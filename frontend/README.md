# NetraScope Dashboard

Web dashboard for the NetraScope server-monitoring system. Built with
React, Vite, TypeScript, Tailwind CSS, and shadcn/ui.

## Features

- Live server list with status (online / stale / offline), search, and tag
  filtering.
- Server detail page with CPU, memory, disk, and network usage cards plus
  history charts (15m / 1h / 6h / 24h).
- Tag management (add/remove tags per server).
- Light, dark, and system theme support (defaults to your OS preference,
  toggle in the header).
- Auto-refreshes every 15 seconds via React Query.

## Getting started

```bash
npm install
cp .env.example .env
npm run dev
```

The app runs at `http://localhost:5173`.

`.env` sets `VITE_API_BASE_URL`, which should point at the NetraScope
backend API (defaults to `http://localhost:5050`).

## Backend requirements

The backend (`backend/src/NetraScope.Core`) must be running and reachable at
the URL configured in `VITE_API_BASE_URL`:

```bash
dotnet run --project backend/src/NetraScope.Core --urls http://localhost:5050
```

For local development, the backend must also allow cross-origin requests
from the frontend's origin. This is configured via `Cors:AllowedOrigins` in
`backend/src/NetraScope.Core/appsettings.json`, which already includes
`http://localhost:5173` by default.

## Authentication

The dashboard requires signing in. Visiting any route while signed out
redirects to `/login`. Anyone can self-register a new account from the
`/register` page; registering signs you in immediately.

The JWT returned on login or registration is stored in `localStorage` and
attached as an `Authorization: Bearer` header to all API requests
(`src/lib/api.ts`). A 401 response clears the session and redirects back to
`/login`.

## Scripts

- `npm run dev` — start the Vite dev server.
- `npm run build` — type-check and build for production.
- `npm run lint` — run ESLint.
- `npm run preview` — preview the production build locally.
