import { cn } from "@/lib/utils"
import { getServerStatus } from "@/lib/format"

const STATUS_LABEL: Record<ReturnType<typeof getServerStatus>, string> = {
  online: "Online",
  stale: "Stale",
  offline: "Offline",
}

const STATUS_DOT: Record<ReturnType<typeof getServerStatus>, string> = {
  online: "bg-emerald-500",
  stale: "bg-amber-500",
  offline: "bg-muted-foreground/50",
}

export function StatusBadge({ lastHeartbeatAt }: { lastHeartbeatAt: string }) {
  const status = getServerStatus(lastHeartbeatAt)

  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium">
      <span className={cn("size-2 rounded-full", STATUS_DOT[status], status === "online" && "animate-pulse")} />
      {STATUS_LABEL[status]}
    </span>
  )
}
