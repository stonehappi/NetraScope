import { eq, SupabaseError, supabaseRequest } from "../supabase"
import { DuplicateUsernameError, type Storage } from "../storage"
import type { MetricPacket, MetricRow, ServerRow, UserRow } from "../types"

export class SupabaseStorage implements Storage {
  constructor(private readonly env: Env) {}

  async findUserByUsername(username: string): Promise<UserRow | null> {
    const users = await supabaseRequest<UserRow[]>(
      this.env,
      `users?select=Id,Username,PasswordHash,IngestionToken,CreatedAt&Username=${eq(username)}&limit=1`,
    )
    return users[0] ?? null
  }

  async createUser(user: UserRow): Promise<void> {
    try {
      await supabaseRequest<void>(this.env, "users", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(user),
      })
    } catch (error) {
      if (error instanceof SupabaseError && error.status === 409) {
        throw new DuplicateUsernameError()
      }
      throw error
    }
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await supabaseRequest<void>(this.env, `users?Id=${eq(userId)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ PasswordHash: passwordHash }),
    })
  }

  async findUserById(userId: string): Promise<UserRow | null> {
    const users = await supabaseRequest<UserRow[]>(
      this.env,
      `users?select=Id,Username,PasswordHash,IngestionToken,CreatedAt&Id=${eq(userId)}&limit=1`,
    )
    return users[0] ?? null
  }

  async updateIngestionToken(userId: string, token: string): Promise<void> {
    await supabaseRequest<void>(this.env, `users?Id=${eq(userId)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ IngestionToken: token }),
    })
  }

  async findOwnerByIngestionToken(token: string): Promise<string | null> {
    const users = await supabaseRequest<Pick<UserRow, "Id">[]>(
      this.env,
      `users?select=Id&IngestionToken=${eq(token)}&limit=1`,
    )
    return users[0]?.Id ?? null
  }

  async ingestMetric(
    packet: MetricPacket,
    ipAddress: string | null,
    ownerUserId: string,
  ): Promise<boolean> {
    return supabaseRequest<boolean>(this.env, "rpc/netrascope_ingest_metric", {
      method: "POST",
      body: JSON.stringify({
        p_server_id: packet.serverId,
        p_timestamp: packet.timestamp,
        p_cpu_usage_pct: packet.cpuUsagePct,
        p_memory_used_bytes: packet.memoryUsedBytes,
        p_memory_total_bytes: packet.memoryTotalBytes,
        p_disk_utilization_pct: packet.diskUtilizationPct,
        p_network_in_bytes_sec: packet.networkInBytesSec,
        p_ip_address: ipAddress,
        p_owner_user_id: ownerUserId,
      }),
    })
  }

  async listServers(ownerUserId: string, tag: string | null): Promise<ServerRow[]> {
    const relation = tag ? "server_tags!inner(TagName)" : "server_tags(TagName)"
    let query =
      `servers?select=Id,HostName,IpAddress,LastHeartbeatAt,${relation}` +
      `&OwnerUserId=${eq(ownerUserId)}&order=Id.asc`
    if (tag) {
      query += `&server_tags.TagName=${eq(tag)}`
    }
    return supabaseRequest<ServerRow[]>(this.env, query)
  }

  async ownsServer(serverId: string, ownerUserId: string): Promise<boolean> {
    const rows = await supabaseRequest<Pick<ServerRow, "Id">[]>(
      this.env,
      `servers?select=Id&Id=${eq(serverId)}&OwnerUserId=${eq(ownerUserId)}&limit=1`,
    )
    return rows.length > 0
  }

  async listMetrics(serverId: string, since: string): Promise<MetricRow[]> {
    return supabaseRequest<MetricRow[]>(
      this.env,
      "performance_metrics" +
        "?select=Timestamp,CpuUsagePct,MemoryUsedBytes,MemoryTotalBytes,DiskUtilizationPct,NetworkInBytesSec" +
        `&ServerId=${eq(serverId)}&Timestamp=gte.${encodeURIComponent(since)}&order=Timestamp.asc`,
    )
  }

  async getServerWithTags(
    serverId: string,
    ownerUserId: string,
  ): Promise<ServerRow | null> {
    const rows = await supabaseRequest<ServerRow[]>(
      this.env,
      `servers?select=Id,server_tags(TagName)&Id=${eq(serverId)}&OwnerUserId=${eq(ownerUserId)}&limit=1`,
    )
    return rows[0] ?? null
  }

  async replaceServerTags(
    serverId: string,
    ownerUserId: string,
    tags: string[],
  ): Promise<boolean> {
    return supabaseRequest<boolean>(this.env, "rpc/netrascope_replace_server_tags", {
      method: "POST",
      body: JSON.stringify({
        p_server_id: serverId,
        p_owner_user_id: ownerUserId,
        p_tags: tags,
      }),
    })
  }
}
