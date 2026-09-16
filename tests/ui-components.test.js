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
console.log('✓ 4. Batch Sessions Modal Compliance: Verified type toggle, custom picker, and custom calendar triggers.');

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
const styleCssPath = path.join(rootDir, 'css/style.css');
const styleCssContent = fs.readFileSync(styleCssPath, 'utf-8');

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

console.log('===================================================================');
console.log('✓ All ASCPT UI Component Compliance Guardrail Checks Passed (100%)!');
console.log('===================================================================');
