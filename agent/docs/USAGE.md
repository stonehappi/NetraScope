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

If installation fails, confirm the PowerShell or Command Prompt window says
`Administrator` in its title. You can also remove a partial installation
before retrying:

```powershell
.\netrascope-agent.exe -service uninstall
```

## 4. Managing the service

Once installed, use the same executable to control the service:

```sh
netrascope-agent -service status
netrascope-agent -service stop
netrascope-agent -service start
netrascope-agent -service restart
netrascope-agent -service uninstall
```

## 5. Version and updates

Check the installed agent version:

```sh
netrascope-agent -version
```

Update to the latest GitHub Release binary for your platform:

```sh
sudo netrascope-agent -update
sudo netrascope-agent -service restart
```

Restarting the service makes the newly installed binary take over from the
already running process.

To install a pinned release instead of the latest release, pass the exact
asset URL:

```sh
sudo netrascope-agent \
  -update \
  -update-url https://github.com/stonehappi/NetraScope/releases/download/v1.0.0/netrascope-agent-linux-amd64
```

On Windows, stop the service before updating:

```powershell
.\netrascope-agent.exe -service stop
.\netrascope-agent.exe -update
.\netrascope-agent.exe -service start
```

## Configuration reference

Every setting can be passed as a command-line flag, an environment variable, or
a config file. Precedence, highest first: **flag > environment variable > config
file > built-in default**.

| Flag | Environment variable | Default | Description |
| --- | --- | --- | --- |
| `-config` | `NETRASCOPE_CONFIG` | empty | Path to a TOML config file (see below). |
| `-server-url` | `NETRASCOPE_SERVER_URL` | `http://localhost:5050/api/metrics` | Where metrics are sent. Use HTTPS in production. |
| `-server-id` | `NETRASCOPE_SERVER_ID` | machine hostname | Name shown for this server in the dashboard. |
| `-token` | `NETRASCOPE_TOKEN` | empty | Bearer token sent with each request, if your backend requires auth. Never logged. |
| `-buffer-db` | `NETRASCOPE_BUFFER_DB` | OS cache directory | Path to the local SQLite offline buffer. |
| `-interval` | `NETRASCOPE_INTERVAL` | `10s` | How often metrics are collected and sent. |
| `-timeout` | `NETRASCOPE_TIMEOUT` | `5s` | HTTP request timeout per metric send. |
| `-batch-size` | `NETRASCOPE_BATCH_SIZE` | `6` | Maximum locally buffered samples sent in one API request. |
| `-flush-interval` | `NETRASCOPE_FLUSH_INTERVAL` | `60s` | Maximum time between batch uploads. |
| `-version` | none | false | Print the embedded agent version and exit. |
| `-update` | none | false | Replace the executable with the latest release binary for this platform. |
| `-update-url` | none | GitHub latest release URL | Download URL used by `-update`. |

The default `-interval 10s`, `-batch-size 6`, and `-flush-interval 60s`
combination keeps 10-second metric resolution but reduces API requests to
about one upload per minute per server.

### Config file

Instead of passing every flag, point the agent at a TOML file. The dashboard
**Add server** guide generates one prefilled with your server URL and token
("Download agent.toml").

```toml
# /etc/netrascope/agent.toml
server_url = "https://monitor.example.com/api/metrics"
token = "YOUR_TOKEN"
server_id = "web-01"
interval = "10s"
timeout = "5s"
batch_size = 6
flush_interval = "60s"
```

```sh
netrascope-agent -config /etc/netrascope/agent.toml
# or install it as a boot service:
sudo netrascope-agent -service install -config /etc/netrascope/agent.toml
```

Keys use `snake_case` and map one-to-one to the flags above. Only `server_url`
and `token` are typically required; omit any key to keep its default. Unknown
keys or invalid values fail fast with an error. Flags and environment variables
still override file values, so you can keep a shared base file and tweak a
single setting per host.

### Examples

Custom server name and faster reporting interval:

```sh
./netrascope-agent \
  -server-url https://monitor.example.com/api/metrics \
  -server-id web-01 \
  -interval 5s \
  -batch-size 12 \
  -flush-interval 1m \
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
