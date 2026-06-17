# NetraScope Backend

The backend is a .NET 10 Minimal API that accepts agent metrics and stores them
in PostgreSQL.

## PostgreSQL

Create a database and user, then set the connection string through an
environment variable:

```sh
export ConnectionStrings__NetraScope='Host=localhost;Port=5432;Database=netrascope;Username=postgres;Password=password'
```

Do not use the example password from `appsettings.json` in production.

## Database Migrations

Restore the local EF Core tool and apply migrations:

```sh
dotnet tool restore
dotnet ef database update \
  --project backend/src/NetraScope.Core \
  --startup-project backend/src/NetraScope.Core
```

Create future migrations with:

```sh
dotnet ef migrations add MigrationName \
  --project backend/src/NetraScope.Core \
  --startup-project backend/src/NetraScope.Core \
  --output-dir Data/Migrations
```

## Run

```sh
dotnet run --project backend/src/NetraScope.Core
```

The local ingestion endpoint is `http://localhost:5050/api/metrics`.

## Authentication

The dashboard API (`/api/servers/*`, including server metric history) requires
a JWT bearer token. Anyone can self-register an account and sign in:

```sh
# Register an account
curl -X POST http://localhost:5050/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"change-me-now"}'

# Sign in to get a token
curl -X POST http://localhost:5050/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"change-me-now"}'
```

Use the returned `token` as a bearer token:

```sh
curl http://localhost:5050/api/servers \
  -H 'Authorization: Bearer YOUR_JWT'
```

Registration is open to anyone. Servers and metrics are scoped per user (see
below) — each account only sees the servers reporting with its own ingestion
token.

Set a strong, random signing secret in production via:

```sh
export Auth__Jwt__Secret='a-long-random-secret-at-least-32-characters'
```

### Agent ingestion token

Every user has their own ingestion token, generated automatically at
registration. `POST /api/metrics` always requires this token as a bearer
token — requests without a valid token are rejected with `401 Unauthorized`.
Servers reporting metrics with a given token are owned by that user and only
appear in that user's dashboard.

Fetch your token (and view it in the dashboard's Settings page):

```sh
curl http://localhost:5050/api/auth/me \
  -H 'Authorization: Bearer YOUR_JWT'
```

Configure each agent with this value as the `-token` flag (or
`NETRASCOPE_TOKEN` environment variable):

```sh
curl -X POST http://localhost:5050/api/metrics \
  -H 'Authorization: Bearer YOUR_INGESTION_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"serverId":"web-01", ...}'
```

If a token is compromised, rotate it (this invalidates the old token
immediately):

```sh
curl -X POST http://localhost:5050/api/auth/token/regenerate \
  -H 'Authorization: Bearer YOUR_JWT'
```

### Server-scoped agent tokens

For production agents, prefer per-server tokens. They are stored as SHA-256
hashes, can be rotated or revoked independently, and can optionally be restricted
to exact source IP addresses.

```sh
# Create a token for one server.
curl -X POST http://localhost:5050/api/servers/web-01/tokens \
  -H 'Authorization: Bearer YOUR_JWT' \
  -H 'Content-Type: application/json' \
  -d '{"name":"web-01 primary","allowedIpAddresses":["203.0.113.10"]}'

# List token metadata. Full token values are only returned on create/rotate.
curl http://localhost:5050/api/servers/web-01/tokens \
  -H 'Authorization: Bearer YOUR_JWT'

# Rotate or revoke one server token.
curl -X POST http://localhost:5050/api/servers/web-01/tokens/TOKEN_ID/rotate \
  -H 'Authorization: Bearer YOUR_JWT'
curl -X DELETE http://localhost:5050/api/servers/web-01/tokens/TOKEN_ID \
  -H 'Authorization: Bearer YOUR_JWT'
```

When a server token is used, submitted metric packets must match that token's
server ID.

## Audit Log

Authenticated users can review recent security events:

```sh
curl http://localhost:5050/api/audit-logs \
  -H 'Authorization: Bearer YOUR_JWT'
```

Events include registration, login success/failure, account token rotation,
server token create/update/rotate/revoke, tag changes, and server deletion.

## Server Tags

Tags are managed by the backend and are not sent by agents with every metric.
Tag names are trimmed, converted to lowercase, deduplicated, and limited to 20
tags per server.

```sh
# Replace all tags assigned to a server
curl -X PUT http://localhost:5050/api/servers/server-01/tags \
  -H 'Content-Type: application/json' \
  -d '{"tags":["production","linux","database"]}'

# Read a server's tags
curl http://localhost:5050/api/servers/server-01/tags

# List servers with a specific tag
curl 'http://localhost:5050/api/servers?tag=production'
```

Send an empty array to remove all tags from a server.

## Alerting

The backend stores alert events in `alert_events` and exposes them through:

```sh
curl 'http://localhost:5050/api/alerts?status=active' \
  -H 'Authorization: Bearer YOUR_JWT'
```

Built-in rules are enabled by default:

- `cpu_high_5m`: CPU above 90% for 5 minutes.
- `memory_high`: memory above 90%.
- `disk_high`: disk above 85%.
- `server_offline`: no heartbeat for 2 minutes.

Tune thresholds with configuration keys under `Alerting`, for example:

```sh
export Alerting__CpuThresholdPct=95
export Alerting__CpuSustainedMinutes=10
export Alerting__MemoryThresholdPct=90
export Alerting__DiskThresholdPct=85
export Alerting__OfflineMinutes=2
```

Configure notification targets with:

```sh
export Alerting__WebhookUrls__0='https://example.com/netrascope-alerts'
export Alerting__EmailWebhookUrl='https://example.com/email-relay'
export Alerting__DiscordWebhookUrl='https://discord.com/api/webhooks/...'
export Alerting__SlackWebhookUrl='https://hooks.slack.com/services/...'
export Alerting__TelegramBotToken='123456:bot-token'
export Alerting__TelegramChatId='123456789'
```

If no target is configured, alerts are still stored and written to the backend
log.

## Delete a Server

Authenticated users can permanently delete a server they own. This removes
its metric history and tag assignments:

```sh
curl -X DELETE http://localhost:5050/api/servers/server-01 \
  -H 'Authorization: Bearer YOUR_JWT'
```

Stop or uninstall the agent first. A running agent will recreate the server
when it sends its next metric.

## Verify

```sh
dotnet test NetraScope.slnx
```
