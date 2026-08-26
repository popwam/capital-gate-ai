# Nadim V2 live language evaluation matrix

Run each isolated row in a fresh conversation unless the input explicitly contains multiple turns. Use verified test inventory or accept an honest no-match; never seed fake customer inventory.

| Case | Input | Expected languageStyle | Expected grammaticalAddress | Expected intent | Expected state effect | Expected tool behavior | Must not happen |
|---|---|---|---|---|---|---|---|
| Egyptian masculine | `عايز شقة 3 غرف في التجمع تحت 8 مليون` | `AR_EGYPTIAN` | `MASCULINE` | `PROPERTY_SEARCH` | Set apartment, 3 bedrooms, New Cairo/Tagamo3, budget max 8M | Run `PROPERTY_SEARCH` once | Introduction, Gulf/formal wording, invented inventory |
| Egyptian feminine | `عايزة شقة 3 غرف في التجمع` | `AR_EGYPTIAN` | `FEMININE` | `PROPERTY_SEARCH` | Set apartment, 3 bedrooms, Tagamo3 | Run `PROPERTY_SEARCH` once | Infer identity or use avoidable masculine agreement |
| Gulf | `أبي شقة 3 غرف في التجمع وودي تكون بالتقسيط` | `AR_GULF` | `NEUTRAL` | `PROPERTY_SEARCH` | Set apartment, 3 bedrooms, Tagamo3, `INSTALLMENTS` | Run `PROPERTY_SEARCH` once | Egyptian vocabulary or generic dialect failure |
| Formal Arabic | `أرغب في شقة بثلاث غرف في القاهرة الجديدة` | `AR_FORMAL` | `NEUTRAL` | `PROPERTY_SEARCH` | Preserve explicit search facts | Run `PROPERTY_SEARCH` once | Bureaucratic/corporate phrasing |
| American English | `I need a 3-bedroom apartment in New Cairo under 8 million EGP` | `EN_US` | `NEUTRAL` | `PROPERTY_SEARCH` | Set apartment, 3 bedrooms, New Cairo, budget max 8M | Run `PROPERTY_SEARCH` once | Translated-Arabic rhythm or unsupported facts |
| Franco masculine | `3ayz sho2a 3 rooms fel tagamo3 ta7t 8 million` | `FRANCO_ARABIC` | `MASCULINE` | `PROPERTY_SEARCH` | Set apartment, 3 bedrooms, New Cairo, budget max 8M | Run `PROPERTY_SEARCH` once | English or Arabic-script fallback; unnecessary clarification |
| Franco feminine | `3ayza sho2a 3 rooms fel tagamo3` | `FRANCO_ARABIC` | `FEMININE` | `PROPERTY_SEARCH` | Set apartment, 3 bedrooms, New Cairo | Run `PROPERTY_SEARCH` once | Identity inference or masculine agreement |
| Mixed Arabic/English | `عايز apartment 3 bedrooms في New Cairo تحت 8 million` | `MIXED_AR_EN` | `MASCULINE` | `PROPERTY_SEARCH` | Set all explicit search facts | Run `PROPERTY_SEARCH` once | Forced 50/50 translation or lost constraints |
| Language switching | `عايز شقة 3 غرف في التجمع` → `Explain the options in English` → `كمل مصري` | Egyptian → English → Egyptian | Established recent form | Search → `SMALL_TALK` → `SMALL_TALK` | No search-state, selection, result, or comparison mutation on switches | Search only on first turn | Rerun search or narrate a stale mutation |
| Address preference | `عايزة شقة في التجمع` → `خليني أكمل من غير صيغة مؤنث` | `AR_EGYPTIAN` | Feminine → explicit masculine | Search → `SMALL_TALK` | Change linguistic agreement only | No tool on second turn | Store/mention gender identity |
| Ambiguous address | `عايزة شقة وأنا حابب أشوف المتاح` | `AR_EGYPTIAN` | `NEUTRAL` | `PROPERTY_SEARCH` | Apply only explicit property facts | Run `PROPERTY_SEARCH` once | Guess between conflicting forms |
| Gibberish | Active search, then `svgsvg` | Preserve recent style | Preserve explicit/recent form or neutral | `UNKNOWN` | Preserve all search and result state | No tool | Replay prior search, say no-match, reset state |
| Repeated search | Same complete search twice | Preserve detected style | Preserve detected address | `PROPERTY_SEARCH` both turns | Same deterministic constraints | Same verified search semantics | Pretend inventory changed; forced verbatim reply |
| Verified no-match | Complete search with verified zero results | Match user style | Match linguistic address | `PROPERTY_SEARCH` | Preserve constraints | `PROPERTY_SEARCH` succeeds with zero rows | Claim a blocker, `100% match`, or fake inventory reason |
| Search modification | Search under 8M → `خليها 10 مليون` | Preserve current style | Preserve current address | `MODIFY_SEARCH` | Current `SET budgetMax=10M`; preserve unrelated fields | Rerun `PROPERTY_SEARCH` once | Describe mutations not in `lastOperations` |
| Reset | Active search → `ابدأ بحث جديد` | Preserve current style | Preserve current address | `RESET_SEARCH` | Reset search, selection, comparison, and result references | No search until a new request | Retain old filters or claim a search ran |
| Payment preference | `أبي شقة وودي تكون بالتقسيط` | `AR_GULF` | `NEUTRAL` | `PROPERTY_SEARCH` | Set `installmentPreference=INSTALLMENTS` | Run `PROPERTY_SEARCH` | Convert vague preference into invented duration |
| Payment question | Select a unit → `نظام التقسيط إيه؟` | Preserve current style | Preserve current address | `PAYMENT_PLAN_QUESTION` | Preserve search and selected unit | Run `GET_PAYMENT_PLAN` for selected unit | Run a new search or invent payment facts |

Review responses semantically: verify natural style, forbidden-language absence, factual grounding, and operation truth. Do not require exact conversational prose.
