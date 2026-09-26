# خريطة نقاط الاتصال بين الجافاسكريبت وواجهة المستخدم (ASCPT DOM Coupling Map)

> **وثيقة أمان أساسية (Phase 0 Safety Net):** يمنع منعاً باتاً حذف أو تعديل أي معرّف (ID) أو كلاس وظيفي مسجل في هذه الخريطة أثناء عمليات تنظيف وإعادة هيكلة `index.html` أو ملفات CSS، إلا بعد تعديل ملف الجافاسكريبت المعني بالتوازي.

---

## 1. الإحصائيات العامة لخط الأساس (Baseline Statistics)
- **إجمالي المعرفات المحمية المرتبطة بالجافاسكريبت:** 728 معرّف فريد.
- **معرفات ثابتة موجودة مباشرة في index.html:** 679 معرّف.
- **معرفات ديناميكية يتم توليدها داخل قوالب JS (innerHTML):** 49 معرّف.
- **إجمالي الكلاسات الوظيفية المرتبطة بمنطق JS:** 83 كلاس وظيفي.

---

## 2. جدول توزيع المعرفات المحمية حسب الموديول (Module Breakdown)
| الموديول | عدد المعرفات المحمية | الوظيفة الأساسية |
| :--- | :---: | :--- |
| `app.js` | **101** | منسق التطبيق العام، شريط التنقل، المودالات العامة، وتبديل الواجهات |
| `appointments.js` | **98** | جدول المواعيد الأسبوعية، الحجز السريع، واستبعاد الجمعة |
| `audit.js` | **31** | سجل التدقيق والرقابة الإدارية والتتبع الزمني |
| `auth.js` | **7** | تسجيل الدخول، إدارة الجلسات، واسترجاع الملف الشخصي |
| `claims.js` | **63** | إدارة مطالبات التأمين الصحي، خطابات التجديد، وكروت الشركات |
| `doctor-dashboard.js` | **25** | لوحة تحكم الطبيب، جدول المواعيد، الإحصائيات، والإنهاء السريري |
| `export.js` | **7** | تصدير البيانات، التقارير المطبوعة، وإعدادات الطباعة |
| `finance.js` | **89** | البيان المالي، كروت الأطباء، المصروفات، والتقرير الشهري |
| `notifications.js` | **10** | شريط الإشعارات، البادج، والنوافذ المنبثقة |
| `patients.js` | **237** | إدارة المرضى، كروت الحالات، شيت العلاج الطبيعي السريري، والفلاتر |
| `pwa.js` | **4** | محرك سحب التحديث، التخزين المحلي، وحالة الشبكة |
| `roles.js` | **3** | التحكم في الصلاحيات والوصول بحسب الرتبة |
| `sessions.js` | **73** | تسجيل الحضور اليومي، الزيارات المنزلية، وباتشات الجلسات |
| `utils.js` | **2** | أدوات التنبيهات المساعدة والـ Toast |

---

## 3. قائمة المعرفات المحمية التفصيلية حسب كل ملف (Protected IDs by File)

### `app.js` (101 معرّف محمي)
<details>
<summary>اضغط لعرض كافة معرّفات app.js</summary>

```text
- #admin-system-version-label [موجود في index.html]
- #appt-doctor-select [موجود في index.html]
- #backup-file-input [موجود في index.html]
- #backup-status-hint [موجود في index.html]
- #batch-hv-doctor [موجود في index.html]
- #btn-cancel-change-pwd [موجود في index.html]
- #btn-cancel-login [موجود في index.html]
- #btn-card-print-current [موجود في index.html]
- #btn-close-auth-modal [موجود في index.html]
- #btn-close-change-pwd-modal [موجود في index.html]
- #btn-close-profile-footer [موجود في index.html]
- #btn-close-user-profile-modal [موجود في index.html]
- #btn-dashboard-view-all-sessions [موجود في index.html]
- #btn-do-login [موجود في index.html]
- #btn-download-backup [موجود في index.html]
- #btn-forgot-password [موجود في index.html]
- #btn-login-text [موجود في index.html]
- #btn-logout-desktop [موجود في index.html]
- #btn-logout-mobile [ديناميكي في JS]
- #btn-multi-picker-add-new [موجود في index.html]
- #btn-multi-picker-confirm [موجود في index.html]
- #btn-picker-add-new-patient [موجود في index.html]
- #btn-print-attendance-cards [موجود في index.html]
- #btn-print-claim-statement [موجود في index.html]
- #btn-print-report [موجود في index.html]
- #btn-print-sheet-bottom [موجود في index.html]
- #btn-print-sheet-top [ديناميكي في JS]
- #btn-profile-admin-panel [موجود في index.html]
- #btn-profile-change-pwd [موجود في index.html]
- #btn-profile-logout [موجود في index.html]
- #btn-profile-toggle-theme [موجود في index.html]
- #btn-quick-new-patient [موجود في index.html]
- #btn-restore-backup [موجود في index.html]
- #btn-select-${selectId} [ديناميكي في JS]
- #btn-submit-change-pwd [موجود في index.html]
- #btn-submit-change-pwd-text [موجود في index.html]
- #btn-toggle-password [موجود في index.html]
- #btn-toggle-theme [ديناميكي في JS]
- #btn-toggle-theme-desktop [موجود في index.html]
- #cal-btn-confirm [موجود في index.html]
- #cal-btn-next [موجود في index.html]
- #cal-btn-prev [موجود في index.html]
- #cal-days-container [موجود في index.html]
- #cal-month-year [موجود في index.html]
- #cal-selected-sub [موجود في index.html]
- #change-pwd-confirm [موجود في index.html]
- #change-pwd-current [موجود في index.html]
- #change-pwd-error [موجود في index.html]
- #change-pwd-new [موجود في index.html]
- #custom-picker-list [موجود في index.html]
- #custom-picker-title [موجود في index.html]
- #dashboard-date-display [موجود في index.html]
- #dashboard-tab-content-recent [موجود في index.html]
- #dashboard-tab-content-waiting [موجود في index.html]
- #dialog-btn-cancel [موجود في index.html]
- #dialog-btn-confirm [موجود في index.html]
- #dialog-icon [موجود في index.html]
- #dialog-input [موجود في index.html]
- #dialog-message [موجود في index.html]
- #dialog-title [موجود في index.html]
- #doc-dashboard-date-display [موجود في index.html]
- #doc-hero-greeting [موجود في index.html]
- #form-change-password [موجود في index.html]
- #form-expense [موجود في index.html]
- #form-login [موجود في index.html]
- #hero-greeting-full [موجود في index.html]
- #icon-toggle-password [موجود في index.html]
- #login-email [موجود في index.html]
- #login-error-msg [موجود في index.html]
- #login-password [موجود في index.html]
- #modal-auth [موجود في index.html]
- #modal-change-password [موجود في index.html]
- #month-picker-confirm-btn [موجود في index.html]
- #month-picker-months-container [موجود في index.html]
- #month-picker-next-year [موجود في index.html]
- #month-picker-prev-year [موجود في index.html]
- #month-picker-quick-current [موجود في index.html]
- #month-picker-quick-last [موجود في index.html]
- #month-picker-sub [موجود في index.html]
- #month-picker-year [موجود في index.html]
- #multi-picker-confirm-text [موجود في index.html]
- #multi-picker-options-list [موجود في index.html]
- #multi-picker-title [موجود في index.html]
- #p-doctor [ديناميكي في JS]
- #profile-modal-avatar-icon [موجود في index.html]
- #profile-modal-user-email [موجود في index.html]
- #profile-modal-user-name [موجود في index.html]
- #profile-modal-user-role [موجود في index.html]
- #profile-theme-icon [موجود في index.html]
- #profile-theme-label [موجود في index.html]
- #session-doctor-select [موجود في index.html]
- #sidebar-user-profile-trigger [موجود في index.html]
- #tab-btn-recent-sessions [موجود في index.html]
- #tab-btn-waiting-patients [موجود في index.html]
- #toast-icon [موجود في index.html]
- #toast-message [موجود في index.html]
- #toast-notification [موجود في index.html]
- #b-nav-avatar-letter [موجود في index.html]
- #view-notifications [موجود في index.html]
- #view-profile [موجود في index.html]
- #view-settings [موجود في index.html]
- #view-${viewName} [ديناميكي في JS]
- #waiting-tab-actions [موجود في index.html]
- #walkin-doctor-select [موجود في index.html]
```
</details>

### `appointments.js` (98 معرّف محمي)
<details>
<summary>اضغط لعرض كافة معرّفات appointments.js</summary>

```text
- #appointments-grid [موجود في index.html]
- #appt-body-part [موجود في index.html]
- #appt-calendar-picker [موجود في index.html]
- #appt-day-stats-pill [موجود في index.html]
- #appt-doctor-select [موجود في index.html]
- #appt-modal-days-grid [موجود في index.html]
- #appt-modal-title [موجود في index.html]
- #appt-patient-picker-trigger [موجود في index.html]
- #appt-picker-patients-list [موجود في index.html]
- #appt-picker-search-input [موجود في index.html]
- #appt-schedule-preview-text [موجود في index.html]
- #appt-sheet-area-val [موجود في index.html]
- #appt-sheet-date-val [موجود في index.html]
- #appt-sheet-doc-val [موجود في index.html]
- #appt-sheet-patient-name [موجود في index.html]
- #appt-sheet-status-badge [موجود في index.html]
- #appt-sheet-sub-info [موجود في index.html]
- #appt-sheet-time-val [موجود في index.html]
- #appt-slot-select [موجود في index.html]
- #appt-weekday-strip [موجود في index.html]
- #badge-waiting-count [موجود في index.html]
- #btn-add-new-slot [موجود في index.html]
- #btn-appt-next-day [موجود في index.html]
- #btn-appt-prev-day [موجود في index.html]
- #btn-appt-sheet-apologize-today [موجود في index.html]
- #btn-appt-sheet-call [موجود في index.html]
- #btn-appt-sheet-checkin [موجود في index.html]
- #btn-appt-sheet-complete [موجود في index.html]
- #btn-appt-sheet-delete [موجود في index.html]
- #btn-appt-sheet-finish-course [موجود في index.html]
- #btn-appt-sheet-move [موجود في index.html]
- #btn-appt-sheet-noshow [موجود في index.html]
- #btn-appt-sheet-reset-scheduled [موجود في index.html]
- #btn-appt-sheet-whatsapp [موجود في index.html]
- #btn-appt-today [موجود في index.html]
- #btn-book-new-appt [موجود في index.html]
- #btn-copy-shift-sat-mon-wed [موجود في index.html]
- #btn-copy-shift-sun-tue-thu [موجود في index.html]
- #btn-delete-slot-row [موجود في index.html]
- #btn-doc-appts-active [ديناميكي في JS]
- #btn-doc-appts-completed [ديناميكي في JS]
- #btn-move-preset-daily [موجود في index.html]
- #btn-move-preset-sat-mon-wed [موجود في index.html]
- #btn-move-preset-sun-tue-thu [موجود في index.html]
- #btn-open-shift-coverage [موجود في index.html]
- #btn-period-am [موجود في index.html]
- #btn-period-pm [موجود في index.html]
- #btn-preset-daily [موجود في index.html]
- #btn-preset-sat-mon-wed [موجود في index.html]
- #btn-preset-sun-tue-thu [موجود في index.html]
- #btn-reception-walkin [موجود في index.html]
- #btn-save-slot-time [موجود في index.html]
- #btn-submit-copy-appt [موجود في index.html]
- #btn-view-mode-daily [موجود في index.html]
- #btn-view-mode-weekly [موجود في index.html]
- #card-dashboard-recent [موجود في index.html]
- #copy-appt-current-info [موجود في index.html]
- #copy-appt-days-grid [موجود في index.html]
- #copy-appt-doctor [موجود في index.html]
- #copy-appt-patient-name [موجود في index.html]
- #copy-appt-slot [موجود في index.html]
- #coverage-active-badge [موجود في index.html]
- #coverage-active-list [موجود في index.html]
- #coverage-date-input [موجود في index.html]
- #coverage-doc-select [موجود في index.html]
- #coverage-notes-input [موجود في index.html]
- #dashboard-waiting-mobile-cards [موجود في index.html]
- #dashboard-waiting-tbody [تمت إزالته لاعتماد الكروت بالكامل]
- #form-copy-appointment [موجود في index.html]
- #form-edit-appointment-slot [موجود في index.html]
- #form-move-appointment [موجود في index.html]
- #form-shift-coverage [موجود في index.html]
- #modal-appointment-form [موجود في index.html]
- #modal-edit-appointment-slot [موجود في index.html]
- #modal-slot-title [موجود في index.html]
- #modal-walkin-form [موجود في index.html]
- #move-appt-current-info [موجود في index.html]
- #move-appt-doctor [موجود في index.html]
- #move-appt-patient-name [موجود في index.html]
- #move-appt-slot [موجود في index.html]
- #move-modal-days-grid [موجود في index.html]
- #my-appointments-grid [موجود في index.html]
- #reception-doc-filter-bar [موجود في index.html]
- #session-doctor-select [موجود في index.html]
- #slot-edit-mode [موجود في index.html]
- #slot-edit-old-key [موجود في index.html]
- #slot-input-hour [موجود في index.html]
- #slot-input-minute [موجود في index.html]
- #slot-input-period [موجود في index.html]
- #slot-preview-label [موجود في index.html]
- #slot-quick-chips [موجود في index.html]
- #text-appt-sheet-apologize [موجود في index.html]
- #walkin-doctor-select [موجود في index.html]
- #walkin-notes [موجود في index.html]
- #walkin-patient-id [موجود في index.html]
- #walkin-patient-name [موجود في index.html]
- #walkin-patient-picker-trigger [موجود في index.html]
- #walkin-slot-select [موجود في index.html]
```
</details>

### `audit.js` (31 معرّف محمي)
<details>
<summary>اضغط لعرض كافة معرّفات audit.js</summary>

```text
- #admin-users-mobile-cards [موجود في index.html]
- #admin-users-tbody [ديناميكي في JS]
- #audit-log-mobile-cards [موجود في index.html]
- #audit-log-tbody [تمت إزالته لاعتماد الكروت بالكامل]
- #btn-save-doctor-shift [موجود في index.html]
- #form-add-user [موجود في index.html]
- #form-group-newuser-rates [موجود في index.html]
- #form-group-newuser-shift [موجود في index.html]
- #newuser-email [موجود في index.html]
- #newuser-hemiplegia-rate [موجود في index.html]
- #newuser-name [موجود في index.html]
- #newuser-password [موجود في index.html]
- #newuser-pediatric-rate [ديناميكي في JS]
- #newuser-quadriplegia-rate [موجود في index.html]
- #newuser-regular-rate [موجود في index.html]
- #newuser-role [موجود في index.html]
- #newuser-scoliosis-rate [موجود في index.html]
- #newuser-shift [موجود في index.html]
- #newuser-special-rate [موجود في index.html]
- #shift-modal-doctor-name [موجود في index.html]
- #shift-modal-hemiplegia-rate [موجود في index.html]
- #shift-modal-pediatric-rate [ديناميكي في JS]
- #shift-modal-quadriplegia-rate [موجود في index.html]
- #shift-modal-regular-rate [موجود في index.html]
- #shift-modal-scoliosis-rate [موجود في index.html]
- #shift-modal-special-rate [موجود في index.html]
- #shift-modal-target-uid [موجود في index.html]
- #stat-admin-audit-count [موجود في index.html]
- #stat-admin-doctors-count [موجود في index.html]
- #stat-admin-staff-count [موجود في index.html]
- #stat-admin-total-users [موجود في index.html]
```
</details>

### `auth.js` (7 معرّف محمي)
<details>
<summary>اضغط لعرض كافة معرّفات auth.js</summary>

```text
- #btn-cancel-login [موجود في index.html]
- #form-login [موجود في index.html]
- #login-error-msg [موجود في index.html]
- #modal-auth [موجود في index.html]
- #sidebar-user-name [موجود في index.html]
- #sidebar-user-role [موجود في index.html]
```
</details>

### `claims.js` (63 معرّف محمي)
<details>
<summary>اضغط لعرض كافة معرّفات claims.js</summary>

```text
- #btn-card-add-treatment [ديناميكي في JS]
- #btn-card-print-current [موجود في index.html]
- #btn-card-save [موجود في index.html]
- #btn-claim-select-all [موجود في index.html]
- #btn-export-claim-excel [موجود في index.html]
- #btn-load-claim-patients [موجود في index.html]
- #btn-open-picker-card-treatments [موجود في index.html]
- #btn-print-attendance-cards [موجود في index.html]
- #btn-print-claim-statement [موجود في index.html]
- #btn-reopen-claim-settings [موجود في index.html]
- #btn-save-claim [موجود في index.html]
- #btn-settle-claim-action [موجود في index.html]
- #btn-toggle-claim-settings [موجود في index.html]
- #card-input-diagnosis [موجود في index.html]
- #card-input-eval [موجود في index.html]
- #card-modal-company-name [موجود في index.html]
- #card-modal-patient-name [موجود في index.html]
- #card-plan-preview-list [موجود في index.html]
- #card-treatment-chips-container [موجود في index.html]
- #card-treatments-count-badge [موجود في index.html]
- #card-treatments-selected-preview [موجود في index.html]
- #claim-company-select [موجود في index.html]
- #claim-default-eval-fee [موجود في index.html]
- #claim-default-session-rate [موجود في index.html]
- #claim-doc-date [موجود في index.html]
- #claim-end-date [موجود في index.html]
- #claim-grand-total-amount [موجود في index.html]
- #claim-mob-total-${patientId} [ديناميكي في JS]
- #claim-patient-search-input [موجود في index.html]
- #claim-patients-mobile-cards [موجود في index.html]
- #claim-patients-table [تمت إزالته لاعتماد الكروت بالكامل]
- #claim-patients-tbody [تمت إزالته لاعتماد الكروت بالكامل]
- #claim-print-company-name [موجود في index.html]
- #claim-print-date [موجود في index.html]
- #claim-print-grand-total [موجود في index.html]
- #claim-print-period-text [موجود في index.html]
- #claim-print-tax-no [موجود في index.html]
- #claim-print-tbody [موجود في index.html]
- #claim-row-total-${patientId} [ديناميكي في JS]
- #claim-search-stats [موجود في index.html]
- #claim-select-all-cb [تمت إزالته لاعتماد الكروت بالكامل]
- #claim-settings-body [موجود في index.html]
- #claim-settings-summary-strip [موجود في index.html]
- #claim-start-date [موجود في index.html]
- #claim-summary-strip-text [موجود في index.html]
- #claim-table-container [تمت إزالته لاعتماد الكروت بالكامل]
- #claim-tax-number [موجود في index.html]
- #claim-top-scroll-dummy [تمت إزالته لاعتماد الكروت بالكامل]
- #claim-top-scroll-wrap [تمت إزالته لاعتماد الكروت بالكامل]
- #claim-total-patients-count [موجود في index.html]
- #claim-total-sessions-count [موجود في index.html]
- #claims-ledger-card [موجود في index.html]
- #claims-ledger-company-filter [موجود في index.html]
- #claims-ledger-count-badge [موجود في index.html]
- #claims-ledger-mobile-cards [موجود في index.html]
- #claims-ledger-search [موجود في index.html]
- #claims-ledger-tbody [تمت إزالته لاعتماد الكروت بالكامل]
- #icon-claim-select-all [موجود في index.html]
- #icon-toggle-claim-settings [موجود في index.html]
- #printable-attendance-cards [موجود في index.html]
- #printable-insurance-claim [موجود في index.html]
- #text-claim-select-all [موجود في index.html]
- #text-toggle-claim-settings [موجود في index.html]
```
</details>

### `doctor-dashboard.js` (25 معرّف محمي)
<details>
<summary>اضغط لعرض كافة معرّفات doctor-dashboard.js</summary>

```text
- #badge-doc-home-visits [ديناميكي في JS]
- #btn-doc-filter-${t} [ديناميكي في JS]
- #doc-table-title [موجود في index.html]
- #doctor-dashboard-sub [ديناميكي في JS]
- #doctor-personal-mobile-cards [موجود في index.html]
- #doctor-personal-tbody [تمت إزالته لاعتماد الكروت بالكامل]
- #my-appointments-grid [موجود في index.html]
- #stat-doc-active-breakdown [موجود في index.html]
- #stat-doc-active-num [موجود في index.html]
- #stat-doc-cash-val [موجود في index.html]
- #stat-doc-earnings-formula-hint [موجود في index.html]
- #stat-doc-earnings-total [موجود في index.html]
- #stat-doc-ins-val [موجود في index.html]
- #stat-doc-lifetime-count [موجود في index.html]
- #stat-doc-month-count [موجود في index.html]
- #stat-doc-month-num [موجود في index.html]
- #stat-doc-month-sub [موجود في index.html]
- #stat-doc-month-total-sessions [موجود في index.html]
- #stat-doc-patients-num [موجود في index.html]
- #stat-doc-patients-sub [موجود في index.html]
- #stat-doc-programs-container [موجود في index.html]
- #stat-doc-today-count [موجود في index.html]
- #stat-doc-today-num [موجود في index.html]
- #stat-doc-today-sub [موجود في index.html]
- #stat-doc-types-ratio [موجود في index.html]
```
</details>

### `export.js` (7 معرّف محمي)
<details>
<summary>اضغط لعرض كافة معرّفات export.js</summary>

```text
- #btn-export-excel [موجود في index.html]
- #btn-print-report [موجود في index.html]
- #finance-claims-content [موجود في index.html]
- #finance-report-tbody [موجود في index.html]
- #print-report-meta [موجود في index.html]
- #print-report-subtitle [موجود في index.html]
- #toast-notification [موجود في index.html]
```
</details>

### `finance.js` (89 معرّف محمي)
<details>
<summary>اضغط لعرض كافة معرّفات finance.js</summary>

```text
- #btn-add-expense [موجود في index.html]
- #btn-add-settlement [ديناميكي في JS]
- #btn-confirm-cash-handoff [موجود في index.html]
- #btn-manage-expense-categories [موجود في index.html]
- #btn-mode-claims [موجود في index.html]
- #btn-mode-daily [موجود في index.html]
- #btn-mode-monthly [موجود في index.html]
- #btn-quick-fin-today [موجود في index.html]
- #btn-quick-fin-yesterday [موجود في index.html]
- #btn-settle-claim-action [موجود في index.html]
- #card-cash-drawer-glance [موجود في index.html]
- #card-finance-daily-expenses [موجود في index.html]
- #card-monthly-settlements [موجود في index.html]
- #daily-doctors-mobile-deck [موجود في index.html]
- #daily-settlements-mobile-cards [موجود في index.html]
- #daily-settlements-tbody [تمت إزالته لاعتماد الكروت بالكامل]
- #daily-settlements-total-badge [موجود في index.html]
- #dashboard-recent-mobile-cards [موجود في index.html]
- #dashboard-recent-table [تمت إزالته لاعتماد الكروت بالكامل]
- #doctors-breakdown-container [موجود في index.html]
- #drawer-calc-breakdown [موجود في index.html]
- #drawer-handoff-status [موجود في index.html]
- #drawer-net-cash-display [موجود في index.html]
- #exp-amount [موجود في index.html]
- #exp-category-select [موجود في index.html]
- #exp-notes [موجود في index.html]
- #filter-group-daily [موجود في index.html]
- #filter-group-monthly [موجود في index.html]
- #finance-claims-content [موجود في index.html]
- #finance-daily-content [موجود في index.html]
- #finance-daily-settlements-card [موجود في index.html]
- #finance-date-picker [موجود في index.html]
- #finance-doctor-filter [موجود في index.html]
- #finance-expenses-mobile-cards [موجود في index.html]
- #finance-expenses-table [موجود في index.html]
- #finance-expenses-tbody [موجود في index.html]
- #finance-filter-bar-card [موجود في index.html]
- #finance-header-sub [ديناميكي في JS]
- #finance-header-title [موجود في index.html]
- #finance-kpi-stats-grid [موجود في index.html]
- #finance-month-picker [موجود في index.html]
- #finance-monthly-content [موجود في index.html]
- #finance-report-tbody [موجود في index.html]
- #finance-top-actions [موجود في index.html]
- #form-add-expense-category [موجود في index.html]
- #form-expense [موجود في index.html]
- #form-settle-claim [موجود في index.html]
- #input-new-expense-category [موجود في index.html]
- #manage-expense-categories-list [موجود في index.html]
- #monthly-calc-breakdown [موجود في index.html]
- #monthly-cash-income-val [موجود في index.html]
- #monthly-doctors-mobile-cards [موجود في index.html]
- #monthly-doctors-table [موجود في index.html]
- #monthly-doctors-tbody [موجود في index.html]
- #monthly-expense-categories-count-badge [موجود في index.html]
- #monthly-expenses-categories-mobile [موجود في index.html]
- #monthly-expenses-categories-table [موجود في index.html]
- #monthly-expenses-categories-tbody [موجود في index.html]
- #monthly-expenses-mobile-cards [موجود في index.html]
- #monthly-expenses-tbody [تمت إزالته لاعتماد الكروت بالكامل]
- #monthly-financial-summary-mobile [موجود في index.html]
- #monthly-financial-summary-table [موجود في index.html]
- #monthly-financial-summary-tbody [موجود في index.html]
- #monthly-financial-summary-tfoot [موجود في index.html]
- #monthly-insurance-mobile-cards [موجود في index.html]
- #monthly-insurance-table [موجود في index.html]
- #monthly-insurance-tbody [موجود في index.html]
- #monthly-margin-pct [موجود في index.html]
- #monthly-margin-status-pill [موجود في index.html]
- #monthly-net-profit-display [موجود في index.html]
- #monthly-settlements-income-val [موجود في index.html]
- #monthly-settlements-mobile-cards [موجود في index.html]
- #monthly-settlements-table [موجود في index.html]
- #monthly-settlements-tbody [موجود في index.html]
- #monthly-settlements-total-badge [موجود في index.html]
- #monthly-total-expenses-val [موجود في index.html]
- #rep-net-cash [موجود في index.html]
- #rep-total-cash [موجود في index.html]
- #rep-total-expenses [موجود في index.html]
- #rep-total-patients [موجود في index.html]
- #rep-total-patients-label [موجود في index.html]
- #settle-claim-period [موجود في index.html]
- #settle-company-select [موجود في index.html]
- #settle-date [موجود في index.html]
- #settle-deduction-reason [موجود في index.html]
- #settle-deductions [موجود في index.html]
- #settle-gross-amount [موجود في index.html]
- #settle-net-display [موجود في index.html]
- #settle-notes [موجود في index.html]
- #settle-ref-number [موجود في index.html]
- #stat-cash-today [موجود في index.html]
- #stat-expenses-today [موجود في index.html]
- #stat-insurance-count [موجود في index.html]
- #stat-patients-today [موجود في index.html]
- #view-finance [موجود في index.html]
```
</details>

### `notifications.js` (10 معرّف محمي)
<details>
<summary>اضغط لعرض كافة معرّفات notifications.js</summary>

```text
- #btn-close-primer-x [موجود في index.html]
- #btn-mark-all-read [موجود في index.html]
- #btn-primer-confirm [موجود في index.html]
- #btn-primer-dismiss [موجود في index.html]
- #btn-toggle-push-notifications [موجود في index.html]
- #notification-badge [موجود في index.html]
- #notifications-list [موجود في index.html]
- #push-status-text [موجود في index.html]
```
</details>

### `patients.js` (237 معرّف محمي)
<details>
<summary>اضغط لعرض كافة معرّفات patients.js</summary>

```text
- #action-prompt-patient-name [موجود في index.html]
- #badge-today-patients-count [موجود في index.html]
- #batch-hv-count [موجود في index.html]
- #batch-hv-dates-chips [موجود في index.html]
- #batch-hv-dates-count [موجود في index.html]
- #batch-hv-doc-label [موجود في index.html]
- #batch-hv-doctor [موجود في index.html]
- #batch-hv-letter-ref [موجود في index.html]
- #batch-hv-manual-date [موجود في index.html]
- #batch-hv-patient-badge [موجود في index.html]
- #batch-hv-patient-info [موجود في index.html]
- #batch-hv-patient-name [موجود في index.html]
- #batch-hv-presettled [موجود في index.html]
- #batch-hv-presettled-label [موجود في index.html]
- #batch-hv-start-date [موجود في index.html]
- #btn-add-batch-hv-single-date [موجود في index.html]
- #btn-apply-crop [موجود في index.html]
- #btn-back-to-patients-bottom [موجود في index.html]
- #btn-back-to-patients-top [موجود في index.html]
- #btn-cancel-crop [موجود في index.html]
- #btn-filter-today-patients [موجود في index.html]
- #btn-gender-female [موجود في index.html]
- #btn-gender-male [موجود في index.html]
- #btn-generate-batch-hv-dates [موجود في index.html]
- #btn-lightbox-close [موجود في index.html]
- #btn-lightbox-download [موجود في index.html]
- #btn-lightbox-next [موجود في index.html]
- #btn-lightbox-prev [موجود في index.html]
- #btn-lightbox-rotate [موجود في index.html]
- #btn-lightbox-zoom-in [موجود في index.html]
- #btn-lightbox-zoom-out [موجود في index.html]
- #btn-lightbox-zoom-reset [موجود في index.html]
- #btn-open-add-patient [موجود في index.html]
- #btn-open-patient-body-parts [موجود في index.html]
- #btn-open-picker-exercises [موجود في index.html]
- #btn-open-picker-modalities [موجود في index.html]
- #btn-open-picker-p-insurance [موجود في index.html]
- #btn-open-picker-procedures [موجود في index.html]
- #btn-patients-next-page [ديناميكي في JS]
- #btn-patients-prev-page [ديناميكي في JS]
- #btn-polish-crop [موجود في index.html]
- #btn-polish-reset [موجود في index.html]
- #btn-polish-rotate-left [موجود في index.html]
- #btn-polish-rotate-right [موجود في index.html]
- #btn-polish-save-current [موجود في index.html]
- #btn-polish-skip-or-cancel [موجود في index.html]
- #btn-print-insurance-letter [ديناميكي في JS]
- #btn-print-sheet-bottom [موجود في index.html]
- #btn-print-sheet-top [ديناميكي في JS]
- #btn-prompt-record-session [موجود في index.html]
- #btn-prompt-stay-patients [موجود في index.html]
- #btn-reset-today-filter [ديناميكي في JS]
- #btn-reset-today-filter-mob [ديناميكي في JS]
- #btn-save-patient [موجود في index.html]
- #btn-save-sheet [موجود في index.html]
- #btn-sheet-picker-body-parts [موجود في index.html]
- #btn-sort-alphabetical [موجود في index.html]
- #btn-sort-recent [موجود في index.html]
- #btn-submit-batch-hv [موجود في index.html]
- #btn-toggle-chips-${category} [ديناميكي في JS]
- #btn-toggle-chips-exercise [ديناميكي في JS]
- #btn-toggle-chips-ins-patient [ديناميكي في JS]
- #btn-toggle-chips-modality [ديناميكي في JS]
- #btn-toggle-chips-procedure [ديناميكي في JS]
- #btn-trigger-add-imaging [موجود في index.html]
- #btn-type-clinic-batch [موجود في index.html]
- #btn-type-home-visit [موجود في index.html]
- #btn-view-patient-sessions [موجود في index.html]
- #btn-wa-tpl-appt [موجود في index.html]
- #btn-wa-tpl-direct [موجود في index.html]
- #btn-wa-tpl-renew [موجود في index.html]
- #card-patients-directory [موجود في index.html]
- #form-add-clinical-option [موجود في index.html]
- #form-batch-home-visits [موجود في index.html]
- #form-cash-receipt [موجود في index.html]
- #form-insurance-letter [موجود في index.html]
- #form-medical-statement [موجود في index.html]
- #form-patient [موجود في index.html]
- #form-patient-sheet [موجود في index.html]
- #form-renew-approval [موجود في index.html]
- #imaging-file-input [موجود في index.html]
- #ins-letter-company [موجود في index.html]
- #ins-letter-diagnosis [موجود في index.html]
- #ins-letter-notes [موجود في index.html]
- #ins-letter-sessions [موجود في index.html]
- #ins-print-company [موجود في index.html]
- #ins-print-date [موجود في index.html]
- #ins-print-diagnosis [موجود في index.html]
- #ins-print-honorific [موجود في index.html]
- #ins-print-notes [موجود في index.html]
- #ins-print-notes-container [موجود في index.html]
- #ins-print-patient-name [موجود في index.html]
- #ins-print-sessions [موجود في index.html]
- #ins-print-verb-need [موجود في index.html]
- #ins-print-verb-suffer [موجود في index.html]
- #lightbox-category-badge [موجود في index.html]
- #lightbox-counter-badge [موجود في index.html]
- #lightbox-filmstrip-bar [موجود في index.html]
- #lightbox-img [موجود في index.html]
- #lightbox-notes-text [موجود في index.html]
- #lightbox-patient-title [موجود في index.html]
- #lightbox-stage [موجود في index.html]
- #modal-batch-title-text [موجود في index.html]
- #modal-image-lightbox [موجود في index.html]
- #modal-opt-title [موجود في index.html]
- #modal-p-sess-list [موجود في index.html]
- #modal-p-sess-patient-name [موجود في index.html]
- #modal-p-sess-total-badge [موجود في index.html]
- #modal-patient-title [موجود في index.html]
- #opt-new-name [موجود في index.html]
- #opt-target-category [موجود في index.html]
- #p-address [موجود في index.html]
- #p-age [موجود في index.html]
- #p-approval-units-text [موجود في index.html]
- #p-approved-body-parts [موجود في index.html]
- #p-approved-sessions [موجود في index.html]
- #p-body-parts [موجود في index.html]
- #p-diagnosis [ديناميكي في JS]
- #p-docs-actions-container [موجود في index.html]
- #p-docs-modal-badge [موجود في index.html]
- #p-docs-modal-info [موجود في index.html]
- #p-docs-modal-name [موجود في index.html]
- #p-gender [موجود في index.html]
- #p-id [موجود في index.html]
- #p-ins-direct-container [موجود في index.html]
- #p-ins-indirect-container [موجود في index.html]
- #p-insurance-btn-text [موجود في index.html]
- #p-insurance-company [موجود في index.html]
- #p-insurance-details [موجود في index.html]
- #p-insurance-quick-chips [موجود في index.html]
- #p-name [موجود في index.html]
- #p-phone [موجود في index.html]
- #p-phone-feedback [موجود في index.html]
- #p-print-address [موجود في index.html]
- #p-print-age [موجود في index.html]
- #p-print-billing [موجود في index.html]
- #p-print-diagnosis [موجود في index.html]
- #p-print-doctor [موجود في index.html]
- #p-print-exercise-details [موجود في index.html]
- #p-print-exercises [موجود في index.html]
- #p-print-modalities [موجود في index.html]
- #p-print-name [موجود في index.html]
- #p-print-notes [موجود في index.html]
- #p-print-phone [موجود في index.html]
- #p-print-procedures [موجود في index.html]
- #p-selected-ins-preview [موجود في index.html]
- #patient-body-parts-badge [موجود في index.html]
- #patient-body-parts-preview [موجود في index.html]
- #patient-clinical-card [موجود في index.html]
- #patient-filter-type [موجود في index.html]
- #patient-search-input [موجود في index.html]
- #patients-data-table [تمت إزالته لاعتماد الكروت بالكامل]
- #patients-mobile-cards [موجود في index.html]
- #patients-table-container [تمت إزالته لاعتماد الكروت بالكامل]
- #patients-tbody [تمت إزالته لاعتماد الكروت بالكامل]
- #patients-top-scroll-dummy [تمت إزالته لاعتماد الكروت بالكامل]
- #patients-top-scroll-wrap [تمت إزالته لاعتماد الكروت بالكامل]
- #patients-total-count-badge [موجود في index.html]
- #patients-view-mode-toggle [موجود في index.html]
- #polish-brightness-slider [موجود في index.html]
- #polish-brightness-val [موجود في index.html]
- #polish-canvas [موجود في index.html]
- #polish-category-select [موجود في index.html]
- #polish-contrast-slider [موجود في index.html]
- #polish-contrast-val [موجود في index.html]
- #polish-crop-box [موجود في index.html]
- #polish-crop-toolbar [موجود في index.html]
- #polish-queue-badge [موجود في index.html]
- #polish-save-btn-text [موجود في index.html]
- #polish-selected-cat-badge [موجود في index.html]
- #polish-standard-toolbar [موجود في index.html]
- #polish-title-input [موجود في index.html]
- #print-sheet-meta [موجود في index.html]
- #printable-cash-receipt [موجود في index.html]
- #printable-insurance-letter [موجود في index.html]
- #printable-medical-statement [موجود في index.html]
- #printable-patient-sheet [موجود في index.html]
- #receipt-amount [موجود في index.html]
- #receipt-date [موجود في index.html]
- #receipt-item-desc [موجود في index.html]
- #receipt-patient-id [موجود في index.html]
- #receipt-patient-name [موجود في index.html]
- #receipt-print-amount-text [موجود في index.html]
- #receipt-print-date [موجود في index.html]
- #receipt-print-date-val [موجود في index.html]
- #receipt-print-honorific [موجود في index.html]
- #receipt-print-item-desc [موجود في index.html]
- #receipt-print-patient-name [موجود في index.html]
- #renew-approval-date [موجود في index.html]
- #renew-approval-no [موجود في index.html]
- #renew-approval-units-text [موجود في index.html]
- #renew-approved-body-parts [موجود في index.html]
- #renew-company-name [موجود في index.html]
- #renew-patient-id [موجود في index.html]
- #renew-patient-name [موجود في index.html]
- #renew-sessions-count [موجود في index.html]
- #sheet-affected-area [موجود في index.html]
- #sheet-card-chevron [موجود في index.html]
- #sheet-card-header-toggle [موجود في index.html]
- #sheet-card-toggle-text [موجود في index.html]
- #sheet-diagnosis [موجود في index.html]
- #sheet-doctor-notes [موجود في index.html]
- #sheet-exercise-details [موجود في index.html]
- #sheet-gender-icon [موجود في index.html]
- #sheet-imaging-count-badge [موجود في index.html]
- #sheet-imaging-gallery-grid [موجود في index.html]
- #sheet-last-update-text [موجود في index.html]
- #sheet-patient-address [موجود في index.html]
- #sheet-patient-age [موجود في index.html]
- #sheet-patient-billing-badge [موجود في index.html]
- #sheet-patient-doctor [موجود في index.html]
- #sheet-patient-gender-badge [موجود في index.html]
- #sheet-patient-gender-text [موجود في index.html]
- #sheet-patient-name [موجود في index.html]
- #sheet-patient-phone [موجود في index.html]
- #sheet-patient-phone-link [موجود في index.html]
- #sheet-patient-program-badge [موجود في index.html]
- #sheet-patient-quick-actions [موجود في index.html]
- #sheet-pcm-avatar-icon [ديناميكي في JS]
- #sheet-program-hint [موجود في index.html]
- #sheet-sessions-badge-count [ديناميكي في JS]
- #sheet-sessions-btn-text [موجود في index.html]
- #sheet-sessions-count [موجود في index.html]
- #statement-body-text [موجود في index.html]
- #statement-date [موجود في index.html]
- #statement-diagnosis [موجود في index.html]
- #statement-patient-id [موجود في index.html]
- #statement-patient-name [موجود في index.html]
- #statement-print-custom-body [موجود في index.html]
- #statement-print-date [موجود في index.html]
- #statement-print-diagnosis [موجود في index.html]
- #statement-print-honorific [موجود في index.html]
- #statement-print-patient-name [موجود في index.html]
- #statement-print-rel-verb [موجود في index.html]
- #view-patients [موجود في index.html]
- #wa-modal-patient-name [موجود في index.html]
- #wa-modal-patient-phone [موجود في index.html]
```
</details>

### `pwa.js` (4 معرّف محمي)
<details>
<summary>اضغط لعرض كافة معرّفات pwa.js</summary>

```text
- #net-status-dot [موجود في index.html]
- #pull-progress-circle [موجود في index.html]
- #pull-to-reload-icon [موجود في index.html]
- #pull-to-reload-indicator [موجود في index.html]
```
</details>

### `roles.js` (3 معرّف محمي)
<details>
<summary>اضغط لعرض كافة معرّفات roles.js</summary>

```text
- #btn-open-add-patient [موجود في index.html]
- #dashboard-admin-view [موجود في index.html]
- #dashboard-doctor-view [موجود في index.html]
```
</details>

### `sessions.js` (73 معرّف محمي)
<details>
<summary>اضغط لعرض كافة معرّفات sessions.js</summary>

```text
- #body-parts-cash-hint [موجود في index.html]
- #body-parts-container [موجود في index.html]
- #btn-change-patient-picker [موجود في index.html]
- #btn-exam-type-cash [موجود في index.html]
- #btn-exam-type-contract [موجود في index.html]
- #btn-mode-exam [موجود في index.html]
- #btn-mode-session [موجود في index.html]
- #btn-open-picker-body-parts [موجود في index.html]
- #btn-quick-sess-today [موجود في index.html]
- #btn-quick-sess-yesterday [موجود في index.html]
- #btn-select-exam-contract-company-select [ديناميكي في JS]
- #btn-sessions-next-page [ديناميكي في JS]
- #btn-sessions-prev-page [ديناميكي في JS]
- #btn-submit-session-text [موجود في index.html]
- #btn-tab-clinic-sessions [موجود في index.html]
- #btn-tab-home-visits [موجود في index.html]
- #btn-toggle-chips-body-parts [ديناميكي في JS]
- #btn-toggle-chips-ins-session [ديناميكي في JS]
- #card-sessions-today [موجود في index.html]
- #exam-company-display-title [ديناميكي في JS]
- #exam-contract-badge [ديناميكي في JS]
- #exam-contract-company-select [ديناميكي في JS]
- #form-add-insurance-company [موجود في index.html]
- #form-group-body-parts [موجود في index.html]
- #form-group-exam-type [موجود في index.html]
- #form-group-special-session [موجود في index.html]
- #form-log-session [موجود في index.html]
- #icon-submit-session [موجود في index.html]
- #input-search-home-visits [موجود في index.html]
- #ins-caller-context [موجود في index.html]
- #ins-new-name [موجود في index.html]
- #ins-target-contract [موجود في index.html]
- #new-ins-type-direct [موجود في index.html]
- #new-ins-type-indirect [موجود في index.html]
- #patient-picker-trigger [موجود في index.html]
- #picker-patients-list [موجود في index.html]
- #picker-search-input [موجود في index.html]
- #selected-parts-count [موجود في index.html]
- #selected-patient-box [موجود في index.html]
- #selected-patient-name [موجود في index.html]
- #selected-patient-sub [موجود في index.html]
- #session-amount-help [موجود في index.html]
- #session-amount-label [موجود في index.html]
- #session-amount-paid [موجود في index.html]
- #session-body-parts-badge [موجود في index.html]
- #session-body-parts-preview [موجود في index.html]
- #session-contract-type-hidden [موجود في index.html]
- #session-date [موجود في index.html]
- #session-date-label [موجود في index.html]
- #session-doctor-select [موجود في index.html]
- #session-ins-direct-container [ديناميكي في JS]
- #session-ins-indirect-container [ديناميكي في JS]
- #session-insurance-fields [ديناميكي في JS]
- #session-insurance-name [موجود في index.html]
- #session-is-special [ديناميكي في JS]
- #session-notes [موجود في index.html]
- #session-notes-label [ديناميكي في JS]
- #session-patient-id [موجود في index.html]
- #session-pay-type-hidden [موجود في index.html]
- #session-payment-method-container [موجود في index.html]
- #session-payment-method-label [موجود في index.html]
- #session-program-badge-hint [موجود في index.html]
- #session-selected-ins-preview [ديناميكي في JS]
- #sessions-home-visits-count-badge [موجود في index.html]
- #sessions-hv-mobile-cards [موجود في index.html]
- #sessions-hv-tbody [تمت إزالته لاعتماد الكروت بالكامل]
- #sessions-table-container [تمت إزالته لاعتماد الكروت بالكامل]
- #sessions-table-date-label [موجود في index.html]
- #sessions-today-count-badge [موجود في index.html]
- #sessions-today-mobile-cards [موجود في index.html]
- #sessions-today-tbody [تمت إزالته لاعتماد الكروت بالكامل]
- #sessions-view-mode-toggle [ديناميكي في JS]
- #view-sessions [موجود في index.html]
```
</details>

### `utils.js` (2 معرّف محمي)
<details>
<summary>اضغط لعرض كافة معرّفات utils.js</summary>

```text
- #btn-toggle-${prefix}-layout [ديناميكي في JS]
- #icon-stack-toggle [ديناميكي في JS]
```
</details>

---

## 4. الكلاسات الوظيفية المرتبطة بالجافاسكريبت (Functional Classes)
> **تنبيه:** هذه الكلاسات ليست للتنسيق الجمالي فقط، بل يعتمد عليها منطق الجافاسكريبت عبر `classList.contains`, `classList.toggle`, `querySelector`. يمنع إعادة تسميتها أو حذفها بدون تعديل JS المقابل.

**`app.js`:** `.active`, `.b-nav-item`, `.bottom-nav`, `.btn-open-change-password`, `.btn-outline`, `.btn-print-sheet`, `.btn-text`, `.btn-toggle-pwd-visibility`, `.is-error`, `.is-success`, `.is-warning`, `.modal-backdrop`, `.modal-no-slide`, `.modal-open`, `.nav-link`, `.show`, `.sidebar-nav`, `.view-section`

**`appointments.js`:** `.active`, `.appt-date-navigator-bar`, `.appt-day-toggle`, `.appt-preset-pill`, `.btn-complete-patient`, `.btn-mark-arrived`, `.btn-record-session-now`, `.btn-text`, `.btn-toggle-expand-appts`, `.btn-undo-patient`, `.cdp-status-badge`, `.copy-day-pill`, `.doc-filter-pill`, `.is-current`

**`audit.js`:** `.audit-item-collapsed`, `.btn-toggle-audit-more`

**`auth.js`:** `.active`, `.modal-backdrop`, `.modal-close`, `.modal-no-slide`, `.not-authenticated`

**`claims.js`:** `.active`, `.btn-claim-filter-pill`, `.btn-outline`, `.btn-primary`, `.card-treatment-chip`, `.claim-patient-check`, `.claim-patient-input`, `.printing-cards`, `.printing-claim`, `.selected`, `.sheet-chip`

**`export.js`:** `.print-daily-compact`, `.print-daily-multipage`, `.print-daily-spacious`, `.printing-cards`, `.printing-claim`, `.printing-insurance-letter`, `.printing-receipt`, `.printing-sheet`, `.printing-statement`, `.show`

**`finance.js`:** `.active`, `.btn-toggle-expenses-more`, `.btn-toggle-monthly-expenses-more`, `.expense-item-collapsed`, `.no-print`

**`notifications.js`:** `.notification-item`

**`patients.js`:** `.active`, `.btn-batch-pattern`, `.btn-cat-chip`, `.btn-change-cat-choice`, `.btn-remove-batch-date`, `.btn-today-active`, `.cycle-completed`, `.cycle-near-limit`, `.input-error`, `.input-success`, `.ins-quick-chip`, `.insurance-company-card`, `.lightbox-filmstrip-item`, `.pcm-collapsed`, `.polish-preset-btn`, `.printing-insurance-letter`, `.printing-receipt`, `.printing-sheet`, `.printing-statement`, `.selected`, `.sheet-chip`, `.sheet-tag-remove-btn`, `.table-responsive`

**`pwa.js`:** `.active`, `.b-nav-item`, `.bottom-nav`, `.loading`, `.nav-link`, `.ready`, `.sidebar`

**`roles.js`:** `.admin-only`, `.b-nav-item`, `.nav-link`

**`sessions.js`:** `.active`, `.btn-text`, `.chip-choice`, `.selected`, `.sheet-chip`

**`utils.js`:** `.active`, `.doc-dot`, `.doc-stack-card`, `.is-active-card`, `.is-hidden-card`, `.is-list-layout`, `.is-passed-card`, `.is-peeking-card`

---

## 5. مصفوفة الحالات والسلوك التفاعلي المحمي (Interaction & Responsive Matrix)
1. **حاويات التمرير الأفقي للهواتف:**
   - شريط تبويبات الاستقبال (`.dashboard-segmented-tab-btn`) وشريط فلاتر الأطباء (`.chip-choice`).
   - شريط التمرير المزدوج لجدول المرضى (`#patients-top-scroll-wrap`).
2. **المودالات والقوائم السفلية الحساسة:**
   - مودال تسجيل مريض جديد (`#modal-patient`): يتطلب هامش سفلي لا يقل عن `100px` وخاصية `touch-action: pan-y` لضمان عدم حجب أزرار الحفظ على الموبايل.
   - مودال الجلسات المجمعة والزيارات المنزلية (`#modal-batch-home-visits`): محظور استخدام `<input type="date">` الخام نهائياً والالتزام بمحفز التقويم المخصص.
3. **سلوك النوافذ المنبثقة المتتالية (Sub-Modals Anti-Race):**
   - الانتقال بين شيت المستندات (`#modal-patient-docs`) والنوافذ الفرعية مشروط بـ `skipHistory: true` لمنع ارتباك زر الرجوع في المتصفح.
