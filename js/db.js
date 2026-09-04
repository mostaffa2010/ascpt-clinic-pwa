// ========================================================
// ASCPT - Data Access Layer (DAL) & Production Storage Provider
// Clean clinic database engine - Zero demo data
// ========================================================

/**
 * CleanStorageProvider
 * Manages clean clinic data with zero preloaded demo records.
 * Purges legacy demo keys on initialization to start fresh.
 */
class CleanStorageProvider {
  constructor() {
    this.purgeLegacyDemoStorage();
  }

  get isCloud() {
    return false;
  }

  purgeLegacyDemoStorage() {
    // Thoroughly flush all legacy demo keys from user's device
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

  // Patients (Clean clinic database)
  async getPatients() {
    const raw = localStorage.getItem('ascpt_patients');
    return raw ? JSON.parse(raw) : [];
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

    localStorage.setItem('ascpt_patients', JSON.stringify(patients));
    return isEdit ? 'updated' : 'created';
  }

  async deletePatient(patientId) {
    let patients = await this.getPatients();
    patients = patients.filter(p => p.id !== patientId);
    localStorage.setItem('ascpt_patients', JSON.stringify(patients));
    return true;
  }

  // Sessions (Clean clinic database)
  async getSessions(filterDate = null) {
    const raw = localStorage.getItem('ascpt_sessions');
    let sessions = raw ? JSON.parse(raw) : [];
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
    localStorage.setItem('ascpt_sessions', JSON.stringify(sessions));
    return res;
  }

  async deleteSession(sessionId) {
    let sessions = await this.getSessions();
    sessions = sessions.filter(s => s.id !== sessionId);
    localStorage.setItem('ascpt_sessions', JSON.stringify(sessions));
    return true;
  }

  // Expenses (Clean clinic database)
  async getExpenses(filterDate = null) {
    const raw = localStorage.getItem('ascpt_expenses');
    let expenses = raw ? JSON.parse(raw) : [];
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
    localStorage.setItem('ascpt_expenses', JSON.stringify(expenses));
    return newExp;
  }

  async deleteExpense(expenseId) {
    let expenses = await this.getExpenses();
    expenses = expenses.filter(e => e.id !== expenseId);
    localStorage.setItem('ascpt_expenses', JSON.stringify(expenses));
    return true;
  }

  // Users (Clean staff list)
  async getUsers() {
    const raw = localStorage.getItem('ascpt_users');
    return raw ? JSON.parse(raw) : [];
  }

  async saveUser(userData) {
    const users = await this.getUsers();
    const newUser = { ...userData, id: 'u-' + Date.now() };
    users.push(newUser);
    localStorage.setItem('ascpt_users', JSON.stringify(users));
    return newUser;
  }

  async deleteUser(userId) {
    let users = await this.getUsers();
    users = users.filter(u => u.id !== userId);
    localStorage.setItem('ascpt_users', JSON.stringify(users));
    return true;
  }

  async getDoctors() {
    const users = await this.getUsers();
    const docs = users.filter(u => u.role === 'doctor' || u.role === 'admin').map(u => u.name);
    return Array.from(new Set(docs)); // Strictly empty if no doctors registered yet!
  }

  // Audit Logs
  async getAuditLogs() {
    const raw = localStorage.getItem('ascpt_audit');
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
    if (logs.length > 200) logs.pop();
    localStorage.setItem('ascpt_audit', JSON.stringify(logs));
  }

  // Backup & Restore
  async createFullBackup() {
    return {
      timestamp: new Date().toISOString(),
      center: 'مركز اسكندرية التخصصي للعلاج الطبيعي (ASCPT)',
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
    localStorage.setItem('ascpt_patients', JSON.stringify(backupData.patients || []));
    localStorage.setItem('ascpt_sessions', JSON.stringify(backupData.sessions || []));
    localStorage.setItem('ascpt_expenses', JSON.stringify(backupData.expenses || []));
    return true;
  }

  // Clinical Options (Standard physical therapy modalities, procedures, exercises)
  getClinicalOptions(category) {
    const key = 'ascpt_opt_' + category;
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
      localStorage.setItem('ascpt_opt_' + category, JSON.stringify(list));
    }
    return list;
  }

  async deleteClinicalOption(category, name) {
    let list = this.getClinicalOptions(category);
    list = list.filter(item => item !== name);
    localStorage.setItem('ascpt_opt_' + category, JSON.stringify(list));
    return list;
  }

  // Insurance Companies Registry
  getInsuranceCompanies(contractType = 'direct') {
    const key = 'ascpt_ins_' + contractType;
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
      localStorage.setItem('ascpt_ins_' + contractType, JSON.stringify(list));
    }
    return list;
  }

  async deleteInsuranceCompany(contractType, name) {
    let list = this.getInsuranceCompanies(contractType);
    list = list.filter(item => item !== name.trim());
    localStorage.setItem('ascpt_ins_' + contractType, JSON.stringify(list));
    return list;
  }
}

/**
 * DatabaseService
 * Unified DAL Coordinator
 */
class DatabaseService {
  constructor() {
    this.provider = new CleanStorageProvider();
  }

  setProvider(newProvider) {
    this.provider = newProvider;
  }

  get isCloud() {
    return this.provider.isCloud;
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
