# Cg Ai — Spatial, Save & Unit Media Upgrade

Date: 2026-08-18

## What changed

### 1. Unit → building assignment is now explicit
- Removed the customer-facing/admin UI flow that showed fixed AI candidate lists and confidence percentages.
- Removed the old `master-plan/suggestions` and `master-plan/review` admin routes so the random-confidence workflow cannot be accidentally reused.
- The Master Plan Studio now has a searchable unit input.
- Search uses unit code plus imported raw `building`, `cluster`, `floor`, `phase` fields.
- Each result shows import provenance: file name, sheet and source row when available.
- Admin can add a unit to the selected building or remove it with one click.
- Manual assignment clears `masterPlanConfidence` and records the admin confirmation source.

### 2. Master Plan image precision
- Zoom range is now 100% → 800%.
- Browse mode supports drag-to-pan in addition to scroll/trackpad navigation.
- `انتقل للمحدد` zooms into the selected phase/building and centers it.
- Drawing still stores normalized coordinates, so zooming does not alter saved geometry.

### 3. Project map: 2D edit + 3D exploration
- 2D mode remains the precision editor for adding and dragging polygon points.
- 3D mode uses Google Maps JavaScript `maps3d` (`Map3DElement`) in HYBRID view with tilt, heading, zoom and exploration controls.
- The verified project polygon is rendered in 3D when present.
- A search box calls the existing server-side Places Text Search endpoint and moves either the 2D or 3D camera to the result.
- `ارجع للمشروع` recenters the current view.
- Search never changes the saved boundary by itself.

Google Cloud requirements:
- Browser key: enable **Maps JavaScript API** and restrict it by HTTP referrer.
- Server key: enable **Places API (New)** for the search box; keep the key server-side.
- Billing must be active for production Google Maps Platform use.

### 4. Save-state reliability
Root cause of the false failures was fixed: code paths were calling `event.currentTarget.reset()` after an `await`; React can clear `currentTarget` before that line executes. The server had already saved the record, then the UI threw `Cannot read properties of null (reading 'reset')`, which made a successful save look failed and encouraged duplicate retries.

Fixes:
- Capture `const formElement = event.currentTarget` before every async call that later resets a form.
- No remaining `currentTarget.reset()` calls in the web app.
- Top admin header now tracks concurrent mutations, not just the last HTTP request:
  - `جاري الحفظ…`
  - `جاري الحفظ · N عمليات…`
  - `تم حفظ كل التغييرات`
  - `فشل الحفظ` + Request ID when available.
- Publish readiness errors now include the actual missing requirements instead of only a generic English message.

### 5. Unit media matching by phase + layout characteristics
New model: `UnitMediaRule`.

A rule can target:
- project
- phase
- media item (IMAGE or FLOOR_PLAN)
- unit type / subtype
- bedrooms
- bathrooms
- minimum built-up area
- maximum built-up area
- priority

Example:
- Phase 2
- 3 bedrooms
- 3 bathrooms
- 240–280 m²

Result:
- 250 m² → matches
- 270 m² → matches
- 300 m² → does not match
- same 250 m² layout in another phase → does not match the Phase 2 rule

A unit-specific media upload overrides inherited rule media of the same media type. Example: if one unit has its own FLOOR_PLAN, the generic phase/area FLOOR_PLAN is suppressed for that unit, while generic IMAGE media can still be inherited if there is no unit-specific IMAGE.

The normal project/phase gallery is separated with `Media.purpose = GALLERY`; matching assets use `UNIT_MATCH` and do not pollute project gallery ordering/covers.

## Database migration

New migration:

```text
packages/database/prisma/migrations/20260818235900_unit_media_rules/migration.sql
```

It adds:
- `Media.purpose`
- `UnitMediaRule`
- FKs and indexes
- PostgreSQL trigger `cg_unit_media_rule_integrity`

The trigger rejects:
- media from a different project
- phase from a different project
- `minBuiltUpArea > maxBuiltUpArea`

## Deploy order

From repository root:

```bash
npm install
npm run db:generate
npm run db:migrate:deploy
npm run build -w @maqar/api
npm run build -w @maqar/web
```

Then redeploy API and Web.

## Manual QA

### Unit ↔ building
1. Open Project → Master Plan.
2. Select phase and building.
3. Search an imported unit code.
4. Confirm file / sheet / row source appears.
5. Add the unit.
6. Refresh; it must remain assigned.
7. Remove it using the × chip; refresh again.
8. No confidence percentages should appear anywhere in this workflow.

### Master Plan precision
1. Enter browse mode.
2. Zoom to 400–800%.
3. Drag the plan to pan.
4. Choose a small building and click `انتقل للمحدد`.
5. Enter building drawing mode and draw at high zoom.
6. Save and refresh; polygon geometry should stay in the same location.

### Project map
1. Project → النطاق.
2. In 2D edit mode draw/edit the project boundary.
3. Switch to 3D and rotate/tilt/zoom.
4. Search for `American University in Cairo` or another place.
5. Select a result and verify camera navigation.
6. Click `ارجع للمشروع`.
7. Return to 2D; boundary must remain unchanged.

### Save reliability
1. Create one building/gate/payment plan/media item.
2. Watch the top header: Saving → Saved.
3. Do not refresh during the mutation.
4. Refresh after Saved; exactly one record should exist.
5. Confirm browser console no longer shows `Cannot read properties of null (reading 'reset')`.

### Unit media rules
1. Project → Media → select Phase 2.
2. Add FLOOR_PLAN rule: beds=3, baths=3, area=240–280.
3. Open/search units at 250, 270 and 300 m².
4. 250/270 should receive the media; 300 must not.
5. Upload a direct FLOOR_PLAN for one matching unit; that unit must use its direct floor plan instead of the inherited one.

## Static checks performed before packaging
- TypeScript/TSX transpile syntax check for all modified source files: 0 syntax errors.
- No remaining `event.currentTarget.reset()` usage.
- Old master-plan suggestion/review routes removed.
- Media rule regression sample: 250/270 match, 300 does not; wrong phase/bed count does not match.
- SQL migration contains the integrity trigger and schema contains `UnitMediaRule`.

A full Next/Nest build still needs the repository dependencies installed in your environment/Railway, so run the build commands above before production promotion.
