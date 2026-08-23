# P1.1 Visual QA Manifest

Date: 2026-08-23

## Final captures

- `desktop-en-final.png` — 1440x1000, English/LTR, empty state with starter prompt drafted.
- `mobile-ar-final.png` — 390x844, Arabic/RTL, empty state with starter prompt drafted.
- `mobile-ar-chat-flow.png` — submission attempt showing the configured database's missing `Conversation.promptVariant` migration error path.

## Verified

- Root `html` direction and language switch between `ltr`/`en` and `rtl`/`ar`.
- No horizontal viewport overflow at either final viewport.
- English sidebar, empty state, starter labels, prompts, and composer are localized.
- Arabic mobile hierarchy, composer, starter cards, and navigation controls remain usable.
- Empty/loading and draft interactions produced no browser console or page errors after the localization fix.

## Blocked flow

The final submit request reached the local API but returned 500 because the configured database predates the `Conversation.promptVariant` column. Migration `packages/database/prisma/migrations/20260823150000_conversation_prompt_variant/migration.sql` was added and intentionally not applied by this QA run.

Earlier `desktop-ar.png` and `desktop-en.png` captures document the pre-fix comparison and are retained as visual evidence.
