import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { ArrowDownLeft, ArrowUpRight, Thermometer } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { StatusBadge } from "@/components/servers/status-badge"
import { UsageMeter } from "@/components/servers/usage-meter"
import { getServerMetrics } from "@/lib/api"
import {
  formatBytes,
  formatBytesPerSecond,
  formatRelativeTime,
  formatTemperature,
} from "@/lib/format"
import type { MetricPoint, ServerSummary } from "@/types/api"

export function ServerCard({
  server,
  latestMetric,
}: {
  server: ServerSummary
  latestMetric?: MetricPoint | null
}) {
  const { data } = useQuery({
    queryKey: ["server-metrics-latest", server.id],
    queryFn: () => getServerMetrics(server.id, 5),
    enabled: latestMetric === undefined,
  })

  const latest = latestMetric === undefined ? data?.at(-1) : latestMetric

  return (
    <Link
      to={`/servers/${encodeURIComponent(server.id)}`}
      className="group flex flex-col gap-4 rounded-2xl border border-white/40 bg-card/50 p-5 shadow-lg shadow-black/5 backdrop-blur-xl transition hover:-translate-y-1 hover:shadow-xl dark:border-white/10 dark:bg-card/40 dark:shadow-black/30"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold leading-tight">{server.hostName}</p>
          <p className="truncate text-xs text-muted-foreground">
            {server.ipAddress ?? server.id}
          </p>
        </div>
        <StatusBadge lastHeartbeatAt={server.lastHeartbeatAt} />
      </div>

      {server.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {server.tags.map((tag) => (
            <Badge key={tag} variant="secondary">
              {tag}
            </Badge>
          ))}
        </div>
      )}

      {latest ? (
        <div className="space-y-2.5">
          <UsageMeter label="CPU" value={latest.cpuUsagePct} />
          <UsageMeter
            label="Memory"
            value={(latest.memoryUsedBytes / (latest.memoryTotalBytes || 1)) * 100}
            detail={`${formatBytes(latest.memoryUsedBytes)} of ${formatBytes(latest.memoryTotalBytes)}`}
          />
          <UsageMeter label="Disk" value={latest.diskUtilizationPct} />

          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/40 text-xs">
            <div className="flex items-center gap-1.5 rounded-lg bg-muted/40 px-2.5 py-1.5">
              <ArrowDownLeft className="size-3.5 text-blue-500 shrink-0" />
              <div className="min-w-0">
                <span className="text-[10px] text-muted-foreground block leading-none">Net In</span>
                <span className="font-medium tabular-nums truncate block">
                  {formatBytesPerSecond(latest.networkInBytesSec)}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 rounded-lg bg-muted/40 px-2.5 py-1.5">
              <Thermometer
                className={`size-3.5 shrink-0 ${
                  latest.cpuTempC != null
                    ? latest.cpuTempC >= 85
                      ? "text-destructive"
                      : latest.cpuTempC >= 70
                        ? "text-amber-500"
                        : "text-emerald-500"
                    : "text-muted-foreground"
                }`}
              />
              <div className="min-w-0">
                <span className="text-[10px] text-muted-foreground block leading-none">CPU Temp</span>
                <span
                  className={`font-medium tabular-nums truncate block ${
                    latest.cpuTempC != null
                      ? latest.cpuTempC >= 85
                        ? "text-destructive"
                        : latest.cpuTempC >= 70
                          ? "text-amber-500"
                          : ""
                      : "text-muted-foreground"
                  }`}
                >
                  {latest.cpuTempC != null ? formatTemperature(latest.cpuTempC, 0) : "N/A"}
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No recent metrics.</p>
      )}

      <div className="mt-auto flex items-center justify-between text-xs text-muted-foreground pt-1">
        <span>{formatRelativeTime(server.lastHeartbeatAt)}</span>
        <div className="flex items-center gap-1 font-medium group-hover:text-primary transition-colors">
          <span>Details</span>
          <ArrowUpRight className="size-3.5" />
        </div>
      </div>
    </Link>
  )
}
