import { Link } from "react-router-dom"
import {
  Activity,
  Cpu,
  Gauge,
  HardDrive,
  LineChart,
  Network,
  ShieldCheck,
  Tags,
} from "lucide-react"

import { BrandLogo } from "@/components/brand-logo"
import { ModeToggle } from "@/components/mode-toggle"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useAuth } from "@/lib/auth-context"
import { cn } from "@/lib/utils"

const features = [
  {
    icon: Cpu,
    title: "CPU, memory & disk",
    description: "Track utilization across every host with live, auto-refreshing cards.",
  },
  {
    icon: Network,
    title: "Network throughput",
    description: "See inbound and outbound traffic trends as they happen.",
  },
  {
    icon: LineChart,
    title: "Historical trends",
    description: "Drill into 15-minute, 1-hour, 6-hour, and 24-hour history charts per server.",
  },
  {
    icon: Tags,
    title: "Tagging & filtering",
    description: "Organize your fleet with tags and filter the dashboard by environment, role, or team.",
  },
  {
    icon: ShieldCheck,
    title: "Secure by default",
    description: "JWT-based authentication protects your dashboard, with token-based agent ingestion.",
  },
  {
    icon: Gauge,
    title: "Always up to date",
    description: "The dashboard refreshes every 15 seconds so you always see current status.",
  },
]

function ScreenshotFrame({
  src,
  alt,
  className,
}: {
  src: string
  alt: string
  className?: string
}) {
  return (
    <div className={cn("overflow-hidden rounded-xl border bg-card shadow-2xl", className)}>
      <div className="flex items-center gap-1.5 border-b bg-muted/50 px-3 py-2.5">
        <span className="size-2.5 rounded-full bg-red-400/70" />
        <span className="size-2.5 rounded-full bg-yellow-400/70" />
        <span className="size-2.5 rounded-full bg-green-400/70" />
      </div>
      <img src={src} alt={alt} className="w-full" loading="lazy" />
    </div>
  )
}

export function LandingPage() {
  const { isAuthenticated } = useAuth()

  return (
    <div className="relative min-h-svh overflow-hidden bg-background">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-32 size-96 rounded-full bg-chart-1/25 blur-3xl" />
        <div className="absolute top-1/4 -right-32 size-96 rounded-full bg-chart-4/20 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 size-112 rounded-full bg-chart-2/15 blur-3xl" />
      </div>

      <header className="sticky top-0 z-10 border-b bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <BrandLogo />
            NetraScope
          </Link>
          <div className="flex items-center gap-2">
            {isAuthenticated ? (
              <Button asChild size="sm">
                <Link to="/dashboard">Open dashboard</Link>
              </Button>
            ) : (
              <>
                <Button asChild variant="ghost" size="sm">
                  <Link to="/login">Sign in</Link>
                </Button>
                <Button asChild size="sm">
                  <Link to="/register">Get started</Link>
                </Button>
              </>
            )}
            <ModeToggle />
          </div>
        </div>
      </header>

      <main className="relative mx-auto max-w-6xl px-4">
        <section className="flex flex-col items-center gap-6 py-20 text-center sm:py-28">
          <div className="inline-flex items-center gap-2 rounded-full border bg-background/70 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
            <Activity className="size-3.5 text-primary" />
            Real-time server monitoring
          </div>
          <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-6xl">
            Know what every server is doing,{" "}
            <span className="text-primary">all in one place</span>
          </h1>
          <p className="max-w-xl text-base text-muted-foreground sm:text-lg">
            NetraScope collects CPU, memory, disk, and network metrics from lightweight
            agents and gives you a live fleet-wide dashboard with history, tags, and search.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {isAuthenticated ? (
              <Button asChild size="lg">
                <Link to="/dashboard">Open dashboard</Link>
              </Button>
            ) : (
              <>
                <Button asChild size="lg">
                  <Link to="/register">Create a free account</Link>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <Link to="/login">Sign in</Link>
                </Button>
              </>
            )}
          </div>
        </section>

        <section className="pb-24">
          <ScreenshotFrame
            src="/servers.png"
            alt="NetraScope server fleet dashboard showing live CPU, memory, and disk usage"
            className="mx-auto max-w-5xl"
          />
        </section>

        <section className="space-y-20 pb-24 sm:space-y-28">
          <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-12">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border bg-background/70 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
                <Gauge className="size-3.5 text-primary" />
                Live server detail
              </div>
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Drill into any server with one click
              </h2>
              <p className="text-muted-foreground sm:text-lg">
                Open a server to see real-time CPU, memory, disk, and network usage, plus
                tags and the last heartbeat — everything you need to spot a problem fast.
              </p>
            </div>
            <ScreenshotFrame
              src="/server-details-1.png"
              alt="NetraScope server detail view with live CPU, memory, disk, and network stats"
            />
          </div>

          <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-12">
            <ScreenshotFrame
              src="/server-details-2.png"
              alt="NetraScope history charts for CPU, memory, disk, and network usage"
              className="lg:order-1"
            />
            <div className="space-y-4 lg:order-2">
              <div className="inline-flex items-center gap-2 rounded-full border bg-background/70 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
                <LineChart className="size-3.5 text-primary" />
                History & alerts
              </div>
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                See trends, not just snapshots
              </h2>
              <p className="text-muted-foreground sm:text-lg">
                Switch between 15-minute, 1-hour, 6-hour, and 24-hour windows to spot
                trends over time, with thresholds that flag CPU or disk usage above 90%.
              </p>
            </div>
          </div>
        </section>

        <section className="grid gap-4 pb-24 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(({ icon: Icon, title, description }) => (
            <Card key={title} className="bg-background/70 backdrop-blur">
              <CardHeader>
                <div className="mb-2 flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-4.5" />
                </div>
                <CardTitle className="text-base">{title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{description}</p>
              </CardContent>
            </Card>
          ))}
        </section>
      </main>

      <footer className="relative border-t bg-background/70 py-6 text-center text-sm text-muted-foreground backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-center gap-2 px-4">
          <HardDrive className="size-4" />
          NetraScope — open-source server monitoring
        </div>
      </footer>
    </div>
  )
}
