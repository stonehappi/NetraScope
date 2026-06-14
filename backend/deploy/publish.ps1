# Publishes NetraScope.Core for an IIS deployment.
#
# Usage:
#   .\backend\deploy\publish.ps1 [-OutDir C:\inetpub\netrascope] [-Runtime win-x64] [-SelfContained]
#
# Run from anywhere; paths are resolved relative to the repo root.

param(
    [string]$OutDir = "publish",
    [string]$Runtime = "win-x64",
    [switch]$SelfContained
)

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $RootDir

$project = "backend/src/NetraScope.Core/NetraScope.Core.csproj"

Write-Host "==> Publishing $project ($Runtime, SelfContained=$($SelfContained.IsPresent)) to $OutDir"

$args = @(
    "publish", $project,
    "-c", "Release",
    "-o", $OutDir,
    "-r", $Runtime,
    "--self-contained", $SelfContained.IsPresent.ToString().ToLower()
)

dotnet @args

Write-Host "==> Copying web.config"
Copy-Item "backend/deploy/web.config" (Join-Path $OutDir "web.config") -Force

Write-Host "==> Done. Copy the contents of '$OutDir' to the IIS site's physical path."
Write-Host "    Edit web.config's <environmentVariables> with your production"
Write-Host "    database connection string and JWT secret before starting the site."
