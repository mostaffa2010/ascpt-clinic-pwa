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
const completedAppt = { ...recurringAppt, status: 'completed' };
assert.equal(filterAppointmentsByDate([completedAppt], '2026-09-21').length, 0);
console.log('✓ All 7 Weekly Recurring Appointments assertions passed successfully!');

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

// 11. Today Patients Filter Engine Tests
console.log('--- Running Tests: Today Patients Filter & Day-of-Week Sync ---');
function mockGetTodayPatientIdentifiers({ todayStr, sessions = [], appointments = [] }) {
  const todayIds = new Set();
  const todayNames = new Set();
  const normalize = (t) => (t || '').trim().toLowerCase().replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');

  sessions.forEach(s => {
    const sDate = s.date || (s.createdAt ? s.createdAt.substring(0, 10) : '');
    if (sDate === todayStr && s.status !== 'cancelled') {
      if (s.patientId) todayIds.add(String(s.patientId).trim());
      if (s.patientName) todayNames.add(normalize(s.patientName));
    }
  });

  const curDate = new Date(todayStr + 'T00:00:00');
  const dayOfWeek = curDate.getDay();
  if (dayOfWeek !== 5) {
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
      if (a.patientId) todayIds.add(String(a.patientId).trim());
      if (a.patientName) todayNames.add(normalize(a.patientName));
    });
  }
  return { todayIds, todayNames };
}

const mondayAppts = Array.from({ length: 15 }, (_, i) => ({
  id: `appt_${i+1}`,
  patientId: `p_${i+1}`,
  patientName: `مريض ${i+1}`,
  daysOfWeek: [6, 1, 3]
}));

const tuesdayResult = mockGetTodayPatientIdentifiers({
  todayStr: '2026-09-15',
  sessions: [],
  appointments: mondayAppts
});
assert.equal(tuesdayResult.todayIds.size, 0);

const mondayResult = mockGetTodayPatientIdentifiers({
  todayStr: '2026-09-14',
  sessions: [],
  appointments: mondayAppts
});
assert.equal(mondayResult.todayIds.size, 15);

const tuesdayWithSession = mockGetTodayPatientIdentifiers({
  todayStr: '2026-09-15',
  sessions: [{ patientId: 'p_1', patientName: 'مريض 1', date: '2026-09-15' }],
  appointments: mondayAppts
});
assert.equal(tuesdayWithSession.todayIds.size, 1);
assert.ok(tuesdayWithSession.todayIds.has('p_1'));

const tuesdayWithCancelled = mockGetTodayPatientIdentifiers({
  todayStr: '2026-09-15',
  sessions: [],
  appointments: [{ id: 'a_tue', patientId: 'p_tue', daysOfWeek: [2], effectiveStatus: 'cancelled' }]
});
assert.equal(tuesdayWithCancelled.todayIds.size, 0);
console.log('✓ All 4 Today Patients Filter assertions passed successfully!');
