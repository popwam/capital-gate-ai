import type { NadimChannel } from "../dto/nadim-turn.dto";
import { regionalVariantFromLocale, styleFromLocale, type NadimLanguageStyleState } from "../personality/language-style.types";
import type { NadimIntentType, StateField, StateOperation } from "./nadim-intent";

export type BudgetStrictness = "APPROXIMATE" | "HARD";
export type BudgetConstraint = { amount: number; currency: string; strictness: BudgetStrictness };
export type QueryObjective =
  | "BEST_MATCH"
  | "HIGHEST_WITHIN_BUDGET"
  | "CHEAPEST"
  | "MOST_EXPENSIVE"
  | "LOWEST_DOWN_PAYMENT"
  | "LOWEST_INSTALLMENT"
  | "EARLIEST_DELIVERY"
  | "LARGEST_AREA";

export type NadimSearchState = {
  locations: string[];
  projects: string[];
  developers: string[];
  propertyTypes: string[];
  bedrooms?: number;
  bathrooms?: number;
  areaMin?: number;
  areaMax?: number;
  budgetMin?: number;
  budgetMax?: number;
  currency?: string;
  budgetConstraint?: BudgetConstraint;
  budget?: {
    originalAmount: number;
    originalCurrency: string;
    normalizedAmount?: number;
    normalizedCurrency?: "EGP";
    fxRate?: number;
    fxAsOf?: string;
    fxSource?: string;
    fxStatus: "VERIFIED" | "UNAVAILABLE";
  };
  downPaymentMax?: number;
  monthlyInstallmentMax?: number;
  installmentMonths?: number;
  installmentPreference?: "INSTALLMENTS" | "LONG_TERM";
  deliveryMaxYears?: number;
  purpose?: "LIVING" | "INVESTMENT";
  finishing?: string;
  queryObjective?: QueryObjective;
};

export type NadimReservationFields = {
  fullName?: string;
  phone?: string;
  paymentMethod?: "PROJECT_PAYMENT_PLAN";
};

export type NadimPendingAction = {
  type: "RESERVATION_REQUEST";
  unitId: string;
  collectedFields: NadimReservationFields;
  missingFields: Array<keyof NadimReservationFields>;
  requestedAt: string;
  lastExecutionStatus?: "READY" | "NOT_EXECUTED" | "FAILED";
  lastErrorCode?: string;
};

export type NadimPendingFollowUp = {
  channel?: "WHATSAPP" | "WEB" | "PHONE";
  outboundAddress?: string;
  temporal?: { kind: "RELATIVE"; amount: number; unit: "MINUTE" | "HOUR" | "DAY" | "WEEK" }
    | { kind: "TOMORROW"; localTime?: string };
};

export type NadimState = {
  version: 2;
  revision: number;
  channel: NadimChannel;
  customerId?: string;
  externalUserId?: string;
  locale: string;
  languageStyle: NadimLanguageStyleState;
  goal?: NadimIntentType;
  search: NadimSearchState;
  selectedUnitId?: string;
  selectedProjectId?: string;
  comparisonUnitIds: string[];
  lastResultIds: string[];
  pendingClarification?: { reason: string; field?: StateField };
  pendingAction?: NadimPendingAction;
  pendingFollowUp?: NadimPendingFollowUp;
  requirementSearchContexts?: Record<string, { budgetConstraint?: BudgetConstraint; queryObjective?: QueryObjective }>;
  lastOperations: StateOperation[];
  recentAssistantWording?: string;
};

export function initialNadimState(input: {
  channel: NadimChannel;
  customerId?: string;
  externalUserId?: string;
  locale?: string;
}): NadimState {
  const locale = input.locale ?? "ar-EG";
  const localeStyle = styleFromLocale(locale);
  const preferredResponseStyle = localeStyle === "UNKNOWN" ? "AR_FORMAL" : localeStyle;
  const regionalVariant = regionalVariantFromLocale(locale);
  return {
    version: 2,
    revision: 0,
    channel: input.channel,
    customerId: input.customerId,
    externalUserId: input.externalUserId,
    locale,
    languageStyle: {
      inputLanguage: "UNKNOWN",
      detected: "UNKNOWN",
      confidence: 0,
      preferredResponseStyle,
      regionalVariant,
      lastArabicResponseStyle: preferredResponseStyle.startsWith("AR_") ? preferredResponseStyle : undefined,
      lastArabicRegionalVariant: regionalVariant,
      explicitOverride: false,
      explicitRequestThisTurn: false,
      changedThisTurn: false,
      grammaticalAddress: "UNKNOWN",
      grammaticalAddressExplicit: false,
      grammaticalAddressChangedThisTurn: false,
    },
    search: { locations: [], projects: [], developers: [], propertyTypes: [] },
    comparisonUnitIds: [],
    lastResultIds: [],
    lastOperations: [],
  };
}
