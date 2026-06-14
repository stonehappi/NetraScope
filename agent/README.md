# NetraScope Agent

The NetraScope agent collects host metrics and posts them to the central
`/api/metrics` endpoint. Failed deliveries are buffered in a local SQLite
database and replayed in order when the endpoint is available again.

## Development

Go 1.25 or newer is required to build the agent.

```sh
cd agent
go mod tidy
go run ./cmd/netrascope-agent \
  -server-url http://localhost:5050/api/metrics
```

## Configuration

Flags override their corresponding environment variables.

| Flag | Environment variable | Default |
| --- | --- | --- |
| `-server-url` | `NETRASCOPE_SERVER_URL` | `http://localhost:5050/api/metrics` |
| `-server-id` | `NETRASCOPE_SERVER_ID` | Machine hostname |
| `-token` | `NETRASCOPE_TOKEN` | Empty |
| `-buffer-db` | `NETRASCOPE_BUFFER_DB` | OS user cache directory |
| `-interval` | `NETRASCOPE_INTERVAL` | `10s` |
| `-timeout` | `NETRASCOPE_TIMEOUT` | `5s` |

Use an HTTPS endpoint in production. The token is sent as a bearer token and
is never printed by the agent. Set `-token` (or `NETRASCOPE_TOKEN`) to the
per-user ingestion token shown on the dashboard's Settings page (or returned
by `GET /api/auth/me`). The backend always requires this token on
`/api/metrics` — requests without it are rejected with `401 Unauthorized`,
and the servers reported with a given token only appear in that user's
dashboard (see the backend README).

For the Cloudflare Worker backend, use its public ingestion URL, for example
`https://netrascope-api.example.workers.dev/api/metrics`. Setup and deployment
instructions are in `worker-backend/README.md`.

## Install As A Background Service

Installation requires administrator/root privileges. Installing always enables
automatic startup and immediately starts the agent. If the service cannot start,
installation fails and the service registration is rolled back.

Linux and macOS:

```sh
sudo ./netrascope-agent \
  -service install \
  -server-url https://monitor.example.com/api/metrics \
  -token YOUR_TOKEN
```

Windows PowerShell, run as Administrator:

```powershell
.\netrascope-agent.exe `
  -service install `
  -server-url https://monitor.example.com/api/metrics `
  -token YOUR_TOKEN
```

The same executable supports service management:

```sh
netrascope-agent -service status
netrascope-agent -service restart
netrascope-agent -service stop
netrascope-agent -service start
netrascope-agent -service uninstall
```

Keep the executable at a permanent path before installing it. The registered
service points to that executable. Installed services store their offline
buffer under the operating system's shared application-data directory by
default.

## Release Builds

Build with `CGO_ENABLED=0` to produce standalone executables:

```sh
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o dist/netrascope-agent-linux-amd64 ./cmd/netrascope-agent
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -ldflags="-s -w" -o dist/netrascope-agent-linux-arm64 ./cmd/netrascope-agent
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o dist/netrascope-agent-windows-amd64.exe ./cmd/netrascope-agent
CGO_ENABLED=0 GOOS=windows GOARCH=arm64 go build -trimpath -ldflags="-s -w" -o dist/netrascope-agent-windows-arm64.exe ./cmd/netrascope-agent
CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o dist/netrascope-agent-darwin-amd64 ./cmd/netrascope-agent
CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -trimpath -ldflags="-s -w" -o dist/netrascope-agent-darwin-arm64 ./cmd/netrascope-agent
```
