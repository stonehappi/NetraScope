import type {
  AgentDownload,
  AuthResponse,
  LoginRequest,
  MeResponse,
  MetricPoint,
  ProblemDetails,
  RegisterRequest,
  ReplaceServerTagsRequest,
  ServerSummary,
  ServerTagsResponse,
} from "@/types/api"
import { getStoredToken, notifyUnauthorized } from "@/lib/auth"

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:5050"

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getStoredToken()
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers,
    ...init,
  })

  if (!response.ok) {
    if (response.status === 401 && token) {
      notifyUnauthorized()
    }
    const message = await extractErrorMessage(response)
    throw new ApiError(response.status, message)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return (await response.json()) as T
}

async function extractErrorMessage(response: Response): Promise<string> {
  try {
    const problem = (await response.json()) as ProblemDetails
    if (problem.errors) {
      return Object.values(problem.errors).flat().join(" ")
    }
    return problem.detail ?? problem.title ?? response.statusText
  } catch {
    return response.statusText
  }
}

export function getServers(tag?: string): Promise<ServerSummary[]> {
  const query = tag ? `?tag=${encodeURIComponent(tag)}` : ""
  return request<ServerSummary[]>(`/api/servers${query}`)
}

export function getServerMetrics(serverId: string, minutes: number): Promise<MetricPoint[]> {
  return request<MetricPoint[]>(
    `/api/servers/${encodeURIComponent(serverId)}/metrics?minutes=${minutes}`,
  )
}

export function getServerTags(serverId: string): Promise<ServerTagsResponse> {
  return request<ServerTagsResponse>(`/api/servers/${encodeURIComponent(serverId)}/tags`)
}

export function replaceServerTags(
  serverId: string,
  body: ReplaceServerTagsRequest,
): Promise<ServerTagsResponse> {
  return request<ServerTagsResponse>(`/api/servers/${encodeURIComponent(serverId)}/tags`, {
    method: "PUT",
    body: JSON.stringify(body),
  })
}

export function login(body: LoginRequest): Promise<AuthResponse> {
  return request<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

export function register(body: RegisterRequest): Promise<AuthResponse> {
  return request<AuthResponse>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

export function getMe(): Promise<MeResponse> {
  return request<MeResponse>("/api/auth/me")
}

export function regenerateIngestionToken(): Promise<MeResponse> {
  return request<MeResponse>("/api/auth/token/regenerate", {
    method: "POST",
  })
}

export function getAgentDownloads(): Promise<AgentDownload[]> {
  return request<AgentDownload[]>("/api/agent/downloads")
}
