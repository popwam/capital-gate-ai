import * as assert from "node:assert/strict";
import { test } from "node:test";
import { CustomerIdentityService, normalizeRequest } from "./customer-identity.service";

function fixture(customers: any[] = [], identities: any[] = []) {
  let sequence = customers.length;
  const tx: any = {
    customer: {
      findUnique: async ({ where }: any) => customers.find((item) =>
        where.id ? item.id === where.id : where.normalizedPhone ? item.normalizedPhone === where.normalizedPhone : item.normalizedEmail === where.normalizedEmail) ?? null,
      create: async ({ data }: any) => {
        const supplied = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
        const item = { id: `customer-${++sequence}`, name: null, normalizedPhone: null, normalizedEmail: null, ...supplied };
        customers.push(item);
        return item;
      },
      update: async ({ where, data }: any) => Object.assign(customers.find((item) => item.id === where.id), data),
    },
    customerChannelIdentity: {
      findUnique: async ({ where }: any) => {
        const key = where.channel_externalId;
        const identity = identities.find((item) => item.channel === key.channel && item.externalId === key.externalId);
        return identity ? { ...identity, customer: customers.find((item) => item.id === identity.customerId) } : null;
      },
      create: async ({ data }: any) => { identities.push(data); return data; },
    },
  };
  return { tx, customers, identities, service: new CustomerIdentityService() };
}

const base = { idempotencyKey: "evt-1", source: "N8N" as const, channel: "WHATSAPP" as const };

test("resolves a customer by explicit id", async () => {
  const customer = { id: "c1", name: "Mona", normalizedPhone: null, normalizedEmail: null };
  const { service, tx } = fixture([customer]);
  assert.equal((await service.resolve(tx, { ...base, customerId: "c1" })).customer.id, "c1");
});

test("normalizes and resolves an international phone", async () => {
  const customer = { id: "c1", name: null, normalizedPhone: "+442079460018", normalizedEmail: null };
  const { service, tx } = fixture([customer]);
  const request = normalizeRequest({ ...base, customer: { phone: "+44 20 7946 0018" } });
  assert.equal((await service.resolve(tx, request)).customer.id, "c1");
});

test("normalizes and resolves email case", async () => {
  const customer = { id: "c1", name: null, normalizedPhone: null, normalizedEmail: "person@example.com" };
  const { service, tx } = fixture([customer]);
  const request = normalizeRequest({ ...base, customer: { email: " Person@Example.COM " } });
  assert.equal((await service.resolve(tx, request)).customer.id, "c1");
});

test("resolves a customer by channel identity", async () => {
  const customer = { id: "c1", name: null, normalizedPhone: null, normalizedEmail: null };
  const { service, tx } = fixture([customer], [{ customerId: "c1", channel: "WHATSAPP", externalId: "wa-1" }]);
  assert.equal((await service.resolve(tx, { ...base, customer: { channelExternalId: "wa-1" } })).customer.id, "c1");
});

test("creates a customer without inventing nullable identity values", async () => {
  const { service, tx } = fixture();
  const result = await service.resolve(tx, { ...base });
  assert.equal(result.created, true);
  assert.equal(result.customer.name, null);
  assert.equal(result.customer.normalizedPhone, null);
});

test("rejects identities that resolve to conflicting customers", async () => {
  const customers = [
    { id: "phone-owner", name: null, normalizedPhone: "+442079460018", normalizedEmail: null },
    { id: "email-owner", name: null, normalizedPhone: null, normalizedEmail: "person@example.com" },
  ];
  const { service, tx } = fixture(customers);
  await assert.rejects(
    () => service.resolve(tx, { ...base, customer: { normalizedPhone: "+442079460018", normalizedEmail: "person@example.com" } }),
    (error: any) => error.code === "CUSTOMER_IDENTITY_CONFLICT",
  );
});
