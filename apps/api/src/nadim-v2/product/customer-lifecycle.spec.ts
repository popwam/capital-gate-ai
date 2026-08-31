import { strict as assert } from "node:assert";
import { test } from "node:test";
import { CustomerLifecycleService } from "./customer-lifecycle.service";
import { initialNadimState } from "../domain/nadim-state";
import { ConversationsService } from "../../conversations.service";
import { extractFollowUpTemporalRequest, resolveFollowUpDueAt } from "./follow-up-time";
import { ActionPolicyService } from "../brain/action-policy.service";

test("human activity never creates a conversation and is a safe no-op outside HUMAN mode", async () => {
  let updates = 0;
  const service = new CustomerLifecycleService({
    conversationParticipant: { findFirst: async () => null },
    nadimConversation: { findFirst: async () => ({ id: "c1", mode: "AI" }), updateMany: async () => { updates += 1; return { count: 1 }; } },
  } as any);
  assert.deepEqual(await service.recordHumanActivity({ channel: "WHATSAPP", externalUserId: "201000000000" }), { recorded: false, mode: "AI" });
  assert.equal(updates, 0);
});

test("human activity updates only a resolved HUMAN conversation and safely rejects an extreme provider timestamp", async () => {
  let where: any;
  let data: any;
  const service = new CustomerLifecycleService({
    conversationParticipant: { findFirst: async () => ({ conversationId: "c1" }) },
    nadimConversation: {
      findUnique: async () => ({ id: "c1", mode: "HUMAN" }),
      updateMany: async (input: any) => { where = input.where; data = input.data; return { count: 1 }; },
    },
  } as any);
  const before = Date.now();
  assert.deepEqual(await service.recordHumanActivity({ channel: "WHATSAPP", externalUserId: "201000000000", occurredAt: "1999-01-01" }), { recorded: true, mode: "HUMAN" });
  assert.equal(where.mode, "HUMAN");
  assert.ok(data.lastHumanMessageAt.getTime() >= before);
});

test("stale HUMAN release uses compare-and-set and returns minimal identifiers", async () => {
  const service = new CustomerLifecycleService({ nadimConversation: {
    findMany: async () => [{ id: "c-old" }, { id: "c-raced" }],
    updateMany: async ({ where }: any) => ({ count: where.id === "c-old" ? 1 : 0 }),
  } } as any);
  assert.deepEqual(await service.releaseStaleHuman(24), { releasedCount: 1, released: [{ conversationId: "c-old" }] });
});

test("due follow-ups are leased once and HUMAN-owned automatic tasks stay suppressed", async () => {
  const rows = [
    { id: "human", conversationId: "c1", channel: "WHATSAPP", outboundAddress: "a", renderedMessage: null, safeDuringHuman: false, attempts: 0, maxAttempts: 3, conversation: { locale: "ar-EG", mode: "HUMAN" } },
    { id: "ai", conversationId: "c2", channel: "WHATSAPP", outboundAddress: "b", renderedMessage: "ready", safeDuringHuman: false, attempts: 0, maxAttempts: 3, conversation: { locale: "en-US", mode: "AI" } },
  ];
  const claimed: string[] = [];
  const service = new CustomerLifecycleService({ followUpTask: {
    updateMany: async ({ where }: any) => { if (where.status === "CLAIMED") return { count: 0 }; claimed.push(where.id); return { count: 1 }; },
    findMany: async () => rows,
  } } as any);
  const result = await service.claimDue("worker", 20);
  assert.deepEqual(claimed, ["ai"]);
  assert.deepEqual(result.tasks, [{ id: "ai", conversationId: "c2", channel: "WHATSAPP", outboundAddress: "b", text: "ready" }]);
});

test("sent is idempotent and failed tasks stop retrying at the attempt cap", async () => {
  let updated: any;
  const prisma: any = { followUpTask: {
    findUnique: async ({ where }: any) => where.id === "sent" ? { id: "sent", status: "SENT", sentAt: new Date(0) } : { id: "failed", status: "CLAIMED", attempts: 3, maxAttempts: 3 },
    updateMany: async ({ data }: any) => { updated = data; return { count: 1 }; },
  } };
  const service = new CustomerLifecycleService(prisma);
  assert.equal((await service.markSent("sent", "EVOLUTION")).idempotent, true);
  const failed = await service.markFailed("failed", "EVOLUTION", "provider timeout");
  assert.equal(failed.retryable, false);
  assert.equal(updated.status, "FAILED");
});

test("share tokens are opaque and only their SHA-256 hash is persisted", async () => {
  let stored: any;
  const service = new CustomerLifecycleService({
    nadimConversation: { findFirst: async () => ({ id: "c1" }) },
    conversationShareToken: { create: async ({ data }: any) => { stored = data; return { id: "t1", ...data }; } },
  } as any);
  const created = await service.createToken({ conversationId: "c1", type: "WHATSAPP_HANDOFF" });
  assert.match(created.token, /^nwh_[A-Za-z0-9_-]{43}$/u);
  assert.notEqual(stored.tokenHash, created.token);
  assert.equal(stored.tokenHash.length, 64);
  assert.equal(stored.maxUses, 1);
});

test("a disjoint property brief creates a second requirement instead of overwriting the active one", async () => {
  let created = false;
  const prisma: any = {
    nadimConversation: {
      findFirst: async () => ({ id: "c1", customerId: "customer" }),
      update: async () => ({}),
      findUnique: async () => ({ activeRequirementId: "r1", activeRequirement: { id: "r1", locations: ["New Cairo"], propertyType: "Apartment" } }),
    },
    propertyRequirement: {
      create: async ({ data }: any) => { created = true; return { id: "r2", ...data }; },
      update: async () => { throw new Error("must not overwrite active requirement"); },
    },
  };
  const service = new CustomerLifecycleService(prisma);
  const state = initialNadimState({ channel: "WEB", locale: "en-US" });
  state.search = { ...state.search, locations: ["Sheikh Zayed"], propertyTypes: ["Villa"], budgetMax: 25_000_000 };
  const result = await service.saveRequirement({ conversationId: "c1", channel: "WEB", state, allowNew: true });
  assert.equal(created, true);
  assert.equal(result.id, "r2");
});

test("an explicitly new brief remains independent even when it resembles the active requirement", async () => {
  let created = false;
  const prisma: any = {
    nadimConversation: {
      findFirst: async () => ({ id: "c1", customerId: "customer" }),
      update: async () => ({}),
      findUnique: async () => ({ activeRequirementId: "r1", activeRequirement: { id: "r1", locations: ["New Cairo"], propertyType: "Apartment" } }),
    },
    propertyRequirement: {
      create: async ({ data }: any) => { created = true; return { id: "r2", ...data }; },
      update: async () => { throw new Error("an explicit new request must not overwrite the active requirement"); },
    },
  };
  const service = new CustomerLifecycleService(prisma);
  const state = initialNadimState({ channel: "WEB", locale: "en-US" });
  state.search = { ...state.search, locations: ["New Cairo"], propertyTypes: ["Apartment"], bedrooms: 2 };
  const result = await service.saveRequirement({ conversationId: "c1", channel: "WEB", state, allowNew: true });
  assert.equal(created, true);
  assert.equal(result.id, "r2");
});

test("a shared MEMBER can leave its web binding without deleting the owner's conversation", async () => {
  const operations: string[] = [];
  const prisma: any = {
    conversation: { findFirst: async () => ({ id: "web-member", nadimConversationId: "nadim-1" }), delete: () => (operations.push("delete-web-member"), {}) },
    conversationParticipant: { findUnique: async () => ({ id: "participant-member", role: "MEMBER" }), update: () => (operations.push("leave-participant"), {}) },
    nadimConversation: { delete: () => { throw new Error("member must not delete shared conversation"); } },
    $transaction: async (items: Promise<unknown>[]) => Promise.all(items),
  };
  const service = new ConversationsService(prisma, { resolve: async () => ({ id: "device" }) } as any, {} as any);
  await service.remove("web-member", "device-token-with-at-least-20-characters");
  assert.deepEqual(operations, ["delete-web-member", "leave-participant"]);
});

test("an OWNER deletion removes every web binding and the conversation-scoped lifecycle data by cascade", async () => {
  const operations: string[] = [];
  const prisma: any = {
    conversation: { findFirst: async () => ({ id: "web-owner", nadimConversationId: "nadim-1" }), deleteMany: () => (operations.push("delete-all-web-bindings"), {}) },
    conversationParticipant: { findUnique: async () => ({ id: "participant-owner", role: "OWNER" }) },
    nadimConversation: { delete: () => (operations.push("delete-nadim"), {}) },
    $transaction: async (items: Promise<unknown>[]) => Promise.all(items),
  };
  const service = new ConversationsService(prisma, { resolve: async () => ({ id: "device" }) } as any, {} as any);
  await service.remove("web-owner", "device-token-with-at-least-20-characters");
  assert.deepEqual(operations, ["delete-all-web-bindings", "delete-nadim"]);
});

test("follow-up expressions resolve deterministically for 30 minutes, 2 hours, and tomorrow in Cairo", () => {
  const now = new Date("2026-08-30T10:00:00.000Z");
  const halfHour = extractFollowUpTemporalRequest("تابع معايا كمان نص ساعة")!;
  const twoHours = extractFollowUpTemporalRequest("كلمني بعد ساعتين")!;
  const tomorrow = extractFollowUpTemporalRequest("فكرني بكرة")!;
  assert.equal(resolveFollowUpDueAt(halfHour, "Africa/Cairo", now).toISOString(), "2026-08-30T10:30:00.000Z");
  assert.equal(resolveFollowUpDueAt(twoHours, "Africa/Cairo", now).toISOString(), "2026-08-30T12:00:00.000Z");
  assert.equal(resolveFollowUpDueAt(tomorrow, "Africa/Cairo", now).toISOString(), "2026-08-31T10:00:00.000Z");
});

test("repeated exact follow-up requests reuse one persisted task", async () => {
  let creates = 0;
  let stored: any;
  const prisma: any = {
    nadimConversation: {
      findFirst: async () => ({ id: "c1", customerId: "customer", timezone: "Africa/Cairo", customer: { timezone: null } }),
      update: async () => ({}), findUniqueOrThrow: async () => ({ id: "c1", customerId: "customer", externalUserId: "201000000000" }),
    },
    followUpTask: { findUnique: async () => stored, create: async ({ data }: any) => { creates += 1; stored = { id: "f1", ...data }; return stored; } },
  };
  const lifecycle = new CustomerLifecycleService(prisma);
  const input = { conversationId: "c1", channel: "WHATSAPP" as const, dueAt: new Date(Date.now() + 30 * 60_000), timezone: "Africa/Cairo", reason: "Customer requested follow-up", messageIntent: {}, dedupeSource: '{"kind":"RELATIVE","amount":30,"unit":"MINUTE"}' };
  assert.equal((await lifecycle.createFollowUp(input)).id, "f1");
  assert.equal((await lifecycle.createFollowUp(input)).id, "f1");
  assert.equal(creates, 1);
});

test("follow-up persistence failure is returned as FAILED and never authorized as success", async () => {
  const policy = new ActionPolicyService({} as any, { conversationTimezone: async () => "Africa/Cairo", createFollowUp: async () => { throw new Error("db down"); } } as any);
  const result = await policy.execute([{ type: "CREATE_FOLLOWUP", reason: "explicit", payload: { temporal: { kind: "RELATIVE", amount: 30, unit: "MINUTE" } } }], { channel: "WHATSAPP", conversationId: "c1", requestId: "r1", state: initialNadimState({ channel: "WHATSAPP", locale: "ar-EG" }) });
  assert.equal(result[0].status, "FAILED");
});

test("successful +30 minute action persists the deterministic dueAt in the conversation timezone", async () => {
  let captured: any;
  const policy = new ActionPolicyService({} as any, { conversationTimezone: async () => "Africa/Cairo", createFollowUp: async (input: any) => { captured = input; return { id: "followup-1" }; } } as any);
  const before = Date.now();
  const [result] = await policy.execute([{ type: "CREATE_FOLLOWUP", reason: "explicit", payload: { temporal: { kind: "RELATIVE", amount: 30, unit: "MINUTE" } } }], { channel: "WHATSAPP", conversationId: "c1", requestId: "r1", state: initialNadimState({ channel: "WHATSAPP", locale: "ar-EG" }) });
  assert.equal(result.status, "SUCCEEDED");
  assert.equal(captured.timezone, "Africa/Cairo");
  assert.ok(captured.dueAt.getTime() >= before + 30 * 60_000 && captured.dueAt.getTime() < before + 30 * 60_000 + 1_000);
});
