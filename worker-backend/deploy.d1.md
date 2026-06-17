# Deploy the NetraScope backend on Cloudflare Workers + D1

Full setup for the Worker-native backend using **Cloudflare D1** (serverless
SQLite). It implements the same API as the .NET backend, so the React
dashboard and Go agents work against it unchanged.

```text
Go agents ──HTTPS──┐
                   ▼
        Cloudflare Worker (this guide)  ──►  D1 (SQLite)
                   ▲
React dashboard ───┘
```

Config lives in [`wrangler.d1.jsonc`](wrangler.d1.jsonc); schema migrations are
stored in [`migrations/`](migrations/).

---

## 1. Prerequisites

- Node 22+ and a Cloudflare account.
- Authenticate Wrangler:
  ```sh
  cd worker-backend
  npm install
  npx wrangler login
  ```

---

## 2. Local development first (optional but recommended)

```sh
cp .dev.vars.d1.example .dev.vars          # set JWT_SECRET to 32+ random chars
npm run migrate:d1:local                   # create the local SQLite DB
npm run dev:d1                              # http://localhost:8787
```

Local D1 data persists under `.wrangler/`. Smoke-test it:

```sh
curl http://localhost:8787/health          # {"status":"ok"}
```

Point the frontend at it during dev with `VITE_API_BASE_URL=http://localhost:8787`.

---

## 3. Create the production D1 database

```sh
npx wrangler d1 create netrascope --location apac
```

Pick the `--location` hint closest to where most agents write (`apac` suits
Cambodia/SE-Asia). Copy the returned **database UUID** into `database_id` in
[`wrangler.d1.jsonc`](wrangler.d1.jsonc), replacing `REPLACE_WITH_D1_DATABASE_ID`.

---

## 4. Configure variables and secrets

Non-secret vars are in `wrangler.d1.jsonc` under `vars` — edit them before deploy:

| Var | Purpose |
| --- | --- |
| `FRONTEND_ORIGIN` | Comma-separated allowed CORS origins, e.g. `https://netrascope.example.com`. **Avoid `*` in production.** |
| `ALLOW_REGISTRATION` | `false` disables public sign-up (recommended once your accounts exist). Default `true`. |
| `JWT_ISSUER` / `JWT_AUDIENCE` | Token issuer/audience, default `NetraScope`. |
| `JWT_EXPIRY_MINUTES` | Session lifetime, default `60`. |
| `ALERT_*` | Built-in alert thresholds, offline window, and optional comma-separated webhook URLs. |

The signing secret is a **Wrangler secret**, never committed:

```sh
# Generate a strong value, then paste it when prompted:
openssl rand -base64 48
npx wrangler secret put JWT_SECRET --config wrangler.d1.jsonc
```

> `JWT_SECRET` is what signs and validates dashboard sessions. Treat it like a
> root credential — rotating it logs everyone out and invalidates any forged
> tokens.

---

## 5. Migrate and deploy

```sh
npm run migrate:d1:remote      # apply all pending D1 migrations
npm run check                  # type-check
npm run dry-run:d1             # validate the deploy without publishing
npm run deploy:d1              # publish the Worker
```

Deploy prints the Worker URL, e.g.
`https://netrascope-api-d1.YOUR_SUBDOMAIN.workers.dev`. (Optionally map a custom
domain/route in the Cloudflare dashboard.)

---

## 6. Verify

```sh
BASE=https://netrascope-api-d1.YOUR_SUBDOMAIN.workers.dev

curl $BASE/health
# -> {"status":"ok"}

# Create the first account BEFORE setting ALLOW_REGISTRATION=false:
curl -X POST $BASE/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"a-strong-password"}'
```

---

## 7. Connect the frontend and agents

Build the dashboard against the Worker URL (or proxy it same-origin — see
`frontend/deploy/deploy.nginx.md`) and make sure that origin is in
`FRONTEND_ORIGIN`:

```sh
VITE_API_BASE_URL=https://netrascope-api-d1.YOUR_SUBDOMAIN.workers.dev npm run build
```

Point each agent at the Worker's metrics endpoint with the token from the
dashboard **Settings** page:

```sh
./netrascope-agent -service install \
  -server-url https://netrascope-api-d1.YOUR_SUBDOMAIN.workers.dev/api/metrics \
  -token YOUR_INGESTION_TOKEN
```

---

## Operations

- **Lock down registration**: set `ALLOW_REGISTRATION=false` in
  `wrangler.d1.jsonc` and re-run `npm run deploy:d1`. Sign-up then returns `403`.
- **Logs**: `observability` is enabled in the config — view live logs with
  `npx wrangler tail --config wrangler.d1.jsonc`.
- **Inspect data**:
  ```sh
  npx wrangler d1 execute netrascope --remote --config wrangler.d1.jsonc \
    --command "SELECT COUNT(*) FROM performance_metrics;"
  ```
- **Retention**: each server writes ~8,640 rows/day at the 10s default. Schedule
  periodic cleanup, e.g. a Cron Trigger or a manual:
  ```sh
  npx wrangler d1 execute netrascope --remote --config wrangler.d1.jsonc \
    --command "DELETE FROM performance_metrics WHERE Timestamp < datetime('now','-30 days');"
  ```
- **New migrations**: drop a numbered `.sql` in `migrations/` and run
  `npm run migrate:d1:remote`.

## Troubleshooting

- **`database_id` errors on deploy** — the UUID in `wrangler.d1.jsonc` still
  says `REPLACE_WITH_D1_DATABASE_ID`; paste the value from `wrangler d1 create`.
- **401 on every dashboard call** — `JWT_SECRET` not set as a secret, or it
  differs from the value sessions were issued with (rotating it logs users out).
- **CORS blocked in browser** — add the exact dashboard origin to
  `FRONTEND_ORIGIN` (scheme + host, comma-separated for multiple).
- **`409 Conflict` on ingestion** — that server ID is already owned by another
  account; give the agent a distinct `NETRASCOPE_SERVER_ID`.

---

## Prefer PostgreSQL?

The same Worker can run on **Supabase (PostgreSQL)** via the Data REST API —
see [`README.md`](README.md) "Option B". Use D1 for a self-contained, low-config
deployment; use Supabase when you need PostgreSQL tooling or direct SQL access.
