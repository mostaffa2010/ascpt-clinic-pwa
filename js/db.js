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
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  limit,
  where,
  writeBatch
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
      const snap = await getDocs(collection(firestoreDb, 'patients'));
      const list = snap.docs.map(d => ({ ...d.data(), id: d.id }));
      return list.sort((a, b) => {
        const tA = a.createdAt || a.lastUpdatedAt || '';
        const tB = b.createdAt || b.lastUpdatedAt || '';
        return tB.localeCompare(tA);
      });
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
          sessions = sessions.filter(s => s.date && s.date.startsWith(filterDate));
        } else {
          sessions = sessions.filter(s => s.date === filterDate);
        }
      }

      // Sort strictly descending by timestamp so newest sessions always appear at top
      return sessions.sort((a, b) => {
        const dateComp = (b.date || '').localeCompare(a.date || '');
        if (dateComp !== 0) return dateComp;
        const timeA = a.createdAt || a.recordedAt || '';
        const timeB = b.createdAt || b.recordedAt || '';
        return timeB.localeCompare(timeA);
      });
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
      console.warn('Firestore getExpenses notice:', err.message);
      return [];
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

  async getDoctorsList() {
    this.ensureConnected();
    try {
      const users = await this.getUsers();
      const doctorMap = new Map();

      users
        .filter(u => (u.role === 'doctor' || u.role === 'admin') && u.active !== false && u.name)
        .forEach(u => {
          const norm = u.name.trim().replace(/\s+/g, ' ');
          const uid = u.uid || u.id;
          if (norm && uid && !doctorMap.has(uid)) {
            doctorMap.set(uid, { uid, name: norm });
          }
        });

      if (doctorMap.size === 0 && CLINIC_CONFIG.director?.name) {
        const dirNorm = CLINIC_CONFIG.director.name.trim().replace(/\s+/g, ' ');
        doctorMap.set('director', { uid: 'director', name: dirNorm });
      }

      return Array.from(doctorMap.values());
    } catch (err) {
      console.error('Firestore getDoctorsList error:', err);
      return CLINIC_CONFIG.director?.name ? [{ uid: 'director', name: CLINIC_CONFIG.director.name.trim().replace(/\s+/g, ' ') }] : [];
    }
  }

  async getDoctors() {
    const list = await this.getDoctorsList();
    return list.map(d => d.name);
  }

  // ================= 5. Audit Trail =================
  async getAuditLogs(limitCount = 50) {
    this.ensureConnected();
    try {
      const q = query(
        collection(firestoreDb, 'audit_logs'),
        orderBy('timestampRaw', 'desc'),
        limit(limitCount)
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ ...d.data(), id: d.id }));
    } catch (err) {
      console.warn('Firestore getAuditLogs error:', err.message);
      return [];
    }
  }

  async purgeOldAuditLogs() {
    if (!this.isCloud) return;
    try {
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
      ]
    };

    const insuranceDefaults = {
      direct: ['أكسا (AXA)', 'أليانز (Allianz)', 'ميتلايف (MetLife)', 'بوبا (Bupa)', 'عناية الرعاية الصحية (Enaya)'],
      indirect: ['نكست كير (NextCare)', 'مصر للتأمين', 'ايجي كير', 'المهندس للتأمين']
    };

    this.clinicalOptionsCache = this.clinicalOptionsCache || {};
    this.insuranceCompaniesCache = this.insuranceCompaniesCache || {};

    // 1. Seed & Sync Clinical Options (modality, procedure, exercise)
    for (const cat of ['modality', 'procedure', 'exercise', 'body_parts', 'expense_categories']) {
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

  getInsuranceCompaniesList() {
    return this.getAllInsuranceCompaniesWithTypes();
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

  // ================= 9. Weekly Appointments Schedule & Custom Slots =================
  async getAppointmentSlots() {
    this.ensureConnected();
    try {
      const docRef = doc(firestoreDb, 'clinical_options', 'appointment_slots');
      const snap = await getDoc(docRef);
      if (snap.exists() && Array.isArray(snap.data().slots) && snap.data().slots.length > 0) {
        return snap.data().slots;
      }
    } catch (e) {
      console.warn('getAppointmentSlots notice:', e.message);
    }
    return [
      { key: '15:30', label: '٣:٣٠ م' },
      { key: '16:30', label: '٤:٣٠ م' },
      { key: '17:30', label: '٥:٣٠ م' },
      { key: '18:30', label: '٦:٣٠ م' },
      { key: '19:00', label: '٧:٠٠ م' }
    ];
  }

  async saveAppointmentSlots(slots) {
    this.ensureConnected();
    const docRef = doc(firestoreDb, 'clinical_options', 'appointment_slots');
    await setDoc(docRef, { slots }, { merge: true });
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
  // Fixed recurring weekly template (not tied to specific calendar dates):
  // a slot stays booked for the same patient every week until someone
  // deletes it and books a different patient in its place.
  async getAppointments() {
    this.ensureConnected();
    const snap = await getDocs(collection(firestoreDb, 'appointments'));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
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
    return payload;
  }

  async updateAppointment(apptId, updates) {
    this.ensureConnected();
    const ref = doc(firestoreDb, 'appointments', apptId);
    await updateDoc(ref, {
      ...updates,
      updatedAt: new Date().toISOString()
    });
    return { id: apptId, ...updates };
  }

  async deleteAppointment(apptId) {
    this.ensureConnected();
    await deleteDoc(doc(firestoreDb, 'appointments', apptId));
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
    this.clinicalOptionsCache = null;
    this.insuranceCompaniesCache = null;
    await this.syncAndSeedCloudOptions();
  }
}

export const db = new FirestoreDatabaseService();
