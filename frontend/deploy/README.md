# Deploying the frontend with nginx + a tunnel

This guide covers serving the built React SPA with **nginx**, reverse-proxying
API calls to the **.NET backend on your local network** (e.g. an IIS server —
see [`backend/deploy/README.md`](../../backend/deploy/README.md)), and
exposing the whole thing to the internet via a **tunnel** (Cloudflare Tunnel
or ngrok) — no router port-forwarding or public IP required.

```
Internet ──tunnel──> nginx (this machine, :80)
                        ├── /            -> frontend/dist (static SPA)
                        └── /api, /downloads, /health -> http://BACKEND_HOST:PORT (LAN)
```

## 1. Build the frontend

The SPA should call the API via **relative paths** so the browser talks to
nginx (same origin) and nginx forwards to the backend — this avoids CORS
entirely.

```sh
cd frontend
cp .env.example .env   # leave VITE_API_BASE_URL empty
npm ci
npm run build
```

Output goes to `frontend/dist/`.

## 2. Install nginx and the site config

On the machine that will host the SPA (any box on your LAN with nginx
installed — Linux, or `nginx` on Windows/macOS):

```sh
sudo cp -r dist /var/www/netrascope
sudo cp frontend/deploy/nginx.conf /etc/nginx/sites-available/netrascope
sudo ln -s /etc/nginx/sites-available/netrascope /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default   # avoid a conflicting default server
```

Edit `/etc/nginx/sites-available/netrascope` and replace:

- `root /var/www/netrascope;` — path where you copied `dist/`.
- `BACKEND_HOST:BACKEND_PORT` (3 occurrences) — your backend's **LAN address**,
  e.g. `192.168.1.50:5050` (`dotnet run` default) or `192.168.1.50:80` (IIS).

```sh
sudo nginx -t && sudo systemctl reload nginx
```

Verify locally: `curl http://localhost/health` should return `{"status":"ok"}`.

## 3. Backend configuration

The backend's `AllowedHosts` / CORS setting must include the **public**
hostname you'll use (from step 4), even though browsers see nginx as the
same origin — the backend still checks the `Origin` header on cross-site
requests if you ever bypass the proxy. Set it to your tunnel hostname:

```
AllowedHosts=https://netrascope.example.com
```

(See `backend/deploy/README.md` for where to set this — `web.config`
environment variables if on IIS, or `ConnectionStrings__*`-style env vars
elsewhere.)

Make sure the backend is reachable from the nginx machine:

```sh
curl http://BACKEND_HOST:BACKEND_PORT/health
```

## 4. Expose nginx to the internet via a tunnel

### Option A — Cloudflare Tunnel (recommended)

Requires a domain on Cloudflare (free plan is fine).

```sh
# Install cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
cloudflared tunnel login
cloudflared tunnel create netrascope
cloudflared tunnel route dns netrascope netrascope.example.com
```

This creates `~/.cloudflared/<TUNNEL_ID>.json` and prints the tunnel ID.
Copy [`cloudflared-config.yml`](cloudflared-config.yml) into place and fill
in the tunnel ID and hostname:

```sh
sudo mkdir -p /etc/cloudflared
sudo cp ~/.cloudflared/<TUNNEL_ID>.json /etc/cloudflared/
sudo cp frontend/deploy/cloudflared-config.yml /etc/cloudflared/config.yml
# edit /etc/cloudflared/config.yml: set tunnel, credentials-file, hostname

sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

Your site is now live at `https://netrascope.example.com` — Cloudflare
terminates TLS for you, so nginx only needs to listen on plain HTTP locally.

### Option B — ngrok (quick test, temporary URL)

```sh
ngrok http 80
```

Use the printed `https://xxxx.ngrok-free.app` URL. Update the backend's
`AllowedHosts` to match it. Note the URL changes on every restart unless you
have a paid ngrok plan with a reserved domain.

## 5. Verify end to end

From outside your network (phone on mobile data, etc.):

```
https://netrascope.example.com/health   -> {"status":"ok"}
https://netrascope.example.com          -> dashboard loads
```

Register/login and confirm `/api/auth/*` calls succeed (open browser dev
tools → Network tab to confirm requests go to `/api/...` relative paths, not
`localhost`).

## Troubleshooting

- **502 from nginx**: backend unreachable — check `BACKEND_HOST:BACKEND_PORT`
  is correct and reachable from the nginx machine (`curl` test in step 3),
  and that the backend's firewall allows connections from this machine's IP.
- **CORS error in browser**: the frontend is calling an absolute URL
  (`VITE_API_BASE_URL` was set at build time) instead of relative `/api/...`.
  Rebuild with it empty, or fix `AllowedHosts` on the backend to match the
  tunnel hostname.
- **Tunnel shows nginx default page / 404**: confirm
  `/etc/nginx/sites-enabled/default` is removed and the `netrascope` site is
  enabled, then `sudo systemctl reload nginx`.
- **SPA routes 404 on refresh**: confirm `try_files $uri $uri/ /index.html;`
  is present in the `location /` block.

## Updating

```sh
cd frontend && npm run build
sudo rsync -a --delete dist/ /var/www/netrascope/
```

No nginx or tunnel restart needed for static file updates.
