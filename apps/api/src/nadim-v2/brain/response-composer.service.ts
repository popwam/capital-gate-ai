import { Injectable } from "@nestjs/common";
import { ExecutedAction, ProposedAction } from "../domain/nadim-action";
import { NadimUnderstanding } from "../domain/nadim-intent";
import { NadimPlan, NadimToolResult } from "../domain/nadim-plan";
import { NadimState } from "../domain/nadim-state";
import { DialogueModelService } from "../providers/dialogue-model.service";

export type CompositionResult = {
  reply: string;
  model?: { provider: string; model: string; fallbackUsed: boolean; latencyMs: number };
};

function money(value: unknown, currency = "EGP", locale = "ar-EG") {
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(number) + ` ${currency}` : undefined;
}

function dataOf(results: NadimToolResult[]) {
  return results.filter((result) => result.ok).flatMap((result) => Array.isArray(result.data) ? result.data : result.data == null ? [] : [result.data]) as any[];
}

@Injectable()
export class ResponseComposerService {
  constructor(private readonly dialogue: DialogueModelService) {}

  async compose(input: {
    userMessage: string;
    understanding: NadimUnderstanding;
    state: NadimState;
    plan: NadimPlan;
    toolResults: NadimToolResult[];
    proposedActions: ProposedAction[];
    executedActions: ExecutedAction[];
    trace?: { conversationId?: string; requestId?: string };
  }): Promise<CompositionResult> {
    const fallback = this.deterministic(input);
    const values = dataOf(input.toolResults);
    const factual = input.plan.steps.length > 0;
    if (factual || !this.dialogue.available()) return { reply: fallback };
    try {
      const model = await this.dialogue.compose({
        userMessage: input.userMessage,
        intent: input.understanding,
        state: input.state,
        verifiedFacts: values,
        actionResults: input.executedActions,
        deterministicFallback: fallback,
      }, input.trace);
      if (!this.safeActionClaims(model.value, input.executedActions)) return { reply: fallback };
      return { reply: model.value, model: { provider: model.provider, model: model.model, fallbackUsed: model.fallbackUsed, latencyMs: model.latencyMs } };
    } catch {
      return { reply: fallback };
    }
  }

  private deterministic(input: Parameters<ResponseComposerService["compose"]>[0]) {
    const ar = input.state.locale.toLowerCase().startsWith("ar");
    const values = dataOf(input.toolResults);
    const failedTool = input.toolResults.some((result) => !result.ok);
    if (input.plan.clarification === "RESULT_REFERENCE_NOT_FOUND") return ar ? "مش قادر أحدد الاختيار المقصود من النتائج الحالية. قولّي رقم الاختيار الظاهر عندك." : "I cannot resolve that reference from the current results. Tell me the visible option number.";
    if (input.plan.clarification === "COMPARISON_SELECTION_REQUIRED") return ar ? "اختار وحدتين على الأقل من النتائج الحالية عشان أقارنهم." : "Select at least two units from the current results to compare them.";
    if (input.plan.clarification === "UNIT_SELECTION_REQUIRED") return ar ? "حدد الوحدة المقصودة من النتائج، مثل: التانية." : "Select the unit you mean, for example: the second one.";
    if (input.executedActions.length) return this.actionReply(input.executedActions, ar);
    if (input.understanding.intent === "GREETING") return ar ? "أهلًا، أنا نديم. قولّي بتدور على إيه وأنا أبدأ بالمعلومات المتاحة." : "Hi, I’m Nadim. Tell me what you’re looking for and I’ll start with the available data.";
    if (input.understanding.intent === "RESET_SEARCH") return ar ? "بدأت بحث جديد ومسحت شروط البحث السابقة." : "I started a new search and cleared the previous search constraints.";
    if (input.plan.goal === "PROPERTY_SEARCH") {
      if (!values.length) {
        const blocker = input.state.search.budgetMax != null
          ? (ar ? `الميزانية القصوى ${money(input.state.search.budgetMax, input.state.search.currency, input.state.locale)}` : `the maximum budget of ${money(input.state.search.budgetMax, input.state.search.currency, input.state.locale)}`)
          : input.state.search.locations.length ? (ar ? `الموقع ${input.state.search.locations.join("، ")}` : `the location ${input.state.search.locations.join(", ")}`) : undefined;
        return ar
          ? `ملقتش تطابق دقيق بالشروط الحالية${blocker ? `، وأقرب قيد محتمل هو ${blocker}` : ""}. أقدر أغيّر قيد واحد، لكن مش هوسّع البحث من غير موافقتك.`
          : `I found no exact match under the current constraints${blocker ? `; a likely blocker is ${blocker}` : ""}. I can relax one constraint, but I will not widen the search without your approval.`;
      }
      const lines = values.slice(0, 5).map((unit, index) => {
        const price = money(unit.price, unit.currency ?? "EGP", input.state.locale);
        const project = unit.project?.name;
        return `${index + 1}. ${[unit.externalUnitId ?? unit.id, unit.unitType, price, project].filter(Boolean).join(" · ")}`;
      });
      return [ar ? `لقيت ${values.length} اختيارات مطابقة من البيانات الموثقة:` : `I found ${values.length} matches in the verified inventory:`, ...lines].join("\n");
    }
    if (input.plan.goal === "COMPARISON") {
      if (!values.length) return ar ? "بيانات المقارنة مش متاحة حاليًا." : "Comparison data is unavailable right now.";
      return [ar ? "مقارنة الوحدات الموثقة:" : "Verified unit comparison:", ...values.map((unit) => `- ${unit.externalUnitId ?? unit.id}: ${[unit.unitType, money(unit.price, unit.currency, input.state.locale), unit.bedrooms != null ? `${unit.bedrooms} ${ar ? "غرف" : "bedrooms"}` : null].filter(Boolean).join(" · ")}`)].join("\n");
    }
    if (input.understanding.intent === "MEDIA_REQUEST") {
      const media = values.flatMap((value) => value.media ?? []);
      return media.length ? (ar ? `لقيت ${media.length} ملفات وسائط موثقة للوحدة.` : `I found ${media.length} verified media items for the unit.`) : (ar ? "مفيش صور موثقة متاحة للوحدة حاليًا." : "No verified media is available for this unit right now.");
    }
    if (input.understanding.intent === "PAYMENT_PLAN_QUESTION") return values.length ? (ar ? `لقيت ${values.length} خطط سداد مفعلة في البيانات الموثقة.` : `I found ${values.length} active verified payment plans.`) : (ar ? "مفيش خطة سداد مفعلة للوحدة في البيانات الحالية." : "No active payment plan is recorded for this unit.");
    if (input.understanding.intent === "PRICE_QUESTION") {
      const unit = values[0];
      return unit?.price != null ? (ar ? `السعر المسجل للوحدة ${unit.externalUnitId ?? ""} هو ${money(unit.price, unit.currency, input.state.locale)}.` : `The recorded price for unit ${unit.externalUnitId ?? ""} is ${money(unit.price, unit.currency, input.state.locale)}.`) : (ar ? "السعر مش متاح في البيانات الموثقة." : "The price is unavailable in the verified data.");
    }
    if (input.understanding.intent === "AVAILABILITY_QUESTION") {
      const availability = values[0];
      return availability ? (ar ? `حالة الوحدة ${availability.externalUnitId ?? ""}: ${availability.status}.` : `Unit ${availability.externalUnitId ?? ""} status: ${availability.status}.`) : (ar ? "حالة الإتاحة غير معروفة حاليًا." : "Availability is currently unknown.");
    }
    if (failedTool) return ar ? "تعذر الوصول للبيانات الموثقة المطلوبة حاليًا، ومش هخمن الإجابة." : "The requested verified data is currently unavailable, so I won’t guess.";
    return ar ? "محتاج تفاصيل أكتر بسيطة عشان أساعدك بشكل دقيق." : "I need one more detail to help accurately.";
  }

  private actionReply(actions: ExecutedAction[], ar: boolean) {
    const succeeded = actions.find((action) => action.status === "SUCCEEDED");
    if (succeeded) {
      if (succeeded.type === "CREATE_VIEWING_REQUEST") return ar ? "تم تسجيل طلب المعاينة بنجاح، والفريق يقدر يتابعه الآن." : "The viewing request was recorded successfully and is available to the team.";
      if (succeeded.type === "CREATE_RESERVATION_REQUEST") return ar ? "تم تسجيل طلب الحجز بنجاح. ده طلب متابعة وليس تأكيد حجز للوحدة." : "The reservation request was recorded successfully. This is a follow-up request, not confirmation that the unit is reserved.";
      return ar ? "تم تسجيل طلب التواصل بنجاح." : "Your contact request was recorded successfully.";
    }
    const failed = actions[0];
    return ar ? `الطلب لم يتم تنفيذه حاليًا (${failed.errorCode ?? "غير متاح"}).` : `The request was not completed (${failed.errorCode ?? "unavailable"}).`;
  }

  private safeActionClaims(reply: string, actions: ExecutedAction[]) {
    if (actions.some((action) => action.status === "SUCCEEDED")) return true;
    return !/(?:تم\s+(?:الحجز|التسجيل|الإرسال|تأكيد|تنفيذ)|booked|reserved|successfully\s+(?:created|sent|scheduled|completed))/iu.test(reply);
  }
}
