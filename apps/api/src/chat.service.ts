import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  DocumentType,
  LeadStatus,
  MessageRole,
  Prisma,
} from "@prisma/client";
import { PrismaService } from "./database/prisma.service";
import { ConversationsService } from "./conversations.service";
import {
  AIMessage,
  AIContextKind,
  AIProvider,
  AnswerInput,
  StructuredIntent,
} from "./providers/ai-provider";
import { answerContextMetrics, compactAnswerInput } from "./providers/ai-context";
import { PropertySearchService } from "./property-search.service";
import { MapsService } from "./maps.service";
import { deterministicIntent } from "./providers/deterministic-intent";
import { normalizeRealEstateSemantics } from "./providers/real-estate-semantics";
import { applyDeterministicTurnSemantics, nextPresentation, planCustomerTurn, UIAction, unpresentedUnitIds } from "./customer-turn-planner";
import { ApplicationCache } from "./cache/application-cache";
import { CustomerTrustService } from "./customer-trust.service";

type MessagePayload = {
  type:
    | "text"
    | "properties"
    | "media"
    | "documents"
    | "map"
    | "lead_prompt"
    | "lead_created";
  properties?: unknown[];
  media?: unknown[];
  documents?: unknown[];
  map?: unknown;
  leadId?: string;
  uiActions: UIAction[];
};
type Prepared = {
  conversationId: string;
  answerInput: AnswerInput;
  state: StructuredIntent;
  payload: MessagePayload;
  userMessages: AIMessage[];
  unitIds: string[];
  trace: Record<string, unknown>;
  directAnswer?: string;
};
export function leadPersistenceAction(
  existingLeadId: string | undefined,
  phone: string | undefined,
  intentScore = 0,
): "update" | "create" | "none" {
  if (!phone) return "none";
  if (existingLeadId) return "update";
  return intentScore >= 70 ? "create" : "none";
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  constructor(
    @Inject("AI_PROVIDER") private readonly ai: AIProvider,
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationsService,
    private readonly search: PropertySearchService,
    private readonly maps: MapsService,
    private readonly cache: ApplicationCache,
    private readonly trust: CustomerTrustService,
  ) {}

  private serialize(value: unknown) {
    return JSON.parse(JSON.stringify(value));
  }

  private cardProperty(value: any) {
    return {
      id: value.id,
      externalUnitId: value.externalUnitId,
      unitType: value.unitType,
      bedrooms: value.bedrooms,
      bathrooms: value.bathrooms,
      builtUpArea: value.builtUpArea,
      price: value.price,
      currency: value.currency,
      status: value.status,
      availabilityUpdatedAt: value.availabilityUpdatedAt,
      deliveryDate: value.deliveryDate,
      finishingType: value.finishingType,
      floor: value.floor,
      phase: value.phase,
      internalLocationDescription: value.internalLocationDescription,
      projectZone: value.projectZone ? { id: value.projectZone.id, name: value.projectZone.nameAr ?? value.projectZone.nameEn ?? value.projectZone.name } : null,
      projectBuilding: value.projectBuilding ? { id: value.projectBuilding.id, name: value.projectBuilding.nameAr ?? value.projectBuilding.nameEn ?? value.projectBuilding.name } : null,
      closestGate: value.closestGate ?? null,
      bestPaymentPlan: value.bestPaymentPlan ?? null,
      project: value.project ? {
        id: value.project.id,
        name: value.project.nameAr ?? value.project.nameEn ?? value.project.name,
        location: value.project.location ? { id: value.project.location.id, name: value.project.location.nameAr ?? value.project.location.nameEn ?? value.project.location.name } : null,
      } : null,
      developer: value.developer ? { id: value.developer.id, name: value.developer.nameAr ?? value.developer.nameEn ?? value.developer.brandName ?? value.developer.name } : null,
      paymentPlans: Array.isArray(value.paymentPlans) ? value.paymentPlans.map((plan: any) => ({
        id: plan.id,
        name: plan.name,
        durationMonths: plan.durationMonths,
        downPaymentAmount: plan.downPaymentAmount ?? plan.downPayment,
        downPaymentPercent: plan.downPaymentPercent,
        installmentAmount: plan.installmentAmount,
        installmentFrequency: plan.installmentFrequency,
        totalPrice: plan.totalPrice,
        totalPriceOverride: plan.totalPriceOverride,
        effectiveTotalPrice: plan.effectiveTotalPrice,
        discountAmount: plan.discountAmount,
        discountPercent: plan.discountPercent,
        currency: plan.currency ?? value.currency,
        scope: plan.unitId ? "UNIT" : "PROJECT",
      })) : [],
      media: Array.isArray(value.media) ? value.media.slice(0, 1).map((item: any) => ({ id: item.id, url: item.url, altText: item.altTextAr ?? item.altTextEn ?? item.altText ?? null })) : [],
    };
  }

  private contextualUnitIds(previous: StructuredIntent, priorUnitIds: string[]) {
    const presentation = previous.presentation ?? {};
    return [...new Set([
      ...(presentation.lastPresentedUnitIds ?? []),
      ...(presentation.selectedUnitId ? [presentation.selectedUnitId] : []),
      ...(presentation.searchCandidateIds ?? []),
      ...priorUnitIds,
    ])];
  }

  private asksUnitMedia(content: string) {
    return /(?:صور|photos?|images?).*(?:الوحده|الوحدة|unit)|(?:الوحده|الوحدة|unit).*(?:صور|photos?|images?)/iu.test(content);
  }

  private distanceDestination(content: string) {
    if (/\bAUC\b|الجامعه\s+الامريكيه|الجامعة\s+الأمريكية/iu.test(content)) return "American University in Cairo, New Cairo";
    const match = content.match(/(?:وبين|الى|إلى|to)\s+(.+?)(?:\s+(?:كام|قد ايه|how far)|[؟?]|$)/iu);
    return match?.[1]?.trim();
  }

  private projectReference(content: string, intent?: string) {
    const patterns = intent === "MEDIA_REQUEST"
      ? [/(?:photos?|images?)\s+(?:of\s+)?(.+)$/iu, /(?:صور)\s+(.+)$/u]
      : intent === "LOCATION_REQUEST"
        ? [/(?:location\s+of|where\s+is)\s+(.+)$/iu, /(?:فين|موقع)\s+(.+)$/u]
        : intent === "BROCHURE_REQUEST"
          ? [/(?:brochure\s+(?:of|for)?|بروشور)\s+(.+)$/iu]
          : [];
    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (!match?.[1]) continue;
      const value = match[1]
        .replace(/\s+بالظبط[؟?]*$/u, "")
        .replace(/[؟?]+$/, "")
        .replace(/^(?:المشروع|مشروع|project)\s+/iu, "")
        .trim();
      if (value) return value;
    }
    return undefined;
  }

  private displayProject(unit: any) {
    return unit?.project?.nameAr ?? unit?.project?.nameEn ?? unit?.project?.name ?? null;
  }

  private displayDeveloper(unit: any) {
    return unit?.developer?.nameAr ?? unit?.developer?.nameEn ?? unit?.developer?.brandName ?? unit?.developer?.name
      ?? unit?.project?.developer?.nameAr ?? unit?.project?.developer?.nameEn ?? unit?.project?.developer?.brandName ?? unit?.project?.developer?.name ?? null;
  }

  private displayLocation(unit: any) {
    return unit?.project?.location?.nameAr ?? unit?.project?.location?.nameEn ?? unit?.project?.location?.name
      ?? unit?.project?.formattedAddress ?? null;
  }

  private money(value: unknown, currency = "EGP") {
    if (value == null || value === "") return null;
    const amount = Number(value);
    return Number.isFinite(amount) ? `${amount.toLocaleString("en-US")} ${currency}` : null;
  }

  private propertyDetailAnswer(unit: any, ar: boolean) {
    if (!unit) return undefined;
    const project = this.displayProject(unit);
    const developer = this.displayDeveloper(unit);
    const location = this.displayLocation(unit);
    const price = this.money(unit.price, unit.currency ?? "EGP");
    const area = unit.builtUpArea != null ? `${Number(unit.builtUpArea)} م²` : null;
    const phase = unit.phaseRef?.nameAr ?? unit.phaseRef?.nameEn ?? unit.phaseRef?.name ?? unit.phase ?? null;
    const building = unit.projectBuilding?.nameAr ?? unit.projectBuilding?.nameEn ?? unit.projectBuilding?.name ?? unit.building ?? null;
    if (!ar) {
      return [
        `Unit ${unit.externalUnitId ?? ""}${project ? ` is in ${project}` : ""}${developer ? ` by ${developer}` : ""}.`,
        [unit.unitType, unit.bedrooms != null ? `${unit.bedrooms} bedrooms` : null, area, price, unit.status].filter(Boolean).join(" · "),
        [phase ? `Phase: ${phase}` : null, building ? `Building: ${building}` : null, location ? `Location: ${location}` : null].filter(Boolean).join(" · "),
      ].filter(Boolean).join("\n\n");
    }
    return [
      `الوحدة **${unit.externalUnitId ?? ""}**${project ? ` في مشروع **${project}**` : ""}${developer ? ` من المطور **${developer}**` : ""}.`,
      [unit.unitType, unit.bedrooms != null ? `${unit.bedrooms} غرف` : null, area, price, unit.status === "AVAILABLE" ? "متاحة حاليًا" : unit.status].filter(Boolean).join(" · "),
      [phase ? `المرحلة: ${phase}` : null, building ? `المبنى: ${building}` : null, location ? `الموقع: ${location}` : null].filter(Boolean).join(" · "),
    ].filter(Boolean).join("\n\n");
  }

  private paymentAnswer(facts: unknown[], ar: boolean) {
    const units = (facts as any[]).filter((item) => item && Array.isArray(item.paymentPlans));
    if (!units.length) return undefined;
    const unit = units[0];
    const plans = units.flatMap((item) => item.paymentPlans ?? []);
    const unique = [...new Map(plans.map((plan: any) => [
      `${plan.planType ?? "INSTALLMENT"}:${plan.durationMonths ?? "x"}:${plan.downPaymentPercent ?? plan.downPaymentAmount ?? "x"}:${plan.discountPercent ?? "x"}`,
      plan,
    ])).values()] as any[];
    if (!unique.length) return ar
      ? `مفيش خطة سداد مفعلة ومطبقة على الوحدة ${unit.externalUnitId ?? "دي"} حاليًا.`
      : `There is no active payment plan applied to unit ${unit.externalUnitId ?? "this unit"} right now.`;
    const currency = unit.currency ?? "EGP";
    const lines = unique.slice(0, 6).map((plan: any) => {
      const cash = String(plan.planType ?? "").toUpperCase() === "CASH" || Number(plan.durationMonths ?? -1) === 0;
      if (cash) {
        const effective = plan.effectiveTotalPrice ?? plan.totalPriceOverride ?? plan.totalPrice;
        const shown = this.money(effective, plan.currency ?? currency) ?? this.money(unit.price, currency);
        const discount = plan.discountPercent != null && Number(plan.discountPercent) > 0 ? `${Number(plan.discountPercent)}%` : null;
        return ar ? `• كاش${shown ? `: ${shown}` : ""}${discount ? ` بعد خصم ${discount}` : ""}` : `• Cash${shown ? `: ${shown}` : ""}${discount ? ` after ${discount} discount` : ""}`;
      }
      const years = plan.durationMonths != null ? Number(plan.durationMonths) / 12 : null;
      const down = plan.downPaymentPercent != null ? `${Number(plan.downPaymentPercent)}%` : this.money(plan.downPaymentAmount, plan.currency ?? currency);
      const every = plan.installmentEveryValue && plan.installmentEveryUnit ? `${plan.installmentEveryValue} ${plan.installmentEveryUnit}` : plan.installmentFrequency;
      const first = plan.firstInstallmentAfterValue && plan.firstInstallmentAfterUnit ? `${plan.firstInstallmentAfterValue} ${plan.firstInstallmentAfterUnit}` : null;
      return ar
        ? `• ${plan.name ?? "تقسيط"}${years ? ` — ${Number.isInteger(years) ? years : years.toFixed(1)} سنة` : ""}${down ? `، مقدم ${down}` : ""}${every ? `، القسط كل ${every}` : ""}${first ? `، أول قسط بعد ${first}` : ""}`
        : `• ${plan.name ?? "Installments"}${years ? ` — ${Number.isInteger(years) ? years : years.toFixed(1)} years` : ""}${down ? `, down payment ${down}` : ""}${every ? `, every ${every}` : ""}${first ? `, first installment after ${first}` : ""}`;
    });
    const project = this.displayProject(unit);
    const intro = ar
      ? `خطط السداد المطبقة على ${unit.externalUnitId ? `الوحدة **${unit.externalUnitId}**` : "الوحدة"}${project ? ` في **${project}**` : ""}:`
      : `Payment plans applied to ${unit.externalUnitId ? `unit ${unit.externalUnitId}` : "the unit"}${project ? ` in ${project}` : ""}:`;
    return `${intro}\n${lines.join("\n")}`;
  }

  private hasGroundingContradiction(answer: string, facts: unknown[]) {
    const values = facts as any[];
    const hasProject = values.some((item) => Boolean(item?.projectName ?? item?.project?.name ?? item?.name));
    const hasDeveloper = values.some((item) => Boolean(item?.developerName ?? item?.developer?.name ?? item?.project?.developer?.name));
    const hasLocation = values.some((item) => Boolean(item?.location ?? item?.formattedAddress ?? item?.project?.location?.name));
    const hasPayment = values.some((item) => Boolean(item?.paymentPlan) || (Array.isArray(item?.paymentPlans) && item.paymentPlans.length));
    const missing = /(?:غير\s+(?:متوفر|متاحة|موجود)|مش\s+(?:متوفر|موجود)|ما\s*فيش|ليس\s+متوفر|unavailable|not\s+available|missing)/iu;
    if (!missing.test(answer)) return false;
    if (hasProject && /(?:اسم\s+المشروع|المشروع|project)/iu.test(answer)) return true;
    if (hasDeveloper && /(?:المطور|developer)/iu.test(answer)) return true;
    if (hasLocation && /(?:الموقع|المكان|location|address)/iu.test(answer)) return true;
    if (hasPayment && /(?:السداد|تقسيط|كاش|payment|installment)/iu.test(answer)) return true;
    return false;
  }

  private groundedFallback(state: StructuredIntent, facts: unknown[]) {
    const ar = state.language?.startsWith("ar") ?? true;
    const first = facts[0] as any;
    if (!first) return ar ? "المعلومة المطلوبة مش متاحة في البيانات الموثقة عندي حاليًا." : "The requested information is not available in the verified data right now.";
    if (first.unitCode) {
      const propertyFacts = (facts as any[]).filter((item) => item?.unitCode).slice(0, 4);
      if (propertyFacts.length > 1) {
        const lines = propertyFacts.map((item) => {
          const price = this.money(item.price, item.currency ?? "EGP");
          return ar
            ? `• **${item.unitCode}** — ${[item.projectName, item.developerName, item.builtUpArea != null ? `${item.builtUpArea} م²` : null, price].filter(Boolean).join(" · ")}`
            : `• **${item.unitCode}** — ${[item.projectName, item.developerName, item.builtUpArea != null ? `${item.builtUpArea} m²` : null, price].filter(Boolean).join(" · ")}`;
        });
        const location = propertyFacts[0].location ?? propertyFacts[0].formattedAddress;
        return ar
          ? `دي وحدات مطابقة من البيانات الموثقة عندي:\n${lines.join("\n")}${location ? `\n\nالموقع: ${location}` : ""}`
          : `These matching units are present in the verified inventory:\n${lines.join("\n")}${location ? `\n\nLocation: ${location}` : ""}`;
      }
      const project = first.projectName;
      const developer = first.developerName;
      const location = first.location ?? first.formattedAddress;
      const price = this.money(first.price, first.currency ?? "EGP");
      return ar
        ? [`الوحدة **${first.unitCode}**${project ? ` في مشروع **${project}**` : ""}${developer ? ` من المطور **${developer}**` : ""}.`, [first.unitType, first.bedrooms != null ? `${first.bedrooms} غرف` : null, first.builtUpArea != null ? `${first.builtUpArea} م²` : null, price, first.availability === "AVAILABLE" ? "متاحة حاليًا" : first.availability].filter(Boolean).join(" · "), location ? `الموقع: ${location}` : null].filter(Boolean).join("\n\n")
        : [`Unit ${first.unitCode}${project ? ` in ${project}` : ""}${developer ? ` by ${developer}` : ""}.`, [first.unitType, first.bedrooms != null ? `${first.bedrooms} bedrooms` : null, first.builtUpArea != null ? `${first.builtUpArea} m²` : null, price, first.availability].filter(Boolean).join(" · "), location ? `Location: ${location}` : null].filter(Boolean).join("\n\n");
    }
    if (first.projectName || first.developerName || first.location || first.formattedAddress) {
      const project = first.projectName ?? null;
      const developer = first.developerName ?? null;
      const location = first.location ?? first.formattedAddress ?? null;
      const types = Array.isArray(first.projectTypes) && first.projectTypes.length ? first.projectTypes.join("، ") : null;
      return ar
        ? [project ? `المشروع: **${project}**` : null, developer ? `المطور: **${developer}**` : null, location ? `الموقع: ${location}` : null, types ? `الأنواع: ${types}` : null].filter(Boolean).join("\n")
        : [project ? `Project: **${project}**` : null, developer ? `Developer: **${developer}**` : null, location ? `Location: ${location}` : null, types ? `Types: ${types}` : null].filter(Boolean).join("\n");
    }
    return ar ? "المعلومة المطلوبة موجودة في البيانات الموثقة، وتم منع صياغة غير دقيقة من الوصول للعميل." : "The requested fact exists in verified data; an inaccurate generated answer was blocked.";
  }

  private directToolAnswer(state: StructuredIntent, payload: MessagePayload, facts: unknown[]) {
    const ar = state.language?.startsWith("ar");
    const intent = state.turnIntent;
    const first = facts[0] as any;
    if (payload.type === "lead_created") {
      const firstName = state.contactName?.trim().split(/\s+/)[0];
      const name = firstName ? ` يا ${firstName}` : "";
      const code = state.externalUnitId ? ` **${state.externalUnitId}**` : "";
      const contactLabel = state.preferredContactChannel === "WHATSAPP" ? "واتساب" : state.preferredContactChannel === "CALL" ? "مكالمة" : state.preferredContactChannel === "SMS" ? "SMS" : state.preferredContactChannel === "EMAIL" ? "إيميل" : null;
      const confirmLabel = state.preferredConfirmationChannel === "WHATSAPP" ? "واتساب" : state.preferredConfirmationChannel === "CALL" ? "مكالمة" : state.preferredConfirmationChannel === "SMS" ? "SMS" : state.preferredConfirmationChannel === "EMAIL" ? "إيميل" : null;
      const timing = [state.preferredVisitDayPart === "AFTERNOON" ? "العصر" : state.preferredVisitDayPart === "MORNING" ? "الصبح" : state.preferredVisitDayPart === "EVENING" ? "المساء" : null, state.preferredVisitTiming === "MIDWEEK" ? "في نص الأسبوع" : state.preferredVisitTiming === "WEEKEND" ? "في نهاية الأسبوع" : state.preferredVisitTiming === "WEEKDAY" ? "في يوم عمل" : null].filter(Boolean).join(" و");
      const missingContact = !state.preferredContactChannel;
      const missingConfirmation = !state.preferredConfirmationChannel;
      if (ar) {
        const base = `تمام${name}، كده أنا سجلتلك الطلب${code ? ` على الوحدة${code}` : ""}${timing ? `، وسجلت تفضيلك للمعاينة ${timing}` : ""}. حد من قسم المبيعات هيكلمك وينسق معاك؛ الموعد النهائي بيتأكد معاهم مش من عندي.`;
        if (missingContact && missingConfirmation) return `${base}

تحب التواصل الأساسي يكون **مكالمة، واتساب، SMS ولا إيميل**؟ وتأكيد الموعد تحبه بأنهي وسيلة؟`;
        if (missingContact) return `${base}

تحب التواصل الأساسي معاك يكون **مكالمة، واتساب، SMS ولا إيميل**؟`;
        if (missingConfirmation) return `${base}

تمام، التواصل عندي ${contactLabel}. تحب تأكيد الموعد النهائي يكون **واتساب، SMS، مكالمة ولا إيميل**؟`;
        return `${base}

تمام، مثبت عندي إن التواصل يكون ${contactLabel} والتأكيد ${confirmLabel}.`;
      }
      const base = `All set${firstName ? `, ${firstName}` : ""}. I saved your request${code ? ` for unit${code}` : ""}. A sales advisor will contact you and coordinate the actual appointment; I won't pretend the time is confirmed before they confirm it.`;
      if (missingContact && missingConfirmation) return `${base}

Would you prefer the main contact by **call, WhatsApp, SMS, or email**, and which channel should be used for the appointment confirmation?`;
      if (missingContact) return `${base}

Would you prefer the main contact by **call, WhatsApp, SMS, or email**?`;
      if (missingConfirmation) return `${base}

I have your contact preference. Would you like the final confirmation by **WhatsApp, SMS, call, or email**?`;
      return base;
    }
    if (payload.type === "lead_prompt") {
      const code = state.externalUnitId ? ` **${state.externalUnitId}**` : "";
      return ar
        ? `تمام، نقدر نكمل الطلب${code ? ` للوحدة${code}` : ""}. قبل ما أسجله محتاج الاسم اللي تحب فريق المبيعات يناديك بيه ورقم موبايل شغال للتواصل. خلّينا نخلي البيانات دقيقة عشان الطلب مايتسجلش باسم أو رقم غلط.`
        : `We can continue the request${code ? ` for unit${code}` : ""}. Before I save it, send the name you want the sales team to use and a working mobile number. I want the handoff details to be accurate rather than saving a placeholder or wrong number.`;
    }
    if (intent === "PROPERTY_DETAILS" && facts.length > 1) {
      const codes = (facts as any[]).map((item) => item?.externalUnitId).filter(Boolean).slice(0, 8);
      return ar ? `لقيت أكتر من وحدة مطابقة للجزء اللي كتبته: ${codes.join("، ")}. اختار الكود الكامل وأنا أجيب لك تفاصيلها الدقيقة.` : `I found multiple units matching that reference: ${codes.join(", ")}. Send the full code and I will open the exact unit.`;
    }
    if (intent === "PROPERTY_DETAILS" && first) return this.propertyDetailAnswer(first, Boolean(ar));
    if (intent === "PAYMENT_PLAN") return this.paymentAnswer(facts, Boolean(ar));
    if (intent === "MEDIA_REQUEST") {
      const action = payload.uiActions.find((item) => item.type === "PROJECT_PHOTOS");
      const count = (action?.payload.media as unknown[] | undefined)?.length ?? 0;
      const unitScope = action?.payload.scope === "UNIT";
      return count
        ? (ar ? (unitScope ? "أكيد، دي الصور المعتمدة المتاحة للوحدة." : "أكيد، دي الصور المعتمدة المتاحة للمشروع.") : (unitScope ? "Here are the approved unit photos available." : "Here are the approved project photos available."))
        : (ar ? (unitScope ? "لسه مفيش صور مخصصة للوحدة دي عندي." : "لسه مفيش صور معتمدة للمشروع عندي.") : (unitScope ? "There are no unit-specific photos available yet." : "There are no approved project photos available yet."));
    }
    if (intent === "BROCHURE_REQUEST") {
      const exists = facts.length > 0;
      const sent = payload.uiActions.some((item) => item.type === "PROJECT_BROCHURE");
      return !exists ? (ar ? "لسه مفيش بروشور معتمد للمشروع عندي." : "There is no approved brochure available yet.") : sent ? (ar ? "تمام، ده البروشور المعتمد للمشروع." : "Here is the approved project brochure.") : (ar ? "أيوه، البروشور موجود. تحب أبعتهولك؟" : "Yes, the brochure is available. Would you like me to send it?");
    }
    if (intent === "LOCATION_REQUEST") return first ? (ar ? "أكيد، ده الموقع الموثق للمشروع." : "Here is the verified project location.") : (ar ? "لسه مفيش إحداثيات موثقة للمشروع عندي." : "Verified project coordinates are not available yet.");
    if (intent === "DISTANCE_REQUEST") {
      const route = first;
      if (!route || route.source === "UNAVAILABLE") return ar ? "مقدرتش أحدد مسافة موثقة للمسار ده حاليًا." : "I could not determine a verified route for that trip right now.";
      const distance = route.distanceKm ?? (route.routes?.[0]?.distanceMeters != null ? Number(route.routes[0].distanceMeters) / 1000 : null);
      const duration = route.estimatedMinutes ?? (typeof route.routes?.[0]?.duration === "string" ? Math.round(Number.parseFloat(route.routes[0].duration) / 60) : null);
      return ar ? `المسافة ${distance != null ? `حوالي ${Number(distance).toFixed(1)} كم` : "متاحة في نتيجة المسار"}${duration != null ? `، والوقت التقريبي ${duration} دقيقة` : ""}. المصدر: ${route.source === "ADMIN_VERIFIED" ? "بيانات إدارية موثقة" : "Google Routes"}.` : `The route is ${distance != null ? `about ${Number(distance).toFixed(1)} km` : "available"}${duration != null ? ` and approximately ${duration} minutes` : ""}. Source: ${route.source === "ADMIN_VERIFIED" ? "admin-verified data" : "Google Routes"}.`;
    }
    if (["INVENTORY_COUNT", "AREA_AGGREGATION", "PRICE_AGGREGATION"].includes(intent ?? "")) {
      if (intent === "INVENTORY_COUNT") return ar ? `عندي ${first?.count ?? 0} وحدة متاحة في نطاق البحث الحالي.` : `${first?.count ?? 0} units are available in the current search scope.`;
      const values = Array.isArray(first?.values) ? first.values : [];
      if (!values.length) return ar ? "مفيش بيانات مطابقة في نطاق البحث الحالي." : "No matching data is available in the current search scope.";
      if (intent === "AREA_AGGREGATION") return ar ? `المساحات المتاحة حاليًا من ${Math.min(...values.map(Number))} إلى ${Math.max(...values.map(Number))} م².` : `Available areas currently range from ${Math.min(...values.map(Number))} to ${Math.max(...values.map(Number))} m².`;
      const prices = values.map((item: any) => Number(item.price)).filter(Number.isFinite);
      return ar ? `الأسعار المتاحة حاليًا من ${Math.min(...prices).toLocaleString("en")} إلى ${Math.max(...prices).toLocaleString("en")} EGP.` : `Available prices currently range from EGP ${Math.min(...prices).toLocaleString("en")} to ${Math.max(...prices).toLocaleString("en")}.`;
    }
    if (intent === "VIEWING_REQUEST" && state.externalUnitId) {
      if (facts.length > 1) {
        const codes = (facts as any[]).map((item) => item?.externalUnitId).filter(Boolean).slice(0, 8);
        return ar ? `المرجع **${state.externalUnitId}** بيطابق أكتر من وحدة: ${codes.join("، ")}. اختار الكود الكامل الأول عشان أسجل معاينة للوحدة الصح.` : `The reference ${state.externalUnitId} matches multiple units: ${codes.join(", ")}. Choose the full code before I register a viewing.`;
      }
      return facts.length ? (ar ? `تمام، الوحدة **${state.externalUnitId}** موجودة. لو عاوز نمشي في المعاينة، ابعتلي الاسم اللي تحب فريق المبيعات يناديك بيه ورقم موبايل صحيح للتواصل، وأنا أسجل الطلب على الوحدة دي.` : `Unit **${state.externalUnitId}** is available. If you want to proceed with a viewing, send the name you want the sales team to use and a valid mobile number, and I’ll attach the request to this exact unit.`) : (ar ? `ملقيتش وحدة متاحة بالكود ${state.externalUnitId}.` : `I could not find an available unit with ID ${state.externalUnitId}.`);
    }

    // Broader project/developer explanations still go to Cg Ai after verified facts
    // are compacted. Exact unit identity and payment facts stay deterministic because
    // these are the places where a fluent model must never contradict the database.

    return undefined;
  }

  async prepare(
    conversationId: string,
    rawToken: string,
    content: string,
    requestId = "unknown",
  ): Promise<Prepared> {
    const startedAt = Date.now();
    const { conversation } = await this.conversations.assertOwned(
      conversationId,
      rawToken,
    );
    await this.prisma.message.create({
      data: { conversationId, role: MessageRole.USER, content },
    });
    const [history, existingState] = await Promise.all([
      this.prisma.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      this.prisma.conversationState.findUnique({ where: { conversationId } }),
    ]);
    const messages: AIMessage[] = history.reverse().map((m) => ({
      role: m.role === MessageRole.USER ? "user" : "assistant",
      content: m.content,
    }));
    const previous =
      (existingState?.searchContext as StructuredIntent | null) ?? {
        language: conversation.detectedLanguage ?? "ar-EG",
      };
    const plan = planCustomerTurn(content, previous);
    const extracted = plan.requiresExtraction
      ? await this.ai.extractIntent(messages, previous, { requestId, conversationId })
      : normalizeRealEstateSemantics(content, deterministicIntent(messages, previous), previous);
    const state = applyDeterministicTurnSemantics(content, extracted, previous, plan);
    this.trust.applyConversationPreferences(state, content);
    const trace: Record<string, unknown> = {
      requestId,
      conversationId,
      inputLanguage: state.language,
      extractedIntent: plan.intent,
      aggregationDimension: state.aggregationDimension ?? null,
      previousConversationState: this.safeTraceState(previous),
      newConversationState: this.safeTraceState(state),
      extractionDegraded: Boolean(state.extractionDegraded),
    };
    let properties: any[] = [];
    let payload: MessagePayload = { type: "text", uiActions: [] };
    let verifiedFacts: unknown[] = [];
    let approvedKnowledge: unknown[] = [];
    let contextKind: AIContextKind = "PROPERTY_SEARCH";
    let trustDirectAnswer: string | undefined;
    const priorUnitIds = existingState?.suggestedUnitIds ?? [];
    const priorPresentation = previous.presentation ?? {};

    // Passive trust signals are deliberately conservative. One unclear message is
    // never labelled fake. We only surface a review alert for an invalid phone,
    // an explicit placeholder identity, or repeated nonsense, and the admin makes
    // the final fraud/fake decision.
    const activeHandoff = priorPresentation.leadHandoffStage === "IDENTITY" || priorPresentation.leadHandoffStage === "CONTACT_PREFERENCES";
    const identityClaim = /(?:^|\s)(?:اسمي|انا\s+اسمي|أنا\s+اسمي|my\s+name\s+is|name\s+is)(?:\s|:|-)/iu.test(content);
    const phoneLike = /(?:\+?\d[\d\s().-]{3,}\d)/u.test(content);
    const explicitPhoneCue = /(?:رقمي|رقم\s*(?:الموبايل|التليفون|الهاتف)|موبايل|تليفون|هاتف|phone|mobile|whats?app|واتساب)/iu.test(content);
    const standaloneEgyptianPhone = /^\s*(?:\+?20|0020)?\s*01[0125](?:[\s().-]*\d){8}\s*$/u.test(content);
    const phoneClaim = phoneLike && (explicitPhoneCue || standaloneEgyptianPhone);
    const passiveTrustTrigger = !activeHandoff && !["VIEWING_REQUEST", "CONTACT_REQUEST"].includes(plan.intent) && (plan.intent === "UNKNOWN" || identityClaim || phoneClaim);
    if (passiveTrustTrigger) {
      const passiveAssessment = await this.trust.assessContact({
        conversationId,
        content,
        state,
        contactExpected: identityClaim,
        allowImplicitPhone: identityClaim || phoneClaim,
      });
      if (passiveAssessment.level !== "CONTACT_VALID") {
        await this.trust.recordAlert({ conversationId, assessment: passiveAssessment, content });
        trace.customerTrust = {
          level: passiveAssessment.level,
          score: passiveAssessment.score,
          reasons: passiveAssessment.reasons,
          passive: true,
          learnedFromFeedback: passiveAssessment.learnedFromFeedback,
        };
        if (plan.intent === "UNKNOWN" && passiveAssessment.reasons.some((reason) => ["unclear_input", "repeated_nonsense_input"].includes(reason))) {
          trustDirectAnswer = this.trust.unclearMessage(state.language?.startsWith("ar"));
        }
      }
    }
    const contextualUnitIds = this.contextualUnitIds(previous, priorUnitIds);
    let cacheHits = this.cache.stats().hits;
    let cacheMisses = this.cache.stats().misses;

    let projectId = priorPresentation.selectedProjectId;
    const rawReferencedProject = state.requestedProject ?? this.projectReference(content, plan.intent);
    const referencedProject = rawReferencedProject
      ?.replace(/^(?:المشروع|مشروع|project)\s+/iu, "")
      .replace(/[؟?]+$/u, "")
      .trim();
    if (referencedProject) {
      const matchedProject = await this.search.findProjectByName(referencedProject);
      if (matchedProject?.id) {
        projectId = matchedProject.id;
        state.requestedProject = referencedProject;
        state.presentation = nextPresentation(state.presentation ?? priorPresentation, {
          selectedProjectId: matchedProject.id,
          lastReferencedEntity: { type: "PROJECT", id: matchedProject.id },
        });
      }
    }
    if (!projectId && priorPresentation.selectedUnitId)
      projectId = (await this.prisma.unit.findUnique({ where: { id: priorPresentation.selectedUnitId }, select: { projectId: true } }))?.projectId;
    if (!projectId && priorUnitIds.length) {
      const projectRefs = await this.prisma.unit.findMany({ where: { id: { in: priorUnitIds } }, select: { projectId: true } });
      const uniqueProjectIds = [...new Set(projectRefs.map((item) => item.projectId).filter(Boolean))];
      if (uniqueProjectIds.length === 1) projectId = uniqueProjectIds[0];
    }

    if (plan.intent === "SMALL_TALK") {
      trace.searchOperation = "NONE";
      trace.databaseResultCount = 0;
    } else if (plan.intent === "CONTACT_REQUEST") {
      trace.searchOperation = "NONE";
      trace.databaseResultCount = 0;
    } else if (["VIEWING_REQUEST", "PROPERTY_DETAILS"].includes(plan.intent) && plan.exactUnitId) {
      const unit = await this.search.findUnitByExternalId(plan.exactUnitId);
      trace.searchOperation = "EXACT_UNIT_LOOKUP";
      trace.databaseResultCount = unit ? 1 : 0;
      if (unit) {
        properties = [unit]; verifiedFacts = this.serialize(properties); projectId = unit.projectId;
        state.presentation = nextPresentation(priorPresentation, { selectedUnitId: unit.id, selectedProjectId: unit.projectId, lastReferencedEntity: { type: "UNIT", id: unit.id }, awaitingConfirmation: false });
        if (plan.emitCards) {
          const alreadyShown = (priorPresentation.presentedUnitIds ?? []).includes(unit.id);
          if (!alreadyShown || plan.intent === "VIEWING_REQUEST") {
            payload.uiActions.push({ type: "PROPERTY_CARDS", payload: { properties: [this.cardProperty(unit)] } });
            state.presentation = nextPresentation(state.presentation, { presentedUnitIds: [...new Set([...(priorPresentation.presentedUnitIds ?? []), unit.id])], lastPresentedUnitIds: [unit.id] });
          }
        }
        if (plan.intent === "VIEWING_REQUEST") payload.uiActions.push({ type: "VIEWING_REQUEST", payload: { unitId: unit.id, externalUnitId: unit.externalUnitId } });
      } else {
        const candidates = await this.search.findUnitsByExternalPrefix(plan.exactUnitId, 6);
        if (candidates.length) {
          properties = candidates;
          verifiedFacts = this.serialize(candidates);
          const candidateProjectIds = [...new Set(candidates.map((item: any) => item.projectId).filter(Boolean))];
          if (candidateProjectIds.length === 1) projectId = candidateProjectIds[0];
          state.presentation = nextPresentation(priorPresentation, {
            selectedUnitId: undefined,
            selectedProjectId: projectId,
            searchCandidateIds: candidates.map((item: any) => item.id),
            lastPresentedUnitIds: candidates.map((item: any) => item.id),
            awaitingConfirmation: false,
          });
          payload.uiActions.push({ type: "PROPERTY_CARDS", payload: { properties: candidates.map((item: any) => this.cardProperty(item)) } });
          trace.searchOperation = "UNIT_PREFIX_LOOKUP";
          trace.databaseResultCount = candidates.length;
        }
      }
    } else if (plan.intent === "PROPERTY_DETAILS" && !plan.exactUnitId) {
      const selectedId = priorPresentation.selectedUnitId ?? priorPresentation.lastPresentedUnitIds?.[0] ?? contextualUnitIds[0];
      const unit = selectedId ? await this.search.getProperty(selectedId).catch(() => null) : null;
      trace.searchOperation = "CONTEXT_UNIT_LOOKUP";
      trace.databaseResultCount = unit ? 1 : 0;
      if (unit) {
        properties = [unit]; verifiedFacts = this.serialize(properties); projectId = unit.projectId;
        state.presentation = nextPresentation(priorPresentation, { selectedUnitId: unit.id, selectedProjectId: unit.projectId, lastReferencedEntity: { type: "UNIT", id: unit.id }, awaitingConfirmation: false });
        if (plan.emitCards && !(priorPresentation.presentedUnitIds ?? []).includes(unit.id)) {
          payload.uiActions.push({ type: "PROPERTY_CARDS", payload: { properties: [this.cardProperty(unit)] } });
          state.presentation = nextPresentation(state.presentation, { presentedUnitIds: [...new Set([...(priorPresentation.presentedUnitIds ?? []), unit.id])], lastPresentedUnitIds: [unit.id] });
        }
      }
    } else if (plan.intent === "MEDIA_REQUEST") {
      contextKind = "MEDIA_REQUEST";
      let media: any[] = [];
      let mediaUnitId: string | null = null;
      if (plan.exactUnitId) {
        const unit = await this.search.findUnitByExternalId(plan.exactUnitId);
        if (unit) { media = unit.media ?? []; mediaUnitId = unit.id; projectId = unit.projectId; }
      } else if (this.asksUnitMedia(content)) {
        const selectedId = priorPresentation.selectedUnitId ?? priorPresentation.lastPresentedUnitIds?.[0] ?? contextualUnitIds[0];
        if (selectedId) {
          const unit = await this.search.getProperty(selectedId).catch(() => null);
          if (unit) { media = unit.media ?? []; mediaUnitId = unit.id; projectId = unit.projectId; }
        }
      }
      if (!mediaUnitId) media = projectId ? await this.search.getProjectMedia(projectId) : [];
      verifiedFacts = this.serialize(media);
      trace.searchOperation = mediaUnitId ? "GET_UNIT_MEDIA" : "GET_PROJECT_MEDIA"; trace.databaseResultCount = media.length;
      payload.uiActions.push({ type: "PROJECT_PHOTOS", payload: { projectId: projectId ?? null, unitId: mediaUnitId, media: this.serialize(media), scope: mediaUnitId ? "UNIT" : "PROJECT" } });
    } else if (plan.intent === "BROCHURE_REQUEST" || plan.executeBrochure) {
      contextKind = "BROCHURE_REQUEST";
      const documents = projectId ? await this.search.getProjectDocuments(projectId, DocumentType.BROCHURE) : [];
      verifiedFacts = this.serialize(documents);
      trace.searchOperation = "GET_PROJECT_BROCHURE"; trace.databaseResultCount = documents.length;
      if (plan.executeBrochure) payload.uiActions.push({ type: "PROJECT_BROCHURE", payload: { projectId: projectId ?? null, documents: this.serialize(documents) } });
      else state.presentation = nextPresentation(priorPresentation, { lastOfferedAction: "PROJECT_BROCHURE", awaitingConfirmation: Boolean(documents.length), selectedProjectId: projectId });
    } else if (plan.intent === "LOCATION_REQUEST") {
      contextKind = "PROJECT_DETAILS";
      const project = projectId ? await this.search.getProject(projectId) : null;
      const latitude = project?.latitude ?? project?.location?.latitude ?? null;
      const longitude = project?.longitude ?? project?.location?.longitude ?? null;
      const map = latitude != null && longitude != null ? { projectId, latitude, longitude, label: project?.name, url: `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}` } : null;
      verifiedFacts = map ? [this.serialize(map)] : [];
      trace.searchOperation = "GET_PROJECT_LOCATION"; trace.databaseResultCount = map ? 1 : 0;
      payload.uiActions.push({ type: "PROJECT_LOCATION", payload: { map } });
    } else if (plan.intent === "DISTANCE_REQUEST") {
      // The distance tool executes below after resolving contextual endpoints.
    } else if (plan.intent === "PROJECT_DETAILS") {
      if (projectId) {
        contextKind = "PROJECT_DETAILS";
        const project = await this.search.getProject(projectId).catch(() => null);
        verifiedFacts = project ? [this.serialize(project)] : [];
        approvedKnowledge = project?.knowledgeItems ?? [];
        trace.searchOperation = "GET_CONTEXT_PROJECT";
        trace.databaseResultCount = project ? 1 : 0;
      } else {
        contextKind = "PROPERTY_SEARCH";
        const units = await this.search.getUnitsByIds(contextualUnitIds.slice(0, 5));
        verifiedFacts = this.serialize(units);
        trace.searchOperation = "GET_CONTEXT_PROJECTS_FROM_UNITS";
        trace.databaseResultCount = units.length;
      }
    } else if (["INVESTMENT", "RESALE", "RENTAL"].includes(plan.intent) && projectId) {
      contextKind = plan.intent as AIContextKind;
      const project = await this.search.getProject(projectId).catch(() => null);
      verifiedFacts = project ? [this.serialize(project)] : [];
      approvedKnowledge = project?.knowledgeItems ?? [];
      if (project) state.presentation = nextPresentation(priorPresentation, { selectedProjectId: project.id, lastReferencedEntity: { type: "PROJECT", id: project.id } });
      trace.searchOperation = `GET_CONTEXT_PROJECT_${plan.intent}`;
      trace.databaseResultCount = project ? 1 : 0;
    } else if (plan.intent === "COMPARISON" && projectId) {
      contextKind = "PROJECT_DETAILS";
      const project = await this.search.getProject(projectId).catch(() => null);
      if (project) {
        const competitorIds = (project.competitorsFrom ?? []).map((row: any) => row.competitorProject?.id).filter(Boolean).slice(0, 6);
        const competitors = (await Promise.all(competitorIds.map((id: string) => this.search.getProject(id).catch(() => null)))).filter(Boolean);
        verifiedFacts = this.serialize([project, ...competitors]);
        approvedKnowledge = project.knowledgeItems ?? [];
        state.presentation = nextPresentation(priorPresentation, { selectedProjectId: project.id, lastReferencedEntity: { type: "PROJECT", id: project.id } });
        trace.searchOperation = "GET_PROJECT_AND_REGISTERED_COMPETITORS";
        trace.databaseResultCount = 1 + competitors.length;
      } else {
        trace.searchOperation = "GET_PROJECT_AND_REGISTERED_COMPETITORS";
        trace.databaseResultCount = 0;
      }
    } else if (plan.intent === "DEVELOPER_DETAILS") {
      const asksDeveloperList = /(?:مطورين|المطورين|developers?)/iu.test(content) && /(?:تعرف|عندك|ايه|اي|what|available|موجود|متاح)/iu.test(content);
      if (asksDeveloperList) {
        contextKind = "AGGREGATION";
        const aggregateState: StructuredIntent = { ...state, temporaryIntent: "INVENTORY_AGGREGATION", aggregationDimension: "DEVELOPER" };
        const aggregate = await this.search.aggregateInventory(aggregateState);
        verifiedFacts = [this.serialize(aggregate)];
        trace.searchOperation = "AGGREGATE_DEVELOPER";
        trace.databaseResultCount = aggregate.count;
      } else if (contextualUnitIds.length) {
        contextKind = "PROPERTY_SEARCH";
        const units = await this.search.getUnitsByIds(contextualUnitIds.slice(0, 5));
        verifiedFacts = this.serialize(units);
        trace.searchOperation = "GET_CONTEXT_DEVELOPERS_FROM_UNITS";
        trace.databaseResultCount = units.length;
      } else if (projectId) {
        contextKind = "PROJECT_DETAILS";
        const project = await this.search.getProject(projectId).catch(() => null);
        verifiedFacts = project ? [this.serialize(project)] : [];
        trace.searchOperation = "GET_CONTEXT_PROJECT_DEVELOPER";
        trace.databaseResultCount = project ? 1 : 0;
      } else if (state.preferredDevelopers?.length === 1) {
        contextKind = "DEVELOPER_HISTORY";
        const developerName = state.preferredDevelopers[0];
        const developer = await this.prisma.developer.findFirst({ where: { OR: [{ name: { contains: developerName, mode: "insensitive" } }, { canonicalName: { contains: developerName, mode: "insensitive" } }, { nameAr: { contains: developerName, mode: "insensitive" } }, { nameEn: { contains: developerName, mode: "insensitive" } }] }, select: { id: true } });
        if (developer) verifiedFacts = [this.serialize(await this.search.getDeveloper(developer.id))];
        trace.searchOperation = "GET_DEVELOPER_STRUCTURED_FACTS";
        trace.databaseResultCount = developer ? 1 : 0;
      } else {
        trace.searchOperation = "GET_CONTEXT_DEVELOPER";
        trace.databaseResultCount = 0;
      }
    } else if (plan.intent === "PAYMENT_PLAN") {
      contextKind = "PROPERTY_SEARCH";
      let units: any[] = [];
      if (plan.exactUnitId) {
        const unit = await this.search.findUnitByExternalId(plan.exactUnitId);
        if (unit) units = [unit];
      } else {
        const ids = (priorPresentation.selectedUnitId
          ? [priorPresentation.selectedUnitId]
          : priorPresentation.lastPresentedUnitIds?.length
            ? priorPresentation.lastPresentedUnitIds
            : contextualUnitIds).slice(0, 8);
        units = await this.search.getUnitsByIds(ids);
        // When the customer says something like "الشقة 155 لو كاش", keep the
        // conversational candidates but resolve the concrete area before choosing
        // which unit's inherited payment plan to explain.
        const targetArea = state.targetBuiltUpArea ?? state.builtUpAreaMin ?? state.minimumArea;
        if (!priorPresentation.selectedUnitId && targetArea != null) {
          units = [...units].sort((a: any, b: any) => {
            const aArea = a?.builtUpArea == null ? Number.POSITIVE_INFINITY : Math.abs(Number(a.builtUpArea) - Number(targetArea));
            const bArea = b?.builtUpArea == null ? Number.POSITIVE_INFINITY : Math.abs(Number(b.builtUpArea) - Number(targetArea));
            return aArea - bArea;
          });
        }
      }
      properties = units;
      verifiedFacts = this.serialize(units);
      if (units.length === 1) {
        projectId = units[0].projectId;
        state.presentation = nextPresentation(priorPresentation, { selectedUnitId: units[0].id, selectedProjectId: units[0].projectId, lastReferencedEntity: { type: "UNIT", id: units[0].id } });
      }
      trace.searchOperation = "GET_PAYMENT_PLANS";
      trace.databaseResultCount = units.reduce((count, unit) => count + (unit.paymentPlans?.length ?? 0), 0);
    } else if (state.preferredDevelopers?.length === 1 && /(?:المطور|سابقة|سلم|تاريخ|developer|track\s*record|portfolio)/iu.test(content)) {
      contextKind = "DEVELOPER_HISTORY";
      const developerName = state.preferredDevelopers[0];
      const developer = await this.prisma.developer.findFirst({ where: { OR: [{ name: { contains: developerName, mode: "insensitive" } }, { canonicalName: { contains: developerName, mode: "insensitive" } }, { nameAr: { contains: developerName, mode: "insensitive" } }, { nameEn: { contains: developerName, mode: "insensitive" } }] }, select: { id: true } });
      if (developer) verifiedFacts = [this.serialize(await this.search.getDeveloper(developer.id))];
      trace.searchOperation = "GET_DEVELOPER_STRUCTURED_FACTS";
      trace.databaseResultCount = developer ? 1 : 0;
    } else if (state.requestedProject && /(?:المشروع|project|تفاصيل|details|استثمار|investment|resale|rental|amenities|facilities)/iu.test(content)) {
      contextKind = /(?:إعادة\s*البيع|اعادة\s*البيع|resale)/iu.test(content) ? "RESALE" : /(?:إيجار|ايجار|rental|yield)/iu.test(content) ? "RENTAL" : /(?:استثمار|investment|عائد)/iu.test(content) ? "INVESTMENT" : /(?:خدمات|مرافق|amenities|facilities)/iu.test(content) ? "AMENITIES" : "PROJECT_DETAILS";
      const match = await this.search.findProjectByName(state.requestedProject);
      if (match) {
        const project = await this.search.getProject(match.id);
        verifiedFacts = [this.serialize(project)];
        approvedKnowledge = project.knowledgeItems;
        trace.searchOperation = "GET_PROJECT_STRUCTURED_FACTS";
        trace.databaseResultCount = 1;
      } else {
        trace.searchOperation = "GET_PROJECT_STRUCTURED_FACTS";
        trace.databaseResultCount = 0;
      }
    } else if (state.temporaryIntent === "INVENTORY_AGGREGATION" && state.aggregationDimension) {
      contextKind = "AGGREGATION";
      const aggregate = await this.search.aggregateInventory(state);
      verifiedFacts = [this.serialize(aggregate)];
      trace.searchOperation = `AGGREGATE_${state.aggregationDimension}`;
      trace.databaseResultCount = aggregate.count;
      trace.aggregateQuery = { dimension: state.aggregationDimension };
    } else {
      const searchState = plan.widenSearch ? { ...state, requestedProject: undefined, preferredProjects: undefined } : state;
      properties = await this.search.searchProperties(searchState);
      verifiedFacts = this.serialize(properties);
      const originIds = await this.search.resolveLocations(state.locations);
      if (originIds.length) {
        const distances = await this.search.findNearbyLocations(
          originIds,
          state.maxTravelMinutes,
        );
        verifiedFacts = [...verifiedFacts, ...this.serialize(distances)];
      }
      const candidateIds = properties.map((property) => property.id);
      const candidateProjectIds = [...new Set(properties.map((property) => property.projectId).filter(Boolean))];
      const contextualProjectId = projectId ?? (candidateProjectIds.length === 1 ? candidateProjectIds[0] : undefined);
      state.presentation = nextPresentation(priorPresentation, { searchCandidateIds: candidateIds, selectedProjectId: contextualProjectId, lastOfferedAction: properties.length && !plan.emitCards ? "PROPERTY_CARDS" : !properties.length ? "SEARCH_WIDEN" : priorPresentation.lastOfferedAction, awaitingConfirmation: Boolean((properties.length && !plan.emitCards) || !properties.length) });
      if (plan.emitCards) {
        const unseenIds = new Set(unpresentedUnitIds(properties.map((property) => property.id), priorPresentation.presentedUnitIds));
        const unseen = properties.filter((property) => unseenIds.has(property.id));
        const cards = unseen.slice(0, 5);
        if (cards.length) {
          payload.uiActions.push({ type: "PROPERTY_CARDS", payload: { properties: cards.map((item) => this.cardProperty(item)) } });
          state.presentation = nextPresentation(state.presentation, { presentedUnitIds: [...new Set([...(priorPresentation.presentedUnitIds ?? []), ...cards.map((item) => item.id)])], lastPresentedUnitIds: cards.map((item) => item.id), awaitingConfirmation: false });
        } else state.presentation = nextPresentation(state.presentation, { awaitingConfirmation: false });
      }
    }
    trace.normalizedSearchFilters = await this.search.normalizedSearchFilters(state);
    trace.searchOperation ??= "SEARCH_PROPERTIES";
    trace.databaseResultCount ??= properties.length;

    if (plan.intent === "DISTANCE_REQUEST" || (state.exactRouteRequested && state.routeOrigin && state.routeDestination)) {
      const selectedProject = projectId ? await this.search.getProject(projectId).catch(() => null) : null;
      const originText = state.routeOrigin || selectedProject?.nameAr || selectedProject?.nameEn || selectedProject?.name || selectedProject?.location?.name;
      const destinationText = state.routeDestination || this.distanceDestination(content);
      const destinationTerms = /\bAUC\b|الجامعه\s+الامريكيه|الجامعة\s+الأمريكية/iu.test(content) ? [destinationText!, "AUC", "الجامعة الأمريكية"] : destinationText ? [destinationText] : [];
      const [origins, destinations] = await Promise.all([
        selectedProject?.locationId ? Promise.resolve([selectedProject.locationId]) : this.search.resolveLocations(originText ? [originText] : []),
        this.search.resolveLocations(destinationTerms),
      ]);
      const stored = origins.length && destinations.length
        ? await this.prisma.locationDistance.findFirst({
            where: { OR: [
              { fromLocationId: { in: origins }, toLocationId: { in: destinations }, verifiedAt: { not: null } },
              { fromLocationId: { in: destinations }, toLocationId: { in: origins }, verifiedAt: { not: null } },
            ] },
            include: { from: true, to: true },
          })
        : null;

      let originPoint: { latitude:number; longitude:number } | null = null;
      if (selectedProject) {
        const latitude = Number(selectedProject.latitude ?? selectedProject.location?.latitude);
        const longitude = Number(selectedProject.longitude ?? selectedProject.location?.longitude);
        if (Number.isFinite(latitude) && Number.isFinite(longitude)) originPoint = { latitude, longitude };
      } else if (origins.length) {
        const location = await this.prisma.location.findFirst({ where: { id: { in: origins }, latitude: { not: null }, longitude: { not: null } }, select: { latitude: true, longitude: true } });
        const latitude = Number(location?.latitude), longitude = Number(location?.longitude);
        if (Number.isFinite(latitude) && Number.isFinite(longitude)) originPoint = { latitude, longitude };
      }

      let route: Record<string, unknown>;
      if (stored) {
        route = {
          source: stored.distanceType === "GOOGLE_ROUTES" ? "GOOGLE_ROUTES" : "ADMIN_VERIFIED",
          distanceKm: Number(stored.distanceKm),
          estimatedMinutes: stored.estimatedMinutes,
          from: stored.from.name,
          to: stored.to.name,
          notes: stored.notes,
        };
      } else if (originPoint && destinationText && process.env.GOOGLE_MAPS_SERVER_API_KEY) {
        const destinationPlace = await this.maps.firstPlace(destinationText).catch(() => null);
        const liveRoute = destinationPlace
          ? await this.maps.routePoints(originPoint, { latitude: destinationPlace.latitude, longitude: destinationPlace.longitude }).catch(() => null)
          : null;
        route = liveRoute && destinationPlace
          ? {
              source: "GOOGLE_ROUTES",
              ...liveRoute,
              from: originText ?? "المشروع",
              to: destinationPlace.name,
              destinationName: destinationPlace.name,
              destinationAddress: destinationPlace.formattedAddress,
            }
          : { source: "UNAVAILABLE", reason: "ROUTE_DATA_UNAVAILABLE" };
      } else {
        route = { source: "UNAVAILABLE", reason: originPoint ? "DESTINATION_UNRESOLVED" : "PROJECT_COORDINATES_MISSING" };
      }
      contextKind = "DISTANCE";
      verifiedFacts = [this.serialize(route)];
      payload.uiActions.push({ type: "DISTANCE_RESULT", payload: { route: this.serialize(route), origin: originText ?? null, destination: destinationText ?? null } });
      trace.searchOperation = stored ? "GET_VERIFIED_DISTANCE" : "GOOGLE_ROUTES";
      trace.databaseResultCount = stored ? 1 : 0;
    }

    const unitIds = properties.map((p) => p.id);
    const priorHandoffStage = priorPresentation.leadHandoffStage;
    const leadIntentTurn = ["VIEWING_REQUEST", "CONTACT_REQUEST"].includes(plan.intent);
    const shouldHandleLead = leadIntentTurn || priorHandoffStage === "IDENTITY" || priorHandoffStage === "CONTACT_PREFERENCES";
    let existingLead = shouldHandleLead
      ? await this.prisma.lead.findFirst({
          where: { conversationId, status: { notIn: [LeadStatus.WON, LeadStatus.LOST] } },
          orderBy: { createdAt: "desc" },
        })
      : null;

    if (existingLead) {
      state.contactName ||= existingLead.name;
      state.contactPhone ||= existingLead.phone;
      state.preferredContactChannel ||= (existingLead.preferredContactChannel as StructuredIntent["preferredContactChannel"]) ?? undefined;
      state.preferredConfirmationChannel ||= (existingLead.preferredConfirmationChannel as StructuredIntent["preferredConfirmationChannel"]) ?? undefined;
      state.preferredVisitDayPart ||= (existingLead.preferredVisitDayPart as StructuredIntent["preferredVisitDayPart"]) ?? undefined;
      state.preferredVisitTiming ||= (existingLead.preferredVisitTiming as StructuredIntent["preferredVisitTiming"]) ?? undefined;
    }

    const contactCandidateInTurn = Boolean(
      state.contactName && state.contactName !== previous.contactName ||
      state.contactPhone && state.contactPhone !== previous.contactPhone ||
      /(?:\+?\d[\d\s().-]{3,}\d)/u.test(content),
    );

    if (shouldHandleLead && (!existingLead || contactCandidateInTurn)) {
      const assessment = await this.trust.assessContact({
        conversationId,
        content,
        state,
        contactExpected: true,
      });
      trace.customerTrust = { level: assessment.level, score: assessment.score, reasons: assessment.reasons, learnedFromFeedback: assessment.learnedFromFeedback };
      if (assessment.candidateName) state.contactName = assessment.candidateName;
      if (assessment.normalizedPhone) state.contactPhone = assessment.normalizedPhone;
      if (assessment.preferredContactChannel) state.preferredContactChannel = assessment.preferredContactChannel;
      if (assessment.preferredConfirmationChannel) state.preferredConfirmationChannel = assessment.preferredConfirmationChannel;
      if (assessment.preferredVisitDayPart) state.preferredVisitDayPart = assessment.preferredVisitDayPart;
      if (assessment.preferredVisitTiming) state.preferredVisitTiming = assessment.preferredVisitTiming;

      if (!assessment.canCreateLead) {
        await this.trust.recordAlert({ conversationId, leadId: existingLead?.id, assessment, content });
        // Do not let an invalid candidate replace a previously valid lead contact.
        if (!existingLead) {
          if (!assessment.normalizedPhone) delete state.contactPhone;
          if (assessment.reasons.some((reason) => ["placeholder_name", "unit_code_as_name", "implausible_name", "repeated_name_token", "missing_name"].includes(reason))) delete state.contactName;
        } else {
          state.contactName = existingLead.name;
          state.contactPhone = existingLead.phone;
        }
        state.presentation = nextPresentation(state.presentation ?? priorPresentation, {
          lastOfferedAction: "CONTACT_REQUEST",
          awaitingConfirmation: true,
          leadHandoffStage: "IDENTITY",
        });
        payload.type = "lead_prompt";
        payload.uiActions.push({ type: "CONTACT_REQUEST", payload: { stage: "VERIFY_CONTACT", trustLevel: assessment.level, reasons: assessment.reasons } });
        trustDirectAnswer = this.trust.customerCorrectionMessage(assessment, state.language?.startsWith("ar"));
      }
    }

    if (shouldHandleLead && !existingLead && !trustDirectAnswer && (state.purchaseIntent ?? 0) >= 80 && (!state.contactPhone || !state.contactName) && (plan.intent !== "VIEWING_REQUEST" || Boolean(state.presentation?.selectedUnitId))) {
      payload.type = "lead_prompt";
      state.presentation = nextPresentation(state.presentation ?? priorPresentation, {
        lastOfferedAction: "CONTACT_REQUEST",
        awaitingConfirmation: true,
        leadHandoffStage: "IDENTITY",
      });
      payload.uiActions.push({ type: "CONTACT_REQUEST", payload: { reason: plan.intent, stage: "IDENTITY" } });
    }

    if (shouldHandleLead && !trustDirectAnswer && state.contactPhone && state.contactName) {
      const contactPhone = state.contactPhone;
      const contactName = state.contactName;
      const persistence = leadPersistenceAction(existingLead?.id, contactPhone, state.purchaseIntent ?? 0);
      if (persistence === "none")
        return this.finishPreparation(
          conversationId,
          conversation.detectedLanguage,
          state,
          payload,
          messages,
          properties,
          verifiedFacts,
          approvedKnowledge,
          existingState?.summary,
          contextKind,
          trustDirectAnswer ?? plan.deterministicResponse,
          trace,
          startedAt,
        );
      const existingPayload = existingLead?.payload && typeof existingLead.payload === "object" && !Array.isArray(existingLead.payload)
        ? existingLead.payload as Record<string, any>
        : {};
      const existingExplicitUnits = Array.isArray(existingPayload.explicitInterestedUnits)
        ? existingPayload.explicitInterestedUnits.filter((id: unknown): id is string => typeof id === "string")
        : [];
      const selectedNow = [
        state.presentation?.selectedUnitId,
        plan.exactUnitId && properties[0]?.id ? properties[0].id : undefined,
      ].filter((id): id is string => Boolean(id));
      const explicitInterestedUnits = [...new Set([...existingExplicitUnits, ...selectedNow])];
      const fallbackInterest = !explicitInterestedUnits.length
        ? (state.presentation?.lastPresentedUnitIds?.length ? state.presentation.lastPresentedUnitIds.slice(0, 1) : unitIds.slice(0, 1))
        : [];
      const interestedUnits = [...new Set([...explicitInterestedUnits, ...fallbackInterest])];
      const unitProjects = interestedUnits.length
        ? (await this.prisma.unit.findMany({ where: { id: { in: interestedUnits } }, select: { projectId: true } })).map((item) => item.projectId)
        : [];
      const interestedProjects = [...new Set([
        ...unitProjects,
        ...(state.presentation?.selectedProjectId ? [state.presentation.selectedProjectId] : []),
      ])];
      const conversationSummary = {
        customerGoal: state.purpose,
        budget: { min: state.budgetMin, max: state.budgetMax, currency: state.currency },
        preferredLocations: state.locations ?? [],
        propertyTypes: state.propertyTypes ?? [],
        bedrooms: state.bedrooms,
        bathrooms: state.bathrooms,
        preferredPhase: state.preferredPhase,
        preferredBuilding: state.preferredBuilding,
        preferredPaymentDurationMonths: state.preferredPaymentDurationMonths,
        maxDownPayment: state.maxDownPayment,
        hardRequirements: state.hardRequirements ?? [],
        softPreferences: state.softPreferences ?? [],
        intentScore: state.purchaseIntent ?? 80,
        selectedUnitCode: state.externalUnitId ?? null,
        preferredContactChannel: state.preferredContactChannel ?? null,
        preferredConfirmationChannel: state.preferredConfirmationChannel ?? null,
        preferredVisitDayPart: state.preferredVisitDayPart ?? null,
        preferredVisitTiming: state.preferredVisitTiming ?? null,
      };
      const leadPayload = this.serialize({
        requirements: state,
        explicitInterestedUnits,
        interestedUnits,
        interestedProjects,
        conversationSummary,
        trust: existingLead?.trustStatus === "ADMIN_CONFIRMED_REAL" || existingLead?.trustStatus === "ADMIN_CONFIRMED_FAKE"
          ? { status: existingLead.trustStatus, score: existingLead.trustScore, reasons: existingLead.trustReasons }
          : { status: "CONTACT_VALID", score: 100, reasons: [] },
      });
      const adminLockedTrust = existingLead?.trustStatus === "ADMIN_CONFIRMED_REAL" || existingLead?.trustStatus === "ADMIN_CONFIRMED_FAKE";
      const commonLeadData = {
        name: contactName,
        phone: contactPhone,
        intentScore: state.purchaseIntent ?? 80,
        payload: leadPayload,
        trustStatus: adminLockedTrust ? existingLead!.trustStatus : "CONTACT_VALID",
        trustScore: adminLockedTrust ? existingLead!.trustScore : 100,
        trustReasons: adminLockedTrust ? existingLead!.trustReasons : [] as string[],
        preferredContactChannel: state.preferredContactChannel ?? null,
        preferredConfirmationChannel: state.preferredConfirmationChannel ?? null,
        preferredVisitDayPart: state.preferredVisitDayPart ?? null,
        preferredVisitTiming: state.preferredVisitTiming ?? null,
        contactValidatedAt: new Date(),
      };
      const lead = persistence === "update" && existingLead
        ? await this.prisma.lead.update({
            where: { id: existingLead.id },
            data: {
              ...commonLeadData,
              events: { create: { type: "LEAD_UPDATED", payload: { channel: "WEB", handoff: true } } },
            },
          })
        : await this.prisma.lead.create({
            data: {
              conversationId,
              ...commonLeadData,
              intent: "PURCHASE",
              source: "WEB_AI",
              events: { create: { type: "LEAD_CREATED", payload: { channel: "WEB", handoff: true } } },
            },
          });
      existingLead = lead;
      await this.trust.resolveOpenAlerts(conversationId, lead.id);

      const needsContactChannel = !state.preferredContactChannel;
      const needsConfirmationChannel = !state.preferredConfirmationChannel;
      const nextHandoffStage = needsContactChannel || needsConfirmationChannel ? "CONTACT_PREFERENCES" : "COMPLETE";
      state.presentation = nextPresentation(state.presentation ?? priorPresentation, {
        lastOfferedAction: nextHandoffStage === "COMPLETE" ? undefined : "CONTACT_REQUEST",
        awaitingConfirmation: nextHandoffStage !== "COMPLETE",
        leadHandoffStage: nextHandoffStage,
      });
      await this.prisma.conversationState.upsert({
        where: { conversationId },
        create: {
          conversationId,
          searchContext: this.serialize(state),
          suggestedUnitIds: interestedUnits.length ? interestedUnits : priorUnitIds,
          rejectedUnitIds: [],
          likedUnitIds: [],
          intentScore: state.purchaseIntent ?? 80,
          summary: this.serialize(conversationSummary),
        },
        update: { searchContext: this.serialize(state), summary: this.serialize(conversationSummary) },
      });
      payload = {
        type: "lead_created",
        leadId: lead.id,
        uiActions: nextHandoffStage === "CONTACT_PREFERENCES"
          ? [{ type: "CONTACT_REQUEST", payload: { stage: "CONTACT_PREFERENCES", needsContactChannel, needsConfirmationChannel } }]
          : [],
      };
    }

    const cacheAfter = this.cache.stats();
    trace.action = plan.intent;
    trace.requiresDatabase = plan.requiresDatabase;
    trace.requiresGroq = true;
    trace.uiActionTypes = payload.uiActions.map((action) => action.type);
    trace.cardsEmitted = payload.uiActions.filter((action) => action.type === "PROPERTY_CARDS").reduce((count, action) => count + ((action.payload.properties as unknown[] | undefined)?.length ?? 0), 0);
    trace.cacheHits = cacheAfter.hits - cacheHits;
    trace.cacheMisses = cacheAfter.misses - cacheMisses;

    return this.finishPreparation(
      conversationId,
      conversation.detectedLanguage,
      state,
      payload,
      messages,
      properties,
      verifiedFacts,
      approvedKnowledge,
      existingState?.summary,
      contextKind,
      trustDirectAnswer ?? plan.deterministicResponse,
      trace,
      startedAt,
    );
  }

  private async finishPreparation(
    conversationId: string,
    previousLanguage: string | null,
    state: StructuredIntent,
    payload: MessagePayload,
    messages: AIMessage[],
    properties: any[],
    verifiedFacts: unknown[],
    approvedKnowledge: unknown[],
    conversationSummary: unknown,
    contextKind: AIContextKind,
    deterministicResponse: string | undefined,
    trace: Record<string, unknown>,
    startedAt: number,
  ): Promise<Prepared> {
    const unitIds = properties.map((property) => property.id);
    await this.prisma.$transaction([
      this.prisma.conversation.update({
        where: { id: conversationId },
        data: {
          detectedLanguage: state.language || previousLanguage,
          updatedAt: new Date(),
        },
      }),
      this.prisma.conversationState.upsert({
        where: { conversationId },
        create: {
          conversationId,
          searchContext: this.serialize(state),
          suggestedUnitIds: unitIds,
          rejectedUnitIds: [],
          likedUnitIds: [],
          intentScore: state.purchaseIntent ?? 0,
        },
        update: {
          searchContext: this.serialize(state),
          suggestedUnitIds: unitIds.length ? unitIds : undefined,
          intentScore: state.purchaseIntent ?? 0,
        },
      }),
    ]);
    const answerInput = compactAnswerInput({
      messages,
      intent: state,
      verifiedFacts,
      approvedKnowledge,
      conversationSummary,
      contextKind,
      candidatesBeforeRanking: properties.length || verifiedFacts.length,
      requestId: String(trace.requestId ?? "unknown"),
      conversationId,
    });
    const contextMetrics = answerContextMetrics(answerInput);
    const directAnswer = deterministicResponse ?? this.directToolAnswer(state, payload, verifiedFacts);
    trace.requiresGroq = !directAnswer;
    this.logger.log(`AIContextTrace ${JSON.stringify({requestId:answerInput.requestId,conversationId,intent:contextKind,candidatesBeforeRanking:properties.length||verifiedFacts.length,candidatesSent:contextMetrics.resultCount,historyMessagesSent:contextMetrics.recentHistoryCount,contextBytes:contextMetrics.contextBytes,estimatedTokens:contextMetrics.estimatedInputTokens})}`);
    return {
      conversationId,
      answerInput,
      state,
      payload,
      userMessages: messages,
      unitIds,
      trace: { ...trace, latencyMs: Date.now() - startedAt },
      directAnswer,
    };
  }

  async send(conversationId: string, rawToken: string, content: string, requestId = "unknown") {
    const prepared = await this.prepare(conversationId, rawToken, content, requestId);
    const rawAnswer = prepared.directAnswer ?? await this.ai.composeAnswer(prepared.answerInput);
    let answer = this.sanitizeCustomerAnswer(rawAnswer, prepared.state.language);
    if (!prepared.directAnswer && this.hasGroundingContradiction(answer, prepared.answerInput.verifiedFacts)) {
      this.logger.warn(`AIGroundingContradiction ${JSON.stringify({ requestId, conversationId, intent: prepared.state.turnIntent })}`);
      answer = this.groundedFallback(prepared.state, prepared.answerInput.verifiedFacts);
    }
    const message = await this.persistAssistant(prepared, answer);
    this.logTrace(prepared, { finalResponseProvider: "HYBRID", completed: true });
    return { message, state: prepared.state, ...prepared.payload };
  }

  async *stream(conversationId: string, rawToken: string, content: string, requestId = "unknown") {
    const prepared = await this.prepare(conversationId, rawToken, content, requestId);
    let answer = "";
    try {
      if (prepared.directAnswer) answer = prepared.directAnswer;
      else for await (const chunk of this.ai.streamAnswer(prepared.answerInput)) answer += chunk;
      if (!answer.trim()) throw new Error("AI_EMPTY_CUSTOMER_RESPONSE");
      answer = this.sanitizeCustomerAnswer(answer, prepared.state.language);
      if (!prepared.directAnswer && this.hasGroundingContradiction(answer, prepared.answerInput.verifiedFacts)) {
        this.logger.warn(`AIGroundingContradiction ${JSON.stringify({ requestId, conversationId, intent: prepared.state.turnIntent })}`);
        answer = this.groundedFallback(prepared.state, prepared.answerInput.verifiedFacts);
      }
      for (let offset = 0; offset < answer.length; offset += 180) yield { event: "token", data: { text: answer.slice(offset, offset + 180) } };
      const message = await this.persistAssistant(prepared, answer);
      this.logTrace(prepared, { finalResponseProvider: "HYBRID_STREAM", completed: true });
      yield { event: "complete", data: { message, state: prepared.state, ...prepared.payload } };
    } catch (error) {
      this.logTrace(prepared, { finalResponseProvider: "HYBRID_STREAM", completed: false, errorCategory: this.errorCategory(error) });
      throw error;
    }
  }

  private sanitizeCustomerAnswer(answer: string, language?: string) {
    const fallback = language?.startsWith("ar") ? "المعلومة الداخلية دي غير مخصصة للعرض، لكن أقدر أوضح لك البيانات المتاحة باسم المشروع أو الوحدة." : "That internal identifier is not meant for display; I can provide the available information using the project or unit name.";
    // Customer links are delivered by verified UI actions. Free-form model text never gets
    // to construct a route, brochure, media, or external URL on its own.
    let safe = answer.replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/giu, "$1");
    safe = safe.replace(/https?:\/\/[^\s)>]+/giu, "");
    safe = safe.replace(/\bc[a-z0-9]{20,}\b/giu, language?.startsWith("ar") ? "المشروع" : "the project");
    safe = safe.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu, language?.startsWith("ar") ? "العنصر" : "the item");
    safe = safe.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    return safe || fallback;
  }

  private safeTraceState(state: StructuredIntent) {
    const { contactName: _contactName, contactPhone: _contactPhone, ...safe } = state;
    return safe;
  }
  private errorCategory(error: unknown) {
    const response = typeof (error as any)?.getResponse === "function" ? (error as any).getResponse() : undefined;
    return response?.category ?? response?.code ?? (error as any)?.code ?? "UNKNOWN";
  }
  private logTrace(prepared: Prepared, completion: Record<string, unknown>) {
    this.logger.log(`CustomerTurnTrace ${JSON.stringify({ ...prepared.trace, ...completion })}`);
  }

  private persistAssistant(prepared: Prepared, answer: string) {
    return this.prisma.message.create({
      data: {
        conversationId: prepared.conversationId,
        role: MessageRole.ASSISTANT,
        content: answer,
        toolPayload: this.serialize(prepared.payload) as Prisma.InputJsonValue,
      },
    });
  }
}
