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
}: {
  title: string
  description?: string
  data: Array<Record<string, string | number>>
  dataKey: string
  color: string
  yDomain?: [number, number]
  tickFormatter?: (value: number) => string
}) {
  const config: ChartConfig = {
    [dataKey]: { label: title, color },
  }
  const gradientId = `fill-${dataKey}`

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
            No data for this time range yet.
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
