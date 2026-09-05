// ========================================================
// ASCPT - Authoritative Cloud Firestore Data Access Layer
// Single Source of Truth: Firestore + Built-in IndexedDB Persistence
// No Parallel LocalStorage Fallback for Authoritative Clinical Records
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

class FirestoreDatabaseService {
  constructor() {
    this.purgeLegacyDemoStorage();
    this.clinicalOptionsCache = null;
    this.insuranceCompaniesCache = null;
    this.syncAndSeedCloudOptions();
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
  async getPatients() {
    this.ensureConnected();
    try {
      const q = query(collection(firestoreDb, 'patients'), orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ ...d.data(), id: d.id }));
    } catch (err) {
      console.error('Firestore getPatients error:', err);
      throw new Error('تعذر تحميل سجل المرضى من قاعدة البيانات.');
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
      return isEdit ? 'updated' : 'created';
    } catch (err) {
      console.error('Firestore savePatient error:', err);
      throw new Error('فشل حفظ بيانات المريض في قاعدة البيانات.');
    }
  }

  async deletePatient(patientId) {
    this.ensureConnected();
    try {
      await deleteDoc(doc(firestoreDb, 'patients', patientId));
      return true;
    } catch (err) {
      console.error('Firestore deletePatient error:', err);
      throw new Error('فشل حذف ملف المريض من قاعدة البيانات.');
    }
  }

  // ================= 2. Sessions Management =================
  async getSessions(filterDate = null) {
    this.ensureConnected();
    try {
      const q = query(collection(firestoreDb, 'sessions'), orderBy('date', 'desc'));
      const snap = await getDocs(q);
      let sessions = snap.docs.map(d => ({ ...d.data(), id: d.id }));

      if (filterDate) {
        if (filterDate.length === 7) {
          return sessions.filter(s => s.date && s.date.startsWith(filterDate));
        }
        return sessions.filter(s => s.date === filterDate);
      }
      return sessions;
    } catch (err) {
      console.error('Firestore getSessions error:', err);
      throw new Error('تعذر جلب سجل الجلسات من قاعدة البيانات.');
    }
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
      return true;
    } catch (err) {
      console.error('Firestore deleteSession error:', err);
      throw new Error('فشل حذف الجلسة من قاعدة البيانات.');
    }
  }

  // ================= 3. Expenses Management =================
  async getExpenses(filterDate = null) {
    this.ensureConnected();
    try {
      const q = query(collection(firestoreDb, 'expenses'), orderBy('date', 'desc'));
      const snap = await getDocs(q);
      let expenses = snap.docs.map(d => ({ ...d.data(), id: d.id }));

      if (filterDate) {
        if (filterDate.length === 7) {
          return expenses.filter(e => e.date && e.date.startsWith(filterDate));
        }
        return expenses.filter(e => e.date === filterDate);
      }
      return expenses;
    } catch (err) {
      console.error('Firestore getExpenses error:', err);
      throw new Error('تعذر تحميل المصروفات من قاعدة البيانات.');
    }
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
      return true;
    } catch (err) {
      console.error('Firestore deleteExpense error:', err);
      throw new Error('فشل حذف المصروف.');
    }
  }

  // ================= 4. Users & Doctors Directory =================
  async getUsers() {
    this.ensureConnected();
    try {
      const snap = await getDocs(collection(firestoreDb, 'users'));
      return snap.docs.map(d => ({ ...d.data(), id: d.id }));
    } catch (err) {
      console.error('Firestore getUsers error:', err);
      return [];
    }
  }

  async getDoctors() {
    this.ensureConnected();
    try {
      const users = await this.getUsers();
      const doctorMap = new Map();

      // Collect all active doctors and admins from registered users in Firestore
      users
        .filter(u => (u.role === 'doctor' || u.role === 'admin') && u.active !== false && u.name)
        .forEach(u => {
          const norm = u.name.trim().replace(/\s+/g, ' ');
          if (norm && !doctorMap.has(norm)) {
            doctorMap.set(norm, norm);
          }
        });

      // Fallback only if no staff users exist yet in Firestore
      if (doctorMap.size === 0 && CLINIC_CONFIG.director?.name) {
        const dirNorm = CLINIC_CONFIG.director.name.trim().replace(/\s+/g, ' ');
        doctorMap.set(dirNorm, dirNorm);
      }

      return Array.from(doctorMap.values());
    } catch (err) {
      console.error('Firestore getDoctors error:', err);
      return CLINIC_CONFIG.director?.name ? [CLINIC_CONFIG.director.name.trim().replace(/\s+/g, ' ')] : [];
    }
  }

  // ================= 5. Audit Trail =================
  async getAuditLogs() {
    this.ensureConnected();
    try {
      const q = query(collection(firestoreDb, 'audit_logs'), orderBy('timestampRaw', 'desc'));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ ...d.data(), id: d.id }));
    } catch (err) {
      console.warn('Firestore getAuditLogs error:', err.message);
      return [];
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
      ]
    };

    if (this.clinicalOptionsCache && this.clinicalOptionsCache[category]) {
      return this.clinicalOptionsCache[category];
    }
    return defaults[category] || [];
  }

  async syncAndSeedCloudOptions() {
    if (!this.isCloud) return;

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

    const insuranceDefaults = {
      direct: ['أكسا (AXA)', 'أليانز (Allianz)', 'ميتلايف (MetLife)', 'بوبا (Bupa)', 'عناية الرعاية الصحية (Enaya)'],
      indirect: ['نكست كير (NextCare)', 'مصر للتأمين', 'ايجي كير', 'المهندس للتأمين']
    };

    this.clinicalOptionsCache = this.clinicalOptionsCache || {};
    this.insuranceCompaniesCache = this.insuranceCompaniesCache || {};

    // 1. Seed & Sync Clinical Options (modality, procedure, exercise)
    for (const cat of ['modality', 'procedure', 'exercise']) {
      try {
        const docRef = doc(firestoreDb, 'clinical_options', cat);
        const snap = await getDoc(docRef);
        if (snap.exists() && Array.isArray(snap.data().items) && snap.data().items.length > 0) {
          this.clinicalOptionsCache[cat] = snap.data().items;
        } else {
          const defaultItems = defaults[cat] || [];
          this.clinicalOptionsCache[cat] = defaultItems;
          await setDoc(docRef, { items: defaultItems }, { merge: true });
        }
      } catch (err) {
        // Fallback to defaults in memory
        if (!this.clinicalOptionsCache[cat]) {
          this.clinicalOptionsCache[cat] = defaults[cat] || [];
        }
      }
    }

    // 2. Seed & Sync Insurance Companies (direct, indirect)
    for (const cType of ['direct', 'indirect']) {
      try {
        const docRef = doc(firestoreDb, 'insurance_companies', cType);
        const snap = await getDoc(docRef);
        if (snap.exists() && Array.isArray(snap.data().companies) && snap.data().companies.length > 0) {
          this.insuranceCompaniesCache[cType] = snap.data().companies;
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
  }

  async syncClinicalOptionsFromFirestore() {
    await this.syncAndSeedCloudOptions();
  }

  async addClinicalOption(category, name) {
    this.ensureConnected();
    const currentList = this.getClinicalOptions(category);
    if (!currentList.includes(name.trim())) {
      const updatedList = [...currentList, name.trim()];
      this.clinicalOptionsCache = this.clinicalOptionsCache || {};
      this.clinicalOptionsCache[category] = updatedList;
      await setDoc(doc(firestoreDb, 'clinical_options', category), { items: updatedList }, { merge: true });
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
    await setDoc(doc(firestoreDb, 'clinical_options', category), { items: updatedList }, { merge: true });
    return updatedList;
  }

  // ================= 7. Insurance Companies =================
  getInsuranceCompanies(contractType = 'direct') {
    const defaults = {
      direct: ['أكسا (AXA)', 'أليانز (Allianz)', 'ميتلايف (MetLife)', 'بوبا (Bupa)', 'عناية الرعاية الصحية (Enaya)'],
      indirect: ['نكست كير (NextCare)', 'مصر للتأمين', 'ايجي كير', 'المهندس للتأمين']
    };

    if (this.insuranceCompaniesCache && this.insuranceCompaniesCache[contractType]) {
      return this.insuranceCompaniesCache[contractType];
    }
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

  async syncInsuranceCompaniesFromFirestore() {
    await this.syncAndSeedCloudOptions();
  }

  async addInsuranceCompany(contractType, name) {
    this.ensureConnected();
    const currentList = this.getInsuranceCompanies(contractType);
    if (!currentList.includes(name.trim())) {
      const updatedList = [...currentList, name.trim()];
      this.insuranceCompaniesCache = this.insuranceCompaniesCache || {};
      this.insuranceCompaniesCache[contractType] = updatedList;
      await setDoc(doc(firestoreDb, 'insurance_companies', contractType), { companies: updatedList }, { merge: true });
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
    await setDoc(doc(firestoreDb, 'insurance_companies', contractType), { companies: updatedList }, { merge: true });
    return updatedList;
  }
}

export const db = new FirestoreDatabaseService();
