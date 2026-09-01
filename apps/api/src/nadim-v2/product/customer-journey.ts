import type { NadimPendingAction, NadimPendingFollowUp, NadimReservationFields, NadimState } from "../domain/nadim-state";
import { extractFollowUpTemporalRequest } from "./follow-up-time";

const digits = (value: string) => value
  .normalize("NFKC")
  .replace(/[٠-٩]/gu, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
  .replace(/[۰-۹]/gu, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));

export function normalizeCustomerPhone(value: string) {
  const phone = digits(value).replace(/[^\d+]/gu, "");
  const normalized = phone.startsWith("00") ? `+${phone.slice(2)}` : phone;
  return /^\+?\d{10,15}$/u.test(normalized) ? normalized : undefined;
}

export function extractCustomerPhone(message: string) {
  const candidate = digits(message).match(/(?:\+|00)?\d[\d\s().-]{8,18}\d/u)?.[0];
  return candidate ? normalizeCustomerPhone(candidate) : undefined;
}

export function extractCustomerName(message: string) {
  const match = message.normalize("NFKC").match(/(?:الاسم|اسمي|إسمي|الاسم الكامل|name(?:\s+is)?)[\s:،,-]+([\p{L}][\p{L}\s.'’-]{2,100}?)(?=\s+(?:رقم|ورقمي|رقمي|الهاتف|الموبايل|phone|mobile|وطريقة|و\s*طريقة|طريقة|والدفع|الدفع)|[،,;]|$)/iu);
  return match?.[1]?.replace(/\s+/gu, " ").trim().slice(0, 100) || undefined;
}

export function requestsProjectPaymentPlan(message: string) {
  return /(?:نظام|خطة|طريقة)\s*(?:ال)?(?:دفع|سداد).{0,28}(?:المشروع|بتاع(?:ة)?\s*المشروع|المخصص(?:ة)?\s*للمشروع)|(?:نظام|خطة)\s*المشروع|project(?:'s)?\s+(?:payment\s+)?plan|payment\s+plan\s+(?:for|of)\s+the\s+project/iu.test(message);
}

export function requestsReservationSubmission(message: string) {
  return /(?:ابعت|أبعت|ارسل|أرسل|نفذ|نفّذ|قدم|قدّم)\s*(?:لي\s*)?(?:ال)?طلب|submit|send\s+(?:the\s+)?request/iu.test(message);
}

export function reservationTransition(input: {
  state: NadimState;
  message: string;
  reservationIntent: boolean;
  profile?: { name?: string | null; phone?: string | null };
  now?: Date;
}) {
  const existing = input.state.pendingAction?.type === "RESERVATION_REQUEST" ? input.state.pendingAction : undefined;
  if (!input.reservationIntent && !existing) return undefined;
  const unitId = input.state.selectedUnitId ?? existing?.unitId;
  if (!unitId) return { clarification: "UNIT_SELECTION_REQUIRED" as const };
  const collectedFields: NadimReservationFields = {
    ...existing?.collectedFields,
    fullName: extractCustomerName(input.message) ?? existing?.collectedFields.fullName ?? input.profile?.name ?? undefined,
    phone: extractCustomerPhone(input.message) ?? existing?.collectedFields.phone ?? input.profile?.phone ?? undefined,
    paymentMethod: requestsProjectPaymentPlan(input.message) ? "PROJECT_PAYMENT_PLAN" : existing?.collectedFields.paymentMethod,
  };
  const missingFields = (["fullName", "phone", "paymentMethod"] as const).filter((field) => !collectedFields[field]);
  const pendingAction: NadimPendingAction = {
    type: "RESERVATION_REQUEST",
    unitId,
    collectedFields,
    missingFields: [...missingFields],
    requestedAt: existing?.requestedAt ?? (input.now ?? new Date()).toISOString(),
    lastExecutionStatus: missingFields.length ? existing?.lastExecutionStatus : "READY",
    lastErrorCode: existing?.lastErrorCode,
  };
  return {
    pendingAction,
    ready: missingFields.length === 0,
    shouldSubmit: missingFields.length === 0 && (input.reservationIntent || requestsReservationSubmission(input.message) || requestsProjectPaymentPlan(input.message)),
    clarification: missingFields.length ? `RESERVATION_${missingFields[0].toUpperCase()}_REQUIRED` : undefined,
  };
}

export function followUpTransition(input: {
  state: NadimState;
  message: string;
  profilePhone?: string | null;
}) {
  const text = input.message.normalize("NFKC");
  const asksWhatsApp = /(?:المتابعة|تابع|كلمني|تواصل|follow\s*up|contact).{0,28}(?:واتس(?:اب)?|whatsapp)|(?:واتس(?:اب)?|whatsapp).{0,28}(?:المتابعة|تابع|كلمني|تواصل|follow\s*up|contact)/iu.test(text);
  const temporal = extractFollowUpTemporalRequest(text)
    ?? (input.state.pendingFollowUp?.temporal?.kind === "TOMORROW"
      ? extractFollowUpTemporalRequest(`بكرة ${text}`)
      : undefined);
  const scheduling = Boolean(temporal && /(?:حدد|حدّد|معاد|موعد|تابع|كلمني|اتصل|فكرني|schedule|follow\s*up|call\s+me|remind)/iu.test(text));
  const existing = input.state.pendingFollowUp;
  if (!asksWhatsApp && !scheduling && !existing) return undefined;
  const currentPhone = extractCustomerPhone(text) ?? existing?.outboundAddress ?? input.profilePhone ?? undefined;
  const pendingFollowUp: NadimPendingFollowUp = {
    ...existing,
    ...(asksWhatsApp ? { channel: "WHATSAPP" as const } : {}),
    ...(currentPhone ? { outboundAddress: currentPhone } : {}),
    ...(temporal ? { temporal } : {}),
  };
  const needsTime = scheduling && pendingFollowUp.temporal?.kind === "TOMORROW" && !pendingFollowUp.temporal.localTime;
  const needsPhone = pendingFollowUp.channel === "WHATSAPP" && !pendingFollowUp.outboundAddress;
  return {
    pendingFollowUp,
    scheduling,
    ready: scheduling && Boolean(pendingFollowUp.temporal) && !needsTime && !needsPhone,
    clarification: needsPhone ? "FOLLOWUP_WHATSAPP_PHONE_REQUIRED" : needsTime ? "FOLLOWUP_EXACT_TIME_REQUIRED" : undefined,
  };
}
