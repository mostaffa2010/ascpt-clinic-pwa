// ========================================================
// ASCPT - Authoritative Supabase PostgreSQL Data Access Layer (v1.4.88)
// Single Source of Truth: Supabase PostgreSQL + Local Storage Persistence
// Unlimited High-Speed Queries, Zero Per-Read Billing
// ========================================================

import { supabase, isConfigured } from './supabase-init.js';
import { CLINIC_CONFIG } from './clinic-config.js';

class SupabaseDatabaseService {
  constructor() {
    this.purgeLegacyDemoStorage();
    this.clinicalOptionsCache = null;
    this.insuranceCompaniesCache = null;
  }

  get isCloud() {
    return isConfigured && Boolean(supabase);
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
      'ascpt_expenses'
    ];
    legacyKeys.forEach(k => {
      try { localStorage.removeItem(k); } catch (_) {}
    });
  }

  ensureConnected() {
    if (!this.isCloud) {
      throw new Error('قاعدة البيانات السحابية Supabase غير متصلة.');
    }
  }

  cacheLocal(key, data) {
    try {
      localStorage.setItem(`ascpt_cache_${key}`, JSON.stringify(data));
    } catch (_) {}
  }

  getCachedLocal(key) {
    try {
      const raw = localStorage.getItem(`ascpt_cache_${key}`);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  // ================= 1. Patients Management =================
  async getPatients() {
    this.ensureConnected();
    try {
      const { data, error } = await supabase
        .from('patients')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const list = (data || []).map(row => ({
        ...(row.data || {}),
        id: row.id,
        name: row.name || row.data?.name || 'بدون اسم',
        billing: row.data?.billing || row.pay_type || 'cash',
        doctor: row.data?.doctor || row.attending_doctor || '',
        address: row.data?.address || '',
        phone: row.phone ?? row.data?.phone ?? '',
        gender: row.gender ?? row.data?.gender ?? '',
        age: row.age ?? row.data?.age ?? '',
        diagnosis: row.diagnosis ?? row.data?.diagnosis ?? '',
        referral: row.referral ?? row.data?.referral ?? '',
        attendingDoctor: row.attending_doctor || row.data?.attendingDoctor || row.data?.doctor || '',
        payType: row.pay_type || row.data?.payType || 'cash',
        contractType: row.contract_type || row.data?.contractType || '',
        insuranceCompany: row.insurance_company || row.data?.insuranceCompany || row.data?.insuranceName || '',
        insuranceNumber: row.insurance_number || row.data?.insuranceNumber || '',
        approvedSessions: row.approved_sessions ?? row.data?.approvedSessions,
        currentApprovalStartDate: row.current_approval_start_date ?? row.data?.currentApprovalStartDate ?? '',
        currentApprovalEndDate: row.current_approval_end_date ?? row.data?.currentApprovalEndDate ?? '',
        isActive: row.is_active !== false && row.data?.isActive !== false,
        createdAt: row.created_at || row.data?.createdAt,
        lastUpdatedAt: row.last_updated_at || row.data?.lastUpdatedAt
      }));

      this.cacheLocal('patients', list);

      return list.sort((a, b) => {
        const tA = a.createdAt || a.lastUpdatedAt || '';
        const tB = b.createdAt || b.lastUpdatedAt || '';
        return tB.localeCompare(tA);
      });
    } catch (err) {
      console.warn('Supabase getPatients warning:', err.message);
      const cached = this.getCachedLocal('patients');
      if (cached) return cached;
      throw new Error('تعذر تحميل سجل المرضى من قاعدة البيانات: ' + err.message);
    }
  }

  async savePatient(patientData, currentUser) {
    this.ensureConnected();
    const patientId = patientData.id || ('p_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7));
    const now = new Date().toISOString();

    const payload = {
      ...patientData,
      id: patientId,
      lastUpdatedAt: now,
      lastUpdatedBy: currentUser?.name || 'طاقم المركز'
    };
    if (!payload.createdAt) payload.createdAt = now;

    const row = {
      id: patientId,
      name: payload.name || 'بدون اسم',
      phone: payload.phone || '',
      gender: payload.gender || '',
      age: String(payload.age || ''),
      diagnosis: payload.diagnosis || '',
      referral: payload.referral || '',
      attending_doctor: payload.attendingDoctor || payload.doctor || '',
      pay_type: payload.payType || 'cash',
      contract_type: payload.contractType || '',
      insurance_company: payload.insuranceCompany || payload.insuranceName || '',
      insurance_number: payload.insuranceNumber || '',
      approved_sessions: parseInt(payload.approvedSessions) || null,
      current_approval_start_date: payload.currentApprovalStartDate || '',
      current_approval_end_date: payload.currentApprovalEndDate || '',
      is_active: payload.isActive !== false,
      created_at: payload.createdAt,
      last_updated_at: now,
      data: payload
    };

    const { error } = await supabase.from('patients').upsert(row);
    if (error) {
      console.error('Supabase savePatient error:', error);
      throw new Error('فشل حفظ بيانات المريض: ' + error.message);
    }

    return payload;
  }

  async deletePatient(patientId) {
    this.ensureConnected();
    try {
      const { error } = await supabase.from('patients').delete().eq('id', patientId);
      if (error) throw error;
      return true;
    } catch (err) {
      console.error('Supabase deletePatient error:', err);
      throw new Error('فشل حذف ملف المريض من قاعدة البيانات: ' + err.message);
    }
  }

  // ================= 2. Sessions Management =================
  async getSessions(filterDate = null) {
    this.ensureConnected();
    try {
      let q = supabase.from('sessions').select('*');
      if (filterDate) {
        if (filterDate.length === 7) {
          q = q.like('date', `${filterDate}%`);
        } else {
          q = q.eq('date', filterDate);
        }
      }

      const { data, error } = await q.order('date', { ascending: false });
      if (error) throw error;

      let sessions = (data || []).map(row => ({
        ...(row.data || {}),
        id: row.id,
        patientId: row.patient_id || row.data?.patientId,
        patientName: row.patient_name || row.data?.patientName,
        doctor: row.doctor || row.data?.doctor,
        doctorUid: row.doctor_uid || row.data?.doctorUid,
        date: row.date || row.data?.date,
        time: row.time || row.data?.time,
        entryType: row.entry_type || row.data?.entryType || 'session',
        examType: row.exam_type || row.data?.examType,
        payType: row.pay_type || row.data?.payType || 'cash',
        contractType: row.contract_type || row.data?.contractType,
        insuranceName: row.insurance_name || row.data?.insuranceName,
        amountPaid: Number(row.amount_paid ?? row.data?.amountPaid ?? 0),
        doctorShare: Number(row.doctor_share ?? row.data?.doctorShare ?? 0),
        bodyPartsCount: parseInt(row.body_parts_count ?? row.data?.bodyPartsCount ?? 1),
        isSpecial: Boolean(row.is_special ?? row.data?.isSpecial),
        sessionPricingType: row.session_pricing_type || row.data?.sessionPricingType || 'regular',
        sessionNumber: parseInt(row.session_number ?? row.data?.sessionNumber ?? 1),
        approvedSessionsTotal: parseInt(row.approved_sessions_total ?? row.data?.approvedSessionsTotal ?? 12),
        recordedBy: row.recorded_by || row.data?.recordedBy,
        recordedAt: row.recorded_at || row.data?.recordedAt,
        shiftId: row.shift_id || row.data?.shiftId,
        createdAt: row.created_at || row.data?.createdAt
      }));

      return sessions.sort((a, b) => {
        const dateComp = (b.date || '').localeCompare(a.date || '');
        if (dateComp !== 0) return dateComp;
        const timeA = a.createdAt || a.recordedAt || '';
        const timeB = b.createdAt || b.recordedAt || '';
        return timeB.localeCompare(timeA);
      });
    } catch (err) {
      console.error('Supabase getSessions error:', err);
      throw new Error('تعذر جلب سجل الجلسات من قاعدة البيانات.');
    }
  }

  async saveSession(sessionData, currentUser) {
    this.ensureConnected();
    const sessionId = sessionData.id || ('sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7));
    const now = new Date();
    const timeStr = now.toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit', hour12: true });

    const payload = {
      ...sessionData,
      id: sessionId,
      lastEditedBy: currentUser?.name || 'مستخدم المركز',
      lastEditedAt: timeStr,
      lastEditedAtISO: now.toISOString()
    };
    if (!payload.createdAt) payload.createdAt = now.toISOString();
    if (!payload.recordedAt) payload.recordedAt = timeStr;
    if (!payload.recordedBy) payload.recordedBy = currentUser?.name || 'طاقم المركز';

    const row = {
      id: sessionId,
      patient_id: payload.patientId || null,
      patient_name: payload.patientName || '',
      doctor: payload.doctor || '',
      doctor_uid: payload.doctorUid || '',
      date: payload.date || '',
      time: payload.time || payload.recordedAt || timeStr,
      entry_type: payload.entryType || 'session',
      exam_type: payload.examType || null,
      pay_type: payload.payType || 'cash',
      contract_type: payload.contractType || '',
      insurance_name: payload.insuranceName || '',
      amount_paid: Number(payload.amountPaid || 0),
      doctor_share: Number(payload.doctorShare || 0),
      body_parts_count: parseInt(payload.bodyPartsCount) || 1,
      is_special: Boolean(payload.isSpecial),
      session_pricing_type: payload.sessionPricingType || 'regular',
      session_number: parseInt(payload.sessionNumber) || null,
      approved_sessions_total: parseInt(payload.approvedSessionsTotal) || null,
      recorded_by: payload.recordedBy || '',
      recorded_at: payload.recordedAt || timeStr,
      shift_id: payload.shiftId || '',
      created_at: payload.createdAt,
      data: payload
    };

    const { error } = await supabase.from('sessions').upsert(row);
    if (error) {
      console.error('Supabase saveSession error:', error);
      throw new Error('فشل تسجيل الجلسة في قاعدة البيانات: ' + error.message);
    }

    return payload;
  }

  async deleteSession(sessionId) {
    this.ensureConnected();
    try {
      const { error } = await supabase.from('sessions').delete().eq('id', sessionId);
      if (error) throw error;
      return true;
    } catch (err) {
      console.error('Supabase deleteSession error:', err);
      throw new Error('فشل حذف الجلسة من قاعدة البيانات: ' + err.message);
    }
  }

  // ================= 3. Expenses Management =================
  async getExpenses(filterDate = null) {
    this.ensureConnected();
    try {
      let q = supabase.from('expenses').select('*');
      if (filterDate) {
        if (filterDate.length === 7) {
          q = q.like('date', `${filterDate}%`);
        } else {
          q = q.eq('date', filterDate);
        }
      }

      const { data, error } = await q.order('date', { ascending: false });
      if (error) throw error;

      let expenses = (data || []).map(row => ({
        ...(row.data || {}),
        id: row.id,
        date: row.date,
        time: row.time || row.data?.time,
        category: row.category || row.data?.category || 'عام',
        description: row.description || row.data?.description || '',
        amount: Number(row.amount ?? row.data?.amount ?? 0),
        recordedBy: row.recorded_by || row.data?.recordedBy || '',
        shiftId: row.shift_id || row.data?.shiftId || '',
        createdAt: row.created_at || row.data?.createdAt
      }));

      return expenses.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    } catch (err) {
      console.error('Supabase getExpenses error:', err);
      throw new Error('تعذر جلب سجل المصروفات من قاعدة البيانات.');
    }
  }

  async saveExpense(expenseData, currentUser) {
    this.ensureConnected();
    const expenseId = expenseData.id || ('exp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7));
    const now = new Date();
    const timeStr = now.toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit', hour12: true });

    const payload = {
      ...expenseData,
      id: expenseId,
      time: timeStr
    };
    if (!payload.createdAt) payload.createdAt = now.toISOString();
    if (!payload.recordedBy) payload.recordedBy = currentUser?.name || 'طاقم المركز';

    const row = {
      id: expenseId,
      date: payload.date || '',
      time: payload.time || timeStr,
      category: payload.category || 'عام',
      description: payload.description || '',
      amount: Number(payload.amount || 0),
      recorded_by: payload.recordedBy || '',
      shift_id: payload.shiftId || '',
      created_at: payload.createdAt,
      data: payload
    };

    const { error } = await supabase.from('expenses').upsert(row);
    if (error) {
      console.error('Supabase saveExpense error:', error);
      throw new Error('فشل تسجيل المصروف في قاعدة البيانات: ' + error.message);
    }

    return payload;
  }

  async deleteExpense(expenseId) {
    this.ensureConnected();
    try {
      const { error } = await supabase.from('expenses').delete().eq('id', expenseId);
      if (error) throw error;
      return true;
    } catch (err) {
      console.error('Supabase deleteExpense error:', err);
      throw new Error('فشل حذف بند المصروفات من قاعدة البيانات.');
    }
  }

  // ================= 4. Users & Staff Management =================
  async getUsers() {
    this.ensureConnected();
    try {
      const { data, error } = await supabase.from('profiles').select('*').order('name');
      if (error) throw error;
      return (data || []).map(row => ({
        ...(row.data || {}),
        id: row.id,
        email: row.email,
        name: row.name,
        role: row.role,
        active: row.is_active !== false && row.data?.active !== false,
        doctorSharePercentage: row.doctor_share_percentage || row.data?.doctorSharePercentage || 0,
        createdAt: row.created_at
      }));
    } catch (err) {
      console.error('Supabase getUsers error:', err);
      return [];
    }
  }

  async getDoctorsList() {
    try {
      const users = await this.getUsers();
      const activeDoctors = users
        .filter(u => u.role === 'doctor' && u.active !== false)
        .map(u => ({
          uid: u.id,
          id: u.id,
          name: u.name,
          role: u.role,
          shift: u.shift || u.data?.shift || 'sat_mon_wed',
          regularSessionRate: u.regularSessionRate || u.data?.regularSessionRate || 0,
          specialSessionRate: u.specialSessionRate || u.data?.specialSessionRate || 0
        }));

      if (activeDoctors.length > 0) {
        return activeDoctors;
      }
    } catch (_) {}

    return [
      { uid: 'doc_1', id: 'doc_1', name: 'د. حسني أحمد الجويلي', role: 'doctor', shift: 'all' },
      { uid: 'doc_2', id: 'doc_2', name: 'د. أحمد مجدي', role: 'doctor', shift: 'sat_mon_wed' },
      { uid: 'doc_3', id: 'doc_3', name: 'د. سارة عثمان', role: 'doctor', shift: 'sun_tue_thu' },
      { uid: 'doc_4', id: 'doc_4', name: 'د. كريم عبد العزيز', role: 'doctor', shift: 'sat_mon_wed' }
    ];
  }

  async getDoctors() {
    return this.getDoctorsList();
  }

  // ================= 5. Audit Trail =================
  async getAuditLogs(limitCount = 50) {
    this.ensureConnected();
    try {
      const { data, error } = await supabase
        .from('audit_logs')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(limitCount);

      if (error) throw error;
      return (data || []).map(row => ({
        ...(row.data || {}),
        id: row.id,
        action: row.action,
        details: row.details,
        userName: row.user_name || row.data?.userName || '',
        userUid: row.user_uid || row.data?.userUid || '',
        timestamp: row.timestamp || row.data?.timestamp
      }));
    } catch (err) {
      console.error('Supabase getAuditLogs error:', err);
      return [];
    }
  }

  async purgeOldAuditLogs() {
    this.ensureConnected();
    try {
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const iso = ninetyDaysAgo.toISOString();

      await supabase.from('audit_logs').delete().lt('timestamp', iso);
    } catch (_) {}
  }

  async logAudit(actionType, description, user) {
    if (!this.isCloud) return;
    const logId = 'log_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    const now = new Date().toISOString();

    const row = {
      id: logId,
      action: actionType,
      details: description,
      user_name: user?.name || 'طاقم المركز',
      user_uid: user?.uid || user?.id || '',
      timestamp: now,
      data: {
        action: actionType,
        details: description,
        userName: user?.name || 'طاقم المركز',
        userUid: user?.uid || user?.id || '',
        timestamp: now
      }
    };

    try {
      await supabase.from('audit_logs').insert(row);
    } catch (_) {}
  }


  getClinicalOptions(category) {
    if (this.clinicalOptionsCache && this.clinicalOptionsCache[category]) {
      return this.clinicalOptionsCache[category];
    }
    const defaults = {
      body_parts: ['الرقبة', 'الفقرات القطنية', 'الكتف الأيمن', 'الكتف الأيسر', 'الركبة اليمنى', 'الركبة اليسرى', 'الكاحل', 'المرفق'],
      expense_categories: ['إيجار المركز', 'كهرباء ومياه وغاز', 'أدوات ومستهلكات طبية', 'صيانة وأجهزة', 'نظافة وضيافة', 'أدوات مكتبية ومطبوعات', 'مرتبات وأجور', 'مصاريف إدارية وحكومية', 'إنترنت واتصالات', 'أخرى'],
      appointment_slots: [
        { key: 'slot_1', label: '10:00 ص - 11:00 ص' },
        { key: 'slot_2', label: '11:00 ص - 12:00 م' },
        { key: 'slot_3', label: '12:00 م - 01:00 م' },
        { key: 'slot_4', label: '01:00 م - 02:00 م' },
        { key: 'slot_5', label: '05:00 م - 06:00 م' },
        { key: 'slot_6', label: '06:00 م - 07:00 م' },
        { key: 'slot_7', label: '07:00 م - 08:00 م' },
        { key: 'slot_8', label: '08:00 م - 09:00 م' }
      ]
    };
    return defaults[category] || [];
  }

  getInsuranceCompanies(contractType) {
    if (this.insuranceCompaniesCache && this.insuranceCompaniesCache[contractType]) {
      return this.insuranceCompaniesCache[contractType];
    }
    const defaults = {
      direct: ['نقابة المهندسين', 'نقابة المحامين', 'شركة البترول', 'الكهرباء', 'مصر للتأمين'],
      indirect: ['نكست كير (NextCare)', 'ميد نت (MedNet)', 'أكسا (AXA)', 'جلوب ميد (GlobeMed)', 'برايم هيلث (Prime Health)']
    };
    return defaults[contractType] || [];
  }

  // ================= 6. Clinical Options =================
  async syncAndSeedCloudOptions() {
    if (!this.isCloud) return;
    try {
      const { data, error } = await supabase.from('clinical_options').select('*');
      if (error || !data || data.length === 0) return;

      const map = {};
      data.forEach(row => {
        map[row.id] = row.items || row.data?.items || [];
      });
      this.clinicalOptionsCache = map;
    } catch (_) {}
  }

  async syncClinicalOptionsFromFirestore() {
    return this.syncAndSeedCloudOptions();
  }

  async addClinicalOption(category, name) {
    this.ensureConnected();
    const cleanName = (name || '').trim();
    if (!cleanName) return;

    try {
      const { data } = await supabase.from('clinical_options').select('*').eq('id', category).maybeSingle();
      let currentItems = data?.items || [];
      if (!currentItems.includes(cleanName)) {
        currentItems.push(cleanName);
        await supabase.from('clinical_options').upsert({
          id: category,
          category,
          items: currentItems,
          last_updated_at: new Date().toISOString(),
          data: { items: currentItems }
        });
        if (this.clinicalOptionsCache) this.clinicalOptionsCache[category] = currentItems;
      }
    } catch (err) {
      console.error('addClinicalOption error:', err);
      throw err;
    }
  }

  async deleteClinicalOption(category, name) {
    this.ensureConnected();
    try {
      const { data } = await supabase.from('clinical_options').select('*').eq('id', category).maybeSingle();
      if (!data) return;
      let currentItems = (data.items || []).filter(item => item !== name);
      await supabase.from('clinical_options').upsert({
        id: category,
        category,
        items: currentItems,
        last_updated_at: new Date().toISOString(),
        data: { items: currentItems }
      });
      if (this.clinicalOptionsCache) this.clinicalOptionsCache[category] = currentItems;
    } catch (err) {
      console.error('deleteClinicalOption error:', err);
      throw err;
    }
  }

  // ================= 7. Insurance Companies =================
  async syncInsuranceCompaniesFromFirestore() {
    if (!this.isCloud) return;
    try {
      const { data, error } = await supabase.from('insurance_companies').select('*');
      if (error || !data) return;

      const cache = {};
      data.forEach(row => {
        cache[row.id] = row.data?.list || [];
      });
      this.insuranceCompaniesCache = cache;
    } catch (_) {}
  }

  async addInsuranceCompany(contractType, name) {
    this.ensureConnected();
    const cleanName = (name || '').trim();
    if (!cleanName) return;

    try {
      const { data } = await supabase.from('insurance_companies').select('*').eq('id', contractType).maybeSingle();
      let list = data?.data?.list || [];
      if (!list.includes(cleanName)) {
        list.push(cleanName);
        await supabase.from('insurance_companies').upsert({
          id: contractType,
          name: contractType,
          data: { list },
          created_at: new Date().toISOString()
        });
        if (!this.insuranceCompaniesCache) this.insuranceCompaniesCache = {};
        this.insuranceCompaniesCache[contractType] = list;
      }
    } catch (err) {
      console.error('addInsuranceCompany error:', err);
      throw err;
    }
  }

  async deleteInsuranceCompany(contractType, name) {
    this.ensureConnected();
    try {
      const { data } = await supabase.from('insurance_companies').select('*').eq('id', contractType).maybeSingle();
      if (!data) return;
      let list = (data.data?.list || []).filter(c => c !== name);
      await supabase.from('insurance_companies').upsert({
        id: contractType,
        name: contractType,
        data: { list },
        created_at: new Date().toISOString()
      });
      if (this.insuranceCompaniesCache) this.insuranceCompaniesCache[contractType] = list;
    } catch (err) {
      console.error('deleteInsuranceCompany error:', err);
      throw err;
    }
  }

  // ================= 8. Insurance Letters =================
  async addInsuranceLetter(letterData) {
    this.ensureConnected();
    const letterId = letterData.id || ('letter_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7));
    const now = new Date().toISOString();

    const payload = {
      ...letterData,
      id: letterId,
      createdAt: now
    };

    const row = {
      id: letterId,
      patient_id: payload.patientId || null,
      patient_name: payload.patientName || '',
      company_name: payload.companyName || '',
      letter_number: payload.letterNumber || '',
      start_date: payload.startDate || '',
      end_date: payload.endDate || '',
      approved_sessions: parseInt(payload.approvedSessions) || null,
      consumed_sessions: parseInt(payload.consumedSessions) || 0,
      created_at: now,
      data: payload
    };

    const { error } = await supabase.from('insurance_letters').upsert(row);
    if (error) throw new Error('فشل حفظ خطاب التأمين: ' + error.message);
    return payload;
  }

  async getInsuranceLetters(patientId) {
    this.ensureConnected();
    try {
      let q = supabase.from('insurance_letters').select('*');
      if (patientId) {
        q = q.eq('patient_id', patientId);
      }
      const { data, error } = await q.order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []).map(row => ({ ...(row.data || {}), id: row.id }));
    } catch (err) {
      console.error('getInsuranceLetters error:', err);
      return [];
    }
  }

  // ================= 9. Insurance Settlements =================
  async getInsuranceSettlements(dateStr = null, monthStr = null) {
    this.ensureConnected();
    try {
      let q = supabase.from('insurance_settlements').select('*');
      if (dateStr) {
        q = q.eq('date', dateStr);
      } else if (monthStr) {
        q = q.like('date', `${monthStr}%`);
      }
      const { data, error } = await q.order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []).map(row => ({
        ...(row.data || {}),
        id: row.id,
        amountReceived: Number(row.amount_received ?? row.data?.amountReceived ?? 0)
      }));
    } catch (err) {
      console.error('getInsuranceSettlements error:', err);
      return [];
    }
  }

  async saveInsuranceSettlement(settlementData, currentUser) {
    this.ensureConnected();
    const settlementId = settlementData.id || ('stl_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7));
    const now = new Date();
    const timeStr = now.toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit', hour12: true });

    const payload = {
      ...settlementData,
      id: settlementId,
      time: timeStr,
      recordedBy: currentUser?.name || 'مدير المركز',
      createdAt: now.toISOString()
    };

    const row = {
      id: settlementId,
      claim_id: payload.claimId || null,
      company_name: payload.companyName || '',
      amount_received: Number(payload.amountReceived || 0),
      date: payload.date || '',
      time: timeStr,
      created_at: now.toISOString(),
      data: payload
    };

    const { error } = await supabase.from('insurance_settlements').upsert(row);
    if (error) throw new Error('فشل تسجيل تسوية التأمين: ' + error.message);
    return payload;
  }

  async deleteInsuranceSettlement(settlementId) {
    this.ensureConnected();
    try {
      const { error } = await supabase.from('insurance_settlements').delete().eq('id', settlementId);
      if (error) throw error;
      return true;
    } catch (err) {
      console.error('deleteInsuranceSettlement error:', err);
      throw new Error('فشل حذف تسوية التأمين.');
    }
  }

  // ================= 10. Insurance Claims =================
  async getInsuranceClaims(companyName = null) {
    this.ensureConnected();
    try {
      let q = supabase.from('insurance_claims').select('*');
      if (companyName) {
        q = q.eq('company_name', companyName);
      }
      const { data, error } = await q.order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []).map(row => ({
        ...(row.data || {}),
        id: row.id,
        totalAmount: Number(row.total_amount ?? row.data?.totalAmount ?? 0)
      }));
    } catch (err) {
      console.error('getInsuranceClaims error:', err);
      return [];
    }
  }

  async saveInsuranceClaim(claimData, currentUser) {
    this.ensureConnected();
    const claimId = claimData.id || ('claim_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7));
    const now = new Date().toISOString();

    const payload = {
      ...claimData,
      id: claimId,
      recordedBy: currentUser?.name || 'مدير المركز',
      recordedByUid: currentUser?.uid || '',
      createdAt: claimData.createdAt || now
    };

    const row = {
      id: claimId,
      claim_number: payload.claimNumber || '',
      company_name: payload.companyName || '',
      month: payload.month || '',
      total_amount: Number(payload.totalAmount || 0),
      status: payload.status || 'pending',
      created_at: payload.createdAt,
      data: payload
    };

    const { error } = await supabase.from('insurance_claims').upsert(row);
    if (error) throw new Error('فشل حفظ مطالبة التأمين: ' + error.message);
    return payload;
  }

  async updateInsuranceClaim(claimId, updateData) {
    this.ensureConnected();
    try {
      const { data: existing } = await supabase.from('insurance_claims').select('*').eq('id', claimId).single();
      const updatedData = { ...(existing?.data || {}), ...updateData };

      const rowUpdates = {
        data: updatedData
      };
      if (updateData.status) rowUpdates.status = updateData.status;
      if (updateData.totalAmount !== undefined) rowUpdates.total_amount = Number(updateData.totalAmount);

      const { error } = await supabase.from('insurance_claims').update(rowUpdates).eq('id', claimId);
      if (error) throw error;
      return true;
    } catch (err) {
      console.error('updateInsuranceClaim error:', err);
      throw new Error('فشل تحديث مطالبة التأمين.');
    }
  }

  async deleteInsuranceClaim(claimId) {
    this.ensureConnected();
    try {
      const { error } = await supabase.from('insurance_claims').delete().eq('id', claimId);
      if (error) throw error;
      return true;
    } catch (err) {
      console.error('deleteInsuranceClaim error:', err);
      throw new Error('فشل حذف مطالبة التأمين.');
    }
  }

  // ================= 11. Appointments Slots =================
  async getAppointmentSlots() {
    this.ensureConnected();
    try {
      const { data } = await supabase.from('clinical_options').select('*').eq('id', 'appointment_slots').maybeSingle();
      if (data?.items && Array.isArray(data.items) && data.items.length > 0) {
        return data.items;
      }
    } catch (_) {}

    return [
      { key: 'slot_1', label: '10:00 ص - 11:00 ص' },
      { key: 'slot_2', label: '11:00 ص - 12:00 م' },
      { key: 'slot_3', label: '12:00 م - 01:00 م' },
      { key: 'slot_4', label: '01:00 م - 02:00 م' },
      { key: 'slot_5', label: '05:00 م - 06:00 م' },
      { key: 'slot_6', label: '06:00 م - 07:00 م' },
      { key: 'slot_7', label: '07:00 م - 08:00 م' },
      { key: 'slot_8', label: '08:00 م - 09:00 م' }
    ];
  }

  async saveAppointmentSlots(slots) {
    this.ensureConnected();
    try {
      await supabase.from('clinical_options').upsert({
        id: 'appointment_slots',
        category: 'appointment_slots',
        items: slots,
        last_updated_at: new Date().toISOString(),
        data: { items: slots }
      });
    } catch (err) {
      console.error('saveAppointmentSlots error:', err);
      throw new Error('فشل حفظ فترات المواعيد.');
    }
  }

  async updateAppointmentSlot(oldKey, newKey, newLabel) {
    const slots = await this.getAppointmentSlots();
    const idx = slots.findIndex(s => s.key === oldKey);
    if (idx !== -1) {
      slots[idx] = { key: newKey, label: newLabel };
      await this.saveAppointmentSlots(slots);
    }
  }

  async deleteAppointmentSlot(slotKey) {
    const slots = await this.getAppointmentSlots();
    const filtered = slots.filter(s => s.key !== slotKey);
    await this.saveAppointmentSlots(filtered);
  }

  async addAppointmentSlot(newKey, newLabel) {
    const slots = await this.getAppointmentSlots();
    slots.push({ key: newKey, label: newLabel });
    await this.saveAppointmentSlots(slots);
  }

  // ================= 12. Appointments =================
  async getAppointments() {
    this.ensureConnected();
    try {
      const { data, error } = await supabase.from('appointments').select('*').order('date', { ascending: true });
      if (error) throw error;
      return (data || []).map(row => ({
        ...(row.data || {}),
        id: row.id,
        patientId: row.patient_id || row.data?.patientId,
        patientName: row.patient_name || row.data?.patientName,
        phone: row.phone || row.data?.phone,
        doctor: row.doctor || row.data?.doctor,
        date: row.date,
        time: row.time || row.data?.time,
        status: row.status || row.data?.status || 'scheduled',
        notes: row.notes || row.data?.notes || '',
        createdAt: row.created_at || row.data?.createdAt
      }));
    } catch (err) {
      console.error('Supabase getAppointments error:', err);
      return [];
    }
  }

  async addAppointment(apptData) {
    this.ensureConnected();
    const apptId = apptData.id || ('appt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7));
    const now = new Date().toISOString();

    const payload = {
      ...apptData,
      id: apptId,
      createdAt: now
    };

    const row = {
      id: apptId,
      patient_id: payload.patientId || null,
      patient_name: payload.patientName || '',
      phone: payload.phone || '',
      doctor: payload.doctor || '',
      date: payload.date || '',
      time: payload.time || '',
      status: payload.status || 'scheduled',
      notes: payload.notes || '',
      created_at: now,
      data: payload
    };

    const { error } = await supabase.from('appointments').upsert(row);
    if (error) throw new Error('فشل تسجيل الموعد: ' + error.message);
    return payload;
  }

  async updateAppointment(apptId, updates) {
    this.ensureConnected();
    try {
      const { data: existing } = await supabase.from('appointments').select('*').eq('id', apptId).single();
      const updatedData = { ...(existing?.data || {}), ...updates };

      const rowUpdates = { data: updatedData };
      if (updates.date) rowUpdates.date = updates.date;
      if (updates.time) rowUpdates.time = updates.time;
      if (updates.status) rowUpdates.status = updates.status;
      if (updates.doctor) rowUpdates.doctor = updates.doctor;

      const { error } = await supabase.from('appointments').update(rowUpdates).eq('id', apptId);
      if (error) throw error;
      return true;
    } catch (err) {
      console.error('updateAppointment error:', err);
      throw new Error('فشل تحديث بيانات الموعد.');
    }
  }

  async deleteAppointment(apptId) {
    this.ensureConnected();
    try {
      const { error } = await supabase.from('appointments').delete().eq('id', apptId);
      if (error) throw error;
      return true;
    } catch (err) {
      console.error('deleteAppointment error:', err);
      throw new Error('فشل حذف الموعد.');
    }
  }

  // ================= 13. Shift Overrides =================
  async getShiftOverrides(dateStr = null) {
    this.ensureConnected();
    try {
      let q = supabase.from('shift_overrides').select('*');
      if (dateStr) {
        q = q.eq('date', dateStr);
      }
      const { data, error } = await q.order('closed_at', { ascending: false });
      if (error) throw error;
      return (data || []).map(row => ({
        ...(row.data || {}),
        id: row.id,
        cashCollected: Number(row.cash_collected ?? row.data?.cashCollected ?? 0),
        expenses: Number(row.expenses ?? row.data?.expenses ?? 0),
        netCash: Number(row.net_cash ?? row.data?.netCash ?? 0)
      }));
    } catch (err) {
      console.error('getShiftOverrides error:', err);
      return [];
    }
  }

  async addShiftOverride(overrideData) {
    this.ensureConnected();
    const docId = overrideData.id || (overrideData.shiftId ? `${overrideData.date}_${overrideData.shiftId}` : `override_${Date.now()}`);
    const now = new Date().toISOString();

    const payload = {
      ...overrideData,
      id: docId,
      createdAt: now
    };

    const row = {
      id: docId,
      shift_id: payload.shiftId || '',
      date: payload.date || '',
      cash_collected: Number(payload.cashCollected || 0),
      expenses: Number(payload.expenses || 0),
      net_cash: Number(payload.netCash || 0),
      closed_by: payload.closedBy || '',
      closed_at: payload.closedAt || now,
      data: payload
    };

    const { error } = await supabase.from('shift_overrides').upsert(row);
    if (error) throw new Error('فشل حفظ تسوية الشفت: ' + error.message);
    return payload;
  }

  async deleteShiftOverride(overrideId) {
    this.ensureConnected();
    try {
      const { error } = await supabase.from('shift_overrides').delete().eq('id', overrideId);
      if (error) throw error;
      return true;
    } catch (err) {
      console.error('deleteShiftOverride error:', err);
      throw new Error('فشل حذف تسوية الشفت.');
    }
  }

  // ================= 14. Full Backup & Restore =================
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

    const { data: clinicalData } = await supabase.from('clinical_options').select('*');
    const clinicalOptions = {};
    (clinicalData || []).forEach(d => { clinicalOptions[d.id] = d.items || d.data?.items || []; });

    const { data: insuranceData } = await supabase.from('insurance_companies').select('*');
    const insuranceCompanies = {};
    (insuranceData || []).forEach(d => { insuranceCompanies[d.id] = d.data?.list || []; });

    return {
      backupVersion: 2,
      clinicName: CLINIC_CONFIG?.name || 'ASCPT',
      database: 'Supabase PostgreSQL',
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

    if (Array.isArray(data.patients)) {
      for (const p of data.patients) {
        await this.savePatient(p);
      }
    }
    if (Array.isArray(data.sessions)) {
      for (const s of data.sessions) {
        await this.saveSession(s);
      }
    }
    if (Array.isArray(data.expenses)) {
      for (const e of data.expenses) {
        await this.saveExpense(e);
      }
    }
    if (Array.isArray(data.appointments)) {
      for (const a of data.appointments) {
        await this.addAppointment(a);
      }
    }
    if (Array.isArray(data.insuranceLetters)) {
      for (const l of data.insuranceLetters) {
        await this.addInsuranceLetter(l);
      }
    }
  }

  // ================= 15. Patient Images & Attachments =================
  async getPatientImages(patientId) {
    this.ensureConnected();
    try {
      const { data, error } = await supabase
        .from('patient_images')
        .select('*')
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []).map(row => ({
        ...(row.data || {}),
        id: row.id,
        patientId: row.patient_id,
        title: row.title,
        category: row.category,
        notes: row.notes,
        dataUrl: row.data_url || row.data?.dataUrl,
        createdAt: row.created_at
      }));
    } catch (err) {
      console.error('getPatientImages error:', err);
      return [];
    }
  }

  async addPatientImage(patientId, imageData) {
    this.ensureConnected();
    if (!patientId) throw new Error('patientId is required');

    const imageId = 'img_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    const now = new Date().toISOString();

    const payload = {
      id: imageId,
      patientId,
      title: imageData.title || 'أشعة / تحليل',
      category: imageData.category || 'other',
      notes: imageData.notes || '',
      dataUrl: imageData.dataUrl,
      createdAt: now,
      createdBy: imageData.createdBy || ''
    };

    const row = {
      id: imageId,
      patient_id: patientId,
      title: payload.title,
      category: payload.category,
      notes: payload.notes,
      data_url: payload.dataUrl,
      created_at: now,
      created_by: payload.createdBy,
      data: payload
    };

    const { error } = await supabase.from('patient_images').upsert(row);
    if (error) throw new Error('فشل حفظ المستند: ' + error.message);
    return payload;
  }

  async updatePatientImage(patientId, imageId, updates) {
    this.ensureConnected();
    try {
      const { data: existing } = await supabase.from('patient_images').select('*').eq('id', imageId).single();
      const updatedData = { ...(existing?.data || {}), ...updates };

      const rowUpdates = { data: updatedData };
      if (updates.title) rowUpdates.title = updates.title;
      if (updates.category) rowUpdates.category = updates.category;
      if (updates.notes !== undefined) rowUpdates.notes = updates.notes;

      const { error } = await supabase.from('patient_images').update(rowUpdates).eq('id', imageId);
      if (error) throw error;
      return true;
    } catch (err) {
      console.error('updatePatientImage error:', err);
      throw new Error('فشل تعديل بيانات المستند.');
    }
  }

  async deletePatientImage(patientId, imageId) {
    this.ensureConnected();
    try {
      const { error } = await supabase.from('patient_images').delete().eq('id', imageId);
      if (error) throw error;
      return true;
    } catch (err) {
      console.error('deletePatientImage error:', err);
      throw new Error('فشل حذف المستند.');
    }
  }
}

export const db = new SupabaseDatabaseService();
