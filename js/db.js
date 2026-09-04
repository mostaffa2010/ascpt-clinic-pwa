// ========================================================
// ASCPT - Data Access Layer (DAL) & Storage Provider Architecture
// Architecture Boundary: UI -> Feature Layer -> DatabaseService (DAL) -> StorageProvider
// ========================================================

import { DEMO_PATIENTS, DEMO_SESSIONS, DEMO_EXPENSES, DEMO_USERS } from './demo-data.js';

/**
 * LocalStorageProvider
 * Encapsulates all browser local storage and demo mock dataset operations.
 * Isolates demo storage logic from the production Data Access Layer.
 */
class LocalStorageProvider {
  constructor() {
    this.initStorage();
  }

  get isCloud() {
    return false;
  }

  initStorage(force = false) {
    if (!localStorage.getItem('pc_demo_v3_september_full') || force) {
      localStorage.setItem('pc_demo_v3_september_full', 'true');
      localStorage.setItem('pc_demo_patients', JSON.stringify(DEMO_PATIENTS));
      localStorage.setItem('pc_demo_sessions', JSON.stringify(DEMO_SESSIONS));
      localStorage.setItem('pc_demo_expenses', JSON.stringify(DEMO_EXPENSES));
      localStorage.setItem('pc_demo_users', JSON.stringify(DEMO_USERS));
      localStorage.setItem('pc_demo_audit', JSON.stringify([
        {
          id: 'log-init',
          userName: 'نظام المركز',
          userRole: 'النظام',
          actionType: 'تجهيز قاعدة البيانات',
          description: 'تم تحميل قاعدة البيانات الأولية بنجاح',
          timestamp: new Date().toLocaleString('ar-EG-u-nu-latn'),
          timestampRaw: Date.now()
        }
      ]));
    }
  }

  resetDemo() {
    localStorage.setItem('pc_demo_v3_september_full', 'true');
    localStorage.setItem('pc_demo_patients', JSON.stringify(DEMO_PATIENTS));
    localStorage.setItem('pc_demo_sessions', JSON.stringify(DEMO_SESSIONS));
    localStorage.setItem('pc_demo_expenses', JSON.stringify(DEMO_EXPENSES));
    localStorage.setItem('pc_demo_users', JSON.stringify(DEMO_USERS));

    localStorage.setItem('pc_demo_audit', JSON.stringify([
      {
        id: 'log-reset-' + Date.now(),
        userName: 'نظام المركز',
        userRole: 'النظام',
        actionType: 'إعادة ضبط البيانات',
        description: 'تمت استعادة البيانات التجريبية الأولية بنجاح.',
        timestamp: new Date().toLocaleString('ar-EG-u-nu-latn'),
        timestampRaw: Date.now()
      }
    ]));

    localStorage.removeItem('pc_opt_modality');
    localStorage.removeItem('pc_opt_procedure');
    localStorage.removeItem('pc_opt_exercise');
    localStorage.removeItem('pc_sb_opt_modality');
    localStorage.removeItem('pc_sb_opt_procedure');
    localStorage.removeItem('pc_sb_opt_exercise');
    localStorage.removeItem('pc_claim_treatments');

    if (DEMO_USERS && DEMO_USERS.length > 0) {
      localStorage.setItem('pc_demo_active_user', JSON.stringify(DEMO_USERS[0]));
    }

    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith('pc_') && !['pc_demo_v3_september_full', 'pc_demo_patients', 'pc_demo_sessions', 'pc_demo_expenses', 'pc_demo_users', 'pc_demo_audit', 'pc_demo_active_user', 'pc_demo_onboarding_seen'].includes(k)) {
        localStorage.removeItem(k);
      }
    }
  }

  async getPatients() {
    const raw = localStorage.getItem('pc_demo_patients');
    return raw ? JSON.parse(raw) : DEMO_PATIENTS;
  }

  async savePatient(patientData, currentUser) {
    const patients = await this.getPatients();
    let isEdit = false;

    if (patientData.id) {
      isEdit = true;
      const index = patients.findIndex(p => p.id === patientData.id);
      if (index !== -1) {
        patients[index] = {
          ...patients[index],
          ...patientData,
          lastUpdatedAt: new Date().toISOString(),
          lastUpdatedBy: currentUser?.name || 'طبيب المركز'
        };
      }
    } else {
      const newPatient = {
        ...patientData,
        id: 'p-' + Date.now(),
        createdAt: new Date().toISOString(),
        createdBy: currentUser?.name || 'استقبال المركز',
        lastUpdatedBy: currentUser?.name || 'استقبال المركز'
      };
      patients.unshift(newPatient);
    }

    localStorage.setItem('pc_demo_patients', JSON.stringify(patients));
    return isEdit ? 'updated' : 'created';
  }

  async deletePatient(patientId) {
    let patients = await this.getPatients();
    patients = patients.filter(p => p.id !== patientId);
    localStorage.setItem('pc_demo_patients', JSON.stringify(patients));
    return true;
  }

  async getSessions(filterDate = null) {
    const raw = localStorage.getItem('pc_demo_sessions');
    let sessions = raw ? JSON.parse(raw) : DEMO_SESSIONS;
    if (filterDate) {
      if (filterDate.length === 7) {
        sessions = sessions.filter(s => s.date && s.date.startsWith(filterDate));
      } else {
        sessions = sessions.filter(s => s.date === filterDate);
      }
    }
    return sessions;
  }

  async saveSession(sessionData, currentUser) {
    const sessions = await this.getSessions();
    let res = null;
    if (sessionData.id) {
      const idx = sessions.findIndex(s => s.id === sessionData.id);
      if (idx !== -1) {
        sessions[idx] = {
          ...sessions[idx],
          ...sessionData,
          lastEditedBy: currentUser?.name || 'مستخدم المركز',
          lastEditedAt: new Date().toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' })
        };
        res = sessions[idx];
      }
    } else {
      const newSession = {
        ...sessionData,
        id: 'sess-' + Date.now(),
        recordedAt: new Date().toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' }),
        recordedBy: currentUser?.name || 'استقبال المركز'
      };
      sessions.unshift(newSession);
      res = newSession;
    }
    localStorage.setItem('pc_demo_sessions', JSON.stringify(sessions));
    return res;
  }

  async deleteSession(sessionId) {
    let sessions = await this.getSessions();
    sessions = sessions.filter(s => s.id !== sessionId);
    localStorage.setItem('pc_demo_sessions', JSON.stringify(sessions));
    return true;
  }

  async getExpenses(filterDate = null) {
    const raw = localStorage.getItem('pc_demo_expenses');
    let expenses = raw ? JSON.parse(raw) : DEMO_EXPENSES;
    if (filterDate) {
      if (filterDate.length === 7) {
        expenses = expenses.filter(e => e.date && e.date.startsWith(filterDate));
      } else {
        expenses = expenses.filter(e => e.date === filterDate);
      }
    }
    return expenses;
  }

  async saveExpense(expenseData, currentUser) {
    const expenses = await this.getExpenses();
    const newExp = {
      ...expenseData,
      id: 'exp-' + Date.now(),
      time: new Date().toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' }),
      recordedBy: currentUser?.name || 'مدير المركز'
    };
    expenses.unshift(newExp);
    localStorage.setItem('pc_demo_expenses', JSON.stringify(expenses));
    return newExp;
  }

  async deleteExpense(expenseId) {
    let expenses = await this.getExpenses();
    expenses = expenses.filter(e => e.id !== expenseId);
    localStorage.setItem('pc_demo_expenses', JSON.stringify(expenses));
    return true;
  }

  async getUsers() {
    const raw = localStorage.getItem('pc_demo_users');
    return raw ? JSON.parse(raw) : DEMO_USERS;
  }

  async saveUser(userData) {
    const users = await this.getUsers();
    const newUser = { ...userData, id: 'u-' + Date.now() };
    users.push(newUser);
    localStorage.setItem('pc_demo_users', JSON.stringify(users));
    return newUser;
  }

  async deleteUser(userId) {
    let users = await this.getUsers();
    users = users.filter(u => u.id !== userId);
    localStorage.setItem('pc_demo_users', JSON.stringify(users));
    return true;
  }

  async getDoctors() {
    const users = await this.getUsers();
    const docs = users.filter(u => u.role === 'doctor' || u.role === 'admin').map(u => u.name);
    return docs.length > 0 ? Array.from(new Set(docs)) : ['د. مصطفى محمود', 'د. أحمد خليل', 'د. سارة عادل', 'د. كريم إبراهيم'];
  }

  async getAuditLogs() {
    const raw = localStorage.getItem('pc_demo_audit');
    return raw ? JSON.parse(raw) : [];
  }

  async logAudit(actionType, description, user) {
    const logs = await this.getAuditLogs();
    const newLog = {
      id: 'log-' + Date.now(),
      userName: user?.name || 'مستخدم المركز',
      userRole: user?.role || 'طبيب',
      actionType,
      description,
      timestamp: new Date().toLocaleString('ar-EG-u-nu-latn'),
      timestampRaw: Date.now()
    };
    logs.unshift(newLog);
    if (logs.length > 150) logs.pop();
    localStorage.setItem('pc_demo_audit', JSON.stringify(logs));
  }

  async createFullBackup() {
    return {
      timestamp: new Date().toISOString(),
      center: 'ASCPT Clinic Management',
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
    localStorage.setItem('pc_demo_patients', JSON.stringify(backupData.patients || []));
    localStorage.setItem('pc_demo_sessions', JSON.stringify(backupData.sessions || []));
    localStorage.setItem('pc_demo_expenses', JSON.stringify(backupData.expenses || []));
    return true;
  }

  getClinicalOptions(category) {
    const key = 'pc_opt_' + category;
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);

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
    const list = defaults[category] || [];
    localStorage.setItem(key, JSON.stringify(list));
    return list;
  }

  async addClinicalOption(category, name) {
    const list = this.getClinicalOptions(category);
    if (!list.includes(name)) {
      list.push(name);
      localStorage.setItem('pc_opt_' + category, JSON.stringify(list));
    }
    return list;
  }

  async deleteClinicalOption(category, name) {
    let list = this.getClinicalOptions(category);
    list = list.filter(item => item !== name);
    localStorage.setItem('pc_opt_' + category, JSON.stringify(list));
    return list;
  }

  getInsuranceCompanies(contractType = 'direct') {
    const key = 'pc_ins_' + contractType;
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);

    const defaults = {
      direct: ['أكسا (AXA)', 'أليانز (Allianz)', 'ميتلايف (MetLife)', 'بوبا (Bupa)', 'عناية الرعاية الصحية (Enaya)'],
      indirect: ['نكست كير (NextCare)', 'مصر للتأمين', 'ايجي كير', 'المهندس للتأمين']
    };
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
      localStorage.setItem('pc_ins_' + contractType, JSON.stringify(list));
    }
    return list;
  }

  async deleteInsuranceCompany(contractType, name) {
    let list = this.getInsuranceCompanies(contractType);
    list = list.filter(item => item !== name.trim());
    localStorage.setItem('pc_ins_' + contractType, JSON.stringify(list));
    return list;
  }
}

/**
 * FirestoreStorageProvider (Architectural scaffold for Phase 3)
 * Will be populated with Firestore collections and real cloud operations in Phase 3.
 */
class FirestoreStorageProvider {
  constructor(firestoreInstance) {
    this.firestore = firestoreInstance;
  }
  get isCloud() {
    return true;
  }
}

/**
 * DatabaseService
 * Unified Data Access Layer (DAL) Coordinator
 * The application modules only interact with DatabaseService,
 * which delegates to the active StorageProvider.
 */
class DatabaseService {
  constructor() {
    // Active provider defaults to LocalStorageProvider during Phase 1 baseline
    this.provider = new LocalStorageProvider();
  }

  setProvider(newProvider) {
    this.provider = newProvider;
  }

  get isCloud() {
    return this.provider.isCloud;
  }

  resetDemo() {
    if (typeof this.provider.resetDemo === 'function') {
      this.provider.resetDemo();
    }
  }

  getPatients() { return this.provider.getPatients(); }
  savePatient(data, user) { return this.provider.savePatient(data, user); }
  deletePatient(id) { return this.provider.deletePatient(id); }

  getSessions(date) { return this.provider.getSessions(date); }
  saveSession(data, user) { return this.provider.saveSession(data, user); }
  deleteSession(id) { return this.provider.deleteSession(id); }

  getExpenses(date) { return this.provider.getExpenses(date); }
  saveExpense(data, user) { return this.provider.saveExpense(data, user); }
  deleteExpense(id) { return this.provider.deleteExpense(id); }

  getUsers() { return this.provider.getUsers(); }
  saveUser(data) { return this.provider.saveUser(data); }
  deleteUser(id) { return this.provider.deleteUser(id); }
  getDoctors() { return this.provider.getDoctors(); }

  getAuditLogs() { return this.provider.getAuditLogs(); }
  logAudit(type, desc, user) { return this.provider.logAudit(type, desc, user); }

  createFullBackup() { return this.provider.createFullBackup(); }
  restoreFromBackup(data) { return this.provider.restoreFromBackup(data); }

  getClinicalOptions(cat) { return this.provider.getClinicalOptions(cat); }
  addClinicalOption(cat, name) { return this.provider.addClinicalOption(cat, name); }
  deleteClinicalOption(cat, name) { return this.provider.deleteClinicalOption(cat, name); }

  getInsuranceCompanies(type) { return this.provider.getInsuranceCompanies(type); }
  getAllInsuranceCompaniesWithTypes() { return this.provider.getAllInsuranceCompaniesWithTypes(); }
  addInsuranceCompany(type, name) { return this.provider.addInsuranceCompany(type, name); }
  deleteInsuranceCompany(type, name) { return this.provider.deleteInsuranceCompany(type, name); }
}

export const db = new DatabaseService();
