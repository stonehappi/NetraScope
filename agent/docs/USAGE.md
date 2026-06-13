# Using the NetraScope Agent (Client Guide)

This guide is for installing and running the agent on a machine you want to
monitor with NetraScope.

## What it does

The agent runs in the background on your server, periodically collects CPU,
memory, disk, and network metrics, and sends them to your NetraScope backend.
If the backend is unreachable, metrics are saved to a local SQLite buffer and
sent once the connection is restored — no data is lost.

## 1. Get the binary

Download the prebuilt binary for your platform (e.g.
`netrascope-agent-linux-amd64`, `netrascope-agent-darwin-arm64`,
`netrascope-agent-windows-amd64.exe`), rename it to `netrascope-agent`, and
place it somewhere permanent, such as `/usr/local/bin/netrascope-agent`. On
Linux/macOS, make it executable:

```sh
chmod +x netrascope-agent
sudo mv netrascope-agent /usr/local/bin/
```

Moving it into `/usr/local/bin` (a directory already on `PATH`) lets you run
`netrascope-agent` from any directory. If you'd rather run it in place
without moving it, prefix the command with `./`, e.g. `./netrascope-agent
-service status` — otherwise the shell reports `command not found`.

## 2. Quick test run

Run it in the foreground first to confirm it can reach your NetraScope server:

```sh
./netrascope-agent -server-url https://monitor.example.com/api/metrics -token YOUR_TOKEN
```

You should see log output like:

```
NetraScope agent started: server_id="my-server" interval=10s
metric sent
metric sent
```

Press Ctrl+C to stop. Once this works, install it as a background service so
it survives reboots.

## 3. Install as a background service

Installing requires administrator/root privileges. Installation always
enables automatic startup and immediately starts the agent. If the service
fails to start, the installation is automatically rolled back.

**Linux / macOS:**

```sh
sudo ./netrascope-agent \
  -service install \
  -server-url https://monitor.example.com/api/metrics \
  -token YOUR_TOKEN
```

**Windows (PowerShell, run as Administrator):**

```powershell
.\netrascope-agent.exe `
  -service install `
  -server-url https://monitor.example.com/api/metrics `
  -token YOUR_TOKEN
```

Keep the executable at a permanent path before installing — the registered
service points to that exact path.

## 4. Managing the service

Once installed, use the same executable to control the service:

```sh
netrascope-agent -service status
netrascope-agent -service stop
netrascope-agent -service start
netrascope-agent -service restart
netrascope-agent -service uninstall
```

## Configuration reference

Every setting can be passed as a command-line flag or an environment
variable. Flags take priority if both are set.

| Flag | Environment variable | Default | Description |
| --- | --- | --- | --- |
| `-server-url` | `NETRASCOPE_SERVER_URL` | `http://localhost:5050/api/metrics` | Where metrics are sent. Use HTTPS in production. |
| `-server-id` | `NETRASCOPE_SERVER_ID` | machine hostname | Name shown for this server in the dashboard. |
| `-token` | `NETRASCOPE_TOKEN` | empty | Bearer token sent with each request, if your backend requires auth. Never logged. |
| `-buffer-db` | `NETRASCOPE_BUFFER_DB` | OS cache directory | Path to the local SQLite offline buffer. |
| `-interval` | `NETRASCOPE_INTERVAL` | `10s` | How often metrics are collected and sent. |
| `-timeout` | `NETRASCOPE_TIMEOUT` | `5s` | HTTP request timeout per metric send. |

### Examples

Custom server name and faster reporting interval:

```sh
./netrascope-agent \
  -server-url https://monitor.example.com/api/metrics \
  -server-id web-01 \
  -interval 5s \
  -token YOUR_TOKEN
```

Using environment variables instead of flags (useful for systemd
`EnvironmentFile` or Docker):

```sh
export NETRASCOPE_SERVER_URL=https://monitor.example.com/api/metrics
export NETRASCOPE_SERVER_ID=web-01
export NETRASCOPE_TOKEN=YOUR_TOKEN
./netrascope-agent
```

## Troubleshooting

- **"agent stopped with error" in logs** — check that `-server-url` is
  reachable from this machine (`curl -i <server-url>`).
- **Metrics not appearing on the dashboard** — confirm the `-server-id` is
  unique and matches what you expect to see listed; check
  `netrascope-agent -service status` to confirm the service is running.
- **Offline buffering** — if the backend is temporarily down, the agent
  queues metrics locally (up to the buffer database) and flushes them in
  order once connectivity returns. No action needed.
- **Changing configuration after install** — uninstall and reinstall the
  service with the new flags:
  ```sh
  sudo netrascope-agent -service uninstall
  sudo netrascope-agent -service install -server-url ... -token ...
  ```
