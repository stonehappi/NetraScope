import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Copy, Eye, EyeOff, RefreshCw, ShieldCheck } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError, getAuditLogs, getMe, regenerateIngestionToken } from "@/lib/api"
import { formatRelativeTime } from "@/lib/format"

export function SettingsPage() {
  const queryClient = useQueryClient()
  const [revealed, setRevealed] = useState(false)

  const { data, isLoading, isError } = useQuery({
    queryKey: ["me"],
    queryFn: getMe,
  })

  const auditQuery = useQuery({
    queryKey: ["audit-logs"],
    queryFn: getAuditLogs,
  })

  const regenerateMutation = useMutation({
    mutationFn: regenerateIngestionToken,
    onSuccess: (response) => {
      queryClient.setQueryData(["me"], response)
      setRevealed(true)
      toast.success("Ingestion token regenerated.")
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : "Failed to regenerate token.")
    },
  })

  async function copyToken() {
    if (!data) return
    try {
      await navigator.clipboard.writeText(data.ingestionToken)
      toast.success("Ingestion token copied to clipboard.")
    } catch {
      toast.error("Failed to copy token.")
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage your account and agent ingestion token.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Agent ingestion token</CardTitle>
          <CardDescription>
            Configure your agents with this token so the metrics they report are linked to your
            account. Keep it secret — anyone with this token can submit metrics as you.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading && <Skeleton className="h-9 w-full max-w-md" />}

          {isError && (
            <p className="text-sm text-destructive">Couldn't load your ingestion token.</p>
          )}

          {data && (
            <>
              <div className="flex max-w-md gap-2">
                <Input
                  readOnly
                  type={revealed ? "text" : "password"}
                  value={data.ingestionToken}
                  className="font-mono"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setRevealed((value) => !value)}
                  aria-label={revealed ? "Hide token" : "Reveal token"}
                >
                  {revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={copyToken}
                  aria-label="Copy token"
                >
                  <Copy className="size-4" />
                </Button>
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => regenerateMutation.mutate()}
                disabled={regenerateMutation.isPending}
              >
                <RefreshCw className="size-4" />
                Regenerate token
              </Button>
              <p className="text-xs text-muted-foreground">
                Regenerating invalidates the current token — agents using the old token will stop
                being able to submit metrics until they're updated.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4" />
            Security audit log
          </CardTitle>
          <CardDescription>
            Recent account, token, server, and configuration security events.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {auditQuery.isLoading && <Skeleton className="h-24 w-full" />}
          {auditQuery.isError && (
            <p className="text-sm text-destructive">Couldn't load audit events.</p>
          )}
          {!auditQuery.isLoading && !auditQuery.isError && (auditQuery.data?.length ?? 0) === 0 && (
            <p className="text-sm text-muted-foreground">No audit events recorded yet.</p>
          )}
          {auditQuery.data?.slice(0, 12).map((event) => (
            <div key={event.id} className="rounded-lg border p-3">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <p className="font-medium">{event.action.replaceAll("_", " ")}</p>
                <p className="text-xs text-muted-foreground">
                  {formatRelativeTime(event.createdAt)}
                </p>
              </div>
              <p className="text-sm text-muted-foreground">
                {event.entityType}
                {event.entityId ? ` · ${event.entityId}` : ""}
                {event.ipAddress ? ` · ${event.ipAddress}` : ""}
              </p>
              {event.message && (
                <p className="mt-1 text-xs text-muted-foreground">{event.message}</p>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
