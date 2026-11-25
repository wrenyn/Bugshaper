# Bugshaper implementation tracker

## Status

In-repo product and deploy tooling target a single-node production launch on **PostgreSQL** via root `docker-compose.yml` (postgres + website + backend).

## Done

- Website workspace + marketing, platform API, Google auth, billing webhooks, quotas
- PostgreSQL data layer (`DATABASE_URL`, `pg` Pool, migrations) — no SQLite
- Extension capture with sign-in auto-resume, workspace/project upload, drafts retry
- Platform share links + in-app Share UI + `/share/:key` viewer
- Reports triage presets (Open / Unassigned / Assigned to me) with URL-synced filters
- Settings developer tools (MCP / CLI)
- Media: disk (`BUGSHAPER_MEDIA_DIR`) or S3-compatible (`BUGSHAPER_S3_*`); BYTEA fallback
- Root Docker Compose, Jenkins-capable backend image, smoke / deploy:check

## Operator-only (cannot finish without your accounts)

1. Fill `backend/.env.production` → `docker compose up -d --build` → confirm `/healthz`
2. Jenkins push with your registry credentials
3. Chrome Web Store upload of the packaged extension
4. Optional Dodo live billing + counsel-approved legal pages
5. Rotate Google client secret if it was exposed outside a private channel
