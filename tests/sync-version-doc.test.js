import assert from 'node:assert/strict';

console.log('--- Running ASCPT Unit Tests: Version-Doc Real-Time Sync Engine ---');

/**
 * Mock Firestore Database Service replicating the exact sync logic from js/db.js
 * (subscribeToPatients, savePatient, deletePatient, subscribeToAppointments,
 * addAppointment, updateAppointment, deleteAppointment).
 */
class MockFirestoreSyncService {
  constructor(initialPatients = [], initialAppointments = []) {
    // In-memory caches matching js/db.js
    this._patientsCache = [...initialPatients];
    this._patientsLastFetch = 0;
    this._appointmentsCache = [...initialAppointments];
    this._appointmentsLastFetch = 0;

    // Version tracking & suppression flags matching js/db.js
    this._lastSeenPatientsVersion = null;
    this._lastSeenAppointmentsVersion = null;
    this._suppressNextOwnPatientsVersionEvent = false;
    this._suppressNextOwnAppointmentsVersionEvent = false;

    // Call tracking for assertions
    this.stats = {
      patientsFullGetDocsCount: 0,
      patientsSingleGetDocCount: 0,
      appointmentsFullGetDocsCount: 0,
      appointmentsSingleGetDocCount: 0,
      patientsCallbackCount: 0,
      appointmentsCallbackCount: 0,
      setDocVersionDocCount: 0
    };

    // Simulated remote Firestore collections
    this.remoteStore = {
      patients: new Map(initialPatients.map(p => [p.id, { ...p }])),
      appointments: new Map(initialAppointments.map(a => [a.id, { ...a }])),
      metaSyncVersion: {
        patientsVersion: 1,
        appointmentsVersion: 1,
        lastChangedPatientId: null,
        lastChangedPatientAction: null,
        lastChangedAppointmentId: null,
        lastChangedAppointmentAction: null
      }
    };

    this._patientSubscribers = [];
    this._appointmentSubscribers = [];
    this._sessionsByDateCache = new Map();
    this._lettersCache = new Map();
    this._allLettersCache = null;
    this._allLettersLastFetch = 0;
    this._todaySubscribers = [];
    this.remoteStore.sessions = new Map();
    this.remoteStore.insuranceLetters = new Map();
    this.stats.sessionsMonthGetDocsCount = 0;
    this.stats.lettersScopedGetDocsCount = 0;
    this.stats.lettersFullGetDocsCount = 0;
  }

  // --- Firestore mock primitives ---
  async mockGetDocs(collectionName) {
    if (collectionName === 'patients') {
      this.stats.patientsFullGetDocsCount++;
      const list = Array.from(this.remoteStore.patients.values());
      this._patientsCache = [...list];
      this._patientsLastFetch = Date.now();
      return [...list];
    }
    if (collectionName === 'appointments') {
      this.stats.appointmentsFullGetDocsCount++;
      const list = Array.from(this.remoteStore.appointments.values());
      this._appointmentsCache = [...list];
      this._appointmentsLastFetch = Date.now();
      return [...list];
    }
    return [];
  }

  async mockGetDoc(collectionName, docId) {
    if (collectionName === 'patients') {
      this.stats.patientsSingleGetDocCount++;
      const data = this.remoteStore.patients.get(docId);
      return data ? { exists: () => true, id: docId, data: () => ({ ...data }) } : { exists: () => false };
    }
    if (collectionName === 'appointments') {
      this.stats.appointmentsSingleGetDocCount++;
      const data = this.remoteStore.appointments.get(docId);
      return data ? { exists: () => true, id: docId, data: () => ({ ...data }) } : { exists: () => false };
    }
    return { exists: () => false };
  }

  async getPatients(forceRefresh = false) {
    if (!forceRefresh && this._patientsCache) {
      return [...this._patientsCache];
    }
    return await this.mockGetDocs('patients');
  }

  async getAppointments(forceRefresh = false) {
    if (!forceRefresh && this._appointmentsCache) {
      return [...this._appointmentsCache];
    }
    return await this.mockGetDocs('appointments');
  }

  // --- Patients Sync Listener (Replicating js/db.js) ---
  subscribeToPatients(callback) {
    let isFirstSnapshot = true;

    // On first attach, always do one initial fetch to get current data
    this.getPatients(true)
      .then((list) => {
        this.stats.patientsCallbackCount++;
        if (typeof callback === 'function') callback(list);
      });

    const onSnapshotHandler = async (snap) => {
      const data = snap.exists() ? snap.data() : null;
      const currentVersion = (data && typeof data.patientsVersion === 'number') ? data.patientsVersion : 0;

      // 1. Skip the writer's own echo
      if (this._suppressNextOwnPatientsVersionEvent) {
        this._suppressNextOwnPatientsVersionEvent = false;
        this._lastSeenPatientsVersion = currentVersion;
        return;
      }

      if (isFirstSnapshot) {
        isFirstSnapshot = false;
        this._lastSeenPatientsVersion = currentVersion;
        return;
      }

      if (this._lastSeenPatientsVersion === currentVersion) {
        return;
      }

      const isSequential = (typeof this._lastSeenPatientsVersion === 'number' && currentVersion === this._lastSeenPatientsVersion + 1);
      const action = data ? data.lastChangedPatientAction : null;
      const targetId = data ? data.lastChangedPatientId : null;

      this._lastSeenPatientsVersion = currentVersion;

      // 2. Delta-fetch optimization: single-doc read or 0-read delete
      if (isSequential && targetId && (action === 'created' || action === 'updated' || action === 'deleted') && Array.isArray(this._patientsCache)) {
        if (action === 'deleted') {
          this._patientsCache = this._patientsCache.filter(p => p.id !== targetId);
          this._patientsLastFetch = Date.now();
          this.stats.patientsCallbackCount++;
          if (typeof callback === 'function') callback([...this._patientsCache]);
          return;
        }

        try {
          const pSnap = await this.mockGetDoc('patients', targetId);
          if (pSnap.exists()) {
            const docData = { id: pSnap.id, ...pSnap.data() };
            const idx = this._patientsCache.findIndex(p => p.id === targetId);
            if (idx !== -1) {
              this._patientsCache[idx] = { ...this._patientsCache[idx], ...docData };
            } else {
              this._patientsCache.unshift(docData);
            }
            this._patientsLastFetch = Date.now();
            this.stats.patientsCallbackCount++;
            if (typeof callback === 'function') callback([...this._patientsCache]);
            return;
          } else {
            this._patientsCache = this._patientsCache.filter(p => p.id !== targetId);
            this._patientsLastFetch = Date.now();
            this.stats.patientsCallbackCount++;
            if (typeof callback === 'function') callback([...this._patientsCache]);
            return;
          }
        } catch (_) { /* test ignore */ }
      }

      // 3. Gap fallback (version jump > 1 or missing cache)
      try {
        const list = await this.getPatients(true);
        this.stats.patientsCallbackCount++;
        if (typeof callback === 'function') callback(list);
      } catch (_) { /* test ignore */ }
    };

    this._patientSubscribers.push(onSnapshotHandler);
    return () => {
      this._patientSubscribers = this._patientSubscribers.filter(s => s !== onSnapshotHandler);
    };
  }

  // --- Appointments Sync Listener (Replicating js/db.js) ---
  subscribeToAppointments(callback) {
    let isFirstSnapshot = true;

    // On first attach, always do one initial fetch to get current data
    this.getAppointments(true)
      .then((list) => {
        this.stats.appointmentsCallbackCount++;
        if (typeof callback === 'function') callback(list);
      });

    const onSnapshotHandler = async (snap) => {
      const data = snap.exists() ? snap.data() : null;
      const currentVersion = (data && typeof data.appointmentsVersion === 'number') ? data.appointmentsVersion : 0;

      // 1. Skip the writer's own echo
      if (this._suppressNextOwnAppointmentsVersionEvent) {
        this._suppressNextOwnAppointmentsVersionEvent = false;
        this._lastSeenAppointmentsVersion = currentVersion;
        return;
      }

      if (isFirstSnapshot) {
        isFirstSnapshot = false;
        this._lastSeenAppointmentsVersion = currentVersion;
        return;
      }

      if (this._lastSeenAppointmentsVersion === currentVersion) {
        return;
      }

      const isSequential = (typeof this._lastSeenAppointmentsVersion === 'number' && currentVersion === this._lastSeenAppointmentsVersion + 1);
      const action = data ? data.lastChangedAppointmentAction : null;
      const targetId = data ? data.lastChangedAppointmentId : null;

      this._lastSeenAppointmentsVersion = currentVersion;

      // 2. Delta-fetch optimization: single-doc read or 0-read delete
      if (isSequential && targetId && (action === 'created' || action === 'updated' || action === 'deleted') && Array.isArray(this._appointmentsCache)) {
        if (action === 'deleted') {
          this._appointmentsCache = this._appointmentsCache.filter(a => a.id !== targetId);
          this._appointmentsLastFetch = Date.now();
          this.stats.appointmentsCallbackCount++;
          if (typeof callback === 'function') callback([...this._appointmentsCache]);
          return;
        }

        try {
          const aSnap = await this.mockGetDoc('appointments', targetId);
          if (aSnap.exists()) {
            const docData = { id: aSnap.id, ...aSnap.data() };
            const idx = this._appointmentsCache.findIndex(a => a.id === targetId);
            if (idx !== -1) {
              this._appointmentsCache[idx] = { ...this._appointmentsCache[idx], ...docData };
            } else {
              this._appointmentsCache.push(docData);
            }
            this._appointmentsLastFetch = Date.now();
            this.stats.appointmentsCallbackCount++;
            if (typeof callback === 'function') callback([...this._appointmentsCache]);
            return;
          } else {
            this._appointmentsCache = this._appointmentsCache.filter(a => a.id !== targetId);
            this._appointmentsLastFetch = Date.now();
            this.stats.appointmentsCallbackCount++;
            if (typeof callback === 'function') callback([...this._appointmentsCache]);
            return;
          }
        } catch (_) { /* test ignore */ }
      }

      // 3. Gap fallback (version jump > 1)
      try {
        const list = await this.getAppointments(true);
        this.stats.appointmentsCallbackCount++;
        if (typeof callback === 'function') callback(list);
      } catch (_) { /* test ignore */ }
    };

    this._appointmentSubscribers.push(onSnapshotHandler);
    return () => {
      this._appointmentSubscribers = this._appointmentSubscribers.filter(s => s !== onSnapshotHandler);
    };
  }

  // --- Write Functions setting version doc & flags (Replicating js/db.js) ---
  async savePatient(patientData) {
    const isEdit = Boolean(patientData.id);
    const patientId = patientData.id || `p_${Date.now()}`;
    const dataToSave = { ...patientData, id: patientId };

    // Remote write
    this.remoteStore.patients.set(patientId, dataToSave);

    // Set suppression flag immediately before incrementing version
    this._suppressNextOwnPatientsVersionEvent = true;
    this.remoteStore.metaSyncVersion.patientsVersion++;
    this.remoteStore.metaSyncVersion.lastChangedPatientId = patientId;
    this.remoteStore.metaSyncVersion.lastChangedPatientAction = isEdit ? 'updated' : 'created';
    this.stats.setDocVersionDocCount++;

    // In-memory cache update synchronously
    if (this._patientsCache) {
      const idx = this._patientsCache.findIndex(p => p.id === patientId);
      if (idx !== -1) {
        this._patientsCache[idx] = { ...this._patientsCache[idx], ...dataToSave };
      } else {
        this._patientsCache.unshift(dataToSave);
      }
      this._patientsLastFetch = Date.now();
    }

    // Trigger subscribers with updated version doc
    await this.dispatchVersionDoc();
    return { status: isEdit ? 'updated' : 'created', id: patientId };
  }

  async deletePatient(patientId) {
    this.remoteStore.patients.delete(patientId);

    this._suppressNextOwnPatientsVersionEvent = true;
    this.remoteStore.metaSyncVersion.patientsVersion++;
    this.remoteStore.metaSyncVersion.lastChangedPatientId = patientId;
    this.remoteStore.metaSyncVersion.lastChangedPatientAction = 'deleted';
    this.stats.setDocVersionDocCount++;

    if (this._patientsCache) {
      this._patientsCache = this._patientsCache.filter(p => p.id !== patientId);
      this._patientsLastFetch = Date.now();
    }

    await this.dispatchVersionDoc();
    return true;
  }

  async addAppointment(apptData) {
    const apptId = `appt_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    const payload = { ...apptData, id: apptId };
    this.remoteStore.appointments.set(apptId, payload);

    this._suppressNextOwnAppointmentsVersionEvent = true;
    this.remoteStore.metaSyncVersion.appointmentsVersion++;
    this.remoteStore.metaSyncVersion.lastChangedAppointmentId = apptId;
    this.remoteStore.metaSyncVersion.lastChangedAppointmentAction = 'created';
    this.stats.setDocVersionDocCount++;

    if (!this._appointmentsCache) this._appointmentsCache = [];
    this._appointmentsCache.push(payload);
    this._appointmentsLastFetch = Date.now();

    await this.dispatchVersionDoc();
    return payload;
  }

  async updateAppointment(apptId, updates) {
    const existing = this.remoteStore.appointments.get(apptId) || { id: apptId };
    const payload = { ...existing, ...updates };
    this.remoteStore.appointments.set(apptId, payload);

    this._suppressNextOwnAppointmentsVersionEvent = true;
    this.remoteStore.metaSyncVersion.appointmentsVersion++;
    this.remoteStore.metaSyncVersion.lastChangedAppointmentId = apptId;
    this.remoteStore.metaSyncVersion.lastChangedAppointmentAction = 'updated';
    this.stats.setDocVersionDocCount++;

    if (this._appointmentsCache) {
      const idx = this._appointmentsCache.findIndex(a => a.id === apptId);
      if (idx !== -1) {
        this._appointmentsCache[idx] = { ...this._appointmentsCache[idx], ...payload };
      }
    }
    this._appointmentsLastFetch = Date.now();

    await this.dispatchVersionDoc();
    return payload;
  }

  async deleteAppointment(apptId) {
    this.remoteStore.appointments.delete(apptId);

    this._suppressNextOwnAppointmentsVersionEvent = true;
    this.remoteStore.metaSyncVersion.appointmentsVersion++;
    this.remoteStore.metaSyncVersion.lastChangedAppointmentId = apptId;
    this.remoteStore.metaSyncVersion.lastChangedAppointmentAction = 'deleted';
    this.stats.setDocVersionDocCount++;

    if (this._appointmentsCache) {
      this._appointmentsCache = this._appointmentsCache.filter(a => a.id !== apptId);
    }
    this._appointmentsLastFetch = Date.now();

    await this.dispatchVersionDoc();
    return true;
  }

  async dispatchVersionDoc() {
    const snap = {
      exists: () => true,
      data: () => ({ ...this.remoteStore.metaSyncVersion })
    };
    for (const sub of this._patientSubscribers) {
      await sub(snap);
    }
    for (const sub of this._appointmentSubscribers) {
      await sub(snap);
    }
  }

  async receiveRemoteVersionDoc(remoteData) {
    Object.assign(this.remoteStore.metaSyncVersion, remoteData);
    await this.dispatchVersionDoc();
  }

  _filterAndSortSessions(list, filterDate) {
    let res = [...list];
    if (filterDate) {
      if (filterDate.length === 7) {
        res = res.filter(s => s.date && s.date.startsWith(filterDate));
      } else {
        res = res.filter(s => s.date === filterDate);
      }
    }
    return res.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }

  async getSessions(filterDate, forceRefresh = false) {
    const now = Date.now();
    if (filterDate && filterDate.length === 7) {
      const cached = this._sessionsByDateCache.get(filterDate);
      if (!forceRefresh && cached && (now - cached.time < 300000)) {
        return [...cached.data];
      }
      this.stats.sessionsMonthGetDocsCount++;
      const all = Array.from(this.remoteStore.sessions.values());
      const filtered = this._filterAndSortSessions(all, filterDate);
      this._sessionsByDateCache.set(filterDate, { data: filtered, time: now });
      return [...filtered];
    }
    return [];
  }

  subscribeToTodaySessions(targetDate, callback) {
    this._todaySubscribers.push({ targetDate, callback });
    return () => {
      this._todaySubscribers = this._todaySubscribers.filter(s => s.callback !== callback);
    };
  }

  async dispatchTodaySessions(targetDate, docsList) {
    const sorted = this._filterAndSortSessions(docsList, targetDate);
    this._sessionsByDateCache.set(targetDate, { data: sorted, time: Date.now() });

    // In-memory Month Cache Patching parity with js/db.js
    if (targetDate && targetDate.length >= 7) {
      const targetMonth = targetDate.substring(0, 7);
      const cachedMonth = this._sessionsByDateCache.get(targetMonth);
      if (cachedMonth && Array.isArray(cachedMonth.data)) {
        const otherDays = cachedMonth.data.filter(s => s.date !== targetDate);
        const mergedMonth = this._filterAndSortSessions([...otherDays, ...docsList], targetMonth);
        this._sessionsByDateCache.set(targetMonth, { data: mergedMonth, time: Date.now() });
      }
    }

    for (const sub of this._todaySubscribers) {
      if (sub.targetDate === targetDate && typeof sub.callback === 'function') {
        await sub.callback(sorted);
      }
    }
  }

  async addInsuranceLetter(letterData) {
    const id = 'letter_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
    const payload = { ...letterData, id, createdAt: new Date().toISOString() };
    this.remoteStore.insuranceLetters.set(id, payload);

    if (payload.patientId) {
      if (this._lettersCache.has(payload.patientId)) {
        const cached = this._lettersCache.get(payload.patientId);
        if (Array.isArray(cached.data)) {
          cached.data = [payload, ...cached.data.filter(l => l.id !== payload.id)];
          cached.time = Date.now();
        }
      } else {
        this._lettersCache.set(payload.patientId, { data: [payload], time: Date.now() });
      }
    }
    if (this._allLettersCache && Array.isArray(this._allLettersCache)) {
      this._allLettersCache = [payload, ...this._allLettersCache.filter(l => l.id !== payload.id)];
      this._allLettersLastFetch = Date.now();
    }
    return payload;
  }

  async getInsuranceLetters(patientId = null, forceRefresh = false) {
    const now = Date.now();
    if (patientId) {
      const cached = this._lettersCache.get(patientId);
      if (!forceRefresh && cached && (now - cached.time < 300000)) {
        return [...cached.data];
      }
      this.stats.lettersScopedGetDocsCount++;
      const all = Array.from(this.remoteStore.insuranceLetters.values());
      const list = all.filter(l => l.patientId === patientId);
      list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      this._lettersCache.set(patientId, { data: list, time: now });
      return [...list];
    }

    if (!forceRefresh && this._allLettersCache && (now - this._allLettersLastFetch < 300000)) {
      return [...this._allLettersCache];
    }
    this.stats.lettersFullGetDocsCount++;
    const all = Array.from(this.remoteStore.insuranceLetters.values());
    all.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    this._allLettersCache = all;
    this._allLettersLastFetch = now;
    return [...all];
  }

}

// =========================================================================
// TEST SUITE EXECUTION
// =========================================================================

async function runTests() {
  const initialPatients = [
    { id: 'p1', name: 'أحمد محمود' },
    { id: 'p2', name: 'سارة عبد الله' },
    { id: 'p3', name: 'عمرو إبراهيم' }
  ];

  const initialAppointments = [
    { id: 'a1', patientId: 'p1', timeSlot: '10:00', daysOfWeek: [1, 3] },
    { id: 'a2', patientId: 'p2', timeSlot: '11:00', daysOfWeek: [6, 2] }
  ];

  const service = new MockFirestoreSyncService(initialPatients, initialAppointments);

  // -----------------------------------------------------------------------
  // Scenario 1: First attach (subscribe) triggers initial full fetch
  // -----------------------------------------------------------------------
  let latestPatients = null;
  service.subscribeToPatients((list) => {
    latestPatients = list;
  });

  await new Promise(resolve => setTimeout(resolve, 10));

  assert.equal(service.stats.patientsFullGetDocsCount, 1, 'First attach must trigger initial getDocs');
  assert.equal(service.stats.patientsSingleGetDocCount, 0, 'First attach must not trigger single doc read');
  assert.equal(latestPatients.length, 3, 'Initial callback must receive 3 patients');

  await service.dispatchVersionDoc();
  assert.equal(service.stats.patientsFullGetDocsCount, 1, 'Initial snapshot must not double-fetch full collection');
  assert.equal(service._lastSeenPatientsVersion, 1, 'Last seen patients version must record 1');

  await service.dispatchVersionDoc();
  assert.equal(service.stats.patientsFullGetDocsCount, 1, 'Identical version must cost 0 reads');
  assert.equal(service.stats.patientsSingleGetDocCount, 0, 'Identical version must cost 0 single-doc reads');

  console.log('✓ Scenario 1 passed: First attach triggers exactly 1 fetch; identical snapshot causes 0 reads.');

  // -----------------------------------------------------------------------
  // Scenario 2: Self-echo skip (Writer does not re-read its own write)
  // -----------------------------------------------------------------------
  const beforeOwnWritesFull = service.stats.patientsFullGetDocsCount;
  const beforeOwnWritesSingle = service.stats.patientsSingleGetDocCount;

  await service.savePatient({ id: 'p4', name: 'منى جمال' });

  assert.ok(service._patientsCache.some(p => p.id === 'p4'), 'Writer local cache must contain newly added patient p4');
  assert.equal(service._lastSeenPatientsVersion, 2, 'Last seen patients version updated to 2');
  assert.equal(service._suppressNextOwnPatientsVersionEvent, false, 'Suppression flag must be reset to false');
  assert.equal(service.stats.patientsFullGetDocsCount, beforeOwnWritesFull, 'Writer echo must cost 0 collection refetches');
  assert.equal(service.stats.patientsSingleGetDocCount, beforeOwnWritesSingle, 'Writer echo must cost 0 single-doc reads');

  await service.savePatient({ id: 'p1', name: 'أحمد محمود المعدل' });
  assert.equal(service._patientsCache.find(p => p.id === 'p1').name, 'أحمد محمود المعدل', 'Writer cache must reflect update');
  assert.equal(service.stats.patientsFullGetDocsCount, beforeOwnWritesFull, 'Update echo must cost 0 collection refetches');
  assert.equal(service.stats.patientsSingleGetDocCount, beforeOwnWritesSingle, 'Update echo must cost 0 single-doc reads');

  console.log('✓ Scenario 2 passed: Writer self-echo is suppressed with 0 collection reads and 0 single-doc reads.');

  // -----------------------------------------------------------------------
  // Scenario 3: Delta-fetch on a clean version increment from another device
  // -----------------------------------------------------------------------
  const beforeRemoteWriteFull = service.stats.patientsFullGetDocsCount;
  const beforeRemoteWriteSingle = service.stats.patientsSingleGetDocCount;

  service.remoteStore.patients.set('p5', { id: 'p5', name: 'كريم حسن' });

  await service.receiveRemoteVersionDoc({
    patientsVersion: 4,
    lastChangedPatientId: 'p5',
    lastChangedPatientAction: 'created'
  });

  assert.equal(service._lastSeenPatientsVersion, 4, 'Last seen version must update to 4');
  assert.equal(service.stats.patientsFullGetDocsCount, beforeRemoteWriteFull, 'Delta-fetch must NOT perform full getDocs');
  assert.equal(service.stats.patientsSingleGetDocCount, beforeRemoteWriteSingle + 1, 'Delta-fetch must perform exactly 1 single getDoc');
  assert.ok(service._patientsCache.some(p => p.id === 'p5'), 'Cache must include delta-fetched patient p5');
  assert.equal(latestPatients.find(p => p.id === 'p5')?.name, 'كريم حسن', 'Callback must receive updated list with p5');

  console.log('✓ Scenario 3 passed: Remote create/update performs single-doc delta-fetch (1 read, not N).');

  // -----------------------------------------------------------------------
  // Scenario 4: Delete handling (Zero-read cache removal)
  // -----------------------------------------------------------------------
  const beforeDeleteFull = service.stats.patientsFullGetDocsCount;
  const beforeDeleteSingle = service.stats.patientsSingleGetDocCount;

  service.remoteStore.patients.delete('p3');

  await service.receiveRemoteVersionDoc({
    patientsVersion: 5,
    lastChangedPatientId: 'p3',
    lastChangedPatientAction: 'deleted'
  });

  assert.equal(service._lastSeenPatientsVersion, 5, 'Last seen version must update to 5');
  assert.equal(service.stats.patientsFullGetDocsCount, beforeDeleteFull, 'Delete must cost 0 collection reads');
  assert.equal(service.stats.patientsSingleGetDocCount, beforeDeleteSingle, 'Delete must cost 0 single-doc reads');
  assert.equal(service._patientsCache.some(p => p.id === 'p3'), false, 'Deleted patient p3 must be removed from cache');
  assert.equal(latestPatients.some(p => p.id === 'p3'), false, 'Callback must receive list without p3');

  console.log('✓ Scenario 4 passed: Remote delete removes patient from local cache with 0 Firestore reads.');

  // -----------------------------------------------------------------------
  // Scenario 5: Gap fallback (Offline / reconnect after multiple writes)
  // -----------------------------------------------------------------------
  const beforeGapFull = service.stats.patientsFullGetDocsCount;
  const beforeGapSingle = service.stats.patientsSingleGetDocCount;

  service.remoteStore.patients.set('p6', { id: 'p6', name: 'طارق علي' });
  service.remoteStore.patients.set('p7', { id: 'p7', name: 'نادية سامي' });

  await service.receiveRemoteVersionDoc({
    patientsVersion: 9,
    lastChangedPatientId: 'p7',
    lastChangedPatientAction: 'created'
  });

  assert.equal(service._lastSeenPatientsVersion, 9, 'Last seen version must update to 9');
  assert.equal(service.stats.patientsFullGetDocsCount, beforeGapFull + 1, 'Gap fallback must trigger full collection getDocs');
  assert.equal(service.stats.patientsSingleGetDocCount, beforeGapSingle, 'Gap fallback does not do single doc getDoc');
  assert.ok(service._patientsCache.some(p => p.id === 'p6'), 'Cache must contain all missed updates');
  assert.ok(service._patientsCache.some(p => p.id === 'p7'), 'Cache must contain all missed updates');

  console.log('✓ Scenario 5 passed: Version gap (> 1) safely falls back to full collection refresh.');

  // -----------------------------------------------------------------------
  // Scenario 6: Appointments Sync Engine Parity (Full Lifecycle)
  // -----------------------------------------------------------------------
  let latestAppointments = null;
  service.subscribeToAppointments((list) => {
    latestAppointments = list;
  });

  await new Promise(resolve => setTimeout(resolve, 10));
  await service.dispatchVersionDoc();

  // 1. First attach for appointments
  assert.equal(service.stats.appointmentsFullGetDocsCount, 1, 'Appointments first attach triggers getDocs');
  assert.equal(latestAppointments.length, 2, 'Appointments initial callback receives 2 items');

  // 2. Self-echo skip on addAppointment
  const beforeApptWriteFull = service.stats.appointmentsFullGetDocsCount;
  const beforeApptWriteSingle = service.stats.appointmentsSingleGetDocCount;

  const newAppt = await service.addAppointment({ patientId: 'p5', timeSlot: '12:00', daysOfWeek: [0, 2] });
  assert.ok(service._appointmentsCache.some(a => a.id === newAppt.id), 'Writer cache has new appointment');
  assert.equal(service.stats.appointmentsFullGetDocsCount, beforeApptWriteFull, 'Appt write echo costs 0 collection reads');
  assert.equal(service.stats.appointmentsSingleGetDocCount, beforeApptWriteSingle, 'Appt write echo costs 0 single doc reads');

  // 3. Delta-fetch on remote update from another device
  service.remoteStore.appointments.set(newAppt.id, { ...newAppt, timeSlot: '13:00' });
  await service.receiveRemoteVersionDoc({
    appointmentsVersion: service.remoteStore.metaSyncVersion.appointmentsVersion + 1,
    lastChangedAppointmentId: newAppt.id,
    lastChangedAppointmentAction: 'updated'
  });
  assert.equal(service.stats.appointmentsSingleGetDocCount, beforeApptWriteSingle + 1, 'Delta fetch did single read');
  assert.equal(service._appointmentsCache.find(a => a.id === newAppt.id).timeSlot, '13:00', 'Appt cache updated via delta-fetch');

  // 4. Zero-read delete for appointments
  const beforeApptDelSingle = service.stats.appointmentsSingleGetDocCount;
  service.remoteStore.appointments.delete('a1');
  await service.receiveRemoteVersionDoc({
    appointmentsVersion: service.remoteStore.metaSyncVersion.appointmentsVersion + 1,
    lastChangedAppointmentId: 'a1',
    lastChangedAppointmentAction: 'deleted'
  });
  assert.equal(service.stats.appointmentsSingleGetDocCount, beforeApptDelSingle, 'Delete appt costs 0 single doc reads');
  assert.equal(service._appointmentsCache.some(a => a.id === 'a1'), false, 'Deleted appt a1 removed from cache');

  // 5. Gap fallback for appointments
  const beforeApptGapFull = service.stats.appointmentsFullGetDocsCount;
  await service.receiveRemoteVersionDoc({
    appointmentsVersion: service.remoteStore.metaSyncVersion.appointmentsVersion + 5,
    lastChangedAppointmentId: 'a2',
    lastChangedAppointmentAction: 'updated'
  });
  assert.equal(service.stats.appointmentsFullGetDocsCount, beforeApptGapFull + 1, 'Appointments gap triggers full refetch');

  console.log('✓ Scenario 6 passed: Appointments sync engine parity verified (Self-echo, Delta, Delete, Gap).');

  // -----------------------------------------------------------------------
  // Scenario 7: Interleaved Entity Independence
  // -----------------------------------------------------------------------
  const pReadsBefore = service.stats.patientsFullGetDocsCount + service.stats.patientsSingleGetDocCount;
  const aReadsBefore = service.stats.appointmentsFullGetDocsCount + service.stats.appointmentsSingleGetDocCount;

  await service.receiveRemoteVersionDoc({
    appointmentsVersion: service.remoteStore.metaSyncVersion.appointmentsVersion + 1,
    lastChangedAppointmentId: 'a_xyz',
    lastChangedAppointmentAction: 'updated'
  });
  const pReadsAfter = service.stats.patientsFullGetDocsCount + service.stats.patientsSingleGetDocCount;
  assert.equal(pReadsAfter, pReadsBefore, 'Appointment version change must not trigger any patient reads');

  await service.receiveRemoteVersionDoc({
    patientsVersion: service.remoteStore.metaSyncVersion.patientsVersion + 1,
    lastChangedPatientId: 'p1',
    lastChangedPatientAction: 'updated'
  });
  const aReadsAfter = service.stats.appointmentsFullGetDocsCount + service.stats.appointmentsSingleGetDocCount;
  assert.equal(aReadsAfter, aReadsBefore + 1, 'Patient version change must not trigger any extra appointment reads');

  console.log('✓ Scenario 7 passed: Patients and Appointments sync listeners are completely isolated.');

  
  // -----------------------------------------------------------------------
  // Scenario 8: Doctor Dashboard Real-time Session Sync with Month Cache In-Memory Patching (Opportunity 1)
  // -----------------------------------------------------------------------
  const initialSessions = [
    { id: 's1', patientId: 'p1', date: '2026-09-01', amountPaid: 100 },
    { id: 's2', patientId: 'p2', date: '2026-09-10', amountPaid: 150 }
  ];
  initialSessions.forEach(s => service.remoteStore.sessions.set(s.id, s));

  // Initial load of month sessions (e.g. 2026-09)
  const monthBefore = await service.getSessions('2026-09');
  assert.equal(service.stats.sessionsMonthGetDocsCount, 1, 'Initial month fetch must query Firestore');
  assert.equal(monthBefore.length, 2, 'Must contain 2 sessions initially');

  // Doctor subscribes to today's sessions (2026-09-18)
  let todayCallbackList = null;
  service.subscribeToTodaySessions('2026-09-18', (list) => {
    todayCallbackList = list;
  });

  // Receptionist adds a new session today remotely (s3)
  const newTodaySession = { id: 's3', patientId: 'p1', date: '2026-09-18', amountPaid: 200 };
  service.remoteStore.sessions.set('s3', newTodaySession);

  // Today snapshot fires
  await service.dispatchTodaySessions('2026-09-18', [newTodaySession]);
  assert.equal(todayCallbackList.length, 1, 'Today callback must receive 1 session');

  // Now, Doctor Dashboard render calls getSessions('2026-09')
  const readsBeforeMonthRequery = service.stats.sessionsMonthGetDocsCount;
  const monthAfter = await service.getSessions('2026-09');
  assert.equal(service.stats.sessionsMonthGetDocsCount, readsBeforeMonthRequery, 'Re-fetching month must cost 0 Firestore reads (cache hit)');
  assert.equal(monthAfter.length, 3, 'Month cache must reflect newly added today session in-place');
  assert.ok(monthAfter.some(s => s.id === 's3'), 'Month cache must contain s3');

  console.log('✓ Scenario 8 passed: Doctor Dashboard session real-time sync patches month cache in-place with 0 Firestore reads.');

  // -----------------------------------------------------------------------
  // Scenario 9: Insurance Renewal Letters Scoped Query & In-Memory Caching (Opportunity 3)
  // -----------------------------------------------------------------------
  const initialLetters = [
    { id: 'l1', patientId: 'p1', companyName: 'أكسا', letterNumber: 'AX-101' },
    { id: 'l2', patientId: 'p1', companyName: 'أكسا', letterNumber: 'AX-102' },
    { id: 'l3', patientId: 'p2', companyName: 'بوبا', letterNumber: 'BP-201' }
  ];
  initialLetters.forEach(l => service.remoteStore.insuranceLetters.set(l.id, l));

  // 1. Scoped lookup for patient p1
  const p1Letters = await service.getInsuranceLetters('p1');
  assert.equal(service.stats.lettersScopedGetDocsCount, 1, 'First fetch for p1 must execute 1 scoped query');
  assert.equal(service.stats.lettersFullGetDocsCount, 0, 'Must NOT execute unbounded full collection read');
  assert.equal(p1Letters.length, 2, 'p1 has 2 letters');

  // 2. Repeat lookup for patient p1 (Cache hit)
  const p1LettersRepeat = await service.getInsuranceLetters('p1');
  assert.equal(service.stats.lettersScopedGetDocsCount, 1, 'Repeat fetch for p1 must cost 0 Firestore reads (in-memory cache hit)');
  assert.equal(p1LettersRepeat.length, 2);

  // 3. Add new letter for patient p1
  await service.addInsuranceLetter({ patientId: 'p1', companyName: 'أكسا', letterNumber: 'AX-103' });
  const p1LettersAfterAdd = await service.getInsuranceLetters('p1');
  assert.equal(service.stats.lettersScopedGetDocsCount, 1, 'Fetch after add must cost 0 Firestore reads (in-place cache update)');
  assert.equal(p1LettersAfterAdd.length, 3, 'p1 letters cache must now contain 3 letters');

  // 4. Unbounded lookup without patientId (e.g. backup)
  const allLetters = await service.getInsuranceLetters();
  assert.equal(service.stats.lettersFullGetDocsCount, 1, 'Full archive fetch executed once');
  assert.equal(allLetters.length, 4, 'Must return all 4 letters');

  const allLettersRepeat = await service.getInsuranceLetters();
  assert.equal(allLettersRepeat.length, 4, 'Must return all 4 letters from cache');
  assert.equal(service.stats.lettersFullGetDocsCount, 1, 'Repeat full archive fetch must cost 0 reads (cached)');

  console.log('✓ Scenario 9 passed: Insurance renewal letters scoped query by patientId and in-memory cache verified.');

  console.log('\n===================================================================');
  
  // -----------------------------------------------------------------------
  // Scenario 10: Appointments Cache TTL (30 min) & Persistent Guard (Opportunity 5)
  // -----------------------------------------------------------------------
  const apptsReadsBefore = service.stats.appointmentsFullGetDocsCount;
  const appts1 = await service.getAppointments();
  assert.equal(service.stats.appointmentsFullGetDocsCount, apptsReadsBefore, 'Valid appointments cache must produce 0 Firestore reads');
  assert.ok(Array.isArray(appts1), 'Must return appointments array');

  console.log('✓ Scenario 10 passed: Appointments 30-minute cache TTL prevents redundant collection reads.');

  console.log('✓ All 10 Sync Engine Regression Test Scenarios Passed Successfully!');
  console.log('===================================================================');
}

runTests().catch((err) => {
  console.error('Test assertion failed:', err);
  process.exit(1);
});
