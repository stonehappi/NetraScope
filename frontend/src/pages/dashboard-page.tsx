import { useMemo, useState } from "react"
import { useQueries, useQuery } from "@tanstack/react-query"
import { Activity, AlertTriangle, Layers3, Search, ServerOff } from "lucide-react"
import { Link } from "react-router-dom"

import { AddServerDialog } from "@/components/servers/add-server-dialog"
import { OnboardingCard } from "@/components/servers/onboarding-card"
import { ServerCard } from "@/components/servers/server-card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { getAlerts, getServerMetrics, getServers } from "@/lib/api"
import {
  formatRelativeTime,
  getServerStatus,
  type ServerStatus,
} from "@/lib/format"
import type { AlertResponse, MetricPoint, ServerSummary } from "@/types/api"

const ALL = "all"
const EMPTY_SERVERS: ServerSummary[] = []
const EMPTY_ALERTS: AlertResponse[] = []

type StatusFilter = "all" | ServerStatus
type SortKey = "status" | "hostname" | "heartbeat" | "cpu" | "memory" | "disk"

const STATUS_ORDER: Record<ServerStatus, number> = {
  offline: 0,
  stale: 1,
  online: 2,
}

const ENV_TAGS: Record<string, string[]> = {
  Production: ["production", "prod"],
  Staging: ["staging", "stage"],
  Development: ["development", "dev"],
  QA: ["qa", "test", "testing"],
}

const RULE_LABELS: Record<string, string> = {
  cpu_high_5m: "CPU sustained high",
  memory_high: "Memory high",
  disk_high: "Disk high",
  server_offline: "Server offline",
}

export function DashboardPage() {
  const [search, setSearch] = useState("")
  const [tagFilter, setTagFilter] = useState(ALL)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [sortBy, setSortBy] = useState<SortKey>("status")

  const serversQuery = useQuery({
    queryKey: ["servers"],
    queryFn: () => getServers(),
  })
  const activeAlertsQuery = useQuery({
    queryKey: ["alerts", "active"],
    queryFn: () => getAlerts("active"),
  })
  const recentAlertsQuery = useQuery({
    queryKey: ["alerts", "recent"],
    queryFn: () => getAlerts(),
  })

  const servers = serversQuery.data ?? EMPTY_SERVERS
  const activeAlerts = activeAlertsQuery.data ?? EMPTY_ALERTS
  const recentAlerts = recentAlertsQuery.data ?? EMPTY_ALERTS

  const metricQueries = useQueries({
    queries: servers.map((server) => ({
      queryKey: ["server-metrics-latest", server.id],
      queryFn: () => getServerMetrics(server.id, 5),
      enabled: servers.length > 0,
    })),
  })

  const latestMetrics = useMemo(() => {
    const metrics = new Map<string, MetricPoint | null>()
    servers.forEach((server, index) => {
      metrics.set(server.id, metricQueries[index]?.data?.at(-1) ?? null)
    })
    return metrics
  }, [metricQueries, servers])

  const availableTags = useMemo(() => {
    const tags = new Set<string>()
    for (const server of servers) {
      for (const tag of server.tags) tags.add(tag)
    }
    return [...tags].sort()
  }, [servers])

  const statusCounts = useMemo(() => {
    const counts: Record<ServerStatus, number> = { online: 0, stale: 0, offline: 0 }
    for (const server of servers) {
      counts[getServerStatus(server.lastHeartbeatAt)]++
    }
    return counts
  }, [servers])

  const filteredServers = useMemo(() => {
    const term = search.trim().toLowerCase()
    return servers
      .filter((server) => {
        const status = getServerStatus(server.lastHeartbeatAt)
        const matchesSearch =
          !term ||
          server.hostName.toLowerCase().includes(term) ||
          server.id.toLowerCase().includes(term) ||
          server.tags.some((tag) => tag.includes(term))
        const matchesTag = tagFilter === ALL || server.tags.includes(tagFilter)
        const matchesStatus = statusFilter === "all" || status === statusFilter
        return matchesSearch && matchesTag && matchesStatus
      })
      .sort((left, right) => compareServers(left, right, latestMetrics, sortBy))
  }, [latestMetrics, search, servers, sortBy, statusFilter, tagFilter])

  const environmentGroups = useMemo(
    () => groupByEnvironment(filteredServers),
    [filteredServers],
  )

  const isLoading = serversQuery.isLoading
  const isError = serversQuery.isError

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Servers, alerts, and environment groups in one operational view.
          </p>
        </div>
        {!isLoading && !isError && servers.length > 0 && <AddServerDialog />}
      </div>

      {!isLoading && !isError && servers.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryTile label="Servers" value={servers.length.toString()} detail="reporting agents" />
          <SummaryTile label="Online" value={statusCounts.online.toString()} detail={`${statusCounts.stale} stale`} />
          <SummaryTile label="Offline" value={statusCounts.offline.toString()} detail="needs attention" />
          <SummaryTile label="Active alerts" value={activeAlerts.length.toString()} detail="open incidents" tone={activeAlerts.length > 0 ? "critical" : "normal"} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="relative sm:col-span-2">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search hostname, id, or tag..."
                className="pl-8"
              />
            </div>
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
              <SelectTrigger>
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="online">Online</SelectItem>
                <SelectItem value="stale">Stale</SelectItem>
                <SelectItem value="offline">Offline</SelectItem>
              </SelectContent>
            </Select>
            <Select value={tagFilter} onValueChange={setTagFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Tag" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All tags</SelectItem>
                {availableTags.map((tag) => (
                  <SelectItem key={tag} value={tag}>
                    {tag}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={(value) => setSortBy(value as SortKey)}>
              <SelectTrigger className="sm:col-span-2 xl:col-span-1">
                <SelectValue placeholder="Sort" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="status">Sort by status</SelectItem>
                <SelectItem value="hostname">Sort by hostname</SelectItem>
                <SelectItem value="heartbeat">Sort by heartbeat</SelectItem>
                <SelectItem value="cpu">Sort by CPU</SelectItem>
                <SelectItem value="memory">Sort by memory</SelectItem>
                <SelectItem value="disk">Sort by disk</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isError && (
            <Card>
              <CardContent className="py-10 text-center text-sm text-destructive">
                Couldn't load servers. Is the backend running and reachable?
              </CardContent>
            </Card>
          )}

          {isLoading && (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-64 rounded-2xl" />
              ))}
            </div>
          )}

          {!isLoading && !isError && servers.length === 0 && <OnboardingCard />}

          {!isLoading && !isError && servers.length > 0 && filteredServers.length === 0 && (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
                <ServerOff className="size-8 text-muted-foreground" />
                <p className="font-medium">No servers found</p>
                <p className="text-sm text-muted-foreground">
                  Try a different search, status, tag, or sort option.
                </p>
              </CardContent>
            </Card>
          )}

          {!isLoading && !isError && filteredServers.length > 0 && (
            <Tabs defaultValue="servers" className="space-y-4">
              <TabsList>
                <TabsTrigger value="servers">Servers</TabsTrigger>
                <TabsTrigger value="environments">Environments</TabsTrigger>
              </TabsList>
              <TabsContent value="servers">
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {filteredServers.map((server) => (
                    <ServerCard
                      key={server.id}
                      server={server}
                      latestMetric={latestMetrics.get(server.id) ?? null}
                    />
                  ))}
                </div>
              </TabsContent>
              <TabsContent value="environments" className="space-y-4">
                {environmentGroups.map((group) => (
                  <section key={group.name} className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Layers3 className="size-4 text-muted-foreground" />
                        <h2 className="font-medium">{group.name}</h2>
                        <Badge variant="secondary">{group.servers.length}</Badge>
                      </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      {group.servers.map((server) => (
                        <ServerCard
                          key={server.id}
                          server={server}
                          latestMetric={latestMetrics.get(server.id) ?? null}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </TabsContent>
            </Tabs>
          )}
        </div>

        <aside className="space-y-4">
          <AlertPanel alerts={activeAlerts} isLoading={activeAlertsQuery.isLoading} />
          <TimelinePanel alerts={recentAlerts.slice(0, 6)} isLoading={recentAlertsQuery.isLoading} />
        </aside>
      </div>
    </div>
  )
}

function SummaryTile({
  label,
  value,
  detail,
  tone = "normal",
}: {
  label: string
  value: string
  detail: string
  tone?: "normal" | "critical"
}) {
  return (
    <div className="rounded-lg border bg-card/60 p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={tone === "critical" ? "text-2xl font-semibold text-destructive" : "text-2xl font-semibold"}>
        {value}
      </p>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </div>
  )
}

function AlertPanel({
  alerts,
  isLoading,
}: {
  alerts: AlertResponse[]
  isLoading: boolean
}) {
  return (
    <section className="rounded-lg border bg-card/60">
      <div className="flex items-center justify-between border-b p-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className={alerts.length > 0 ? "size-4 text-destructive" : "size-4 text-muted-foreground"} />
          <h2 className="font-medium">Active alerts</h2>
        </div>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/alerts">View all</Link>
        </Button>
      </div>
      <div className="space-y-3 p-4">
        {isLoading && <Skeleton className="h-20 rounded-lg" />}
        {!isLoading && alerts.length === 0 && (
          <p className="text-sm text-muted-foreground">No active alerts right now.</p>
        )}
        {!isLoading &&
          alerts.slice(0, 5).map((alert) => (
            <AlertListItem key={alert.id} alert={alert} />
          ))}
      </div>
    </section>
  )
}

function TimelinePanel({
  alerts,
  isLoading,
}: {
  alerts: AlertResponse[]
  isLoading: boolean
}) {
  return (
    <section className="rounded-lg border bg-card/60">
      <div className="flex items-center gap-2 border-b p-4">
        <Activity className="size-4 text-muted-foreground" />
        <h2 className="font-medium">Recent events</h2>
      </div>
      <div className="space-y-4 p-4">
        {isLoading && <Skeleton className="h-24 rounded-lg" />}
        {!isLoading && alerts.length === 0 && (
          <p className="text-sm text-muted-foreground">Alert events will appear here as rules trigger and recover.</p>
        )}
        {!isLoading &&
          alerts.map((alert) => (
            <div key={alert.id} className="grid grid-cols-[0.75rem_1fr] gap-3">
              <span
                className={
                  alert.status === "active"
                    ? "mt-1.5 size-2 rounded-full bg-destructive"
                    : "mt-1.5 size-2 rounded-full bg-emerald-500"
                }
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{ruleLabel(alert.ruleKey)}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {alert.serverId} · {alert.status === "active" ? "triggered" : "recovered"} {formatRelativeTime(alert.lastObservedAt)}
                </p>
              </div>
            </div>
          ))}
      </div>
    </section>
  )
}

function AlertListItem({ alert }: { alert: AlertResponse }) {
  return (
    <Link
      to={`/servers/${encodeURIComponent(alert.serverId)}`}
      className="block rounded-lg border bg-background/60 p-3 transition hover:bg-muted/50"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{ruleLabel(alert.ruleKey)}</p>
          <p className="truncate text-xs text-muted-foreground">{alert.serverId}</p>
        </div>
        <Badge variant={alert.status === "active" ? "destructive" : "secondary"}>
          {alert.status}
        </Badge>
      </div>
      <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{alert.message}</p>
    </Link>
  )
}

function compareServers(
  left: ServerSummary,
  right: ServerSummary,
  metrics: Map<string, MetricPoint | null>,
  sortBy: SortKey,
): number {
  if (sortBy === "hostname") {
    return left.hostName.localeCompare(right.hostName)
  }

  if (sortBy === "heartbeat") {
    return new Date(right.lastHeartbeatAt).getTime() - new Date(left.lastHeartbeatAt).getTime()
  }

  if (sortBy === "status") {
    return (
      STATUS_ORDER[getServerStatus(left.lastHeartbeatAt)] -
      STATUS_ORDER[getServerStatus(right.lastHeartbeatAt)] ||
      left.hostName.localeCompare(right.hostName)
    )
  }

  return metricValue(right, metrics.get(right.id), sortBy) - metricValue(left, metrics.get(left.id), sortBy)
}

function metricValue(
  server: ServerSummary,
  metric: MetricPoint | null | undefined,
  sortBy: SortKey,
): number {
  if (!metric) return Number.NEGATIVE_INFINITY
  if (sortBy === "cpu") return metric.cpuUsagePct
  if (sortBy === "disk") return metric.diskUtilizationPct
  if (sortBy === "memory") return (metric.memoryUsedBytes / metric.memoryTotalBytes) * 100
  return STATUS_ORDER[getServerStatus(server.lastHeartbeatAt)]
}

function groupByEnvironment(servers: ServerSummary[]) {
  const groups = new Map<string, ServerSummary[]>()
  for (const server of servers) {
    const environment = getEnvironment(server.tags)
    groups.set(environment, [...(groups.get(environment) ?? []), server])
  }

  return [...groups.entries()]
    .map(([name, groupedServers]) => ({ name, servers: groupedServers }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

function getEnvironment(tags: string[]): string {
  for (const [environment, matches] of Object.entries(ENV_TAGS)) {
    if (tags.some((tag) => matches.includes(tag))) {
      return environment
    }
  }
  return "Unassigned"
}

function ruleLabel(ruleKey: string): string {
  return RULE_LABELS[ruleKey] ?? ruleKey.replaceAll("_", " ")
}
