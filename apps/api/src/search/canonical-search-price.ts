export type CanonicalSearchPrice = {
  amount: number;
  currency: string;
  source: "UNIT_PRICE";
};

/**
 * Unit.price is the current inventory-wide, verified total price contract.
 * Payment-plan totals are plan-specific quotes and cannot safely replace the
 * unit price until the customer has selected a plan.
 */
export function resolveSearchableTotalPrice(unit: { price?: unknown; currency?: string | null }): CanonicalSearchPrice | null {
  if (unit.price == null || unit.price === "") return null;
  const amount = Number(unit.price);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return { amount, currency: String(unit.currency ?? "EGP").toUpperCase(), source: "UNIT_PRICE" };
}
