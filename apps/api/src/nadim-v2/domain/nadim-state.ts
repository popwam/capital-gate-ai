import type { NadimChannel } from "../dto/nadim-turn.dto";
import { styleFromLocale, type NadimLanguageStyleState } from "../personality/language-style.types";
import type { NadimIntentType, StateField, StateOperation } from "./nadim-intent";

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
  downPaymentMax?: number;
  installmentMonths?: number;
  installmentPreference?: "INSTALLMENTS" | "LONG_TERM";
  deliveryMaxYears?: number;
  purpose?: "LIVING" | "INVESTMENT";
  finishing?: string;
  queryObjective?: "BEST_MATCH" | "CHEAPEST" | "MOST_EXPENSIVE";
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
