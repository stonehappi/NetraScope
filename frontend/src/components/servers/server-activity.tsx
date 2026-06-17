import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  AlertTriangle,
  KeyRound,
  Plug,
  Tag,
  Wifi,
  WifiOff,
  type LucideIcon,
} from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { getAlerts, getAuditLogs } from "@/lib/api"
import { formatRelativeTime } from "@/lib/format"
import type { AlertResponse, AuditLogResponse } from "@/types/api"

type TimelineKind = "install" | "offline" | "recovery" | "alert" | "token" | "tags"

interface TimelineEvent {
  id: string
  at: string
  kind: TimelineKind
  title: string
  detail?: string
}

const KIND_ICON: Record<TimelineKind, LucideIcon> = {
  install: Plug,
  offline: WifiOff,
  recovery: Wifi,
  alert: AlertTriangle,
  token: KeyRound,
  tags: Tag,
}

const KIND_COLOR: Record<TimelineKind, string> = {
  install: "text-chart-2",
  offline: "text-destructive",
  recovery: "text-chart-2",
  alert: "text-destructive",
  token: "text-muted-foreground",
  tags: "text-muted-foreground",
}

const RULE_LABELS: Record<string, string> = {
  cpu_high_5m: "High CPU",
  memory_high: "High memory",
  disk_high: "High disk",
  server_offline: "Offline",
}

const TOKEN_TITLES: Record<string, string> = {
  "agent_token.created": "Agent token created",
  "agent_token.updated": "Agent token updated",
  "agent_token.rotated": "Agent token rotated",
  "agent_token.revoked": "Agent token revoked",
}

export function ServerActivity({ serverId }: { serverId: string }) {
  const alertsQuery = useQuery({ queryKey: ["alerts"], queryFn: () => getAlerts() })
  const auditQuery = useQuery({ queryKey: ["audit-logs"], queryFn: getAuditLogs })

  const isLoading = alertsQuery.isLoading || auditQuery.isLoading
  const events = useMemo(
    () => buildTimeline(serverId, alertsQuery.data ?? [], auditQuery.data ?? []),
    [serverId, alertsQuery.data, auditQuery.data],
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Activity</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <Skeleton className="h-24 w-full" />}
        {!isLoading && events.length === 0 && (
          <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
        )}
        {!isLoading && events.length > 0 && (
          <ol className="space-y-4">
            {events.map((event) => {
              const Icon = KIND_ICON[event.kind]
              return (
                <li key={event.id} className="flex items-start gap-3">
                  <span className={`mt-0.5 shrink-0 ${KIND_COLOR[event.kind]}`}>
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{event.title}</p>
                    {event.detail && (
                      <p className="truncate text-sm text-muted-foreground">{event.detail}</p>
                    )}
                  </div>
                  <time className="shrink-0 text-xs text-muted-foreground" dateTime={event.at}>
                    {formatRelativeTime(event.at)}
                  </time>
                </li>
              )
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}

function buildTimeline(
  serverId: string,
  alerts: AlertResponse[],
  audit: AuditLogResponse[],
): TimelineEvent[] {
  const events: TimelineEvent[] = []

  for (const alert of alerts) {
    if (alert.serverId !== serverId) continue
    const offline = alert.ruleKey === "server_offline"
    const label = RULE_LABELS[alert.ruleKey] ?? alert.ruleKey
    events.push({
      id: `alert-${alert.id}-trigger`,
      at: alert.triggeredAt,
      kind: offline ? "offline" : "alert",
      title: offline ? "Server went offline" : `Alert: ${label}`,
      detail: alert.message,
    })
    if (alert.resolvedAt) {
      events.push({
        id: `alert-${alert.id}-resolve`,
        at: alert.resolvedAt,
        kind: "recovery",
        title: offline ? "Server recovered" : `Resolved: ${label}`,
      })
    }
  }

  for (const entry of audit) {
    const event = mapAuditEntry(serverId, entry)
    if (event) events.push(event)
  }

  return events.sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
}

function mapAuditEntry(serverId: string, entry: AuditLogResponse): TimelineEvent | null {
  const aboutServer = entry.entityType === "server" && entry.entityId === serverId
  const aboutToken = entry.entityType === "agent_token" && entry.message === serverId
  if (!aboutServer && !aboutToken) return null

  const base = { id: `audit-${entry.id}`, at: entry.createdAt }

  if (entry.action === "server.created") {
    return { ...base, kind: "install", title: "Agent connected", detail: "First metrics received" }
  }
  if (entry.action === "server.tags_updated") {
    return {
      ...base,
      kind: "tags",
      title: "Tags updated",
      detail: entry.message ? entry.message : "Tags cleared",
    }
  }
  if (entry.action in TOKEN_TITLES) {
    return { ...base, kind: "token", title: TOKEN_TITLES[entry.action] }
  }
  return null
}
