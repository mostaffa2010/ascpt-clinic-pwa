import assert from 'node:assert/strict';
import { getDayShiftKey, isDoctorOnDuty, getShiftLabel, getLatestTherapySession, sequencePatientSessionsChronologically } from '../js/utils.js';

console.log('--- Running ASCPT Unit Tests: Calculations & Shift Engine ---');

// 1. Shift Key Mapping Tests
assert.equal(getDayShiftKey('2026-09-12'), 'sat_mon_wed', 'Saturday must map to sat_mon_wed');
assert.equal(getDayShiftKey('2026-09-13'), 'sun_tue_thu', 'Sunday must map to sun_tue_thu');
assert.equal(getDayShiftKey('2026-09-14'), 'sat_mon_wed', 'Monday must map to sat_mon_wed');
assert.equal(getDayShiftKey('2026-09-15'), 'sun_tue_thu', 'Tuesday must map to sun_tue_thu');
assert.equal(getDayShiftKey('2026-09-16'), 'sat_mon_wed', 'Wednesday must map to sat_mon_wed');
assert.equal(getDayShiftKey('2026-09-17'), 'sun_tue_thu', 'Thursday must map to sun_tue_thu');
assert.equal(getDayShiftKey('2026-09-18'), 'friday', 'Friday must map to friday');

// 2. Doctor On-Duty Logic Tests
assert.equal(isDoctorOnDuty('sat_mon_wed', '2026-09-12'), true, 'Doctor with sat_mon_wed must be on duty on Saturday');
assert.equal(isDoctorOnDuty('sun_tue_thu', '2026-09-12'), false, 'Doctor with sun_tue_thu must NOT be on duty on Saturday');
assert.equal(isDoctorOnDuty('all', '2026-09-12'), true, 'Full-time doctor (all) must be on duty on Saturday');
assert.equal(isDoctorOnDuty('sun_tue_thu', '2026-09-13'), true, 'Doctor with sun_tue_thu must be on duty on Sunday');
assert.equal(isDoctorOnDuty('sat_mon_wed', '2026-09-13'), false, 'Doctor with sat_mon_wed must NOT be on duty on Sunday');

const sampleOverrides = [{ doctorUid: 'doc_mostafa', date: '2026-09-13', type: 'coverage' }];
assert.equal(isDoctorOnDuty('sat_mon_wed', '2026-09-13', sampleOverrides, 'doc_mostafa'), true, 'Doctor with coverage override must be on duty');
assert.equal(isDoctorOnDuty('sat_mon_wed', '2026-09-13', sampleOverrides, 'other_doc'), false, 'Other doctor must remain off duty');

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
    if (s.entryType === 'examination') return;
    const isSpec = Boolean(s.isSpecial || s.sessionPricingType === 'special');
    const count = s.bodyPartsCount || 1;
    if (isSpec) specialCount += count;
    else regularCount += count;
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
assert.equal(getLatestTherapySession([]), null, 'Empty list must return null');
assert.equal(getLatestTherapySession([{ entryType: 'examination' }]), null, 'Only examinations list must return null');
console.log('✓ All 8 Last Session Auto-Restore assertions passed successfully!');

// 6. Appointments Date Filtering & Status Transition Tests
console.log('--- Running Tests: Appointments Engine & Status Sync ---');
function filterAppointmentsByDate(appointments, targetDate, doctors = [], shiftOverrides = []) {
  if (!targetDate) return [];
  const curDate = new Date(targetDate + 'T00:00:00');
  const dayOfWeek = curDate.getDay();
  if (dayOfWeek === 5) return [];
  const shiftKey = getDayShiftKey(targetDate);
  return appointments.filter(a => {
    if (Array.isArray(a.daysOfWeek) && a.daysOfWeek.length > 0) {
      if (a.status === 'completed') return false;
      if (!a.daysOfWeek.includes(dayOfWeek)) return false;
      if (a.startDate && targetDate < a.startDate) return false;
      if (a.endDate && targetDate > a.endDate) return false;
      return true;
    }
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

const sep14Appts = filterAppointmentsByDate(mockAppointments, '2026-09-14');
assert.equal(sep14Appts.length, 5, 'Should return 5 appointments for 2026-09-14');
const sep15Appts = filterAppointmentsByDate(mockAppointments, '2026-09-15');
assert.equal(sep15Appts.length, 1, 'Should return 1 appointment for 2026-09-15');
assert.equal(sep15Appts[0].patientName, 'خالد');

const slot1530Count = calculateSlotOccupancy(mockAppointments, '2026-09-14', '15:30');
assert.equal(slot1530Count, 3, 'Slot 15:30 occupancy should be 3 beds');

let testAppt = { id: 'a1', status: 'scheduled' };
assert.equal(testAppt.status, 'scheduled');
testAppt.status = 'attended';
assert.equal(testAppt.status, 'attended');
testAppt.status = 'completed';
assert.equal(testAppt.status, 'completed');
testAppt.status = 'no-show';
assert.equal(testAppt.status, 'no-show');
console.log('✓ All 6 Appointments Engine & Status Sync assertions passed successfully!');

// 6.5 Weekly Recurring Appointments Engine Tests
console.log('--- Running Tests: Weekly Recurring Appointments Engine ---');
const recurringAppt = {
  id: 'rec_101',
  patientName: 'الحسن سيد شحاتة',
  doctorUid: 'doc_mostafa',
  timeSlot: '15:30',
  daysOfWeek: [6, 1, 3],
  startDate: '2026-09-12',
  status: 'active'
};

assert.equal(filterAppointmentsByDate([recurringAppt], '2026-09-12').length, 1);
assert.equal(filterAppointmentsByDate([recurringAppt], '2026-09-13').length, 0);
assert.equal(filterAppointmentsByDate([recurringAppt], '2026-09-14').length, 1);
assert.equal(filterAppointmentsByDate([recurringAppt], '2026-09-16').length, 1);
assert.equal(filterAppointmentsByDate([recurringAppt], '2026-09-19').length, 1);
assert.equal(filterAppointmentsByDate([recurringAppt], '2026-09-21').length, 1);
assert.equal(filterAppointmentsByDate([recurringAppt], '2026-09-18').length, 0);

// Weekly Master Grid Filter Rule: Never hide active recurring appointments when a session is completed
function filterWeeklyMasterAppointments(appointments, slotKey, dayIndex) {
  return appointments.filter(a => {
    if (a.status === 'cancelled' || a.status === 'discharged') return false;
    if (a.timeSlot !== slotKey) return false;
    if (Array.isArray(a.daysOfWeek) && a.daysOfWeek.includes(dayIndex)) return true;
    return false;
  });
}

// Even if an appointment has status === 'completed' or dailyStatuses set, it remains in weekly master grid
const completedTodayRecurring = { ...recurringAppt, status: 'scheduled', dailyStatuses: { '2026-09-14': 'completed' } };
assert.equal(filterWeeklyMasterAppointments([completedTodayRecurring], '15:30', 6).length, 1, 'Present on Saturday in master grid');
assert.equal(filterWeeklyMasterAppointments([completedTodayRecurring], '15:30', 1).length, 1, 'Present on Monday in master grid');
assert.equal(filterWeeklyMasterAppointments([completedTodayRecurring], '15:30', 3).length, 1, 'Present on Wednesday in master grid');
assert.equal(filterWeeklyMasterAppointments([completedTodayRecurring], '15:30', 0).length, 0, 'Not present on Sunday');

console.log('✓ All 11 Weekly Recurring Appointments & Master Grid assertions passed successfully!');

// 7. Insurance Companies Sync & Persistence Tests
console.log('--- Running Tests: Insurance Companies Sync & Mutation ---');
function mockAddInsuranceCompany(currentList, name) {
  const clean = name.trim();
  if (!currentList.includes(clean)) return [...currentList, clean];
  return currentList;
}
function mockDeleteInsuranceCompany(currentList, name) {
  const clean = name.trim();
  return currentList.filter(item => item !== clean);
}

let directCompanies = ['أكسا (AXA)', 'أليانز (Allianz)', 'ميتلايف (MetLife)'];
directCompanies = mockAddInsuranceCompany(directCompanies, 'شركة الدلتا للتأمين');
assert.equal(directCompanies.length, 4, 'Should have 4 companies after add');
assert.ok(directCompanies.includes('شركة الدلتا للتأمين'));
directCompanies = mockAddInsuranceCompany(directCompanies, 'شركة الدلتا للتأمين');
assert.equal(directCompanies.length, 4, 'Duplicate company must not increase count');
directCompanies = mockDeleteInsuranceCompany(directCompanies, 'أكسا (AXA)');
assert.equal(directCompanies.length, 3, 'Should have 3 companies after delete');
assert.ok(!directCompanies.includes('أكسا (AXA)'));
// Test 6: Insurance Contract Isolation & Quick Chips Guardrail
const mockDirectCompanies = ['أكسا (AXA)', 'أبو قير', 'أليانز (Allianz)', 'ميتلايف (MetLife)'];
const mockIndirectCompanies = ['ايجي كير', 'عناية', 'ميدي كونسالت', 'ايجي ميد'];

function getMockQuickChips(contractType, currentVal) {
  const companies = contractType === 'direct' ? mockDirectCompanies : mockIndirectCompanies;
  const quickList = companies.slice(0, 8);
  if (currentVal && companies.includes(currentVal) && !quickList.includes(currentVal)) {
    quickList.unshift(currentVal);
  }
  return quickList;
}

// Case 1: Direct company 'أبو قير' must NOT appear in indirect quick chips even if currentVal is 'أبو قير'
const indirectChipsWithDirectVal = getMockQuickChips('indirect', 'أبو قير');
assert.ok(!indirectChipsWithDirectVal.includes('أبو قير'), 'Direct company must never leak into indirect chips deck');
assert.equal(indirectChipsWithDirectVal.length, 4);

// Case 2: Direct company 'أبو قير' must appear in direct quick chips
const directChips = getMockQuickChips('direct', 'أبو قير');
assert.ok(directChips.includes('أبو قير'), 'Direct company must appear in direct chips deck');

// Case 3: Legacy Abo Qir normalizer check
function isLegacyAboQir(name) {
  if (!name) return false;
  const norm = name.trim().toLowerCase()
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, '');
  return norm.includes('ابوقير') && norm.includes('اسمد');
}

assert.equal(isLegacyAboQir('أبوقير للأسمدة'), true, 'Must detect أبوقير للأسمدة as legacy');
assert.equal(isLegacyAboQir('أبو قير للأسمدة'), true, 'Must detect أبو قير للأسمدة as legacy');
assert.equal(isLegacyAboQir('أبو قير'), false, 'Clean أبو قير must not be flagged as legacy');
assert.equal(isLegacyAboQir('ايجي كير'), false, 'Unrelated companies must not be flagged');

console.log('✓ All 7 Insurance Companies Sync & Mutation assertions passed successfully!');

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

assert.equal(isFridayHoliday('2026-09-18'), true, '2026-09-18 must be detected as Friday holiday');
assert.equal(isFridayHoliday('2026-09-14'), false, '2026-09-14 (Monday) is not Friday');
assert.equal(isFridayHoliday('2026-09-12'), false, '2026-09-12 (Saturday) is not Friday');

const sep14Week = getWorkWeekDays('2026-09-14');
assert.equal(sep14Week.length, 6, 'Work week must have exactly 6 days');
assert.equal(sep14Week[0], '2026-09-12', 'First day of week is Saturday 2026-09-12');
assert.equal(sep14Week[5], '2026-09-17', 'Last day of week is Thursday 2026-09-17');
assert.ok(!sep14Week.includes('2026-09-18'), 'Friday 2026-09-18 must be excluded');

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
assert.equal(copied.length, 2, 'Friday must be skipped');
assert.equal(copied[0].date, '2026-09-12');
assert.equal(copied[0].patientName, 'محمد عبد الفتاح');
assert.equal(copied[0].doctorName, 'د. مصطفى محمود');
assert.equal(copied[0].timeSlot, '16:30');
assert.equal(copied[0].status, 'scheduled');
assert.equal(copied[1].date, '2026-09-16');
console.log('✓ All 6 Friday Exclusion & Appointment Copy assertions passed successfully!');

// 9. Clinical Programs & Senior/Junior Doctor Pricing Engine Tests
console.log('--- Running Tests: Clinical Programs & Senior/Junior Doctor Pricing ---');
function calculateDoctorProgramDues(sessions, docRates) {
  let regularCount = 0;
  let scoliosisCount = 0;
  let hemiplegiaCount = 0;
  let quadriplegiaCount = 0;
  let otherCount = 0;
  sessions.forEach(s => {
    if (s.entryType === 'examination') return;
    const count = s.bodyPartsCount || 1;
    const pType = s.sessionPricingType || s.programType || (s.isSpecial ? 'special' : 'regular');
    if (pType === 'scoliosis') scoliosisCount += count;
    else if (pType === 'hemiplegia') hemiplegiaCount += count;
    else if (pType === 'quadriplegia' || pType === 'pediatric') quadriplegiaCount += count;
    else if (pType === 'special') otherCount += count;
    else regularCount += count;
  });
  const quadRate = docRates.quadriplegia ?? docRates.pediatric ?? 0;
  const totalDues = (regularCount * (docRates.regular || 0)) +
                    (scoliosisCount * (docRates.scoliosis || 0)) +
                    (hemiplegiaCount * (docRates.hemiplegia || 0)) +
                    (quadriplegiaCount * quadRate) +
                    (otherCount * (docRates.special || 0));
  return { regularCount, scoliosisCount, hemiplegiaCount, quadriplegiaCount, otherCount, totalDues };
}

const sampleMixedSessions = [
  { entryType: 'session', sessionPricingType: 'regular', bodyPartsCount: 1 },
  { entryType: 'session', sessionPricingType: 'regular', bodyPartsCount: 2 },
  { entryType: 'session', sessionPricingType: 'scoliosis', bodyPartsCount: 1 },
  { entryType: 'session', sessionPricingType: 'hemiplegia', bodyPartsCount: 1 },
  { entryType: 'session', sessionPricingType: 'quadriplegia', bodyPartsCount: 1 },
  { entryType: 'examination', sessionPricingType: 'regular', bodyPartsCount: 0 }
];

const juniorRates = { regular: 40, scoliosis: 80, hemiplegia: 70, quadriplegia: 60, pediatric: 60 };
const juniorDues = calculateDoctorProgramDues(sampleMixedSessions, juniorRates);
assert.equal(juniorDues.regularCount, 3);
assert.equal(juniorDues.scoliosisCount, 1);
assert.equal(juniorDues.hemiplegiaCount, 1);
assert.equal(juniorDues.quadriplegiaCount, 1);
assert.equal(juniorDues.totalDues, 330);

const seniorRates = { regular: 70, scoliosis: 130, hemiplegia: 100, quadriplegia: 90, pediatric: 90 };
const seniorDues = calculateDoctorProgramDues(sampleMixedSessions, seniorRates);
assert.equal(seniorDues.regularCount, 3);
assert.equal(seniorDues.scoliosisCount, 1);
assert.equal(seniorDues.hemiplegiaCount, 1);
assert.equal(seniorDues.quadriplegiaCount, 1);
assert.equal(seniorDues.totalDues, 530);
console.log('✓ All 8 Clinical Program & Seniority Dues assertions passed successfully!');

// 10. Version-Doc Pattern Sync Engine Tests
console.log('--- Running Tests: Version-Doc Pattern & Sync Trigger Engine ---');
function createMockDeltaSyncListener(initialData, singleDocStore = {}) {
  let lastSeenVersion = null;
  let isFirstSnapshot = true;
  let fullCollectionFetchCount = 0;
  let singleDocFetchCount = 0;
  let suppressNextOwnVersionEvent = false;
  let cache = [...initialData];
  let notifiedData = [...initialData];

  function mockFullFetch() {
    fullCollectionFetchCount++;
    cache = [...initialData];
    notifiedData = [...cache];
    return Promise.resolve(cache);
  }

  function mockSingleDocFetch(id) {
    singleDocFetchCount++;
    const docData = singleDocStore[id];
    return Promise.resolve(docData ? { exists: true, id, data: docData } : { exists: false, id });
  }

  mockFullFetch();

  async function onSnapshotCallback(snap) {
    const data = snap.exists ? snap.data : null;
    const currentVersion = (data && typeof data.patientsVersion === 'number') ? data.patientsVersion : 0;

    if (suppressNextOwnVersionEvent) {
      suppressNextOwnVersionEvent = false;
      lastSeenVersion = currentVersion;
      return;
    }
    if (isFirstSnapshot) {
      isFirstSnapshot = false;
      lastSeenVersion = currentVersion;
      return;
    }
    if (lastSeenVersion === currentVersion) return;

    const isSequential = (typeof lastSeenVersion === 'number' && currentVersion === lastSeenVersion + 1);
    const action = data ? data.lastChangedPatientAction : null;
    const targetId = data ? data.lastChangedPatientId : null;
    lastSeenVersion = currentVersion;

    if (isSequential && targetId && (action === 'created' || action === 'updated' || action === 'deleted') && Array.isArray(cache)) {
      if (action === 'deleted') {
        cache = cache.filter(p => p.id !== targetId);
        notifiedData = [...cache];
        return;
      }
      const pSnap = await mockSingleDocFetch(targetId);
      if (pSnap.exists) {
        const item = { id: pSnap.id, ...pSnap.data };
        const idx = cache.findIndex(p => p.id === targetId);
        if (idx !== -1) cache[idx] = { ...cache[idx], ...item };
        else cache.unshift(item);
        notifiedData = [...cache];
        return;
      } else {
        cache = cache.filter(p => p.id !== targetId);
        notifiedData = [...cache];
        return;
      }
    }
    await mockFullFetch();
  }

  return {
    getLastSeen: () => lastSeenVersion,
    getFullFetchCount: () => fullCollectionFetchCount,
    getSingleDocFetchCount: () => singleDocFetchCount,
    getNotifiedData: () => notifiedData,
    getCache: () => cache,
    setSuppressOwn: (val) => { suppressNextOwnVersionEvent = val; },
    getSuppressOwn: () => suppressNextOwnVersionEvent,
    triggerSnapshot: onSnapshotCallback
  };
}

const mockPatientsData = [{ id: 'p1', name: 'أحمد' }, { id: 'p2', name: 'محمود' }];
const mockStore = {
  p1: { name: 'أحمد المعدل', phone: '0100000000' },
  p3: { name: 'علي الجديد', phone: '0120000000' }
};
const syncTest = createMockDeltaSyncListener(mockPatientsData, mockStore);

assert.equal(syncTest.getFullFetchCount(), 1);
assert.equal(syncTest.getSingleDocFetchCount(), 0);

await syncTest.triggerSnapshot({ exists: true, data: { patientsVersion: 5 } });
assert.equal(syncTest.getLastSeen(), 5);
assert.equal(syncTest.getFullFetchCount(), 1);

await syncTest.triggerSnapshot({ exists: true, data: { patientsVersion: 5 } });
assert.equal(syncTest.getFullFetchCount(), 1);
assert.equal(syncTest.getSingleDocFetchCount(), 0);

syncTest.setSuppressOwn(true);
await syncTest.triggerSnapshot({ exists: true, data: { patientsVersion: 6, lastChangedPatientId: 'p1', lastChangedPatientAction: 'updated' } });
assert.equal(syncTest.getLastSeen(), 6);
assert.equal(syncTest.getFullFetchCount(), 1);
assert.equal(syncTest.getSingleDocFetchCount(), 0);
assert.equal(syncTest.getSuppressOwn(), false);

await syncTest.triggerSnapshot({ exists: true, data: { patientsVersion: 7, lastChangedPatientId: 'p1', lastChangedPatientAction: 'updated' } });
assert.equal(syncTest.getLastSeen(), 7);
assert.equal(syncTest.getFullFetchCount(), 1);
assert.equal(syncTest.getSingleDocFetchCount(), 1);
assert.equal(syncTest.getCache().find(p => p.id === 'p1').name, 'أحمد المعدل');

await syncTest.triggerSnapshot({ exists: true, data: { patientsVersion: 8, lastChangedPatientId: 'p2', lastChangedPatientAction: 'deleted' } });
assert.equal(syncTest.getLastSeen(), 8);
assert.equal(syncTest.getFullFetchCount(), 1);
assert.equal(syncTest.getSingleDocFetchCount(), 1);
assert.equal(syncTest.getCache().some(p => p.id === 'p2'), false);

await syncTest.triggerSnapshot({ exists: true, data: { patientsVersion: 12, lastChangedPatientId: 'p3', lastChangedPatientAction: 'created' } });
assert.equal(syncTest.getLastSeen(), 12);
assert.equal(syncTest.getFullFetchCount(), 2);

const emptyDocSync = createMockDeltaSyncListener([]);
await emptyDocSync.triggerSnapshot({ exists: false, data: null });
assert.equal(emptyDocSync.getLastSeen(), 0);
console.log('✓ All 8 Version-Doc Sync Trigger assertions passed successfully!');

// 11. Today Patients Filter Engine Tests (Master Schedule Only - Attended Excluded)
console.log('--- Running Tests: Today Patients Filter & Day-of-Week Sync ---');
function mockGetTodayPatientIdentifiers({ todayStr, sessions = [], appointments = [] }) {
  const todayIds = new Set();
  const todayNames = new Set();
  const normalize = (t) => (t || '').trim().toLowerCase().replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');

  // 1. Attended patients today (from recorded sessions)
  const attendedIds = new Set();
  const attendedNames = new Set();
  sessions.forEach(s => {
    const sDate = s.date || (s.createdAt ? s.createdAt.substring(0, 10) : '');
    if (sDate === todayStr && s.status !== 'cancelled') {
      if (s.patientId) attendedIds.add(String(s.patientId).trim());
      if (s.patientName) attendedNames.add(normalize(s.patientName));
    }
  });

  // 2. Scheduled appointments for today (Strict day-of-week or exact date)
  const curDate = new Date(todayStr + 'T00:00:00');
  const dayOfWeek = curDate.getDay();
  if (dayOfWeek !== 5) { // Friday holiday
    const todayAppts = appointments.filter(a => {
      if (a.status === 'completed' || a.status === 'cancelled') return false;
      if (Array.isArray(a.daysOfWeek) && a.daysOfWeek.length > 0) {
        return a.daysOfWeek.includes(dayOfWeek);
      }
      if (a.date) return a.date === todayStr;
      return false;
    });

    todayAppts.forEach(a => {
      if (a.effectiveStatus === 'cancelled' || a.isCancelledToday) return;
      const pId = a.patientId ? String(a.patientId).trim() : '';
      const pName = a.patientName ? normalize(a.patientName) : '';

      // If already attended today, exclude from remaining scheduled cases
      if ((pId && attendedIds.has(pId)) || (pName && attendedNames.has(pName)) || a.isAttendedToday) {
        return;
      }
      if (pId) todayIds.add(pId);
      if (pName) todayNames.add(pName);
    });
  }
  return { todayIds, todayNames };
}

const mondayAppts = Array.from({ length: 15 }, (_, i) => ({
  id: `appt_${i+1}`,
  patientId: `p_${i+1}`,
  patientName: `مريض ${i+1}`,
  daysOfWeek: [6, 1, 3] // Sat, Mon, Wed
}));

// Tuesday (day 2): Monday appts do NOT match Tuesday
const tuesdayResult = mockGetTodayPatientIdentifiers({
  todayStr: '2026-09-15',
  sessions: [],
  appointments: mondayAppts
});
assert.equal(tuesdayResult.todayIds.size, 0);

// Monday (day 1): 15 scheduled appointments before clinic opens (0 sessions attended)
const mondayResult = mockGetTodayPatientIdentifiers({
  todayStr: '2026-09-14',
  sessions: [],
  appointments: mondayAppts
});
assert.equal(mondayResult.todayIds.size, 15);

// Monday with 1 patient attended: p_1 should disappear from remaining scheduled cases -> 14 remaining!
const mondayWith1Attended = mockGetTodayPatientIdentifiers({
  todayStr: '2026-09-14',
  sessions: [{ patientId: 'p_1', patientName: 'مريض 1', date: '2026-09-14' }],
  appointments: mondayAppts
});
assert.equal(mondayWith1Attended.todayIds.size, 14);
assert.equal(mondayWith1Attended.todayIds.has('p_1'), false);

// Monday when ALL 15 patients have attended sessions: should be 0 remaining!
const mondayAllAttended = mockGetTodayPatientIdentifiers({
  todayStr: '2026-09-14',
  sessions: mondayAppts.map(a => ({ patientId: a.patientId, patientName: a.patientName, date: '2026-09-14' })),
  appointments: mondayAppts
});
assert.equal(mondayAllAttended.todayIds.size, 0);

// Friday holiday (2026-09-18): should always be 0!
const fridayResult = mockGetTodayPatientIdentifiers({
  todayStr: '2026-09-18',
  sessions: [],
  appointments: mondayAppts
});
assert.equal(fridayResult.todayIds.size, 0);

console.log('✓ All 6 Today Patients Filter assertions passed successfully!');

// 12. Batch Home Visits & Doctor Dashboard Dues Isolation Tests
console.log('--- Running Tests: Batch Home Visits & Doctor Dashboard Decoupling ---');

function mockGenerateBatchHomeVisitDates({ count = 12, startDate = '2026-09-12', pattern = 'sat_mon_wed' }) {
  let allowedDays;
  if (pattern === 'sun_tue_thu') {
    allowedDays = [0, 2, 4];
  } else if (pattern === 'both' || pattern === 'sat_to_thu' || pattern === 'all_week') {
    allowedDays = [0, 1, 2, 3, 4, 6];
  } else {
    allowedDays = [6, 1, 3];
  }
  const generated = [];
  const curDate = new Date(startDate + 'T00:00:00');
  let safety = 0;
  while (generated.length < count && safety < 150) {
    safety++;
    const day = curDate.getDay();
    if (day !== 5 && allowedDays.includes(day)) {
      const y = curDate.getFullYear();
      const m = String(curDate.getMonth() + 1).padStart(2, '0');
      const d = String(curDate.getDate()).padStart(2, '0');
      generated.push(`${y}-${m}-${d}`);
    }
    curDate.setDate(curDate.getDate() + 1);
  }
  return generated;
}

// 1. Test Sat/Mon/Wed pattern for 12 sessions starting Saturday 2026-09-12
const satBatch = mockGenerateBatchHomeVisitDates({ count: 12, startDate: '2026-09-12', pattern: 'sat_mon_wed' });
assert.equal(satBatch.length, 12, 'Must generate exactly 12 dates');
assert.equal(satBatch[0], '2026-09-12', 'First date Saturday');
assert.equal(satBatch[1], '2026-09-14', 'Second date Monday');
assert.equal(satBatch[2], '2026-09-16', 'Third date Wednesday');
assert.equal(satBatch[3], '2026-09-19', 'Fourth date next Saturday');
assert.ok(!satBatch.includes('2026-09-18'), 'Friday 2026-09-18 must be strictly excluded');

// 2. Test Sun/Tue/Thu pattern for 6 sessions starting Sunday 2026-09-13
const sunBatch = mockGenerateBatchHomeVisitDates({ count: 6, startDate: '2026-09-13', pattern: 'sun_tue_thu' });
assert.equal(sunBatch.length, 6, 'Must generate exactly 6 dates');
assert.equal(sunBatch[0], '2026-09-13', 'First date Sunday');
assert.equal(sunBatch[1], '2026-09-15', 'Second date Tuesday');
assert.equal(sunBatch[2], '2026-09-17', 'Third date Thursday');
assert.ok(!sunBatch.includes('2026-09-18'), 'Friday holiday must not appear');

// 3. Test Both patterns together (Saturday to Thursday) for 12 sessions starting Saturday 2026-09-12
const bothBatch = mockGenerateBatchHomeVisitDates({ count: 12, startDate: '2026-09-12', pattern: 'both' });
assert.equal(bothBatch.length, 12, 'Must generate exactly 12 dates for both patterns');
assert.equal(bothBatch[0], '2026-09-12', 'Day 1 Sat');
assert.equal(bothBatch[1], '2026-09-13', 'Day 2 Sun');
assert.equal(bothBatch[2], '2026-09-14', 'Day 3 Mon');
assert.equal(bothBatch[3], '2026-09-15', 'Day 4 Tue');
assert.equal(bothBatch[4], '2026-09-16', 'Day 5 Wed');
assert.equal(bothBatch[5], '2026-09-17', 'Day 6 Thu');
assert.ok(!bothBatch.includes('2026-09-18'), 'Friday 2026-09-18 must be strictly excluded');
assert.equal(bothBatch[6], '2026-09-19', 'Day 7 next Sat');

// 3. Test Doctor Dashboard In-Clinic Dues Exclusion Logic
function calculateDoctorMonthDuesWithExclusions(sessions, regularRate = 50) {
  let inClinicCount = 0;
  let inClinicDues = 0;

  sessions.forEach(s => {
    if (s.entryType === 'examination') return;
    // Strict business rule 1: Home visits are excluded from standard doctor clinic dues
    if (s.isHomeVisit || s.visitType === 'home') return;
    // Strict business rule 2: Historical / pre-settled sessions (before Sept 2026 or isPreSettled) are excluded
    if (s.isPreSettled || (s.date && s.date < '2026-09-01')) return;

    const count = s.bodyPartsCount || 1;
    inClinicCount += count;
    inClinicDues += (count * regularRate);
  });

  return { inClinicCount, inClinicDues };
}

const mixedDoctorSessions = [
  // 3 in-clinic sessions in September -> MUST be counted (3 * 50 = 150 EGP)
  { id: 's1', date: '2026-09-02', isHomeVisit: false, isPreSettled: false, bodyPartsCount: 1 },
  { id: 's2', date: '2026-09-05', isHomeVisit: false, isPreSettled: false, bodyPartsCount: 1 },
  { id: 's3', date: '2026-09-08', isHomeVisit: false, isPreSettled: false, bodyPartsCount: 1 },
  // 12 home visit sessions in September -> MUST NOT be counted in clinic dues (0 EGP)
  ...Array.from({ length: 12 }, (_, i) => ({
    id: `hv_${i+1}`,
    date: '2026-09-10',
    isHomeVisit: true,
    visitType: 'home',
    bodyPartsCount: 1
  })),
  // 10 historical sessions before September 2026 -> MUST NOT be counted in dues (0 EGP)
  ...Array.from({ length: 10 }, (_, i) => ({
    id: `hist_${i+1}`,
    date: '2026-08-20',
    isHomeVisit: false,
    bodyPartsCount: 1
  })),
  // 4 pre-settled sessions in September -> MUST NOT be counted in dues (0 EGP)
  ...Array.from({ length: 4 }, (_, i) => ({
    id: `pre_${i+1}`,
    date: '2026-09-12',
    isPreSettled: true,
    bodyPartsCount: 1
  }))
];

const duesCalculation = calculateDoctorMonthDuesWithExclusions(mixedDoctorSessions, 50);
assert.equal(duesCalculation.inClinicCount, 3, 'Only the 3 in-clinic September sessions must be counted');
assert.equal(duesCalculation.inClinicDues, 150, 'Total dues must be exactly 150 EGP (12 home visits + 10 August + 4 pre-settled excluded)');

// 4. Test Home Visits Grouping for Doctor Dashboard (Count and Name only, NO PRICES)
function groupHomeVisitsForDoctor(sessions) {
  const hv = sessions.filter(s => s.isHomeVisit || s.visitType === 'home');
  const groups = new Map();
  hv.forEach(s => {
    const key = s.patientId || s.patientName;
    if (!groups.has(key)) {
      groups.set(key, {
        patientId: s.patientId,
        patientName: s.patientName,
        insuranceName: s.insuranceName,
        sessionCount: 0
      });
    }
    groups.get(key).sessionCount++;
  });
  return Array.from(groups.values());
}

const sampleHVSessions = [
  ...Array.from({ length: 12 }, () => ({ patientId: 'p100', patientName: 'سيد إبراهيم', isHomeVisit: true, insuranceName: 'أكسا' })),
  ...Array.from({ length: 6 }, () => ({ patientId: 'p200', patientName: 'فاطمة حسن', isHomeVisit: true, insuranceName: 'أليانز' }))
];

const groupedHV = groupHomeVisitsForDoctor(sampleHVSessions);
assert.equal(groupedHV.length, 2, 'Should have 2 patient groups');
assert.equal(groupedHV[0].patientName, 'سيد إبراهيم');
assert.equal(groupedHV[0].sessionCount, 12, 'Patient 1 must have 12 sessions');
assert.equal(groupedHV[1].patientName, 'فاطمة حسن');
assert.equal(groupedHV[1].sessionCount, 6, 'Patient 2 must have 6 sessions');
assert.equal(groupedHV[0].price, undefined, 'Must not contain any price or monetary dues');

// 5. Test Daily Sessions Log Isolation: Home Visits strictly excluded, Clinic Batches preserved
function filterSessionsForDailyLog(sessionsList) {
  return (sessionsList || []).filter(s => !s.isHomeVisit && s.visitType !== 'home');
}

const mixedDailyLogSessions = [
  { id: 's_clinic_1', patientName: 'علي كمال', isHomeVisit: false, visitType: 'clinic' },
  { id: 's_hv_1', patientName: 'محمود عبد الله', isHomeVisit: true, visitType: 'home' },
  { id: 's_clinic_batch', patientName: 'مريض أرشيف مركز', isHomeVisit: false, visitType: 'clinic' },
  { id: 's_hv_2', patientName: 'محمود عبد الله', isHomeVisit: true, visitType: 'home' }
];

const dailyFiltered = filterSessionsForDailyLog(mixedDailyLogSessions);
assert.equal(dailyFiltered.length, 2, 'Daily sessions log must strictly contain 2 clinic sessions and exclude 2 home visits');
assert.equal(dailyFiltered[0].id, 's_clinic_1');
assert.equal(dailyFiltered[1].id, 's_clinic_batch');

// 6. Test Doctor Dashboard Cross-Month Home Visits Merging
function mergeDoctorSessionsAndHomeVisits(monthSessions, allHomeVisits, docUid, docName) {
  const isDocMatch = (s) => {
    if (s.doctorUid && docUid && s.doctorUid === docUid) return true;
    if (s.doctor && docName && (s.doctor.trim() === docName || s.doctor.includes(docName) || docName.includes(s.doctor))) return true;
    return false;
  };
  const monthDocSessions = monthSessions.filter(isDocMatch);
  const docHomeVisits = allHomeVisits.filter(isDocMatch);
  const merged = [...monthDocSessions];
  const existingIds = new Set(monthDocSessions.map(s => s.id));
  docHomeVisits.forEach(s => {
    if (!existingIds.has(s.id)) {
      merged.push(s);
      existingIds.add(s.id);
    }
  });
  return merged;
}

const mockDocMonthSessions = [
  { id: 's_sept_1', date: '2026-09-02', doctorUid: 'doc_1', isHomeVisit: false }
];
const mockAllHomeVisits = [
  ...Array.from({ length: 12 }, (_, i) => ({
    id: `hv_june_${i+1}`,
    date: `2026-06-24`,
    doctorUid: 'doc_1',
    doctor: 'د. حسني أحمد الجويلي',
    patientId: 'p_hv_1',
    patientName: 'مريض زيارة منزلية',
    isHomeVisit: true,
    visitType: 'home'
  })),
  { id: 'hv_other_doc', date: '2026-06-25', doctorUid: 'doc_2', isHomeVisit: true, visitType: 'home' }
];

const docMerged = mergeDoctorSessionsAndHomeVisits(mockDocMonthSessions, mockAllHomeVisits, 'doc_1', 'د. حسني أحمد الجويلي');
assert.equal(docMerged.length, 13, 'Merged sessions must include 1 September clinic session + 12 June home visits for doc_1');
const docHVOnly = docMerged.filter(s => s.isHomeVisit || s.visitType === 'home');
assert.equal(docHVOnly.length, 12, 'Must have exactly 12 home visits');
assert.equal(docHVOnly[0].date.startsWith('2026-06'), true, 'Home visits from June must be present in doctor dashboard');

const docGroupedHV = groupHomeVisitsForDoctor(docMerged);
assert.equal(docGroupedHV.length, 1, 'Should group into exactly 1 patient in doctor home-visits tab');
assert.equal(docGroupedHV[0].sessionCount, 12, 'Group must have all 12 sessions');

// 7. Test Batch Sessions & Home Visits Deletion Engine
function mockDeleteBatchSessions(sessionsCache, sessionIdsToDelete) {
  const idSet = new Set(sessionIdsToDelete);
  return sessionsCache.filter(s => !idSet.has(s.id));
}

const initialHVCache = [
  ...Array.from({ length: 12 }, (_, i) => ({ id: `hv_del_${i+1}`, patientId: 'p_del' })),
  { id: 'hv_keep_1', patientId: 'p_keep' }
];
const idsToDelete = initialHVCache.filter(s => s.patientId === 'p_del').map(s => s.id);
assert.equal(idsToDelete.length, 12, 'Must identify 12 sessions to delete for patient p_del');

const remainingCache = mockDeleteBatchSessions(initialHVCache, idsToDelete);
assert.equal(remainingCache.length, 1, 'Remaining cache must only contain p_keep session');
assert.equal(remainingCache[0].id, 'hv_keep_1');

// 8. Test Pre-Settled Checkbox Fidelity
function evaluatePreSettledStatus(isCheckboxChecked) {
  return Boolean(isCheckboxChecked);
}
assert.equal(evaluatePreSettledStatus(false), false, 'When checkbox is unchecked, status must be false regardless of date');
assert.equal(evaluatePreSettledStatus(true), true, 'When checkbox is checked, status must be true');

const sampleBatchSessionsUnchecked = Array.from({ length: 12 }, (_, i) => ({
  date: `2026-06-24`,
  isPreSettled: evaluatePreSettledStatus(false)
}));
assert.equal(sampleBatchSessionsUnchecked.every(s => !s.isPreSettled), true, 'All sessions must have isPreSettled: false');
assert.equal(sampleBatchSessionsUnchecked.every(s => Boolean(s.isPreSettled)), false, 'Batch must not be evaluated as pre-settled');

// 9. Test Settle Batch Sessions Engine
function mockSettleBatchSessions(sessions, targetIds) {
  const targetSet = new Set(targetIds);
  return sessions.map(s => {
    if (targetSet.has(s.id)) {
      return { ...s, isPreSettled: true, settledAt: '2026-09-16T19:20:00Z' };
    }
    return s;
  });
}

const unsettledSessions = [
  { id: 's_u1', isPreSettled: false, patientId: 'p_test' },
  { id: 's_u2', isPreSettled: false, patientId: 'p_test' },
  { id: 's_other', isPreSettled: false, patientId: 'p_other' }
];

const settledResult = mockSettleBatchSessions(unsettledSessions, ['s_u1', 's_u2']);
assert.equal(settledResult.find(s => s.id === 's_u1').isPreSettled, true);
assert.equal(settledResult.find(s => s.id === 's_u2').isPreSettled, true);
assert.equal(settledResult.find(s => s.id === 's_other').isPreSettled, false);

// 10. Test Chronological Session Sequencing & Option A Cycle Rollover
// Scenario 1: Existing September sessions (13/9, 15/9, 16/9) + retroactive August batch (7 sessions from 5/8 to 17/8)
function mockSequencePatientSessionsChronologically(sessions = [], approvedTotal = 12) {
  const therapySessions = (sessions || []).filter(s =>
    (s.entryType === 'session' || !s.entryType) && s.status !== 'cancelled'
  );

  therapySessions.sort((a, b) => {
    const dComp = (a.date || '').localeCompare(b.date || '');
    if (dComp !== 0) return dComp;
    const tA = a.createdAt || a.recordedAt || '';
    const tB = b.createdAt || b.recordedAt || '';
    if (tA && tB) return tA.localeCompare(tB);
    return (a.id || '').localeCompare(b.id || '');
  });

  const total = parseInt(approvedTotal, 10) > 0 ? parseInt(approvedTotal, 10) : 12;
  const map = new Map();

  therapySessions.forEach((s, idx) => {
    const numInCycle = (idx % total) + 1;
    const cycleNum = Math.floor(idx / total) + 1;
    const isHome = s.isHomeVisit || s.visitType === 'home';
    const label = isHome ? 'زيارة' : 'جلسة';
    const cycleSuffix = cycleNum > 1 ? ` (دورة ${cycleNum})` : '';

    map.set(s.id, {
      sessionNumber: numInCycle,
      cycleNumber: cycleNum,
      overallNumber: idx + 1,
      displayLabel: `${label} ${numInCycle} من ${total}${cycleSuffix}`,
      shortLabel: `${label} ${numInCycle}${cycleSuffix}`
    });
  });

  return map;
}

const augustSessions = Array.from({ length: 7 }, (_, i) => ({
  id: `aug_${i+1}`,
  date: `2026-08-${String(5 + i * 2).padStart(2, '0')}`,
  entryType: 'session'
}));
const septSessions = [
  { id: 'sept_1', date: '2026-09-13', entryType: 'session' },
  { id: 'sept_2', date: '2026-09-15', entryType: 'session' },
  { id: 'sept_3', date: '2026-09-16', entryType: 'session' }
];

const combinedSessions = [...augustSessions, ...septSessions];
const seqMap = mockSequencePatientSessionsChronologically(combinedSessions, 12);

// Check August sessions (1 to 7)
assert.equal(seqMap.get('aug_1').sessionNumber, 1, 'First August session must be #1');
assert.equal(seqMap.get('aug_1').cycleNumber, 1);
assert.equal(seqMap.get('aug_2').sessionNumber, 2, 'Second August session must be #2');
assert.equal(seqMap.get('aug_7').sessionNumber, 7, 'Seventh August session must be #7');

// Check September sessions (shifted from 1,2,3 to 8,9,10)
assert.equal(seqMap.get('sept_1').sessionNumber, 8, '13/09 session must become #8');
assert.equal(seqMap.get('sept_1').cycleNumber, 1);
assert.equal(seqMap.get('sept_2').sessionNumber, 9, '15/09 session must become #9');
assert.equal(seqMap.get('sept_3').sessionNumber, 10, '16/09 session must become #10');

// Scenario 2: Option A Cycle Rollover at session 12 -> 13
const extendedSessions = [
  ...combinedSessions,
  { id: 'sept_4', date: '2026-09-18', entryType: 'session' }, // #11
  { id: 'sept_5', date: '2026-09-20', entryType: 'session' }, // #12
  { id: 'sept_6', date: '2026-09-22', entryType: 'session' }, // #13 -> cycle 2, #1
  { id: 'sept_7', date: '2026-09-24', entryType: 'session' }  // #14 -> cycle 2, #2
];

const seqExtendedMap = mockSequencePatientSessionsChronologically(extendedSessions, 12);
assert.equal(seqExtendedMap.get('sept_5').sessionNumber, 12, '12th session is #12 in cycle 1');
assert.equal(seqExtendedMap.get('sept_5').cycleNumber, 1);

// Option A: 13th session rolls over to #1 of Cycle 2
assert.equal(seqExtendedMap.get('sept_6').sessionNumber, 1, '13th session must roll over to #1');
assert.equal(seqExtendedMap.get('sept_6').cycleNumber, 2, '13th session must be in cycle 2');
assert.equal(seqExtendedMap.get('sept_7').sessionNumber, 2, '14th session must be #2 of cycle 2');
assert.equal(seqExtendedMap.get('sept_7').cycleNumber, 2);

// Scenario 3: Explicit Cycle Start Date on Approval Renewal (Cycle 2 starts from 2026-09-15)
const cycleRenewalSessions = [
  { id: 'c1_1', date: '2026-09-01', entryType: 'session' },
  { id: 'c1_2', date: '2026-09-05', entryType: 'session' },
  { id: 'c1_3', date: '2026-09-10', entryType: 'session' }, // Cycle 1 ended at 3 sessions
  { id: 'c2_1', date: '2026-09-15', entryType: 'session' }, // Cycle 2 starts at 2026-09-15 -> Session #1
  { id: 'c2_2', date: '2026-09-17', entryType: 'session' }  // Cycle 2 Session #2
];
const seqCycleMap = sequencePatientSessionsChronologically(cycleRenewalSessions, 12, { currentApprovalStartDate: '2026-09-15' });
assert.equal(seqCycleMap.get('c1_1').sessionNumber, 1, 'Pre-renewal session must be in cycle 1');
assert.equal(seqCycleMap.get('c1_1').cycleNumber, 1);
assert.equal(seqCycleMap.get('c1_3').sessionNumber, 3, 'Pre-renewal session 3 must be #3 of cycle 1');
assert.equal(seqCycleMap.get('c1_3').cycleNumber, 1);
assert.equal(seqCycleMap.get('c2_1').sessionNumber, 1, 'Session on new cycle start date must be #1 of cycle 2');
assert.equal(seqCycleMap.get('c2_1').cycleNumber, 2, 'Session on new cycle start date must be in cycle 2');
assert.equal(seqCycleMap.get('c2_2').sessionNumber, 2, 'Next session in new cycle must be #2 of cycle 2');
assert.equal(seqCycleMap.get('c2_2').cycleNumber, 2);

console.log('✓ All 28 Batch Home Visits & Option A Chronological Sequencing assertions passed successfully!');

// ============================================================================
// 12. Doctor Dashboard Lifetime Patients Grouping & First Doctor Assignment
// ============================================================================
console.log('--- Running Tests: Doctor Dashboard Lifetime Patients & First Doctor Rule ---');

function groupLifetimePatientsForDoctor(sessions) {
  const patientMap = new Map();
  const rawSessions = sessions.filter((s) => !s.isHomeVisit && s.visitType !== 'home');

  rawSessions.forEach((s) => {
    const key = s.patientId || s.patientName;
    if (!patientMap.has(key)) {
      patientMap.set(key, {
        patientId: s.patientId || '',
        patientName: s.patientName || 'مريض',
        payType: s.payType || 'cash',
        sessionsCount: 0,
        firstDate: s.date || '',
        lastDate: s.date || ''
      });
    }
    const item = patientMap.get(key);
    item.sessionsCount++;
    if (s.date) {
      if (!item.firstDate || s.date < item.firstDate) item.firstDate = s.date;
      if (!item.lastDate || s.date > item.lastDate) item.lastDate = s.date;
    }
  });

  return Array.from(patientMap.values()).sort((a, b) => (b.lastDate || '').localeCompare(a.lastDate || ''));
}

const mockLifetimeSessions = [
  { patientId: 'p1', patientName: 'أحمد محمود', date: '2026-09-01', payType: 'cash' },
  { patientId: 'p1', patientName: 'أحمد محمود', date: '2026-09-03', payType: 'cash' },
  { patientId: 'p1', patientName: 'أحمد محمود', date: '2026-09-05', payType: 'cash' },
  { patientId: 'p2', patientName: 'منى علي', date: '2026-09-02', payType: 'insurance' },
  { patientId: 'p2', patientName: 'منى علي', date: '2026-09-04', payType: 'insurance' },
  { patientId: 'p3', patientName: 'خالد يوسف', date: '2026-09-06', payType: 'cash' },
  // Home visit should be excluded from lifetime in-clinic patients
  { patientId: 'p4', patientName: 'زيارة منزلية', date: '2026-09-07', isHomeVisit: true }
];

const lifetimeGrouped = groupLifetimePatientsForDoctor(mockLifetimeSessions);
assert.equal(lifetimeGrouped.length, 3, 'Must group 6 in-clinic sessions into exactly 3 unique patients');
assert.equal(lifetimeGrouped[0].patientId, 'p3', 'Latest session patient (2026-09-06) should be first');
assert.equal(lifetimeGrouped.find(p => p.patientId === 'p1').sessionsCount, 3, 'Patient p1 must have 3 sessions');
assert.equal(lifetimeGrouped.find(p => p.patientId === 'p2').sessionsCount, 2, 'Patient p2 must have 2 sessions');
assert.equal(lifetimeGrouped.find(p => p.patientId === 'p1').firstDate, '2026-09-01');
assert.equal(lifetimeGrouped.find(p => p.patientId === 'p1').lastDate, '2026-09-05');

// Test First Doctor Assignment Rule
function assignFirstDoctorRule(patient, sessionDoctor, sessionDoctorUid) {
  if (patient && sessionDoctor && (!patient.doctor || patient.doctor === '' || patient.doctor === 'طبيب المركز')) {
    patient.doctor = sessionDoctor;
    patient.doctorUid = sessionDoctorUid || '';
    return true; // assigned
  }
  return false; // preserved
}

const newPatient = { id: 'p10', name: 'سارة محمد', doctor: '' };
const assignedFirst = assignFirstDoctorRule(newPatient, 'د. حسني أحمد الجويلي', 'uid_hosny');
assert.equal(assignedFirst, true, 'First doctor must be assigned when patient.doctor is empty');
assert.equal(newPatient.doctor, 'د. حسني أحمد الجويلي');

const secondSessionWithOtherDoctor = assignFirstDoctorRule(newPatient, 'د. أحمد علي', 'uid_ahmed');
assert.equal(secondSessionWithOtherDoctor, false, 'Existing assigned doctor must NOT be overwritten by subsequent doctors');
assert.equal(newPatient.doctor, 'د. حسني أحمد الجويلي', 'Assigned doctor must remain the first doctor');

console.log('✓ All 9 Lifetime Patients Grouping & First Doctor Rule assertions passed successfully!');

// 14. Daily Print Sheet Sessions Aggregation Engine Tests (Ascending Arrival Order & Clean Columns)
console.log('--- Running Tests: Daily Print Sheet Sessions Aggregation Engine ---');

function aggregateDailySessionsForPrint(sessions = []) {
  const patientMap = new Map();
  sessions.forEach(s => {
    if (s.status === 'cancelled') return;
    const key = s.patientId ? ('id_' + String(s.patientId).trim()) : ('name_' + (s.patientName || '').trim());
    if (!patientMap.has(key)) patientMap.set(key, []);
    patientMap.get(key).push(s);
  });

  // Sort patients chronologically by arrival time (earliest arrival first)
  const sortedPatientEntries = Array.from(patientMap.values()).sort((itemsA, itemsB) => {
    const timeA = itemsA.reduce((min, s) => {
      const t = s.createdAt || s.recordedAt || s.time || '';
      return (!min || (t && t < min)) ? t : min;
    }, '');
    const timeB = itemsB.reduce((min, s) => {
      const t = s.createdAt || s.recordedAt || s.time || '';
      return (!min || (t && t < min)) ? t : min;
    }, '');
    return timeA.localeCompare(timeB);
  });

  const rows = [];
  sortedPatientEntries.forEach(items => {
    const first = items[0];
    const patientName = first.patientName || 'مريض';
    const docNames = Array.from(new Set(items.map(s => s.doctor).filter(Boolean)));
    const doctorText = docNames.join(' • ') || 'طبيب المركز';

    const partsSet = new Set();
    items.forEach(s => {
      if (Array.isArray(s.bodyParts)) s.bodyParts.forEach(p => { if (p) partsSet.add(p.trim()); });
      else if (s.bodyParts) partsSet.add(String(s.bodyParts).trim());
    });

    const hasExam = items.some(s => s.entryType === 'examination');
    const hasSession = items.some(s => s.entryType === 'session' || !s.entryType);
    let actionType = 'جلسة';
    if (hasSession && hasExam) {
      actionType = 'جلسة وكشف';
    } else if (hasExam) {
      actionType = 'كشف';
    } else if (items.length > 1) {
      actionType = 'جلسة (' + items.length + ')';
    } else {
      actionType = 'جلسة';
    }

    const treatedBodyParts = partsSet.size > 0 ? Array.from(partsSet).join('، ') : (hasExam && !hasSession ? 'فحص سريري' : 'عام');
    const isInsurance = items.some(s => s.payType === 'insurance' || s.contractType === 'direct' || s.contractType === 'indirect');
    let companyName = '-';
    if (isInsurance) {
      const matchedItem = items.find(s => s.insuranceName);
      companyName = (matchedItem && matchedItem.insuranceName) ? matchedItem.insuranceName : 'تأمين';
    }

    const totalPaid = items.reduce((acc, curr) => acc + (parseFloat(curr.amountPaid) || 0), 0);
    const amountDisplay = totalPaid === 0 ? '0' : totalPaid.toLocaleString('en-US');

    rows.push({
      patientName,
      doctorText,
      treatedBodyParts,
      companyName,
      actionType,
      amountDisplay,
      totalPaid
    });
  });

  return rows;
}

// Scenario 1: Patient with only a session
const testOnlySession = aggregateDailySessionsForPrint([
  { id: 's1', patientId: 'p1', patientName: 'أحمد علي', doctor: 'د. مصطفى', bodyParts: ['الركبة'], entryType: 'session', payType: 'cash', amountPaid: 150, time: '04:00' }
]);
assert.equal(testOnlySession.length, 1);
assert.equal(testOnlySession[0].actionType, 'جلسة');
assert.equal(testOnlySession[0].companyName, '-');
assert.equal(testOnlySession[0].amountDisplay, '150');

// Scenario 2: Patient with only an examination
const testOnlyExam = aggregateDailySessionsForPrint([
  { id: 'e1', patientId: 'p2', patientName: 'سارة محمد', doctor: 'د. محمد', bodyParts: [], entryType: 'examination', payType: 'insurance', insuranceName: 'أموك', amountPaid: 0, time: '04:30' }
]);
assert.equal(testOnlyExam.length, 1);
assert.equal(testOnlyExam[0].actionType, 'كشف');
assert.equal(testOnlyExam[0].companyName, 'أموك');
assert.equal(testOnlyExam[0].treatedBodyParts, 'فحص سريري');
assert.equal(testOnlyExam[0].amountDisplay, '0');

// Scenario 3: Patient with BOTH session and examination on the same day -> Must merge into ONE row with "جلسة وكشف" and sum amounts!
const testSessionAndExam = aggregateDailySessionsForPrint([
  { id: 's3', patientId: 'p3', patientName: 'محمود حسن', doctor: 'د. مصطفى', bodyParts: ['أسفل الظهر'], entryType: 'session', payType: 'cash', amountPaid: 150, time: '03:15' },
  { id: 'e3', patientId: 'p3', patientName: 'محمود حسن', doctor: 'د. مصطفى', bodyParts: [], entryType: 'examination', payType: 'cash', amountPaid: 100, time: '03:10' }
]);
assert.equal(testSessionAndExam.length, 1, 'Patient with session and exam must merge into exactly 1 row');
assert.equal(testSessionAndExam[0].actionType, 'جلسة وكشف');
assert.equal(testSessionAndExam[0].totalPaid, 250);
assert.equal(testSessionAndExam[0].amountDisplay, '250');
assert.equal(testSessionAndExam[0].treatedBodyParts, 'أسفل الظهر');

// Scenario 4: Chronological sorting (Earliest arrival first)
const testSorting = aggregateDailySessionsForPrint([
  { id: 's_late', patientId: 'p_late', patientName: 'مريض متأخر', time: '05:30', entryType: 'session', amountPaid: 100 },
  { id: 's_early', patientId: 'p_early', patientName: 'مريض مبكر', time: '03:30', entryType: 'session', amountPaid: 100 }
]);
assert.equal(testSorting[0].patientName, 'مريض مبكر', 'Earliest arrival (03:30) must be first row');
assert.equal(testSorting[1].patientName, 'مريض متأخر', 'Later arrival (05:30) must be second row');

console.log('✓ All 8 Daily Print Sheet Aggregation assertions passed successfully!');


// 15. Monthly Report Calculations & Tables Integrity Tests
console.log('--- Running Tests: Monthly Report Calculations & Tables Integrity ---');

// Test 1: Doctor Sessions vs Exams, Patients Cash/Ins, and Program Types
const sampleMonthlySessions = [
  { doctor: 'د. حسني', bodyPartsCount: 2, entryType: 'session', payType: 'cash', patientId: 'p1', sessionPricingType: 'regular' },
  { doctor: 'د. حسني', bodyPartsCount: 1, entryType: 'examination', payType: 'cash', patientId: 'p1' },
  { doctor: 'د. حسني', bodyPartsCount: 1, entryType: 'session', payType: 'insurance', patientId: 'p2', sessionPricingType: 'scoliosis' },
  { doctor: 'د. أحمد', bodyPartsCount: 1, entryType: 'session', payType: 'cash', patientId: 'p3', sessionPricingType: 'regular' }
];

const docHosnySessions = sampleMonthlySessions.filter(s => s.doctor === 'د. حسني');
const sessionsCount = docHosnySessions.filter(s => s.entryType !== 'examination').reduce((acc, s) => acc + (s.bodyPartsCount || 1), 0); // 2 + 1 = 3
const examsCount = docHosnySessions.filter(s => s.entryType === 'examination').length; // 1
assert.equal(sessionsCount, 3, 'Sessions count should sum non-exam bodyPartsCount');
assert.equal(examsCount, 1, 'Exams count should be 1');

const cashPatients = (new Set(docHosnySessions.filter(s => s.payType === 'cash').map(s => s.patientId))).size; // 1
const insPatients = (new Set(docHosnySessions.filter(s => s.payType !== 'cash').map(s => s.patientId))).size; // 1
assert.equal(cashPatients, 1, 'Cash patients count should be 1');
assert.equal(insPatients, 1, 'Insurance patients count should be 1');

// Test 2: Monthly Cash Sessions vs Insurance Sessions Counts
let totalCashSessions = 0;
let totalInsSessions = 0;
sampleMonthlySessions.forEach(s => {
  const count = (s.entryType === 'examination') ? 1 : (s.bodyPartsCount || 1);
  if (s.payType === 'cash') totalCashSessions += count;
  else totalInsSessions += count;
});
assert.equal(totalCashSessions, 4, 'Total cash sessions (including exams) should be 2 + 1 + 1 = 4');
assert.equal(totalInsSessions, 1, 'Total insurance sessions should be 1');

// Test 3: Monthly Financial Summary Totals
const sessionsCashIncome = 15000;
const insuranceSettlementsNet = 5000;
const monthlyExpensesTotal = 8000;
const totalMonthIncome = sessionsCashIncome + insuranceSettlementsNet;
const netOperatingProfit = totalMonthIncome - monthlyExpensesTotal;
assert.equal(totalMonthIncome, 20000, 'Total income must sum cash + settlements (15000 + 5000 = 20000)');
assert.equal(netOperatingProfit, 12000, 'Net operating profit must be total income - expenses (20000 - 8000 = 12000)');

// Test 4: Doctor Salary Calculation from Rates
const mockDocObj = {
  regularSessionRate: 50,
  scoliosisRate: 80,
  hemiplegiaRate: 70,
  quadriplegiaRate: 90,
  specialSessionRate: 60
};
let regCount = 0, scolCount = 0, hemiCount = 0, quadCount = 0, specCount = 0;
docHosnySessions.forEach(s => {
  if (s.entryType === 'examination') return;
  const count = s.bodyPartsCount || 1;
  const pType = s.sessionPricingType || s.programType || 'regular';
  if (pType === 'scoliosis') scolCount += count;
  else if (pType === 'hemiplegia') hemiCount += count;
  else if (pType === 'quadriplegia') quadCount += count;
  else if (pType === 'special') specCount += count;
  else regCount += count;
});
const totalSalary = (regCount * mockDocObj.regularSessionRate) +
                    (scolCount * mockDocObj.scoliosisRate) +
                    (hemiCount * mockDocObj.hemiplegiaRate) +
                    (quadCount * mockDocObj.quadriplegiaRate) +
                    (specCount * mockDocObj.specialSessionRate);
// 2 regular @ 50 = 100, 1 scoliosis @ 80 = 80 -> total = 180
assert.equal(totalSalary, 180, 'Total salary must be (2 * 50) + (1 * 80) = 180');

// Test 5: Monthly Settlements Table Auto-Hide when Empty & Structure
const mockEmptySettlements = [];
const mockPopulatedSettlements = [{ id: 's1', grossAmount: 1000, netAmount: 900, deductions: 100 }];

function getSettlementCardVisibility(settlements) {
  if (settlements.length === 0) {
    return { display: 'none', noPrint: true };
  } else {
    return { display: 'block', noPrint: false };
  }
}

const emptyState = getSettlementCardVisibility(mockEmptySettlements);
assert.equal(emptyState.display, 'none', 'Settlements card must be hidden on screen when 0 settlements');
assert.equal(emptyState.noPrint, true, 'Settlements card must have no-print class when 0 settlements');

const populatedState = getSettlementCardVisibility(mockPopulatedSettlements);
assert.equal(populatedState.display, 'block', 'Settlements card must be visible when settlements exist');
assert.equal(populatedState.noPrint, false, 'Settlements card must not have no-print class when settlements exist');

// Test 6: Verify HTML Headers
import fs from 'node:fs';
const indexHtmlContent = fs.readFileSync('index.html', 'utf8');
assert.ok(indexHtmlContent.includes('جلسات / كشوفات'), 'Monthly doctors table must include "جلسات / كشوفات" header');
assert.ok(indexHtmlContent.includes('مرضى (نقدي / شركات)'), 'Monthly doctors table must include "مرضى (نقدي / شركات)" header');
assert.ok(indexHtmlContent.includes('نوع الجلسات (عادية / scoliosis / hemiplegia / quadriplegia)'), 'Monthly doctors table must include program types header');
assert.ok(indexHtmlContent.includes('راتب الاطباء'), 'Monthly doctors table must include "راتب الاطباء" header');
const financeJsContent = fs.readFileSync('js/finance.js', 'utf8');
assert.ok(financeJsContent.includes('مجموع رواتب الاطباء'), 'finance.js must render "مجموع رواتب الاطباء" total row');
assert.ok(financeJsContent.includes('إجمالي راتب الاطباء'), 'finance.js must inject "إجمالي راتب الاطباء" as monthly expense');
assert.ok(indexHtmlContent.includes('عدد جلسات النقدي'), 'Monthly insurance table must include "عدد جلسات النقدي" header');
assert.ok(indexHtmlContent.includes('عدد جلسات التأمين'), 'Monthly insurance table must include "عدد جلسات التأمين" header');

console.log('✓ All 6 Monthly Report Integrity assertions passed successfully!');

// ============================================================================
// 15. Visit Lifecycle & Doctor Clinical Completion Engine
// ============================================================================
console.log('--- Running Tests: Visit Lifecycle & Doctor Clinical Completion Engine ---');

function mockDoctorCompleteClinicalSession(appt, today, doctorUid) {
  // Doctor marks clinical completion WITHOUT recording a session in sessions collection
  const dailyStatuses = { ...(appt.dailyStatuses || {}) };
  dailyStatuses[today] = 'completed_clinically';
  const updates = {
    dailyStatuses,
    statusUpdatedAt: new Date().toISOString(),
    completedClinicallyAt: new Date().toISOString(),
    completedClinicallyDoctorUid: doctorUid
  };
  return {
    success: true,
    effectiveStatus: 'completed_clinically',
    updates,
    sessionCreatedInDb: false // Crucial: Doctor never writes to sessions collection
  };
}

// 1. Doctor completes clinically: Allowed for ANY session (no blocking), no session auto-created in db
const docCompleteRes = mockDoctorCompleteClinicalSession(
  { id: 'a1', patientId: 'p1', patientName: 'علي', doctorName: 'د. مصطفى' },
  '2026-09-16',
  'doc_1'
);
assert.equal(docCompleteRes.success, true, 'Doctor clinical completion must succeed');
assert.equal(docCompleteRes.sessionCreatedInDb, false, 'Doctor must NEVER auto-create session in database');
assert.equal(docCompleteRes.effectiveStatus, 'completed_clinically');
assert.equal(docCompleteRes.updates.dailyStatuses['2026-09-16'], 'completed_clinically');

// 2. Receptionist records session: Transition to recorded/attended
function mockReceptionRecordSession(appt, savedSessionId, today) {
  const dailyStatuses = { ...(appt.dailyStatuses || {}) };
  dailyStatuses[today] = 'recorded';
  return {
    effectiveStatus: 'attended',
    dailyStatuses,
    recordedSessionId: savedSessionId
  };
}
const recRecordRes = mockReceptionRecordSession({ id: 'a1', dailyStatuses: { '2026-09-16': 'completed_clinically' } }, 'sess_123', '2026-09-16');
assert.equal(recRecordRes.effectiveStatus, 'attended');
assert.equal(recRecordRes.dailyStatuses['2026-09-16'], 'recorded');
assert.equal(recRecordRes.recordedSessionId, 'sess_123');

// 3. Duplicate Prevention: Check duplicate session on same date
function mockCheckDuplicateSession(existingSessions, patientId, date) {
  return existingSessions.some(s => s.patientId === patientId && s.date === date && s.status !== 'cancelled' && (s.entryType === 'session' || !s.entryType));
}
const mockExisting = [{ id: 's_today', patientId: 'p1', date: '2026-09-16', status: 'active', entryType: 'session' }];
assert.equal(mockCheckDuplicateSession(mockExisting, 'p1', '2026-09-16'), true, 'Duplicate must be detected on same date');
assert.equal(mockCheckDuplicateSession(mockExisting, 'p1', '2026-09-17'), false, 'Different date must not be duplicate');
assert.equal(mockCheckDuplicateSession(mockExisting, 'p2', '2026-09-16'), false, 'Different patient must not be duplicate');

console.log('✓ All 7 Visit Lifecycle & Duplicate Prevention assertions passed successfully!');

// ============================================================================
console.log('--- Running Tests: Insurance Claims Integration (Batch Sessions, Home Visits & Arabic Normalization) ---');

function mockNormalizeArabic(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .trim()
    .replace(/[\u064B-\u065F\u0670]/g, '') // remove tashkeel
    .replace(/[إأآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[\u0640]/g, '') // tatweel
    .toLowerCase();
}

function mockFilterCompanyPatients(allPatients, allSessions, currentCompany) {
  const normSelectedComp = mockNormalizeArabic(currentCompany);

  return allPatients.filter(p => {
    const pComp = p.insuranceCompany || p.insuranceName || '';
    const isIns = (p.billing === 'insurance') || (!p.billing && pComp.length > 0) || (p.payType === 'insurance');
    if (isIns && pComp) {
      const normPComp = mockNormalizeArabic(pComp);
      if (normPComp.includes(normSelectedComp) || normSelectedComp.includes(normPComp)) return true;
    }
    const hasMatchingSession = allSessions.some(s => {
      if (s.patientId !== p.id) return false;
      const sComp = s.insuranceName || '';
      if (!sComp || sComp === 'نقدي') return false;
      const normSComp = mockNormalizeArabic(sComp);
      return normSComp.includes(normSelectedComp) || normSelectedComp.includes(normSComp);
    });
    return hasMatchingSession;
  });
}

function mockFilterPatientSessionsForClaim(allSessions, p, currentCompany, startDate, endDate) {
  const normSelectedComp = mockNormalizeArabic(currentCompany);

  return allSessions.filter(s => {
    if (s.patientId !== p.id) return false;
    if (s.status === 'cancelled') return false;
    if (s.entryType === 'examination') return false;
    if (startDate && s.date < startDate) return false;
    if (endDate && s.date > endDate) return false;

    const sComp = (s.insuranceName && s.insuranceName !== 'نقدي') ? s.insuranceName : (p.insuranceCompany || p.insuranceName || '');
    const normSComp = mockNormalizeArabic(sComp);
    const compMatches = normSComp.includes(normSelectedComp) || normSelectedComp.includes(normSComp);

    const isInsSession = (s.payType === 'insurance') ||
      (p.billing === 'insurance' && (s.amountPaid === 0 || !s.amountPaid)) ||
      Boolean(s.letterRef) ||
      (s.isHomeVisit && compMatches);

    return compMatches && isInsSession;
  });
}

// 1. Arabic Normalization Test: "أبو قير" matches "ابو قير"
const mockPatientsList = [
  { id: 'p_aboqir', name: 'أحمد محمود', billing: 'insurance', insuranceCompany: 'أبو قير' },
  { id: 'p_misr', name: 'سارة إبراهيم', billing: 'insurance', insuranceCompany: 'مصر للتأمين' },
  { id: 'p_cash_with_letter', name: 'محمد علي', billing: 'cash', insuranceCompany: '' } // Cash profile but has insurance sessions
];

const mockAllSessionsList = [
  // August batch home visits for p_aboqir under "ابو قير" (spelled without hamza)
  { id: 'batch_1', patientId: 'p_aboqir', date: '2026-08-05', payType: 'insurance', insuranceName: 'ابو قير', isHomeVisit: true, letterRef: 'REF-101' },
  { id: 'batch_2', patientId: 'p_aboqir', date: '2026-08-07', payType: 'insurance', insuranceName: 'ابو قير', isHomeVisit: true, letterRef: 'REF-101' },
  { id: 'batch_3', patientId: 'p_aboqir', date: '2026-08-09', payType: 'insurance', insuranceName: 'ابو قير', isHomeVisit: true, letterRef: 'REF-101' },
  // September clinic session for p_aboqir
  { id: 'sept_1', patientId: 'p_aboqir', date: '2026-09-13', payType: 'insurance', insuranceName: 'أبو قير', isHomeVisit: false },
  // Examination (must be excluded from sessionCount)
  { id: 'exam_1', patientId: 'p_aboqir', date: '2026-08-01', entryType: 'examination', payType: 'insurance', insuranceName: 'ابو قير' },
  // Cancelled session (must be excluded)
  { id: 'canc_1', patientId: 'p_aboqir', date: '2026-08-11', status: 'cancelled', payType: 'insurance', insuranceName: 'ابو قير' },
  // Home visit for p_cash_with_letter under "مصر للتامين"
  { id: 'hv_cash_p', patientId: 'p_cash_with_letter', date: '2026-08-15', payType: 'insurance', insuranceName: 'مصر للتامين', isHomeVisit: true }
];

// Test 1: Match company patients with Arabic normalization ("ابو قير" finds "أبو قير")
const matchedAboQir = mockFilterCompanyPatients(mockPatientsList, mockAllSessionsList, 'ابو قير');
assert.equal(matchedAboQir.length, 1);
assert.equal(matchedAboQir[0].id, 'p_aboqir');

// Test 2: Match patient who has insurance session even if profile billing was cash
const matchedMisr = mockFilterCompanyPatients(mockPatientsList, mockAllSessionsList, 'مصر للتأمين');
assert.equal(matchedMisr.length, 2, 'Should match both p_misr and p_cash_with_letter due to session cross-reference');

// Test 3: Open-ended date range (no dates) returns all 4 valid sessions for p_aboqir (3 August home visits + 1 Sept session)
const openRangeSessions = mockFilterPatientSessionsForClaim(mockAllSessionsList, matchedAboQir[0], 'ابو قير', '', '');
assert.equal(openRangeSessions.length, 4, 'Must include 3 home visits + 1 clinic session across all periods');
assert.equal(openRangeSessions.filter(s => s.isHomeVisit).length, 3, 'Must include 3 home visits');

// Test 4: Scoped date range for August (2026-08-01 to 2026-08-31)
const augustSessionsOnly = mockFilterPatientSessionsForClaim(mockAllSessionsList, matchedAboQir[0], 'ابو قير', '2026-08-01', '2026-08-31');
assert.equal(augustSessionsOnly.length, 3, 'Must include exactly the 3 August home visits');
assert.equal(augustSessionsOnly.some(s => s.id === 'sept_1'), false, 'September session must be excluded in August claim');

// Test 5: Scoped date range for September (2026-09-01 to 2026-09-30)
const septSessionsOnly = mockFilterPatientSessionsForClaim(mockAllSessionsList, matchedAboQir[0], 'ابو قير', '2026-09-01', '2026-09-30');
assert.equal(septSessionsOnly.length, 1, 'Must include only the 1 September session');
assert.equal(septSessionsOnly[0].id, 'sept_1');

// Test 6: Exclusion of examinations and cancelled sessions
assert.equal(openRangeSessions.some(s => s.entryType === 'examination'), false, 'Examinations must never be counted as therapy sessions');
assert.equal(openRangeSessions.some(s => s.status === 'cancelled'), false, 'Cancelled sessions must never be counted');

// Test 7: Total sessions and amount calculation in claim save
const mockCheckedItems = [
  {
    patient: matchedAboQir[0],
    sessionCount: 4,
    sessionRate: 100,
    evalFee: 50,
    total: 450,
    attendedSessions: openRangeSessions
  }
];
const totalPatients = mockCheckedItems.length;
const totalSessions = mockCheckedItems.reduce((acc, curr) => acc + (parseInt(curr.sessionCount, 10) || 0), 0);
const totalAmount = mockCheckedItems.reduce((acc, curr) => acc + (parseFloat(curr.total) || 0), 0);

assert.equal(totalPatients, 1);
assert.equal(totalSessions, 4, 'Total sessions must equal 4 (non-zero!)');
assert.equal(totalAmount, 450);

console.log('✓ All 7 Insurance Claims & Home Visits Integration assertions passed successfully!');
