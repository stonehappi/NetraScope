import { Hono } from "hono"
import type { Context, MiddlewareHandler } from "hono"
import { cors } from "hono/cors"
import { HTTPException } from "hono/http-exception"
import {
  createJwt,
  generateIngestionToken,
  hashIngestionToken,
  hashPassword,
  readBearerToken,
  tokenSuffix,
  verifyJwt,
  verifyPassword,
  type AuthenticatedUser,
} from "./security"
import { createStorage, DuplicateUsernameError } from "./storage"
import { SupabaseError } from "./supabase"
import type { AlertEventRow, MetricPacket, UserRow } from "./types"

type Variables = {
  user: AuthenticatedUser
}

const app = new Hono<{ Bindings: Env; Variables: Variables }>()
const maxTagLength = 50
const maxTagsPerServer = 20
const maxMetricBatchSize = 500
const activeAlertStatus = "active"
const resolvedAlertStatus = "resolved"
const criticalAlertSeverity = "critical"
const authRateLimit = createInMemoryRateLimiter(30, 60_000)
const metricRateLimit = createInMemoryRateLimiter(900, 60_000)

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
  if (!authRateLimit(clientIp(context))) {
    return context.json({ title: "Too Many Requests" }, 429)
  }
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
    await audit(storage, user.Id, "user", "auth.registered", "user", user.Id, user.Username, context)
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
  if (!authRateLimit(clientIp(context))) {
    return context.json({ title: "Too Many Requests" }, 429)
  }
  const body = await readJson<{ username?: string; password?: string }>(context)
  if (!body.username || !body.password) {
    return context.json({ title: "Unauthorized" }, 401)
  }

  const storage = createStorage(context.env)
  const user = await storage.findUserByUsername(body.username.trim())
  if (!user || !(await verifyPassword(body.password, user.PasswordHash))) {
    await audit(storage, user?.Id ?? null, "anonymous", "auth.login_failed", "user", user?.Id ?? null, body.username.trim(), context)
    return context.json({ title: "Unauthorized" }, 401)
  }

  if (!user.PasswordHash.startsWith("netrascope-pbkdf2-v1$")) {
    await storage.updatePassword(user.Id, await hashPassword(body.password))
  }

  await audit(storage, user.Id, "user", "auth.login_succeeded", "user", user.Id, user.Username, context)
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
  const storage = createStorage(context.env)
  await storage.updateIngestionToken(currentUser.id, token)
  await audit(storage, currentUser.id, "user", "account_token.rotated", "user", currentUser.id, "Account-wide ingestion token rotated.", context)
  return context.json({ username: currentUser.username, ingestionToken: token })
})

app.post("/api/metrics", async (context) => {
  if (!metricRateLimit(clientIp(context))) {
    return context.json({ title: "Too Many Requests" }, 429)
  }
  const ingestionToken = readBearerToken(context.req.header("Authorization"))
  if (!ingestionToken) {
    return context.json({ title: "Unauthorized" }, 401)
  }

  const storage = createStorage(context.env)
  const agentToken = await storage.findAgentTokenByHash(await hashIngestionToken(ingestionToken))
  if (agentToken && !ipAllowed(agentToken.AllowedIpAddresses, clientIp(context))) {
    return context.json({ title: "Unauthorized" }, 401)
  }
  const ownerUserId = agentToken?.OwnerUserId ?? (await storage.findOwnerByIngestionToken(ingestionToken))
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

  if (agentToken && metrics.packets.some((packet) => packet.serverId !== agentToken.ServerId)) {
    return context.json({ title: "Unauthorized" }, 401)
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

    await evaluateMetricAlerts(storage, context.env, packet, ownerUserId)
  }

  if (agentToken) {
    await storage.updateAgentTokenLastUsed(agentToken.Id, new Date().toISOString())
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
  const storage = createStorage(context.env)
  const serverId = context.req.param("serverId")
  const deleted = await storage.deleteServer(
    serverId,
    context.get("user").id,
  )
  if (deleted) {
    await audit(storage, context.get("user").id, "user", "server.deleted", "server", serverId, serverId, context)
  }
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

app.get("/api/servers/:serverId/tokens", requireUser, async (context) => {
  const serverId = context.req.param("serverId")
  const storage = createStorage(context.env)
  if (!(await storage.ownsServer(serverId, context.get("user").id))) {
    return context.json({ title: "Not Found" }, 404)
  }
  const tokens = await storage.listAgentTokens(serverId, context.get("user").id)
  return context.json(tokens.map(mapAgentTokenResponse))
})

app.post("/api/servers/:serverId/tokens", requireUser, async (context) => {
  const serverId = context.req.param("serverId")
  const storage = createStorage(context.env)
  if (!(await storage.ownsServer(serverId, context.get("user").id))) {
    return context.json({ title: "Not Found" }, 404)
  }
  const body = await readJson<{ name?: string; allowedIpAddresses?: unknown }>(context)
  const validation = validateAgentTokenInput(body.name, body.allowedIpAddresses)
  if ("errors" in validation) {
    return validationProblem(context, validation.errors)
  }
  const rawToken = generateIngestionToken()
  const now = new Date().toISOString()
  const token = {
    Id: crypto.randomUUID(),
    ServerId: serverId,
    OwnerUserId: context.get("user").id,
    Name: validation.name,
    TokenHash: await hashIngestionToken(rawToken),
    TokenSuffix: tokenSuffix(rawToken),
    AllowedIpAddresses: joinIpAllowlist(validation.allowedIpAddresses),
    CreatedAt: now,
    LastUsedAt: null,
    RevokedAt: null,
  }
  await storage.createAgentToken(token)
  await audit(storage, context.get("user").id, "user", "agent_token.created", "agent_token", token.Id, serverId, context)
  return context.json({ ...mapAgentTokenResponse(token), token: rawToken }, 201)
})

app.put("/api/servers/:serverId/tokens/:tokenId", requireUser, async (context) => {
  const serverId = context.req.param("serverId")
  const tokenId = context.req.param("tokenId")
  const storage = createStorage(context.env)
  const existing = (await storage.listAgentTokens(serverId, context.get("user").id)).find(
    (token) => token.Id === tokenId,
  )
  if (!existing) {
    return context.json({ title: "Not Found" }, 404)
  }
  const body = await readJson<{ name?: string; allowedIpAddresses?: unknown }>(context)
  const validation = validateAgentTokenInput(body.name, body.allowedIpAddresses)
  if ("errors" in validation) {
    return validationProblem(context, validation.errors)
  }
  const updated = {
    ...existing,
    Name: validation.name,
    AllowedIpAddresses: joinIpAllowlist(validation.allowedIpAddresses),
  }
  await storage.updateAgentToken(updated)
  await audit(storage, context.get("user").id, "user", "agent_token.updated", "agent_token", tokenId, serverId, context)
  return context.json(mapAgentTokenResponse(updated))
})

app.post("/api/servers/:serverId/tokens/:tokenId/rotate", requireUser, async (context) => {
  const serverId = context.req.param("serverId")
  const tokenId = context.req.param("tokenId")
  const storage = createStorage(context.env)
  const existing = (await storage.listAgentTokens(serverId, context.get("user").id)).find(
    (token) => token.Id === tokenId,
  )
  if (!existing) {
    return context.json({ title: "Not Found" }, 404)
  }
  const rawToken = generateIngestionToken()
  const updated = {
    ...existing,
    TokenHash: await hashIngestionToken(rawToken),
    TokenSuffix: tokenSuffix(rawToken),
    LastUsedAt: null,
    RevokedAt: null,
  }
  await storage.updateAgentToken(updated)
  await audit(storage, context.get("user").id, "user", "agent_token.rotated", "agent_token", tokenId, serverId, context)
  return context.json({ ...mapAgentTokenResponse(updated), token: rawToken })
})

app.delete("/api/servers/:serverId/tokens/:tokenId", requireUser, async (context) => {
  const serverId = context.req.param("serverId")
  const tokenId = context.req.param("tokenId")
  const storage = createStorage(context.env)
  const existing = (await storage.listAgentTokens(serverId, context.get("user").id)).find(
    (token) => token.Id === tokenId,
  )
  if (!existing) {
    return context.json({ title: "Not Found" }, 404)
  }
  const updated = { ...existing, RevokedAt: existing.RevokedAt ?? new Date().toISOString() }
  await storage.updateAgentToken(updated)
  await audit(storage, context.get("user").id, "user", "agent_token.revoked", "agent_token", tokenId, serverId, context)
  return context.json(mapAgentTokenResponse(updated))
})

app.get("/api/alerts", requireUser, async (context) => {
  const status = context.req.query("status")?.trim().toLowerCase() ?? null
  if (status !== null && status !== activeAlertStatus && status !== resolvedAlertStatus) {
    return validationProblem(context, { status: ["Status must be active or resolved."] })
  }

  const alerts = await createStorage(context.env).listAlerts(context.get("user").id, status)
  return context.json(alerts.map(mapAlertResponse))
})

app.get("/api/audit-logs", requireUser, async (context) => {
  const logs = await createStorage(context.env).listAuditLogs(context.get("user").id)
  return context.json(
    logs.map((log) => ({
      id: log.Id,
      actorType: log.ActorType,
      action: log.Action,
      entityType: log.EntityType,
      entityId: log.EntityId,
      message: log.Message,
      ipAddress: log.IpAddress,
      createdAt: log.CreatedAt,
    })),
  )
})

app.put("/api/servers/:serverId/tags", requireUser, async (context) => {
  const body = await readJson<{ tags?: unknown }>(context)
  const validation = validateTags(body.tags)
  if ("errors" in validation) {
    return validationProblem(context, validation.errors)
  }

  const serverId = context.req.param("serverId")
  const storage = createStorage(context.env)
  const replaced = await storage.replaceServerTags(
    serverId,
    context.get("user").id,
    validation.tags,
  )
  if (!replaced) {
    return context.json({ title: "Not Found" }, 404)
  }
  await audit(storage, context.get("user").id, "user", "server.tags_updated", "server", serverId, validation.tags.join(","), context)
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

function createInMemoryRateLimiter(limit: number, windowMs: number) {
  const buckets = new Map<string, { count: number; resetAt: number }>()
  return (key: string): boolean => {
    const now = Date.now()
    const bucket = buckets.get(key)
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs })
      return true
    }
    if (bucket.count >= limit) {
      return false
    }
    bucket.count += 1
    return true
  }
}

function clientIp(context: Context): string {
  return (
    context.req.header("CF-Connecting-IP") ??
    context.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ??
    "unknown"
  )
}

async function audit(
  storage: ReturnType<typeof createStorage>,
  ownerUserId: string | null,
  actorType: string,
  action: string,
  entityType: string,
  entityId: string | null,
  message: string | null,
  context: Context,
): Promise<void> {
  await storage.createAuditLog({
    OwnerUserId: ownerUserId,
    ActorType: actorType,
    Action: action,
    EntityType: entityType,
    EntityId: entityId,
    Message: message,
    IpAddress: clientIp(context) === "unknown" ? null : clientIp(context),
    CreatedAt: new Date().toISOString(),
  })
}

function mapAgentTokenResponse(token: {
  Id: string
  ServerId: string
  Name: string
  TokenSuffix: string
  AllowedIpAddresses: string | null
  CreatedAt: string
  LastUsedAt: string | null
  RevokedAt: string | null
}) {
  return {
    id: token.Id,
    serverId: token.ServerId,
    name: token.Name,
    tokenSuffix: token.TokenSuffix,
    allowedIpAddresses: splitIpAllowlist(token.AllowedIpAddresses),
    createdAt: token.CreatedAt,
    lastUsedAt: token.LastUsedAt,
    revokedAt: token.RevokedAt,
  }
}

function validateAgentTokenInput(
  nameValue: string | undefined,
  allowedIpAddressesValue: unknown,
): { name: string; allowedIpAddresses: string[] } | { errors: Record<string, string[]> } {
  const errors: Record<string, string[]> = {}
  const name = nameValue?.trim() || "Default agent token"
  if (name.length > 100) {
    errors.Name = ["Name cannot exceed 100 characters."]
  }

  if (allowedIpAddressesValue !== undefined && !Array.isArray(allowedIpAddressesValue)) {
    errors.AllowedIpAddresses = ["AllowedIpAddresses must be an array of IP addresses."]
  }

  const allowedIpAddresses = Array.isArray(allowedIpAddressesValue)
    ? [
        ...new Set(
          allowedIpAddressesValue
            .filter((item): item is string => typeof item === "string")
            .map((ip) => ip.trim())
            .filter(Boolean),
        ),
      ]
    : []

  if (
    allowedIpAddresses.length !==
      (Array.isArray(allowedIpAddressesValue)
        ? allowedIpAddressesValue.filter((item) => typeof item === "string" && item.trim()).length
        : allowedIpAddresses.length) ||
    allowedIpAddresses.some((ip) => ip.length > 45 || ip.includes(","))
  ) {
    errors.AllowedIpAddresses = [
      "IP allowlist entries must be plain IP addresses up to 45 characters.",
    ]
  }

  if (Object.keys(errors).length > 0) {
    return { errors }
  }

  return { name, allowedIpAddresses }
}

function joinIpAllowlist(allowedIpAddresses: string[]): string | null {
  return allowedIpAddresses.length === 0 ? null : allowedIpAddresses.join(",")
}

function splitIpAllowlist(value: string | null): string[] {
  return value ? value.split(",").map((ip) => ip.trim()).filter(Boolean) : []
}

function ipAllowed(allowedIpAddresses: string | null, ipAddress: string): boolean {
  const allowed = splitIpAllowlist(allowedIpAddresses)
  return allowed.length === 0 || allowed.includes(ipAddress)
}

interface AlertingSettings {
  enabled: boolean
  cpuThresholdPct: number
  cpuSustainedMinutes: number
  memoryThresholdPct: number
  diskThresholdPct: number
  offlineMinutes: number
  webhookUrls: string[]
  emailWebhookUrl: string | null
  discordWebhookUrl: string | null
  slackWebhookUrl: string | null
  telegramBotToken: string | null
  telegramChatId: string | null
}

async function evaluateMetricAlerts(
  storage: ReturnType<typeof createStorage>,
  env: Env,
  packet: MetricPacket,
  ownerUserId: string,
): Promise<void> {
  const settings = alertingSettings(env)
  if (!settings.enabled) {
    return
  }

  const observedAt = parseMetricDate(packet.timestamp)
  const memoryPct = (packet.memoryUsedBytes / packet.memoryTotalBytes) * 100
  const cpuSustained = await isCpuSustained(storage, packet, observedAt, settings)

  await evaluateRule(
    storage,
    env,
    packet.serverId,
    ownerUserId,
    "cpu_high_5m",
    cpuSustained,
    packet.cpuUsagePct,
    settings.cpuThresholdPct,
    observedAt,
    `CPU stayed above ${settings.cpuThresholdPct}% for ${settings.cpuSustainedMinutes} minutes.`,
    "CPU recovered below the sustained alert threshold.",
  )
  await evaluateRule(
    storage,
    env,
    packet.serverId,
    ownerUserId,
    "memory_high",
    memoryPct > settings.memoryThresholdPct,
    memoryPct,
    settings.memoryThresholdPct,
    observedAt,
    `Memory usage is ${formatPct(memoryPct)}%, above ${settings.memoryThresholdPct}%.`,
    "Memory usage recovered below the alert threshold.",
  )
  await evaluateRule(
    storage,
    env,
    packet.serverId,
    ownerUserId,
    "disk_high",
    packet.diskUtilizationPct > settings.diskThresholdPct,
    packet.diskUtilizationPct,
    settings.diskThresholdPct,
    observedAt,
    `Disk usage is ${formatPct(packet.diskUtilizationPct)}%, above ${settings.diskThresholdPct}%.`,
    "Disk usage recovered below the alert threshold.",
  )
  await resolveAlert(
    storage,
    env,
    packet.serverId,
    ownerUserId,
    "server_offline",
    observedAt.toISOString(),
    "Server heartbeat recovered.",
  )
}

async function evaluateOfflineAlerts(env: Env): Promise<void> {
  const settings = alertingSettings(env)
  if (!settings.enabled) {
    return
  }

  const storage = createStorage(env)
  const now = new Date()
  const cutoff = new Date(now.getTime() - settings.offlineMinutes * 60_000).toISOString()
  const servers = await storage.listOfflineServers(cutoff)
  for (const server of servers) {
    if (!server.OwnerUserId) {
      continue
    }
    await triggerAlert(
      storage,
      env,
      server.Id,
      server.OwnerUserId,
      "server_offline",
      null,
      settings.offlineMinutes,
      now.toISOString(),
      `Server has been offline since ${server.LastHeartbeatAt}.`,
    )
  }
}

async function isCpuSustained(
  storage: ReturnType<typeof createStorage>,
  packet: MetricPacket,
  observedAt: Date,
  settings: AlertingSettings,
): Promise<boolean> {
  const since = new Date(observedAt.getTime() - settings.cpuSustainedMinutes * 60_000)
  const points = await storage.listMetrics(packet.serverId, since.toISOString())
  const bounded = points.filter((point) => parseMetricDate(point.Timestamp) <= observedAt)
  return (
    bounded.length > 0 &&
    Math.min(...bounded.map((point) => parseMetricDate(point.Timestamp).getTime())) <=
      since.getTime() &&
    bounded.every((point) => point.CpuUsagePct > settings.cpuThresholdPct)
  )
}

async function evaluateRule(
  storage: ReturnType<typeof createStorage>,
  env: Env,
  serverId: string,
  ownerUserId: string,
  ruleKey: string,
  isTriggered: boolean,
  triggerValue: number,
  thresholdValue: number,
  observedAt: Date,
  triggerMessage: string,
  resolveMessage: string,
): Promise<void> {
  if (isTriggered) {
    await triggerAlert(
      storage,
      env,
      serverId,
      ownerUserId,
      ruleKey,
      triggerValue,
      thresholdValue,
      observedAt.toISOString(),
      triggerMessage,
    )
    return
  }

  await resolveAlert(
    storage,
    env,
    serverId,
    ownerUserId,
    ruleKey,
    observedAt.toISOString(),
    resolveMessage,
  )
}

async function triggerAlert(
  storage: ReturnType<typeof createStorage>,
  env: Env,
  serverId: string,
  ownerUserId: string,
  ruleKey: string,
  triggerValue: number | null,
  thresholdValue: number | null,
  observedAt: string,
  message: string,
): Promise<void> {
  const active = await storage.findActiveAlert(serverId, ownerUserId, ruleKey)
  if (active) {
    await storage.updateAlert({
      ...active,
      Message: message,
      TriggerValue: triggerValue,
      LastObservedAt: observedAt,
    })
    return
  }

  const created = await storage.createAlert({
    ServerId: serverId,
    OwnerUserId: ownerUserId,
    RuleKey: ruleKey,
    Severity: criticalAlertSeverity,
    Status: activeAlertStatus,
    Message: message,
    TriggerValue: triggerValue,
    ThresholdValue: thresholdValue,
    TriggeredAt: observedAt,
    LastObservedAt: observedAt,
    ResolvedAt: null,
  })
  await notifyAlert(env, created)
  await storage.updateAlert({ ...created, LastNotifiedAt: new Date().toISOString() })
}

async function resolveAlert(
  storage: ReturnType<typeof createStorage>,
  env: Env,
  serverId: string,
  ownerUserId: string,
  ruleKey: string,
  observedAt: string,
  message: string,
): Promise<void> {
  const active = await storage.findActiveAlert(serverId, ownerUserId, ruleKey)
  if (!active) {
    return
  }

  const resolved: AlertEventRow = {
    ...active,
    Status: resolvedAlertStatus,
    Message: message,
    LastObservedAt: observedAt,
    ResolvedAt: observedAt,
  }
  await storage.updateAlert(resolved)
  await notifyAlert(env, resolved)
  await storage.updateAlert({ ...resolved, LastNotifiedAt: new Date().toISOString() })
}

async function notifyAlert(env: Env, alert: AlertEventRow): Promise<void> {
  const settings = alertingSettings(env)
  const payload = mapAlertResponse(alert)
  const text = `NetraScope ${alert.Status.toUpperCase()} ${alert.RuleKey} for ${alert.ServerId}: ${alert.Message}`
  const targets: Array<{ url: string; body: unknown }> = [
    ...settings.webhookUrls.map((url) => ({ url, body: payload })),
    ...(settings.emailWebhookUrl ? [{ url: settings.emailWebhookUrl, body: payload }] : []),
    ...(settings.discordWebhookUrl
      ? [{ url: settings.discordWebhookUrl, body: { content: text } }]
      : []),
    ...(settings.slackWebhookUrl ? [{ url: settings.slackWebhookUrl, body: { text } }] : []),
  ]

  if (settings.telegramBotToken && settings.telegramChatId) {
    targets.push({
      url: `https://api.telegram.org/bot${settings.telegramBotToken}/sendMessage`,
      body: { chat_id: settings.telegramChatId, text },
    })
  }

  if (targets.length === 0) {
    console.warn(JSON.stringify({ event: "alert.changed", alert: payload }))
    return
  }

  await Promise.all(
    targets.map(async (target) => {
      try {
        const response = await fetch(target.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(target.body),
        })
        if (!response.ok) {
          console.warn(
            JSON.stringify({
              event: "alert.notification_failed",
              status: response.status,
              url: target.url,
            }),
          )
        }
      } catch (error) {
        console.warn(
          JSON.stringify({
            event: "alert.notification_failed",
            url: target.url,
            error: error instanceof Error ? error.message : String(error),
          }),
        )
      }
    }),
  )
}

function mapAlertResponse(alert: AlertEventRow) {
  return {
    id: alert.Id,
    serverId: alert.ServerId,
    ruleKey: alert.RuleKey,
    severity: alert.Severity,
    status: alert.Status,
    message: alert.Message,
    triggerValue: alert.TriggerValue,
    thresholdValue: alert.ThresholdValue,
    triggeredAt: alert.TriggeredAt,
    lastObservedAt: alert.LastObservedAt,
    resolvedAt: alert.ResolvedAt,
    lastNotifiedAt: alert.LastNotifiedAt,
  }
}

function alertingSettings(env: Env): AlertingSettings {
  return {
    enabled: readEnv(env, "ALERTING_ENABLED", "true").toLowerCase() !== "false",
    cpuThresholdPct: readNumberEnv(env, "ALERT_CPU_THRESHOLD_PCT", 90),
    cpuSustainedMinutes: readNumberEnv(env, "ALERT_CPU_SUSTAINED_MINUTES", 5),
    memoryThresholdPct: readNumberEnv(env, "ALERT_MEMORY_THRESHOLD_PCT", 90),
    diskThresholdPct: readNumberEnv(env, "ALERT_DISK_THRESHOLD_PCT", 85),
    offlineMinutes: readNumberEnv(env, "ALERT_OFFLINE_MINUTES", 2),
    webhookUrls: readEnv(env, "ALERT_WEBHOOK_URLS", "")
      .split(",")
      .map((url) => url.trim())
      .filter(Boolean),
    emailWebhookUrl: optionalEnv(env, "ALERT_EMAIL_WEBHOOK_URL"),
    discordWebhookUrl: optionalEnv(env, "ALERT_DISCORD_WEBHOOK_URL"),
    slackWebhookUrl: optionalEnv(env, "ALERT_SLACK_WEBHOOK_URL"),
    telegramBotToken: optionalEnv(env, "ALERT_TELEGRAM_BOT_TOKEN"),
    telegramChatId: optionalEnv(env, "ALERT_TELEGRAM_CHAT_ID"),
  }
}

function readNumberEnv(env: Env, key: string, fallback: number): number {
  const value = Number(readEnv(env, key, String(fallback)))
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function optionalEnv(env: Env, key: string): string | null {
  const value = readEnv(env, key, "").trim()
  return value || null
}

function readEnv(env: Env, key: string, fallback: string): string {
  const values = env as unknown as Record<string, string | undefined>
  return values[key] ?? fallback
}

function parseMetricDate(value: string): Date {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? new Date() : date
}

function formatPct(value: number): string {
  return Number(value.toFixed(1)).toString()
}

export default {
  fetch: app.fetch,
  scheduled(_event: ScheduledEvent, env: Env, context: ExecutionContext) {
    context.waitUntil(evaluateOfflineAlerts(env))
  },
}
