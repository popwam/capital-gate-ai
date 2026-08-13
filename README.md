# Maqar AI

Conversation-first real-estate platform for the Egyptian market.

- `apps/web` — Next.js customer experience and protected admin console
- `apps/api` — NestJS conversations, Gemini, verified search, imports, knowledge, storage and lead APIs
- `packages/database` — Prisma/PostgreSQL schema and committed migrations

## Local development

```bash
npm install
copy .env.example .env
npm run db:generate
npm run db:migrate:deploy
npm run dev:api
npm run dev:web
```

Set `AI_PROVIDER=demo` and `STORAGE_PROVIDER=local` only in development. The API intentionally refuses those providers in production.

## Production database

```bash
npm run db:generate
npm run db:migrate:deploy
```

Production deployments use `prisma migrate deploy`; `db push` is retained only as an explicit development utility.

## Railway

Use repository root `/` for both application services so the npm workspace and lockfile remain available.

### Web service

- Build: `npm run build -w @maqar/web`
- Start: `npm run start -w @maqar/web`
- Health check: `/`
- Variables: `NEXT_PUBLIC_API_URL`, `ADMIN_JWT_SECRET`

### API service

- Build: `npm run db:generate && npm run build -w @maqar/api`
- Pre-deploy: `npm run db:migrate:deploy`
- Start: `npm run start -w @maqar/api`
- Health check: `/v1/health`
- Attach `DATABASE_URL` using `${{Postgres.DATABASE_URL}}`
- Set all API variables documented in `.env.example`

The API must have a public HTTPS domain because customer chat streams directly from the browser. Set that URL in `NEXT_PUBLIC_API_URL`. Set `WEB_ORIGIN` to the exact web origin; comma-separated staging and production origins are supported. For sibling domains, set `ADMIN_COOKIE_DOMAIN` to their shared registrable domain (for example `.example.com`) and put the same `ADMIN_JWT_SECRET` on web and API services.

## First administrator

On an empty database, temporarily set `ADMIN_BOOTSTRAP_EMAIL` and a 12+ character `ADMIN_BOOTSTRAP_PASSWORD` on the API service. The API creates the first hashed `AdminUser` and writes an audit event. Remove both variables immediately after the successful boot.

## Smoke checks

```bash
npm run build
npm run test:smoke -w @maqar/api
SMOKE_API_URL=https://api.example.com npm run smoke:api
```

The live smoke command expects a running API and database. It creates and deletes an anonymous test conversation.
