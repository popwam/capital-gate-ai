# AI Reasoning Architecture

## 2026-08-23 Architecture Update

`ChatService` now delegates customer-facing formatting and sanitization, deterministic answers, payment/property presentation, and lead handoff to injected conversation-domain services. Prompt experiment selection is assigned once when a conversation is created, carried in each answer input, and recorded per AI usage event; it no longer relies on mutating a process-wide prompt registry. The API smoke suite passes 152/152. Existing databases must apply migration `20260823150000_conversation_prompt_variant` before this flow can run live.
**Date:** 2026-08-20  
**Version:** 1.0  
**Status:** Production (with critical gaps)

## Overview

AICG uses a **multi-provider hybrid AI architecture** with intelligent routing, three-tier fallback chains, and structured intent extraction. The system orchestrates real estate conversations by combining structured data (Prisma database) with LLM generation (Groq/OpenAI/Workers AI).

**Architecture Philosophy:**
- **Resilience over optimization** — Multiple providers prevent single points of failure
- **Cost-conscious routing** — Cheaper models (Groq) for most work, expensive models (OpenAI) only on opt-in
- **Grounding first** — Database facts always override LLM generation
- **Trust-aware** — Contact validation integrated into lead handoff

---

## AI Brains Registry

### Brain #1: Intent Extractor

**File:** `apps/api/src/providers/hybrid.provider.ts` → `extractIntent()`  
**Purpose:** Convert natural language customer input into structured intent with 100+ fields

**Responsibilities:**
- Parse customer message into `StructuredIntent` type
- Detect intent category (30+ types: PROPERTY_SEARCH, VIEWING_REQUEST, etc.)
- Extract structured fields: location, unit type, price range, features, contact info
- Normalize real estate semantics (bedrooms, payment terms, locations)

**Input:**
```typescript
{
  history: AIMessage[],        // Last 20 conversation turns
  currentMessage: string,      // Latest customer input
  conversationState?: unknown  // Persistent state
}
```

**Output:**
```typescript
StructuredIntent {
  primaryIntent: CustomerTurnIntent,  // PROPERTY_SEARCH, PAYMENT_PLAN, etc.
  // 100+ optional fields for locations, features, contact, purchase signals
}
```

**Reasoning Flow:**
1. Call Workers AI with structured JSON schema
2. On failure/timeout: fallback to deterministic regex extraction (`deterministic-intent.ts`)
3. Post-process with `real-estate-semantics.ts` normalization
4. Return structured intent

**Tools:** None (pure transformation)

**APIs:**
- **Primary:** Cloudflare Workers AI (`@cf/meta/llama-3.1-8b-instruct`)
- **Fallback:** Deterministic pattern matching

**Preferred Model:** Small, fast LLM (Workers AI sufficient)

**Fallback Strategy:**
```
Workers AI (@cf/meta/llama-3.1-8b-instruct) 
  → timeout/error → 
Deterministic extraction (regex patterns in customer-turn-planner.ts)
  → always succeeds with best-effort intent
```

**Memory/Context:**
- Last 20 messages from conversation
- Conversation state (lead status, payment route, etc.)
- No long-term memory

**Validation:**
- JSON schema validation on Workers AI response
- If invalid: fallback to deterministic
- Post-extraction: real estate semantic normalization

**Failure Handling:**
- Workers AI timeout (10s) → deterministic fallback
- Workers AI error → deterministic fallback
- Deterministic never fails (returns minimal intent)

**Escalation:** None (always returns some intent, even if empty)

**Output Format:** TypeScript `StructuredIntent` object (not streamed)

**Interaction:**
- **Called by:** ChatService.prepare()
- **Calls:** None (leaf node)
- **Logs:** `AIProviderTrace` with provider="workers-ai", task="extract-intent"

---

### Brain #2: Answer Generator

**File:** `apps/api/src/providers/hybrid.provider.ts` → `composeAnswer()` / `streamAnswer()`  
**Purpose:** Generate natural conversational responses grounded in database facts

**Responsibilities:**
- Compose Arabic/English responses matching customer language
- Ground answers in verified database facts (units, projects, developers)
- Maintain conversational tone (not robotic)
- Handle multi-intent scenarios (comparison, recommendation, explanation)
- Respect trust boundaries (don't pressure, don't fabricate)

**Input:**
```typescript
AnswerInput {
  messages: AIMessage[],              // Conversation history
  intent: StructuredIntent,           // Extracted intent
  verifiedFacts: unknown[],           // DB query results
  approvedKnowledge?: unknown[],      // Admin-curated facts
  conversationSummary?: unknown,      // Persistent state
  contextKind: AIContextKind,         // PROPERTY_SEARCH, PAYMENT_INFO, etc.
  candidatesBeforeRanking: number     // Search breadth signal
}
```

**Output:**
- **Non-streaming:** `string` (complete answer)
- **Streaming:** `AsyncGenerator<string>` (SSE chunks)

**Reasoning Flow:**
1. **Model routing** — Select FAST/GENERAL/REASONING based on intent complexity
2. **Context construction** — Build system prompt + user message with verified facts
3. **Primary attempt** — Call Groq with selected model
4. **Fallback cascade:**
   - 413 (context too large) → aggressive compaction → retry primary
   - Other error → try backup model
   - Backup fails → try OpenAI (if enabled)
   - OpenAI fails → try Workers AI
   - Workers AI fails → return error
5. **Post-processing:**
   - Detect grounding contradictions
   - Sanitize output (strip UUIDs, URLs, CUIDs)
   - Add first-turn intro if new conversation

**Tools:** None

**APIs:**
- **Primary:** Groq (openai/gpt-oss-20b, openai/gpt-oss-120b)
- **Fallback:** OpenAI (gpt-4o-mini, if OPENAI_FALLBACK_ENABLED=true)
- **Last Resort:** Cloudflare Workers AI

**Preferred Model:** Determined by ConversationModelRouter:
- **FAST (openai/gpt-oss-20b):** Small talk, short conversational, simple context
- **GENERAL (openai/gpt-oss-120b):** Default conversations
- **REASONING (openai/gpt-oss-120b):** High purchase intent, comparisons, mixed language, investment questions

**Fallback Strategy:**
```
Primary (FAST/GENERAL/REASONING from Groq)
  → 413 context error → aggressive compaction → retry
  → other error → backup model (openai/gpt-oss-20b)
  → backup fails → alt model (from fallback chain)
  → alt fails → OpenAI (if enabled)
  → OpenAI fails → Workers AI
  → Workers AI fails → throw error
```

**Memory/Context:**
- **Short-term:** Last 20 messages (sliding window)
- **Long-term:** Conversation summary (structure undocumented)
- **Approved knowledge:** Admin-curated project facts
- **Context window:** ~8K tokens (Groq), ~128K (OpenAI gpt-4o-mini)
- **Compaction:** Normal mode keeps full history, aggressive mode strips to intent + last 3 turns

**Validation:**
- **Grounding check:** `hasGroundingContradiction()` detects hallucinated facts
- **Output schema:** None (plain text, not validated)
- **Sanitization:** Strips URLs, UUIDs, CUIDs

**Failure Handling:**
- Empty response → log + throw error
- Partial stream → detected only after first chunk (weakness)
- Model error → fallback chain
- Context too large → aggressive compaction

**Escalation:**
- After all fallbacks exhausted → return error to client
- No admin notification system

**Output Format:**
- Plain text (Arabic or English)
- Markdown formatting (**bold** for emphasis)
- Streaming: SSE chunks

**Interaction:**
- **Called by:** ChatService.send() / ChatService.stream()
- **Calls:** ConversationModelRouter (for model selection)
- **Logs:** `AIProviderTrace`, `AIModelRoute`, `AIContextTrace`

---

### Brain #3: Knowledge Extractor

**File:** `apps/api/src/providers/hybrid.provider.ts` → `extractKnowledge()`  
**Purpose:** Extract structured facts from unstructured documents (PDFs, brochures, project descriptions)

**Responsibilities:**
- Parse uploaded documents
- Extract: project features, developer info, location details, amenities, payment terms
- Structure into `ProjectKnowledge` format
- Handle Arabic and English text

**Input:**
```typescript
{
  documentText: string,        // Extracted text from PDF/doc
  projectContext?: string      // Optional project name/developer hint
}
```

**Output:**
```typescript
ProjectKnowledge {
  features: string[],
  amenities: string[],
  developer: string,
  location: string,
  paymentTerms: string,
  // ... structured fields
}
```

**Reasoning Flow:**
1. Send document text to Workers AI with extraction schema
2. Parse JSON response
3. Validate and normalize extracted fields
4. Return structured knowledge

**Tools:** None

**APIs:**
- **Only:** Cloudflare Workers AI (`@cf/meta/llama-3.1-8b-instruct`)
- **No fallback** (if fails, admin sees error)

**Preferred Model:** Workers AI (sufficient for extraction)

**Fallback Strategy:** None (single provider)

**Memory/Context:** Stateless (no conversation history)

**Validation:**
- JSON schema validation
- Field normalization (e.g., "2 غرف نوم" → structured bedrooms)

**Failure Handling:**
- Workers AI error → return error to admin
- Invalid JSON → return error
- No retry logic

**Escalation:** Admin sees extraction failure in UI

**Output Format:** TypeScript `ProjectKnowledge` object

**Interaction:**
- **Called by:** AdminKnowledgeService (admin panel)
- **Calls:** None
- **Logs:** `AIProviderTrace` with task="extract-knowledge"

---

### Brain #4: Column Mapper

**File:** `apps/api/src/providers/hybrid.provider.ts` → `mapColumns()`  
**Purpose:** AI-assisted Excel/CSV import — map uploaded spreadsheet columns to database fields

**Responsibilities:**
- Analyze column headers (Arabic/English)
- Suggest mapping to Prisma schema fields
- Handle ambiguous cases (e.g., "Area" could be size or location)
- Provide confidence scores

**Input:**
```typescript
{
  headers: string[],           // Excel column names
  sampleRows: unknown[][],     // First 5 rows for context
  targetEntity: string         // "Unit" | "Project" | "Developer"
}
```

**Output:**
```typescript
{
  mappings: Array<{
    sourceColumn: string,
    targetField: string,
    confidence: number
  }>
}
```

**Reasoning Flow:**
1. Send headers + sample data to Workers AI
2. LLM suggests field mappings based on schema
3. Return mappings with confidence scores
4. Admin confirms/adjusts in UI

**Tools:** None

**APIs:**
- **Only:** Cloudflare Workers AI
- **No fallback**

**Preferred Model:** Workers AI

**Fallback Strategy:** None (admin can manually map on failure)

**Memory/Context:** Stateless

**Validation:**
- Target field must exist in Prisma schema
- Confidence score 0-100

**Failure Handling:**
- Workers AI error → admin manually maps columns
- No retry

**Escalation:** Admin handles mapping manually

**Output Format:** Array of column mappings (JSON)

**Interaction:**
- **Called by:** ImporterService (admin import flow)
- **Calls:** None
- **Logs:** `AIProviderTrace` with task="map-columns"

---

## Supporting Systems

### Real Estate Semantic Normalizer

**File:** `apps/api/src/providers/real-estate-semantics.ts`  
**Purpose:** Normalize ambiguous real estate terms into canonical database values

**Not an LLM** — deterministic string matching and transformation

**Responsibilities:**
- Map "شقة" → "APARTMENT", "Villa" → "VILLA"
- Normalize payment terms: "تقسيط" → "INSTALLMENT", "cash" → "CASH"
- Parse bedroom counts: "2 غرف نوم" → 2
- Normalize location names: "new cairo" → "New Cairo"

**Called by:** Intent Extractor (post-processing step)

---

### Customer Turn Planner

**File:** `apps/api/src/providers/customer-turn-planner.ts`  
**Purpose:** Deterministic turn classification (used as fallback when Workers AI fails)

**Not an LLM** — pure regex pattern matching

**Responsibilities:**
- Detect confirmation flows ("نعم", "yes", "ok")
- Detect payment choices ("cash", "installment")
- Detect unit code references ("LS8-C-402")
- Detect greetings, thanks, small talk

**Called by:** Intent Extractor (as fallback)

---

### Grounding Contradiction Detector

**File:** `apps/api/src/chat.service.ts` → `hasGroundingContradiction()`  
**Purpose:** Detect when LLM hallucinates facts not present in database results

**Method:** Keyword matching (not LLM-based)

**Checks:**
- "لم أجد" (didn't find) when units were returned
- "لا يوجد" (doesn't exist) when facts are verified
- Price contradictions
- Location contradictions

**Action:** Logs warning, does NOT block answer (accepts false positives)

---

### Trust Assessor

**File:** `apps/api/src/customer-trust.service.ts`  
**Purpose:** Validate customer contact information quality

**Not an LLM** — rule-based validation

**Responsibilities:**
- Detect placeholder names ("test", "user", "aaa")
- Detect fake phones ("0000000000", "1234567890")
- Detect incomplete names (single letter, too short)
- Score contact validity: CONTACT_VALID, UNCLEAR_CONTACT, PLACEHOLDER_DETECTED, LIKELY_FAKE

**Called by:** ChatService during lead handoff

---

## Model Routing Matrix

**Router:** `apps/api/src/providers/conversation-model-router.ts`

| Scenario | Selected Model | Fallback Chain |
|----------|----------------|----------------|
| High purchase intent (≥80) | REASONING (120B) | backup → general → last-resort → fast |
| Complex comparison/investment | REASONING (120B) | ↑ |
| Mixed Arabic/English | REASONING (120B) | ↑ |
| Semantic reasoning patterns | REASONING (120B) | ↑ |
| Short conversational (<90 chars) | FAST (20B) | general → backup → reasoning → last-resort |
| Simple deterministic | FAST (20B) | ↑ |
| Default (standard conversation) | GENERAL (120B) | backup → reasoning → last-resort → fast |

**Current Model Mapping (from env):**
- FAST: `openai/gpt-oss-20b`
- GENERAL: `openai/gpt-oss-120b`
- REASONING: `openai/gpt-oss-120b` ⚠️ (same as general — no actual differentiation)
- BACKUP: `openai/gpt-oss-20b`
- LAST_RESORT: `openai/gpt-oss-20b`

**⚠️ Critical Issue:** GENERAL and REASONING both use `openai/gpt-oss-120b` by default. The routing logic creates an illusion of specialized reasoning treatment, but unless env vars explicitly override it, reasoning tasks get no special model.

---

## Prompt Architecture

### Current State: Inline Construction

Prompts are **not versioned, not templated, not centralized**. They are constructed inline in:

**File:** `apps/api/src/providers/ai-context.ts` (inferred from architecture)

**System Prompt Components:**
1. **Role definition** — "You are a real estate assistant..."
2. **Context category** — PROPERTY_SEARCH, PAYMENT_INFO, VIEWING_REQUEST, etc.
3. **Verified facts** — JSON dump of database results
4. **Approved knowledge** — Admin-curated project facts
5. **Conversation history** — Last 20 messages
6. **Instructions** — How to format answers, what to avoid

**User Prompt:**
- Latest customer message
- Intent summary

**⚠️ Critical Gaps:**
1. **No versioning** — Cannot roll back prompt changes
2. **No A/B testing** — Cannot experiment with variations
3. **No templates** — String concatenation, not structured templates
4. **No multilingual adaptation** — Same prompt structure for Arabic/English (only customer text differs)
5. **No prompt injection defense** — Adversarial input goes directly into context

---

## Observability & Telemetry

### Structured Logging

**Logs emitted (JSON to stdout):**

1. **AIProviderTrace**
   - `requestId`, `conversationId`, `provider`, `model`, `task`, `stage`, `status`, `latency`, `fallback`

2. **AIModelRoute**
   - `requestId`, `conversationId`, `role` (FAST/GENERAL/REASONING), `model`, `reason`, `fallbackChain`

3. **AIContextTrace**
   - `requestId`, `conversationId`, `bytesSent`, `estimatedTokens`, `candidatesBeforeRanking`, `contextKind`

4. **CustomerTurnTrace**
   - `requestId`, `conversationId`, `deviceToken`, `messageCount`, `purchaseIntent`, `leadStatus`, `latency`

**⚠️ Gap:** Logs go to stdout with no aggregation/dashboarding. Cannot query "What's the Groq fallback rate?" or "Average latency by model?"

### Database Telemetry

**AIUsage Table** (Prisma model)
- Tracks every AI call: provider, model, task, tokens, latency, success, fallbackUsed
- No analytics/dashboard consuming this data yet

---

## Failure Modes & Mitigations

| Failure | Current Mitigation | Gap |
|---------|-------------------|-----|
| Workers AI timeout | Deterministic fallback | ✅ Covered |
| Groq rate limit | Fallback to backup model | ⚠️ No exponential backoff |
| Context too large (413) | Aggressive compaction | ⚠️ Quality loss unmeasured |
| Empty LLM response | Detected + logged + error | ✅ Covered |
| Hallucination | Grounding check (keyword-based) | ⚠️ Weak detection (keyword matching only) |
| Prompt injection | None | ❌ Unprotected |
| Model retirement | Runtime blocking | ⚠️ Should fail at deploy, not runtime |
| Streaming failure | Detected only after first chunk | ⚠️ Partial success can slip through |
| Lead handoff race | None | ❌ No transactional guarantee |

---

## Critical Recommendations

### Immediate (P0)

1. **Differentiate REASONING model** or simplify to FAST/STANDARD (no fake reasoning tier)
2. **Add prompt versioning** — Store prompts in `prompts/` directory with version IDs tracked in AIUsage
3. **Set up log aggregation** — Datadog, CloudWatch, or ELK to query fallback rates, latency
4. **Add output schema validation** — Zod schemas for structured AI outputs
5. **Add prompt injection tests** — Adversarial input suite

### High Priority (P1)

6. **Build AI success dashboard** — Visualize AIUsage table (success rate by provider, model, task)
7. **Measure context compaction quality** — A/B test aggressive vs normal mode
8. **Template system** — Migrate to Handlebars/Mustache for prompts
9. **A/B testing framework** — Track prompt version in AIUsage, compare metrics
10. **Streaming failure detection** — Validate complete response, not just first chunk

### Medium Priority (P2)

11. **Decompose ChatService** — 1373 lines into separate concerns (IntentExtractor, SearchOrchestrator, TrustAssessor, LeadStateMachine, ResponseGenerator)
12. **Add exponential backoff** on Groq rate limits
13. **Document conversation summary schema** (currently `unknown`)
14. **Token budget enforcement** — Trim context proactively, not reactively on 413
15. **Improve grounding check** — Use LLM-based fact verification, not keyword matching

---

## AI Cost Estimate (Rough)

**Per Conversation (10 turns):**
- Intent extraction: 10 × Workers AI calls ≈ $0.001
- Answer generation: 8 × Groq (120B) + 2 × fallback ≈ $0.05
- Knowledge extraction: 0 (admin-only)
- Column mapping: 0 (admin-only)

**Total per conversation:** ~$0.051  
**Fallback to OpenAI:** +$0.20 per turn (if enabled)

**Monthly (1000 conversations/day):**
- 30,000 conversations × $0.051 = **$1,530/month**
- With 10% OpenAI fallback: +$600/month → **$2,130/month**

---

## Security Considerations

### Current Posture

✅ **Protected:**
- SQL injection (Prisma ORM)
- XSS in messages (text-only, no HTML rendering)
- SSRF (no user-controlled URLs)
- Admin passwords (bcrypt)

❌ **Exposed:**
- **Prompt injection** — No defense against adversarial input
- **PII leakage in logs** — AIUsage stores full conversationId (can reconstruct conversations)
- **No output sanitization beyond UUID stripping** — LLM could output malicious Markdown
- **No rate limiting per conversation** — Only global throttle

### Recommendations

1. **Add prompt injection defense:**
   - User input preprocessing (strip special tokens, adversarial patterns)
   - Dual-prompt architecture (user input in separate context section)
   - Output validation (reject answers containing instructions)

2. **Anonymize logs:**
   - Hash conversationId in AIUsage table
   - Redact PII from CustomerTurnTrace

3. **Per-conversation rate limiting:**
   - Max 50 messages per conversation
   - Max 5 conversations per device per hour

4. **Output sanitization:**
   - Validate Markdown (no script tags, no arbitrary HTML)
   - Content security policy for rendered output

---

## Evolution Roadmap

### Phase 1: Observability (1 week)
- Set up log aggregation
- Build AI success dashboard
- Create alerting (>10% fallback rate, >5s P95 latency)

### Phase 2: Prompt Infrastructure (2 weeks)
- Migrate prompts to versioned templates
- Track prompt version in AIUsage
- Build A/B testing framework

### Phase 3: Quality Improvements (2 weeks)
- Add output schema validation
- Improve grounding check (LLM-based)
- Measure context compaction quality

### Phase 4: Security Hardening (1 week)
- Add prompt injection defense
- Per-conversation rate limiting
- PII anonymization in logs

### Phase 5: Architectural Refactor (3 weeks)
- Decompose ChatService
- Extract standalone services: IntentExtractor, ResponseGenerator, etc.
- Add comprehensive unit tests

---

**Document Status:** Complete but identifies critical gaps  
**Next Actions:** Proceed to P0 implementation (focus on focus indicators, prompt versioning, log aggregation)
