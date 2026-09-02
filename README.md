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

## System reference for engineers and AI agents

This section is the concise source of truth for anyone reasoning about the platform. Source code and runtime behavior take precedence if this document ever becomes stale.

### Service boundaries

| Component | Public responsibility | Must not do |
| --- | --- | --- |
| Next.js Web | Customer chat UI, Admin UI, and same-origin server adapters | Expose backend URLs or gateway secrets to the browser |
| Android | Display the existing Web Chat in a hardened native WebView | Create another AI brain, database, or conversation state |
| NestJS API | Nadim V2, deterministic search, lifecycle, CRM, imports, maps, storage, and Admin APIs | Trust model output as a fact or action result |
| Automation API | Execute authorized lead, viewing, callback, and reservation workflows | Execute without its shared secret or claim success on failure |
| PostgreSQL | Canonical inventory, conversations, lifecycle, CRM, audit, and import provenance | Be replaced by model memory |
| R2-compatible storage | Uploaded media and source objects | Decide whether a property fact is true |
| External AI providers | Interpret language and compose natural responses | Filter inventory, calculate verified facts, or authorize actions |

The customer path is:

```text
Browser or Android WebView
  -> POST /api/nadim/turn on Next.js
  -> server-side validation and per-device rate limit
  -> POST /v2/nadim/turn on the NestJS API
  -> gateway-secret validation
  -> Nadim V2 orchestration
  -> PostgreSQL + deterministic tools + approved AI provider
  -> validated reply and structured UI payload
  -> same conversation persisted for Web, Admin, and channel continuity
```

The gateway secret and backend origins exist only on the server. The browser receives neither. The Web adapter derives a stable `externalUserId` by hashing the device token and Web conversation ID.

`ChatService` is still registered for compatibility with older internal surfaces, import assistance, and tests. It is not the public Web customer brain. New customer behavior must go through Nadim V2 and must not create a second conversation store or reintroduce legacy customer routing.

### Which component is the AI brain?

Nadim is a hybrid system. The language model is the semantic brain, while deterministic services remain the authority for state, facts, and execution.

| Layer | Current implementation | Role |
| --- | --- | --- |
| Primary Nadim V2 dialogue provider | AWS Bedrock GLM through an OpenAI-compatible endpoint | Structured semantic decision and natural response composition when enabled and configured |
| Secondary Nadim V2 dialogue provider | Groq `GroqDialogueProvider` | Automatic fallback when Bedrock is disabled, unavailable, or returns invalid output |
| Deterministic outage fallback | `UnderstandingService`, state engine, planner, tools, and response templates | Keeps explicit safe behavior available when every dialogue provider is unavailable |
| Groq model router | `conversation-model-router.ts` | Chooses fast, standard, backup, and vision Groq models for the hybrid compatibility stack; Nadim V2 uses its configured standard/general model for the Groq secondary provider |
| Cloudflare Workers AI | `CloudflareWorkersAIProvider` inside `HybridAIProvider` | Intent extraction, knowledge/column assistance, and resilient response fallback for compatibility services; it is not the primary `/v2/nadim/turn` provider chain |
| OpenAI | Opt-in fallback inside the compatibility hybrid provider | Disabled unless `OPENAI_FALLBACK_ENABLED`, key, and model are all explicitly configured; it is not in the current Nadim V2 Bedrock-to-Groq chain |
| Demo provider | Local/development compatibility mode | Deterministic development behavior, never production intelligence |

The Bedrock implementation currently uses `BEDROCK_BASE_URL` plus `BEDROCK_API_KEY`; it is an OpenAI-compatible Bedrock Mantle request, not an IAM-signed AWS SDK invocation. Cloudflare R2 uses the AWS S3 client protocol, but that does not make R2 the AI brain.

Provider order for a V2 model task:

```text
BEDROCK_GLM_ENABLED=true and Bedrock configured
  -> Bedrock GLM
  -> if unsuccessful: Groq
  -> if every provider fails: deterministic safe fallback
```

If Bedrock is disabled, Groq becomes the first available V2 provider. If neither is configured, deterministic behavior remains available but conversational quality is intentionally reduced.

### One Nadim V2 turn, step by step

1. The Web adapter validates IDs, device token, locale, event ID, and a message of at most 8,000 characters.
2. It applies a 20-turn-per-minute in-memory limit per hashed device token.
3. It forwards the turn with a server-only gateway secret, request ID, and idempotency key.
4. The API validates the DTO, authenticates the gateway, and rejects reused idempotency keys with different payloads.
5. `NadimConversationService` resolves the customer, participant, conversation, persisted state, active requirement, recent successful turns, and ownership mode.
6. The language-style detector preserves sticky Arabic/English/Franco/mixed response style unless the customer explicitly changes it.
7. The dialogue model produces one structured decision: meaning, references, state operations, tool proposals, action proposals, response goal, and clarification state.
8. Deterministic interpretation supplements explicit high-confidence constraints and actions; model proposals are never trusted blindly.
9. The state engine applies `SET`, `REMOVE`, `RESET`, and `PRESERVE` semantics without leaking one property requirement into another.
10. The planner runs at most four approved tools. Property search, exact-unit facts, payment plans, availability, media, comparison, location, and time remain deterministic.
11. Action policy validates every proposed action. Product actions are persisted internally; external commercial actions run only when execution is enabled and the Automation API succeeds.
12. The composer receives verified tool results and action outcomes. Post-generation guards reject invented inventory, identity, delivery, proximity, deletion, or success claims.
13. The API commits the turn, state, metadata, structured UI, and lifecycle changes. A repeated identical event is replayed idempotently instead of duplicated.

The invariant is permanent:

```text
NO VERIFIED FACT WITHOUT VERIFIED DATA
NO SUCCESS CLAIM WITHOUT SUCCESSFUL EXECUTION
```

### Databases and state

There is one canonical relational database: PostgreSQL through Prisma. No MongoDB, Redis, vector database, or second chat database is configured in this repository.

Main schema groups:

- **Real estate:** `Location`, aliases and distances, `Developer`, `Project`, phases, buildings, zones, gates, amenities, market profiles, landmarks, competitors, `Unit`, price history, payment plans, offers, media, documents, and spatial proximity.
- **Inventory governance:** import batches, sheets, mappings, value mappings, issues, corrections, per-unit changes, source hashes, preview versions, approval state, and provenance.
- **Conversation:** anonymous devices, customer identities, participants, Nadim conversations, turns, messages, state, share tokens, deletion receipts, and ownership mode.
- **Customer lifecycle:** independent property requirements, follow-up tasks, selected units/projects, recent result IDs, comparison candidates, and channel continuation.
- **Commercial workflow:** leads, lead events, notes, trust alerts, automation executions, assignment, qualification, and status transitions.
- **Administration and observability:** Admin users, audit log, AI usage, prompt/model metadata, latency, errors, and fallback information.

Structured project knowledge is stored in PostgreSQL and must be approved before it becomes customer truth. There is no embedding or vector retrieval subsystem in the current code.

Application caching is a bounded in-process LRU-style map with a maximum of 500 entries per API process. FX has a separate in-process TTL/stale cache. Cache state is not shared between replicas.

### Customer-data processing

- The current message, up to 12 recent successful turns, conversation summary, active requirements, and customer context are assembled for semantic interpretation.
- Customer context may include name, normalized phone, and normalized email. Therefore AI providers are data processors and must be covered by privacy disclosures, retention controls, and appropriate provider agreements.
- The API redacts email, phone-like values, and long identifiers from the compact diagnostic meaning written to logs, but model requests still receive the conversational context needed to perform the task.
- Property facts are fetched from PostgreSQL after deterministic constraint normalization. Hard budget, currency/FX, status, unit reference, payment, and availability checks are performed outside the model.
- Share and WhatsApp continuation tokens are random; only their SHA-256 hashes are stored. They have expiry and use-count controls.
- Conversation deletion uses a two-step confirmation and transactional deletion. A minimal deletion receipt remains to make retries idempotent. The repository does not define a global automatic retention schedule for conversations, customers, uploads, audits, or AI usage; production policy must define one.
- Database encryption at rest, backups, point-in-time recovery, network isolation, and regional residency are responsibilities of the selected PostgreSQL and hosting configuration; they are not proven by application code alone.

### Inventory ingestion and canonical fields

The import contract accepts XLSX, XLS, and UTF-8 CSV. Uploads are Admin-only, limited to 20 MB and 10,000 detected rows, checked against file signatures, hashed with SHA-256, analyzed without writing inventory, resolved by an Admin, previewed, and finally committed in one database transaction with audit and provenance.

Operational minimum for a useful searchable unit:

- stable external unit ID;
- resolved developer, project, location, and phase context;
- explicit availability status or an Admin-confirmed default;
- property type;
- canonical total price and currency;
- any advertised bedrooms, bathrooms, area, delivery, payment, and media facts.

The canonical import taxonomy currently contains 205 fields. Its executable source of truth is `apps/api/src/imports/import-contract.ts`. It covers:

- identity and hierarchy: unit/property reference, plot, parcel, project, phase, cluster, zone, block, building, floor, gate, and internal location;
- classification: unit/subtype, use, ownership, sale/seller type, commercial activity, and license type;
- rooms and areas: bedrooms, bathrooms, service rooms, parking, storage, built/net/gross/land/garden/roof/terrace/balcony/basement/common areas, frontage, and ceiling height;
- pricing and fees: canonical price, original/asking price, price per square metre, currency, reservation, discounts, maintenance, club, transfer and broker fees, and offers;
- availability and delivery: status, availability date, condition, occupancy, ready-to-move, delivery, launch, construction percentage, finishing, and furnishing;
- payment: down payment amount/percentage, installment duration/amount/frequency, first installment, and balloon payment;
- location and features: coordinates, address, orientation, views, pool, lifts, parking, gardens, roofs, terraces, utilities, security, smart-home, and building characteristics;
- resale and leasing: premium, paid/remaining amounts, installments, rent, lease dates, tenant state, deposit, yields, vacancy, and seller requirements;
- commercial/industrial: frontage, footfall, power, HVAC, signage, outdoor area, extraction, office/retail/medical/warehouse attributes, loading, yard, and crane capacity;
- legal: title deed, registration, registry, ownership share, tenure, mortgage, permit, and legal notes;
- provenance and operations: source URL/channel/contact, agent/broker, listing dates, exclusivity, tags, quality score, and notes.

Blank source cells do not silently erase richer canonical values. A stale preview cannot be confirmed after mappings change. Failed confirmation is rolled back so partially imported inventory is not left behind.

### Capacity and request limits

Configured limits are safety policy, not a load-test result:

| Boundary | Current limit |
| --- | --- |
| Web Nadim turns | 20 per device token per 60 seconds, per Web process |
| API default throttle | 120 requests per source IP per 60 seconds, per API process |
| Legacy conversation message endpoints | 20 requests per source IP per 60 seconds |
| Admin, import, analytics, maps, and login-sensitive routes | generally 5 requests per source IP per 60 seconds |
| API JSON/form body | 1 MB |
| Automation API body | 256 KB |
| Inventory/knowledge/media upload | 20 MB per configured interceptor |
| Inventory rows | 10,000 per workbook |
| Search return request | normally 5, hard-capped at 10 |
| Tool loop | at most 4 iterations |
| Context history | 12 recent successful Nadim turns |
| Model completion | 1,200 output tokens per provider call |
| Non-stream model timeout | 18 seconds per provider attempt |
| Stream model timeout | 45 seconds per provider attempt |
| Web Nadim request duration | 120 seconds |
| General internal Web-to-API proxy | 180 seconds |

There is no defensible total requests-per-second or concurrent-user number yet because the repository contains no production load-test result, replica count, CPU/memory profile, database plan/pool configuration, or provider quota. A single Web service may also present one internal source IP to the API; in that topology, the API's 120/minute IP throttle can become an aggregate ceiling of roughly two requests per second for all Web chat traffic through that service.

Node/Nest and Next can handle concurrent I/O, but real capacity is the minimum of:

```text
Web replicas
API replicas and event-loop latency
API IP throttling
PostgreSQL connection/query capacity
Bedrock/Groq rate and token quotas
R2/Maps/FX latency and quotas
network and hosting limits
```

Before publishing a capacity claim, run staged load tests for deterministic search, full AI turns, multi-turn persistence, Admin reads, and imports. Measure p50/p95/p99 latency, error rate, provider throttling, DB connections, CPU, memory, and queueing. Distributed Redis-backed throttling/cache or another shared store is required if consistent limits across replicas are a production requirement.

## Security assessment

Assessment date: **2026-09-02**. This is a source, build, dependency, and local-runtime review; it is not a third-party penetration-test certificate.

### Verified controls

- API and Automation API use Helmet, strict DTO validation, property whitelisting, body-size limits, request IDs, safe exception filters, and rate limiting.
- API CORS uses an explicit Web-origin allowlist and permits only required headers and methods.
- Nadim gateway and Automation API secrets are compared through constant-time SHA-256 digests.
- Admin authentication uses bcrypt cost 12, eight-hour JWTs with issuer/audience, HttpOnly cookies, `Secure` in production, `SameSite=Lax`, login throttling, active-user checks, and audit events.
- Admin routes are guarded in the API and non-disclosing behind the private Web entry path.
- No tracked high-confidence API key/private-key pattern was found in the repository during this review.
- No `dangerouslySetInnerHTML`, direct `innerHTML`, `eval`, or `new Function` use was found in application source.
- Inventory uploads validate extension and basic file signatures. Confirmations use transactions, versioned previews, provenance, and audit records.
- Model decisions, tool proposals, actions, and final text pass deterministic allowlists and truth/success-claim validation.
- Android requests only Internet and network-state permissions; backups are disabled; cleartext is disabled except the emulator host; file/content access and mixed content are disabled; third-party cookies are rejected; no JavaScript bridge exists; navigation is same-origin; Admin paths are blocked; external links leave the app.

### Open findings

| Severity | Finding | Required treatment |
| --- | --- | --- |
| High when R2 is public | The same `R2_PUBLIC_BASE_URL` model is used for public media and original import/knowledge source objects. Original workbooks or knowledge documents may therefore be reachable by anyone who obtains their URL. | Separate public media from private source storage; serve private files through authorized short-lived signed URLs. |
| High dependency advisory | `npm audit --omit=dev` reports three high findings through `prisma -> @prisma/config -> deepmerge-ts@7.1.5` (`GHSA-ggr8-5vv4-36mx`). The observed path is Prisma CLI/config rather than the customer request path, but it remains unresolved. | Upgrade Prisma and client together to a tested fixed line; do not use `npm audit fix --force` blindly. |
| Medium | The review initially found no Web response security headers. Baseline CSP frame/object/base/form restrictions, HSTS, nosniff, referrer, permissions, frame, and opener headers were added. A restrictive script/style/connect CSP is still absent because Next.js, Google Maps, and approved remote media need a tested nonce/allowlist design. | Add nonce-based CSP in report-only mode, validate every Web/Admin/Maps route, then enforce it. |
| Medium | Admin mutations rely primarily on `SameSite=Lax`; no explicit CSRF token or mutation Origin/Referer enforcement was found. | Add same-origin mutation checks or CSRF tokens, especially if sibling subdomains share trust. |
| Medium | Web and API rate limits and caches are in memory and are not coordinated across replicas. Web server-to-server traffic may collapse many customers into one API IP bucket. | Use a distributed limiter/cache and define the trusted proxy/IP strategy before horizontal scale. |
| Medium privacy | Recent dialogue and customer profile fields can be sent to Bedrock or Groq. No provider-specific PII minimization, regional policy, or retention configuration is enforced in code. | Define DPA/retention/residency rules and minimize/redact fields not required for each model task. |
| Medium | Some image/document flows trust MIME type or filename extension after authentication and do not consistently inspect magic bytes, decode images, or malware-scan source documents. | Add content-signature validation, safe image decoding/re-encoding, and malware scanning before publication. |
| Operational | No committed production infrastructure specification proves TLS termination, WAF, secret rotation, database backups/PITR, private networking, log retention, alerts, or autoscaling. | Verify these controls in the actual hosting account and record owners and evidence. |

## Google Play readiness

Current verdict: **technically compatible, but not submission-ready**.

What already passes:

- application ID `ai.capitalgate.chat`;
- `compileSdk` and `targetSdk` 36, satisfying the Android 16/API 36 requirement that applies to new apps and updates from 31 August 2026;
- minimum SDK 24;
- exported launcher activity declared explicitly;
- Android release lint passes;
- an Android App Bundle can be generated;
- no sensitive Android permission is requested;
- RTL, system insets, loading, retry, network error, and predictive-back behavior were tested on an emulator.

What blocks Play submission today:

1. The generated release AAB is unsigned. Configure a private upload key and Google Play App Signing outside the repository.
2. Build release with the real HTTPS chat URL. The Gradle build now rejects release builds without `-PCHAT_URL=https://...`.
3. Publish a comprehensive, globally available, non-PDF privacy policy and link it both in Play Console and inside the app/Web Chat.
4. Complete the Data Safety form for chat messages, device/conversation identifiers, optional name/phone/email, diagnostics, and processing by infrastructure/AI providers.
5. Define a public data-deletion request path and retention policy. Conversation deletion exists, but no general account/customer retention policy is documented.
6. Prepare store listing, screenshots, feature graphic, support contact, target audience, content rating, ads declaration, and reviewer access/instructions.
7. Verify the developer identity and package registration requirements in the Play Console.
8. Demonstrate meaningful, reliable mobile utility. A WebView is not automatically prohibited, but a thin wrapper can be rejected for limited functionality or broken/offline behavior. The interactive Nadim chat, native loading/error handling, secure navigation, and stable production availability must be evident during review.

Google's current primary references:

- [Target API level requirements](https://support.google.com/googleplay/android-developer/answer/11926878)
- [Functionality, content, and user experience](https://support.google.com/googleplay/android-developer/answer/9898783)
- [Android App Bundle publishing](https://support.google.com/googleplay/android-developer/answer/9844279)
- [User Data and privacy-policy requirements](https://support.google.com/googleplay/android-developer/answer/10144311)
- [Data Safety form](https://support.google.com/googleplay/android-developer/answer/10787469)

## Technology

- Next.js, React, TypeScript, and Tailwind CSS
- NestJS and TypeScript
- Prisma and PostgreSQL
- Bedrock GLM and Groq for Nadim V2; Cloudflare Workers AI and opt-in OpenAI for compatibility services
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
| Runtime/database | `NODE_ENV`, service-specific `PORT`, `DATABASE_URL` |
| Web/API routing | `WEB_ORIGIN`, `WEB_BASE_URL`, `INTERNAL_API_URL`, `NADIM_API_URL` |
| Nadim V2 | `NADIM_V2_ENABLED`, `NADIM_GATEWAY_SECRET`, `DEVICE_HASH_SECRET` |
| V2 primary | `BEDROCK_GLM_ENABLED`, `BEDROCK_API_KEY`, `BEDROCK_BASE_URL`, `BEDROCK_GLM_MODEL` |
| V2 secondary/Groq routing | `GROQ_API_KEY`, `GROQ_FAST_MODEL`, `GROQ_STANDARD_MODEL`/`GROQ_GENERAL_MODEL`, `GROQ_REASONING_MODEL`, `GROQ_BACKUP_MODEL`, `GROQ_LAST_RESORT_MODEL`, `GROQ_VISION_MODEL`, preview/unlisted model flags |
| Compatibility AI | `AI_PROVIDER`, Cloudflare account/token/models, `OPENAI_FALLBACK_ENABLED`, `OPENAI_API_KEY`, `OPENAI_TEXT_MODEL` |
| Verified FX | `FX_API_URL`, `FX_API_KEY`, timeout, cache TTL, stale maximum |
| Admin | `ADMIN_JWT_SECRET`, `ADMIN_ACCESS_PATH`, `ADMIN_COOKIE_DOMAIN`, one-time bootstrap email/password |
| Storage | `STORAGE_PROVIDER`, R2 account, access key, secret, bucket, and public base URL |
| Maps | `GOOGLE_MAPS_SERVER_API_KEY`, `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY` |
| Actions | `NADIM_ACTION_EXECUTION_ENABLED`, `NADIM_AUTOMATION_API_URL`, `NADIM_AUTOMATION_SECRET`, `NADIM_DEFAULT_PHONE_COUNTRY` |
| Continuity | `WHATSAPP_BUSINESS_NUMBER` |
| Build diagnostics | `ANALYZE` for the optional Web bundle analyzer |

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

Play release bundle after configuring an external upload-key signing setup:

```powershell
cd apps/android
.\gradlew.bat clean lintRelease bundleRelease -PCHAT_URL=https://your-chat-domain.example
```

The AAB is generated at `apps/android/app/build/outputs/bundle/release/app-release.aab`. A locally generated unsigned AAB is not upload-ready.

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
