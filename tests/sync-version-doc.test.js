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

  // --- Patients Sync Listener (Replicating js/db.js lines 332-415) ---
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

  // --- Appointments Sync Listener (Replicating js/db.js lines 1640-1725) ---
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

  // Simulate receiving a remote write from another device
  async receiveRemoteVersionDoc(remoteData) {
    Object.assign(this.remoteStore.metaSyncVersion, remoteData);
    await this.dispatchVersionDoc();
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

  // Allow promise to resolve
  await new Promise(resolve => setTimeout(resolve, 10));

  assert.equal(service.stats.patientsFullGetDocsCount, 1, 'First attach must trigger initial getDocs');
  assert.equal(service.stats.patientsSingleGetDocCount, 0, 'First attach must not trigger single doc read');
  assert.equal(latestPatients.length, 3, 'Initial callback must receive 3 patients');

  // Initial snapshot arrives matching current version -> records version, does not double-fetch
  await service.dispatchVersionDoc();
  assert.equal(service.stats.patientsFullGetDocsCount, 1, 'Initial snapshot must not double-fetch full collection');
  assert.equal(service._lastSeenPatientsVersion, 1, 'Last seen patients version must record 1');

  // Redundant snapshot with identical version (reconnect / metadata update) -> 0 reads
  await service.dispatchVersionDoc();
  assert.equal(service.stats.patientsFullGetDocsCount, 1, 'Identical version must cost 0 reads');
  assert.equal(service.stats.patientsSingleGetDocCount, 0, 'Identical version must cost 0 single-doc reads');

  console.log('✓ Scenario 1 passed: First attach triggers exactly 1 fetch; identical snapshot causes 0 reads.');

  // -----------------------------------------------------------------------
  // Scenario 2: Self-echo skip (Writer does not re-read its own write)
  // -----------------------------------------------------------------------
  const beforeOwnWritesFull = service.stats.patientsFullGetDocsCount;
  const beforeOwnWritesSingle = service.stats.patientsSingleGetDocCount;

  // Device saves a patient (creates p4)
  await service.savePatient({ id: 'p4', name: 'منى جمال' });

  // Assert writer's local cache was updated synchronously
  assert.ok(service._patientsCache.some(p => p.id === 'p4'), 'Writer local cache must contain newly added patient p4');
  assert.equal(service._lastSeenPatientsVersion, 2, 'Last seen patients version updated to 2');
  assert.equal(service._suppressNextOwnPatientsVersionEvent, false, 'Suppression flag must be reset to false');
  assert.equal(service.stats.patientsFullGetDocsCount, beforeOwnWritesFull, 'Writer echo must cost 0 collection refetches');
  assert.equal(service.stats.patientsSingleGetDocCount, beforeOwnWritesSingle, 'Writer echo must cost 0 single-doc reads');

  // Device updates patient p1
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

  // Another device writes patient p5 to Firestore (remote version becomes 4)
  service.remoteStore.patients.set('p5', { id: 'p5', name: 'كريم حسن' });

  // Device receives version-doc from device B: version jump = +1, action = 'created'
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

  // Another device deletes p3 (remote version becomes 5)
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

  // While this device was offline, 4 changes occurred (version jumped from 5 to 9)
  service.remoteStore.patients.set('p6', { id: 'p6', name: 'طارق علي' });
  service.remoteStore.patients.set('p7', { id: 'p7', name: 'نادية سامي' });

  await service.receiveRemoteVersionDoc({
    patientsVersion: 9, // Jump of 4 > 1 -> Gap detected!
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
  // Initial snapshot arrives from Firestore on attach
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
    appointmentsVersion: service.remoteStore.metaSyncVersion.appointmentsVersion + 5, // Gap of 5
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

  // Mutating appointmentsVersion only must NOT cause any reads on patients
  await service.receiveRemoteVersionDoc({
    appointmentsVersion: service.remoteStore.metaSyncVersion.appointmentsVersion + 1,
    lastChangedAppointmentId: 'a_xyz',
    lastChangedAppointmentAction: 'updated'
  });
  const pReadsAfter = service.stats.patientsFullGetDocsCount + service.stats.patientsSingleGetDocCount;
  assert.equal(pReadsAfter, pReadsBefore, 'Appointment version change must not trigger any patient reads');

  // Mutating patientsVersion only must NOT cause any reads on appointments
  await service.receiveRemoteVersionDoc({
    patientsVersion: service.remoteStore.metaSyncVersion.patientsVersion + 1,
    lastChangedPatientId: 'p1',
    lastChangedPatientAction: 'updated'
  });
  const aReadsAfter = service.stats.appointmentsFullGetDocsCount + service.stats.appointmentsSingleGetDocCount;
  assert.equal(aReadsAfter, aReadsBefore + 1, 'Patient version change must not trigger any extra appointment reads');

  console.log('✓ Scenario 7 passed: Patients and Appointments sync listeners are completely isolated.');

  console.log('\n===================================================================');
  console.log('✓ All 7 Sync Engine Regression Test Scenarios Passed Successfully!');
  console.log('===================================================================');
}

runTests().catch((err) => {
  console.error('Test assertion failed:', err);
  process.exit(1);
});
