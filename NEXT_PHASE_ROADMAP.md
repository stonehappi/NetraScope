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

## 4. Dashboard Upgrade

Add a dedicated alert and server organization experience.

Useful UI features:

- Sort and filter by status, tag, CPU, memory, or disk.
- Server groups or environments such as production, staging, and dev.
- Timeline events for agent install, offline, recovery, token changes, and deletion.
- Better onboarding and empty states.

## 5. Agent Configuration Profiles

Let the dashboard generate a config file instead of requiring every flag manually.

Example config:

```toml
server_url = "https://api.example.com/api/metrics"
token = "..."
interval = "10s"
server_id = "web-01"
```

Example install command:

```bash
netrascope-agent -config /etc/netrascope/agent.toml
```

## 6. Security Hardening

Recommended upgrades:

- Token rotation per server, not only per user.
- Revoke individual agent tokens.
- Audit logs for auth, token, server deletion, and configuration changes.
- Rate limits on auth and metric ingestion endpoints.
- Optional IP allowlist per token.

## 7. Historical Storage Strategy

Metrics can grow quickly. Add retention and rollups.

Suggested policy:

- Raw metrics: 7 or 30 days.
- 5-minute rollups: 90 days.
- Hourly rollups: 1 year.

This keeps storage cost under control and makes charts faster.

## 8. Public Deployment Path

Create one recommended production deployment path.

Suggested stack:

- Frontend on Cloudflare Pages.
- Backend on Cloudflare Workers plus D1 or Supabase.
- Agent binaries on GitHub Releases.
- One clear production setup guide.
