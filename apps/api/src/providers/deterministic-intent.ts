import { AIMessage, StructuredIntent } from "./ai-provider";

const arabicDigits: Record<string, string> = { "٠":"0", "١":"1", "٢":"2", "٣":"3", "٤":"4", "٥":"5", "٦":"6", "٧":"7", "٨":"8", "٩":"9" };
function normalizedNumbers(value: string) { return value.replace(/[٠-٩]/g, digit => arabicDigits[digit]); }

export function detectRequestedMedia(value: string) {
  const text = value.toLowerCase();
  if (/(?:صور|photos?|images?)/i.test(text)) return "IMAGES" as const;
  if (/(?:بروشور|brochure)/i.test(text)) return "BROCHURE" as const;
  if (/(?:الموقع|مكان|خريطة|map|location)/i.test(text)) return "MAP" as const;
  return undefined;
}

export function detectExplicitSalesSignals(value: string) {
  const phone = value.match(/(?:\+?20|0)?1[0125]\d{8}/)?.[0];
  const arabicName = value.match(
    /اسمي\s+(.+?)(?=\s+(?:ورقمي|ورقم|رقمي)|[.,،]|$)/iu,
  )?.[1];
  const englishName = value.match(
    /my name is\s+(.+?)(?=\s+(?:and my (?:phone|number)|phone|number)|[.,،]|$)/iu,
  )?.[1];
  const strongIntent =
    /(?:جاهز\s*(?:أشتري|اشتري)|عايز\s*(?:أحجز|احجز)|كلمني|تواصلوا?\s*معي|معاينة|book|reserve|contact me|ready to buy)/iu.test(
      value,
    );
  return {
    contactPhone: phone,
    contactName: (arabicName ?? englishName)?.trim(),
    purchaseIntent: strongIntent ? 90 : undefined,
  };
}

export function detectExplicitRouteRequest(value: string) {
  const match = value.match(
    /(?:المسافة|الوقت|قد\s*إيه|كام|how far|distance|route).*?(?:من|from)\s+(.+?)\s+(?:إلى|الى|لـ|to)\s+(.+?)(?:\?|؟|$)/iu,
  );
  return match
    ? {
        exactRouteRequested: true as const,
        routeOrigin: match[1].trim(),
        routeDestination: match[2]
          .replace(/\s+(?:كام|قد\s*إيه|how far)$/iu, "")
          .trim(),
      }
    : undefined;
}

export function deterministicIntent(messages: AIMessage[], previous: StructuredIntent): StructuredIntent {
  const source = messages.at(-1)?.content ?? "";
  const text = normalizedNumbers(source.toLowerCase());
  const hasArabic = /[\u0600-\u06ff]/.test(text);
  const hasLatin = /[a-z]/.test(text);
  const millions = [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:m|mn|million|مليون)/g)].map(match => Number(match[1].replace(",", ".")) * 1_000_000);
  const range = text.match(/(\d+(?:[.,]\d+)?)\s*(?:ل(?:حد|ـ)?|to|[-–])\s*(\d+(?:[.,]\d+)?)\s*(?:m|mn|million|مليون)/);
  const bedroom = text.match(/(\d+)\s*(?:bed(?:room)?s?|غرف(?:ة|تين)?|نوم)/);
  const sales = detectExplicitSalesSignals(source);
  const route = detectExplicitRouteRequest(source);
  return {
    ...previous,
    requestedMedia: detectRequestedMedia(text),
    exactRouteRequested: route?.exactRouteRequested ?? (/(?:بعيد|مسافة|وقت|route|distance|how far)/i.test(text) || undefined),
    routeOrigin: route?.routeOrigin,
    routeDestination: route?.routeDestination,
    language: hasArabic ? "ar-EG" : "en",
    dialect: hasArabic && hasLatin ? "MIXED" : hasArabic ? "EGYPTIAN_ARABIC" : "ENGLISH",
    purpose: /(?:استثمار|investment|resale)/i.test(text) ? "INVESTMENT" : previous.purpose,
    bedrooms: bedroom ? Number(bedroom[1]) : previous.bedrooms,
    budgetMin: range ? Number(range[1].replace(",", ".")) * 1_000_000 : previous.budgetMin,
    budgetMax: range ? Number(range[2].replace(",", ".")) * 1_000_000 : millions.at(-1) ?? previous.budgetMax,
    currency: millions.length || range ? "EGP" : previous.currency,
    purchaseIntent: sales.purchaseIntent ?? (/(?:احجز|حجز|معاينة|كلمني|مهتم|book|reserve|viewing|contact me)/i.test(text) ? 85 : previous.purchaseIntent ?? 0),
    contactPhone: sales.contactPhone ?? previous.contactPhone,
    contactName: sales.contactName ?? previous.contactName,
    extractionDegraded: true,
  };
}
