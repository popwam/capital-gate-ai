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

1. **Understand** first identifies what the customer is doing, then produces a schema-validated `NadimUnderstanding`. Customer-service intents such as assistant identity, normal conversation, callback, handoff, reset and current-state questions are independent from property inventory. Short references are resolved against active state before `UNKNOWN`; GLM may interpret noisy language, while explicit high-confidence facts still take precedence. Raw model JSON never becomes state without Zod validation.
2. **State** applies only explicit `SET`, `REMOVE`, `RESET`, and `PRESERVE` operations. Unmentioned constraints survive, and greeting, assistant-identity, state-query, small-talk, and unknown intents cannot mutate search state. Search results are persisted as IDs, not reconstructed from model memory.
3. **Plan** maps validated intent and state to typed tool calls. `PROPERTY_SEARCH` runs only when inventory results are requested or a search mutation requires new results. Identity, state queries, rejected relaxations, language requests, callbacks, handoff, greetings, gibberish, and plain resets do not execute it. The planner cannot generate SQL or action success.
4. **Tools** call trusted application services and PostgreSQL-backed repositories. Tool errors become structured unavailable/not-found results.
5. **Action policy** permits proposals only for explicit customer requests and checks prerequisites. Execution goes through the private automation API, never directly from model output.
6. **Compose** receives verified tool/action results. Deterministic responses are used for property truth and action status; the dialogue model is limited to non-factual natural language composition.
7. **Persist** writes updated state and a complete turn trace transactionally.

## Personality and adaptive language

Nadim has one stable personality: an intelligent, calm, warm, confident, concise, commercially aware, trustworthy, polished and practical real-estate advisor. He is helpful without being pushy and human without becoming over-familiar. This identity does not change with language; only its expression changes.

Inbound language is detected before understanding and remains isolated from intent, search constraints, tool execution and action policy. `inputLanguage` is a current-turn comprehension signal; `preferredResponseStyle` is the sticky persisted output contract. Understanding English, Arabic, Franco, mixed wording, or noisy input does not itself authorize an output-language change. The supported styles are:

- `AR_EGYPTIAN`: polished, natural Egyptian Arabic;
- `AR_GULF`: neutral Gulf Arabic without Egyptian fillers;
- `AR_FORMAL`: clear modern Arabic without bureaucratic phrasing;
- `EN_US`: conversational American English;
- `FRANCO_ARABIC`: readable Arabizi using Latin script;
- `MIXED_AR_EN`: restrained mirroring of Arabic/English code-switching;
- `UNKNOWN`: resolved from conversation preference or locale fallback.

Response resolution priority is an explicit current language instruction, an explicit persisted preference, the established `preferredResponseStyle`, channel/conversation locale, then the safe Arabic default. Instructions such as `كمل مصري`, `كمل خليجي`, `رد بالعربي`, `رد بالإنجليزي`, `continue in English`, and `kamel franco` persist until another explicit language instruction changes them. `inputLanguage` still detects meaningful English and Franco for comprehension, but it is never used as an automatic response-language switch. Latin script alone is not language consent: `What's your name?` can be understood in an Egyptian conversation and answered in Egyptian Arabic, while `svgsvg` remains `UNKNOWN` and receives the established style's clarification.

The style state is persisted inside the existing `NadimConversation.state` JSON, separately from `search`:

```json
{
  "languageStyle": {
    "inputLanguage": "EN_US",
    "detected": "EN_US",
    "confidence": 0.95,
    "preferredResponseStyle": "AR_EGYPTIAN",
    "explicitOverride": false,
    "explicitRequestThisTurn": false,
    "changedThisTurn": false,
    "grammaticalAddress": "MASCULINE",
    "grammaticalAddressExplicit": false,
    "grammaticalAddressChangedThisTurn": false
  }
}
```

Changing language cannot reset locations, budget, bedrooms, selected results, or any other search state. For example, an Egyptian search remains Egyptian when the customer says `What's my budget?`, switches only after `Reply in English`, and can later use `كمل مصري` while retaining the same unit and constraints.

`grammaticalAddress` controls conversational agreement only; it is not customer gender or demographic identity. Strong current-turn forms such as `عايزة` or `3ayza` may set it, explicit address preferences take precedence, conflicting evidence becomes neutral, and Nadim never mentions the detection. The most recent assistant wording is retained as bounded conversation-style context so composition can avoid verbatim repetition without changing facts.

Greeting behavior is contextual:

- `السلام عليكم` on the first inbound turn can receive `وعليكم السلام، أنا نديم. قولّي بتدور على إيه وأنا أساعدك.`
- `Hi` with an English locale or explicit English preference can receive `Hey, I’m Nadim. What are you looking for?`
- `عايز شقة 3 غرف في التجمع` skips the introduction and answers the request directly.

Assistant identity is deterministic: `اسمك اي`, `انت مين`, `What's your name?`, and `Who are you?` return a brief style-aware Nadim identity response without inventory, state reset, or search execution.

Deterministic user-visible responses are styled through the same response-style service, including clarification, no-match, unknown facts, provider failure, reset, current-turn state changes, result presentation and action status. Customer-facing presentation turns numeric budgets into spoken amounts such as `10 مليون` or `10M EGP`, maps property enums to natural labels, and acknowledges mutations without narrating state-engine operations. State questions and rejections use micro-responses; search and comparison turns retain the detail their function requires. A no-match statement is allowed only after a successful `PROPERTY_SEARCH` returns zero verified rows; active filters alone are never treated as proof of why the result is empty. Unintelligible turns preserve state, run no tool, and receive a style-aware clarification.

Personality remains presentation-only. Result IDs, ordering, selection, price, rooms, area, availability, payment terms and action outcomes come from trusted deterministic results. Factual result turns use deterministic rendering. For a verified empty search, the model receives explicit search-execution/result-count facts plus the preceding persisted user/assistant turn, and may vary only the cause-free surface wording; a semantic guard rejects missing no-match meaning, invented blockers, robotic phrases, and unverified inventory claims. The deterministic style-aware response remains the provider fallback.

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

The public browser posts turns to the same-origin Next.js route `POST /api/nadim/turn` and accesses conversation history through the allowlisted `/api/backend/v1/...` server proxy. Only server routes read `NADIM_API_URL`, `INTERNAL_API_URL`, and `NADIM_GATEWAY_SECRET`; private API locations, the secret, and `x-nadim-gateway-secret` never enter the client bundle. Production must configure the server-only private API URLs and gateway secret. Public chat has no `NEXT_PUBLIC_API_URL` dependency.

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
