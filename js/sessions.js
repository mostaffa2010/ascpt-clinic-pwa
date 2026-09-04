import { escapeHTML } from './utils.js';
// ========================================================
// PhysioFlow - Daily Sessions & Check-in Module
// ========================================================

import { db } from './db.js';
import { auth } from './auth.js';
import { RolesManager } from './roles.js';

export class SessionsManager {
  constructor(app) {
    this.app = app;
    this.todayDateStr = new Date().toISOString().split('T')[0];
    this.currentSessionDate = this.todayDateStr;
    this.selectedPatientId = null;
    this.editingSessionId = null;
    this.insEditMode = false;
    this.currentContractType = 'direct';
    window.sessionsManager = this;
  }

  async init() {
    this.bindEvents();
    const dateInput = document.getElementById('session-date');
    if (dateInput) dateInput.value = this.currentSessionDate;
    this.updateDateLabel();
    this.renderAllInsuranceChips();
    await this.loadTodaySessions();
  }

  bindEvents() {
    // 0. Session Date Change
    const dateInput = document.getElementById('session-date');
    if (dateInput) {
      dateInput.addEventListener('change', (e) => {
        this.currentSessionDate = e.target.value;
        this.syncQuickDateButtons(this.currentSessionDate);
        this.updateDateLabel();
        this.loadTodaySessions();
      });
    }

    // Quick Date Buttons
    document.getElementById('btn-quick-sess-today')?.addEventListener('click', () => this.setDateQuick('today'));
    document.getElementById('btn-quick-sess-yesterday')?.addEventListener('click', () => this.setDateQuick('yesterday'));

    // 1. Body parts buttons toggle (100% bug-free click handling)
    const chipsContainer = document.getElementById('body-parts-container');
    if (chipsContainer) {
      chipsContainer.querySelectorAll('.chip-choice').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          btn.classList.toggle('selected');
          this.updateBodyPartsCount();
        });
      });
    }

    // 2. Patient Picker Search Filter & Triggers
    document.getElementById('patient-picker-trigger')?.addEventListener('click', () => this.openPatientPicker());
    document.getElementById('btn-change-patient-picker')?.addEventListener('click', () => this.openPatientPicker());

    const pickerSearch = document.getElementById('picker-search-input');
    if (pickerSearch) {
      pickerSearch.addEventListener('input', () => this.renderPickerPatients());
    }

    // Event Delegation: Patient Picker List
    const pickerList = document.getElementById('picker-patients-list');
    if (pickerList) {
      pickerList.addEventListener('click', (e) => {
        const addBtn = e.target.closest('.btn-picker-add-patient');
        if (addBtn) {
          this.app.closeModal('modal-patient-picker');
          this.app.patientsManager.openAddModal();
          return;
        }
        const item = e.target.closest('.picker-item');
        if (item) {
          const pid = item.getAttribute('data-patient-id');
          if (pid) this.selectPatient(pid);
        }
      });
    }

    // 3. Toggle Insurance fields on radio change
    const payRadios = document.querySelectorAll('input[name="session-pay-type"]');
    payRadios.forEach(r => {
      r.addEventListener('change', (e) => {
        const insFields = document.getElementById('session-insurance-fields');
        insFields.style.display = e.target.value === 'insurance' ? 'block' : 'none';
      });
    });

    // Contract Type Radios in Session Form
    document.querySelectorAll('input[name="session-contract-type"]').forEach(r => {
      r.addEventListener('change', (e) => this.onContractTypeChanged(e.target.value));
    });

    // Toggle Insurance Edit Mode
    document.getElementById('btn-toggle-chips-ins-session')?.addEventListener('click', () => this.toggleInsuranceEditMode('session'));

    // Event Delegation: Session Insurance Chips Containers
    ['session-ins-direct-container', 'session-ins-indirect-container'].forEach(id => {
      const container = document.getElementById(id);
      if (container) {
        container.addEventListener('click', (e) => {
          const delTag = e.target.closest('[data-action="delete-insurance"]');
          if (delTag) {
            e.stopPropagation();
            this.deleteInsuranceDirect(delTag.dataset.contract, delTag.dataset.company);
            return;
          }
          const addBtn = e.target.closest('[data-action="add-insurance"]');
          if (addBtn) {
            e.stopPropagation();
            this.openAddInsuranceModal(addBtn.dataset.contract, addBtn.dataset.source || 'session');
            return;
          }
          const chip = e.target.closest('[data-action="select-insurance"]');
          if (chip) {
            this.selectInsuranceCompany(chip.dataset.contract, chip.dataset.company);
          }
        });
      }
    });

    // Modal Add Insurance Company Form & Radio sync
    const formAddCompany = document.getElementById('form-add-insurance-company');
    if (formAddCompany) {
      formAddCompany.addEventListener('submit', (e) => this.handleSaveNewCompany(e));
    }
    const updateTargetContract = (val) => {
      const targetInput = document.getElementById('ins-target-contract');
      if (targetInput) targetInput.value = val;
    };
    document.getElementById('new-ins-type-direct')?.addEventListener('change', (e) => updateTargetContract(e.target.value));
    document.getElementById('new-ins-type-indirect')?.addEventListener('change', (e) => updateTargetContract(e.target.value));

    // 4. Form Submit
    const form = document.getElementById('form-log-session');
    if (form) {
      form.addEventListener('submit', (e) => this.handleSaveSession(e));
    }

    // Event Delegation: Sessions Table Body
    const sessionsTbody = document.getElementById('sessions-today-tbody') || document.getElementById('sessions-today-table-body');
    if (sessionsTbody) {
      sessionsTbody.addEventListener('click', (e) => {
        const editBtn = e.target.closest('.btn-edit-session');
        if (editBtn) {
          const sid = editBtn.getAttribute('data-session-id');
          if (sid) this.editSession(sid);
          return;
        }
        const delBtn = e.target.closest('.btn-delete-session');
        if (delBtn) {
          const sid = delBtn.getAttribute('data-session-id');
          if (sid) this.deleteSession(sid);
          return;
        }
      });
    }
  }

  updateBodyPartsCount() {
    const selected = document.querySelectorAll('#body-parts-container .chip-choice.selected');
    const countDisplay = document.getElementById('selected-parts-count');
    if (countDisplay) {
      countDisplay.textContent = selected.length;
    }
  }

  getSelectedBodyParts() {
    return Array.from(document.querySelectorAll('#body-parts-container .chip-choice.selected'))
      .map(btn => btn.getAttribute('data-part'));
  }

  // Searchable Patient Picker
  async openPatientPicker() {
    const searchInput = document.getElementById('picker-search-input');
    if (searchInput) searchInput.value = '';
    await this.renderPickerPatients();
    this.app.openModal('modal-patient-picker');
    if (searchInput) {
      setTimeout(() => searchInput.focus(), 250);
    }
  }

  // ================= Smart Arabic Search & Relevance Ranking =================
  normalizeArabic(text) {
    if (!text) return '';
    return text.toString().trim().toLowerCase()
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/[\u064B-\u065F\u0670]/g, '');
  }

  getPatientSearchScore(p, rawQuery) {
    const q = this.normalizeArabic(rawQuery);
    if (!q) return 1;

    const name = this.normalizeArabic(p.name);
    const words = name.split(/\s+/);

    // 1. First name starts directly with query (Top Priority: 10,000+)
    if (words[0] && words[0].startsWith(q)) {
      return 10000 - words[0].length;
    }

    // 2. Second word (Father's name) starts with query (Priority: 5,000+)
    if (words[1] && words[1].startsWith(q)) {
      return 5000 - words[1].length;
    }

    // 3. Third or subsequent word starts with query (Priority: 2,000+)
    for (let i = 2; i < words.length; i++) {
      if (words[i].startsWith(q)) {
        return 2000 - (i * 10);
      }
    }

    // 4. Substring match in full name
    if (name.includes(q)) {
      return 500;
    }

    // 5. Phone match
    const phone = (p.phone || '').replace(/[^0-9]/g, '');
    const cleanDigits = rawQuery.replace(/[^0-9]/g, '');
    if (cleanDigits && phone.includes(cleanDigits)) {
      return phone.startsWith(cleanDigits) ? 200 : 100;
    }

    // 6. Insurance match
    if (p.insuranceCompany && this.normalizeArabic(p.insuranceCompany).includes(q)) {
      return 50;
    }

    return -1;
  }

  async renderPickerPatients() {
    const container = document.getElementById('picker-patients-list');
    if (!container) return;

    const rawSearch = document.getElementById('picker-search-input')?.value.trim() || '';
    const patients = await db.getPatients();

    let scored = [];
    for (const p of patients) {
      if (!rawSearch) {
        scored.push({ patient: p, score: 0 });
      } else {
        const score = this.getPatientSearchScore(p, rawSearch);
        if (score > 0) {
          scored.push({ patient: p, score });
        }
      }
    }

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.patient.name.localeCompare(b.patient.name, 'ar');
    });

    const filtered = scored.map(item => item.patient);

    if (filtered.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 24px; color: var(--text-muted); font-size: 0.9rem;">
          لا يوجد مريض بهذا الاسم أو الرقم.<br>
          <button type="button" class="btn btn-primary btn-sm btn-picker-add-patient" style="margin-top: 10px;">
            <i class="fa-solid fa-user-plus"></i> تسجيل مريض جديد الآن
          </button>
        </div>
      `;
      return;
    }

    container.innerHTML = filtered.map(p => {
      let badge = '';
      const safeComp = escapeHTML(p.insuranceCompany || 'تأمين');
      if (p.billing === 'cash') {
        badge = `<span class="badge badge-cash">نقدي</span>`;
      } else {
        const cType = p.contractType === 'direct' ? 'مباشر' : 'غير مباشر';
        badge = `<span class="badge badge-direct">${safeComp} (${cType})</span>`;
      }

      const safeId = escapeHTML(p.id);
      const safeName = escapeHTML(p.name);
      const safePhone = escapeHTML(p.phone);
      const safeDoctor = escapeHTML(p.doctor);

      return `
        <div class="picker-item" data-patient-id="${safeId}">
          <div>
            <div style="font-weight: 700; color: var(--text-main); font-size: 0.95rem;">
              <i class="fa-solid fa-user" style="color: var(--primary); margin-left: 6px;"></i> ${safeName}
            </div>
            <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 3px;">
              <i class="fa-solid fa-phone" style="font-size: 0.75rem;"></i> ${safePhone} | <span style="color: #1e293b; font-weight: 600;">${safeDoctor}</span>
            </div>
          </div>
          <div>${badge}</div>
        </div>
      `;
    }).join('');
  }

  async selectPatient(patientId) {
    const patients = await db.getPatients();
    const patient = patients.find(p => p.id === patientId);
    if (!patient) return;

    this.selectedPatientId = patient.id;
    document.getElementById('session-patient-id').value = patient.id;

    // Update UI Box
    const trigger = document.getElementById('patient-picker-trigger');
    const selectedBox = document.getElementById('selected-patient-box');
    const nameEl = document.getElementById('selected-patient-name');
    const subEl = document.getElementById('selected-patient-sub');

    if (trigger) trigger.style.display = 'none';
    if (selectedBox) selectedBox.style.display = 'flex';

    if (nameEl) nameEl.textContent = patient.name;
    if (subEl) {
      const billingTxt = patient.billing === 'cash' 
        ? 'نقدي' 
        : `تأمين: ${patient.insuranceCompany || 'شركة'} (${patient.contractType === 'direct' ? 'مباشر' : 'غير مباشر'})`;
      subEl.textContent = `الهاتف: ${patient.phone} | الطبيب: ${patient.doctor} | ${billingTxt}`;
    }

    // Auto-fill Doctor
    const docSelect = document.getElementById('session-doctor-select');
    if (docSelect) docSelect.value = patient.doctor;

    // Auto-fill Billing & Insurance
    const payRadios = document.querySelectorAll('input[name="session-pay-type"]');
    payRadios.forEach(r => { r.checked = (r.value === patient.billing); });

    const insFields = document.getElementById('session-insurance-fields');
    if (patient.billing === 'insurance') {
      insFields.style.display = 'block';
      document.getElementById('session-insurance-name').value = patient.insuranceCompany || '';
      const cRadios = document.querySelectorAll('input[name="session-contract-type"]');
      cRadios.forEach(r => { r.checked = (r.value === (patient.contractType || 'direct')); });
    } else {
      insFields.style.display = 'none';
    }

    this.app.closeModal('modal-patient-picker');
  }

  resetPatientSelection() {
    this.selectedPatientId = null;
    document.getElementById('session-patient-id').value = '';
    const trigger = document.getElementById('patient-picker-trigger');
    const selectedBox = document.getElementById('selected-patient-box');
    if (trigger) trigger.style.display = 'flex';
    if (selectedBox) selectedBox.style.display = 'none';
  }

  async handleSaveSession(e) {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري تسجيل الجلسة...';
      setTimeout(() => {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fa-solid fa-check"></i> حفظ الجلسة';
      }, 1500);
    }
    const currentUser = auth.getCurrentUser();
    
    if (!this.selectedPatientId) {
      await this.app.showAlert('يرجى اختيار المريض من السجل أولاً لتسجيل الجلسة.', 'تنبيه', 'warning');
      this.openPatientPicker();
      return;
    }

    const patients = await db.getPatients();
    const patient = patients.find(p => p.id === this.selectedPatientId);
    const patientName = patient ? patient.name : 'مريض';

    const doctor = document.getElementById('session-doctor-select').value;
    
    // Body parts selection
    const selectedParts = this.getSelectedBodyParts();
    if (selectedParts.length === 0) {
      await this.app.showAlert('يرجى تحديد عضو واحد على الأقل تم علاجه في الجلسة (اضغط على أزرار الأعضاء المعالجة).', 'تنبيه', 'warning');
      return;
    }

    const payType = document.querySelector('input[name="session-pay-type"]:checked')?.value || 'cash';
    let insuranceName = '';
    let contractType = '';
    if (payType === 'insurance') {
      insuranceName = document.getElementById('session-insurance-name').value.trim();
      contractType = document.querySelector('input[name="session-contract-type"]:checked')?.value || 'direct';
    }

    const amountPaid = parseFloat(document.getElementById('session-amount-paid').value) || 0;
    const notes = document.getElementById('session-notes').value.trim();

    const sessionDateVal = document.getElementById('session-date')?.value || this.currentSessionDate;
    const isEdit = Boolean(this.editingSessionId);

    const sessionData = {
      id: this.editingSessionId || null,
      date: sessionDateVal,
      patientId: this.selectedPatientId,
      patientName,
      doctor,
      bodyParts: selectedParts,
      bodyPartsCount: selectedParts.length,
      payType,
      insuranceName,
      contractType,
      amountPaid,
      notes
    };

    await db.saveSession(sessionData, currentUser);
    const auditAction = isEdit ? 'تعديل جلسة' : 'تسجيل جلسة';
    const auditDesc = isEdit
      ? `تعديل بيانات جلسة المريض ${patientName} بتاريخ ${sessionDateVal} (مسدد: ${amountPaid} ج.م)`
      : `تسجيل جلسة للمريض ${patientName} مع ${doctor} بتاريخ ${sessionDateVal} (${selectedParts.length} أعضاء: ${selectedParts.join('، ')} - مسدد: ${amountPaid} ج.م)`;

    await db.logAudit(auditAction, auditDesc, currentUser);
    this.app.showToast(isEdit ? 'تم تعديل بيانات الجلسة بنجاح' : 'تم تسجيل وحفظ الجلسة بنجاح');
    this.resetSessionForm();
    this.renderAllInsuranceChips();
    await this.loadTodaySessions();
    
    // التحديث الفوري للحسابات والتقرير اليومي
    await this.app.financeManager.loadDailyReport();
  }

  // ================= Insurance Interactive Buttons =================
  renderAllInsuranceChips() {
    this.renderInsuranceChips('direct', 'session-ins-direct-container');
    this.renderInsuranceChips('indirect', 'session-ins-indirect-container');
  }

  renderInsuranceChips(contractType, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const companies = db.getInsuranceCompanies(contractType);
    const selectedCompany = document.getElementById('session-insurance-name')?.value || '';
    const isEdit = Boolean(this.insEditMode);
    const icon = contractType === 'direct' ? 'fa-solid fa-file-contract' : 'fa-solid fa-handshake';

    let html = companies.map(comp => {
      const isSelected = comp === selectedCompany;
      const safeComp = comp.replace(/'/g, "\\'");
      const editClass = isEdit ? 'in-edit-mode' : '';
      const deleteIconHtml = isEdit
        ? `<span class="chip-delete-tag" data-action="delete-insurance" data-contract="${contractType}" data-company="${safeComp}" title="حذف الشركة"><i class="fa-solid fa-circle-xmark"></i></span>`
        : '';

      return `
        <button type="button" class="chip-choice sheet-chip chip-${contractType} ${isSelected ? 'selected' : ''} ${editClass}" data-action="select-insurance" data-contract="${contractType}" data-company="${safeComp}">
          <i class="${icon}"></i> <span>${comp}</span>
          ${deleteIconHtml}
        </button>
      `;
    }).join('');

    if (isEdit) {
      html += `
        <button type="button" class="chip-add-new-btn" data-action="add-insurance" data-contract="${contractType}" data-source="session">
          <i class="fa-solid fa-plus"></i> <span>إضافة شركة جديدة</span>
        </button>
      `;
    }

    container.innerHTML = html;
  }

  selectInsuranceCompany(contractType, compName) {
    if (this.insEditMode) return;

    const input = document.getElementById('session-insurance-name');
    if (input) input.value = compName;

    const preview = document.getElementById('session-selected-ins-preview');
    if (preview) preview.textContent = `المختارة: ${compName}`;

    // Highlight selected chip in both direct and indirect containers
    document.querySelectorAll('#session-ins-direct-container .sheet-chip, #session-ins-indirect-container .sheet-chip').forEach(btn => {
      const isMatch = btn.textContent.trim().includes(compName);
      btn.classList.toggle('selected', isMatch);
    });
  }

  onContractTypeChanged(contractType) {
    this.currentContractType = contractType;
    const directCont = document.getElementById('session-ins-direct-container');
    const indirectCont = document.getElementById('session-ins-indirect-container');

    if (directCont && indirectCont) {
      if (contractType === 'direct') {
        directCont.style.display = 'flex';
        indirectCont.style.display = 'none';
      } else {
        directCont.style.display = 'none';
        indirectCont.style.display = 'flex';
      }
    }
  }

  toggleInsuranceEditMode(caller = 'session') {
    const user = auth.getCurrentUser();
    if (!RolesManager.canManageUsers(user)) {
      this.app.showAlert('تعديل وحذف شركات التأمين متاح لمدير المركز فقط.', 'صلاحية المدير');
      return;
    }

    this.insEditMode = !this.insEditMode;
    const isEdit = this.insEditMode;

    const btn = document.getElementById('btn-toggle-chips-ins-session');
    if (btn) {
      if (isEdit) {
        btn.className = 'btn-edit-chips active';
        btn.innerHTML = '<i class="fa-solid fa-check"></i> <span class="edit-text">تم الانتهاء</span>';
      } else {
        btn.className = 'btn-edit-chips';
        btn.innerHTML = '<i class="fa-solid fa-pen-to-square"></i> <span class="edit-text">تعديل الشركات</span>';
      }
    }

    this.renderAllInsuranceChips();
  }

  async deleteInsuranceDirect(contractType, compName) {
    const user = auth.getCurrentUser();
    if (!RolesManager.canManageUsers(user)) return;

    const confirmed = await this.app.showConfirm(`هل أنت متأكد من حذف شركة "${compName}" نهائياً؟`, 'حذف شركة تأمين');
    if (confirmed) {
      await db.deleteInsuranceCompany(contractType, compName);
      this.renderAllInsuranceChips();
      if (this.app.patientsManager) this.app.patientsManager.renderAllInsuranceChips();
      this.app.showToast(`تم حذف شركة "${compName}"`);
      await db.logAudit('حذف شركة تأمين', `حذف شركة ${compName} من قائمة ${contractType}`, user);
    }
  }

  openAddInsuranceModal(contractType, caller = 'session') {
    const user = auth.getCurrentUser();
    if (!RolesManager.canManageUsers(user)) {
      this.app.showAlert('إضافة شركات التأمين متاح لمدير المركز فقط.', 'صلاحية المدير');
      return;
    }

    document.getElementById('ins-target-contract').value = contractType;
    document.getElementById('ins-caller-context').value = caller;
    document.getElementById('ins-new-name').value = '';

    const rDirect = document.getElementById('new-ins-type-direct');
    const rIndirect = document.getElementById('new-ins-type-indirect');
    if (rDirect) rDirect.checked = (contractType === 'direct');
    if (rIndirect) rIndirect.checked = (contractType === 'indirect');

    this.app.openModal('modal-add-insurance-company');
  }

  async handleSaveNewCompany(e) {
    e.preventDefault();
    const contractType = document.getElementById('ins-target-contract').value;
    const nameInput = document.getElementById('ins-new-name');
    const name = nameInput.value.trim();

    if (!name || !contractType) return;

    await db.addInsuranceCompany(contractType, name);
    this.renderAllInsuranceChips();
    if (this.app.patientsManager) this.app.patientsManager.renderAllInsuranceChips();

    this.selectInsuranceCompany(contractType, name);
    this.app.closeModal('modal-add-insurance-company');
    this.app.showToast(`تمت إضافة شركة "${name}" بنجاح`);
    await db.logAudit('إضافة شركة تأمين', `إضافة شركة ${name} في تعاقد ${contractType}`, auth.getCurrentUser());
  }


  setDateQuick(type) {
    if (type === 'today') {
      this.currentSessionDate = this.todayDateStr;
    } else if (type === 'yesterday') {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      this.currentSessionDate = d.toISOString().split('T')[0];
    }
    const dateInput = document.getElementById('session-date');
    if (dateInput) dateInput.value = this.currentSessionDate;

    this.syncQuickDateButtons(this.currentSessionDate);
    this.updateDateLabel();
    this.loadTodaySessions();
  }

  syncQuickDateButtons(dateStr) {
    const btnToday = document.getElementById('btn-quick-sess-today');
    const btnYest = document.getElementById('btn-quick-sess-yesterday');
    const today = this.todayDateStr;
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const yesterday = d.toISOString().split('T')[0];

    if (btnToday) {
      if (dateStr === today) {
        btnToday.classList.add('active');
      } else {
        btnToday.classList.remove('active');
      }
    }
    if (btnYest) {
      if (dateStr === yesterday) {
        btnYest.classList.add('active');
      } else {
        btnYest.classList.remove('active');
      }
    }
  }

  updateDateLabel() {
    const label = document.getElementById('sessions-table-date-label');
    if (!label) return;
    if (this.currentSessionDate === this.todayDateStr) {
      label.innerHTML = 'اليوم';
    } else {
      const yest = new Date();
      yest.setDate(yest.getDate() - 1);
      const yestStr = yest.toISOString().split('T')[0];
      if (this.currentSessionDate === yestStr) {
        label.innerHTML = `أمس • <bdi dir="ltr">${this.currentSessionDate}</bdi>`;
      } else {
        label.innerHTML = `<bdi dir="ltr">${this.currentSessionDate}</bdi>`;
      }
    }
  }

  async editSession(sessionId) {
    const allSessions = await db.getSessions();
    const s = allSessions.find(item => item.id === sessionId);
    if (!s) return;

    // 1. Switch to sessions view
    this.app.switchView('sessions');

    // 2. Set state
    this.editingSessionId = s.id;
    this.currentSessionDate = s.date || this.todayDateStr;
    const dateInput = document.getElementById('session-date');
    if (dateInput) dateInput.value = this.currentSessionDate;
    this.updateDateLabel();

    // 3. Select patient
    await this.selectPatient(s.patientId);

    // 4. Select doctor
    const docSelect = document.getElementById('session-doctor-select');
    if (docSelect) {
      docSelect.value = s.doctor;
      this.app.updateCustomSelectDisplay('session-doctor-select');
    }

    // 5. Select body parts
    const savedParts = s.bodyParts || [];
    document.querySelectorAll('#body-parts-container .chip-choice').forEach(btn => {
      const val = btn.getAttribute('data-part');
      btn.classList.toggle('selected', savedParts.includes(val));
    });
    this.updateBodyPartsCount();

    // 6. Payment
    const payRadios = document.querySelectorAll('input[name="session-pay-type"]');
    payRadios.forEach(r => { r.checked = (r.value === s.payType); });

    const insFields = document.getElementById('session-insurance-fields');
    if (s.payType === 'insurance') {
      insFields.style.display = 'block';
      document.getElementById('session-insurance-name').value = s.insuranceName || '';
      const cRadios = document.querySelectorAll('input[name="session-contract-type"]');
      cRadios.forEach(r => { r.checked = (r.value === (s.contractType || 'direct')); });
    } else {
      insFields.style.display = 'none';
    }

    document.getElementById('session-amount-paid').value = s.amountPaid || 0;
    document.getElementById('session-notes').value = s.notes || '';

    // 7. Update submit button
    const submitBtn = document.querySelector('#form-log-session button[type="submit"]');
    if (submitBtn) {
      submitBtn.innerHTML = '<i class="fa-solid fa-pen-to-square"></i> حفظ تعديل الجلسة';
      submitBtn.className = 'btn btn-success';
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
    this.app.showToast(`جاري تعديل جلسة: ${s.patientName}`);
  }

  resetSessionForm() {
    this.editingSessionId = null;
    const submitBtn = document.querySelector('#form-log-session button[type="submit"]');
    if (submitBtn) {
      submitBtn.innerHTML = '<i class="fa-solid fa-check"></i> حفظ الجلسة';
      submitBtn.className = 'btn btn-primary';
    }
    document.getElementById('form-log-session').reset();
    const dateInput = document.getElementById('session-date');
    if (dateInput) dateInput.value = this.currentSessionDate;
    document.querySelectorAll('#body-parts-container .chip-choice').forEach(c => c.classList.remove('selected'));
    document.getElementById('selected-parts-count').textContent = '0';
    document.getElementById('session-insurance-fields').style.display = 'none';
    this.resetPatientSelection();
  }

  async loadTodaySessions() {
    const sessions = await db.getSessions(this.currentSessionDate);
    const tbody = document.getElementById('sessions-today-tbody');
    const badge = document.getElementById('sessions-today-count-badge');
    if (badge) badge.textContent = `${sessions.length} جلسة`;

    if (!tbody) return;

    if (sessions.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 25px;">لا توجد جلسات مسجلة اليوم حتى الآن.</td></tr>`;
      return;
    }

    const currentUser = auth.getCurrentUser();
    const canDelete = RolesManager.canDelete(currentUser);

    tbody.innerHTML = sessions.map(s => {
      const safeId = escapeHTML(s.id);
      const safePatient = escapeHTML(s.patientName);
      const safeDoc = escapeHTML(s.doctor);
      const safeIns = escapeHTML(s.insuranceName || 'تأمين');
      const safeAmount = escapeHTML(s.amountPaid);
      const safeRecBy = escapeHTML(s.recordedBy);
      const safeRecAt = escapeHTML(s.recordedAt);
      const safeParts = Array.isArray(s.bodyParts) ? s.bodyParts.map(b => escapeHTML(b)).join('، ') : escapeHTML(s.bodyParts || '');
      const safePartsShort = Array.isArray(s.bodyParts) ? s.bodyParts.slice(0, 2).map(b => escapeHTML(b)).join('، ') : escapeHTML(s.bodyParts || '');

      let payBadge = '';
      if (s.payType === 'cash') {
        payBadge = `<span class="badge badge-cash"><i class="fa-solid fa-money-bill"></i> نقدي</span>`;
      } else if (s.contractType === 'direct') {
        payBadge = `<span class="badge badge-direct"><i class="fa-solid fa-file-contract"></i> ${safeIns} (مباشر)</span>`;
      } else {
        payBadge = `<span class="badge badge-indirect"><i class="fa-solid fa-handshake"></i> ${safeIns} (غير مباشر)</span>`;
      }

      return `
        <tr>
          <td style="font-weight: 700;">${safePatient}</td>
          <td>${safeDoc}</td>
          <td>${payBadge}</td>
          <td>
            <span class="badge badge-role-doctor" title="${safeParts}">
              ${escapeHTML(s.bodyPartsCount)} أعضاء (${safePartsShort}${s.bodyParts && s.bodyParts.length > 2 ? '...' : ''})
            </span>
          </td>
          <td style="font-weight: 700; color: var(--success);">${safeAmount} ج.م</td>
          <td style="font-size: 0.8rem; color: var(--text-muted);">${safeRecBy} (${safeRecAt})</td>
          <td>
            <div style="display: flex; gap: 4px;">
              <button type="button" class="btn btn-outline btn-sm btn-edit-session" data-session-id="${safeId}" onclick="sessionsManager.editSession('${safeId}')" title="تعديل بيانات الجلسة">
                <i class="fa-solid fa-pen-to-square"></i>
              </button>
              ${canDelete ? `
                <button type="button" class="btn btn-outline btn-sm btn-delete-record btn-delete-session" style="color: var(--danger);" data-session-id="${safeId}" onclick="sessionsManager.deleteSession('${safeId}')" title="حذف">
                  <i class="fa-solid fa-trash"></i>
                </button>
              ` : ''}
            </div>
          </td>
        </tr>
      `;    }).join('');
  }

  async deleteSession(sessionId) {
    const confirmed = await this.app.showConfirm('هل أنت متأكد من حذف هذه الجلسة من سجلات اليوم؟', 'تأكيد الحذف');
    if (confirmed) {
      const currentUser = auth.getCurrentUser();
      await db.deleteSession(sessionId);
      await db.logAudit('حذف جلسة', `حذف حركة جلسة برقم ${sessionId}`, currentUser);
      this.app.showToast('تم حذف الجلسة');
      this.renderAllInsuranceChips();
    await this.loadTodaySessions();
      await this.app.financeManager.loadDailyReport();
    }
  }
}
