# AICG Design System

**Version:** 1.0  
**Last updated:** 2026-08-22  
**Foundation:** Phase 5 design token system

---

## Overview

AICG's design system is built on **intelligent minimalism** with an **Apple-inspired premium aesthetic**. Every element earns its place. The system is token-based, accessible (WCAG AA), and supports both Arabic RTL and English LTR natively.

**Core principles:**
1. **Purposeful** — Every design decision serves the product
2. **Calm** — Premium without being loud
3. **Accessible** — WCAG AA minimum, respects user preferences
4. **Consistent** — Design tokens eliminate one-off values
5. **Bilingual native** — RTL and LTR feel equally polished

---

## Design Tokens

All visual properties reference CSS variables from `design-tokens.css`. Never use hardcoded values.

### Surface Hierarchy

Four elevation levels for depth and hierarchy:

```css
--surface-base: #faf9f5        /* Main background, lowest elevation */
--surface-raised: #ffffff      /* Cards, elevated content */
--surface-overlay: #efede6     /* Modals, drawers, sidebar */
--surface-inset: #f7f5f0       /* Input fields, inset areas */
```

**Usage:**
- **Base:** Page background, conversation area
- **Raised:** Property cards, message bubbles, buttons (when solid)
- **Overlay:** Sidebar, drawers, modals
- **Inset:** Input backgrounds, search fields

**Example:**
```tsx
<div style={{ background: 'var(--surface-raised)' }}>
  Card content
</div>
```

---

### Glass Material System

Three glass tiers for translucent UI surfaces. Glass should be **purposeful**, not decorative.

```css
--glass-base: rgba(250, 249, 245, 0.88)      /* Standard glass */
--glass-strong: rgba(250, 249, 245, 0.94)    /* High-clarity glass */
--glass-subtle: rgba(250, 249, 245, 0.72)    /* Subtle glass */
--glass-blur: 18px
--glass-blur-strong: 24px
```

**Usage:**
- **Strong glass:** Header (needs high clarity for text)
- **Base glass:** Composer, floating panels
- **Subtle glass:** Tooltips, popovers

**Classes:**
```css
.cg-glass          /* Base glass + standard blur */
.cg-glass-strong   /* Strong glass + stronger blur */
```

**Performance rule:** Only apply glass to **fixed or sticky surfaces**. Never blur scroll-with-page content.

**Accessibility:** Automatically falls back to higher opacity + no blur when user prefers reduced transparency.

---

### Borders & Dividers

Four border weights for hierarchy:

```css
--border-default: #dde1dc      /* Standard borders */
--border-subtle: #e8ebe7       /* Soft dividers */
--border-strong: #c8cdc9       /* Emphasis borders */
--border-focus: #8ea9a0        /* Focus ring color */
```

**Usage:**
- **Default:** Card borders, input borders, most UI elements
- **Subtle:** Section dividers, soft separators
- **Strong:** Active states, selected items
- **Focus:** Focus rings only (never for borders)

---

### Ink (Text Hierarchy)

Four text levels for typographic hierarchy:

```css
--ink-primary: #14211f            /* Body text, headlines */
--ink-secondary: #66736d          /* Supporting text */
--ink-tertiary: #89938f           /* Metadata, captions */
--ink-on-glass: rgba(20, 33, 31, 0.95)  /* Text on glass surfaces */
```

**Contrast ratios (on `--surface-base`):**
- Primary: **13.8:1** (AAA)
- Secondary: **4.7:1** (AA)
- Tertiary: **3.2:1** (AA for large text only)

**Usage:**
- **Primary:** All body text, headings, assistant messages
- **Secondary:** Descriptions, labels, secondary info
- **Tertiary:** Timestamps, metadata, placeholders
- **On-glass:** Text overlaid on glass surfaces

---

### Brand Colors

```css
--forest: #173f3b               /* Primary brand */
--forest-hover: #102f2c         /* Forest hover state */
--forest-light: #e2f0e9         /* Forest backgrounds */

--coral: #d97357               /* Accent color */
--coral-light: #fbe9e5         /* Coral backgrounds */

--accent-warm: #b08c52         /* Warm accent (gold) */
--accent-warm-light: #f7f2e9   /* Warm backgrounds */
```

**Usage:**
- **Forest:** Primary buttons, focus states, brand moments
- **Coral:** Highlights, active states, important actions
- **Warm accent:** Secondary emphasis, warnings

**Hover states:** Use `-hover` variants for interactive elements.

---

### Semantic Colors

```css
--success: #45a67a             /* Positive actions */
--success-bg: #edf5f1          /* Success backgrounds */
--success-border: #b9d0c6      /* Success borders */

--error: #c44133               /* Destructive actions */
--error-bg: #fdeae8            /* Error backgrounds */
--error-text: #742f25          /* Error text (darker) */

--warning: #b08c52             /* Warnings */
--warning-bg: #f7f2e9          /* Warning backgrounds */
--warning-border: #dfd8cc      /* Warning borders */
```

**Usage:**
- **Success:** Verified badges, success messages, positive feedback
- **Error:** Error messages, destructive actions, alerts
- **Warning:** Warnings, conversation closure, caution states

**Accessibility:** All semantic colors meet AA contrast on their respective backgrounds.

---

### Spacing Scale

12-step spacing system based on 4px:

```css
--space-1: 4px      --space-2: 8px       --space-3: 12px
--space-4: 16px     --space-5: 20px      --space-6: 24px
--space-8: 32px     --space-10: 40px     --space-12: 48px
--space-16: 64px    --space-20: 80px     --space-24: 96px
```

**Usage guidelines:**
- **1-2 (4-8px):** Icon gaps, tight spacing
- **3-4 (12-16px):** Component internal spacing
- **5-6 (20-24px):** Between related sections
- **8-10 (32-40px):** Between unrelated sections
- **12+ (48px+):** Page-level spacing

**Never use arbitrary spacing values.** Always reference the scale.

---

### Radius Scale

Six radius sizes for rounded corners:

```css
--radius-sm: 8px       /* Small chips, badges */
--radius-md: 12px      /* Buttons, inputs */
--radius-lg: 16px      /* Card inner elements */
--radius-xl: 20px      /* Cards (outer) */
--radius-2xl: 24px     /* Modals, drawers, composer */
--radius-full: 9999px  /* Pills, avatars, circular */
```

**Usage:**
- **sm:** Badges, small chips
- **md:** Buttons, inputs, small cards
- **lg:** Card content, internal card elements
- **xl:** Main cards, panels
- **2xl:** Large surfaces (composer, modals)
- **full:** Pills, avatars, circular elements

**Consistency rule:** Nested elements should use smaller radius than their container.

---

### Elevation Scale (Shadows)

Six shadow tiers for depth:

```css
--shadow-xs    /* Subtle lift */
--shadow-sm    /* Small elevation */
--shadow-md    /* Standard cards */
--shadow-lg    /* Floating elements */
--shadow-xl    /* Major surfaces */
--shadow-2xl   /* Composer, modals */
```

**Visual examples:**

**xs:** Conversation items hover
```css
box-shadow: 0 1px 2px rgba(20, 33, 31, 0.04),
            0 0 0 1px rgba(20, 33, 31, 0.02);
```

**sm:** Static cards, raised surfaces
```css
box-shadow: 0 2px 4px rgba(20, 33, 31, 0.04),
            0 4px 8px rgba(20, 33, 31, 0.02);
```

**md:** Interactive cards hover state
```css
box-shadow: 0 4px 8px rgba(20, 33, 31, 0.06),
            0 8px 16px rgba(20, 33, 31, 0.04);
```

**lg:** Property cards hover
```css
box-shadow: 0 8px 16px rgba(20, 33, 31, 0.08),
            0 16px 32px rgba(20, 33, 31, 0.04);
```

**xl:** Glass surfaces, drawers
```css
box-shadow: 0 12px 24px rgba(20, 33, 31, 0.10),
            0 24px 48px rgba(20, 33, 31, 0.06);
```

**2xl:** Composer, major modals
```css
box-shadow: 0 18px 36px rgba(20, 33, 31, 0.12),
            0 36px 72px rgba(20, 33, 31, 0.08);
```

**Usage:** Use shadows to communicate hierarchy and interactivity. Hover states should increase shadow. Active states should decrease shadow (pressed effect).

---

### Typography Scale

Eight text sizes + five weights:

```css
--text-xs: 11px       /* Captions, metadata */
--text-sm: 13px       /* Secondary text, labels */
--text-base: 16px     /* Body text */
--text-lg: 18px       /* Prominent body (assistant) */
--text-xl: 20px       /* Section headings */
--text-2xl: 24px      /* Card titles */
--text-3xl: 32px      /* Page titles */
--text-4xl: 48px      /* Hero (welcome screen) */

--weight-normal: 400
--weight-medium: 600
--weight-semibold: 700
--weight-bold: 800
--weight-black: 900
```

**Line heights:**
```css
--leading-tight: 1.25     /* Dense headings */
--leading-snug: 1.4       /* Compact text */
--leading-normal: 1.6     /* Default body */
--leading-relaxed: 1.75   /* Comfortable reading */
--leading-loose: 1.9      /* Arabic text (needs more) */
```

**Usage:**
- **xs:** Timestamps, metadata, fine print
- **sm:** Labels, secondary info, buttons
- **base:** Body text, user messages
- **lg:** Assistant messages (more prominent)
- **xl:** Section headings
- **2xl:** Card titles
- **3xl:** Page titles
- **4xl:** Hero headings (welcome screen)

**RTL consideration:** Arabic text requires `--leading-loose` (1.9) for proper glyph rendering. English text uses `--leading-relaxed` (1.75).

---

### Animation Timing

Four easing curves:

```css
--ease-smooth: cubic-bezier(0.4, 0, 0.2, 1)        /* General */
--ease-enter: cubic-bezier(0.16, 1, 0.3, 1)        /* Elements appearing */
--ease-exit: cubic-bezier(0.4, 0, 1, 1)            /* Elements leaving */
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1)   /* Playful bounce */
```

Five durations:

```css
--duration-instant: 100ms
--duration-fast: 150ms
--duration-normal: 200ms
--duration-slow: 300ms
--duration-slower: 400ms
```

**Usage guidelines:**

| Interaction | Easing | Duration |
|------------|--------|----------|
| Button hover | `smooth` | `fast` (150ms) |
| Card hover | `smooth` | `normal` (200ms) |
| Message entrance | `enter` | `slow` (300ms) |
| Modal open | `enter` | `slower` (400ms) |
| Modal close | `exit` | `fast` (150ms) |
| Typing indicator | `smooth` | 1200ms (wave) |

**Accessibility:** All animations respect `prefers-reduced-motion` — they drop to 0.01ms duration when user prefers reduced motion.

---

## Component Patterns

### Buttons

Three variants:

**Primary (forest, raised):**
```tsx
<button className="btn-primary rounded-full px-4 py-2.5 text-white"
        style={{ background: 'var(--forest)', boxShadow: 'var(--shadow-sm)' }}>
  Primary action
</button>
```

**Ghost (transparent, hover glow):**
```tsx
<button className="btn-ghost rounded-full px-4 py-2.5"
        style={{ border: '1px solid var(--border-default)' }}>
  Secondary action
</button>
```

**Icon (minimal):**
```tsx
<button className="grid h-9 w-9 place-items-center rounded-full"
        style={{ border: '1px solid var(--border-default)' }}>
  <Icon size={17}/>
</button>
```

**States:**
- **Hover:** Primary lifts (`translateY(-1px)`) + stronger shadow. Ghost shows radial glow.
- **Active:** Primary returns to base position. Ghost glow intensifies.
- **Disabled:** Gray background (`var(--border-default)`), no hover effects.
- **Loading:** Spinner replaces content, disabled state active.

---

### Cards

Two primary variants:

**Static card:**
```tsx
<div className="rounded-[20px] p-4"
     style={{ 
       border: '1px solid var(--border-default)',
       background: 'var(--surface-raised)',
       boxShadow: 'var(--shadow-sm)'
     }}>
  Card content
</div>
```

**Interactive card (hover lift):**
```tsx
<div className="card-interactive rounded-[20px] p-4"
     style={{ 
       border: '1px solid var(--border-default)',
       background: 'var(--surface-raised)',
       boxShadow: 'var(--shadow-sm)'
     }}>
  Card content
</div>
```

**Interactive hover:** Lifts `translateY(-4px)`, shadow upgrades to `--shadow-lg`.

---

### Badges

Three semantic variants:

**Verified (success):**
```tsx
<span className="badge-verified rounded-full px-2.5 py-1 text-[11px] font-bold"
      style={{ 
        background: 'var(--success-bg)',
        color: 'var(--success)'
      }}>
  Verified
</span>
```

**Error:**
```tsx
<span className="rounded-full px-2.5 py-1 text-[11px] font-bold"
      style={{ 
        background: 'var(--error-bg)',
        color: 'var(--error)'
      }}>
  Error
</span>
```

**Warning:**
```tsx
<span className="rounded-full px-2.5 py-1 text-[11px] font-bold"
      style={{ 
        background: 'var(--warning-bg)',
        color: 'var(--warning)'
      }}>
  Warning
</span>
```

**Verified badge glow:** `.badge-verified` class adds subtle success glow (`box-shadow: 0 0 0 3px rgba(69, 166, 122, 0.08)`).

---

### Inputs

**Text input:**
```tsx
<input type="text"
       className="h-11 rounded-xl px-3 text-[13px] outline-none"
       style={{
         border: '1px solid var(--border-default)',
         background: 'var(--surface-inset)',
         color: 'var(--ink-primary)'
       }}
       placeholder="Placeholder text" />
```

**With focus glow:**
```tsx
<div className="input-focus-glow rounded-xl p-2"
     style={{ border: '1px solid var(--border-default)' }}>
  <textarea className="w-full bg-transparent outline-none"
            style={{ color: 'var(--ink-primary)' }} />
</div>
```

**Focus state:** `.input-focus-glow` adds enhanced focus ring (border becomes `--border-focus`, shadow ring appears).

---

### Glass Surfaces

**Header (strong glass):**
```tsx
<header className="cg-glass-strong h-[68px]"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}>
  Header content
</header>
```

**Composer (base glass):**
```tsx
<div className="cg-glass input-focus-glow rounded-[24px] p-2"
     style={{ 
       border: '1px solid var(--border-default)',
       boxShadow: 'var(--shadow-2xl)'
     }}>
  Composer content
</div>
```

**Performance note:** Glass surfaces should be **fixed or sticky** only. Blurring scrolling content is GPU-expensive.

---

## Layout Patterns

### Spacing Application

Use spacing tokens consistently:

```tsx
/* Section spacing */
<div style={{ marginBottom: 'var(--space-8)' }}>Section</div>

/* Component internal spacing */
<div style={{ padding: 'var(--space-4)' }}>Content</div>

/* Flex gap */
<div style={{ display: 'flex', gap: 'var(--space-3)' }}>Items</div>
```

**Never use arbitrary values like `mb-7` or `gap-5` when a token exists.**

---

### Container Widths

```tsx
/* Chat messages container */
max-width: 860px

/* Welcome screen container */
max-width: 820px

/* Sidebar */
width: 292px
```

---

### Responsive Breakpoints

Follow Tailwind defaults:

- **sm:** 640px (mobile landscape)
- **md:** 768px (tablet)
- **lg:** 1024px (desktop, sidebar shows)
- **xl:** 1280px (wide desktop)

---

## Motion Principles

### When to Animate

**Do animate:**
- State changes (hover, focus, active)
- Content appearing (messages, cards)
- Loading indicators
- User-triggered actions

**Don't animate:**
- Initial page load (except logo entrance)
- Static content
- Background elements
- Scrolling (use native scroll)

---

### Animation Performance

**GPU-accelerated properties only:**
- ✅ `transform` (translateX/Y, scale, rotate)
- ✅ `opacity`
- ❌ `width`, `height`, `top`, `left` (causes layout thrashing)

**Performance budget:**
- All animations must run at **60fps** on mid-tier Android
- Test with DevTools CPU throttling (4x slowdown)
- Reduced-motion fallback required (automatic via CSS)

---

### Stagger Animations

Property cards stagger by 80ms:

```css
.property-card-enter:nth-child(1) { animation-delay: 0ms; }
.property-card-enter:nth-child(2) { animation-delay: 80ms; }
.property-card-enter:nth-child(3) { animation-delay: 160ms; }
.property-card-enter:nth-child(4) { animation-delay: 240ms; }
.property-card-enter:nth-child(5) { animation-delay: 320ms; }
```

**Usage:** Apply `.property-card-enter` class to each card. Stagger creates visual flow.

---

## Accessibility Guidelines

### Focus States

**Required on all interactive elements:**

```css
button:focus-visible {
  outline: 2px solid var(--forest);
  outline-offset: 2px;
  box-shadow: 0 0 0 4px rgba(23, 63, 59, 0.12);
}
```

**Never remove focus indicators.** Style them to match the design.

---

### Color Contrast

**WCAG AA minimum (4.5:1 for normal text, 3:1 for large text):**

All text-on-background combinations in the token system meet AA. When creating new combinations:

1. Use contrast checker (e.g., WebAIM)
2. Test at actual rendered opacity (especially on glass)
3. Document ratio if borderline

---

### Touch Targets

**Minimum 44×44px for all interactive elements:**

```tsx
/* Correct */
<button className="h-11 w-11">Icon</button>

/* Incorrect */
<button className="h-8 w-8">Icon</button>  {/* Too small */}
```

---

### Reduced Motion

**All animations respect `prefers-reduced-motion`:**

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

**Automatic — no developer action needed.**

---

### Reduced Transparency

**Glass materials fall back to higher opacity:**

```css
@media (prefers-reduced-transparency: reduce) {
  :root {
    --glass-base: rgba(250, 249, 245, 0.96);  /* Higher opacity */
    --glass-blur: 0px;                        /* No blur */
  }
}
```

**Automatic — improves performance and legibility for users with vision impairments or low-end devices.**

---

## RTL/Bilingual Considerations

### Logical Properties

Use logical properties instead of physical:

```css
/* ✅ Correct (works in both RTL/LTR) */
margin-inline-start: 12px;
padding-inline: 16px;

/* ❌ Wrong (breaks in RTL) */
margin-left: 12px;
padding-left: 16px;
padding-right: 16px;
```

---

### Icon Flipping

**Directional icons must flip in RTL:**

Automatic via CSS:

```css
[dir="rtl"] .lucide-arrow-right,
[dir="rtl"] .lucide-chevron-right {
  transform: scaleX(-1);
}
```

**Non-directional icons (search, close, settings) must NOT flip.**

---

### Letter Spacing

**Never apply letter-spacing to Arabic text** — it breaks glyph joining:

```css
/* ✅ Correct */
.chat-copy { letter-spacing: 0; }

/* ❌ Wrong */
.arabic-text { letter-spacing: 0.05em; }  /* Breaks Arabic */
```

---

### Line Height

**Arabic requires more line height than English:**

```css
.chat-copy[dir="rtl"] { line-height: var(--leading-loose);   /* 1.9 */ }
.chat-copy[dir="ltr"] { line-height: var(--leading-relaxed); /* 1.75 */ }
```

---

## Anti-Patterns

### What to Avoid

❌ **Hardcoded colors:**
```tsx
/* Wrong */
<div style={{ background: '#faf9f5' }}>...</div>

/* Correct */
<div style={{ background: 'var(--surface-base)' }}>...</div>
```

❌ **Hardcoded shadows:**
```tsx
/* Wrong */
<div style={{ boxShadow: '0 4px 8px rgba(0,0,0,0.1)' }}>...</div>

/* Correct */
<div style={{ boxShadow: 'var(--shadow-md)' }}>...</div>
```

❌ **Arbitrary spacing:**
```tsx
/* Wrong */
<div className="mb-7 gap-5">...</div>

/* Correct */
<div style={{ marginBottom: 'var(--space-8)', gap: 'var(--space-4)' }}>...</div>
```

❌ **Glass on every element:**
```tsx
/* Wrong - glass is not a visual gimmick */
<div className="cg-glass">
  <div className="cg-glass">
    <div className="cg-glass">...</div>
  </div>
</div>

/* Correct - purposeful glass usage */
<header className="cg-glass-strong">...</header>
<div className="cg-glass">Composer</div>
```

❌ **Blurring scrolling content:**
```tsx
/* Wrong - expensive, causes jank */
<div className="overflow-y-auto">
  <div className="cg-glass">Scrolling card</div>
</div>

/* Correct - blur only fixed surfaces */
<header className="cg-glass-strong fixed">...</header>
```

---

## Dark Mode (Ready, Not Activated)

Complete dark mode token system exists in `design-tokens.css` under `@media (prefers-color-scheme: dark)`. Activation deferred to Phase 5.2 or Phase 16.

**When activating:**
1. Test all components in dark mode
2. Verify contrast ratios still meet AA
3. Test glass materials (may need opacity adjustments)
4. Test property card images (may need overlay darkening)
5. Update welcome screen gradients
6. Test focus states (may need color adjustments)

---

## References

**Token source:** `apps/web/app/design-tokens.css`  
**Global styles:** `apps/web/app/globals.css`  
**Component examples:** `apps/web/components/chat-app.tsx`

**External resources:**
- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/)
- [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/)

---

**Last updated:** 2026-08-22  
**Maintainer:** AICG Product Team
