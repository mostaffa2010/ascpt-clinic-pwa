import { escapeHTML, getLocalDateStr, updatePickerTriggerDisplay } from './utils.js';
// ========================================================
// PhysioFlow - Patients Management Module
// ========================================================

import { db } from './db.js';
import { auth } from './auth.js';
import { RolesManager } from './roles.js';

export class PatientsManager {
  constructor(app) {
    this.app = app;
    this.patients = [];
    this.currentSheetPatient = null;
    this.selectedApprovedBodyParts = [];
    this.selectedRenewApprovedBodyParts = [];
    this.selectedModalities = [];
    this.selectedProcedures = [];
    this.selectedExercises = [];
    window.patientsManager = this;
    this.insEditMode = false;
    this.currentContractType = "direct";
    this.chipsEditMode = {
      modality: false,
      procedure: false,
      exercise: false
    };
    this.filterTodayOnly = false;
  }

  async init() {
    this.bindEvents();
    this.renderAllInsuranceChips();
    await this.loadPatients();
  }

  bindEvents() {
    const searchInput = document.getElementById('patient-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', () => this.renderPatients());
    }

    const filterType = document.getElementById('patient-filter-type');
    if (filterType) {
      filterType.addEventListener('change', () => this.renderPatients());
    }

    const btnToday = document.getElementById('btn-filter-today-patients');
    if (btnToday) {
      btnToday.addEventListener('click', () => this.toggleTodayFilter());
    }

    const btnOpenAdd = document.getElementById('btn-open-add-patient');
    if (btnOpenAdd) {
      btnOpenAdd.addEventListener('click', () => this.openAddModal());
    }

    // Toggle Insurance Fields in Patient Form
    const billingRadios = document.querySelectorAll('input[name="p-billing"]');
    billingRadios.forEach(r => {
      r.addEventListener('change', (e) => {
        const insBox = document.getElementById('p-insurance-details');
        if (insBox) {
          insBox.style.display = e.target.value === 'insurance' ? 'block' : 'none';
        }
      });
    });

    // Contract Type Radios in Patient Form
    document.querySelectorAll('input[name="p-contract-type"]').forEach(r => {
      r.addEventListener('change', (e) => this.onContractTypeChanged(e.target.value));
    });

    // Patient Modal: Insurance Company Picker & Approved Body Parts Picker
    document.getElementById('btn-open-p-insurance-picker')?.addEventListener('click', () => this.openInsuranceCompanyPicker());
    document.getElementById('btn-open-p-approved-body-parts-picker')?.addEventListener('click', () => this.openApprovedBodyPartsPicker());
    document.getElementById('btn-open-renew-body-parts-picker')?.addEventListener('click', () => this.openRenewBodyPartsPicker());

    // Input listener on approved sessions in patient modal
    document.getElementById('p-approved-sessions')?.addEventListener('input', () => this.updateApprovalSummary());

    // Renew Modal input listener
    document.getElementById('renew-sessions-count')?.addEventListener('input', () => this.updateRenewSummary());

    // Patient Sheet Navigation & Print Buttons
    document.getElementById('btn-back-to-patients-top')?.addEventListener('click', () => this.app.switchView('patients'));
    document.getElementById('btn-back-to-patients-bottom')?.addEventListener('click', () => this.app.switchView('patients'));
        const btnTop = document.getElementById('btn-print-sheet-top');
    if (btnTop) {
      btnTop.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (btnTop.disabled) return;
        this.printCurrentSheet();
      };
    }
    const btnBottom = document.getElementById('btn-print-sheet-bottom');
    if (btnBottom) {
      btnBottom.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (btnBottom.disabled) return;
        this.printCurrentSheet();
      };
    }

    document.getElementById('btn-print-insurance-letter')?.addEventListener('click', () => this.openInsuranceLetterModal());
    document.getElementById('form-insurance-letter')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submitInsuranceLetter();
    });

    // Renew Insurance Approval Form Submit
    const formRenew = document.getElementById('form-renew-approval');
    if (formRenew) {
      formRenew.addEventListener('submit', (e) => this.handleConfirmRenewApproval(e));
    }

    // Cash Receipt Form Submit
    document.getElementById('form-cash-receipt')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.printCashReceipt();
    });

    // Medical Statement Form Submit
    document.getElementById('form-medical-statement')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.printMedicalStatement();
    });

    // Patient Sheet Form Submit
    const formSheet = document.getElementById('form-patient-sheet');
    if (formSheet) {
      formSheet.addEventListener('submit', (e) => this.handleSaveSheet(e));
    }

    // Clinical Sheet Searchable Pickers
    document.getElementById('btn-open-sheet-modalities-picker')?.addEventListener('click', () => this.openModalitiesPicker());
    document.getElementById('btn-open-sheet-procedures-picker')?.addEventListener('click', () => this.openProceduresPicker());
    document.getElementById('btn-open-sheet-exercises-picker')?.addEventListener('click', () => this.openExercisesPicker());

    // Real-time phone input digits filter
    const phoneInp = document.getElementById('p-phone');
    if (phoneInp) {
      phoneInp.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/[^0-9]/g, '');
      });
    }

    // Modal Add Clinical Option Form Submit
    const formAddOption = document.getElementById('form-add-clinical-option');
    if (formAddOption) {
      formAddOption.addEventListener('submit', (e) => this.handleSaveNewOption(e));
    }

    // Form Submission for Patient
    const form = document.getElementById('form-patient');
    if (form) {
      form.addEventListener('submit', (e) => this.handleSavePatient(e));
    }

    // Event Delegation: Patients Directory Table (sheet, edit, delete)
    const tbody = document.getElementById('patients-tbody');
    if (tbody) {
      tbody.addEventListener('click', (e) => {
        const sheetAction = e.target.closest('.btn-patient-sheet-action, .patient-sheet-link');
        if (sheetAction) {
          const pid = sheetAction.getAttribute('data-patient-id');
          if (pid) this.openPatientSheet(pid);
          return;
        }
        const docsBtn = e.target.closest('.btn-patient-docs');
        if (docsBtn) {
          const pid = docsBtn.getAttribute('data-patient-id');
          if (pid) this.openPatientDocsModal(pid);
          return;
        }
        const renewBtn = e.target.closest('.btn-renew-approval');
        if (renewBtn) {
          const pid = renewBtn.getAttribute('data-patient-id');
          if (pid) this.openRenewApprovalModal(pid);
          return;
        }
        const editBtn = e.target.closest('.btn-edit-patient');
        if (editBtn) {
          const pid = editBtn.getAttribute('data-patient-id');
          if (pid) this.openEditModal(pid);
          return;
        }
        const delBtn = e.target.closest('.btn-delete-patient');
        if (delBtn) {
          const pid = delBtn.getAttribute('data-patient-id');
          if (pid) this.confirmDelete(pid);
          return;
        }
        const insLetterBtn = e.target.closest('.btn-insurance-letter-row');
        if (insLetterBtn) {
          const pid = insLetterBtn.getAttribute('data-patient-id');
          if (pid) this.openInsuranceLetterModalForPatient(pid);
          return;
        }
      });
    }
  }

  async loadPatients() {
    // If sessions or appointments not loaded yet, fetch them for accurate today counting
    if (this.app?.sessionsManager && (!this.app.sessionsManager.sessions || this.app.sessionsManager.sessions.length === 0)) {
      try { await this.app.sessionsManager.loadTodaySessions(); } catch (_) {}
    }
    if (this.app?.appointmentsManager && (!this.app.appointmentsManager.appointments || this.app.appointmentsManager.appointments.length === 0)) {
      try { await this.app.appointmentsManager.loadAll(); } catch (_) {}
    }

    this.patients = await db.getPatients();
    this.renderPatients();
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

  toggleTodayFilter() {
    this.filterTodayOnly = !this.filterTodayOnly;
    const btn = document.getElementById('btn-filter-today-patients');
    if (btn) {
      if (this.filterTodayOnly) {
        btn.classList.add('btn-today-active');
      } else {
        btn.classList.remove('btn-today-active');
      }
    }
    this.renderPatients();
  }

  getTodayPatientIdentifiers() {
    const todayIds = new Set();
    const todayNames = new Set();
    const todayStr = getLocalDateStr();

    // 1. Sessions recorded today
    const sessions = this.app?.sessionsManager?.sessions || [];
    sessions.forEach(s => {
      const sDate = s.date || (s.createdAt ? s.createdAt.substring(0, 10) : '');
      if (sDate === todayStr) {
        if (s.patientId) todayIds.add(String(s.patientId).trim());
        if (s.patientName) todayNames.add(this.normalizeArabic(s.patientName));
      }
    });

    // 2. Weekly appointments schedule
    const appts = this.app?.appointmentsManager?.appointments || [];
    appts.forEach(a => {
      if (a.patientId) todayIds.add(String(a.patientId).trim());
      if (a.patientName) todayNames.add(this.normalizeArabic(a.patientName));
    });

    return { todayIds, todayNames };
  }

  renderPatients() {
    const tbody = document.getElementById('patients-tbody');
    if (!tbody) return;

    const rawSearch = document.getElementById('patient-search-input')?.value.trim() || '';
    const filterType = document.getElementById('patient-filter-type')?.value || 'all';
    const normSearch = this.normalizeArabic(rawSearch);
    const cleanDigits = rawSearch.replace(/[^0-9]/g, '');

    const { todayIds, todayNames } = this.getTodayPatientIdentifiers();
    const countBadge = document.getElementById('badge-today-patients-count');
    
    // Count matches among all patients
    const todayMatches = this.patients.filter(p => {
      const pId = String(p.id || '').trim();
      const pName = this.normalizeArabic(p.name || '');
      return todayIds.has(pId) || (pName && todayNames.has(pName));
    });
    if (countBadge) countBadge.textContent = todayMatches.length;

    let filtered = this.patients.filter(p => {
      // 0. Filter Today Only if active
      if (this.filterTodayOnly) {
        const pId = String(p.id || '').trim();
        const pName = this.normalizeArabic(p.name || '');
        const isToday = todayIds.has(pId) || (pName && todayNames.has(pName));
        if (!isToday) return false;
      }
      // 1. Smart Normalized Arabic & Phone Search
      let matchSearch = true;
      if (rawSearch) {
        const normName = this.normalizeArabic(p.name);
        const normPhone = (p.phone || '').replace(/[^0-9]/g, '');
        const normComp = this.normalizeArabic(p.insuranceCompany || '');
        const normDoc = this.normalizeArabic(p.doctor || '');
        const normAddr = this.normalizeArabic(p.address || '');

        matchSearch = 
          normName.includes(normSearch) ||
          (cleanDigits.length > 0 && normPhone.includes(cleanDigits)) ||
          normComp.includes(normSearch) ||
          normDoc.includes(normSearch) ||
          normAddr.includes(normSearch);
      }

      if (!matchSearch) return false;

      // 2. Billing Filter
      if (filterType === 'cash') return p.billing === 'cash';
      if (filterType === 'insurance_direct') return p.billing === 'insurance' && p.contractType === 'direct';
      if (filterType === 'insurance_indirect') return p.billing === 'insurance' && p.contractType === 'indirect';

      return true;
    });

    // 3. Relevance ranking if user typed a search query
    if (rawSearch) {
      filtered.sort((a, b) => {
        const scoreA = this.getPatientSearchScore(a, rawSearch);
        const scoreB = this.getPatientSearchScore(b, rawSearch);
        if (scoreB !== scoreA) {
          return scoreB - scoreA;
        }
        return a.name.localeCompare(b.name, 'ar');
      });
    }

    if (filtered.length === 0) {
      if (this.filterTodayOnly) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 30px;">
          <i class="fa-solid fa-calendar-xmark" style="font-size: 1.8rem; color: var(--text-muted); margin-bottom: 8px; display: block;"></i>
          لا توجد حالات مسجلة في مواعيد أو جلسات اليوم.<br>
          <button type="button" class="btn btn-outline btn-sm" id="btn-reset-today-filter" style="margin-top: 10px;">
            عرض كافة المرضى
          </button>
        </td></tr>`;
        document.getElementById('btn-reset-today-filter')?.addEventListener('click', () => this.toggleTodayFilter());
        return;
      }
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 30px;">لا يوجد مرضى مطابقين لكلمة البحث: <strong>"${escapeHTML(rawSearch)}"</strong></td></tr>`;
      return;
    }

    const currentUser = auth.getCurrentUser();
    const canAccessSheet = RolesManager.canAccessClinicalSheet(currentUser);
    const canDeletePatient = RolesManager.canDeletePatient(currentUser);
    const isDoctor = currentUser?.role === 'doctor';

    setTimeout(() => this.setupScrollSync(), 50);
    tbody.innerHTML = filtered.map(p => {
      let billingBadge = '';
      const safeComp = escapeHTML(p.insuranceCompany || 'تأمين');
      if (p.billing === 'cash') {
        billingBadge = `<span class="badge badge-cash"><i class="fa-solid fa-money-bill"></i> نقدي</span>`;
      } else if (p.contractType === 'direct') {
        const partsInfo = (p.approvedBodyPartsCount && p.approvedBodyPartsCount > 1) ? ` • ${p.approvedBodyPartsCount} أعضاء` : '';
        billingBadge = `<span class="badge badge-direct"><i class="fa-solid fa-file-contract"></i> ${safeComp} (مباشر)</span> <span class="badge" style="background: var(--bg-subtle); color: var(--text-main); border: 1px solid var(--border-color); font-size: 0.74rem; font-weight: 700; margin-right: 4px;" title="رصيد زيارات الجواب">${p.approvedSessions || 12} زيارة${partsInfo}</span>`;
      } else {
        const partsInfo = (p.approvedBodyPartsCount && p.approvedBodyPartsCount > 1) ? ` • ${p.approvedBodyPartsCount} أعضاء` : '';
        billingBadge = `<span class="badge badge-indirect"><i class="fa-solid fa-handshake"></i> ${safeComp} (غير مباشر)</span> <span class="badge" style="background: var(--bg-subtle); color: var(--text-main); border: 1px solid var(--border-color); font-size: 0.74rem; font-weight: 700; margin-right: 4px;" title="رصيد زيارات الجواب">${p.approvedSessions || 12} زيارة${partsInfo}</span>`;
      }

      const safeId = escapeHTML(p.id);
      const safeName = escapeHTML(p.name);
      const safeAge = escapeHTML(p.age);
      const safePhone = escapeHTML(p.phone);
      const safeAddress = escapeHTML(p.address || '-');
      const safeDoctor = escapeHTML(p.doctor);
      const safeEditor = escapeHTML(p.lastUpdatedBy || p.createdBy || '-');
      const cleanWaPhone = (p.phone || '').replace(/[^0-9]/g, '').replace(/^0/, '20');

      return `
        <tr>
          <td style="font-weight: 800; color: var(--primary); cursor: ${canAccessSheet ? 'pointer' : 'default'}; white-space: nowrap;"
              class="${canAccessSheet ? 'patient-sheet-link' : 'btn-edit-patient'}"
              data-patient-id="${safeId}"
              onclick="patientsManager.openPatientSheet('${safeId}')"
              title="${canAccessSheet ? 'اضغط لفتح الشيت الطبي' : 'تعديل بيانات المريض'}">
            <i class="fa-solid ${canAccessSheet ? 'fa-file-waveform' : 'fa-user'}" style="margin-left: 6px;"></i> ${safeName}
          </td>
          <td style="white-space: nowrap;">${safeAge} سنة</td>
          <td style="white-space: nowrap;">
            <a href="tel:${safePhone}" style="color: var(--primary); text-decoration: none; white-space: nowrap; direction: ltr; display: inline-flex; align-items: center; gap: 4px;">
              <i class="fa-solid fa-phone" style="font-size: 0.75rem;"></i> <bdi dir="ltr">${safePhone}</bdi>
            </a>
          </td>
          <td style="white-space: nowrap;">${safeAddress}</td>
          <td style="white-space: nowrap;"><span style="font-weight: 600; color: var(--text-main);">${safeDoctor}</span></td>
          <td style="white-space: nowrap;">${billingBadge}</td>
          <td style="font-size: 0.8rem; color: var(--text-muted); white-space: nowrap;">${safeEditor}</td>
          <td style="white-space: nowrap;">
            <div style="display: flex; gap: 6px; align-items: center; flex-wrap: nowrap;">
              ${canAccessSheet ? `
                <button type="button" class="btn btn-primary btn-sm btn-patient-sheet-action" data-patient-id="${safeId}" title="شيت العلاج الطبيعي">
                  <i class="fa-solid fa-file-waveform"></i> الشيت الطبي
                </button>
              ` : ''}
              ${!isDoctor ? `
                <button type="button" class="btn btn-outline btn-sm btn-patient-docs" data-patient-id="${safeId}" style="color: #0284c7; border-color: #0284c7; font-weight: 700; gap: 4px; display: inline-flex; align-items: center;" title="المستندات والطباعة (إيصال، إفادة، موافقات)">
                  <i class="fa-solid fa-file-invoice"></i> <span style="font-size: 0.76rem;">مستندات</span>
                </button>
              ` : ''}
              <a href="https://wa.me/${cleanWaPhone}" target="_blank" class="btn btn-outline btn-sm" style="color: #10b981; border-color: #10b981;" title="محادثة واتساب">
                <i class="fa-brands fa-whatsapp"></i>
              </a>
              ${!isDoctor ? `
                <button type="button" class="btn btn-outline btn-sm btn-edit-patient" data-patient-id="${safeId}" title="تعديل بيانات المريض">
                  <i class="fa-solid fa-pen-to-square"></i>
                </button>
              ` : ''}
              ${!isDoctor && canDeletePatient ? `
                <button type="button" class="btn btn-outline btn-sm btn-delete-patient" style="color: var(--danger);" data-patient-id="${safeId}" title="حذف المريض">
                  <i class="fa-solid fa-trash"></i>
                </button>
              ` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }


  // ================= Approved Sessions & Dynamic Body Parts Live Calculation =================
  formatPartsCountLabel(count) {
    if (count <= 1) return 'عضو واحد';
    if (count === 2) return 'عضوين';
    if (count >= 3 && count <= 10) return `${count} أعضاء`;
    return `${count} عضواً`;
  }

  updateApprovalSummary() {
    const visits = parseInt(document.getElementById('p-approved-sessions')?.value) || 0;
    const selected = this.getSelectedApprovedBodyParts();
    const partsCount = selected.length > 0 ? selected.length : (parseInt(document.getElementById('p-approved-body-parts-count')?.value) || 1);
    const hidden = document.getElementById('p-approved-body-parts-count');
    if (hidden) hidden.value = partsCount;

    // Update Counter Display below chips (Identical to sessions screen)
    const countDisplay = document.getElementById('p-approved-parts-count-display');
    if (countDisplay) {
      if (selected.length === 0) {
        countDisplay.textContent = 'عضو واحد (افتراضي)';
      } else {
        countDisplay.textContent = `${this.formatPartsCountLabel(selected.length)} (${selected.length})`;
      }
    }

    const docSessions = visits * partsCount;
    const visitsEl = document.getElementById('p-summary-visits');
    const docEl = document.getElementById('p-summary-doctor-sessions');
    if (visitsEl) visitsEl.textContent = `${visits} زيارة حضور فعلية`;
    if (docEl) {
      const partsLabel = this.formatPartsCountLabel(partsCount);
      docEl.textContent = `${docSessions} جلسة عمل للطبيب (${visits} زيارة × ${partsLabel})`;
    }
  }

  updateRenewSummary() {
    const visits = parseInt(document.getElementById('renew-sessions-count')?.value) || 0;
    const selected = this.getSelectedRenewApprovedBodyParts();
    const partsCount = selected.length > 0 ? selected.length : (parseInt(document.getElementById('renew-body-parts-count')?.value) || 1);
    const hidden = document.getElementById('renew-body-parts-count');
    if (hidden) hidden.value = partsCount;

    const countDisplay = document.getElementById('renew-approved-parts-count-display');
    if (countDisplay) {
      if (selected.length === 0) {
        countDisplay.textContent = 'عضو واحد (افتراضي)';
      } else {
        countDisplay.textContent = `${this.formatPartsCountLabel(selected.length)} (${selected.length})`;
      }
    }

    const docSessions = visits * partsCount;
    const docEl = document.getElementById('renew-summary-doctor-sessions');
    if (docEl) {
      const partsLabel = this.formatPartsCountLabel(partsCount);
      docEl.textContent = `${docSessions} جلسة للطبيب (${visits} زيارة × ${partsLabel})`;
    }
  }

  renderApprovedBodyPartsChips(selectedParts = null) {
    if (selectedParts !== null) {
      this.selectedApprovedBodyParts = Array.isArray(selectedParts) ? [...selectedParts] : [];
    }
    updatePickerTriggerDisplay({
      summaryId: 'p-approved-parts-summary',
      subId: 'p-approved-parts-sub',
      countBadgeId: 'p-approved-parts-count-badge',
      tagsContainerId: 'p-approved-parts-tags',
      selectedItems: this.selectedApprovedBodyParts,
      placeholder: 'اضغط لاختيار الأعضاء المعتمدة...',
      emptySub: 'حدد الأعضاء المذكورة بالخطاب',
      unitName: 'أعضاء',
      icon: 'fa-solid fa-bone',
      onRemove: (item) => {
        this.selectedApprovedBodyParts = this.selectedApprovedBodyParts.filter(p => p !== item);
        this.renderApprovedBodyPartsChips();
      }
    });

    const count = this.selectedApprovedBodyParts.length;
    const displayEl = document.getElementById('p-approved-parts-count-display');
    if (displayEl) {
      displayEl.textContent = this.formatPartsCountLabel(count);
    }
    const hiddenCount = document.getElementById('p-approved-body-parts-count');
    if (hiddenCount) {
      hiddenCount.value = count || 1;
    }
    this.updateApprovalSummary();
  }

  getSelectedApprovedBodyParts() {
    return Array.isArray(this.selectedApprovedBodyParts) ? this.selectedApprovedBodyParts : [];
  }

  renderRenewApprovedBodyPartsChips(selectedParts = null) {
    if (selectedParts !== null) {
      this.selectedRenewApprovedBodyParts = Array.isArray(selectedParts) ? [...selectedParts] : [];
    }
    updatePickerTriggerDisplay({
      summaryId: 'renew-approved-parts-summary',
      subId: 'renew-approved-parts-sub',
      countBadgeId: 'renew-approved-parts-count-badge',
      tagsContainerId: 'renew-approved-parts-tags',
      selectedItems: this.selectedRenewApprovedBodyParts,
      placeholder: 'اضغط لاختيار الأعضاء المعتمدة...',
      emptySub: 'حدد الأعضاء للدورة الجديدة',
      unitName: 'أعضاء',
      icon: 'fa-solid fa-bone',
      onRemove: (item) => {
        this.selectedRenewApprovedBodyParts = this.selectedRenewApprovedBodyParts.filter(p => p !== item);
        this.renderRenewApprovedBodyPartsChips();
      }
    });

    const count = this.selectedRenewApprovedBodyParts.length;
    const displayEl = document.getElementById('renew-approved-parts-count-display');
    if (displayEl) {
      displayEl.textContent = this.formatPartsCountLabel(count);
    }
    const hiddenCount = document.getElementById('renew-body-parts-count');
    if (hiddenCount) {
      hiddenCount.value = count || 1;
    }
    this.updateRenewSummary();
  }

  getSelectedRenewApprovedBodyParts() {
    return Array.isArray(this.selectedRenewApprovedBodyParts) ? this.selectedRenewApprovedBodyParts : [];
  }

  // ================= Insurance Picker Integration for Patient Registration =================
  renderAllInsuranceChips() {
    const compName = document.getElementById('p-insurance-company')?.value || '';
    const contractType = document.querySelector('input[name="p-contract-type"]:checked')?.value || 'direct';
    this.selectInsuranceCompany(contractType, compName);
  }

  selectInsuranceCompany(contractType, compName) {
    const input = document.getElementById('p-insurance-company');
    if (input) input.value = compName;

    const summaryEl = document.getElementById('p-insurance-company-summary');
    if (summaryEl) summaryEl.textContent = compName ? compName : '-- اضغط لاختيار شركة التأمين --';

    const subEl = document.getElementById('p-insurance-company-sub');
    if (subEl) {
      subEl.textContent = compName
        ? (contractType === 'direct' ? 'تعاقد مباشر' : 'تعاقد غير مباشر')
        : 'اختر من الشركات المسجلة أو أضف جديدة';
    }
  }

  onContractTypeChanged(contractType) {
    this.currentContractType = contractType;
    const compName = document.getElementById('p-insurance-company')?.value || '';
    this.selectInsuranceCompany(contractType, compName);
  }

  clearPhoneValidation() {
    const phoneInput = document.getElementById('p-phone');
    const feedback = document.getElementById('p-phone-feedback');
    if (phoneInput) phoneInput.classList.remove('input-error', 'input-success');
    if (feedback) { feedback.style.display = 'none'; feedback.innerHTML = ''; }
  }

  openAddModal() {
    document.getElementById('form-patient').reset();
    this.clearPhoneValidation();
    document.getElementById('p-id').value = '';
    this.app.updateCustomSelectDisplay('p-gender');
    const insComp = document.getElementById('p-insurance-company');
    if (insComp) insComp.value = '';
    const insPrev = document.getElementById('p-selected-ins-preview');
    if (insPrev) insPrev.textContent = '';

    document.getElementById('modal-patient-title').innerHTML = '<i class="fa-solid fa-user-plus"></i> تسجيل مريض جديد';
    document.getElementById('p-insurance-details').style.display = 'none';
    const appSessionsInp = document.getElementById('p-approved-sessions');
    if (appSessionsInp) appSessionsInp.value = '12';
    const hiddenCount = document.getElementById('p-approved-body-parts-count');
    if (hiddenCount) hiddenCount.value = '1';
    this.renderApprovedBodyPartsChips([]);
    this.onContractTypeChanged('direct');
    const directRadio = document.querySelector('input[name="p-contract-type"][value="direct"]');
    if (directRadio) directRadio.checked = true;
    this.app.openModal('modal-patient');
  }

  openEditModalFromSheet(patientId) {
    this.editingFromSheet = true;
    this.openEditModal(patientId);
  }

  async confirmDeleteFromSheet(patientId) {
    const p = this.patients.find(item => item.id === patientId);
    if (!p) return;

    const confirmed = await this.app.showConfirm(
      `هل أنت متأكد من حذف ملف المريض (${p.name}) نهائياً من المركز؟`,
      'حذف المريض'
    );

    if (confirmed) {
      await db.deletePatient(patientId);
      await db.logAudit('حذف مريض', `قام بحذف ملف المريض: ${p.name}`, auth.getCurrentUser());
      await this.loadPatients();
      this.app.switchView('patients');
      this.app.showToast(`تم حذف ملف المريض (${p.name}) بنجاح`);
    }
  }

  openEditModal(patientId) {
    const p = this.patients.find(item => item.id === patientId);
    if (!p) return;

    document.getElementById('p-id').value = p.id;
    document.getElementById('p-name').value = p.name;
    document.getElementById('p-age').value = p.age;
    document.getElementById('p-gender').value = p.gender || '';
    document.getElementById('p-phone').value = p.phone;
    document.getElementById('p-address').value = p.address || '';
    document.getElementById('p-doctor').value = p.doctor;
    this.app.updateCustomSelectDisplay('p-gender');
    this.app.updateCustomSelectDisplay('p-doctor');

    const billingRadios = document.querySelectorAll('input[name="p-billing"]');
    billingRadios.forEach(r => { r.checked = (r.value === p.billing); });

    const insBox = document.getElementById('p-insurance-details');
    if (p.billing === 'insurance') {
      insBox.style.display = 'block';
      document.getElementById('p-insurance-company').value = p.insuranceCompany || '';
      const cType = p.contractType || 'direct';
      const contractRadios = document.querySelectorAll('input[name="p-contract-type"]');
      contractRadios.forEach(r => { r.checked = (r.value === cType); });
      this.onContractTypeChanged(cType);
      const appSessionsInp = document.getElementById('p-approved-sessions');
      if (appSessionsInp) appSessionsInp.value = p.approvedSessions || 12;
      const hiddenCount = document.getElementById('p-approved-body-parts-count');
      if (hiddenCount) hiddenCount.value = p.approvedBodyPartsCount || 1;
      this.renderApprovedBodyPartsChips(p.approvedBodyParts || []);
    } else {
      insBox.style.display = 'none';
    }

    document.getElementById('modal-patient-title').innerHTML = '<i class="fa-solid fa-pen-to-square"></i> تعديل بيانات مريض';
    this.app.openModal('modal-patient');
  }

  async handleSavePatient(e) {
    e.preventDefault();
    const saveBtn = document.getElementById('btn-save-patient');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الحفظ...';
      setTimeout(() => {
        saveBtn.disabled = false;
        saveBtn.innerHTML = 'حفظ المريض';
      }, 1500);
    }
    const currentUser = auth.getCurrentUser();
    const id = document.getElementById('p-id').value;
    const name = document.getElementById('p-name').value.trim();
    const age = parseInt(document.getElementById('p-age').value);
    const gender = document.getElementById('p-gender').value;
    const phone = document.getElementById('p-phone').value.trim();
    const address = document.getElementById('p-address').value.trim();
    const docSelectEl = document.getElementById('p-doctor');
    const doctor = docSelectEl?.value || '';
    const selectedDoctorOpt = docSelectEl?.options[docSelectEl.selectedIndex];
    const doctorUid = selectedDoctorOpt?.getAttribute('data-uid') || '';
    const billing = document.querySelector('input[name="p-billing"]:checked')?.value || 'cash';

    // 1. Name Validation (must be at least 2 words and not contain numbers)
    const nameWords = name.split(/\s+/).filter(w => w.length > 0);
    if (nameWords.length < 2 || name.length < 5) {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = 'حفظ المريض'; }
      await this.app.showAlert('يرجى إدخال اسم المريض ثنائياً على الأقل (الاسم واسم العائلة).', 'اسم المريض غير مكتمل', 'warning');
      document.getElementById('p-name')?.focus();
      return;
    }
    if (/[0-9]/.test(name)) {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = 'حفظ المريض'; }
      await this.app.showAlert('اسم المريض يجب ألا يحتوي على أرقام.', 'خطأ في الاسم', 'warning');
      document.getElementById('p-name')?.focus();
      return;
    }

    // 2. Age Validation (must be between 1 and 120)
    if (isNaN(age) || age < 1 || age > 120) {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = 'حفظ المريض'; }
      await this.app.showAlert('يرجى إدخال سن صحيح للمريض (بين 1 و 120 سنة).', 'خطأ في السن', 'warning');
      document.getElementById('p-age')?.focus();
      return;
    }

    // 2.أ. Gender Validation
    if (gender !== 'male' && gender !== 'female') {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = 'حفظ المريض'; }
      await this.app.showAlert('يرجى اختيار نوع المريض (ذكر / أنثى).', 'بيانات ناقصة', 'warning');
      document.getElementById('p-gender')?.focus();
      return;
    }

    // 3. Strict Egyptian Mobile Phone Validation (010, 011, 012, 015 - exactly 11 digits)
    let cleanPhone = phone.replace(/[\s\-\(\)\.]/g, '');
    if (cleanPhone.startsWith('+20')) cleanPhone = '0' + cleanPhone.slice(3);
    else if (cleanPhone.startsWith('20') && cleanPhone.length === 12) cleanPhone = '0' + cleanPhone.slice(2);

    const egyptianMobileRegex = /^01[0125][0-9]{8}$/;
    if (!egyptianMobileRegex.test(cleanPhone)) {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = 'حفظ المريض'; }
      const phoneInput = document.getElementById('p-phone');
      phoneInput?.classList.add('input-error');

      let whatIsWrong = '';
      if (!cleanPhone.startsWith('01')) {
        whatIsWrong = `الرقم المدخل (${cleanPhone}) لا يبدأ بـ 01.`;
      } else if (cleanPhone.length !== 11) {
        whatIsWrong = `عدد أرقام الهاتف الحالي (${cleanPhone.length} أرقام) والمطلوب 11 رقماً.`;
      } else {
        whatIsWrong = `كود الشبكة (${cleanPhone.slice(0, 3)}) غير معتمد في شبكات مصر.`;
      }

      const alertMsg = `⚠️ خطأ في رقم الموبايل:\n${whatIsWrong}\n\n✅ كيف تملأ الحقل بشكل صحيح؟\nيجب كتابة 11 رقماً بالضبط، يبدأ بأحد أكواد شبكات المحمول:\n• 010 (فودافون)\n• 011 (إتصالات)\n• 012 (أورنج)\n• 015 (وي)\n\nمثال صحيح: 01012345678`;

      await this.app.showAlert(alertMsg, 'رقم الموبايل غير صحيح', 'warning');
      phoneInput?.focus();
      return;
    }
    const normalizedPhone = cleanPhone;

    // Duplicate Phone Check for new patients
    if (!id) {
      const existingPatient = this.patients.find(p => p.phone === normalizedPhone);
      if (existingPatient) {
        const confirmDup = await this.app.showConfirm(
          `رقم الهاتف (${normalizedPhone}) مسجل بالفعل للمريض (${existingPatient.name}). هل ترغب في الاستمرار وتسجيل ملف جديد بنفس الرقم؟`,
          'تنبيه رقم مكرر'
        );
        if (!confirmDup) {
          if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = 'حفظ المريض'; }
          return;
        }
      }
    }

    // 4. Doctor Validation
    if (!doctor || doctor === '') {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = 'حفظ المريض'; }
      await this.app.showAlert('يرجى اختيار الطبيب المعالج المتابع للحالة.', 'اختيار الطبيب', 'warning');
      return;
    }

    // 5. Insurance Company Validation
    let insuranceCompany = '';
    let contractType = '';
    if (billing === 'insurance') {
      insuranceCompany = document.getElementById('p-insurance-company').value.trim();
      if (!insuranceCompany || insuranceCompany.length < 2) {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = 'حفظ المريض'; }
        await this.app.showAlert('يرجى كتابة أو اختيار اسم شركة التأمين أو جهة التعاقد.', 'جهة التأمين مطلوبة', 'warning');
        document.getElementById('p-insurance-company')?.focus();
        return;
      }
      contractType = document.querySelector('input[name="p-contract"]:checked')?.value || 'direct';
    }

    let approvedSessions = 12;
    let approvedBodyPartsCount = 1;
    let approvedBodyParts = [];
    if (billing === 'insurance') {
      approvedSessions = parseInt(document.getElementById('p-approved-sessions')?.value) || 12;
      approvedBodyPartsCount = parseInt(document.getElementById('p-approved-body-parts-count')?.value) || 1;
      approvedBodyParts = this.getSelectedApprovedBodyParts();
    }

    const patientData = {
      id: id || null,
      name,
      age,
      gender,
      phone: normalizedPhone,
      address,
      doctor,
      doctorUid,
      billing,
      insuranceCompany,
      contractType,
      approvedSessions,
      approvedBodyPartsCount,
      approvedBodyParts
    };

    if (!id && billing === 'insurance') {
      patientData.currentApprovalStartDate = getLocalDateStr();
    } else if (id && billing === 'insurance') {
      const existingP = this.patients.find(p => p.id === id);
      patientData.currentApprovalStartDate = existingP?.currentApprovalStartDate || getLocalDateStr();
    }

    const actionResult = await db.savePatient(patientData, currentUser);
    const auditDesc = id 
      ? `تعديل ملف المريض: ${name}`
      : `تسجيل مريض جديد: ${name} (طبيب: ${doctor} - نظام: ${billing})`;
      
    try { await db.logAudit(id ? 'تعديل مريض' : 'إضافة مريض', auditDesc, currentUser); } catch (_) {}

    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = 'حفظ المريض';
    }

    this.app.closeModal('modal-patient');
    this.app.showToast(id ? 'تم تعديل بيانات المريض بنجاح' : 'تم إضافة المريض بنجاح');
    this.renderAllInsuranceChips();
    await this.loadPatients();
  }

  async confirmDelete(patientId) {
    const p = this.patients.find(item => item.id === patientId);
    if (!p) return;

    const confirmed = await this.app.showConfirm(`هل أنت متأكد من حذف ملف المريض: ${p.name}؟ هذا الإجراء لا يمكن التراجع عنه.`, 'تأكيد حذف المريض');
    if (confirmed) {
      const currentUser = auth.getCurrentUser();
      await db.deletePatient(patientId);
      await db.logAudit('حذف مريض', `قام بحذف ملف المريض: ${p.name}`, currentUser);
      this.app.showToast('تم حذف ملف المريض');
      this.renderAllInsuranceChips();
    await this.loadPatients();
    }
  }

  openRenewApprovalModal(patientId) {
    const patient = this.patients.find(p => p.id === patientId);
    if (!patient) return;

    document.getElementById('renew-patient-id').value = patient.id;
    document.getElementById('renew-patient-name').textContent = patient.name;
    const cTypeLabel = patient.contractType === 'indirect' ? 'تعاقد غير مباشر' : 'تعاقد مباشر';
    document.getElementById('renew-company-name').textContent = `${patient.insuranceCompany || 'شركة التأمين'} (${cTypeLabel})`;
    document.getElementById('renew-sessions-count').value = patient.approvedSessions || 12;
    const renewHidden = document.getElementById('renew-body-parts-count');
    if (renewHidden) renewHidden.value = patient.approvedBodyPartsCount || 1;
    this.renderRenewApprovedBodyPartsChips(patient.approvedBodyParts || []);
    document.getElementById('renew-approval-date').value = getLocalDateStr();
    document.getElementById('renew-approval-no').value = patient.insuranceApprovalNo || '';

    this.app.openModal('modal-renew-approval');
  }

  async handleConfirmRenewApproval(e) {
    e.preventDefault();
    const pid = document.getElementById('renew-patient-id')?.value;
    const newSessions = parseInt(document.getElementById('renew-sessions-count')?.value) || 12;
    const selectedRenewParts = this.getSelectedRenewApprovedBodyParts();
    const newPartsCount = selectedRenewParts.length > 0 ? selectedRenewParts.length : (parseInt(document.getElementById('renew-body-parts-count')?.value) || 1);
    const renewDate = document.getElementById('renew-approval-date')?.value || getLocalDateStr();
    const newApprovalNo = document.getElementById('renew-approval-no')?.value?.trim() || '';

    const patient = this.patients.find(p => p.id === pid);
    if (!patient) return;

    try {
      const currentUser = auth.getCurrentUser();
      const updates = {
        approvedSessions: newSessions,
        approvedBodyPartsCount: newPartsCount,
        approvedBodyParts: selectedRenewParts.length > 0 ? selectedRenewParts : (patient.approvedBodyParts || []),
        currentApprovalStartDate: renewDate,
        lastRenewalDate: renewDate,
        lastRenewedBy: currentUser?.name || 'الاستقبال'
      };
      if (newApprovalNo) {
        updates.insuranceApprovalNo = newApprovalNo;
      }

      await db.savePatient({ ...patient, ...updates }, currentUser);
      try {
        await db.logAudit(
          'تجديد موافقة تأمين',
          `تجديد موافقة التأمين للمريض ${patient.name} (${newSessions} جلسة - سريان من ${renewDate})`,
          currentUser
        );
      } catch (_) {}

      this.app.closeModal('modal-renew-approval');
      this.app.showToast(`تم تجديد جواب الموافقة للمريض (${patient.name}) وبدء دورة جديدة (${newSessions} جلسة) بنجاح.`);
      await this.loadPatients();
      if (this.app?.sessionsManager?.loadTodaySessions) {
        await this.app.sessionsManager.loadTodaySessions();
      }
    } catch (err) {
      this.app.showAlert('تعذر تجديد الموافقة: ' + err.message, 'خطأ', 'danger');
    }
  }

  // ================= Clinical Patient Sheet =================
  // ================= Top & Bottom Horizontal Scroll Synchronization =================
  setupScrollSync() {
    const topWrap = document.getElementById('patients-top-scroll-wrap');
    const container = document.getElementById('patients-table-container') || document.querySelector('#view-patients .table-responsive');
    const dummy = document.getElementById('patients-top-scroll-dummy');
    const table = document.getElementById('patients-data-table');

    if (!topWrap || !container || !dummy || !table) return;

    const syncMetrics = () => {
      if (table.scrollWidth > container.clientWidth) {
        dummy.style.width = table.scrollWidth + 'px';
        topWrap.style.display = 'block';
      } else {
        topWrap.style.display = 'none';
      }
    };

    setTimeout(syncMetrics, 60);
    window.addEventListener('resize', syncMetrics);

    let isTopScrolling = false;
    let isTableScrolling = false;

    topWrap.onscroll = () => {
      if (!isTopScrolling) {
        isTableScrolling = true;
        container.scrollLeft = topWrap.scrollLeft;
      }
      isTopScrolling = false;
    };

    container.onscroll = () => {
      if (!isTableScrolling) {
        isTopScrolling = true;
        topWrap.scrollLeft = container.scrollLeft;
      }
      isTableScrolling = false;
    };
  }

  async openPatientSheet(patientId) {
    const currentUser = auth.getCurrentUser();
    if (!RolesManager.canAccessClinicalSheet(currentUser)) {
      this.app.showAlert('الدخول على الشيت الطبي متاح للأطباء المعالجين ومدير المركز فقط.', 'صلاحية الأطباء');
      return;
    }

    const p = this.patients.find(item => item.id === patientId);
    if (!p) return;

    this.currentSheetPatient = p;
    const sheet = p.clinicalSheet || {};

    // 0. Load Patient Past Sessions
    try {
      const allSessions = await db.getSessions();
      const pSessions = allSessions.filter(s => s.patientId === p.id || s.patientName === p.name);
      pSessions.sort((a, b) => new Date(b.date) - new Date(a.date));
      this.currentPatientSessions = pSessions;
      
      const sessBadge = document.getElementById('sheet-sessions-badge-count');
      if (sessBadge) {
        sessBadge.textContent = `${pSessions.length} جلسة`;
      }
    } catch (e) {
      this.currentPatientSessions = [];
    }

    // 1. Fill Header info
    const nameEl = document.getElementById('sheet-patient-name');
    if (nameEl) nameEl.textContent = p.name;

    const ageEl = document.getElementById('sheet-patient-age');
    if (ageEl) ageEl.textContent = p.age;

    const genderEl = document.getElementById('sheet-patient-gender');
    if (genderEl) {
      genderEl.textContent = p.gender === 'male' ? '- ذكر' : (p.gender === 'female' ? '- أنثى' : '');
    }

    const phoneEl = document.getElementById('sheet-patient-phone');
    if (phoneEl) phoneEl.textContent = p.phone;

    const addrEl = document.getElementById('sheet-patient-address');
    if (addrEl) addrEl.textContent = p.address || 'غير محدد';

    const docEl = document.getElementById('sheet-patient-doctor');
    if (docEl) docEl.textContent = p.doctor;

        const badgeEl = document.getElementById('sheet-patient-billing-badge');
    const insLetterBtn = document.getElementById('btn-print-insurance-letter');
    if (insLetterBtn) insLetterBtn.style.display = (p.billing === 'cash') ? 'none' : 'inline-flex';
    if (badgeEl) {
      if (p.billing === 'cash') {
        badgeEl.innerHTML = '<span class="badge badge-cash" style="font-size: 0.82rem; padding: 4px 12px; font-weight: 700; white-space: nowrap; display: inline-flex; align-items: center; gap: 5px;"><i class="fa-solid fa-money-bill-wave"></i> نقدي</span>';
      } else if (p.contractType === 'direct') {
        badgeEl.innerHTML = `<span class="badge badge-direct" style="font-size: 0.82rem; padding: 4px 12px; font-weight: 700; white-space: nowrap; display: inline-flex; align-items: center; gap: 5px;"><i class="fa-solid fa-file-contract"></i> ${escapeHTML(p.insuranceCompany || 'تأمين')} (مباشر)</span>`;
      } else {
        badgeEl.innerHTML = `<span class="badge badge-indirect" style="font-size: 0.82rem; padding: 4px 12px; font-weight: 700; white-space: nowrap; display: inline-flex; align-items: center; gap: 5px;"><i class="fa-solid fa-handshake"></i> ${escapeHTML(p.insuranceCompany || 'تأمين')} (غير مباشر)</span>`;
      }
    }

    // 1.1 Render 3 Quick Actions inside Patient Sheet (WhatsApp, Edit, Delete)
    const actionsEl = document.getElementById('sheet-patient-quick-actions');
    if (actionsEl) {
      const cleanPhone = (p.phone || '').replace(/[^0-9]/g, '').replace(/^0/, '20');
      const canDelete = RolesManager.canDelete(currentUser);

      actionsEl.innerHTML = `
        <a href="https://wa.me/${cleanPhone}" target="_blank" class="btn btn-outline btn-sm" style="color: #10b981; border-color: #10b981; border-radius: 8px; width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center; font-size: 1.05rem;" title="محادثة واتساب مع المريض">
          <i class="fa-brands fa-whatsapp"></i>
        </a>
        <button type="button" class="btn btn-outline btn-sm" onclick="patientsManager.openEditModalFromSheet('${p.id}')" style="border-radius: 8px; width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center; font-size: 0.95rem; color: var(--primary); border-color: var(--border-color);" title="تعديل بيانات المريض">
          <i class="fa-solid fa-pen-to-square"></i>
        </button>
        ${canDelete ? `
          <button type="button" class="btn btn-outline btn-sm btn-delete-record" onclick="patientsManager.confirmDeleteFromSheet('${p.id}')" style="border-radius: 8px; width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center; font-size: 0.95rem; color: var(--danger); border-color: #fca5a5;" title="حذف المريض">
            <i class="fa-solid fa-trash"></i>
          </button>
        ` : ''}
      `;
    }

    const updateEl = document.getElementById('sheet-last-update-text');
    if (updateEl) {
      updateEl.textContent = sheet.lastUpdated 
        ? `${sheet.lastUpdated} (بواسطة: ${sheet.updatedBy || 'الطبيب'})`
        : 'لم يتم تعديل الشيت بعد (شيت جديد)';
    }

    // 2. Fill Diagnosis & Affected Area
    document.getElementById('sheet-diagnosis').value = sheet.diagnosis || '';
    document.getElementById('sheet-affected-area').value = sheet.affectedArea || '';

    // 3, 4, 5. Dynamic Clinical Chips (Manager Controlled)
    this.renderAllClinicalChips(sheet);
    const exerciseDetailsEl = document.getElementById('sheet-exercise-details');
    if (exerciseDetailsEl) exerciseDetailsEl.value = sheet.exerciseDetails || '';

    // 6. Plan & Notes
    document.getElementById('sheet-sessions-count').value = sheet.plannedSessions || '';
    document.getElementById('sheet-doctor-notes').value = sheet.doctorNotes || '';

    // 7. Switch View
    this.app.switchView('patient-sheet');
  }

  async handleSaveSheet(e) {
    e.preventDefault();
    if (!this.currentSheetPatient) return;

    const diagnosis = document.getElementById('sheet-diagnosis')?.value.trim();
    const affectedArea = document.getElementById('sheet-affected-area')?.value.trim();

    if (!diagnosis) {
      await this.app.showAlert('يرجى كتابة التشخيص الطبي أو شكوى المريض الرئيسية قبل حفظ الشيت.', 'بيانات مطلوبة', 'warning');
      document.getElementById('sheet-diagnosis')?.focus();
      return;
    }

    if (!affectedArea) {
      await this.app.showAlert('يرجى تحديد المنطقة أو العضو المصاب المراد علاجه.', 'بيانات مطلوبة', 'warning');
      document.getElementById('sheet-affected-area')?.focus();
      return;
    }

    const currentUser = auth.getCurrentUser();
    const saveBtn = document.getElementById('btn-save-sheet');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الحفظ...';
      setTimeout(() => {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> حفظ الشيت الطبي';
      }, 1500);
    }

    // Collect Modalities, Procedures, Exercises from Pickers
    const modalities = Array.isArray(this.selectedModalities) ? this.selectedModalities : [];
    const procedures = Array.isArray(this.selectedProcedures) ? this.selectedProcedures : [];
    const exercises = Array.isArray(this.selectedExercises) ? this.selectedExercises : [];

    const clinicalSheet = {
      diagnosis: document.getElementById('sheet-diagnosis').value.trim(),
      affectedArea: document.getElementById('sheet-affected-area').value.trim(),
      modalities,
      customModalities: '',
      procedures,
      customProcedures: '',
      exercises,
      exerciseDetails: document.getElementById('sheet-exercise-details').value.trim(),
      plannedSessions: document.getElementById('sheet-sessions-count').value.trim(),
      doctorNotes: document.getElementById('sheet-doctor-notes').value.trim(),
      lastUpdated: new Date().toLocaleString('en-US'),
      updatedBy: currentUser?.name || 'الطبيب المعالج'
    };

    this.currentSheetPatient.clinicalSheet = clinicalSheet;
    await db.savePatient(this.currentSheetPatient, currentUser);

    await db.logAudit(
      'تحديث الشيت الطبي',
      `قام ${currentUser?.name || 'الطبيب'} بتحديث الشيت الطبي وخطة العلاج للمريض: ${this.currentSheetPatient.name}`,
      currentUser
    );

    const updateEl = document.getElementById('sheet-last-update-text');
    if (updateEl) {
      updateEl.textContent = `${clinicalSheet.lastUpdated} (بواسطة: ${clinicalSheet.updatedBy})`;
    }

    this.app.showToast('تم حفظ وتحديث الشيت الطبي للمريض بنجاح');
    this.renderAllInsuranceChips();
    await this.loadPatients();
  }

  // ================= Picker Launching Methods =================
  openInsuranceCompanyPicker() {
    const contractType = document.querySelector('input[name="p-contract-type"]:checked')?.value || 'direct';
    const curComp = document.getElementById('p-insurance-company')?.value || '';
    this.app.multiSelectPicker.open({
      title: `اختر شركة التأمين (${contractType === 'direct' ? 'تعاقد مباشر' : 'تعاقد غير مباشر'})`,
      icon: 'fa-solid fa-file-contract',
      category: 'insurance_company',
      contractType: contractType,
      selected: curComp,
      mode: 'single',
      searchPlaceholder: 'ابحث في شركات التأمين...',
      addPlaceholder: 'إضافة شركة تأمين جديدة...',
      onConfirm: (val) => {
        this.selectInsuranceCompany(contractType, val);
      }
    });
  }

  openApprovedBodyPartsPicker() {
    this.app.multiSelectPicker.open({
      title: 'الأعضاء المعالجة المعتمدة بالجواب',
      icon: 'fa-solid fa-bone',
      category: 'body_parts',
      selected: this.selectedApprovedBodyParts,
      searchPlaceholder: 'ابحث في الأعضاء المعتمدة...',
      addPlaceholder: 'إضافة عضو جديد...',
      onConfirm: (vals) => {
        this.selectedApprovedBodyParts = vals;
        this.renderApprovedBodyPartsChips();
      }
    });
  }

  openRenewBodyPartsPicker() {
    this.app.multiSelectPicker.open({
      title: 'الأعضاء المعتمدة بالدورة الجديدة',
      icon: 'fa-solid fa-bone',
      category: 'body_parts',
      selected: this.selectedRenewApprovedBodyParts,
      searchPlaceholder: 'ابحث في الأعضاء المعتمدة...',
      addPlaceholder: 'إضافة عضو جديد...',
      onConfirm: (vals) => {
        this.selectedRenewApprovedBodyParts = vals;
        this.renderRenewApprovedBodyPartsChips();
      }
    });
  }

  openModalitiesPicker() {
    this.app.multiSelectPicker.open({
      title: 'الأجهزة والوسائل الفيزيائية',
      icon: 'fa-solid fa-bolt-lightning',
      category: 'modality',
      selected: this.selectedModalities,
      searchPlaceholder: 'ابحث في الأجهزة والوسائل...',
      addPlaceholder: 'إضافة جهاز فيزيائي جديد...',
      onConfirm: (vals) => {
        this.selectedModalities = vals;
        this.renderClinicalPickersUI();
      }
    });
  }

  openProceduresPicker() {
    this.app.multiSelectPicker.open({
      title: 'الإجراءات والعلاج اليدوي',
      icon: 'fa-solid fa-hand-holding-hand',
      category: 'procedure',
      selected: this.selectedProcedures,
      searchPlaceholder: 'ابحث في الإجراءات والعلاج اليدوي...',
      addPlaceholder: 'إضافة إجراء يدوي جديد...',
      onConfirm: (vals) => {
        this.selectedProcedures = vals;
        this.renderClinicalPickersUI();
      }
    });
  }

  openExercisesPicker() {
    this.app.multiSelectPicker.open({
      title: 'التمارين العلاجية الموصوفة',
      icon: 'fa-solid fa-person-running',
      category: 'exercise',
      selected: this.selectedExercises,
      searchPlaceholder: 'ابحث في التمارين العلاجية...',
      addPlaceholder: 'إضافة تمرين علاجي جديد...',
      onConfirm: (vals) => {
        this.selectedExercises = vals;
        this.renderClinicalPickersUI();
      }
    });
  }

  // ================= Dynamic Clinical Pickers Integration =================
  renderAllClinicalChips(sheet = {}) {
    this.selectedModalities = Array.isArray(sheet.modalities) ? [...sheet.modalities] : [];
    this.selectedProcedures = Array.isArray(sheet.procedures) ? [...sheet.procedures] : [];
    this.selectedExercises = Array.isArray(sheet.exercises) ? [...sheet.exercises] : [];
    this.renderClinicalPickersUI();
  }

  renderClinicalPickersUI() {
    // 1. Modalities
    updatePickerTriggerDisplay({
      summaryId: 'sheet-modalities-summary',
      subId: 'sheet-modalities-sub',
      countBadgeId: 'sheet-modalities-count-badge',
      tagsContainerId: 'sheet-modalities-tags',
      selectedItems: this.selectedModalities,
      placeholder: 'اضغط لاختيار الأجهزة والوسائل...',
      emptySub: 'لم يتم اختيار أي جهاز بعد',
      unitName: 'أجهزة',
      icon: 'fa-solid fa-bolt-lightning',
      onRemove: (item) => {
        this.selectedModalities = this.selectedModalities.filter(x => x !== item);
        this.renderClinicalPickersUI();
      }
    });

    // 2. Procedures
    updatePickerTriggerDisplay({
      summaryId: 'sheet-procedures-summary',
      subId: 'sheet-procedures-sub',
      countBadgeId: 'sheet-procedures-count-badge',
      tagsContainerId: 'sheet-procedures-tags',
      selectedItems: this.selectedProcedures,
      placeholder: 'اضغط لاختيار الإجراءات والعلاج اليدوي...',
      emptySub: 'لم يتم اختيار أي إجراء بعد',
      unitName: 'إجراءات',
      icon: 'fa-solid fa-hand-holding-hand',
      onRemove: (item) => {
        this.selectedProcedures = this.selectedProcedures.filter(x => x !== item);
        this.renderClinicalPickersUI();
      }
    });

    // 3. Exercises
    updatePickerTriggerDisplay({
      summaryId: 'sheet-exercises-summary',
      subId: 'sheet-exercises-sub',
      countBadgeId: 'sheet-exercises-count-badge',
      tagsContainerId: 'sheet-exercises-tags',
      selectedItems: this.selectedExercises,
      placeholder: 'اضغط لاختيار التمارين العلاجية...',
      emptySub: 'لم يتم اختيار أي تمرين بعد',
      unitName: 'تمارين',
      icon: 'fa-solid fa-person-running',
      onRemove: (item) => {
        this.selectedExercises = this.selectedExercises.filter(x => x !== item);
        this.renderClinicalPickersUI();
      }
    });
  }

  // ================= Patient Sessions History Modal =================
  openPatientSessionsModal() {
    if (!this.currentSheetPatient) return;
    const p = this.currentSheetPatient;
    const sessions = this.currentPatientSessions || [];

    const nameEl = document.getElementById('modal-p-sess-patient-name');
    if (nameEl) nameEl.textContent = p.name;
    
    const countEl = document.getElementById('modal-p-sess-total-badge');
    if (countEl) countEl.textContent = `${sessions.length} جلسة`;

    const tbody = document.getElementById('modal-p-sess-tbody');
    if (!tbody) return;

    if (sessions.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; color: var(--text-muted); padding: 35px 15px;">
            <i class="fa-solid fa-calendar-xmark" style="font-size: 2.2rem; color: #cbd5e1; margin-bottom: 10px; display: block;"></i>
            <span style="font-weight: 700; font-size: 0.95rem;">لا توجد جلسات سابقة مسجلة لهذا المريض حتى الآن</span>
            <p style="font-size: 0.78rem; margin-top: 4px; color: #94a3b8;">يتم تسجيل حضور الجلسات من شاشة "تسجيل الجلسات" اليومية</p>
          </td>
        </tr>
      `;
    } else {
      tbody.innerHTML = sessions.map((s, idx) => {
        let payBadge = '';
        if (s.payType === 'cash') {
          payBadge = `<span class="badge badge-cash"><i class="fa-solid fa-money-bill"></i> نقدي (${s.amountPaid || 0} ج.م)</span>`;
        } else if (s.contractType === 'direct') {
          payBadge = `<span class="badge badge-direct"><i class="fa-solid fa-file-contract"></i> ${escapeHTML(s.insuranceName || 'تأمين')} (مباشر) - ${s.amountPaid || 0} ج.م</span>`;
        } else {
          payBadge = `<span class="badge badge-indirect"><i class="fa-solid fa-handshake"></i> ${escapeHTML(s.insuranceName || 'تأمين')} (غير مباشر) - ${s.amountPaid || 0} ج.م</span>`;
        }

        const parts = Array.isArray(s.bodyParts) ? s.bodyParts.join('، ') : (s.bodyParts || 'غير محدد');

        return `
          <tr>
            <td style="font-weight: 800; color: var(--primary);">${idx + 1}</td>
            <td style="font-weight: 700; white-space: nowrap;">
              <div>${s.date}</div>
              <small style="color: var(--text-muted); font-size: 0.72rem;">${s.recordedAt || ''}</small>
            </td>
            <td><span style="font-weight: 700; color: var(--text-main);">${escapeHTML(s.doctor)}</span></td>
            <td style="font-size: 0.85rem;">${escapeHTML(parts)}</td>
            <td>${payBadge}</td>
            <td style="font-size: 0.82rem; color: var(--text-muted);">${escapeHTML(s.notes || '-')}</td>
            <td style="font-size: 0.75rem; color: var(--text-muted);">${s.recordedBy || '-'}</td>
          </tr>
        `;
      }).join('');
    }

    this.app.openModal('modal-patient-sessions-history');
  }

  printCurrentSheet() {
    if (this._isPrinting) return;
    this._isPrinting = true;
    setTimeout(() => { this._isPrinting = false; }, 2500);

    const currentUser = auth.getCurrentUser();
    if (!RolesManager.canPrintSheet(currentUser)) {
      this.app.showAlert('عفواً، طباعة وحفظ الشيت الطبي متاح لإدارة المركز فقط.', 'صلاحية الطباعة');
      return;
    }

    if (!this.currentSheetPatient) {
      this.app.showAlert('يرجى فتح شيت المريض أولاً قبل الطباعة.', 'تنبيه', 'warning');
      return;
    }

    const p = this.currentSheetPatient;
    const sheet = p.clinicalSheet || {};

    // 1. Fill Printable Template
    const now = new Date().toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' });
    const today = new Date().toLocaleDateString('ar-EG-u-nu-latn');
    document.getElementById('print-sheet-meta').textContent = `تاريخ ووقت الطباعة: ${today} ${now}`;

    document.getElementById('p-print-name').textContent = p.name;
    document.getElementById('p-print-age').textContent = `${p.age} سنة`;
    document.getElementById('p-print-phone').textContent = p.phone;
    document.getElementById('p-print-address').textContent = p.address || '-';
    document.getElementById('p-print-doctor').textContent = p.doctor;
    document.getElementById('p-print-billing').textContent = p.billing === 'cash' 
      ? 'نقدي (Cash)' 
      : `${p.insuranceCompany || 'تأمين'} (${p.contractType === 'direct' ? 'تعاقد مباشر' : 'تعاقد غير مباشر'})`;

    // 2. Diagnosis
    document.getElementById('p-print-diagnosis').textContent = 
      `${sheet.diagnosis || 'لم يحدد'} | العضو/المنطقة: ${sheet.affectedArea || 'غير محدد'}`;

    // 3. Modalities
    const mods = [...(sheet.modalities || [])];
    if (sheet.customModalities) mods.push(sheet.customModalities);
    document.getElementById('p-print-modalities').textContent = mods.length > 0 ? mods.join(' • ') : 'لا توجد أجهزة مقررة';

    // 4. Procedures
    const procs = [...(sheet.procedures || [])];
    if (sheet.customProcedures) procs.push(sheet.customProcedures);
    document.getElementById('p-print-procedures').textContent = procs.length > 0 ? procs.join(' • ') : 'لا توجد إجراءات يدوية مقررة';

    // 5. Exercises
    const exList = [...(sheet.exercises || [])];
    document.getElementById('p-print-exercises').textContent = exList.length > 0 ? exList.join(' • ') : 'لا توجد تمارين محددة';
    document.getElementById('p-print-exercise-details').textContent = sheet.exerciseDetails ? `التفاصيل: ${sheet.exerciseDetails}` : '';

    // 6. Plan & Notes
    const planText = sheet.plannedSessions ? `الخطة: ${sheet.plannedSessions} | ` : '';
    document.getElementById('p-print-notes').textContent = `${planText}${sheet.doctorNotes || 'لا توجد ملاحظات إضافية'}`;

    // 3. Activate print class and trigger print
    document.body.classList.add('printing-sheet');

    const cleanPrintClass = () => {
      document.body.classList.remove('printing-sheet');
      window.removeEventListener('afterprint', cleanPrintClass);
    };
    window.addEventListener('afterprint', cleanPrintClass);

    window.print();

    setTimeout(cleanPrintClass, 2000);
  }

  // ================= Insurance Renewal Letter (A5) =================
  openInsuranceLetterModalForPatient(patientId) {
    const p = this.patients.find((item) => item.id === patientId);
    if (!p) return;
    this.currentSheetPatient = p;
    this.openInsuranceLetterModal();
  }

  openInsuranceLetterModal() {
    if (!this.currentSheetPatient) return;
    const p = this.currentSheetPatient;
    const sheet = p.clinicalSheet || {};

    document.getElementById('ins-letter-company').value = p.insuranceCompany || '';
    document.getElementById('ins-letter-diagnosis').value = sheet.diagnosis || '';
    document.getElementById('ins-letter-sessions').value = '';

    this.app.openModal('modal-insurance-letter');
  }

  async submitInsuranceLetter() {
    if (this._isPrinting) return;

    const p = this.currentSheetPatient;
    if (!p) return;

    const diagnosis = document.getElementById('ins-letter-diagnosis')?.value.trim();
    const sessionsRaw = document.getElementById('ins-letter-sessions')?.value.trim();
    const sessionCount = parseInt(sessionsRaw, 10);

    if (!diagnosis) {
      this.app.showAlert('يرجى كتابة التشخيص.', 'بيانات مطلوبة', 'warning');
      return;
    }
    if (!sessionCount || sessionCount <= 0) {
      this.app.showAlert('يرجى كتابة عدد جلسات صحيح.', 'بيانات مطلوبة', 'warning');
      return;
    }

    this._isPrinting = true;
    setTimeout(() => { this._isPrinting = false; }, 2500);

    const currentUser = auth.getCurrentUser();
    const todayLabel = new Date().toLocaleDateString('ar-EG-u-nu-latn', { year: 'numeric', month: 'long', day: 'numeric' });

    try {
      // 1. Save a copy of the letter in the database first
      await db.addInsuranceLetter({
        patientId: p.id,
        patientName: p.name,
        insuranceCompany: p.insuranceCompany || '',
        diagnosis,
        sessionCount,
        issuedBy: currentUser?.name || '',
        createdByUid: currentUser?.uid || ''
      });

      // 2. Fill the printable A5 template
      document.getElementById('ins-print-company').textContent = p.insuranceCompany || '-';
      document.getElementById('ins-print-patient-name').textContent = p.name;
      document.getElementById('ins-print-diagnosis').textContent = diagnosis;
      document.getElementById('ins-print-sessions').textContent = sessionCount;
      document.getElementById('ins-print-date').textContent = `تحريراً في: ${todayLabel}`;

      // Gender-correct wording when known; falls back to the neutral
      // slash form for older patient records saved before this field existed.
      const honorificEl = document.getElementById('ins-print-honorific');
      const sufferVerbEl = document.getElementById('ins-print-verb-suffer');
      const needVerbEl = document.getElementById('ins-print-verb-need');
      if (p.gender === 'male') {
        honorificEl.textContent = 'السيد';
        sufferVerbEl.textContent = 'يعاني';
        needVerbEl.textContent = 'يحتاج';
      } else if (p.gender === 'female') {
        honorificEl.textContent = 'السيدة';
        sufferVerbEl.textContent = 'تعاني';
        needVerbEl.textContent = 'تحتاج';
      } else {
        honorificEl.textContent = 'السيد/ة';
        sufferVerbEl.textContent = 'يعاني/تعاني';
        needVerbEl.textContent = 'يحتاج/تحتاج';
      }

      this.app.closeModal('modal-insurance-letter');

      // 3. Trigger print
      document.body.classList.add('printing-insurance-letter');
      const cleanPrintClass = () => {
        document.body.classList.remove('printing-insurance-letter');
        window.removeEventListener('afterprint', cleanPrintClass);
      };
      window.addEventListener('afterprint', cleanPrintClass);
      window.print();
      setTimeout(cleanPrintClass, 2000);
    } catch (err) {
      this.app.showAlert('تعذر حفظ/طباعة الخطاب: ' + err.message, 'خطأ', 'danger');
    }
  }

  // ================= Patient Documents Hub (نافذة المستندات والطباعة) =================
  openPatientDocsModal(patientId) {
    const p = this.patients.find(item => item.id === patientId);
    if (!p) return;

    this.activeDocsPatientId = patientId;
    document.getElementById('p-docs-modal-name').textContent = p.name;
    const isIns = p.billing === 'insurance';
    const cType = p.contractType === 'indirect' ? 'غير مباشر' : 'مباشر';
    document.getElementById('p-docs-modal-info').textContent = isIns
      ? `${p.insuranceCompany || 'شركة التأمين'} (${cType}) • السن: ${p.age} سنة`
      : `مريض نقدي • كود: ${p.id.slice(-5)} • السن: ${p.age} سنة`;

    const badge = document.getElementById('p-docs-modal-badge');
    if (badge) {
      badge.className = `badge ${isIns ? 'badge-direct' : 'badge-cash'}`;
      badge.textContent = isIns ? 'تأمين' : 'نقدي';
    }

    const container = document.getElementById('p-docs-actions-container');
    if (!container) return;

    if (!isIns) {
      // Cash Patient Actions
      container.innerHTML = `
        <button type="button" class="btn btn-outline" onclick="patientsManager.openCashReceiptModal('${p.id}')" style="justify-content: flex-start; padding: 12px 16px; border-radius: 10px; font-weight: 800; font-size: 0.95rem; gap: 12px; border-color: var(--border-color); background: var(--bg-surface);">
          <i class="fa-solid fa-receipt" style="font-size: 1.3rem; color: var(--success);"></i>
          <div style="text-align: right;">
            <div>طباعة إيصال استلام نقدية</div>
            <small style="color: var(--text-muted); font-weight: 600; font-size: 0.74rem;">إيصال معتمد بالمبلغ والبيان لجلسات المريض</small>
          </div>
        </button>
        <button type="button" class="btn btn-outline" onclick="patientsManager.openMedicalStatementModal('${p.id}')" style="justify-content: flex-start; padding: 12px 16px; border-radius: 10px; font-weight: 800; font-size: 0.95rem; gap: 12px; border-color: var(--border-color); background: var(--bg-surface);">
          <i class="fa-solid fa-file-lines" style="font-size: 1.3rem; color: var(--primary);"></i>
          <div style="text-align: right;">
            <div>إصدار إفادة طبية (إلى من يهمه الأمر)</div>
            <small style="color: var(--text-muted); font-weight: 600; font-size: 0.74rem;">تقرير بالتشخيص ونسبة التحسن وملاحظات الجلسات</small>
          </div>
        </button>
      `;
    } else {
      // Insurance Patient Actions
      container.innerHTML = `
        <button type="button" class="btn btn-outline" onclick="patientsManager.openMedicalStatementModal('${p.id}')" style="justify-content: flex-start; padding: 12px 16px; border-radius: 10px; font-weight: 800; font-size: 0.95rem; gap: 12px; border-color: var(--border-color); background: var(--bg-surface);">
          <i class="fa-solid fa-file-lines" style="font-size: 1.3rem; color: var(--primary);"></i>
          <div style="text-align: right;">
            <div>إصدار إفادة طبية (إلى من يهمه الأمر)</div>
            <small style="color: var(--text-muted); font-weight: 600; font-size: 0.74rem;">تقرير بالتشخيص ونسبة التحسن وملاحظات الجلسات</small>
          </div>
        </button>
        <button type="button" class="btn btn-outline" onclick="patientsManager.openRenewApprovalModal('${p.id}')" style="justify-content: flex-start; padding: 12px 16px; border-radius: 10px; font-weight: 800; font-size: 0.95rem; gap: 12px; border-color: var(--border-color); background: var(--bg-surface);">
          <i class="fa-solid fa-rotate-right" style="font-size: 1.3rem; color: #0284c7;"></i>
          <div style="text-align: right;">
            <div>تجديد جواب الموافقة (وبدء دورة جديدة)</div>
            <small style="color: var(--text-muted); font-weight: 600; font-size: 0.74rem;">اعتماد جواب جديد وتصفير العداد للبدء من الجلسة 1</small>
          </div>
        </button>
        <button type="button" class="btn btn-outline" onclick="patientsManager.openInsuranceLetterFromRow('${p.id}')" style="justify-content: flex-start; padding: 12px 16px; border-radius: 10px; font-weight: 800; font-size: 0.95rem; gap: 12px; border-color: var(--border-color); background: var(--bg-surface);">
          <i class="fa-solid fa-file-shield" style="font-size: 1.3rem; color: #2563eb;"></i>
          <div style="text-align: right;">
            <div>طباعة خطاب تجديد تأمين (A5)</div>
            <small style="color: var(--text-muted); font-weight: 600; font-size: 0.74rem;">خطاب رسمي لشركة التأمين بطلب تجديد الجلسات</small>
          </div>
        </button>
      `;
    }

    this.app.openModal('modal-patient-docs');
  }

  openInsuranceLetterFromRow(patientId) {
    this.app.closeModal('modal-patient-docs');
    this.openInsuranceLetterModalForPatient(patientId);
  }

  // ================= Cash Receipt Methods =================
  openCashReceiptModal(patientId) {
    this.app.closeModal('modal-patient-docs');
    const p = this.patients.find(item => item.id === patientId);
    if (!p) return;

    this.activeReceiptPatient = p;
    document.getElementById('receipt-patient-id').value = p.id;
    document.getElementById('receipt-patient-name').value = p.name;
    document.getElementById('receipt-amount').value = '400';
    document.getElementById('receipt-item-desc').value = 'جلسة علاج طبيعي';
    document.getElementById('receipt-date').value = getLocalDateStr();

    this.app.openModal('modal-cash-receipt');
  }

  printCashReceipt() {
    if (this._isPrinting) return;
    this._isPrinting = true;
    setTimeout(() => { this._isPrinting = false; }, 2500);

    const p = this.activeReceiptPatient;
    if (!p) return;

    const amount = document.getElementById('receipt-amount')?.value || '400';
    const itemDesc = document.getElementById('receipt-item-desc')?.value.trim() || 'جلسة علاج طبيعي';
    const dateVal = document.getElementById('receipt-date')?.value || getLocalDateStr();
    const currentUser = auth.getCurrentUser();

    const isFemaleReceipt = (p.gender === 'female');
    const isMaleReceipt = (p.gender === 'male');
    const receiptHonorificEl = document.getElementById('receipt-print-honorific');
    if (receiptHonorificEl) {
      receiptHonorificEl.textContent = isFemaleReceipt ? 'السيدة' : (isMaleReceipt ? 'السيد' : 'السيد / السيدة');
    }

    document.getElementById('receipt-print-patient-name').textContent = p.name;
    document.getElementById('receipt-print-amount-text').textContent = `${amount} ج.م`;
    document.getElementById('receipt-print-item-desc').textContent = itemDesc;
    document.getElementById('receipt-print-date').textContent = `تحريراً في: ${dateVal}`;
    document.getElementById('receipt-print-receiver').textContent = currentUser?.name || 'الاستقبال';

    this.app.closeModal('modal-cash-receipt');
    document.body.classList.add('printing-receipt');
    window.print();
    setTimeout(() => {
      document.body.classList.remove('printing-receipt');
    }, 1500);
  }

  // ================= Medical Statement Methods =================
  openMedicalStatementModal(patientId) {
    this.app.closeModal('modal-patient-docs');
    const p = this.patients.find(item => item.id === patientId);
    if (!p) return;

    this.activeStatementPatient = p;
    document.getElementById('statement-patient-id').value = p.id;
    document.getElementById('statement-patient-name').value = p.name;
    
    // Fetch diagnosis directly from the patient's clinical sheet (or patient record) without hardcoded fallback
    const sheetDiag = (p.clinicalSheet && p.clinicalSheet.diagnosis)
      ? p.clinicalSheet.diagnosis.trim()
      : (p.diagnosis ? p.diagnosis.trim() : '');
    document.getElementById('statement-diagnosis').value = sheetDiag;

    // Clear body text so it relies cleanly on the placeholder without forcing the user to erase
    document.getElementById('statement-body-text').value = '';
    document.getElementById('statement-date').value = getLocalDateStr();

    this.app.openModal('modal-medical-statement');
  }

  printMedicalStatement() {
    if (this._isPrinting) return;
    this._isPrinting = true;
    setTimeout(() => { this._isPrinting = false; }, 2500);

    const p = this.activeStatementPatient;
    if (!p) return;

    const diag = document.getElementById('statement-diagnosis')?.value.trim() || '-';
    const bodyText = document.getElementById('statement-body-text')?.value.trim() || '';
    const dateVal = document.getElementById('statement-date')?.value || getLocalDateStr();

    const isFemaleStmt = (p.gender === 'female');
    const isMaleStmt = (p.gender === 'male');
    const stmtHonorificEl = document.getElementById('statement-print-honorific');
    const stmtRelVerbEl = document.getElementById('statement-print-rel-verb');

    if (stmtHonorificEl) {
      stmtHonorificEl.textContent = isFemaleStmt ? 'السيدة' : (isMaleStmt ? 'السيد' : 'السيد / السيدة');
    }
    if (stmtRelVerbEl) {
      stmtRelVerbEl.textContent = isFemaleStmt ? 'والتي تعاني من:' : (isMaleStmt ? 'والذي يعاني من:' : 'والذي / والتي تعاني من:');
    }

    document.getElementById('statement-print-patient-name').textContent = p.name;
    document.getElementById('statement-print-diagnosis').textContent = diag;
    document.getElementById('statement-print-custom-body').textContent = bodyText;
    document.getElementById('statement-print-date').textContent = `تحريراً في: ${dateVal}`;

    this.app.closeModal('modal-medical-statement');
    document.body.classList.add('printing-statement');
    window.print();
    setTimeout(() => {
      document.body.classList.remove('printing-statement');
    }, 1500);
  }
}
