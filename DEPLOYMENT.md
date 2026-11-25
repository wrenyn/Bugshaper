# Running Bugshaper

Bugshaper is a React website served by the Node.js `backend` package. **PostgreSQL** stores accounts, sessions, workspace data, report evidence, and subscription state. Media defaults to disk (`BUGSHAPER_MEDIA_DIR`).

## Docker (root compose)

```text
cp backend/.env.production.example backend/.env.production
# Set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET and BUGSHAPER_ORIGIN
docker compose up -d --build
```

Services:

| Service | Port | Role |
| --- | --- | --- |
| `postgres` | 5432 | PostgreSQL |
| `website` | 8080 | Static marketing/app build (nginx) |
| `backend` | 4318 | API + workspace app |

Confirm `http://localhost:4318/healthz` and `http://localhost:8080/`.

Google OAuth redirect: `https://your-domain.example/auth/google/callback`  
Dodo webhooks (optional): `/api/webhooks/dodo`  
Plans: `backend/helpers/plans.js`

## Environment

Required:

- `DATABASE_URL` — Postgres connection string
- `BUGSHAPER_ORIGIN` — HTTPS origin in production
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — production auth

Optional: Dodo billing, Resend invitations, `BUGSHAPER_MEDIA_DIR`, S3 (`BUGSHAPER_S3_*`).

Validate: `cd backend && npm run deploy:check`

## Layout

- Root `docker-compose.yml` — postgres + website + backend
- `website/` — React app + marketing; nginx Dockerfile
- `backend/` — API (`start.mjs`, controllers, models, `db/` migrations)
- `extension/`, `cli/` — each with a root Dockerfile

`backend/db/` holds `schema.sql` and SQL migrations (applied at boot).
