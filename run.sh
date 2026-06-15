#!/usr/bin/env bash
# Convenience launcher for local development (macOS / Linux).
# Starts PostgreSQL via Docker, applies EF Core migrations, then runs the
# ASP.NET Core backend and the Vite frontend dev server together.
#
# Usage: ./run.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

export ConnectionStrings__NetraScope='Host=localhost;Port=5432;Database=netrascope;Username=postgres;Password=password'
export Auth__Jwt__Secret='CHANGE_ME_DEV_ONLY_REPLACE_WITH_A_LONG_RANDOM_SECRET'
export AllowedHosts='http://localhost:5173'

if command -v docker >/dev/null; then
  echo "==> Starting PostgreSQL"
  docker compose up -d db
else
  echo "==> Docker not found, skipping PostgreSQL startup (make sure it is running)"
fi

echo "==> Applying database migrations"
dotnet tool restore
dotnet ef database update \
  --project backend/src/NetraScope.Core \
  --startup-project backend/src/NetraScope.Core

if [ ! -f frontend/.env ]; then
  echo "VITE_API_BASE_URL=http://localhost:5050" > frontend/.env
fi

if [ ! -d frontend/node_modules ]; then
  echo "==> Installing frontend dependencies"
  (cd frontend && npm install)
fi

cleanup() {
  echo "==> Stopping services"
  jobs -p | xargs -r kill 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "==> Starting backend (http://localhost:5050)"
dotnet run --project backend/src/NetraScope.Core --urls http://localhost:5050 &

echo "==> Starting frontend (http://localhost:5173)"
(cd frontend && npm run dev) &

wait
