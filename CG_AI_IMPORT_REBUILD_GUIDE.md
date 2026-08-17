# Cg Ai — Import & Data Workflow Rebuild

هذه النسخة مبنية على `AICG(9)` وتعيد بناء مسار إدخال المخزون والمراجعة بدل ترقيع شاشة الاستيراد القديمة.

## ما تغير

### 1. الإدخال اليدوي بدون Excel
- صفحة **البيانات والاستيراد** تحتوي الآن على `إضافة عقار / وحدة` و`استيراد ملف` داخل محتوى الصفحة.
- أزيل زر **استيراد جديد** من الـTop Bar العام.
- الإدخال اليدوي يدعم إنشاء Developer ثم Project ثم Location ثم Phase من نفس الـModal وربط الوحدة مباشرة.
- كود الوحدة أصبح اختياريًا في الإدخال اليدوي؛ إذا تركته فارغًا يولّد السيرفر كودًا داخليًا فريدًا.

### 2. مراحل الاستيراد
الـStepper الإداري أصبح:
1. المصدر
2. الجداول
3. المشروع والمرحلة
4. مطابقة الحقول
5. المعاينة
6. الاعتماد

لا يمكن الانتقال للاعتماد قبل اكتمال السياق والحقول الحرجة ووجود Preview صالح.

### 3. حل BLOCKING issues داخل الجدول نفسه
لكل Sheet يتم عرض النواقص في نفس Card، ومنها:
- المشروع
- المطور
- موقع المشروع
- المرحلة
- العملة
- كود الوحدة
- الأعمدة غير المعروفة

يمكن من نفس المكان:
- البحث عن مشروع.
- إنشاء مشروع إذا لم يكن موجودًا.
- إنشاء مطور.
- إنشاء Location هرميًا.
- ربط Location بمشروع قديم لا يملك موقعًا.
- إنشاء Phase جديدة باسم/كود/سنة تسليم وربطها بالـSheet.

### 4. قاموس عقاري واسع وقابل للبحث
- القاموس الحالي: **203 canonical fields**.
- أنواع الوحدات: **43**.
- أنواع التشطيب: **11**.
- العملات المدعومة: **10**.
- البحث يتم بالنص العربي أو الإنجليزي أو اسم الحقل أو المجموعة والكلمات المفتاحية.
- لا تحتاج النزول في Select طويل.
- أي حقل غير موجود يمكن كتابته وحفظه بصيغة `META:<name>` داخل `Unit.sourceMetadata` مع المحافظة على مصدره.

القاموس يشمل، من ضمن غيرها: الهوية، Developer/Project/Phase/Building/Cluster، المساحات، الغرف، السعر، سعر المتر، السداد، الرسوم، التسليم، Primary/Resale، الإيجار والعائد، الملكية والقانوني، التجاري والإداري والطبي، الصناعي واللوجستي، المرافق، الخدمات، الإطلالات، الجراج، المزايا الخاصة، بيانات الإعلان والمصدر.

### 5. SQL relational integrity
Migration جديدة:

`packages/database/prisma/migrations/20260818214500_relational_integrity_guards/migration.sql`

تضيف PostgreSQL triggers فوق Foreign Keys الموجودة في Prisma للتحقق من العلاقات العابرة، مثل:
- Developer الوحدة يملك Project الوحدة.
- Phase الوحدة تابعة لنفس Project.
- Building/Zone تابعان لنفس Project/Phase.
- Phase الخاصة بـImportSheet تابعة للمشروع المختار.
- Location الخاصة بالـSheet لا تتعارض مع Location المشروع.
- Media/Document/PaymentPlan/MarketProfile لا يمكن ربطها بـProject/Phase/Unit من سياقات مختلفة.

تم عمل static relation audit للحقول التي تعتمد عليها الـtriggers، وكانت النتيجة: **9 triggers / 0 missing columns**.

## Google Maps

الكود أصبح يستخدم Loader مركزي واحد في:

`apps/web/lib/google-maps.ts`

ويحمّل Maps JS بالباراميترات:
- `loading=async`
- callback
- `auth_referrer_policy=origin`
- `script.async = true`

لا يوجد Loader آخر لـ`maps.googleapis.com/maps/api/js` داخل Web app.

### متغيرات البيئة
استخدم مفتاحين منفصلين:

```env
# API service — لا يصل للمتصفح
GOOGLE_MAPS_SERVER_API_KEY=...

# Web service — Browser key
NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY=...
```

في Google Cloud للـBrowser key:
1. فعّل **Maps JavaScript API** في نفس Google Cloud Project الذي خرج منه المفتاح.
2. استخدم Website / HTTP referrer restriction.
3. أضف بيئة التطوير والدومين الفعلي، مثل:
   - `http://localhost:3000`
   - `https://ai.cg.popwam.com`
4. ضع API restriction على Maps JavaScript API والخدمات العميلية التي تستخدمها فعلًا.

`ApiNotActivatedMapError` لن يختفي بتعديل React فقط؛ يجب أن تكون Maps JavaScript API مفعلة على مشروع المفتاح نفسه.

بعد تعديل إعدادات Google وإعادة تشغيل Web، نفذ Hard Refresh حتى لا تستخدم Bundle/Script قديمًا.

## تشغيل قاعدة نظيفة

إذا قررت بالفعل حذف قاعدة Cg Ai القديمة والبدء من الصفر، نفذ Reset فقط بعد التأكد أنك على قاعدة Neon الصحيحة وأن النسخة القديمة غير مطلوبة:

```sql
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
```

ثم من جذر المشروع:

```bash
npm install
npm run db:generate
npm run db:migrate:deploy
```

بعدها شغّل الـAPI. في قاعدة فارغة، إذا كانت القيمتان موجودتين:

```env
ADMIN_BOOTSTRAP_EMAIL=...
ADMIN_BOOTSTRAP_PASSWORD=...
```

سيتم إنشاء أول Admin. بعد التأكد من تسجيل الدخول احذف متغيري Bootstrap من بيئة الإنتاج.

## اختبار محلي مقترح

```bash
npm install
npm run db:generate
npm run db:migrate:deploy
npm run dev:api
```

وفي Terminal آخر:

```bash
npm run dev:web
```

اختبر بالترتيب:
1. `/admin/data` → `إضافة عقار / وحدة` بدون ملف.
2. أنشئ Developer/Location/Project/Phase جديدة من نفس المسار.
3. ارفع Workbook متعدد الـSheets.
4. اختر Sheet للاستيراد.
5. لو المشروع غير موجود، أنشئه داخل مراجعة الـSheet.
6. لو المشروع لا يملك Location، أنشئ/اختر Location وتأكد أن المشكلة تختفي.
7. أنشئ Phase من نفس Sheet وتأكد أن BLOCKING issue تختفي.
8. في Mapping اكتب كلمات مثل `سعر متر`, `title deed`, `warehouse`, `yield`, `owner` وتأكد من ظهور النتائج المناسبة.
9. اكتب اسم حقل غير موجود وتأكد من ظهور زر حفظه كحقل مخصص.
10. أنشئ Preview ثم Confirm.
11. افتح حدود المشروع/اختيار الموقع وتأكد أن Console لم يعد يعرض warning الخاص بتحميل Maps بدون `loading=async`.

## الفحوص التي تمت على النسخة قبل التسليم
- Syntax/transpile audit: **61 TS/TSX files / 0 syntax errors**.
- Import contract tests: **6/6 passed**.
- Canonical vocabulary assertion: `>= 200` passed؛ العدد الفعلي 203.
- SQL trigger/schema static audit: **9 triggers / 0 missing columns**.
- `git diff --check`: passed.
- Web scan: Loader واحد فقط لـMaps JavaScript API.

لم يتم تشغيل Full `npm run build` داخل بيئة التسليم لأن `node_modules` الخاصة بالمشروع غير متاحة هنا. نفّذ Build بعد `npm install` عندك أو على Railway قبل الاعتماد النهائي.
