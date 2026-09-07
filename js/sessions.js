import { escapeHTML, getLocalDateStr } from './utils.js';
// ========================================================
// PhysioFlow - Daily Sessions & Check-in Module
// ========================================================

import { db } from './db.js';
import { auth } from './auth.js';
import { RolesManager } from './roles.js';

export class SessionsManager {
  constructor(app) {
    this.app = app;
    this.todayDateStr = getLocalDateStr();
    this.currentSessionDate = this.todayDateStr;
    this.selectedPatientId = null;
    this.editingSessionId = null;
    this.insEditMode = false;
    this.bodyPartsEditMode = false;
    this.currentContractType = 'direct';
    this.entryMode = 'session'; // 'session' | 'examination'
    this.examType = 'cash'; // 'cash' | 'contract'
    this.selectedPatient = null;
    window.sessionsManager = this;
  }

  async init() {
    this.bindEvents();
    const dateInput = document.getElementById('session-date');
    if (dateInput) dateInput.value = this.currentSessionDate;
    this.updateDateLabel();
    this.renderAllInsuranceChips();
    this.renderBodyPartsChips();
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

    // Mode Switcher (Session vs Examination)
    document.getElementById('btn-mode-session')?.addEventListener('click', () => this.setEntryMode('session'));
    document.getElementById('btn-mode-exam')?.addEventListener('click', () => this.setEntryMode('examination'));

    // Examination Type Toggle (Cash vs Contract)
    document.getElementById('btn-exam-type-cash')?.addEventListener('click', () => this.setExamType('cash'));
    document.getElementById('btn-exam-type-contract')?.addEventListener('click', () => this.setExamType('contract'));

    // 1. Dynamic Body Parts Management (Add, Delete & Select)
    document.getElementById('btn-toggle-chips-body-parts')?.addEventListener('click', () => this.toggleBodyPartsEditMode());

    const chipsContainer = document.getElementById('body-parts-container');
    if (chipsContainer) {
      chipsContainer.addEventListener('click', async (e) => {
        const delTag = e.target.closest('[data-action="delete-body-part"]');
        if (delTag) {
          e.stopPropagation();
          await this.deleteBodyPart(delTag.dataset.part);
          return;
        }

        const addBtn = e.target.closest('[data-action="add-body-part"]');
        if (addBtn) {
          e.stopPropagation();
          await this.promptAddBodyPart();
          return;
        }

        const btn = e.target.closest('.chip-choice');
        if (btn && !this.bodyPartsEditMode) {
          e.preventDefault();
          btn.classList.toggle('selected');
          this.updateBodyPartsCount();
        }
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
    const sessionsTbody = document.getElementById('sessions-today-tbody');
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

  // ================= Mode Switcher: Session vs Examination =================
  setEntryMode(mode) {
    this.entryMode = mode === 'examination' ? 'examination' : 'session';
    const isExam = (this.entryMode === 'examination');

    const btnSession = document.getElementById('btn-mode-session');
    const btnExam = document.getElementById('btn-mode-exam');
    const bodyPartsGroup = document.getElementById('form-group-body-parts');
    const examTypeGroup = document.getElementById('form-group-exam-type');
    const dateLabel = document.getElementById('session-date-label');
    const payLabel = document.getElementById('session-payment-method-label');
    const btnSubmitText = document.getElementById('btn-submit-session-text');
    const btnSubmitIcon = document.getElementById('icon-submit-session');

    if (btnSession && btnExam) {
      if (isExam) {
        btnExam.style.background = 'var(--primary, #0284c7)';
        btnExam.style.color = '#ffffff';
        btnExam.style.boxShadow = '0 2px 4px rgba(0,0,0,0.06)';
        btnSession.style.background = 'transparent';
        btnSession.style.color = 'var(--text-muted, #64748b)';
        btnSession.style.boxShadow = 'none';
      } else {
        btnSession.style.background = 'var(--primary, #0284c7)';
        btnSession.style.color = '#ffffff';
        btnSession.style.boxShadow = '0 2px 4px rgba(0,0,0,0.06)';
        btnExam.style.background = 'transparent';
        btnExam.style.color = 'var(--text-muted, #64748b)';
        btnExam.style.boxShadow = 'none';
      }
    }

    if (bodyPartsGroup) bodyPartsGroup.style.display = isExam ? 'none' : 'block';
    if (examTypeGroup) examTypeGroup.style.display = isExam ? 'block' : 'none';

    if (dateLabel) {
      dateLabel.innerHTML = `<i class="fa-solid fa-calendar-day"></i> ${isExam ? 'تاريخ الكشف *' : 'تاريخ الجلسة *'}`;
    }
    if (payLabel) {
      payLabel.textContent = isExam ? 'جهة السداد ونظام المحاسبة للكشف *' : 'نظام وطريقة السداد للجلسة *';
    }
    if (btnSubmitText) {
      if (this.editingSessionId) {
        btnSubmitText.textContent = isExam ? 'حفظ تعديلات الكشف' : 'حفظ تعديلات الجلسة';
      } else {
        btnSubmitText.textContent = isExam ? 'حفظ الكشف' : 'حفظ الجلسة';
      }
    }
    if (btnSubmitIcon) {
      btnSubmitIcon.className = isExam ? 'fa-solid fa-stethoscope' : 'fa-solid fa-check';
    }

    if (isExam) {
      this.updateExamPaymentUI();
    } else {
      if (this.selectedPatient) {
        this.updateSessionPaymentUI(this.selectedPatient);
      } else {
        const paymentContainer = document.getElementById('session-payment-method-container');
        if (paymentContainer) {
          paymentContainer.innerHTML = `
            <div style="background: var(--bg-subtle); border: 1.5px dashed var(--border-color); border-radius: 10px; padding: 14px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
              <i class="fa-solid fa-hand-pointer" style="margin-left: 6px; color: var(--primary);"></i> اختر المريض بالأعلى لتحديد نظام السداد تلقائياً (نقدي / تأمين)
            </div>
          `;
        }
      }
    }
  }

  setExamType(type) {
    this.examType = type === 'contract' ? 'contract' : 'cash';
    this.updateExamPaymentUI();
  }

  updateExamPaymentUI() {
    const btnCash = document.getElementById('btn-exam-type-cash');
    const btnContract = document.getElementById('btn-exam-type-contract');
    const paymentContainer = document.getElementById('session-payment-method-container');
    const amountLabel = document.getElementById('session-amount-label');
    const amountHelp = document.getElementById('session-amount-help');
    const payTypeInput = document.getElementById('session-pay-type-hidden');

    const isContract = (this.examType === 'contract');

    if (btnCash && btnContract) {
      if (isContract) {
        btnContract.style.borderColor = 'var(--primary, #0284c7)';
        btnContract.style.background = 'var(--primary, #0284c7)';
        btnContract.style.color = '#ffffff';
        btnCash.style.borderColor = 'var(--border-color, #cbd5e1)';
        btnCash.style.background = '#ffffff';
        btnCash.style.color = 'var(--text-muted, #64748b)';
      } else {
        btnCash.style.borderColor = 'var(--primary, #0284c7)';
        btnCash.style.background = 'var(--primary, #0284c7)';
        btnCash.style.color = '#ffffff';
        btnContract.style.borderColor = 'var(--border-color, #cbd5e1)';
        btnContract.style.background = '#ffffff';
        btnContract.style.color = 'var(--text-muted, #64748b)';
      }
    }

    if (payTypeInput) payTypeInput.value = isContract ? 'insurance' : 'cash';

    if (amountLabel) {
      amountLabel.textContent = isContract ? 'مبلغ التحمل المسدد بالدرج (إن وجد) *' : 'سعر الكشف المسدد بالدرج (ج.م) *';
    }
    if (amountHelp) {
      amountHelp.textContent = isContract ? 'في حالة كشف التعاقد، ضع مبلغ نسبة التحمل النقدي إن وُجد، أو 0.' : 'اكتب المبلغ المسدد بالدرج للكشف النقدي.';
    }

    if (!paymentContainer) return;

    if (!isContract) {
      paymentContainer.innerHTML = `
        <div style="background: #f0fdf4; border: 1.5px solid #bbf7d0; border-radius: 10px; padding: 12px 14px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <div style="width: 38px; height: 38px; border-radius: 8px; background: #dcfce7; color: #15803d; display: flex; align-items: center; justify-content: center; font-size: 1.15rem; flex-shrink: 0;">
              <i class="fa-solid fa-money-bill-wave"></i>
            </div>
            <div>
              <div style="font-weight: 800; font-size: 0.95rem; color: #166534;">كشف نقدي مباشر (Cash)</div>
              <div style="font-size: 0.78rem; color: #15803d; font-weight: 600;">يتم تحصيل سعر الكشف نقداً وتوريده لخزينة المركز</div>
            </div>
          </div>
          <span class="badge badge-cash" style="font-size: 0.76rem; padding: 4px 10px; border-radius: 9999px;">كشف نقدي</span>
        </div>
      `;
    } else {
      const allCompanies = db.getInsuranceCompaniesList();
      const patientComp = (this.selectedPatient?.insuranceCompany || document.getElementById('session-insurance-name')?.value || '').trim();
      const defaultComp = patientComp || (allCompanies[0]?.name || '');

      const insInput = document.getElementById('session-insurance-name');
      if (insInput) insInput.value = defaultComp;

      paymentContainer.innerHTML = `
        <div style="background: #f0fdf4; border: 1.5px solid #bbf7d0; border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px;">
          <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <div style="width: 38px; height: 38px; border-radius: 8px; background: #dcfce7; color: #15803d; display: flex; align-items: center; justify-content: center; font-size: 1.15rem; flex-shrink: 0;">
                <i class="fa-solid fa-file-contract"></i>
              </div>
              <div>
                <div style="font-weight: 800; font-size: 0.95rem; color: #166534;">كشف تعاقد شركة تأمين</div>
                <div style="font-size: 0.78rem; color: #15803d; font-weight: 600;">اختر شركة التعاقد المحول منها المريض:</div>
              </div>
            </div>
            <span class="badge" style="background: #16a34a; color: #ffffff; font-weight: 700; font-size: 0.76rem; padding: 4px 10px; border-radius: 9999px;">كشف تعاقد</span>
          </div>
          <div>
            <select id="exam-contract-company-select" class="form-control" style="font-weight: 700;">
              ${allCompanies.map(c => `<option value="${escapeHTML(c.name)}" data-contract="${escapeHTML(c.contractType)}" ${c.name === defaultComp ? 'selected' : ''}>${escapeHTML(c.label)}</option>`).join('')}
            </select>
          </div>
        </div>
      `;

      const compSelect = document.getElementById('exam-contract-company-select');
      if (compSelect) {
        compSelect.addEventListener('change', (e) => {
          const opt = compSelect.options[compSelect.selectedIndex];
          const cName = e.target.value;
          const cType = opt?.getAttribute('data-contract') || 'direct';
          const insNameInput = document.getElementById('session-insurance-name');
          const contractTypeInput = document.getElementById('session-contract-type-hidden');
          if (insNameInput) insNameInput.value = cName;
          if (contractTypeInput) contractTypeInput.value = cType;
        });
      }
    }
  }

  updateSessionPaymentUI(patient) {
    const isInsurance = Boolean(
      patient.billing === 'insurance' ||
      (patient.insuranceCompany && String(patient.insuranceCompany).trim().length > 0)
    );
    const payTypeInput = document.getElementById('session-pay-type-hidden');
    if (payTypeInput) payTypeInput.value = isInsurance ? 'insurance' : 'cash';

    const insNameInput = document.getElementById('session-insurance-name');
    if (insNameInput) insNameInput.value = isInsurance ? (patient.insuranceCompany || '') : '';

    const contractTypeInput = document.getElementById('session-contract-type-hidden');
    if (contractTypeInput) contractTypeInput.value = patient.contractType || 'direct';

    const paymentContainer = document.getElementById('session-payment-method-container');
    const amountLabel = document.getElementById('session-amount-label');
    const amountInput = document.getElementById('session-amount-paid');

    if (paymentContainer) {
      if (isInsurance) {
        const cTypeLabel = patient.contractType === 'direct' ? 'تعاقد مباشر' : 'تعاقد غير مباشر';
        const safeCompName = escapeHTML(patient.insuranceCompany || 'شركة تأمين');
        paymentContainer.innerHTML = `
          <div style="background: #f0fdf4; border: 1.5px solid #bbf7d0; border-radius: 10px; padding: 12px 14px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <div style="width: 38px; height: 38px; border-radius: 8px; background: #dcfce7; color: #15803d; display: flex; align-items: center; justify-content: center; font-size: 1.15rem; flex-shrink: 0;">
                <i class="fa-solid fa-file-contract"></i>
              </div>
              <div>
                <div style="font-weight: 800; font-size: 0.95rem; color: #166534;">
                  ${safeCompName}
                </div>
                <div style="font-size: 0.78rem; color: #15803d; font-weight: 600;">
                  تأمين المريض التلقائي • <span class="badge badge-direct" style="font-size: 0.7rem; padding: 1px 6px;">${cTypeLabel}</span>
                </div>
              </div>
            </div>
            <span class="badge" style="background: #16a34a; color: #ffffff; font-weight: 700; font-size: 0.76rem; padding: 4px 10px; border-radius: 9999px;">
              حالة تأمين
            </span>
          </div>
        `;
        if (amountLabel) amountLabel.textContent = 'نسبة التحمل المدفوعة بالدرج (ج.م) *';
        if (amountInput && !this.editingSessionId) amountInput.value = '0';
      } else {
        paymentContainer.innerHTML = `
          <div style="background: #f0f9ff; border: 1.5px solid #bae6fd; border-radius: 10px; padding: 12px 14px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <div style="width: 38px; height: 38px; border-radius: 8px; background: #e0f2fe; color: #0284c7; display: flex; align-items: center; justify-content: center; font-size: 1.15rem; flex-shrink: 0;">
                <i class="fa-solid fa-money-bill-wave"></i>
              </div>
              <div>
                <div style="font-weight: 800; font-size: 0.95rem; color: #0369a1;">
                  سداد نقدي مباشر (Cash)
                </div>
                <div style="font-size: 0.78rem; color: #0284c7; font-weight: 600;">
                  المريض غير خاضع لأي تعاقد تأميني
                </div>
              </div>
            </div>
            <span class="badge badge-cash" style="font-size: 0.76rem; padding: 4px 10px; border-radius: 9999px;">
              نقدي
            </span>
          </div>
        `;
        if (amountLabel) amountLabel.textContent = 'المبلغ المدفوع بالدرج (ج.م) *';
      }
    }
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

    this.selectedPatient = patient;

    if (this.entryMode === 'examination') {
      const isIns = Boolean(patient.billing === 'insurance' || (patient.insuranceCompany && String(patient.insuranceCompany).trim().length > 0));
      this.setExamType(isIns ? 'contract' : 'cash');
    } else {
      this.updateSessionPaymentUI(patient);
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

    const paymentContainer = document.getElementById('session-payment-method-container');
    if (paymentContainer) {
      paymentContainer.innerHTML = `
        <div style="background: var(--bg-subtle); border: 1.5px dashed var(--border-color); border-radius: 10px; padding: 14px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
          <i class="fa-solid fa-hand-pointer" style="margin-left: 6px; color: var(--primary);"></i> اختر المريض بالأعلى لتحديد نظام السداد تلقائياً (نقدي / تأمين)
        </div>
      `;
    }
    const amountLabel = document.getElementById('session-amount-label');
    if (amountLabel) amountLabel.textContent = 'المبلغ المدفوع بالدرج (ج.م) *';
    const payTypeInput = document.getElementById('session-pay-type-hidden');
    if (payTypeInput) payTypeInput.value = 'cash';
    const insNameInput = document.getElementById('session-insurance-name');
    if (insNameInput) insNameInput.value = '';
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

    const docSelectEl = document.getElementById('session-doctor-select');
    const doctor = docSelectEl?.value || '';
    const selectedDoctorOpt = docSelectEl?.options[docSelectEl.selectedIndex];
    const doctorUid = selectedDoctorOpt?.getAttribute('data-uid') || patient?.doctorUid || '';
    
    // Body parts selection (Required for session, skipped for examination)
    let selectedParts = [];
    if (this.entryMode === 'session') {
      selectedParts = this.getSelectedBodyParts();
      if (selectedParts.length === 0) {
        await this.app.showAlert('يرجى تحديد عضو واحد على الأقل تم علاجه في الجلسة (اضغط على أزرار الأعضاء المعالجة).', 'تنبيه', 'warning');
        return;
      }
    }

    let payType = 'cash';
    let insuranceName = '';
    let contractType = '-';

    if (this.entryMode === 'examination') {
      if (this.examType === 'contract') {
        payType = 'insurance';
        const compSelect = document.getElementById('exam-contract-company-select');
        insuranceName = (compSelect?.value || patient?.insuranceCompany || document.getElementById('session-insurance-name')?.value || '').trim();
        const selOpt = compSelect?.options[compSelect?.selectedIndex];
        contractType = selOpt?.getAttribute('data-contract') || patient?.contractType || 'direct';
        if (!insuranceName) {
          await this.app.showAlert('يرجى اختيار شركة التعاقد المحول منها المريض للكشف.', 'بيانات ناقصة', 'warning');
          return;
        }
      } else {
        payType = 'cash';
        insuranceName = '';
        contractType = '-';
      }
    } else {
      const isPatientInsured = Boolean(
        patient?.billing === 'insurance' ||
        (patient?.insuranceCompany && String(patient?.insuranceCompany).trim().length > 0)
      );
      payType = isPatientInsured ? 'insurance' : 'cash';
      if (payType === 'insurance') {
        insuranceName = (patient?.insuranceCompany || document.getElementById('session-insurance-name')?.value || '').trim();
        contractType = patient?.contractType || document.getElementById('session-contract-type-hidden')?.value || 'direct';
      }
    }

    const amountPaid = parseFloat(document.getElementById('session-amount-paid').value) || 0;
    const notes = document.getElementById('session-notes').value.trim();

    const sessionDateVal = document.getElementById('session-date')?.value || this.currentSessionDate;
    const isEdit = Boolean(this.editingSessionId);

    const sessionData = {
      id: this.editingSessionId || null,
      entryType: this.entryMode, // 'session' | 'examination'
      examType: this.entryMode === 'examination' ? this.examType : null,
      date: sessionDateVal,
      patientId: this.selectedPatientId,
      patientName,
      doctor,
      doctorUid,
      bodyParts: this.entryMode === 'examination' ? [] : selectedParts,
      bodyPartsCount: this.entryMode === 'examination' ? 0 : selectedParts.length,
      payType,
      insuranceName,
      contractType,
      amountPaid,
      notes
    };

    await db.saveSession(sessionData, currentUser);
    
    let auditAction = isEdit ? 'تعديل جلسة' : 'تسجيل جلسة';
    let auditDesc = '';
    if (this.entryMode === 'examination') {
      auditAction = isEdit ? 'تعديل كشف' : 'تسجيل كشف';
      auditDesc = isEdit
        ? `تعديل بيانات كشف المريض ${patientName} بتاريخ ${sessionDateVal} (${this.examType === 'contract' ? 'كشف تعاقد: ' + insuranceName : 'كشف نقدي'} - مسدد: ${amountPaid} ج.م)`
        : `تسجيل كشف للمريض ${patientName} مع ${doctor} بتاريخ ${sessionDateVal} (${this.examType === 'contract' ? 'كشف تعاقد: ' + insuranceName : 'كشف نقدي'} - مسدد: ${amountPaid} ج.م)`;
    } else {
      auditDesc = isEdit
        ? `تعديل بيانات جلسة المريض ${patientName} بتاريخ ${sessionDateVal} (مسدد: ${amountPaid} ج.م)`
        : `تسجيل جلسة للمريض ${patientName} مع ${doctor} بتاريخ ${sessionDateVal} (${selectedParts.length} أعضاء: ${selectedParts.join('، ')} - مسدد: ${amountPaid} ج.م)`;
    }

    try { await db.logAudit(auditAction, auditDesc, currentUser); } catch (_) {}
    const toastMsg = isEdit 
      ? (this.entryMode === 'examination' ? 'تم تعديل بيانات الكشف بنجاح' : 'تم تعديل بيانات الجلسة بنجاح')
      : (this.entryMode === 'examination' ? 'تم تسجيل وحفظ الكشف بنجاح' : 'تم تسجيل وحفظ الجلسة بنجاح');
    this.app.showToast(toastMsg);
    this.resetSessionForm();
    this.renderAllInsuranceChips();
    this.renderBodyPartsChips();
    await this.loadTodaySessions();
    
    // التحديث الفوري للحسابات والتقرير اليومي
    await this.app.financeManager.loadDailyReport();
  }

  // ================= Dynamic Body Parts (Add & Delete like Modalities) =================
  renderBodyPartsChips(selectedParts = []) {
    const container = document.getElementById('body-parts-container');
    if (!container) return;

    const parts = db.getClinicalOptions('body_parts');
    const isEdit = Boolean(this.bodyPartsEditMode);

    let html = parts.map(part => {
      const isSelected = selectedParts.includes(part);
      const editClass = isEdit ? 'in-edit-mode' : '';
      const safePart = part.replace(/'/g, "\\'");
      const deleteIconHtml = isEdit
        ? `<span class="chip-delete-tag" data-action="delete-body-part" data-part="${safePart}" title="حذف هذا العضو"><i class="fa-solid fa-circle-xmark"></i></span>`
        : '';

      return `
        <button type="button" class="chip-choice ${isSelected ? 'selected' : ''} ${editClass}" data-part="${part}">
          <i class="fa-solid fa-bone"></i> <span>${part}</span>
          ${deleteIconHtml}
        </button>
      `;
    }).join('');

    if (isEdit) {
      html += `
        <button type="button" class="chip-add-new-btn" data-action="add-body-part">
          <i class="fa-solid fa-plus"></i> <span>إضافة عضو جديد</span>
        </button>
      `;
    }

    container.innerHTML = html;
    this.updateBodyPartsCount();
  }

  toggleBodyPartsEditMode() {
    this.bodyPartsEditMode = !this.bodyPartsEditMode;
    const isEdit = this.bodyPartsEditMode;

    const btn = document.getElementById('btn-toggle-chips-body-parts');
    if (btn) {
      if (isEdit) {
        btn.className = 'btn-edit-chips active';
        btn.innerHTML = '<i class="fa-solid fa-check"></i> <span class="edit-text">تم الانتهاء</span>';
      } else {
        btn.className = 'btn-edit-chips';
        btn.innerHTML = '<i class="fa-solid fa-pen-to-square"></i> <span class="edit-text">تعديل الأزرار</span>';
      }
    }

    const curSelected = this.getSelectedBodyParts();
    this.renderBodyPartsChips(curSelected);
  }

  async deleteBodyPart(partName) {
    const confirmed = await this.app.showConfirm(`هل أنت متأكد من حذف زر "${partName}" نهائياً؟`, 'حذف زر');
    if (confirmed) {
      await db.deleteClinicalOption('body_parts', partName);
      const curSelected = this.getSelectedBodyParts().filter(p => p !== partName);
      this.renderBodyPartsChips(curSelected);
      this.app.showToast(`تم حذف زر "${partName}"`);
    }
  }

  async promptAddBodyPart() {
    const name = prompt('اكتب اسم العضو المعالج الجديد:');
    if (name && name.trim()) {
      await db.addClinicalOption('body_parts', name.trim());
      const curSelected = this.getSelectedBodyParts();
      curSelected.push(name.trim());
      this.renderBodyPartsChips(curSelected);
      this.app.showToast(`تمت إضافة زر "${name.trim()}" بنجاح`);
    }
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
    this.renderBodyPartsChips();
  }

  async deleteInsuranceDirect(contractType, compName) {
    const user = auth.getCurrentUser();
    if (!RolesManager.canManageUsers(user)) return;

    const confirmed = await this.app.showConfirm(`هل أنت متأكد من حذف شركة "${compName}" نهائياً؟`, 'حذف شركة تأمين');
    if (confirmed) {
      await db.deleteInsuranceCompany(contractType, compName);
      this.renderAllInsuranceChips();
    this.renderBodyPartsChips();
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
    this.renderBodyPartsChips();
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
      this.currentSessionDate = getLocalDateStr(d);
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
    const yesterday = getLocalDateStr(d);

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
      const yestStr = getLocalDateStr(yest);
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

    // 2. Set mode & exam type
    if (s.entryType === 'examination') {
      this.setEntryMode('examination');
      if (s.examType) {
        this.setExamType(s.examType);
      }
    } else {
      this.setEntryMode('session');
    }

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
    this.renderBodyPartsChips(savedParts);

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
    this.selectedPatient = null;
    document.getElementById('form-log-session').reset();
    const dateInput = document.getElementById('session-date');
    if (dateInput) dateInput.value = this.currentSessionDate;
    this.renderBodyPartsChips([]);
    const countEl = document.getElementById('selected-parts-count');
    if (countEl) countEl.textContent = '0';
    const insF = document.getElementById('session-insurance-fields');
    if (insF) insF.style.display = 'none';
    this.resetPatientSelection();
    this.setEntryMode(this.entryMode);
  }

  async loadTodaySessions() {
    const sessions = await db.getSessions(this.currentSessionDate);
    const tbody = document.getElementById('sessions-today-tbody');
    const badge = document.getElementById('sessions-today-count-badge');
    
    const examsCount = sessions.filter(s => s.entryType === 'examination').length;
    const sessCount = sessions.length - examsCount;
    if (badge) {
      if (examsCount > 0 && sessCount > 0) {
        badge.textContent = `${sessions.length} حركات (${sessCount} جلسة • ${examsCount} كشف)`;
      } else if (examsCount > 0) {
        badge.textContent = `${examsCount} كشف`;
      } else {
        badge.textContent = `${sessions.length} جلسة`;
      }
    }

    if (!tbody) return;

    if (sessions.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 25px;">لا توجد حركات أو جلسات مسجلة اليوم حتى الآن.</td></tr>`;
      return;
    }

    const currentUser = auth.getCurrentUser();
    const canDelete = RolesManager.canDelete(currentUser);

    tbody.innerHTML = sessions.map(s => {
      const safeId = escapeHTML(s.id);
      const safePatient = escapeHTML(s.patientName);
      const safeDoc = escapeHTML(s.doctor);
      const safeIns = escapeHTML(s.insuranceName || 'تعاقد');
      const safeAmount = escapeHTML(s.amountPaid);
      const safeRecBy = escapeHTML(s.recordedBy);
      const safeRecAt = escapeHTML(s.recordedAt);

      const isExam = (s.entryType === 'examination');

      let payBadge = '';
      if (isExam) {
        if (s.examType === 'cash' || s.payType === 'cash') {
          payBadge = `<span class="badge badge-cash" style="background:#dcfce7; color:#15803d;"><i class="fa-solid fa-money-bill"></i> كشف نقدي</span>`;
        } else {
          const cTypeLabel = s.contractType === 'indirect' ? 'غير مباشر' : 'مباشر';
          payBadge = `<span class="badge badge-direct" style="background:#e0e7ff; color:#3730a3;"><i class="fa-solid fa-file-contract"></i> كشف تعاقد: ${safeIns} (${cTypeLabel})</span>`;
        }
      } else {
        if (s.payType === 'cash') {
          payBadge = `<span class="badge badge-cash"><i class="fa-solid fa-money-bill"></i> نقدي</span>`;
        } else if (s.contractType === 'direct') {
          payBadge = `<span class="badge badge-direct"><i class="fa-solid fa-file-contract"></i> ${safeIns} (مباشر)</span>`;
        } else {
          payBadge = `<span class="badge badge-indirect"><i class="fa-solid fa-handshake"></i> ${safeIns} (غير مباشر)</span>`;
        }
      }

      let partsCell = '';
      if (isExam) {
        partsCell = `
          <span class="badge" style="background: #f8fafc; color: #0284c7; border: 1px solid #bae6fd; font-weight: 800; font-size: 0.76rem; padding: 3px 8px;">
            <i class="fa-solid fa-stethoscope"></i> فحص سريري / كشف
          </span>
        `;
      } else {
        const safeParts = Array.isArray(s.bodyParts) ? s.bodyParts.map(b => escapeHTML(b)).join('، ') : escapeHTML(s.bodyParts || '');
        const safePartsShort = Array.isArray(s.bodyParts) ? s.bodyParts.slice(0, 2).map(b => escapeHTML(b)).join('، ') : escapeHTML(s.bodyParts || '');
        partsCell = `
          <span class="badge badge-role-doctor" title="${safeParts}">
            ${escapeHTML(s.bodyPartsCount)} أعضاء (${safePartsShort}${s.bodyParts && s.bodyParts.length > 2 ? '...' : ''})
          </span>
        `;
      }

      const examTag = isExam
        ? `<span class="badge" style="background: #ede9fe; color: #6d28d9; font-size: 0.72rem; padding: 1px 6px; margin-right: 6px; border-radius: 4px; font-weight: 800;"><i class="fa-solid fa-stethoscope"></i> كشف</span>`
        : '';

      return `
        <tr>
          <td style="font-weight: 700;">${safePatient} ${examTag}</td>
          <td>${safeDoc}</td>
          <td>${payBadge}</td>
          <td>${partsCell}</td>
          <td style="font-weight: 700; color: var(--success);">${safeAmount} ج.م</td>
          <td style="font-size: 0.8rem; color: var(--text-muted);">${safeRecBy} (${safeRecAt})</td>
          <td>
            <div style="display: flex; gap: 4px;">
              <button type="button" class="btn btn-outline btn-sm btn-edit-session" data-session-id="${safeId}" onclick="sessionsManager.editSession('${safeId}')" title="${isExam ? 'تعديل بيانات الكشف' : 'تعديل بيانات الجلسة'}">
                <i class="fa-solid fa-pen-to-square"></i>
              </button>
              ${canDelete ? `
                <button type="button" class="btn btn-outline btn-sm btn-delete-record btn-delete-session" style="color: var(--danger);" data-session-id="${safeId}" onclick="sessionsManager.deleteSession('${safeId}')" title="${isExam ? 'حذف الكشف' : 'حذف الجلسة'}">
                  <i class="fa-solid fa-trash"></i>
                </button>
              ` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  async deleteSession(sessionId) {
    const allSessions = await db.getSessions();
    const s = allSessions.find(item => item.id === sessionId);
    const itemLabel = s?.entryType === 'examination' ? 'الكشف' : 'الجلسة';
    const confirmed = await this.app.showConfirm(`هل أنت متأكد من حذف ${itemLabel} من سجلات اليوم؟`, `تأكيد حذف ${itemLabel}`);
    if (confirmed) {
      const currentUser = auth.getCurrentUser();
      await db.deleteSession(sessionId);
      const auditAction = s?.entryType === 'examination' ? 'حذف كشف' : 'حذف جلسة';
      await db.logAudit(auditAction, `حذف حركة ${itemLabel} برقم ${sessionId}`, currentUser);
      this.app.showToast(`تم حذف ${itemLabel}`);
      this.renderAllInsuranceChips();
      this.renderBodyPartsChips();
      await this.loadTodaySessions();
      await this.app.financeManager.loadDailyReport();
    }
  }
}
