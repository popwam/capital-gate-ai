import * as assert from "node:assert/strict";
import { test } from "node:test";
import { LeadStatus } from "@prisma/client";
import { CustomerIdentityService } from "../customers/customer-identity.service";
import { IdempotencyService } from "../idempotency/idempotency.service";
import { LeadsService } from "./leads.service";

function fixture(seed: { customers?: any[]; identities?: any[]; leads?: any[]; conversations?: any[] } = {}) {
  const state = {
    customers: [...(seed.customers ?? [])],
    identities: [...(seed.identities ?? [])],
    leads: [...(seed.leads ?? [])],
    conversations: [...(seed.conversations ?? [])],
    executions: [] as any[],
    events: [] as any[],
    audits: [] as any[],
    sequence: 0,
  };
  const prisma: any = {
    customer: {
      findUnique: async ({ where }: any) => state.customers.find((item) =>
        where.id ? item.id === where.id : where.normalizedPhone ? item.normalizedPhone === where.normalizedPhone : item.normalizedEmail === where.normalizedEmail) ?? null,
      create: async ({ data }: any) => {
        const supplied = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
        const item = { id: `customer-${++state.sequence}`, name: null, normalizedPhone: null, normalizedEmail: null, ...supplied };
        state.customers.push(item);
        return item;
      },
      update: async ({ where, data }: any) => Object.assign(state.customers.find((item) => item.id === where.id), data),
    },
    customerChannelIdentity: {
      findUnique: async ({ where }: any) => {
        const key = where.channel_externalId;
        const identity = state.identities.find((item) => item.channel === key.channel && item.externalId === key.externalId);
        return identity ? { ...identity, customer: state.customers.find((item) => item.id === identity.customerId) } : null;
      },
      create: async ({ data }: any) => { state.identities.push(data); return data; },
    },
    lead: {
      findUnique: async ({ where }: any) => state.leads.find((item) => item.id === where.id) ?? null,
      findFirst: async ({ where }: any) => state.leads
        .filter((item) => where.customerId === null ? item.customerId == null : where.customerId ? item.customerId === where.customerId : true)
        .filter((item) => where.phone ? item.phone === where.phone : true)
        .filter((item) => !where.status?.notIn?.includes(item.status))
        .sort((left, right) => +right.updatedAt - +left.updatedAt)[0] ?? null,
      create: async ({ data }: any) => {
        const supplied = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
        const item = {
          id: `lead-${++state.sequence}`,
          conversationId: data.conversationId ?? null,
          customerId: data.customerId ?? null,
          name: data.name ?? null,
          phone: data.phone ?? null,
          status: LeadStatus.NEW,
          payload: data.payload,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...supplied,
        };
        state.leads.push(item);
        return item;
      },
      update: async ({ where, data }: any) => {
        const item = state.leads.find((lead) => lead.id === where.id);
        if (data.customer?.connect) item.customerId = data.customer.connect.id;
        if (data.conversation?.connect) item.conversationId = data.conversation.connect.id;
        const scalar = { ...data };
        delete scalar.customer;
        delete scalar.conversation;
        Object.assign(item, scalar, { updatedAt: new Date() });
        return item;
      },
    },
    conversation: { findUnique: async ({ where }: any) => state.conversations.find((item) => item.id === where.id) ?? null },
    leadEvent: { create: async ({ data }: any) => { const item = { id: `event-${++state.sequence}`, ...data }; state.events.push(item); return item; } },
    auditLog: { create: async ({ data }: any) => { state.audits.push(data); return data; } },
    automationActionExecution: {
      create: async ({ data }: any) => {
        if (state.executions.some((item) => item.idempotencyKey === data.idempotencyKey)) throw { code: "P2002" };
        const item = { id: `execution-${++state.sequence}`, responsePayload: null, ...data };
        state.executions.push(item);
        return item;
      },
      findUnique: async ({ where }: any) => state.executions.find((item) => item.idempotencyKey === where.idempotencyKey) ?? null,
      update: async ({ where, data }: any) => Object.assign(state.executions.find((item) => item.id === where.id), data),
    },
  };
  prisma.$transaction = async (callback: any) => callback(prisma);
  const service = new LeadsService(prisma, new CustomerIdentityService(), new IdempotencyService(prisma));
  return { service, state };
}

const base = { source: "N8N" as const, channel: "WHATSAPP" as const };
const customer = { id: "customer-existing", name: "Mona", normalizedPhone: "+442079460018", normalizedEmail: "mona@example.com" };

test("creates a lead without a web conversation and without fake customer values", async () => {
  const { service, state } = fixture();
  const result = await service.upsert({ ...base, idempotencyKey: "create-1", lead: { intent: "INQUIRY" } });
  assert.equal(result.ok, true);
  assert.equal(result.lead?.created, true);
  assert.equal(state.leads[0].conversationId, null);
  assert.equal(state.leads[0].name, null);
  assert.equal(state.leads[0].phone, null);
});

test("updates an existing active lead for the resolved customer", async () => {
  const existing = { id: "lead-existing", customerId: customer.id, conversationId: null, name: "Mona", phone: customer.normalizedPhone, status: LeadStatus.CONTACTED, intent: "INQUIRY", intentScore: 20, payload: { retained: true }, updatedAt: new Date() };
  const { service, state } = fixture({ customers: [customer], leads: [existing] });
  const result = await service.upsert({ ...base, idempotencyKey: "update-1", customerId: customer.id, lead: { intentScore: 88, purpose: "Investment" } });
  assert.equal(result.lead?.updated, true);
  assert.equal(state.leads[0].intentScore, 88);
  assert.equal(state.leads[0].payload.retained, true);
  assert.equal(state.leads[0].payload.requirements.purpose, "Investment");
});

test("attaches a legacy active lead matched by normalized phone", async () => {
  const legacy = { id: "legacy", customerId: null, conversationId: "web-1", name: "Mona", phone: customer.normalizedPhone, status: LeadStatus.NEW, intent: "PURCHASE", intentScore: 80, payload: {}, updatedAt: new Date() };
  const { service, state } = fixture({ leads: [legacy] });
  const result = await service.upsert({ ...base, idempotencyKey: "legacy-1", customer: { phone: "+44 20 7946 0018" }, lead: { intentScore: 90 } });
  assert.equal(result.lead?.id, "legacy");
  assert.ok(state.leads[0].customerId);
  assert.ok(state.events.some((item) => item.type === "CUSTOMER_ATTACHED"));
});

test("creates only a customer when lead data is insufficient", async () => {
  const { service, state } = fixture();
  const result = await service.upsert({ ...base, idempotencyKey: "customer-only" });
  assert.equal(result.reason, "INSUFFICIENT_LEAD_DATA");
  assert.equal(result.lead, null);
  assert.equal(state.leads.length, 0);
});

test("replays an identical request without duplicate lead or event", async () => {
  const { service, state } = fixture();
  const request = { ...base, idempotencyKey: "replay-1", lead: { intent: "VIEWING" as const } };
  const first = await service.upsert(request);
  const replay = await service.upsert(request);
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(state.leads.length, 1);
  assert.equal(state.events.length, 1);
});

test("rejects reuse of an idempotency key with different normalized input", async () => {
  const { service, state } = fixture();
  await service.upsert({ ...base, idempotencyKey: "conflict-key", lead: { intent: "INQUIRY" } });
  await assert.rejects(
    () => service.upsert({ ...base, idempotencyKey: "conflict-key", lead: { intent: "PURCHASE" } }),
    (error: any) => error.code === "IDEMPOTENCY_CONFLICT" && error.status === 409,
  );
  assert.equal(state.leads.length, 1);
});

test("records a failed execution when customer identities conflict", async () => {
  const phoneOwner = { id: "phone-owner", name: null, normalizedPhone: customer.normalizedPhone, normalizedEmail: null };
  const emailOwner = { id: "email-owner", name: null, normalizedPhone: null, normalizedEmail: customer.normalizedEmail };
  const { service, state } = fixture({ customers: [phoneOwner, emailOwner] });
  const result = await service.upsert({ ...base, idempotencyKey: "identity-conflict", customer: { phone: customer.normalizedPhone, email: customer.normalizedEmail } });
  assert.equal(result.error?.code, "CUSTOMER_IDENTITY_CONFLICT");
  assert.equal(state.executions[0].status, "FAILED");
  assert.equal(state.leads.length, 0);
});

test("does not reuse terminal leads when no explicit leadId is supplied", async () => {
  const won = { id: "won", customerId: customer.id, conversationId: null, name: "Mona", phone: customer.normalizedPhone, status: LeadStatus.WON, intent: "PURCHASE", intentScore: 100, payload: {}, updatedAt: new Date() };
  const { service, state } = fixture({ customers: [customer], leads: [won] });
  const result = await service.upsert({ ...base, idempotencyKey: "terminal", customerId: customer.id, lead: { intent: "INQUIRY" } });
  assert.equal(result.lead?.created, true);
  assert.equal(state.leads.length, 2);
});
