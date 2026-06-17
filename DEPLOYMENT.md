# NetraScope production deployment

This is the **one recommended production path** for NetraScope. It is fully
serverless, has no servers to patch, and scales to zero cost when idle:

```text
                       ┌────────────────────────────────────────┐
   Browser ──HTTPS──►  │  Cloudflare Pages  (React dashboard)     │
                       └───────────────────┬──────────────────────┘
                                           │  /api/* (HTTPS)
                                           ▼
   Go agents ──HTTPS──►  Cloudflare Worker  ─────►  D1 (serverless SQLite)
   (your servers)        (netrascope-api)
                                           ▲
                                           │  download binary + auto-update
                       ┌───────────────────┴──────────────────────┐
                       │  GitHub Releases  (agent binaries)        │
                       └────────────────────────────────────────────┘
```

| Layer | Platform | Why |
| --- | --- | --- |
| Dashboard | **Cloudflare Pages** | Static SPA on a global CDN, free tier, instant rollbacks. |
| Backend API | **Cloudflare Worker + D1** | Same API as the .NET backend, no database server to run. |
| Agents | **GitHub Releases** | Versioned, stable download URLs; powers `netrascope-agent -update`. |

> Prefer PostgreSQL, or already self-host? The Worker also runs on **Supabase**
> (see [worker-backend/README.md](worker-backend/README.md) "Option B"), and a
> Docker / nginx / IIS path exists (see [deploy/README.md](deploy/README.md)).
> This guide covers the recommended Cloudflare + D1 stack only.

## Prerequisites

- A **Cloudflare account** and **Node 22+**.
- A **GitHub repository** for this project (for agent releases).
- Wrangler authenticated once: `cd worker-backend && npm install && npx wrangler login`.

Pick names/URLs up front and reuse them throughout:

| Placeholder | Example |
| --- | --- |
| Worker URL | `https://netrascope-api-d1.YOUR_SUBDOMAIN.workers.dev` |
| Dashboard URL | `https://netrascope.pages.dev` (or a custom domain) |
| Repo slug | `stonehappi/NetraScope` |

---

## 1. Deploy the backend (Cloudflare Worker + D1)

The full reference with variables, secrets, and troubleshooting lives in
[worker-backend/deploy.d1.md](worker-backend/deploy.d1.md). The minimum path:

```sh
cd worker-backend
npm install

# Create the production database; copy the printed UUID into
# wrangler.d1.jsonc -> database_id (replace REPLACE_WITH_D1_DATABASE_ID).
npx wrangler d1 create netrascope --location apac

# Sign dashboard sessions with a strong secret (never committed):
openssl rand -base64 48
npx wrangler secret put JWT_SECRET --config wrangler.d1.jsonc

# Apply schema (includes metric_rollups) and deploy:
npm run migrate:d1:remote
npm run deploy:d1
```

Before deploying, set production values in `wrangler.d1.jsonc` → `vars`:

- `FRONTEND_ORIGIN` → your **Dashboard URL** (comma-separated for multiple).
  Avoid `*` in production.
- `ALLOW_REGISTRATION` → leave `true` for now; you lock it down in step 4.
- Retention defaults (`RAW_RETENTION_DAYS`, `ROLLUP_5M_RETENTION_DAYS`,
  `ROLLUP_1H_RETENTION_DAYS`) are already set; the scheduled trigger rolls up
  and prunes history automatically.

Deploy prints your **Worker URL**. Verify it:

```sh
curl https://netrascope-api-d1.YOUR_SUBDOMAIN.workers.dev/health   # {"status":"ok"}
```

---

## 2. Deploy the dashboard (Cloudflare Pages)

The dashboard is a static bundle and `VITE_API_BASE_URL` is baked in **at build
time**, so it must point at the Worker URL from step 1. A `_redirects` file
(`frontend/public/_redirects`) ships SPA fallback so deep links work.

### Option A — Connect the Git repo (recommended)

In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to
Git**, then set:

| Setting | Value |
| --- | --- |
| Framework preset | None / Vite |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | `frontend` |
| Environment variable | `VITE_API_BASE_URL` = your **Worker URL** |

Every push to the production branch builds and deploys automatically.

### Option B — Deploy from your machine

```sh
cd frontend
npm ci
VITE_API_BASE_URL=https://netrascope-api-d1.YOUR_SUBDOMAIN.workers.dev npm run build
npx wrangler pages deploy dist --project-name netrascope
```

### After the first deploy

1. Note the **Dashboard URL** Pages assigns (or attach a custom domain under
   **Pages → Custom domains**).
2. Make sure that exact origin is in the Worker's `FRONTEND_ORIGIN`, then
   re-run `npm run deploy:d1`. A mismatch shows up as CORS errors in the browser.

---

## 3. Publish agent binaries (GitHub Releases)

Pushing a `vX.Y.Z` tag triggers
[`.github/workflows/agent-release.yml`](.github/workflows/agent-release.yml),
which cross-compiles the Go agent for linux/darwin/windows (amd64 + arm64),
generates `checksums.txt`, and publishes a GitHub Release:

```sh
git tag v1.0.0
git push origin v1.0.0
```

This yields stable download URLs such as:

```text
https://github.com/stonehappi/NetraScope/releases/download/v1.0.0/netrascope-agent-linux-amd64
```

These same URLs back `netrascope-agent -update`. See
[agent/docs/USAGE.md](agent/docs/USAGE.md) for versioning and updates.

---

## 4. Create the first account, then lock down registration

Create your admin account **before** disabling registration:

```sh
BASE=https://netrascope-api-d1.YOUR_SUBDOMAIN.workers.dev
curl -X POST $BASE/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"a-strong-password"}'
```

Then set `ALLOW_REGISTRATION=false` in `wrangler.d1.jsonc` and re-run
`npm run deploy:d1`. Public sign-up now returns `403`.

---

## 5. Install agents on your servers

Download the binary for each server's OS/arch, then install it as a service
using the ingestion token from the dashboard **Settings** page:

```sh
curl -fsSL -o netrascope-agent \
  https://github.com/stonehappi/NetraScope/releases/download/v1.0.0/netrascope-agent-linux-amd64
chmod +x netrascope-agent

sudo ./netrascope-agent -service install \
  -server-url https://netrascope-api-d1.YOUR_SUBDOMAIN.workers.dev/api/metrics \
  -token YOUR_INGESTION_TOKEN
```

Give each agent a distinct `NETRASCOPE_SERVER_ID`; ingestion returns
`409 Conflict` if an ID is already owned by another account.

---

## 6. Verify end-to-end

1. Open the **Dashboard URL** and sign in as `admin`.
2. Within ~10s the server running the agent appears with live CPU/memory/disk.
3. Open a server and switch the history range to **7d** / **30d** — these read
   the 5-minute and hourly rollups created by the scheduled job.

---

## Operations

- **Backend update**: `git pull`, then `npm run deploy:d1` (run
  `npm run migrate:d1:remote` first if new migrations landed).
- **Dashboard update**: push to the production branch (Option A) or re-run the
  build + `wrangler pages deploy` (Option B).
- **New agent version**: bump and push a `vX.Y.Z` tag; servers pick it up with
  `netrascope-agent -update`.
- **Logs**: `npx wrangler tail --config wrangler.d1.jsonc`.
- **History retention** is automatic — see
  [worker-backend/README.md](worker-backend/README.md) "History retention and
  rollups" to tune the windows.
