// ========================================================
// ASCPT - Production Cloud Firestore Database Service
// Real-time Cloud Synchronization & Offline Persistence Layer
// Single-Tenant Direct Collection Architecture
// ========================================================

import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  deleteDoc,
  query,
  orderBy
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

import { firestoreDb, isConfigured } from './firebase-init.js';
import { CLINIC_CONFIG } from './clinic-config.js';

const withTimeout = (promise, ms = 3500) => {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Firestore timeout')), ms))
  ]);
};

class FirestoreDatabaseService {
  constructor() {
    this.purgeLegacyDemoStorage();
    this.syncOptionsFromFirestore();
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
      'pc_claim_treatments'
    ];
    legacyKeys.forEach(k => {
      try { localStorage.removeItem(k); } catch (_) {}
    });
  }

  // ================= 1. Patients Management =================
  async getPatients() {
    if (this.isCloud) {
      try {
        const q = query(collection(firestoreDb, 'patients'), orderBy('createdAt', 'desc'));
        const snap = await withTimeout(getDocs(q), 3500);
        const list = snap.docs.map(d => ({ ...d.data(), id: d.id }));
        localStorage.setItem('ascpt_patients', JSON.stringify(list));
        return list;
      } catch (err) {
        console.warn('Firestore getPatients fallback to local cache:', err.message);
      }
    }
    const raw = localStorage.getItem('ascpt_patients');
    return raw ? JSON.parse(raw) : [];
  }

  async savePatient(patientData, currentUser) {
    const patientId = patientData.id || ('p-' + Date.now());
    const isEdit = Boolean(patientData.id);

    const dataToSave = {
      ...patientData,
      id: patientId,
      lastUpdatedAt: new Date().toISOString(),
      lastUpdatedBy: currentUser?.name || 'طبيب المركز'
    };

    if (!isEdit) {
      dataToSave.createdAt = new Date().toISOString();
      dataToSave.createdBy = currentUser?.name || 'استقبال المركز';
    }

    // 1. Instant local cache update so UI responds immediately
    const cachedPatients = await this.getPatients();
    if (isEdit) {
      const idx = cachedPatients.findIndex(p => p.id === patientId);
      if (idx !== -1) cachedPatients[idx] = dataToSave;
    } else {
      cachedPatients.unshift(dataToSave);
    }
    localStorage.setItem('ascpt_patients', JSON.stringify(cachedPatients));

    // 2. Cloud Firestore sync
    if (this.isCloud) {
      try {
        await withTimeout(setDoc(doc(firestoreDb, 'patients', patientId), dataToSave, { merge: true }), 3500);
      } catch (err) {
        console.warn('Firestore savePatient queued/offline:', err.message);
      }
    }

    return isEdit ? 'updated' : 'created';
  }

  async deletePatient(patientId) {
    let cachedPatients = await this.getPatients();
    cachedPatients = cachedPatients.filter(p => p.id !== patientId);
    localStorage.setItem('ascpt_patients', JSON.stringify(cachedPatients));

    if (this.isCloud) {
      try {
        await withTimeout(deleteDoc(doc(firestoreDb, 'patients', patientId)), 3500);
      } catch (err) {
        console.warn('Firestore deletePatient notice:', err.message);
      }
    }
    return true;
  }

  // ================= 2. Sessions Management =================
  async getSessions(filterDate = null) {
    let sessions = [];
    if (this.isCloud) {
      try {
        const snap = await withTimeout(getDocs(collection(firestoreDb, 'sessions')), 3500);
        sessions = snap.docs.map(d => ({ ...d.data(), id: d.id }));
        localStorage.setItem('ascpt_sessions', JSON.stringify(sessions));
      } catch (err) {
        const raw = localStorage.getItem('ascpt_sessions');
        sessions = raw ? JSON.parse(raw) : [];
      }
    } else {
      const raw = localStorage.getItem('ascpt_sessions');
      sessions = raw ? JSON.parse(raw) : [];
    }

    if (filterDate) {
      if (filterDate.length === 7) {
        return sessions.filter(s => s.date && s.date.startsWith(filterDate));
      }
      return sessions.filter(s => s.date === filterDate);
    }
    return sessions;
  }

  async saveSession(sessionData, currentUser) {
    const sessionId = sessionData.id || ('sess-' + Date.now());
    const isEdit = Boolean(sessionData.id);

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

    const sessions = await this.getSessions();
    if (isEdit) {
      const idx = sessions.findIndex(s => s.id === sessionId);
      if (idx !== -1) sessions[idx] = dataToSave;
    } else {
      sessions.unshift(dataToSave);
    }
    localStorage.setItem('ascpt_sessions', JSON.stringify(sessions));

    if (this.isCloud) {
      try {
        await withTimeout(setDoc(doc(firestoreDb, 'sessions', sessionId), dataToSave, { merge: true }), 3500);
      } catch (err) {
        console.warn('Firestore saveSession queued/offline:', err.message);
      }
    }

    return dataToSave;
  }

  async deleteSession(sessionId) {
    let sessions = await this.getSessions();
    sessions = sessions.filter(s => s.id !== sessionId);
    localStorage.setItem('ascpt_sessions', JSON.stringify(sessions));

    if (this.isCloud) {
      try {
        await withTimeout(deleteDoc(doc(firestoreDb, 'sessions', sessionId)), 3500);
      } catch (err) {
        console.warn('Firestore deleteSession notice:', err.message);
      }
    }
    return true;
  }

  // ================= 3. Expenses Management =================
  async getExpenses(filterDate = null) {
    let expenses = [];
    if (this.isCloud) {
      try {
        const snap = await withTimeout(getDocs(collection(firestoreDb, 'expenses')), 3500);
        expenses = snap.docs.map(d => ({ ...d.data(), id: d.id }));
        localStorage.setItem('ascpt_expenses', JSON.stringify(expenses));
      } catch (err) {
        const raw = localStorage.getItem('ascpt_expenses');
        expenses = raw ? JSON.parse(raw) : [];
      }
    } else {
      const raw = localStorage.getItem('ascpt_expenses');
      expenses = raw ? JSON.parse(raw) : [];
    }

    if (filterDate) {
      if (filterDate.length === 7) {
        return expenses.filter(e => e.date && e.date.startsWith(filterDate));
      }
      return expenses.filter(e => e.date === filterDate);
    }
    return expenses;
  }

  async saveExpense(expenseData, currentUser) {
    const expenseId = expenseData.id || ('exp-' + Date.now());
    const dataToSave = {
      ...expenseData,
      id: expenseId,
      time: new Date().toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' }),
      recordedBy: currentUser?.name || 'مدير المركز',
      createdAt: new Date().toISOString()
    };

    const expenses = await this.getExpenses();
    expenses.unshift(dataToSave);
    localStorage.setItem('ascpt_expenses', JSON.stringify(expenses));

    if (this.isCloud) {
      try {
        await withTimeout(setDoc(doc(firestoreDb, 'expenses', expenseId), dataToSave, { merge: true }), 3500);
      } catch (err) {
        console.warn('Firestore saveExpense notice:', err.message);
      }
    }
    return dataToSave;
  }

  async deleteExpense(expenseId) {
    let expenses = await this.getExpenses();
    expenses = expenses.filter(e => e.id !== expenseId);
    localStorage.setItem('ascpt_expenses', JSON.stringify(expenses));

    if (this.isCloud) {
      try {
        await withTimeout(deleteDoc(doc(firestoreDb, 'expenses', expenseId)), 3500);
      } catch (err) {
        console.warn('Firestore deleteExpense notice:', err.message);
      }
    }
    return true;
  }

  // ================= 4. Users & Doctors Directory =================
  async getUsers() {
    if (this.isCloud) {
      try {
        const snap = await withTimeout(getDocs(collection(firestoreDb, 'users')), 3000);
        const users = snap.docs.map(d => ({ ...d.data(), id: d.id }));
        localStorage.setItem('ascpt_users', JSON.stringify(users));
        return users;
      } catch (err) {
        const raw = localStorage.getItem('ascpt_users');
        return raw ? JSON.parse(raw) : [];
      }
    }
    const raw = localStorage.getItem('ascpt_users');
    return raw ? JSON.parse(raw) : [];
  }

  async saveUser(userData) {
    const userId = userData.uid || userData.id || ('u-' + Date.now());
    const dataToSave = { ...userData, id: userId, uid: userId };

    const users = await this.getUsers();
    const idx = users.findIndex(u => u.id === userId);
    if (idx !== -1) {
      users[idx] = dataToSave;
    } else {
      users.push(dataToSave);
    }
    localStorage.setItem('ascpt_users', JSON.stringify(users));

    if (this.isCloud) {
      try {
        await withTimeout(setDoc(doc(firestoreDb, 'users', userId), dataToSave, { merge: true }), 3000);
      } catch (err) {
        console.warn('Firestore saveUser notice:', err.message);
      }
    }
    return dataToSave;
  }

  async deleteUser(userId) {
    let users = await this.getUsers();
    users = users.filter(u => u.id !== userId);
    localStorage.setItem('ascpt_users', JSON.stringify(users));

    if (this.isCloud) {
      try {
        await withTimeout(deleteDoc(doc(firestoreDb, 'users', userId)), 3000);
      } catch (err) {
        console.warn('Firestore deleteUser notice:', err.message);
      }
    }
    return true;
  }

  async getDoctors() {
    const users = await this.getUsers();
    const docs = users.filter(u => (u.role === 'doctor' || u.role === 'admin') && u.active !== false).map(u => u.name);

    // Dr. Hosny Ahmed El-Gweily is always available as the center's director consultant
    if (CLINIC_CONFIG.director?.name && !docs.includes(CLINIC_CONFIG.director.name)) {
      docs.unshift(CLINIC_CONFIG.director.name);
    }
    return Array.from(new Set(docs));
  }

  // ================= 5. Audit Trail =================
  async getAuditLogs() {
    if (this.isCloud) {
      try {
        const snap = await withTimeout(getDocs(collection(firestoreDb, 'audit_logs')), 3000);
        const logs = snap.docs.map(d => ({ ...d.data(), id: d.id }));
        logs.sort((a, b) => (b.timestampRaw || 0) - (a.timestampRaw || 0));
        localStorage.setItem('ascpt_audit', JSON.stringify(logs));
        return logs;
      } catch (err) {
        const raw = localStorage.getItem('ascpt_audit');
        return raw ? JSON.parse(raw) : [];
      }
    }
    const raw = localStorage.getItem('ascpt_audit');
    return raw ? JSON.parse(raw) : [];
  }

  async logAudit(actionType, description, user) {
    const logId = 'log-' + Date.now();
    const logData = {
      id: logId,
      actionType,
      description,
      userId: user?.uid || user?.id || 'system',
      userName: user?.name || 'مستخدم المركز',
      userRole: user?.role || 'staff',
      timestamp: new Date().toLocaleString('ar-EG-u-nu-latn'),
      timestampRaw: Date.now()
    };

    const logs = await this.getAuditLogs();
    logs.unshift(logData);
    if (logs.length > 200) logs.pop();
    localStorage.setItem('ascpt_audit', JSON.stringify(logs));

    if (this.isCloud) {
      try {
        await withTimeout(setDoc(doc(firestoreDb, 'audit_logs', logId), logData), 3000);
      } catch (err) {
        console.warn('Firestore logAudit notice:', err.message);
      }
    }
  }

  // ================= 6. Synchronous Clinical Options (With Background Cloud Sync) =================
  // MUST remain synchronous so that UI renders (renderCategoryChips, renderAllClinicalChips)
  // receive an immediate Array and NEVER throw '.map() on Promise'
  getClinicalOptions(category) {
    const key = 'ascpt_opt_' + category;
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
      ]
    };

    const raw = localStorage.getItem(key);
    if (raw) {
      try { return JSON.parse(raw); } catch (_) {}
    }
    const list = defaults[category] || [];
    localStorage.setItem(key, JSON.stringify(list));
    return list;
  }

  async addClinicalOption(category, name) {
    const list = this.getClinicalOptions(category);
    if (!list.includes(name.trim())) {
      list.push(name.trim());
      const key = 'ascpt_opt_' + category;
      localStorage.setItem(key, JSON.stringify(list));

      if (this.isCloud) {
        try {
          await withTimeout(setDoc(doc(firestoreDb, 'clinical_options', category), { items: list }, { merge: true }), 3000);
        } catch (_) {}
      }
    }
    return list;
  }

  async deleteClinicalOption(category, name) {
    let list = this.getClinicalOptions(category);
    list = list.filter(item => item !== name.trim());
    const key = 'ascpt_opt_' + category;
    localStorage.setItem(key, JSON.stringify(list));

    if (this.isCloud) {
      try {
        await withTimeout(setDoc(doc(firestoreDb, 'clinical_options', category), { items: list }, { merge: true }), 3000);
      } catch (_) {}
    }
    return list;
  }

  // ================= 7. Synchronous Insurance Companies (With Background Cloud Sync) =================
  // MUST remain synchronous so that UI renders (renderInsuranceChips in sessions & patients)
  // receive an immediate Array and NEVER throw '.map() on Promise'
  getInsuranceCompanies(contractType = 'direct') {
    const key = 'ascpt_ins_' + contractType;
    const defaults = {
      direct: ['أكسا (AXA)', 'أليانز (Allianz)', 'ميتلايف (MetLife)', 'بوبا (Bupa)', 'عناية الرعاية الصحية (Enaya)'],
      indirect: ['نكست كير (NextCare)', 'مصر للتأمين', 'ايجي كير', 'المهندس للتأمين']
    };

    const raw = localStorage.getItem(key);
    if (raw) {
      try { return JSON.parse(raw); } catch (_) {}
    }
    const list = defaults[contractType] || [];
    localStorage.setItem(key, JSON.stringify(list));
    return list;
  }

  getAllInsuranceCompaniesWithTypes() {
    const direct = this.getInsuranceCompanies('direct');
    const indirect = this.getInsuranceCompanies('indirect');
    const res = [];
    direct.forEach(name => res.push({ name, contractType: 'direct', label: `${name} (تعاقد مباشر)` }));
    indirect.forEach(name => res.push({ name, contractType: 'indirect', label: `${name} (تعاقد غير مباشر)` }));
    return res;
  }

  async addInsuranceCompany(contractType, name) {
    const list = this.getInsuranceCompanies(contractType);
    if (!list.includes(name.trim())) {
      list.push(name.trim());
      const key = 'ascpt_ins_' + contractType;
      localStorage.setItem(key, JSON.stringify(list));

      if (this.isCloud) {
        try {
          await withTimeout(setDoc(doc(firestoreDb, 'insurance_companies', contractType), { companies: list }, { merge: true }), 3000);
        } catch (_) {}
      }
    }
    return list;
  }

  async deleteInsuranceCompany(contractType, name) {
    let list = this.getInsuranceCompanies(contractType);
    list = list.filter(item => item !== name.trim());
    const key = 'ascpt_ins_' + contractType;
    localStorage.setItem(key, JSON.stringify(list));

    if (this.isCloud) {
      try {
        await withTimeout(setDoc(doc(firestoreDb, 'insurance_companies', contractType), { companies: list }, { merge: true }), 3000);
      } catch (_) {}
    }
    return list;
  }

  // Background Cloud Options Sync
  async syncOptionsFromFirestore() {
    if (!this.isCloud) return;
    try {
      // Sync clinical options
      for (const cat of ['modality', 'procedure', 'exercise']) {
        const snap = await withTimeout(getDoc(doc(firestoreDb, 'clinical_options', cat)), 2000);
        if (snap.exists() && Array.isArray(snap.data().items)) {
          localStorage.setItem('ascpt_opt_' + cat, JSON.stringify(snap.data().items));
        }
      }
      // Sync insurance companies
      for (const cType of ['direct', 'indirect']) {
        const snap = await withTimeout(getDoc(doc(firestoreDb, 'insurance_companies', cType)), 2000);
        if (snap.exists() && Array.isArray(snap.data().companies)) {
          localStorage.setItem('ascpt_ins_' + cType, JSON.stringify(snap.data().companies));
        }
      }
    } catch (_) {}
  }

  // ================= 8. Backup & Restore =================
  async createFullBackup() {
    return {
      timestamp: new Date().toISOString(),
      center: 'مركز اسكندرية التخصصي للعلاج الطبيعي (ASCPT)',
      director: CLINIC_CONFIG.director.name,
      contact: CLINIC_CONFIG.contact,
      patients: await this.getPatients(),
      sessions: await this.getSessions(),
      expenses: await this.getExpenses(),
      users: await this.getUsers(),
      auditLogs: await this.getAuditLogs()
    };
  }

  async restoreFromBackup(backupData) {
    if (!backupData || !Array.isArray(backupData.patients)) {
      throw new Error('الملف غير صالح');
    }
    for (const p of backupData.patients || []) {
      await this.savePatient(p, { name: 'استعادة نسخة احتياطية' });
    }
    for (const s of backupData.sessions || []) {
      await this.saveSession(s, { name: 'استعادة نسخة احتياطية' });
    }
    for (const e of backupData.expenses || []) {
      await this.saveExpense(e, { name: 'استعادة نسخة احتياطية' });
    }
    return true;
  }
}

export const db = new FirestoreDatabaseService();
