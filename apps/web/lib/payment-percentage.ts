export function normalizedPaymentPercent(value: unknown): number | undefined {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) return undefined;
  return Number((numeric > 0 && numeric < 1 ? numeric * 100 : numeric).toFixed(4));
}

export function formatPaymentPercent(value: unknown) {
  const percent = normalizedPaymentPercent(value);
  return percent === undefined ? undefined : `${percent}%`;
}
