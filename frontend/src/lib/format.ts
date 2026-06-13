const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"]

export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes <= 0) return "0 B"

  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    BYTE_UNITS.length - 1,
  )
  const value = bytes / 1024 ** exponent
  return `${value.toFixed(exponent === 0 ? 0 : decimals)} ${BYTE_UNITS[exponent]}`
}

export function formatBytesPerSecond(bytesPerSecond: number, decimals = 1): string {
  return `${formatBytes(bytesPerSecond, decimals)}/s`
}

export function formatPercent(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`
}

const RELATIVE_TIME_UNITS: { unit: Intl.RelativeTimeFormatUnit; seconds: number }[] = [
  { unit: "year", seconds: 31536000 },
  { unit: "month", seconds: 2592000 },
  { unit: "day", seconds: 86400 },
  { unit: "hour", seconds: 3600 },
  { unit: "minute", seconds: 60 },
  { unit: "second", seconds: 1 },
]

const relativeTimeFormatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" })

export function formatRelativeTime(isoTimestamp: string): string {
  const diffSeconds = (new Date(isoTimestamp).getTime() - Date.now()) / 1000

  for (const { unit, seconds } of RELATIVE_TIME_UNITS) {
    if (Math.abs(diffSeconds) >= seconds || unit === "second") {
      return relativeTimeFormatter.format(Math.round(diffSeconds / seconds), unit)
    }
  }

  return relativeTimeFormatter.format(Math.round(diffSeconds), "second")
}

export function secondsSince(isoTimestamp: string): number {
  return (Date.now() - new Date(isoTimestamp).getTime()) / 1000
}

export type ServerStatus = "online" | "stale" | "offline"

export function getServerStatus(lastHeartbeatAt: string): ServerStatus {
  const elapsed = secondsSince(lastHeartbeatAt)
  if (elapsed <= 30) return "online"
  if (elapsed <= 120) return "stale"
  return "offline"
}

export function formatChartTime(isoTimestamp: string): string {
  return new Date(isoTimestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })
}
