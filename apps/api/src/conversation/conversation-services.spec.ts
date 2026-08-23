import * as assert from "node:assert/strict";
import { test } from "node:test";
import { ConversationFormatterService } from "./conversation-formatter.service";
import { DeterministicAnswerService } from "./deterministic-answer.service";
import { LeadHandoffService, leadPersistenceAction } from "./lead-handoff.service";
import { PaymentPresenterService } from "./payment-presenter.service";
import { PropertyPresenterService } from "./property-presenter.service";
import { PromptABTestingService } from "../providers/prompt-ab-testing.service";

const formatter = new ConversationFormatterService();
const payments = new PaymentPresenterService(formatter);
const properties = new PropertyPresenterService(formatter);
const answers = new DeterministicAnswerService(formatter, properties, payments);

test("customer answer sanitization strips model-created links and internal identifiers", () => {
  const answer = formatter.sanitizeCustomerAnswer(
    "Open [the brochure](https://example.com/internal.pdf) for c12345678901234567890 and 123e4567-e89b-42d3-a456-426614174000.",
    "en",
  );
  assert.doesNotMatch(answer, /https?:\/\//u);
  assert.doesNotMatch(answer, /c12345678901234567890/u);
  assert.doesNotMatch(answer, /123e4567-e89b-42d3-a456-426614174000/u);
  assert.match(answer, /the brochure/u);
});

test("payment choices preserve cash and installment handoff options", () => {
  const choices = payments.paymentChoices({
    price: 10_000_000,
    currency: "EGP",
    paymentPlans: [
      { id: "cash", planType: "CASH", durationMonths: 0, discountPercent: 5 },
      { id: "installment", planType: "INSTALLMENT", durationMonths: 96, downPaymentPercent: 10 },
    ],
  });
  assert.equal(choices.hasCash, true);
  assert.equal(choices.hasInstallment, true);
  assert.equal(choices.cash?.total, 9_500_000);
  assert.equal(choices.longest?.down, 1_000_000);
});

test("deterministic answers keep verified payment and empty-search turns out of the model", () => {
  const payment = answers.directToolAnswer(
    { language: "en", turnIntent: "PAYMENT_PLAN" },
    { type: "text", uiActions: [] },
    [{ externalUnitId: "U-1", price: 1_000_000, currency: "EGP", paymentPlans: [{ planType: "CASH", durationMonths: 0 }] }],
  );
  assert.match(payment ?? "", /Payment plans applied to unit U-1/u);
  const empty = answers.directToolAnswer(
    { language: "en", turnIntent: "PROPERTY_SEARCH", propertyTypes: ["Apartment"], budgetMax: 2_000_000 },
    { type: "text", uiActions: [] },
    [],
  );
  assert.match(empty ?? "", /no matching verified unit/u);
});

test("empty verified inventory keeps the exact budget range and invents no locations", () => {
  const empty = answers.directToolAnswer(
    { language: "ar-EG", turnIntent: "PROPERTY_REFINEMENT", budgetMin: 3_000_000, budgetMax: 5_000_000 },
    { type: "text", uiActions: [] },
    [],
  ) ?? "";
  assert.match(empty, /3,000,000/u);
  assert.match(empty, /5,000,000/u);
  assert.match(empty, /الميزانية ما اتغيرتش/u);
  assert.doesNotMatch(empty, /المعادي|التجمع|المهندسين|الدقي/u);
});

test("grounding contradiction detection blocks claims that verified facts are missing", () => {
  assert.equal(properties.hasGroundingContradiction("The project name is not available.", [{ projectName: "Verified Project" }]), true);
});

test("lead persistence remains conservative", () => {
  assert.equal(leadPersistenceAction("lead-1", "+201001234567", 20), "update");
  assert.equal(leadPersistenceAction(undefined, "+201001234567", 69), "none");
  assert.equal(leadPersistenceAction(undefined, "+201001234567", 80), "create");
  assert.equal(leadPersistenceAction(undefined, undefined, 90), "none");
});

test("lead handoff requires a payment choice before collecting identity", async () => {
  const prisma = { lead: { findFirst: async () => null } };
  const handoff = new LeadHandoffService(prisma as any, {} as any, formatter, payments, properties);
  const state: any = { language: "en", purchaseIntent: 90, presentation: { selectedUnitId: "unit-1" } };
  const result = await handoff.handleLeadCapture({
    conversationId: "conversation-1",
    content: "book a viewing",
    state,
    previous: { language: "en" },
    plan: { intent: "VIEWING_REQUEST", exactUnitId: "U-1" },
    handoffUnit: {
      id: "unit-1",
      externalUnitId: "U-1",
      price: 10_000_000,
      paymentPlans: [
        { id: "cash", planType: "CASH", durationMonths: 0 },
        { id: "installment", planType: "INSTALLMENT", durationMonths: 96, downPaymentPercent: 10 },
      ],
    },
    priorHandoffStage: undefined,
    priorPresentation: {},
    priorUnitIds: [],
  });
  assert.equal(result.payload?.type, "lead_prompt");
  assert.equal(result.payload?.uiActions[0]?.type, "PAYMENT_CHOICES");
  assert.equal(state.presentation.leadHandoffStage, "PAYMENT");
});

test("prompt variants are balanced without mutating process-wide prompt state", async () => {
  const service = new PromptABTestingService({
    conversation: {
      count: async ({ where }: any) => where.promptVariant === "control" ? 4 : 3,
    },
  } as any);
  assert.equal(await service.nextVariant(), "experiment");
});
