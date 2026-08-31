export function customerPaymentPercent(value: unknown): number | undefined {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) return undefined;
  const percent = numeric > 0 && numeric < 1 ? numeric * 100 : numeric;
  return Number(percent.toFixed(4));
}

export function normalizePaymentPlan<T extends Record<string, unknown>>(plan: T): T {
  const downPaymentPercent = customerPaymentPercent(plan.downPaymentPercent);
  return {
    ...plan,
    ...(downPaymentPercent === undefined ? {} : { downPaymentPercent }),
  };
}
