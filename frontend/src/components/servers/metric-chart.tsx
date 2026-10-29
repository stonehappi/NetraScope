import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"

export function MetricChart({
  title,
  description,
  data,
  dataKey,
  color,
  yDomain,
  tickFormatter,
  emptyMessage = "No data for this time range yet.",
  headerExtra,
}: {
  title: string
  description?: string
  data: Array<Record<string, string | number | null | undefined>>
  dataKey: string
  color: string
  yDomain?: [number, number]
  tickFormatter?: (value: number) => string
  emptyMessage?: string
  headerExtra?: React.ReactNode
}) {
  const config: ChartConfig = {
    [dataKey]: { label: title, color },
  }
  const gradientId = `fill-${dataKey}`

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
        <div className="space-y-1">
          <CardTitle className="text-base">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {headerExtra}
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="flex h-[220px] items-center justify-center text-center text-sm text-muted-foreground p-4">
            {emptyMessage}
          </div>
        ) : (
          <ChartContainer config={config} className="aspect-auto h-[220px] w-full">
            <AreaChart data={data} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={`var(--color-${dataKey})`} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={`var(--color-${dataKey})`} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="time" tickLine={false} axisLine={false} minTickGap={32} />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={48}
                domain={yDomain ?? ["auto", "auto"]}
                tickFormatter={tickFormatter}
              />
              <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
              <Area
                dataKey={dataKey}
                type="monotone"
                fill={`url(#${gradientId})`}
                stroke={`var(--color-${dataKey})`}
                strokeWidth={2}
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}
