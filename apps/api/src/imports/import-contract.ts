export const SUPPORTED_CURRENCIES = ["EGP", "USD", "EUR", "AED", "SAR", "GBP", "QAR", "KWD", "BHD", "OMR"] as const;

export const UNIT_TYPES = [
  "Apartment", "Studio", "Duplex", "Triplex", "Penthouse", "Loft", "Sky Villa", "Garden Apartment",
  "Townhouse", "Twin House", "Standalone Villa", "Mansion", "Palace", "Chalet", "Cabin", "Beach House",
  "Serviced Apartment", "Hotel Apartment", "Branded Residence", "Student Housing", "Senior Living",
  "Office", "Administrative Office", "Co-working Space", "Retail", "Shop", "Showroom", "Restaurant", "Cafe",
  "Clinic", "Medical Center", "Pharmacy", "Laboratory", "Warehouse", "Factory", "Workshop", "Logistics Unit",
  "Land", "Residential Land", "Commercial Land", "Agricultural Land", "Mixed-use", "Other",
] as const;

export const FINISHING_TYPES = [
  "CORE_AND_SHELL", "SHELL_AND_CORE", "SEMI_FINISHED", "FINISHED", "FULLY_FINISHED", "ULTRA_LUX",
  "FURNISHED", "FULLY_FURNISHED", "HOTEL_FINISHED", "CUSTOM_FINISH", "UNKNOWN",
] as const;

export const AVAILABILITY_TYPES = ["AVAILABLE", "RESERVED", "SOLD", "UNAVAILABLE", "CONTACT_SALES"] as const;
export type PaymentPlanValueType = "TOTAL_PRICE" | "INSTALLMENT_AMOUNT" | "DOWN_PAYMENT_AMOUNT" | "DOWN_PAYMENT_PERCENT" | "MAINTENANCE_AMOUNT" | "MAINTENANCE_PERCENT";
export type CanonicalStorage = "UNIT" | "METADATA";

export type CanonicalField = {
  value: string;
  group: string;
  labelAr: string;
  labelEn: string;
  type: string;
  storage?: CanonicalStorage;
  keywords?: string[];
};

const field = (value: string, group: string, labelAr: string, labelEn: string, type = "TEXT", storage: CanonicalStorage = "UNIT", keywords: string[] = []): CanonicalField => ({ value, group, labelAr, labelEn, type, storage, keywords });

/**
 * Canonical inventory vocabulary. Core fields map to Unit columns. The broader real-estate vocabulary is preserved
 * under Unit.sourceMetadata so an import never has to throw away a valid business column just because it is not a
 * first-class SQL column yet. Admins can also create META:<label> mappings for uncommon broker/developer fields.
 */
export const CANONICAL_FIELDS: CanonicalField[] = [
  field("externalUnitId", "الهوية والمرجع", "كود / مرجع الوحدة", "Unit external ID", "TEXT", "UNIT", ["unit id", "unit no", "reference", "كود", "رقم الوحدة"]),
  field("propertyReference", "الهوية والمرجع", "مرجع العقار", "Property reference", "TEXT", "METADATA"),
  field("unitNumber", "الهوية والمرجع", "رقم الوحدة داخل المبنى", "Unit number", "TEXT", "METADATA"),
  field("plotNumber", "الهوية والمرجع", "رقم القطعة", "Plot number", "TEXT", "METADATA"),
  field("parcelNumber", "الهوية والمرجع", "رقم الحوض / القسيمة", "Parcel number", "TEXT", "METADATA"),
  field("phase", "الهيكل داخل المشروع", "المرحلة", "Phase", "TEXT"),
  field("cluster", "الهيكل داخل المشروع", "المجموعة / الكلاستر", "Cluster", "TEXT"),
  field("zone", "الهيكل داخل المشروع", "المنطقة / الزون", "Zone", "TEXT", "METADATA"),
  field("block", "الهيكل داخل المشروع", "البلوك", "Block", "TEXT", "METADATA"),
  field("building", "الهيكل داخل المشروع", "المبنى", "Building", "TEXT"),
  field("buildingCode", "الهيكل داخل المشروع", "كود المبنى", "Building code", "TEXT", "METADATA"),
  field("floor", "الهيكل داخل المشروع", "الدور", "Floor", "TEXT"),
  field("floorFrom", "الهيكل داخل المشروع", "من دور", "Floor from", "NUMBER", "METADATA"),
  field("floorTo", "الهيكل داخل المشروع", "إلى دور", "Floor to", "NUMBER", "METADATA"),
  field("gate", "الهيكل داخل المشروع", "البوابة الأقرب / التابعة", "Gate", "TEXT", "METADATA"),
  field("internalLocation", "الهيكل داخل المشروع", "وصف الموقع الداخلي", "Internal location", "TEXT", "METADATA"),

  field("unitType", "نوع واستخدام العقار", "نوع الوحدة", "Unit type", "ENUM_SELECT"),
  field("unitSubType", "نوع واستخدام العقار", "النوع الفرعي", "Unit subtype"),
  field("propertyUse", "نوع واستخدام العقار", "استخدام العقار", "Property use", "TEXT", "METADATA", ["residential", "commercial", "medical", "administrative"]),
  field("ownershipType", "نوع واستخدام العقار", "نوع الملكية", "Ownership type", "TEXT", "METADATA"),
  field("saleType", "نوع واستخدام العقار", "نوع البيع Primary / Resale", "Sale type", "TEXT", "METADATA"),
  field("sellerType", "نوع واستخدام العقار", "نوع البائع", "Seller type", "TEXT", "METADATA"),
  field("commercialActivity", "نوع واستخدام العقار", "النشاط التجاري", "Commercial activity", "TEXT", "METADATA"),
  field("licenseType", "نوع واستخدام العقار", "نوع الترخيص", "License type", "TEXT", "METADATA"),

  field("bedrooms", "الغرف والتقسيم", "غرف النوم", "Bedrooms", "NUMBER"),
  field("bathrooms", "الغرف والتقسيم", "الحمامات", "Bathrooms", "NUMBER"),
  field("maidRooms", "الغرف والتقسيم", "غرف المربية", "Maid rooms", "NUMBER", "METADATA"),
  field("driverRooms", "الغرف والتقسيم", "غرف السائق", "Driver rooms", "NUMBER", "METADATA"),
  field("livingRooms", "الغرف والتقسيم", "غرف المعيشة", "Living rooms", "NUMBER", "METADATA"),
  field("kitchens", "الغرف والتقسيم", "عدد المطابخ", "Kitchens", "NUMBER", "METADATA"),
  field("parkingSpaces", "الغرف والتقسيم", "أماكن الركن", "Parking spaces", "NUMBER", "METADATA"),
  field("storageRooms", "الغرف والتقسيم", "غرف التخزين", "Storage rooms", "NUMBER", "METADATA"),

  field("builtUpArea", "المساحات", "المساحة المبنية BUA", "Built-up area", "NUMBER"),
  field("netArea", "المساحات", "المساحة الصافية", "Net area", "NUMBER", "METADATA"),
  field("grossArea", "المساحات", "المساحة الإجمالية", "Gross area", "NUMBER", "METADATA"),
  field("landArea", "المساحات", "مساحة الأرض", "Land area", "NUMBER"),
  field("gardenArea", "المساحات", "مساحة الحديقة", "Garden area", "NUMBER"),
  field("roofArea", "المساحات", "مساحة الروف", "Roof area", "NUMBER"),
  field("terraceArea", "المساحات", "مساحة التراس", "Terrace area", "NUMBER"),
  field("balconyArea", "المساحات", "مساحة البلكونة", "Balcony area", "NUMBER", "METADATA"),
  field("basementArea", "المساحات", "مساحة البدروم", "Basement area", "NUMBER", "METADATA"),
  field("garageArea", "المساحات", "مساحة الجراج", "Garage area", "NUMBER", "METADATA"),
  field("commonArea", "المساحات", "نصيب المساحات المشتركة", "Common area", "NUMBER", "METADATA"),
  field("frontageWidth", "المساحات", "عرض الواجهة", "Frontage width", "NUMBER", "METADATA"),
  field("ceilingHeight", "المساحات", "ارتفاع السقف", "Ceiling height", "NUMBER", "METADATA"),

  field("price", "السعر والقيمة", "السعر الرسمي", "Official price", "NUMBER"),
  field("originalPrice", "السعر والقيمة", "السعر قبل الخصم", "Original price", "NUMBER", "METADATA"),
  field("pricePerSqm", "السعر والقيمة", "سعر المتر", "Price per sqm", "NUMBER", "METADATA"),
  field("currency", "السعر والقيمة", "العملة", "Currency", "CURRENCY_SELECT"),
  field("reservationAmount", "السعر والقيمة", "مبلغ الحجز", "Reservation amount", "NUMBER", "METADATA"),
  field("discount", "السعر والقيمة", "قيمة الخصم", "Discount amount", "NUMBER"),
  field("discountPercent", "السعر والقيمة", "نسبة الخصم", "Discount percent", "NUMBER", "METADATA"),
  field("maintenance", "السعر والقيمة", "قيمة الصيانة", "Maintenance amount", "NUMBER"),
  field("maintenancePercent", "السعر والقيمة", "نسبة الصيانة", "Maintenance percent", "NUMBER", "METADATA"),
  field("clubFees", "السعر والقيمة", "رسوم النادي", "Club fees", "NUMBER"),
  field("transferFees", "السعر والقيمة", "رسوم التنازل / التحويل", "Transfer fees", "NUMBER", "METADATA"),
  field("brokerCommission", "السعر والقيمة", "عمولة الوسيط", "Broker commission", "NUMBER", "METADATA"),
  field("offerText", "السعر والقيمة", "تفاصيل العرض", "Offer details", "TEXTAREA"),

  field("status", "الحالة والإتاحة", "حالة / إتاحة الوحدة", "Availability", "ENUM_SELECT"),
  field("availabilityDate", "الحالة والإتاحة", "تاريخ آخر إتاحة", "Availability date", "DATE", "METADATA"),
  field("unitCondition", "الحالة والإتاحة", "حالة العقار", "Unit condition", "TEXT", "METADATA"),
  field("occupancyStatus", "الحالة والإتاحة", "حالة الإشغال", "Occupancy status", "TEXT", "METADATA"),
  field("readyToMove", "الحالة والإتاحة", "جاهز للاستلام", "Ready to move", "BOOLEAN", "METADATA"),
  field("lastUpdated", "الحالة والإتاحة", "آخر تحديث للمخزون", "Last inventory update", "DATE", "METADATA"),

  field("deliveryDate", "التسليم والإنشاء", "تاريخ التسليم", "Delivery date", "DATE"),
  field("deliveryYear", "التسليم والإنشاء", "سنة التسليم", "Delivery year", "NUMBER", "METADATA"),
  field("deliveryYears", "التسليم والإنشاء", "مدة التسليم بالسنوات", "Delivery years", "NUMBER"),
  field("launchDate", "التسليم والإنشاء", "تاريخ الإطلاق", "Launch date", "DATE", "METADATA"),
  field("constructionPercentage", "التسليم والإنشاء", "نسبة التنفيذ", "Construction percentage", "NUMBER", "METADATA"),
  field("finishingType", "التسليم والإنشاء", "نوع التشطيب", "Finishing type", "ENUM_SELECT"),
  field("furnishingStatus", "التسليم والإنشاء", "حالة الفرش", "Furnishing status", "TEXT", "METADATA"),

  field("downPayment", "خطة السداد", "مبلغ المقدم", "Down payment amount", "NUMBER"),
  field("downPaymentPercent", "خطة السداد", "نسبة المقدم", "Down payment percent", "NUMBER", "METADATA"),
  field("installmentYears", "خطة السداد", "مدة التقسيط بالسنوات", "Installment years", "NUMBER"),
  field("installmentMonths", "خطة السداد", "مدة التقسيط بالشهور", "Installment months", "NUMBER", "METADATA"),
  field("installmentAmount", "خطة السداد", "قيمة القسط", "Installment amount", "NUMBER"),
  field("installmentFrequency", "خطة السداد", "دورية القسط", "Installment frequency", "TEXT", "METADATA"),
  field("firstInstallmentAfter", "خطة السداد", "أول قسط بعد", "First installment after", "TEXT", "METADATA"),
  field("balloonPayment", "خطة السداد", "دفعة استثنائية / Balloon", "Balloon payment", "NUMBER", "METADATA"),

  field("view", "المزايا والموقع", "الإطلالة", "View", "TEXT", "METADATA"),
  field("orientation", "المزايا والموقع", "الاتجاه", "Orientation", "TEXT", "METADATA"),
  field("facing", "المزايا والموقع", "واجهة على", "Facing", "TEXT", "METADATA"),
  field("cornerUnit", "المزايا والموقع", "وحدة ناصية", "Corner unit", "BOOLEAN", "METADATA"),
  field("privatePool", "المزايا والموقع", "حمام سباحة خاص", "Private pool", "BOOLEAN", "METADATA"),
  field("elevator", "المزايا والموقع", "مصعد", "Elevator", "BOOLEAN", "METADATA"),
  field("parkingType", "المزايا والموقع", "نوع الركن", "Parking type", "TEXT", "METADATA"),
  field("street", "المزايا والموقع", "الشارع", "Street", "TEXT", "METADATA"),
  field("district", "المزايا والموقع", "الحي / المنطقة", "District", "TEXT", "METADATA"),
  field("latitude", "المزايا والموقع", "Latitude", "Latitude", "NUMBER", "METADATA"),
  field("longitude", "المزايا والموقع", "Longitude", "Longitude", "NUMBER", "METADATA"),

  field("resalePremium", "إعادة البيع", "أوفر / Premium الريسيل", "Resale premium", "NUMBER", "METADATA"),
  field("paidAmount", "إعادة البيع", "المبلغ المدفوع", "Paid amount", "NUMBER", "METADATA"),
  field("remainingAmount", "إعادة البيع", "المبلغ المتبقي", "Remaining amount", "NUMBER", "METADATA"),
  field("remainingInstallments", "إعادة البيع", "الأقساط المتبقية", "Remaining installments", "TEXT", "METADATA"),
  field("nextInstallmentDate", "إعادة البيع", "موعد القسط القادم", "Next installment date", "DATE", "METADATA"),

  field("rentalPrice", "الإيجار والعائد", "قيمة الإيجار", "Rental price", "NUMBER", "METADATA"),
  field("rentalFrequency", "الإيجار والعائد", "دورية الإيجار", "Rental frequency", "TEXT", "METADATA"),
  field("currentRent", "الإيجار والعائد", "الإيجار الحالي", "Current rent", "NUMBER", "METADATA"),
  field("leaseEndDate", "الإيجار والعائد", "نهاية عقد الإيجار", "Lease end date", "DATE", "METADATA"),
  field("expectedYield", "الإيجار والعائد", "العائد المتوقع", "Expected yield", "NUMBER", "METADATA"),

  field("frontage", "تجاري وإداري", "نوع / وصف الواجهة", "Frontage", "TEXT", "METADATA"),
  field("footfall", "تجاري وإداري", "كثافة الحركة / Footfall", "Footfall", "TEXT", "METADATA"),
  field("floorLoad", "تجاري وإداري", "حمولة الأرضية", "Floor load", "NUMBER", "METADATA"),
  field("powerCapacity", "تجاري وإداري", "القدرة الكهربائية", "Power capacity", "TEXT", "METADATA"),
  field("hvac", "تجاري وإداري", "نظام التكييف HVAC", "HVAC", "TEXT", "METADATA"),

  field("salesAgent", "المصدر والملاحظات", "مسؤول المبيعات", "Sales agent", "TEXT", "METADATA"),
  field("broker", "المصدر والملاحظات", "الوسيط / البروكر", "Broker", "TEXT", "METADATA"),
  field("sourceUrl", "المصدر والملاحظات", "رابط المصدر", "Source URL", "TEXT", "METADATA"),
  field("titleDeedStatus", "القانوني والملكية", "حالة سند الملكية", "Title deed status", "TEXT", "METADATA"),
  field("registrationStatus", "القانوني والملكية", "حالة التسجيل العقاري", "Registration status", "TEXT", "METADATA"),
  field("registryNumber", "القانوني والملكية", "رقم التسجيل / الشهر العقاري", "Registry number", "TEXT", "METADATA"),
  field("ownershipShare", "القانوني والملكية", "نسبة الملكية", "Ownership share", "NUMBER", "METADATA"),
  field("tenureType", "القانوني والملكية", "نوع الحيازة", "Tenure type", "TEXT", "METADATA"),
  field("usufructYears", "القانوني والملكية", "مدة حق الانتفاع", "Usufruct years", "NUMBER", "METADATA"),
  field("mortgageStatus", "القانوني والملكية", "حالة الرهن", "Mortgage status", "TEXT", "METADATA"),
  field("mortgageBalance", "القانوني والملكية", "الرصيد المتبقي للرهن", "Mortgage balance", "NUMBER", "METADATA"),
  field("permitNumber", "القانوني والملكية", "رقم الترخيص", "Permit number", "TEXT", "METADATA"),
  field("permitStatus", "القانوني والملكية", "حالة الترخيص", "Permit status", "TEXT", "METADATA"),
  field("legalNotes", "القانوني والملكية", "ملاحظات قانونية", "Legal notes", "TEXTAREA", "METADATA"),

  field("sellableArea", "المساحات والأبعاد المتقدمة", "المساحة البيعية", "Sellable area", "NUMBER", "METADATA"),
  field("internalArea", "المساحات والأبعاد المتقدمة", "المساحة الداخلية", "Internal area", "NUMBER", "METADATA"),
  field("coveredArea", "المساحات والأبعاد المتقدمة", "المساحة المغطاة", "Covered area", "NUMBER", "METADATA"),
  field("plotWidth", "المساحات والأبعاد المتقدمة", "عرض الأرض", "Plot width", "NUMBER", "METADATA"),
  field("plotDepth", "المساحات والأبعاد المتقدمة", "عمق الأرض", "Plot depth", "NUMBER", "METADATA"),
  field("frontageLength", "المساحات والأبعاد المتقدمة", "طول الواجهة", "Frontage length", "NUMBER", "METADATA"),
  field("streetWidth", "المساحات والأبعاد المتقدمة", "عرض الشارع", "Street width", "NUMBER", "METADATA"),
  field("usableArea", "المساحات والأبعاد المتقدمة", "المساحة القابلة للاستخدام", "Usable area", "NUMBER", "METADATA"),
  field("sharedAreaPercent", "المساحات والأبعاد المتقدمة", "نسبة التحميل / المشترك", "Shared area percent", "NUMBER", "METADATA"),

  field("totalFloors", "المبنى والتجهيز", "إجمالي أدوار المبنى", "Total building floors", "NUMBER", "METADATA"),
  field("unitLevels", "المبنى والتجهيز", "عدد مستويات الوحدة", "Unit levels", "NUMBER", "METADATA"),
  field("buildingAge", "المبنى والتجهيز", "عمر المبنى", "Building age", "NUMBER", "METADATA"),
  field("yearBuilt", "المبنى والتجهيز", "سنة البناء", "Year built", "NUMBER", "METADATA"),
  field("renovationYear", "المبنى والتجهيز", "سنة آخر تجديد", "Renovation year", "NUMBER", "METADATA"),
  field("elevatorCount", "المبنى والتجهيز", "عدد المصاعد", "Elevator count", "NUMBER", "METADATA"),
  field("entranceCount", "المبنى والتجهيز", "عدد المداخل", "Entrance count", "NUMBER", "METADATA"),
  field("serviceEntrance", "المبنى والتجهيز", "مدخل خدمة", "Service entrance", "BOOLEAN", "METADATA"),
  field("loadingDock", "المبنى والتجهيز", "منطقة تحميل", "Loading dock", "BOOLEAN", "METADATA"),
  field("fireSafety", "المبنى والتجهيز", "نظام مكافحة الحريق", "Fire safety system", "TEXT", "METADATA"),
  field("securitySystem", "المبنى والتجهيز", "نظام الأمن", "Security system", "TEXT", "METADATA"),
  field("accessControl", "المبنى والتجهيز", "نظام التحكم بالدخول", "Access control", "TEXT", "METADATA"),

  field("electricityMeter", "المرافق والخدمات الفنية", "عداد كهرباء", "Electricity meter", "TEXT", "METADATA"),
  field("waterMeter", "المرافق والخدمات الفنية", "عداد مياه", "Water meter", "TEXT", "METADATA"),
  field("gasMeter", "المرافق والخدمات الفنية", "عداد غاز", "Gas meter", "TEXT", "METADATA"),
  field("electricityPhase", "المرافق والخدمات الفنية", "نوع الكهرباء / الفازات", "Electricity phase", "TEXT", "METADATA"),
  field("backupGenerator", "المرافق والخدمات الفنية", "مولد احتياطي", "Backup generator", "BOOLEAN", "METADATA"),
  field("solarPower", "المرافق والخدمات الفنية", "طاقة شمسية", "Solar power", "BOOLEAN", "METADATA"),
  field("smartHome", "المرافق والخدمات الفنية", "نظام منزل ذكي", "Smart home", "BOOLEAN", "METADATA"),
  field("internetReady", "المرافق والخدمات الفنية", "جاهزية الإنترنت / الفايبر", "Internet / fiber ready", "BOOLEAN", "METADATA"),
  field("centralAc", "المرافق والخدمات الفنية", "تكييف مركزي", "Central AC", "BOOLEAN", "METADATA"),
  field("waterPressureSystem", "المرافق والخدمات الفنية", "نظام ضغط المياه", "Water pressure system", "TEXT", "METADATA"),

  field("privateGarden", "المزايا الخاصة", "حديقة خاصة", "Private garden", "BOOLEAN", "METADATA"),
  field("privateRoof", "المزايا الخاصة", "روف خاص", "Private roof", "BOOLEAN", "METADATA"),
  field("privateTerrace", "المزايا الخاصة", "تراس خاص", "Private terrace", "BOOLEAN", "METADATA"),
  field("jacuzzi", "المزايا الخاصة", "جاكوزي", "Jacuzzi", "BOOLEAN", "METADATA"),
  field("storageIncluded", "المزايا الخاصة", "مخزن مشمول", "Storage included", "BOOLEAN", "METADATA"),
  field("parkingIncluded", "المزايا الخاصة", "ركن / جراج مشمول", "Parking included", "BOOLEAN", "METADATA"),
  field("parkingNumber", "المزايا الخاصة", "رقم مكان الركن", "Parking number", "TEXT", "METADATA"),
  field("seaView", "المزايا الخاصة", "إطلالة بحر", "Sea view", "BOOLEAN", "METADATA"),
  field("golfView", "المزايا الخاصة", "إطلالة جولف", "Golf view", "BOOLEAN", "METADATA"),
  field("lagoonView", "المزايا الخاصة", "إطلالة لاجون", "Lagoon view", "BOOLEAN", "METADATA"),
  field("parkView", "المزايا الخاصة", "إطلالة حديقة", "Park view", "BOOLEAN", "METADATA"),

  field("askingPrice", "إعادة البيع المتقدمة", "السعر المطلوب من البائع", "Seller asking price", "NUMBER", "METADATA"),
  field("developerRemaining", "إعادة البيع المتقدمة", "متبقي للمطور", "Remaining to developer", "NUMBER", "METADATA"),
  field("sellerCashRequired", "إعادة البيع المتقدمة", "كاش مطلوب للبائع", "Cash required by seller", "NUMBER", "METADATA"),
  field("transferEligibility", "إعادة البيع المتقدمة", "إمكانية التنازل", "Transfer eligibility", "TEXT", "METADATA"),
  field("transferApprovalStatus", "إعادة البيع المتقدمة", "حالة موافقة التنازل", "Transfer approval status", "TEXT", "METADATA"),
  field("ownerStatus", "إعادة البيع المتقدمة", "صفة المالك / البائع", "Owner / seller status", "TEXT", "METADATA"),
  field("resaleReason", "إعادة البيع المتقدمة", "سبب إعادة البيع", "Resale reason", "TEXT", "METADATA"),
  field("handoverReceived", "إعادة البيع المتقدمة", "تم استلام الوحدة", "Handover received", "BOOLEAN", "METADATA"),
  field("keysAvailable", "إعادة البيع المتقدمة", "المفاتيح متاحة", "Keys available", "BOOLEAN", "METADATA"),

  field("tenantStatus", "الإيجار والعائد المتقدم", "حالة المستأجر", "Tenant status", "TEXT", "METADATA"),
  field("tenantName", "الإيجار والعائد المتقدم", "اسم المستأجر", "Tenant name", "TEXT", "METADATA"),
  field("leaseStartDate", "الإيجار والعائد المتقدم", "بداية عقد الإيجار", "Lease start date", "DATE", "METADATA"),
  field("securityDeposit", "الإيجار والعائد المتقدم", "تأمين الإيجار", "Rental security deposit", "NUMBER", "METADATA"),
  field("annualRent", "الإيجار والعائد المتقدم", "الإيجار السنوي", "Annual rent", "NUMBER", "METADATA"),
  field("monthlyRent", "الإيجار والعائد المتقدم", "الإيجار الشهري", "Monthly rent", "NUMBER", "METADATA"),
  field("serviceCharges", "الإيجار والعائد المتقدم", "رسوم الخدمات", "Service charges", "NUMBER", "METADATA"),
  field("vacancyRate", "الإيجار والعائد المتقدم", "معدل الشغور", "Vacancy rate", "NUMBER", "METADATA"),
  field("netYield", "الإيجار والعائد المتقدم", "صافي العائد", "Net yield", "NUMBER", "METADATA"),
  field("grossYield", "الإيجار والعائد المتقدم", "إجمالي العائد", "Gross yield", "NUMBER", "METADATA"),

  field("businessType", "تجاري وإداري متقدم", "نوع النشاط", "Business type", "TEXT", "METADATA"),
  field("operatingLicense", "تجاري وإداري متقدم", "رخصة التشغيل", "Operating license", "TEXT", "METADATA"),
  field("signageRights", "تجاري وإداري متقدم", "حقوق اللافتات", "Signage rights", "TEXT", "METADATA"),
  field("outdoorArea", "تجاري وإداري متقدم", "مساحة خارجية", "Outdoor area", "NUMBER", "METADATA"),
  field("kitchenExtraction", "تجاري وإداري متقدم", "تجهيز شفط للمطاعم", "Kitchen extraction", "BOOLEAN", "METADATA"),
  field("greaseTrap", "تجاري وإداري متقدم", "Grease trap", "BOOLEAN", "METADATA"),
  field("officeGrade", "تجاري وإداري متقدم", "تصنيف المكتب", "Office grade", "TEXT", "METADATA"),
  field("retailCategory", "تجاري وإداري متقدم", "تصنيف الريتيل", "Retail category", "TEXT", "METADATA"),
  field("medicalLicenseEligible", "تجاري وإداري متقدم", "صالح لترخيص طبي", "Medical license eligible", "BOOLEAN", "METADATA"),

  field("warehouseClearHeight", "صناعي ولوجستي", "الارتفاع الصافي للمخزن", "Warehouse clear height", "NUMBER", "METADATA"),
  field("loadingBays", "صناعي ولوجستي", "عدد بوابات التحميل", "Loading bays", "NUMBER", "METADATA"),
  field("dockLeveler", "صناعي ولوجستي", "Dock leveler", "BOOLEAN", "METADATA"),
  field("yardArea", "صناعي ولوجستي", "مساحة الساحة", "Yard area", "NUMBER", "METADATA"),
  field("industrialPower", "صناعي ولوجستي", "قدرة كهرباء صناعية", "Industrial power", "TEXT", "METADATA"),
  field("craneCapacity", "صناعي ولوجستي", "حمولة الونش", "Crane capacity", "NUMBER", "METADATA"),

  field("sourceChannel", "المصدر والملاحظات", "قناة المصدر", "Source channel", "TEXT", "METADATA"),
  field("sourceContact", "المصدر والملاحظات", "جهة اتصال المصدر", "Source contact", "TEXT", "METADATA"),
  field("listingDate", "المصدر والملاحظات", "تاريخ الإدراج", "Listing date", "DATE", "METADATA"),
  field("listingExpiry", "المصدر والملاحظات", "انتهاء الإدراج", "Listing expiry", "DATE", "METADATA"),
  field("exclusiveListing", "المصدر والملاحظات", "تسويق حصري", "Exclusive listing", "BOOLEAN", "METADATA"),
  field("internalTags", "المصدر والملاحظات", "وسوم داخلية", "Internal tags", "TEXT", "METADATA"),
  field("qualityScore", "المصدر والملاحظات", "درجة جودة البيانات", "Data quality score", "NUMBER", "METADATA"),
  field("notes", "المصدر والملاحظات", "ملاحظات", "Notes", "TEXTAREA", "METADATA"),
];

export const CANONICAL_VALUES = CANONICAL_FIELDS.map((item) => item.value);
export const CANONICAL_FIELD_MAP = new Map(CANONICAL_FIELDS.map((item) => [item.value, item]));
export const METADATA_CANONICAL_VALUES = CANONICAL_FIELDS.filter((item) => item.storage === "METADATA").map((item) => item.value);
export const CORE_UNIT_CANONICAL_VALUES = CANONICAL_FIELDS.filter((item) => item.storage !== "METADATA").map((item) => item.value);

export function isCustomMetadataField(value: string) {
  return /^META:[^\r\n]{1,120}$/u.test(value);
}

export function customMetadataLabel(value: string) {
  return isCustomMetadataField(value) ? value.slice(5).trim() : undefined;
}

export function parsePaymentPlanHeader(source: string) {
  const normalized = source.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!/(?:price|unit price|سعر)/iu.test(normalized)) return undefined;
  const years = normalized.match(/(?:price\s*)?(\d+(?:\.\d+)?)\s*(?:y|yr|yrs|year|years|سنة|سنوات)/iu)
    ?? normalized.match(/(\d+(?:\.\d+)?)\s*(?:y|yr|yrs|year|years|سنة|سنوات).*?(?:price|سعر)/iu);
  const months = normalized.match(/(?:price\s*)?(\d+)\s*(?:m|mo|mos|month|months|شهر|شهور)/iu)
    ?? normalized.match(/(\d+)\s*(?:m|mo|mos|month|months|شهر|شهور).*?(?:price|سعر)/iu);
  const durationMonths = months ? Number(months[1]) : years ? Math.round(Number(years[1]) * 12) : undefined;
  if (!durationMonths || durationMonths < 1 || durationMonths > 360) return undefined;
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
  if (/ultra|الترا|سوبر لوكس/.test(text)) return "ULTRA_LUX";
  if (/semi|نصف/.test(text)) return "SEMI_FINISHED";
  if (/core|shell|بدون تشطيب/.test(text)) return "CORE_AND_SHELL";
  if (/hotel|فندقي/.test(text)) return "HOTEL_FINISHED";
  if (/fully furnished|مفروش بالكامل/.test(text)) return "FULLY_FURNISHED";
  if (/furnish|مفروش/.test(text)) return "FURNISHED";
  if (/fully|تشطيب كامل/.test(text)) return "FULLY_FINISHED";
  if (/finish|متشطب/.test(text)) return "FINISHED";
  return "UNKNOWN";
}

export function normalizeUnitType(value: unknown) {
  const text = String(value ?? "").trim();
  const normalized = text.toLowerCase().replace(/[_-]+/g, " ");
  const aliases: Record<string, string> = {
    apt: "Apartment", apartment: "Apartment", شقة: "Apartment", studio: "Studio", استوديو: "Studio",
    duplex: "Duplex", دوبلكس: "Duplex", triplex: "Triplex", penthouse: "Penthouse", بنتهاوس: "Penthouse",
    th: "Townhouse", townhouse: "Townhouse", "تاون هاوس": "Townhouse", tw: "Twin House", "twin house": "Twin House", "توين هاوس": "Twin House",
    villa: "Standalone Villa", "standalone villa": "Standalone Villa", فيلا: "Standalone Villa", mansion: "Mansion",
    chalet: "Chalet", شاليه: "Chalet", office: "Office", مكتب: "Office", retail: "Retail", shop: "Shop", محل: "Shop",
    clinic: "Clinic", عيادة: "Clinic", pharmacy: "Pharmacy", warehouse: "Warehouse", مخزن: "Warehouse", land: "Land", أرض: "Land", ارض: "Land",
  };
  return aliases[normalized] ?? text;
}
