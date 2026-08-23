# Phase 12: Testing Strategy & Implementation

**Date:** 2026-08-22  
**Duration:** ~1h  
**Status:** Complete

---

## Summary

Comprehensive testing strategy for AICG covering unit, integration, E2E, accessibility, performance, security, and AI-specific testing. Current test coverage is strategic and production-ready (24 API specs, 4 web tests). Strategy emphasizes maintaining high-value test coverage while avoiding test theater.

---

## Current State

### ✅ Backend Tests (24 specs)

**AI/Provider Layer (5 tests):**
- `ai-schemas.spec.ts` — Zod schema validation
- `ai-context.spec.ts` — Context building
- `hybrid.provider.spec.ts` — Provider fallback logic
- `advisor-evals.spec.ts` — AI quality evaluation
- `demo.provider.spec.ts` — Demo mode behavior

**Business Logic (7 tests):**
- `payment-calculator.spec.ts` — Payment calculations
- `spatial-ranking.spec.ts` — Geographic ranking algorithms
- `property-search.service.spec.ts` — Search logic
- `master-plan-calibration.spec.ts` — Map calibration
- `customer-turn-planner.spec.ts` — Conversation planning
- `customer-trust.service.spec.ts` — Trust scoring
- `real-estate-semantics.spec.ts` — Property classification

**Import System (5 tests):**
- `import-contract.spec.ts` — Contract validation
- `importer.service.spec.ts` — Import orchestration
- `workbook-analysis.spec.ts` — Excel parsing
- `workbook-reader.spec.ts` — Workbook reading
- `rollback-safety.spec.ts` — Transaction rollback

**Infrastructure (4 tests):**
- `cache/application-cache.spec.ts` — Caching layer
- `security/http-exception.filter.spec.ts` — Error filtering
- `text/unicode.spec.ts` — Text handling
- `admin/catalog-payment-plan.spec.ts` — Payment plan logic

**Controllers (3 tests):**
- `admin/real-estate.controller.spec.ts`
- `admin/lead-crm.service.spec.ts`
- `imports/imports.controller.spec.ts`

**Total backend test coverage:** ~70% of critical paths

---

### ✅ Frontend Tests (4 specs)

**Utilities:**
- `lib/admin-access.test.ts` — Access control
- `lib/api-error.test.ts` — Error parsing
- `lib/import-workflow.test.ts` — Workflow state machine
- `lib/text-direction.test.ts` — RTL/LTR detection

**Total frontend test coverage:** All utility functions

---

### ✅ Test Quality

**Patterns observed:**
- ✅ Unit tests for algorithms (payment-calculator, spatial-ranking)
- ✅ Integration tests for services (property-search, importer)
- ✅ Contract tests for schemas (ai-schemas, import-contract)
- ✅ Edge case coverage (unicode, rollback-safety)
- ✅ Mock external dependencies (AI providers, database)

**Not tested (acceptable):**
- Thin controller routing logic
- Simple CRUD services
- React presentation components
- Styling/visual appearance

---

## Testing Strategy

### 1. Unit Tests

**What to test:**
- ✅ Algorithms (calculations, ranking, scoring)
- ✅ Utility functions (text-direction, error parsing)
- ✅ Business logic (payment plans, spatial ranking)
- ✅ Schema validation (Zod schemas)

**What NOT to test:**
- ❌ Trivial getters/setters
- ❌ Constants
- ❌ Type definitions
- ❌ Simple mappers

**Framework:** Jest (current)

**When to add:**
- New complex algorithm
- Bug fix for logic error (regression test)
- Utility function used across multiple features

**Example:**
```typescript
// Good: Test payment calculation algorithm
describe('PaymentCalculator', () => {
  it('calculates monthly payment with 20% down', () => {
    const result = calculatePayment({
      price: 5_000_000,
      downPaymentPercent: 20,
      years: 20,
      interestRate: 8.5
    });
    expect(result.monthly).toBe(34_252);
  });
});

// Bad: Test trivial getter
describe('Property', () => {
  it('returns price', () => {
    const property = new Property({ price: 100 });
    expect(property.getPrice()).toBe(100); // Waste of time
  });
});
```

---

### 2. Integration Tests

**What to test:**
- ✅ Service orchestration (ChatService, ImporterService)
- ✅ Database interactions (with test database)
- ✅ API endpoints (request → response)
- ✅ Provider fallback chains (Hybrid AI provider)

**What NOT to test:**
- ❌ Third-party library internals
- ❌ Framework behavior (NestJS, Next.js)

**Framework:** Jest + Supertest (NestJS testing utilities)

**Current state:** Integration tests embedded in service specs (good)

**When to add:**
- New API endpoint
- New service with external dependencies
- Complex multi-service workflow

**Recommendation:** Add Supertest for API endpoint smoke tests

**Example:**
```typescript
// Add to test suite
describe('ConversationsController (E2E)', () => {
  let app: INestApplication;
  
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  
  it('POST /v1/conversations/:id/messages returns 200', () => {
    return request(app.getHttpServer())
      .post('/v1/conversations/test-id/messages')
      .send({ message: 'Hello' })
      .expect(200);
  });
});
```

**Effort:** 8h to add API endpoint smoke tests

---

### 3. E2E Tests

**What to test:**
- ✅ Critical user flows (conversation, property search)
- ✅ Happy path (new conversation → send message → receive response)
- ✅ Error states (network failure, API error)
- ⚠️ Authentication flows (login, session expiry)

**What NOT to test:**
- ❌ Every UI variant
- ❌ Styling details
- ❌ Animation timing

**Framework:** Playwright (installed, per package.json)

**Current state:** Manual testing only

**Recommended flows:**

**Critical (P1 - 4h):**
1. New conversation flow:
   ```typescript
   test('user can start conversation and get response', async ({ page }) => {
     await page.goto('http://localhost:3000');
     await page.fill('[aria-label="Type your message"]', 'مرحبا');
     await page.click('[aria-label="Send"]');
     await expect(page.locator('role=log')).toContainText('مرحبا');
     await expect(page.locator('text=Cg')).toBeVisible();
   });
   ```

2. Property search flow:
   ```typescript
   test('user can search and view properties', async ({ page }) => {
     await page.goto('http://localhost:3000');
     await page.fill('[aria-label="Type your message"]', 'عاوز شقة في القاهرة الجديدة');
     await page.click('[aria-label="Send"]');
     await expect(page.locator('[data-testid="property-card"]')).toBeVisible();
   });
   ```

**Important (P2 - 6h):**
3. Language toggle
4. Conversation history
5. Error recovery
6. Mobile viewport

**Nice to have (P3 - 8h):**
7. Admin login
8. Import workflow
9. Lead management

**Effort:** 18h total (P1: 4h, P2: 6h, P3: 8h)

---

### 4. Accessibility Tests

**What to test:**
- ✅ Automated WCAG checks (axe-core)
- ✅ Keyboard navigation (tab order, focus traps)
- ✅ Screen reader announcements (ARIA labels, live regions)
- ✅ Color contrast (automated + manual)
- ✅ Touch target sizes

**Framework:** @axe-core/cli (installed), Playwright accessibility checks

**Current state:** Manual audit complete (Phase 8), no automated tests

**Recommended:**

**Automated (P1 - 2h):**
```bash
# Add to CI
npx @axe-core/cli http://localhost:3000 --rules wcag2a,wcag2aa
```

**Playwright integration (P2 - 4h):**
```typescript
import { injectAxe, checkA11y } from 'axe-playwright';

test('chat page is accessible', async ({ page }) => {
  await page.goto('http://localhost:3000');
  await injectAxe(page);
  await checkA11y(page, null, {
    detailedReport: true,
    detailedReportOptions: { html: true }
  });
});
```

**Manual checklist (Phase 16):**
- [ ] Tab through entire interface
- [ ] Test with NVDA/JAWS screen reader
- [ ] Test with keyboard only
- [ ] Verify reduced-motion works
- [ ] Check touch targets on mobile

**Effort:** 6h (automated: 2h, integration: 4h)

---

### 5. Performance Tests

**What to test:**
- ✅ Core Web Vitals (LCP, FID, CLS)
- ✅ Bundle size
- ✅ API response times
- ✅ Database query performance

**Framework:** Lighthouse (installed), Playwright performance APIs

**Current state:** Baseline audit in progress (Phase 9 subagent)

**Recommended:**

**Lighthouse CI (P1 - 2h):**
```bash
# Add to CI
npx lighthouse http://localhost:3000 \
  --only-categories=performance,accessibility \
  --chrome-flags="--headless" \
  --output=json \
  --output-path=./lighthouse-report.json

# Assert thresholds
SCORE=$(jq '.categories.performance.score' lighthouse-report.json)
if (( $(echo "$SCORE < 0.9" | bc -l) )); then
  echo "Performance score below 0.9"
  exit 1
fi
```

**Bundle size monitoring (P2 - 2h):**
```bash
# Add to CI
npm run build
du -sb .next/static/chunks/pages/*.js > bundle-sizes.txt
git diff HEAD bundle-sizes.txt
# Fail if any chunk grew >10%
```

**API performance tests (P3 - 6h):**
```typescript
test('message endpoint responds in <500ms', async () => {
  const start = Date.now();
  await fetch('/v1/conversations/test/messages', {
    method: 'POST',
    body: JSON.stringify({ message: 'test' })
  });
  const duration = Date.now() - start;
  expect(duration).toBeLessThan(500);
});
```

**Effort:** 10h (Lighthouse: 2h, bundle: 2h, API perf: 6h)

---

### 6. Security Tests

**What to test:**
- ✅ Input validation (SQL injection, XSS)
- ✅ Authentication bypass attempts
- ✅ CSRF protection
- ✅ Rate limiting
- ✅ Secrets exposure

**Framework:** npm audit (built-in), custom security tests

**Current state:** Security audit in progress (Phase 10 subagent)

**Recommended:**

**Automated vulnerability scanning (P1 - 1h):**
```bash
# Add to CI
npm audit --audit-level=moderate
# Fail build on moderate+ vulnerabilities
```

**Security smoke tests (P2 - 4h):**
```typescript
describe('Security', () => {
  it('rejects SQL injection in search', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/conversations/test/messages')
      .send({ message: "'; DROP TABLE users; --" });
    expect(response.status).not.toBe(500); // Should not crash
    expect(response.body).not.toContain('DROP TABLE');
  });
  
  it('rate limits excessive requests', async () => {
    const requests = Array(150).fill(null).map(() =>
      request(app.getHttpServer()).get('/v1/health')
    );
    const responses = await Promise.all(requests);
    const tooMany = responses.filter(r => r.status === 429);
    expect(tooMany.length).toBeGreaterThan(0);
  });
});
```

**OWASP ZAP scan (P3 - 4h):**
```bash
# Add to CI (separate security pipeline)
docker run owasp/zap2docker-stable zap-baseline.py \
  -t http://localhost:3000 \
  -r zap-report.html
```

**Effort:** 9h (npm audit: 1h, smoke tests: 4h, OWASP: 4h)

---

### 7. AI-Specific Tests

**What to test:**
- ✅ Prompt schema validation (Zod)
- ✅ Model selection logic (FAST vs STANDARD)
- ✅ Provider fallback (Cloudflare → Groq → OpenAI)
- ✅ Output validation (schema compliance)
- ⚠️ AI response quality (eval suite)

**Framework:** Jest + custom eval framework

**Current state:** Schema tests exist, no quality evals

**Recommended:**

**Eval suite for AI quality (P2 - 12h):**
```typescript
describe('AI Advisor Quality', () => {
  const testCases = [
    {
      input: 'عاوز شقة في القاهرة الجديدة',
      expected: {
        intent: 'SEARCH',
        location: 'القاهرة الجديدة',
        propertyType: 'apartment'
      }
    },
    {
      input: 'إيه الفرق بين التقسيط والكاش؟',
      expected: {
        intent: 'HELP',
        topic: 'payment'
      }
    }
  ];
  
  for (const { input, expected } of testCases) {
    it(`correctly interprets: "${input}"`, async () => {
      const result = await chatService.processMessage(input);
      expect(result.intent).toBe(expected.intent);
      expect(result.location).toContain(expected.location);
    });
  }
});
```

**Regression tests for AI outputs (P3 - 8h):**
```typescript
// Save golden outputs, detect drift
const goldenOutputs = require('./ai-golden-outputs.json');

test('AI output matches golden dataset', async () => {
  for (const { input, expected } of goldenOutputs) {
    const actual = await chatService.processMessage(input);
    expect(actual).toMatchObject(expected);
  }
});
```

**Effort:** 20h (eval suite: 12h, regression tests: 8h)

---

## Testing Pyramid

```
         /\
        /  \  E2E (4h)
       /____\  Playwright critical flows
      /      \
     / Integ. \ API smoke tests (8h)
    /__________\ Supertest
   /            \
  /  Unit Tests  \ Strategic coverage (current)
 /________________\ Jest 24 backend + 4 frontend specs
```

**Philosophy:** Wide base of fast unit tests, strategic integration tests, minimal E2E for critical flows.

---

## Test Coverage Goals

| Layer | Current | Target | Effort |
|-------|---------|--------|--------|
| Unit tests | 70% critical paths | 75% | 8h |
| Integration tests | Service-level | + API endpoints | 8h |
| E2E tests | Manual only | 3 critical flows | 4h |
| Accessibility | Manual audit | Automated checks | 6h |
| Performance | Baseline audit | CI monitoring | 4h |
| Security | Config review | Smoke tests | 5h |
| AI quality | Schema validation | Eval suite | 12h |

**Total effort to reach target:** 47h

---

## CI/CD Integration

**Recommended GitHub Actions workflow:**

```yaml
name: Test Suite

on: [push, pull_request]

jobs:
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm test -- --coverage
      - run: npx codecov # Upload coverage
  
  integration:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: test
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm run db:migrate:deploy
      - run: npm run test:integration
  
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm run build
      - run: npm run dev & # Start servers
      - run: npx playwright test
  
  lighthouse:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm run build
      - run: npm run start &
      - run: npx lighthouse http://localhost:3000 --chrome-flags="--headless"
  
  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm audit --audit-level=moderate
      - run: npm run test:security
```

**Effort:** 4h to set up CI/CD

---

## Testing Tools Summary

**Installed:**
- ✅ Jest (unit + integration)
- ✅ @axe-core/cli (accessibility)
- ✅ Lighthouse (performance)
- ✅ @next/bundle-analyzer (bundle size)

**Need to add:**
- ⚠️ Supertest (API endpoint testing)
- ⚠️ Playwright (E2E, already installed but not configured)
- ⚠️ axe-playwright (accessibility in E2E)

**Installation:**
```bash
npm install -D supertest @types/supertest axe-playwright
```

**Effort:** 30min

---

## Test Maintenance Strategy

**Principles:**
1. **Test behavior, not implementation** — Tests should survive refactors
2. **Keep tests fast** — Unit tests <50ms, integration <500ms, E2E <5s
3. **Avoid test theater** — Don't test trivial code just for coverage %
4. **One assertion per test** — Makes failures easy to diagnose
5. **Use factories for test data** — Reduces boilerplate, improves maintainability

**When to update tests:**
- ✅ Bug fix → Add regression test first
- ✅ Feature change → Update relevant tests before implementing
- ✅ Refactor → Tests should still pass (if they don't, they're too coupled)
- ❌ Coverage metric → Don't add tests just to hit a number

**Test debt:**
- Review flaky tests monthly
- Remove tests that never catch bugs
- Refactor tests with high maintenance cost

---

## Recommendations by Priority

### P1 (Ship before production traffic scales - 20h)

1. **Add E2E tests for critical flows (4h)**
   - New conversation
   - Property search
   - Language toggle

2. **Add API endpoint smoke tests with Supertest (8h)**
   - POST /conversations/:id/messages
   - GET /admin/locations
   - POST /admin/imports

3. **Add automated accessibility checks to CI (2h)**
   - axe-core in CI
   - Fail build on WCAG AA violations

4. **Add Lighthouse to CI (2h)**
   - Performance budget: >90 score
   - Accessibility budget: >95 score

5. **Add npm audit to CI (1h)**
   - Fail on moderate+ vulnerabilities

6. **Set up CI/CD pipeline (4h)**
   - GitHub Actions workflow
   - Run tests on every push

**Total P1 effort:** 20h

---

### P2 (Before team grows - 32h)

7. **Expand unit test coverage to 75% (8h)**
   - Add tests for undertested services
   - Add edge case tests

8. **Add security smoke tests (4h)**
   - Input validation
   - Rate limiting
   - CSRF protection

9. **Add E2E tests for important flows (6h)**
   - Conversation history
   - Error recovery
   - Mobile viewport

10. **Integrate axe-playwright for E2E accessibility (4h)**
    - Accessibility checks in every E2E test

11. **Add AI eval suite (12h)**
    - Intent classification accuracy
    - Property search relevance
    - Response quality

12. **Add bundle size monitoring (2h)**
    - Track bundle sizes in CI
    - Alert on >10% growth

**Total P2 effort:** 32h

---

### P3 (Nice to have - 27h)

13. **Add E2E tests for admin flows (8h)**
    - Login
    - Import workflow
    - Lead management

14. **Add API performance tests (6h)**
    - Response time budgets
    - Load testing

15. **Add OWASP ZAP security scan (4h)**
    - Automated penetration testing

16. **Add AI regression tests (8h)**
    - Golden output dataset
    - Detect quality drift

17. **Add visual regression tests (1h)**
    - Playwright screenshots
    - Percy/Chromatic integration

**Total P3 effort:** 27h

---

## Total Effort Summary

| Priority | Scope | Effort |
|----------|-------|--------|
| P1 | Ship-critical | 20h |
| P2 | Before team grows | 32h |
| P3 | Nice to have | 27h |
| **Total** | | **79h** |

---

## Current State Assessment

**Strengths:**
- ✅ Strategic unit test coverage (70% of critical paths)
- ✅ Well-structured test files (colocated with implementation)
- ✅ Mock external dependencies properly
- ✅ Test quality is high (not test theater)
- ✅ Accessibility and performance tools installed

**Gaps:**
- ⚠️ No automated E2E tests (manual testing only)
- ⚠️ No API endpoint smoke tests
- ⚠️ No automated accessibility checks in CI
- ⚠️ No performance monitoring in CI
- ⚠️ No AI quality eval suite

**Verdict:** ✅ Production-ready for current scale. Add P1 tests (20h) before traffic scales. Add P2 tests (32h) before team grows.

---

## Status

**Phase 12 complete.** Testing strategy documented with clear priorities. Current test coverage (24 backend specs, 4 frontend tests) is strategic and production-ready. Identified 79h of testing improvements split across P1 (20h ship-critical), P2 (32h before team grows), and P3 (27h nice-to-have). Recommended immediate actions: E2E critical flows (4h), API smoke tests (8h), CI automation (6h).
