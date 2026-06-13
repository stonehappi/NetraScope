#!/usr/bin/env bash
# One-shot deploy for macOS / Linux:
#  1. Make sure env files exist (copied from .env.example templates).
#  2. Cross-compile the Go agent for all supported platforms.
#  3. Publish the binaries to the backend's downloads folder.
#  4. Build and start the full stack with docker compose.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "==> Checking environment files"
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example - review it before deploying to production."
fi
if [ ! -f frontend/.env ]; then
  cp frontend/.env.example frontend/.env
  echo "Created frontend/.env from frontend/.env.example."
fi

echo "==> Building agent binaries"
command -v go >/dev/null || { echo "Go is required to build the agent. Install Go 1.25+." >&2; exit 1; }

(
  cd agent
  go mod tidy
  mkdir -p dist

  PLATFORMS=(
    "linux amd64"
    "linux arm64"
    "darwin amd64"
    "darwin arm64"
    "windows amd64"
    "windows arm64"
  )

  for platform in "${PLATFORMS[@]}"; do
    read -r os arch <<< "$platform"
    ext=""
    [ "$os" = "windows" ] && ext=".exe"
    out="dist/netrascope-agent-${os}-${arch}${ext}"
    echo "  building $out"
    CGO_ENABLED=0 GOOS="$os" GOARCH="$arch" go build -trimpath -ldflags="-s -w" -o "$out" ./cmd/netrascope-agent
  done
)

echo "==> Publishing agent binaries for download"
DOWNLOADS_DIR="backend/src/NetraScope.Core/wwwroot/downloads"
mkdir -p "$DOWNLOADS_DIR"
cp agent/dist/netrascope-agent-*-* "$DOWNLOADS_DIR/"

echo "==> Building and starting services"
command -v docker >/dev/null || { echo "Docker is required to deploy the stack." >&2; exit 1; }
docker compose up --build -d

set -a
source .env
set +a
echo "==> Done. Dashboard available at http://localhost:${PROXY_PORT:-8081}"
