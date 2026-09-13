import { escapeHTML, getLocalDateStr } from './utils.js';
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
    const defDates = this._getDefaultMonthDates();
    this.startDate = defDates.start;
    this.endDate = defDates.end;
    this.claimPatientsData = [];
    this.activeCardPatientId = null;
    this.attendanceCardsStore = {};
    this.searchQuery = '';
    this.cardTreatmentsEditMode = false;
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

    // Claims Ledger State
    this.claimsLedgerData = [];
    this.ledgerStatusFilter = 'all';
    this.ledgerCompanyFilter = 'all';
    this.ledgerSearchQuery = '';
  }

  async init() {
    this.bindEvents();
    this.setDefaultDates();
    this.setupScrollSync();
    await this.populateCompaniesDropdown();
    await this.loadClaims();
  }

  _getDefaultMonthDates() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
    return {
      start: `${y}-${m}-01`,
      end: `${y}-${m}-${String(lastDay).padStart(2, '0')}`,
      today: getLocalDateStr(now)
    };
  }

  setDefaultDates() {
    const startEl = document.getElementById('claim-start-date');
    const endEl = document.getElementById('claim-end-date');
    const claimDateEl = document.getElementById('claim-doc-date');

    const defDates = this._getDefaultMonthDates();

    if (startEl) startEl.value = defDates.start;
    if (endEl) endEl.value = defDates.end;
    if (claimDateEl) claimDateEl.value = defDates.today;

    this.startDate = defDates.start;
    this.endDate = defDates.end;
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
      companies.map(c => `<option value="${escapeHTML(c.name)}">${escapeHTML(c.label)}</option>`).join('');

    // Keep default empty placeholder
    select.value = '';
    this.currentCompany = '';

    if (this.app && this.app.updateCustomSelectDisplay) {
      this.app.updateCustomSelectDisplay('claim-company-select');
    }

    // Populate Claims Ledger Company Filter
    const ledgerCompSelect = document.getElementById('claims-ledger-company-filter');
    if (ledgerCompSelect) {
      ledgerCompSelect.innerHTML = '<option value="all">كل شركات التأمين</option>' +
        companies.map(c => `<option value="${escapeHTML(c.name)}">${escapeHTML(c.name)}</option>`).join('');
      if (this.app && this.app.updateCustomSelectDisplay) {
        this.app.updateCustomSelectDisplay('claims-ledger-company-filter');
      }
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
    document.getElementById('btn-toggle-claim-settings')?.addEventListener('click', () => this.toggleClaimSettings());
    document.getElementById('btn-reopen-claim-settings')?.addEventListener('click', () => this.toggleClaimSettings(true));
    document.getElementById('btn-save-claim')?.addEventListener('click', () => this.saveCurrentClaim());
    document.getElementById('btn-settle-claim-action')?.addEventListener('click', () => this.openSettleClaim());
    const bClaim = document.getElementById('btn-print-claim-statement'); if (bClaim) bClaim.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.printClaimStatement(); };
    const bCards = document.getElementById('btn-print-attendance-cards'); if (bCards) bCards.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.printAttendanceCards(); };

    // Custom Multi-Picker Trigger for Card Treatments
    document.getElementById('btn-open-picker-card-treatments')?.addEventListener('click', () => {
      this.app.openMultiPicker({
        category: 'card_treatments',
        title: 'خطة ووسائل العلاج بكارت التردد',
        currentSelected: this.activeCardTreatments || [],
        onConfirm: (selected) => {
          this.updateCardTreatmentsPreview(selected);
        }
      });
    });
    document.getElementById('btn-export-claim-excel')?.addEventListener('click', () => this.exportClaimExcel());
    document.getElementById('claim-patient-search-input')?.addEventListener('input', (e) => this.onSearchInput(e.target.value));

    // Claims Ledger Search & Filters
    document.getElementById('claims-ledger-search')?.addEventListener('input', (e) => {
      this.ledgerSearchQuery = e.target.value.trim().toLowerCase();
      this.renderClaimsLedgerTable();
    });

    document.getElementById('claims-ledger-company-filter')?.addEventListener('change', (e) => {
      this.ledgerCompanyFilter = e.target.value;
      this.renderClaimsLedgerTable();
    });

    // Status Filter Pills for Claims Ledger
    document.querySelectorAll('.btn-claim-filter-pill').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.btn-claim-filter-pill').forEach(b => {
          b.classList.remove('active');
          b.style.background = 'var(--bg-subtle)';
          b.style.color = 'var(--text-main)';
        });
        btn.classList.add('active');
        btn.style.background = 'var(--primary)';
        btn.style.color = 'white';
        this.ledgerStatusFilter = btn.getAttribute('data-status') || 'all';
        this.renderClaimsLedgerTable();
      });
    });

    // Event Delegation for Claims Ledger Table
    const ledgerTbody = document.getElementById('claims-ledger-tbody');
    if (ledgerTbody) {
      ledgerTbody.addEventListener('click', async (e) => {
        const settleBtn = e.target.closest('.btn-settle-ledger-claim');
        if (settleBtn) {
          const claimId = settleBtn.getAttribute('data-claim-id');
          const claim = this.claimsLedgerData.find(c => c.id === claimId);
          if (claim) {
            this.openSettleClaim(claim);
          }
          return;
        }

        const loadBtn = e.target.closest('.btn-load-ledger-claim');
        if (loadBtn) {
          const claimId = loadBtn.getAttribute('data-claim-id');
          await this.loadClaimIntoEditor(claimId);
          return;
        }

        const delBtn = e.target.closest('.btn-delete-ledger-claim');
        if (delBtn) {
          const claimId = delBtn.getAttribute('data-claim-id');
          await this.deleteClaim(claimId);
          return;
        }
      });
    }

    // Modal attendance card buttons
    document.getElementById('btn-card-add-treatment')?.addEventListener('click', () => this.toggleCardTreatmentsEditMode());
    const bCurCard = document.getElementById('btn-card-print-current'); if (bCurCard) bCurCard.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.printAttendanceCards(this.activeCardPatientId); };
    document.getElementById('btn-card-save')?.addEventListener('click', () => this.saveAttendanceCardData());

    // Event Delegation: Mobile Container
    const mobClaimList = document.getElementById('claim-patients-mobile-cards');
    if (mobClaimList) {
      mobClaimList.addEventListener('change', (e) => {
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

      mobClaimList.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-open-card-modal');
        if (btn) {
          const pid = btn.getAttribute('data-patient-id');
          if (pid) this.openAttendanceCardModal(pid);
        }
      });
    }

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
      treatContainer.addEventListener('click', async (e) => {
        const addBtn = e.target.closest('#btn-card-add-new-treatment');
        if (addBtn) {
          e.preventDefault();
          e.stopPropagation();
          await this.promptAddNewTreatment();
          return;
        }

        const delTag = e.target.closest('.chip-delete-tag');
        if (delTag) {
          e.preventDefault();
          e.stopPropagation();
          const optName = delTag.getAttribute('data-treatment');
          if (optName) {
            await this.deleteCardTreatment(optName);
          }
          return;
        }

        if (!this.cardTreatmentsEditMode) {
          const chip = e.target.closest('.card-treatment-chip');
          if (chip) {
            chip.classList.toggle('selected');
            this.updateCardLivePreview();
          }
        }
      });
    }
  }

  toggleClaimSettings(forceOpen) {
    const body = document.getElementById('claim-settings-body');
    const strip = document.getElementById('claim-settings-summary-strip');
    const btn = document.getElementById('btn-toggle-claim-settings');
    const icon = document.getElementById('icon-toggle-claim-settings');
    const text = document.getElementById('text-toggle-claim-settings');

    if (!body) return;

    const isCurrentlyHidden = (body.style.display === 'none');
    const shouldOpen = (forceOpen !== undefined) ? forceOpen : isCurrentlyHidden;

    if (shouldOpen) {
      body.style.display = 'block';
      if (strip) strip.style.display = 'none';
      if (icon) icon.className = 'fa-solid fa-chevron-up';
      if (text) text.textContent = 'طي الإعدادات';
    } else {
      body.style.display = 'none';
      if (strip) strip.style.display = 'flex';
      if (icon) icon.className = 'fa-solid fa-chevron-down';
      if (text) text.textContent = 'إظهار الإعدادات';
    }
  }

  async loadCompanyPatients() {
    const compSelect = document.getElementById('claim-company-select');
    const startInput = document.getElementById('claim-start-date');
    const endInput = document.getElementById('claim-end-date');
    const defaultRateInput = document.getElementById('claim-default-session-rate');
    const defaultEvalInput = document.getElementById('claim-default-eval-fee');

    this.currentCompany = compSelect?.value || this.currentCompany || '';
    const defDates = this._getDefaultMonthDates();
    this.startDate = startInput?.value || this.startDate || defDates.start;
    this.endDate = endInput?.value || this.endDate || defDates.end;

    if (!this.currentCompany) {
      await this.app.showAlert('يرجى اختيار شركة التأمين أولاً من القائمة.', 'بيانات ناقصة', 'warning');
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

    // Show toggle button, update summary strip, and collapse form (v1.4.48)
    const btnToggle = document.getElementById('btn-toggle-claim-settings');
    if (btnToggle) btnToggle.style.display = 'inline-flex';

    const stripText = document.getElementById('claim-summary-strip-text');
    if (stripText) {
      stripText.innerHTML = `شركة: <strong style="color: var(--primary);">${escapeHTML(this.currentCompany)}</strong> • من <strong>${escapeHTML(this.startDate)}</strong> إلى <strong>${escapeHTML(this.endDate)}</strong> • سعر الجلسة: <strong>${defaultRate} ج.م</strong> • تقييم: <strong>${defaultEval} ج.م</strong>`;
    }
    this.toggleClaimSettings(false);
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
        <tr style="${!item.isChecked ? 'opacity: 0.55; background-color: var(--bg-subtle);' : ''}">
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
            <button type="button" class="btn btn-outline btn-sm btn-open-card-modal" data-patient-id="${safeId}" style="padding: 4px 10px; font-size: 0.78rem; font-weight: 700; color: var(--primary); border-color: var(--border-color); background-color: var(--bg-subtle);" title="تخصيص وطباعة بطاقة التردد">
              <i class="fa-solid fa-id-card"></i> بطاقة التردد
            </button>
          </td>
        </tr>
      `;    }).join('');

    // Render Handcrafted Mobile Claim Cards
    const mobContainer = document.getElementById('claim-patients-mobile-cards');
    if (mobContainer) {
      mobContainer.innerHTML = filtered.map((item, idx) => {
        const p = item.patient;
        const safeId = escapeHTML(p.id);
        const safeName = escapeHTML(p.name);
        const safePhone = escapeHTML(p.phone);
        const safeDoc = escapeHTML(p.doctor);
        const rowChecked = item.isChecked ? 'checked' : '';
        const rowTotal = (item.sessionCount * item.sessionRate) + item.evalFee;

        return `
          <div class="hero-styled-card claim-patient-card-item ${!item.isChecked ? 'is-unchecked' : ''}" style="padding: 14px 16px; margin-bottom: 10px; border-radius: 18px; ${!item.isChecked ? 'opacity: 0.7;' : ''}">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px;">
              <div style="display: flex; align-items: center; gap: 10px;">
                <input type="checkbox" class="claim-patient-check" data-patient-id="${safeId}" style="width: 22px; height: 22px; cursor: pointer; accent-color: var(--primary);" ${rowChecked}>
                <div>
                  <div style="font-weight: 800; font-size: 1rem; color: var(--text-main);">${safeName}</div>
                  <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 2px;"><i class="fa-solid fa-phone"></i> ${safePhone} • ${safeDoc}</div>
                </div>
              </div>
              <button type="button" class="btn btn-outline btn-sm btn-open-card-modal" data-patient-id="${safeId}" style="font-size: 0.75rem; padding: 5px 10px; border-radius: 10px; font-weight: 700; white-space: nowrap;">
                <i class="fa-solid fa-id-card"></i> بطاقة التردد
              </button>
            </div>

            <div class="hsc-divider" style="margin: 10px 0;"></div>

            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; text-align: center;">
              <div style="background: var(--bg-subtle); border-radius: 10px; padding: 6px 4px; border: 1px solid var(--border-color);">
                <div style="font-size: 0.72rem; font-weight: 700; color: var(--text-muted); margin-bottom: 2px;">فحص (ج.م)</div>
                <input type="number" class="form-control claim-patient-input" data-field="evalFee" data-patient-id="${safeId}" value="${item.evalFee}" style="width: 100%; text-align: center; font-weight: 800; font-size: 0.95rem; border: none; background: transparent; padding: 0;">
              </div>
              <div style="background: var(--bg-subtle); border-radius: 10px; padding: 6px 4px; border: 1px solid var(--border-color);">
                <div style="font-size: 0.72rem; font-weight: 700; color: var(--text-muted); margin-bottom: 2px;">الجلسات</div>
                <input type="number" class="form-control claim-patient-input" data-field="sessionCount" data-patient-id="${safeId}" value="${item.sessionCount}" style="width: 100%; text-align: center; font-weight: 800; font-size: 0.95rem; border: none; background: transparent; padding: 0;">
              </div>
              <div style="background: var(--bg-subtle); border-radius: 10px; padding: 6px 4px; border: 1px solid var(--border-color);">
                <div style="font-size: 0.72rem; font-weight: 700; color: var(--text-muted); margin-bottom: 2px;">سعر الجلسة</div>
                <input type="number" class="form-control claim-patient-input" data-field="sessionRate" data-patient-id="${safeId}" value="${item.sessionRate}" style="width: 100%; text-align: center; font-weight: 800; font-size: 0.95rem; border: none; background: transparent; padding: 0;">
              </div>
            </div>

            <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 10px; padding-top: 8px; border-top: 1px dashed var(--border-color);">
              <span style="font-size: 0.8rem; font-weight: 700; color: var(--text-muted);">إجمالي مستحقات المريض:</span>
              <span style="font-size: 1.05rem; font-weight: 800; color: var(--success);">${rowTotal.toLocaleString('en-US')} ج.م</span>
            </div>
          </div>
        `;
      }).join('');
    }

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

    this.cardTreatmentsEditMode = false;
    const editBtn = document.getElementById('btn-card-add-treatment');
    if (editBtn) {
      editBtn.className = 'btn-edit-chips';
      editBtn.innerHTML = '<i class="fa-solid fa-pen-to-square"></i> <span class="edit-text">تعديل الوسائل</span>';
    }
    this.renderCardTreatmentChips(cardData.treatments || []);
    this.app.openModal('modal-attendance-card');
  }

  updateCardTreatmentsPreview(selectedTreatments = []) {
    this.activeCardTreatments = Array.isArray(selectedTreatments) ? [...selectedTreatments] : [];
    const previewEl = document.getElementById('card-treatments-selected-preview');
    const badgeEl = document.getElementById('card-treatments-count-badge');
    if (badgeEl) badgeEl.textContent = `${this.activeCardTreatments.length} محدد`;

    if (previewEl) {
      if (this.activeCardTreatments.length === 0) {
        previewEl.innerHTML = `<span style="color: var(--text-muted); font-size: 0.88rem;">-- اضغط لاختيار وتحديد وسائل كارت التردد --</span>`;
      } else {
        previewEl.innerHTML = this.activeCardTreatments.map(t => `
          <span class="badge badge-primary" style="font-size: 0.78rem; padding: 4px 10px; margin: 2px; border-radius: 6px; font-weight: 700;">
            <i class="fa-solid fa-bolt" style="margin-left: 4px;"></i> ${escapeHTML(t)}
          </span>
        `).join('');
      }
    }

    // Populate hidden container for backward compatibility
    const hiddenContainer = document.getElementById('card-treatment-chips-container');
    if (hiddenContainer) {
      hiddenContainer.innerHTML = this.activeCardTreatments.map(t => `
        <button type="button" class="sheet-chip card-treatment-chip selected" data-val="${escapeHTML(t)}"></button>
      `).join('');
    }

    this.updateCardLivePreview();
  }

  renderCardTreatmentChips(selectedTreatments = []) {
    this.updateCardTreatmentsPreview(selectedTreatments);
  }

  toggleCardTreatmentsEditMode() {
    const user = auth.getCurrentUser();
    if (!RolesManager.canManageUsers(user)) {
      this.app.showAlert('تعديل وحذف الأزرار متاح لمدير المركز فقط.', 'صلاحية المدير');
      return;
    }

    this.cardTreatmentsEditMode = !this.cardTreatmentsEditMode;
    const isEdit = this.cardTreatmentsEditMode;

    const btn = document.getElementById('btn-card-add-treatment');
    if (btn) {
      if (isEdit) {
        btn.className = 'btn-edit-chips active';
        btn.innerHTML = '<i class="fa-solid fa-check"></i> <span class="edit-text">تم الانتهاء</span>';
      } else {
        btn.className = 'btn-edit-chips';
        btn.innerHTML = '<i class="fa-solid fa-pen-to-square"></i> <span class="edit-text">تعديل الوسائل</span>';
      }
    }

    const selected = Array.from(document.querySelectorAll('#card-treatment-chips-container .card-treatment-chip.selected'))
      .map(b => b.getAttribute('data-val'));

    this.renderCardTreatmentChips(selected);
  }

  async deleteCardTreatment(optName) {
    const user = auth.getCurrentUser();
    if (!RolesManager.canManageUsers(user)) {
      await this.app.showAlert('حذف وسائل العلاج متاح لمدير المركز فقط.', 'صلاحية المدير');
      return;
    }

    const confirmed = await this.app.showConfirm(`هل أنت متأكد من حذف وسيلة العلاج "${optName}"؟`, 'تأكيد الحذف');
    if (confirmed) {
      this.defaultTreatmentOptions = this.defaultTreatmentOptions.filter(item => item !== optName);

      if (typeof db !== 'undefined' && db.deleteClinicalOption) {
        try {
          await db.deleteClinicalOption('modality', optName);
        } catch (_) {}
      }

      const selected = Array.from(document.querySelectorAll('#card-treatment-chips-container .card-treatment-chip.selected'))
        .map(b => b.getAttribute('data-val'))
        .filter(v => v !== optName);

      this.renderCardTreatmentChips(selected);
      this.app.showToast(`تم حذف وسيلة "${optName}" بنجاح`);
    }
  }

  async promptAddNewTreatment() {
    const user = auth.getCurrentUser();
    if (!RolesManager.canManageUsers(user)) {
      await this.app.showAlert('إضافة وسائل العلاج متاح لمدير المركز فقط.', 'صلاحية المدير');
      return;
    }

    const name = await this.app.showPrompt(
      'اكتب اسم وسيلة العلاج الطبيعي الجديدة:',
      'إضافة وسيلة علاجية جديدة',
      'مثال: Shortwave Diathermy'
    );

    if (name && typeof name === 'string' && name.trim().length > 0) {
      const cleanName = name.trim();
      await db.addClinicalOption('modality', cleanName);

      const selected = Array.from(document.querySelectorAll('#card-treatment-chips-container .sheet-chip.selected'))
        .map(b => b.getAttribute('data-val'));
      selected.push(cleanName);

      this.renderCardTreatmentChips(selected);
      this.app.showToast('تمت إضافة وسيلة ' + cleanName + ' بنجاح');
    }
  }

  updateCardLivePreview() {
    const selected = Array.from(document.querySelectorAll('#card-treatment-chips-container .sheet-chip.selected'))
      .map(b => b.getAttribute('data-val'));

    const previewList = document.getElementById('card-plan-preview-list');
    if (previewList) {
      if (selected.length === 0) {
        previewList.innerHTML = '<span style="color: var(--text-muted); font-size: 0.8rem;">اضغط على الأزرار أعلاه لتحديد الخطة العلاجية...</span>';
      } else {
        previewList.innerHTML = selected.map(t => `<div style="padding: 2px 0; font-weight: 700; color: var(--text-main);">- ${escapeHTML(t)}</div>`).join('');
      }
    }
  }

  saveAttendanceCardData() {
    if (!this.activeCardPatientId) return;

    const diagnosis = document.getElementById('card-input-diagnosis')?.value.trim() || '';
    const evaluation = document.getElementById('card-input-eval')?.value.trim() || '';
    const treatments = (this.activeCardTreatments && this.activeCardTreatments.length > 0)
      ? this.activeCardTreatments
      : Array.from(document.querySelectorAll('#card-treatment-chips-container .sheet-chip.selected')).map(b => b.getAttribute('data-val'));

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
    const claimDate = document.getElementById('claim-doc-date')?.value || getLocalDateStr();

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
            <h2 style="font-size: 13pt; margin: 0; font-weight: 800; color: #0369a1;">مركز الإسكندرية التخصصي للعلاج الطبيعي (ASCPT)</h2>
            <div style="font-size: 10pt; font-weight: 700; color: var(--text-main);">د. حسني أحمد الجويلي</div>
            <div style="font-size: 8.5pt; color: #475569;">إستشاري العلاج الطبيعي والتقويم الحركي للعمود الفقري</div>
            <div style="font-size: 8pt; color: #64748b;">١٧ شارع حسين شيرين - لوران - الإسكندرية | تليفون: 03-5702356 | البريد: algewelyspinecare@yahoo.com</div>
          </div>

          <div style="text-align: center; margin: 20px 0;">
            <h1 style="font-size: 16pt; margin: 0; font-weight: 900; text-decoration: underline;">بطاقة تردد</h1>
          </div>

          <!-- Top Line: Name on the RIGHT, Company on the LEFT (No 'Referred from') -->
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; font-size: 11.5pt; font-weight: bold; border-bottom: 1.5px dashed #777; padding-bottom: 10px; direction: rtl;">
            <div style="text-align: right;">الاسم: <span style="font-size: 12.5pt; font-weight: 800; color: var(--text-main);">${escapeHTML(p.name)}</span></div>
            <div style="text-align: left;">شركة: <span style="font-weight: 800; color: var(--text-main);">${escapeHTML(companyName)}</span></div>
          </div>

          <!-- Content Block: strictly LTR, left-aligned, with bullet points underneath -->
          <div style="direction: ltr; text-align: left; line-height: 1.8; margin-bottom: 30px; font-size: 11pt;">
            <div style="margin-bottom: 20px;">
              <strong style="font-size: 12pt; display: block; color: #000; text-decoration: underline; margin-bottom: 6px;">Referred diagnosis:</strong>
              <div style="padding-left: 14px; font-weight: 700; color: var(--text-main);">• ${escapeHTML(diag)}</div>
            </div>

            <div style="margin-bottom: 20px;">
              <strong style="font-size: 12pt; display: block; color: #000; text-decoration: underline; margin-bottom: 6px;">P.T. Evaluation:</strong>
              <div style="padding-left: 14px; color: var(--text-muted);">• ${escapeHTML(evaluation)}</div>
            </div>

            <div style="margin-bottom: 20px;">
              <strong style="font-size: 12pt; display: block; color: #000; text-decoration: underline; margin-bottom: 6px;">Plan of P.T. Treatment:</strong>
              <div style="padding-left: 14px; font-weight: 700; color: var(--text-main); line-height: 1.8;">
                ${treatments.map(t => `<div style="margin-bottom: 4px;">• ${t}</div>`).join('')}
              </div>
            </div>
          </div>

          <div style="display: flex; justify-content: flex-end; margin-top: 50px; padding-left: 20px;">
            <div style="text-align: center;">
              <div style="font-size: 10.5pt; font-weight: bold;">د. حسني أحمد الجويلي</div>
              <div style="font-size: 9.5pt; margin-top: 4px; color: var(--text-muted);">إستشاري العلاج الطبيعي والتقويم الحركي للعمود الفقري</div>
              <div style="margin-top: 35px; border-bottom: 1.5px solid #000; width: 150px;"></div>
            </div>
          </div>

          <div style="margin-top: 60px; border-top: 1px solid #777; padding-top: 8px; text-align: center; font-size: 8.5pt; color: #444; line-height: 1.5;">
            <div style="font-weight: 700;">مركز الإسكندرية التخصصي للعلاج الطبيعي (ASCPT)</div>
            <div>١٧ شارع حسين شيرين - لوران - الإسكندرية | تليفون: 03-5702356 | البريد: algewelyspinecare@yahoo.com</div>
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
    const claimDate = document.getElementById('claim-doc-date')?.value || getLocalDateStr();

    const wsData = [
      ['مركز الإسكندرية التخصصي للعلاج الطبيعي (ASCPT)'],
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
  openSettleClaim(prefillClaim = null) {
    if (prefillClaim) {
      if (this.app?.financeManager?.openSettleClaimModal) {
        const periodStr = prefillClaim.startDate && prefillClaim.endDate
          ? `مطالبة من ${prefillClaim.startDate} إلى ${prefillClaim.endDate}`
          : (prefillClaim.period || `مطالبة ${prefillClaim.companyName}`);

        this.app.financeManager.openSettleClaimModal({
          company: prefillClaim.companyName,
          grossAmount: prefillClaim.totalAmount,
          period: periodStr,
          claimId: prefillClaim.id
        });
      }
      return;
    }

    if (!this.currentCompany) {
      this.app.showAlert('يرجى اختيار شركة التأمين واستخراج بيانات المطالبة أولاً.', 'تنبيه', 'warning');
      return;
    }
    const gross = this.claimPatientsData
      ? this.claimPatientsData.filter(i => i.isChecked).reduce((acc, curr) => acc + (parseFloat(curr.total) || 0), 0)
      : 0;

    const periodStr = `مطالبة من ${this.startDate || ''} إلى ${this.endDate || ''}`;
    if (this.app?.financeManager?.openSettleClaimModal) {
      this.app.financeManager.openSettleClaimModal({
        company: this.currentCompany,
        grossAmount: gross,
        period: periodStr
      });
    }
  }

  // ================= 4. Claims Ledger Management Methods =================
  async loadClaims() {
    try {
      this.claimsLedgerData = await db.getInsuranceClaims();
      this.renderClaimsLedgerTable();
    } catch (err) {
      console.error('Error loading claims ledger:', err);
    }
  }

  renderClaimsLedgerTable() {
    const tbody = document.getElementById('claims-ledger-tbody');
    const countBadge = document.getElementById('claims-ledger-count-badge');
    if (!tbody) return;

    let filtered = Array.isArray(this.claimsLedgerData) ? [...this.claimsLedgerData] : [];

    // Filter by company
    if (this.ledgerCompanyFilter && this.ledgerCompanyFilter !== 'all') {
      filtered = filtered.filter(c => c.companyName === this.ledgerCompanyFilter);
    }

    // Filter by status
    if (this.ledgerStatusFilter === 'pending') {
      filtered = filtered.filter(c => c.status === 'pending');
    } else if (this.ledgerStatusFilter === 'settled') {
      filtered = filtered.filter(c => c.status === 'settled' || c.status === 'partial');
    }

    // Filter by search query
    if (this.ledgerSearchQuery) {
      const q = this.ledgerSearchQuery;
      filtered = filtered.filter(c => 
        (c.companyName || '').toLowerCase().includes(q) ||
        (c.claimCode || '').toLowerCase().includes(q) ||
        (c.startDate || '').includes(q) ||
        (c.endDate || '').includes(q) ||
        (c.recordedBy || '').toLowerCase().includes(q)
      );
    }

    if (countBadge) {
      countBadge.textContent = `${filtered.length} مطالبة`;
    }

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 24px;">لا توجد مطالبات تأمين مسجلة مطابقة للبحث.</td></tr>`;
      return;
    }

    const currentUser = auth.getCurrentUser();
    const canDelete = RolesManager.canDelete(currentUser);

    tbody.innerHTML = filtered.map(c => {
      const safeId = escapeHTML(c.id);
      const safeCode = escapeHTML(c.claimCode || 'CLM-SYS');
      const safeCompany = escapeHTML(c.companyName);
      const safePeriod = `من ${escapeHTML(c.startDate || '')} إلى ${escapeHTML(c.endDate || '')}`;
      const safePatientsCount = escapeHTML(c.totalPatients || 0);
      const safeSessionsCount = escapeHTML(c.totalSessions || 0);
      const safeAmount = (parseFloat(c.totalAmount) || 0).toLocaleString('en-US');
      const safeDate = escapeHTML(c.claimDate || (c.createdAt ? c.createdAt.slice(0, 10) : ''));

      let statusBadge = '';
      if (c.status === 'settled') {
        statusBadge = `<span class="badge" style="background: #dcfce7; color: #15803d; border: 1px solid #bbf7d0; font-weight: 800; font-size: 0.78rem;"><i class="fa-solid fa-circle-check"></i> تم التحصيل</span>`;
      } else if (c.status === 'partial') {
        const ded = (parseFloat(c.deductions) || 0).toLocaleString('en-US');
        statusBadge = `<span class="badge" style="background: #e0e7ff; color: #3730a3; border: 1px solid #c7d2fe; font-weight: 800; font-size: 0.78rem;"><i class="fa-solid fa-hand-holding-dollar"></i> تحصيل جزئي (${ded} ج.م استقطاع)</span>`;
      } else {
        statusBadge = `<span class="badge" style="background: #fef3c7; color: #b45309; border: 1px solid #fde68a; font-weight: 800; font-size: 0.78rem;"><i class="fa-solid fa-clock"></i> قيد التحصيل</span>`;
      }

      let settledDisplay = '<span style="color: var(--text-muted); font-size: 0.85rem;">-</span>';
      if (c.status === 'settled' || c.status === 'partial') {
        const netSettled = (parseFloat(c.settledAmount) || 0).toLocaleString('en-US');
        settledDisplay = `<span style="font-weight: 800; color: var(--success); font-size: 0.92rem;">${netSettled} ج.م</span><br><small style="color: var(--text-muted); font-size: 0.74rem;">بتاريخ ${escapeHTML(c.settledDate || '')}</small>`;
      }

      return `
        <tr>
          <td style="font-weight: 800; color: var(--primary); font-family: monospace; font-size: 0.88rem;">
            ${safeCode}
            <div style="font-size: 0.74rem; font-weight: normal; color: var(--text-muted); font-family: sans-serif;">${safeDate}</div>
          </td>
          <td style="font-weight: 800; color: var(--text-main); font-size: 0.92rem;">
            <i class="fa-solid fa-building-shield" style="color: var(--primary); margin-left: 5px;"></i>
            ${safeCompany}
          </td>
          <td style="font-size: 0.84rem; font-weight: 600;">${safePeriod}</td>
          <td style="text-align: center;">
            <span class="badge badge-role-doctor" style="font-weight: 700;">${safePatientsCount} مريض</span>
            <span class="badge" style="background: var(--bg-subtle); color: var(--text-main); border: 1px solid var(--border-color); font-weight: 700;">${safeSessionsCount} جلسة</span>
          </td>
          <td style="font-weight: 800; color: var(--primary); font-size: 0.95rem;">${safeAmount} ج.م</td>
          <td style="text-align: center;">${statusBadge}</td>
          <td>${settledDisplay}</td>
          <td class="no-print" style="text-align: center;">
            <div style="display: flex; gap: 4px; justify-content: center;">
              <button type="button" class="btn btn-outline btn-sm btn-settle-ledger-claim" data-claim-id="${safeId}" title="تسجيل تحصيل المطالبة" style="color: var(--primary); border-color: var(--primary); padding: 4px 8px;">
                <i class="fa-solid fa-money-bill-transfer"></i>
              </button>
              <button type="button" class="btn btn-outline btn-sm btn-load-ledger-claim" data-claim-id="${safeId}" title="استدعاء المطالبة للشاشة للطباعة والتصدير" style="color: var(--text-main); padding: 4px 8px;">
                <i class="fa-solid fa-eye"></i>
              </button>
              ${canDelete ? `
                <button type="button" class="btn btn-outline btn-sm btn-delete-ledger-claim" data-claim-id="${safeId}" title="حذف المطالبة" style="color: var(--danger); border-color: var(--danger); padding: 4px 8px;">
                  <i class="fa-solid fa-trash"></i>
                </button>
              ` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  async saveCurrentClaim() {
    if (!this.currentCompany) {
      await this.app.showAlert('يرجى اختيار شركة التأمين واستخراج المرضى أولاً.', 'بيانات ناقصة', 'warning');
      return;
    }

    const checkedItems = this.claimPatientsData.filter(i => i.isChecked);
    if (checkedItems.length === 0) {
      await this.app.showAlert('يرجى تحديد مريض واحد على الأقل للمطالبة قبل الحفظ.', 'تنبيه', 'warning');
      return;
    }

    // Check if duplicate claim exists for same company & period
    const existing = this.claimsLedgerData.find(c => 
      c.companyName === this.currentCompany &&
      c.startDate === this.startDate &&
      c.endDate === this.endDate
    );

    let targetClaimId = null;
    let claimCode = null;

    if (existing) {
      const confirmUpdate = await this.app.showConfirm(
        `توجد مطالبة سابقة لنفس الشركة (${this.currentCompany}) عن نفس الفترة (${this.startDate} إلى ${this.endDate}). هل ترغب في تحديثها بالمطالبة الحالية؟`,
        'تحديث مطالبة قائمة'
      );
      if (!confirmUpdate) return;
      targetClaimId = existing.id;
      claimCode = existing.claimCode;
    } else {
      const now = new Date();
      const yy = String(now.getFullYear()).slice(-2);
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const seq = (this.claimsLedgerData.length + 1).toString().padStart(2, '0');
      claimCode = `CLM-${yy}${mm}-${seq}`;
    }

    const totalPatients = checkedItems.length;
    const totalSessions = checkedItems.reduce((acc, curr) => acc + (curr.attendedSessions ? curr.attendedSessions.length : 0), 0);
    const totalAmount = checkedItems.reduce((acc, curr) => acc + (parseFloat(curr.total) || 0), 0);
    const claimDate = document.getElementById('claim-doc-date')?.value || new Date().toISOString().slice(0, 10);
    const taxNumber = document.getElementById('claim-tax-number')?.value.trim() || '';
    const sessionRate = parseFloat(document.getElementById('claim-default-session-rate')?.value) || 120;
    const evalFee = parseFloat(document.getElementById('claim-default-eval-fee')?.value) || 150;

    const claimData = {
      claimCode,
      companyName: this.currentCompany,
      startDate: this.startDate,
      endDate: this.endDate,
      claimDate,
      taxNumber,
      defaultSessionRate: sessionRate,
      defaultEvalFee: evalFee,
      totalPatients,
      totalSessions,
      totalAmount,
      status: existing ? existing.status : 'pending',
      settledAmount: existing ? existing.settledAmount : 0,
      deductions: existing ? existing.deductions : 0,
      deductionReason: existing ? existing.deductionReason : '',
      settledDate: existing ? existing.settledDate : null,
      settlementId: existing ? existing.settlementId : null,
      patientsData: checkedItems.map(item => ({
        patient: {
          id: item.patient.id,
          name: item.patient.name,
          phone: item.patient.phone || '',
          insuranceMembershipNo: item.patient.insuranceMembershipNo || '',
          insuranceApprovalNo: item.patient.insuranceApprovalNo || ''
        },
        cardData: item.cardData || null,
        attendedSessions: (item.attendedSessions || []).map(s => ({
          id: s.id,
          date: s.date,
          doctor: s.doctor,
          recordedAt: s.recordedAt
        })),
        evalFee: item.evalFee,
        sessionRate: item.sessionRate,
        sessionsCost: item.sessionsCost,
        total: item.total,
        isChecked: true
      }))
    };

    if (targetClaimId) {
      claimData.id = targetClaimId;
    }

    try {
      const currentUser = auth.getCurrentUser();
      await db.saveInsuranceClaim(claimData, currentUser);
      try {
        await db.logAudit('اعتماد مطالبة تأمين', `حفظ مطالبة ${claimData.companyName} (${claimCode}) بقيمة ${totalAmount.toLocaleString('en-US')} ج.م`, currentUser);
      } catch (_) {}

      this.app.showToast(`تم حفظ واعتماد المطالبة (${claimCode}) بنجاح وإدراجها في السجل.`);
      await this.loadClaims();

      const ledgerCard = document.getElementById('claims-ledger-card');
      if (ledgerCard) {
        ledgerCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } catch (err) {
      console.error('Error saving claim:', err);
      await this.app.showAlert('تعذر حفظ المطالبة: ' + err.message, 'خطأ', 'danger');
    }
  }

  async loadClaimIntoEditor(claimId) {
    const claim = this.claimsLedgerData.find(c => c.id === claimId);
    if (!claim) return;

    this.currentCompany = claim.companyName;
    const compSelect = document.getElementById('claim-company-select');
    if (compSelect) {
      compSelect.value = claim.companyName;
      if (this.app?.updateCustomSelectDisplay) {
        this.app.updateCustomSelectDisplay('claim-company-select');
      }
    }

    this.startDate = claim.startDate;
    this.endDate = claim.endDate;
    const startEl = document.getElementById('claim-start-date');
    const endEl = document.getElementById('claim-end-date');
    const claimDateEl = document.getElementById('claim-doc-date');
    const taxEl = document.getElementById('claim-tax-number');
    const rateEl = document.getElementById('claim-default-session-rate');
    const evalEl = document.getElementById('claim-default-eval-fee');

    if (startEl) startEl.value = claim.startDate;
    if (endEl) endEl.value = claim.endDate;
    if (claimDateEl) claimDateEl.value = claim.claimDate || '';
    if (taxEl) taxEl.value = claim.taxNumber || '';
    if (rateEl) rateEl.value = claim.defaultSessionRate || 120;
    if (evalEl) evalEl.value = claim.defaultEvalFee || 150;

    if (Array.isArray(claim.patientsData) && claim.patientsData.length > 0) {
      this.claimPatientsData = claim.patientsData.map(p => ({
        ...p,
        isChecked: true
      }));
      this.renderPatientsTable();
      this.recalcGrandTotals();

      this.app.showToast(`تم استدعاء بيانات المطالبة (${claim.claimCode || ''}) للطباعة والتصدير`);
      const tableContainer = document.getElementById('claim-table-container');
      if (tableContainer) {
        tableContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } else {
      await this.loadCompanyPatients();
    }
  }

  async deleteClaim(claimId) {
    const confirmed = await this.app.showConfirm('هل أنت متأكد من حذف هذه المطالبة من السجل المعتمد؟', 'تأكيد الحذف');
    if (!confirmed) return;

    try {
      const currentUser = auth.getCurrentUser();
      await db.deleteInsuranceClaim(claimId);
      try {
        await db.logAudit('حذف مطالبة تأمين', `حذف مطالبة برقم ${claimId}`, currentUser);
      } catch (_) {}
      this.app.showToast('تم حذف المطالبة من السجل بنجاح');
      await this.loadClaims();
    } catch (err) {
      this.app.showAlert('تعذر حذف المطالبة: ' + err.message, 'خطأ', 'danger');
    }
  }

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
