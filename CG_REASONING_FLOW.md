# Cg reasoning flow — current implementation

This document describes the code currently on disk. It is an implementation trace, not a target architecture or redesign proposal.

## 1. Executive summary

Cg is a **hybrid system whose decision state is primarily deterministic**:

- An LLM (Cloudflare Workers AI in the configured hybrid path) proposes PATCH-like `StructuredIntent` fields for the latest turn.
- Deterministic code merges that patch with persisted state, re-derives explicit constraint operations from the raw message, and can restore or delete whole constraint groups regardless of what the LLM proposed.
- Prisma queries, not the LLM, decide which inventory records exist and are `AVAILABLE`.
- Deterministic scoring and sorting decide result order. `queryObjective` represents `CHEAPEST`, `MOST_EXPENSIVE`, or `BEST_MATCH`.
- Database-backed factual turns are now rendered deterministically from structured verified facts. The answer LLM is not allowed to introduce project, developer, location, price, type, payment, amenity, or availability claims on those turns.
- The LLM remains important for ambiguous/open-ended intent extraction and non-database conversational wording. A small high-confidence deterministic patch supplements successful extraction for explicit budgets/ranges, bedrooms, known property types, explicit locations, and ranking objectives.

The authoritative memory is `ConversationState.searchContext`, with `suggestedUnitIds` and `presentation` supplying entity/UI continuity. Browser state is optimistic UI/cache, not the reasoning authority.

Current local configuration sets `AI_PROVIDER=hybrid`. Production also defaults to hybrid; a development environment with no explicit setting defaults to `DemoAIProvider` (`apps/api/src/providers/ai-provider.factory.ts:createAIProvider`).

## 2. End-to-end reasoning pipeline

### Pipeline overview

```text
Composer / starter action
  -> ChatApp.send
  -> create conversation when activeId === "fresh"
  -> POST /v1/conversations/:id/messages/stream
  -> ConversationsController.stream
  -> ChatService.prepare
       ownership + persisted user message + last 20 messages + persisted searchContext
       -> planCustomerTurn
       -> HybridAIProvider.extractIntent (Workers AI + high-confidence deterministic patch; full deterministic fallback)
       -> normalizeRealEstateSemantics / constraint + objective lifecycle
       -> applyDeterministicTurnSemantics
       -> database/tool branch in ChatService
       -> PropertySearchService filters + verified lookup + database price order / deterministic match ranking
       -> persist updated ConversationState
       -> deterministic verified presenter for database-factual turns
       -> otherwise compact AnswerInput / optional HybridAIProvider.streamAnswer
            Groq route/model fallbacks -> optional OpenAI -> Workers AI
  -> sanitize / grounding contradiction check / first-turn intro
  -> persist assistant Message + toolPayload
  -> SSE token events + complete event
  -> ChatApp appends normalized message
  -> RichChatText + deterministic structured UI renderers
```

### Stage-by-stage trace

| Stage | File and main symbol | Input -> output | Kind | Persistent state read / written | Override and guardrail behavior |
|---|---|---|---|---|---|
| 1. Send UI | `apps/web/components/chat-app.tsx:ChatApp.send` | Textarea/starter value -> optimistic user `Message`, `generating=true` | Deterministic UI/state transformation | Reads cached `activeId`, active conversation and `closed`; writes React state and later localStorage cache | Blocks empty, concurrent, or closed sends. The user message is visible before network completion. |
| 2. Conversation selection/creation | `ChatApp.send`, `newChat`; `apps/web/lib/chat-state.ts` | `activeId === "fresh"` -> `conversationsApi.create(title)` -> real conversation ID | Deterministic UI + API/database creation | Browser persists `cgai-active-conversation`; database writes `Conversation` and stable `promptVariant` | `skipHistoryOnceRef` prevents a just-created conversation from being overwritten by an early history fetch. `mergeConversationIndex` protects local messages from a stale list response. |
| 3. API client and device identity | `apps/web/lib/api.ts:getDeviceToken`, `conversationsApi.stream` | Content, optional display text, device token -> HTTP/SSE request | Deterministic transport | Reads/writes browser `cgai-device-id` | Device token is sent as `x-device-token`; JSON/SSE parse failures become frontend send failures. |
| 4. HTTP validation/rate limit | `apps/api/src/main.ts:bootstrap`; `apps/api/src/conversations.controller.ts:ConversationsController.stream` | HTTP body/header -> validated `SendMessageDto` and controller call | Validation/guardrail | No conversation mutation itself | Global whitelist validation rejects extra/invalid fields; content is non-empty, string, max 8,000 chars. Stream endpoint is limited to 20 requests/minute. Token must be at least 20 chars. |
| 5. Ownership | `apps/api/src/conversations.service.ts:owned/assertOwned`; `DevicesService.resolve` | Conversation ID + raw device token -> owned `Conversation` | Database lookup + authorization | Reads `AnonymousDevice`, `Conversation`; updates device `lastSeenAt` | Conversation must belong to the HMAC-hashed device identity. |
| 6. Load memory and persist user | `apps/api/src/chat.service.ts:ChatService.prepare` | Conversation + content -> history, `previous`, `isFirstTurn` | Database lookup/persistence | Writes the USER `Message` first; reads `ConversationState.searchContext`, `suggestedUnitIds`, `summary`, last 20 messages | A persisted `presentation.conversationClosed` rejects the turn. State and history from the database are authoritative. |
| 7. Coarse turn planning | `apps/api/src/customer-turn-planner.ts:planCustomerTurn` | Raw latest message + previous `StructuredIntent` -> `TurnPlan` | Deterministic code | Reads `previous.presentation` (offered action, confirmation/handoff state, candidate presence) | Regex/rule routing selects search, refinement, details, payment, media, aggregation, small talk, out-of-domain, etc. Constraint operations or a ranking objective force a search/refinement plan. |
| 8. Intent extraction | `apps/api/src/providers/hybrid.provider.ts:HybridAIProvider.extractIntent`; `CloudflareWorkersAIProvider.extractIntent` | Last 10 messages + previous state -> proposed `StructuredIntent` patch | **LLM reasoning**, deterministic supplementation, then validation | Previous state is included in the extraction prompt | Workers AI is the normal extractor. `highConfidenceIntentPatch` supplements explicit budget/range, bedroom, known type and location values even when a successful model response omits them. Provider failure still uses `deterministicIntent`. |
| 9. Structured-output sanitation | `apps/api/src/providers/provider-utils.ts:sanitizeIntent`; `apps/api/src/providers/ai-schemas.ts:validateIntent` | Untrusted JSON -> bounded typed fields | Validation/guardrail + state merge | `sanitizeIntent` copies `previous` first and replaces only accepted values | Unknown enum values/operation shapes are discarded. Zod failure returns `{language, extractionDegraded:true}`. In the Workers path, JSON is parsed and sanitized before the second Zod validation. |
| 10. Semantic merge and constraint lifecycle | `apps/api/src/providers/real-estate-semantics.ts:normalizeRealEstateSemantics`; `constraint-lifecycle.ts` | Proposed intent + raw source + previous state -> effective intent | Deterministic state transformation | Reads all previous search fields; produces the state that will be persisted | Merge order is previous -> extracted patch -> high-confidence patch -> explicit operations. Raw-text operations are applied last. Single-dimension `RESET` clears its mapped group; type-detail questions deterministically preserve `PROPERTY_TYPE`. |
| 11. Final deterministic turn semantics | `customer-turn-planner.ts:applyDeterministicTurnSemantics`; `CustomerTrustService.applyConversationPreferences` | Effective extraction + `TurnPlan` -> final turn state | Deterministic state transformation | Reads prior `presentation`; mutates language/dialect, explicit type/budget/payment fields, intent, aggregation and trust preferences | Explicit current-turn patterns run after LLM extraction and therefore override it. This is also where confirmed no-match widening is applied. |
| 12. Orchestration branch | `ChatService.prepare` | `TurnPlan`, final state and prior entity context -> selected database/tool operation | Deterministic orchestration | Reads `presentation`, prior suggested unit IDs; may mutate `presentation` and selected entity fields | Exact-unit, project, payment, media, brochure, distance, aggregation and generic property search are separate branches. The LLM does not choose arbitrary tools. |
| 13. Query construction | `apps/api/src/property-search.service.ts:normalizedWhere`, `resolveLocations`, `normalizedSearchFilters` | `StructuredIntent` -> Prisma `UnitWhereInput` and traceable filters | Deterministic code + database lookup | Reads filter fields only; does not mutate conversation state | Always requires `status=AVAILABLE` and `archivedAt=null`. Budget becomes `price.gte/lte`; purpose requires a project investment profile with `verifiedAt` and the matching suitability flag; approved aliases include descendant locations. An unresolved requested location returns no results rather than silently removing it. |
| 14. Verified inventory lookup | `PropertySearchService.searchProperties` and specific lookup methods | Prisma filters -> database units/projects/media/documents/routes | Database/data lookup | Reads current catalog, approved aliases/knowledge, verified amenities/distances and active plans | Exact and generic unit lookup exclude archived/unavailable inventory. Project knowledge is `APPROVED`; amenities/competitors/portfolio/landmarks use their verification fields. |
| 15. Ranking | `PropertySearchService.searchProperties` | Database-ordered candidate rows -> scored/sorted top `limit` (default 8) | Database ordering + deterministic code | No conversation mutation | Explicit `CHEAPEST`/`MOST_EXPENSIVE` pushes price ordering (nulls last) into Prisma before `take`, so the first result is global over the active verified filters. Default best-match retains freshness-pool scoring. Ranking never removes active constraints. |
| 16. No-match and presentation decision | `ChatService.prepare`; `DeterministicAnswerService.directToolAnswer` | Property result count plus auxiliary facts -> presentation/direct answer | Deterministic state transformation + guardrail | Replaces `searchCandidateIds`; clears selected/last-presented IDs on zero results | No-match is based on `properties.length`, not combined auxiliary facts. Wording lists only active constraints and never claims an unchanged budget when none is active. Widening remains opt-in. |
| 17. Persist reasoning state | `ChatService.finishPreparation` | Effective state + result IDs -> transaction | Database persistence | Updates `searchContext`, `suggestedUnitIds`, `intentScore` | A generic property search replaces `suggestedUnitIds` even with `[]`, preventing stale candidate revival. State still commits before response persistence. |
| 18. Context/prompt construction | `apps/api/src/providers/ai-context.ts:compactAnswerInput`, `advisorMessages`; prompt loader/registry | Last history, effective state, verified facts, approved knowledge -> bounded model messages | Deterministic transformation + prompt guardrail | Reads persisted summary when present; no state mutation | `queryObjective` is included in compact state. Facts are reduced to public fields and ranking metadata is removed. This context remains available for non-factual model turns and provider compatibility. |
| 19. Verified answer selection / model routing | `ChatService.finishPreparation`; `DeterministicAnswerService`; `PropertyPresenterService`; `conversation-model-router.ts` | Verified database facts -> deterministic prose; non-database turn -> optional provider route | Deterministic guardrail, optionally LLM generation | No conversation state mutation | Any `requiresDatabase` turn without an existing direct answer is hard-gated through `verifiedFactsAnswer` or a deterministic unavailable response. The model router is reached only when the turn is not database-factual and has no deterministic answer. |
| 20. Provider fallback | `HybridAIProvider.composeWithGroqRoute/streamAnswer` | Provider response/error -> answer or safe service error | Validation/reliability guardrail | Writes AI usage telemetry | Groq models are tried in order. HTTP 413 triggers aggressive compaction. With OpenAI fallback disabled, Workers AI is the compatibility fallback; when enabled, OpenAI is tried before Workers. A stream that already emitted content does not switch providers. |
| 21. Final output guardrails | `ChatService.send/stream`; `ConversationFormatterService`; `PropertyPresenterService` | Deterministic verified or non-factual model answer -> sanitized final answer | Validation/guardrail + deterministic override | No state mutation yet | Database-backed property claims come only from verified structures. Sanitization and the older contradiction check remain defense-in-depth for any model path. First-turn Cg/time greeting is deterministic. |
| 22. Persist and emit answer | `ChatService.persistAssistant`; `ConversationsController.stream` | Final text + deterministic payload -> ASSISTANT row and SSE events | Database persistence + transport | Writes assistant `Message.content` and `toolPayload` | The assistant row is created before `complete`. Although the provider may stream, `ChatService.stream` buffers the entire answer, validates it, then emits 180-character `token` chunks followed by `complete`. |
| 23. Frontend reconciliation/render | `ChatApp.send`, `normalizeMessage`, `MessageView`, `RichChatText`, `PropertyResults` | SSE tokens/complete payload -> React messages and structured components | Deterministic UI/state transformation | Writes browser cache; server messages remain authoritative after reload | Temporary text is shown while generating; the persisted complete message replaces it. Message IDs are deduplicated. React renders text/limited `**bold**` without raw HTML; cards/maps/media come from server-created `uiActions`, not free-form model markup. |

## 3. State lifecycle

### Authoritative state

`StructuredIntent` is defined in `apps/api/src/providers/ai-provider.ts`. The authoritative durable copy is Prisma `ConversationState.searchContext` (`packages/database/prisma/schema.prisma`). Important adjacent memory is:

- `ConversationState.suggestedUnitIds`: current property-search result IDs. A zero-result replacement search persists `[]`; non-search turns leave the field unchanged.
- `StructuredIntent.presentation`: candidate IDs, selected unit/project, presented IDs, last offered action, confirmation/handoff state and closed state.
- `ConversationState.summary`: included in answer context when present; current code writes it during lead handoff, not on every chat turn.
- Last 20 persisted `Message` rows: passed into extraction; compacted to 8 or 4 for answer generation.
- `Conversation.promptVariant`: assigned at conversation creation and logged with usage. Current `buildMessages` loads registry prompts without consulting `input.promptVariant`, so the stored assignment does not currently select different prompt text.

### Write ordering

1. Persist USER message.
2. Load previous `searchContext` and history.
3. Compute effective state and query verified data.
4. Persist new `searchContext` and result IDs.
5. Generate/validate final wording.
6. Persist ASSISTANT message and deterministic `toolPayload`.
7. Emit SSE `complete`.

Consequences:

- A failed answer provider does not roll back the user message or state mutation.
- A transient frontend error message is local only; it is not an ASSISTANT database row and disappears when authoritative history is reloaded.
- Browser localStorage improves continuity but does not feed `StructuredIntent`; server state owns reasoning memory.

### Current-turn precedence

For search state, practical precedence is:

1. Deterministic assignments in `applyDeterministicTurnSemantics`.
2. Explicit constraint operations reapplied from the raw current message.
3. High-confidence explicit value patch.
4. Accepted LLM patch fields.
5. Persisted previous fields.

This makes explicit remove/preserve/reset/broaden instructions stronger than a conflicting extraction result. Final type/budget parsing checks current clearing operations so it cannot re-add a group removed in the same turn. Ambiguous values outside the high-confidence subset remain an LLM responsibility.

## 4. Constraint mutation semantics

There is no explicit `SET` or `UPDATE` operation in the type. They are implicit field patches: a valid new value replaces the inherited value. Explicit operation metadata is limited to `REMOVE | RESET | BROADEN | PRESERVE`.

| Concept | Actual implementation | Effect |
|---|---|---|
| SET / UPDATE | `sanitizeIntent` accepted fields; `deterministicIntent`; explicit assignments in `applyDeterministicTurnSemantics` | New supplied value replaces the previous field; omitted fields inherit previous values. |
| REMOVE | `inferConstraintOperations` or model `constraintOperations`; `applyConstraintOperations` | Deletes all real keys mapped to that constraint group. |
| PRESERVE | Same path | Restores the whole constraint group's keys from `previous`, overriding conflicting model output. |
| BROADEN dimension | Same path | Deletes that dimension's mapped keys. It does not discover nearby alternatives itself. |
| BROADEN SEARCH | `applyConstraintOperations` | Deletes `PURPOSE`, `PROPERTY_TYPE`, `LOCATION`, `PROJECT`, and `DEVELOPER`; deliberately preserves budget/payment. |
| RESET SEARCH | `applyConstraintOperations` | Removes all listed search constraint groups. |
| RESET one dimension | `applyConstraintOperations` clears `constraintKeys(dimension)` | Resets only the named group and preserves every unrelated group. |

Real group mappings include:

- `BUDGET`: `budgetMin`, `budgetMax`, `budgetFlexible`, `budgetFlexibility`, `priceTarget`, `priceMin`, `priceMax`, rejected price bounds and `currency`.
- `PROPERTY_TYPE`: `propertyTypes`.
- `LOCATION`: `locations`, `rejectedLocations`, `maxTravelMinutes`.
- `PURPOSE`: `purpose`, `investmentRequirements`.
- Other groups map bedrooms/bathrooms, unit area fields, project/developer fields, payment fields, delivery and proximity fields.

Removing or resetting `BUDGET` also clears `currency`; it cannot leave a hidden currency predicate behind.

`searchRelaxationAuthorized` is current-turn metadata. It is true for a non-`PRESERVE` operation or an explicit ranking request, allowing a deliberately unbounded cheapest/most-expensive lookup after constraints were removed. It does not itself delete any filter.

No-match widening is explicit:

1. A zero-result search sets `presentation.lastOfferedAction="SEARCH_WIDEN"` and `awaitingConfirmation=true`.
2. A later affirmative recognized by `planCustomerTurn` sets `widenSearch=true`.
3. `applyDeterministicTurnSemantics` applies `BROADEN SEARCH` and authorizes the relaxed query.

## 5. LLM vs deterministic responsibility

| Responsibility | LLM | Deterministic code | Database |
|---|---:|---:|---:|
| Interpret open-ended Egyptian Arabic into structured values | Primary Workers AI path | Fallback and explicit-pattern supplementation | No |
| Preserve omitted state | Prompted | Enforced by `sanitizeIntent` previous-state merge | Stores previous state |
| Preserve/remove/broaden the example's constraint groups | Proposes operations | Re-inferred from raw text and enforced | No |
| Select orchestration/tool branch | No | `planCustomerTurn` + `ChatService` | No |
| Decide what inventory exists | No | Constructs filter | Prisma/catalog is authoritative |
| Exclude unavailable/archived inventory | No | Enforced query predicates | Supplies status/data |
| Resolve approved location aliases | No | Query logic | Supplies approved aliases/hierarchy |
| Rank matches/cheapest | No | Match scoring and final tie-breaking | Prisma applies global price order for explicit cheapest/most-expensive and supplies facts |
| Decide no-match | No | Empty result + deterministic response/presentation | Empty result set |
| Generate database-factual wording | No | `DeterministicAnswerService` / verified presenters | Supplies verified facts |
| Generate non-database conversational wording | When no direct answer exists | Context construction and sanitization | No property claims supplied |
| Create property cards/actions | No | `ChatService` + presenters | Supplies verified records |
| Maintain conversation memory | No | Merge/mutation/persistence logic | `ConversationState` is authoritative |

## 6. Real multi-turn example

### Scope and certainty

The exact unit rows depend on the live catalog, so they are not invented here. The explicit range is now guaranteed by `highConfidenceIntentPatch` even if a successful Workers response omits it; provider failure reaches the same state through `deterministicIntent`. Tests cover the state flow, Prisma query and deterministic verified wording.

Fields shown are real `StructuredIntent` or normalized-query fields. `absent` means the key is `undefined`, not a guessed value.

### Turn 1 — `عاوز وحدة في حدود 3-5 م`

Responsibility:

- LLM normal path may extract the range, but the high-confidence deterministic patch enforces `budgetMin=3000000`, `budgetMax=5000000`, `currency="EGP"`.
- Deterministic fallback extracts the same range if Workers fails.
- Deterministic planner: `PROPERTY_SEARCH`, `requiresExtraction=true`.
- Database: decides whether any `AVAILABLE`, non-archived EGP units exist in the range.

```yaml
budgetMin: 3000000
budgetMax: 5000000
currency: EGP
budget operation/state: SET by current turn; persisted

propertyTypes: absent
property type operation/state: inherited absence

locations: absent
location operation/state: inherited absence

purpose: absent
purpose operation/state: inherited absence

queryObjective: BEST_MATCH
searchRelaxationAuthorized: absent

verified inventory filters:
  unitType: []
  priceMin: 3000000
  priceMax: 5000000
  locationIds: []
  availability: [AVAILABLE]
  currency predicate: EGP
  archivedAt: null
```

If results exist, deterministic ranking defaults to match score then lower price. If none exist, state offers `SEARCH_WIDEN` and deterministic no-match wording is used.

### Turn 2 — `مش حابب اغير البادجيت`

Responsibility:

- LLM may propose `PRESERVE BUDGET` and could even return a conflicting price patch.
- Deterministic `inferConstraintOperations` independently recognizes `PRESERVE BUDGET`.
- `applyConstraintOperations(..., previous)` restores the previous budget group exactly.

```yaml
budgetMin: 3000000
budgetMax: 5000000
currency: EGP
budget operation/state: PRESERVE; restored from previous even if LLM conflicts

propertyTypes: absent
property type operation/state: inherited

locations: absent
location operation/state: inherited

purpose: absent
purpose operation/state: inherited

queryObjective: BEST_MATCH
searchRelaxationAuthorized: absent  # PRESERVE alone does not authorize relaxation

verified inventory filters:
  priceMin: 3000000
  priceMax: 5000000
  unitType: []
  locationIds: []
  availability: [AVAILABLE]
  currency predicate: EGP
  archivedAt: null
```

The search/refinement label is conditional on whether the previous database search produced candidate IDs; the effective filters are the same either way.

### Turn 3 — `شيل النوع ووسع المنطقة`

Deterministic operations inferred from the raw text are:

```yaml
- { operation: REMOVE, constraint: PROPERTY_TYPE }
- { operation: REMOVE, constraint: LOCATION }
- { operation: BROADEN, constraint: LOCATION }
```

The duplicate location clear is harmless. Budget is not part of either group.

```yaml
budgetMin: 3000000
budgetMax: 5000000
currency: EGP
budget operation/state: inherited unchanged

propertyTypes: absent
property type operation/state: REMOVE

locations: absent
rejectedLocations: absent
maxTravelMinutes: absent
location operation/state: REMOVE then BROADEN

purpose: absent
purpose operation/state: inherited

queryObjective: BEST_MATCH
searchRelaxationAuthorized: true

verified inventory filters:
  priceMin: 3000000
  priceMax: 5000000
  unitType: []
  locationIds: []
  availability: [AVAILABLE]
  currency predicate: EGP
  archivedAt: null
```

This turn is deterministic-state-driven: the model can aid interpretation, but it cannot change the preserved budget through these operations.

### Turn 4 — `الغي شرط ال 5 م`

`inferConstraintOperations` has a special numeric-condition rule that maps `شرط ... 5 م` to `REMOVE BUDGET`, even without the word “budget”.

```yaml
budgetMin: absent
budgetMax: absent
priceMin: absent
priceMax: absent
currency: absent
budget operation/state: REMOVE

propertyTypes: absent
property type operation/state: inherited absence

locations: absent
location operation/state: inherited absence

purpose: absent
purpose operation/state: inherited absence

queryObjective: BEST_MATCH
searchRelaxationAuthorized: true

verified inventory filters:
  priceMin: null
  priceMax: null
  unitType: []
  locationIds: []
  availability: [AVAILABLE]
  currency predicate: absent
  archivedAt: null
```

The database query is rerun without a price predicate. A regression test explicitly verifies that the stale price filter is absent.

### Turn 5 — `ارخص وحدة عندك نوعها اي`

Deterministic interpretation:

- `queryObjective(source)` -> `CHEAPEST`.
- A ranking objective does not remove any active constraint. In this scenario the budget is already absent because turn 4 removed it.
- “نوعها اي” is recognized as a unit-detail question and emits `PRESERVE PROPERTY_TYPE`, not `REMOVE`.
- Prisma orders the complete matching inventory by price ascending before applying the result limit.
- `PropertyPresenterService.verifiedFactsAnswer` deterministically states the returned unit's verified type and supporting facts; the answer model is not used.

```yaml
budgetMin: absent
budgetMax: absent
priceMin: absent
priceMax: absent
currency: absent
budget operation/state: inherited absence from turn 4

propertyTypes: absent
property type operation/state: PRESERVE inherited absence; interrogative, not relaxation

locations: absent
location operation/state: inherited absence

purpose: absent
purpose operation/state: inherited absence

queryObjective: CHEAPEST
searchRelaxationAuthorized: true

verified inventory filters:
  priceMin: null
  priceMax: null
  unitType: []
  locationIds: []
  availability: [AVAILABLE]
  currency predicate: absent
  archivedAt: null

ranking:
  primary: price ascending
  tie_breaker: matchScore descending
```

The first candidate is therefore the global cheapest row over all remaining active filters, subject to the catalog's directly comparable numeric currency values. If no candidate exists, `DeterministicAnswerService` writes the state-aware no-match response.

## 7. Failure and fallback behavior

### Intent extraction failures

- Workers network/HTTP/empty/malformed-JSON failure -> `HybridAIProvider.extractIntent` catches it -> `deterministicIntent` + `normalizeRealEstateSemantics`.
- Invalid typed output -> Zod returns a language-only degraded intent. Because the Workers provider already sanitizes parsed JSON, most malformed structures fail earlier or are dropped before this layer.
- A syntactically valid but incomplete LLM patch inherits previous fields and is supplemented by `highConfidenceIntentPatch` for the narrow explicit fields described above. Ambiguous/open-ended values remain the model's responsibility.

### Answer generation failures

Database-backed factual turns no longer depend on an answer provider: `finishPreparation` selects deterministic verified presentation before `send`/`stream` can call the model. The provider fallback sequence below applies only to a remaining non-database turn with no deterministic answer.

- Groq empty output is a retryable `EMPTY_RESPONSE`/`EMPTY_STREAM_RESPONSE` and moves to another routed Groq model.
- 413 causes aggressive context compaction before retry/fallback.
- 401/403 do not fan out across Groq models.
- After Groq exhaustion: opt-in OpenAI when enabled, otherwise Workers AI; failed OpenAI also falls back to Workers.
- If a stream provider fails after emitting content, fallback is stopped to avoid mixing providers; the request becomes unavailable.
- If every provider fails, the controller emits SSE `error` with a safe Arabic message. The frontend catches it and adds a local generic assistant failure message.
- The already-persisted user message and effective conversation state remain; no assistant database row is written for the failed turn.

### Malformed or empty final text

- Provider-specific readers reject empty non-stream responses.
- Groq stream ignores malformed SSE frames but requires non-empty visible text after reasoning-tag removal.
- `ChatService.stream` also rejects a blank accumulated answer.
- `sanitizeCustomerAnswer` removes free-form URLs/internal identifiers and supplies a generic fallback if sanitization empties the text.
- There is no general JSON schema for non-factual final prose. Property/entity claims do not rely on prose entailment checking because they are rendered from structured verified fields.

## 8. Current strengths

- Durable, explicit `StructuredIntent` rather than relying on chat-history recall alone.
- Current-turn lifecycle operations are reapplied deterministically from raw text and override conflicting model patches.
- Constraint groups prevent location/type changes from silently altering budget/payment.
- No-match widening requires an explicit user confirmation or explicit broaden instruction.
- Inventory availability, archival state, aliases, knowledge and structured UI payloads are database-controlled.
- Database-backed prose is also deterministically assembled from those verified structures; free-form model text cannot add positive property facts.
- Ranking objectives are first-class state, not vague prompt instructions.
- Explicit cheapest/most-expensive ordering runs in Prisma before limiting candidates.
- Tool selection and UI actions are deterministic; the answer model cannot fabricate a property card or execute an arbitrary tool.
- Answer context strips internal ranking metadata and limits prompt size/history/facts.
- Provider routing, bounded retries, 413 compaction and safe final errors are explicit.
- React renders generated prose as text rather than raw HTML.

## 9. Current weaknesses and risky coupling

1. **Ambiguous extraction still depends on LLM quality.** The always-on deterministic supplement is intentionally narrow; novel locations, nuanced preferences and open-ended corrections can still be missed by a syntactically valid model patch.
2. **Rule routing remains regex-heavy.** `planCustomerTurn`, constraint inference and final deterministic parsing contain overlapping language rules; precedence and phrase collisions remain a regression risk despite the new interrogative tests.
3. **Purpose coverage depends on verified admin data.** `LIVING`/`INVESTMENT` now filters on `ProjectInvestmentProfile.verifiedAt` and its suitability flag. Projects without that verified profile are excluded rather than guessed, and there is no more granular unit-level purpose inference.
4. **Cross-currency ranking has no FX normalization.** Removing/resetting budget also removes `currency`; if verified inventory contains mixed currencies, numeric cheapest/most-expensive ordering compares stored amounts directly.
5. **Deterministic factual presentation is deliberately bounded.** It guarantees grounding but does not yet provide every nuance an LLM could phrase from a rich project record; new factual answer types need explicit presenter support.
6. **State commits before answer success.** This preserves user intent through outages but can leave a state-advanced conversation with no persisted assistant explanation on a non-deterministic provider failure.
7. **SSE is post-generation chunking.** The server buffers any provider output for validation and emits it afterward; deterministic answers are also emitted in 180-character chunks.
8. **Prompt variant assignment is not wired to prompt selection.** It is persisted/logged, but `buildMessages` uses the static registry configuration.

## 10. Prompt-dependent behavior that is not fully enforceable

The following currently rely materially on `advisor-system.hbs`, `advisor-context.hbs`, or extraction prompts rather than comprehensive code enforcement:

- Natural Egyptian tone, concision, asking at most one question and avoiding internal narration.
- Correctly interpreting open-ended new constraints when no deterministic parser covers them.
- Resolving many conversational pronouns/references beyond the deterministic selected entity/candidate IDs.
- Avoiding unsupported future-action promises beyond the specific tool/action context and output sanitizer.
- Treating user-input delimiters as untrusted content; delimiters reduce prompt-injection risk but do not create a hard security boundary.

## Verdict

- **Primary architecture:** hybrid, but deterministic-state-driven for continuity, mutation, querying, ranking, factual wording and tool execution; LLM-driven mainly for ambiguous semantic extraction and remaining non-database conversation.
- **Memory consistency owner:** `ChatService` plus `normalizeRealEstateSemantics` / `applyConstraintOperations` / `applyDeterministicTurnSemantics`, persisted in Prisma `ConversationState.searchContext`.
- **Largest future reasoning-bug risk:** the boundary between ambiguous LLM patches and overlapping deterministic language rules, especially operation precedence and phrase classification as new expressions are added.
