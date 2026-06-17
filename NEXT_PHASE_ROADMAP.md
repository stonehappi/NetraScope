# NetraScope Next Phase Roadmap

## Recommended Priorities

The strongest next phase is:

1. Agent releases
2. Alerts
3. Per-server tokens

Together, these move NetraScope from a working monitor into something more useful for real operations.

## 1. Agent Releases

Move agent binaries out of `agent/dist` in the repo and publish them through GitHub Releases.

Benefits:

- Cleaner repository.
- Versioned downloads.
- Easier rollback.
- Stable download URLs such as:

```text
https://github.com/stonehappi/NetraScope/releases/download/v1.0.0/netrascope-agent-linux-amd64
```

The setup guide can point to the latest release or a pinned version.

## 2. Agent Auto-Update

Add simple version and update support to the agent.

Example commands:

```bash
netrascope-agent -version
netrascope-agent -update
```

This becomes important once many servers are running the agent.

## 3. Alerting

Add alert rules and notifications.

Start with simple rules:

- CPU above 90% for 5 minutes.
- Memory above 90%.
- Disk above 85%.
- Server offline for 2 minutes.

Notification targets can include:

- Email
- Telegram
- Discord
- Slack
- Webhooks

## 4. Dashboard Upgrade ✅ Implemented

A dedicated alert and server organization experience.

UI features:

- ✅ Sort and filter by status, tag, CPU, memory, or disk (dashboard).
- ✅ Server groups / environments such as production, staging, and dev.
- ✅ Timeline of activity per server — agent install (first metrics), offline,
  recovery, threshold alerts, and token changes — on the server detail page.
  A new `server.created` audit event records the agent's first connection;
  account-wide deletions remain in the Settings audit log.
- ✅ Onboarding card and empty states.

## 5. Agent Configuration Profiles ✅ Implemented

The agent reads a TOML config file via `-config` (or `NETRASCOPE_CONFIG`), and
the dashboard **Add server** guide generates one prefilled with the server URL
and token ("Download agent.toml").

```toml
server_url = "https://api.example.com/api/metrics"
token = "..."
interval = "10s"
server_id = "web-01"
```

```bash
netrascope-agent -config /etc/netrascope/agent.toml
```

Precedence is flag > environment variable > config file > built-in default, so a
shared base file can be tweaked per host. Unknown keys and invalid values fail
fast. See [agent/docs/USAGE.md](agent/docs/USAGE.md) "Config file".

## 6. Security Hardening

Recommended upgrades:

- Token rotation per server, not only per user.
- Revoke individual agent tokens.
- Audit logs for auth, token, server deletion, and configuration changes.
- Rate limits on auth and metric ingestion endpoints.
- Optional IP allowlist per token.

## 7. Historical Storage Strategy ✅ Implemented

Metrics can grow quickly, so both backends now roll raw samples into
downsampled aggregates and prune data past its retention window.

Active policy (configurable via environment variables):

- Raw metrics: 30 days (`RAW_RETENTION_DAYS`).
- 5-minute rollups: 90 days (`ROLLUP_5M_RETENTION_DAYS`).
- Hourly rollups: 1 year (`ROLLUP_1H_RETENTION_DAYS`).

A scheduled job recomputes rollups (every 5 minutes) and prunes expired data
(hourly). The history endpoint auto-selects resolution by requested window —
raw up to 24h, 5-minute rollups up to 7d, hourly rollups up to 365d — so charts
stay fast and keep working after raw data is pruned. The dashboard exposes new
7d and 30d ranges.

Implemented across the .NET backend (`metric_rollups` table +
`MetricMaintenanceWorker`), the Cloudflare Worker (D1 and Supabase storage +
scheduled trigger), and the frontend.

## 8. Public Deployment Path ✅ Implemented

One recommended production deployment path is documented end to end in
[DEPLOYMENT.md](DEPLOYMENT.md).

Stack:

- Frontend on Cloudflare Pages (SPA fallback via `frontend/public/_redirects`).
- Backend on Cloudflare Workers plus D1 (Supabase remains an option).
- Agent binaries on GitHub Releases (tag-triggered `agent-release.yml`).
- A single production setup guide covering backend, dashboard, agent releases,
  first-account lockdown, and verification.
