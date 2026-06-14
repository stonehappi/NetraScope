# Deploying the backend to IIS

This guide covers publishing `NetraScope.Core` (the .NET 10 Minimal API) to a
Windows Server running IIS, and pointing it at a database that is different
from the one used in local/dev (e.g. a separate production PostgreSQL server,
on another host or a managed service).

## 1. Prerequisites (on the IIS server)

1. **.NET 10 Hosting Bundle** — installs the ASP.NET Core Runtime and the
   IIS **ASP.NET Core Module V2**.
   Download: https://dotnet.microsoft.com/download/dotnet/10.0
   (choose "Hosting Bundle" under ASP.NET Core Runtime).
   After installing, run `net stop was /y` then `net start w3svc` (or reboot)
   so IIS picks up the module.
2. **IIS** with the **Web Server (IIS)** role and **ASP.NET 4.8+** /
   **Static Content** features enabled.
3. Network access from the IIS server to the database server (correct
   firewall rules / security group on the DB host, port 5432 for
   PostgreSQL).

## 2. Publish the app

From the repo root (on your dev machine or a build agent):

```powershell
.\backend\deploy\publish.ps1 -OutDir publish
```

This runs `dotnet publish -c Release -r win-x64` and copies
[`web.config`](web.config) into the output folder. Options:

- `-Runtime win-x64` (default) or `win-arm64` — match the IIS server's CPU.
- `-SelfContained` — bundle the .NET runtime so the server doesn't need the
  Hosting Bundle's runtime (the module is still required). Omit for a smaller
  framework-dependent deploy.

Copy the contents of `publish/` to the IIS site's physical path, e.g.
`C:\inetpub\netrascope\`.

## 3. Create the IIS site

1. In **IIS Manager**, create an **Application Pool**:
   - .NET CLR version: **No Managed Code**
   - Start mode: **AlwaysRunning** (recommended)
2. Create a **Site** (or **Application** under an existing site):
   - Physical path: `C:\inetpub\netrascope`
   - Application pool: the one created above
   - Binding: e.g. `https://api.yourdomain.com` (use a real TLS cert)
3. Grant the app pool identity (`IIS AppPool\<poolname>`) **read & execute**
   permission on the physical path, and **write** permission on the `logs`
   folder if you keep `stdoutLogEnabled="true"`.

## 4. Point the app at the production database

The connection string comes from configuration key `ConnectionStrings:NetraScope`
(env var form: `ConnectionStrings__NetraScope`). Pick **one** of:

### Option A — `web.config` environment variables (simplest)

Edit the `<environmentVariables>` block in `web.config` (already copied to
the publish output):

```xml
<environmentVariable name="ConnectionStrings__NetraScope"
                      value="Host=DB_HOST;Port=5432;Database=netrascope;Username=DB_USER;Password=DB_PASSWORD" />
```

Replace `DB_HOST`, `DB_USER`, `DB_PASSWORD` with the **other database
server's** details. Use the same format for any PostgreSQL-compatible host
(self-hosted, RDS, Azure Database for PostgreSQL, etc.).

Also set a real `Auth__Jwt__Secret` and `AllowedHosts` (your frontend origin)
in the same block.

> Recycle the app pool after editing `web.config` for changes to take effect:
> `Restart-WebAppPool -Name "<poolname>"`

### Option B — `appsettings.Production.json`

Drop an `appsettings.Production.json` next to `NetraScope.Core.dll` (it's
loaded automatically when `ASPNETCORE_ENVIRONMENT=Production`, which
`web.config` sets):

```json
{
  "ConnectionStrings": {
    "NetraScope": "Host=DB_HOST;Port=5432;Database=netrascope;Username=DB_USER;Password=DB_PASSWORD"
  },
  "Auth": {
    "Jwt": { "Secret": "REPLACE_WITH_A_LONG_RANDOM_SECRET" }
  },
  "AllowedHosts": "https://YOUR_FRONTEND_ORIGIN"
}
```

Don't commit this file with real credentials — keep it only on the server, or
manage it via IIS's **Configuration Editor** (`system.webServer/aspNetCore` >
environment variables), which keeps secrets out of the published files.

## 5. Apply EF Core migrations to the new database

Run this from a machine with `dotnet` and network access to the production
database (your workstation or a build agent — not necessarily the IIS box):

```sh
export ConnectionStrings__NetraScope='Host=DB_HOST;Port=5432;Database=netrascope;Username=DB_USER;Password=DB_PASSWORD'

dotnet tool restore
dotnet ef database update \
  --project backend/src/NetraScope.Core \
  --startup-project backend/src/NetraScope.Core
```

On Windows/PowerShell, set the env var with:

```powershell
$env:ConnectionStrings__NetraScope = "Host=DB_HOST;Port=5432;Database=netrascope;Username=DB_USER;Password=DB_PASSWORD"
```

## 6. Verify

```
curl https://api.yourdomain.com/health
# -> {"status":"ok"}
```

Then register/login as in [backend/README.md](../README.md):

```sh
curl -X POST https://api.yourdomain.com/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"change-me-now"}'
```

## Troubleshooting

- **502.5 / Process Failure**: check `<site>/logs/stdout_*.log` (requires the
  `logs` folder to exist and the app pool identity to have write access), or
  Windows **Event Viewer** → Application log, source `IIS AspNetCore Module V2`.
- **"Connection string 'NetraScope' is required"**: `ConnectionStrings__NetraScope`
  isn't set — double-check `web.config`'s environment variables or
  `appsettings.Production.json`, and that `ASPNETCORE_ENVIRONMENT=Production`.
- **DB connection refused/timeout**: confirm the IIS server can reach the DB
  host/port (`Test-NetConnection DB_HOST -Port 5432`) and that the database's
  firewall/pg_hba.conf allows the IIS server's IP.
- **CORS errors in the browser**: `AllowedHosts` must match the frontend's
  exact origin (scheme + host, no trailing slash).

## Updating the deployment

1. Re-run `.\backend\deploy\publish.ps1 -OutDir publish`.
2. Stop the site / app pool (or it'll lock the `.dll`):
   `Stop-WebAppPool -Name "<poolname>"`
3. Copy the new `publish/` contents over the site folder (keep your edited
   `web.config` / `appsettings.Production.json`, or re-apply your env var
   edits to the freshly copied `web.config`).
4. `Start-WebAppPool -Name "<poolname>"`
5. Re-run step 5 (`dotnet ef database update`) if the update includes new
   migrations.
