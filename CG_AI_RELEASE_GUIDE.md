# Cg Ai — Phase Workspace & Grounded AI Release Guide

This package is the source update for the uploaded `AICG(8)` project. It keeps the existing database history and legacy fields for compatibility, while moving the product toward a real hierarchy:

`Developer → Project → Phase / Community → Building → Unit`

The migration is additive. **Do not delete the old Neon data just to install this release.**

## 1. Project workspace redesign

The old long project form is replaced by a workspace with one sticky header and tabs:

- Overview
- Phases
- Market
- Media
- Payments
- Boundary
- Master Plan
- Knowledge

There is one top-level **Save** and one top-level **Publish** action. Form edits are kept as a local browser draft until Save. Publish first flushes pending project/phase/market/boundary/tag changes, then runs the existing customer-readiness rules.

### Overview

- Launch year is a selector.
- Project status is a selector.
- Project types are multi-select.
- Delivery statuses are multi-select.
- Arabic/English narrative content is grouped instead of scattered through a very long form.
- Amenities use a searchable system picker with removable chips.
- Typing a missing amenity offers a modal to create it once in the system.
- Competitors are selected from registered projects and become explicit comparison context for Cg Ai.
- Manual nearby-landmark entry is removed from the main project workspace.

## 2. Real phases instead of `numberOfPhases`

`ProjectPhase` is now a real database entity. A phase can have its own:

- code / Arabic / English name
- launch year
- delivery year
- status
- delivery statuses
- project/property-use types
- construction percentage
- unit types
- finishing options
- customer fit
- bedroom range
- area range
- Arabic/English description
- Arabic/English delivery notes
- master-plan polygon

Units, buildings, gates, payment plans, media, brochures, market profiles and import sheets can all be scoped to a phase.

### Existing units

Existing legacy `Unit.phase` text is preserved. After creating the real phases, use the button:

`مطابقة الوحدات القديمة بالمراحل`

It deterministically assigns unassigned units when the old phase text exactly matches a registered phase code/name. Unmatched units are reported for manual review. Customer publishing is blocked while active units remain without a real `phaseId`.

## 3. Inventory is no longer Excel-only

`Admin → Inventory` now contains:

- **إضافة وحدة** — add one unit manually.
- **استيراد Excel** — keep the existing bulk workflow.

The manual unit flow is:

`Developer → Project → Phase → optional Building → Unit`

If a developer, project or phase does not exist, it can be created inline without leaving the unit modal. A unit cannot be created without a phase.

The inventory table also exposes Phase / Building context and retains Primary / Resale filtering.

## 4. Phase-aware Excel imports

Import sheets can be assigned to a phase. If the workbook has a mapped phase column, the importer attempts to match each row against the registered phase code/name.

An unknown phase does **not** silently fall into a different phase. It becomes a blocking import issue that must be resolved before confirmation.

Primary / Resale remains persisted per sheet and per unit.

## 5. Market profiles: Investment / Resale / Rental

The old single commercial/investment block is no longer the main editing model.

A new `MarketProfile` supports three independent segments:

- Investment
- Resale
- Rental

And six property-use contexts:

- Residential
- Commercial
- Office
- Retail
- Hospitality
- Mixed

Profiles may exist at project, phase or unit level. This allows a phase or special unit to override the broader market profile instead of forcing one rating across the whole project.

Unit editing includes a unit-level market override editor.

## 6. Smart amenities and registered competitors

Amenities are reusable system entities. The Admin can search while typing, select an existing value, remove it with ×, or create a missing value in a modal.

Competitors are linked to actual registered projects. Cg Ai receives these registered competitors during comparison requests rather than inventing alternatives because only one project happens to be visible in the current form.

## 7. Project and phase media

Normal project media is intentionally simplified:

- `IMAGE` for project/phase gallery images.
- `BROCHURE` PDF for project/phase brochures.
- `MASTER_PLAN` is handled only in the Master Plan workspace.
- Unit media remains `IMAGE` / `FLOOR_PLAN`.

Gallery order is stored. Making an image Cover moves it to position **1** and reorders the remaining images.

A brochure can be project-wide or phase-specific.

## 8. Payment-plan inheritance

The payment designer now supports project defaults and phase overrides.

Default modes:

- Cash
- Installments

For installments, distribution defaults to **EQUAL** after the down payment. The installment table is not shown unless the Admin explicitly switches to custom distribution.

The first installment can start after a value expressed in:

- Days
- Months
- Years

This supports examples such as 4, 5 or 9 months after booking rather than forcing the first installment after one month.

The customer search layer resolves effective plans in this order:

`Project default → Phase override → Unit override`

## 9. Boundary map

Project coordinates are no longer intended to be typed manually in the workspace.

The Admin draws the project boundary as an editable polygon. Saving the polygon calculates the project center automatically. Clearing the polygon also clears the derived center, preventing stale “ghost” coordinates.

The browser Google Maps loader now reports authentication failures more clearly. Use a dedicated browser key with Maps JavaScript API + Billing + HTTP-referrer restrictions.

## 10. Master Plan workflow

The Master Plan workspace is separate from normal gallery media.

Workflow:

1. Upload the Master Plan image.
2. Draw a Phase / Community polygon.
3. Draw Building polygons inside it.
4. Place Gates manually.
5. Request unit-to-building suggestions.
6. Cg Ai proposes deterministic name/code matches with confidence.
7. Admin reviews the proposed unit assignments.
8. Confirmed units are linked to the building and, when applicable, its phase.

The AI does not silently finalize gates or unit placement. The Admin confirms the spatial model.

## 11. AI grounding fixes

The live transcript exposed four serious failure modes: generic help messages falling into inventory search, raw database IDs appearing in customer text, unsupported marketing claims, and guessed map distances/URLs.

This release changes that behavior.

### Help / small talk

`تقدر تساععدني ب اي` and similar variants are deterministic HELP turns. They do not run an inventory search.

### Conversation context

The customer state preserves the selected project/unit and last presented candidates. Follow-ups such as:

- `المشروع دا`
- `طيب المرحلة التانية؟`
- `بينه وبين الجامعة الأمريكية كام؟`

can resolve the current project rather than exposing or asking the user to understand an internal ID.

### Internal ID guard

CUID-like IDs and UUIDs are removed from final customer text. Compact AI context uses human-readable names rather than raw project/developer IDs.

### No unsupported marketing claims

The AI system context explicitly forbids inventing developer reputation, delivery promises, amenities, prices, distances or other facts not present in approved application context.

### Real distance tool

Distance requests now follow:

`selected project coordinates → destination Places lookup → Google Routes → verified answer`

If the project has no coordinates, the destination cannot be resolved, Maps is unavailable, or Routes returns no route, Cg Ai says a verified distance is unavailable. It does **not** estimate “3–4 km” itself.

Free-form model URLs are stripped from final customer text. Verified application UI actions remain the only place for route/media/brochure links.

### Registered comparison context

When the Admin links competitor projects, comparison requests fetch those registered projects and send their verified data to the reasoning layer.

## 12. Root `.env` loading

For local development, keep one file here:

```text
<repo>/.env
```

Both workspaces now load it:

- API: `apps/api/src/load-root-env.ts`
- Web: `apps/web/next.config.mjs`

Railway is unchanged: it should continue using per-service Variables. With no committed `.env`, Railway’s injected `process.env` is the source of truth.

The API default local port in this package is `8080`, so the sample uses:

```env
NEXT_PUBLIC_API_URL=http://localhost:8080
WEB_ORIGIN=http://localhost:3000
```

## 13. Database migration and Neon

New migration:

```text
packages/database/prisma/migrations/20260817193000_phase_hierarchy_market_profiles/migration.sql
```

It is additive and preserves existing project/unit/import data. It creates the phase hierarchy/scoped market records and adds nullable phase references to existing tables.

**Do not reset or delete the old Neon database as an installation step.** For maximum safety, make a Neon branch/backup first, then run the migration on that branch before production.

Recommended:

```bash
npm install
npm run db:generate
npm run db:migrate:deploy
```

Do not use `prisma db push` for the production database.

## 14. Local test order

### A. Start

```bash
npm install
npm run db:generate
npm run db:migrate:deploy
npm run dev:api
```

Second terminal:

```bash
npm run dev:web
```

Expected API success includes:

```text
PostgreSQL connection established
Nest application successfully started
API listening on 0.0.0.0:8080
```

### B. Project / phases

1. Open an existing project.
2. Verify the page is tabbed rather than one long form.
3. Create two phases with different delivery years and finishing options.
4. Change multiple fields and reload before Save: local drafts should survive.
5. Press the single top Save.
6. For existing inventory, run `مطابقة الوحدات القديمة بالمراحل`.
7. Review unmatched units instead of blindly assigning them.

### C. Manual inventory

1. Open Inventory.
2. Press `إضافة وحدة`.
3. Create a developer/project/phase inline in a test case if needed.
4. Add a Primary unit.
5. Add a Resale unit.
6. Verify Project / Phase / Building relations in the table and edit modal.

### D. Excel import

1. Upload a multi-sheet workbook.
2. Select Project and Phase per inventory sheet, or map a phase column.
3. Mark one sheet Primary and another Resale.
4. Preview.
5. Confirm that an unknown phase blocks confirmation rather than being guessed.

### E. Amenities / competitors

1. Type an existing amenity and select it.
2. Remove it with ×.
3. Type an unknown amenity and create it through the modal.
4. Verify it appears as a reusable suggestion.
5. Add registered competitor projects.

### F. Media

1. Upload 4 project images.
2. Make image #4 the Cover.
3. Verify it becomes #1 and the rest reorder.
4. Select a phase and upload phase-specific images.
5. Upload only a PDF brochure in the brochure area.
6. Verify Master Plan is absent from the normal gallery.

### G. Payments

1. Create a project default installment plan.
2. Keep Equal distribution and verify no giant custom schedule is required.
3. Set first installment after 9 months.
4. Create a different plan for one phase.
5. Switch to Custom distribution and verify the manual table appears only then.

### H. Maps

1. Configure separate server/browser Google keys.
2. Draw 3+ project-boundary points.
3. Move vertices and Save from the top header.
4. Reload and confirm the polygon returns.
5. Clear it and Save; confirm project center coordinates are also cleared.

### I. Master Plan

1. Upload a Master Plan.
2. Draw phase polygons.
3. Draw buildings.
4. Add/position gates manually.
5. Open Cg Ai unit/building suggestions.
6. Review high-confidence suggestions and confirm selected units only.
7. Verify units are linked to the chosen building/phase.

### J. AI regression conversation

Test these cases in one conversation:

```text
مساء الفل
تقدر تساععدني ب اي
```

The second reply must describe Cg Ai capabilities; it must not spontaneously recommend a 120 m² unit.

Then search/select a project and ask:

```text
المشروع دا بينه وبين الجامعة الأمريكية كام؟
```

Expected behavior:

- human-readable project name, never a CUID
- Google Routes distance/time if the project has verified coordinates and Maps is configured
- otherwise a clear “verified route unavailable” answer
- never a guessed distance
- never a model-generated Google Maps URL

Also verify that answers never expose strings resembling `cmss0tg3j009smb0p0xicxgtd` or UUIDs.

## 15. Validation status of this package

The preparation environment does not contain this repository’s installed `node_modules`, and outbound npm installation is unavailable here. Therefore a full Nest/Next/Prisma build was **not** claimed.

Checks performed on the modified source before packaging:

- `git diff --check`
- JavaScript syntax check for `apps/web/next.config.mjs`
- TypeScript/TSX parser/transpile syntax pass over every modified `.ts` / `.tsx` file
- deterministic customer-turn planner tests, including the Arabic typo HELP regression

Run the real dependency-backed checks on your machine after install:

```bash
npm run db:generate
npm run build
npm run smoke:api
```

Then run the feature checks above before deploying the migration to the production Neon branch.

## 16. Railway reminder

API service keeps secrets and server-only values such as:

- `DATABASE_URL`
- `GROQ_API_KEY`
- Cloudflare AI token/account
- R2 credentials
- `GOOGLE_MAPS_SERVER_API_KEY`
- `DEVICE_HASH_SECRET`
- Admin bootstrap credentials

Web service only needs browser/public configuration plus the Admin entry-path configuration required by the existing app, notably:

- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY`
- `ADMIN_ACCESS_PATH`

Never expose R2, Groq, database or server Google secrets as `NEXT_PUBLIC_*` variables.
