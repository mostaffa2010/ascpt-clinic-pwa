// ========================================================
// ASCPT - Authoritative Cloud Firestore Data Access Layer
// Single Source of Truth: Firestore + Built-in IndexedDB Persistence
// No Parallel LocalStorage Fallback for Authoritative Clinical Records
// ========================================================

import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  limit,
  where,
  writeBatch,
  increment
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

import { firestoreDb, isConfigured } from './firebase-init.js';
import { CLINIC_CONFIG } from './clinic-config.js';

function getLocalTodayDateStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}


// ========================================================
// Lightweight Asynchronous IndexedDB Cache Engine
// Zero-dependency, Non-blocking, Unlimited Storage (> 1GB)
// With Graceful Fallback to Web Storage / Memory
// ========================================================
class AsyncIdbCache {
  constructor(dbName = 'ascpt_local_store', storeName = 'cache_entries') {
    this.dbName = dbName;
    this.storeName = storeName;
    this._dbPromise = null;
  }

  _getDb() {
    if (this._dbPromise) return this._dbPromise;
    if (typeof window === 'undefined' || !window.indexedDB) {
      return Promise.resolve(null);
    }
    this._dbPromise = new Promise((resolve) => {
      try {
        const req = window.indexedDB.open(this.dbName, 1);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(this.storeName)) {
            db.createObjectStore(this.storeName);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch (_) {
        resolve(null);
      }
    });
    return this._dbPromise;
  }

  async get(key) {
    try {
      const db = await this._getDb();
      if (!db) return this._fallbackGet(key);
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(this.storeName, 'readonly');
          const store = tx.objectStore(this.storeName);
          const req = store.get(key);
          req.onsuccess = () => {
            if (req.result !== undefined && req.result !== null) {
              resolve(req.result);
            } else {
              resolve(this._fallbackGet(key));
            }
          };
          req.onerror = () => resolve(this._fallbackGet(key));
        } catch (_) {
          resolve(this._fallbackGet(key));
        }
      });
    } catch (_) {
      return this._fallbackGet(key);
    }
  }

  async set(key, value) {
    try {
      const db = await this._getDb();
      if (!db) {
        this._fallbackSet(key, value);
        return;
      }
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(this.storeName, 'readwrite');
          const store = tx.objectStore(this.storeName);
          store.put(value, key);
          tx.oncomplete = () => {
            this._fallbackSet(key, value);
            resolve();
          };
          tx.onerror = () => {
            this._fallbackSet(key, value);
            resolve();
          };
        } catch (_) {
          this._fallbackSet(key, value);
          resolve();
        }
      });
    } catch (_) {
      this._fallbackSet(key, value);
    }
  }

  async remove(key) {
    try {
      const db = await this._getDb();
      if (db) {
        const tx = db.transaction(this.storeName, 'readwrite');
        tx.objectStore(this.storeName).delete(key);
      }
    } catch (_) {}
    this._fallbackRemove(key);
  }

  _fallbackGet(key) {
    try {
      const s = sessionStorage.getItem(key);
      if (s) return JSON.parse(s);
    } catch (_) {}
    try {
      const l = localStorage.getItem(key);
      if (l) return JSON.parse(l);
    } catch (_) {}
    return null;
  }

  _fallbackSet(key, value) {
    try {
      const str = typeof value === 'string' ? value : JSON.stringify(value);
      sessionStorage.setItem(key, str);
    } catch (_) {}
  }

  _fallbackRemove(key) {
    try { sessionStorage.removeItem(key); } catch (_) {}
    try { localStorage.removeItem(key); } catch (_) {}
  }
}

const idbCache = new AsyncIdbCache();

class FirestoreDatabaseService {
  constructor() {
    this.purgeLegacyDemoStorage();
    this.clinicalOptionsCache = null;
    this.insuranceCompaniesCache = null;
    this._optionsLoaded = false;

    // High-performance Zero-Cost in-memory data store (prevents redundant Firestore billing)
    this._patientsCache = null;
    this._patientsLastFetch = 0;
    this._sessionsCache = null;
    this._sessionsLastFetch = 0;
    this._expensesCache = null;
    this._expensesLastFetch = 0;
    this._usersCache = null;
    this._usersLastFetch = 0;
    this._appointmentsCache = null;
    this._appointmentsLastFetch = 0;
    this._auditCache = null;
    this._auditLastFetch = 0;
    this._shiftOverridesCache = null;
    this._shiftOverridesLastFetch = 0;
    this._claimsCache = null;
    this._claimsLastFetch = 0;
    this._settlementsCache = null;
    this._settlementsLastFetch = 0;
    this._lettersCache = new Map();

    // Version-Doc Tracking for Zero-Cost Real-Time Sync
    this._lastSeenPatientsVersion = null;
    this._lastSeenAppointmentsVersion = null;
    this._suppressNextOwnPatientsVersionEvent = false;
    this._suppressNextOwnAppointmentsVersionEvent = false;

    // Advanced Scoped Caches for Zero-Cost Reads
    this._sessionsByDateCache = new Map();
    this._sessionsByPatientCache = new Map();
    this._expensesByDateCache = new Map();
    this._sessionDocCache = new Map();

    // Cache TTL in ms
    this.CACHE_TTL = 300000; // 5 minutes operational cache
    this.PATIENTS_CACHE_TTL = 900000; // 15 minutes patients cache
    this.USERS_CACHE_TTL = 3600000; // 1 hour users/doctors cache
    this.APPT_CACHE_TTL = 1800000; // 30 minutes appointments cache

    this.syncAndSeedCloudOptions();
  }

  invalidateAllCaches() {
    this._patientsCache = null;
    this._patientsLastFetch = 0;
    this._sessionsCache = null;
    this._sessionsLastFetch = 0;
    this._expensesCache = null;
    this._expensesLastFetch = 0;
    this._usersCache = null;
    this._usersLastFetch = 0;
    this._appointmentsCache = null;
    this._appointmentsLastFetch = 0;
    this._auditCache = null;
    this._auditLastFetch = 0;
    this._shiftOverridesCache = null;
    this._shiftOverridesLastFetch = 0;
    this._claimsCache = null;
    this._claimsLastFetch = 0;
    this._settlementsCache = null;
    this._settlementsLastFetch = 0;
    this._lettersCache.clear();
    this._lastSeenPatientsVersion = null;
    this._lastSeenAppointmentsVersion = null;
    this._sessionsByDateCache.clear();
    this._sessionsByPatientCache.clear();
    this._expensesByDateCache.clear();
    this._sessionDocCache.clear();
    try {
      idbCache.remove('ascpt_cached_users');
      idbCache.remove('ascpt_cached_patients');
      idbCache.remove('ascpt_patients_last_sync');
      idbCache.remove('ascpt_cached_appointments');
      localStorage.removeItem('ascpt_cached_users');
      sessionStorage.removeItem('ascpt_cached_patients');
      sessionStorage.removeItem('ascpt_patients_last_sync');
      localStorage.removeItem('ascpt_cached_appointments');
    } catch (_) {}
    console.log('ASCPT: All in-memory database caches invalidated.');
  }

  get isCloud() {
    return isConfigured && Boolean(firestoreDb);
  }

  purgeLegacyDemoStorage() {
    const legacyKeys = [
      'pc_demo_v3_september_full',
      'pc_demo_patients',
      'pc_demo_sessions',
      'pc_demo_expenses',
      'pc_demo_users',
      'pc_demo_audit',
      'pc_demo_active_user',
      'pc_demo_onboarding_seen',
      'pc_sb_patients',
      'pc_sb_sessions',
      'pc_claim_treatments',
      'ascpt_patients',
      'ascpt_sessions',
      'ascpt_expenses',
      'ascpt_users',
      'ascpt_audit'
    ];
    legacyKeys.forEach(k => {
      try { localStorage.removeItem(k); } catch (_) {}
    });
  }

  ensureConnected() {
    if (!this.isCloud) {
      throw new Error('قاعدة البيانات السحابية غير متصلة.');
    }
  }

  // ================= 1. Patients Management =================
  async getPatients(forceRefresh = false) {
    this.ensureConnected();
    const now = Date.now();

    // 1. Fast in-memory cache hit (Zero Firestore reads)
    if (!forceRefresh && this._patientsCache && (now - this._patientsLastFetch < this.PATIENTS_CACHE_TTL)) {
      return [...this._patientsCache];
    }

    // 2. Try IndexedDB persistent cache (Zero Firestore reads)
    let cachedList = null;
    try {
      cachedList = await idbCache.get('ascpt_cached_patients');
    } catch (_) {}

    if (!forceRefresh && Array.isArray(cachedList) && cachedList.length > 0) {
      this._patientsCache = cachedList;
      this._patientsLastFetch = now;
      return [...cachedList];
    }

    // 3. Fetch from Firestore if cache is empty or forceRefresh explicitly requested
    try {
      const snap = await getDocs(collection(firestoreDb, 'patients'));
      const list = snap.docs.map(d => ({ ...d.data(), id: d.id }));
      const sorted = list.sort((a, b) => {
        const tA = a.createdAt || a.lastUpdatedAt || '';
        const tB = b.createdAt || b.lastUpdatedAt || '';
        return tB.localeCompare(tA);
      });
      this._patientsCache = sorted;
      this._patientsLastFetch = now;
      try {
        await idbCache.set('ascpt_cached_patients', sorted);
      } catch (_) {}
      return [...sorted];
    } catch (err) {
      if (this._patientsCache) {
        console.warn('Returning cached patients due to fetch notice:', err.message);
        return [...this._patientsCache];
      }
      console.error('Firestore getPatients error:', err);
      throw new Error('تعذر تحميل سجل المرضى من قاعدة البيانات.');
    }
  }

  // Real-time zero-cost sync for patients directory via meta/syncVersion trigger doc
  subscribeToPatients(callback) {
    if (!this.isCloud) return () => {};
    try {
      let isFirstSnapshot = true;

      // On first attach, always do one initial fetch to get current data
      this.getPatients(true)
        .then((list) => {
          if (typeof callback === 'function') callback(list);
        })
        .catch((err) => {
          console.warn('subscribeToPatients initial fetch notice:', err);
        });

      const versionDocRef = doc(firestoreDb, 'meta', 'syncVersion');
      return onSnapshot(versionDocRef, async (snap) => {
        const data = snap.exists() ? snap.data() : null;
        const currentVersion = (data && typeof data.patientsVersion === 'number') ? data.patientsVersion : 0;

        // 1. Skip the writer's own echo (already patched synchronously in-memory)
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

        // 2. Delta-fetch optimization: single-doc read (created/updated) or 0-read (deleted)
        if (isSequential && targetId && (action === 'created' || action === 'updated' || action === 'deleted') && Array.isArray(this._patientsCache)) {
          if (action === 'deleted') {
            this._patientsCache = this._patientsCache.filter(p => p.id !== targetId);
            this._patientsLastFetch = Date.now();
            try {
              idbCache.set('ascpt_cached_patients', this._patientsCache);
              idbCache.set('ascpt_patients_last_sync', new Date().toISOString());
            } catch (_) {}
            if (typeof callback === 'function') callback([...this._patientsCache]);
            return;
          }

          try {
            const pSnap = await getDoc(doc(firestoreDb, 'patients', targetId));
            if (pSnap.exists()) {
              const docData = { id: pSnap.id, ...pSnap.data() };
              const idx = this._patientsCache.findIndex(p => p.id === targetId);
              if (idx !== -1) {
                this._patientsCache[idx] = { ...this._patientsCache[idx], ...docData };
              } else {
                this._patientsCache.unshift(docData);
              }
              this._patientsCache.sort((a, b) => {
                const tA = a.createdAt || a.lastUpdatedAt || '';
                const tB = b.createdAt || b.lastUpdatedAt || '';
                return tB.localeCompare(tA);
              });
              this._patientsLastFetch = Date.now();
              try {
                idbCache.set('ascpt_cached_patients', this._patientsCache);
                idbCache.set('ascpt_patients_last_sync', new Date().toISOString());
              } catch (_) {}
              if (typeof callback === 'function') callback([...this._patientsCache]);
              return;
            } else {
              this._patientsCache = this._patientsCache.filter(p => p.id !== targetId);
              this._patientsLastFetch = Date.now();
              try {
                idbCache.set('ascpt_cached_patients', this._patientsCache);
                idbCache.set('ascpt_patients_last_sync', new Date().toISOString());
              } catch (_) {}
              if (typeof callback === 'function') callback([...this._patientsCache]);
              return;
            }
          } catch (docErr) {
            console.warn('subscribeToPatients delta-fetch single doc notice, falling back to full refresh:', docErr);
          }
        }

        // 3. Gap fallback: version jump > 1 or missing cache
        try {
          const list = await this.getPatients(true);
          if (typeof callback === 'function') callback(list);
        } catch (err) {
          console.warn('subscribeToPatients refetch notice:', err);
        }
      }, (err) => {
        console.warn('subscribeToPatients notice:', err);
      });
    } catch (err) {
      console.warn('Failed to subscribeToPatients:', err);
      return () => {};
    }
  }

  async savePatient(patientData, currentUser) {
    this.ensureConnected();
    const isEdit = Boolean(patientData.id);
    const patientId = patientData.id || doc(collection(firestoreDb, 'patients')).id;

    const dataToSave = {
      ...patientData,
      id: patientId,
      lastUpdatedAt: new Date().toISOString(),
      lastUpdatedBy: currentUser?.name || 'طاقم المركز'
    };

    if (!isEdit) {
      dataToSave.createdAt = new Date().toISOString();
      dataToSave.createdBy = currentUser?.name || 'استقبال المركز';
    }

    try {
      await setDoc(doc(firestoreDb, 'patients', patientId), dataToSave, { merge: true });
      try {
        this._suppressNextOwnPatientsVersionEvent = true;
        await setDoc(doc(firestoreDb, 'meta', 'syncVersion'), {
          patientsVersion: increment(1),
          lastChangedPatientId: patientId,
          lastChangedPatientAction: isEdit ? 'updated' : 'created'
        }, { merge: true });
      } catch (verErr) {
        console.warn('Failed to increment patientsVersion:', verErr);
      }

      // Update in-memory cache and sessionStorage in place (0 additional reads)
      if (this._patientsCache) {
        const idx = this._patientsCache.findIndex(p => p.id === patientId);
        if (idx !== -1) {
          this._patientsCache[idx] = { ...this._patientsCache[idx], ...dataToSave };
        } else {
          this._patientsCache.unshift(dataToSave);
        }
        this._patientsLastFetch = Date.now();
      }
      try {
        if (this._patientsCache) {
          idbCache.set('ascpt_cached_patients', this._patientsCache);
          idbCache.set('ascpt_patients_last_sync', new Date().toISOString());
        }
      } catch (_) {}

      return { status: isEdit ? 'updated' : 'created', id: patientId };
    } catch (err) {
      console.error('Firestore savePatient error:', err);
      throw new Error('فشل حفظ بيانات المريض في قاعدة البيانات.');
    }
  }

  async deletePatient(patientId) {
    this.ensureConnected();
    try {
      await deleteDoc(doc(firestoreDb, 'patients', patientId));
      try {
        this._suppressNextOwnPatientsVersionEvent = true;
        await setDoc(doc(firestoreDb, 'meta', 'syncVersion'), {
          patientsVersion: increment(1),
          lastChangedPatientId: patientId,
          lastChangedPatientAction: 'deleted'
        }, { merge: true });
      } catch (verErr) {
        console.warn('Failed to increment patientsVersion:', verErr);
      }
      if (this._patientsCache) {
        this._patientsCache = this._patientsCache.filter(p => p.id !== patientId);
        this._patientsLastFetch = Date.now();
        try {
          idbCache.set('ascpt_cached_patients', this._patientsCache);
        } catch (_) {}
      }
      return true;
    } catch (err) {
      console.error('Firestore deletePatient error:', err);
      throw new Error('فشل حذف ملف المريض من قاعدة البيانات.');
    }
  }

  // ================= 2. Sessions Management (Zero-Cost Scoped Architecture) =================
  async getSessions(filterDate = null, forceRefresh = false) {
    this.ensureConnected();
    const now = Date.now();

    // 1. Specific Day Scoped Query (e.g. today 'YYYY-MM-DD') -> Reads only that single day's docs (~20 docs vs 2,000)!
    if (filterDate && filterDate.length === 10) {
      const cached = this._sessionsByDateCache.get(filterDate);
      if (!forceRefresh && cached && (now - cached.time < this.CACHE_TTL)) {
        return [...cached.data];
      }
      try {
        const q = query(
          collection(firestoreDb, 'sessions'),
          where('date', '==', filterDate)
        );
        const snap = await getDocs(q);
        const list = snap.docs.map(d => ({ ...d.data(), id: d.id }));
        const sorted = this._filterAndSortSessions(list, filterDate);
        this._sessionsByDateCache.set(filterDate, { data: sorted, time: now });
        list.forEach(s => this._sessionDocCache.set(s.id, s));
        return [...sorted];
      } catch (err) {
        if (cached) return [...cached.data];
        console.error('Firestore getSessions by date error:', err);
        throw new Error('تعذر جلب جلسات اليوم المحدد من قاعدة البيانات.');
      }
    }

    // 2. Specific Month Scoped Query (e.g. 'YYYY-MM') -> Reads only that month's docs
    if (filterDate && filterDate.length === 7) {
      const cached = this._sessionsByDateCache.get(filterDate);
      if (!forceRefresh && cached && (now - cached.time < this.CACHE_TTL)) {
        return [...cached.data];
      }
      try {
        const q = query(
          collection(firestoreDb, 'sessions'),
          where('date', '>=', filterDate + '-01'),
          where('date', '<=', filterDate + '-31')
        );
        const snap = await getDocs(q);
        const list = snap.docs.map(d => ({ ...d.data(), id: d.id }));
        const sorted = this._filterAndSortSessions(list, filterDate);
        this._sessionsByDateCache.set(filterDate, { data: sorted, time: now });
        list.forEach(s => this._sessionDocCache.set(s.id, s));
        return [...sorted];
      } catch (err) {
        if (cached) return [...cached.data];
        console.error('Firestore getSessions by month error:', err);
        throw new Error('تعذر جلب جلسات الشهر المحدد من قاعدة البيانات.');
      }
    }

    // 3. Unbounded / All Sessions Query (Only for full backup or export)
    if (!forceRefresh && this._sessionsCache && (now - this._sessionsLastFetch < this.CACHE_TTL)) {
      return this._filterAndSortSessions(this._sessionsCache, filterDate);
    }
    try {
      const q = query(collection(firestoreDb, 'sessions'), orderBy('date', 'desc'));
      const snap = await getDocs(q);
      const sessions = snap.docs.map(d => ({ ...d.data(), id: d.id }));
      this._sessionsCache = sessions;
      this._sessionsLastFetch = now;
      sessions.forEach(s => this._sessionDocCache.set(s.id, s));
      return this._filterAndSortSessions(sessions, filterDate);
    } catch (err) {
      if (this._sessionsCache) {
        console.warn('Returning cached sessions due to network notice:', err.message);
        return this._filterAndSortSessions(this._sessionsCache, filterDate);
      }
      console.error('Firestore getSessions error:', err);
      throw new Error('تعذر جلب سجل الجلسات من قاعدة البيانات.');
    }
  }

  // Targeted Single Patient Sessions Lookup (Zero-Cost for Clinical Sheet)
  async getSessionsForPatient(patientId, forceRefresh = false) {
    if (!patientId) return [];
    this.ensureConnected();
    const now = Date.now();
    const cached = this._sessionsByPatientCache.get(patientId);
    if (!forceRefresh && cached && (now - cached.time < this.CACHE_TTL)) {
      return [...cached.data];
    }
    try {
      const q = query(
        collection(firestoreDb, 'sessions'),
        where('patientId', '==', patientId)
      );
      const snap = await getDocs(q);
      const list = snap.docs.map(d => ({ ...d.data(), id: d.id }));
      const sorted = this._filterAndSortSessions(list, null);
      this._sessionsByPatientCache.set(patientId, { data: sorted, time: now });
      list.forEach(s => this._sessionDocCache.set(s.id, s));
      return [...sorted];
    } catch (err) {
      if (cached) return [...cached.data];
      console.error('Firestore getSessionsForPatient error:', err);
      return [];
    }
  }

  // Targeted Date Range Query (Zero-Cost for Claims Calculation)
  async getSessionsInRange(startDate, endDate, forceRefresh = false) {
    this.ensureConnected();
    const now = Date.now();
    const cacheKey = `range_${startDate}_${endDate}`;
    const cached = this._sessionsByDateCache.get(cacheKey);
    if (!forceRefresh && cached && (now - cached.time < this.CACHE_TTL)) {
      return [...cached.data];
    }
    try {
      const q = query(
        collection(firestoreDb, 'sessions'),
        where('date', '>=', startDate),
        where('date', '<=', endDate)
      );
      const snap = await getDocs(q);
      const list = snap.docs.map(d => ({ ...d.data(), id: d.id }));
      const sorted = this._filterAndSortSessions(list, null);
      this._sessionsByDateCache.set(cacheKey, { data: sorted, time: now });
      list.forEach(s => this._sessionDocCache.set(s.id, s));
      return [...sorted];
    } catch (err) {
      if (cached) return [...cached.data];
      console.error('Firestore getSessionsInRange error:', err);
      return [];
    }
  }

  // Fast Single Session Lookup
  async getSessionById(sessionId) {
    if (!sessionId) return null;
    if (this._sessionDocCache.has(sessionId)) {
      return { ...this._sessionDocCache.get(sessionId) };
    }
    this.ensureConnected();
    try {
      const snap = await getDoc(doc(firestoreDb, 'sessions', sessionId));
      if (snap.exists()) {
        const item = { ...snap.data(), id: snap.id };
        this._sessionDocCache.set(sessionId, item);
        return item;
      }
      return null;
    } catch (err) {
      console.warn('Firestore getSessionById error:', err);
      return null;
    }
  }

  // ================= Real-time Session Sync =================
  subscribeToTodaySessions(dateStr, callback) {
    if (!this.isCloud) return () => {};
    const targetDate = dateStr || getLocalTodayDateStr();
    try {
      const q = query(
        collection(firestoreDb, 'sessions'),
        where('date', '==', targetDate)
      );
      return onSnapshot(q, (snap) => {
        const list = snap.docs.map(d => ({ ...d.data(), id: d.id }));
        const sorted = this._filterAndSortSessions(list, targetDate);
        this._sessionsByDateCache.set(targetDate, { data: sorted, time: Date.now() });
        // Invalidate month cache so doctor dashboard and finance reflect changes in real-time
        if (targetDate.length >= 7) {
          this._sessionsByDateCache.delete(targetDate.substring(0, 7));
        }
        list.forEach(s => this._sessionDocCache.set(s.id, s));
        if (typeof callback === 'function') {
          callback(sorted);
        }
      }, (err) => {
        console.warn('subscribeToTodaySessions notice:', err);
      });
    } catch (err) {
      console.warn('Failed to subscribeToTodaySessions:', err);
      return () => {};
    }
  }

  _filterAndSortSessions(sessionsList, filterDate) {
    let sessions = [...sessionsList];
    if (filterDate) {
      if (filterDate.length === 7) {
        sessions = sessions.filter(s => s.date && s.date.startsWith(filterDate));
      } else {
        sessions = sessions.filter(s => s.date === filterDate);
      }
    }

    return sessions.sort((a, b) => {
      const dateComp = (b.date || '').localeCompare(a.date || '');
      if (dateComp !== 0) return dateComp;
      const timeA = a.createdAt || a.recordedAt || '';
      const timeB = b.createdAt || b.recordedAt || '';
      return timeB.localeCompare(timeA);
    });
  }

  async saveSession(sessionData, currentUser) {
    this.ensureConnected();
    const isEdit = Boolean(sessionData.id);
    const sessionId = sessionData.id || doc(collection(firestoreDb, 'sessions')).id;

    const dataToSave = {
      ...sessionData,
      id: sessionId,
      lastEditedBy: currentUser?.name || 'مستخدم المركز',
      lastEditedAt: new Date().toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' })
    };

    if (!isEdit) {
      dataToSave.recordedAt = new Date().toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' });
      dataToSave.recordedBy = currentUser?.name || 'استقبال المركز';
      dataToSave.createdAt = new Date().toISOString();
    }

    try {
      await setDoc(doc(firestoreDb, 'sessions', sessionId), dataToSave, { merge: true });

      // Update local and scoped caches in place (0 reads)
      this._sessionDocCache.set(sessionId, dataToSave);
      if (dataToSave.date) {
        this._sessionsByDateCache.delete(dataToSave.date);
        this._sessionsByDateCache.delete(dataToSave.date.substring(0, 7));
      }
      if (dataToSave.patientId) {
        this._sessionsByPatientCache.delete(dataToSave.patientId);
      }
      if (this._sessionsCache) {
        const idx = this._sessionsCache.findIndex(s => s.id === sessionId);
        if (idx !== -1) {
          this._sessionsCache[idx] = { ...this._sessionsCache[idx], ...dataToSave };
        } else {
          this._sessionsCache.unshift(dataToSave);
        }
        this._sessionsLastFetch = Date.now();
      }

      return dataToSave;
    } catch (err) {
      console.error('Firestore saveSession error:', err);
      throw new Error('فشل حفظ حركة الجلسة في قاعدة البيانات.');
    }
  }

  async deleteSession(sessionId) {
    this.ensureConnected();
    try {
      await deleteDoc(doc(firestoreDb, 'sessions', sessionId));
      this._sessionDocCache.delete(sessionId);
      this._sessionsByDateCache.clear();
      this._sessionsByPatientCache.clear();
      if (this._sessionsCache) {
        this._sessionsCache = this._sessionsCache.filter(s => s.id !== sessionId);
        this._sessionsLastFetch = Date.now();
      }
      return true;
    } catch (err) {
      console.error('Firestore deleteSession error:', err);
      throw new Error('فشل حذف الجلسة من قاعدة البيانات.');
    }
  }

  // ================= 3. Expenses Management (Zero-Cost Scoped Architecture) =================
  async getExpenses(filterDate = null, forceRefresh = false) {
    this.ensureConnected();
    const now = Date.now();

    // 1. Single Day Scoped Query (YYYY-MM-DD)
    if (filterDate && filterDate.length === 10) {
      const cached = this._expensesByDateCache.get(filterDate);
      if (!forceRefresh && cached && (now - cached.time < this.CACHE_TTL)) {
        return [...cached.data];
      }
      try {
        const q = query(
          collection(firestoreDb, 'expenses'),
          where('date', '==', filterDate)
        );
        const snap = await getDocs(q);
        const list = snap.docs.map(d => ({ ...d.data(), id: d.id }));
        const sorted = this._filterExpenses(list, filterDate);
        this._expensesByDateCache.set(filterDate, { data: sorted, time: now });
        return [...sorted];
      } catch (err) {
        if (cached) return [...cached.data];
        console.warn('Firestore getExpenses by date notice:', err.message);
        return [];
      }
    }

    // 2. Single Month Scoped Query (YYYY-MM)
    if (filterDate && filterDate.length === 7) {
      const cached = this._expensesByDateCache.get(filterDate);
      if (!forceRefresh && cached && (now - cached.time < this.CACHE_TTL)) {
        return [...cached.data];
      }
      try {
        const q = query(
          collection(firestoreDb, 'expenses'),
          where('date', '>=', filterDate + '-01'),
          where('date', '<=', filterDate + '-31')
        );
        const snap = await getDocs(q);
        const list = snap.docs.map(d => ({ ...d.data(), id: d.id }));
        const sorted = this._filterExpenses(list, filterDate);
        this._expensesByDateCache.set(filterDate, { data: sorted, time: now });
        return [...sorted];
      } catch (err) {
        if (cached) return [...cached.data];
        console.warn('Firestore getExpenses by month notice:', err.message);
        return [];
      }
    }

    // 3. Unbounded Query
    if (!forceRefresh && this._expensesCache && (now - this._expensesLastFetch < this.CACHE_TTL)) {
      return this._filterExpenses(this._expensesCache, filterDate);
    }
    try {
      const q = query(collection(firestoreDb, 'expenses'), orderBy('date', 'desc'));
      const snap = await getDocs(q);
      const expenses = snap.docs.map(d => ({ ...d.data(), id: d.id }));
      this._expensesCache = expenses;
      this._expensesLastFetch = now;
      return this._filterExpenses(expenses, filterDate);
    } catch (err) {
      if (this._expensesCache) {
        return this._filterExpenses(this._expensesCache, filterDate);
      }
      console.warn('Firestore getExpenses notice:', err.message);
      return [];
    }
  }

  _filterExpenses(expensesList, filterDate) {
    let expenses = [...expensesList];
    if (filterDate) {
      if (filterDate.length === 7) {
        return expenses.filter(e => e.date && e.date.startsWith(filterDate));
      }
      return expenses.filter(e => e.date === filterDate);
    }
    return expenses;
  }

  async saveExpense(expenseData, currentUser) {
    this.ensureConnected();
    const expenseId = expenseData.id || doc(collection(firestoreDb, 'expenses')).id;
    const dataToSave = {
      ...expenseData,
      id: expenseId,
      time: new Date().toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' }),
      recordedBy: currentUser?.name || 'مدير المركز',
      createdAt: new Date().toISOString()
    };

    try {
      await setDoc(doc(firestoreDb, 'expenses', expenseId), dataToSave, { merge: true });
      if (dataToSave.date) {
        this._expensesByDateCache.delete(dataToSave.date);
        this._expensesByDateCache.delete(dataToSave.date.substring(0, 7));
      }
      if (this._expensesCache) {
        const idx = this._expensesCache.findIndex(e => e.id === expenseId);
        if (idx !== -1) {
          this._expensesCache[idx] = { ...this._expensesCache[idx], ...dataToSave };
        } else {
          this._expensesCache.unshift(dataToSave);
        }
        this._expensesLastFetch = Date.now();
      }
      return dataToSave;
    } catch (err) {
      console.error('Firestore saveExpense error:', err);
      throw new Error('فشل حفظ المصروف في قاعدة البيانات.');
    }
  }

  async deleteExpense(expenseId) {
    this.ensureConnected();
    try {
      await deleteDoc(doc(firestoreDb, 'expenses', expenseId));
      this._expensesByDateCache.clear();
      if (this._expensesCache) {
        this._expensesCache = this._expensesCache.filter(e => e.id !== expenseId);
        this._expensesLastFetch = Date.now();
      }
      return true;
    } catch (err) {
      console.error('Firestore deleteExpense error:', err);
      throw new Error('فشل حذف المصروف.');
    }
  }

  // ================= 4. Users & Doctors Directory (Zero-Cost Local Caching) =================
  async getUsers(forceRefresh = false) {
    this.ensureConnected();
    const now = Date.now();

    // 1. In-memory check
    if (!forceRefresh && this._usersCache && (now - this._usersLastFetch < this.USERS_CACHE_TTL)) {
      return [...this._usersCache];
    }

    // 2. Persistent IndexedDB check (saves reads across browser reloads)
    if (!forceRefresh) {
      try {
        const idbUsers = await idbCache.get('ascpt_cached_users');
        const lastSync = await idbCache.get('ascpt_users_last_sync');
        if (idbUsers && lastSync) {
          const syncTime = parseInt(lastSync, 10);
          if (now - syncTime < this.USERS_CACHE_TTL && Array.isArray(idbUsers) && idbUsers.length > 0) {
            this._usersCache = idbUsers;
            this._usersLastFetch = now;
            return [...idbUsers];
          }
        }
      } catch (_) {}
    }

    // 3. Fetch from Firestore
    try {
      const snap = await getDocs(collection(firestoreDb, 'users'));
      const list = snap.docs.map(d => ({ ...d.data(), id: d.id }));
      this._usersCache = list;
      this._usersLastFetch = now;
      try {
        await idbCache.set('ascpt_cached_users', list);
        await idbCache.set('ascpt_users_last_sync', String(now));
      } catch (_) {}
      return [...list];
    } catch (err) {
      if (this._usersCache) return [...this._usersCache];
      console.error('Firestore getUsers error:', err);
      return [];
    }
  }

  async getDoctorsList(forceRefresh = false) {
    this.ensureConnected();
    try {
      const users = await this.getUsers(forceRefresh);
      const doctorMap = new Map();

      users
        .filter(u => (u.role === 'doctor' || u.role === 'admin') && u.active !== false && u.name)
        .forEach(u => {
          const norm = u.name.trim().replace(/\s+/g, ' ');
          const uid = u.uid || u.id;
          if (norm && uid && !doctorMap.has(uid)) {
            doctorMap.set(uid, {
              uid,
              name: norm,
              role: u.role,
              shift: u.shift || (u.role === 'doctor' ? 'sat_mon_wed' : 'all'),
              seniorityLevel: u.seniorityLevel || 'junior',
              regularSessionRate: typeof u.regularSessionRate === 'number' ? u.regularSessionRate : 0,
              scoliosisRate: typeof u.scoliosisRate === 'number' ? u.scoliosisRate : 0,
              hemiplegiaRate: typeof u.hemiplegiaRate === 'number' ? u.hemiplegiaRate : 0,
              quadriplegiaRate: typeof u.quadriplegiaRate === 'number' ? u.quadriplegiaRate : (typeof u.pediatricRate === 'number' ? u.pediatricRate : 0),
              pediatricRate: typeof u.quadriplegiaRate === 'number' ? u.quadriplegiaRate : (typeof u.pediatricRate === 'number' ? u.pediatricRate : 0),
              specialSessionRate: typeof u.specialSessionRate === 'number' ? u.specialSessionRate : 0
            });
          }
        });

      if (doctorMap.size === 0 && CLINIC_CONFIG.director?.name) {
        const dirNorm = CLINIC_CONFIG.director.name.trim().replace(/\s+/g, ' ');
        doctorMap.set('director', { uid: 'director', name: dirNorm, role: 'admin', shift: 'all' });
      }

      return Array.from(doctorMap.values());
    } catch (err) {
      console.error('Firestore getDoctorsList error:', err);
      return CLINIC_CONFIG.director?.name ? [{ uid: 'director', name: CLINIC_CONFIG.director.name.trim().replace(/\s+/g, ' '), role: 'admin', shift: 'all' }] : [];
    }
  }

  async getDoctors(forceRefresh = false) {
    const list = await this.getDoctorsList(forceRefresh);
    return list.map(d => d.name);
  }

  // ================= 5. Audit Trail =================
  async getAuditLogs(limitCount = 50, forceRefresh = false) {
    this.ensureConnected();
    const now = Date.now();
    if (!forceRefresh && this._auditCache && (now - this._auditLastFetch < this.CACHE_TTL)) {
      return [...this._auditCache].slice(0, limitCount);
    }
    try {
      const q = query(
        collection(firestoreDb, 'audit_logs'),
        orderBy('timestampRaw', 'desc'),
        limit(limitCount)
      );
      const snap = await getDocs(q);
      const list = snap.docs.map(d => ({ ...d.data(), id: d.id }));
      this._auditCache = list;
      this._auditLastFetch = now;
      return [...list];
    } catch (err) {
      if (this._auditCache) return [...this._auditCache].slice(0, limitCount);
      console.warn('Firestore getAuditLogs error:', err.message);
      return [];
    }
  }

  async purgeOldAuditLogs() {
    if (!this.isCloud) return;
    const lastPurge = parseInt(localStorage.getItem('ascpt_last_audit_purge') || '0', 10);
    // Only run once every 24 hours to eliminate repeated background read/delete calls
    if (Date.now() - lastPurge < 86400000) return;

    try {
      localStorage.setItem('ascpt_last_audit_purge', String(Date.now()));
      const sixtyDaysAgo = Date.now() - (60 * 24 * 60 * 60 * 1000);
      const q = query(
        collection(firestoreDb, 'audit_logs'),
        where('timestampRaw', '<', sixtyDaysAgo),
        limit(100)
      );
      const snap = await getDocs(q);
      if (snap.empty) return;

      const batch = writeBatch(firestoreDb);
      snap.docs.forEach(d => {
        batch.delete(d.ref);
      });
      await batch.commit();
      console.log(`ASCPT Audit: Automatically purged ${snap.docs.length} audit logs older than 60 days.`);
    } catch (e) {
      console.warn('Audit purge notice:', e.message);
    }
  }

  async logAudit(actionType, description, user) {
    if (!this.isCloud) return;
    const logId = 'log-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
    const currentUser = (typeof auth !== 'undefined' && auth.getCurrentUser) ? auth.getCurrentUser() : null;
    const uid = user?.uid || user?.id || currentUser?.uid;
    const name = user?.name || currentUser?.name || 'مستخدم المركز';
    const role = user?.role || currentUser?.role || 'staff';

    if (!uid) return;

    const logData = {
      id: logId,
      actionType: String(actionType || 'إجراء'),
      description: String(description || ''),
      userId: uid,
      userName: name,
      userRole: role,
      timestamp: new Date().toLocaleString('ar-EG-u-nu-latn'),
      timestampRaw: Date.now()
    };

    try {
      await setDoc(doc(firestoreDb, 'audit_logs', logId), logData);
      if (this._auditCache) {
        this._auditCache.unshift(logData);
        if (this._auditCache.length > 100) this._auditCache.pop();
        this._auditLastFetch = Date.now();
      }
    } catch (err) {
      console.warn('Audit logging notice:', err.message);
    }
  }

  // ================= 6. Clinical Options =================
  getClinicalOptions(category) {
    const defaults = {
      modality: [
        'TENS (كهرباء تسكينية)',
        'Ultrasound (موجات صوتية)',
        'كمادات ساخنة (Hot Pack)',
        'كمادات باردة / ثلج (Cryotherapy)',
        'الشد الفقري (Traction)',
        'ليزر علاجي (Laser Therapy)',
        'موجات تصادمية (Shockwave)',
        'أشعة تحت الحمراء (Infrared)',
        'كؤوس هواء (Cupping)'
      ],
      procedure: [
        'تحريك المفاصل (Joint Mobilization)',
        'تحرير اللفافة العضلية (Myofascial Release)',
        'تدليك علاجي عميق (Deep Tissue Massage)',
        'إطالات عضلية (Muscle Stretching)',
        'الإبر الجافة (Dry Needling)',
        'الأشرطة اللاصقة الحركية (Kinesio Taping)'
      ],
      exercise: [
        'تمارين التقوية العضلية (Strengthening)',
        'تمارين المدى الحركي (Range of Motion)',
        'تمارين التوازن والاتزان الحركي (Balance & Proprioception)',
        'تمارين عضلات الجذع (Core Stability)',
        'تمارين تصحيح القوام (Postural Correction)',
        'برنامج التمارين المنزلية (Home Exercise Program)'
      ],
      body_parts: [
        'الرقبة',
        'أسفل الظهر',
        'الكتف',
        'الركبة',
        'الكاحل والقدم',
        'الكوع والرسغ',
        'مفصل الفخذ / الحوض',
        'عضو آخر'
      ],
      expense_categories: [
        'مستلزمات وأدوات طبية',
        'صيانة أجهزة وزيوت',
        'فواتير وكهرباء ومياه',
        'أدوات ومواد نظافة',
        'ضيافة وبوفيه',
        'أجور ومرتبات',
        'إيجار المركز',
        'مطبوعات وأدوات مكتبية',
        'مصروفات نثرية / أخرى'
      ]
    };

    if (this.clinicalOptionsCache && this.clinicalOptionsCache[category]) {
      return this.clinicalOptionsCache[category];
    }
    try {
      const stored = localStorage.getItem('ascpt_cached_clinical_options');
      if (stored) {
        this.clinicalOptionsCache = JSON.parse(stored);
        if (this.clinicalOptionsCache && this.clinicalOptionsCache[category]) {
          return this.clinicalOptionsCache[category];
        }
      }
    } catch (_) {}
    return defaults[category] || [];
  }

  async syncAndSeedCloudOptions(forceRefresh = false) {
    if (!this.isCloud) return;
    if (this._optionsLoaded && !forceRefresh) return;

    this.ensureConnected();

    // Fast-path: immediate memory hydration from local storage (Zero Firestore Reads)
    try {
      const storedClinical = localStorage.getItem('ascpt_cached_clinical_options');
      const storedIns = localStorage.getItem('ascpt_cached_insurance_companies');
      if (storedClinical && !this.clinicalOptionsCache) {
        this.clinicalOptionsCache = JSON.parse(storedClinical);
      }
      if (storedIns && !this.insuranceCompaniesCache) {
        this.insuranceCompaniesCache = JSON.parse(storedIns);
      }
      if (storedClinical && storedIns && !forceRefresh) {
        this._optionsLoaded = true;
        return;
      }
    } catch (_) {}

    const defaults = {
      modality: [
        'TENS (كهرباء تسكينية)',
        'Ultrasound (موجات صوتية)',
        'كمادات ساخنة (Hot Pack)',
        'كمادات باردة / ثلج (Cryotherapy)',
        'الشد الفقري (Traction)',
        'ليزر علاجي (Laser Therapy)',
        'موجات تصادمية (Shockwave)',
        'أشعة تحت الحمراء (Infrared)',
        'كؤوس هواء (Cupping)'
      ],
      procedure: [
        'تحريك المفاصل (Joint Mobilization)',
        'تحرير اللفافة العضلية (Myofascial Release)',
        'تدليك علاجي عميق (Deep Tissue Massage)',
        'إطالات عضلية (Muscle Stretching)',
        'الإبر الجافة (Dry Needling)',
        'الأشرطة اللاصقة الحركية (Kinesio Taping)'
      ],
      exercise: [
        'تمارين التقوية العضلية (Strengthening)',
        'تمارين المدى الحركي (Range of Motion)',
        'تمارين التوازن والاتزان الحركي (Balance & Proprioception)',
        'تمارين عضلات الجذع (Core Stability)',
        'تمارين تصحيح القوام (Postural Correction)',
        'برنامج التمارين المنزلية (Home Exercise Program)'
      ],
      body_parts: [
        'الرقبة',
        'أسفل الظهر',
        'الكتف',
        'الركبة',
        'الكاحل والقدم',
        'الكوع والرسغ',
        'مفصل الفخذ / الحوض',
        'عضو آخر'
      ],
      expense_categories: [
        'مستلزمات وأدوات طبية',
        'صيانة أجهزة وزيوت',
        'فواتير وكهرباء ومياه',
        'أدوات ومواد نظافة',
        'ضيافة وبوفيه',
        'أجور ومرتبات',
        'إيجار المركز',
        'مطبوعات وأدوات مكتبية',
        'مصروفات نثرية / أخرى'
      ]
    };

    const insuranceDefaults = CLINIC_CONFIG.defaultInsuranceCompanies || {
      direct: ['أكسا (AXA)', 'أليانز (Allianz)', 'ميتلايف (MetLife)', 'بوبا (Bupa)', 'عناية الرعاية الصحية (Enaya)'],
      indirect: ['نكست كير (NextCare)', 'مصر للتأمين', 'ايجي كير', 'المهندس للتأمين']
    };

    this.clinicalOptionsCache = this.clinicalOptionsCache || {};
    this.insuranceCompaniesCache = this.insuranceCompaniesCache || {};

    // 1. Seed & Sync Clinical Options
    for (const cat of ['modality', 'procedure', 'exercise', 'body_parts', 'expense_categories']) {
      try {
        const docRef = doc(firestoreDb, 'clinical_options', cat);
        const snap = await getDoc(docRef);
        if (snap.exists()) {
          const data = snap.data();
          if (Array.isArray(data.items)) {
            this.clinicalOptionsCache[cat] = data.items;
          }
        } else {
          const defaultItems = defaults[cat] || [];
          this.clinicalOptionsCache[cat] = defaultItems;
          await setDoc(docRef, { items: defaultItems }, { merge: true });
        }
      } catch (err) {
        if (!this.clinicalOptionsCache[cat]) {
          this.clinicalOptionsCache[cat] = defaults[cat] || [];
        }
      }
    }

    // 2. Seed & Sync Insurance Companies
    for (const cType of ['direct', 'indirect']) {
      try {
        const docRef = doc(firestoreDb, 'insurance_companies', cType);
        const snap = await getDoc(docRef);
        if (snap.exists()) {
          const data = snap.data();
          if (Array.isArray(data.companies)) {
            this.insuranceCompaniesCache[cType] = data.companies;
          }
        } else {
          const defaultCompanies = insuranceDefaults[cType] || [];
          this.insuranceCompaniesCache[cType] = defaultCompanies;
          await setDoc(docRef, { companies: defaultCompanies }, { merge: true });
        }
      } catch (err) {
        if (!this.insuranceCompaniesCache[cType]) {
          this.insuranceCompaniesCache[cType] = insuranceDefaults[cType] || [];
        }
      }
    }

    try {
      localStorage.setItem('ascpt_cached_clinical_options', JSON.stringify(this.clinicalOptionsCache));
      localStorage.setItem('ascpt_cached_insurance_companies', JSON.stringify(this.insuranceCompaniesCache));
    } catch (_) {}

    this._optionsLoaded = true;
  }

  async syncClinicalOptionsFromFirestore() {
    await this.syncAndSeedCloudOptions(true);
  }

  async addClinicalOption(category, name) {
    this.ensureConnected();
    const currentList = this.getClinicalOptions(category);
    if (!currentList.includes(name.trim())) {
      const updatedList = [...currentList, name.trim()];
      this.clinicalOptionsCache = this.clinicalOptionsCache || {};
      this.clinicalOptionsCache[category] = updatedList;
      try {
        localStorage.setItem('ascpt_cached_clinical_options', JSON.stringify(this.clinicalOptionsCache));
      } catch (_) {}
      try {
        await setDoc(doc(firestoreDb, 'clinical_options', category), { items: updatedList }, { merge: true });
      } catch (err) {
        console.warn('Firestore addClinicalOption error:', err);
      }
      return updatedList;
    }
    return currentList;
  }

  async deleteClinicalOption(category, name) {
    this.ensureConnected();
    const currentList = this.getClinicalOptions(category);
    const updatedList = currentList.filter(item => item !== name.trim());
    this.clinicalOptionsCache = this.clinicalOptionsCache || {};
    this.clinicalOptionsCache[category] = updatedList;
    try {
      localStorage.setItem('ascpt_cached_clinical_options', JSON.stringify(this.clinicalOptionsCache));
    } catch (_) {}
    try {
      await setDoc(doc(firestoreDb, 'clinical_options', category), { items: updatedList }, { merge: true });
    } catch (err) {
      console.warn('Firestore deleteClinicalOption error:', err);
    }
    return updatedList;
  }

  // ================= 7. Insurance Companies =================
  getInsuranceCompanies(contractType = 'direct') {
    const defaults = CLINIC_CONFIG.defaultInsuranceCompanies || {
      direct: ['أكسا (AXA)', 'أليانز (Allianz)', 'ميتلايف (MetLife)', 'بوبا (Bupa)', 'عناية الرعاية الصحية (Enaya)'],
      indirect: ['نكست كير (NextCare)', 'مصر للتأمين', 'ايجي كير', 'المهندس للتأمين']
    };

    if (this.insuranceCompaniesCache && this.insuranceCompaniesCache[contractType]) {
      return this.insuranceCompaniesCache[contractType];
    }
    try {
      const stored = localStorage.getItem('ascpt_cached_insurance_companies');
      if (stored) {
        this.insuranceCompaniesCache = JSON.parse(stored);
        if (this.insuranceCompaniesCache && this.insuranceCompaniesCache[contractType]) {
          return this.insuranceCompaniesCache[contractType];
        }
      }
    } catch (_) {}
    return defaults[contractType] || [];
  }

  getAllInsuranceCompaniesWithTypes() {
    const direct = this.getInsuranceCompanies('direct');
    const indirect = this.getInsuranceCompanies('indirect');
    const res = [];
    direct.forEach(name => res.push({ name, contractType: 'direct', label: `${name} (تعاقد مباشر)` }));
    indirect.forEach(name => res.push({ name, contractType: 'indirect', label: `${name} (تعاقد غير مباشر)` }));
    return res;
  }

  getInsuranceCompaniesList() {
    return this.getAllInsuranceCompaniesWithTypes();
  }

  async syncInsuranceCompaniesFromFirestore() {
    await this.syncAndSeedCloudOptions(true);
  }

  async addInsuranceCompany(contractType, name) {
    this.ensureConnected();
    const currentList = this.getInsuranceCompanies(contractType);
    if (!currentList.includes(name.trim())) {
      const updatedList = [...currentList, name.trim()];
      this.insuranceCompaniesCache = this.insuranceCompaniesCache || {};
      this.insuranceCompaniesCache[contractType] = updatedList;
      try {
        localStorage.setItem('ascpt_cached_insurance_companies', JSON.stringify(this.insuranceCompaniesCache));
      } catch (_) {}
      try {
        await setDoc(doc(firestoreDb, 'insurance_companies', contractType), { companies: updatedList }, { merge: true });
      } catch (err) {
        console.warn('Firestore addInsuranceCompany error:', err);
      }
      return updatedList;
    }
    return currentList;
  }

  async deleteInsuranceCompany(contractType, name) {
    this.ensureConnected();
    const currentList = this.getInsuranceCompanies(contractType);
    const updatedList = currentList.filter(item => item !== name.trim());
    this.insuranceCompaniesCache = this.insuranceCompaniesCache || {};
    this.insuranceCompaniesCache[contractType] = updatedList;
    try {
      localStorage.setItem('ascpt_cached_insurance_companies', JSON.stringify(this.insuranceCompaniesCache));
    } catch (_) {}
    try {
      await setDoc(doc(firestoreDb, 'insurance_companies', contractType), { companies: updatedList }, { merge: true });
    } catch (err) {
      console.warn('Firestore deleteInsuranceCompany error:', err);
    }
    return updatedList;
  }

    // ================= 10. Insurance Renewal Letters (append-only archive) =================
  async addInsuranceLetter(letterData) {
    this.ensureConnected();
    const ref = doc(collection(firestoreDb, 'insurance_letters'));
    const payload = {
      ...letterData,
      id: ref.id,
      createdAt: new Date().toISOString()
    };
    await setDoc(ref, payload);
    return payload;
  }

  async getInsuranceLetters(patientId) {
    this.ensureConnected();
    const snap = await getDocs(collection(firestoreDb, 'insurance_letters'));
    const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return patientId ? all.filter((l) => l.patientId === patientId) : all;
  }

  // ================= 8. Insurance Claim Settlements =================
  async getInsuranceSettlements(dateStr = null, monthStr = null) {
    this.ensureConnected();
    try {
      let q;
      if (dateStr) {
        q = query(
          collection(firestoreDb, 'insurance_settlements'),
          where('settlementDate', '==', dateStr)
        );
      } else if (monthStr) {
        const startOfMonth = `${monthStr}-01`;
        const endOfMonth = `${monthStr}-31`;
        q = query(
          collection(firestoreDb, 'insurance_settlements'),
          where('settlementDate', '>=', startOfMonth),
          where('settlementDate', '<=', endOfMonth)
        );
      } else {
        q = query(
          collection(firestoreDb, 'insurance_settlements'),
          orderBy('settlementDate', 'desc'),
          limit(100)
        );
      }
      const snap = await getDocs(q);
      const list = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
      list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      return list;
    } catch (err) {
      console.warn('Firestore getInsuranceSettlements error:', err.message);
      return [];
    }
  }

  async saveInsuranceSettlement(settlementData, currentUser) {
    this.ensureConnected();
    const settlementId = settlementData.id || doc(collection(firestoreDb, 'insurance_settlements')).id;
    const dataToSave = {
      ...settlementData,
      id: settlementId,
      time: new Date().toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' }),
      recordedBy: currentUser?.name || 'مدير المركز',
      createdAt: new Date().toISOString()
    };

    try {
      await setDoc(doc(firestoreDb, 'insurance_settlements', settlementId), dataToSave);
      return dataToSave;
    } catch (err) {
      console.error('Save insurance settlement error:', err);
      throw err;
    }
  }

  async deleteInsuranceSettlement(settlementId) {
    this.ensureConnected();
    await deleteDoc(doc(firestoreDb, 'insurance_settlements', settlementId));
  }

  // ================= 8.أ. Insurance Claims (سجل مطالبات التأمين الصادرة) =================
  async getInsuranceClaims(companyName = null) {
    this.ensureConnected();
    try {
      let q;
      if (companyName && companyName !== 'all') {
        q = query(
          collection(firestoreDb, 'insurance_claims'),
          where('companyName', '==', companyName)
        );
      } else {
        q = query(
          collection(firestoreDb, 'insurance_claims'),
          orderBy('createdAt', 'desc'),
          limit(100)
        );
      }
      const snap = await getDocs(q);
      const list = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
      list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      return list;
    } catch (err) {
      console.warn('Firestore getInsuranceClaims error:', err.message);
      return [];
    }
  }

  async saveInsuranceClaim(claimData, currentUser) {
    this.ensureConnected();
    const claimId = claimData.id || doc(collection(firestoreDb, 'insurance_claims')).id;
    const dataToSave = {
      ...claimData,
      id: claimId,
      recordedBy: currentUser?.name || 'مدير المركز',
      recordedByUid: currentUser?.uid || '',
      createdAt: claimData.createdAt || new Date().toISOString()
    };

    try {
      await setDoc(doc(firestoreDb, 'insurance_claims', claimId), dataToSave, { merge: true });
      return dataToSave;
    } catch (err) {
      console.error('Save insurance claim error:', err);
      throw err;
    }
  }

  async updateInsuranceClaim(claimId, updateData) {
    this.ensureConnected();
    try {
      await setDoc(doc(firestoreDb, 'insurance_claims', claimId), updateData, { merge: true });
      return true;
    } catch (err) {
      console.error('Update insurance claim error:', err);
      throw err;
    }
  }

  async deleteInsuranceClaim(claimId) {
    this.ensureConnected();
    await deleteDoc(doc(firestoreDb, 'insurance_claims', claimId));
  }

  // ================= 9. Weekly Appointments Schedule & Custom Slots (Persistent Local Caching) =================
  async getAppointmentSlots(forceRefresh = false) {
    // Fast path: localStorage
    if (!forceRefresh) {
      try {
        const local = localStorage.getItem('ascpt_cached_appointment_slots');
        if (local) {
          const parsed = JSON.parse(local);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
      } catch (_) {}
    }

    this.ensureConnected();
    try {
      const docRef = doc(firestoreDb, 'clinical_options', 'appointment_slots');
      const snap = await getDoc(docRef);
      if (snap.exists() && Array.isArray(snap.data().slots) && snap.data().slots.length > 0) {
        const slots = snap.data().slots;
        try { localStorage.setItem('ascpt_cached_appointment_slots', JSON.stringify(slots)); } catch (_) {}
        return slots;
      }
    } catch (e) {
      console.warn('getAppointmentSlots notice:', e.message);
    }
    const defaults = [
      { key: '15:30', label: '٣:٣٠ م' },
      { key: '16:30', label: '٤:٣٠ م' },
      { key: '17:30', label: '٥:٣٠ م' },
      { key: '18:30', label: '٦:٣٠ م' },
      { key: '19:00', label: '٧:٠٠ م' }
    ];
    try { localStorage.setItem('ascpt_cached_appointment_slots', JSON.stringify(defaults)); } catch (_) {}
    return defaults;
  }

  async saveAppointmentSlots(slots) {
    this.ensureConnected();
    const docRef = doc(firestoreDb, 'clinical_options', 'appointment_slots');
    await setDoc(docRef, { slots }, { merge: true });
    try { localStorage.setItem('ascpt_cached_appointment_slots', JSON.stringify(slots)); } catch (_) {}
    return slots;
  }

  async updateAppointmentSlot(oldKey, newKey, newLabel) {
    this.ensureConnected();
    let slots = await this.getAppointmentSlots();
    slots = slots.map(s => s.key === oldKey ? { key: newKey, label: newLabel } : s);
    slots.sort((a, b) => a.key.localeCompare(b.key));
    await this.saveAppointmentSlots(slots);

    if (oldKey !== newKey) {
      try {
        const appts = await this.getAppointments();
        const affected = appts.filter(a => a.timeSlot === oldKey);
        for (const a of affected) {
          await setDoc(doc(firestoreDb, 'appointments', a.id), { timeSlot: newKey }, { merge: true });
        }
        if (this._appointmentsCache) {
          this._appointmentsCache = this._appointmentsCache.map(a => a.timeSlot === oldKey ? { ...a, timeSlot: newKey } : a);
        }
        try {
          localStorage.setItem('ascpt_cached_appointments', JSON.stringify(this._appointmentsCache || []));
          localStorage.setItem('ascpt_appointments_last_sync', String(Date.now()));
        } catch (_) {}
      } catch (err) {
        console.warn('Update affected appts notice:', err.message);
      }
    }
    return slots;
  }

  async deleteAppointmentSlot(slotKey) {
    this.ensureConnected();
    let slots = await this.getAppointmentSlots();
    slots = slots.filter(s => s.key !== slotKey);
    await this.saveAppointmentSlots(slots);

    try {
      const appts = await this.getAppointments();
      const affected = appts.filter(a => a.timeSlot === slotKey);
      for (const a of affected) {
        await deleteDoc(doc(firestoreDb, 'appointments', a.id));
      }
      if (this._appointmentsCache) {
        this._appointmentsCache = this._appointmentsCache.filter(a => a.timeSlot !== slotKey);
      }
      try {
        localStorage.setItem('ascpt_cached_appointments', JSON.stringify(this._appointmentsCache || []));
        localStorage.setItem('ascpt_appointments_last_sync', String(Date.now()));
      } catch (_) {}
    } catch (err) {
      console.warn('Delete affected appts notice:', err.message);
    }
    return slots;
  }

  async addAppointmentSlot(newKey, newLabel) {
    this.ensureConnected();
    let slots = await this.getAppointmentSlots();
    if (!slots.some(s => s.key === newKey)) {
      slots.push({ key: newKey, label: newLabel });
      slots.sort((a, b) => a.key.localeCompare(b.key));
      await this.saveAppointmentSlots(slots);
    }
    return slots;
  }

    // ================= 9. Weekly Appointments Schedule =================
  // Fixed recurring weekly template (not tied to specific calendar dates)
  async getAppointments(forceRefresh = false) {
    this.ensureConnected();
    const now = Date.now();

    // 1. Fast in-memory cache check (valid for 60 seconds if not force-refresh)
    if (!forceRefresh && this._appointmentsCache && (now - this._appointmentsLastFetch < 60000)) {
      return [...this._appointmentsCache];
    }

    // 2. Query Firestore directly (Firestore SDK provides its own persistent offline cache!)
    try {
      const snap = await getDocs(collection(firestoreDb, 'appointments'));
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      this._appointmentsCache = list;
      this._appointmentsLastFetch = now;
      try {
        localStorage.setItem('ascpt_cached_appointments', JSON.stringify(list));
        localStorage.setItem('ascpt_appointments_last_sync', String(now));
      } catch (_) {}
      return [...list];
    } catch (e) {
      console.warn('getAppointments network error, using local fallback:', e.message);
      // 3. Fallback when completely offline or network fails
      if (this._appointmentsCache) return [...this._appointmentsCache];
      try {
        const local = localStorage.getItem('ascpt_cached_appointments');
        if (local) {
          const parsed = JSON.parse(local);
          if (Array.isArray(parsed)) {
            this._appointmentsCache = parsed;
            this._appointmentsLastFetch = now;
            return [...parsed];
          }
        }
      } catch (_) {}
      return [];
    }
  }

  // Real-time zero-cost sync for clinic appointments via meta/syncVersion trigger doc
  subscribeToAppointments(callback) {
    if (!this.isCloud) return () => {};
    try {
      let isFirstSnapshot = true;

      // On first attach, always do one initial fetch to get current data
      this.getAppointments(true)
        .then((list) => {
          if (typeof callback === 'function') callback(list);
        })
        .catch((err) => {
          console.warn('subscribeToAppointments initial fetch notice:', err);
        });

      const versionDocRef = doc(firestoreDb, 'meta', 'syncVersion');
      return onSnapshot(versionDocRef, async (snap) => {
        const data = snap.exists() ? snap.data() : null;
        const currentVersion = (data && typeof data.appointmentsVersion === 'number') ? data.appointmentsVersion : 0;

        // 1. Skip the writer's own echo (already patched synchronously in-memory)
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

        // 2. Delta-fetch optimization: single-doc read (created/updated) or 0-read (deleted)
        if (isSequential && targetId && (action === 'created' || action === 'updated' || action === 'deleted') && Array.isArray(this._appointmentsCache)) {
          if (action === 'deleted') {
            this._appointmentsCache = this._appointmentsCache.filter(a => a.id !== targetId);
            this._appointmentsLastFetch = Date.now();
            try {
              localStorage.setItem('ascpt_cached_appointments', JSON.stringify(this._appointmentsCache));
              localStorage.setItem('ascpt_appointments_last_sync', String(Date.now()));
            } catch (_) {}
            if (typeof callback === 'function') callback([...this._appointmentsCache]);
            return;
          }

          try {
            const aSnap = await getDoc(doc(firestoreDb, 'appointments', targetId));
            if (aSnap.exists()) {
              const docData = { id: aSnap.id, ...aSnap.data() };
              const idx = this._appointmentsCache.findIndex(a => a.id === targetId);
              if (idx !== -1) {
                this._appointmentsCache[idx] = { ...this._appointmentsCache[idx], ...docData };
              } else {
                this._appointmentsCache.push(docData);
              }
              this._appointmentsLastFetch = Date.now();
              try {
                localStorage.setItem('ascpt_cached_appointments', JSON.stringify(this._appointmentsCache));
                localStorage.setItem('ascpt_appointments_last_sync', String(Date.now()));
              } catch (_) {}
              if (typeof callback === 'function') callback([...this._appointmentsCache]);
              return;
            } else {
              this._appointmentsCache = this._appointmentsCache.filter(a => a.id !== targetId);
              this._appointmentsLastFetch = Date.now();
              try {
                localStorage.setItem('ascpt_cached_appointments', JSON.stringify(this._appointmentsCache));
                localStorage.setItem('ascpt_appointments_last_sync', String(Date.now()));
              } catch (_) {}
              if (typeof callback === 'function') callback([...this._appointmentsCache]);
              return;
            }
          } catch (docErr) {
            console.warn('subscribeToAppointments delta-fetch single doc notice, falling back to full refresh:', docErr);
          }
        }

        // 3. Gap fallback: version jump > 1 or missing cache
        try {
          const list = await this.getAppointments(true);
          if (typeof callback === 'function') callback(list);
        } catch (err) {
          console.warn('subscribeToAppointments refetch notice:', err);
        }
      }, (err) => {
        console.warn('subscribeToAppointments notice:', err);
      });
    } catch (err) {
      console.warn('Failed to subscribeToAppointments:', err);
      return () => {};
    }
  }

  async addAppointment(apptData) {
    this.ensureConnected();
    const ref = doc(collection(firestoreDb, 'appointments'));
    const payload = {
      ...apptData,
      id: ref.id,
      createdAt: new Date().toISOString()
    };
    await setDoc(ref, payload);
    try {
      this._suppressNextOwnAppointmentsVersionEvent = true;
      await setDoc(doc(firestoreDb, 'meta', 'syncVersion'), {
        appointmentsVersion: increment(1),
        lastChangedAppointmentId: ref.id,
        lastChangedAppointmentAction: 'created'
      }, { merge: true });
    } catch (verErr) {
      console.warn('Failed to increment appointmentsVersion:', verErr);
    }

    // Update in-memory cache and localStorage synchronously
    if (!this._appointmentsCache) {
      this._appointmentsCache = [];
    }
    this._appointmentsCache.push(payload);
    this._appointmentsLastFetch = Date.now();
    try {
      localStorage.setItem('ascpt_cached_appointments', JSON.stringify(this._appointmentsCache));
      localStorage.setItem('ascpt_appointments_last_sync', String(Date.now()));
    } catch (_) {}
    return payload;
  }

  async updateAppointment(apptId, updates) {
    this.ensureConnected();
    const ref = doc(firestoreDb, 'appointments', apptId);
    const payload = {
      ...updates,
      updatedAt: new Date().toISOString()
    };
    await updateDoc(ref, payload);
    try {
      this._suppressNextOwnAppointmentsVersionEvent = true;
      await setDoc(doc(firestoreDb, 'meta', 'syncVersion'), {
        appointmentsVersion: increment(1),
        lastChangedAppointmentId: apptId,
        lastChangedAppointmentAction: 'updated'
      }, { merge: true });
    } catch (verErr) {
      console.warn('Failed to increment appointmentsVersion:', verErr);
    }

    // Update in-memory cache and localStorage synchronously
    if (this._appointmentsCache) {
      const idx = this._appointmentsCache.findIndex(a => a.id === apptId);
      if (idx !== -1) {
        this._appointmentsCache[idx] = { ...this._appointmentsCache[idx], ...payload };
      }
    }
    this._appointmentsLastFetch = Date.now();
    try {
      if (this._appointmentsCache) {
        localStorage.setItem('ascpt_cached_appointments', JSON.stringify(this._appointmentsCache));
        localStorage.setItem('ascpt_appointments_last_sync', String(Date.now()));
      }
    } catch (_) {}
    return { id: apptId, ...payload };
  }

  async updateAppointmentStatus(apptId, status, meta = {}) {
    return await this.updateAppointment(apptId, {
      status,
      ...meta,
      statusUpdatedAt: new Date().toISOString()
    });
  }

  async deleteAppointment(apptId) {
    this.ensureConnected();
    await deleteDoc(doc(firestoreDb, 'appointments', apptId));
    try {
      this._suppressNextOwnAppointmentsVersionEvent = true;
      await setDoc(doc(firestoreDb, 'meta', 'syncVersion'), {
        appointmentsVersion: increment(1),
        lastChangedAppointmentId: apptId,
        lastChangedAppointmentAction: 'deleted'
      }, { merge: true });
    } catch (verErr) {
      console.warn('Failed to increment appointmentsVersion:', verErr);
    }

    // Update in-memory cache and localStorage synchronously
    if (this._appointmentsCache) {
      this._appointmentsCache = this._appointmentsCache.filter(a => a.id !== apptId);
    }
    this._appointmentsLastFetch = Date.now();
    try {
      localStorage.setItem('ascpt_cached_appointments', JSON.stringify(this._appointmentsCache || []));
      localStorage.setItem('ascpt_appointments_last_sync', String(Date.now()));
    } catch (_) {}
  }

  // ================= 9.1 Shift Overrides (Temporary Doctor Coverage) =================
  async getShiftOverrides(dateStr = null, forceRefresh = false) {
    this.ensureConnected();
    const now = Date.now();
    if (!forceRefresh && this._shiftOverridesCache && (now - this._shiftOverridesLastFetch < this.CACHE_TTL)) {
      if (dateStr) return this._shiftOverridesCache.filter((o) => o.date === dateStr);
      return [...this._shiftOverridesCache];
    }
    try {
      const snap = await getDocs(collection(firestoreDb, 'shift_overrides'));
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      this._shiftOverridesCache = all;
      this._shiftOverridesLastFetch = now;
      if (dateStr) {
        return all.filter((o) => o.date === dateStr);
      }
      return all;
    } catch (err) {
      if (this._shiftOverridesCache) {
        if (dateStr) return this._shiftOverridesCache.filter((o) => o.date === dateStr);
        return [...this._shiftOverridesCache];
      }
      console.warn('getShiftOverrides notice:', err.message);
      return [];
    }
  }

  async addShiftOverride(overrideData) {
    this.ensureConnected();
    const docId = `${overrideData.doctorUid}_${overrideData.date}`;
    const ref = doc(firestoreDb, 'shift_overrides', docId);
    const payload = {
      ...overrideData,
      id: docId,
      createdAt: new Date().toISOString()
    };
    await setDoc(ref, payload);
    if (this._shiftOverridesCache) {
      const idx = this._shiftOverridesCache.findIndex(o => o.id === docId);
      if (idx !== -1) {
        this._shiftOverridesCache[idx] = payload;
      } else {
        this._shiftOverridesCache.push(payload);
      }
      this._shiftOverridesLastFetch = Date.now();
    }
    return payload;
  }

  async deleteShiftOverride(overrideId) {
    this.ensureConnected();
    await deleteDoc(doc(firestoreDb, 'shift_overrides', overrideId));
    if (this._shiftOverridesCache) {
      this._shiftOverridesCache = this._shiftOverridesCache.filter(o => o.id !== overrideId);
      this._shiftOverridesLastFetch = Date.now();
    }
  }

  // ================= 8. Backup & Restore =================
  // NOTE: `users` and `audit_logs` are intentionally excluded from backups.
  // Staff accounts must only ever be created/changed through the vetted
  // admin API (api/admin/users.js), never by restoring arbitrary JSON, and
  // restoring old audit entries would corrupt the audit trail's true
  // chronological order.
  async createFullBackup() {
    this.ensureConnected();

    const [patients, sessions, expenses, appointments, insuranceLetters, insuranceClaims] = await Promise.all([
      this.getPatients(),
      this.getSessions(),
      this.getExpenses(),
      this.getAppointments(),
      this.getInsuranceLetters(),
      this.getInsuranceClaims()
    ]);

    const clinicalOptionsSnap = await getDocs(collection(firestoreDb, 'clinical_options'));
    const clinicalOptions = {};
    clinicalOptionsSnap.forEach((d) => { clinicalOptions[d.id] = d.data(); });

    const insuranceSnap = await getDocs(collection(firestoreDb, 'insurance_companies'));
    const insuranceCompanies = {};
    insuranceSnap.forEach((d) => { insuranceCompanies[d.id] = d.data(); });

    return {
      backupVersion: 1,
      clinicName: CLINIC_CONFIG?.name || 'ASCPT',
      timestamp: new Date().toISOString(),
      counts: {
        patients: patients.length,
        sessions: sessions.length,
        expenses: expenses.length,
        appointments: appointments.length,
        insuranceLetters: insuranceLetters.length,
        insuranceClaims: insuranceClaims.length
      },
      patients,
      sessions,
      expenses,
      appointments,
      insuranceLetters,
      insuranceClaims,
      clinicalOptions,
      insuranceCompanies
    };
  }

  async restoreFromBackup(data) {
    this.ensureConnected();
    if (!data || typeof data !== 'object') {
      throw new Error('ملف النسخة الاحتياطية غير صالح أو تالف.');
    }

    const restoreCollection = async (collectionName, items) => {
      if (!Array.isArray(items) || items.length === 0) return;
      let batch = writeBatch(firestoreDb);
      let opsInBatch = 0;
      for (const item of items) {
        if (!item || !item.id) continue; // skip malformed entries defensively
        batch.set(doc(firestoreDb, collectionName, item.id), item, { merge: true });
        opsInBatch++;
        if (opsInBatch >= 450) { // stay safely under Firestore's 500-op batch limit
          await batch.commit();
          batch = writeBatch(firestoreDb);
          opsInBatch = 0;
        }
      }
      if (opsInBatch > 0) {
        await batch.commit();
      }
    };

    await restoreCollection('patients', data.patients);
    await restoreCollection('sessions', data.sessions);
    await restoreCollection('expenses', data.expenses);
    await restoreCollection('appointments', data.appointments);
    await restoreCollection('insurance_letters', data.insuranceLetters);

    if (data.clinicalOptions && typeof data.clinicalOptions === 'object') {
      for (const [category, value] of Object.entries(data.clinicalOptions)) {
        await setDoc(doc(firestoreDb, 'clinical_options', category), value, { merge: true });
      }
    }

    if (data.insuranceCompanies && typeof data.insuranceCompanies === 'object') {
      for (const [type, value] of Object.entries(data.insuranceCompanies)) {
        await setDoc(doc(firestoreDb, 'insurance_companies', type), value, { merge: true });
      }
    }

    // Force a fresh read next time options/companies are needed, since the
    // in-memory caches may now be stale relative to what was just restored.
    this.invalidateAllCaches();
    this.clinicalOptionsCache = null;
    this.insuranceCompaniesCache = null;
    this._optionsLoaded = false;
    await this.syncAndSeedCloudOptions();
  }

  // ================= 11. Patient Medical Imaging & Lab Reports (v1.4.81) =================
  async getPatientImages(patientId) {
    this.ensureConnected();
    if (!patientId) return [];
    try {
      const imageMap = new Map();

      // 1. Primary: Fetch from dedicated Subcollection 'patients/{patientId}/images'
      try {
        const snap = await getDocs(collection(firestoreDb, 'patients', patientId, 'images'));
        snap.docs.forEach((d) => {
          imageMap.set(d.id, { id: d.id, ...d.data() });
        });
      } catch (subErr) {
        console.warn('Subcollection images fetch notice:', subErr.message);
      }

      // 2. Legacy fallback: Read from parent patient document (imagingFiles or clinicalSheet.images)
      try {
        const pSnap = await getDoc(doc(firestoreDb, 'patients', patientId));
        if (pSnap.exists()) {
          const pData = pSnap.data();
          if (Array.isArray(pData.imagingFiles)) {
            pData.imagingFiles.forEach((img) => {
              if (img && img.id && !imageMap.has(img.id)) {
                imageMap.set(img.id, img);
              }
            });
          }
          if (pData.clinicalSheet && Array.isArray(pData.clinicalSheet.images)) {
            pData.clinicalSheet.images.forEach((img) => {
              if (img && img.id && !imageMap.has(img.id)) {
                imageMap.set(img.id, img);
              }
            });
          }
        }
      } catch (docErr) {
        console.warn('Patient document imagingFiles fetch notice:', docErr.message);
      }

      return Array.from(imageMap.values()).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    } catch (err) {
      console.error('getPatientImages error:', err);
      return [];
    }
  }

  async addPatientImage(patientId, imageData) {
    this.ensureConnected();
    if (!patientId) throw new Error('patientId is required');

    const imageId = 'img_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    const payload = {
      id: imageId,
      patientId,
      title: imageData.title || 'أشعة / تحليل',
      category: imageData.category || 'other',
      notes: imageData.notes || '',
      dataUrl: imageData.dataUrl,
      createdAt: new Date().toISOString(),
      createdBy: imageData.createdBy || '',
      createdByUid: imageData.createdByUid || ''
    };

    // 1. Primary: Save directly to subcollection 'patients/{patientId}/images/{imageId}'
    // This perfectly matches Firestore Security Rule: match /images/{imageId} { allow read, write: if isUserActive(); }
    // and completely prevents hitting the 1MB Firestore document limit on the main patient record!
    try {
      const imgDocRef = doc(firestoreDb, 'patients', patientId, 'images', imageId);
      await setDoc(imgDocRef, payload);
      return payload;
    } catch (err) {
      console.warn('Subcollection image write notice, attempting fallback to document array:', err.message);
      // 2. Fallback: If subcollection write fails, try updating patient document directly
      try {
        const pRef = doc(firestoreDb, 'patients', patientId);
        const pSnap = await getDoc(pRef);
        if (pSnap.exists()) {
          const currentList = Array.isArray(pSnap.data().imagingFiles) ? pSnap.data().imagingFiles : [];
          const updatedList = [payload, ...currentList].slice(0, 20);
          await updateDoc(pRef, {
            imagingFiles: updatedList,
            lastUpdatedAt: new Date().toISOString(),
            lastUpdatedBy: imageData.createdBy || 'طاقم المركز'
          });
          return payload;
        }
      } catch (fallbackErr) {
        console.error('addPatientImage fallback error:', fallbackErr);
      }
      throw err;
    }
  }

  async updatePatientImage(patientId, imageId, updates) {
    this.ensureConnected();
    if (!patientId || !imageId || !updates) return false;

    let updated = false;

    // 1. Try updating in subcollection 'patients/{patientId}/images/{imageId}'
    try {
      const imgRef = doc(firestoreDb, 'patients', patientId, 'images', imageId);
      const imgSnap = await getDoc(imgRef);
      if (imgSnap.exists()) {
        await updateDoc(imgRef, {
          ...updates,
          lastUpdatedAt: new Date().toISOString()
        });
        updated = true;
      }
    } catch (subErr) {
      console.warn('Subcollection image update notice:', subErr.message);
    }

    // 2. Also check / update in parent patient document imagingFiles (for legacy records)
    try {
      const pRef = doc(firestoreDb, 'patients', patientId);
      const pSnap = await getDoc(pRef);
      if (pSnap.exists()) {
        const pData = pSnap.data();
        if (Array.isArray(pData.imagingFiles)) {
          const list = [...pData.imagingFiles];
          const idx = list.findIndex((img) => img.id === imageId);
          if (idx !== -1) {
            list[idx] = { ...list[idx], ...updates, lastUpdatedAt: new Date().toISOString() };
            await updateDoc(pRef, { imagingFiles: list, lastUpdatedAt: new Date().toISOString() });
            updated = true;
          }
        }
      }
    } catch (docErr) {
      console.warn('Patient document imagingFiles update notice:', docErr.message);
    }

    return updated;
  }

  async deletePatientImage(patientId, imageId) {
    this.ensureConnected();
    if (!patientId || !imageId) return;

    try {
      // 1. Delete from subcollection
      try {
        await deleteDoc(doc(firestoreDb, 'patients', patientId, 'images', imageId));
      } catch (subErr) {
        console.warn('Subcollection image delete notice:', subErr.message);
      }

      // 2. Also remove from patient document imagingFiles if it was saved there (legacy cleanup)
      try {
        const pRef = doc(firestoreDb, 'patients', patientId);
        const pSnap = await getDoc(pRef);
        if (pSnap.exists()) {
          const currentList = Array.isArray(pSnap.data().imagingFiles) ? pSnap.data().imagingFiles : [];
          if (currentList.some((img) => img.id === imageId)) {
            const updatedList = currentList.filter((img) => img.id !== imageId);
            await updateDoc(pRef, {
              imagingFiles: updatedList,
              lastUpdatedAt: new Date().toISOString()
            });
          }
        }
      } catch (docErr) {
        console.warn('Patient document imagingFiles delete notice:', docErr.message);
      }
    } catch (err) {
      console.error('deletePatientImage error:', err);
      throw err;
    }
  }
}

export const db = new FirestoreDatabaseService();
