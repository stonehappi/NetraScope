export interface ServerSummary {
  id: string
  hostName: string
  ipAddress: string | null
  lastHeartbeatAt: string
  tags: string[]
}

export interface MetricPoint {
  timestamp: string
  cpuUsagePct: number
  memoryUsedBytes: number
  memoryTotalBytes: number
  diskUtilizationPct: number
  networkInBytesSec: number
}

export interface ServerTagsResponse {
  serverId: string
  tags: string[]
}

export interface ReplaceServerTagsRequest {
  tags: string[]
}

export interface ProblemDetails {
  title?: string
  detail?: string
  errors?: Record<string, string[]>
}

export interface AuthResponse {
  token: string
  expiresAt: string
  username: string
}

export interface LoginRequest {
  username: string
  password: string
}

export interface RegisterRequest {
  username: string
  password: string
}

export interface MeResponse {
  username: string
  ingestionToken: string
}

export interface AgentDownload {
  os: string
  arch: string
  fileName: string
  sizeBytes: number
  url: string
}
