import { Injectable } from "@nestjs/common";
import { StructuredIntent } from "../providers/ai-provider";
import { UIAction } from "../customer-turn-planner";
import { ConversationFormatterService } from "./conversation-formatter.service";
import { PropertyPresenterService } from "./property-presenter.service";
import { PaymentPresenterService } from "./payment-presenter.service";

type MessagePayload = {
  type:
    | "text"
    | "properties"
    | "media"
    | "documents"
    | "map"
    | "lead_prompt"
    | "lead_created"
    | "conversation_closed";
  properties?: unknown[];
  media?: unknown[];
  documents?: unknown[];
  map?: unknown;
  leadId?: string;
  uiActions: UIAction[];
};

/**
 * Generates deterministic (non-AI) answers for specific intents.
 * Extracted from ChatService for clarity and testability.
 */
@Injectable()
export class DeterministicAnswerService {
  constructor(
    private readonly formatter: ConversationFormatterService,
    private readonly propertyPresenter: PropertyPresenterService,
    private readonly paymentPresenter: PaymentPresenterService,
  ) {}

  asksUnitMedia(content: string): boolean {
    return /(?:صور|photos?|images?).*(?:الوحده|الوحدة|unit)|(?:الوحده|الوحدة|unit).*(?:صور|photos?|images?)/iu.test(content);
  }

  distanceDestination(content: string): string | undefined {
    if (/\bAUC\b|الجامعه\s+الامريكيه|الجامعة\s+الأمريكية/iu.test(content)) return "American University in Cairo, New Cairo";
    const match = content.match(/(?:وبين|الى|إلى|to)\s+(.+?)(?:\s+(?:كام|قد ايه|how far)|[؟?]|$)/iu);
    return match?.[1]?.trim();
  }

  projectReference(content: string, intent?: string): string | undefined {
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

  directToolAnswer(state: StructuredIntent, payload: MessagePayload, facts: unknown[], content?: string): string | undefined {
    const ar = state.language?.startsWith("ar");
    const intent = state.turnIntent;
    const first = facts[0] as any;

    if (payload.type === "conversation_closed") {
      return ar
        ? "أنا **Cg**، ودوري هنا استشارات العقارات فقط. الطلب الأخير خرج برا نطاق العقارات، فهقفل المحادثة هنا عشان ما أديكش ردود مالهاش علاقة بخدمتي."
        : "I'm **Cg**, and this chat is limited to real-estate guidance. The last request moved outside that scope, so I'm closing this conversation rather than giving you an unrelated answer.";
    }

    if (intent === "PROPERTY_DETAILS" && facts.length > 1) {
      const codes = (facts as any[]).map((item) => item?.externalUnitId).filter(Boolean).slice(0, 8);
      return ar ? `لقيت أكتر من وحدة مطابقة للجزء اللي كتبته: ${codes.join("، ")}. اختار الكود الكامل وأنا أجيب لك تفاصيلها الدقيقة.` : `I found multiple units matching that reference: ${codes.join(", ")}. Send the full code and I will open the exact unit.`;
    }
    if (intent === "PROPERTY_DETAILS" && first) return this.propertyPresenter.propertyDetailAnswer(first, Boolean(ar));
    if (intent === "PAYMENT_PLAN") return this.paymentPresenter.paymentAnswer(facts, Boolean(ar));

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
        return ar ? "المرجع اللي وصلني مش محدد وحدة واحدة بشكل كافي. اختار الوحدة من الكروت الظاهرة وأنا أكمل عليها مباشرة." : "That reference does not identify one unit clearly enough. Choose the exact unit from the cards and I'll continue with it.";
      }
      const unit = (facts as any[])[0];
      return unit ? (ar ? `تمام، ${this.formatter.humanUnitLabel(unit, true)} متاحة. هرتب معاك طريقة الدفع الأول، وبعدها بيانات التواصل.` : `${this.formatter.humanUnitLabel(unit, false)} is available. I'll confirm the payment route first, then the contact details.`) : (ar ? "ملقيتش الوحدة المطلوبة ضمن الوحدات المتاحة حاليًا." : "I could not find that unit in the currently available inventory.");
    }

    if (["PROPERTY_SEARCH", "PROPERTY_REFINEMENT", "PROPERTY_OPTIONS_REQUEST", "AVAILABILITY_CHECK", "INVESTMENT", "RESALE", "RENTAL"].includes(intent ?? "") && !facts.length) {
      const type = state.propertyTypes?.[0];
      const budget = state.budgetMax ?? state.priceMax;
      const location = state.locations?.[0];
      const constraints = [
        type ? (ar ? `نوع ${type}` : `type ${type}`) : null,
        budget ? (ar ? `حتى ${this.formatter.money(budget, state.currency ?? "EGP")}` : `up to ${this.formatter.money(budget, state.currency ?? "EGP")}`) : null,
        location ? (ar ? `في ${location}` : `in ${location}`) : null,
      ].filter(Boolean).join(ar ? " · " : " · ");
      return ar
        ? `تحت الشروط الحالية${constraints ? ` (${constraints})` : ""} مش ظاهر عندي اختيار موثق. أقدر أوسع النطاق لو تحب، أو تشيل شرط محدد زي السعر أو النوع.`
        : `There is no verified option matching the current constraints${constraints ? ` (${constraints})` : ""}. I can widen the scope if you want, or you can remove a specific condition such as price or type.`;
    }

    return undefined;
  }

  contextualUnitIds(previous: StructuredIntent, priorUnitIds: string[]): string[] {
    const presentation = previous.presentation ?? {};
    return [...new Set([
      ...(presentation.lastPresentedUnitIds ?? []),
      ...(presentation.selectedUnitId ? [presentation.selectedUnitId] : []),
      ...(presentation.searchCandidateIds ?? []),
      ...priorUnitIds,
    ])];
  }
}
