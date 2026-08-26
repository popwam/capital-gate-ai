import { Injectable } from "@nestjs/common";
import { NadimState } from "../domain/nadim-state";
import { GrammaticalAddress, NadimLanguageStyle, NadimLanguageStyleState, styleFromLocale } from "./language-style.types";

type Detection = { style: NadimLanguageStyle; confidence: number; explicit: boolean; codeSwitchRatio?: number };
type AddressDetection = { value: GrammaticalAddress; explicit: boolean; changed?: boolean };

const ARABIC = /[\u0600-\u06FF]/u;
const LATIN_WORD = /[A-Za-z]{2,}/gu;

@Injectable()
export class LanguageStyleDetectorService {
  apply(state: NadimState, message: string, localeHint?: string): NadimState {
    return { ...state, languageStyle: this.detect(message, state.languageStyle, localeHint ?? state.locale) };
  }

  detect(message: string, previous?: NadimLanguageStyleState, localeHint?: string): NadimLanguageStyleState {
    const detectedAddress = this.grammaticalAddress(message, previous);
    const address = {
      ...detectedAddress,
      changed: Boolean(previous
        && previous.grammaticalAddress !== detectedAddress.value
        && (detectedAddress.explicit || previous.grammaticalAddress !== "UNKNOWN")),
    };
    const explicit = this.explicitRequest(message);
    if (explicit) {
      const changed = previous?.preferredResponseStyle !== explicit;
      return this.result(explicit, explicit, 1, true, changed, address);
    }

    const latest = this.latestMessage(message);
    if (previous?.explicitOverride && previous.preferredResponseStyle !== "UNKNOWN") {
      return this.result(latest.style, previous.preferredResponseStyle, latest.confidence, true, false, address, latest.codeSwitchRatio);
    }
    if (latest.style !== "UNKNOWN" && latest.confidence >= 0.65) {
      return this.result(latest.style, latest.style, latest.confidence, false, false, address, latest.codeSwitchRatio);
    }

    const recent = previous?.detected && previous.detected !== "UNKNOWN" ? previous.detected : undefined;
    const persisted = previous?.preferredResponseStyle && previous.preferredResponseStyle !== "UNKNOWN" ? previous.preferredResponseStyle : undefined;
    const fallback = recent ?? persisted ?? styleFromLocale(localeHint);
    return this.result(latest.style, fallback, latest.confidence, previous?.explicitOverride ?? false, false, address, latest.codeSwitchRatio);
  }

  private grammaticalAddress(message: string, previous?: NadimLanguageStyleState): AddressDetection {
    const text = message.normalize("NFKC").trim();
    if (/(?:بصيغة|خاطبني|كلمني|كلّميني).{0,24}(?:مؤنث|للمؤنث)|(?:use|address me in).{0,20}feminine/iu.test(text)) {
      return { value: "FEMININE", explicit: true };
    }
    if (/(?:من غير|بدون).{0,12}(?:صيغة )?مؤنث|(?:بصيغة|خاطبني).{0,20}(?:مذكر|للمذكر)|(?:use|address me in).{0,20}masculine/iu.test(text)) {
      return { value: "MASCULINE", explicit: true };
    }
    if (/(?:صيغة|كلام|خطاب).{0,16}محايد|من غير (?:تذكير|مذكر).{0,12}(?:تأنيث|مؤنث)|gender[- ]neutral/iu.test(text)) {
      return { value: "NEUTRAL", explicit: true };
    }
    if (previous?.grammaticalAddressExplicit) {
      return { value: previous.grammaticalAddress ?? "NEUTRAL", explicit: true };
    }

    const feminine = /(?:عايزة|عاوزة|حابة)(?=$|\s|[،,.!?])/iu.test(text)
      || /\b(?:3ayza|3awza|7aba)\b/iu.test(text);
    const masculine = /(?:عايز|عاوز|حابب)(?=$|\s|[،,.!?])/iu.test(text)
      || /\b(?:3ayz|3awz|7abeb)\b/iu.test(text);
    if (feminine && masculine) return { value: "NEUTRAL", explicit: false };
    if (feminine) return { value: "FEMININE", explicit: false };
    if (masculine) return { value: "MASCULINE", explicit: false };
    return {
      value: previous?.grammaticalAddress && previous.grammaticalAddress !== "UNKNOWN"
        ? previous.grammaticalAddress
        : "NEUTRAL",
      explicit: false,
    };
  }

  private explicitRequest(message: string): NadimLanguageStyle | undefined {
    const text = message.normalize("NFKC").trim();
    if (/(?:كمل|رد|كلمني|اتكلم)(?:\s+لي)?\s*(?:ب|بال)?مصري|باللهجة المصرية/iu.test(text)) return "AR_EGYPTIAN";
    if (/(?:رد|كلمني|اتكلم)(?:\s+لي)?\s*(?:ب|بال)?خليجي|باللهجة الخليجية/iu.test(text)) return "AR_GULF";
    if (/(?:رد|كلمني|اتكلم)(?:\s+لي)?\s+بالعربي(?:ة)?|بالفصحى|بالعربية الفصحى/iu.test(text)) return "AR_FORMAL";
    if (/(?:رد|كلمني|اتكلم)(?:\s+لي)?\s+بال(?:إنجليزي|انجليزي)|(?:continue|reply|explain|answer|speak)\b[^.?!]{0,60}\bin english\b|english please/iu.test(text)) return "EN_US";
    if (/(?:رد|كلمني|اتكلم)(?:\s+لي)?\s+(?:ب|بال)?فرانكو|بالفرانكو/iu.test(text)) return "FRANCO_ARABIC";
    return undefined;
  }

  private latestMessage(message: string): Detection {
    const text = message.normalize("NFKC").trim();
    const hasArabic = ARABIC.test(text);
    const latinWords = text.match(LATIN_WORD) ?? [];
    const englishRealEstate = latinWords.filter((word) => /^(?:apartment|bedrooms?|rooms?|budget|payment|plan|price|unit|villa|compound|project|compare|available|english|explain)$/iu.test(word));
    if (hasArabic && englishRealEstate.length) {
      const wordCount = Math.max(1, (text.match(/[\p{L}\d]+/gu) ?? []).length);
      return { style: "MIXED_AR_EN", confidence: 0.94, explicit: false, codeSwitchRatio: Math.min(1, englishRealEstate.length / wordCount) };
    }
    if (hasArabic && /(?:أبي|ابي|أبغى|ابغى|ودي|وش|هذي|هال|خلني|خلها|خلهم|تبيني|ما راح|^هلا(?:\s|$))/iu.test(text)) {
      return { style: "AR_GULF", confidence: 0.93, explicit: false };
    }
    if (hasArabic && /(?:أرغب|أود|اود|يرجى|الوحدات المتاحة|هل يمكن|أرشدني)/iu.test(text)) {
      return { style: "AR_FORMAL", confidence: 0.9, explicit: false };
    }
    if (hasArabic && /(?:عايز|عاوز|بدور|دورلي|مفيش|إزاي|ازاي|بتاع|خليني|شوفلي|قولّي)/iu.test(text)) {
      return { style: "AR_EGYPTIAN", confidence: 0.95, explicit: false };
    }
    if (hasArabic) return { style: "UNKNOWN", confidence: 0.45, explicit: false };

    const lower = text.toLowerCase();
    const francoTokens = lower.match(/(?:3ay[ez]|sho2a|tagamo3|btedor|khalini|khalyha|khalyhom|ashoof|mala2etsh|ta2seet|msa7|a7san|ar5as|\bfel\b|\b3ala\b)/gu) ?? [];
    const digitWords = lower.match(/[a-z]+[235789][a-z]+|[235789][a-z]{2,}/gu) ?? [];
    if (francoTokens.length >= 1 && (francoTokens.length + digitWords.length >= 2 || /\d/u.test(lower))) return { style: "FRANCO_ARABIC", confidence: 0.94, explicit: false };
    const englishSignals = latinWords.filter((word) => /^(?:i|i'm|im|we|you|need|want|looking|find|show|make|change|keep|what|how|where|which|is|are|it|the|in|under|million|hello|hey|hi|please|thanks|explain|english|apartment|bedrooms?|rooms?|budget|payment|plan|price|unit|villa|compound|project|compare|available)$/iu.test(word));
    const meaningfulEnglish = englishRealEstate.length > 0
      || englishSignals.length >= 2
      || (englishSignals.length === 1 && /^(?:hello|hey|hi|thanks)$/iu.test(englishSignals[0]));
    if (meaningfulEnglish) return { style: "EN_US", confidence: 0.9, explicit: false };
    return { style: "UNKNOWN", confidence: 0.2, explicit: false };
  }

  private result(
    detected: NadimLanguageStyle,
    preferredResponseStyle: NadimLanguageStyle,
    confidence: number,
    explicitOverride: boolean,
    changedThisTurn: boolean,
    address: AddressDetection,
    codeSwitchRatio?: number,
  ): NadimLanguageStyleState {
    return {
      detected,
      confidence,
      preferredResponseStyle,
      explicitOverride,
      changedThisTurn,
      codeSwitchRatio,
      grammaticalAddress: address.value,
      grammaticalAddressExplicit: address.explicit,
      grammaticalAddressChangedThisTurn: Boolean(address.changed),
    };
  }
}
