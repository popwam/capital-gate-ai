# AICG Implementation Plan
**Date:** 2026-08-20  
**Status:** Ready for execution  
**Estimated Duration:** 6-8 weeks (phased rollout)

## Overview

This plan addresses critical gaps identified in the comprehensive audit, organized by priority tier. Each item includes implementation approach, testing strategy, and success criteria.

---

## P0: Critical (Blocks Production) — Week 1-2

### P0.1: Fix Missing Focus Indicators (WCAG AA Violation)

**Problem:** No visible focus states on interactive elements — accessibility blocker.

**Files to change:**
- `apps/web/app/globals.css`
- `apps/web/tailwind.config.ts`

**Implementation:**
```css
/* globals.css - Add focus system */
*:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

button:focus-visible, a:focus-visible {
  outline: 2px solid #173f3b;
  outline-offset: 2px;
  box-shadow: 0 0 0 4px rgba(23, 63, 59, 0.1);
}

.cg-glass:focus-visible {
  outline: 2px solid #b08c52;
  outline-offset: 2px;
}
```

**Testing:**
- Tab through all interactive elements
- Verify focus ring visible in light and dark modes
- Check contrast ratio ≥3:1 against background
- Test with keyboard-only navigation

**Success Criteria:**
- ✅ All buttons, links, inputs have visible focus
- ✅ Focus ring contrast passes WCAG AA
- ✅ Focus order is logical

**Estimated Time:** 4 hours

---

### P0.2: Add Prompt Versioning System

**Problem:** Cannot roll back prompt changes or track which version caused issues.

**New files:**
- `apps/api/src/prompts/` directory
- `apps/api/src/prompts/v1/intent-extraction.hbs`
- `apps/api/src/prompts/v1/answer-generation.hbs`
- `apps/api/src/prompts/prompt-loader.ts`
- `apps/api/src/prompts/prompt-registry.ts`

**Database migration:**
```prisma
model AIUsage {
  // ... existing fields
  promptVersion    String?         // e.g. "v1.0.2"
  promptVariant    String?         // e.g. "control" | "experiment-a"
}
```

**Implementation:**
```typescript
// prompt-loader.ts
import Handlebars from 'handlebars';
import fs from 'fs/promises';

export class PromptLoader {
  private cache = new Map<string, HandlebarsTemplateDelegate>();
  
  async load(name: string, version: string = 'v1'): Promise<HandlebarsTemplateDelegate> {
    const key = `${version}/${name}`;
    if (this.cache.has(key)) return this.cache.get(key)!;
    
    const path = `${__dirname}/${version}/${name}.hbs`;
    const source = await fs.readFile(path, 'utf-8');
    const template = Handlebars.compile(source);
    this.cache.set(key, template);
    return template;
  }
}
```

**Template structure:**
```handlebars
{{!-- prompts/v1/answer-generation.hbs --}}
---
version: 1.0.0
description: Real estate conversational answer generation
model: groq/openai-gpt-oss-120b
---

أنت مساعد عقاري ذكي. مهمتك...

{{#if verifiedFacts}}
الوحدات المتاحة:
{{#each verifiedFacts}}
- {{this.name}}: {{this.price}}
{{/each}}
{{/if}}

السؤال: {{customerMessage}}
```

**Migration path:**
1. Extract current inline prompts to templates
2. Add version metadata to each template
3. Update HybridAIProvider to use PromptLoader
4. Track version in AIUsage table
5. Create prompt changelog

**Testing:**
- Unit test prompt loader (version resolution, caching)
- Integration test: same input with v1 vs v2 produces expected differences
- Rollback test: switch from v2 → v1, verify no errors

**Success Criteria:**
- ✅ All prompts loaded from versioned templates
- ✅ Version tracked in AIUsage table
- ✅ Can rollback to previous version in <5 minutes
- ✅ Prompt changelog documents each version

**Estimated Time:** 16 hours

---

### P0.3: Set Up Log Aggregation and Alerting

**Problem:** Logs go to stdout with no way to query trends, detect anomalies, or alert on issues.

**Options:**
1. **Railway built-in logs** (if deployed on Railway)
2. **CloudWatch** (if AWS-based)
3. **Datadog** (full observability platform)
4. **Grafana Loki + Prometheus** (self-hosted)

**Recommended:** Railway logs + Grafana Cloud (free tier: 50GB logs/month)

**Implementation:**

**Step 1: Structured logging validation**
```typescript
// apps/api/src/logging/structured-logger.ts
export interface StructuredLog {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  requestId: string;
  type: 'AIProviderTrace' | 'AIModelRoute' | 'AIContextTrace' | 'CustomerTurnTrace';
  [key: string]: unknown;
}

export class StructuredLogger {
  log(data: StructuredLog) {
    console.log(JSON.stringify(data));
  }
}
```

**Step 2: Key metrics to track**
- AI success rate by provider (target: >95%)
- Fallback rate (target: <10%)
- P95 latency by model (target: <3s)
- Context 413 error rate (target: <2%)
- Grounding contradiction rate (target: <5%)

**Step 3: Alerts**
```yaml
# alerts.yml (for Grafana)
- alert: HighAIFailureRate
  expr: (sum(rate(ai_usage_error_total[5m])) / sum(rate(ai_usage_total[5m]))) > 0.10
  for: 5m
  annotations:
    summary: "AI failure rate above 10% for 5 minutes"

- alert: HighFallbackRate
  expr: (sum(rate(ai_usage_fallback_total[5m])) / sum(rate(ai_usage_total[5m]))) > 0.20
  for: 10m
  annotations:
    summary: "AI fallback rate above 20%"

- alert: SlowAIResponses
  expr: histogram_quantile(0.95, ai_latency_seconds) > 5
  for: 5m
  annotations:
    summary: "P95 AI latency above 5 seconds"
```

**Testing:**
- Simulate high error rate, verify alert fires
- Query logs for "fallback rate by model"
- Test alert notification delivery (email/Slack)

**Success Criteria:**
- ✅ Can query "What's the Groq fallback rate today?"
- ✅ Dashboard shows AI success rate by provider
- ✅ Alert fires within 5 minutes of SLO breach
- ✅ Logs retained for 30 days

**Estimated Time:** 12 hours

---

### P0.4: Measure Glass/Blur Performance

**Problem:** `backdrop-filter: blur(18px)` is GPU-expensive — performance on mid-tier devices unknown.

**Testing devices:**
- Desktop: Chrome/Firefox/Safari on Windows/Mac
- Mobile: Chrome on Moto G Power (mid-tier Android)
- Mobile: Safari on iPhone SE (mid-tier iOS)

**Metrics to measure:**
- **FPS during scroll** (target: ≥55fps)
- **Interaction to Next Paint (INP)** (target: <200ms)
- **GPU usage** (target: <80% during scroll)

**Implementation:**

**Step 1: Add performance monitoring**
```typescript
// apps/web/lib/performance-monitor.ts
export function measureScrollPerformance() {
  let lastTime = performance.now();
  let frames = 0;
  
  function tick() {
    frames++;
    const now = performance.now();
    if (now >= lastTime + 1000) {
      const fps = Math.round((frames * 1000) / (now - lastTime));
      console.log('FPS:', fps);
      if (fps < 55) {
        console.warn('Low FPS detected:', fps);
      }
      frames = 0;
      lastTime = now;
    }
    requestAnimationFrame(tick);
  }
  
  requestAnimationFrame(tick);
}
```

**Step 2: Create reduced-motion fallback**
```css
/* globals.css */
@media (prefers-reduced-transparency: reduce) {
  .cg-glass {
    backdrop-filter: none;
    background: rgba(250, 249, 245, 0.95);
  }
  
  .backdrop-blur-xl {
    backdrop-filter: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

**Step 3: Device capability detection**
```typescript
// apps/web/lib/device-capabilities.ts
export function supportsBackdropFilter(): boolean {
  return CSS.supports('backdrop-filter', 'blur(1px)');
}

export function isLowEndDevice(): boolean {
  // Heuristic: <4 cores or <4GB RAM
  return navigator.hardwareConcurrency < 4;
}
```

**Testing:**
1. Run Lighthouse on desktop (target: Performance >90)
2. Run Lighthouse on mobile emulation (target: Performance >70)
3. Profile on real Moto G Power
4. Use Chrome DevTools Performance tab: record scroll, check FPS

**Success Criteria:**
- ✅ FPS ≥55 on Moto G Power during scroll
- ✅ INP <200ms on all devices
- ✅ Reduced-transparency fallback works
- ✅ Lighthouse Performance score >70 mobile

**Estimated Time:** 8 hours

---

### P0.5: Add Error Boundaries to React App

**Problem:** Unhandled React errors crash entire app — no graceful degradation.

**Files to change:**
- `apps/web/components/error-boundary.tsx` (new)
- `apps/web/app/layout.tsx`
- `apps/web/components/chat-app.tsx`

**Implementation:**
```typescript
// components/error-boundary.tsx
'use client';
import { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: unknown) {
    console.error('ErrorBoundary caught:', error, errorInfo);
    // TODO: Send to error tracking service
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="flex items-center justify-center min-h-screen bg-sand">
          <div className="text-center">
            <h1 className="text-2xl font-semibold text-ink mb-4">
              حدث خطأ غير متوقع
            </h1>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-3 bg-forest text-white rounded-lg"
            >
              إعادة تحميل الصفحة
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
```

**Usage:**
```tsx
// app/layout.tsx
export default function RootLayout({ children }) {
  return (
    <html lang="ar" dir="rtl">
      <body>
        <ErrorBoundary>
          {children}
        </ErrorBoundary>
      </body>
    </html>
  );
}
```

**Testing:**
- Throw error in component, verify boundary catches
- Verify fallback UI renders correctly
- Check error logged to console
- Test reload button works

**Success Criteria:**
- ✅ Top-level error boundary in layout
- ✅ Error boundary around ChatApp
- ✅ Fallback UI is accessible (keyboard, screen reader)
- ✅ Errors logged for debugging

**Estimated Time:** 4 hours

---

### P0.6: Differentiate REASONING Model or Simplify Routing

**Problem:** GENERAL and REASONING both use `openai/gpt-oss-120b` — routing logic creates illusion of specialization.

**Option A: Differentiate models**
```env
GROQ_REASONING_MODEL=meta-llama/llama-4.5-405b-instruct  # Hypothetical better model
```

**Option B: Simplify routing (recommended)**

Remove REASONING tier, collapse to FAST/STANDARD:

**Files to change:**
- `apps/api/src/providers/conversation-model-router.ts`

**Implementation:**
```typescript
// Simplified routing
export enum ModelRole {
  FAST = 'FAST',      // Small talk, simple queries
  STANDARD = 'STANDARD',  // Everything else
}

function selectModel(turn: CustomerTurnAnalysis): ModelRole {
  // Simple heuristic: message length + intent complexity
  if (turn.customerMessage.length < 90 && !turn.requiresDatabase) {
    return ModelRole.FAST;
  }
  return ModelRole.STANDARD;
}
```

**Env changes:**
```env
# Remove GROQ_REASONING_MODEL
GROQ_FAST_MODEL=openai/gpt-oss-20b
GROQ_STANDARD_MODEL=openai/gpt-oss-120b
GROQ_BACKUP_MODEL=openai/gpt-oss-20b
```

**Testing:**
- Regression test: verify answers still coherent
- Compare latency: FAST should be 2-3× faster
- Verify fallback chain still works

**Success Criteria:**
- ✅ No fake reasoning tier
- ✅ Model selection logic is honest
- ✅ Documentation reflects actual routing

**Estimated Time:** 6 hours

---

## P1: Major (Degrade Experience) — Week 3-5

### P1.1: Decompose ChatService (1373 Lines)

**Implemented 2026-08-23.** Responsibility-based services now own formatting/sanitization, deterministic answers, payment presentation, property presentation, and lead handoff. `ChatService` is a 700-line orchestration facade; the approximately 200-line estimate was not forced because search preparation, streaming completion, persistence, and safe diagnostics remain one cohesive turn lifecycle. Seven focused service tests and the full 152-test API smoke suite pass.

**Deployment prerequisite:** Apply migration `20260823150000_conversation_prompt_variant` before starting this version against an existing database.

**Problem:** God object violates single responsibility — hard to test, maintain, extend.

**Target architecture:**
```
ChatService (orchestrator, ~200 lines)
  ↓
├─ IntentExtractorService (~150 lines)
├─ SearchOrchestratorService (~200 lines)
├─ TrustAssessorService (~100 lines)
├─ LeadStateMachineService (~250 lines)
├─ ResponseGeneratorService (~200 lines)
└─ ResponseSanitizerService (~100 lines)
```

**New files:**
- `apps/api/src/conversation/intent-extractor.service.ts`
- `apps/api/src/conversation/search-orchestrator.service.ts`
- `apps/api/src/conversation/trust-assessor.service.ts`
- `apps/api/src/conversation/lead-state-machine.service.ts`
- `apps/api/src/conversation/response-generator.service.ts`
- `apps/api/src/conversation/response-sanitizer.service.ts`

**Migration strategy:**
1. Extract services one at a time (don't rewrite everything at once)
2. Keep old ChatService as facade initially
3. Add unit tests for each extracted service
4. Gradually migrate ChatService to delegate to services
5. Remove old implementation once tests pass

**Testing:**
- Unit test each service in isolation
- Integration test full flow
- Regression test: same inputs → same outputs

**Success Criteria:**
- ✅ Each service <300 lines
- ✅ Each service has ≥80% test coverage
- ✅ ChatService is thin orchestrator (~200 lines)

**Estimated Time:** 40 hours

---

### P1.2: Build AI Success Rate Dashboard

**Problem:** AIUsage table collects data but no analytics or visualization.

**Implementation:**

**Option 1: Metabase (recommended for speed)**
- Open-source BI tool
- Point at PostgreSQL database
- Build dashboards with SQL queries

**Option 2: Custom admin panel**
- Add `/admin/ai-analytics` route
- Use Recharts for visualization

**Key queries:**
```sql
-- Success rate by provider (last 24h)
SELECT 
  provider,
  COUNT(*) as total,
  SUM(CASE WHEN success THEN 1 ELSE 0 END) as successful,
  ROUND(100.0 * SUM(CASE WHEN success THEN 1 ELSE 0 END) / COUNT(*), 2) as success_rate
FROM "AIUsage"
WHERE "createdAt" > NOW() - INTERVAL '24 hours'
GROUP BY provider;

-- Fallback rate by model
SELECT 
  model,
  COUNT(*) as total,
  SUM(CASE WHEN "fallbackUsed" THEN 1 ELSE 0 END) as fallbacks,
  ROUND(100.0 * SUM(CASE WHEN "fallbackUsed" THEN 1 ELSE 0 END) / COUNT(*), 2) as fallback_rate
FROM "AIUsage"
WHERE "createdAt" > NOW() - INTERVAL '24 hours'
GROUP BY model;

-- P95 latency by model
SELECT 
  model,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency) as p95_latency
FROM "AIUsage"
WHERE "createdAt" > NOW() - INTERVAL '24 hours'
GROUP BY model;
```

**Dashboard panels:**
1. Overall AI success rate (gauge)
2. Success rate by provider (bar chart)
3. Fallback rate by model (line chart over time)
4. P50/P95 latency (line chart)
5. Token usage by task (pie chart)
6. Top error messages (table)

**Success Criteria:**
- ✅ Dashboard accessible at `/admin/ai-analytics`
- ✅ Data refreshes every 5 minutes
- ✅ Can filter by date range
- ✅ Can drill down into individual requests

**Estimated Time:** 16 hours

---

### P1.3: Fix Touch Target Sizes (<44px)

**Problem:** Property card action buttons are 40px — below WCAG recommendation.

**Files to change:**
- `apps/web/components/chat-app.tsx` (PropertyResults component)

**Implementation:**
```tsx
// Change h-10 → h-11 (44px)
<button className="flex items-center gap-2 px-4 h-11 rounded-lg border border-ink/10">
  <Camera className="w-4 h-4" />
  <span>الصور</span>
</button>
```

**Testing:**
- Visual check on mobile (Chrome DevTools device emulation)
- Test on real device (tap accuracy)
- Verify still fits in card layout

**Success Criteria:**
- ✅ All touch targets ≥44×44px
- ✅ No layout breakage

**Estimated Time:** 2 hours

---

### P1.4: Verify RTL Icon Flipping

**Problem:** Directional icons (arrows, chevrons) should mirror in RTL but currently don't.

**Files to change:**
- `apps/web/app/globals.css`

**Implementation:**
```css
/* Flip directional icons in RTL */
[dir="rtl"] .lucide-arrow-right,
[dir="rtl"] .lucide-chevron-right,
[dir="rtl"] .lucide-chevron-left,
[dir="rtl"] .lucide-arrow-left {
  transform: scaleX(-1);
}
```

**Testing:**
- Check send button arrow
- Check drawer close icon
- Check conversation list chevrons
- Test in both RTL and LTR modes

**Success Criteria:**
- ✅ Directional icons flip in RTL
- ✅ Non-directional icons (search, close) don't flip

**Estimated Time:** 2 hours

---

### P1.5: Add Schema Validation for AI Outputs

**Problem:** AI outputs consumed raw — no guarantee of shape correctness.

**Implementation:**

**Install Zod:**
```bash
npm install zod --save -w @maqar/api
```

**Define schemas:**
```typescript
// apps/api/src/providers/ai-schemas.ts
import { z } from 'zod';

export const StructuredIntentSchema = z.object({
  primaryIntent: z.enum([...30+ intent types]),
  location: z.string().optional(),
  unitType: z.enum(['APARTMENT', 'VILLA', 'TOWNHOUSE', 'STUDIO']).optional(),
  minPrice: z.number().optional(),
  maxPrice: z.number().optional(),
  // ... 100+ fields
});

export type StructuredIntent = z.infer<typeof StructuredIntentSchema>;
```

**Use in provider:**
```typescript
async extractIntent(input: IntentInput): Promise<StructuredIntent> {
  const raw = await this.workersAI.call(/* ... */);
  
  // Validate before returning
  const parsed = StructuredIntentSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn('Invalid intent schema:', parsed.error);
    return this.deterministicFallback(input);
  }
  
  return parsed.data;
}
```

**Testing:**
- Unit test schema validation
- Test malformed AI response triggers fallback
- Verify valid responses pass through

**Success Criteria:**
- ✅ All AI outputs validated with Zod
- ✅ Invalid outputs logged + fallback triggered
- ✅ No runtime type errors from AI responses

**Estimated Time:** 12 hours

---

### P1.6: Build A/B Testing Framework for Prompts

**Problem:** Cannot experiment with prompt variations to improve quality.

**Database migration:**
```prisma
model Conversation {
  // ... existing fields
  promptVariant    String?  @default("control")  // "control" | "experiment-a" | "experiment-b"
}
```

**Implementation:**
```typescript
// apps/api/src/prompts/ab-tester.ts
export class PromptABTester {
  assignVariant(conversationId: string): string {
    // Hash-based assignment (stable per conversation)
    const hash = createHash('sha256').update(conversationId).digest('hex');
    const value = parseInt(hash.substring(0, 8), 16) % 100;
    
    // 80% control, 10% experiment-a, 10% experiment-b
    if (value < 80) return 'control';
    if (value < 90) return 'experiment-a';
    return 'experiment-b';
  }
  
  async loadPrompt(name: string, variant: string): Promise<string> {
    const version = this.variantToVersion(variant);
    return this.promptLoader.load(name, version);
  }
}
```

**Analysis query:**
```sql
-- Compare success rates by variant
SELECT 
  c."promptVariant",
  COUNT(*) as total_conversations,
  AVG(CASE WHEN l.id IS NOT NULL THEN 1 ELSE 0 END) as lead_conversion_rate,
  AVG((SELECT COUNT(*) FROM "Message" m WHERE m."conversationId" = c.id)) as avg_messages
FROM "Conversation" c
LEFT JOIN "Lead" l ON l."conversationId" = c.id
WHERE c."createdAt" > NOW() - INTERVAL '7 days'
GROUP BY c."promptVariant";
```

**Success Criteria:**
- ✅ Can deploy prompt experiment without code change
- ✅ Traffic split is stable (same conversation always gets same variant)
- ✅ Can compare metrics by variant
- ✅ Can promote winning variant to control

**Estimated Time:** 16 hours

---

### P1.7: Implement Conversation Rate Limiting

**Problem:** No per-conversation limit — abuse possible.

**Implementation:**

**Add to Prisma schema:**
```prisma
model Conversation {
  // ... existing fields
  messageCount     Int      @default(0)
}
```

**Middleware:**
```typescript
// apps/api/src/middleware/conversation-rate-limit.middleware.ts
@Injectable()
export class ConversationRateLimitMiddleware implements NestMiddleware {
  constructor(private prisma: PrismaService) {}
  
  async use(req: Request, res: Response, next: NextFunction) {
    const conversationId = req.params.id;
    
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { messageCount: true, createdAt: true },
    });
    
    if (!conv) return next();
    
    // Rule 1: Max 50 messages per conversation
    if (conv.messageCount >= 50) {
      return res.status(429).json({ error: 'Conversation message limit reached' });
    }
    
    // Rule 2: Max 20 messages in first hour
    const age = Date.now() - conv.createdAt.getTime();
    if (age < 3600000 && conv.messageCount >= 20) {
      return res.status(429).json({ error: 'Too many messages too quickly' });
    }
    
    next();
  }
}
```

**Update message creation:**
```typescript
// Increment messageCount atomically
await prisma.conversation.update({
  where: { id: conversationId },
  data: { messageCount: { increment: 1 } },
});
```

**Success Criteria:**
- ✅ Cannot send >50 messages per conversation
- ✅ Cannot send >20 messages in first hour
- ✅ Returns 429 with clear error message

**Estimated Time:** 6 hours

---

## P2: Important (Quality of Life) — Week 6-7

### P2.1: Complete Design System
- Define 8-color palette (not 4)
- Create elevation scale (8 levels, not 2)
- Add spacing scale (4px base)
- Add border-radius scale
- Document in `apps/web/design-system.md`

**Estimated Time:** 16 hours

### P2.2: Add Skeleton Loaders
- Property card skeleton
- Message skeleton
- Streaming indicator enhancement

**Estimated Time:** 8 hours

### P2.3: Improve Lead Handoff Flow Visibility
- Add progress indicator (PAYMENT → IDENTITY → CONFIRMATION → COMPLETE)
- Show current stage in UI
- Explain why each step is needed

**Estimated Time:** 12 hours

### P2.4: Add Bundle Analyzer
- Install `@next/bundle-analyzer`
- Document bundle sizes
- Identify optimization opportunities

**Estimated Time:** 4 hours

### P2.5: Image Lazy Loading & CLS Prevention
- Add `loading="lazy"` to property images
- Add `width` and `height` attributes
- Measure CLS improvement

**Estimated Time:** 4 hours

### P2.6: Unit Tests for ChatService and Model Router
- Extract testable functions first
- Write Jest tests
- Aim for 80% coverage

**Estimated Time:** 24 hours

### P2.7: Visual Regression Testing Setup
- Install Playwright
- Create snapshot tests for key screens
- Add to CI pipeline

**Estimated Time:** 12 hours

---

## P3: Nice to Have — Week 8

### P3.1: Swipe-to-Close Drawer Gesture
**Estimated Time:** 6 hours

### P3.2: Conversation Grouping (Today, Yesterday, etc.)
**Estimated Time:** 8 hours

### P3.3: Edit-Last-Message
**Estimated Time:** 8 hours

### P3.4: Admin Panel Visual Audit
**Estimated Time:** 16 hours

---

## Success Metrics

### Technical Health
- **P0 completion:** 100% (all 6 items)
- **Test coverage:** >70% (currently unknown)
- **Build time:** <2 minutes (currently unknown)
- **Type errors:** 0
- **Lint errors:** 0

### User Experience
- **Lighthouse Performance:** >70 mobile, >90 desktop
- **WCAG AA compliance:** 100% (currently failing on focus indicators)
- **Core Web Vitals:** All "Good" (LCP <2.5s, INP <200ms, CLS <0.1)

### AI Quality
- **Success rate:** >95%
- **Fallback rate:** <10%
- **P95 latency:** <3s
- **Grounding errors:** <5%

### Observability
- **Log retention:** 30 days
- **Dashboard coverage:** 6 key metrics
- **Alert response time:** <5 minutes
- **Incident detection:** <10 minutes

---

## Risk Mitigation

### Risk 1: Breaking Changes During Refactor
**Mitigation:** Feature flags, gradual rollout, comprehensive tests

### Risk 2: Performance Regression from Monitoring
**Mitigation:** Profile overhead, use sampling (1% of requests)

### Risk 3: Prompt Experiments Degrade Quality
**Mitigation:** Kill switch, automatic rollback if success rate drops >5%

### Risk 4: Log Storage Costs
**Mitigation:** Start with free tier, set retention policy, monitor costs weekly

---

## Timeline Summary

| Week | Focus | Deliverables |
|------|-------|--------------|
| 1 | P0.1-P0.3 | Focus indicators, prompt versioning, log aggregation |
| 2 | P0.4-P0.6 | Performance audit, error boundaries, routing simplification |
| 3 | P1.1-P1.2 | Service decomposition, AI dashboard |
| 4 | P1.3-P1.5 | Touch targets, RTL, schema validation |
| 5 | P1.6-P1.7 | A/B testing, rate limiting |
| 6 | P2.1-P2.4 | Design system, skeletons, bundle analysis |
| 7 | P2.5-P2.7 | Images, tests, visual regression |
| 8 | P3 + Buffer | Nice-to-haves, documentation, polish |

**Total Duration:** 8 weeks  
**Team Size:** 1 senior full-stack engineer (you)  
**Dependencies:** None (all internal)

---

**Next Step:** Begin P0.1 (Focus Indicators) immediately.
