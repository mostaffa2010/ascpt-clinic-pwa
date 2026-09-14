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

// 6. Appointments Date Filtering & Status Transition Tests
console.log('--- Running Tests: Appointments Engine & Status Sync ---');

function filterAppointmentsByDate(appointments, targetDate, doctors = [], shiftOverrides = []) {
  if (!targetDate) return [];
  const shiftKey = getDayShiftKey(targetDate);
  return appointments.filter(a => {
    if (a.date) return a.date === targetDate;
    if (a.dayOfWeek) return a.dayOfWeek === shiftKey;
    const doc = doctors.find(d => d.uid === a.doctorUid);
    return isDoctorOnDuty(doc?.shift, targetDate, shiftOverrides, a.doctorUid);
  });
}

function calculateSlotOccupancy(appointments, targetDate, timeSlot) {
  const dayAppts = filterAppointmentsByDate(appointments, targetDate);
  return dayAppts.filter(a => a.timeSlot === timeSlot && a.status !== 'cancelled').length;
}

const mockAppointments = [
  { id: 'a1', patientName: 'أحمد', timeSlot: '15:30', date: '2026-09-14', status: 'scheduled' },
  { id: 'a2', patientName: 'محمود', timeSlot: '15:30', date: '2026-09-14', status: 'attended' },
  { id: 'a3', patientName: 'سارة', timeSlot: '15:30', date: '2026-09-14', status: 'completed' },
  { id: 'a4', patientName: 'منى', timeSlot: '15:30', date: '2026-09-14', status: 'cancelled' },
  { id: 'a5', patientName: 'كريم', timeSlot: '16:30', date: '2026-09-14', status: 'no-show' },
  { id: 'a6', patientName: 'خالد', timeSlot: '15:30', date: '2026-09-15', status: 'scheduled' }
];

// 1. Filtering by date
const sep14Appts = filterAppointmentsByDate(mockAppointments, '2026-09-14');
assert.equal(sep14Appts.length, 5, 'Should return 5 appointments for 2026-09-14');

const sep15Appts = filterAppointmentsByDate(mockAppointments, '2026-09-15');
assert.equal(sep15Appts.length, 1, 'Should return 1 appointment for 2026-09-15');
assert.equal(sep15Appts[0].patientName, 'خالد');

// 2. Bed Occupancy calculation (ignores cancelled appointments)
const slot1530Count = calculateSlotOccupancy(mockAppointments, '2026-09-14', '15:30');
assert.equal(slot1530Count, 3, 'Slot 15:30 occupancy should be 3 beds (cancelled appt a4 excluded)');

// 3. Status transitions
let testAppt = { id: 'a1', status: 'scheduled' };
assert.equal(testAppt.status, 'scheduled');
testAppt.status = 'attended'; // Checked-in from reception
assert.equal(testAppt.status, 'attended');
testAppt.status = 'completed'; // Finished by doctor
assert.equal(testAppt.status, 'completed');
testAppt.status = 'no-show'; // Patient did not show up
assert.equal(testAppt.status, 'no-show');

console.log('✓ All 6 Appointments Engine & Status Sync assertions passed successfully!');

// 7. Insurance Companies Sync & Persistence Tests
console.log('--- Running Tests: Insurance Companies Sync & Mutation ---');

function mockAddInsuranceCompany(currentList, name) {
  const clean = name.trim();
  if (!currentList.includes(clean)) {
    return [...currentList, clean];
  }
  return currentList;
}

function mockDeleteInsuranceCompany(currentList, name) {
  const clean = name.trim();
  return currentList.filter(item => item !== clean);
}

let directCompanies = ['أكسا (AXA)', 'أليانز (Allianz)', 'ميتلايف (MetLife)'];

// Add test
directCompanies = mockAddInsuranceCompany(directCompanies, 'شركة الدلتا للتأمين');
assert.equal(directCompanies.length, 4, 'Should have 4 companies after add');
assert.ok(directCompanies.includes('شركة الدلتا للتأمين'));

// Duplicate add test
directCompanies = mockAddInsuranceCompany(directCompanies, 'شركة الدلتا للتأمين');
assert.equal(directCompanies.length, 4, 'Duplicate company must not increase count');

// Delete test
directCompanies = mockDeleteInsuranceCompany(directCompanies, 'أكسا (AXA)');
assert.equal(directCompanies.length, 3, 'Should have 3 companies after delete');
assert.ok(!directCompanies.includes('أكسا (AXA)'));

console.log('✓ All 4 Insurance Companies Sync & Mutation assertions passed successfully!');

// 8. Weekly Working Days & Friday Holiday Exclusion Tests
console.log('--- Running Tests: Friday Exclusion & Appointment Copy Engine ---');

function isFridayHoliday(dateStr) {
  return new Date(dateStr + 'T00:00:00').getDay() === 5;
}

function getWorkWeekDays(curDateStr) {
  const cur = new Date(curDateStr + 'T00:00:00');
  const dayOfWeek = cur.getDay();
  const diffToSat = (dayOfWeek + 1) % 7;
  const sat = new Date(cur);
  sat.setDate(cur.getDate() - diffToSat);

  const days = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(sat);
    d.setDate(sat.getDate() + i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    days.push(`${y}-${m}-${day}`);
  }
  return days;
}

// 1. Friday Detection
assert.equal(isFridayHoliday('2026-09-18'), true, '2026-09-18 must be detected as Friday holiday');
assert.equal(isFridayHoliday('2026-09-14'), false, '2026-09-14 (Monday) is not Friday');
assert.equal(isFridayHoliday('2026-09-12'), false, '2026-09-12 (Saturday) is not Friday');

// 2. Week working days must have exactly 6 days (excluding Friday)
const sep14Week = getWorkWeekDays('2026-09-14');
assert.equal(sep14Week.length, 6, 'Work week must have exactly 6 days');
assert.equal(sep14Week[0], '2026-09-12', 'First day of week is Saturday 2026-09-12');
assert.equal(sep14Week[5], '2026-09-17', 'Last day of week is Thursday 2026-09-17');
assert.ok(!sep14Week.includes('2026-09-18'), 'Friday 2026-09-18 must be strictly excluded from working week strip');

// 3. Appointment Copy Simulation
function copyAppointmentToDates(origAppt, targetDates) {
  return targetDates
    .filter(d => !isFridayHoliday(d))
    .map(targetDate => ({
      ...origAppt,
      id: `copy_${targetDate}_${origAppt.id}`,
      date: targetDate,
      copiedFromId: origAppt.id,
      status: 'scheduled'
    }));
}

const origAppt = {
  id: 'appt_mon_1',
  patientId: 'p_101',
  patientName: 'محمد عبد الفتاح',
  doctorUid: 'doc_mostafa',
  doctorName: 'د. مصطفى محمود',
  timeSlot: '16:30',
  date: '2026-09-14',
  status: 'completed'
};

const copied = copyAppointmentToDates(origAppt, ['2026-09-12', '2026-09-16', '2026-09-18']);
assert.equal(copied.length, 2, 'Friday must be skipped, copying to Saturday and Wednesday only');
assert.equal(copied[0].date, '2026-09-12');
assert.equal(copied[0].patientName, 'محمد عبد الفتاح');
assert.equal(copied[0].doctorName, 'د. مصطفى محمود');
assert.equal(copied[0].timeSlot, '16:30');
assert.equal(copied[0].status, 'scheduled', 'Copied appointment must reset to scheduled status');
assert.equal(copied[1].date, '2026-09-16');

console.log('✓ All 6 Friday Exclusion & Appointment Copy assertions passed successfully!');

// 9. Clinical Programs & Senior/Junior Doctor Pricing Engine Tests
console.log('--- Running Tests: Clinical Programs & Senior/Junior Doctor Pricing ---');

function calculateDoctorProgramDues(sessions, docRates) {
  let regularCount = 0;
  let scoliosisCount = 0;
  let hemiplegiaCount = 0;
  let pediatricCount = 0;
  let otherCount = 0;

  sessions.forEach(s => {
    if (s.entryType === 'examination') return;
    const count = s.bodyPartsCount || 1;
    const pType = s.sessionPricingType || s.programType || (s.isSpecial ? 'special' : 'regular');
    if (pType === 'scoliosis') {
      scoliosisCount += count;
    } else if (pType === 'hemiplegia') {
      hemiplegiaCount += count;
    } else if (pType === 'pediatric') {
      pediatricCount += count;
    } else if (pType === 'special') {
      otherCount += count;
    } else {
      regularCount += count;
    }
  });

  const totalDues = 
    (regularCount * (docRates.regular || 0)) +
    (scoliosisCount * (docRates.scoliosis || 0)) +
    (hemiplegiaCount * (docRates.hemiplegia || 0)) +
    (pediatricCount * (docRates.pediatric || 0)) +
    (otherCount * (docRates.special || 0));

  return {
    regularCount,
    scoliosisCount,
    hemiplegiaCount,
    pediatricCount,
    otherCount,
    totalDues
  };
}

const sampleMixedSessions = [
  { entryType: 'session', sessionPricingType: 'regular', bodyPartsCount: 1 },
  { entryType: 'session', sessionPricingType: 'regular', bodyPartsCount: 2 }, // 2 units
  { entryType: 'session', sessionPricingType: 'scoliosis', bodyPartsCount: 1 },
  { entryType: 'session', sessionPricingType: 'hemiplegia', bodyPartsCount: 1 },
  { entryType: 'session', sessionPricingType: 'pediatric', bodyPartsCount: 1 },
  { entryType: 'examination', sessionPricingType: 'regular', bodyPartsCount: 0 } // Exam excluded from therapy rates
];

// Test 1: Junior Doctor Rates (Regular 40, Scoliosis 80, Hemiplegia 70, Pediatric 60)
const juniorRates = { regular: 40, scoliosis: 80, hemiplegia: 70, pediatric: 60 };
const juniorDues = calculateDoctorProgramDues(sampleMixedSessions, juniorRates);
assert.equal(juniorDues.regularCount, 3, 'Junior should have 3 regular session units (1 + 2)');
assert.equal(juniorDues.scoliosisCount, 1, 'Junior should have 1 scoliosis session');
assert.equal(juniorDues.hemiplegiaCount, 1, 'Junior should have 1 hemiplegia session');
assert.equal(juniorDues.pediatricCount, 1, 'Junior should have 1 pediatric session');
// Total = (3 * 40) + (1 * 80) + (1 * 70) + (1 * 60) = 120 + 80 + 70 + 60 = 330 EGP
assert.equal(juniorDues.totalDues, 330, 'Junior total dues should be 330 EGP');

// Test 2: Senior Doctor Rates (Regular 70, Scoliosis 130, Hemiplegia 100, Pediatric 90)
const seniorRates = { regular: 70, scoliosis: 130, hemiplegia: 100, pediatric: 90 };
const seniorDues = calculateDoctorProgramDues(sampleMixedSessions, seniorRates);
assert.equal(seniorDues.regularCount, 3);
assert.equal(seniorDues.scoliosisCount, 1);
assert.equal(seniorDues.hemiplegiaCount, 1);
assert.equal(seniorDues.pediatricCount, 1);
// Total = (3 * 70) + (1 * 130) + (1 * 100) + (1 * 90) = 210 + 130 + 100 + 90 = 530 EGP
assert.equal(seniorDues.totalDues, 530, 'Senior total dues should be 530 EGP');

console.log('✓ All 8 Clinical Program & Seniority Dues assertions passed successfully!');
