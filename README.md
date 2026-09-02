<div align="center">

# Capital Gate AI

### Verified real-estate intelligence for Arabic-first customer journeys

**Nadim** understands the customer, searches trusted inventory, explains verified facts, and moves qualified conversations toward a real next action.

</div>

---

## What this project is

Capital Gate AI is a production-oriented real-estate sales and customer-service platform. It combines an AI-first conversation experience with deterministic inventory search, structured customer lifecycle state, secure human handoff, and an operational Admin workspace.

The product is Arabic-first, supports English and mixed Arabic/English conversations, and keeps factual property answers grounded in the canonical database.

> **Core rule:** no property fact without verified inventory, and no success claim without successful execution.

## Product surfaces

- **Nadim Web Chat** — conversational property discovery, structured result cards, comparisons, media, payment facts, sharing, and follow-ups.
- **Admin Workspace** — conversations, requirements, follow-ups, sales opportunities, inventory, projects, teams, analytics, and settings.
- **Inventory Import** — XLSX/XLS/CSV analysis, human-reviewed field mapping, multi-project resolution, preview, atomic confirmation, audit, and provenance.
- **Android Chat** — a focused native shell that opens the same Nadim Web Chat without creating another AI brain or conversation store.
- **Automation API** — authorized external action execution for workflows that are explicitly enabled and configured.

## Why Nadim is different

- Context-first conversation state instead of stale-result-first behavior.
- Independent customer requirements with a clearly active requirement.
- Semantic reference handling for natural Arabic, English, Franco Arabic, and mixed language.
- Deterministic exact-unit, payment-plan, budget, FX, availability, and ranking validation.
- Multi-intent turns that can execute more than one independent action.
- Human ownership mode and resumable AI ownership.
- Explicit pending actions for reservations, viewings, callbacks, and follow-ups.
- Structured UI payloads so Web and Android consume the same backend truth.

## Architecture

```text
Customer
   │
   ├── Web Chat ───────────────┐
   └── Android Chat WebView ───┤
                               ▼
                    Same-origin Web adapters
                               │
                               ▼
                         Nadim V2 API
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
       Conversation state  Property search  Action policy
              │                │                │
              └──────────┬─────┴──────────┬─────┘
                         ▼                ▼
                 PostgreSQL/Prisma   Automation API
                         │
                  Verified inventory
```

### Monorepo

| Path | Responsibility |
| --- | --- |
| `apps/web` | Next.js customer chat and protected Admin workspace |
| `apps/api` | NestJS Nadim V2, search, lifecycle, CRM, imports, maps, storage, and AI routing |
| `apps/automation-api` | Authorized external action execution |
| `apps/android` | Native Android chat-only WebView shell |
| `packages/database` | Prisma schema and forward-only PostgreSQL migrations |
| `scripts` | Referenced smoke tests, controlled fixtures, and operational validation tools |

Internal npm workspace names still use the legacy `@maqar/*` identifiers for compatibility.

## Technology

- Next.js, React, TypeScript, and Tailwind CSS
- NestJS and TypeScript
- Prisma and PostgreSQL/Neon
- Groq, Cloudflare Workers AI, and opt-in provider fallbacks
- Cloudflare R2-compatible object storage
- Google Maps, Places, and Routes
- Native Android Java, Gradle, and Android WebView

## Local setup

### Requirements

- Node.js 22 or newer
- npm 11 or newer
- PostgreSQL-compatible database
- Java 17 and Android SDK 36 for the Android app

### Install

```bash
npm install
cp .env.example .env
npm run db:generate
npm run db:migrate:deploy
```

On Windows, copy `.env.example` to `.env` manually instead of using `cp`.

### Start the platform

```bash
npm run dev:api
npm run dev:web
```

Default local addresses:

- Web: `http://localhost:3000`
- API: `http://localhost:8080`
- Automation API: `http://localhost:8081`

## Environment configuration

Use one root `.env` for local development. Production services should use platform-managed environment variables.

| Area | Main variables |
| --- | --- |
| Database | `DATABASE_URL` |
| Web/API | `WEB_ORIGIN`, `WEB_BASE_URL`, `INTERNAL_API_URL`, `NADIM_API_URL` |
| Nadim security | `NADIM_GATEWAY_SECRET`, `DEVICE_HASH_SECRET` |
| Admin | `ADMIN_JWT_SECRET`, `ADMIN_ACCESS_PATH`, bootstrap credentials |
| AI providers | `AI_PROVIDER`, `GROQ_API_KEY`, Cloudflare/OpenAI/Bedrock opt-in variables |
| Storage | `STORAGE_PROVIDER` and R2 credentials |
| Maps | server and browser Google Maps keys |
| Actions | `NADIM_ACTION_EXECUTION_ENABLED`, Automation API URL and secret |

Never expose server secrets through a `NEXT_PUBLIC_` variable. The browser communicates through same-origin adapters.

## Inventory truth flow

```text
Upload source
  → detect workbook tables
  → review project and phase context
  → map canonical fields
  → validate normalized rows
  → preview changes
  → atomic confirmation
  → audit and provenance
  → deterministic property search
  → final match validation
  → Nadim response
```

The importer never writes inventory before Admin confirmation. Blank source cells do not overwrite richer canonical values, and a missing status is not silently treated as available in production report flows.

## Android chat app

The Android app is intentionally small: it opens the existing Web Chat, preserves the same conversation lifecycle, blocks Admin routes, disables file/content access, rejects mixed content, and opens external links outside the app.

The default debug URL points to the host machine from the Android emulator:

```text
http://10.0.2.2:3000
```

Build with a deployed chat URL:

```powershell
cd apps/android
.\gradlew.bat :app:assembleDebug -PCHAT_URL=https://your-chat-domain.example
```

macOS/Linux:

```bash
cd apps/android
./gradlew :app:assembleDebug -PCHAT_URL=https://your-chat-domain.example
```

The generated debug APK is placed under:

```text
apps/android/app/build/outputs/apk/debug/app-debug.apk
```

For a production release, configure the real HTTPS chat origin and your Android signing setup. Signing credentials must never be committed.

## Validation

```bash
npm run db:generate
npm run lint
npm run build
npm run smoke:api
```

Focused suites are also available inside the API and Web workspaces:

```bash
npm run test:nadim-v2 --workspace @maqar/api
npm run test:nadim-product --workspace @maqar/api
npm run test:smoke --workspace @maqar/api
npm run test --workspace @maqar/web
```

Android:

```powershell
cd apps/android
.\gradlew.bat lintDebug testDebugUnitTest assembleDebug
```

## Production safety

- Apply only reviewed, forward-only migrations.
- Never use `prisma db push` against production.
- Never commit `.env`, signing keys, API tokens, or customer data.
- Treat model output as untrusted input.
- Keep reservation/action execution disabled until its authorized provider path is production-ready.
- Do not claim that a booking, follow-up, share link, or handoff succeeded until its execution result is verified.

## Repository

GitHub: [popwam/capital-gate-ai](https://github.com/popwam/capital-gate-ai)
