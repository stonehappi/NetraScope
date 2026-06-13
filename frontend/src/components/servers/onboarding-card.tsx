import { Terminal } from "lucide-react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { AgentSetupGuide } from "@/components/servers/agent-setup-guide"

export function OnboardingCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Terminal className="size-4" />
          Connect your first server
        </CardTitle>
        <CardDescription>
          No agents have reported metrics yet. Download the agent for your OS, then run it with
          your personal ingestion token to start sending metrics.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AgentSetupGuide />
      </CardContent>
    </Card>
  )
}
