import { Injectable } from "@nestjs/common";
import { ConversationFormatterService } from "./conversation-formatter.service";

export type PaymentPlanKind = "CASH" | "INSTALLMENT";

export type PaymentChoices = {
  hasCash: boolean;
  hasInstallment: boolean;
  cash: any | null;
  longest: any | null;
  liquidity: any | null;
  immediate: any | null;
  readyNow: boolean;
};

/**
 * Calculates and presents payment plan choices.
 * Extracted from ChatService for domain separation.
 */
@Injectable()
export class PaymentPresenterService {
  constructor(private readonly formatter: ConversationFormatterService) {}

  paymentPlanKind(plan: any): PaymentPlanKind {
    const duration = Number(plan?.durationMonths ?? plan?.durationValue ?? 0);
    const downPercent = Number(plan?.downPaymentPercent ?? 0);
    return plan?.planType === "CASH" || duration === 0 || downPercent >= 100 ? "CASH" : "INSTALLMENT";
  }

  paymentPlanAmount(plan: any, unit: any) {
    const price = unit?.price == null ? null : Number(unit.price);
    const explicitTotal = plan?.effectiveTotalPrice ?? plan?.totalPriceOverride ?? plan?.totalPrice;
    const discountAmount = plan?.discountAmount == null ? null : Number(plan.discountAmount);
    const discountPercent = plan?.discountPercent == null ? null : Number(plan.discountPercent);
    const calculatedTotal = price == null ? null : discountAmount != null ? Math.max(0, price - discountAmount) : discountPercent != null && discountPercent > 0 ? Math.max(0, price * (1 - discountPercent / 100)) : price;
    const total = explicitTotal == null ? calculatedTotal : Number(explicitTotal);
    const downAmount = plan?.downPaymentAmount ?? plan?.downPayment;
    const downPercent = plan?.downPaymentPercent == null ? null : Number(plan.downPaymentPercent);
    const down = downAmount != null ? Number(downAmount) : (total != null && downPercent != null ? total * downPercent / 100 : null);
    const durationMonths = Number(plan?.durationMonths ?? 0) || null;
    const everyValue = Number(plan?.installmentEveryValue ?? 1) || 1;
    const everyUnit = String(plan?.installmentEveryUnit ?? "MONTH").toUpperCase();
    const everyMonths = everyUnit === "YEAR" ? everyValue * 12 : everyUnit === "MONTH" ? everyValue : 1;
    const count = durationMonths ? Math.max(1, Math.floor(durationMonths / everyMonths)) : null;
    const installment = plan?.installmentAmount != null ? Number(plan.installmentAmount) : (total != null && down != null && count ? Math.max(0, total - down) / count : null);
    return { total, down, downPercent, durationMonths, installment, everyMonths };
  }

  paymentChoices(unit: any): PaymentChoices {
    const plans = Array.isArray(unit?.paymentPlans) ? unit.paymentPlans : [];
    const cashPlans = plans.filter((plan: any) => this.paymentPlanKind(plan) === "CASH");
    const installmentPlans = plans.filter((plan: any) => this.paymentPlanKind(plan) === "INSTALLMENT");
    const cash = cashPlans.sort((a: any, b: any) => Number(a.effectiveTotalPrice ?? a.totalPriceOverride ?? a.totalPrice ?? unit.price ?? Infinity) - Number(b.effectiveTotalPrice ?? b.totalPriceOverride ?? b.totalPrice ?? unit.price ?? Infinity))[0] ?? null;
    const longest = [...installmentPlans].sort((a: any, b: any) => Number(b.durationMonths ?? 0) - Number(a.durationMonths ?? 0))[0] ?? null;
    const lowestDown = [...installmentPlans].sort((a: any, b: any) => {
      const av = this.paymentPlanAmount(a, unit).down ?? Infinity;
      const bv = this.paymentPlanAmount(b, unit).down ?? Infinity;
      return av - bv;
    })[0] ?? null;
    const shortest = [...installmentPlans].sort((a: any, b: any) => Number(a.durationMonths ?? Infinity) - Number(b.durationMonths ?? Infinity))[0] ?? null;
    const readyNow = Boolean(
      (unit?.deliveryDate && new Date(unit.deliveryDate).getTime() <= Date.now()) ||
      /(?:DELIVERED|READY_TO_MOVE)/iu.test(String(unit?.phaseRef?.status ?? unit?.project?.deliveryStatus ?? "")) ||
      (Array.isArray(unit?.project?.deliveryStatuses) && unit.project.deliveryStatuses.some((value: unknown) => /(?:DELIVERED|READY_TO_MOVE)/iu.test(String(value))))
    );
    const immediate = readyNow ? (cash ?? shortest ?? longest) : null;
    const serializePlan = (plan: any, tag?: string) => plan ? {
      id: plan.id, name: plan.name ?? null, kind: this.paymentPlanKind(plan), tag: tag ?? null,
      ...this.paymentPlanAmount(plan, unit), currency: plan.currency ?? unit?.currency ?? "EGP",
      discountPercent: plan.discountPercent == null ? null : Number(plan.discountPercent),
    } : null;
    return {
      hasCash: Boolean(cash), hasInstallment: Boolean(installmentPlans.length),
      cash: serializePlan(cash, "CASH"),
      longest: serializePlan(longest, "LONGEST"),
      liquidity: serializePlan(lowestDown, "LIQUIDITY"),
      immediate: serializePlan(immediate, "IMMEDIATE"),
      readyNow,
    };
  }

  paymentChoicesAnswer(unit: any, ar: boolean): string {
    const choices = this.paymentChoices(unit);
    const label = this.formatter.humanUnitLabel(unit, ar);
    const currency = unit?.currency ?? "EGP";
    const cashTotal = choices.cash?.total != null ? this.formatter.money(choices.cash.total, currency) : null;
    const longDown = choices.longest?.down != null ? this.formatter.money(choices.longest.down, currency) : null;
    const longInstallment = choices.longest?.installment != null ? this.formatter.money(choices.longest.installment, currency) : null;
    if (ar) {
      const lines = [
        `**قبل المعاينة**`,
        `${label}. خلّينا نحدد طريقة الدفع الأول عشان الطلب يروح للمبيعات وهو واضح.`,
        choices.cash ? `**كاش** ${cashTotal ? `الإجمالي التقريبي ${cashTotal}` : "متاح"}${choices.cash.discountPercent ? ` بعد خصم ${choices.cash.discountPercent}%` : ""}.` : null,
        choices.longest ? `**تقسيط طويل** ${choices.longest.durationMonths ? `${choices.longest.durationMonths} شهر` : ""}${longDown ? ` · مقدم ${longDown}` : ""}${longInstallment ? ` · القسط التقريبي ${longInstallment}` : ""}.` : null,
        choices.liquidity && choices.liquidity.id !== choices.longest?.id ? `**للاستثمار والسيولة** أقل مقدم موثق ${choices.liquidity.down != null ? this.formatter.money(choices.liquidity.down, currency) : "حسب الخطة"}؛ ده يحافظ على سيولة أكبر من غير ما أفترض عائد استثماري غير موثق.` : null,
        choices.immediate ? `**للسكن الفوري** بيانات الوحدة تشير إنها جاهزة/مسلمة؛ الأسرع ماليًا هو ${choices.immediate.kind === "CASH" ? "الكاش" : "أقصر خطة متاحة"}.` : null,
        `اختار **كاش** أو **تقسيط** ونكمل.`
      ].filter(Boolean);
      return lines.join("\n\n");
    }
    const lines = [
      `**Before the viewing**`,
      `${label}. Let's choose the payment route first so the sales handoff is clear.`,
      choices.cash ? `**Cash** ${cashTotal ? `approx. total ${cashTotal}` : "available"}${choices.cash.discountPercent ? ` after ${choices.cash.discountPercent}% discount` : ""}.` : null,
      choices.longest ? `**Long-term installment** ${choices.longest.durationMonths ? `${choices.longest.durationMonths} months` : ""}${longDown ? ` · down payment ${longDown}` : ""}${longInstallment ? ` · approx. installment ${longInstallment}` : ""}.` : null,
      choices.liquidity && choices.liquidity.id !== choices.longest?.id ? `**Investment / liquidity** the lowest verified down payment is ${choices.liquidity.down != null ? this.formatter.money(choices.liquidity.down, currency) : "set by the plan"}; this preserves more liquidity without assuming an unverified return.` : null,
      choices.immediate ? `**Immediate living** the unit is marked ready/delivered; the fastest financial route is ${choices.immediate.kind === "CASH" ? "cash" : "the shortest available plan"}.` : null,
      `Choose **cash** or **installments** and we'll continue.`
    ].filter(Boolean);
    return lines.join("\n\n");
  }

  paymentAnswer(facts: unknown[], ar: boolean): string | undefined {
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
        const shown = this.formatter.money(effective, plan.currency ?? currency) ?? this.formatter.money(unit.price, currency);
        const discount = plan.discountPercent != null && Number(plan.discountPercent) > 0 ? `${Number(plan.discountPercent)}%` : null;
        return ar ? `• كاش${shown ? `: ${shown}` : ""}${discount ? ` بعد خصم ${discount}` : ""}` : `• Cash${shown ? `: ${shown}` : ""}${discount ? ` after ${discount} discount` : ""}`;
      }
      const years = plan.durationMonths != null ? Number(plan.durationMonths) / 12 : null;
      const down = plan.downPaymentPercent != null ? `${Number(plan.downPaymentPercent)}%` : this.formatter.money(plan.downPaymentAmount, plan.currency ?? currency);
      const every = plan.installmentEveryValue && plan.installmentEveryUnit ? `${plan.installmentEveryValue} ${plan.installmentEveryUnit}` : plan.installmentFrequency;
      const first = plan.firstInstallmentAfterValue && plan.firstInstallmentAfterUnit ? `${plan.firstInstallmentAfterValue} ${plan.firstInstallmentAfterUnit}` : null;
      return ar
        ? `• ${plan.name ?? "تقسيط"}${years ? ` — ${Number.isInteger(years) ? years : years.toFixed(1)} سنة` : ""}${down ? `، مقدم ${down}` : ""}${every ? `، القسط كل ${every}` : ""}${first ? `، أول قسط بعد ${first}` : ""}`
        : `• ${plan.name ?? "Installments"}${years ? ` — ${Number.isInteger(years) ? years : years.toFixed(1)} years` : ""}${down ? `, down payment ${down}` : ""}${every ? `, every ${every}` : ""}${first ? `, first installment after ${first}` : ""}`;
    });
    const project = this.formatter.displayProject(unit);
    const intro = ar
      ? `خطط السداد المطبقة على ${unit.externalUnitId ? `الوحدة **${unit.externalUnitId}**` : "الوحدة"}${project ? ` في **${project}**` : ""}:`
      : `Payment plans applied to ${unit.externalUnitId ? `unit ${unit.externalUnitId}` : "the unit"}${project ? ` in ${project}` : ""}:`;
    return `${intro}\n${lines.join("\n")}`;
  }
}
