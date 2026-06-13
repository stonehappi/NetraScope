import { cn } from "@/lib/utils"
import { Progress } from "@/components/ui/progress"
import { formatPercent } from "@/lib/format"

function levelClass(pct: number): string {
  if (pct >= 90) return "[&>div]:bg-destructive"
  if (pct >= 70) return "[&>div]:bg-amber-500"
  return "[&>div]:bg-emerald-500"
}

export function UsageMeter({
  label,
  value,
  detail,
}: {
  label: string
  value: number
  detail?: string
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">{formatPercent(value)}</span>
      </div>
      <Progress value={Math.min(value, 100)} className={cn("h-2", levelClass(value))} />
      {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
    </div>
  )
}
