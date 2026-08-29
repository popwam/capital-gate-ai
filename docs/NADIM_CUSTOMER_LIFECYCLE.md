# Nadim customer lifecycle contracts

All `/v2/internal/*` endpoints require `x-nadim-gateway-secret`. They are not browser APIs.

## n8n endpoints

- `POST /v2/internal/conversations/human-activity`
  - Body: `{ "channel": "WHATSAPP", "externalUserId": "...", "providerMessageId"?: "...", "instance"?: "...", "occurredAt"?: ISO|string|epoch, "source"?: "...", "addressingMode"?: "..." }`
  - Response: `{ "recorded": boolean, "mode": "AI" | "HUMAN" | "PAUSED" }`
  - It only resolves an existing participant/conversation and only updates the timer in `HUMAN` mode.
- `POST /v2/internal/conversations/release-stale-human`
  - Body: `{ "inactiveForHours": 24 }`
  - Response: `{ "releasedCount": number, "released": [{ "conversationId": "..." }] }`
  - Releases ownership to AI without deleting context or sending a message.
- `POST /v2/internal/followups/claim-due`
  - Body: `{ "workerId": "n8n-whatsapp", "limit": 20 }`
  - Response: `{ "tasks": [{ "id", "conversationId", "channel", "outboundAddress", "text" }] }`
  - Claims use a compare-and-set lease. Deleted conversations and ordinary tasks in `HUMAN` conversations are excluded.
- `POST /v2/internal/followups/:id/sent`
  - Body: `{ "provider": "EVOLUTION", "providerMessageId"?: string | null }`
  - Idempotently records `SENT` and `sentAt`.
- `POST /v2/internal/followups/:id/failed`
  - Body: `{ "provider": "EVOLUTION", "reason": "..." }`
  - Releases a retryable claim or records terminal `FAILED` after three attempts.

## Sharing and channel continuation

Public URLs contain only a 256-bit opaque token. The database stores its SHA-256 hash. Web share tokens default to seven days and can be revoked; WhatsApp handoff tokens default to 15 minutes and one use. A join creates a `ConversationParticipant`, never merges customer identities, and preserves conversation ownership (`AI`, `HUMAN`, or `PAUSED`).

The browser uses same-origin routes. Server routes call guarded internal endpoints and never expose the gateway secret. `/c/[token]` creates a device-owned Web binding, copies the safe conversation transcript, and resumes the same Nadim conversation. WhatsApp handoff messages are intercepted and consumed before LLM processing.

Required deployment variables are `WEB_BASE_URL` and `WHATSAPP_BUSINESS_NUMBER` in addition to the existing Nadim server variables.

## Controlled inventory

Run intentionally with:

```bash
npm run db:seed:controlled
```

This upserts 18 marked `CONTROLLED_TEST` units across New Cairo and Sheikh Zayed. They are fixtures, not current commercial inventory.
