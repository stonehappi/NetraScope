# NetraScope Cloudflare Worker Backend

This is a Worker-native replacement for the ASP.NET Core backend. It preserves
the current frontend and Go agent API routes and supports two storage options:

- **Cloudflare D1**: fully Cloudflare-hosted SQLite with an in-process binding.
- **Supabase**: PostgreSQL through the Supabase Data REST API.

D1 is the simpler deployment when you do not specifically need PostgreSQL.
The existing `backend/` project remains available for Docker or conventional
server hosting. It cannot run directly in the Cloudflare Workers runtime.

## Option A: Cloudflare D1

### Local development

Install dependencies and create a local secret file:

```sh
cd worker-backend
npm install
cp .dev.vars.d1.example .dev.vars
```

Initialize the local D1 database and start the Worker:

```sh
npm run migrate:d1:local
npm run dev:d1
```

Local D1 data is persisted under `.wrangler/`. The API is available at
`http://localhost:8787`.

### Production deployment

Create the database. `apac` is a sensible location hint for Cambodia; choose
the location closest to the majority of writes if your agents are elsewhere.

```sh
npx wrangler login
npx wrangler d1 create netrascope --location apac
```

Copy the returned database UUID into `database_id` in
`wrangler.d1.jsonc`. Then configure the Worker:

```sh
npx wrangler secret put JWT_SECRET --config wrangler.d1.jsonc
npm run migrate:d1:remote
npm run check
npm run dry-run:d1
npm run deploy:d1
```

The D1 migrations are stored in `migrations/`. Run migrations again after
pulling updates so the `alert_events` table is created.

## Option B: Supabase

### Prepare Supabase

Create a Supabase project, open **SQL Editor**, and run:

```text
worker-backend/supabase/schema.sql
```

The schema uses the same quoted table and column names as the existing Entity
Framework migrations. You can therefore point this Worker at a Supabase
database already initialized by the .NET backend.

Use a Supabase server-side secret key when available. A legacy `service_role`
key also works. Never expose either key to the frontend or agent.

### Local development

```sh
cd worker-backend
npm install
cp .dev.vars.example .dev.vars
```

Set the three values in `.dev.vars`, then run:

```sh
npm run dev
```

The API is available at `http://localhost:8787`. Test it with:

```sh
curl http://localhost:8787/health
```

Point the frontend at it:

```text
VITE_API_BASE_URL=http://localhost:8787
```

### Production deployment

Authenticate Wrangler:

```sh
npx wrangler login
```

Store production secrets interactively:

```sh
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put JWT_SECRET
```

Use a random `JWT_SECRET` of at least 32 characters. Set the production
frontend origin in `wrangler.jsonc`, then deploy:

```sh
npm run check
npm run dry-run
npm run deploy
```

## Connect the frontend and agent

After deployment, set the frontend's `VITE_API_BASE_URL` and each agent's
`NETRASCOPE_SERVER_URL` to the Worker URL:

```sh
export NETRASCOPE_SERVER_URL=https://netrascope-api.YOUR_SUBDOMAIN.workers.dev/api/metrics
export NETRASCOPE_TOKEN=TOKEN_FROM_THE_SETTINGS_PAGE
./netrascope-agent
```

Both storage backends expose the same API, so the frontend and agent do not
need backend-specific changes.

## Alerting

The Worker stores alert events and serves them at:

```sh
curl 'https://YOUR_WORKER/api/alerts?status=active' \
  -H 'Authorization: Bearer YOUR_JWT'
```

Rules are enabled by default:

- `cpu_high_5m`: CPU above 90% for 5 minutes.
- `memory_high`: memory above 90%.
- `disk_high`: disk above 85%.
- `server_offline`: no heartbeat for 2 minutes.

The scheduled Worker trigger in `wrangler.jsonc` checks for offline servers once
per minute. Thresholds can be changed with Worker variables:

```text
ALERTING_ENABLED=true
ALERT_CPU_THRESHOLD_PCT=90
ALERT_CPU_SUSTAINED_MINUTES=5
ALERT_MEMORY_THRESHOLD_PCT=90
ALERT_DISK_THRESHOLD_PCT=85
ALERT_OFFLINE_MINUTES=2
ALERT_WEBHOOK_URLS=https://example.com/one,https://example.com/two
```

Use Wrangler secrets for notification URLs and tokens:

```sh
wrangler secret put ALERT_EMAIL_WEBHOOK_URL
wrangler secret put ALERT_DISCORD_WEBHOOK_URL
wrangler secret put ALERT_SLACK_WEBHOOK_URL
wrangler secret put ALERT_TELEGRAM_BOT_TOKEN
wrangler secret put ALERT_TELEGRAM_CHAT_ID
```

## Security hardening

The Worker supports the same server-scoped token and audit APIs as the .NET
backend:

```sh
curl -X POST https://YOUR_WORKER/api/servers/web-01/tokens \
  -H 'Authorization: Bearer YOUR_JWT' \
  -H 'Content-Type: application/json' \
  -d '{"name":"web-01 primary","allowedIpAddresses":["203.0.113.10"]}'

curl https://YOUR_WORKER/api/audit-logs \
  -H 'Authorization: Bearer YOUR_JWT'
```

Server-scoped tokens are stored hashed, can be rotated or revoked individually,
and require matching `serverId` values when used for metric ingestion. Optional
IP allowlists use exact IP address matches. Authentication and metric ingestion
also have lightweight request throttling in the Worker isolate.

Authenticated users can delete servers they own with
`DELETE /api/servers/{serverId}`. Deletion also removes metric history and tag
assignments. Stop the agent first or its next metric will recreate the server.

## Storage choice

D1 removes the external database request and Supabase credentials. It is a
good default for a small or medium monitoring deployment. At the agent's
default 10-second interval, each server writes 8,640 metric rows per day, so
plan retention or aggregation before history grows indefinitely.

Supabase is preferable when you need PostgreSQL tooling, direct SQL access,
larger analytical workflows, or integration with other Supabase services.

Server IDs are globally unique with both schemas. Give agents distinct
`NETRASCOPE_SERVER_ID` values; ingestion returns `409 Conflict` instead of
moving a server between accounts when an ID is already owned.

## Existing Accounts

If existing user rows are imported, login supports ASP.NET Identity V3
password hashes from the current .NET backend. After a successful login, the
Worker transparently replaces the hash with its Web Crypto PBKDF2 format.
