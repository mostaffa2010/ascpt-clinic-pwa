import { escapeHTML } from './utils.js';
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
    window.patientsManager = this;
    this.insEditMode = false;
    this.currentContractType = "direct";
    this.chipsEditMode = {
      modality: false,
      procedure: false,
      exercise: false
    };
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

    // Toggle Insurance Edit Mode in Patient Form
    document.getElementById('btn-toggle-chips-ins-patient')?.addEventListener('click', () => this.toggleInsuranceEditMode('patient'));

    // Event Delegation: Patient Modal Insurance Chips Containers
    ['p-ins-direct-container', 'p-ins-indirect-container'].forEach(id => {
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
            this.app.sessionsManager.openAddInsuranceModal(addBtn.dataset.contract, addBtn.dataset.source || 'patient');
            return;
          }
          const chip = e.target.closest('[data-action="select-insurance"]');
          if (chip) {
            this.selectInsuranceCompany(chip.dataset.contract, chip.dataset.company);
          }
        });
      }
    });

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

    // Patient Sheet Form Submit
    const formSheet = document.getElementById('form-patient-sheet');
    if (formSheet) {
      formSheet.addEventListener('submit', (e) => this.handleSaveSheet(e));
    }

    // Toggle Chips Edit Mode Buttons in Clinical Sheet
    document.getElementById('btn-toggle-chips-modality')?.addEventListener('click', () => this.toggleChipsEditMode('modality'));
    document.getElementById('btn-toggle-chips-procedure')?.addEventListener('click', () => this.toggleChipsEditMode('procedure'));
    document.getElementById('btn-toggle-chips-exercise')?.addEventListener('click', () => this.toggleChipsEditMode('exercise'));

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
      });
    }
  }

  async loadPatients() {
    this.patients = await db.getPatients();
    this.renderPatients();
    this.populateSessionsDropdown();
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

  renderPatients() {
    const tbody = document.getElementById('patients-tbody');
    if (!tbody) return;

    const rawSearch = document.getElementById('patient-search-input')?.value.trim() || '';
    const filterType = document.getElementById('patient-filter-type')?.value || 'all';
    const normSearch = this.normalizeArabic(rawSearch);
    const cleanDigits = rawSearch.replace(/[^0-9]/g, '');

    let filtered = this.patients.filter(p => {
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
        billingBadge = `<span class="badge badge-direct"><i class="fa-solid fa-file-contract"></i> ${safeComp} (مباشر)</span>`;
      } else {
        billingBadge = `<span class="badge badge-indirect"><i class="fa-solid fa-handshake"></i> ${safeComp} (غير مباشر)</span>`;
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
          <td style="white-space: nowrap;"><span style="font-weight: 600; color: #1e293b;">${safeDoctor}</span></td>
          <td style="white-space: nowrap;">${billingBadge}</td>
          <td style="font-size: 0.8rem; color: var(--text-muted); white-space: nowrap;">${safeEditor}</td>
          <td style="white-space: nowrap;">
            <div style="display: flex; gap: 6px; align-items: center; flex-wrap: nowrap;">
              ${canAccessSheet ? `
                <button type="button" class="btn btn-primary btn-sm btn-patient-sheet-action" data-patient-id="${safeId}" title="شيت العلاج الطبيعي">
                  <i class="fa-solid fa-file-waveform"></i> الشيت الطبي
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

  // ================= Insurance Interactive Buttons for Patient Registration =================
  renderAllInsuranceChips() {
    this.renderInsuranceChips('direct', 'p-ins-direct-container');
    this.renderInsuranceChips('indirect', 'p-ins-indirect-container');
  }

  renderInsuranceChips(contractType, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const companies = db.getInsuranceCompanies(contractType);
    const selectedCompany = document.getElementById('p-insurance-company')?.value || '';
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
        <button type="button" class="chip-add-new-btn" data-action="add-insurance" data-contract="${contractType}" data-source="patient">
          <i class="fa-solid fa-plus"></i> <span>إضافة شركة جديدة</span>
        </button>
      `;
    }

    container.innerHTML = html;
  }

  selectInsuranceCompany(contractType, compName) {
    if (this.insEditMode) return;

    const input = document.getElementById('p-insurance-company');
    if (input) input.value = compName;

    const preview = document.getElementById('p-selected-ins-preview');
    if (preview) preview.textContent = `المختارة: ${compName}`;

    document.querySelectorAll('#p-ins-direct-container .sheet-chip, #p-ins-indirect-container .sheet-chip').forEach(btn => {
      const isMatch = btn.textContent.trim().includes(compName);
      btn.classList.toggle('selected', isMatch);
    });
  }

  onContractTypeChanged(contractType) {
    this.currentContractType = contractType;
    const directCont = document.getElementById('p-ins-direct-container');
    const indirectCont = document.getElementById('p-ins-indirect-container');

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

  toggleInsuranceEditMode() {
    const user = auth.getCurrentUser();
    if (!RolesManager.canManageUsers(user)) {
      this.app.showAlert('تعديل وحذف شركات التأمين متاح لمدير المركز فقط.', 'صلاحية المدير');
      return;
    }

    this.insEditMode = !this.insEditMode;
    const isEdit = this.insEditMode;

    const btn = document.getElementById('btn-toggle-chips-ins-patient');
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
    await this.app.sessionsManager.deleteInsuranceDirect(contractType, compName);
  }


  populateSessionsDropdown() {
    const select = document.getElementById('session-patient-select');
    if (!select) return;

    select.innerHTML = '<option value="">-- اختر المريض من السجل --</option>' + 
      this.patients.map(p => {
        const info = p.billing === 'cash' ? 'نقدي' : `تأمين: ${escapeHTML(p.insuranceCompany || 'شركة')}`;
        return `<option value="${escapeHTML(p.id)}">${escapeHTML(p.name)} (${escapeHTML(p.doctor)}) - [${info}]</option>`;
      }).join('');
  }

  validatePhoneLive() {
    const phoneInput = document.getElementById('p-phone');
    const feedback = document.getElementById('p-phone-feedback');
    if (!phoneInput) return false;

    let val = phoneInput.value.trim().replace(/[\s\-\(\)\.]/g, '');
    if (val.startsWith('+20')) val = '0' + val.slice(3);
    else if (val.startsWith('20') && val.length === 12) val = '0' + val.slice(2);

    if (!val) {
      phoneInput.classList.remove('input-error', 'input-success');
      if (feedback) { feedback.style.display = 'none'; feedback.innerHTML = ''; }
      return false;
    }

    const isValid = /^01[0125][0-9]{8}$/.test(val);

    if (isValid) {
      phoneInput.classList.remove('input-error');
      phoneInput.classList.add('input-success');
      if (feedback) {
        feedback.className = 'form-feedback-msg success';
        feedback.style.display = 'flex';
        feedback.innerHTML = '<i class="fa-solid fa-circle-check" style="margin-top: 2px;"></i> <span>رقم موبايل مصري صحيح ومكتمل (11 رقماً).</span>';
      }
      return true;
    } else {
      phoneInput.classList.remove('input-success');
      phoneInput.classList.add('input-error');
      let whatIsWrong = '';
      let whatToDo = 'اكتب 11 رقماً يبدأ بأحد شبكات المحمول المصرية (010، 011، 012، 015).';

      if (!val.startsWith('01')) {
        whatIsWrong = 'الرقم لا يبدأ بـ 01.';
      } else if (val.length >= 3 && !/^01[0125]/.test(val)) {
        whatIsWrong = `كود الشبكة (${val.slice(0, 3)}) غير معروف.`;
      } else if (val.length < 11) {
        whatIsWrong = `الرقم ناقص (${val.length} أرقام فقط من 11).`;
      } else if (val.length > 11) {
        whatIsWrong = `الرقم زائد عن 11 رقماً (${val.length} رقماً).`;
      } else {
        whatIsWrong = 'صيغة الرقم غير صحيحة.';
      }

      if (feedback) {
        feedback.className = 'form-feedback-msg error';
        feedback.style.display = 'flex';
        feedback.innerHTML = `<i class="fa-solid fa-circle-exclamation" style="margin-top: 2px; flex-shrink: 0;"></i> <div><strong>خطأ:</strong> ${whatIsWrong}<br><span style="color: #7f1d1d;"><strong>الصحيح:</strong> ${whatToDo}</span></div>`;
      }
      return false;
    }
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
    const insComp = document.getElementById('p-insurance-company');
    if (insComp) insComp.value = '';
    const insPrev = document.getElementById('p-selected-ins-preview');
    if (insPrev) insPrev.textContent = '';
    document.querySelectorAll('#p-ins-direct-container .sheet-chip, #p-ins-indirect-container .sheet-chip').forEach(btn => {
      btn.classList.remove('selected');
    });
    document.getElementById('modal-patient-title').innerHTML = '<i class="fa-solid fa-user-plus"></i> تسجيل مريض جديد';
    document.getElementById('p-insurance-details').style.display = 'none';
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
    document.getElementById('p-phone').value = p.phone;
    document.getElementById('p-address').value = p.address || '';
    document.getElementById('p-doctor').value = p.doctor;

    const billingRadios = document.querySelectorAll('input[name="p-billing"]');
    billingRadios.forEach(r => { r.checked = (r.value === p.billing); });

    const insBox = document.getElementById('p-insurance-details');
    if (p.billing === 'insurance') {
      insBox.style.display = 'block';
      document.getElementById('p-insurance-company').value = p.insuranceCompany || '';
      const contractRadios = document.querySelectorAll('input[name="p-contract"]');
      contractRadios.forEach(r => { r.checked = (r.value === p.contractType); });
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
    const phone = document.getElementById('p-phone').value.trim();
    const address = document.getElementById('p-address').value.trim();
    const doctor = document.getElementById('p-doctor').value;
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

    const patientData = {
      id: id || null,
      name,
      age,
      phone: normalizedPhone,
      address,
      doctor,
      billing,
      insuranceCompany,
      contractType
    };

    const actionResult = await db.savePatient(patientData, currentUser);
    const auditDesc = id 
      ? `تعديل ملف المريض: ${name}`
      : `تسجيل مريض جديد: ${name} (طبيب: ${doctor} - نظام: ${billing})`;
      
    await db.logAudit(id ? 'تعديل مريض' : 'إضافة مريض', auditDesc, currentUser);

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

    const phoneEl = document.getElementById('sheet-patient-phone');
    if (phoneEl) phoneEl.textContent = p.phone;

    const addrEl = document.getElementById('sheet-patient-address');
    if (addrEl) addrEl.textContent = p.address || 'غير محدد';

    const docEl = document.getElementById('sheet-patient-doctor');
    if (docEl) docEl.textContent = p.doctor;

        const badgeEl = document.getElementById('sheet-patient-billing-badge');
    if (badgeEl) {
      if (p.billing === 'cash') {
        badgeEl.innerHTML = '<span class="badge badge-cash" style="font-size: 0.82rem; padding: 4px 12px; font-weight: 700; white-space: nowrap; display: inline-flex; align-items: center; gap: 5px;"><i class="fa-solid fa-money-bill-wave"></i> نقدي</span>';
      } else if (p.contractType === 'direct') {
        badgeEl.innerHTML = `<span class="badge badge-direct" style="font-size: 0.82rem; padding: 4px 12px; font-weight: 700; white-space: nowrap; display: inline-flex; align-items: center; gap: 5px;"><i class="fa-solid fa-file-contract"></i> ${p.insuranceCompany || 'تأمين'} (مباشر)</span>`;
      } else {
        badgeEl.innerHTML = `<span class="badge badge-indirect" style="font-size: 0.82rem; padding: 4px 12px; font-weight: 700; white-space: nowrap; display: inline-flex; align-items: center; gap: 5px;"><i class="fa-solid fa-handshake"></i> ${p.insuranceCompany || 'تأمين'} (غير مباشر)</span>`;
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

    // Collect Modalities
    const modalities = Array.from(document.querySelectorAll('#sheet-modalities-container .sheet-chip.selected'))
      .map(b => b.getAttribute('data-val'));

    // Collect Procedures
    const procedures = Array.from(document.querySelectorAll('#sheet-procedures-container .sheet-chip.selected'))
      .map(b => b.getAttribute('data-val'));

    // Collect Exercises
    const exercises = Array.from(document.querySelectorAll('#sheet-exercises-container .sheet-chip.selected'))
      .map(b => b.getAttribute('data-val'));

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

  // ================= Dynamic Clinical Chips (Manager Controlled) =================
  toggleChipsEditMode(category) {
    const user = auth.getCurrentUser();
    if (!RolesManager.canManageUsers(user)) {
      this.app.showAlert('تعديل وحذف الأزرار متاح لمدير المركز فقط.', 'صلاحية المدير');
      return;
    }

    this.chipsEditMode[category] = !this.chipsEditMode[category];
    const isEdit = this.chipsEditMode[category];

    const btn = document.getElementById(`btn-toggle-chips-${category}`);
    if (btn) {
      if (isEdit) {
        btn.className = 'btn-edit-chips active';
        btn.innerHTML = '<i class="fa-solid fa-check"></i> <span class="edit-text">تم الانتهاء</span>';
      } else {
        btn.className = 'btn-edit-chips';
        btn.innerHTML = '<i class="fa-solid fa-pen-to-square"></i> <span class="edit-text">تعديل الأزرار</span>';
      }
    }

    const containerMap = {
      modality: 'sheet-modalities-container',
      procedure: 'sheet-procedures-container',
      exercise: 'sheet-exercises-container'
    };

    const curSelected = Array.from(document.querySelectorAll(`#${containerMap[category]} .sheet-chip.selected`))
      .map(b => b.getAttribute('data-val'));

    this.renderCategoryChips(category, containerMap[category], curSelected);
  }

  renderAllClinicalChips(sheet = {}) {
    // Reset edit modes on sheet open
    this.chipsEditMode = { modality: false, procedure: false, exercise: false };
    ['modality', 'procedure', 'exercise'].forEach(cat => {
      const btn = document.getElementById(`btn-toggle-chips-${cat}`);
      if (btn) {
        btn.className = 'btn-edit-chips';
        btn.innerHTML = '<i class="fa-solid fa-pen-to-square"></i> <span class="edit-text">تعديل الأزرار</span>';
      }
    });

    this.renderCategoryChips('modality', 'sheet-modalities-container', sheet.modalities || []);
    this.renderCategoryChips('procedure', 'sheet-procedures-container', sheet.procedures || []);
    this.renderCategoryChips('exercise', 'sheet-exercises-container', sheet.exercises || []);
  }

  renderCategoryChips(category, containerId, selectedList = []) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const options = db.getClinicalOptions(category);
    const iconMap = {
      modality: 'fa-solid fa-bolt-lightning',
      procedure: 'fa-solid fa-hand-holding-hand',
      exercise: 'fa-solid fa-person-running'
    };
    const defaultIcon = iconMap[category] || 'fa-solid fa-circle-check';
    const isEdit = Boolean(this.chipsEditMode[category]);

    let html = options.map(opt => {
      const isSelected = selectedList.includes(opt);
      const editClass = isEdit ? 'in-edit-mode' : '';
      const safeOpt = opt.replace(/'/g, "\\'");
      const deleteIconHtml = isEdit
        ? `<span class="chip-delete-tag" data-action="delete-option" data-category="${category}" data-option="${safeOpt}" title="حذف هذا الزر"><i class="fa-solid fa-circle-xmark"></i></span>`
        : '';

      return `
        <button type="button" class="chip-choice sheet-chip ${isSelected ? 'selected' : ''} ${editClass}" data-group="${category}" data-val="${opt}">
          <i class="${defaultIcon}"></i> <span>${opt}</span>
          ${deleteIconHtml}
        </button>
      `;
    }).join('');

    if (isEdit) {
      const addLabels = {
        modality: 'إضافة جهاز جديد',
        procedure: 'إضافة إجراء جديد',
        exercise: 'إضافة تمرين جديد'
      };
      html += `
        <button type="button" class="chip-add-new-btn" data-action="add-option" data-category="${category}">
          <i class="fa-solid fa-plus"></i> <span>${addLabels[category] || 'إضافة جديد'}</span>
        </button>
      `;
    }

    container.innerHTML = html;

    // Bind selection click listener (only toggles selection in normal mode)
    container.querySelectorAll('.chip-choice').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!this.chipsEditMode[category]) {
          btn.classList.toggle('selected');
        }
      });
    });
  }

  async deleteOptionDirect(category, optionName) {
    const user = auth.getCurrentUser();
    if (!RolesManager.canManageUsers(user)) return;

    const confirmed = await this.app.showConfirm(
      `هل أنت متأكد من حذف زر "${optionName}" نهائياً من قائمة الأطباء؟`,
      'حذف زر دائم'
    );
    if (confirmed) {
      await db.deleteClinicalOption(category, optionName);
      const containerMap = {
        modality: 'sheet-modalities-container',
        procedure: 'sheet-procedures-container',
        exercise: 'sheet-exercises-container'
      };
      const curSelected = Array.from(document.querySelectorAll(`#${containerMap[category]} .sheet-chip.selected`))
        .map(b => b.getAttribute('data-val'))
        .filter(v => v !== optionName);

      this.renderCategoryChips(category, containerMap[category], curSelected);
      this.app.showToast(`تم حذف زر "${optionName}" بنجاح`);
      await db.logAudit('حذف زر سريري', `حذف زر ${optionName} من قسم ${category}`, user);
    }
  }

  openAddOptionModal(category) {
    const user = auth.getCurrentUser();
    if (!RolesManager.canManageUsers(user)) {
      this.app.showAlert('إضافة الأزرار الدائمة متاح لمدير المركز فقط.', 'صلاحية المدير');
      return;
    }

    const titles = {
      modality: 'إضافة جهاز فيزيائي جديد',
      procedure: 'إضافة إجراء / علاج يدوي جديد',
      exercise: 'إضافة تمرين علاجي جديد'
    };

    document.getElementById('opt-target-category').value = category;
    document.getElementById('modal-opt-title').innerHTML = `<i class="fa-solid fa-circle-plus"></i> ${titles[category] || 'إضافة زر جديد'}`;
    document.getElementById('opt-new-name').value = '';
    this.app.openModal('modal-add-clinical-option');
  }

  async handleSaveNewOption(e) {
    e.preventDefault();
    const category = document.getElementById('opt-target-category').value;
    const nameInput = document.getElementById('opt-new-name');
    const name = nameInput.value.trim();

    if (!name) {
      await this.app.showAlert('يرجى كتابة اسم الزر الجديد أولاً قبل الحفظ.', 'بيانات مطلوبة', 'warning');
      nameInput?.focus();
      return;
    }
    if (!category) return;

    await db.addClinicalOption(category, name);
    const containerMap = {
      modality: 'sheet-modalities-container',
      procedure: 'sheet-procedures-container',
      exercise: 'sheet-exercises-container'
    };

    const curSelected = Array.from(document.querySelectorAll(`#${containerMap[category]} .sheet-chip.selected`)).map(b => b.getAttribute('data-val'));
    curSelected.push(name);
    this.renderCategoryChips(category, containerMap[category], curSelected);

    this.app.closeModal('modal-add-clinical-option');
    this.app.showToast(`تمت إضافة زر "${name}" بنجاح`);
    await db.logAudit('إضافة زر سريري', `إضافة زر ${name} في قسم ${category}`, auth.getCurrentUser());
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
          payBadge = `<span class="badge badge-direct"><i class="fa-solid fa-file-contract"></i> ${s.insuranceName || 'تأمين'} (مباشر) - ${s.amountPaid || 0} ج.م</span>`;
        } else {
          payBadge = `<span class="badge badge-indirect"><i class="fa-solid fa-handshake"></i> ${s.insuranceName || 'تأمين'} (غير مباشر) - ${s.amountPaid || 0} ج.م</span>`;
        }

        const parts = Array.isArray(s.bodyParts) ? s.bodyParts.join('، ') : (s.bodyParts || 'غير محدد');

        return `
          <tr>
            <td style="font-weight: 800; color: var(--primary);">${idx + 1}</td>
            <td style="font-weight: 700; white-space: nowrap;">
              <div>${s.date}</div>
              <small style="color: var(--text-muted); font-size: 0.72rem;">${s.recordedAt || ''}</small>
            </td>
            <td><span style="font-weight: 700; color: #1e293b;">${s.doctor}</span></td>
            <td style="font-size: 0.85rem;">${parts}</td>
            <td>${payBadge}</td>
            <td style="font-size: 0.82rem; color: var(--text-muted);">${s.notes || '-'}</td>
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
}