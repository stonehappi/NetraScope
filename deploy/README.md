# Deploy

One script per platform (Windows can't run `.sh`). Each does the same thing:

1. Create `.env` and `frontend/.env` from their `.env.example` templates if missing.
2. Cross-compile the Go agent for linux/darwin/windows (amd64 + arm64).
3. Run `docker compose up --build -d` to (re)build and start `db`, `migrate`,
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

## Skipping the agent build

If Go isn't installed, or the agent binaries don't need to be rebuilt,
pass `--skip-agent` (`-SkipAgent` on Windows) to skip step 2 and go
straight to `docker compose up --build -d`:

```sh
./deploy/deploy.sh --skip-agent
```

```powershell
.\deploy\deploy.ps1 -SkipAgent
```

## Notes

- Review `.env` before deploying to a real environment — the generated
  defaults (`POSTGRES_PASSWORD`, `JWT_SECRET`) are dev-only placeholders.
- Re-run the script after agent code changes to rebuild local binaries in
  `agent/dist`.
- Push a tag like `v1.0.0` to publish official agent binaries through GitHub
  Releases for dashboard downloads and `netrascope-agent -update`.
