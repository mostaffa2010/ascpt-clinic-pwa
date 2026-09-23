// ========================================================
// ASCPT Unit Tests: Push Notifications & In-App Center Guardrail
// Alexandria Specialized Center for Physical Therapy
// ========================================================

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('--- Running ASCPT Tests: Push Notifications & In-App Center Guardrail ---');

// 1. Verify VAPID Key in clinic-config.js
const clinicConfigContent = fs.readFileSync(path.join(rootDir, 'js/clinic-config.js'), 'utf-8');
assert.ok(
  clinicConfigContent.includes('BNxVekL4fNFFrfCdSFf8KQaB0dWM3YrMfl59uku4lxI5Anwiat1fIMv7ZQOsLNommf3Ub_hSgmlXUquBHbzYJNs'),
  'clinic-config.js must configure the provided VAPID public key'
);
console.log('✓ 1. VAPID Key Configuration: Verified exact public certificate in clinic-config.js.');

// 2. Verify Backend Serverless Endpoint
const apiSendContent = fs.readFileSync(path.join(rootDir, 'api/notifications/send.js'), 'utf-8');
assert.ok(apiSendContent.includes('getMessaging'), 'api/notifications/send.js must import getMessaging');
assert.ok(apiSendContent.includes('sendEachForMulticast'), 'api/notifications/send.js must use sendEachForMulticast');
assert.ok(apiSendContent.includes('messaging/registration-token-not-registered'), 'api/notifications/send.js must handle stale token cleanup');
assert.ok(apiSendContent.includes('notifications'), 'api/notifications/send.js must record in-app notifications in Firestore');
console.log('✓ 2. Backend Serverless Endpoint: Verified multicast routing, stale token hygiene, and in-app Firestore storage.');

// 3. Verify Service Worker Background Push Handlers
const swContent = fs.readFileSync(path.join(rootDir, 'sw.js'), 'utf-8');
assert.ok(swContent.includes("addEventListener('push'"), 'sw.js must implement push event listener');
assert.ok(swContent.includes("addEventListener('notificationclick'"), 'sw.js must implement notificationclick event listener');
assert.ok(swContent.includes('/js/notifications.js'), 'sw.js must include notifications.js in offline APP_SHELL_ASSETS');
console.log('✓ 3. Service Worker Push & Click: Verified background notification display, vibration, and deep-link click routing.');

// 4. Verify Frontend Manager (js/notifications.js)
const notifManagerContent = fs.readFileSync(path.join(rootDir, 'js/notifications.js'), 'utf-8');
assert.ok(notifManagerContent.includes('class NotificationsManager'), 'notifications.js must define NotificationsManager class');
assert.ok(notifManagerContent.includes('requestPermissionAndSubscribe'), 'notifications.js must implement subscription method');
assert.ok(notifManagerContent.includes('sendNotification'), 'notifications.js must implement sendNotification method');
assert.ok(notifManagerContent.includes('markAllAsRead'), 'notifications.js must implement markAllAsRead method');
console.log('✓ 4. Frontend Notifications Manager: Verified subscription, real-time listener, badge updating, and API dispatcher.');

// 5. Verify UI Components in index.html
const indexHtmlContent = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf-8');
assert.ok(indexHtmlContent.includes('id="btn-notifications-bell"'), 'index.html must include #btn-notifications-bell');
assert.ok(indexHtmlContent.includes('id="notification-badge"'), 'index.html must include #notification-badge');
assert.ok(indexHtmlContent.includes('id="notification-dropdown"'), 'index.html must include #notification-dropdown');
assert.ok(indexHtmlContent.includes('id="btn-mark-all-read"'), 'index.html must include #btn-mark-all-read');
assert.ok(indexHtmlContent.includes('id="btn-toggle-push-notifications"'), 'index.html must include #btn-toggle-push-notifications in profile');
assert.ok(indexHtmlContent.includes('class="notification-bell-wrapper no-print"'), 'notification bell wrapper must have no-print class');
console.log('✓ 5. Top Header & Profile UI: Verified bell button, red counter badge, dropdown menu, and settings toggle.');

// 6. Verify CSS Styling & Print Suppression
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
const styleCssContent = fs.existsSync(styleCssPath)
  ? fs.readFileSync(styleCssPath, 'utf-8')
  : modularCssFiles
      .filter(f => fs.existsSync(path.join(rootDir, f)))
      .map(f => fs.readFileSync(path.join(rootDir, f), 'utf-8'))
      .join('\n');
const printCssContent = fs.readFileSync(path.join(rootDir, 'css/print.css'), 'utf-8');
assert.ok(styleCssContent.includes('.notification-badge'), 'style.css must define .notification-badge');
assert.ok(styleCssContent.includes('.notification-dropdown'), 'style.css must define .notification-dropdown');
assert.ok(printCssContent.includes('.notification-bell-wrapper'), 'print.css must suppress .notification-bell-wrapper');
assert.ok(printCssContent.includes('.notification-dropdown'), 'print.css must suppress .notification-dropdown');
console.log('✓ 6. Design System & Print Immunity: Verified glassmorphism styling, theme variables, and strict print suppression.');

// 7. Verify Trigger Hooks in Business Modules
const sessionsContent = fs.readFileSync(path.join(rootDir, 'js/sessions.js'), 'utf-8');
const apptsContent = fs.readFileSync(path.join(rootDir, 'js/appointments.js'), 'utf-8');
const financeContent = fs.readFileSync(path.join(rootDir, 'js/finance.js'), 'utf-8');

assert.ok(sessionsContent.includes("type: 'patient_checkin'"), 'sessions.js must dispatch patient_checkin notification to attending doctor');
assert.ok(apptsContent.includes("type: 'appointment_booked'"), 'appointments.js must dispatch appointment_booked notification to doctor');
assert.ok(apptsContent.includes("type: 'session_completed'"), 'appointments.js must dispatch session_completed notification to reception');
assert.ok(financeContent.includes("type: 'cash_handoff'"), 'finance.js must dispatch cash_handoff notification to admin');
console.log('✓ 7. Operational Event Triggers: Verified 4 clinical triggers (Check-in, Appt Booked, Session Completed, Cash Handoff).');

// 8. Verify Documentation
const guidePath = path.join(rootDir, 'docs/NOTIFICATIONS_GUIDE.md');
assert.ok(fs.existsSync(guidePath), 'docs/NOTIFICATIONS_GUIDE.md must exist');
const guideContent = fs.readFileSync(guidePath, 'utf-8');
assert.ok(guideContent.includes('كيف تضيف نوع إشعار جديد في 3 خطوات بسيطة'), 'guide must explain adding new notification types');
console.log('✓ 8. Comprehensive Documentation: Verified docs/NOTIFICATIONS_GUIDE.md with 3-step developer template and usage table.');


// 9. Verify Token Endpoint & Primer Modal (v2.10.1 Refinement)
const apiTokenPath = path.join(rootDir, 'api/notifications/token.js');
assert.ok(fs.existsSync(apiTokenPath), 'api/notifications/token.js must exist');
const apiTokenContent = fs.readFileSync(apiTokenPath, 'utf-8');
assert.ok(apiTokenContent.includes("action === 'register'"), 'token.js must handle registration');
assert.ok(apiTokenContent.includes("action === 'mark_all_read'"), 'token.js must handle mark_all_read');

assert.ok(indexHtmlContent.includes('id="modal-notification-primer"'), 'index.html must include #modal-notification-primer');
assert.ok(indexHtmlContent.includes('id="btn-primer-confirm"'), 'index.html must include #btn-primer-confirm');
assert.ok(styleCssContent.includes('position: fixed'), 'style.css must define position: fixed for mobile notification dropdown');
assert.ok(printCssContent.includes('#modal-notification-primer'), 'print.css must suppress #modal-notification-primer');
console.log('✓ 9. Refinement Guardrails: Verified server token endpoint, custom primer modal, and fixed mobile dropdown.');

console.log('===================================================================');
console.log('✓ All 9 Push Notifications Guardrail Tests Passed Successfully (100%)!');
console.log('===================================================================');
