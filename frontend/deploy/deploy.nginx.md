# Deploy the NetraScope frontend with nginx

Full setup for building the React dashboard and serving it as a static SPA
behind nginx, with nginx reverse-proxying `/api` to the backend (the IIS .NET
API or the Cloudflare Worker).

```text
Browser ──HTTPS──► nginx (this guide)
                     ├── /            static SPA (frontend/dist)
                     └── /api, /downloads, /health  ──►  backend
```

> The dashboard is a **static bundle**. `VITE_API_BASE_URL` is baked in **at
> build time**, so you rebuild (not just restart) to change the API target.

---

## 1. Build the dashboard

On a machine with Node 22+:

```sh
cd frontend
npm ci
```

Choose how the SPA reaches the API:

- **Same-origin (recommended)** — nginx serves the SPA *and* proxies `/api` on
  the same hostname. Leave the base URL empty so the app uses relative paths:
  ```sh
  VITE_API_BASE_URL="" npm run build
  ```
- **Separate API hostname** — point directly at the API origin:
  ```sh
  VITE_API_BASE_URL="https://api.example.com" npm run build
  ```
  This requires the backend's CORS allow-list to include the dashboard origin
  (`AllowedHosts` on IIS, `FRONTEND_ORIGIN` on the Worker).

The build output is `frontend/dist/`.

---

## 2. Install on the server

```sh
sudo mkdir -p /var/www/netrascope
sudo cp -r frontend/dist/* /var/www/netrascope/
```

A starter site config lives at
[`frontend/deploy/nginx.conf`](nginx.conf). Install it and edit the marked
placeholders:

```sh
sudo cp frontend/deploy/nginx.conf /etc/nginx/sites-available/netrascope
sudo ln -s /etc/nginx/sites-available/netrascope /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Set `root` to `/var/www/netrascope` and replace `BACKEND_HOST:BACKEND_PORT`
with your backend's address (e.g. an IIS box at `192.168.1.50:5050`, or a
Worker via a Cloudflare Tunnel — see `cloudflared-config.yml`).

---

## 3. Recommended production server block

Use this hardened config (TLS + SPA fallback + API proxy + security headers).
Replace `netrascope.example.com`, the cert paths, and the backend address.

```nginx
# Redirect HTTP to HTTPS.
server {
    listen 80;
    server_name netrascope.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    http2 on;
    server_name netrascope.example.com;

    ssl_certificate     /etc/letsencrypt/live/netrascope.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/netrascope.example.com/privkey.pem;

    server_tokens off;
    root /var/www/netrascope;
    index index.html;

    # Security headers (applied to every response, including errors).
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'" always;

    # Cache hashed assets aggressively; never cache index.html.
    location /assets/ {
        try_files $uri =404;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Static SPA — fall back to index.html for client-side routing.
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Dashboard API + metrics ingestion.
    location /api/ {
        proxy_pass http://BACKEND_HOST:BACKEND_PORT;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Agent binary downloads.
    location /downloads/ {
        proxy_pass http://BACKEND_HOST:BACKEND_PORT;
        proxy_set_header Host $host;
    }

    location /health {
        proxy_pass http://BACKEND_HOST:BACKEND_PORT;
        proxy_set_header Host $host;
    }
}
```

> The `connect-src 'self'` CSP assumes same-origin API calls (empty
> `VITE_API_BASE_URL`). If the SPA calls a different API hostname, add it:
> `connect-src 'self' https://api.example.com`.

Get a TLS certificate with Certbot:

```sh
sudo certbot --nginx -d netrascope.example.com
```

---

## 4. Verify

```sh
curl -I https://netrascope.example.com           # 200, security headers present
curl    https://netrascope.example.com/health    # {"status":"ok"} (proxied to backend)
```

Open the site, register/sign in, and confirm the server list loads (the
Network tab should show `/api/...` calls returning 200).

---

## 5. Updating the dashboard

```sh
cd frontend && npm ci && VITE_API_BASE_URL="" npm run build
sudo rsync -a --delete frontend/dist/ /var/www/netrascope/
```

No nginx reload is needed for content-only updates (only when you change the
config). Because asset filenames are content-hashed, returning users pick up
the new bundle as soon as `index.html` is refreshed.

---

## Troubleshooting

- **Blank page / 404 on refresh of a sub-route** — the `try_files ... /index.html`
  fallback is missing; client-side routes need it.
- **API calls 404 or CORS-blocked** — if you built with an absolute
  `VITE_API_BASE_URL`, the backend must allow that origin; prefer same-origin
  (empty base URL) so everything is served from one host.
- **Mixed-content warnings** — serve the SPA over HTTPS and proxy to the
  backend server-side; don't point the browser at a plain-HTTP API.
- **Stale UI after deploy** — ensure `index.html` isn't being cached (the block
  above only long-caches `/assets/`).
