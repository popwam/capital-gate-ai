# دليل منصة AICG وبناء الـInventory

> مرجع عربي موحّد للمنصة، نموذج البيانات العقارية، طرق إدخال المخزون، الحقول والقيم المسموحة، ومتغيرات التشغيل.
>
> آخر مراجعة للكود: 2 سبتمبر 2026. مصدر الحقيقة لهذا الدليل هو الكود الحالي وPrisma schema وعقد الاستيراد، وليس ملفات المواصفات القديمة.

## 1. ما هي المنصة؟

AICG منصة عقارية عربية أولًا، تجمع بين:

- **Nadim V2:** مستشار عقاري حواري يفهم العربية والإنجليزية والصيغ المختلطة، ويستخدم مخزونًا موثقًا بدل اختراع وحدات أو أسعار.
- **Web Chat:** واجهة العميل للمحادثة، عرض بطاقات العقارات، المقارنات، الصور، خطط الدفع، روابط المشاركة، والمتابعة عبر WhatsApp.
- **Admin Dashboard:** إدارة المحادثات، المتطلبات العقارية، المتابعات، فرص البيع، المخزون، المطورين، المشروعات، المراحل، الوسائط، وخطط الدفع.
- **Inventory/Search:** بحث deterministic يعتمد على بيانات PostgreSQL الموثقة، مع فلترة نهائية قبل عرض أي بطاقة.
- **Import Pipeline:** رفع XLSX/XLS/CSV، تحليل الصفحات والجداول، ربط الأعمدة، معاينة، ثم تأكيد ذري داخل قاعدة البيانات.
- **Lifecycle/CRM:** Conversation وProperty Requirement وFollow-up وLead/Sales Opportunity كيانات منفصلة؛ وجود محادثة أو zero-match لا يعني تلقائيًا وجود فرصة بيع.
- **Action Layer:** تنفيذ الحجز/المعاينة/المتابعة عبر مسار مصرح به، مع القاعدة: `NO SUCCESS CLAIM WITHOUT SUCCESSFUL EXECUTION`.

### المكونات التقنية

| المكوّن | التقنية | المسؤولية |
|---|---|---|
| `apps/web` | Next.js / React | Web Chat وAdmin Dashboard وواجهات API same-origin |
| `apps/api` | NestJS / TypeScript | Nadim V2، البحث، المخزون، الاستيراد، CRM، الخرائط، التخزين |
| `apps/automation-api` | NestJS | تنفيذ العمليات الخارجية المصرح بها عند تفعيلها |
| `packages/database` | Prisma / PostgreSQL | مخطط البيانات والعلاقات وmigrations |
| Object Storage | R2 في production أو local في development | ملفات الاستيراد والوسائط والمستندات |
| AI Providers | Groq، Workers AI، OpenAI opt-in، Bedrock GLM opt-in | الفهم والصياغة مع ضوابط deterministic |

## 2. نموذج الـInventory

التسلسل الأساسي:

```text
Location
Developer
  └─ Project
      └─ Phase
          ├─ Zone
          ├─ Building
          └─ Unit
              ├─ Payment Plans
              ├─ Offers
              ├─ Media
              ├─ Price History
              └─ Source Metadata / Import Provenance
```

القيم العامة للمشروع تعمل كـdefaults. يمكن للمرحلة أن تحدد خطة دفع أو تسليم أو خصائص أدق، ويمكن للوحدة أن تحمل override نهائيًا خاصًا بها.

### الكيانات الرئيسية

| الكيان | وظيفته | أهم البيانات |
|---|---|---|
| Location | شجرة الدولة/المحافظة/المدينة/المنطقة | الاسم العربي والإنجليزي، aliases، الإحداثيات، Google Place ID |
| Developer | المطور العقاري | الاسم، slug، العلامة، معلومات التواصل والوصف |
| Project | المشروع | المطور، الموقع، الاسم، التسليم، الأنواع، المساحات، الحدود، المعرفة والوسائط |
| ProjectPhase | مرحلة داخل المشروع | الاسم/الكود، التسليم، الأنواع، التشطيب، النطاقات وخطط الدفع |
| ProjectZone | منطقة داخل master plan | الاسم/الكود، المرحلة، polygon |
| ProjectBuilding | مبنى داخل المشروع | الاسم/الكود، المرحلة/المنطقة، الموقع والمخطط |
| Unit | سجل المخزون الأساسي | الكود، المشروع، المرحلة، النوع، السعر، الإتاحة، المساحة، الغرف والتسليم |
| PaymentPlan | خطة دفع على مشروع أو مرحلة أو وحدة | المقدم، المدة، الدورية، الخصم، جدول النسب والصلاحية |
| Offer | عرض مرتبط بوحدة | العنوان، الوصف، الخصم، البداية والنهاية |
| Media | صورة/مخطط/فيديو/خريطة | الرابط، النوع، المالك، الغرض، النص البديل والترتيب |
| Document | Brochure/Payment Plan/Knowledge Source | الملف، اللغة، المشروع/المرحلة، فترة الصلاحية |
| DataImport | دفعة استيراد | الملف، الحالة، النتائج، mappings، المشاكل، التغييرات وrollback provenance |

### حقول طبقات الكتالوج قبل الوحدة

هذه حقول business القابلة للاستخدام في schema الحالية؛ العلاقات الداخلية وحقول `id/createdAt/updatedAt` لا تحتاج إدخالًا يدويًا.

#### Location

```text
type, name, canonicalName, nameAr, nameEn, formattedAddress, source,
slug, parentId, latitude, longitude, googlePlaceId
```

قيم `type`:

```text
COUNTRY, GOVERNORATE, CITY, AREA, SUBAREA
```

يمكن إضافة aliases متعددة لكل موقع مع `value`, `normalizedValue`, `language`, و`approvalStatus`.

#### Developer

```text
name, slug, description, canonicalName, nameAr, nameEn, shortName,
brandName, logoUrl, coverImageUrl, website, foundedYear, headquarters,
country, developerType, salesPhone, email, socialLinks,
shortDescriptionAr, shortDescriptionEn, fullDescriptionAr,
fullDescriptionEn, yearsInMarket
```

الحد الأدنى في Admin API هو `name + slug`.

#### Project

```text
developerId, locationId, name, canonicalName, nameAr, nameEn, slug,
shortDescription, description, shortDescriptionAr, shortDescriptionEn,
fullDescriptionAr, fullDescriptionEn, adminStatus, launchDate, launchYear,
officialWebsite, formattedAddress, googlePlaceId, latitude, longitude,
boundaryGeoJson, boundarySource, boundaryConfirmedAt,
masterPlanCalibration, projectStatus, projectType, projectTypes,
deliveryInformation, deliveryStatus, deliveryStatuses, deliveryDate,
deliveryYear, finishingOptions, totalLandArea, builtUpPercentage,
numberOfPhases, totalUnits, densityDescription, gatedCommunity, unitTypes,
minArea, maxArea, minBedrooms, maxBedrooms, priceSummary, paymentSummary,
maintenanceSummary, clubFeesSummary, customerFit, sourceMetadata
```

الحد الأدنى في Admin API هو `developerId + name + slug`. لكن `locationId` مطلوب في import workflow ويجب استكماله قبل اعتماد المخزون.

#### ProjectPhase

```text
projectId, code, name, nameAr, nameEn, sortOrder, launchYear,
deliveryYear, status, deliveryStatuses, projectTypes,
constructionPercentage, unitTypes, finishingOptions, customerFit,
minArea, maxArea, minBedrooms, maxBedrooms, descriptionAr,
descriptionEn, deliveryNotesAr, deliveryNotesEn, masterPlanPolygon,
sourceMetadata
```

يمكن ربط aliases بقيم المرحلة القادمة من ملفات المطور حتى لا يكرر Admin القرار مع كل صف.

#### ProjectZone وProjectBuilding

```text
ProjectZone:
projectId, phaseId, masterPlanPolygon, code, name, nameAr, nameEn, notes

ProjectBuilding:
projectId, phaseId, zoneId, code, name, nameAr, nameEn,
latitude, longitude, masterPlanX, masterPlanY, masterPlanPolygon,
masterPlanLocationSource, masterPlanConfirmedAt, notes
```

#### Unit: حقول قاعدة البيانات المباشرة

```text
externalUnitId, developerId, projectId, phase, phaseId, cluster,
building, floor, unitType, unitSubType, bedrooms, bathrooms,
builtUpArea, landArea, gardenArea, roofArea, terraceArea, price, currency,
status, isResale, deliveryDate, deliveryYears, finishingType,
downPayment, installmentYears, installmentAmount, maintenance, clubFees,
discount, offerText, latitude, longitude, masterPlanX, masterPlanY,
masterPlanLocationStatus, masterPlanLocationSource, masterPlanConfidence,
masterPlanConfirmedAt, internalLocationDescription, projectZoneId,
projectBuildingId, sourceImportId, archivedAt, sourceMetadata,
availabilityUpdatedAt
```

حقول master-plan confirmation و`sourceImportId` وtimestamps يديرها النظام عادةً ولا ينبغي تزويرها في ملف الاستيراد.

## 3. الحد الأدنى لبناء Inventory صالح

هناك فرق بين **المطلوب تقنيًا للحفظ** و**المطلوب لتجربة بحث جيدة**.

### 3.1 المتطلبات الصارمة في استيراد الملفات

لن تصبح دفعة الاستيراد جاهزة للتأكيد قبل وجود:

1. صفحة/جدول وصف عناوين صحيح.
2. `developerId` لمطور مسجل.
3. `projectId` لمشروع يتبع هذا المطور.
4. `locationId` لموقع المشروع.
5. مرحلة: إما `phaseId` ثابت للجدول أو عمود `phase` مربوط بمراحل المشروع.
6. عمود `externalUnitId` يميز كل وحدة.
7. عملة: عمود `currency` أو `defaultCurrency` للجدول.
8. قرار لكل عمود غير معروف: ربطه بحقل canonical، حفظه كـmetadata، أو تجاهله.
9. موافقة على أي payment-plan mapping مستخرج.
10. معاينة حديثة بعد آخر تعديل وقبل التأكيد.

### 3.2 المطلوب في الإدخال اليدوي

عقد إنشاء الوحدة اليدوي يطلب:

- `developerId`
- `projectId`
- `phaseId`

`externalUnitId` اختياري في الـAPI اليدوي؛ إذا ترك فارغًا ينشئ النظام كودًا يبدأ بـ`MANUAL-`. العملة الافتراضية `EGP`، والحالة الافتراضية `AVAILABLE`.

### 3.3 الحد الأدنى الموصى به لوحدة قابلة للبيع والبحث

| الأولوية | الحقل | السبب |
|---|---|---|
| إلزامي | `externalUnitId` | الهوية المستقرة للتحديث، الدفع، المقارنة والحجز |
| إلزامي | Developer + Project + Phase + Location | السياق الصحيح ومنع تسرب بيانات بين المشروعات |
| إلزامي عمليًا | `status` | لا تُعرض إلا الوحدة المتاحة وغير المؤرشفة |
| إلزامي عمليًا | `price` + `currency` | الفلترة والترتيب والبطاقات |
| موصى به جدًا | `unitType` | فهم شقة/فيلا/مكتب وغيرها |
| موصى به جدًا | `bedrooms`, `bathrooms` | مطابقة الطلبات السكنية |
| موصى به جدًا | `builtUpArea` | المقارنة والترتيب بالمساحة |
| موصى به جدًا | `deliveryDate` أو `deliveryYears` | أسئلة التسليم والترتيب |
| موصى به | `finishingType` | توصيف الوحدة ومنع إجابات غامضة |
| موصى به | Payment Plan موثقة | المقدم والمدة والقسط |
| موصى به | صورة حقيقية أو media rule | بطاقة منتج أفضل؛ وإلا يظهر placeholder محايد |
| موصى به | `availabilityUpdatedAt`/مصدر حديث | الثقة في الإتاحة |

## 4. السعر المعتمد

السعر canonical الحالي للبحث هو:

```text
Unit.price
```

ويستخدم في الفلترة، hard budget، التحقق النهائي، الترتيب، payload والبطاقة.

- `originalPrice` و`pricePerSqm` معلومات إضافية ولا تستبدلان `price`.
- `PaymentPlan.totalPriceOverride` أو الخصم يعطي quote خاصًا بخطة محددة، وليس سعر البحث العام تلقائيًا.
- `Offer.discountAmount` عرض مستقل، ولا يغيّر `Unit.price` صامتًا.
- كل تغيير يدوي أو مستورد للسعر يمكن أن ينشئ `UnitPriceHistory` للمراجعة التاريخية.

## 5. طرق إدخال البيانات

### 5.1 الإدخال اليدوي

من Admin Dashboard:

```text
Inventory → إضافة وحدة
```

التدفق الصحيح:

1. أنشئ Location إن لم تكن موجودة.
2. أنشئ Developer.
3. أنشئ Project واربطه بالمطور والموقع.
4. أنشئ Phase داخل المشروع.
5. اختياريًا أنشئ Zone وBuilding.
6. أضف الوحدة واربطها بالسياق السابق.
7. أضف Payment Plan على المشروع أو المرحلة أو الوحدة.
8. أضف الصور/المخططات والمستندات.
9. راجع `status`, `price`, `currency` وبيانات التسليم.

يمكن أيضًا تحديث مجموعة حتى 500 وحدة في عملية واحدة للحالة، المشروع، التسليم أو الأرشفة. الحذف الآمن يرفض حذف وحدة مرتبطة بوسائط أو provenance استيراد؛ الأرشفة هي الاختيار الآمن عادةً.

### 5.2 الاستيراد من Excel/CSV

الملفات المدعومة:

- `.xlsx`
- `.xls`
- `.csv` بترميز UTF-8
- حد الملف: 20 MB
- ملف واحد في كل upload

الامتداد وحده لا يكفي؛ النظام يتحقق من signature الحقيقية للملف ويرفض الملفات المعاد تسميتها بشكل مضلل.

#### دورة الاستيراد

```text
Upload
  → Workbook analysis
  → Select sheets/tables/header rows
  → Resolve a single context or confirm every Project value and its Phase
  → Map columns and values
  → Resolve blocking issues
  → Preview
  → Confirm transaction
  → Audit + provenance + price history
```

- يدعم الملف متعدد الصفحات والجداول.
- إذا كانت دقة اكتشاف صف العناوين أقل من 65% تصبح المراجعة اليدوية إلزامية.
- mappings ذات الحساسية العالية تحتاج تأكيدًا أول مرة إذا كانت الثقة أقل من 95%.
- الأعمدة غير المعروفة لا تُرمى تلقائيًا؛ يمكن حفظها كـ`METADATA` أو `META:<custom label>`.
- التأكيد يتم داخل transaction؛ فشل قاعدة البيانات لا يترك استيرادًا جزئيًا.
- هوية التحديث هي: `developerId + projectId + externalUnitId`.

#### تقرير Availability متعدد المشاريع

المسار الحالي يدعم جدولًا واحدًا يحتوي عدة مشروعات من خلال resolver لكل قيمة مميزة في عمود `Project`. لا ينشئ النظام مشروعًا تلقائيًا ولا يدمج أسماء متشابهة fuzzy؛ يختار الـAdmin مشروعًا موجودًا ومرحلة موجودة لكل مجموعة، ثم يُشتق `developerId` و`locationId` من المشروع المؤكد.

| عمود التقرير | المعنى داخل المنصة | السياسة |
|---|---|---|
| `Unit Name` | `externalUnitId` | الهوية المفضلة بعد normalize آمن للمسافات |
| `Unit No.` / `Unit: Unit No.` | `sourceMetadata.unitNumber` | ليس هوية عند وجود `Unit Name` |
| `Project` | Project resolver | قرار مستقل لكل قيمة مميزة، مع Phase إلزامية |
| `Building` | `Unit.building` | نص؛ لا يُجبر إلى رقم |
| `BUA` | `builtUpArea` | Decimal صالح وغير سالب |
| `Garden Area` | `gardenArea` | blank = null، والصفر الصريح يبقى صفرًا |
| `Roof Area` | `roofArea` | blank = null، والصفر الصريح يبقى صفرًا |
| `No. of Bedrooms` | `bedrooms` | عدد صحيح غير سالب |
| `Usage Types` | `unitType` | عبر normalizer الأنواع الحالي |
| `Nominal Prices` | `priceWithCurrency` | يفصل إلى `Unit.price` و`Unit.currency` بدقة Decimal |
| `Floors` | metadata افتراضيًا | منخفض الثقة؛ القيمة `V` لا تتحول إلى رقم دور |

أمثلة `Nominal Prices` المقبولة: `EGP 17,193,457.990000` و`53,028,424.000000 EGP`. الزيادة العشرية الصفرية تُحذف بأمان، لكن كسرًا غير صفري يتجاوز منزلتين يُحجب بدل التقريب الصامت.

إذا غاب عمود Status عن هذا النوع من التقارير، يجب أن يؤكد الـAdmin default مثل `AVAILABLE` صراحة. يظهر القرار في Preview ويحفظ في provenance. السياسة الافتراضية للوحدات الغائبة تظل `LEAVE_UNCHANGED`.

#### سياسة الوحدات الغائبة من النسخة الجديدة

| القيمة | السلوك |
|---|---|
| `LEAVE_UNCHANGED` | لا تغيّر الوحدات غير الموجودة في الملف الجديد؛ الافتراضي والأكثر أمانًا |
| `MARK_UNAVAILABLE` | علّم الوحدات الغائبة بأنها غير متاحة |
| `ARCHIVE` | أرشف الوحدات الغائبة |

لا تستخدم `MARK_UNAVAILABLE` أو `ARCHIVE` إلا عندما يكون الملف snapshot كاملًا للمشروع/المرحلة.

### 5.3 الإدخال عبر API

المسارات الإدارية محمية بـAdmin authentication، ومن أهمها:

```text
POST   /admin/catalog/developers
POST   /admin/catalog/projects
POST   /admin/catalog/units
PATCH  /admin/catalog/units/:id
POST   /admin/catalog/units/:id/payment-plans
POST   /admin/catalog/projects/:id/payment-plans
POST   /admin/catalog/phases/:id/payment-plans
POST   /admin/catalog/units/:id/offers
POST   /admin/imports/upload
GET    /admin/imports/:id/sheets/:sheetId/project-values
PATCH  /admin/imports/:id/sheets/:sheetId/project-values
PATCH  /admin/imports/:id/sheets/:sheetId
POST   /admin/imports/:id/preview
POST   /admin/imports/:id/confirm
```

لا يُنصح بالكتابة المباشرة في PostgreSQL؛ ذلك يتجاوز validation وaudit وprice history وcache invalidation.

## 6. قالب ملف مقترح

أبسط جدول عملي:

```csv
Unit Code,Phase,Unit Type,Bedrooms,Bathrooms,BUA,Price,Currency,Status,Delivery Date,Down Payment %,Installment Months
EG-A301,Phase 1,Apartment,3,3,165,7900000,EGP,AVAILABLE,2028-12-31,10,96
CH-A210,Phase 2,Apartment,3,2,155,8800000,EGP,AVAILABLE,2029-12-31,10,108
```

يمكن تثبيت Developer/Project/Location/Phase/Currency من شاشة المراجعة بدل تكرارها في كل صف. إذا احتوى الملف على أكثر من مرحلة، استخدم عمود Phase واربط كل قيمة مرة واحدة بالمرحلة المسجلة.

## 7. صيغ البيانات المقبولة

### 7.1 العملات

```text
EGP, USD, EUR, AED, SAR, GBP, QAR, KWD, BHD, OMR
```

### 7.2 حالات الوحدة

```text
AVAILABLE, RESERVED, SOLD, UNAVAILABLE, CONTACT_SALES
```

القيمة غير المعروفة لا تتحول إلى `AVAILABLE`: تصبح خطأ validation في Preview. وعند غياب العمود في تقرير Availability متعدد المشاريع يلزم تأكيد default صريح.

### 7.3 أنواع الوحدات

```text
Apartment, Studio, Duplex, Triplex, Penthouse, Loft, Sky Villa,
Garden Apartment, Townhouse, Twin House, Standalone Villa, Mansion,
Palace, Chalet, Cabin, Beach House, Serviced Apartment, Hotel Apartment,
Branded Residence, Student Housing, Senior Living, Office,
Administrative Office, Co-working Space, Retail, Shop, Showroom,
Restaurant, Cafe, Clinic, Medical Center, Pharmacy, Laboratory,
Warehouse, Factory, Workshop, Logistics Unit, Land, Residential Land,
Commercial Land, Agricultural Land, Mixed-use, Other
```

توجد normalization معروفة لاختصارات وقيم عربية شائعة مثل `apt`, `شقة`, `villa`, `فيلا`, `TH`, `Townhouse`, `clinic`, `عيادة`.

### 7.4 التشطيب

```text
CORE_AND_SHELL, SHELL_AND_CORE, SEMI_FINISHED, FINISHED,
FULLY_FINISHED, ULTRA_LUX, FURNISHED, FULLY_FURNISHED,
HOTEL_FINISHED, CUSTOM_FINISH, UNKNOWN
```

### 7.5 الأرقام

- يقبل الأرقام الإنجليزية والعربية.
- يقبل فواصل الآلاف ورموز العملات الشائعة.
- يقبل النسبة بعلامة `%` عند ربطها بحقل نسبة.
- القيم غير الرقمية في حقول الأرقام تجعل الصف غير صالح للمعاينة/التأكيد.
- لا تضع كلمة `million` بدل الرقم الفعلي؛ استخدم `7900000` مثلًا.

### 7.6 التواريخ والمدد

التاريخ يقبل:

```text
DD/MM/YYYY
DD-MM-YYYY
YYYY-MM-DD
Excel date serial
```

مدة التسليم تقبل أرقام السنوات أو صيغًا مثل `2 years`, `18 months`, `سنتين` حسب parser الحالي. لا تخلط مدة دفع مثل `96 months` مع تاريخ تقويمي.

### 7.7 Boolean

استخدم قيمًا واضحة ومتسقة مثل:

```text
true / false
yes / no
1 / 0
```

أي عمود Boolean غير معروف يجب مراجعته في preview بدل افتراض معناه.

## 8. خطط الدفع

يمكن ربط الخطة بأحد المستويات التالية:

1. Project: قاعدة عامة للمشروع.
2. Phase: override لمرحلة معينة.
3. Unit: خطة دقيقة للوحدة، ولها الأولوية عند التطابق.

### حقول PaymentPlan

| الحقل | المعنى |
|---|---|
| `name` | اسم الخطة |
| `planType` | `CASH` أو `INSTALLMENT` |
| `durationMonths` | المدة الموحدة بالشهور؛ 0 للكاش |
| `durationValue`, `durationUnit` | مدة بصيغة DAY/MONTH/YEAR |
| `downPaymentAmount` | مبلغ المقدم |
| `downPaymentPercent` | نسبة المقدم |
| `totalPrice` | إجمالي الخطة |
| `totalPriceOverride` | إجمالي موثق بديل للخطة |
| `discountAmount`, `discountPercent` | خصم الخطة |
| `installmentAmount` | مبلغ القسط إن كان موثقًا |
| `installmentFrequency` | MONTHLY/QUARTERLY/SEMI_ANNUAL/ANNUAL/CUSTOM |
| `installmentEveryValue`, `installmentEveryUnit` | تكرار مخصص |
| `firstInstallmentTiming` | SAME_CYCLE/NEXT_MONTH/NEXT_CYCLE/AFTER_DELAY |
| `firstInstallmentAfterValue/Unit` | التأخير قبل أول قسط |
| `maintenanceAmount/Percent` | الصيانة |
| `reservationAmount` | مبلغ الحجز |
| `distributionMode` | EQUAL أو CUSTOM |
| `percentageSchedule` | جدول دفعات مخصص |
| `validFrom`, `validTo` | صلاحية الخطة |
| `currency` | عملة الخطة |
| `notes`, `isActive` | الملاحظات والتفعيل |

خطط المشروع والمرحلة يجب أن تكون قواعد نسب/فترات؛ لا يسمح فيها بمبالغ unit-specific مثل `totalPriceOverride` أو `installmentAmount`. في جدول CUSTOM يجب أن يساوي المقدم + الدفعات 100%.

أعمدة مثل `Price 8 years`, `96 months price`, `Down Payment %`, `Installment Amount` يمكن اكتشافها، لكن لا تُستخدم قبل موافقة Admin على mapping.

## 9. العروض والوسائط والمستندات

### Offer

```text
title                  مطلوب
description            اختياري
discountAmount         اختياري
startsAt / endsAt      اختياري
isActive               افتراضي true
```

### Media types

```text
IMAGE, FLOOR_PLAN, MASTER_PLAN, VIDEO, MAP
```

حقول الوسائط: `url`, `storageKey`, `altText`, `altTextAr`, `altTextEn`, `caption`, `isCover`, `sortOrder`, `purpose`، وربط اختياري بمطور/مشروع/مرحلة/وحدة.

`purpose=UNIT_MATCH` يسمح بتطبيق الصورة على وحدات تطابق قواعد النوع والغرف والحمامات ونطاق المساحة. لا تُعرض صورة مصطنعة بدل وحدة لا تملك media موثقة.

### Document types

```text
BROCHURE, PAYMENT_PLAN, KNOWLEDGE_SOURCE, OTHER
```

## 10. قاموس حقول الاستيراد الكامل

الرموز:

- `U`: حقل first-class في Unit.
- `M`: يحفظ داخل `Unit.sourceMetadata`.
- `TEXT`, `TEXTAREA`, `NUMBER`, `DATE`, `BOOLEAN`, `ENUM`, `CURRENCY`: نوع الإدخال المتوقع.
- يمكن حفظ أي عمود مشروع آخر عبر `META:<label>` بطول label حتى 120 حرفًا.

### الهوية والمرجع

| المفتاح | الوصف | النوع | التخزين |
|---|---|---|---|
| `externalUnitId` | كود/مرجع الوحدة | TEXT | U |
| `propertyReference` | مرجع العقار | TEXT | M |
| `unitNumber` | رقم الوحدة داخل المبنى | TEXT | M |
| `plotNumber` | رقم القطعة | TEXT | M |
| `parcelNumber` | رقم الحوض/القسيمة | TEXT | M |

### الهيكل داخل المشروع

| المفاتيح U | المفاتيح M |
|---|---|
| `phase`, `cluster`, `building`, `floor` | `zone`, `block`, `buildingCode`, `floorFrom`, `floorTo`, `gate`, `internalLocation` |

### النوع والاستخدام

| المفاتيح U | المفاتيح M |
|---|---|
| `unitType:ENUM`, `unitSubType:TEXT` | `propertyUse`, `ownershipType`, `saleType`, `sellerType`, `commercialActivity`, `licenseType` |

### الغرف والتقسيم

| المفاتيح U | المفاتيح M |
|---|---|
| `bedrooms:NUMBER`, `bathrooms:NUMBER` | `maidRooms`, `driverRooms`, `livingRooms`, `kitchens`, `parkingSpaces`, `storageRooms` |

### المساحات

كل القيم `NUMBER`.

| المفاتيح U | المفاتيح M |
|---|---|
| `builtUpArea`, `landArea`, `gardenArea`, `roofArea`, `terraceArea` | `netArea`, `grossArea`, `balconyArea`, `basementArea`, `garageArea`, `commonArea`, `frontageWidth`, `ceilingHeight` |

### السعر والقيمة

| المفاتيح U | المفاتيح M |
|---|---|
| `price:NUMBER`, `currency:CURRENCY`, `discount:NUMBER`, `maintenance:NUMBER`, `clubFees:NUMBER`, `offerText:TEXTAREA` | `originalPrice`, `pricePerSqm`, `reservationAmount`, `discountPercent`, `maintenancePercent`, `transferFees`, `brokerCommission` |

### الإتاحة والتسليم

| المفاتيح U | المفاتيح M |
|---|---|
| `status:ENUM`, `deliveryDate:DATE`, `deliveryYears:NUMBER`, `finishingType:ENUM` | `availabilityDate:DATE`, `unitCondition`, `occupancyStatus`, `readyToMove:BOOLEAN`, `lastUpdated:DATE`, `deliveryYear:NUMBER`, `launchDate:DATE`, `constructionPercentage:NUMBER`, `furnishingStatus` |

### خطة السداد داخل صف الوحدة

| المفاتيح U | المفاتيح M |
|---|---|
| `downPayment:NUMBER`, `installmentYears:NUMBER`, `installmentAmount:NUMBER` | `downPaymentPercent`, `installmentMonths`, `installmentFrequency`, `firstInstallmentAfter`, `balloonPayment` |

### المزايا والموقع

كلها M:

```text
view:TEXT, orientation:TEXT, facing:TEXT, cornerUnit:BOOLEAN,
privatePool:BOOLEAN, elevator:BOOLEAN, parkingType:TEXT, street:TEXT,
district:TEXT, latitude:NUMBER, longitude:NUMBER
```

### إعادة البيع

كلها M:

```text
resalePremium:NUMBER, paidAmount:NUMBER, remainingAmount:NUMBER,
remainingInstallments:TEXT, nextInstallmentDate:DATE
```

### الإيجار والعائد

كلها M:

```text
rentalPrice:NUMBER, rentalFrequency:TEXT, currentRent:NUMBER,
leaseEndDate:DATE, expectedYield:NUMBER
```

### تجاري وإداري

كلها M:

```text
frontage:TEXT, footfall:TEXT, floorLoad:NUMBER,
powerCapacity:TEXT, hvac:TEXT
```

### المصدر الأساسي

كلها M:

```text
salesAgent:TEXT, broker:TEXT, sourceUrl:TEXT
```

### القانوني والملكية

كلها M:

```text
titleDeedStatus:TEXT, registrationStatus:TEXT, registryNumber:TEXT,
ownershipShare:NUMBER, tenureType:TEXT, usufructYears:NUMBER,
mortgageStatus:TEXT, mortgageBalance:NUMBER, permitNumber:TEXT,
permitStatus:TEXT, legalNotes:TEXTAREA
```

### المساحات والأبعاد المتقدمة

كلها `NUMBER` وM:

```text
sellableArea, internalArea, coveredArea, plotWidth, plotDepth,
frontageLength, streetWidth, usableArea, sharedAreaPercent
```

### المبنى والتجهيز

كلها M:

```text
totalFloors:NUMBER, unitLevels:NUMBER, buildingAge:NUMBER,
yearBuilt:NUMBER, renovationYear:NUMBER, elevatorCount:NUMBER,
entranceCount:NUMBER, serviceEntrance:BOOLEAN, loadingDock:BOOLEAN,
fireSafety:TEXT, securitySystem:TEXT, accessControl:TEXT
```

### المرافق والخدمات الفنية

كلها M:

```text
electricityMeter:TEXT, waterMeter:TEXT, gasMeter:TEXT,
electricityPhase:TEXT, backupGenerator:BOOLEAN, solarPower:BOOLEAN,
smartHome:BOOLEAN, internetReady:BOOLEAN, centralAc:BOOLEAN,
waterPressureSystem:TEXT
```

### المزايا الخاصة

كلها M:

```text
privateGarden:BOOLEAN, privateRoof:BOOLEAN, privateTerrace:BOOLEAN,
jacuzzi:BOOLEAN, storageIncluded:BOOLEAN, parkingIncluded:BOOLEAN,
parkingNumber:TEXT, seaView:BOOLEAN, golfView:BOOLEAN,
lagoonView:BOOLEAN, parkView:BOOLEAN
```

### إعادة البيع المتقدمة

كلها M:

```text
askingPrice:NUMBER, developerRemaining:NUMBER, sellerCashRequired:NUMBER,
transferEligibility:TEXT, transferApprovalStatus:TEXT, ownerStatus:TEXT,
resaleReason:TEXT, handoverReceived:BOOLEAN, keysAvailable:BOOLEAN
```

### الإيجار والعائد المتقدم

كلها M:

```text
tenantStatus:TEXT, tenantName:TEXT, leaseStartDate:DATE,
securityDeposit:NUMBER, annualRent:NUMBER, monthlyRent:NUMBER,
serviceCharges:NUMBER, vacancyRate:NUMBER, netYield:NUMBER,
grossYield:NUMBER
```

### تجاري وإداري متقدم

كلها M وفق المقصود من العقد:

```text
businessType:TEXT, operatingLicense:TEXT, signageRights:TEXT,
outdoorArea:NUMBER, kitchenExtraction:BOOLEAN, greaseTrap:BOOLEAN,
officeGrade:TEXT, retailCategory:TEXT, medicalLicenseEligible:BOOLEAN
```

### صناعي ولوجستي

كلها M وفق المقصود من العقد:

```text
warehouseClearHeight:NUMBER, loadingBays:NUMBER, dockLeveler:BOOLEAN,
yardArea:NUMBER, industrialPower:TEXT, craneCapacity:NUMBER
```

### المصدر والملاحظات المتقدمة

كلها M:

```text
sourceChannel:TEXT, sourceContact:TEXT, listingDate:DATE,
listingExpiry:DATE, exclusiveListing:BOOLEAN, internalTags:TEXT,
qualityScore:NUMBER, notes:TEXTAREA
```

### تصحيح عقد الحقول

تم تصحيح `greaseTrap` و`dockLeveler` في `import-contract.ts` وأصبح العقد الفعلي لكليهما `BOOLEAN + METADATA` مع label عربي وإنجليزي مستقلين، وتوجد اختبارات regression تمنع عودة انزياح arguments.

## 11. متغيرات البيئة

لا تضع أي secret في متغير يبدأ بـ`NEXT_PUBLIC_`. القيم السرية يجب أن تبقى server-side وفي Railway Variables أو `.env` محلي غير مرفوع إلى Git.

### Core runtime

| المتغير | مطلوب؟ | الاستخدام |
|---|---|---|
| `NODE_ENV` | نعم | `development` أو `production` |
| `DATABASE_URL` | نعم | اتصال PostgreSQL/Neon المستخدم بواسطة Prisma |
| `PORT` | اختياري | API افتراضيًا 8080؛ Automation API افتراضيًا 8081 |
| `WEB_ORIGIN` | نعم في production | CORS origins، ويمكن فصل أكثر من origin بفاصلة |
| `WEB_BASE_URL` | للروابط | أصل رابط Web share/continuation |
| `INTERNAL_API_URL` | Web server | عنوان API الداخلي؛ fallback لـNADIM_API_URL |
| `NADIM_API_URL` | Web server | عنوان Nadim API server-to-server |
| `NEXT_PUBLIC_API_URL` | قديم/غير مستخدم حاليًا | موجود في `.env.example` لكن Web الحالي يستخدم same-origin adapters |
| `ANALYZE` | اختياري | تفعيل تحليل Web bundle عند `true` |

### Nadim والروابط والإجراءات

| المتغير | الاستخدام |
|---|---|
| `NADIM_V2_ENABLED` | تشغيل Nadim V2 عند `true` |
| `NADIM_GATEWAY_SECRET` | secret بين Web وAPI؛ مطلوب عند تفعيل V2 |
| `DEVICE_HASH_SECRET` | hashing لهوية الجهاز المجهول؛ يجب أن يكون قويًا |
| `WHATSAPP_BUSINESS_NUMBER` | رقم destination بصيغة أرقام فقط مع country code |
| `NADIM_ACTION_EXECUTION_ENABLED` | يسمح بالتنفيذ الخارجي عند `true`; لا يُفعّل قبل جاهزية الـAutomation API |
| `NADIM_AUTOMATION_API_URL` | عنوان Automation API |
| `NADIM_AUTOMATION_SECRET` | secret مشترك مع Automation API |
| `NADIM_DEFAULT_PHONE_COUNTRY` | ISO country code افتراضي لتطبيع الهاتف داخل Automation API |

### Admin security

| المتغير | الاستخدام |
|---|---|
| `ADMIN_JWT_SECRET` | توقيع جلسات Admin؛ إلزامي في production |
| `ADMIN_ACCESS_PATH` | مسار Admin المخصص/المحمي |
| `ADMIN_COOKIE_DOMAIN` | domain اختياري للـAdmin cookie |
| `ADMIN_BOOTSTRAP_EMAIL` | حساب Admin bootstrap |
| `ADMIN_BOOTSTRAP_PASSWORD` | كلمة مرور bootstrap؛ secret |

### Object storage

| المتغير | الاستخدام |
|---|---|
| `STORAGE_PROVIDER` | `local` للتطوير فقط أو `r2` للإنتاج |
| `R2_ACCOUNT_ID` | Cloudflare R2 account |
| `R2_ACCESS_KEY_ID` | access key |
| `R2_SECRET_ACCESS_KEY` | secret key |
| `R2_BUCKET` | اسم bucket |
| `R2_PUBLIC_BASE_URL` | base URL للملفات العامة المعتمدة |

عند `STORAGE_PROVIDER=r2` تصبح متغيرات R2 الخمسة إلزامية.

### الخرائط

| المتغير | الاستخدام |
|---|---|
| `GOOGLE_MAPS_SERVER_API_KEY` | Geocoding/Routes على الخادم؛ secret |
| `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY` | Maps JavaScript في المتصفح؛ يجب تقييده بـHTTP referrers ولا يُعاد استخدام server key |

### FX

| المتغير | الاستخدام/الافتراضي |
|---|---|
| `FX_API_URL` | مصدر conversion موثوق؛ يدعم `{from}/{to}` أو query params |
| `FX_API_KEY` | Bearer key اختياري |
| `FX_TIMEOUT_MS` | 2000، محصور بين 500 و5000 |
| `FX_CACHE_TTL_MS` | 900000 |
| `FX_STALE_MAX_MS` | 21600000 |

إذا لم يوجد FX موثوق، يحتفظ Nadim بالعملة الأصلية ولا يخمن تحويل EGP.

### AI routing

| المتغير | الاستخدام |
|---|---|
| `AI_PROVIDER` | `hybrid` في production أو `demo` للتطوير فقط |
| `GROQ_API_KEY` | Groq secret |
| `GROQ_FAST_MODEL` | موديل الردود السريعة |
| `GROQ_STANDARD_MODEL` | موديل المحادثة القياسي الجديد |
| `GROQ_GENERAL_MODEL` | alias قديم للـstandard |
| `GROQ_REASONING_MODEL` | alias قديم للـstandard |
| `GROQ_ARABIC_MODEL` | fallback قديم للـfast |
| `GROQ_BACKUP_MODEL` | fallback أول |
| `GROQ_LAST_RESORT_MODEL` | fallback أخير داخل Groq |
| `GROQ_VISION_MODEL` | تحليل master plan/vision |
| `ALLOW_PREVIEW_GROQ_MODELS` | السماح المتعمد بموديلات preview |
| `ALLOW_UNLISTED_GROQ_MODELS` | السماح المتعمد بموديلات retired/unlisted |
| `CLOUDFLARE_AI_ACCOUNT_ID` | Workers AI account |
| `CLOUDFLARE_AI_API_TOKEN` | Workers AI token |
| `CLOUDFLARE_AI_MODEL` | موديل Workers الأساسي |
| `CLOUDFLARE_AI_FAST_MODEL` | موديل الاستخراج/السرعة |
| `OPENAI_FALLBACK_ENABLED` | OpenAI fallback opt-in فقط |
| `OPENAI_API_KEY` | OpenAI secret |
| `OPENAI_TEXT_MODEL` | موديل OpenAI المختار |
| `BEDROCK_GLM_ENABLED` | تشغيل Bedrock GLM opt-in |
| `BEDROCK_API_KEY` | Bedrock/Mantle key |
| `BEDROCK_BASE_URL` | base URL؛ له default حالي |
| `BEDROCK_GLM_MODEL` | default حالي `zai.glm-5` |

ملحوظة: `.env.example` الحالي لا يسرد كل aliases الجديدة/الاختيارية أعلاه، خصوصًا `GROQ_STANDARD_MODEL` ومتغيرات Bedrock وAutomation execution، لكن الكود يستخدمها فعليًا.

## 12. قواعد الجودة قبل الاعتماد

### لكل وحدة

- كود فريد وغير فارغ.
- المطور يملك المشروع.
- المرحلة والمبنى يتبعان المشروع نفسه.
- `status` صحيح، والوحدة غير مؤرشفة إذا كانت للبيع.
- السعر رقم غير سالب والعملة مدعومة.
- الغرف/الحمامات أعداد صحيحة غير سالبة.
- المساحات أرقام غير سالبة وبوحدة قياس موحدة، ويفضل m².
- تاريخ أو مدة التسليم واضحان ولا يُخلطان بمدة التقسيط.
- أي claim استثماري أو yield يجب أن يكون موثقًا، وليس marketing text غير معتمد.

### لكل دفعة استيراد

- راجع الجدول وصف العناوين.
- لا تتجاهل blocking issues.
- راجع الأعمدة ذات الثقة المنخفضة.
- افحص preview وعدد New/Existing/Invalid.
- تحقق من duplicate `externalUnitId` داخل الملف.
- حدد سياسة missing units بوعي.
- لا تؤكد دفعة بعد تغيير mapping دون إنشاء preview جديد.
- احتفظ بملف المصدر وRequest ID للمراجعة.

### قبل production

- استخدم `R2` لا local storage.
- شغّل migrations forward-only ولا تستخدم `prisma db push` على production.
- لا ترفع `.env` أو credentials إلى Git.
- قيد مفاتيح Google Maps حسب نوعها.
- لا تفعّل action execution قبل اختبار Automation API والـsecret.
- نفّذ Prisma validate، API/Web builds واختبارات imports قبل طرح تغيير كبير في القاموس.

## 13. أين توجد مصادر الحقيقة في الكود؟

```text
packages/database/prisma/schema.prisma
apps/api/src/imports/import-contract.ts
apps/api/src/imports/importer.service.ts
apps/api/src/imports/imports.controller.ts
apps/api/src/admin/catalog.controller.ts
apps/api/src/property-search.service.ts
apps/api/src/payment-calculator.ts
apps/api/src/storage/storage.service.ts
.env.example
```

عند تعارض هذا الدليل مستقبلًا مع الكود أو schema، يكون الكود الحالي هو المرجع، ثم يجب تحديث هذا الملف في نفس التغيير.
