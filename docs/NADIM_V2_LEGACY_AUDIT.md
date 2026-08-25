# Nadim V2 Legacy Reasoning Audit

This audit separates stable Maqar capabilities from the conversational intelligence that V2 intentionally replaces. No legacy production endpoint or implementation is deleted in this slice.

## REUSE

| Component | Why it is retained |
| --- | --- |
| `database/PrismaService` and the Prisma domain | Stable persistence boundary and source of verified identifiers/data. |
| `PropertySearchService` | Deterministic search, unit/project/payment/media/availability reads. V2 adapts its results through typed tools. |
| `Customer`, `CustomerChannelIdentity` | Canonical cross-channel identity. V2 conversations resolve to these records. |
| Leads, `LeadEvent`, `AuditLog`, automation API | Existing CRM/action authority; V2 never creates a parallel CRM or writes action claims itself. |
| `AIUsageService` | Existing provider usage telemetry. |
| Admin authentication and API validation/filter infrastructure | Stable security and error boundaries. |

## REFACTOR

| Component | Later improvement |
| --- | --- |
| Compact property projection in `nadim-v2/brain/tool-executor.service.ts` | Extract a shared verified-property DTO/mapper once both flows need the same stable external representation. |
| V2 channel/customer resolution | Add explicit identity-linking workflows and conflict review as more provider gateways are introduced. |
| V2 response delivery | Add a transport-neutral streaming controller after clients have a stream protocol; keep the current no-mixing provider invariant. |
| Action policy/client | Add typed automation endpoints for viewing, reservation, handoff and messaging rather than mapping unsupported business requests onto lead notes. |
| V2 understanding | Expand evaluated semantic coverage and provider prompts; keep the validated operation contract as the boundary. |

## DEPRECATE

| Legacy component | Reason |
| --- | --- |
| `chat.service.ts` as a reasoning/orchestration owner | It coordinates extraction, state, planning, search, response and persistence in one legacy flow. V2 replaces this with explicit stages. |
| `customer-turn-planner.ts` for new channels | It belongs to the old conversational state contract and widening/follow-up loop. |
| `providers/hybrid.provider.ts` for V2 dialogue routing | Its fallback/routing policy is legacy-specific. V2 has a small provider abstraction with a strict before-output fallback boundary. |
| `providers/real-estate-semantics.ts` and `constraint-lifecycle.ts` as V2 state authority | Useful legacy behavior exists, but the types and mutation rules are coupled to `StructuredIntent` and include `BROADEN`; V2 permits only explicit SET/REMOVE/RESET/PRESERVE. |
| Legacy prompt builders/provider extraction prompts | They encode the old broad state and response loops and should not become V2's source of truth. |
| Legacy deterministic response-decision flow | V2 composition consumes its own typed tool/action results and cannot infer success from conversational text. |

## DELETE_LATER

Delete only after all production channels use V2, comparison telemetry is accepted, rollback is no longer required, and any legacy conversation data has a migration/archive decision:

- orchestration sections of `chat.service.ts`;
- `customer-turn-planner.ts` and its legacy-only tests;
- V2-unused branches of `providers/hybrid.provider.ts` and legacy provider prompt/answer utilities;
- legacy-only semantic mutation modules and response-decision helpers;
- legacy controller routes and legacy conversation state columns/models that have no remaining consumers.

These are candidates, not authorization to remove shared provider transports or deterministic property/domain services.

## Duplicated or dangerous heuristics

- Intent and constraint semantics are distributed across provider prompts, `provider-utils`, `real-estate-semantics`, `constraint-lifecycle`, `customer-turn-planner`, and `ChatService`. Ordering can make the same message mutate state differently.
- Legacy `BROADEN` and offered-follow-up paths can transform search constraints as part of dialogue flow. This is especially risky after no-match; V2 never changes a meaningful constraint without a validated explicit operation.
- Provider selection, retries, context compaction and response composition are interleaved in `HybridAIProvider`, making partial-output fallback harder to reason about. V2 makes the stream cutover rule explicit.
- Conversational orchestration and trusted property presentation coexist in the legacy flow. This increases the risk that generated language is mistaken for database truth.
- Result continuity in legacy code can depend on accumulated conversational context. V2 persists ordered database IDs and resolves ordinals deterministically.
- Action-like language in a general response path risks implying completion. V2 separates proposal, policy, execution result and composition.

## Migration rule

Do not copy additional legacy heuristics into V2 merely to match an isolated legacy response. Promote only a deterministic domain capability with a typed contract and direct tests. Behavioral parity should be judged on customer outcomes, verified truth, state correctness and action safety—not identical wording.
