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

export interface AlertResponse {
  id: number
  serverId: string
  ruleKey: string
  severity: string
  status: "active" | "resolved"
  message: string
  triggerValue: number | null
  thresholdValue: number | null
  triggeredAt: string
  lastObservedAt: string
  resolvedAt: string | null
  lastNotifiedAt: string | null
}

export interface AgentTokenResponse {
  id: string
  serverId: string
  name: string
  tokenSuffix: string
  allowedIpAddresses: string[]
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

export interface AgentTokenCreatedResponse extends AgentTokenResponse {
  token: string
}

export interface UpsertAgentTokenRequest {
  name?: string
  allowedIpAddresses?: string[]
}

export interface AuditLogResponse {
  id: number
  actorType: string
  action: string
  entityType: string
  entityId: string | null
  message: string | null
  ipAddress: string | null
  createdAt: string
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
