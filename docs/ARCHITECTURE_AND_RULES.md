# ASCPT — Permanent Code & Project Organization Rules

وثيقة القواعد الهندسية الدائمة لمشروع مركز الإسكندرية التخصصي للعلاج الطبيعي (ASCPT).
يلتزم فريق التطوير بهذه القواعد في أي تعديل أو ميزة (Feature) أو إصلاح (Bug Fix) أو إعادة هيكلة (Refactoring).

---

## 1. القاعدة الذهبية (Golden Rule)
**Do not break working code.**
قبل تعديل أي شيء:
1. افهم الكود الحالي بدقة.
2. حدد مكان المسؤولية الحقيقي للكود.
3. افحص التبعيات (Dependencies) بين الملفات.
4. افحص الـ Event Listeners والدوال ذات الصلة.
5. لا تعيد كتابة شيء يعمل فقط لتفضيل شخصي.
*Minimal change is preferred over unnecessary refactoring.*

---

## 2. تنظيم المشروع (Project Structure)
فصل واضح وحاسم بين أنواع الملفات:
```
ascpt-clinic-pwa/
│
├── index.html
├── manifest.json
├── package.json
├── sw.js
├── README.md
│
├── css/
│   ├── design-tokens.css   # Tier 1: Design tokens, CSS variables, typography, light/dark themes
│   ├── base.css            # Tier 2: CSS reset, normalized defaults, scrollbar & typography base
│   ├── components/         # Tier 3: Reusable UI Component Library (Zero !important)
│   │   ├── buttons.css     # Standardized primary, secondary, outline, danger & icon buttons
│   │   ├── cards.css       # Surface cards, interactive stats, metric grids & containers
│   │   ├── chips-badges.css# Role, status, specialty, and contract chips & badges
│   │   ├── forms.css       # Unified input fields, custom select pickers & control groups
│   │   ├── modals.css      # Modal dialogs, stacked sub-modals, bottom-sheets & backdrops
│   │   ├── skeletons.css   # Shimmer loading animations & placeholder skeletons
│   │   └── tables.css      # Responsive data tables, sticky headers & striped data rows
│   ├── views/              # Tier 4: Scoped Modular Screen Stylesheets (Zero !important)
│   │   ├── shell.css       # App header, sidebar navigation, bottom nav & notification bells
│   │   ├── reception.css   # Waiting list, daily appointments grid & patient check-in
│   │   ├── patients.css    # Patient records, medical sheets, diagnoses & search grid
│   │   ├── doctor.css      # Doctor dashboard, monthly stats, patient history & clinical tabs
│   │   ├── sessions.css    # Daily sessions queue, home visits tabs, cycle tracking & batch forms
│   │   ├── admin.css       # User access controls, clinic settings, audit logs & system tools
│   │   ├── finance.css     # Income/expense ledgers, doctor dues, financial summary & monthly reports
│   │   └── claims.css      # Insurance companies management, claims batching & letter printing
│   ├── style.css           # Legacy transition sheet (shrunken by 77%, legacy fallbacks only)
│   └── print.css           # Print Engine: WiFi-printing, receipts, reports & A5 frames
│
├── js/
│   ├── app.js          # Application coordinator
│   ├── auth.js         # Authentication & current user state
│   ├── roles.js        # RBAC & permissions
│   ├── db.js           # Data persistence layer
│   ├── patients.js     # Patients & clinical sheets
│   ├── sessions.js     # Attendance & session tracking
│   ├── finance.js      # Reports, expenses & revenue
│   ├── claims.js       # Insurance claims management
│   ├── export.js       # Excel & PDF/Print exports
│   ├── audit.js        # Audit trail & logs
│   ├── pwa.js          # PWA installation & network status
│   ├── utils.js        # Pure helper functions
│   ├── notifications.js# Unified Push & In-App Notification Center
│
├── api/
│   ├── admin/users.js  # Privileged staff admin endpoint
│   └── notifications/  # Serverless push notification dispatch
│
├── assets/
│   ├── icons/
│   └── vendor/
│
└── docs/               # Architecture & documentation
```
- لا تضع JavaScript عشوائياً في الـ root.
- لا تضع CSS داخل JavaScript.
- لا تضع Business Logic داخل HTML.

---

## 3. مبدأ المسؤولية الفردية (Single Responsibility)
كل ملف وموديول له مسؤولية واحدة محددة:
- `patients.js`: إدارة المرضى والشيتات الطبية فقط.
- `sessions.js`: تسجيل وحضور الجلسات فقط.
- `finance.js`: الحسابات والمصروفات والتقارير المالية.
- `auth.js`: حالة تسجيل الدخول وتحديد هوية المستخدم.
- `roles.js`: التحقق من الصلاحيات والأدوار (Authorization).
- `db.js`: طبقة الوصول للبيانات والحفظ فقط.
- `export.js`: التصدير والطباعة فقط.

---

## 4. app.js ليس God Object
- `app.js` هو منسق التطبيق (Application Coordinator) فقط.
- وظيفته: تهيئة التطبيق، ربط الموديولات، إدارة التنقل بين الشاشات، إدارة الأحداث العامة.
- لا يحتوي على Business Logic أو استعلامات قاعدة البيانات أو دوال تصدير.

---

## 5. قواعد HTML
- `index.html` يحتوي على هيكل دلالي (Semantic HTML) والـ IDs والـ Classes فقط.
- **ممنوع نهائياً الـ Inline Event Handlers**:
  `onclick`, `onchange`, `oninput`, `onsubmit`, `onload`, `onkeydown`, `onkeyup`.
- جميع الأحداث تُربط من ملفات الـ JavaScript عبر `addEventListener` أو Event Delegation.

---

## 6. إدارة الأحداث في JavaScript
- فحص الـ Listeners الموجودة قبل إضافة أي Listener جديد لمنع التكرار.
- استخدام Event Delegation للقوائم والعناصر الديناميكية بدلاً من إنشاء مئات الـ Listeners الفردية.

---

## 7. معايير التسمية (Naming Conventions)
- الدوال والمتغيرات: `camelCase`
- الثوابت: `UPPER_SNAKE_CASE`
- الفئات (Classes): `PascalCase`
- الملفات: `kebab-case.js`

---

## 8. منع القيم السحرية (No Magic Numbers / Strings)
- استخدام Constants مركزية للأدوار، الحالات، والإعدادات بدلاً من السلاسل النصية المكررة.

---

## 9. مركزية الإعدادات (Centralize Configuration)
- تجميع إعدادات الإصدار (App Version)، كاش الـ Service Worker، وثوابت التهيئة في مكان مركزي موحد.

---

## 10. طبقة البيانات (Data Layer Architecture)
- تدفق البيانات المنضبط:
  `UI -> Feature Module -> DB Layer -> Storage`
- حظر الوصول العشوائي المباشر لـ `localStorage` أو `Firestore` من واجهة المستخدم.

---

## 11. معمارية الإنتاج (Production Architecture)
- فصل تام بين: Presentation, Business Logic, Data Access, Auth, Utilities.
- صلاحيات الـ UI مخصصة لتحسين تجربة المستخدم (UX)، بينما الأمان الحقيقي يفرضه الـ Backend و Firestore Security Rules.

---

## 12. المصادقة والتفويض (AuthN vs AuthZ)
- المصادقة (Authentication): "من هو المستخدم؟"
- التفويض (Authorization): "ما هي صلاحيات هذا المستخدم؟"
- التحقق الإلزامي من الصلاحيات في جهة الخادم وقواعد البيانات.

---

## 13. معمارية المركز المستقل (Single-Tenant Architecture)
- التطبيق يعمل بنمط عيادة واحدة = مشروع Firebase واحد مستقل (One Clinic = One Firebase Project).
- المجموعات مسطحة ومباشرة في جذر Firestore (`patients`, `sessions`, `expenses`, `users`, `audit_logs`) بدون أي استخدام لـ `clinicId`.
- حدود مشروع Firebase هي بذاتها حدود العيادة (Tenant Boundary).

---

## 14. كود موحد للجميع (No Client-Specific Forks)
- كود برمجي واحد (One Single Codebase).
- أي تخصيص لمركز يكون عبر ملف الإعدادات (Configuration) فقط، وليس بإنشاء نسخة كود منفصلة.

---

## 15. تنظيم ملفات التنسيق وحظر استخدام !important (CSS Architecture & Zero !important Policy)
- **حظر استخدام `!important` في أي كود جديد:** يُمنع تماماً إضافة `!important` في أي ميزة جديدة أو تعديل مستقبلي. الاعتماد حصراً على تسلسل الـ Specificity الطبيعي، وترتيب القواعد (Cascade Order)، واستخدام متغيرات CSS المتوارثة (`var(--token)`).
- **البدائل الحديثة المعتمدة:**
  1. الاعتماد على متغيرات CSS (`CSS Variables`) للتحكم في الألوان والمسافات والسمات (Themes) دون الحاجة لكسر الـ Specificity.
  2. تنظيم الأولويات عبر تقنية طبقات التنسيق الحديثة (`@layer`).
  3. ضبط الترتيب الطبيعي للـ Media Queries بوضع قواعد الهواتف بعد التنسيقات الأساسية لتتفوق عليها تلقائياً دون إجبار.
- **خطة الجدولة والمراحل لإزالة المتبقي (Phased Removal Roadmap):**
  - لا يتم حذف الـ `!important` المتبقي في الأقسام القديمة دفعة واحدة لتفادي أي انكسار مفاجئ في الشاشات المستقرة، بل يتم جدولته عبر مراحل منظمة وفقاً للوحدات الوظيفية (Modules).
  - الاستثناء الوحيد المصرح به مستقبلاً هو فئات الـ Utilities الذرية البحتة (مثل `.d-none` أو إخفاء عناصر الطباعة في `@media print`).
- استخدام المتغيرات المعيارية `--radius-md`, `--primary` وتجنب الإضافات العشوائية أو تكرار القواعد.

---

## 16. تجنب الملفات العملاقة (Avoid Giant Files)
- تقسيم الملفات عند تعدد المسؤوليات بشكل منطقي يعتمد على الوظيفة (Responsibility-based).

---

## 17. التعليقات الهادفة (Comments)
- التعليق يشرح "لماذا" (Why) تم اختيار الحل أو المنطق البرمجي، وليس "ماذا" (What) يفعله الكود البديهي.

---

## 18. المعالجة الصارمة للأخطاء (Error Handling)
- حظر استخدام `catch (e) {}` الصامت.
- إظهار رسائل مفهومة للمستخدم وتسجيل التفاصيل التقنية في السجلات البرمجية.

---

## 19. الأمان وحماية البيانات (Security & Sanitization)
- معاملة كل مدخلات المستخدم كبيانات غير موثوقة (Untrusted).
- استخدام `textContent` للنصوص، وتطهير أي HTML ديناميكي لمنع هجمات XSS.

---

## 20. حظر الأسرار في الواجهة (No Secrets in Frontend)
- حظر حفظ مفاتيح API الخاصة أو كلمات السر في كود الواجهة الأمامية أو مستودع GitHub.

---

## 21. ترشيد المكتبات الخارجية (Dependencies)
- عدم إضافة أي مكتبة خارجية إلا للضرورة القصوى مع التأكد من أمانها وتوافقها التام مع العمل دون إنترنت (Offline).

---

## 22. دعم العمل أوفلاين (PWA & Offline-First)
- التأكد من أن جميع ملفات وتشغيلات النظام الأساسية تعمل محلياً بكفاءة 100% بدون إنترنت.

---

## 23. توافق الـ Service Worker
- تحديث رقم إصدار الكاش تلقائياً عند أي تعديل في ملفات التطبيق لضمان وصول التحديثات الفورية للهواتف.

---

## 24. توحيد أرقام الإصدارات (Versioning)
- مواءمة رقم الإصدار في `package.json` و `manifest.json` و `sw.js`.

---

## 25. انضباط رسائل Git (Git Discipline)
- استخدام رسائل commit معيارية وواضحة تصف التعديل الفعلي (`feat:`, `fix:`, `refactor:`, `docs:`).

---

## 26. الفحص المسبق قبل التعديل (Inspection First)
- فحص بنية المشروع والتبعيات وتدفق البيانات قبل الشروع في كتابة التعديل.

---

## 27. التحقق والاختبار بعد التعديل (Validation & Tests)
- التحقق الصارم عبر `node --check` وخلو المشروع من أخطاء الـ Syntax والـ Duplicate IDs.

---

## 28. عدم تغيير نطاق التعديل تلقائياً (Scope Control)
- الالتزام بنطاق المشكلة المطلوب حلها دون فرض تعديلات تصميمية أو معمارية جانبية دون طلب العميل.

---

## 29. سياسة إعادة الهيكلة (Refactoring Policy)
- Refactor ≠ Rewrite. التعديل الموضعي الآمن أولى من إعادة كتابة الموديول بالكامل.

---

## 30. متطلبات الجاهزية للإنتاج (Production Readiness)
- التحقق من تدفق البيانات، الأذونات، سلوك انقطاع الشبكة، وسجل التدقيق الرقابي.

---

## 31. سرية البيانات الطبية (Healthcare Data Protection)
- معاملة بيانات المرضى بأقصى درجات الحذر والسرية وتطبيق مبدأ الحد الأدنى من الصلاحيات (Least Privilege).

---

## 31.أ. قرار مقصود: قراءة كل ملفات المرضى متاحة لأي موظف نشط
- في `firestore.rules`، صلاحية `allow read` على `/patients/{patientId}` مفتوحة لأي مستخدم نشط (`isUserActive()`) بغض النظر عن دوره أو الطبيب المعالج المرتبط بالمريض.
- هذا **قرار مقصود** وليس ثغرة: نموذج العيادة الحالي عيادة واحدة صغيرة الحجم، وربما يحتاج الطبيب أو السكرتارية الاطلاع على ملف أي مريض (تغطية زميل غائب، استفسار هاتفي، حالة طارئة) بدون قيود صارمة تعطل سير العمل اليومي.
- **حدود القرار:** الكتابة (`update`) على الشيت الطبي (`clinicalSheet`) لسه مقيدة فعليًا بمنطق الأدوار (الطبيب يقدر يعدل بس الشيت الطبي، السكرتارية تقدر تعدل كل حاجة إلا الشيت الطبي). القراءة فقط هي المفتوحة.
- لو العيادة كبرت مستقبلاً لعدة فروع أو عدد أطباء كبير وصار فصل ملفات كل طبيب مطلوب فعليًا لأسباب خصوصية أو تنظيمية، **لازم** ترجع لهذا القرار وتقيّد القراءة بـ `doctorUid` بنفس منطق `doctorUid` المستخدم فعلاً في `js/doctor-dashboard.js` للفلترة.

---

## 32. الفصل بين بيئة الديمو والإنتاج (Demo vs Production)
- الديمو يستخدم LocalStorage والمحاكاة الآمنة.
- الإنتاج يتطلب السيرفر الآمن والمصادقة الحقيقية المشفرة.

---

## 33. حظر نقل اختصارات الديمو للإنتاج
- أي ميزة تجريبية مؤقتة تبقى في بيئة الديمو فقط ولا تنتقل للإنتاج إلا بعد التجهيز الأمني الكامل.

---

## 34. التوثيق المستمر (Documentation)
- توثيق كافة القرارات المعمارية والخطط داخل مجلد `docs/`.

---

## 35. التقرير الإلزامي بعد التعديل (Standard Report)
- تقديم تقرير هندسي منظم وموحد بعد كل عملية تعديل يوضح التغييرات والمخاطر ونتيجة الاختبارات.

---

## 36. منع التخمين (Zero Guesswork)
- عند وجود أي غموض في متطلبات العميل، السؤال والتوضيح المسبق أولى من التخمين والتنفيذ الخاطئ.

---

## 37. التسليم الإلزامي للمشروع كاملاً بعد كل تعديل (Mandatory Full Project Delivery)
- إرفاق المشروع كاملاً في أرشيف واحد بصيغة `.tar.gz`.
- تزويد العميل بأمر Termux جاهز للنسخ واللصق يحتوي على فك الضغط والحذف التلقائي للأرشيف والرفع لـ GitHub.
- الالتزام بنموذج التقرير النهائي المحدد في الوثيقة.

## 38. ملاحظة داخلية (غير ظاهرة للعميل) - تاريخ الترقيم
- رقم الإصدار أُعيد تصفيره لـ v1.0.0 عند أول تسليم فعلي لعميل حقيقي (بعد إضافة حقل النوع للمريض وربطه بخطاب التأمين).
- الرقم الداخلي الأخير قبل إعادة التصفير كان v2.9.8 (يغطي: إصلاح الأمان الكامل، سجل التدقيق، النسخ الاحتياطي، جدول المواعيد بالدكاترة، خطاب تجديد التأمين).
- أي رجوع لتتبع تاريخ تعديل قديم، ابحث بالمرجع v2.9.x الداخلي مش v1.0.0.

---

## 39. حراس الجودة المعمارية المؤتمتة (The 25 Automated Quality Gatekeepers)
يلتزم المشروع بحزمة اختبارات مؤتمتة صارمة (`tests/ui-components.test.js`) تحتوي على **25 حارس جودة آلي** يُمنع تماماً كسر أي منها:
1. **Zero Native Date Pickers:** حظر عناصر `<input type="date">` والاعتماد على الكالندر المعياري.
2. **Calendar Triggers Integrity:** التحقق من ارتباط عناصر `data-open-calendar`.
3. **Custom Picker Integrity:** التحقق من ارتباط عناصر `data-open-picker`.
4. **Batch Sessions Modal Compliance:** التحقق من تفعيل التبديل، الاختيار، والزر المدمج.
5. **App Coordinator Parity:** تسجيل كافة منتقيات الأطباء والمزامنة.
6. **Sub-Modals Navigation Parity:** حماية الانتقال بين النوافذ الفرعية وتفادي كسر التاريخ (`skipHistory`).
7. **Contract Radio Name Parity:** مطابقة أسماء حقول أنواع التعاقد.
8. **Patient Modal Scroll Guardrail:** ضمان مسافة التمرير الآمنة (100px bottom clearance) وسلاسة التمرير.
9. **Insurance Claim Print Guardrail:** عزل وتنسيق طباعة المطالبات والتفويض للطباعة اللاسلكية.
10. **Bottom Footers & Safe Print Margins:** ضبط هوامش وتذييلات بطاقات الحضور والتقارير المالية.
11. **Medical Statement Branding:** تثبيت ترويسة واسم المركز في الإفادة الطبية.
12. **Cash Receipt A5 Frame & Footer:** الالتزام بإطار A5 بارتفاع 194mm وتثبيت التاريخ.
13. **Insurance Renewal Letter A5 Frame & Footer:** ضبط إطار ونموذج خطابات تجديد التأمين.
14. **Session Edit Scroll-to-Top:** التمرير التلقائي السلس لأعلى النموذج عند التعديل والإتمام.
15. **White-Label Centralization:** خلو الكود من أي أسماء مراكز صلبة والاعتماد على `clinic-config.js`.
16. **Sessions Screen Home Visits Tab:** التحقق من تبويبات وحاويات ودوال الزيارات المنزلية.
17. **ES Module Imports Integrity:** التحقق بنسبة 100% من صحة كافة استيرادات وحدات JavaScript وتصديراتها المسماة.
18. **Minimalist Pull-to-Force-Reload:** التحقق من ودجة السحب الدائرية الأنيقة وحلقة SVG ومزامنة PWA.
19. **Active View Persistence:** استعادة الشاشة النشطة فورياً عند إعادة تحميل الصفحة.
20. **Doctor Rates & Cache Invalidation:** تطابق نسب الأطباء ومسح الكاش الموضعي عند التعديل.
21. **UX Polish & Unsaved Changes Protection:** حماية نموذج المريض من الإغلاق غير المقصود عند وجود تعديلات لم تُحفظ وميض الشيمر للحسابات.
22. **Protected DOM Coupling Integrity:** التحقق من وجود كافة المعرفات الاستاتيكية الـ 700 المحصورة في `docs/DOM_COUPLING_MAP.md` داخل `index.html`.
23. **Zero !important Architecture Gatekeeper:** منع وحظر استخدام `!important` بنسبة 100% داخل جميع ملفات شاشات العرض (`css/views/*.css`).
24. **HTML Inline Style Freeze Gatekeeper:** تجميد ومنع أي تنسيقات داخلية (`style="..."`) عشوائية في `index.html`.
25. **Data Safety & XSS Gatekeeper:** التحقق التلقائي من تطبيق دالة التعقيم الصارم `escapeHTML()` على كافة البيانات الديناميكية في الموديولات التشغيلية الستة.
