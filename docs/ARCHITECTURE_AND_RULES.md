# PhysioFlow — Permanent Code & Project Organization Rules

وثيقة القواعد الهندسية الدائمة لمشروع PhysioFlow.
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
physioflow/
│
├── index.html
├── manifest.json
├── package.json
├── sw.js
├── README.md
│
├── css/
│   ├── style.css
│   └── print.css
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
│   └── demo-data.js    # Preloaded showcase data
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

## 13. دعم تعدد العيادات (Multi-Tenant Architecture)
- تصميم السجلات لترتبط دائماً بـ `clinicId`.
- عزل بيانات كل مركز بالكامل عبر Security Rules لمنع أي تداخل بين العيادات.

---

## 14. كود موحد للجميع (No Client-Specific Forks)
- كود برمجي واحد (One Single Codebase).
- أي تخصيص لمركز يكون عبر ملف الإعدادات (Configuration) فقط، وليس بإنشاء نسخة كود منفصلة.

---

## 15. تنظيم ملفات التنسيق (CSS Organization)
- استخدام المتغيرات المعيارية `--radius-md`, `--primary` وتجنب الإضافات العشوائية أو تكرار القواعد.
- تجنب `!important` إلا للضرورات القصوى.

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
