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

export type NadimLanguageStyleState = {
  detected: NadimLanguageStyle;
  confidence: number;
  preferredResponseStyle: NadimLanguageStyle;
  explicitOverride: boolean;
  changedThisTurn: boolean;
  codeSwitchRatio?: number;
};

export function styleFromLocale(locale?: string): NadimLanguageStyle {
  const normalized = locale?.trim().toLowerCase() ?? "";
  if (normalized.startsWith("en")) return "EN_US";
  if (/^ar-(?:sa|ae|kw|qa|bh|om)/u.test(normalized)) return "AR_GULF";
  if (normalized.startsWith("ar")) return "AR_EGYPTIAN";
  return "UNKNOWN";
}
