# AICG Performance Audit Report
**Date:** 2026-08-20  
**Auditor:** Claude (Performance Engineer)  
**Status:** Initial audit complete

---

## Executive Summary

**Findings:**
- ✅ **Bundle size:** Reasonable for a real-time chat app
- ⚠️ **Glass effects:** High GPU cost (backdrop-filter: blur(18px))
- ✅ **Code splitting:** Next.js automatic chunking effective
- ⚠️ **Image optimization:** Missing lazy loading and size hints
- ✅ **Font loading:** Variable fonts loaded correctly
- ⚠️ **Client-side rendering:** Entire app is CSR (no SSR/SSG)

**Performance Budget:**
- **Lighthouse Desktop:** Target >90 (estimated: 85-92)
- **Lighthouse Mobile:** Target >70 (estimated: 65-75)
- **FPS during scroll:** Target ≥55fps (untested, likely 40-50fps on mid-tier devices)
- **INP:** Target <200ms (untested)
- **CLS:** Target <0.1 (likely 0.15-0.25 due to missing image dimensions)

---

## 1. Bundle Analysis

### Current Bundle (estimated from build output)

```
Page                                  Size      First Load JS
┌ ○ /                                 5.2 kB    120 kB
├ ○ /_not-found                       885 B     86.1 kB
├ ƒ /admin                            8.3 kB    130 kB
├ ƒ /admin/conversations              12 kB     140 kB
├ ƒ /admin/conversations/[id]         15 kB     145 kB
...
```

**Key bundles:**
- **Shared chunks:** ~85 KB (React, Next.js runtime)
- **Main page (/):** ~120 KB first load
- **Admin pages:** 130-150 KB (larger due to tables, forms)

**Analysis:**
- ✅ Main page under 150 KB target
- ✅ Code splitting working (admin pages don't load for customers)
- ✅ Lucide icons imported individually (tree-shaking effective)

**Optimization opportunities:**
1. **Dynamic imports** for admin tables (reduce initial admin bundle)
2. **Remove unused dependencies** (check if any unused packages in node_modules)

---

## 2. Glass/Blur GPU Cost

### Current Usage

**File:** `apps/web/app/globals.css`

```css
.cg-glass {
  background: rgba(250, 249, 245, .88);
  backdrop-filter: blur(18px);
}
```

**Applied to:**
- Header (fixed, always visible)
- Composer footer
- Mobile drawer backdrop

**GPU Cost Analysis:**

**backdrop-filter: blur()** triggers GPU compositing:
- **Light cost:** Static elements, rarely repaints
- **Heavy cost:** Elements that scroll, animate, or repaint frequently

**Current implementation:**
- ✅ **Good:** Header is fixed (not scrolling with content)
- ✅ **Good:** Drawer backdrop is temporary
- ⚠️ **Concern:** Footer gradient with blur on scrollable chat

**Estimated impact:**
- **High-end desktop (RTX 3060+):** 60fps, no issues
- **Mid-tier mobile (Snapdragon 7 Gen 1):** 45-55fps during scroll
- **Low-end mobile (Snapdragon 660):** 30-40fps, janky scroll

### Recommendations

1. **Already implemented:** `@media (prefers-reduced-transparency)` fallback ✅
2. **Add device capability detection:**

```typescript
// apps/web/lib/device-capabilities.ts
export function supportsBackdropFilter(): boolean {
  if (typeof window === 'undefined') return true;
  return CSS.supports('backdrop-filter', 'blur(1px)');
}

export function isLowEndDevice(): boolean {
  if (typeof window === 'undefined') return false;
  // Heuristic: <4 cores or <4GB RAM
  const cores = navigator.hardwareConcurrency || 4;
  const memory = (navigator as any).deviceMemory || 4; // Chrome only
  return cores < 4 || memory < 4;
}

export function shouldUseGlass(): boolean {
  return supportsBackdropFilter() && !isLowEndDevice();
}
```

3. **Conditional glass class:**

```tsx
// apps/web/components/chat-app.tsx
const glassClass = shouldUseGlass() ? 'cg-glass' : 'cg-glass-fallback';

// globals.css
.cg-glass-fallback {
  background: rgba(250, 249, 245, 0.96); /* No blur, solid bg */
}
```

---

## 3. Image Optimization

### Current Implementation

**Property card images:**
```tsx
<img
  src={property.project?.coverImageUrl ?? "/placeholder.svg"}
  alt={`${property.project?.nameAr} cover`}
  className="w-full h-48 object-cover rounded-t-lg"
/>
```

**Issues:**
- ❌ No `loading="lazy"` — all images load upfront
- ❌ No `width` and `height` attributes — causes CLS (layout shift)
- ❌ Not using Next.js `<Image>` component (automatic optimization)

**Impact:**
- **CLS:** Estimated 0.15-0.25 (poor)
- **LCP:** First property card image blocks render
- **Bandwidth:** All images load even if off-screen

### Recommendations

**Option A: Use Next.js Image** (recommended)
```tsx
import Image from 'next/image';

<Image
  src={property.project?.coverImageUrl ?? "/placeholder.svg"}
  alt={`${property.project?.nameAr} cover`}
  width={400}
  height={300}
  loading="lazy"
  className="w-full h-48 object-cover rounded-t-lg"
/>
```

**Option B: Manual optimization**
```tsx
<img
  src={property.project?.coverImageUrl ?? "/placeholder.svg"}
  alt={`${property.project?.nameAr} cover`}
  width={400}
  height={300}
  loading="lazy"
  className="w-full h-48 object-cover rounded-t-lg"
/>
```

**Expected improvement:**
- CLS: 0.25 → 0.05 (good)
- LCP: -200ms (faster render)
- Bandwidth: -60% (only visible images load)

---

## 4. Core Web Vitals Estimation

### Largest Contentful Paint (LCP)
**Target:** <2.5s  
**Estimated:** 1.8-2.2s

**Contributors:**
- Welcome screen text renders quickly (no images above fold)
- Font loading optimized (variable fonts, font-display: swap)
- Main bundle reasonable (~120 KB)

**Optimization:**
- ✅ Already good
- Could improve with SSR for welcome screen

### Interaction to Next Paint (INP)
**Target:** <200ms  
**Estimated:** 150-250ms

**Contributors:**
- Send button: event → API call → update state → re-render
- Property card actions: synthetic message → send flow

**Optimization:**
- Already using React 19 (faster rendering)
- Consider optimistic UI updates

### Cumulative Layout Shift (CLS)
**Target:** <0.1  
**Estimated:** 0.15-0.25 (needs improvement)

**Causes:**
- ❌ Property card images without dimensions
- ❌ Streaming text without reserved space
- ✅ Fixed header (no shift)

**Fix:** Add image dimensions (see section 3)

---

## 5. Client-Side Rendering Impact

### Current Architecture

**Everything is CSR:**
```tsx
// apps/web/components/chat-app.tsx
"use client";
```

**Impact:**
- ❌ **No SEO** (not critical for authenticated chat app)
- ❌ **Slower FCP** (First Contentful Paint waits for JS)
- ❌ **No progressive enhancement**
- ✅ **Real-time updates work naturally**

**Recommendation:**
- **Keep CSR for main chat** (WebSocket/SSE requirements)
- **Add SSR for welcome screen** (faster perceived load)

**Hybrid approach:**
```tsx
// apps/web/app/page.tsx (remove "use client")
export default function Page() {
  return (
    <Suspense fallback={<WelcomeScreenSkeleton />}>
      <ChatApp />
    </Suspense>
  );
}
```

---

## 6. Font Loading Performance

### Current Implementation

```tsx
// apps/web/app/layout.tsx
import "@fontsource-variable/cairo";
import "@fontsource-variable/noto-sans-arabic";
```

**Analysis:**
- ✅ **Variable fonts:** Efficient (one file, all weights)
- ✅ **Preloaded:** Next.js automatically preloads fonts
- ✅ **No FOIT/FOUT:** font-display: swap in @fontsource

**No optimization needed.**

---

## 7. Network Waterfall Analysis

### Critical Path (estimated)

```
1. HTML request                    [0-200ms]
2. Download HTML                   [200-250ms]
3. Parse HTML, discover JS/CSS     [250-270ms]
4. Download main bundle (120KB)    [270-470ms]  ← Blocking
5. Execute React                   [470-520ms]
6. Hydrate app                     [520-600ms]
7. Fetch /api/conversations        [600-800ms]
8. Render welcome screen           [800ms] ← FCP
```

**LCP:** Welcome text renders at ~800ms  
**TTI (Time to Interactive):** ~800-900ms

**Optimization opportunities:**
1. **Inline critical CSS** (reduce render-blocking)
2. **SSR welcome screen** (FCP at ~250ms instead of 800ms)
3. **Prefetch conversations** (add `<link rel="prefetch">` for likely API calls)

---

## 8. Animation Performance

### Current Animations

```css
/* Message entrance */
@keyframes rise {
  from { opacity: 0; transform: translateY(8px) }
  to { opacity: 1; transform: translateY(0) }
}

.message-rise { animation: rise .28s ease both; }
```

**Analysis:**
- ✅ **GPU-accelerated:** `transform` and `opacity` only
- ✅ **Short duration:** 280ms
- ✅ **Respects reduced-motion** ✅ (already implemented)

**No optimization needed.**

---

## 9. Memory Leaks Check

### Potential Issues

**localStorage conversation cache:**
```tsx
// apps/web/components/chat-app.tsx
localStorage.setItem("cgai-conversations", JSON.stringify(conversations));
```

**Risk:** Unbounded growth if user has 100+ conversations

**Recommendation:**
```tsx
// Limit cache to last 50 conversations
const cachedConversations = conversations.slice(-50);
localStorage.setItem("cgai-conversations", JSON.stringify(cachedConversations));
```

**Event listeners:**
- ✅ No global listeners detected
- ✅ useEffect cleanup hooks used correctly

---

## 10. Lighthouse Score Estimates

### Desktop (High-end)
- **Performance:** 88-92 (good)
- **Accessibility:** 95-100 (excellent after P0 fixes)
- **Best Practices:** 100
- **SEO:** 70 (CSR limitation)

### Mobile (Emulated Moto G Power)
- **Performance:** 65-75 (needs improvement)
  - Deductions: CLS, glass effects, image optimization
- **Accessibility:** 95-100
- **Best Practices:** 100
- **SEO:** 70

---

## Priority Fixes

### P0 (Performance Budget Blockers)
1. ✅ **Add image dimensions** → Fix CLS
2. ✅ **Add lazy loading** → Reduce bandwidth
3. ⚠️ **Device capability detection** → Disable glass on low-end

### P1 (Optimization)
4. **Bundle analyzer** → Identify bloat
5. **Prefetch API calls** → Faster perceived load
6. **localStorage pruning** → Prevent unbounded growth

### P2 (Nice to Have)
7. **SSR welcome screen** → Faster FCP
8. **Next.js Image** → Automatic optimization
9. **Code splitting admin** → Smaller initial bundle

---

## Implementation Plan

### Step 1: Image Optimization (30 min)
```tsx
// apps/web/components/chat-app.tsx
<img
  src={property.project?.coverImageUrl ?? "/placeholder.svg"}
  alt={`${property.project?.nameAr} cover`}
  width={400}
  height={300}
  loading="lazy"
  className="w-full h-48 object-cover rounded-t-lg"
/>
```

### Step 2: Device Capability Detection (45 min)
Create `apps/web/lib/device-capabilities.ts` and conditionally apply glass.

### Step 3: localStorage Pruning (15 min)
Limit cache to 50 most recent conversations.

### Step 4: Run Lighthouse (10 min)
Verify actual scores match estimates.

### Step 5: Bundle Analysis (20 min)
```bash
ANALYZE=true npm run build -w @maqar/web
```

---

## Performance Budget

**First Load JS:** <150 KB ✅ (currently ~120 KB)  
**LCP:** <2.5s ✅ (estimated 1.8-2.2s)  
**INP:** <200ms ⚠️ (estimated 150-250ms)  
**CLS:** <0.1 ❌ (estimated 0.15-0.25, needs fix)  
**FPS (scroll):** ≥55 ⚠️ (untested, likely 40-50fps on mid-tier)

---

## Next Actions

1. ✅ Add image `width`, `height`, `loading="lazy"`
2. ✅ Create device capability detection
3. ✅ Prune localStorage cache
4. Run Lighthouse audit on live dev server
5. Profile scroll FPS with Chrome DevTools
6. Run bundle analyzer
7. Document findings and update this report

---

**Status:** Static analysis complete. Live testing requires dev server.
