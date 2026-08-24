import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { CountryCode, getCountries, parsePhoneNumberFromString } from "libphonenumber-js";
import { AutomationError } from "../common/automation-error";
import { UpsertLeadDto } from "../leads/dto/upsert-lead.dto";

export type NormalizedCustomerInput = {
  name?: string;
  normalizedPhone?: string;
  normalizedEmail?: string;
  channelExternalId?: string;
};

export type NormalizedUpsertRequest = Omit<UpsertLeadDto, "customer"> & {
  customer?: NormalizedCustomerInput;
};

function cleanText(value: string | null | undefined) {
  const result = value?.trim().replace(/\s+/gu, " ");
  return result || undefined;
}

export function normalizePhone(value: string, defaultCountry = process.env.NADIM_DEFAULT_PHONE_COUNTRY) {
  const raw = cleanText(value);
  if (!raw) throw new AutomationError("INVALID_PHONE", "Phone must not be empty");
  let country: CountryCode | undefined;
  if (defaultCountry) {
    const configured = defaultCountry.trim().toUpperCase();
    if (!getCountries().includes(configured as CountryCode)) {
      throw new AutomationError("INVALID_DEFAULT_COUNTRY", "NADIM_DEFAULT_PHONE_COUNTRY is not a valid ISO country code");
    }
    country = configured as CountryCode;
  }
  const phone = parsePhoneNumberFromString(raw, country);
  if (!phone?.isValid()) {
    throw new AutomationError("INVALID_PHONE", "Phone is not a valid international number");
  }
  return phone.number;
}

export function normalizeRequest(input: UpsertLeadDto): NormalizedUpsertRequest {
  const channelFromCustomer = cleanText(input.customer?.channelExternalId);
  const channelFromContext = cleanText(input.context?.externalChannelId);
  if (channelFromCustomer && channelFromContext && channelFromCustomer !== channelFromContext) {
    throw new AutomationError("AMBIGUOUS_CHANNEL_IDENTITY", "Conflicting channel external identifiers were supplied");
  }
  const customer = input.customer ? {
    ...(cleanText(input.customer.name) ? { name: cleanText(input.customer.name) } : {}),
    ...(input.customer.phone ? { normalizedPhone: normalizePhone(input.customer.phone) } : {}),
    ...(input.customer.email ? { normalizedEmail: input.customer.email.trim().toLowerCase() } : {}),
    ...(channelFromCustomer || channelFromContext ? { channelExternalId: channelFromCustomer ?? channelFromContext } : {}),
  } : channelFromContext ? { channelExternalId: channelFromContext } : undefined;
  const lead = input.lead ? Object.fromEntries(Object.entries({
    ...input.lead,
    purpose: cleanText(input.lead.purpose),
    currency: cleanText(input.lead.currency)?.toUpperCase(),
    preferredContactChannel: cleanText(input.lead.preferredContactChannel),
    preferredConfirmationChannel: cleanText(input.lead.preferredConfirmationChannel),
    notes: cleanText(input.lead.notes),
    followUpAt: input.lead.followUpAt ? new Date(input.lead.followUpAt).toISOString() : undefined,
  }).filter(([, value]) => value !== undefined && value !== null)) : undefined;
  const context = input.context ? Object.fromEntries(Object.entries({
    conversationId: cleanText(input.context.conversationId),
    externalChannelId: channelFromContext,
    eventId: cleanText(input.context.eventId),
    metadata: input.context.metadata,
  }).filter(([, value]) => value !== undefined && value !== null)) : undefined;
  return {
    idempotencyKey: input.idempotencyKey.trim(),
    source: input.source,
    channel: input.channel,
    ...(cleanText(input.customerId) ? { customerId: cleanText(input.customerId) } : {}),
    ...(cleanText(input.leadId) ? { leadId: cleanText(input.leadId) } : {}),
    ...(customer && Object.keys(customer).length ? { customer } : {}),
    ...(lead && Object.keys(lead).length ? { lead: lead as UpsertLeadDto["lead"] } : {}),
    ...(context && Object.keys(context).length ? { context: context as UpsertLeadDto["context"] } : {}),
  };
}

type ResolvedCustomer = { id: string; name: string | null; normalizedPhone: string | null; normalizedEmail: string | null };

@Injectable()
export class CustomerIdentityService {
  async resolve(tx: Prisma.TransactionClient, request: NormalizedUpsertRequest) {
    const phone = request.customer?.normalizedPhone;
    const email = request.customer?.normalizedEmail;
    const externalId = request.customer?.channelExternalId;
    const [explicit, byPhone, byEmail, byChannel] = await Promise.all([
      request.customerId ? tx.customer.findUnique({ where: { id: request.customerId } }) : null,
      phone ? tx.customer.findUnique({ where: { normalizedPhone: phone } }) : null,
      email ? tx.customer.findUnique({ where: { normalizedEmail: email } }) : null,
      externalId ? tx.customerChannelIdentity.findUnique({
        where: { channel_externalId: { channel: request.channel, externalId } },
        include: { customer: true },
      }) : null,
    ]);
    if (request.customerId && !explicit) {
      throw new AutomationError("CUSTOMER_NOT_FOUND", "The explicit customerId does not exist", 404);
    }
    const candidates = [explicit, byPhone, byEmail, byChannel?.customer].filter(Boolean) as ResolvedCustomer[];
    const candidateIds = new Set(candidates.map((item) => item.id));
    if (candidateIds.size > 1) {
      throw new AutomationError("CUSTOMER_IDENTITY_CONFLICT", "Supplied identities belong to different customers", 409);
    }
    let customer = (explicit ?? byPhone ?? byEmail ?? byChannel?.customer) as ResolvedCustomer | null;
    let created = false;
    let updated = false;
    if (!customer) {
      customer = await tx.customer.create({ data: {
        name: request.customer?.name,
        normalizedPhone: phone,
        normalizedEmail: email,
      } });
      created = true;
    } else {
      const data: Prisma.CustomerUpdateInput = {};
      if (request.customer?.name && request.customer.name !== customer.name) data.name = request.customer.name;
      if (phone && phone !== customer.normalizedPhone) data.normalizedPhone = phone;
      if (email && email !== customer.normalizedEmail) data.normalizedEmail = email;
      if (Object.keys(data).length) {
        customer = await tx.customer.update({ where: { id: customer.id }, data });
        updated = true;
      }
    }
    if (externalId && !byChannel) {
      await tx.customerChannelIdentity.create({ data: {
        customerId: customer.id,
        channel: request.channel,
        externalId,
        metadata: request.context?.metadata as Prisma.InputJsonValue | undefined,
      } });
      updated = !created || updated;
    }
    return { customer, created, updated };
  }
}
