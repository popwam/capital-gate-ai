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

## Reservation requests and sales opportunities

A reservation request is a resumable Nadim V2 pending action stored in the canonical conversation state. It retains the exact selected unit and collects only the missing customer name, phone, and payment method. Choosing the project payment plan forces a fresh verified payment-plan lookup for that exact unit before an action can be proposed.

`CREATE_RESERVATION_REQUEST` is execution-gated. It reaches the existing Automation API only when all of the following are configured:

- `NADIM_ACTION_EXECUTION_ENABLED=true`
- `NADIM_AUTOMATION_API_URL`
- `NADIM_AUTOMATION_SECRET`
- a supported customer channel and an exact unit

When the gate is disabled, unavailable, or rejects the request, Nadim keeps the pending action resumable and must not claim that the request was submitted. Enabling the gate is an explicit deployment decision; application code does not change it.

The Dashboard uses these distinct product concepts:

- Conversation: the customer communication thread and its AI/HUMAN ownership.
- Property requirement: an independent saved property brief, including recent matches and any selected unit.
- Sales opportunity (`Lead`): an actionable commercial event created by the authorized Automation API for explicit reservation, viewing, callback/contact, or another configured qualification policy.

A conversation or requirement alone does not create a sales opportunity. Therefore a zero opportunity count is valid when requests are still collecting fields or action execution is disabled. The pending reservation remains visible in conversation detail without fabricating a Lead.

For a Web conversation that requests WhatsApp follow-up, the task stores `channel=WHATSAPP` and the verified customer destination. The Web device identifier is never registered as a WhatsApp identity.

## Controlled inventory

Run intentionally with:

```bash
npm run db:seed:controlled
```

This upserts 18 marked `CONTROLLED_TEST` units across New Cairo and Sheikh Zayed. They are fixtures, not current commercial inventory.
