# AICG Architecture Map
**Generated:** 2026-08-20
**Status:** Real estate AI conversational platform

## Project Structure

**Monorepo** (npm workspaces, npm@11.12.1)
- `apps/web` — Next.js 16.3.0 customer-facing frontend
- `apps/api` — NestJS backend API
- `packages/database` — Prisma 6.19.3 shared database layer

## Tech Stack

### Frontend (apps/web)
- **Framework:** Next.js 16.3.0 (App Router), React 19.2.0
- **Language:** TypeScript 5.9.3
- **Styling:** Tailwind CSS 3.4.17, custom design tokens
- **Fonts:** Cairo Variable, Noto Sans Arabic Variable
- **Default:** RTL Arabic (`<html lang="ar" dir="rtl">`)
- **Pages:** 17 routes total (mostly admin)
- **Components:** ~43 TypeScript files
- **Environment:** Loads root `.env` for local dev

### Backend (apps/api)
- **Framework:** NestJS 11 with Express
- **Language:** TypeScript 5.9.3
- **Security:** Helmet, CORS, throttling (120 req/60s), validation pipes
- **Architecture:** Service-oriented with dependency injection
- **Entry:** `src/main.ts` on port 8080

### Database (packages/database)
- **ORM:** Prisma 6.19.3
- **Database:** PostgreSQL
- **Schemas:** 40+ models covering:
  - Real estate: Location, Developer, Project, Unit, PaymentPlan, Media, Document
  - AI conversations: Conversation, Message, ConversationState, Lead
  - Admin: AdminUser, AuditLog, DataImport, ImportSheet
  - Trust/Safety: CustomerTrustAlert
  - Analytics: AIUsage

## AI Architecture

### Providers (Hybrid Strategy)
**Primary:** HybridAIProvider (apps/api/src/providers/hybrid.provider.ts)
- **Factory:** `AI_PROVIDER` env selects `hybrid` (prod) or `demo` (dev)
- **Provider Chain:**
  1. **Cloudflare Workers AI** — fast extraction, knowledge, column mapping
  2. **Groq** — customer conversation generation with intelligent routing
  3. **OpenAI** — opt-in paid fallback (OPENAI_FALLBACK_ENABLED=true)

### Model Routing (conversation-model-router.ts)
Groq models dynamically selected per turn:
- **FAST** (openai/gpt-oss-20b): small talk, short conversational, simple context
- **GENERAL** (openai/gpt-oss-120b): default customer conversations
- **REASONING** (openai/gpt-oss-120b): comparison, investment, payment plans, high purchase intent, mixed language, complex context

**Fallback Chain:** primary → backup → alternative → last-resort
**Retired Models Blocked:** llama-3.1-8b-instant, llama-3.3-70b-versatile (unless ALLOW_UNLISTED_GROQ_MODELS=true)

### AI Capabilities
1. **Intent Extraction** (Workers AI)
   - 30+ structured intent types (PROPERTY_SEARCH, VIEWING_REQUEST, PAYMENT_PLAN, etc.)
   - Fallback: deterministic regex-based extraction
   
2. **Customer Answer Generation** (Groq → OpenAI → Workers AI)
   - Streaming and non-streaming
   - Real estate semantic normalization
   - Grounding contradiction detection

3. **Knowledge Extraction** (Workers AI)
   - Extract structured facts from documents

4. **Column Mapping** (Workers AI)
   - AI-assisted Excel/CSV import mapping

### Context Construction (ai-context.ts)
Input to LLM includes:
- Recent conversation history (20 messages)
- Verified facts (units, projects, developers)
- Approved knowledge items
- Conversation summary
- Context compaction: "normal" vs "aggressive" for 413 errors

### Observability
- Structured JSON logs: `AIProviderTrace`, `AIModelRoute`, `AIContextTrace`, `CustomerTurnTrace`
- AIUsage table tracking: provider, model, task type, tokens, latency, success, fallback usage
- Trust scoring and alert system

## Core Services

### ChatService (apps/api/src/chat.service.ts)
**1373 lines** — The brain orchestrating customer conversations
- Prepare phase: extract intent → search database → construct context
- Generate phase: route to model → stream/compose answer → persist
- Deterministic answers for: lead creation, payment choices, media/brochure, distance, small talk
- Trust validation integrated into contact handoff flow
- Lead handoff stages: PAYMENT → IDENTITY → CONFIRMATION → COMPLETE

### ConversationsService
Manage conversation CRUD, message history

### PropertySearchService
Database queries: searchProperties, findUnitByExternalId, getProject, getDeveloper, aggregateInventory

### CustomerTrustService
Assess contact validity, detect fake/placeholder names, record alerts

### ImporterService
Excel/CSV import with AI-assisted mapping and validation

### MapsService
Google Maps integration (Routes API, Places API)

### StorageService
AWS S3 / Cloudflare R2 media storage

## Authentication & Authorization
- **Customer:** Anonymous device tokens (`x-device-token` header, SHA-256 hashed)
- **Admin:** JWT-based (AdminAuthGuard), bcrypt password hashing
- **Session:** Cookie-based for admin panel

## API Routes

### Public
- `POST /v1/conversations` — create conversation
- `GET /v1/conversations/:id/messages` — get history
- `POST /v1/conversations/:id/messages` — send message
- `POST /v1/conversations/:id/messages/stream` — SSE streaming

### Admin (`/v1/admin/*`)
- Conversations, Leads, CRM
- Catalog (projects, units)
- Data imports
- Locations, Maps
- Developers, Real Estate management
- System health

## Frontend Architecture

### Main Entry
- `app/page.tsx` → `<ChatApp />` component
- Root layout: Arabic RTL by default

### Admin Routes (17 pages)
- `/admin` — dashboard
- `/admin/conversations` — conversation list
- `/admin/conversations/[id]` — conversation detail
- `/admin/leads` — CRM leads
- `/admin/leads/[id]` — lead detail
- `/admin/data` — import management
- `/admin/data/import` — import wizard
- `/admin/inventory` — unit inventory
- `/admin/projects` — project list
- `/admin/projects/[id]` — project detail
- `/admin/projects/[id]/knowledge` — knowledge base
- `/admin/developers` — developer list
- `/admin/developers/[id]` — developer detail
- `/admin/locations` — location hierarchy
- `/admin/login` — admin authentication
- `/admin/system` — system health

### Design System (globals.css, tailwind.config.ts)
**Colors:**
- `ink` #14211f (primary text)
- `forest` #173f3b (secondary)
- `sand` #f5f2eb (background)
- `coral` #b08c52 (accent)

**Surface Treatments:**
- `.cg-surface` — radial gradients on #faf9f5
- `.cg-glass` — rgba(250, 249, 245, .88) + backdrop-filter blur(18px)
- Shadows: `soft`, `premium`

**Typography:**
- Cairo Variable (Arabic primary)
- Noto Sans Arabic Variable (Arabic fallback)
- RTL line-height: 1.9 | LTR: 1.75
- No letter-spacing on Arabic (glyph joining)

**Animation:**
- `rise` — message entrance
- `blink` — typing indicator

## Internationalization
- **Primary Language:** Arabic (ar, RTL)
- **Secondary:** English (en, LTR)
- **Approach:** Dynamic language detection per conversation
- **Bidi Support:** `unicode-bidi: plaintext`, `text-align: start`
- **Font Loading:** @fontsource-variable packages

## Environment Variables (Critical)

### AI Providers
- `AI_PROVIDER` — "hybrid" | "demo"
- `GROQ_API_KEY` — Groq API key
- `GROQ_FAST_MODEL`, `GROQ_GENERAL_MODEL`, `GROQ_REASONING_MODEL`
- `OPENAI_API_KEY`, `OPENAI_TEXT_MODEL`
- `OPENAI_FALLBACK_ENABLED` — "true" to enable paid OpenAI fallback
- `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`

### Infrastructure
- `DATABASE_URL` — PostgreSQL connection
- `WEB_ORIGIN` — CORS allowed origins
- `PORT` — API port (default 8080)
- `NODE_ENV` — "production" | "development"

### Integrations
- `GOOGLE_MAPS_SERVER_API_KEY` — Maps/Routes/Places
- `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_DOMAIN`

## Data Flow: Customer Conversation

1. **User sends message** → `POST /v1/conversations/:id/messages`
2. **ConversationsController** validates device token
3. **ChatService.prepare():**
   - Persist user message
   - Load history (last 20 messages)
   - **Extract intent** (Workers AI → deterministic fallback)
   - Apply real estate semantic normalization
   - **Database search** (PropertySearchService)
   - Construct `AnswerInput` with verified facts
   - **Trust assessment** (if contact info present)
   - **Lead handoff logic** (payment → identity → confirmation)
4. **ChatService.send() or .stream():**
   - Route model (FAST/GENERAL/REASONING)
   - Call Groq with fallback chain
   - Detect grounding contradictions
   - Sanitize answer (strip URLs, UUIDs, CUIDs)
   - Add first-turn intro
   - Persist assistant message
5. **Return:** message + UI actions (cards, media, lead prompts)

## Key Business Logic

### Lead Creation Threshold
`purchaseIntent >= 70` + valid name + valid phone → create Lead

### Payment Route Handoff
If unit has payment plans → force choice (CASH | INSTALLMENT) before identity collection

### Trust Signals
- Passive: unexpected identity/phone in non-handoff context
- Active: during IDENTITY/CONFIRMATION stages
- Alert levels: CONTACT_VALID, UNCLEAR_CONTACT, PLACEHOLDER_DETECTED, LIKELY_FAKE

### Search Ranking
Units ranked by: availability, price match, area match, delivery date, feature match

## Missing / Weak Areas (Initial Observations)

### AI Layer
- No AI_REASONING_ARCHITECTURE.md exists yet
- Logging is structured but not aggregated/analyzed
- No documented prompt versioning
- No A/B testing of prompts or routing logic
- Model fallback chain is long but success rates unknown
- No documented hallucination mitigation beyond grounding check

### Frontend
- Only 1 customer-facing page (ChatApp)
- 16 admin pages but no visual audit yet
- Design system partially defined (4 colors, 2 shadows, basic glass)
- No design tokens file
- Component library unknown (shadcn? custom?)
- Responsive strategy not documented
- No visual regression testing

### Testing
- Tests exist (*.spec.ts) but coverage unknown
- No E2E tests visible
- No visual testing
- No accessibility testing infrastructure

### Documentation
- No API documentation (OpenAPI/Swagger)
- No component storybook
- No deployment guide visible
- No runbook for incidents

### Observability
- Logs exist but no dashboards mentioned
- No error tracking (Sentry?)
- No performance monitoring
- No user analytics visible

---

**Next Steps:** Run the application and perform visual/functional audit.
