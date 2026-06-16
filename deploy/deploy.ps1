# One-shot deploy for Windows (PowerShell):
#  1. Make sure env files exist (copied from .env.example templates).
#  2. Cross-compile the Go agent for all supported platforms (unless -SkipAgent).
#  3. Build and start the full stack with docker compose.
#
# Usage: .\deploy\deploy.ps1 [-SkipAgent]
#   -SkipAgent  Skip building/publishing the Go agent binaries (no Go required).

param(
    [switch]$SkipAgent
)

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $PSScriptRoot
Set-Location $RootDir

Write-Host "==> Checking environment files"
if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "Created .env from .env.example - review it before deploying to production."
}
if (-not (Test-Path "frontend/.env")) {
    Copy-Item "frontend/.env.example" "frontend/.env"
    Write-Host "Created frontend/.env from frontend/.env.example."
}

if ($SkipAgent) {
    Write-Host "==> Skipping agent build (-SkipAgent)"
}
else {
    Write-Host "==> Building agent binaries"
    if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
        Write-Error "Go is required to build the agent. Install Go 1.25+, or pass -SkipAgent."
        exit 1
    }
    $agentVersion = if ($env:AGENT_VERSION) { $env:AGENT_VERSION } else { "dev" }

    Push-Location agent
    try {
        go mod tidy
        New-Item -ItemType Directory -Force -Path dist | Out-Null

        $platforms = @(
            @{os = "linux";   arch = "amd64"},
            @{os = "linux";   arch = "arm64"},
            @{os = "darwin";  arch = "amd64"},
            @{os = "darwin";  arch = "arm64"},
            @{os = "windows"; arch = "amd64"},
            @{os = "windows"; arch = "arm64"}
        )

        foreach ($p in $platforms) {
            $ext = if ($p.os -eq "windows") { ".exe" } else { "" }
            $out = "dist/netrascope-agent-$($p.os)-$($p.arch)$ext"
            Write-Host "  building $out"
            $env:CGO_ENABLED = "0"
            $env:GOOS = $p.os
            $env:GOARCH = $p.arch
            go build -trimpath -ldflags="-s -w -X main.version=$agentVersion" -o $out ./cmd/netrascope-agent
        }
    }
    finally {
        Remove-Item Env:\CGO_ENABLED, Env:\GOOS, Env:\GOARCH -ErrorAction SilentlyContinue
        Pop-Location
    }

    Write-Host "==> Agent binaries available in agent/dist"
}

Write-Host "==> Building and starting services"
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Error "Docker is required to deploy the stack."
    exit 1
}
docker compose up --build -d

$proxyPort = "8081"
foreach ($line in Get-Content ".env") {
    if ($line -match '^\s*PROXY_PORT\s*=\s*(.+)$') {
        $proxyPort = $matches[1].Trim()
    }
}
Write-Host "==> Done. Dashboard available at http://localhost:$proxyPort"
