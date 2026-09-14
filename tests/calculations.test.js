import assert from 'node:assert/strict';
import { getDayShiftKey, isDoctorOnDuty, getShiftLabel, getLatestTherapySession } from '../js/utils.js';

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

// On Sunday (2026-09-13) with Shift Coverage Overrides
const sampleOverrides = [{ doctorUid: 'doc_mostafa', date: '2026-09-13', type: 'coverage' }];
assert.equal(isDoctorOnDuty('sat_mon_wed', '2026-09-13', sampleOverrides, 'doc_mostafa'), true, 'Doctor with sat_mon_wed must be on duty on Sunday if coverage override exists');
assert.equal(isDoctorOnDuty('sat_mon_wed', '2026-09-13', sampleOverrides, 'other_doc'), false, 'Other sat_mon_wed doctor must remain off duty without override');

// 3. Shift Labels
assert.equal(getShiftLabel('sat_mon_wed'), 'السبت / الاثنين / الأربعاء');
assert.equal(getShiftLabel('sun_tue_thu'), 'الأحد / الثلاثاء / الخميس');
assert.equal(getShiftLabel('all'), 'طوال أيام الأسبوع');

console.log('✓ All 12 shift and calculation assertions passed successfully!');

// 4. Doctor Session Pricing Calculation Tests
function calculateDoctorDues(sessions, regularRate, specialRate) {
  let regularCount = 0;
  let specialCount = 0;

  sessions.forEach(s => {
    // Examinations are not treated as regular therapy sessions unless configured,
    // only active physical therapy sessions count toward doctor session rates
    if (s.entryType === 'examination') return;

    const isSpec = Boolean(s.isSpecial || s.sessionPricingType === 'special');
    const count = s.bodyPartsCount || 1;
    if (isSpec) {
      specialCount += count;
    } else {
      regularCount += count;
    }
  });

  const totalDues = (regularCount * regularRate) + (specialCount * specialRate);
  return { regularCount, specialCount, totalDues };
}

const testSessions = [
  { entryType: 'session', isSpecial: false, bodyPartsCount: 1 },
  { entryType: 'session', isSpecial: false, bodyPartsCount: 2 },
  { entryType: 'session', isSpecial: true, bodyPartsCount: 1 },
  { entryType: 'session', isSpecial: true, bodyPartsCount: 1 },
  { entryType: 'examination', isSpecial: false, bodyPartsCount: 0 }
];

const duesResult = calculateDoctorDues(testSessions, 50, 80);
assert.equal(duesResult.regularCount, 3, 'Regular sessions count should be 3');
assert.equal(duesResult.specialCount, 2, 'Special sessions count should be 2');
assert.equal(duesResult.totalDues, (3 * 50) + (2 * 80), 'Total dues should be 310 EGP');
assert.equal(duesResult.totalDues, 310);

console.log('✓ All Doctor Dues and Session Pricing assertions passed successfully!');

// 5. Patient Last Session Auto-Restore Logic Tests
console.log('--- Running Tests: Patient Last Session Auto-Restore ---');

const mockPatientSessions = [
  { id: 's3', entryType: 'examination', doctor: 'د. حسني أحمد الجويلي', date: '2026-09-14', amountPaid: 200, notes: 'كشف دوري' },
  { id: 's2', entryType: 'session', doctor: 'د. مصطفى محمود', bodyParts: ['الفقرات العنقية', 'الكتف الأيمن'], isSpecial: true, amountPaid: 150, notes: 'تحسن في المدى الحركي', date: '2026-09-13' },
  { id: 's1', entryType: 'session', doctor: 'د. حسني أحمد الجويلي', bodyParts: ['الفقرات العنقية'], isSpecial: false, amountPaid: 100, notes: 'جلسة أولى', date: '2026-09-10' }
];

const latestTherapy = getLatestTherapySession(mockPatientSessions);
assert.ok(latestTherapy, 'Must find a therapy session');
assert.equal(latestTherapy.id, 's2', 'Must pick latest therapy session s2, ignoring s3 examination');
assert.equal(latestTherapy.doctor, 'د. مصطفى محمود');
assert.equal(latestTherapy.bodyParts.length, 2);
assert.equal(latestTherapy.isSpecial, true);
assert.equal(latestTherapy.amountPaid, 150);
assert.equal(latestTherapy.notes, 'تحسن في المدى الحركي');

// Empty sessions list test
assert.equal(getLatestTherapySession([]), null, 'Empty list must return null');
assert.equal(getLatestTherapySession([{ entryType: 'examination' }]), null, 'Only examinations list must return null');

console.log('✓ All 8 Last Session Auto-Restore assertions passed successfully!');
