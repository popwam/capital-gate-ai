export const NADIM_LANGUAGE_STYLES = [
  "AR_EGYPTIAN",
  "AR_GULF",
  "AR_FORMAL",
  "EN_US",
  "FRANCO_ARABIC",
  "MIXED_AR_EN",
  "UNKNOWN",
] as const;

export type NadimLanguageStyle = (typeof NADIM_LANGUAGE_STYLES)[number];

export const NADIM_REGIONAL_VARIANTS = ["SAUDI"] as const;
export type NadimRegionalVariant = (typeof NADIM_REGIONAL_VARIANTS)[number];

export const GRAMMATICAL_ADDRESSES = ["MASCULINE", "FEMININE", "NEUTRAL", "UNKNOWN"] as const;
export type GrammaticalAddress = (typeof GRAMMATICAL_ADDRESSES)[number];

export type NadimLanguageStyleState = {
  /** Language/style observed in the current inbound message. Comprehension signal only. */
  inputLanguage: NadimLanguageStyle;
  /** @deprecated Use inputLanguage. Kept for persisted V2 state compatibility. */
  detected: NadimLanguageStyle;
  confidence: number;
  /** Sticky output style. It changes only after an explicit customer request. */
  preferredResponseStyle: NadimLanguageStyle;
  regionalVariant?: NadimRegionalVariant;
  /** Most recent Arabic output preference, retained while another language is active. */
  lastArabicResponseStyle?: NadimLanguageStyle;
  lastArabicRegionalVariant?: NadimRegionalVariant;
  explicitOverride: boolean;
  explicitRequestThisTurn: boolean;
  changedThisTurn: boolean;
  codeSwitchRatio?: number;
  /** Conversational agreement only. This is not a demographic or gender-identity field. */
  grammaticalAddress: GrammaticalAddress;
  grammaticalAddressExplicit: boolean;
  grammaticalAddressChangedThisTurn: boolean;
};

export function styleFromLocale(locale?: string): NadimLanguageStyle {
  const normalized = locale?.trim().toLowerCase() ?? "";
  if (normalized.startsWith("en")) return "EN_US";
  if (/^ar-(?:sa|ae|kw|qa|bh|om)/u.test(normalized)) return "AR_GULF";
  if (normalized.startsWith("ar")) return "AR_EGYPTIAN";
  return "UNKNOWN";
}

export function regionalVariantFromLocale(locale?: string): NadimRegionalVariant | undefined {
  return locale?.trim().toLowerCase().startsWith("ar-sa") ? "SAUDI" : undefined;
}
