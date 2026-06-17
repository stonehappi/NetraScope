export interface MetricPacket {
  serverId: string
  timestamp: string
  cpuUsagePct: number
  memoryUsedBytes: number
  memoryTotalBytes: number
  diskUtilizationPct: number
  networkInBytesSec: number
}

export interface UserRow {
  Id: string
  Username: string
  PasswordHash: string
  IngestionToken: string
  CreatedAt: string
}

export interface ServerTagRow {
  TagName: string
}

export interface ServerRow {
  Id: string
  HostName: string
  IpAddress: string | null
  LastHeartbeatAt: string
  OwnerUserId: string | null
  server_tags?: ServerTagRow[]
}

export interface MetricRow {
  Timestamp: string
  CpuUsagePct: number
  MemoryUsedBytes: number
  MemoryTotalBytes: number
  DiskUtilizationPct: number
  NetworkInBytesSec: number
}

export interface AlertEventRow {
  Id: number
  ServerId: string
  OwnerUserId: string | null
  RuleKey: string
  Severity: string
  Status: string
  Message: string
  TriggerValue: number | null
  ThresholdValue: number | null
  TriggeredAt: string
  LastObservedAt: string
  ResolvedAt: string | null
  LastNotifiedAt: string | null
}

export interface AgentTokenRow {
  Id: string
  ServerId: string
  OwnerUserId: string
  Name: string
  TokenHash: string
  TokenSuffix: string
  AllowedIpAddresses: string | null
  CreatedAt: string
  LastUsedAt: string | null
  RevokedAt: string | null
}

export interface AuditLogRow {
  Id: number
  OwnerUserId: string | null
  ActorType: string
  Action: string
  EntityType: string
  EntityId: string | null
  Message: string | null
  IpAddress: string | null
  CreatedAt: string
}
