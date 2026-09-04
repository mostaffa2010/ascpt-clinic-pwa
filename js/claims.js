import { escapeHTML } from './utils.js';
// ========================================================
// PhysioFlow - Insurance Claims & Attendance Cards Module
// نظام مطالبات شركات التأمين وبطاقات التردد
// ========================================================

import { db } from './db.js';
import { auth } from './auth.js';
import { RolesManager } from './roles.js';

export class ClaimsManager {
  constructor(app) {
    this.app = app;
    this.currentCompany = '';
    this.startDate = '2026-08-01';
    this.endDate = '2026-08-31';
    this.claimPatientsData = [];
    this.activeCardPatientId = null;
    this.attendanceCardsStore = {};
    this.searchQuery = '';
    this.defaultTreatmentOptions = [
      'pulsed Ultrasound',
      'Heat application',
      'Interferential current',
      'Therapeutic ex',
      'TENS',
      'Spinal Traction',
      'Laser Therapy',
      'Shockwave Therapy',
      'Joint Mobilization',
      'Myofascial Release',
      'Cryotherapy'
    ];
  }

  async init() {
    this.bindEvents();
    this.setDefaultDates();
    this.setupScrollSync();
    await this.populateCompaniesDropdown();
  }

  setDefaultDates() {
    const startEl = document.getElementById('claim-start-date');
    const endEl = document.getElementById('claim-end-date');
    const claimDateEl = document.getElementById('claim-doc-date');

    if (startEl) startEl.value = '2026-08-01';
    if (endEl) endEl.value = '2026-08-31';
    if (claimDateEl) claimDateEl.value = '2026-08-31';

    this.startDate = '2026-08-01';
    this.endDate = '2026-08-31';
  }

  async populateCompaniesDropdown() {
    const select = document.getElementById('claim-company-select');
    if (!select) return;

    const companies = db.getAllInsuranceCompaniesWithTypes ? db.getAllInsuranceCompaniesWithTypes() : [];

    // Also include any companies found on patients
    const patients = await db.getPatients();
    patients.forEach(p => {
      if (p.billing === 'insurance' && p.insuranceCompany) {
        const cName = p.insuranceCompany.trim();
        const found = companies.find(c => c.name.toLowerCase() === cName.toLowerCase());
        if (!found) {
          companies.push({
            name: cName,
            contractType: p.contractType || 'direct',
            label: `${cName} (${p.contractType === 'indirect' ? 'تعاقد غير مباشر' : 'تعاقد مباشر'})`
          });
        }
      }
    });

    select.innerHTML = '<option value="">-- اضغط هنا لاختيار شركة التأمين --</option>' + 
      companies.map(c => `<option value="${c.name}">${c.label}</option>`).join('');

    // Keep default empty placeholder
    select.value = '';
    this.currentCompany = '';

    if (this.app && this.app.updateCustomSelectDisplay) {
      this.app.updateCustomSelectDisplay('claim-company-select');
    }
  }

  onCompanyChanged(companyName) {
    this.currentCompany = companyName;
    if (companyName) {
      this.loadCompanyPatients();
    }
  }

  bindEvents() {
    const selectAllCb = document.getElementById('claim-select-all-cb');
    if (selectAllCb) {
      selectAllCb.addEventListener('change', (e) => {
        const checked = e.target.checked;
        this.claimPatientsData.forEach(item => {
          item.isChecked = checked;
        });
        this.renderPatientsTable();
        this.recalcGrandTotals();
      });
    }

    const startInput = document.getElementById('claim-start-date');
    if (startInput) {
      startInput.addEventListener('change', (e) => {
        this.startDate = e.target.value;
      });
    }

    const endInput = document.getElementById('claim-end-date');
    if (endInput) {
      endInput.addEventListener('change', (e) => {
        this.endDate = e.target.value;
      });
    }

    const compSelect = document.getElementById('claim-company-select');
    if (compSelect) {
      compSelect.addEventListener('change', (e) => this.onCompanyChanged(e.target.value));
    }

    document.getElementById('btn-load-claim-patients')?.addEventListener('click', () => this.loadCompanyPatients());
    const bClaim = document.getElementById('btn-print-claim-statement'); if (bClaim) bClaim.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.printClaimStatement(); };
    const bCards = document.getElementById('btn-print-attendance-cards'); if (bCards) bCards.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.printAttendanceCards(); };
    document.getElementById('btn-export-claim-excel')?.addEventListener('click', () => this.exportClaimExcel());
    document.getElementById('claim-patient-search-input')?.addEventListener('input', (e) => this.onSearchInput(e.target.value));

    // Modal attendance card buttons
    document.getElementById('btn-card-add-treatment')?.addEventListener('click', () => this.promptAddNewTreatment());
    const bCurCard = document.getElementById('btn-card-print-current'); if (bCurCard) bCurCard.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.printAttendanceCards(this.activeCardPatientId); };
    document.getElementById('btn-card-save')?.addEventListener('click', () => this.saveAttendanceCardData());

    // Event Delegation: Claims Patient Table (checkboxes, inputs, open card)
    const tbody = document.getElementById('claim-patients-tbody');
    if (tbody) {
      tbody.addEventListener('change', (e) => {
        const target = e.target;
        if (target.classList.contains('claim-patient-check')) {
          const pid = target.getAttribute('data-patient-id');
          this.togglePatientCheck(pid, target.checked);
        } else if (target.classList.contains('claim-patient-input')) {
          const pid = target.getAttribute('data-patient-id');
          const field = target.getAttribute('data-field');
          this.updatePatientNumber(pid, field, target.value);
        }
      });

      tbody.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-open-card-modal');
        if (btn) {
          const pid = btn.getAttribute('data-patient-id');
          if (pid) this.openAttendanceCardModal(pid);
        }
      });
    }

    // Event Delegation: Attendance Card Treatments Chips
    const treatContainer = document.getElementById('card-treatment-chips-container');
    if (treatContainer) {
      treatContainer.addEventListener('click', (e) => {
        const chip = e.target.closest('.card-treatment-chip');
        if (chip) {
          chip.classList.toggle('selected');
          this.updateCardLivePreview();
        }
      });
    }
  }

  async loadCompanyPatients() {
    const compSelect = document.getElementById('claim-company-select');
    const startInput = document.getElementById('claim-start-date');
    const endInput = document.getElementById('claim-end-date');
    const defaultRateInput = document.getElementById('claim-default-session-rate');
    const defaultEvalInput = document.getElementById('claim-default-eval-fee');

    this.currentCompany = compSelect?.value || this.currentCompany || '';
    this.startDate = startInput?.value || this.startDate || '2026-08-01';
    this.endDate = endInput?.value || this.endDate || '2026-08-31';

    if (!this.currentCompany) {
      if (this.app && this.app.showAlert) {
        this.app.showAlert('يرجى اختيار شركة التأمين أولاً من القائمة.', 'تنبيه');
      } else {
        alert('يرجى اختيار شركة التأمين أولاً.');
      }
      return;
    }

    const defaultRate = parseFloat(defaultRateInput?.value) || 120;
    const defaultEval = parseFloat(defaultEvalInput?.value) || 150;

    const allPatients = await db.getPatients();
    const allSessions = await db.getSessions();

    // Match patients belonging to selected company (flexible matching)
    const companyPatients = allPatients.filter(p => {
      if (p.billing !== 'insurance' || !p.insuranceCompany) return false;
      const c1 = p.insuranceCompany.trim().toLowerCase();
      const c2 = this.currentCompany.trim().toLowerCase();
      return c1.includes(c2) || c2.includes(c1);
    });

    if (companyPatients.length === 0) {
      const tbody = document.getElementById('claim-patients-tbody');
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 24px; color: var(--text-muted); font-weight: 700;">لا يوجد مرضى مسجلون حالياً تحت شركة ${this.currentCompany}.</td></tr>`;
      }
      this.claimPatientsData = [];
      this.recalcGrandTotals();
      return;
    }

    this.claimPatientsData = companyPatients.map(p => {
      // Sessions for this patient in selected date range
      const patientSessions = allSessions.filter(s => {
        return s.patientId === p.id && s.date >= this.startDate && s.date <= this.endDate;
      });

      const sessionCount = patientSessions.length > 0 ? patientSessions.length : 12;
      const isChecked = false; // غير محدد افتراضياً حتى يبحث الطبيب ويحدد براحته
      const total = (sessionCount * defaultRate) + defaultEval;

      const clinical = p.clinicalSheet || {};
      const cardData = this.attendanceCardsStore[p.id] || {
        diagnosis: clinical.diagnosis || 'Lumber discogenic low back pain',
        evaluation: clinical.affectedArea ? `فحص سريري وتقييم لوظائف: ${clinical.affectedArea}` : 'فحص سريري للعمود الفقري والمدى الحركي',
        treatments: (clinical.modalities && clinical.modalities.length > 0)
          ? clinical.modalities.map(m => m.split(' ')[0])
          : ['pulsed Ultrasound', 'Heat application', 'Interferential current', 'Therapeutic ex']
      };
      this.attendanceCardsStore[p.id] = cardData;

      return {
        patient: p,
        isChecked,
        evalFee: defaultEval,
        sessionCount: sessionCount,
        sessionRate: defaultRate,
        total,
        cardData
      };
    });

    this.searchQuery = '';
    const sInput = document.getElementById('claim-patient-search-input');
    if (sInput) sInput.value = '';
    const selectAllCb = document.getElementById('claim-select-all-cb');
    if (selectAllCb) selectAllCb.checked = false;

    this.renderPatientsTable();
    this.recalcGrandTotals();
    if (this.app && this.app.showToast) {
      this.app.showToast(`تم استخراج ${this.claimPatientsData.length} مريض لشركة ${this.currentCompany}`);
    }
  }

  onSearchInput(query) {
    this.searchQuery = (query || '').trim().toLowerCase();
    this.renderPatientsTable();
  }

  getFilteredPatients() {
    if (!this.searchQuery) return this.claimPatientsData;
    const q = this.searchQuery;
    return this.claimPatientsData.filter(item => {
      const p = item.patient;
      const name = (p.name || '').toLowerCase();
      const phone = (p.phone || '');
      const doctor = (p.doctor || '').toLowerCase();
      return name.includes(q) || phone.includes(q) || doctor.includes(q);
    });
  }

  renderPatientsTable() {
    const tbody = document.getElementById('claim-patients-tbody');
    if (!tbody) return;

    if (this.claimPatientsData.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 24px; color: var(--text-muted);">اضغط على زر "استخراج وعرض مرضى الشركة" لعرض القائمة.</td></tr>`;
      const statsEl = document.getElementById('claim-search-stats');
      if (statsEl) statsEl.innerHTML = '';
      return;
    }

    const filtered = this.getFilteredPatients();

    // Update search stats badge
    const statsEl = document.getElementById('claim-search-stats');
    if (statsEl) {
      if (this.searchQuery) {
        statsEl.innerHTML = `<span class="badge" style="background: #e0f2fe; color: #0284c7; font-weight: 700; font-size: 0.8rem;">عرض ${filtered.length} من أصل ${this.claimPatientsData.length} مريض</span>`;
      } else {
        statsEl.innerHTML = `<span style="color: var(--text-muted); font-size: 0.8rem;">إجمالي مرضى الشركة: ${this.claimPatientsData.length} مريض</span>`;
      }
    }

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 24px; color: var(--text-muted); font-weight: 700;">لا توجد نتائج مطابقة لبحثك: "${this.searchQuery}".</td></tr>`;
      return;
    }

    // Sync select-all checkbox with filtered items
    const selectAllCb = document.getElementById('claim-select-all-cb');
    if (selectAllCb) {
      selectAllCb.checked = filtered.length > 0 && filtered.every(i => i.isChecked);
    }

    this.setupScrollSync();
    tbody.innerHTML = filtered.map((item, idx) => {
      const p = item.patient;
      const safeId = escapeHTML(p.id);
      const safeName = escapeHTML(p.name);
      const safePhone = escapeHTML(p.phone);
      const safeDoc = escapeHTML(p.doctor);
      const rowChecked = item.isChecked ? 'checked' : '';
      const rowTotal = (item.sessionCount * item.sessionRate) + item.evalFee;
      item.total = rowTotal;

      return `
        <tr style="${!item.isChecked ? 'opacity: 0.55; background-color: #f8fafc;' : ''}">
          <td style="text-align: center;">
            <input type="checkbox" class="claim-patient-check" data-patient-id="${safeId}" style="width: 18px; height: 18px; cursor: pointer;" ${rowChecked}>
          </td>
          <td style="text-align: center; font-weight: 700;">${idx + 1}</td>
          <td>
            <div style="font-weight: 800; color: var(--text-main); font-size: 0.92rem;">${safeName}</div>
            <small style="color: var(--text-muted); font-size: 0.76rem;"><i class="fa-solid fa-phone"></i> ${safePhone} • ${safeDoc}</small>
          </td>
          <td>
            <input type="number" class="form-control claim-patient-input" data-field="evalFee" data-patient-id="${safeId}" style="width: 80px; padding: 4px 6px; font-weight: 700; text-align: center;" value="${item.evalFee}">
          </td>
          <td>
            <input type="number" class="form-control claim-patient-input" data-field="sessionCount" data-patient-id="${safeId}" style="width: 70px; padding: 4px 6px; font-weight: 700; text-align: center;" value="${item.sessionCount}">
          </td>
          <td>
            <input type="number" class="form-control claim-patient-input" data-field="sessionRate" data-patient-id="${safeId}" style="width: 75px; padding: 4px 6px; font-weight: 700; text-align: center;" value="${item.sessionRate}">
          </td>
          <td style="font-weight: 800; color: var(--success); font-size: 0.95rem; text-align: center;">
            <span id="claim-row-total-${safeId}">${rowTotal.toLocaleString('en-US')}</span> ج.م
          </td>
          <td style="text-align: center;">
            <button type="button" class="btn btn-outline btn-sm btn-open-card-modal" data-patient-id="${safeId}" style="padding: 4px 10px; font-size: 0.78rem; font-weight: 700; color: #0369a1; border-color: #bae6fd; background-color: #f0f9ff;" title="تخصيص وطباعة بطاقة التردد">
              <i class="fa-solid fa-id-card"></i> بطاقة التردد
            </button>
          </td>
        </tr>
      `;    }).join('');
    setTimeout(() => this.setupScrollSync(), 50);
  }

  togglePatientCheck(patientId, checked) {
    const item = this.claimPatientsData.find(i => i.patient.id === patientId);
    if (item) {
      item.isChecked = checked;
      this.renderPatientsTable();
      this.recalcGrandTotals();
    }
  }

  updatePatientNumber(patientId, field, val) {
    const num = parseFloat(val) || 0;
    const item = this.claimPatientsData.find(i => i.patient.id === patientId);
    if (item) {
      item[field] = num;
      item.total = (item.sessionCount * item.sessionRate) + item.evalFee;
      const totalCell = document.getElementById(`claim-row-total-${patientId}`);
      if (totalCell) totalCell.textContent = item.total.toLocaleString('en-US');
      this.recalcGrandTotals();
    }
  }

    recalcGrandTotals() {
    let totalPatients = 0;
    let totalSessions = 0;
    let grandTotalAmount = 0;

    this.claimPatientsData.forEach(item => {
      if (item.isChecked) {
        totalPatients++;
        totalSessions += item.sessionCount;
        grandTotalAmount += item.total;
      }
    });

    const ptsBadge = document.getElementById('claim-total-patients-count');
    const sessBadge = document.getElementById('claim-total-sessions-count');
    const grandBadge = document.getElementById('claim-grand-total-amount');

    if (ptsBadge) ptsBadge.textContent = `${totalPatients} مريض`;
    if (sessBadge) sessBadge.textContent = `${totalSessions} جلسة`;
    if (grandBadge) grandBadge.textContent = `${grandTotalAmount.toLocaleString('en-US')} ج.م`;
  }

  // ================= Attendance Card Management =================
  openAttendanceCardModal(patientId) {
    this.activeCardPatientId = patientId;
    const item = this.claimPatientsData.find(i => i.patient.id === patientId);
    if (!item) return;

    const p = item.patient;
    const cardData = this.attendanceCardsStore[patientId] || item.cardData;

    document.getElementById('card-modal-patient-name').textContent = p.name;
    document.getElementById('card-modal-company-name').textContent = this.currentCompany || p.insuranceCompany;
    document.getElementById('card-input-diagnosis').value = cardData.diagnosis || '';
    document.getElementById('card-input-eval').value = cardData.evaluation || '';

    this.renderCardTreatmentChips(cardData.treatments || []);
    this.app.openModal('modal-attendance-card');
  }

  renderCardTreatmentChips(selectedTreatments = []) {
    const container = document.getElementById('card-treatment-chips-container');
    if (!container) return;

    const customStored = JSON.parse(localStorage.getItem('pc_claim_treatments') || '[]');
    const allOptions = Array.from(new Set([...this.defaultTreatmentOptions, ...customStored]));

    container.innerHTML = allOptions.map(opt => {
      const isSelected = selectedTreatments.includes(opt);
      return `
        <button type="button" class="chip-choice sheet-chip card-treatment-chip ${isSelected ? 'selected' : ''}" data-val="${opt}">
          <i class="fa-solid fa-bolt"></i> ${opt}
        </button>
      `;
    }).join('');

    this.updateCardLivePreview();
  }

  updateCardLivePreview() {
    const selected = Array.from(document.querySelectorAll('#card-treatment-chips-container .sheet-chip.selected'))
      .map(b => b.getAttribute('data-val'));

    const previewList = document.getElementById('card-plan-preview-list');
    if (previewList) {
      if (selected.length === 0) {
        previewList.innerHTML = '<span style="color: var(--text-muted); font-size: 0.8rem;">اضغط على الأزرار أعلاه لتحديد الخطة العلاجية...</span>';
      } else {
        previewList.innerHTML = selected.map(t => `<div style="padding: 2px 0; font-weight: 700; color: #1e293b;">- ${t}</div>`).join('');
      }
    }
  }

  saveAttendanceCardData() {
    if (!this.activeCardPatientId) return;

    const diagnosis = document.getElementById('card-input-diagnosis')?.value.trim() || '';
    const evaluation = document.getElementById('card-input-eval')?.value.trim() || '';
    const treatments = Array.from(document.querySelectorAll('#card-treatment-chips-container .sheet-chip.selected'))
      .map(b => b.getAttribute('data-val'));

    this.attendanceCardsStore[this.activeCardPatientId] = {
      diagnosis,
      evaluation,
      treatments
    };

    const item = this.claimPatientsData.find(i => i.patient.id === this.activeCardPatientId);
    if (item) {
      item.cardData = this.attendanceCardsStore[this.activeCardPatientId];
    }

    this.app.closeModal('modal-attendance-card');
    this.app.showToast('تم حفظ بطاقة التردد بنجاح');
  }

  // ================= Printing =================
  printClaimStatement() {
    const checkedItems = this.claimPatientsData.filter(i => i.isChecked);
    if (checkedItems.length === 0) {
      this.app.showAlert('يرجى تحديد مريض واحد على الأقل للمطالبة قبل الطباعة.', 'تنبيه');
      return;
    }

    const companyName = this.currentCompany || 'شركة التأمين';
    const taxNumber = document.getElementById('claim-tax-number')?.value.trim() || '';
    const claimDate = document.getElementById('claim-doc-date')?.value || '2026-08-31';

    document.getElementById('claim-print-company-name').textContent = companyName;
    document.getElementById('claim-print-tax-no').textContent = taxNumber ? `رقم البطاقة الضريبية: ${taxNumber}` : 'رقم البطاقة الضريبية: ';
    document.getElementById('claim-print-date').textContent = `تحريراً في: ${claimDate}`;
    document.getElementById('claim-print-period-text').textContent = `عن الفترة من ${this.startDate} إلى ${this.endDate}`;

    let grandTotal = 0;
    const tbody = document.getElementById('claim-print-tbody');
    tbody.innerHTML = checkedItems.map((item, idx) => {
      grandTotal += item.total;
      return `
        <tr>
          <td style="text-align: center; font-weight: bold;">${idx + 1}</td>
          <td style="font-weight: bold; padding-right: 8px;">${escapeHTML(item.patient.name)}</td>
          <td style="text-align: center; font-weight: bold;">${escapeHTML(item.evalFee)}</td>
          <td style="text-align: center; font-weight: bold;">${escapeHTML(item.sessionCount)}</td>
          <td style="text-align: center; font-weight: bold;">${escapeHTML(item.sessionRate)}</td>
          <td style="text-align: center; font-weight: 800;">${escapeHTML(item.total)}</td>
        </tr>
      `;
    }).join('');

    document.getElementById('claim-print-grand-total').textContent = `${grandTotal} ج.م`;

    document.body.classList.add('printing-claim');
    window.print();
    setTimeout(() => {
      document.body.classList.remove('printing-claim');
    }, 1500);
  }

  printAttendanceCards(singlePatientId = null) {
    if (this._isPrinting) return;
    this._isPrinting = true;
    setTimeout(() => { this._isPrinting = false; }, 2500);

    let itemsToPrint = [];
    if (singlePatientId) {
      const found = this.claimPatientsData.find(i => i.patient.id === singlePatientId);
      if (found) itemsToPrint = [found];
    } else {
      itemsToPrint = this.claimPatientsData.filter(i => i.isChecked);
    }

    if (itemsToPrint.length === 0) {
      this.app.showAlert('لا يوجد مرضى محددون لطباعة بطاقات التردد.', 'تنبيه');
      return;
    }

    const companyName = this.currentCompany || 'شركة التأمين';
    const container = document.getElementById('printable-attendance-cards');
    if (!container) return;

    container.innerHTML = itemsToPrint.map(item => {
      const p = item.patient;
      const card = this.attendanceCardsStore[p.id] || item.cardData || {};
      const diag = card.diagnosis || 'Lumber discogenic low back pain';
      const evaluation = card.evaluation || 'P.T. Initial functional evaluation';
      const treatments = card.treatments && card.treatments.length > 0
        ? card.treatments
        : ['pulsed Ultrasound', 'Heat application', 'Interferential current', 'Therapeutic ex'];

      return `
        <div class="attendance-card-print-page">
          <div style="text-align: right; line-height: 1.4; border-bottom: 2px solid #000; padding-bottom: 6px; margin-bottom: 16px;">
            <h2 style="font-size: 13pt; margin: 0; font-weight: 800; color: #0284c7;">مركز فيزيو فلو للعلاج الطبيعي والتأهيل (PhysioFlow)</h2>
            <div style="font-size: 10pt; font-weight: 700; color: #0f172a;">د/ مصطفى محمود</div>
            <div style="font-size: 8.5pt; color: #475569;">أخصائي العلاج الطبيعي والتأهيل الحركي</div>
          </div>

          <div style="text-align: center; margin: 20px 0;">
            <h1 style="font-size: 16pt; margin: 0; font-weight: 900; text-decoration: underline;">بطاقة تردد</h1>
          </div>

          <!-- Top Line: Name on the RIGHT, Company on the LEFT (No 'Referred from') -->
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; font-size: 11.5pt; font-weight: bold; border-bottom: 1.5px dashed #777; padding-bottom: 10px; direction: rtl;">
            <div style="text-align: right;">الاسم: <span style="font-size: 12.5pt; font-weight: 800; color: #0f172a;">${escapeHTML(p.name)}</span></div>
            <div style="text-align: left;">شركة: <span style="font-weight: 800; color: #0f172a;">${escapeHTML(companyName)}</span></div>
          </div>

          <!-- Content Block: strictly LTR, left-aligned, with bullet points underneath -->
          <div style="direction: ltr; text-align: left; line-height: 1.8; margin-bottom: 30px; font-size: 11pt;">
            <div style="margin-bottom: 20px;">
              <strong style="font-size: 12pt; display: block; color: #000; text-decoration: underline; margin-bottom: 6px;">Referred diagnosis:</strong>
              <div style="padding-left: 14px; font-weight: 700; color: #0f172a;">• ${escapeHTML(diag)}</div>
            </div>

            <div style="margin-bottom: 20px;">
              <strong style="font-size: 12pt; display: block; color: #000; text-decoration: underline; margin-bottom: 6px;">P.T. Evaluation:</strong>
              <div style="padding-left: 14px; color: #334155;">• ${escapeHTML(evaluation)}</div>
            </div>

            <div style="margin-bottom: 20px;">
              <strong style="font-size: 12pt; display: block; color: #000; text-decoration: underline; margin-bottom: 6px;">Plan of P.T. Treatment:</strong>
              <div style="padding-left: 14px; font-weight: 700; color: #0f172a; line-height: 1.8;">
                ${treatments.map(t => `<div style="margin-bottom: 4px;">• ${t}</div>`).join('')}
              </div>
            </div>
          </div>

          <div style="display: flex; justify-content: flex-end; margin-top: 50px; padding-left: 20px;">
            <div style="text-align: center;">
              <div style="font-size: 10.5pt; font-weight: bold;">أخصائي العلاج الطبيعي</div>
              <div style="font-size: 10pt; margin-top: 4px;">د/ مصطفى محمود</div>
              <div style="margin-top: 35px; border-bottom: 1.5px solid #000; width: 150px;"></div>
            </div>
          </div>

          <div style="margin-top: 60px; border-top: 1px solid #777; padding-top: 8px; text-align: center; font-size: 8.5pt; color: #444; line-height: 1.5;">
            <div style="font-weight: 700;">نظام PhysioFlow لإدارة مراكز وعيادات العلاج الطبيعي والتأهيل</div>
            <div>للتواصل والدعم الفني وطلب نسختك الخاصة: 01098164067 | support@physioflow.app</div>
          </div>
        </div>
      `;
    }).join('');

    document.body.classList.add('printing-cards');
    window.print();
    setTimeout(() => {
      document.body.classList.remove('printing-cards');
    }, 1500);
  }

  exportClaimExcel() {
    const checkedItems = this.claimPatientsData.filter(i => i.isChecked);
    if (checkedItems.length === 0) {
      this.app.showAlert('يرجى تحديد مرضى للمطالبة قبل التصدير.', 'تنبيه');
      return;
    }

    if (typeof XLSX === 'undefined') {
      this.app.showAlert('مكتبة الإكسيل جاري تحميلها، يرجى المحاولة بعد ثوانٍ.', 'تنبيه');
      return;
    }

    const companyName = this.currentCompany || 'شركة التأمين';
    const taxNumber = document.getElementById('claim-tax-number')?.value.trim() || '';
    const claimDate = document.getElementById('claim-doc-date')?.value || '2026-08-31';

    const wsData = [
      ['مركز الإسكندرية التخصصي للعلاج الطبيعي - PhysioFlow'],
      [`السادة شركة: ${companyName}`, '', '', `تحريراً في: ${claimDate}`],
      ['بيان بأسماء السادة المحولين'],
      [`رقم البطاقة الضريبية: ${taxNumber}`, '', '', `الفترة: ${this.startDate} إلى ${this.endDate}`],
      [],
      ['م', 'اسم المريض', 'رقم الهاتف', 'الطبيب المعالج', 'فحص وتقييم (ج.م)', 'عدد الجلسات', 'قيمة الجلسة (ج.م)', 'الإجمالي (ج.م)']
    ];

    let grandTotal = 0;
    checkedItems.forEach((item, idx) => {
      grandTotal += item.total;
      wsData.push([
        idx + 1,
        item.patient.name,
        item.patient.phone,
        item.patient.doctor,
        item.evalFee,
        item.sessionCount,
        item.sessionRate,
        item.total
      ]);
    });

    wsData.push([]);
    wsData.push(['', '', '', '', '', '', 'المبلغ الإجمالي الكلي المستحق:', grandTotal]);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, 'مطالبة تأمين');
    XLSX.writeFile(wb, `مطالبة_${companyName}_${claimDate}.xlsx`);
    this.app.showToast('تم تصدير المطالبة بنجاح إلى ملف Excel');
  }

  // ================= Top & Bottom Horizontal Scroll Synchronization =================
  setupScrollSync() {
    const topWrap = document.getElementById('claim-top-scroll-wrap');
    const container = document.getElementById('claim-table-container');
    const dummy = document.getElementById('claim-top-scroll-dummy');
    const table = document.getElementById('claim-patients-table');

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
    setTimeout(syncMetrics, 300);
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

}
