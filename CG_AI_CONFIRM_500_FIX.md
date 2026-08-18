# Cg Ai — Import confirm 500 hardening

This patch keeps the phase-column mapping build and hardens the final `/confirm` step.

## What changed

- Confirmation database errors are translated into actionable API errors instead of raw HTTP 500s.
- Missing `ProjectPhaseAlias` migration returns `IMPORT_SCHEMA_OUT_OF_DATE` and tells the admin to run `db:migrate:deploy`.
- Hierarchy/foreign-key conflicts return `IMPORT_RELATION_CONFLICT`.
- Duplicate unit identity conflicts return `IMPORT_DUPLICATE_UNIT`.
- Audit logging is now non-blocking: a successful inventory transaction cannot be turned into a false HTTP 500 just because the audit insert failed.
- The API logs `ImportConfirmFailure` / `ImportTransactionFailure` with request id and Prisma code.
- The Web confirmation action now uses the common `adminErrorMessage()` mapper, so the real safe error is shown in the UI.

## Deploy check

The current source contains **15 Prisma migrations**. Railway API logs should therefore show `15 migrations found` and apply:

`20260818233000_project_phase_aliases`

If Railway still reports `14 migrations found`, the deployed API source is older than this build or the migration directory was not included.

Run on API before retrying confirmation:

```bash
npm run db:generate
npm run db:migrate:deploy
```

Then restart/redeploy API.

## Important check after an existing 500

Before pressing Confirm again, refresh the import page:

- If status is **COMPLETED** and units exist, the transaction succeeded and the previous 500 was probably post-transaction (for example audit logging). Do not re-import.
- If status is **READY / NEEDS_INPUT**, the inventory transaction rolled back and it is safe to fix the reported issue and retry.
