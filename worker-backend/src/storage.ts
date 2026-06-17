import { D1Storage } from "./storage/d1"
import { SupabaseStorage } from "./storage/supabase"
import type {
  AgentTokenRow,
  AlertEventRow,
  AuditLogRow,
  MetricPacket,
  MetricRow,
  RollupGranularity,
  ServerRow,
  UserRow,
} from "./types"

export interface Storage {
  findUserByUsername(username: string): Promise<UserRow | null>
  createUser(user: UserRow): Promise<void>
  updatePassword(userId: string, passwordHash: string): Promise<void>
  findUserById(userId: string): Promise<UserRow | null>
  updateIngestionToken(userId: string, token: string): Promise<void>
  findOwnerByIngestionToken(token: string): Promise<string | null>
  ingestMetric(
    packet: MetricPacket,
    ipAddress: string | null,
    ownerUserId: string,
  ): Promise<boolean>
  listServers(ownerUserId: string, tag: string | null): Promise<ServerRow[]>
  ownsServer(serverId: string, ownerUserId: string): Promise<boolean>
  deleteServer(serverId: string, ownerUserId: string): Promise<boolean>
  listMetrics(serverId: string, since: string): Promise<MetricRow[]>
  listMetricRollups(
    granularity: RollupGranularity,
    serverId: string,
    since: string,
  ): Promise<MetricRow[]>
  rollupMetrics(fiveMinuteSince: string, hourSince: string): Promise<void>
  pruneHistory(
    rawCutoff: string,
    fiveMinuteCutoff: string,
    hourCutoff: string,
  ): Promise<void>
  getServerWithTags(serverId: string, ownerUserId: string): Promise<ServerRow | null>
  replaceServerTags(
    serverId: string,
    ownerUserId: string,
    tags: string[],
  ): Promise<boolean>
  listAlerts(ownerUserId: string, status: string | null): Promise<AlertEventRow[]>
  findActiveAlert(
    serverId: string,
    ownerUserId: string,
    ruleKey: string,
  ): Promise<AlertEventRow | null>
  createAlert(alert: Omit<AlertEventRow, "Id" | "LastNotifiedAt">): Promise<AlertEventRow>
  updateAlert(alert: AlertEventRow): Promise<void>
  listOfflineServers(cutoff: string): Promise<ServerRow[]>
  findAgentTokenByHash(tokenHash: string): Promise<AgentTokenRow | null>
  listAgentTokens(serverId: string, ownerUserId: string): Promise<AgentTokenRow[]>
  createAgentToken(token: AgentTokenRow): Promise<void>
  updateAgentToken(token: AgentTokenRow): Promise<void>
  updateAgentTokenLastUsed(tokenId: string, lastUsedAt: string): Promise<void>
  listAuditLogs(ownerUserId: string): Promise<AuditLogRow[]>
  createAuditLog(log: Omit<AuditLogRow, "Id">): Promise<void>
}

export class DuplicateUsernameError extends Error {}

export function createStorage(env: Env): Storage {
  const backend: string = env.STORAGE_BACKEND
  return backend === "d1" ? new D1Storage(env.DB) : new SupabaseStorage(env)
}
