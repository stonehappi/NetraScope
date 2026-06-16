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
