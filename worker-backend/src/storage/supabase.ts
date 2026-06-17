import { eq, SupabaseError, supabaseRequest } from "../supabase"
import { DuplicateUsernameError, type Storage } from "../storage"
import type {
  AgentTokenRow,
  AlertEventRow,
  AuditLogRow,
  MetricPacket,
  MetricRow,
  ServerRow,
  UserRow,
} from "../types"

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
      `servers?select=Id,HostName,IpAddress,LastHeartbeatAt,OwnerUserId,${relation}` +
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

  async deleteServer(serverId: string, ownerUserId: string): Promise<boolean> {
    const rows = await supabaseRequest<Pick<ServerRow, "Id">[]>(
      this.env,
      `servers?select=Id&Id=${eq(serverId)}&OwnerUserId=${eq(ownerUserId)}`,
      {
        method: "DELETE",
        headers: { Prefer: "return=representation" },
      },
    )
    return rows.length === 1
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
      `servers?select=Id,HostName,IpAddress,LastHeartbeatAt,OwnerUserId,server_tags(TagName)&Id=${eq(serverId)}&OwnerUserId=${eq(ownerUserId)}&limit=1`,
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

  async listAlerts(ownerUserId: string, status: string | null): Promise<AlertEventRow[]> {
    let query =
      `alert_events?select=*&OwnerUserId=${eq(ownerUserId)}` +
      "&order=LastObservedAt.desc&limit=100"
    if (status) {
      query += `&Status=${eq(status)}`
    }
    return supabaseRequest<AlertEventRow[]>(this.env, query)
  }

  async findActiveAlert(
    serverId: string,
    ownerUserId: string,
    ruleKey: string,
  ): Promise<AlertEventRow | null> {
    const rows = await supabaseRequest<AlertEventRow[]>(
      this.env,
      `alert_events?select=*&ServerId=${eq(serverId)}&OwnerUserId=${eq(ownerUserId)}` +
        `&RuleKey=${eq(ruleKey)}&Status=eq.active&limit=1`,
    )
    return rows[0] ?? null
  }

  async createAlert(alert: Omit<AlertEventRow, "Id" | "LastNotifiedAt">): Promise<AlertEventRow> {
    const rows = await supabaseRequest<AlertEventRow[]>(this.env, "alert_events", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(alert),
    })
    const created = rows[0]
    if (!created) {
      throw new Error("Failed to create alert event")
    }
    return created
  }

  async updateAlert(alert: AlertEventRow): Promise<void> {
    await supabaseRequest<void>(this.env, `alert_events?Id=eq.${alert.Id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        Severity: alert.Severity,
        Status: alert.Status,
        Message: alert.Message,
        TriggerValue: alert.TriggerValue,
        LastObservedAt: alert.LastObservedAt,
        ResolvedAt: alert.ResolvedAt,
        LastNotifiedAt: alert.LastNotifiedAt,
      }),
    })
  }

  async listOfflineServers(cutoff: string): Promise<ServerRow[]> {
    return supabaseRequest<ServerRow[]>(
      this.env,
      "servers?select=Id,HostName,IpAddress,LastHeartbeatAt,OwnerUserId,server_tags(TagName)" +
        `&OwnerUserId=not.is.null&LastHeartbeatAt=lte.${encodeURIComponent(cutoff)}` +
        "&order=Id.asc",
    )
  }

  async findAgentTokenByHash(tokenHash: string): Promise<AgentTokenRow | null> {
    const rows = await supabaseRequest<AgentTokenRow[]>(
      this.env,
      `agent_tokens?select=*&TokenHash=${eq(tokenHash)}&RevokedAt=is.null&limit=1`,
    )
    return rows[0] ?? null
  }

  async listAgentTokens(serverId: string, ownerUserId: string): Promise<AgentTokenRow[]> {
    return supabaseRequest<AgentTokenRow[]>(
      this.env,
      `agent_tokens?select=*&ServerId=${eq(serverId)}&OwnerUserId=${eq(ownerUserId)}&order=CreatedAt.desc`,
    )
  }

  async createAgentToken(token: AgentTokenRow): Promise<void> {
    await supabaseRequest<void>(this.env, "agent_tokens", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(token),
    })
  }

  async updateAgentToken(token: AgentTokenRow): Promise<void> {
    await supabaseRequest<void>(this.env, `agent_tokens?Id=${eq(token.Id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        Name: token.Name,
        TokenHash: token.TokenHash,
        TokenSuffix: token.TokenSuffix,
        AllowedIpAddresses: token.AllowedIpAddresses,
        LastUsedAt: token.LastUsedAt,
        RevokedAt: token.RevokedAt,
      }),
    })
  }

  async updateAgentTokenLastUsed(tokenId: string, lastUsedAt: string): Promise<void> {
    await supabaseRequest<void>(this.env, `agent_tokens?Id=${eq(tokenId)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ LastUsedAt: lastUsedAt }),
    })
  }

  async listAuditLogs(ownerUserId: string): Promise<AuditLogRow[]> {
    return supabaseRequest<AuditLogRow[]>(
      this.env,
      `audit_logs?select=*&OwnerUserId=${eq(ownerUserId)}&order=CreatedAt.desc&limit=100`,
    )
  }

  async createAuditLog(log: Omit<AuditLogRow, "Id">): Promise<void> {
    await supabaseRequest<void>(this.env, "audit_logs", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(log),
    })
  }
}
