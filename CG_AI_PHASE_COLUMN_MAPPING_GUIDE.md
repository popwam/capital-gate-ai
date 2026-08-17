# Cg Ai — Phase column mapping

This patch changes inventory imports that contain more than one project phase in the same worksheet.

## New behavior

- If a source column is mapped to the canonical `phase` field, the sheet no longer requires one fixed `phaseId`.
- The importer reads **all rows**, extracts distinct phase values, counts how many units use each value, and matches each distinct value once.
- Existing phase names/codes auto-match.
- Admin-approved mappings are saved in `ProjectPhaseAlias` and are reused in future imports for the same project.
- Common variants normalize to the same alias, for example `Phase 1A`, `Phase 1-A`, `1A`, `P1A`, and `المرحلة 1A`.
- Unmatched values create **one blocking decision per distinct value**, never one error per unit row.
- `phaseId` is internal and is removed from normalized preview rows. The preview displays the source `phase` value only.
- A single-phase selector remains available only for files that do not contain/map a phase column.

## Database migration

New migration:

`packages/database/prisma/migrations/20260818233000_project_phase_aliases`

It creates `ProjectPhaseAlias` with:

- project relation
- phase relation
- original source value
- normalized source value
- unique alias per project
- database trigger that prevents an alias from pointing to a phase from another project

## Deploy

Run before the API build/deploy:

```bash
npm run db:generate
npm run db:migrate:deploy
```

Then build:

```bash
npm run build -w @maqar/api
npm run build -w @maqar/web
```

## Existing import

You do not need to re-upload the Excel file.

Open the existing import. If the `Phase` source column is already mapped to `phase`, the UI will show all distinct phase values and their unit counts. Map only the unknown values, then regenerate the preview once. Preview engine version is now 3, so older previews are considered stale automatically.
