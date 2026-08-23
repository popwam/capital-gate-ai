# AICG Remediation Checklist

**Created:** 2026-08-22  
**Status:** In Progress  
**Mode:** Autonomous Remediation + Verification

---

## P0: Critical Security Fixes (MUST FIX)

### C1: Production Secrets Default to Dev Values ⏳
**Files:** `apps/api/src/devices.service.ts`, `apps/api/src/auth/auth.module.ts`  
**Issue:** Secrets fall back to hardcoded dev values if env vars not set  
**Fix:** Enforce required env vars at startup, throw error if missing  
**Verification:** Start API without env vars, expect crash with clear error  
**Estimated Time:** 2h

### C2: Admin Routes Lack Rate Limiting ⏳
**Files:** 14 admin controllers in `apps/api/src/admin/*.controller.ts`  
**Issue:** Admin endpoints use global 120 req/min, vulnerable to brute-force  
**Fix:** Add `@Throttle({ default: { limit: 5, ttl: 60_000 } })` to all admin controllers  
**Verification:** Send 6 requests in 60s to admin endpoint, expect 429 on 6th  
**Estimated Time:** 4h

### C3: LLM Output XSS Risk ⏳
**Files:** `apps/api/src/chat.service.ts`, `apps/web/components/chat-app.tsx`  
**Issue:** AI-generated text rendered without sanitization  
**Fix:** Install `isomorphic-dompurify`, sanitize all AI output, add CSP headers  
**Verification:** Inject `<img src=x onerror=alert(1)>` in property name, verify no execution  
**Estimated Time:** 4h

---

## P0: Deployment Configuration Gaps

### Prompt Files Not Copied to dist/ ⏳
**File:** `apps/api/tsconfig.json` or `apps/api/nest-cli.json`  
**Issue:** `prompts/` directory not included in build output  
**Fix:** Add `prompts/` to assets array in nest-cli.json  
**Verification:** Run `npm run build -w @maqar/api`, verify `dist/prompts/v1/*.hbs` exist  
**Estimated Time:** 30m

### Hero Image 3MB → <300KB ⏳
**File:** `apps/web/public/new-cairo-residences.png`  
**Issue:** 3MB PNG destroys LCP performance  
**Fix:** Convert to WebP using sharp/imagemin, target <300KB  
**Verification:** Check file size, measure LCP improvement  
**Estimated Time:** 1h

---

## P1: High Priority Security

### H1: Admin Endpoints Missing RBAC ⏳
**Files:** 14 admin controllers  
**Issue:** No role differentiation (viewer/editor/super-admin)  
**Fix:** Implement Roles decorator + RolesGuard  
**Verification:** Test with different role levels, verify access control  
**Estimated Time:** 16h (DEFERRED - requires role data model)

### H2: File Upload Magic Number Validation ⏳
**File:** `apps/api/src/storage/storage.service.ts`  
**Issue:** File type validation relies on extension, not content  
**Fix:** Install `file-type`, validate buffer magic numbers  
**Verification:** Upload .exe renamed to .xlsx, expect rejection  
**Estimated Time:** 4h

### H3: Google Maps API Key Exposed ⏳
**Files:** `apps/web/components/chat-app.tsx`, backend proxy  
**Issue:** Maps URLs constructed client-side, key might be exposed  
**Fix:** Proxy Google Maps requests through backend endpoint  
**Verification:** Inspect network tab, verify no API key in client bundle  
**Estimated Time:** 6h

### H4: Session Tokens in localStorage ⏳
**Files:** Auth logic (needs investigation)  
**Issue:** XSS can steal tokens from localStorage  
**Fix:** Migrate to httpOnly cookies with secure/sameSite flags  
**Verification:** Verify localStorage empty, cookies httpOnly  
**Estimated Time:** 8h (DEFERRED - major auth refactor)

### H5: AI Provider Credentials Logged ⏳
**Files:** Provider files, logging interceptors  
**Issue:** API keys might appear in logs  
**Fix:** Add sanitization interceptor, redact Authorization/x-api-key headers  
**Verification:** Trigger error with API call, check logs for redacted keys  
**Estimated Time:** 4h

---

## P1: Performance Fixes

### Property Cards: Replace <img> with next/image ⏳
**File:** `apps/web/components/chat-app.tsx:210`  
**Issue:** No lazy loading, no format negotiation, no responsive sizing  
**Fix:** Replace `<img>` with Next.js `<Image>` component  
**Verification:** Verify lazy loading below fold, WebP served to modern browsers  
**Estimated Time:** 2h

### Bundle Size Baseline Measurement ⏳
**Command:** `ANALYZE=true npm run build`  
**Issue:** No baseline established  
**Fix:** Run analyzer, document results, set up size-limit checks  
**Verification:** Bundle map generated, sizes documented  
**Estimated Time:** 1h

### Glass Blur GPU Profiling ⏳
**Files:** `apps/web/app/globals.css:297-299`, header/composer components  
**Issue:** 24px blur on fixed header may cause scroll jank  
**Fix:** Profile on real device, reduce blur or disable during scroll if needed  
**Verification:** 60fps scroll on mid-tier Android  
**Estimated Time:** 4h (DEFERRED - requires device testing)

---

## P1: Code Quality - ChatService Decomposition ⏳

### Decompose ChatService (1372 lines)

**Completed 2026-08-23:** Five cohesive services were extracted and wired through NestJS DI. `ChatService` is 700 lines, down from 1,374. Focused service tests and the full API smoke suite pass (152/152). The facade remains larger than the original estimate because the retained turn preparation/stream/persistence lifecycle is cohesive.
**File:** `apps/api/src/chat.service.ts`  
**Issue:** Single service with multiple responsibilities  
**Fix:** Extract cohesive services:
  - `IntentPlannerService` (user turn planning)
  - `InventoryQueryService` (property search logic)
  - `ResponseComposerService` (AI text generation)
  - `LeadCaptureService` (contact collection)
  - `ChatService` (orchestration only)  
**Verification:** All existing tests pass, behavior unchanged  
**Estimated Time:** 40h (MAJOR REFACTOR)

---

## P2: Medium Priority Security

### M1: CSRF Protection ⏳
**Files:** Admin controllers  
**Issue:** No CSRF tokens on state-changing endpoints  
**Fix:** Add `@nestjs/csrf` or verify Origin/Referer headers  
**Verification:** POST without CSRF token rejected  
**Estimated Time:** 4h

### M2: Weak Admin Password Requirements ⏳
**File:** Auth validation  
**Issue:** No minimum complexity enforced  
**Fix:** Add Zod schema with 12+ chars, uppercase, number, special char  
**Verification:** Weak password rejected with clear error  
**Estimated Time:** 2h

### M5: Prompt Injection Mitigation ⏳
**Files:** Prompt templates  
**Issue:** User input passed directly to LLM without delimiters  
**Fix:** Add [USER INPUT START]/[USER INPUT END] markers in prompts  
**Verification:** Injection attempt ("ignore instructions...") fails  
**Estimated Time:** 6h

---

## P2: Accessibility Improvements

### Touch Target Sizes 36px/32px → 44px ⏳
**File:** `apps/web/components/chat-app.tsx`  
**Issue:** Header buttons 36px, delete 32px (below WCAG AAA 44px)  
**Locations:**
  - Language toggle (line 113): `h-9 w-9` → `h-11 w-11`
  - New chat button (line 114): `h-9 w-9` → `h-11 w-11`
  - Delete conversation (line 139): `h-8 w-8` → `h-11 w-11`  
**Verification:** Measure touch targets, verify ≥44px  
**Estimated Time:** 1h

---

## P2: Build & Deployment

### Lint Execution ⏳
**Command:** `npm run lint`  
**Issue:** Not run during verification  
**Fix:** Execute and fix any violations  
**Verification:** Zero lint errors  
**Estimated Time:** 30m

### Environment Variable Documentation ⏳
**File:** `.env.example` or `DEPLOYMENT.md`  
**Issue:** Required env vars not fully documented  
**Fix:** Document all required secrets with validation rules  
**Verification:** Complete env var checklist  
**Estimated Time:** 1h

---

## Verification & Testing

### Run Complete Test Suite ⏳
**Commands:** 
  - `npm run test:smoke -w @maqar/api`
  - Unit tests for refactored services  
**Expected:** 100% pass rate (no new failures)  
**Estimated Time:** Ongoing during refactor

### Playwright Visual QA (Post-Fix) ⏳
**Scope:** Critical user flows after all fixes  
**States to verify:**
  - Desktop 1440px: Welcome, chat, property cards, sidebar
  - Mobile 390px: Drawer, composer, cards
  - Arabic RTL: Layout mirror, text direction
  - English LTR: Standard flow
  - Loading: Typing indicator, streaming text
  - Empty: No conversations, no search results
  - Error: Connection error banner  
**Estimated Time:** 2h

### Security Re-Check ⏳
**Scope:** Verify all C1-C3 fixes effective  
**Tests:**
  - C1: Start API without secrets → crash
  - C2: Brute-force admin login → rate limited
  - C3: XSS injection → sanitized  
**Estimated Time:** 1h

### Performance Re-Measurement ⏳
**Tools:** Lighthouse CI, bundle analyzer  
**Metrics:** LCP, FID/INP, CLS, bundle size  
**Expected:** LCP <2.5s, bundle <200KB  
**Estimated Time:** 30m

---

## Final Report Update ⏳

### Update FINAL_COMPREHENSIVE_REPORT.md
**Content:** 
  - Mark C1-C3 as ✅ FIXED
  - Update production readiness score
  - Document actual post-fix state
  - Update remaining P1/P2 backlog  
**Estimated Time:** 1h

---

## Task Priority Order

1. **C1: Enforce required secrets** (2h) — Prevents auth bypass
2. **C2: Admin rate limiting** (4h) — Prevents brute-force
3. **C3: LLM output sanitization** (4h) — Prevents XSS
4. **Prompt files build config** (30m) — Fixes runtime errors
5. **Hero image optimization** (1h) — Fixes LCP blocker
6. **H2: File upload validation** (4h) — Malware defense
7. **H5: Sanitize credential logs** (4h) — Leak prevention
8. **Touch target sizes** (1h) — WCAG compliance
9. **Property cards next/image** (2h) — Performance improvement
10. **Bundle size baseline** (1h) — Establish metrics
11. **Lint execution** (30m) — Code quality gate
12. **M2: Password complexity** (2h) — Auth hardening
13. **M5: Prompt injection** (6h) — AI safety
14. **Complete test suite** (ongoing) — Regression prevention
15. **Playwright visual QA** (2h) — UX verification
16. **Security re-check** (1h) — Confirm fixes
17. **Performance re-measurement** (30m) — Metrics update
18. **Update final report** (1h) — Documentation

**Total Estimated Time (excluding deferred):** ~37 hours

**Deferred (require external resources or major refactor):**
- H1: RBAC implementation (16h) — Needs role data model
- H3: Google Maps proxy (6h) — Needs backend API design
- H4: httpOnly cookies (8h) — Major auth refactor
- Glass blur profiling (4h) — Needs real device
- ChatService decomposition (40h) — Major refactor, separate task

**Immediate Focus:** C1-C3 security fixes + deployment config (11.5h)

---

## Current Status

- [ ] P0 Security (C1-C3): 0/3 complete
- [ ] P0 Deployment Config: 0/2 complete
- [ ] P1 Security (actionable): 0/2 complete
- [ ] P1 Performance: 0/3 complete
- [ ] P2 Improvements: 0/5 complete
- [ ] Final Verification: 0/4 complete

**Next Action:** Start with C1 (devices.service.ts + auth.module.ts)
