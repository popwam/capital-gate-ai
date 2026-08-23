import { AIMessage, ProximityPreference, StructuredIntent } from "./ai-provider";

const arabicDigits: Record<string, string> = { "٠":"0", "١":"1", "٢":"2", "٣":"3", "٤":"4", "٥":"5", "٦":"6", "٧":"7", "٨":"8", "٩":"9" };
function normalizedNumbers(value: string) { return value.replace(/[٠-٩]/g, digit => arabicDigits[digit]); }

function explicitPropertyTypes(text: string): string[] | undefined {
  return /(?:شقه|شقة|apartment|flat)/iu.test(text) ? ["Apartment"]
    : /(?:عياده|عيادة|clinic)/iu.test(text) ? ["Clinics"]
    : /(?:فيلا|villa)/iu.test(text) ? ["Villa"]
    : /(?:تاون\s*هاوس|town\s*house)/iu.test(text) ? ["Townhouse"]
    : /(?:توين\s*هاوس|twin\s*house)/iu.test(text) ? ["Twin House"]
    : /(?:دوبلكس|duplex)/iu.test(text) ? ["Duplex"]
    : /(?:محل|retail|shop)/iu.test(text) ? ["Retail"]
    : /(?:مكتب|office)/iu.test(text) ? ["Office"]
    : undefined;
}

/**
 * Small, high-confidence patch that supplements successful model extraction.
 * It intentionally covers only explicit values with low ambiguity.
 */
export function highConfidenceIntentPatch(source: string): Partial<StructuredIntent> {
  const text = normalizedNumbers(source.toLowerCase());
  const patch: Partial<StructuredIntent> = {};
  const explicitMillionRange = text.match(/(\d+(?:[.,]\d+)?)\s*(?:ل(?:حد|ـ)?|to|[-–])\s*(\d+(?:[.,]\d+)?)\s*(?:m|mn|million|مليون)/iu);
  const shorthandMillionRange = text.match(/(?:ميزاني|سعر|فلوس|في\s+حدود|budget).*?(\d+(?:[.,]\d+)?)\s*(?:ل(?:حد|ـ)?|to|[-–])\s*(\d+(?:[.,]\d+)?)\s*م(?=\s|[؟?.,،]|$)/u);
  const range = explicitMillionRange ?? shorthandMillionRange;
  if (range) {
    patch.budgetMin = Number(range[1].replace(",", ".")) * 1_000_000;
    patch.budgetMax = Number(range[2].replace(",", ".")) * 1_000_000;
    patch.currency = "EGP";
  } else {
    const cap = text.match(/(?:ميزاني(?:ه|ة|تي)?|بادج(?:ت|يت)|ب(?:سعر|مبلغ)|في\s+حدود|budget(?:\s+of)?|under|اقل\s+من|أقل\s+من|تحت)\s*(?:حوالي\s*)?(\d+(?:[.,]\d+)?)\s*(?:مليون|m|mn|million)/iu);
    if (cap) {
      patch.budgetMax = Number(cap[1].replace(",", ".")) * 1_000_000;
      patch.currency = "EGP";
    }
  }
  const bedroom = text.match(/(\d+)\s*(?:bed(?:room)?s?|غرف(?:ه|ة)?\s*(?:نوم)?)/iu);
  if (bedroom) patch.bedrooms = Number(bedroom[1]);
  const propertyTypes = explicitPropertyTypes(text);
  if (propertyTypes) patch.propertyTypes = propertyTypes;
  const locationMatch = text.match(/(?:عاوز|عايز|محتاج|ابحث|دور|show|find).*?(?:\sفي\s|\sin\s)([\p{L}][\p{L}\s-]{2,45})(?:[؟?.,،]|$)/iu);
  const location = locationMatch?.[1]?.trim();
  if (location && !/(?:حدود|مليون|سعر|ميزاني|غرف|متر|مشروع|وحد)/iu.test(location)) patch.locations = [location];
  return patch;
}

export function detectRequestedMedia(value: string) {
  const text = value.toLowerCase();
  if (/(?:صور|photos?|images?)/i.test(text)) return "IMAGES" as const;
  if (/(?:بروشور|brochure)/i.test(text)) return "BROCHURE" as const;
  if (/(?:الموقع|مكان|خريطة|map|location)/i.test(text)) return "MAP" as const;
  return undefined;
}

export function detectExplicitSalesSignals(value: string) {
  const phone = value.match(/(?:\+?20|0)?1[0125]\d{8}/)?.[0];
  const arabicName = value.match(/اسمي\s+(.+?)(?=\s+(?:ورقمي|ورقم|رقمي)|[.,،]|$)/iu)?.[1];
  const englishName = value.match(/my name is\s+(.+?)(?=\s+(?:and my (?:phone|number)|phone|number)|[.,،]|$)/iu)?.[1];
  const strongIntent = /(?:جاهز\s*(?:أشتري|اشتري)|عايز\s*(?:أحجز|احجز)|كلمني|تواصلوا?\s*معي|معاينة|book|reserve|contact me|ready to buy)/iu.test(value);
  return { contactPhone: phone, contactName: (arabicName ?? englishName)?.trim(), purchaseIntent: strongIntent ? 90 : undefined };
}

export function detectExplicitRouteRequest(value: string) {
  const match = value.match(/(?:المسافة|الوقت|قد\s*إيه|كام|how far|distance|route).*?(?:من|from)\s+(.+?)\s+(?:إلى|الى|لـ|to)\s+(.+?)(?:\?|؟|$)/iu);
  return match ? { exactRouteRequested: true as const, routeOrigin: match[1].trim(), routeDestination: match[2].replace(/\s+(?:كام|قد\s*إيه|how far)$/iu, "").trim() } : undefined;
}

function proximityFromText(text: string): ProximityPreference[] | undefined {
  const values: ProximityPreference[] = [];
  const near = /(?:قريب(?:ه|ة)?|جنب|ناحيه|ناحية|near|close to)/iu.test(text);
  const far = /(?:بعيد(?:ه|ة)?|بعيده|away from|far from)/iu.test(text);
  const preference = far ? "FAR" : near ? "NEAR" : undefined;
  if (!preference) return undefined;
  const gate = text.match(/(?:البوابه|البوابة|بوابه|بوابة|gate)\s*(?:رقم\s*)?([a-z0-9\u0600-\u06ff-]+)?/iu);
  if (gate) values.push({ targetType: "GATE", targetName: gate[1]?.trim() || (/(?:الرئيسيه|الرئيسية|main)/iu.test(text) ? "MAIN_GATE" : undefined), preference });
  const amenity = text.match(/(?:الكلوب\s*هاوس|club\s*house|حمام\s*السباحه|حمام\s*السباحة|pool|الجيم|gym|الحديقه|الحديقة|park)/iu)?.[0];
  if (amenity) values.push({ targetType: "AMENITY", targetName: amenity, preference });
  if (/(?:نص\s*المشروع|منتصف\s*المشروع|وسط\s*الكمبوند|project center|center of (?:the )?compound)/iu.test(text)) values.push({ targetType: "PROJECT_CENTER", preference: "NEAR" });
  return values.length ? values : undefined;
}

export function deterministicIntent(messages: AIMessage[], previous: StructuredIntent): StructuredIntent {
  const source = messages.at(-1)?.content ?? "";
  const text = normalizedNumbers(source.toLowerCase());
  const hasArabic = /[\u0600-\u06ff]/.test(text);
  const hasLatin = /[a-z]/.test(text);
  const millions = [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:m|mn|million|مليون)/g)].map(match => Number(match[1].replace(",", ".")) * 1_000_000);
  const explicitMillionRange = text.match(/(\d+(?:[.,]\d+)?)\s*(?:ل(?:حد|ـ)?|to|[-–])\s*(\d+(?:[.,]\d+)?)\s*(?:m|mn|million|مليون)/);
  const shorthandMillionRange = text.match(/(?:ميزاني|سعر|فلوس|في\s+حدود|budget).*?(\d+(?:[.,]\d+)?)\s*(?:ل(?:حد|ـ)?|to|[-–])\s*(\d+(?:[.,]\d+)?)\s*م(?=\s|[؟?.,،]|$)/u);
  const range = explicitMillionRange ?? shorthandMillionRange;
  const bedroom = text.match(/(\d+)\s*(?:bed(?:room)?s?|غرف(?:ة|تين)?|نوم)/);
  const floor = text.match(/(?:الدور|طابق|floor)\s*(?:ال)?(\d+)/iu);
  const phase = text.match(/(?:phase|مرحله|مرحلة)\s*([a-z0-9\u0600-\u06ff-]+)/iu);
  const building = text.match(/(?:building|مبنى|عماره|عمارة)\s*([a-z0-9\u0600-\u06ff-]+)/iu);
  const gate = text.match(/(?:بوابه|بوابة|gate)\s*(?:رقم\s*)?(\d+)/iu);
  const paymentYears = text.match(/(?:تقسيط|سداد|على|payment).*?(\d+(?:[.,]\d+)?)\s*(?:سنه|سنة|سنين|years?|y\b)/iu);
  const paymentMonths = text.match(/(?:تقسيط|سداد|على|payment).*?(\d+)\s*(?:شهر|شهور|months?|mo\b)/iu);
  const sales = detectExplicitSalesSignals(source);
  const resale = /(?:ريسيل|ري\s*سيل|إعادة\s*بيع|اعادة\s*بيع|resale|secondary\s*market)/iu.test(text);
  const primary = /(?:primary|من\s+المطور|بيع\s+أول|بيع\s+اول|أول\s+بيع|اول\s+بيع|new\s+from\s+(?:the\s+)?developer)/iu.test(text);
  const route = detectExplicitRouteRequest(source);
  const propertyTypes = explicitPropertyTypes(text) ?? previous.propertyTypes;
  const locationMatch = text.match(/(?:عاوز|عايز|محتاج|ابحث|دور|show|find).*?(?:\sفي\s|\sin\s)([\p{L}][\p{L}\s-]{2,45})(?:[؟?.,،]|$)/iu);
  const locationCandidate = locationMatch?.[1]?.trim();
  const locations = locationCandidate && !/(?:حدود|مليون|سعر|ميزاني|غرف|متر|مشروع|وحد)/iu.test(locationCandidate) ? [locationCandidate] : previous.locations;
  return {
    ...previous,
    requestedMedia: detectRequestedMedia(text),
    exactRouteRequested: route?.exactRouteRequested ?? (/(?:بعيد|مسافة|وقت|route|distance|how far)/i.test(text) || undefined),
    routeOrigin: route?.routeOrigin,
    routeDestination: route?.routeDestination,
    language: hasArabic ? "ar-EG" : "en",
    dialect: hasArabic && hasLatin ? "MIXED" : hasArabic ? "EGYPTIAN_ARABIC" : "ENGLISH",
    purpose: /(?:استثمار|investment|resale|ريسيل|إعادة\s*بيع|اعادة\s*بيع)/iu.test(text) ? "INVESTMENT" : previous.purpose,
    inventoryMarket: resale ? "RESALE" : primary ? "PRIMARY" : previous.inventoryMarket,
    propertyTypes,
    locations,
    bedrooms: bedroom ? Number(bedroom[1]) : previous.bedrooms,
    preferredFloor: floor ? Number(floor[1]) : previous.preferredFloor,
    preferredPhase: phase?.[1]?.trim() ?? previous.preferredPhase,
    preferredBuilding: building?.[1]?.trim() ?? previous.preferredBuilding,
    preferredGate: gate ? `Gate ${gate[1]}` : previous.preferredGate,
    preferredPaymentDurationMonths: paymentMonths ? Number(paymentMonths[1]) : paymentYears ? Math.round(Number(paymentYears[1].replace(",", ".")) * 12) : previous.preferredPaymentDurationMonths,
    proximityPreferences: proximityFromText(text) ?? previous.proximityPreferences,
    budgetMin: range ? Number(range[1].replace(",", ".")) * 1_000_000 : previous.budgetMin,
    budgetMax: range ? Number(range[2].replace(",", ".")) * 1_000_000 : millions.at(-1) ?? previous.budgetMax,
    currency: millions.length || range ? "EGP" : previous.currency,
    purchaseIntent: sales.purchaseIntent ?? (/(?:احجز|حجز|معاينة|كلمني|مهتم|book|reserve|viewing|contact me)/i.test(text) ? 85 : previous.purchaseIntent ?? 0),
    contactPhone: sales.contactPhone ?? previous.contactPhone,
    contactName: sales.contactName ?? previous.contactName,
    extractionDegraded: true,
  };
}
