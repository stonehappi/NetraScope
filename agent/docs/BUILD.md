# Building the Agent for Production

This guide covers compiling release binaries of `netrascope-agent` for
distribution to client machines.

## Requirements

- Go 1.25 or newer
- No CGO toolchain needed — the agent uses the pure-Go `modernc.org/sqlite`
  driver, so `CGO_ENABLED=0` builds work on every platform.

## Build a single binary

From the `agent` directory:

```sh
cd agent
go mod tidy
CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o dist/netrascope-agent ./cmd/netrascope-agent
```

- `-trimpath` removes local filesystem paths from the binary.
- `-ldflags="-s -w"` strips debug symbols to reduce binary size.

## Cross-compile for all supported platforms

```sh
cd agent
mkdir -p dist

CGO_ENABLED=0 GOOS=linux   GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o dist/netrascope-agent-linux-amd64   ./cmd/netrascope-agent
CGO_ENABLED=0 GOOS=linux   GOARCH=arm64 go build -trimpath -ldflags="-s -w" -o dist/netrascope-agent-linux-arm64   ./cmd/netrascope-agent
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o dist/netrascope-agent-windows-amd64.exe ./cmd/netrascope-agent
CGO_ENABLED=0 GOOS=windows GOARCH=arm64 go build -trimpath -ldflags="-s -w" -o dist/netrascope-agent-windows-arm64.exe ./cmd/netrascope-agent
CGO_ENABLED=0 GOOS=darwin  GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o dist/netrascope-agent-darwin-amd64  ./cmd/netrascope-agent
CGO_ENABLED=0 GOOS=darwin  GOARCH=arm64 go build -trimpath -ldflags="-s -w" -o dist/netrascope-agent-darwin-arm64  ./cmd/netrascope-agent
```

Each output in `dist/` is a standalone executable with no external runtime
dependencies — copy it to a client machine and run it directly.

## Publishing builds for download from the dashboard

The backend serves agent binaries directly to users from its "Connect your
first server" onboarding card and the Settings page. To publish a set of
builds, copy the cross-compiled binaries (named exactly as produced above,
e.g. `netrascope-agent-linux-amd64`, `netrascope-agent-windows-amd64.exe`)
into:

```text
backend/src/NetraScope.Core/wwwroot/downloads/
```

`GET /api/agent/downloads` scans that directory and returns the available
`{ os, arch, fileName, sizeBytes, url }` entries, which the dashboard groups
by operating system. Files are served as-is at `/downloads/<fileName>`.

## Embedding a version number (optional)

To stamp a version into the binary, add a package-level `var version = "dev"`
to `main.go` and override it at build time:

```sh
CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X main.version=1.2.3" -o dist/netrascope-agent ./cmd/netrascope-agent
```

## Run the test suite before releasing

```sh
cd agent
go test ./...
```

## Verify a built binary

```sh
./dist/netrascope-agent-linux-amd64 -server-url http://localhost:5050/api/metrics -interval 5s
```

It should print `NetraScope agent started: server_id="..." interval=5s`
followed by periodic `metric sent` log lines. Press Ctrl+C to stop.
