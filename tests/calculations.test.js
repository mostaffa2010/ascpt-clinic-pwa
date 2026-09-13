import assert from 'node:assert/strict';
import { getDayShiftKey, isDoctorOnDuty, getShiftLabel } from '../js/utils.js';

console.log('--- Running ASCPT Unit Tests: Calculations & Shift Engine ---');

// 1. Shift Key Mapping Tests
// 2026-09-12: Saturday (day 6)
assert.equal(getDayShiftKey('2026-09-12'), 'sat_mon_wed', 'Saturday must map to sat_mon_wed');

// 2026-09-13: Sunday (day 0)
assert.equal(getDayShiftKey('2026-09-13'), 'sun_tue_thu', 'Sunday must map to sun_tue_thu');

// 2026-09-14: Monday (day 1)
assert.equal(getDayShiftKey('2026-09-14'), 'sat_mon_wed', 'Monday must map to sat_mon_wed');

// 2026-09-15: Tuesday (day 2)
assert.equal(getDayShiftKey('2026-09-15'), 'sun_tue_thu', 'Tuesday must map to sun_tue_thu');

// 2026-09-16: Wednesday (day 3)
assert.equal(getDayShiftKey('2026-09-16'), 'sat_mon_wed', 'Wednesday must map to sat_mon_wed');

// 2026-09-17: Thursday (day 4)
assert.equal(getDayShiftKey('2026-09-17'), 'sun_tue_thu', 'Thursday must map to sun_tue_thu');

// 2026-09-18: Friday (day 5)
assert.equal(getDayShiftKey('2026-09-18'), 'friday', 'Friday must map to friday');

// 2. Doctor On-Duty Logic Tests
// On Saturday (2026-09-12)
assert.equal(isDoctorOnDuty('sat_mon_wed', '2026-09-12'), true, 'Doctor with sat_mon_wed must be on duty on Saturday');
assert.equal(isDoctorOnDuty('sun_tue_thu', '2026-09-12'), false, 'Doctor with sun_tue_thu must NOT be on duty on Saturday');
assert.equal(isDoctorOnDuty('all', '2026-09-12'), true, 'Full-time doctor (all) must be on duty on Saturday');

// On Sunday (2026-09-13)
assert.equal(isDoctorOnDuty('sun_tue_thu', '2026-09-13'), true, 'Doctor with sun_tue_thu must be on duty on Sunday');
assert.equal(isDoctorOnDuty('sat_mon_wed', '2026-09-13'), false, 'Doctor with sat_mon_wed must NOT be on duty on Sunday');

// 3. Shift Labels
assert.equal(getShiftLabel('sat_mon_wed'), 'السبت / الاثنين / الأربعاء');
assert.equal(getShiftLabel('sun_tue_thu'), 'الأحد / الثلاثاء / الخميس');
assert.equal(getShiftLabel('all'), 'طوال أيام الأسبوع');

console.log('✓ All 12 shift and calculation assertions passed successfully!');
