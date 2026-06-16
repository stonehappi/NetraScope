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
CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X main.version=1.0.0" -o dist/netrascope-agent ./cmd/netrascope-agent
```

- `-trimpath` removes local filesystem paths from the binary.
- `-ldflags="-s -w"` strips debug symbols to reduce binary size.
- `-X main.version=1.0.0` stamps the value shown by `-version`.

## Cross-compile for all supported platforms

```sh
cd agent
mkdir -p dist

VERSION=1.0.0
LDFLAGS="-s -w -X main.version=${VERSION}"

CGO_ENABLED=0 GOOS=linux   GOARCH=amd64 go build -trimpath -ldflags="$LDFLAGS" -o dist/netrascope-agent-linux-amd64   ./cmd/netrascope-agent
CGO_ENABLED=0 GOOS=linux   GOARCH=arm64 go build -trimpath -ldflags="$LDFLAGS" -o dist/netrascope-agent-linux-arm64   ./cmd/netrascope-agent
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags="$LDFLAGS" -o dist/netrascope-agent-windows-amd64.exe ./cmd/netrascope-agent
CGO_ENABLED=0 GOOS=windows GOARCH=arm64 go build -trimpath -ldflags="$LDFLAGS" -o dist/netrascope-agent-windows-arm64.exe ./cmd/netrascope-agent
CGO_ENABLED=0 GOOS=darwin  GOARCH=amd64 go build -trimpath -ldflags="$LDFLAGS" -o dist/netrascope-agent-darwin-amd64  ./cmd/netrascope-agent
CGO_ENABLED=0 GOOS=darwin  GOARCH=arm64 go build -trimpath -ldflags="$LDFLAGS" -o dist/netrascope-agent-darwin-arm64  ./cmd/netrascope-agent
```

Each output in `dist/` is a standalone executable with no external runtime
dependencies — copy it to a client machine and run it directly.

## Publishing builds through GitHub Releases

The dashboard and `netrascope-agent -update` use GitHub Release URLs such as:

```text
https://github.com/stonehappi/NetraScope/releases/latest/download/netrascope-agent-linux-amd64
```

Push a semantic version tag to build and publish all supported agent assets:

```sh
git tag v1.0.0
git push origin v1.0.0
```

The release workflow strips the leading `v` from the tag before embedding the
version into each binary, so `netrascope-agent -version` prints `1.0.0`.

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
