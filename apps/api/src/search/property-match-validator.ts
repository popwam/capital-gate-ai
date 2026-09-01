import type { StructuredIntent } from "../providers/ai-provider";
import { resolveSearchableTotalPrice } from "./canonical-search-price";

export type PropertyValidationResult = { valid: true } | { valid: false; reasons: string[] };

const normalized = (value: unknown) => String(value ?? "").normalize("NFKC").toLocaleLowerCase().trim();
const finite = (value: unknown) => {
  if (value == null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
};

export function validatePropertyAgainstActiveRequirement(
  property: Record<string, any>,
  requirement: StructuredIntent,
  context: { locationIds?: string[]; now?: Date } = {},
): PropertyValidationResult {
  const reasons: string[] = [];
  const price = resolveSearchableTotalPrice(property);
  const hardBudget = requirement.budgetStrictness !== "APPROXIMATE";
  const minimumPrice = requirement.priceMin ?? requirement.budgetMin;
  const maximumPrice = requirement.priceMax ?? requirement.budgetMax;

  if (property.status !== "AVAILABLE" || property.archivedAt != null) reasons.push("UNAVAILABLE");
  if (requirement.propertyTypes?.length && !requirement.propertyTypes.some((value) => normalized(value) === normalized(property.unitType))) reasons.push("PROPERTY_TYPE");
  if (requirement.bedrooms != null && property.bedrooms !== requirement.bedrooms) reasons.push("BEDROOMS");
  if (requirement.bathrooms != null && (property.bathrooms == null || property.bathrooms < requirement.bathrooms)) reasons.push("BATHROOMS");
  const area = finite(property.builtUpArea);
  const areaMin = requirement.builtUpAreaMin ?? requirement.minimumArea;
  const areaMax = requirement.builtUpAreaMax ?? requirement.maximumArea;
  if (areaMin != null && (area == null || area < areaMin)) reasons.push("AREA_MIN");
  if (areaMax != null && (area == null || area > areaMax)) reasons.push("AREA_MAX");
  if (requirement.currency && normalized(price?.currency) !== normalized(requirement.currency)) reasons.push("CURRENCY");
  if (minimumPrice != null && (price == null || price.amount < minimumPrice)) reasons.push("PRICE_MIN");
  if (hardBudget && maximumPrice != null && (price == null || price.amount > maximumPrice)) reasons.push("HARD_BUDGET");
  if (context.locationIds?.length && !context.locationIds.includes(String(property.project?.locationId ?? property.project?.location?.id ?? ""))) reasons.push("LOCATION");

  if (requirement.deliveryMaxYears != null) {
    const latest = new Date(context.now ?? new Date());
    latest.setFullYear(latest.getFullYear() + Math.ceil(requirement.deliveryMaxYears));
    const delivery = property.deliveryDate == null ? undefined : new Date(property.deliveryDate);
    if (!delivery || Number.isNaN(delivery.getTime()) || delivery > latest) reasons.push("DELIVERY");
  }

  const plans = Array.isArray(property.paymentPlans) ? property.paymentPlans : [];
  if (requirement.maxDownPayment != null && !plans.some((plan: any) => finite(plan.downPaymentAmount) != null && finite(plan.downPaymentAmount)! <= requirement.maxDownPayment!)) reasons.push("DOWN_PAYMENT");
  if (requirement.maxMonthlyInstallment != null && !plans.some((plan: any) => finite(plan.monthlyEquivalent) != null && finite(plan.monthlyEquivalent)! <= requirement.maxMonthlyInstallment!)) reasons.push("INSTALLMENT");
  if (requirement.preferredPaymentDurationMonths != null && !plans.some((plan: any) => plan.durationMonths === requirement.preferredPaymentDurationMonths)) reasons.push("PAYMENT_DURATION");

  return reasons.length ? { valid: false, reasons } : { valid: true };
}
