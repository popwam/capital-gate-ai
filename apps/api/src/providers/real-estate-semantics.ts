import { StructuredIntent } from "./ai-provider";

const arabicDigits: Record<string, string> = { "٠":"0", "١":"1", "٢":"2", "٣":"3", "٤":"4", "٥":"5", "٦":"6", "٧":"7", "٨":"8", "٩":"9" };
const numberText = (value: string) => value.replace(/[٠-٩]/g, (digit) => arabicDigits[digit]);

export function normalizeRealEstateSemantics(
  source: string,
  extracted: StructuredIntent,
  previous: StructuredIntent,
): StructuredIntent {
  const text = numberText(source.toLowerCase()).replace(/م²|م٢/g, "متر");
  const next: StructuredIntent = {
    ...previous,
    ...extracted,
    requestedMedia: extracted.requestedMedia,
    exactRouteRequested: extracted.exactRouteRequested,
    routeOrigin: extracted.routeOrigin,
    routeDestination: extracted.routeDestination,
    temporaryIntent: undefined,
    aggregationDimension: undefined,
  };

  const clearArea = /(?:مش فارقة|مش مهم(?:ة)?|الغ[يِ]|شيل|من غير)\s+(?:لي\s+)?(?:المساحة|مساحة)/u.test(text);
  if (clearArea) {
    delete next.minimumArea;
    delete next.maximumArea;
    delete next.builtUpAreaMin;
    delete next.builtUpAreaMax;
    delete next.targetBuiltUpArea;
  }

  const unitAreaContext = /(?:مساح(?:ة|تها|ته|ات)|متر(?:\s*مربع)?|\d+\s*م(?:\b|\s)|أكبر\s+من\s+\d+)/u.test(text)
    && !/(?:منطق(?:ة|تها)|مناطق|لوكيشن|location)/iu.test(text);
  if (unitAreaContext && !clearArea) {
    const range = text.match(/(?:مساح(?:ة|ات).*?)?(\d+(?:[.,]\d+)?)\s*(?:متر)?\s*(?:ل(?:ـ|حد)?|إلى|الى|to|[-–])\s*(\d+(?:[.,]\d+)?)\s*(?:متر)?/u);
    const minimum = text.match(/(?:فوق|أكبر\s+من|اكثر\s+من|أكثر\s+من|minimum|min(?:imum)?)\s*(\d+(?:[.,]\d+)?)\s*(?:متر|م\b)?/iu);
    const maximum = text.match(/(?:تحت|أقل\s+من|اقل\s+من|maximum|max(?:imum)?)\s*(\d+(?:[.,]\d+)?)\s*(?:متر|م\b)?/iu);
    const target = text.match(/(?:حوالي|تقريب(?:ا|اً)?|around|about)\s*(\d+(?:[.,]\d+)?)\s*(?:متر|م\b)/iu);
    if (range) {
      next.builtUpAreaMin = Number(range[1].replace(",", "."));
      next.builtUpAreaMax = Number(range[2].replace(",", "."));
    } else {
      if (minimum) next.builtUpAreaMin = Number(minimum[1].replace(",", "."));
      if (maximum) next.builtUpAreaMax = Number(maximum[1].replace(",", "."));
      if (target) next.targetBuiltUpArea = Number(target[1].replace(",", "."));
    }
    next.minimumArea = next.builtUpAreaMin;
    next.maximumArea = next.builtUpAreaMax;
  }

  const asksAvailable = /(?:إيه|ايه|اي|ما|كام|قد\s*إيه|what|available|المتاحة|المتوفر(?:ة)?|الموجود(?:ة)?|عندك)/iu.test(text);
  if (asksAvailable) {
    let dimension: StructuredIntent["aggregationDimension"];
    if (/(?:المساحات|مساحات|مساحه|المساحة\s+(?:كام|قد\s*إيه))/u.test(text)) dimension = "BUILT_UP_AREA";
    else if (/(?:المناطق|مناطق|لوكيشن|locations?)/iu.test(text)) dimension = "LOCATION";
    else if (/(?:الأسعار|الاسعار|أسعار|prices?)/iu.test(text)) dimension = "PRICE";
    else if (/(?:المشاريع|مشاريع|projects?)/iu.test(text)) dimension = "PROJECT";
    else if (/(?:المطورين|المطورون|developers?)/iu.test(text)) dimension = "DEVELOPER";
    else if (/(?:أنواع\s+الوحدات|انواع\s+الوحدات|unit types?)/iu.test(text)) dimension = "UNIT_TYPE";
    else if (/(?:مواعيد\s+التسليم|delivery dates?)/iu.test(text)) dimension = "DELIVERY_DATE";
    else if (/(?:مدد\s+السداد|سنين\s+التقسيط|payment durations?)/iu.test(text)) dimension = "PAYMENT_DURATION";
    else if (/(?:عدد\s+الغرف|غرف\s+النوم|bedroom counts?)/iu.test(text)) dimension = "BEDROOM_COUNT";
    if (dimension) {
      next.temporaryIntent = "INVENTORY_AGGREGATION";
      next.aggregationDimension = dimension;
    }
  }
  return next;
}
