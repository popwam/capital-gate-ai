export const SUPPORTED_CURRENCIES = ["EGP", "USD", "EUR", "AED", "SAR", "GBP"] as const;
export const UNIT_TYPES = ["Apartment", "Duplex", "Penthouse", "Studio", "Townhouse", "Twin House", "Standalone Villa", "Chalet", "Office", "Retail", "Clinic", "Other"] as const;
export const FINISHING_TYPES = ["FINISHED", "SEMI_FINISHED", "CORE_AND_SHELL", "FULLY_FINISHED", "FURNISHED", "UNKNOWN"] as const;
export const AVAILABILITY_TYPES = ["AVAILABLE", "RESERVED", "SOLD", "UNAVAILABLE", "CONTACT_SALES"] as const;
export type PaymentPlanValueType = "TOTAL_PRICE" | "INSTALLMENT_AMOUNT" | "DOWN_PAYMENT_AMOUNT" | "DOWN_PAYMENT_PERCENT" | "MAINTENANCE_AMOUNT" | "MAINTENANCE_PERCENT";

export const CANONICAL_FIELDS = [
  { value: "externalUnitId", group: "هوية الوحدة", labelAr: "كود الوحدة", labelEn: "Unit external ID", type: "TEXT" },
  { value: "phase", group: "المشروع والمطور", labelAr: "المرحلة", labelEn: "Phase", type: "TEXT" },
  { value: "cluster", group: "المشروع والمطور", labelAr: "المجموعة", labelEn: "Cluster", type: "TEXT" },
  { value: "building", group: "هوية الوحدة", labelAr: "المبنى", labelEn: "Building", type: "TEXT" },
  { value: "floor", group: "هوية الوحدة", labelAr: "الدور", labelEn: "Floor", type: "TEXT" },
  { value: "unitType", group: "نوع الوحدة", labelAr: "نوع الوحدة", labelEn: "Unit type", type: "ENUM_SELECT" },
  { value: "unitSubType", group: "نوع الوحدة", labelAr: "النوع الفرعي", labelEn: "Unit subtype", type: "TEXT" },
  { value: "bedrooms", group: "الغرف والحمامات", labelAr: "غرف النوم", labelEn: "Bedrooms", type: "NUMBER" },
  { value: "bathrooms", group: "الغرف والحمامات", labelAr: "الحمامات", labelEn: "Bathrooms", type: "NUMBER" },
  { value: "builtUpArea", group: "المساحات", labelAr: "المساحة المبنية", labelEn: "Built-up area", type: "NUMBER" },
  { value: "landArea", group: "المساحات", labelAr: "مساحة الأرض", labelEn: "Land area", type: "NUMBER" },
  { value: "gardenArea", group: "المساحات", labelAr: "مساحة الحديقة", labelEn: "Garden area", type: "NUMBER" },
  { value: "roofArea", group: "المساحات", labelAr: "مساحة الروف", labelEn: "Roof area", type: "NUMBER" },
  { value: "terraceArea", group: "المساحات", labelAr: "مساحة التراس", labelEn: "Terrace area", type: "NUMBER" },
  { value: "price", group: "السعر", labelAr: "السعر الرسمي", labelEn: "Official price", type: "NUMBER" },
  { value: "currency", group: "السعر", labelAr: "العملة", labelEn: "Currency", type: "CURRENCY_SELECT" },
  { value: "status", group: "حالة الوحدة", labelAr: "حالة الوحدة", labelEn: "Availability", type: "ENUM_SELECT" },
  { value: "deliveryDate", group: "التسليم", labelAr: "تاريخ التسليم", labelEn: "Delivery date", type: "DATE" },
  { value: "deliveryYears", group: "التسليم", labelAr: "سنوات التسليم", labelEn: "Delivery years", type: "NUMBER" },
  { value: "finishingType", group: "التشطيب", labelAr: "نوع التشطيب", labelEn: "Finishing type", type: "ENUM_SELECT" },
  { value: "downPayment", group: "خطط السداد", labelAr: "مبلغ المقدم", labelEn: "Down payment amount", type: "NUMBER" },
  { value: "installmentYears", group: "خطط السداد", labelAr: "مدة التقسيط بالسنوات", labelEn: "Installment years", type: "NUMBER" },
  { value: "installmentAmount", group: "خطط السداد", labelAr: "قيمة القسط", labelEn: "Installment amount", type: "NUMBER" },
  { value: "maintenance", group: "خطط السداد", labelAr: "قيمة الصيانة", labelEn: "Maintenance amount", type: "NUMBER" },
  { value: "clubFees", group: "معلومات إضافية", labelAr: "رسوم النادي", labelEn: "Club fees", type: "NUMBER" },
  { value: "discount", group: "معلومات إضافية", labelAr: "الخصم", labelEn: "Discount", type: "NUMBER" },
  { value: "offerText", group: "معلومات إضافية", labelAr: "تفاصيل العرض", labelEn: "Offer details", type: "TEXT" },
] as const;

export const CANONICAL_VALUES = CANONICAL_FIELDS.map((field) => field.value);

export function parsePaymentPlanHeader(source: string) {
  const normalized = source.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!/(?:price|unit price|سعر)/iu.test(normalized)) return undefined;
  const years = normalized.match(/(?:price\s*)?(\d+(?:\.\d+)?)\s*(?:y|yr|yrs|year|years|سنة|سنوات)/iu)
    ?? normalized.match(/(\d+(?:\.\d+)?)\s*(?:y|yr|yrs|year|years|سنة|سنوات).*?(?:price|سعر)/iu);
  const months = normalized.match(/(?:price\s*)?(\d+)\s*(?:m|mo|mos|month|months|شهر|شهور)/iu)
    ?? normalized.match(/(\d+)\s*(?:m|mo|mos|month|months|شهر|شهور).*?(?:price|سعر)/iu);
  const durationMonths = months ? Number(months[1]) : years ? Math.round(Number(years[1]) * 12) : undefined;
  if (!durationMonths || durationMonths < 18 || durationMonths > 180) return undefined;
  return { durationMonths, valueType: "TOTAL_PRICE" as const, sourceDurationText: months?.[0] ?? years?.[0] ?? source };
}

export function parsePaymentPlanComponentHeader(source: string): { durationMonths?: number; valueType: PaymentPlanValueType; sourceDurationText: string } | undefined {
  const price = parsePaymentPlanHeader(source);
  if (price) return price;
  const normalized = source.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  const percent = /%|percent|percentage|نسبة/u.test(normalized);
  if (/(?:down payment|\bdp\b|مقدم|نسبة المقدم)/iu.test(normalized)) return { valueType: percent ? "DOWN_PAYMENT_PERCENT" : "DOWN_PAYMENT_AMOUNT", sourceDurationText: source };
  if (/(?:maintenance|صيانة|وديعة الصيانة)/iu.test(normalized)) return { valueType: percent ? "MAINTENANCE_PERCENT" : "MAINTENANCE_AMOUNT", sourceDurationText: source };
  if (/(?:installment amount|قيمة القسط|\binstallment\b|\bقسط\b)/iu.test(normalized)) return { valueType: "INSTALLMENT_AMOUNT", sourceDurationText: source };
  return undefined;
}

export function parseImportDate(value: unknown): Date | undefined {
  if (value == null || value === "") return undefined;
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  if (typeof value === "number" && value > 0) {
    const parsed = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86_400_000);
    return Number.isNaN(parsed.valueOf()) ? undefined : parsed;
  }
  const text = String(value).trim();
  let match = text.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (match) {
    const date = new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])));
    return date.getUTCFullYear() === Number(match[3]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[1]) ? date : undefined;
  }
  match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const date = new Date(`${text}T00:00:00.000Z`);
    return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]) ? date : undefined;
  }
  return undefined;
}

export function normalizeFinishing(value: unknown) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return undefined;
  if (/semi|نصف/.test(text)) return "SEMI_FINISHED";
  if (/core|shell|بدون تشطيب/.test(text)) return "CORE_AND_SHELL";
  if (/furnish|مفروش/.test(text)) return "FURNISHED";
  if (/fully|تشطيب كامل/.test(text)) return "FULLY_FINISHED";
  if (/finish|متشطب/.test(text)) return "FINISHED";
  return "UNKNOWN";
}

export function normalizeUnitType(value: unknown) {
  const text = String(value ?? "").trim();
  const normalized = text.toLowerCase().replace(/[_-]+/g, " ");
  const aliases: Record<string, string> = { apt: "Apartment", apartment: "Apartment", شقة: "Apartment", duplex: "Duplex", دوبلكس: "Duplex", penthouse: "Penthouse", studio: "Studio", th: "Townhouse", townhouse: "Townhouse", tw: "Twin House", "twin house": "Twin House", villa: "Standalone Villa", "standalone villa": "Standalone Villa", chalet: "Chalet", office: "Office", retail: "Retail", clinic: "Clinic" };
  return aliases[normalized] ?? text;
}
