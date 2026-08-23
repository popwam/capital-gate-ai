# Prompt Changelog

## v1.0.0 (2026-08-20)

### advisor-system
- **Initial extraction** from inline code in `ai-context.ts`
- 2,800-character system prompt
- Defines Cg Ai persona, conversation quality, real-estate grounding, sales behavior, style
- No changes to content, just moved to versioned template

### advisor-context
- **Initial extraction** from inline code
- Context injection template for VERIFIED_FACTS, APPROVED_KNOWLEDGE, CURRENT_STATE
- Includes instructions for final answer formatting

### conversation-summary
- **Initial extraction** from inline code
- Simple template for injecting conversation summary into context

---

## Version Naming Convention

- **Major version** (X.0.0): Breaking changes to prompt structure or persona
- **Minor version** (1.X.0): Significant wording changes that may affect behavior
- **Patch version** (1.0.X): Typo fixes, clarifications, no behavioral change

## Rollback Procedure

1. Update `PromptRegistry` to point to previous version
2. Restart API service (or set via env var if implemented)
3. Monitor AIUsage table for success rate comparison
4. Document rollback reason in this changelog

## A/B Testing Procedure

1. Create new version (e.g., v1.1.0)
2. Update `PromptRegistry` to split traffic (80% control, 20% experiment)
3. Track `promptVersion` and `promptVariant` in AIUsage table
4. Compare metrics after 1000+ conversations per variant
5. Promote winning variant or rollback

---

## Future Versions

### Planned for v1.1.0
- Experiment with shorter system prompt (remove redundant instructions)
- Test more explicit grounding instructions
- A/B test persona temperature (current: "thoughtful professional" vs. "warm friend")

### Planned for v2.0.0
- Multilingual prompt variants (separate Arabic vs. English system prompts)
- Specialized prompts per context kind (INVESTMENT vs. PROPERTY_SEARCH)
- Tool-use instructions (if function calling is added)
