# Nadim Brain V2

## Purpose and boundary

Nadim V2 is a new, channel-independent orchestration path. It does not call `ChatService`, the legacy intent/state loop, or the legacy hybrid response-decision pipeline. The legacy `/v1/conversations` flow remains available for rollback and comparison.

All transports normalize an event and call `POST /v2/nadim/turn`:

```text
WEB | WHATSAPP | PHONE | N8N
              |
              v
       Nadim gateway auth
              |
              v
Understand -> State -> Plan -> Tools -> Action Policy -> Compose -> Persist
```

The first arrow always starts with an inbound customer turn. Nadim does not initiate conversations, send an automatic opening, or expose an opening endpoint. A greeting-only first message may receive a short introduction; a first message that already contains a property request goes directly to useful work.

`NADIM_V2_ENABLED=true` is required to process a turn. The endpoint is service-to-service protected by `x-nadim-gateway-secret`; it is not public-user authentication and must be kept on Railway private networking for n8n/provider gateways.

## Pipeline

1. **Understand** produces a schema-validated `NadimUnderstanding`. GLM may interpret language, but explicit high-confidence facts are deterministically extracted and take precedence. Raw model JSON never becomes state without Zod validation.
2. **State** applies only explicit `SET`, `REMOVE`, `RESET`, and `PRESERVE` operations. Unmentioned constraints survive. Search results are persisted as IDs, not reconstructed from model memory.
3. **Plan** maps validated intent and state to typed tool calls. It cannot generate SQL or action success.
4. **Tools** call trusted application services and PostgreSQL-backed repositories. Tool errors become structured unavailable/not-found results.
5. **Action policy** permits proposals only for explicit customer requests and checks prerequisites. Execution goes through the private automation API, never directly from model output.
6. **Compose** receives verified tool/action results. Deterministic responses are used for property truth and action status; the dialogue model is limited to non-factual natural language composition.
7. **Persist** writes updated state and a complete turn trace transactionally.

## Personality and adaptive language

Nadim has one stable personality: an intelligent, calm, warm, confident, concise, commercially aware, trustworthy, polished and practical real-estate advisor. He is helpful without being pushy and human without becoming over-familiar. This identity does not change with language; only its expression changes.

Language style is detected before understanding and remains isolated from intent, search constraints, tool execution and action policy. The supported response styles are:

- `AR_EGYPTIAN`: polished, natural Egyptian Arabic;
- `AR_GULF`: neutral Gulf Arabic without Egyptian fillers;
- `AR_FORMAL`: clear modern Arabic without bureaucratic phrasing;
- `EN_US`: conversational American English;
- `FRANCO_ARABIC`: readable Arabizi using Latin script;
- `MIXED_AR_EN`: restrained mirroring of Arabic/English code-switching;
- `UNKNOWN`: resolved from conversation preference or locale fallback.

Resolution priority is an explicit current language instruction, an existing explicit preference, the latest confidently detected customer wording, recent conversation style, persisted preference, then locale. Instructions such as `كمل مصري`, `كلمني خليجي`, `رد بالعربي`, `رد بالإنجليزي`, `continue in English`, and `كلمني فرانكو` persist until another explicit language instruction changes them. Automatic detection uses conservative dialect markers and does not guess a Gulf country.

The style state is persisted inside the existing `NadimConversation.state` JSON, separately from `search`:

```json
{
  "languageStyle": {
    "detected": "AR_EGYPTIAN",
    "confidence": 0.95,
    "preferredResponseStyle": "AR_EGYPTIAN",
    "explicitOverride": false,
    "changedThisTurn": false
  }
}
```

Changing language cannot reset locations, budget, bedrooms, selected results, or any other search state. For example, an Egyptian search can switch to `Explain the payment plan in English` and later `كمل مصري` while retaining the same unit and constraints.

Greeting behavior is contextual:

- `السلام عليكم` on the first inbound turn can receive `وعليكم السلام، أنا نديم. قولّي بتدور على إيه وأنا أساعدك.`
- `Hi` can receive `Hey, I’m Nadim. What are you looking for?`
- `عايز شقة 3 غرف في التجمع` skips the introduction and answers the request directly.

Deterministic user-visible responses are styled through the same response-style service, including clarification, no-match, unknown facts, provider failure, reset, constraint changes, result presentation and action status. Typical equivalents include `مش ظاهر عندي نظام تقسيط موثّق للوحدة دي، فمش هخمن.`, `ما عندي خطة دفع موثقة للوحدة هذي، فما راح أخمن.`, `I don’t have a verified payment plan for that unit, so I won’t guess.`, and `mesh zaher 3andy payment plan mota2aked lel wa7da di, fa mesh hakhamen.`

Personality remains presentation-only. Result IDs, ordering, selection, price, rooms, area, availability, payment terms and action outcomes come from trusted deterministic results. Factual turns use deterministic rendering. The model receives the selected style, stable personality and verified context for eligible natural composition, but hard inventory and action-claim guards remain authoritative.

## Trusted and untrusted data

Untrusted inputs are channel payloads, message text, metadata, and every model response. DTO validation, the gateway guard, schema validation, deterministic state transitions, and typed tools form the trust boundary.

PostgreSQL data returned through `PropertySearchService`, explicit action-layer responses, database identifiers, and deterministic application decisions are trusted. A model cannot establish price, availability, payment terms, property identity, or action success. A missing verified fact is reported as unavailable.

## State model

`NadimState` is versioned (`version: 2`) and revisioned. It contains:

- channel/customer/external identity and locale;
- current goal and optional pending clarification;
- search locations, projects, developers, property types, rooms, area, budget, payment/delivery, purpose, finishing and ranking objective;
- selected unit/project and comparison unit IDs;
- ordered `lastResultIds` for references such as “التانية” and “قارن الأول والتالت”;
- the last explicit state operations.

A search reset clears search and result-selection state. A field removal changes only that field. No-match composition does not mutate or silently widen state.

`NadimConversation` and `NadimTurn` are separate V2 persistence records. A conversation can resolve through an explicit conversation ID, canonical customer, or channel identity. The same canonical customer can continue from another channel without creating a separate brain.

Inbound turns optionally use `x-idempotency-key`. The API stores the key per channel, a canonical SHA-256 request hash, and the exact response payload. A completed identical retry replays that response with `replayed: true`; different input under the same channel/key returns `409 IDEMPOTENCY_CONFLICT`. A pending concurrent duplicate returns `409 TURN_IN_PROGRESS` and never enters the brain or action layer. Keys are isolated by channel. If the header is absent, a normalized gateway may supply its canonical provider event ID as `metadata.eventId`.

## Tool system

The typed registry currently exposes:

- `PROPERTY_SEARCH`
- `GET_PROJECT_FACTS`
- `GET_UNIT_FACTS`
- `GET_PAYMENT_PLAN`
- `GET_AVAILABILITY`
- `COMPARE_PROPERTIES`
- `GET_MEDIA`
- `GET_LOCATION`
- `CUSTOMER_LOOKUP`
- `LEAD_LOOKUP`

Property tools reuse `PropertySearchService`; customer/lead lookup uses scoped Prisma reads. The registry maps V2 state into the existing deterministic search contract and returns compact verified records. It never accepts model-generated SQL.

## Models and fallback

`DialogueProvider` is an OpenAI-compatible provider boundary with completion, streaming, and health operations. V2 uses:

```text
Amazon Bedrock Mantle GLM 5 (`zai.glm-5`)
    -> on failure before visible output
Groq production dialogue model
    -> deterministic safe response when no model is available
```

If a streaming provider fails after emitting visible output, `DialogueStreamInterruptedError` terminates that response. Groq is not appended, preventing mixed-provider answers. GLM being disabled does not make the API unhealthy. When enabled without credentials, the protected V2 AI health endpoint reports the configuration failure.

## Actions

The domain lists future action types, but this slice executes only the lead-backed paths supported by the existing automation API: contact/callback, viewing request, and reservation request. Human handoff and unsupported actions remain `NOT_EXECUTED`.

Every execution has a request-derived idempotency key. The automation API remains the transactional authority. Only a `SUCCEEDED` response may produce success language. A reservation request is explicitly described as a follow-up request, not a reserved unit.

## Endpoint contract

Headers:

```http
x-nadim-gateway-secret: <NADIM_GATEWAY_SECRET>
x-idempotency-key: wa-message-123
Content-Type: application/json
```

Request:

```json
{
  "channel": "WEB",
  "conversationId": "optional-v2-conversation-id",
  "customerId": "optional-canonical-customer-id",
  "externalUserId": "optional-channel-user-id",
  "message": "عايز شقة في التجمع 3 غرف تحت 8 مليون",
  "locale": "ar-EG",
  "metadata": { "eventId": "wa-message-123" }
}
```

`channel` is one of `WEB`, `WHATSAPP`, `PHONE`, or `N8N`. `message` is required and limited to 8,000 characters. IDs, locale, metadata type, and unknown DTO fields are validated by the API's global validation policy.

Response:

```json
{
  "ok": true,
  "version": "v2",
  "replayed": false,
  "conversationId": "...",
  "reply": "...",
  "intent": { "type": "PROPERTY_SEARCH", "confidence": 0.9 },
  "state": {},
  "results": [],
  "proposedActions": [],
  "executedActions": [],
  "metadata": {
    "requestId": "...",
    "brainVersion": "v2",
    "modelProvider": "bedrock-glm",
    "model": "zai.glm-5",
    "fallbackUsed": false,
    "toolNames": ["PROPERTY_SEARCH"],
    "latencyMs": 42
  }
}
```

n8n/provider gateways should pass the immutable inbound provider event ID through `x-idempotency-key`. They must not generate a new UUID for each retry. The key is trimmed and limited to 200 characters. For compatibility, `metadata.eventId` is used only when the header is absent.

### Customer web adapter

The public browser posts to the same-origin Next.js route `POST /api/nadim/turn`. Only that server route reads `NADIM_GATEWAY_SECRET`; the secret and `x-nadim-gateway-secret` never enter the client bundle. Configure the web runtime with server-only `NADIM_API_URL` (prefer the private API URL) and `NADIM_GATEWAY_SECRET`. `NEXT_PUBLIC_API_URL` remains the fallback API location, not a credential.

The adapter posts a non-streaming WEB turn to `/v2/nadim/turn`, forwards the submitted event UUID as both `metadata.eventId` and `x-idempotency-key`, and persists the returned Nadim conversation ID on the existing web conversation shell. The existing history endpoints continue to supply refresh/list/delete behavior, but customer replies come only from Nadim V2. The legacy message and streaming endpoints remain available for rollback/admin comparison and are not called by the customer web component.

## Observability and health

Each persisted turn stores intent, plan, tool results, proposals, executions, model identity, fallback use, latency and error status. A compact structured log contains request/conversation/customer/channel, brain version, tools, model and action outcomes; prompts, messages, credentials and auth headers are not logged.

The admin-authenticated endpoint `GET /v1/admin/system/nadim-v2-ai-health` reports GLM and Groq status while preserving existing `ai-health` behavior.

## Rollout

1. Review and apply the additive Prisma migration in the target environment.
2. Deploy the API with V2 disabled and verify provider health.
3. Enable V2 on a private instance and run n8n/QA traffic with action execution disabled.
4. Compare V2 outputs and telemetry with the isolated legacy flow.
5. Enable private action execution, then migrate one channel/cohort at a time.
6. Deploy the web adapter variables and apply the additive web-conversation mapping migration before routing production web traffic.
7. Remove legacy orchestration only after an agreed observation window and data migration plan.

The migration is additive and this implementation does not apply it automatically.
