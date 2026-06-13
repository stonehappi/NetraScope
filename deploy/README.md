# Deploy

One script per platform (Windows can't run `.sh`). Each does the same thing:

1. Create `.env` and `frontend/.env` from their `.env.example` templates if missing.
2. Cross-compile the Go agent for linux/darwin/windows (amd64 + arm64).
3. Copy the binaries into `backend/src/NetraScope.Core/wwwroot/downloads/`
   so they're served by `GET /api/agent/downloads` and the dashboard's
   "Connect your first server" card.
4. Run `docker compose up --build -d` to (re)build and start `db`, `migrate`,
   `backend`, `frontend`, and `proxy`.

## Requirements

- Go 1.25+ (to build the agent)
- Docker with Compose v2

## macOS / Linux

```sh
./deploy/deploy.sh
```

## Windows (PowerShell)

```powershell
.\deploy\deploy.ps1
```

## Notes

- Review `.env` before deploying to a real environment — the generated
  defaults (`POSTGRES_PASSWORD`, `JWT_SECRET`) are dev-only placeholders.
- Re-run the script after agent code changes to rebuild and republish the
  binaries.
