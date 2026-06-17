import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { ArrowUpRight } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { StatusBadge } from "@/components/servers/status-badge"
import { UsageMeter } from "@/components/servers/usage-meter"
import { getServerMetrics } from "@/lib/api"
import { formatBytesPerSecond, formatRelativeTime } from "@/lib/format"
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
            value={(latest.memoryUsedBytes / latest.memoryTotalBytes) * 100}
          />
          <UsageMeter label="Disk" value={latest.diskUtilizationPct} />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No recent metrics.</p>
      )}

      <div className="mt-auto flex items-center justify-between text-xs text-muted-foreground">
        <span>{formatRelativeTime(server.lastHeartbeatAt)}</span>
        <div className="flex items-center gap-1.5">
          {latest && <span>{formatBytesPerSecond(latest.networkInBytesSec)} in</span>}
          <ArrowUpRight className="size-3.5 opacity-0 transition group-hover:opacity-100" />
        </div>
      </div>
    </Link>
  )
}
