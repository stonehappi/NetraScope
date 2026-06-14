import { Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { AgentSetupGuide } from "@/components/servers/agent-setup-guide"

export function AddServerDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" />
          Add server
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] w-[80vw] overflow-y-auto sm:max-w-[80vw]">
        <DialogHeader>
          <DialogTitle>Connect a new server</DialogTitle>
          <DialogDescription>
            Download the agent for your OS, then run it with your personal ingestion token to
            start sending metrics.
          </DialogDescription>
        </DialogHeader>
        <AgentSetupGuide />
      </DialogContent>
    </Dialog>
  )
}
