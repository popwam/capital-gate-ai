# Maqar AI

Arabic-first, conversation-first real-estate search for the Egyptian market. PostgreSQL is the source of truth for inventory and the public experience remains anonymous.

## Architecture

- `apps/web` — Next.js customer chat and protected Admin console.
- `apps/api` — NestJS conversations, verified search, imports, knowledge, storage, maps, leads, and AI routing.
- `packages/database` — Prisma/PostgreSQL schema and forward-only migrations.
- Cloudflare Workers AI performs structured extraction; Groq writes and streams the primary customer response; OpenAI is invoked only as a failure/quality fallback.
- R2 stores source workbooks and approved project assets. Neon PostgreSQL stores all canonical facts and provenance.

## AI routing

Production uses `AI_PROVIDER=hybrid`:

1. Workers AI extracts validated intent, conversation state, import mappings, and document knowledge.
2. Application services query PostgreSQL and return verified facts.
3. Groq generates the customer answer and normalized stream.
4. Retryable Groq failure routes to OpenAI, then a compatible Workers model. Provider failure never creates inventory facts.

`AI_PROVIDER=demo` is development-only and the API refuses it in production.

## Data import lifecycle

`Upload → parse → R2 source → DataImport → known/remembered mapping → optional Workers suggestion → progressive questions → diff preview → transactional confirm → searchable inventory`

Each applied batch records per-unit before/after provenance. New versions reference the earlier completed batch. Missing rows remain unchanged unless an Admin explicitly selects unavailable or archive policy.

## Batch update and delete

- Update: select a completed batch, upload the new workbook, review new/changed/missing units, then confirm.
- Safe rollback: restores only units whose current values still match that batch’s applied snapshot.
- Exclusive delete: removes only units created by that batch when no later import, manual edit, or media attachment conflicts.
- Source-record deletion is refused after inventory provenance exists. All destructive operations require explicit confirmation and create an audit event.

## Admin routes

- `/admin` import assistant
- `/admin/data` batch history, updates, downloads, and rollback
- `/admin/inventory` searchable units, correction, and bulk status/archive actions
- `/admin/projects` developers, projects, and project knowledge
- `/admin/locations` hierarchy, aliases, coordinates, and verified distances
- `/admin/leads` and `/admin/conversations` internal CRM context
- `/admin/system` protected AI health and lightweight usage

## Customer flow

The browser creates a random anonymous device token. The API stores only its keyed hash. Multiple server-side conversations are supported. Messages use first-strong-character direction, while the page defaults to Arabic/RTL and Cairo. Media, brochures, and maps are returned only when requested.

## Environment

Copy `.env.example` and populate only the variables used by the chosen runtime. Never expose Workers, Groq, OpenAI, R2, Google, database, device-hash, or Admin signing secrets to the browser.

## Production migration

```bash
npm run db:generate
npm run db:migrate:deploy
```

Production uses committed `prisma migrate deploy` migrations. Never use `prisma db push` for deployment and never reset a production database.

## Development and validation

```bash
npm install
npm run db:generate
npm run dev:api
npm run dev:web

npm run build
npm run test:smoke -w @maqar/api
npm run test -w @maqar/web
npm run smoke:imports
npm run ai:smoke
```

Live smoke commands consume local environment credentials, create isolated test records, and must clean those records afterwards.
