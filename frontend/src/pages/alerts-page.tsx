import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { AlertTriangle, CheckCircle2, Search } from "lucide-react"
import { Link } from "react-router-dom"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { getAlerts } from "@/lib/api"
import { formatRelativeTime } from "@/lib/format"
import type { AlertResponse } from "@/types/api"

const EMPTY_ALERTS: AlertResponse[] = []
const RULE_LABELS: Record<string, string> = {
  cpu_high_5m: "CPU sustained high",
  memory_high: "Memory high",
  disk_high: "Disk high",
  server_offline: "Server offline",
}

type AlertStatusFilter = "all" | "active" | "resolved"

export function AlertsPage() {
  const [status, setStatus] = useState<AlertStatusFilter>("all")
  const [search, setSearch] = useState("")

  const { data, isLoading, isError } = useQuery({
    queryKey: ["alerts", status],
    queryFn: () => getAlerts(status === "all" ? undefined : status),
  })

  const alerts = data ?? EMPTY_ALERTS
  const filteredAlerts = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return alerts
    return alerts.filter(
      (alert) =>
        alert.serverId.toLowerCase().includes(term) ||
        alert.ruleKey.toLowerCase().includes(term) ||
        alert.message.toLowerCase().includes(term),
    )
  }, [alerts, search])

  const activeCount = alerts.filter((alert) => alert.status === "active").length
  const resolvedCount = alerts.filter((alert) => alert.status === "resolved").length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Alerts</h1>
        <p className="text-sm text-muted-foreground">
          Review active incidents and recent recoveries across your servers.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <AlertStat label="Active" value={activeCount} tone="critical" />
        <AlertStat label="Resolved" value={resolvedCount} tone="normal" />
        <AlertStat label="Visible" value={filteredAlerts.length} tone="normal" />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={status} onValueChange={(value) => setStatus(value as AlertStatusFilter)}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="resolved">Resolved</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search alerts..."
            className="pl-8"
          />
        </div>
      </div>

      {isError && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-destructive">
            Couldn't load alerts. Is the backend running and reachable?
          </CardContent>
        </Card>
      )}

      {isLoading && <Skeleton className="h-80 rounded-lg" />}

      {!isLoading && !isError && filteredAlerts.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <CheckCircle2 className="size-8 text-emerald-500" />
            <p className="font-medium">No alerts found</p>
            <p className="text-sm text-muted-foreground">
              Alert events will appear here as thresholds trigger and recover.
            </p>
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && filteredAlerts.length > 0 && (
        <div className="rounded-lg border bg-card/60">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rule</TableHead>
                <TableHead>Server</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Last seen</TableHead>
                <TableHead>Message</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAlerts.map((alert) => (
                <TableRow key={alert.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <AlertTriangle
                        className={
                          alert.status === "active"
                            ? "size-4 text-destructive"
                            : "size-4 text-muted-foreground"
                        }
                      />
                      <span className="font-medium">{ruleLabel(alert.ruleKey)}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Link
                      to={`/servers/${encodeURIComponent(alert.serverId)}`}
                      className="font-medium text-primary underline-offset-4 hover:underline"
                    >
                      {alert.serverId}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant={alert.status === "active" ? "destructive" : "secondary"}>
                      {alert.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatAlertValue(alert)}</TableCell>
                  <TableCell>{formatRelativeTime(alert.lastObservedAt)}</TableCell>
                  <TableCell className="max-w-md whitespace-normal text-muted-foreground">
                    {alert.message}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

function AlertStat({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: "normal" | "critical"
}) {
  return (
    <div className="rounded-lg border bg-card/60 p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={tone === "critical" && value > 0 ? "text-2xl font-semibold text-destructive" : "text-2xl font-semibold"}>
        {value}
      </p>
    </div>
  )
}

function formatAlertValue(alert: AlertResponse): string {
  if (alert.triggerValue === null) return "-"
  const value = Number(alert.triggerValue.toFixed(1))
  if (alert.ruleKey === "server_offline") return "-"
  return `${value}%`
}

function ruleLabel(ruleKey: string): string {
  return RULE_LABELS[ruleKey] ?? ruleKey.replaceAll("_", " ")
}
