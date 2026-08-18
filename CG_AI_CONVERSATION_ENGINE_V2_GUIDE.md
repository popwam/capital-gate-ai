# Cg Ai — Conversation Engine V2

Base: `AICG(10).zip`

## What changed

### 1. Hard customer constraints
- Explicit property type is deterministic (`شقة` stays Apartment; it cannot silently become Clinics).
- Explicit budget is a hard maximum unless the customer explicitly changes it.
- Explicit location is kept as a location constraint; Cg does not widen to a parent area by itself.
- Empty inventory produces a short deterministic no-match answer instead of market-price hallucinations.

### 2. First-turn Cg identity and Cairo time
- Every new conversation starts with a Cairo time-aware greeting (`Africa/Cairo`).
- Cg introduces itself as `Cg` on the first answer.
- The current user message controls answer language, so an English turn can switch the conversation to English.
- Generic `كيف يمكنني مساعدتك اليوم؟ / How can I help you today?` is removed.

### 3. Viewing flow
For an exact selected unit the flow is now:

`SELECT UNIT -> PAYMENT -> IDENTITY -> CONFIRMATION -> COMPLETE`

- If both verified cash and installment plans exist, Cg asks the customer to choose Cash or Installments first.
- Then Cg asks for name + valid mobile number.
- Final confirmation channel is only `CALL` or `WHATSAPP`.
- SMS and email are not customer-facing supported confirmation methods.
- The visible customer viewing message does not expose the unit code. The server still receives the exact unit code for authoritative lookup.

Example visible message:

`عاوز أعاين وحدة · 155 م² · 3 غرف · مشروع test`

### 4. Payment decision summary
Before handoff, verified plans can show:
- Cash: effective total after verified discount.
- Long-term installment: longest duration, down payment and approximate equal installment where calculable.
- Investment / liquidity: lowest verified upfront payment, without inventing ROI.
- Immediate living: only when verified delivery/status indicates ready/delivered.

### 5. Conversation closure
- Clear off-topic or argumentative turns close the conversation instead of falling back into inventory search.
- One short closure answer is stored.
- The composer is then replaced with a `New conversation` action.
- The API also rejects additional turns on the closed conversation.

### 6. Property cards
- Property result cards are rendered side-by-side in a horizontal swipe/scroll row.
- Mobile uses snap scrolling; desktop can show multiple cards on one row.

### 7. Chat typography
- Lightweight safe markdown rendering supports `**short headings**`.
- Body text remains normal weight.
- Raw `**` is no longer shown to customers.

## Verification performed in this package

- TypeScript syntax/transpile check: 14 changed TS/TSX files, 0 syntax diagnostics.
- Deterministic customer-turn tests: 18/18 passed.
- The source package in this environment does not include a complete root `node_modules`, so a full Nest/Next production build was not claimed here.

## Local verification

From the project root:

```bash
npm install
npm run db:generate
npm run build -w @maqar/api
npm run build -w @maqar/web
```

No new Prisma migration was added by Conversation Engine V2. If migrations already present in AICG(10) have not been deployed to the target database, run the project's normal migration deploy command before deployment.

## Recommended smoke conversations

### Hard filters
1. `محتاج شقة بسعر 12 مليون`
2. `وريني الاختيارات`
3. Confirm that Clinics never appear for the Apartment request.

### Location
1. `محتاج استثمر بمبلغ 10 مليون`
2. `عاوز حاجة في المستقبل سيتي`
3. If the inventory has no exact/child match, Cg must say there is no verified match instead of widening to Cairo.

### Viewing
1. Pick a property card and press `طلب معاينة`.
2. Confirm the visible user bubble contains human unit details, not the external unit code.
3. Choose Cash / Installments.
4. Send name + phone.
5. Confirm only Call / WhatsApp are offered.

### Off-topic closure
1. `i need some milk`
2. Cg should close the conversation once.
3. The composer should no longer accept more messages; use New conversation.

### Time and language
Start a new conversation with `good morning` at night Cairo time. Cg should use the actual Cairo daypart and answer in English.
