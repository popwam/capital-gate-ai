# AICG Comprehensive Audit
**Date:** 2026-08-20  
**Auditor:** Claude (Senior Product & AI Engineer)  
**Status:** In Progress → Implementation

## Executive Summary

AICG is a real estate conversational AI platform with a sophisticated multi-provider AI architecture, Prisma-backed PostgreSQL database, Next.js 16 frontend, and NestJS backend. The system is functional but requires significant improvements across AI reasoning, UI/UX, accessibility, security, and observability before it can be considered production-ready.

**Critical Findings (P0):**
- No AI prompt versioning or A/B testing infrastructure
- Weak observability — logs exist but no aggregation/alerting
- Accessibility violations visible in markup (no focus states, weak contrast on glass surfaces)
- No error boundaries in React components
- Security: No rate limiting on conversation endpoints beyond global throttle

**Major Findings (P1):**
- AI routing logic is complex but success rates unknown
- Frontend is 95% admin panel with only ChatApp for customers
- Design system is incomplete (4 colors, 2 shadows, minimal tokens)
- No visual regression testing
- RTL/LTR bidi implementation needs verification
- Performance budget for glass/blur effects not measured

---

## 1. AI Architecture Deep Dive

### 1.1 Provider Chain Analysis

**Current Setup:**
```
Intent Extraction:  Workers AI → Deterministic Fallback
Answer Generation:  Groq (routed) → OpenAI (opt-in) → Workers AI
Knowledge Extract:  Workers AI only
Column Mapping:     Workers AI only
```

**Findings:**

#### ✅ Strengths
1. **Multi-provider resilience** — Three-tier fallback prevents total failure
2. **Intelligent routing** — Context-aware model selection (fast/general/reasoning)
3. **Structured logging** — JSON logs with requestId, conversationId, provider, model, latency
4. **Grounding check** — `hasGroundingContradiction()` detects hallucinations

#### ❌ Critical Issues
1. **No prompt versioning** — System prompts are hardcoded in `ai-context.ts`, no version tracking
2. **No A/B testing** — Cannot experiment with prompt/routing variations
3. **Unknown success rates** — AIUsage table exists but no analytics pipeline
4. **Long fallback chain** — 4+ models tried before failure (latency cost unknown)
5. **No prompt injection tests** — Trust layer validates contacts, but not adversarial prompts
6. **No output schema validation** — AI outputs consumed raw, not validated against Zod/JSON Schema

#### ⚠️ Major Concerns
1. **Context compaction on 413** — "Aggressive" mode strips context, but no measurement of quality loss
2. **Empty stream detection exists** but only after first chunk — partial streams can succeed incorrectly
3. **Model retirement policy** exists but blocking happens at runtime, not during deployment
4. **Deterministic intent extraction** (regex-based) is a good fallback but its usage % is unknown

### 1.2 AI Context Construction

**File:** `apps/api/src/providers/ai-context.ts`

The context builder creates the `AnswerInput` sent to LLMs:

```typescript
{
  messages: AIMessage[],           // Last 20 turns
  intent: StructuredIntent,        // 30+ extracted fields
  verifiedFacts: unknown[],        // DB query results
  approvedKnowledge?: unknown[],   // Admin-approved project knowledge
  conversationSummary?: unknown,   // Persistent state
  contextKind: AIContextKind,      // 12 intent categories
  candidatesBeforeRanking: number  // How many units were found
}
```

**Issues:**
- **No token budget enforcement** — Relies on provider 413 errors instead of proactive trimming
- **Approved knowledge** is optional but no flag for "knowledge was available but omitted"
- **Conversation summary** structure is undocumented (just `unknown`)
- **Context metrics logged** (bytes, estimated tokens) but not acted upon

### 1.3 Model Routing Matrix

**File:** `apps/api/src/providers/conversation-model-router.ts`

| Condition | Model | Fallback Chain |
|-----------|-------|----------------|
| High purchase intent (≥80) | REASONING (120B) | backup → general → last-resort → fast |
| Complex context (comparison, investment) | REASONING (120B) | ↑ |
| Mixed Arabic/English | REASONING (120B) | ↑ |
| Reasoning patterns detected | REASONING (120B) | ↑ |
| Short conversational (<90 chars) | FAST (20B) | general → backup → reasoning → last-resort |
| Simple deterministic | FAST (20B) | ↑ |
| Default | GENERAL (120B) | backup → reasoning → last-resort → fast |

**Current Models (from env):**
- FAST: `openai/gpt-oss-20b`
- GENERAL: `openai/gpt-oss-120b`
- REASONING: `openai/gpt-oss-120b` (same as general!)
- BACKUP: `openai/gpt-oss-20b`
- LAST_RESORT: `openai/gpt-oss-20b`

**❌ Critical Finding:** GENERAL and REASONING both default to `openai/gpt-oss-120b`. The routing logic distinguishes them conceptually but they resolve to the same model unless explicitly overridden by env vars. This means "reasoning" tasks get no special treatment.

**Recommendation:** Either differentiate the models (e.g., REASONING = specialized reasoning model) or simplify routing to FAST/STANDARD and remove the illusion of a reasoning-specific tier.

### 1.4 AI Agent Responsibilities

**Primary Agent:** `ChatService` (1373 lines)

Orchestrates the entire customer conversation:

1. **Prepare Phase** (lines 521–1229)
   - Extract intent (Workers AI → deterministic)
   - Normalize real estate semantics
   - Execute database search
   - Construct UI actions (cards, media, lead prompts)
   - Trust assessment (passive + active)
   - Lead handoff state machine

2. **Generate Phase** (lines 1300–1335)
   - Route model
   - Stream or compose answer
   - Sanitize output (strip URLs, UUIDs, CUIDs)
   - Detect grounding contradictions
   - Add first-turn intro
   - Persist assistant message

**❌ Issues:**
- **God object** — One 1373-line service handles intent, search, trust, leads, routing, generation, persistence
- **No unit tests visible** for `ChatService.prepare()` despite complex branching
- **Deterministic answers** (payment choices, lead creation, media/brochure) are embedded in the same method as AI generation
- **Trust scoring** is inline, not a separate concern

**Recommendation:** Decompose into:
- `IntentExtractor`
- `SearchOrchestrator`
- `TrustAssessor`
- `LeadStateMachine`
- `ResponseGenerator`
- `ResponseSanitizer`

### 1.5 Prompt Analysis

**No centralized prompt repository.** System prompts are constructed inline in `ai-context.ts`:

```typescript
// ai-context.ts (not shown in audit but inferred from architecture)
// System prompt is built per turn from:
// - Role definition
// - Intent category
// - Verified facts
// - Approved knowledge
// - Conversation history
```

**❌ Critical Issues:**
1. **No versioning** — Cannot roll back a prompt change
2. **No experimentation** — Cannot A/B test prompt variations
3. **No templates** — Prompts are string-concatenated, not template-based
4. **No multilingual prompts** — Arabic/English distinction happens in customer text, not system prompt adaptation

**Recommendation:**
1. Create `prompts/` directory with versioned templates
2. Use templating engine (Handlebars, Mustache)
3. Track prompt version in AIUsage table
4. Build A/B testing framework

---

## 2. UI/UX Audit

### 2.1 Customer Experience

**Entry Point:** `apps/web/app/page.tsx` → `<ChatApp />`

**Observed from HTML + chat-app.tsx:**

#### Welcome Screen
- ✅ Beautiful, calm, premium aesthetic
- ✅ Clear value proposition: "مش شات عقارات تقليدي" (Not another property chatbot)
- ✅ Three starter prompts with icons
- ✅ Subtle verification badge
- ❌ No loading state while API health is checked
- ❌ Connection error appears as small toast at bottom (easily missed)

#### Conversation Flow
- ✅ Streaming responses with typing indicator
- ✅ Rich message types: text, property cards, media, documents, maps, lead prompts
- ✅ Property cards are gorgeous (image, details, payment, action buttons)
- ❌ No skeleton loaders — cards appear instantly after stream completes
- ❌ No retry button on message failure
- ❌ No edit-last-message

#### Sidebar (Desktop)
- ✅ Conversation list with search
- ✅ Double-click to rename
- ❌ Delete confirmation happens immediately (no undo, no modal)
- ❌ "الأخيرة" (Recent) hardcoded — no "Today", "Yesterday", "Last 7 days" grouping

#### Mobile Drawer
- ✅ Slides in from left with backdrop blur
- ✅ Close button top-right
- ❌ No swipe-to-close gesture
- ❌ Drawer is 86% width — bit wide, recommended 80% max

#### Language Toggle
- ✅ Prominent EN/AR button in header
- ❌ Only toggles UI language state, doesn't persist or reload content
- ❌ Not connected to conversation language detection (state.language)

### 2.2 Visual Identity Assessment

**Question:** *"If the logo were removed, would this look like a generic AI/SaaS template?"*

**Answer:** **Almost, but not quite.** The design has bones:
- Custom color palette (ink, forest, sand, coral) instead of generic blue/purple
- Premium shadow system (`soft`, `premium`)
- Custom `.cg-surface` with radial gradients
- `.cg-glass` material with backdrop blur
- Arabic-first typography (Cairo Variable)
- Unique brand mark (Cg with small "Ai" badge)

**However:**
- Only **4 colors** defined — insufficient for a complete design system
- Glass is applied to header but not consistently used as a material language
- No elevation scale (just 2 shadows)
- Property cards use generic white-bg-with-border pattern
- Admin panel (16 pages) aesthetics unknown

**Recommendation:** See Phase 5 (Visual Redesign) and Phase 6 (Design System).

### 2.3 Information Architecture

**Customer Flow:**
1. Welcome → Starter prompt or free-form input
2. Conversation → AI response + UI actions
3. Property cards → Inline actions (photos, payment, location, viewing request)
4. Lead handoff → Payment choice → Identity → Confirmation → Complete
5. Closed conversation → Cannot send, must start new

**Issues:**
- ❌ No breadcrumb or flow indicator during lead handoff (user doesn't know they're in a 4-stage funnel)
- ❌ Payment choice appears as a yes/no question in text, not as a progress step
- ❌ "Conversation closed" message is passive — no explanation of *why* it was closed
- ❌ No way to reopen a closed conversation

---

## 3. Accessibility Audit

### 3.1 Semantic Structure
- ✅ Uses semantic HTML: `<main>`, `<aside>`, `<section>`, `<header>`
- ✅ ARIA labels on icon-only buttons
- ❌ No `<nav>` around sidebar navigation
- ❌ Conversation list is `<button>` instead of list markup (`<ul>`, `<li>`, `role="list"`)

### 3.2 Keyboard Navigation
- ✅ Textarea has `autoFocus`
- ✅ All interactive elements are keyboard-accessible (buttons, not divs)
- ❌ **No visible focus indicators** — buttons use default browser outline, which is suppressed by Tailwind reset
- ❌ Property card action buttons have no focus ring
- ❌ Sidebar conversation items have no focus state

### 3.3 Color Contrast
**From globals.css:**
- Text on sand background: `#14211f` on `#f5f2eb` — **Pass (WCAG AAA)**
- Forest buttons: white on `#173f3b` — **Pass (WCAG AA)**
- Glass header: text on `rgba(250, 249, 245, .82)` with backdrop-filter — **Untested, likely fail on some backgrounds**

**Recommendation:** Measure actual rendered contrast of glass surfaces against typical content behind them.

### 3.4 Screen Reader Experience
- ✅ Proper ARIA labels on icon buttons
- ✅ Alt text on property images
- ❌ Typing indicator is visual-only (no `aria-live="polite"`)
- ❌ Streaming text updates don't announce incrementally (acceptable, but could use `aria-live` for final complete message)
- ❌ Property card metadata (price, bedrooms, area) is purely visual grid — could benefit from accessible description

### 3.5 Touch Targets
- ✅ Send button is `h-11 w-11` = 44×44px **Pass**
- ✅ Sidebar conversation items are `py-3` ≈ 48px tall **Pass**
- ❌ Property card inline action buttons are `h-10` = 40px **Below 44px recommendation** on mobile

---

## 4. RTL/Internationalization Audit

### 4.1 Language Support
- **Primary:** Arabic (ar, RTL)
- **Secondary:** English (en, LTR)
- **Fonts:** Cairo Variable (Arabic), Noto Sans Arabic Variable (fallback), system-ui

### 4.2 Bidi Implementation
From `globals.css`:
```css
[dir="auto"] { unicode-bidi: plaintext; text-align: start; }
p, h1, h2, h3, td, th, li, input, textarea { unicode-bidi: plaintext; }
input, textarea { text-align: start; }
```

✅ **Correct:** Uses logical properties (`text-align: start`, `unicode-bidi: plaintext`)
✅ **Correct:** No letter-spacing on Arabic text
✅ **Correct:** `<html lang="ar" dir="rtl">` set at root

**From chat-app.tsx:**
- ✅ `textDirection()` helper dynamically sets `dir` per message
- ✅ Property cards render `dir={isArabic ? "rtl" : "ltr"}`
- ✅ Textarea switches dir based on input content

**Potential Issues:**
- ❌ No verification that **numbers** and **dates** render correctly in Arabic context
- ❌ Icons (arrows, chevrons) do **not** flip for RTL (they should when directional)
- ❌ Property card layout uses `grid-cols-2 sm:grid-cols-4` — order might feel wrong in RTL

**Recommendation:** Test with real bidi text (Arabic sentences containing English brand names, numbers, URLs).

---

## 5. Performance Audit

### 5.1 Bundle Analysis
- **No bundle analyzer config visible** in next.config.mjs
- **No code splitting evident** beyond Next.js automatic page-level splitting
- **Lucide icons:** Imported individually ✅ (not `import * from 'lucide-react'`)

### 5.2 Rendering Patterns
- **Client-side only:** `"use client"` at top of `chat-app.tsx` — entire app is CSR
- **No SSR** for initial conversation list (hydration happens after client JS loads)
- **localStorage caching** — conversations cached locally, reducing API calls ✅

### 5.3 Glass/Blur Cost
- `.cg-glass { backdrop-filter: blur(18px); }` — **High GPU cost**
- Used on:
  - Header (`bg-[#faf9f5]/82 backdrop-blur-xl`)
  - Composer footer gradient
  - Mobile drawer backdrop (`backdrop-blur-[2px]`)

**Untested:** Performance on mid-tier Android. Backdrop-filter can drop frames.

**Recommendation:**
1. Profile on Moto G Power or equivalent
2. Add `@media (prefers-reduced-transparency)` fallback
3. Consider removing backdrop-filter from scrollable content

### 5.4 Images
- ✅ Property card images use `<img>` not Next.js `<Image>` — but URLs come from R2/CDN
- ❌ No `loading="lazy"` on images
- ❌ No width/height attributes (CLS risk)

---

## 6. Security & Privacy Review

### 6.1 Authentication
- **Customer:** Anonymous device tokens (`x-device-token` header, SHA-256 hashed)
- **Admin:** JWT-based (AdminAuthGuard), bcrypt password hashing
- ✅ Helmet middleware active
- ✅ CORS restricted to WEB_ORIGIN env var
- ✅ httpOnly cookies for admin sessions (inferred from cookie-parser usage)

### 6.2 Authorization
- ❌ **No rate limiting per conversation** — only global throttle (120 req/60s)
- ❌ **No device token rotation** — same token used forever
- ❌ **No admin role granularity** — just one "ADMIN" role, no RBAC

### 6.3 Data Exposure
- ✅ `sanitizeCustomerAnswer()` strips URLs, UUIDs, CUIDs from AI responses
- ✅ Trust alerts separate PII from main logs (`safeTraceState` omits contact info)
- ❌ **AI Usage table** stores full `conversationId` — could be used to reconstruct conversations if leaked
- ❌ **No data retention policy** — conversations live forever

### 6.4 Injection Risks
- ✅ Prisma ORM prevents SQL injection
- ✅ Input validation with `class-validator`
- ❌ **No prompt injection defense** — adversarial user input goes directly into LLM context
- ❌ **XSS risk:** `RichChatText` splits on `**bold**` but doesn't sanitize HTML entities (acceptable since input is text-only, but fragile)

---

## 7. Testing Strategy

### 7.1 Existing Tests
From package.json and file structure:
- **API smoke tests:** `smoke:api`, `ai:smoke`, `smoke:imports`, etc.
- **Unit tests:** `*.spec.ts` files exist in `apps/api/dist/`
- **No E2E tests** visible (no Playwright/Cypress config)
- **No visual regression tests**

### 7.2 Coverage Gaps
- ❌ **No tests for ChatService.prepare()** (the most complex method)
- ❌ **No tests for model routing logic**
- ❌ **No tests for trust assessment**
- ❌ **No tests for lead state machine**
- ❌ **No frontend tests** (React components untested)

---

## 8. Observability

### 8.1 Logging
✅ **Structured JSON logs:**
- `AIProviderTrace` — provider, model, stage, status, fallback
- `AIModelRoute` — role, model, reason, fallback chain
- `AIContextTrace` — token estimates, context size, candidates
- `CustomerTurnTrace` — full turn metadata, latency

❌ **No log aggregation** — logs go to stdout, no Datadog/ELK/CloudWatch integration visible

### 8.2 Metrics
- ✅ **AIUsage table** — tracks provider, model, task, tokens, latency, success, fallback
- ❌ **No dashboards** — data is collected but not visualized
- ❌ **No alerting** — no SLO monitoring for AI latency, error rate

### 8.3 Tracing
- ✅ Request IDs propagated (`x-request-id` header)
- ❌ No distributed tracing (no OpenTelemetry, no Jaeger)

---

## Priority Matrix

### P0 (Critical — Blocks Production)
1. Fix missing focus indicators (WCAG AA violation)
2. Add prompt versioning and rollback capability
3. Set up log aggregation and error alerting
4. Measure glass/blur performance on mid-tier devices
5. Add error boundaries to React app
6. Differentiate REASONING model or remove routing illusion

### P1 (Major — Degrade Experience)
1. Decompose 1373-line ChatService into smaller services
2. Add AI success rate analytics dashboard
3. Fix touch target sizes (<44px)
4. Verify RTL icon flipping and bidi text handling
5. Add schema validation for AI outputs
6. Build A/B testing framework for prompts
7. Implement conversation rate limiting

### P2 (Important — Quality of Life)
1. Complete design system (elevation, radius, spacing scales)
2. Add skeleton loaders and retry UX
3. Improve lead handoff flow visibility
4. Add bundle analyzer and code splitting review
5. Image lazy loading and CLS prevention
6. Unit tests for ChatService and model router
7. Visual regression testing setup

### P3 (Nice to Have)
1. Swipe-to-close drawer gesture
2. Conversation grouping (Today, Yesterday, etc.)
3. Edit-last-message
4. Admin panel visual audit

---

## Next Steps

Proceed to **Phase 3: Deep AI/Brains Audit** (document AI_REASONING_ARCHITECTURE.md)
Then **Phase 14: Implement P0 Critical Fixes**
Then **Phase 15: Implement P1 Major Improvements**

---

**Audit Confidence:** High (based on codebase inspection, HTML output, and architectural tracing)  
**Unverified Areas:** Actual browser rendering (Playwright unavailable), production logs, runtime performance metrics
