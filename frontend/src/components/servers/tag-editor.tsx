import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, X } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ApiError, getServerTags, replaceServerTags } from "@/lib/api"

export function TagEditor({ serverId }: { serverId: string }) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState("")

  const { data, isLoading } = useQuery({
    queryKey: ["server-tags", serverId],
    queryFn: () => getServerTags(serverId),
  })

  const tags = data?.tags ?? []

  const mutation = useMutation({
    mutationFn: (nextTags: string[]) => replaceServerTags(serverId, { tags: nextTags }),
    onSuccess: (response) => {
      queryClient.setQueryData(["server-tags", serverId], response)
      queryClient.invalidateQueries({ queryKey: ["servers"] })
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : "Failed to update tags.")
    },
  })

  function addTag() {
    const next = draft.trim().toLowerCase()
    if (!next || tags.includes(next)) {
      setDraft("")
      return
    }
    mutation.mutate([...tags, next])
    setDraft("")
  }

  function removeTag(tag: string) {
    mutation.mutate(tags.filter((existing) => existing !== tag))
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {isLoading && <span className="text-sm text-muted-foreground">Loading tags…</span>}
        {!isLoading && tags.length === 0 && (
          <span className="text-sm text-muted-foreground">No tags yet.</span>
        )}
        {tags.map((tag) => (
          <Badge key={tag} variant="secondary" className="gap-1 pr-1">
            {tag}
            <button
              type="button"
              onClick={() => removeTag(tag)}
              disabled={mutation.isPending}
              aria-label={`Remove tag ${tag}`}
              className="rounded-full p-0.5 hover:bg-muted-foreground/20 disabled:opacity-50"
            >
              <X className="size-3" />
            </button>
          </Badge>
        ))}
      </div>
      <div className="flex max-w-xs gap-2">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              addTag()
            }
          }}
          placeholder="Add a tag…"
          disabled={mutation.isPending}
          maxLength={50}
        />
        <Button type="button" variant="outline" size="icon" onClick={addTag} disabled={mutation.isPending}>
          <Plus className="size-4" />
        </Button>
      </div>
    </div>
  )
}
