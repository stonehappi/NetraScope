## 🛠️ NetraScope Tech Stack

This stack uses **Go for the server agent** and modern **C# / .NET for the backend**, focusing on simple cross-platform installation, high performance, and low memory usage.

* **Agent (Collector):** **Go** compiled into a small, self-contained native binary for Linux, Windows, and macOS. The agent must not require Go or another runtime on the monitored server.
* **Backend (Ingestion & Engine):** **ASP.NET Core Minimal Web API** (.NET 10) for high-performance, asynchronous, low-overhead HTTP ingestion.
* **Database ORM:** **Entity Framework Core (EF Core)** using the **Npgsql** provider.
* **Database Storage:** **PostgreSQL** (can be extended with the *TimescaleDB* extension later for optimized time-series compression).
* **Communication Protocol:** **HTTP REST with JSON** for a simple, portable contract between the Go agent and .NET backend.

---

## 📋 Copy-Paste AI Prompt (Features & Requirements)

Copy the prompt block below and paste it into your AI assistant to generate the project structure and initial code.

```text
Act as a Senior Infrastructure, Go, and .NET Solutions Architect. I am building a custom server monitoring system named **NetraScope**.

Please generate a complete, working blueprint using Go for the collector and C#/.NET 10 for the backend:

### 1. SHARED API CONTRACT
- Define the backend Data Transfer Object (DTO) using a C# `record` named `MetricPacket`.
- Fields needed: `ServerId` (string), `Timestamp` (DateTime offset), `CpuUsagePct` (float), `MemoryUsedBytes` (long), `MemoryTotalBytes` (long), `DiskUtilizationPct` (float), `NetworkInBytesSec` (long).
- Define a matching Go `MetricPacket` struct with explicit JSON tags using camelCase field names.
- Document the JSON payload contract so the Go agent and .NET backend remain compatible.

### 2. GO CLIENT AGENT (cmd/netrascope-agent)
- Create the collector in Go using a clean, conventional Go module layout.
- Gather real cross-platform system metrics for CPU usage, memory usage, root disk utilization, and network bytes received per second.
- Loop every 10 seconds by default, construct a `MetricPacket`, and send it as an HTTP POST JSON payload to the central backend endpoint (`/api/metrics`).
- Read configuration from command-line flags and environment variables, including backend URL, server ID, collection interval, request timeout, and optional bearer token.
- Default the server ID to the machine hostname when it is not configured.
- Use bounded HTTP timeouts, handle non-success responses, and retry temporary delivery failures with capped exponential backoff.
- Support graceful shutdown on operating-system signals.
- Compile to a single native executable with no runtime dependency.
- Provide release build commands for Windows amd64/arm64, Linux amd64/arm64, and macOS amd64/arm64.
- Make installation easy on every supported OS:
  - Linux: provide a systemd unit and install/uninstall script.
  - Windows: provide PowerShell install/uninstall scripts that register a Windows Service.
  - macOS: provide a launchd plist and install/uninstall script.
- Installation must register the agent for automatic startup and start it immediately. If automatic startup cannot be enabled or the service cannot start, installation must fail instead of leaving a partially installed agent.
- Do not require Docker, Go, or .NET to be installed on monitored servers.
- Never log authentication tokens or other secrets.

### 3. BACKEND CORE ENGINE (NetraScope.Core)
- Create an ASP.NET Core Minimal API.
- Define a PostgreSQL Database Context (`NetraDbContext`) using EF Core with two entities/tables mapped:
  1. `Server` (Id, HostName, IpAddress, LastHeartbeatAt)
  2. `PerformanceMetric` (Id, ServerId, Timestamp, CpuUsagePct, MemoryUsedBytes, MemoryTotalBytes, DiskUtilizationPct, NetworkInBytesSec) with a composite index on (ServerId, Timestamp DESC).
- Create a high-performance Minimal API endpoint: `POST /api/metrics`.
- The endpoint must accept a `MetricPacket`, save it to the database asynchronously, and update the corresponding Server's `LastHeartbeatAt` timestamp.
- Add an Alerting Engine Stub: If `CpuUsagePct > 90.0`, log a critical warning to the console simulating an alert dispatch (e.g., "ALERT: Server [Id] CPU is critically high!").

Provide the full file structures, the .csproj configurations, and clear instructions on how to run database migrations. Keep the code optimized, scannable, clean, and modern.

```

---

### What this prompt guarantees you will get back:

1. **Easy cross-platform agent installation:** The Go collector compiles into native binaries for Windows, Linux, and macOS without requiring a runtime on monitored servers.
2. **High performance backend:** Minimal APIs combined with indexed PostgreSQL tables ensure your backend can handle thousands of inbound metric snapshots seamlessly.
3. **Foundation for expansion:** The console logging stub gives you the exact place to hook up your future alerting integrations (like Telegram, Slack, or email notifications).
