import { Hono } from "hono"
import type { Context, MiddlewareHandler } from "hono"
import { cors } from "hono/cors"
import { HTTPException } from "hono/http-exception"
import {
  createJwt,
  generateIngestionToken,
  hashPassword,
  readBearerToken,
  verifyJwt,
  verifyPassword,
  type AuthenticatedUser,
} from "./security"
import { createStorage, DuplicateUsernameError } from "./storage"
import { SupabaseError } from "./supabase"
import type { MetricPacket, UserRow } from "./types"

type Variables = {
  user: AuthenticatedUser
}

const app = new Hono<{ Bindings: Env; Variables: Variables }>()
const maxTagLength = 50
const maxTagsPerServer = 20
const maxMetricBatchSize = 500

app.use("*", async (context, next) => {
  const origin: string = context.env.FRONTEND_ORIGIN
  return cors({
    origin: origin === "*" ? "*" : origin.split(",").map((value) => value.trim()),
    allowHeaders: ["Authorization", "Content-Type"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    maxAge: 86400,
  })(context, next)
})

const requireUser: MiddlewareHandler<{ Bindings: Env; Variables: Variables }> = async (
  context,
  next,
) => {
  const token = readBearerToken(context.req.header("Authorization"))
  const user = token ? await verifyJwt(context.env, token) : null
  if (!user) {
    return context.json({ title: "Unauthorized" }, 401)
  }
  context.set("user", user)
  await next()
}

app.get("/health", (context) => context.json({ status: "ok" }))

app.post("/api/auth/register", async (context) => {
  // Registration is open by default but can be disabled on private
  // deployments by setting ALLOW_REGISTRATION=false.
  if (String(context.env.ALLOW_REGISTRATION ?? "true").toLowerCase() === "false") {
    return context.json(
      { title: "Account registration is disabled on this deployment." },
      403,
    )
  }

  const body = await readJson<{ username?: string; password?: string }>(context)
  const errors = validateCredentials(body.username, body.password)
  if (Object.keys(errors).length > 0) {
    return validationProblem(context, errors)
  }

  const username = body.username!.trim()
  const storage = createStorage(context.env)
  if (await storage.findUserByUsername(username)) {
    return validationProblem(context, { Username: ["Username is already taken."] })
  }

  const user: UserRow = {
    Id: crypto.randomUUID(),
    Username: username,
    PasswordHash: await hashPassword(body.password!),
    IngestionToken: generateIngestionToken(),
    CreatedAt: new Date().toISOString(),
  }

  try {
    await storage.createUser(user)
  } catch (error) {
    if (error instanceof DuplicateUsernameError) {
      return validationProblem(context, { Username: ["Username is already taken."] })
    }
    throw error
  }

  const auth = await createJwt(context.env, { id: user.Id, username: user.Username })
  return context.json({ ...auth, username: user.Username }, 201)
})

app.post("/api/auth/login", async (context) => {
  const body = await readJson<{ username?: string; password?: string }>(context)
  if (!body.username || !body.password) {
    return context.json({ title: "Unauthorized" }, 401)
  }

  const storage = createStorage(context.env)
  const user = await storage.findUserByUsername(body.username.trim())
  if (!user || !(await verifyPassword(body.password, user.PasswordHash))) {
    return context.json({ title: "Unauthorized" }, 401)
  }

  if (!user.PasswordHash.startsWith("netrascope-pbkdf2-v1$")) {
    await storage.updatePassword(user.Id, await hashPassword(body.password))
  }

  const auth = await createJwt(context.env, { id: user.Id, username: user.Username })
  return context.json({ ...auth, username: user.Username })
})

app.get("/api/auth/me", requireUser, async (context) => {
  const user = await createStorage(context.env).findUserById(context.get("user").id)
  if (!user) {
    throw new HTTPException(401, { message: "Unauthorized" })
  }
  return context.json({ username: user.Username, ingestionToken: user.IngestionToken })
})

app.post("/api/auth/token/regenerate", requireUser, async (context) => {
  const token = generateIngestionToken()
  const currentUser = context.get("user")
  await createStorage(context.env).updateIngestionToken(currentUser.id, token)
  return context.json({ username: currentUser.username, ingestionToken: token })
})

app.post("/api/metrics", async (context) => {
  const ingestionToken = readBearerToken(context.req.header("Authorization"))
  if (!ingestionToken) {
    return context.json({ title: "Unauthorized" }, 401)
  }

  const storage = createStorage(context.env)
  const ownerUserId = await storage.findOwnerByIngestionToken(ingestionToken)
  if (!ownerUserId) {
    return context.json({ title: "Unauthorized" }, 401)
  }

  const payload = await readJson<unknown>(context)
  const metrics = normalizeMetricPayload(payload)
  if ("errors" in metrics) {
    return validationProblem(context, metrics.errors)
  }

  const errors = validateMetrics(metrics.packets)
  if (Object.keys(errors).length > 0) {
    return validationProblem(context, errors)
  }

  for (const packet of metrics.packets) {
    const ingested = await storage.ingestMetric(
      packet,
      context.req.header("CF-Connecting-IP") ?? null,
      ownerUserId,
    )
    if (!ingested) {
      return context.json(
        {
          title: "Server ID Conflict",
          detail: "This server ID is already owned by another account.",
        },
        409,
      )
    }

    if (packet.cpuUsagePct > 90) {
      console.warn(
        JSON.stringify({
          event: "high_cpu",
          serverId: packet.serverId,
          cpuUsagePct: packet.cpuUsagePct,
        }),
      )
    }
  }

  return context.body(null, 202)
})

app.get("/api/servers", requireUser, async (context) => {
  const tag = context.req.query("tag")
  const normalizedTag = tag === undefined ? null : normalizeTag(tag)
  if (tag !== undefined && !normalizedTag) {
    return validationProblem(context, {
      tag: ["Tag cannot be empty or exceed 50 characters."],
    })
  }

  const servers = await createStorage(context.env).listServers(
    context.get("user").id,
    normalizedTag,
  )
  return context.json(
    servers.map((server) => ({
      id: server.Id,
      hostName: server.HostName,
      ipAddress: server.IpAddress,
      lastHeartbeatAt: server.LastHeartbeatAt,
      tags: (server.server_tags ?? []).map((item) => item.TagName).sort(),
    })),
  )
})

app.delete("/api/servers/:serverId", requireUser, async (context) => {
  const deleted = await createStorage(context.env).deleteServer(
    context.req.param("serverId"),
    context.get("user").id,
  )
  return deleted
    ? context.body(null, 204)
    : context.json({ title: "Not Found" }, 404)
})

app.get("/api/servers/:serverId/metrics", requireUser, async (context) => {
  const serverId = context.req.param("serverId")
  const storage = createStorage(context.env)
  if (!(await storage.ownsServer(serverId, context.get("user").id))) {
    return context.json({ title: "Not Found" }, 404)
  }

  const requestedMinutes = Number(context.req.query("minutes") ?? 60)
  const minutes = Number.isFinite(requestedMinutes)
    ? Math.min(1440, Math.max(1, Math.trunc(requestedMinutes)))
    : 60
  const since = new Date(Date.now() - minutes * 60_000).toISOString()
  const rows = await storage.listMetrics(serverId, since)
  return context.json(
    rows.map((metric) => ({
      timestamp: metric.Timestamp,
      cpuUsagePct: metric.CpuUsagePct,
      memoryUsedBytes: metric.MemoryUsedBytes,
      memoryTotalBytes: metric.MemoryTotalBytes,
      diskUtilizationPct: metric.DiskUtilizationPct,
      networkInBytesSec: metric.NetworkInBytesSec,
    })),
  )
})

app.get("/api/servers/:serverId/tags", requireUser, async (context) => {
  const serverId = context.req.param("serverId")
  const server = await createStorage(context.env).getServerWithTags(
    serverId,
    context.get("user").id,
  )
  if (!server) {
    return context.json({ title: "Not Found" }, 404)
  }
  return context.json({
    serverId,
    tags: (server.server_tags ?? []).map((item) => item.TagName).sort(),
  })
})

app.put("/api/servers/:serverId/tags", requireUser, async (context) => {
  const body = await readJson<{ tags?: unknown }>(context)
  const validation = validateTags(body.tags)
  if ("errors" in validation) {
    return validationProblem(context, validation.errors)
  }

  const serverId = context.req.param("serverId")
  const replaced = await createStorage(context.env).replaceServerTags(
    serverId,
    context.get("user").id,
    validation.tags,
  )
  if (!replaced) {
    return context.json({ title: "Not Found" }, 404)
  }
  return context.json({ serverId, tags: validation.tags })
})

app.notFound((context) => context.json({ title: "Not Found" }, 404))

app.onError((error, context) => {
  if (error instanceof HTTPException) {
    return context.json({ title: error.message }, error.status)
  }
  if (error instanceof SupabaseError) {
    console.error(
      JSON.stringify({
        event: "supabase_error",
        status: error.status,
        details: error.details,
      }),
    )
  } else {
    console.error(error)
  }
  return context.json({ title: "Internal Server Error" }, 500)
})

async function readJson<T>(context: Context): Promise<T> {
  try {
    return await context.req.json<T>()
  } catch {
    throw new HTTPException(400, { message: "Request body must be valid JSON." })
  }
}

function validationProblem(
  context: Context,
  errors: Record<string, string[]>,
): Response {
  return context.json(
    {
      type: "https://tools.ietf.org/html/rfc9110#section-15.5.1",
      title: "One or more validation errors occurred.",
      status: 400,
      errors,
    },
    400,
  )
}

function validateCredentials(
  username: string | undefined,
  password: string | undefined,
): Record<string, string[]> {
  const errors: Record<string, string[]> = {}
  if (!username?.trim()) {
    errors.Username = ["Username is required."]
  } else if (username.trim().length > 100) {
    errors.Username = ["Username cannot exceed 100 characters."]
  }
  if (!password || password.length < 8) {
    errors.Password = ["Password must be at least 8 characters."]
  }
  return errors
}

function validateMetric(packet: Partial<MetricPacket>): Record<string, string[]> {
  const errors: Record<string, string[]> = {}
  if (!packet.serverId?.trim()) {
    errors.ServerId = ["ServerId is required."]
  } else if (packet.serverId.length > 200) {
    errors.ServerId = ["ServerId cannot exceed 200 characters."]
  }
  if (!packet.timestamp || Number.isNaN(Date.parse(packet.timestamp))) {
    errors.Timestamp = ["Timestamp is required and must be a valid date."]
  }
  if (!isPercentage(packet.cpuUsagePct)) {
    errors.CpuUsagePct = ["CpuUsagePct must be between 0 and 100."]
  }
  if (!isPercentage(packet.diskUtilizationPct)) {
    errors.DiskUtilizationPct = ["DiskUtilizationPct must be between 0 and 100."]
  }
  if (
    !Number.isSafeInteger(packet.memoryUsedBytes) ||
    !Number.isSafeInteger(packet.memoryTotalBytes) ||
    packet.memoryUsedBytes! < 0 ||
    packet.memoryTotalBytes! <= 0 ||
    packet.memoryUsedBytes! > packet.memoryTotalBytes!
  ) {
    errors.MemoryUsedBytes = [
      "Memory values must be non-negative and used memory cannot exceed total memory.",
    ]
  }
  if (!Number.isSafeInteger(packet.networkInBytesSec) || packet.networkInBytesSec! < 0) {
    errors.NetworkInBytesSec = ["NetworkInBytesSec cannot be negative."]
  }
  return errors
}

function normalizeMetricPayload(
  value: unknown,
): { packets: MetricPacket[] } | { errors: Record<string, string[]> } {
  const packets = Array.isArray(value) ? value : [value]
  if (packets.length === 0) {
    return { errors: { Metrics: ["At least one metric packet is required."] } }
  }
  if (packets.length > maxMetricBatchSize) {
    return { errors: { Metrics: [`Metric batches cannot exceed ${maxMetricBatchSize} packets.`] } }
  }
  if (!packets.every((packet) => packet && typeof packet === "object" && !Array.isArray(packet))) {
    return {
      errors: {
        Metrics: ["Metric payload must be a metric object or an array of metric objects."],
      },
    }
  }
  return { packets: packets as MetricPacket[] }
}

function validateMetrics(packets: MetricPacket[]): Record<string, string[]> {
  const errors: Record<string, string[]> = {}
  packets.forEach((packet, index) => {
    const packetErrors = validateMetric(packet)
    for (const [key, value] of Object.entries(packetErrors)) {
      errors[`Metrics[${index}].${key}`] = value
    }
  })
  return errors
}

function isPercentage(value: number | undefined): boolean {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
}

function normalizeTag(tag: string): string | null {
  const normalized = tag.trim().toLowerCase()
  return normalized && normalized.length <= maxTagLength ? normalized : null
}

function validateTags(
  value: unknown,
): { tags: string[] } | { errors: Record<string, string[]> } {
  if (!Array.isArray(value)) {
    return { errors: { Tags: ["Tags is required. Use an empty array to remove all tags."] } }
  }
  if (value.some((tag) => typeof tag !== "string" || !normalizeTag(tag))) {
    return { errors: { Tags: ["Tags cannot be empty and cannot exceed 50 characters."] } }
  }
  const tags = [...new Set(value.map((tag) => normalizeTag(tag as string)!))].sort()
  if (tags.length > maxTagsPerServer) {
    return { errors: { Tags: [`A server can have at most ${maxTagsPerServer} tags.`] } }
  }
  return { tags }
}

export default app
