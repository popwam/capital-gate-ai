import * as assert from "node:assert/strict";
import { test } from "node:test";
import { contactPreferencesFromText, CustomerTrustService } from "./customer-trust.service";

function service(feedbackStatus?: string, recentMessages: string[] = []) {
  const prisma: any = {
    message: { findMany: async () => recentMessages.map((content) => ({ content })) },
    customerTrustAlert: {
      findFirst: async () => feedbackStatus ? { status: feedbackStatus } : null,
      create: async (args: any) => ({ id: "alert-1", ...args.data }),
      update: async (args: any) => ({ id: args.where.id, ...args.data }),
      updateMany: async () => ({ count: 1 }),
    },
  };
  return new CustomerTrustService(prisma);
}

test("valid Egyptian contact is normalized and can create a lead", async () => {
  const result = await service().assessContact({
    conversationId: "c1",
    content: "ممدوح ممدوح 01033662552",
    state: { language: "ar-EG", purchaseIntent: 90 },
    contactExpected: true,
  });
  assert.equal(result.canCreateLead, true);
  assert.equal(result.normalizedPhone, "+201033662552");
  assert.equal(result.candidateName, "ممدوح ممدوح");
  assert.equal(result.level, "CONTACT_VALID");
});

test("placeholder name and invalid phone are held for verification", async () => {
  const result = await service().assessContact({
    conversationId: "c1",
    content: "test 12345",
    state: { language: "ar-EG", purchaseIntent: 90 },
    contactExpected: true,
  });
  assert.equal(result.canCreateLead, false);
  assert.ok(result.reasons.includes("invalid_phone"));
  assert.ok(result.reasons.includes("placeholder_name"));
  assert.equal(result.level, "NEEDS_VERIFICATION");
});

test("admin confirmed fake contact becomes suspicious on a future conversation", async () => {
  const result = await service("ADMIN_CONFIRMED_FAKE").assessContact({
    conversationId: "c2",
    content: "ممدوح 01033662552",
    state: { language: "ar-EG", purchaseIntent: 90 },
    contactExpected: true,
  });
  assert.equal(result.level, "SUSPICIOUS");
  assert.equal(result.learnedFromFeedback, true);
  assert.equal(result.canCreateLead, false);
});

test("contact and confirmation preferences are separated", () => {
  const result = contactPreferencesFromText("التواصل واتساب والتأكيد SMS والعصر في نص الأسبوع");
  assert.equal(result.preferredContactChannel, "WHATSAPP");
  assert.equal(result.preferredConfirmationChannel, "SMS");
  assert.equal(result.preferredVisitDayPart, "AFTERNOON");
  assert.equal(result.preferredVisitTiming, "MIDWEEK");
});


test("one clearly nonsensical message is flagged for review but not called fake", async () => {
  const result = await service(undefined, ["asdfgh"] ).assessContact({
    conversationId: "c3",
    content: "asdfgh",
    state: { language: "ar-EG" },
    contactExpected: false,
  });
  assert.equal(result.level, "NEEDS_VERIFICATION");
  assert.equal(result.reasons.includes("unclear_input"), true);
  assert.equal(result.reasons.includes("repeated_nonsense_input"), false);
});

test("repeated nonsense is sent for verification without calling the customer fake", async () => {
  const result = await service(undefined, ["asdfgh", "qwerty"] ).assessContact({
    conversationId: "c4",
    content: "qwerty",
    state: { language: "ar-EG" },
    contactExpected: false,
  });
  assert.equal(result.level, "SUSPICIOUS");
  assert.equal(result.reasons.includes("repeated_nonsense_input"), true);
  assert.equal(result.canCreateLead, false);
});

test("an invalid phone is reviewable even before a formal handoff", async () => {
  const result = await service().assessContact({
    conversationId: "c5",
    content: "رقمي 12345",
    state: { language: "ar-EG" },
    contactExpected: false,
  });
  assert.equal(result.level, "NEEDS_VERIFICATION");
  assert.equal(result.reasons.includes("invalid_phone"), true);
});

test("a budget number is not treated as a phone during passive trust review", async () => {
  const result = await service().assessContact({
    conversationId: "c6",
    content: "ميزانيتي 15000000 جنيه",
    state: { language: "ar-EG" },
    contactExpected: false,
    allowImplicitPhone: false,
  });
  assert.equal(result.level, "CONTACT_VALID");
  assert.equal(result.reasons.includes("invalid_phone"), false);
});


test("repeated placeholder-style name is held for human review", async () => {
  const result = await service().assessContact({
    conversationId: "c7",
    content: "محمد محمد محمد 01033662552",
    state: { language: "ar-EG", purchaseIntent: 90 },
    contactExpected: true,
  });
  assert.equal(result.canCreateLead, false);
  assert.equal(result.level, "NEEDS_VERIFICATION");
  assert.equal(result.reasons.includes("repeated_name_token"), true);
});

test("obviously repeated-digit phone is held for review", async () => {
  const result = await service().assessContact({
    conversationId: "c8",
    content: "ممدوح ممدوح 01000000000",
    state: { language: "ar-EG", purchaseIntent: 90 },
    contactExpected: true,
  });
  assert.equal(result.canCreateLead, false);
  assert.equal(result.reasons.includes("implausible_phone"), true);
});
