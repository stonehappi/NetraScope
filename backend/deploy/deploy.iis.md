# Deploy the NetraScope backend to IIS

Full setup for hosting the **.NET 10 ASP.NET Core API** (`NetraScope.Core`) on
Windows Server / IIS, backed by PostgreSQL. This is the production counterpart
to running the API locally with `dotnet run`.

```text
Go agents ──HTTPS──┐
                   ▼
        IIS (this guide)  ──►  PostgreSQL
                   ▲
React dashboard ───┘   (served by nginx — see frontend/deploy/deploy.nginx.md)
```

---

## 1. Prerequisites on the IIS server

1. **.NET 10 Hosting Bundle** — installs the ASP.NET Core Runtime **and** the
   IIS **ASP.NET Core Module V2** (ANCM).
   Download: <https://dotnet.microsoft.com/download/dotnet/10.0> → *Hosting Bundle*.
   After installing run an IIS refresh so the module loads:
   ```powershell
   net stop was /y
   net start w3svc
   ```
2. **IIS** with the **Web Server (IIS)** role plus the **Static Content** and
   **WebSocket** features.
3. **PostgreSQL 16** reachable from the IIS server (open TCP 5432 in the DB
   host firewall / `pg_hba.conf` for the IIS server's IP).
4. A **TLS certificate** for the API hostname (e.g. `api.example.com`). Never
   expose the API over plain HTTP — agents send ingestion tokens on every request.

---

## 2. Prepare the production database

On the PostgreSQL server, create the database and a dedicated least-privilege role:

```sql
CREATE DATABASE netrascope;
CREATE USER netrascope WITH PASSWORD 'USE_A_LONG_RANDOM_PASSWORD';
GRANT ALL PRIVILEGES ON DATABASE netrascope TO netrascope;
```

The schema is created by EF Core migrations in step 5 — don't hand-create tables.

---

## 3. Publish the app

From the repo root on your dev machine or a build agent:

```powershell
.\backend\deploy\publish.ps1 -OutDir publish
```

This runs `dotnet publish -c Release` and copies
[`web.config`](web.config) into the output. Flags:

- `-Runtime win-x64` (default) or `win-arm64` — match the server CPU.
- `-SelfContained` — bundle the runtime (server then needs only the ANCM, not
  the full runtime). Omit for a smaller framework-dependent build.

Copy the contents of `publish\` to the site's physical path, e.g.
`C:\inetpub\netrascope\`.

---

## 4. Configure the IIS site

1. **Application Pool**
   - .NET CLR version: **No Managed Code**
   - Start mode: **AlwaysRunning**
2. **Site / Application**
   - Physical path: `C:\inetpub\netrascope`
   - App pool: the one above
   - HTTPS binding with your TLS certificate, e.g. `https://api.example.com`
3. **Permissions** — grant `IIS AppPool\<poolname>` **read & execute** on the
   site folder, and **write** on the `logs` subfolder if `stdoutLogEnabled="true"`.

### Configuration / secrets

All settings come from environment variables (double-underscore = nested key).
Set them in the `<environmentVariables>` block of [`web.config`](web.config)
**or** in an `appsettings.Production.json` placed next to `NetraScope.Core.dll`.

| Variable | Required | Purpose |
| --- | --- | --- |
| `ASPNETCORE_ENVIRONMENT` | yes | Must be `Production` (set in `web.config`). |
| `ConnectionStrings__NetraScope` | yes | PostgreSQL connection string. |
| `Auth__Jwt__Secret` | **yes** | Long random secret (32+ chars). **The app issues and validates session tokens with this — anyone who knows it can forge logins.** |
| `Cors__AllowedOrigins` | yes | Frontend origin(s) for CORS, comma-separated, e.g. `https://netrascope.example.com` (scheme + host, no trailing slash). `*` allows any origin. |
| `AllowedHosts` | no | ASP.NET Core **Host Filtering** — leave `*` (default) unless restricting to the API's own hostname (bare host, no scheme). **Do not put the frontend origin here** — a scheme-qualified value causes `400 Bad Request`. |
| `Auth__Jwt__ExpiryMinutes` | no | Session lifetime, default `60`. |
| `Auth__AllowRegistration` | no | `false` disables public sign-up (recommended for private deployments). Default `true`. |
| `Auth__RateLimit__PermitLimit` | no | Login/register attempts allowed per IP per window. Default `10`. |
| `Auth__RateLimit__WindowSeconds` | no | Rate-limit window. Default `60`. |

Generate a strong JWT secret:

```powershell
[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Max 256 }))
```

Example `web.config` block (edit the copied file in the publish output):

```xml
<environmentVariables>
  <environmentVariable name="ASPNETCORE_ENVIRONMENT" value="Production" />
  <environmentVariable name="ConnectionStrings__NetraScope"
      value="Host=DB_HOST;Port=5432;Database=netrascope;Username=netrascope;Password=DB_PASSWORD" />
  <environmentVariable name="Auth__Jwt__Secret" value="REPLACE_WITH_A_LONG_RANDOM_SECRET" />
  <environmentVariable name="Cors__AllowedOrigins" value="https://netrascope.example.com" />
  <environmentVariable name="AllowedHosts" value="*" />
  <environmentVariable name="Auth__AllowRegistration" value="false" />
</environmentVariables>
```

> Recycle the app pool after editing config: `Restart-WebAppPool -Name "<poolname>"`.
> Keep secrets out of source control — edit them only on the server, or use IIS
> **Configuration Editor** → `system.webServer/aspNetCore`.

---

## 5. Apply EF Core migrations

Run from any machine with `dotnet` and network access to the production DB
(your workstation works — it does not have to be the IIS box):

```powershell
$env:ConnectionStrings__NetraScope = "Host=DB_HOST;Port=5432;Database=netrascope;Username=netrascope;Password=DB_PASSWORD"

dotnet tool restore
dotnet ef database update `
  --project backend/src/NetraScope.Core `
  --startup-project backend/src/NetraScope.Core
```

Re-run this step whenever a release adds new migrations.

---

## 6. Verify

```powershell
curl https://api.example.com/health
# -> {"status":"ok"}

# Create the first account (do this before setting Auth__AllowRegistration=false)
curl -X POST https://api.example.com/api/auth/register `
  -H "Content-Type: application/json" `
  -d '{"username":"admin","password":"a-strong-password"}'
```

Copy the ingestion token from the dashboard **Settings** page and point an
agent at `https://api.example.com/api/metrics`.

---

## 7. Connect agents

```powershell
.\netrascope-agent.exe -service install `
  -server-url https://api.example.com/api/metrics `
  -token YOUR_INGESTION_TOKEN
```

The API serves agent binaries from `wwwroot/downloads/` (proxied at
`/downloads/`); place only intended release binaries there.

---

## Operations

- **Lock down registration**: after creating accounts, set
  `Auth__AllowRegistration=false` and recycle the pool. New sign-ups then return
  `403`.
- **Rotate the JWT secret**: change `Auth__Jwt__Secret` and recycle — this logs
  everyone out and invalidates any previously issued/forged tokens.
- **Retention**: each server writes ~8,640 metric rows/day at the 10s default.
  Schedule a cleanup/aggregation job on the `PerformanceMetrics` table.
- **Backups**: `pg_dump` the `netrascope` database on a schedule.

## Troubleshooting

- **HTTP 502.5 / Process Failure** — read `<site>\logs\stdout_*.log` (folder
  must exist + be writable) or Event Viewer → Application → *IIS AspNetCore
  Module V2*.
- **"Connection string 'NetraScope' is required"** — `ConnectionStrings__NetraScope`
  not set, or `ASPNETCORE_ENVIRONMENT` isn't `Production`.
- **DB refused/timeout** — `Test-NetConnection DB_HOST -Port 5432`; check
  `pg_hba.conf` allows the IIS server.
- **`400 Bad Request` on every request** — `AllowedHosts` is set to a
  scheme-qualified value (e.g. an origin). Set it to `*` and put the frontend
  origin in `Cors__AllowedOrigins` instead. (Can also be an IIS **site binding**
  whose host name doesn't match the URL you're requesting — see below.)
- **`Bad Request - Invalid Hostname` (IIS error page)** — the IIS site binding's
  *Host name* doesn't match the URL. In IIS Manager → site → **Bindings**, either
  clear the host name (listen on all) or set it to the hostname you browse to.
- **CORS error in browser** — `Cors__AllowedOrigins` must equal the frontend
  origin exactly (scheme + host, no trailing slash); comma-separate multiples.
- **HTTP 429 on login** — rate limit hit; raise `Auth__RateLimit__PermitLimit`
  or wait out the window.

## Updating

1. Re-run `publish.ps1`.
2. `Stop-WebAppPool -Name "<poolname>"` (releases the locked `.dll`).
3. Copy new `publish\` contents over the site (preserve your edited
   `web.config` / `appsettings.Production.json`).
4. `Start-WebAppPool -Name "<poolname>"`.
5. Re-run `dotnet ef database update` if there are new migrations.
