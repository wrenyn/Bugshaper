# Bugshaper

Bugshaper is a team workspace for capturing, investigating, and resolving web application bugs. Packages are independent so each can live in its own repo.

## Packages

| Path | Role |
| --- | --- |
| `website/` | React app + marketing site |
| `backend/` | Node.js MVC server (PostgreSQL) |
| `extension/` | Capture-only Chrome extension |
| `cli/` | CLI and MCP client |

## Docker (recommended)

From the repo root, one compose file runs **Postgres**, **website** (nginx on `:8080`), and **backend** (API + app on `:4318`):

```text
cp backend/.env.production.example backend/.env.production   # fill Google OAuth, etc.
docker compose up -d --build
```

- Website: http://localhost:8080  
- Backend / app: http://localhost:4318  
- Postgres: `postgres://bugshaper:bugshaper@127.0.0.1:5432/bugshaper`

Set `DATABASE_URL` in `backend/.env.production` (Compose defaults to the `postgres` service).

## Local demo

```text
docker compose up -d postgres
cd website && npm install && npm run build
cd ../backend
# DATABASE_URL=postgres://bugshaper:bugshaper@127.0.0.1:5432/bugshaper_demo
npm run dev
```

Open `http://localhost:4318` → **Get started free → Explore the demo workspace**.

## Extension / CLI

```text
cd extension && npm run package
node backend/start.mjs
node cli/cli.mjs list
```

## Verification

Postgres must be running (`docker compose up -d postgres`). Tests use `bugshaper_test`.

```text
cd website && npm test
cd ../backend && npm test
cd ../cli && npm test
cd ../extension && npm test
```
