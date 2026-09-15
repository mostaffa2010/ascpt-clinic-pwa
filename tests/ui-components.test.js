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

console.log('===================================================================');
console.log('✓ All ASCPT UI Component Compliance Guardrail Checks Passed (100%)!');
console.log('===================================================================');
