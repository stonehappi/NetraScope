import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate, useParams } from "react-router-dom"
import { ArrowLeft, Trash2 } from "lucide-react"
import { toast } from "sonner"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { MetricChart } from "@/components/servers/metric-chart"
import { ServerActivity } from "@/components/servers/server-activity"
import { AgentTokenManager } from "@/components/servers/agent-token-manager"
import { StatusBadge } from "@/components/servers/status-badge"
import { TagEditor } from "@/components/servers/tag-editor"
import { UsageMeter } from "@/components/servers/usage-meter"
import { ApiError, deleteServer, getServerMetrics, getServers } from "@/lib/api"
import { formatBytes, formatBytesPerSecond, formatChartTime, formatRelativeTime } from "@/lib/format"
import type { MetricPoint } from "@/types/api"

const EMPTY_POINTS: MetricPoint[] = []

const TIME_RANGES = [
  { value: "15", label: "15m" },
  { value: "60", label: "1h" },
  { value: "360", label: "6h" },
  { value: "1440", label: "24h" },
  { value: "10080", label: "7d" },
  { value: "43200", label: "30d" },
]

export function ServerDetailPage() {
  const { serverId = "" } = useParams<{ serverId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [range, setRange] = useState("60")

  const serversQuery = useQuery({
    queryKey: ["servers"],
    queryFn: () => getServers(),
  })

  const metricsQuery = useQuery({
    queryKey: ["server-metrics", serverId, range],
    queryFn: () => getServerMetrics(serverId, Number(range)),
    enabled: serverId.length > 0,
  })

  const server = serversQuery.data?.find((item) => item.id === serverId)
  const points = metricsQuery.data ?? EMPTY_POINTS
  const latest = points.at(-1)

  const deleteMutation = useMutation({
    mutationFn: () => deleteServer(serverId),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["server-metrics", serverId] })
      queryClient.removeQueries({ queryKey: ["server-tags", serverId] })
      queryClient.invalidateQueries({ queryKey: ["servers"] })
      toast.success("Server deleted.")
      navigate("/dashboard", { replace: true })
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : "Failed to delete server.")
    },
  })

  const chartData = useMemo(
    () => {
      const includeDate = Number(range) > 1440
      return points.map((point) => ({
        time: formatChartTime(point.timestamp, includeDate),
        cpu: Number(point.cpuUsagePct.toFixed(1)),
        memory: Number(((point.memoryUsedBytes / point.memoryTotalBytes) * 100).toFixed(1)),
        disk: Number(point.diskUtilizationPct.toFixed(1)),
        network: Number((point.networkInBytesSec / 1024).toFixed(1)),
      }))
    },
    [points, range],
  )

  return (
    <div className="space-y-6">
      <Link to="/dashboard" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        Back to servers
      </Link>

      {serversQuery.isLoading && <Skeleton className="h-32 w-full" />}

      {!serversQuery.isLoading && !server && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Server "{serverId}" was not found.
          </CardContent>
        </Card>
      )}

      {server && (
        <Card>
          <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <CardTitle className="text-xl">{server.hostName}</CardTitle>
              <p className="text-sm text-muted-foreground">
                {server.id} · {server.ipAddress ?? "no IP recorded"}
              </p>
              <p className="text-sm text-muted-foreground">
                Last heartbeat {formatRelativeTime(server.lastHeartbeatAt)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge lastHeartbeatAt={server.lastHeartbeatAt} />
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="destructive" size="sm">
                    <Trash2 className="size-4" />
                    Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete {server.hostName}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This permanently deletes the server, its metric history, and its tag
                      assignments. If its agent is still running, the server will appear again
                      when the next metric is sent.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={deleteMutation.isPending}>
                      Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      disabled={deleteMutation.isPending}
                      onClick={() => deleteMutation.mutate()}
                    >
                      {deleteMutation.isPending ? "Deleting…" : "Delete server"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
              <p className="text-sm font-medium">Tags</p>
              <TagEditor serverId={server.id} />
            </CardContent>
          </Card>
      )}

      {server && <AgentTokenManager serverId={server.id} />}

      {server && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">CPU</CardTitle>
              </CardHeader>
              <CardContent>
                {latest ? (
                  <UsageMeter label="Usage" value={latest.cpuUsagePct} />
                ) : (
                  <p className="text-sm text-muted-foreground">No recent data.</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Memory</CardTitle>
              </CardHeader>
              <CardContent>
                {latest ? (
                  <UsageMeter
                    label="Usage"
                    value={(latest.memoryUsedBytes / latest.memoryTotalBytes) * 100}
                    detail={`${formatBytes(latest.memoryUsedBytes)} of ${formatBytes(latest.memoryTotalBytes)}`}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">No recent data.</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Disk</CardTitle>
              </CardHeader>
              <CardContent>
                {latest ? (
                  <UsageMeter label="Root volume" value={latest.diskUtilizationPct} />
                ) : (
                  <p className="text-sm text-muted-foreground">No recent data.</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Network In</CardTitle>
              </CardHeader>
              <CardContent>
                {latest ? (
                  <p className="text-2xl font-semibold tabular-nums">
                    {formatBytesPerSecond(latest.networkInBytesSec)}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">No recent data.</p>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight">History</h2>
            <Tabs value={range} onValueChange={setRange}>
              <TabsList>
                {TIME_RANGES.map((option) => (
                  <TabsTrigger key={option.value} value={option.value}>
                    {option.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>

          {metricsQuery.isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Skeleton className="h-70 w-full" />
              <Skeleton className="h-70 w-full" />
              <Skeleton className="h-70 w-full" />
              <Skeleton className="h-70 w-full" />
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <MetricChart
                title="CPU Usage"
                description="Percent of CPU in use"
                data={chartData}
                dataKey="cpu"
                color="var(--chart-1)"
                yDomain={[0, 100]}
                tickFormatter={(value) => `${value}%`}
              />
              <MetricChart
                title="Memory Usage"
                description="Percent of memory in use"
                data={chartData}
                dataKey="memory"
                color="var(--chart-2)"
                yDomain={[0, 100]}
                tickFormatter={(value) => `${value}%`}
              />
              <MetricChart
                title="Disk Usage"
                description="Root volume utilization"
                data={chartData}
                dataKey="disk"
                color="var(--chart-3)"
                yDomain={[0, 100]}
                tickFormatter={(value) => `${value}%`}
              />
              <MetricChart
                title="Network In"
                description="Inbound traffic (KB/s)"
                data={chartData}
                dataKey="network"
                color="var(--chart-4)"
                tickFormatter={(value) => `${value} KB/s`}
              />
            </div>
          )}
        </>
      )}

      {server && <ServerActivity serverId={serverId} />}

      {server && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Badge variant="outline">90%+</Badge>
          CPU above 90% for 5 minutes, memory above 90%, disk above 85%, or a missing heartbeat triggers a critical alert on the backend.
        </p>
      )}
    </div>
  )
}
