import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Copy, KeyRound, RefreshCw, ShieldX } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  createAgentToken,
  getAgentTokens,
  rotateAgentToken,
  revokeAgentToken,
  updateAgentToken,
} from "@/lib/api"
import { formatRelativeTime } from "@/lib/format"
import type { AgentTokenCreatedResponse, AgentTokenResponse } from "@/types/api"

export function AgentTokenManager({ serverId }: { serverId: string }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState("Default agent token")
  const [allowedIps, setAllowedIps] = useState("")
  const [revealedToken, setRevealedToken] = useState<AgentTokenCreatedResponse | null>(null)

  const tokensQuery = useQuery({
    queryKey: ["agent-tokens", serverId],
    queryFn: () => getAgentTokens(serverId),
  })

  const createMutation = useMutation({
    mutationFn: () =>
      createAgentToken(serverId, {
        name,
        allowedIpAddresses: parseIpList(allowedIps),
      }),
    onSuccess: (response) => {
      setRevealedToken(response)
      queryClient.invalidateQueries({ queryKey: ["agent-tokens", serverId] })
      toast.success("Server agent token created.")
    },
    onError: showApiError,
  })

  const rotateMutation = useMutation({
    mutationFn: (tokenId: string) => rotateAgentToken(serverId, tokenId),
    onSuccess: (response) => {
      setRevealedToken(response)
      queryClient.invalidateQueries({ queryKey: ["agent-tokens", serverId] })
      toast.success("Server agent token rotated.")
    },
    onError: showApiError,
  })

  const revokeMutation = useMutation({
    mutationFn: (tokenId: string) => revokeAgentToken(serverId, tokenId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-tokens", serverId] })
      toast.success("Server agent token revoked.")
    },
    onError: showApiError,
  })

  const updateMutation = useMutation({
    mutationFn: (token: AgentTokenResponse) =>
      updateAgentToken(serverId, token.id, {
        name: token.name,
        allowedIpAddresses: parseIpList(allowedIps),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-tokens", serverId] })
      toast.success("IP allowlist updated.")
    },
    onError: showApiError,
  })

  const tokens = tokensQuery.data ?? []

  async function copyToken(token: string) {
    try {
      await navigator.clipboard.writeText(token)
      toast.success("Token copied.")
    } catch {
      toast.error("Failed to copy token.")
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-4" />
          Server agent tokens
        </CardTitle>
        <CardDescription>
          Prefer these scoped tokens over the account-wide token. Full token values are shown
          only when created or rotated.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} />
          <Input
            value={allowedIps}
            onChange={(event) => setAllowedIps(event.target.value)}
            placeholder="Optional IP allowlist, comma-separated"
          />
          <Button
            type="button"
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
          >
            Create token
          </Button>
        </div>

        {revealedToken && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
            <p className="text-sm font-medium">New token for {revealedToken.name}</p>
            <div className="mt-2 flex gap-2">
              <Input readOnly value={revealedToken.token} className="font-mono" />
              <Button type="button" variant="outline" size="icon" onClick={() => copyToken(revealedToken.token)}>
                <Copy className="size-4" />
              </Button>
            </div>
          </div>
        )}

        {tokensQuery.isLoading && <Skeleton className="h-24 rounded-lg" />}
        {!tokensQuery.isLoading && tokens.length === 0 && (
          <p className="text-sm text-muted-foreground">No server-scoped tokens yet.</p>
        )}
        <div className="space-y-2">
          {tokens.map((token) => (
            <div key={token.id} className="rounded-lg border p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{token.name}</p>
                    <Badge variant={token.revokedAt ? "secondary" : "outline"}>
                      {token.revokedAt ? "revoked" : "active"}
                    </Badge>
                    <span className="font-mono text-xs text-muted-foreground">
                      ...{token.tokenSuffix}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Created {formatRelativeTime(token.createdAt)}
                    {token.lastUsedAt ? ` · used ${formatRelativeTime(token.lastUsedAt)}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    IPs: {token.allowedIpAddresses.length > 0 ? token.allowedIpAddresses.join(", ") : "any"}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => updateMutation.mutate(token)}
                    disabled={updateMutation.isPending}
                  >
                    Save IPs
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => rotateMutation.mutate(token.id)}
                    disabled={rotateMutation.isPending}
                    aria-label="Rotate token"
                  >
                    <RefreshCw className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => revokeMutation.mutate(token.id)}
                    disabled={Boolean(token.revokedAt) || revokeMutation.isPending}
                    aria-label="Revoke token"
                  >
                    <ShieldX className="size-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function parseIpList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function showApiError(error: unknown) {
  toast.error(error instanceof Error ? error.message : "Token operation failed.")
}
