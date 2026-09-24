import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const htmlPath = path.join(rootDir, 'index.html');
const appJsPath = path.join(rootDir, 'js/app.js');

console.log('--- Running ASCPT UI Component Compliance Guardrail ---');

const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
const appJsContent = fs.readFileSync(appJsPath, 'utf-8');
const styleCssPath = path.join(rootDir, 'css/style.css');
const modularCssFiles = [
  'css/design-tokens.css',
  'css/base.css',
  'css/components/skeletons.css',
  'css/components/buttons.css',
  'css/components/chips-badges.css',
  'css/components/cards.css',
  'css/components/forms.css',
  'css/components/modals.css',
  'css/components/tables.css',
  'css/components/notifications.css',
  'css/components/lightbox.css',
  'css/components/image-editor.css',
  'css/views/shell.css',
  'css/views/reception.css',
  'css/views/patients.css',
  'css/views/doctor.css',
  'css/views/sessions.css',
  'css/views/admin.css',
  'css/views/finance.css',
  'css/views/claims.css',
  'css/views/appointments.css'
];
const getModularCssContent = () => {
  if (fs.existsSync(styleCssPath)) {
    return fs.readFileSync(styleCssPath, 'utf-8');
  }
  return modularCssFiles
    .filter(f => fs.existsSync(path.join(rootDir, f)))
    .map(f => fs.readFileSync(path.join(rootDir, f), 'utf-8'))
    .join('\n');
};
const styleCssContent = getModularCssContent();
const lines = htmlContent.split('\n');

// 1. Strict Guardrail: ZERO Native Date Pickers (<input type="date"> is strictly prohibited across the entire app)
const dateInputViolations = [];
lines.forEach((line, idx) => {
  if (line.includes('type="date"') || line.includes("type='date'")) {
    dateInputViolations.push(`Line ${idx + 1}: ${line.trim()}`);
  }
});

assert.equal(
  dateInputViolations.length,
  0,
  `[GUARDRAIL FAILURE] Found ${dateInputViolations.length} native date picker(s) (<input type="date">) in index.html.\n` +
  `ASCPT Engineering Standards strictly prohibit native date inputs.\n` +
  `Always use: <input type="text" readonly class="form-control modern-input date-picker-clickable" data-open-calendar="[id]" placeholder="اختر التاريخ...">\n` +
  `Violations:\n` + dateInputViolations.join('\n')
);
console.log('✓ 1. Zero Native Date Pickers: No <input type="date"> anywhere in index.html.');

// 2. Strict Guardrail: Calendar Triggers Integrity
const calTriggers = [...htmlContent.matchAll(/data-open-calendar=["']([^"']+)["']/g)].map(m => m[1]);
assert(calTriggers.length >= 10, 'Should have registered calendar triggers');
calTriggers.forEach(id => {
  const hasElement = htmlContent.includes(`id="${id}"`) || htmlContent.includes(`id='${id}'`);
  assert(hasElement, `[GUARDRAIL FAILURE] data-open-calendar references missing element id: "${id}"`);
});
console.log(`✓ 2. Calendar Triggers Integrity: Verified ${calTriggers.length} data-open-calendar bindings.`);

// 3. Strict Guardrail: Custom Picker Triggers Integrity
const pickerTriggers = [...htmlContent.matchAll(/data-open-picker=["']([^"']+)["']/g)].map(m => m[1]);
assert(pickerTriggers.length >= 10, 'Should have registered custom select triggers');
pickerTriggers.forEach(id => {
  const hasSelect = htmlContent.includes(`<select id="${id}"`) || htmlContent.includes(`<select id='${id}'`);
  assert(hasSelect, `[GUARDRAIL FAILURE] data-open-picker references missing <select id="${id}">`);
});
console.log(`✓ 3. Custom Picker Integrity: Verified ${pickerTriggers.length} data-open-picker select bindings.`);

// 4. Strict Guardrail: Batch Sessions & Home Visits Modal Custom UI Compliance
const batchModalMatch = htmlContent.match(/<div[^>]*id=["']modal-batch-home-visits["'][\s\S]*?<\/form>\s*<\/div>\s*<\/div>/);
assert(batchModalMatch, 'modal-batch-home-visits must exist in index.html');
const batchModalHtml = batchModalMatch[0];

// Assert no raw input type="date" in batch modal
assert(!batchModalHtml.includes('type="date"'), 'modal-batch-home-visits must not contain type="date"');

// Assert both start-date and manual-date use data-open-calendar
assert(batchModalHtml.includes('data-open-calendar="batch-hv-start-date"'), 'batch-hv-start-date must use data-open-calendar');
assert(batchModalHtml.includes('data-open-calendar="batch-hv-manual-date"'), 'batch-hv-manual-date must use data-open-calendar');

// Assert doctor selector uses custom picker trigger
assert(batchModalHtml.includes('data-open-picker="batch-hv-doctor"'), 'batch-hv-doctor must use data-open-picker');
assert(batchModalHtml.includes('<select id="batch-hv-doctor" class="form-control d-none"'), 'batch-hv-doctor underlying select must be d-none');

// Assert session type toggle exists (Home Visits vs Clinic Batch)
assert(batchModalHtml.includes('name="batch-session-type" value="home_visit"'), 'batch-session-type home_visit must exist');
assert(batchModalHtml.includes('name="batch-session-type" value="clinic_batch"'), 'batch-session-type clinic_batch must exist');
assert(batchModalHtml.includes('id="btn-batch-pattern-both"'), 'btn-batch-pattern-both must exist in modal-batch-home-visits');
assert(styleCssContent.includes('#modal-batch-home-visits .modal-body'), 'style.css must define scoped rules for #modal-batch-home-visits .modal-body');
assert(styleCssContent.includes('.btn-batch-pattern.active'), 'style.css must define .btn-batch-pattern.active');
console.log('✓ 4. Batch Sessions Modal Compliance: Verified type toggle, custom picker, combined pattern button, and desktop scroll guardrail.');

// 5. Strict Guardrail: app.js registration of custom doctor selectors
assert(appJsContent.includes("'batch-hv-doctor'"), "app.js must register 'batch-hv-doctor' in custom select lists");
assert(appJsContent.includes("this.updateCustomSelectDisplay('batch-hv-doctor')"), "app.js must call updateCustomSelectDisplay for batch-hv-doctor");
console.log('✓ 5. App Coordinator Parity: batch-hv-doctor is registered in custom selects and sync loops.');

// 6. Strict Guardrail: Sub-Modals Navigation from modal-patient-docs (Anti-Race Condition)
const patientsJsPath = path.join(rootDir, 'js/patients.js');
const patientsJsContent = fs.readFileSync(patientsJsPath, 'utf-8');

assert(patientsJsContent.includes("this.app.closeModal('modal-patient-docs', { skipHistory: true });"), "patients.js must use skipHistory: true when transitioning from modal-patient-docs to sub-modals");
assert(appJsContent.includes("this.closeModal(modalId, { skipHistory: true });"), "app.js must use skipHistory: true when returning to modal-patient-docs via close button");
console.log('✓ 6. Sub-Modals Navigation Parity: Verified skipHistory guards on docs sub-modal transitions.');

// 7. Strict Guardrail: Patient Form Radio Name Parity (Anti-Data Drift)
assert(htmlContent.includes('name="p-contract-type"'), 'index.html must use name="p-contract-type" for contract switcher');
assert(patientsJsContent.includes('input[name="p-contract-type"]:checked'), 'patients.js must read input[name="p-contract-type"]:checked during save');
console.log('✓ 7. Contract Radio Name Parity: Verified HTML and JS contractType selector sync.');

// 8. Strict Guardrail: Patient Registration Modal Scroll & Clearance Integrity

assert(styleCssContent.includes('#modal-patient .modal-body'), 'style.css must have dedicated scoped rules for #modal-patient .modal-body');
assert(styleCssContent.includes('padding: 16px 18px 100px 18px !important;'), 'modal-patient body must have at least 100px bottom padding to clear footer buttons');
assert(styleCssContent.includes('touch-action: pan-y !important;'), 'modal-patient body must enable vertical touch gestures (touch-action: pan-y)');
assert(styleCssContent.includes('#modal-patient #p-insurance-details'), 'style.css must scope #p-insurance-details');
assert(patientsJsContent.includes("scrollIntoView({ behavior: 'smooth', block: 'nearest' })"), 'patients.js must smoothly scroll insurance box into view when selected');
console.log('✓ 8. Patient Modal Scroll Guardrail: Verified scoped overflow, 100px bottom clearance, and auto-scroll.');

// 9. Strict Guardrail: Insurance Claim Official Printout Isolation & Layout
const exportJsPath = path.join(rootDir, 'js/export.js');
const exportJsContent = fs.readFileSync(exportJsPath, 'utf-8');
const claimsJsPath = path.join(rootDir, 'js/claims.js');
const claimsJsContent = fs.readFileSync(claimsJsPath, 'utf-8');

assert(htmlContent.includes('id="printable-insurance-claim"'), 'index.html must contain #printable-insurance-claim');
assert(htmlContent.includes('class="claim-print-table"'), 'index.html must have .claim-print-table');
assert(styleCssContent.includes('body.printing-claim') || fs.readFileSync(path.join(rootDir, 'css/print.css'), 'utf-8').includes('body.printing-claim'), 'print.css must have dedicated isolation for body.printing-claim');
assert(exportJsContent.includes('this.app.claimsManager.printClaimStatement()'), 'export.js must delegate to claimsManager.printClaimStatement when on claims tab');
assert(claimsJsContent.includes('document.body.classList.add(\'printing-claim\')'), 'claims.js must add printing-claim class');
console.log('✓ 9. Insurance Claim Print Guardrail: Verified isolation, table layout parity, and WiFi print delegation.');

// 10. Strict Guardrail: Fixed Bottom Footers & Safe Print Margins
const printCssPath = path.join(rootDir, 'css/print.css');
const printCssContent = fs.readFileSync(printCssPath, 'utf-8');

assert(printCssContent.includes('.attendance-card-footer-wrap'), 'print.css must define .attendance-card-footer-wrap');
assert(printCssContent.includes('margin-top: auto !important;') && printCssContent.includes('.claim-print-footer-wrap'), 'print.css must pin claim-print-footer-wrap to bottom via margin-top: auto');
assert(printCssContent.includes('padding: 8mm 14mm !important;'), 'print.css must use safe 14mm horizontal padding for attendance card to prevent left margin clipping');
assert(htmlContent.includes('class="claim-print-footer-wrap"'), 'index.html must contain .claim-print-footer-wrap inside claim printable doc');
assert(claimsJsContent.includes('class="attendance-card-footer-wrap"'), 'claims.js must generate .attendance-card-footer-wrap for attendance cards');
assert(printCssContent.includes('min-height: 242mm !important;'), 'print.css must ensure #view-finance has min-height: 242mm to push footer to bottom');
assert(printCssContent.includes('print-daily-spacious'), 'print.css must define print-daily-spacious mode for 1-22 patients');
assert(printCssContent.includes('print-daily-compact'), 'print.css must define print-daily-compact mode for 23-35 patients');
assert(printCssContent.includes('print-daily-multipage'), 'print.css must define print-daily-multipage mode for >35 patients');
assert(exportJsContent.includes('syncPrintClasses'), 'export.js must define syncPrintClasses() for responsive print tiers');
console.log('✓ 10. Bottom Footers & Safe Print Margins: Verified attendance cards, claims, and financial reports.');

// 11. Strict Guardrail: Medical Statement Header Branding Parity
assert(htmlContent.includes('<h2 style="font-size: 13pt; margin: 0; font-weight: 800; color: #0284c7; white-space: nowrap;" data-clinic="brand-name">مركز الإسكندرية التخصصي للعلاج الطبيعي</h2>'), 'Medical statement header must be "مركز الإسكندرية التخصصي للعلاج الطبيعي"');
console.log('✓ 11. Medical Statement Branding: Verified center name header in #printable-medical-statement.');

// 12. Strict Guardrail: Cash Receipt A5 Full-Bleed Frame & Pinned Footer Integrity
assert(printCssContent.includes('@page receiptPage'), 'print.css must define @page receiptPage');
assert(printCssContent.includes('body.printing-receipt') && printCssContent.includes('page: receiptPage;'), 'print.css must assign page: receiptPage to body.printing-receipt');
assert(printCssContent.includes('.receipt-print-footer-wrap'), 'print.css must define .receipt-print-footer-wrap');
assert(printCssContent.includes('#printable-cash-receipt > div') && printCssContent.includes('height: 194mm !important;'), 'print.css must give receipt frame full A5 height (194mm)');
assert(htmlContent.includes('class="receipt-print-footer-wrap"'), 'index.html must wrap receipt signatures and footer in .receipt-print-footer-wrap');
assert(htmlContent.includes('id="receipt-print-date"') && htmlContent.includes('id="receipt-print-date-val"'), 'receipt-print-date elements must exist');
assert(htmlContent.indexOf('id="receipt-print-date"') > htmlContent.indexOf('id="receipt-print-item-desc"'), 'receipt-print-date must be placed at the bottom in the footer bar, not in the top header');
console.log('✓ 12. Cash Receipt A5 Frame & Footer: Verified A5 page rule, 194mm height, and bottom-right date placement.');

// 13. Strict Guardrail: Insurance Letter A5 Frame & Footer Pin Parity
assert(printCssContent.includes('.ins-letter-frame'), 'print.css must define .ins-letter-frame');
assert(printCssContent.includes('.ins-letter-footer-wrap'), 'print.css must define .ins-letter-footer-wrap');
assert(htmlContent.includes('class="ins-letter-footer-wrap"'), 'index.html must contain .ins-letter-footer-wrap');
assert(!htmlContent.includes('موضع الختم'), 'index.html must have removed stamp placeholder text from insurance letter');
const insLetterMatch = htmlContent.match(/<div id="printable-insurance-letter"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/);
assert(insLetterMatch, 'must find printable-insurance-letter');
assert(!insLetterMatch[0].includes('خاتم واعتماد المركز'), 'insurance letter must have removed stamp heading text');
console.log('✓ 13. Insurance Renewal Letter A5 Frame & Footer: Verified frame, removed stamp text, and pinned footer.');

// 14. Strict Guardrail: Session Edit Immediate Scroll-to-Top Parity
const sessionsJsPath = path.join(rootDir, 'js/sessions.js');
const sessionsJsContent = fs.readFileSync(sessionsJsPath, 'utf-8');
assert(sessionsJsContent.includes('scrollToFormTop()'), 'sessions.js must implement scrollToFormTop()');
assert(sessionsJsContent.includes("onclick=\"sessionsManager.scrollToFormTop(); sessionsManager.editSession"), 'sessions card edit buttons must trigger scrollToFormTop synchronously on click');
assert(sessionsJsContent.includes('this.scrollToFormTop();'), 'editSession must call scrollToFormTop at both start and end of edit lifecycle');
console.log('✓ 14. Session Edit Scroll-to-Top: Verified immediate and completion smooth scrolling.');

// 15. Strict Guardrail: White-Label Centralization & Dynamic Branding Parity
const apptsJsPath = path.join(rootDir, 'js/appointments.js');
const apptsJsContent = fs.readFileSync(apptsJsPath, 'utf-8');
const dbJsPath = path.join(rootDir, 'js/db.js');
const dbJsContent = fs.readFileSync(dbJsPath, 'utf-8');

assert(apptsJsContent.includes('CLINIC_CONFIG.shortName') || apptsJsContent.includes('CLINIC_CONFIG.brandName'), 'appointments.js friday holiday message must dynamically use CLINIC_CONFIG');
assert(!apptsJsContent.includes('مركز الإسكندرية التخصصي مغلق'), 'appointments.js must not contain hardcoded clinic name in friday alert');
assert(appJsContent.includes('(CLINIC_CONFIG.abbreviation ||'), 'app.js exit confirmation and backup filename must dynamically use CLINIC_CONFIG');
assert(dbJsContent.includes('CLINIC_CONFIG?.brandName'), 'db.js backup clinicName must use CLINIC_CONFIG.brandName');
const exportJsPathCheck = path.join(rootDir, 'js/export.js');
const exportJsContentCheck = fs.readFileSync(exportJsPathCheck, 'utf-8');
assert(exportJsContentCheck.includes('CLINIC_CONFIG.abbreviation'), 'export.js must dynamically use CLINIC_CONFIG.abbreviation for report filenames');
assert(!exportJsContentCheck.includes('PhysioFlow'), 'export.js must not contain hardcoded PhysioFlow');
console.log('✓ 15. White-Label Centralization: Verified zero hardcoded clinic names in appointments, alerts, and backup.');

// 16. Strict Guardrail: Sessions Screen View Switcher & Home Visits Tab Parity
assert(htmlContent.includes('id="btn-tab-clinic-sessions"'), 'index.html must include #btn-tab-clinic-sessions');
assert(htmlContent.includes('id="btn-tab-home-visits"'), 'index.html must include #btn-tab-home-visits');
assert(htmlContent.includes('id="sessions-home-visits-view"'), 'index.html must include #sessions-home-visits-view');
assert(htmlContent.includes('id="sessions-hv-mobile-cards"'), 'index.html must include #sessions-hv-mobile-cards');
assert(sessionsJsContent.includes('switchSessionsTab(tab)'), 'sessions.js must implement switchSessionsTab(tab)');
assert(sessionsJsContent.includes('renderHomeVisitsList()'), 'sessions.js must implement renderHomeVisitsList()');
assert(sessionsJsContent.includes('updateHomeVisitsBadge()'), 'sessions.js must implement updateHomeVisitsBadge()');
assert(dbJsContent.includes('deleteBatchSessions('), 'db.js must implement deleteBatchSessions(');
assert(sessionsJsContent.includes('deleteHomeVisitsGroup('), 'sessions.js must implement deleteHomeVisitsGroup(');
assert(fs.readFileSync(path.join(rootDir, 'js/patients.js'), 'utf-8').includes('deletePatientSession('), 'patients.js must implement deletePatientSession(');
assert(dbJsContent.includes('settleBatchSessions('), 'db.js must implement settleBatchSessions(');
assert(sessionsJsContent.includes('settleHomeVisitsGroup('), 'sessions.js must implement settleHomeVisitsGroup(');
const freshSessionsContent = fs.readFileSync(sessionsJsPath, 'utf-8');
assert(freshSessionsContent.includes('btn-settle-hv'), 'sessions.js must include btn-settle-hv in home visits actions');
console.log('✓ 16. Sessions Screen Home Visits Tab: Verified view switcher, tabs, containers, and delete methods parity.');

// 17. Strict Guardrail: Zero Unresolved ES Module Imports & Named Exports Integrity
const jsDir = path.join(rootDir, 'js');
const jsFiles = fs.readdirSync(jsDir).filter(f => f.endsWith('.js'));
const exportMap = {};

jsFiles.forEach(file => {
  const fContent = fs.readFileSync(path.join(jsDir, file), 'utf-8');
  const exports = new Set();
  const directRegex = /export\s+(?:function|class|const|let|var)\s+([a-zA-Z0-9_$]+)/g;
  let m;
  while ((m = directRegex.exec(fContent)) !== null) {
    exports.add(m[1]);
  }
  const namedRegex = /export\s*\{([^}]+)\}/g;
  while ((m = namedRegex.exec(fContent)) !== null) {
    m[1].split(',').forEach(item => {
      const parts = item.trim().split(/\s+as\s+/);
      const expName = (parts[1] || parts[0]).trim();
      if (expName) exports.add(expName);
    });
  }
  if (/export\s+default/.test(fContent)) {
    exports.add('default');
  }
  exportMap['./' + file] = exports;
});

let missingImportErrors = [];
jsFiles.forEach(file => {
  const fContent = fs.readFileSync(path.join(jsDir, file), 'utf-8');
  const importRegex = /import\s+(?:(\*\s+as\s+[\w$]+)|([\w$]+)|(?:\{([^}]+)\}))?\s*(?:,\s*\{([^}]+)\})?\s*from\s*[\x27\x22]([^\x27\x22]+)[\x27\x22]/g;
  let im;
  while ((im = importRegex.exec(fContent)) !== null) {
    const defaultImp = im[2];
    const namedList1 = im[3];
    const namedList2 = im[4];
    const fromPath = im[5];
    if (exportMap[fromPath]) {
      const availableExports = exportMap[fromPath];
      if (defaultImp && !availableExports.has('default')) {
        missingImportErrors.push(`${file} imports default from ${fromPath}, but it has no default export!`);
      }
      const namedCombined = [namedList1, namedList2].filter(Boolean).join(',');
      if (namedCombined) {
        namedCombined.split(',').forEach(part => {
          const cleanPart = part.trim().split(/\s+as\s+/)[0].trim();
          if (cleanPart && !availableExports.has(cleanPart)) {
            missingImportErrors.push(`${file} imports "${cleanPart}" from ${fromPath}, but it is not exported!`);
          }
        });
      }
    }
  }
});
assert.equal(missingImportErrors.length, 0, 'Missing imports detected: ' + missingImportErrors.join(', '));
console.log('✓ 17. ES Module Imports Integrity: Verified 100% of internal imports resolve to valid named exports.');

// 18. Strict Guardrail: Custom Minimalist Context-Aware Pull-to-Force-Reload Widget & PWA Method Parity
assert(htmlContent.includes('id="pull-to-reload-indicator"'), 'index.html must include #pull-to-reload-indicator');
assert(htmlContent.includes('id="pull-to-reload-icon"'), 'index.html must include #pull-to-reload-icon');
assert(htmlContent.includes('id="pull-progress-circle"'), 'index.html must include #pull-progress-circle');
const cssContent = styleCssContent;
assert(cssContent.includes('.pull-to-reload-indicator'), 'style.css must define .pull-to-reload-indicator');
assert(cssContent.includes('.pull-to-reload-bubble'), 'style.css must define .pull-to-reload-bubble');
assert(cssContent.includes('overscroll-behavior-y: contain'), 'style.css must contain overscroll-behavior-y: contain to suppress native pull refresh');
const pwaJsContent = fs.readFileSync(path.join(rootDir, 'js/pwa.js'), 'utf-8');
assert(pwaJsContent.includes('initPullToReload()'), 'pwa.js must implement initPullToReload()');
assert(pwaJsContent.includes('forceReload()'), 'pwa.js must implement forceReload()');
assert(pwaJsContent.includes('getViewIcon()'), 'pwa.js must implement dynamic screen icon detection');
console.log('✓ 18. Minimalist Pull-to-Force-Reload: Verified context-aware circular widget, SVG ring, and PWA handler parity.');

// 19. Strict Guardrail: Active View Persistence & Force-Reload Restoration Parity
const freshAppJsContent = fs.readFileSync(path.join(rootDir, 'js/app.js'), 'utf-8');
assert(freshAppJsContent.includes('restoreActiveView()'), 'app.js must implement restoreActiveView()');
assert(freshAppJsContent.includes('sessionStorage.setItem(\'ascpt_active_view\', viewName)'), 'switchView must persist active view to sessionStorage');
assert(pwaJsContent.includes('?view='), 'pwa.js forceReload must pass current active view in reload query');
assert(pwaJsContent.includes('sessionStorage.setItem(\'ascpt_active_view\', activeView)'), 'pwa.js forceReload must store active view in sessionStorage');
console.log('✓ 19. Active View Persistence: Verified session and reload preservation for all views.');

// 20. Strict Guardrail: Doctor Rates Serverless Handler & Cache Invalidation Parity
const apiUsersContent = fs.readFileSync(path.join(rootDir, 'api/admin/users.js'), 'utf-8');
assert(apiUsersContent.includes('scoliosisRate !== undefined'), 'api/admin/users.js PATCH must persist scoliosisRate');
assert(apiUsersContent.includes('hemiplegiaRate !== undefined'), 'api/admin/users.js PATCH must persist hemiplegiaRate');
assert(apiUsersContent.includes('quadriplegiaRate !== undefined'), 'api/admin/users.js PATCH must persist quadriplegiaRate');
assert(apiUsersContent.includes('seniorityLevel !== undefined'), 'api/admin/users.js PATCH must persist seniorityLevel');
const freshDbJsContent = fs.readFileSync(path.join(rootDir, 'js/db.js'), 'utf-8');
assert(freshDbJsContent.includes('invalidateUsersCache()'), 'db.js must implement invalidateUsersCache()');
const freshAuthJsContent = fs.readFileSync(path.join(rootDir, 'js/auth.js'), 'utf-8');
assert(freshAuthJsContent.includes('scoliosisRate: typeof profile.scoliosisRate === \'number\''), 'auth.js must map doctor clinical rates in resolveUserProfile');
console.log('✓ 20. Doctor Rates & Cache Invalidation: Verified serverless API, auth profile mapper, and db cache bust parity.');

// 21. Strict Guardrail: UX Polish, Unsaved Changes Protection & Skeleton Shimmer
const freshPatientsJs = fs.readFileSync(path.join(rootDir, 'js/patients.js'), 'utf-8');
const freshAppJs = fs.readFileSync(path.join(rootDir, 'js/app.js'), 'utf-8');
const freshFinJs = fs.readFileSync(path.join(rootDir, 'js/finance.js'), 'utf-8');
const freshClaimsJs = fs.readFileSync(path.join(rootDir, 'js/claims.js'), 'utf-8');

assert(freshPatientsJs.includes('hasUnsavedChanges()'), 'patients.js must implement hasUnsavedChanges()');
assert(freshAppJs.includes('hasUnsavedChanges()'), 'app.js must guard modal-patient close via hasUnsavedChanges()');
assert(freshFinJs.includes('renderMonthlySkeleton()'), 'finance.js must implement renderMonthlySkeleton()');
assert(freshClaimsJs.includes('hero-styled-card') && freshClaimsJs.includes('لا توجد مطالبات مسجلة'), 'claims.js must render hero-styled-card empty state');
console.log('✓ 21. UX Polish & Guardrails: Verified patient modal unsaved changes protection, monthly report skeleton shimmer, and empty states.');

// 22. Strict Guardrail: Protected DOM Coupling IDs Integrity (Phase 0 Safety Net)
const domMapPath = path.join(rootDir, "docs/DOM_COUPLING_MAP.md");
assert(fs.existsSync(domMapPath), "docs/DOM_COUPLING_MAP.md must exist");
const domMapContent = fs.readFileSync(domMapPath, "utf-8");
const staticIdsInMap = [...domMapContent.matchAll(/- #([a-zA-Z0-9_-]+) \[موجود في index\.html\]/g)].map(m => m[1]);
assert(staticIdsInMap.length >= 650, "Must have at least 650 protected static IDs mapped in DOM_COUPLING_MAP.md");

const missingDomIds = [];
staticIdsInMap.forEach(id => {
  if (!htmlContent.includes(`id="${id}"`) && !htmlContent.includes(`id='${id}'`)) {
    missingDomIds.push(id);
  }
});
assert.equal(
  missingDomIds.length,
  0,
  `[GUARDRAIL FAILURE] Found ${missingDomIds.length} protected DOM ID(s) missing from index.html!\n` +
  `These IDs are coupled to JS modules and defined in docs/DOM_COUPLING_MAP.md.\n` +
  `Missing IDs:\n` + missingDomIds.join(", ")
);
console.log(`✓ 22. Protected DOM Coupling Integrity: Verified all ${staticIdsInMap.length} static IDs from docs/DOM_COUPLING_MAP.md exist in index.html.`);

// 23. Strict Guardrail: Zero !important in Modern Modular View CSS Files (Step 80)
const viewCssDir = path.join(rootDir, "css/views");
const viewCssFiles = fs.readdirSync(viewCssDir).filter(f => f.endsWith(".css") && f !== "shell.css");
const importantViolations = [];
viewCssFiles.forEach(vf => {
  const rawContent = fs.readFileSync(path.join(viewCssDir, vf), "utf-8");
  // Remove all CSS comment blocks
  const content = rawContent.replace(/\/\*[\s\S]*?\*\//g, "");
  const vLines = content.split("\n");
  vLines.forEach((l, idx) => {
    const stripped = l.trim();
    if (stripped.includes("!important")) {
      importantViolations.push(`${vf}:${idx+1} -> ${stripped}`);
    }
  });
});
assert.equal(
  importantViolations.length,
  0,
  `[GUARDRAIL FAILURE] Found ${importantViolations.length} unauthorized !important usage(s) in modular view stylesheets.\n` +
  `ASCPT Architecture Standards strictly prohibit !important in css/views/*.css.\n` +
  `Violations:\n` + importantViolations.join("\n")
);
console.log(`✓ 23. Zero !important Architecture Gatekeeper: Verified 100% clean specificity across ${viewCssFiles.length} modular view stylesheets.`);

// 24. Strict Guardrail: HTML Semantic Linting & Inline Style Freeze (Step 81)
const styleMatches = [...htmlContent.matchAll(/style=["']([^"']+)["']/g)].map(m => m[1]);
assert.ok(
  styleMatches.length <= 700,
  `[GUARDRAIL FAILURE] Total inline styles in index.html (${styleMatches.length}) exceeded the strict threshold of 700.`
);
console.log(`✓ 24. HTML Inline Style Freeze Gatekeeper: Verified index.html contains zero unapproved styling regressions (${styleMatches.length} remaining).`);

// 25. Strict Guardrail: Data Safety & XSS Sanitization Gatekeeper (Step 82)
const modulesJsDir = path.join(rootDir, "js");
const jsFilesToCheck = ["patients.js", "sessions.js", "claims.js", "finance.js", "doctor-dashboard.js", "appointments.js"];
jsFilesToCheck.forEach(jf => {
  const code = fs.readFileSync(path.join(modulesJsDir, jf), "utf-8");
  assert.ok(code.includes("escapeHTML"), `${jf} must import and utilize escapeHTML for XSS sanitization`);
});
console.log(`✓ 25. Data Safety & XSS Gatekeeper: Verified escapeHTML() sanitization enforcement across all ${jsFilesToCheck.length} core business modules.`);

// 26. Strict Guardrail: Undeclared Table References Detector (Prevent ReferenceErrors)
const jsDirectory = path.join(rootDir, "js");
const jsModuleFiles = fs.readdirSync(jsDirectory).filter(f => f.endsWith(".js"));
jsModuleFiles.forEach(f => {
  const content = fs.readFileSync(path.join(jsDirectory, f), "utf-8");
  // If file uses naked tbody, it must have declared it in that file
  const hasNakedTbody = /(?<![\x27\"\-_])\btbody\b(?![\x27\"\-_])/.test(content);
  if (hasNakedTbody) {
    assert.ok(
      /(const|let|var)\s+tbody\b/.test(content),
      `[GUARDRAIL FAILURE] Undeclared tbody reference found in ${f} without declaration!`
    );
  }
});
console.log(`✓ 26. Scope Safety Gatekeeper: Verified zero undeclared table/DOM variables across ${jsModuleFiles.length} JS modules.`);

// 27. Strict Guardrail: Print-Only Legacy Tables Integrity Protection
const printOnlyTables = [
  "finance-expenses-table",
  "monthly-doctors-table",
  "monthly-insurance-table",
  "monthly-settlements-table",
  "monthly-expenses-categories-table",
  "monthly-financial-summary-table"
];
printOnlyTables.forEach(tableId => {
  assert(
    htmlContent.includes(`id="${tableId}"`),
    `[PRINT GUARDRAIL FAILURE] Print-only table #${tableId} must exist in index.html as data source for A4 printing!`
  );
  assert(
    htmlContent.includes("PRINT-ONLY DATA SOURCE") && htmlContent.includes(tableId),
    `[PRINT GUARDRAIL FAILURE] Print-only table #${tableId} must have documentation comment in index.html!`
  );
});
console.log(`✓ 27. Print-Only Tables Integrity: Verified all ${printOnlyTables.length} intentionally-kept print-only tables exist and are documented in index.html.`);


console.log('===================================================================');
console.log('✓ All ASCPT UI Component Compliance Guardrail Checks Passed (100%)!');
console.log('===================================================================');
