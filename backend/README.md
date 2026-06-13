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

## Verify

```sh
dotnet test NetraScope.slnx
```
