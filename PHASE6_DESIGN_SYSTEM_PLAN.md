# Phase 6: Design System Establishment

**Date:** 2026-08-22  
**Status:** In progress  
**Foundation:** Phase 5 design tokens complete

---

## Objective

Formalize the visual foundation from Phase 5 into a documented, reusable design system. Extract component patterns, establish usage guidelines, and create a reference for consistent implementation.

---

## Scope

### 1. Token Documentation
- Document all CSS variables from `design-tokens.css`
- Provide visual examples for each token category
- Explain token usage (when to use which)
- Document dark mode token strategy

### 2. Component Library
Extract and document reusable components:
- **Button** (primary, ghost, icon)
- **Card** (interactive, property, static)
- **Badge** (verified, status, semantic)
- **Input** (text, search, textarea)
- **Avatar** (assistant, user)
- **Glass surfaces** (header, composer, drawer)

### 3. Layout Patterns
- Spacing system application
- Grid/flex patterns
- Responsive breakpoints
- Container widths

### 4. Motion Principles
- Animation timing guidelines
- When to use which easing curve
- Micro-interaction patterns
- Performance considerations

### 5. Accessibility Guidelines
- Focus state requirements
- Color contrast verification process
- Touch target enforcement
- Reduced-motion/transparency handling

---

## Implementation Plan

### Stage 1: Token Documentation (2h)
Create `apps/web/DESIGN_SYSTEM.md` covering:
- Surface hierarchy visual guide
- Glass material system usage
- Border weight selection
- Ink (text) hierarchy
- Brand color application
- Semantic color usage
- Spacing scale examples
- Radius scale applications
- Elevation (shadow) scale
- Typography scale
- Animation timing

### Stage 2: Component Extraction (3h)
Create atomic components:
1. **Button component** (`components/ui/button.tsx`)
   - Variants: primary, ghost, icon
   - Sizes: sm, md, lg
   - States: default, hover, active, disabled, loading
   - Props: variant, size, disabled, loading, icon, children

2. **Card component** (`components/ui/card.tsx`)
   - Variants: static, interactive, glass
   - Props: interactive, glass, elevation, children

3. **Badge component** (`components/ui/badge.tsx`)
   - Variants: verified, success, error, warning, info
   - Props: variant, glow, children

4. **Input component** (`components/ui/input.tsx`)
   - Types: text, search, textarea
   - States: default, focus, error, disabled
   - Props: type, error, disabled, placeholder

### Stage 3: Usage Guidelines (1h)
Document in `apps/web/DESIGN_SYSTEM.md`:
- When to use each component variant
- Composition patterns (how components work together)
- Anti-patterns (what to avoid)
- RTL considerations

### Stage 4: Motion Guidelines (1h)
Document in `apps/web/DESIGN_SYSTEM.md`:
- Entrance animations (when elements appear)
- Exit animations (when elements leave)
- Interaction feedback (hover, focus, active)
- Loading states
- Performance budget

---

## Current Status

**Foundation complete:**
- ✅ Design tokens established (`design-tokens.css`)
- ✅ Utility classes created (`globals.css`)
- ✅ Token system applied to chat interface
- ✅ Micro-interactions implemented
- ✅ Glass material system working

**Next steps:**
1. Create `DESIGN_SYSTEM.md` with token documentation
2. Extract Button component
3. Extract Card component
4. Extract Badge component
5. Extract Input component
6. Document usage patterns

---

## Deferred to Post-Launch

**Full component library:**
- Modal/Dialog
- Dropdown/Select
- Tabs
- Toast/Notification
- Loading states
- Empty states

**Reason:** Core chat interface components take priority; admin UI components can follow design system later.

---

## Success Criteria

**Documentation:**
- [ ] All tokens documented with visual examples
- [ ] Component API documented
- [ ] Usage guidelines clear
- [ ] Anti-patterns identified

**Components:**
- [ ] Button component extracted and tested
- [ ] Card component extracted and tested
- [ ] Badge component extracted and tested
- [ ] Input component extracted and tested

**Adoption:**
- [ ] Chat interface uses extracted components (refactor)
- [ ] No hardcoded values in component usage
- [ ] Consistent visual output

---

Starting Stage 1: Token Documentation
