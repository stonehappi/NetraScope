import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate, useParams } from "react-router-dom"
import {
  ArrowDownLeft,
  ArrowLeft,
  ChartArea,
  Cpu,
  Database,
  Download,
  HardDrive,
  Table2,
  Thermometer,
  Trash2,
} from "lucide-react"
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
import { MetricChart } from "@/components/servers/metric-chart"
import { ServerActivity } from "@/components/servers/server-activity"
import { AgentTokenManager } from "@/components/servers/agent-token-manager"
import { StatusBadge } from "@/components/servers/status-badge"
import { TagEditor } from "@/components/servers/tag-editor"
import { UsageMeter } from "@/components/servers/usage-meter"
import { ApiError, deleteServer, getServerMetrics, getServers } from "@/lib/api"
import {
  formatBytes,
  formatBytesPerSecond,
  formatChartTime,
  formatPercent,
  formatRelativeTime,
  formatTemperature,
} from "@/lib/format"
import type { MetricPoint } from "@/types/api"

const EMPTY_POINTS: MetricPoint[] = []
const CUSTOM_RANGE_VALUE = "custom"

function formatDateTimeLocal(date: Date) {
  const pad = (value: number) => value.toString().padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

function exportMetricsCsv(serverId: string, points: MetricPoint[]) {
  if (points.length === 0) {
    toast.error("No metric points to export.")
    return
  }

  const headers = [
    "Timestamp",
    "CPU Usage (%)",
    "Memory Used (Bytes)",
    "Memory Total (Bytes)",
    "Memory Usage (%)",
    "Disk Utilization (%)",
    "Network In (Bytes/sec)",
    "CPU Temperature (°C)",
  ]

  const rows = points.map((p) => {
    const memPct =
      p.memoryTotalBytes > 0
        ? ((p.memoryUsedBytes / p.memoryTotalBytes) * 100).toFixed(2)
        : "0"
    return [
      `"${p.timestamp}"`,
      p.cpuUsagePct.toFixed(2),
      p.memoryUsedBytes,
      p.memoryTotalBytes,
      memPct,
      p.diskUtilizationPct.toFixed(2),
      p.networkInBytesSec,
      p.cpuTempC != null ? p.cpuTempC.toFixed(2) : "",
    ].join(",")
  })

  const blob = new Blob([headers.join(",") + "\n" + rows.join("\n")], {
    type: "text/csv;charset=utf-8;",
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = `${serverId}-metrics-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
  toast.success("Metrics exported to CSV.")
}

const TIME_RANGES = [
  { value: "15", label: "15m" },
  { value: "60", label: "1h" },
  { value: "360", label: "6h" },
  { value: "1440", label: "24h" },
  { value: "10080", label: "7d" },
  { value: "43200", label: "30d" },
  { value: "525600", label: "1y" },
  { value: CUSTOM_RANGE_VALUE, label: "Custom" },
]

export function ServerDetailPage() {
  const { serverId = "" } = useParams<{ serverId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [range, setRange] = useState("60")
  const [historyTab, setHistoryTab] = useState<"charts" | "matrix">("charts")
  const [matrixPageSize, setMatrixPageSize] = useState<number>(50)
  const [customFrom, setCustomFrom] = useState(() =>
    formatDateTimeLocal(new Date(Date.now() - 1000 * 60 * 60 * 24 * 7)),
  )
  const [customTo, setCustomTo] = useState(() => formatDateTimeLocal(new Date()))

  const isCustomRange = range === CUSTOM_RANGE_VALUE
  const customRangeValid =
    isCustomRange &&
    customFrom.length > 0 &&
    customTo.length > 0 &&
    new Date(customFrom) < new Date(customTo)

  const serversQuery = useQuery({
    queryKey: ["servers"],
    queryFn: () => getServers(),
  })

  const metricsQuery = useQuery({
    queryKey: ["server-metrics", serverId, range, customFrom, customTo],
    queryFn: () =>
      isCustomRange
        ? getServerMetrics(serverId, customFrom, customTo)
        : getServerMetrics(serverId, Number(range)),
    enabled: serverId.length > 0 && (!isCustomRange || customRangeValid),
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

  // Calculate aggregated stats across the active window
  const stats = useMemo(() => {
    if (points.length === 0) return null

    const cpuVals = points.map((p) => p.cpuUsagePct)
    const memVals = points.map((p) =>
      p.memoryTotalBytes > 0 ? (p.memoryUsedBytes / p.memoryTotalBytes) * 100 : 0,
    )
    const diskVals = points.map((p) => p.diskUtilizationPct)
    const netVals = points.map((p) => p.networkInBytesSec)
    const tempPoints = points.filter((p) => p.cpuTempC != null)

    const avg = (arr: number[]) =>
      arr.length > 0 ? arr.reduce((acc, v) => acc + v, 0) / arr.length : 0

    return {
      cpu: {
        min: Math.min(...cpuVals),
        max: Math.max(...cpuVals),
        avg: avg(cpuVals),
      },
      memory: {
        min: Math.min(...memVals),
        max: Math.max(...memVals),
        avg: avg(memVals),
      },
      disk: {
        min: Math.min(...diskVals),
        max: Math.max(...diskVals),
        avg: avg(diskVals),
      },
      network: {
        min: Math.min(...netVals),
        max: Math.max(...netVals),
        avg: avg(netVals),
      },
      temperature: {
        hasData: tempPoints.length > 0,
        min: tempPoints.length > 0 ? Math.min(...tempPoints.map((p) => p.cpuTempC!)) : null,
        max: tempPoints.length > 0 ? Math.max(...tempPoints.map((p) => p.cpuTempC!)) : null,
        avg:
          tempPoints.length > 0
            ? tempPoints.reduce((acc, p) => acc + p.cpuTempC!, 0) / tempPoints.length
            : null,
      },
    }
  }, [points])

  const chartData = useMemo(() => {
    const includeDate = range === CUSTOM_RANGE_VALUE || Number(range) > 1440
    return points.map((point) => ({
      time: formatChartTime(point.timestamp, includeDate),
      cpu: Number(point.cpuUsagePct.toFixed(1)),
      memory: Number(
        (point.memoryTotalBytes > 0
          ? (point.memoryUsedBytes / point.memoryTotalBytes) * 100
          : 0
        ).toFixed(1),
      ),
      disk: Number(point.diskUtilizationPct.toFixed(1)),
      network: Number((point.networkInBytesSec / 1024).toFixed(1)), // KB/s
      temperature: point.cpuTempC != null ? Number(point.cpuTempC.toFixed(1)) : null,
    }))
  }, [points, range])

  const tempChartData = useMemo(
    () => chartData.filter((d) => d.temperature !== null),
    [chartData],
  )

  const sortedPointsDesc = useMemo(() => [...points].reverse(), [points])
  const displayedPoints = useMemo(
    () => (matrixPageSize === -1 ? sortedPointsDesc : sortedPointsDesc.slice(0, matrixPageSize)),
    [sortedPointsDesc, matrixPageSize],
  )

  const currentMemPct =
    latest && latest.memoryTotalBytes > 0
      ? (latest.memoryUsedBytes / latest.memoryTotalBytes) * 100
      : null

  return (
    <div className="space-y-6">
      <Link
        to="/dashboard"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
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
          {/* Top Live Metric Cards: Shows ALL metrics */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {/* CPU Card */}
            <Card className="flex flex-col justify-between">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-muted-foreground">CPU Usage</CardTitle>
                  <Cpu className="size-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {latest ? (
                  <UsageMeter label="Current" value={latest.cpuUsagePct} />
                ) : (
                  <p className="text-sm text-muted-foreground">No recent data.</p>
                )}
                {stats && (
                  <div className="flex items-center justify-between border-t border-border/50 pt-2 text-[11px] text-muted-foreground">
                    <span>Avg: {formatPercent(stats.cpu.avg, 1)}</span>
                    <span>Peak: {formatPercent(stats.cpu.max, 1)}</span>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Memory Card */}
            <Card className="flex flex-col justify-between">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Memory Usage</CardTitle>
                  <Database className="size-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {latest ? (
                  <UsageMeter
                    label="Current"
                    value={(latest.memoryUsedBytes / (latest.memoryTotalBytes || 1)) * 100}
                    detail={`${formatBytes(latest.memoryUsedBytes)} of ${formatBytes(latest.memoryTotalBytes)}`}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">No recent data.</p>
                )}
                {stats && latest && (
                  <div className="flex items-center justify-between border-t border-border/50 pt-2 text-[11px] text-muted-foreground">
                    <span>{formatBytes(Math.max(0, latest.memoryTotalBytes - latest.memoryUsedBytes))} free</span>
                    <span>Peak: {formatPercent(stats.memory.max, 1)}</span>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Disk Card */}
            <Card className="flex flex-col justify-between">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Disk Utilization</CardTitle>
                  <HardDrive className="size-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {latest ? (
                  <UsageMeter label="Root volume" value={latest.diskUtilizationPct} />
                ) : (
                  <p className="text-sm text-muted-foreground">No recent data.</p>
                )}
                {stats && (
                  <div className="flex items-center justify-between border-t border-border/50 pt-2 text-[11px] text-muted-foreground">
                    <span>Avg: {formatPercent(stats.disk.avg, 1)}</span>
                    <span>Peak: {formatPercent(stats.disk.max, 1)}</span>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Network In Card */}
            <Card className="flex flex-col justify-between">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Network In</CardTitle>
                  <ArrowDownLeft className="size-4 text-blue-500" />
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {latest ? (
                  <div className="space-y-1">
                    <p className="text-2xl font-semibold tabular-nums">
                      {formatBytesPerSecond(latest.networkInBytesSec)}
                    </p>
                    <p className="text-xs text-muted-foreground">Inbound throughput</p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No recent data.</p>
                )}
                {stats && (
                  <div className="flex items-center justify-between border-t border-border/50 pt-2 text-[11px] text-muted-foreground">
                    <span>Avg: {formatBytesPerSecond(stats.network.avg)}</span>
                    <span>Peak: {formatBytesPerSecond(stats.network.max)}</span>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* CPU Temperature Card - Always shown */}
            <Card className="flex flex-col justify-between">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-muted-foreground">CPU Temp</CardTitle>
                  <Thermometer
                    className={`size-4 ${
                      latest?.cpuTempC != null
                        ? latest.cpuTempC >= 85
                          ? "text-destructive"
                          : latest.cpuTempC >= 70
                            ? "text-amber-500"
                            : "text-emerald-500"
                        : "text-muted-foreground"
                    }`}
                  />
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {latest?.cpuTempC != null ? (
                  <div className="space-y-1">
                    <p
                      className={`text-2xl font-semibold tabular-nums ${
                        latest.cpuTempC >= 85
                          ? "text-destructive"
                          : latest.cpuTempC >= 70
                            ? "text-amber-500"
                            : "text-emerald-600 dark:text-emerald-400"
                      }`}
                    >
                      {formatTemperature(latest.cpuTempC, 1)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {latest.cpuTempC >= 85
                        ? "Critical heat"
                        : latest.cpuTempC >= 70
                          ? "Warm"
                          : "Normal thermal"}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <p className="text-2xl font-semibold tabular-nums text-muted-foreground">N/A</p>
                    <p className="text-xs text-muted-foreground">No sensor data</p>
                  </div>
                )}
                {stats && (
                  <div className="flex items-center justify-between border-t border-border/50 pt-2 text-[11px] text-muted-foreground">
                    <span>
                      Avg:{" "}
                      {stats.temperature.avg != null
                        ? formatTemperature(stats.temperature.avg, 1)
                        : "—"}
                    </span>
                    <span>
                      Peak:{" "}
                      {stats.temperature.max != null
                        ? formatTemperature(stats.temperature.max, 1)
                        : "—"}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* All Metrics Matrix: Comprehensive statistical breakdown */}
          <Card className="overflow-hidden border border-border/60">
            <CardHeader className="flex flex-col gap-2 pb-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-base font-semibold">Metrics Matrix</CardTitle>
                <CardDescription>
                  Aggregated telemetry matrix for all monitored metrics across the active time window.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="font-mono text-xs">
                  {points.length} recorded {points.length === 1 ? "sample" : "samples"}
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => exportMetricsCsv(serverId, points)}
                  disabled={points.length === 0}
                  className="h-8 gap-1.5"
                >
                  <Download className="size-3.5" />
                  Export CSV
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Metric</TableHead>
                      <TableHead className="text-right">Current</TableHead>
                      <TableHead className="text-right">Window Avg</TableHead>
                      <TableHead className="text-right">Window Peak (Max)</TableHead>
                      <TableHead className="text-right">Window Min</TableHead>
                      <TableHead className="text-right">Threshold / Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {/* CPU Usage Row */}
                    <TableRow className="hover:bg-muted/40 transition-colors">
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <Cpu className="size-4 text-muted-foreground shrink-0" />
                          <span>CPU Usage</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {latest ? (
                          <span
                            className={
                              latest.cpuUsagePct >= 90
                                ? "font-semibold text-destructive"
                                : latest.cpuUsagePct >= 70
                                  ? "font-semibold text-amber-500"
                                  : "text-foreground"
                            }
                          >
                            {formatPercent(latest.cpuUsagePct)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {stats ? formatPercent(stats.cpu.avg) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {stats ? (
                          <span
                            className={
                              stats.cpu.max >= 90
                                ? "font-semibold text-destructive"
                                : stats.cpu.max >= 70
                                  ? "font-semibold text-amber-500"
                                  : "text-foreground"
                            }
                          >
                            {formatPercent(stats.cpu.max)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {stats ? formatPercent(stats.cpu.min) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {latest ? (
                          latest.cpuUsagePct >= 90 ? (
                            <Badge variant="destructive">Alert &gt; 90%</Badge>
                          ) : latest.cpuUsagePct >= 70 ? (
                            <Badge variant="secondary" className="text-amber-500">Elevated</Badge>
                          ) : (
                            <Badge variant="outline" className="text-emerald-600">Normal</Badge>
                          )
                        ) : (
                          <Badge variant="outline">No data</Badge>
                        )}
                      </TableCell>
                    </TableRow>

                    {/* Memory Usage Row */}
                    <TableRow className="hover:bg-muted/40 transition-colors">
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <Database className="size-4 text-muted-foreground shrink-0" />
                          <span>Memory Usage</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {latest && currentMemPct != null ? (
                          <div className="flex flex-col items-end">
                            <span
                              className={
                                currentMemPct >= 90
                                  ? "font-semibold text-destructive"
                                  : currentMemPct >= 70
                                    ? "font-semibold text-amber-500"
                                    : "text-foreground"
                              }
                            >
                              {formatPercent(currentMemPct)}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              {formatBytes(latest.memoryUsedBytes)} / {formatBytes(latest.memoryTotalBytes)}
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {stats ? formatPercent(stats.memory.avg) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {stats ? (
                          <span
                            className={
                              stats.memory.max >= 90
                                ? "font-semibold text-destructive"
                                : stats.memory.max >= 70
                                  ? "font-semibold text-amber-500"
                                  : "text-foreground"
                            }
                          >
                            {formatPercent(stats.memory.max)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {stats ? formatPercent(stats.memory.min) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {currentMemPct != null ? (
                          currentMemPct >= 90 ? (
                            <Badge variant="destructive">Alert &gt; 90%</Badge>
                          ) : currentMemPct >= 70 ? (
                            <Badge variant="secondary" className="text-amber-500">Elevated</Badge>
                          ) : (
                            <Badge variant="outline" className="text-emerald-600">Normal</Badge>
                          )
                        ) : (
                          <Badge variant="outline">No data</Badge>
                        )}
                      </TableCell>
                    </TableRow>

                    {/* Disk Utilization Row */}
                    <TableRow className="hover:bg-muted/40 transition-colors">
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <HardDrive className="size-4 text-muted-foreground shrink-0" />
                          <span>Disk (Root)</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {latest ? (
                          <span
                            className={
                              latest.diskUtilizationPct >= 85
                                ? "font-semibold text-destructive"
                                : latest.diskUtilizationPct >= 70
                                  ? "font-semibold text-amber-500"
                                  : "text-foreground"
                            }
                          >
                            {formatPercent(latest.diskUtilizationPct)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {stats ? formatPercent(stats.disk.avg) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {stats ? (
                          <span
                            className={
                              stats.disk.max >= 85
                                ? "font-semibold text-destructive"
                                : stats.disk.max >= 70
                                  ? "font-semibold text-amber-500"
                                  : "text-foreground"
                            }
                          >
                            {formatPercent(stats.disk.max)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {stats ? formatPercent(stats.disk.min) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {latest ? (
                          latest.diskUtilizationPct >= 85 ? (
                            <Badge variant="destructive">Alert &gt; 85%</Badge>
                          ) : latest.diskUtilizationPct >= 70 ? (
                            <Badge variant="secondary" className="text-amber-500">Elevated</Badge>
                          ) : (
                            <Badge variant="outline" className="text-emerald-600">Normal</Badge>
                          )
                        ) : (
                          <Badge variant="outline">No data</Badge>
                        )}
                      </TableCell>
                    </TableRow>

                    {/* Network In Row */}
                    <TableRow className="hover:bg-muted/40 transition-colors">
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <ArrowDownLeft className="size-4 text-blue-500 shrink-0" />
                          <span>Network In</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {latest ? (
                          formatBytesPerSecond(latest.networkInBytesSec)
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {stats ? formatBytesPerSecond(stats.network.avg) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {stats ? formatBytesPerSecond(stats.network.max) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {stats ? formatBytesPerSecond(stats.network.min) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="outline" className="text-blue-500">Throughput</Badge>
                      </TableCell>
                    </TableRow>

                    {/* CPU Temperature Row */}
                    <TableRow className="hover:bg-muted/40 transition-colors">
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <Thermometer className="size-4 text-muted-foreground shrink-0" />
                          <span>CPU Temperature</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {latest?.cpuTempC != null ? (
                          <span
                            className={
                              latest.cpuTempC >= 85
                                ? "font-semibold text-destructive"
                                : latest.cpuTempC >= 70
                                  ? "font-semibold text-amber-500"
                                  : "text-foreground"
                            }
                          >
                            {formatTemperature(latest.cpuTempC, 1)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">N/A</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {stats?.temperature.avg != null ? formatTemperature(stats.temperature.avg, 1) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {stats?.temperature.max != null ? (
                          <span
                            className={
                              stats.temperature.max >= 85
                                ? "font-semibold text-destructive"
                                : stats.temperature.max >= 70
                                  ? "font-semibold text-amber-500"
                                  : "text-foreground"
                            }
                          >
                            {formatTemperature(stats.temperature.max, 1)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {stats?.temperature.min != null ? formatTemperature(stats.temperature.min, 1) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {latest?.cpuTempC != null ? (
                          latest.cpuTempC >= 85 ? (
                            <Badge variant="destructive">Alert &gt; 85°C</Badge>
                          ) : latest.cpuTempC >= 70 ? (
                            <Badge variant="secondary" className="text-amber-500">Warm &gt; 70°C</Badge>
                          ) : (
                            <Badge variant="outline" className="text-emerald-600">Normal</Badge>
                          )
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">No sensor</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* History Section: Mode switch (Charts vs Data Points Matrix) and Time Range */}
          <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <Tabs value={historyTab} onValueChange={(val) => setHistoryTab(val as "charts" | "matrix")}>
                  <TabsList>
                    <TabsTrigger value="charts" className="gap-1.5">
                      <ChartArea className="size-4" />
                      Charts
                    </TabsTrigger>
                    <TabsTrigger value="matrix" className="gap-1.5">
                      <Table2 className="size-4" />
                      Data Points Matrix
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
              <Tabs value={range} onValueChange={setRange}>
                <TabsList className="overflow-x-auto max-w-full">
                  {TIME_RANGES.map((option) => (
                    <TabsTrigger key={option.value} value={option.value}>
                      {option.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>

            {isCustomRange && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="custom-from" className="text-sm font-medium text-muted-foreground">
                    Start
                  </label>
                  <Input
                    id="custom-from"
                    type="datetime-local"
                    value={customFrom}
                    onChange={(event) => setCustomFrom(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="custom-to" className="text-sm font-medium text-muted-foreground">
                    End
                  </label>
                  <Input
                    id="custom-to"
                    type="datetime-local"
                    value={customTo}
                    onChange={(event) => setCustomTo(event.target.value)}
                  />
                </div>
              </div>
            )}

            {isCustomRange && !customRangeValid && (
              <p className="text-sm text-muted-foreground">
                Pick a valid start and end date before the metrics will refresh.
              </p>
            )}

            {/* View Mode: Charts */}
            {historyTab === "charts" && (
              <>
                {metricsQuery.isLoading ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Skeleton className="h-70 w-full" />
                    <Skeleton className="h-70 w-full" />
                    <Skeleton className="h-70 w-full" />
                    <Skeleton className="h-70 w-full" />
                    <Skeleton className="h-70 w-full sm:col-span-2" />
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <MetricChart
                      title="CPU Usage"
                      description="Percent of CPU in active utilization"
                      data={chartData}
                      dataKey="cpu"
                      color="var(--chart-1)"
                      yDomain={[0, 100]}
                      tickFormatter={(value) => `${value}%`}
                      headerExtra={
                        stats ? (
                          <Badge variant="outline" className="text-xs">
                            Peak {formatPercent(stats.cpu.max, 1)}
                          </Badge>
                        ) : undefined
                      }
                    />
                    <MetricChart
                      title="Memory Usage"
                      description="Percent of memory capacity in use"
                      data={chartData}
                      dataKey="memory"
                      color="var(--chart-2)"
                      yDomain={[0, 100]}
                      tickFormatter={(value) => `${value}%`}
                      headerExtra={
                        stats ? (
                          <Badge variant="outline" className="text-xs">
                            Peak {formatPercent(stats.memory.max, 1)}
                          </Badge>
                        ) : undefined
                      }
                    />
                    <MetricChart
                      title="Disk Usage"
                      description="Root volume storage utilization"
                      data={chartData}
                      dataKey="disk"
                      color="var(--chart-3)"
                      yDomain={[0, 100]}
                      tickFormatter={(value) => `${value}%`}
                      headerExtra={
                        stats ? (
                          <Badge variant="outline" className="text-xs">
                            Peak {formatPercent(stats.disk.max, 1)}
                          </Badge>
                        ) : undefined
                      }
                    />
                    <MetricChart
                      title="Network In"
                      description="Inbound network traffic rate (KB/s)"
                      data={chartData}
                      dataKey="network"
                      color="var(--chart-4)"
                      tickFormatter={(value) => `${value} KB/s`}
                      headerExtra={
                        stats ? (
                          <Badge variant="outline" className="text-xs">
                            Peak {formatBytesPerSecond(stats.network.max)}
                          </Badge>
                        ) : undefined
                      }
                    />
                    {/* CPU Temperature Chart: Always displayed with appropriate state */}
                    <div className="sm:col-span-2">
                      <MetricChart
                        title="CPU Temperature"
                        description="Hardware thermal sensor telemetry (°C)"
                        data={tempChartData}
                        dataKey="temperature"
                        color="hsl(24, 95%, 53%)"
                        tickFormatter={(value) => `${value}°C`}
                        emptyMessage="No hardware thermal sensor data recorded for this time window."
                        headerExtra={
                          stats?.temperature.max != null ? (
                            <Badge
                              variant="outline"
                              className={`text-xs ${
                                stats.temperature.max >= 85
                                  ? "text-destructive"
                                  : stats.temperature.max >= 70
                                    ? "text-amber-500"
                                    : ""
                              }`}
                            >
                              Peak {formatTemperature(stats.temperature.max, 1)}
                            </Badge>
                          ) : undefined
                        }
                      />
                    </div>
                  </div>
                )}
              </>
            )}

            {/* View Mode: Data Points Matrix */}
            {historyTab === "matrix" && (
              <Card className="border border-border/60">
                <CardHeader className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle className="text-base font-semibold">Recorded Metric Samples</CardTitle>
                    <CardDescription>
                      Individual telemetry packets collected by the NetraScope agent.
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Rows:</span>
                    <Select
                      value={matrixPageSize.toString()}
                      onValueChange={(val) => setMatrixPageSize(Number(val))}
                    >
                      <SelectTrigger className="h-8 w-24 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="25">25</SelectItem>
                        <SelectItem value="50">50</SelectItem>
                        <SelectItem value="100">100</SelectItem>
                        <SelectItem value="-1">All ({points.length})</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {metricsQuery.isLoading ? (
                    <div className="space-y-2 p-4">
                      <Skeleton className="h-8 w-full" />
                      <Skeleton className="h-8 w-full" />
                      <Skeleton className="h-8 w-full" />
                    </div>
                  ) : displayedPoints.length === 0 ? (
                    <div className="py-12 text-center text-sm text-muted-foreground">
                      No metric points available for this time range.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="hover:bg-transparent">
                            <TableHead>Timestamp</TableHead>
                            <TableHead className="text-right">CPU</TableHead>
                            <TableHead className="text-right">Memory</TableHead>
                            <TableHead className="text-right">Disk</TableHead>
                            <TableHead className="text-right">Network In</TableHead>
                            <TableHead className="text-right">CPU Temp</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {displayedPoints.map((point, index) => {
                            const pointMemPct =
                              point.memoryTotalBytes > 0
                                ? (point.memoryUsedBytes / point.memoryTotalBytes) * 100
                                : 0
                            return (
                              <TableRow
                                key={`${point.timestamp}-${index}`}
                                className="hover:bg-muted/40 transition-colors font-mono tabular-nums text-xs"
                              >
                                <TableCell className="font-sans text-muted-foreground whitespace-nowrap">
                                  {new Date(point.timestamp).toLocaleString([], {
                                    month: "short",
                                    day: "numeric",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                    second: "2-digit",
                                  })}
                                </TableCell>
                                <TableCell className="text-right">
                                  <span
                                    className={
                                      point.cpuUsagePct >= 90
                                        ? "font-semibold text-destructive"
                                        : point.cpuUsagePct >= 70
                                          ? "font-semibold text-amber-500"
                                          : ""
                                    }
                                  >
                                    {formatPercent(point.cpuUsagePct)}
                                  </span>
                                </TableCell>
                                <TableCell className="text-right">
                                  <div className="flex flex-col items-end">
                                    <span
                                      className={
                                        pointMemPct >= 90
                                          ? "font-semibold text-destructive"
                                          : pointMemPct >= 70
                                            ? "font-semibold text-amber-500"
                                            : ""
                                      }
                                    >
                                      {formatPercent(pointMemPct)}
                                    </span>
                                    <span className="text-[10px] text-muted-foreground font-sans">
                                      {formatBytes(point.memoryUsedBytes)}
                                    </span>
                                  </div>
                                </TableCell>
                                <TableCell className="text-right">
                                  <span
                                    className={
                                      point.diskUtilizationPct >= 85
                                        ? "font-semibold text-destructive"
                                        : point.diskUtilizationPct >= 70
                                          ? "font-semibold text-amber-500"
                                          : ""
                                    }
                                  >
                                    {formatPercent(point.diskUtilizationPct)}
                                  </span>
                                </TableCell>
                                <TableCell className="text-right">
                                  {formatBytesPerSecond(point.networkInBytesSec)}
                                </TableCell>
                                <TableCell className="text-right">
                                  {point.cpuTempC != null ? (
                                    <span
                                      className={
                                        point.cpuTempC >= 85
                                          ? "font-semibold text-destructive"
                                          : point.cpuTempC >= 70
                                            ? "font-semibold text-amber-500"
                                            : ""
                                      }
                                    >
                                      {formatTemperature(point.cpuTempC, 1)}
                                    </span>
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </TableCell>
                              </TableRow>
                            )
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                  {points.length > displayedPoints.length && (
                    <div className="border-t border-border/50 p-2.5 text-center text-xs text-muted-foreground">
                      Showing first {displayedPoints.length} of {points.length} recorded samples. Select "All" in row selector to view all.
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </>
      )}

      {server && <ServerActivity serverId={serverId} />}

      {server && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Badge variant="outline">Alerts</Badge>
          CPU above 90% for 5 minutes, memory above 90%, disk above 85%, temperature above 85°C, or a missing heartbeat triggers a critical alert on the backend.
        </p>
      )}
    </div>
  )
}
