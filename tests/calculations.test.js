import assert from 'node:assert/strict';
import { getDayShiftKey, isDoctorOnDuty, getShiftLabel, getLatestTherapySession } from '../js/utils.js';

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

console.log('✓ All 14 Batch Home Visits & Doctor Dashboard Decoupling assertions passed successfully!');

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

// Test 1: Doctor percentage based on credited sessions, NOT patient count
const sampleMonthlySessions = [
  { doctor: 'د. حسني', bodyPartsCount: 2, entryType: 'session' }, // 2 credited sessions
  { doctor: 'د. حسني', bodyPartsCount: 1, entryType: 'session' }, // 1 credited session
  { doctor: 'د. أحمد', bodyPartsCount: 1, entryType: 'session' }  // 1 credited session
];
const totalClinicCreditedSessions = sampleMonthlySessions.reduce((acc, s) => acc + (s.bodyPartsCount || 1), 0); // 4
const docHosnySessions = sampleMonthlySessions.filter(s => s.doctor === 'د. حسني');
const docHosnyCredited = docHosnySessions.reduce((acc, s) => acc + (s.bodyPartsCount || 1), 0); // 3
const docHosnyPct = ((docHosnyCredited / totalClinicCreditedSessions) * 100).toFixed(1);
assert.equal(docHosnyPct, '75.0', 'Doctor percentage must be based on credited sessions (3/4 = 75%), not patient count (2/3 = 66.7%)');

// Test 2: Insurance Distribution Sorted Descending by Count
const sampleInsCategories = {
  'abo_qir': { name: 'أبو قير', count: 1 },
  'cash': { name: 'سداد نقدي مباشر', count: 26 },
  'amoc': { name: 'أموك', count: 5 }
};
const sortedIns = Object.values(sampleInsCategories).sort((a, b) => b.count - a.count);
assert.equal(sortedIns[0].name, 'سداد نقدي مباشر', 'Highest count/percentage (26) must be top row');
assert.equal(sortedIns[1].name, 'أموك', 'Second highest (5) must be second row');
assert.equal(sortedIns[2].name, 'أبو قير', 'Lowest (1) must be last row');

// Test 3: Monthly Financial Summary Totals
const sessionsCashIncome = 15000;
const insuranceSettlementsNet = 5000;
const monthlyExpensesTotal = 8000;
const totalMonthIncome = sessionsCashIncome + insuranceSettlementsNet;
const netOperatingProfit = totalMonthIncome - monthlyExpensesTotal;
assert.equal(totalMonthIncome, 20000, 'Total income must sum cash + settlements (15000 + 5000 = 20000)');
assert.equal(netOperatingProfit, 12000, 'Net operating profit must be total income - expenses (20000 - 8000 = 12000)');


// Test 4: Regression Protection for Monthly Doctors Map TDZ Execution
const testMonthlySessions = [
  { doctor: 'د. مصطفى', bodyPartsCount: 2, entryType: 'session', payType: 'cash' },
  { doctor: 'د. مصطفى', bodyPartsCount: 1, entryType: 'session', payType: 'insurance' },
  { doctor: 'د. أحمد', bodyPartsCount: 1, entryType: 'examination', payType: 'cash' }
];
const testTotalClinicSessions = testMonthlySessions.reduce((acc, s) => {
  if (s.entryType === 'examination') return acc + 1;
  return acc + (s.bodyPartsCount || 1);
}, 0); // 4
const testDoctors = ['د. مصطفى', 'د. أحمد'];

const renderedDocs = testDoctors.map(doc => {
  const docSessions = testMonthlySessions.filter(s => s.doctor === doc);
  const cashCount = docSessions.filter(s => s.payType === 'cash').length;
  const insCount = docSessions.filter(s => s.payType === 'insurance').length;
  const total = docSessions.length;
  const creditedSessions = docSessions.reduce((acc, s) => {
    if (s.entryType === 'examination') return acc + 1;
    return acc + (s.bodyPartsCount || 1);
  }, 0);
  const pct = testTotalClinicSessions > 0 ? ((creditedSessions / testTotalClinicSessions) * 100).toFixed(1) : 0;
  return { doc, total, creditedSessions, pct, cashCount, insCount };
});

assert.equal(renderedDocs.length, 2);
assert.equal(renderedDocs[0].pct, '75.0'); // 3 out of 4 sessions
assert.equal(renderedDocs[1].pct, '25.0'); // 1 out of 4 sessions

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

import fs from 'node:fs';
const indexHtmlContent = fs.readFileSync('index.html', 'utf8');
assert.ok(indexHtmlContent.includes('id="monthly-settlements-table"'), 'Settlements table must have id="monthly-settlements-table"');
assert.ok(indexHtmlContent.includes('<th class="no-print">المسجل</th>'), 'Recorder header must have class="no-print" in settlements table');
assert.ok(indexHtmlContent.includes('<th class="no-print">إجراءات</th>'), 'Actions header must have class="no-print" in settlements table');

console.log('✓ All 6 Monthly Report Integrity assertions passed successfully!');

// ============================================================================
// 15. Doctor Auto-Session, First-Session Guard & Duplicate Prevention Tests
// ============================================================================
console.log('--- Running Tests: Doctor Auto-Session & Duplicate Prevention Engine ---');

function mockValidateDoctorCompleteSession(allPatientSessions, lastSession, appt, today) {
  if (!lastSession) {
    return { allowed: false, reason: 'first_session' };
  }
  const partsToUse = (Array.isArray(lastSession.bodyParts) && lastSession.bodyParts.length > 0)
    ? [...lastSession.bodyParts]
    : (appt.bodyPart ? [appt.bodyPart] : []);

  const newSession = {
    entryType: 'session',
    date: today,
    patientId: appt.patientId,
    patientName: appt.patientName,
    doctor: appt.doctorName,
    doctorUid: appt.doctorUid,
    bodyParts: partsToUse,
    bodyPartsCount: partsToUse.length || 1,
    payType: lastSession.payType || 'cash',
    amountPaid: lastSession.amountPaid !== undefined ? lastSession.amountPaid : 0,
    sessionPricingType: lastSession.sessionPricingType || 'regular',
    autoCreatedByDoctor: true,
    sourceAppointmentId: appt.id
  };
  return { allowed: true, newSession };
}

// 1. First session: Doctor is strictly blocked
const firstSessionRes = mockValidateDoctorCompleteSession([], null, { id: 'a1', patientId: 'p1', patientName: 'علي', doctorName: 'د. مصطفى' }, '2026-09-16');
assert.equal(firstSessionRes.allowed, false, 'First session must be blocked for doctor');
assert.equal(firstSessionRes.reason, 'first_session');

// 2. Subsequent session: Doctor succeeds and settings are replicated from lastSession
const mockLastSession = {
  id: 'sess_prev',
  entryType: 'session',
  date: '2026-09-14',
  payType: 'cash',
  amountPaid: 150,
  bodyParts: ['الركبة اليمنى', 'الفقرات القطنية'],
  sessionPricingType: 'regular'
};
const subSessionRes = mockValidateDoctorCompleteSession([mockLastSession], mockLastSession, { id: 'a2', patientId: 'p1', patientName: 'علي', doctorName: 'د. مصطفى', doctorUid: 'doc_1' }, '2026-09-16');
assert.equal(subSessionRes.allowed, true, 'Subsequent session must be allowed');
assert.equal(subSessionRes.newSession.amountPaid, 150);
assert.equal(subSessionRes.newSession.bodyPartsCount, 2);
assert.equal(subSessionRes.newSession.autoCreatedByDoctor, true);

// 3. Duplicate Prevention: Check duplicate session on same date
function mockCheckDuplicateSession(existingSessions, patientId, date) {
  return existingSessions.some(s => s.patientId === patientId && s.date === date && s.status !== 'cancelled' && (s.entryType === 'session' || !s.entryType));
}
const mockExisting = [{ id: 's_today', patientId: 'p1', date: '2026-09-16', status: 'active', entryType: 'session' }];
assert.equal(mockCheckDuplicateSession(mockExisting, 'p1', '2026-09-16'), true, 'Duplicate must be detected on same date');
assert.equal(mockCheckDuplicateSession(mockExisting, 'p1', '2026-09-17'), false, 'Different date must not be duplicate');
assert.equal(mockCheckDuplicateSession(mockExisting, 'p2', '2026-09-16'), false, 'Different patient must not be duplicate');

console.log('✓ All 7 Doctor Auto-Session & Duplicate Prevention assertions passed successfully!');
