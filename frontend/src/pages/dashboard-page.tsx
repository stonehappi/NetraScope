import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Search, ServerOff } from "lucide-react"

import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent } from "@/components/ui/card"
import { AddServerDialog } from "@/components/servers/add-server-dialog"
import { OnboardingCard } from "@/components/servers/onboarding-card"
import { ServerCard } from "@/components/servers/server-card"
import { getServers } from "@/lib/api"
import type { ServerSummary } from "@/types/api"

const ALL_TAGS = "all"
const EMPTY_SERVERS: ServerSummary[] = []

export function DashboardPage() {
  const [search, setSearch] = useState("")
  const [tagFilter, setTagFilter] = useState(ALL_TAGS)

  const { data, isLoading, isError } = useQuery({
    queryKey: ["servers", tagFilter],
    queryFn: () => getServers(tagFilter === ALL_TAGS ? undefined : tagFilter),
  })

  const servers = data ?? EMPTY_SERVERS

  const availableTags = useMemo(() => {
    const tags = new Set<string>()
    for (const server of servers) {
      for (const tag of server.tags) tags.add(tag)
    }
    return [...tags].sort()
  }, [servers])

  const filteredServers = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return servers
    return servers.filter(
      (server) =>
        server.hostName.toLowerCase().includes(term) ||
        server.id.toLowerCase().includes(term),
    )
  }, [servers, search])

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Servers</h1>
          <p className="text-sm text-muted-foreground">
            Live overview of every server reporting metrics to NetraScope.
          </p>
        </div>
        {!isLoading && !isError && servers.length > 0 && <AddServerDialog />}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by hostname or id…"
            className="pl-8"
          />
        </div>
        <Select value={tagFilter} onValueChange={setTagFilter}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="Filter by tag" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_TAGS}>All tags</SelectItem>
            {availableTags.map((tag) => (
              <SelectItem key={tag} value={tag}>
                {tag}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isError && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-destructive">
            Couldn't load servers. Is the backend running and reachable?
          </CardContent>
        </Card>
      )}

      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-64 rounded-2xl" />
          ))}
        </div>
      )}

      {!isLoading && !isError && servers.length === 0 && <OnboardingCard />}

      {!isLoading && !isError && servers.length > 0 && filteredServers.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <ServerOff className="size-8 text-muted-foreground" />
            <p className="font-medium">No servers found</p>
            <p className="text-sm text-muted-foreground">
              Try a different search term or tag filter.
            </p>
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && filteredServers.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredServers.map((server) => (
            <ServerCard key={server.id} server={server} />
          ))}
        </div>
      )}
    </div>
  )
}
