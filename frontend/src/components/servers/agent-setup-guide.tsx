import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Copy, Download } from "lucide-react"
import { Link } from "react-router-dom"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { API_BASE_URL, getMe } from "@/lib/api"

interface AgentDownloadLink {
  os: string
  arch: string
  fileName: string
  url: string
}

const OS_LABELS: Record<string, string> = {
  linux: "Linux",
  darwin: "macOS",
  windows: "Windows",
}

const ARCH_LABELS: Record<string, string> = {
  amd64: "Intel/AMD 64-bit",
  arm64: "ARM 64-bit",
}

const OS_ORDER = ["linux", "darwin", "windows"]
const AGENT_DOWNLOAD_BASE_URL =
  "https://github.com/stonehappi/NetraScope/raw/main/agent/dist"
const AGENT_DOWNLOADS: AgentDownloadLink[] = OS_ORDER.flatMap((os) =>
  ["amd64", "arm64"].map((arch) => {
    const fileName = agentFileName(os, arch)
    return {
      os,
      arch,
      fileName,
      url: `${AGENT_DOWNLOAD_BASE_URL}/${fileName}`,
    }
  }),
)

function detectOs(): string {
  const platform = navigator.userAgent
  if (/Win/i.test(platform)) return "windows"
  if (/Mac/i.test(platform)) return "darwin"
  if (/Linux/i.test(platform)) return "linux"
  return "linux"
}

function agentFileName(os: string, arch: string): string {
  const ext = os === "windows" ? ".exe" : ""
  return `netrascope-agent-${os}-${arch}${ext}`
}

function buildRunCommands(
  os: string,
  arch: string,
  serverUrl: string,
  token: string,
  downloadUrl: string,
) {
  const fileName = agentFileName(os, arch)

  if (os === "windows") {
    const setupLines = [`Invoke-WebRequest -Uri "${downloadUrl}" -OutFile "${fileName}"`]
    return {
      run: [...setupLines, `.\\${fileName} \``, `  -server-url ${serverUrl} \``, `  -token ${token}`].join(
        "\n",
      ),
      service: [
        ...setupLines,
        "# Run PowerShell as Administrator",
        `.\\${fileName} \``,
        "  -service install `",
        `  -server-url ${serverUrl} \``,
        `  -token ${token}`,
      ].join("\n"),
    }
  }

  const setupLines =
    os === "darwin"
      ? [
          `curl -fsSL ${downloadUrl} -o ${fileName}`,
          `chmod +x ./${fileName}`,
          `xattr -d com.apple.quarantine ./${fileName}`,
        ]
      : [`curl -fsSL ${downloadUrl} -o ${fileName}`, `chmod +x ./${fileName}`]

  return {
    run: [...setupLines, `./${fileName} \\`, `  -server-url ${serverUrl} \\`, `  -token ${token}`].join(
      "\n",
    ),
    service: [
      ...setupLines,
      `sudo ./${fileName} \\`,
      "  -service install \\",
      `  -server-url ${serverUrl} \\`,
      `  -token ${token}`,
    ].join("\n"),
  }
}

export function AgentSetupGuide() {
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: getMe,
  })

  const [tab, setTab] = useState<string | null>(null)
  const [archTab, setArchTab] = useState<string | null>(null)

  const downloads = AGENT_DOWNLOADS
  const availableOses = OS_ORDER.filter((os) => downloads.some((download) => download.os === os))
  const activeTab = tab ?? (availableOses.includes(detectOs()) ? detectOs() : availableOses[0])

  const osDownloads = downloads.filter((download) => download.os === activeTab)
  const activeArch =
    archTab && osDownloads.some((download) => download.arch === archTab)
      ? archTab
      : osDownloads[0]?.arch
  const activeDownload = osDownloads.find((download) => download.arch === activeArch)

  const commands =
    meQuery.data && activeTab && activeArch && activeDownload
      ? buildRunCommands(
          activeTab,
          activeArch,
          `${API_BASE_URL}/api/metrics`,
          meQuery.data.ingestionToken,
          activeDownload.url,
        )
      : null

  return (
    <div className="space-y-4">
      {availableOses.length > 0 && activeTab && (
        <div className="space-y-2">
          <Tabs value={activeTab} onValueChange={setTab}>
            <TabsList>
              {availableOses.map((os) => (
                <TabsTrigger key={os} value={os}>
                  {OS_LABELS[os] ?? os}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="flex flex-wrap items-center gap-2">
            {osDownloads.map((download) => (
              <Button
                key={download.fileName}
                variant={download.arch === activeArch ? "default" : "outline"}
                size="sm"
                onClick={() => setArchTab(download.arch)}
              >
                {ARCH_LABELS[download.arch] ?? download.arch}
              </Button>
            ))}
            {activeDownload && (
              <Button size="sm" variant="secondary" asChild>
                <a href={activeDownload.url} download>
                  <Download className="size-4" />
                  Download
                </a>
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <p className="text-sm font-medium">Run it</p>
        {meQuery.isLoading && <Skeleton className="h-24 w-full" />}
        {commands && <CommandBlock command={commands.run} />}
        <p className="text-xs text-muted-foreground">
          Run this from the folder where you downloaded the binary, or select the architecture
          above that matches what you downloaded.
        </p>
        {activeTab === "darwin" && (
          <p className="text-xs text-muted-foreground">
            macOS blocks downloaded binaries by default ("cannot be verified"). The{" "}
            <code className="font-mono">xattr</code> command above clears the quarantine flag so
            it can run.
          </p>
        )}
        {activeTab === "windows" && (
          <p className="text-xs text-muted-foreground">
            Run these commands in <strong>PowerShell</strong>, not Command Prompt (
            <code className="font-mono">cmd</code>) — <code className="font-mono">cmd</code> does
            not support this syntax.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Run as a background service (auto-start on boot)</p>
        {meQuery.isLoading && <Skeleton className="h-24 w-full" />}
        {commands && <CommandBlock command={commands.service} />}
        <p className="text-xs text-muted-foreground">
          {activeTab === "windows"
            ? "Registers and starts a Windows service that launches the agent automatically on every boot."
            : "Registers and starts a systemd (Linux) or launchd (macOS) service that launches the agent automatically on every boot."}
        </p>
      </div>

      <p className="text-sm text-muted-foreground">
        You can view or regenerate your ingestion token anytime from{" "}
        <Link to="/settings" className="underline hover:text-foreground">
          Settings
        </Link>
        . See the agent README for service management commands (status, restart, stop, uninstall).
      </p>
    </div>
  )
}

function CommandBlock({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      toast.success("Command copied to clipboard.")
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Failed to copy command.")
    }
  }

  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg bg-muted p-3 pr-10 text-xs">
        <code className="font-mono">{command}</code>
      </pre>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={copy}
        aria-label="Copy command"
        className="absolute top-2 right-2"
      >
        <Copy className={copied ? "size-3.5 text-primary" : "size-3.5"} />
      </Button>
    </div>
  )
}
