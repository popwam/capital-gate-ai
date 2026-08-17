# Cg Ai — Production Rewrite Guide

This package is a source rewrite of the uploaded project. It intentionally does **not** contain generated `dist` / `.next` output so production cannot accidentally start stale code.

## What changed

### 1. Cg Ai model routing

Customer generation is role-based instead of sending every turn to one model:

| Role | Default | Purpose |
| --- | --- | --- |
| FAST | `openai/gpt-oss-20b` on Groq | greetings, simple confirmations, lightweight turns |
| GENERAL | `openai/gpt-oss-120b` on Groq | normal real-estate conversation |
| REASONING | `openai/gpt-oss-120b` on Groq | comparison, investment, resale, project/developer detail, payment plans, strong buying intent, mixed Arabic/English |
| INTENT | `@cf/meta/llama-4-scout-17b-16e-instruct` on Workers AI | structured conversation-state extraction |
| FALLBACK | `@cf/openai/gpt-oss-120b` on Workers AI | generation fallback after Groq candidates fail |
| VISION | `qwen/qwen3.6-27b` on Groq | master-plan image localization only |

The customer text router rejects old/unlisted Groq model IDs and Preview models by default. An upstream `404` / `model_not_found` is now treated as a model-level failure and advances to the next allowed model instead of killing the response.

As of **17 August 2026**, Groq's deprecation schedule has shut down `llama-3.1-8b-instant` and `llama-3.3-70b-versatile` for Free/Developer usage (shutdown date: 16 August 2026). The production defaults in this package therefore migrate those roles to GPT-OSS rather than trying the retired IDs first.

`qwen/qwen3.6-27b` is intentionally isolated to master-plan vision. It is a Preview model, so it is not a default customer-chat model.

`groq/compound` / `groq/compound-mini` are not used for verified inventory answers because their agentic tool behavior can introduce external information outside the platform's approved inventory. They are suitable later for an explicitly scoped tool workflow.

Whisper and Orpheus are not called yet because this release has no customer voice workflow. When voice input/output is added, use `whisper-large-v3-turbo` for STT by default and the matching Orpheus Arabic/English TTS model for speech output. Prompt Guard / Safeguard models are also Preview and are not placed in the production response path by default.

### 2. No silent paid OpenAI fallback

OpenAI is disabled unless **all three** are deliberately configured:

```env
OPENAI_FALLBACK_ENABLED=true
OPENAI_API_KEY=...
OPENAI_TEXT_MODEL=...
```

With the recommended production configuration below, the OpenAI API is never called, including by the admin health dashboard.

### 3. Better answer quality

Project details, developer details, inventory breakdowns, payment-plan explanations, investment/resale questions and comparisons now reach the AI with verified DB facts instead of being replaced early by terse canned strings.

Deterministic direct replies remain only where they protect exactness or trigger UI actions: media, brochure, location, distance, basic count/range and viewing flow.

The system prompt now requires a useful answer first, enough explanation to make a decision, compact paragraphs/bullets when helpful, and no compulsory closing question.

### 4. Resale is real data, not a UI label

- `Unit.isResale` is persisted in PostgreSQL.
- Each imported workbook sheet can be marked `Primary` or `Resale`.
- One button marks **all workbook sheets** as inventory.
- Imported units inherit the sheet market type.
- Inventory Admin filters and edits Primary/Resale.
- Customer intent recognizes `ريسيل`, `إعادة بيع`, `resale`, `secondary market`, `primary`, and `من المطور` and filters the DB accordingly.

### 5. Map-first location workflow

- Project boundaries are clicked/drawn directly on Google Maps as an editable Polygon.
- Project center latitude/longitude is calculated from the saved boundary; manual project coordinate fields were removed.
- Admin locations use Google geocoding + click/drag map pin instead of coordinate inputs.
- Location-to-location distance can be calculated from Google Routes; manual km/min remains only as an explicit fallback.
- Server and browser Google keys remain separate.

### 6. Mobile-first Cg Ai UI

- New `Cg Ai` identity: `Cg` is primary; `Ai` is subordinate.
- Deep ink/forest + restrained gold palette, warm neutral background.
- Suggested starter questions **only fill the composer**. They do not send automatically.
- Composer is multiline: Enter adds a line; Ctrl/Cmd+Enter sends; explicit send button remains primary.
- Removed the old global font-size hack and increased genuinely unreadable 7–10px chat/import text at component level.
- Admin home is tabbed and short instead of one long dashboard.

## Recommended production environment

Keep your existing secrets outside Git and replace only the routing values as needed:

```env
AI_PROVIDER=hybrid

GROQ_API_KEY=YOUR_KEY
GROQ_FAST_MODEL=openai/gpt-oss-20b
GROQ_GENERAL_MODEL=openai/gpt-oss-120b
GROQ_REASONING_MODEL=openai/gpt-oss-120b
GROQ_BACKUP_MODEL=openai/gpt-oss-20b
GROQ_LAST_RESORT_MODEL=openai/gpt-oss-20b
GROQ_VISION_MODEL=qwen/qwen3.6-27b
ALLOW_PREVIEW_GROQ_MODELS=false
ALLOW_UNLISTED_GROQ_MODELS=false

CLOUDFLARE_AI_ACCOUNT_ID=YOUR_ACCOUNT_ID
CLOUDFLARE_AI_API_TOKEN=YOUR_TOKEN
CLOUDFLARE_AI_FAST_MODEL=@cf/meta/llama-4-scout-17b-16e-instruct
CLOUDFLARE_AI_MODEL=@cf/openai/gpt-oss-120b

OPENAI_FALLBACK_ENABLED=false
OPENAI_API_KEY=
OPENAI_TEXT_MODEL=

GOOGLE_MAPS_SERVER_API_KEY=YOUR_SERVER_RESTRICTED_KEY
NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY=YOUR_BROWSER_HTTP_REFERRER_RESTRICTED_KEY
```

You can remove the legacy `GROQ_ARABIC_MODEL`, `GROQ_BACKUP_MODEL=llama-3.3-70b-versatile`, and `GROQ_GENERAL_MODEL=qwen/qwen3.6-27b` values from the deployed environment. The new router already protects against them, but removing stale variables makes operations clearer.

Do not expose `GOOGLE_MAPS_SERVER_API_KEY` to the browser. Create a second browser key restricted to the exact Cg Ai web origins for `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY`.

## How to test locally

No build, tests, migrations, or live provider calls were executed while preparing this rewrite, per the request. Run these yourself in a disposable/local environment first.

### A. Install + DB

```bash
npm install
npm run db:generate
npm run db:migrate:deploy
```

Use a staging/development copy of the database for the first migration run. The new migration adds `Unit.isResale` and `ImportSheet.defaultIsResale` with safe `false` defaults.

### B. Start both apps

Terminal 1:

```bash
npm run dev:api
```

Terminal 2:

```bash
npm run dev:web
```

Open the web URL shown by Next.js (normally `http://localhost:3000`). The API normally runs on port 4000 in this repo.

### C. AI checks

1. Ask a simple Arabic greeting. Check the server log `AIModelRoute`; it should choose FAST.
2. Ask a comparison such as: `أنهي أفضل للاستثمار وإعادة البيع بين الاختيارين وليه؟` It should choose REASONING.
3. Ask project/developer/payment-plan detail. Confirm the answer is explanatory rather than the old one-line canned reply.
4. Ask `عايز وحدات ريسيل` and then `عايز من المطور بس`. Confirm inventory results change with the market filter.
5. In Groq Console/API model permissions, make sure `openai/gpt-oss-20b` and `openai/gpt-oss-120b` are permitted for the project.
6. Optional failure-path check in development only: deliberately configure an invalid allowed model, restart the API, send one message, and verify the trace moves to a fallback model instead of ending at `model_not_found`. Restore the production model immediately afterward.
7. Confirm OpenAI shows no requests while `OPENAI_FALLBACK_ENABLED=false`.

### D. Customer mobile UI

Use a real phone or browser device mode at approximately 360–430px width:

1. Open a fresh conversation.
2. Tap any starter suggestion.
3. Confirm it **only appears in the textarea** and no network message is sent.
4. Add extra words/new lines.
5. Press Enter: it must create a new line, not send.
6. Press the send icon (or Ctrl/Cmd+Enter) and confirm it sends once.
7. Test Arabic, English and mixed Arabic/English answers for wrapping/overlap.

### E. Workbook + resale

1. Upload an XLSX with multiple sheets.
2. Click `اعتبر كل الشيتات مخزون`.
3. Mark at least one sheet `Resale` and another `Primary`.
4. Complete mappings and preview.
5. Confirm import.
6. Open Inventory and filter `Resale فقط`, then `Primary فقط`.
7. Confirm the imported units are in the correct market and can be edited individually.

### F. Maps

1. Set a browser-restricted `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY` and a separate server key.
2. Open a project → spatial/master-plan section.
3. Click at least 3 boundary points; drag Polygon vertices; save.
4. Reload and confirm the Polygon returns and the project location works without manually entering coordinates.
5. Open Locations; search an address, then click/drag the map pin and save.
6. Select two locations and click `احسب تلقائيًا من Google Routes`; confirm km/min fill automatically before saving.

### G. Dashboard

Open Admin home and switch between `نظرة سريعة`, `المخزون`, `الذكاء الاصطناعي`, and `تحتاج انتباه`. Only one operational section should be expanded at a time.

## Production deployment after your checks pass

```bash
npm run db:generate
npm run db:migrate:deploy
npm run build
```

Then start the API and web using your existing process manager/deployment commands. Do not reuse an old `apps/api/dist` or `apps/web/.next`; build fresh from this source package.

## Compatibility note

Internal workspace names, JWT issuer/audience, and the existing admin cookie identifier still use legacy `maqar` identifiers on purpose. They are not user-facing branding and were retained to avoid invalidating active sessions or breaking deployment scripts. Browser conversation/device storage migrates forward to `cgai-*` keys while preserving existing anonymous users.
