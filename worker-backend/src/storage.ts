import { D1Storage } from "./storage/d1"
import { SupabaseStorage } from "./storage/supabase"
import type { MetricPacket, MetricRow, ServerRow, UserRow } from "./types"

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
  getServerWithTags(serverId: string, ownerUserId: string): Promise<ServerRow | null>
  replaceServerTags(
    serverId: string,
    ownerUserId: string,
    tags: string[],
  ): Promise<boolean>
}

export class DuplicateUsernameError extends Error {}

export function createStorage(env: Env): Storage {
  const backend: string = env.STORAGE_BACKEND
  return backend === "d1" ? new D1Storage(env.DB) : new SupabaseStorage(env)
}
