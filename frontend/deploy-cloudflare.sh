#!/usr/bin/env bash
# Build and deploy the frontend to Cloudflare Pages, pointing it at a
# configurable backend (Worker) URL.
#
# Edit DEFAULT_BACKEND_URL below to set the backend permanently, or override
# it at runtime:
#
#   ./deploy-cloudflare.sh <backend-url> [pages-project-name]
#
# Or set VITE_API_BASE_URL in the environment instead of passing an argument:
#   VITE_API_BASE_URL=https://netrascope-api-d1.<subdomain>.workers.dev ./deploy-cloudflare.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

# Fixed default backend (Worker) URL used when no argument or
# VITE_API_BASE_URL env var is provided.
DEFAULT_BACKEND_URL="https://netrascope-api-d1.seng-vannak-eventhub.workers.dev"

VITE_API_BASE_URL="${1:-${VITE_API_BASE_URL:-$DEFAULT_BACKEND_URL}}"



export VITE_API_BASE_URL

echo "==> Building frontend (VITE_API_BASE_URL=$VITE_API_BASE_URL)"
npm ci
npm run build

echo "==> Deploying dist/ to Cloudflare Pages project 'netrascope'"
npx wrangler pages deploy dist --project-name netrascope
