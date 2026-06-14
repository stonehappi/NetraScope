import { DuplicateUsernameError, type Storage } from "../storage"
import type { MetricPacket, MetricRow, ServerRow, UserRow } from "../types"

interface D1ServerRow {
  Id: string
  HostName: string
  IpAddress: string | null
  LastHeartbeatAt: string
  Tags: string
}

const tagSeparator = "\u001f"

export class D1Storage implements Storage {
  constructor(private readonly db: D1Database) {}

  async findUserByUsername(username: string): Promise<UserRow | null> {
    return (
      (await this.db
        .prepare(
          `SELECT Id, Username, PasswordHash, IngestionToken, CreatedAt
           FROM users WHERE Username = ?1 LIMIT 1`,
        )
        .bind(username)
        .first<UserRow>()) ?? null
    )
  }

  async createUser(user: UserRow): Promise<void> {
    try {
      await this.db
        .prepare(
          `INSERT INTO users (Id, Username, PasswordHash, IngestionToken, CreatedAt)
           VALUES (?1, ?2, ?3, ?4, ?5)`,
        )
        .bind(user.Id, user.Username, user.PasswordHash, user.IngestionToken, user.CreatedAt)
        .run()
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
        throw new DuplicateUsernameError()
      }
      throw error
    }
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await this.db
      .prepare("UPDATE users SET PasswordHash = ?1 WHERE Id = ?2")
      .bind(passwordHash, userId)
      .run()
  }

  async findUserById(userId: string): Promise<UserRow | null> {
    return (
      (await this.db
        .prepare(
          `SELECT Id, Username, PasswordHash, IngestionToken, CreatedAt
           FROM users WHERE Id = ?1 LIMIT 1`,
        )
        .bind(userId)
        .first<UserRow>()) ?? null
    )
  }

  async updateIngestionToken(userId: string, token: string): Promise<void> {
    await this.db
      .prepare("UPDATE users SET IngestionToken = ?1 WHERE Id = ?2")
      .bind(token, userId)
      .run()
  }

  async findOwnerByIngestionToken(token: string): Promise<string | null> {
    const row = await this.db
      .prepare("SELECT Id FROM users WHERE IngestionToken = ?1 LIMIT 1")
      .bind(token)
      .first<{ Id: string }>()
    return row?.Id ?? null
  }

  async ingestMetric(
    packet: MetricPacket,
    ipAddress: string | null,
    ownerUserId: string,
  ): Promise<boolean> {
    const results = await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO servers (Id, HostName, IpAddress, LastHeartbeatAt, OwnerUserId)
           VALUES (?1, ?1, ?2, ?3, ?4)
           ON CONFLICT (Id) DO UPDATE SET
             HostName = excluded.HostName,
             IpAddress = excluded.IpAddress,
             LastHeartbeatAt = excluded.LastHeartbeatAt,
             OwnerUserId = excluded.OwnerUserId
           WHERE servers.OwnerUserId IS NULL OR servers.OwnerUserId = excluded.OwnerUserId`,
        )
        .bind(packet.serverId, ipAddress, new Date().toISOString(), ownerUserId),
      this.db
        .prepare(
          `INSERT INTO performance_metrics (
             ServerId, Timestamp, CpuUsagePct, MemoryUsedBytes, MemoryTotalBytes,
             DiskUtilizationPct, NetworkInBytesSec
           )
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
           WHERE EXISTS (
             SELECT 1 FROM servers WHERE Id = ?1 AND OwnerUserId = ?8
           )`,
        )
        .bind(
          packet.serverId,
          packet.timestamp,
          packet.cpuUsagePct,
          packet.memoryUsedBytes,
          packet.memoryTotalBytes,
          packet.diskUtilizationPct,
          packet.networkInBytesSec,
          ownerUserId,
        ),
    ])
    return results[1].meta.changes === 1
  }

  async listServers(ownerUserId: string, tag: string | null): Promise<ServerRow[]> {
    const tagFilter = tag
      ? `AND EXISTS (
           SELECT 1 FROM server_tags filter_tag
           WHERE filter_tag.ServerId = servers.Id AND filter_tag.TagName = ?2
         )`
      : ""
    const statement = this.db.prepare(
      `SELECT
         servers.Id,
         servers.HostName,
         servers.IpAddress,
         servers.LastHeartbeatAt,
         COALESCE(GROUP_CONCAT(server_tags.TagName, '${tagSeparator}'), '') AS Tags
       FROM servers
       LEFT JOIN server_tags ON server_tags.ServerId = servers.Id
       WHERE servers.OwnerUserId = ?1 ${tagFilter}
       GROUP BY servers.Id, servers.HostName, servers.IpAddress, servers.LastHeartbeatAt
       ORDER BY servers.Id`,
    )
    const rows = tag
      ? await statement.bind(ownerUserId, tag).all<D1ServerRow>()
      : await statement.bind(ownerUserId).all<D1ServerRow>()
    return rows.results.map(mapServer)
  }

  async ownsServer(serverId: string, ownerUserId: string): Promise<boolean> {
    const row = await this.db
      .prepare("SELECT 1 AS Found FROM servers WHERE Id = ?1 AND OwnerUserId = ?2 LIMIT 1")
      .bind(serverId, ownerUserId)
      .first<{ Found: number }>()
    return row?.Found === 1
  }

  async listMetrics(serverId: string, since: string): Promise<MetricRow[]> {
    const rows = await this.db
      .prepare(
        `SELECT
           Timestamp, CpuUsagePct, MemoryUsedBytes, MemoryTotalBytes,
           DiskUtilizationPct, NetworkInBytesSec
         FROM performance_metrics
         WHERE ServerId = ?1 AND Timestamp >= ?2
         ORDER BY Timestamp`,
      )
      .bind(serverId, since)
      .all<MetricRow>()
    return rows.results
  }

  async getServerWithTags(
    serverId: string,
    ownerUserId: string,
  ): Promise<ServerRow | null> {
    const row = await this.db
      .prepare(
        `SELECT
           servers.Id,
           servers.HostName,
           servers.IpAddress,
           servers.LastHeartbeatAt,
           COALESCE(GROUP_CONCAT(server_tags.TagName, '${tagSeparator}'), '') AS Tags
         FROM servers
         LEFT JOIN server_tags ON server_tags.ServerId = servers.Id
         WHERE servers.Id = ?1 AND servers.OwnerUserId = ?2
         GROUP BY servers.Id, servers.HostName, servers.IpAddress, servers.LastHeartbeatAt
         LIMIT 1`,
      )
      .bind(serverId, ownerUserId)
      .first<D1ServerRow>()
    return row ? mapServer(row) : null
  }

  async replaceServerTags(
    serverId: string,
    ownerUserId: string,
    tags: string[],
  ): Promise<boolean> {
    if (!(await this.ownsServer(serverId, ownerUserId))) {
      return false
    }

    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `DELETE FROM server_tags
           WHERE ServerId = ?1
             AND EXISTS (
               SELECT 1 FROM servers WHERE Id = ?1 AND OwnerUserId = ?2
             )`,
        )
        .bind(serverId, ownerUserId),
    ]
    for (const tag of tags) {
      statements.push(
        this.db
          .prepare("INSERT INTO tags (Name) VALUES (?1) ON CONFLICT (Name) DO NOTHING")
          .bind(tag),
        this.db
          .prepare(
            `INSERT INTO server_tags (ServerId, TagName)
             SELECT ?1, ?2
             WHERE EXISTS (
               SELECT 1 FROM servers WHERE Id = ?1 AND OwnerUserId = ?3
             )`,
          )
          .bind(serverId, tag, ownerUserId),
      )
    }
    await this.db.batch(statements)
    return true
  }
}

function mapServer(row: D1ServerRow): ServerRow {
  return {
    Id: row.Id,
    HostName: row.HostName,
    IpAddress: row.IpAddress,
    LastHeartbeatAt: row.LastHeartbeatAt,
    server_tags: row.Tags
      ? row.Tags.split(tagSeparator).map((TagName) => ({ TagName }))
      : [],
  }
}
