# Phase 9: Performance Audit

**Status:** ✅ Complete  
**Date:** 2026-08-22  
**Auditor:** Phase 9 Performance Review (Direct)

---

## Executive Summary

AICG demonstrates **strong structural performance fundamentals** with a Next.js 16 App Router architecture, minimal CSS (2 files), and thoughtful accessibility features. The main performance considerations center around:

1. **Glass blur effects** — `backdrop-filter: blur()` is GPU-expensive and applied to multiple surfaces
2. **Large hero image** — 3MB PNG in `/public`
3. **Bundle size baseline** — needs measurement tooling configured
4. **Animation budget** — extensive custom animations need 60fps verification

**Overall Grade: 7.5/10** — Solid foundation with targeted optimization opportunities.

---

## 1. Core Web Vitals Baseline

### Current State
- **LCP (Largest Contentful Paint):** Not measured yet — needs Lighthouse/production analytics
- **FID/INP (Interaction delay):** Likely good — minimal JavaScript in critical path
- **CLS (Cumulative Layout Shift):** Low risk — no dynamic ad units, fixed header height (68px)

### Positive Signals
- Server Components by default (Next.js App Router)
- No external widget embeds (analytics, chat SDKs)
- Fixed-height header prevents layout shift
- Welcome screen uses CSS animations (no JS layout thrashing)

### Recommendations
**P1 (Critical):**
- [ ] Add Lighthouse CI to GitHub Actions or pre-deploy workflow
- [ ] Configure production analytics (Vercel Analytics, Web Vitals reporting)
- [ ] Measure LCP on welcome screen (hero image) and chat view (first message)

**P2 (High):**
- [ ] Add `next/image` usage for hero PNG — currently raw `<img>` in property cards only
- [ ] Implement performance budget thresholds (LCP < 2.5s, INP < 200ms, CLS < 0.1)

---

## 2. Bundle Size Analysis

### Current Configuration
```javascript
// apps/web/next.config.mjs
webpack: (config, { dev, isServer }) => {
  if (process.env.ANALYZE === 'true') {
    const { default: withBundleAnalyzer } = require('@next/bundle-analyzer')({
      enabled: true,
    });
    return withBundleAnalyzer(config);
  }
  return config;
}
```

✅ **Bundle analyzer configured** but needs to be run and baseline established.

### What We Know
- **2 CSS files:** `design-tokens.css` (215 lines, ~5KB) + `globals.css` (325 lines, ~8KB) = ~13KB uncompressed
- **Main component:** `chat-app.tsx` (318 lines) — single-file client component
- **Icon library:** Lucide React — tree-shakeable, but imports 20+ icons

### Estimated Bundle Size
- Next.js 16 runtime: ~85KB (gzipped)
- React 19 runtime: ~45KB (gzipped)
- Lucide icons (20 imports): ~15KB (gzipped)
- Chat app component + logic: ~25KB (gzipped)
- **Total estimated first load:** ~170KB gzipped

This is **excellent** for a real-time chat application.

### Recommendations
**P1 (Critical):**
- [ ] Run `ANALYZE=true npm run build` and document actual bundle breakdown
- [ ] Verify code splitting — admin routes should be separate chunks

**P2 (High):**
- [ ] Consider lazy-loading rarely-used icons (`import(...)`) if bundle exceeds 200KB
- [ ] Add bundle size CI check (e.g., `bundlesize` or `size-limit`)

**P3 (Nice to have):**
- [ ] Explore icon sprite sheet if Lucide bundle becomes significant

---

## 3. Render Performance

### Glass Material System — GPU Cost Analysis

**High-Cost Surfaces (3 instances):**

```css
/* apps/web/app/globals.css:297-299 */
.cg-glass-strong {
  background: var(--glass-strong);
  backdrop-filter: blur(var(--glass-blur-strong)); /* 24px blur */
}
```

**Applied to:**
1. **Header** (line 106 in chat-app.tsx): `cg-glass-strong` — fixed position, always visible
2. **Composer** (line 309): `cg-glass` (18px blur) — fixed position, always visible
3. **Mobile drawer** (line 103): `shadow-2xl` on `surface-overlay` — only on mobile, not permanent

**GPU Profiling Concerns:**
- `backdrop-filter: blur(24px)` on fixed header = **continuous repaint cost**
- Every scroll event forces GPU composite layer update
- Mid-tier Android devices (Snapdragon 6-series, Mali GPUs) will struggle

**Reduced Transparency Fallback (✅ Already Implemented):**
```css
/* apps/web/app/globals.css:302-311 */
@media (prefers-reduced-transparency: reduce) {
  .cg-glass,
  .cg-glass-strong {
    backdrop-filter: none;
    background: var(--glass-base);
  }
}
```

✅ **Accessibility compliance met** — users can disable blur via OS preference.

### Recommendations
**P1 (Critical):**
- [ ] Profile on real Android device (Pixel 6a / Galaxy A53) using Chrome DevTools remote debugging
- [ ] Measure composite layer paint time (target: <16ms per frame = 60fps)
- [ ] If > 20ms, reduce header blur to 12px or remove during scroll

**P2 (High):**
- [ ] Add `will-change: backdrop-filter` to fixed glass surfaces (hint GPU optimization)
- [ ] Consider removing blur from composer on mobile (< 640px breakpoint)

**P3 (Deferred):**
- [ ] Implement `IntersectionObserver` to disable blur when header is offscreen (if applicable)

---

## 4. Animation Performance Budget

### Custom Animations Inventory

**apps/web/app/globals.css:**
- `@keyframes rise` (169-178): Message entrance — `translateY(12px)` + opacity
- `@keyframes wave` (185-194): Typing indicator — `translateY(-8px)` loop
- `@keyframes slide-up-fade` (203-212): Property card stagger
- `@keyframes logo-fade-in` (226-238): Logo entrance
- `@keyframes shimmer` (241-248): Unused (defined but not applied)

**Analysis:**
- ✅ All animations use `transform` and `opacity` only (GPU-accelerated properties)
- ✅ No `width`, `height`, `left`, `top` animations (would trigger layout)
- ✅ `prefers-reduced-motion` respected (globals.css:54-62)

**Timing Functions:**
```css
--ease-smooth: cubic-bezier(0.4, 0, 0.2, 1);      /* General */
--ease-enter: cubic-bezier(0.16, 1, 0.3, 1);      /* Overshoot */
--ease-exit: cubic-bezier(0.4, 0, 1, 1);          /* Accelerate */
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1); /* Bounce */
```

These are **production-grade easing curves** matching Apple's design language.

### 60fps Verification
**Needs manual testing:**
- [ ] Open Chrome DevTools Performance tab
- [ ] Record while scrolling chat messages (rise animation)
- [ ] Record while property cards appear (stagger animation)
- [ ] Verify all frames < 16.67ms (60fps threshold)

**Predicted Results:**
- Message rise: **PASS** — single transform, short duration (300ms)
- Typing dots wave: **PASS** — small elements, infinite but low complexity
- Property card stagger: **PASS** — 5 cards max, 80ms delay each
- Composer focus glow: **RISK** — transitions `box-shadow` (not GPU-accelerated)

### Recommendations
**P1 (Critical):**
- [ ] Record Performance profile during heavy interactions (20+ messages, property cards appearing)
- [ ] Verify no "Long Tasks" > 50ms blocking main thread

**P2 (High):**
- [ ] Replace `box-shadow` transitions with `filter: drop-shadow()` or pseudo-element tricks
  - Line 160-162 (input-focus-glow): `box-shadow` transition causes repaints

**P3 (Nice to have):**
- [ ] Add `transform: translateZ(0)` to animated elements to force GPU layer promotion

---

## 5. Image Optimization

### Current Issues

**Hero Image (Public Assets):**
```
apps/web/public/new-cairo-residences.png - 3011.3 KB (3MB!)
```

This is **excessive** for a web asset.

### Impact
- **LCP penalty:** If this image is above-the-fold, it will destroy LCP score
- **Mobile data cost:** 3MB on 3G = 10+ seconds download time
- **No progressive loading:** PNG doesn't support progressive rendering like JPEG

### Property Card Images
```tsx
// chat-app.tsx:210
<img src={image} alt={...} className="h-full w-full object-cover"/>
```

❌ **Not using `next/image`** — missing:
- Automatic format negotiation (WebP/AVIF)
- Lazy loading
- Responsive sizing

### Recommendations
**P0 (Blocker before production):**
- [ ] Convert `new-cairo-residences.png` to:
  - WebP format (target: <300KB)
  - AVIF format (target: <200KB) for modern browsers
  - Serve via `<picture>` with PNG fallback
- [ ] OR remove hero image entirely if not essential

**P1 (Critical):**
- [ ] Replace all `<img>` tags in property cards with `<Image>` from `next/image`
  - Automatic lazy loading below fold
  - Responsive `srcset` generation
  - Blur placeholder while loading

**P2 (High):**
- [ ] Set up Vercel Image Optimization (if deploying to Vercel)
- [ ] OR configure `next/image` loader for R2 storage (already used for project media)

---

## 6. Code Splitting & Lazy Loading

### Current Architecture
```
apps/web/app/
├── page.tsx (Chat interface)
├── admin/ (Protected workspace)
│   ├── layout.tsx
│   ├── page.tsx
│   └── [9 admin routes]
└── layout.tsx (Root)
```

✅ **Natural route-based splitting** — Next.js App Router automatically splits admin routes into separate chunks.

### What Loads on First Visit
1. Root layout (`layout.tsx`)
2. Chat page (`page.tsx`)
3. `chat-app.tsx` (client component)
4. CSS files (design-tokens + globals)

Admin workspace is **NOT** loaded until user navigates to `/admin` — ✅ **optimal**.

### Dynamic Imports Opportunity
```tsx
// chat-app.tsx imports 13 Lucide icons at top level
import { ArrowUp, Building2, Check, ChevronDown, Clock3, FileText,
  Heart, Image as ImageIcon, MapPin, Menu, MessageSquareText,
  MoreHorizontal, Plus, Search, ShieldCheck, Sparkles, Trash2, X } from "lucide-react";
```

These icons are **used immediately** (in header, composer, welcome screen), so eager loading is justified. No lazy-loading needed here.

### Recommendations
**P2 (High):**
- [ ] If admin dashboard grows beyond 10 routes, consider lazy-loading heavy admin components
- [ ] Verify via bundle analyzer that admin chunks are separate from chat bundle

**P3 (Deferred):**
- [ ] Consider lazy-loading `PropertyResults` component (only shown when search returns results)

---

## 7. CSS Performance

### Stylesheet Size
- `design-tokens.css`: 215 lines, ~5KB uncompressed
- `globals.css`: 325 lines, ~8KB uncompressed
- **Total:** ~13KB CSS uncompressed (≈3KB gzipped)

✅ **Excellent** — most sites ship 50-100KB of CSS.

### Critical CSS Extraction
❌ **Not implemented** — entire `globals.css` loaded in `<head>` (blocking render).

**Impact:**
- First paint delayed until CSS downloaded + parsed
- On 3G: ~200ms penalty

### CSS Complexity
- **Selectors:** Mostly single-class (`.btn-primary`, `.cg-glass`)
- **Nesting depth:** Maximum 3 levels (`.conversation-active::before`)
- **Specificity conflicts:** None observed

### Recommendations
**P2 (High):**
- [ ] Extract critical CSS for welcome screen (welcome, logo, header) and inline in `<head>`
- [ ] Defer non-critical CSS (animations, admin styles)

**P3 (Nice to have):**
- [ ] Use `next/font` for Cairo Variable with `display: swap` to prevent FOIT (Flash of Invisible Text)
  - Currently relying on system font stack fallback

---

## 8. Third-Party Scripts

### Current Dependencies (from context)
- ✅ **No external analytics SDKs** (Google Analytics, Mixpanel, etc.)
- ✅ **No chat widgets** (Intercom, Drift)
- ✅ **No advertising pixels**
- ✅ **Google Maps** — loaded on-demand when map shown (verified from chat-app.tsx:280-287)

### Google Maps Loading
```tsx
// MapResult component (line 280)
<a href={map.url} target="_blank" rel="noreferrer" ...>
```

✅ **Optimal** — no embedded map iframe, just a link. Defers Google Maps load until user clicks.

### Font Loading
```css
/* globals.css:16 */
font-family: "Cairo Variable", "Noto Sans Arabic Variable", system-ui, sans-serif;
```

❓ **Unknown:** How are these fonts loaded? Via `@font-face`, `next/font`, or CDN?

### Recommendations
**P1 (Critical):**
- [ ] Verify Cairo Variable font source (local? Google Fonts? Bunny Fonts?)
- [ ] If using Google Fonts, add `&display=swap` to prevent FOIT
- [ ] OR self-host fonts in `/public/fonts` and use `next/font/local`

**P2 (High):**
- [ ] Add `rel="dns-prefetch"` for R2 storage domain (media URLs)

---

## 9. Network Optimization

### API Calls (from chat-app.tsx)
```tsx
// Line 47: List conversations on mount
conversationsApi.list().then(...)

// Line 62: Fetch messages for active conversation
conversationsApi.messages(activeId).then(...)

// Line 79: Stream assistant response
await conversationsApi.stream(id, clean, {...})
```

✅ **Efficient patterns:**
- Conversations list cached in localStorage (line 54)
- Messages only fetched when conversation selected
- SSE streaming for real-time responses (no polling)

### Caching Strategy
```tsx
// Line 44-46: Cache versioning
if (localStorage.getItem("cgai-cache-version") !== "3") 
  localStorage.setItem("cgai-cache-version", "3");
```

✅ **Cache invalidation mechanism** implemented.

### Recommendations
**P2 (High):**
- [ ] Add stale-while-revalidate for conversation list (fetch fresh in background)
- [ ] Implement optimistic updates (show message immediately, rollback on error)

**P3 (Nice to have):**
- [ ] Add service worker for offline message queue (PWA feature)

---

## 10. Accessibility Performance Impact

### Current A11y Features (from globals.css)
- ✅ `prefers-reduced-motion` support (lines 54-62)
- ✅ `prefers-reduced-transparency` support (lines 302-311)
- ✅ Focus indicators with proper contrast (lines 24-51)

**Performance benefit:**
- Users who enable reduced motion get **instant animations** (0.01ms instead of 200ms-400ms)
- Users who enable reduced transparency avoid **GPU-expensive blur** entirely

This is **exemplary** — accessibility and performance aligned.

### Recommendations
✅ **No action needed** — already best-in-class.

---

## Summary & Prioritized Roadmap

### Critical (P0/P1) — Before Production Launch
1. **Optimize hero image** — 3MB → <300KB via WebP/AVIF
2. **Switch to `next/image`** for property cards
3. **Establish bundle size baseline** — run bundle analyzer, document results
4. **Profile glass blur on mid-tier Android** — measure composite layer cost
5. **Verify font loading strategy** — prevent FOIT, measure load time
6. **Add Lighthouse CI** — automate performance gate in CI/CD

**Estimated effort:** 12 hours

### High Priority (P2) — Post-Launch Sprint
1. **Extract critical CSS** — inline above-fold styles
2. **Reduce composer shadow transition** — replace `box-shadow` with GPU-friendly alternative
3. **Add performance budget enforcement** — fail CI if LCP > 2.5s
4. **Optimize header blur** — reduce to 12px or remove during scroll
5. **Add Web Vitals reporting** — production analytics

**Estimated effort:** 16 hours

### Nice to Have (P3) — Future Iterations
1. **Service worker for offline support**
2. **Icon sprite sheet** (if Lucide bundle exceeds 200KB)
3. **Lazy-load PropertyResults component**
4. **DNS prefetch for R2 domain**

**Estimated effort:** 8 hours

---

## Final Score Breakdown

| Category | Score | Weight | Notes |
|----------|-------|--------|-------|
| Bundle Size | 9/10 | 20% | Excellent baseline, needs verification |
| Render Performance | 7/10 | 25% | Glass blur is GPU-expensive |
| Image Optimization | 4/10 | 15% | 3MB hero PNG is a blocker |
| Code Splitting | 9/10 | 10% | Route-based splitting optimal |
| CSS Performance | 8/10 | 10% | Minimal CSS, needs critical extraction |
| Network Strategy | 8/10 | 10% | SSE streaming + caching solid |
| Animation Budget | 8/10 | 5% | GPU-friendly, needs 60fps verification |
| A11y Performance | 10/10 | 5% | Exemplary reduced-motion/transparency |

**Weighted Average: 7.5/10**

**Blockers before production:**
- Hero image size (P0)
- Bundle size measurement (P1)
- Glass blur profiling on Android (P1)

**Overall:** Strong foundation with clear optimization path. No architectural rewrites needed.
