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

export const GRAMMATICAL_ADDRESSES = ["MASCULINE", "FEMININE", "NEUTRAL", "UNKNOWN"] as const;
export type GrammaticalAddress = (typeof GRAMMATICAL_ADDRESSES)[number];

export type NadimLanguageStyleState = {
  detected: NadimLanguageStyle;
  confidence: number;
  preferredResponseStyle: NadimLanguageStyle;
  explicitOverride: boolean;
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
