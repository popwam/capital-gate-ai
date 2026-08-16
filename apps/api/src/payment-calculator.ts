export type PaymentPlanLike = {
  id?: string;
  name?: string | null;
  durationMonths?: number | null;
  downPaymentAmount?: unknown;
  downPayment?: unknown;
  downPaymentPercent?: unknown;
  installmentAmount?: unknown;
  installmentFrequency?: string | null;
  totalPrice?: unknown;
  totalPriceOverride?: unknown;
  discountAmount?: unknown;
  discountPercent?: unknown;
  currency?: string | null;
  maintenanceAmount?: unknown;
  maintenancePercent?: unknown;
  projectId?: string | null;
  unitId?: string | null;
};

const num = (value: unknown) => value == null || value === "" ? null : Number(value);

function paymentsPerYear(frequency?: string | null) {
  const value = String(frequency ?? "MONTHLY").toUpperCase();
  if (value.includes("QUART")) return 4;
  if (value.includes("SEMI")) return 2;
  if (value.includes("ANNU")) return 1;
  return 12;
}

export function quotePaymentPlan(plan: PaymentPlanLike, unitPrice: unknown, unitCurrency?: string | null) {
  const basePrice = num(unitPrice) ?? 0;
  const fixedTotalPrice = num(plan.totalPriceOverride) ?? num(plan.totalPrice);
  const discountAmount = Math.max(0, num(plan.discountAmount) ?? 0);
  const discountPercent = Math.max(0, num(plan.discountPercent) ?? 0);
  const calculatedDiscount = fixedTotalPrice == null
    ? discountAmount + (basePrice * discountPercent / 100)
    : Math.max(0, basePrice - fixedTotalPrice);
  const totalPrice = fixedTotalPrice ?? Math.max(0, basePrice - calculatedDiscount);
  const dpPercent = num(plan.downPaymentPercent);
  const explicitDp = num(plan.downPaymentAmount) ?? num(plan.downPayment);
  const downPaymentAmount = explicitDp ?? (dpPercent != null ? totalPrice * dpPercent / 100 : null);
  const remaining = downPaymentAmount != null ? Math.max(0, totalPrice - downPaymentAmount) : totalPrice;
  const durationMonths = plan.durationMonths ?? null;
  const perYear = paymentsPerYear(plan.installmentFrequency);
  const installments = durationMonths ? Math.max(1, Math.round(durationMonths / 12 * perYear)) : null;
  const explicitInstallment = num(plan.installmentAmount);
  const installmentAmount = explicitInstallment ?? (installments ? remaining / installments : null);
  const monthlyEquivalent = installmentAmount == null ? null : installmentAmount * perYear / 12;
  const maintenanceAmount = num(plan.maintenanceAmount) ?? (num(plan.maintenancePercent) != null ? totalPrice * num(plan.maintenancePercent)! / 100 : null);
  return {
    id: plan.id,
    name: plan.name ?? null,
    durationMonths,
    totalPrice,
    currency: plan.currency ?? unitCurrency ?? "EGP",
    downPaymentAmount,
    downPaymentPercent: dpPercent,
    installmentAmount,
    installmentFrequency: plan.installmentFrequency ?? "MONTHLY",
    monthlyEquivalent,
    maintenanceAmount,
    basePrice,
    discountAmount: calculatedDiscount,
    discountPercent: basePrice > 0 ? calculatedDiscount / basePrice * 100 : discountPercent,
    calculatedTotalPrice: fixedTotalPrice == null,
    calculatedDownPayment: explicitDp == null && dpPercent != null,
    calculatedInstallment: explicitInstallment == null && installmentAmount != null,
  };
}

export function chooseBestPaymentPlan(plans: PaymentPlanLike[], unitPrice: unknown, unitCurrency: string | null | undefined, preferences: { preferredPaymentDurationMonths?: number; maxDownPayment?: number; maxMonthlyInstallment?: number; preferredDownPaymentPercent?: number } = {}) {
  const quoted = plans.map(plan => quotePaymentPlan(plan, unitPrice, unitCurrency));
  return quoted.sort((a,b) => {
    let scoreA = 0, scoreB = 0;
    if (preferences.preferredPaymentDurationMonths != null) {
      scoreA -= Math.abs((a.durationMonths ?? 0) - preferences.preferredPaymentDurationMonths) / 12;
      scoreB -= Math.abs((b.durationMonths ?? 0) - preferences.preferredPaymentDurationMonths) / 12;
    } else {
      scoreA += (a.durationMonths ?? 0) / 12;
      scoreB += (b.durationMonths ?? 0) / 12;
    }
    if (preferences.maxDownPayment != null) {
      scoreA += a.downPaymentAmount != null && a.downPaymentAmount <= preferences.maxDownPayment ? 10 : -10;
      scoreB += b.downPaymentAmount != null && b.downPaymentAmount <= preferences.maxDownPayment ? 10 : -10;
    }
    if (preferences.maxMonthlyInstallment != null) {
      scoreA += a.monthlyEquivalent != null && a.monthlyEquivalent <= preferences.maxMonthlyInstallment ? 10 : -10;
      scoreB += b.monthlyEquivalent != null && b.monthlyEquivalent <= preferences.maxMonthlyInstallment ? 10 : -10;
    }
    if (preferences.preferredDownPaymentPercent != null) {
      scoreA -= Math.abs((a.downPaymentPercent ?? 999) - preferences.preferredDownPaymentPercent);
      scoreB -= Math.abs((b.downPaymentPercent ?? 999) - preferences.preferredDownPaymentPercent);
    }
    return scoreB - scoreA;
  })[0] ?? null;
}
