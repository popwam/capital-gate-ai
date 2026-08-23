# Phase 5: Visual Redesign Plan

**Date:** 2026-08-22  
**Status:** In progress

---

## Current Visual State Assessment

### Strengths (Keep & Refine)
- ✅ Premium color palette (`#173f3b` forest, `#faf9f5` cream, `#f0eee8` warm gray)
- ✅ Cairo Variable typography (excellent Arabic rendering)
- ✅ Subtle surface gradients (`.cg-surface` radial overlays)
- ✅ Glass class exists (`.cg-glass` with `backdrop-filter: blur(18px)`)
- ✅ Reduced-motion + reduced-transparency fallbacks
- ✅ Strong focus indicators (WCAG AA compliant)
- ✅ Logical properties for RTL/LTR
- ✅ Property cards are well-designed (rounded, shadowed, info-dense)
- ✅ Welcome screen is clean and premium

### Gaps (Redesign Targets)
- ⚠️ Glass only used in header — not leveraged as a design system material
- ⚠️ Generic shadows (`shadow-sm`, `shadow-lg`) — no elevation scale
- ⚠️ Inconsistent border colors (5+ variants: `#dde1dc`, `#e3e5e0`, `#dedfd9`, `#dcdcd6`, `#dce2dd`)
- ⚠️ Inconsistent backgrounds (7+ cream/gray variants)
- ⚠️ No micro-interactions (button hovers are `hover:bg-X`, no scale/lift/glow)
- ⚠️ Property cards appear instantly (no stagger animation despite code comment)
- ⚠️ Typing indicator is basic dots (no elegance)
- ⚠️ No dark mode (color-scheme: light only)
- ⚠️ No visual hierarchy in message list (all messages same weight)
- ⚠️ Composer is nice but not distinct enough (looks like standard input)

---

## Design System Requirements (CLAUDE.md)

**Must achieve:**
1. Apple-inspired but original (not a clone)
2. Premium and calm (not loud, not generic SaaS)
3. Intelligent minimalism (every element earns its place)
4. Refined typography (strong hierarchy)
5. Thoughtful whitespace (breathing room)
6. Subtle translucent materials (glass as material, not gimmick)
7. Controlled backdrop blur (GPU cost justified)
8. Subtle reflections and edge highlights
9. Elegant motion and micro-interactions
10. Polished light and dark modes
11. Excellent mobile design
12. Arabic RTL and English LTR both feel native

**Must avoid:**
- Generic dashboard templates
- Excessive gradients
- Purple AI clichés
- Excessive glow
- Glass on every element
- Card-inside-card layouts
- Oversized rounded cards
- Excessive pills
- Decorative UI with no product purpose

**Performance budget:**
- Blur only fixed/sticky surfaces (not scroll-with-page)
- Profile on mid-tier Android
- Reduced-effects fallback (already exists ✓)

**Accessibility floor (non-negotiable):**
- WCAG AA contrast on glass at actual rendered opacity (check at runtime, not flat)
- Visible focus states (already good ✓)
- Full keyboard nav (verify)
- Respect `prefers-reduced-motion` (already exists ✓)
- Touch targets ≥44px (P1.3 complete ✓)
- Screen-reader labels for icon-only buttons (verify)

---

## Visual Redesign Strategy

### 1. Establish Design Tokens (Consistency)

**Colors (Semantic System):**
```css
:root {
  /* Surface hierarchy */
  --surface-base: #faf9f5;        /* Main background */
  --surface-raised: #ffffff;      /* Cards, elevated elements */
  --surface-overlay: #efede6;     /* Modals, drawers */
  --surface-inset: #f7f5f0;       /* Input backgrounds, inset areas */
  
  /* Glass material */
  --glass-base: rgba(250, 249, 245, 0.88);
  --glass-strong: rgba(250, 249, 245, 0.94);
  --glass-subtle: rgba(250, 249, 245, 0.72);
  --glass-blur: 18px;
  --glass-blur-strong: 24px;
  
  /* Borders & dividers */
  --border-default: #dde1dc;
  --border-subtle: #e8ebe7;
  --border-strong: #c8cdc9;
  --border-focus: #8ea9a0;
  
  /* Ink (text hierarchy) */
  --ink-primary: #14211f;
  --ink-secondary: #66736d;
  --ink-tertiary: #89938f;
  --ink-on-glass: rgba(20, 33, 31, 0.95);
  
  /* Brand */
  --forest: #173f3b;
  --forest-hover: #102f2c;
  --forest-light: #e2f0e9;
  --coral: #d97357;
  --coral-light: #fbe9e5;
  
  /* Semantic */
  --success: #45a67a;
  --success-bg: #edf5f1;
  --error: #c44133;
  --error-bg: #fdeae8;
  --warning: #b08c52;
  --warning-bg: #f7f2e9;
}

/* Dark mode tokens (Phase 5.2 — defer if time-constrained) */
@media (prefers-color-scheme: dark) {
  :root {
    --surface-base: #0f1514;
    --surface-raised: #1a2220;
    --surface-overlay: #141d1b;
    --surface-inset: #0a0f0e;
    
    --glass-base: rgba(15, 21, 20, 0.88);
    --glass-strong: rgba(15, 21, 20, 0.94);
    --glass-subtle: rgba(15, 21, 20, 0.72);
    
    --border-default: #2a3532;
    --border-subtle: #1f2825;
    --border-strong: #3d4844;
    
    --ink-primary: #e8f0ed;
    --ink-secondary: #a8b5af;
    --ink-tertiary: #7a8782;
    
    /* Brand adjustments for dark */
    --forest: #4d8b7f;
    --forest-hover: #63a295;
    --coral: #e89480;
  }
}
```

**Spacing Scale (Consistent Rhythm):**
```css
:root {
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;
  --space-16: 64px;
  --space-20: 80px;
}
```

**Radius Scale:**
```css
:root {
  --radius-sm: 8px;   /* Small chips, badges */
  --radius-md: 12px;  /* Buttons, inputs */
  --radius-lg: 16px;  /* Cards (inner elements) */
  --radius-xl: 20px;  /* Cards (outer) */
  --radius-2xl: 24px; /* Modals, drawers */
  --radius-full: 9999px; /* Pills, avatars */
}
```

**Elevation Scale (Shadow System):**
```css
:root {
  /* Subtle lifts */
  --shadow-xs: 0 1px 2px rgba(20, 33, 31, 0.04),
               0 0 0 1px rgba(20, 33, 31, 0.02);
  
  --shadow-sm: 0 2px 4px rgba(20, 33, 31, 0.04),
               0 4px 8px rgba(20, 33, 31, 0.02);
  
  --shadow-md: 0 4px 8px rgba(20, 33, 31, 0.06),
               0 8px 16px rgba(20, 33, 31, 0.04);
  
  /* Floating elements */
  --shadow-lg: 0 8px 16px rgba(20, 33, 31, 0.08),
               0 16px 32px rgba(20, 33, 31, 0.04);
  
  --shadow-xl: 0 12px 24px rgba(20, 33, 31, 0.10),
               0 24px 48px rgba(20, 33, 31, 0.06);
  
  /* Composer, modals */
  --shadow-2xl: 0 18px 36px rgba(20, 33, 31, 0.12),
                0 36px 72px rgba(20, 33, 31, 0.08);
}
```

**Typography Scale (Strong Hierarchy):**
```css
:root {
  --text-xs: 11px;     /* Captions, metadata */
  --text-sm: 13px;     /* Secondary text, labels */
  --text-base: 16px;   /* Body */
  --text-lg: 18px;     /* Prominent body (assistant messages) */
  --text-xl: 20px;     /* Section headings */
  --text-2xl: 24px;    /* Card titles */
  --text-3xl: 32px;    /* Page titles */
  --text-4xl: 48px;    /* Hero (welcome screen) */
  
  --weight-normal: 400;
  --weight-medium: 600;
  --weight-semibold: 700;
  --weight-bold: 800;
  --weight-black: 900;
}
```

---

### 2. Micro-Interactions (Apple-Grade Polish)

**Button States:**
```css
/* Primary button (forest) */
.btn-primary {
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}
.btn-primary:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
}
.btn-primary:active {
  transform: translateY(0);
  box-shadow: var(--shadow-sm);
}

/* Ghost button */
.btn-ghost {
  transition: background 0.15s ease;
  position: relative;
  overflow: hidden;
}
.btn-ghost::before {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at center, rgba(23, 63, 59, 0.08), transparent 70%);
  opacity: 0;
  transition: opacity 0.2s;
}
.btn-ghost:hover::before {
  opacity: 1;
}
```

**Property Card Stagger Animation:**
```css
@keyframes slide-up-fade {
  from {
    opacity: 0;
    transform: translateY(16px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.property-card {
  animation: slide-up-fade 0.4s cubic-bezier(0.16, 1, 0.3, 1) backwards;
}

.property-card:nth-child(1) { animation-delay: 0ms; }
.property-card:nth-child(2) { animation-delay: 80ms; }
.property-card:nth-child(3) { animation-delay: 160ms; }
.property-card:nth-child(4) { animation-delay: 240ms; }
.property-card:nth-child(5) { animation-delay: 320ms; }
```

**Typing Indicator (Elegant):**
```tsx
<div className="typing-indicator">
  <div className="typing-wave">
    <span></span>
    <span></span>
    <span></span>
  </div>
  <span className="typing-label">Cg يفكر</span>
</div>

/* CSS */
.typing-wave span {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--forest);
  animation: wave 1.2s ease-in-out infinite;
}
.typing-wave span:nth-child(1) { animation-delay: 0s; }
.typing-wave span:nth-child(2) { animation-delay: 0.15s; }
.typing-wave span:nth-child(3) { animation-delay: 0.3s; }

@keyframes wave {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
  30% { transform: translateY(-8px); opacity: 1; }
}
```

**Input Focus Glow:**
```css
.composer-input:focus-within {
  border-color: var(--border-focus);
  box-shadow: 0 0 0 4px rgba(142, 169, 160, 0.12),
              var(--shadow-lg);
}
```

---

### 3. Glass Material System

**Three Glass Tiers:**

1. **Glass Header (Strong Blur)** — already exists, refine:
   ```css
   .glass-header {
     background: var(--glass-strong);
     backdrop-filter: blur(var(--glass-blur-strong));
     border-bottom: 1px solid var(--border-subtle);
   }
   ```

2. **Glass Composer (Elevated):**
   ```css
   .glass-composer {
     background: var(--glass-base);
     backdrop-filter: blur(var(--glass-blur));
     box-shadow: var(--shadow-2xl);
     border: 1px solid var(--border-default);
   }
   ```

3. **Glass Drawer/Modal (Overlay):**
   ```css
   .glass-drawer {
     background: var(--glass-base);
     backdrop-filter: blur(var(--glass-blur));
     box-shadow: var(--shadow-xl);
   }
   ```

**Edge Highlights (Subtle Reflections):**
```css
.glass-surface {
  position: relative;
}
.glass-surface::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 1px;
  background: linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.4) 0%,
    rgba(255, 255, 255, 0) 50%,
    rgba(255, 255, 255, 0.2) 100%
  );
  -webkit-mask: linear-gradient(#fff 0 0) content-box,
                linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  pointer-events: none;
}
```

---

### 4. Visual Hierarchy Improvements

**Message Role Distinction:**
```tsx
// User messages: warm, raised
<div className="user-message">
  background: linear-gradient(135deg, #fff 0%, #fdfcf8 100%);
  border: 1px solid var(--border-subtle);
  box-shadow: var(--shadow-sm);
</div>

// Assistant messages: no background, larger text, forest accent
<div className="assistant-message">
  font-size: var(--text-lg);
  color: var(--ink-primary);
  /* Avatar has subtle forest glow */
</div>
```

**Section Dividers (Subtle):**
```css
.message-group + .message-group::before {
  content: '';
  display: block;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent,
    var(--border-subtle) 20%,
    var(--border-subtle) 80%,
    transparent
  );
  margin: var(--space-8) auto;
  max-width: 200px;
}
```

---

### 5. Property Card Enhancements

**Current state is good — add:**

1. **Hover lift:**
   ```css
   .property-card {
     transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
   }
   .property-card:hover {
     transform: translateY(-4px);
     box-shadow: var(--shadow-lg);
   }
   ```

2. **Image overlay gradient (better text contrast):**
   ```css
   .property-card-image::after {
     content: '';
     position: absolute;
     inset: 0;
     background: linear-gradient(
       180deg,
       rgba(20, 33, 31, 0) 0%,
       rgba(20, 33, 31, 0.02) 100%
     );
   }
   ```

3. **Badge glow (verified):**
   ```css
   .badge-verified {
     background: var(--success-bg);
     color: var(--success);
     box-shadow: 0 0 0 3px rgba(69, 166, 122, 0.08);
   }
   ```

---

### 6. Welcome Screen Refinement

**Current is clean — enhance:**

1. **Logo mark subtle animation on load:**
   ```css
   @keyframes logo-fade-in {
     from { opacity: 0; transform: scale(0.96); }
     to { opacity: 1; transform: scale(1); }
   }
   .logo-entrance {
     animation: logo-fade-in 0.6s cubic-bezier(0.16, 1, 0.3, 1);
   }
   ```

2. **Starter buttons on hover:**
   ```css
   .starter-button {
     transition: all 0.2s ease;
   }
   .starter-button:hover {
     background: var(--surface-raised);
     box-shadow: var(--shadow-md);
     transform: translateY(-2px);
   }
   .starter-button:hover .starter-icon {
     color: var(--forest);
   }
   ```

---

### 7. Sidebar Refinement

**Current is functional — enhance:**

1. **Active conversation indicator (not just bg change):**
   ```css
   .conversation-item.active::before {
     content: '';
     position: absolute;
     left: 0;
     top: 50%;
     transform: translateY(-50%);
     width: 3px;
     height: 60%;
     background: var(--forest);
     border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
   }
   ```

2. **Hover glow on conversation items:**
   ```css
   .conversation-item:hover {
     background: var(--surface-raised);
     box-shadow: var(--shadow-xs);
   }
   ```

3. **Search input subtle inner shadow:**
   ```css
   .search-input {
     box-shadow: inset 0 1px 2px rgba(20, 33, 31, 0.04);
   }
   ```

---

## Implementation Plan

### Phase 5.1: Foundation (4h)
1. ✅ Document current state
2. Create `design-tokens.css` with all CSS variables
3. Replace hardcoded colors in `globals.css` with tokens
4. Replace hardcoded shadows with elevation scale
5. Verify contrast ratios on glass surfaces (manual check in browser)

### Phase 5.2: Micro-Interactions (3h)
1. Add button hover transforms
2. Add property card stagger animations
3. Enhance typing indicator
4. Add input focus glow
5. Add hover states to all interactive elements

### Phase 5.3: Glass Refinement (2h)
1. Add edge highlights to glass surfaces
2. Refine header glass
3. Enhance composer glass
4. Add glass to drawer/modal

### Phase 5.4: Visual Hierarchy (2h)
1. Distinguish user/assistant messages visually
2. Increase assistant message text size
3. Add subtle section dividers
4. Enhance property card visual weight

### Phase 5.5: Welcome & Sidebar Polish (2h)
1. Add logo entrance animation
2. Enhance starter button hovers
3. Add active conversation indicator
4. Refine sidebar interaction states

### Phase 5.6: Verification (2h)
1. Run app in browser
2. Test all interactions (hover, focus, active states)
3. Test mobile viewports (DevTools)
4. Test RTL rendering
5. Verify reduced-motion fallback
6. Check contrast ratios on glass
7. Lighthouse audit (Performance, Accessibility)
8. Document findings

**Total estimate:** 15h

---

## Success Criteria

**Visual:**
- [ ] Does NOT look like generic AI SaaS dashboard
- [ ] Glass behaves like material (purposeful, not everywhere)
- [ ] Micro-interactions feel Apple-grade (smooth, purposeful)
- [ ] Strong visual hierarchy (messages, cards, sections clear)
- [ ] Consistent spacing, colors, shadows throughout
- [ ] Mobile feels native (not just responsive)

**Accessibility:**
- [ ] WCAG AA contrast maintained (including glass surfaces)
- [ ] Focus states visible on all interactive elements
- [ ] Keyboard navigation works everywhere
- [ ] Reduced-motion respected

**Performance:**
- [ ] No new layout shifts
- [ ] Blur only on fixed surfaces (header, composer)
- [ ] Animations run at 60fps on mid-tier device (DevTools throttle test)

**Code Quality:**
- [ ] No hardcoded values (all use tokens)
- [ ] No duplicate styles (DRY)
- [ ] CSS organized and commented
- [ ] No new accessibility regressions

---

## Status

Starting Phase 5.1: Foundation (design tokens + globals.css refactor)
