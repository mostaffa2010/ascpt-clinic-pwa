import { escapeHTML, getLocalDateStr, initStackDeck, isDoctorOnDuty, getShiftLabel } from './utils.js';
import { CLINIC_CONFIG } from './clinic-config.js';
// ========================================================
// ASCPT - Daily & Monthly Financial & Statistical Reports
// ========================================================

import { db } from './db.js';
import { auth } from './auth.js';
import { RolesManager } from './roles.js';

export class FinanceManager {
  constructor(app) {
    this.app = app;
    this.reportMode = 'daily'; // 'daily' | 'monthly'
    this.currentDate = getLocalDateStr();
    this.currentMonth = this.currentDate.substring(0, 7); // YYYY-MM
    this.selectedDoctor = 'all';
  }

  async init() {
    this.bindEvents();
    
    const datePicker = document.getElementById('finance-date-picker');
    if (datePicker) datePicker.value = this.currentDate;

    const monthPicker = document.getElementById('finance-month-picker');
    if (monthPicker) monthPicker.value = this.currentMonth;

    this.populateExpenseCategoriesDropdown();
  }

  bindEvents() {
    // Daily Date Picker
    const datePicker = document.getElementById('finance-date-picker');
    if (datePicker) {
      datePicker.addEventListener('change', (e) => {
        this.currentDate = e.target.value;
        this.syncQuickDateButtons(this.currentDate);
        this.loadDailyReport();
      });
    }

    // Monthly Month Picker
    const monthPicker = document.getElementById('finance-month-picker');
    if (monthPicker) {
      monthPicker.addEventListener('click', () => {
        if (this.app?.openMonthPicker) {
          this.app.openMonthPicker('finance-month-picker');
        }
      });
      monthPicker.addEventListener('change', (e) => {
        this.currentMonth = e.target.value;
        this.loadMonthlyReport();
      });
    }

    // Doctor Filter for Daily
    const doctorFilter = document.getElementById('finance-doctor-filter');
    if (doctorFilter) {
      doctorFilter.addEventListener('change', (e) => {
        this.selectedDoctor = e.target.value;
        this.loadDailyReport();
      });
    }

    // Expense Form
    const formExpense = document.getElementById('form-expense');
    if (formExpense) {
      formExpense.addEventListener('submit', (e) => this.handleAddExpense(e));
    }

    // Mode Buttons
    document.getElementById('btn-mode-daily')?.addEventListener('click', () => this.setReportMode('daily'));
    document.getElementById('btn-mode-monthly')?.addEventListener('click', () => this.setReportMode('monthly'));
    document.getElementById('btn-mode-claims')?.addEventListener('click', () => this.setReportMode('claims'));

    // Quick Date Buttons
    document.getElementById('btn-quick-fin-today')?.addEventListener('click', () => this.setDateQuick('today'));
    document.getElementById('btn-quick-fin-yesterday')?.addEventListener('click', () => this.setDateQuick('yesterday'));

    // Add Expense Button
    document.getElementById('btn-add-expense')?.addEventListener('click', () => this.app.openAddExpenseModal());
    document.getElementById('btn-confirm-cash-handoff')?.addEventListener('click', () => this.handleConfirmCashHandoff());

    // Insurance Claim Settlements Triggers & Forms
    document.getElementById('btn-add-settlement')?.addEventListener('click', () => this.openSettleClaimModal());
    document.getElementById('btn-settle-claim-action')?.addEventListener('click', () => this.openSettleClaimModalFromClaims());

    ['settle-gross-amount', 'settle-deductions'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', () => this.updateNetSettlementDisplay());
    });

    document.getElementById('form-settle-claim')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleSubmitSettlement(e);
    });

    document.getElementById('monthly-settlements-tbody')?.addEventListener('click', (e) => {
      const delBtn = e.target.closest('.btn-delete-settlement');
      if (delBtn) {
        const sid = delBtn.getAttribute('data-settlement-id');
        if (sid) this.handleDeleteSettlement(sid);
      }
    });

    // Expense Categories Management
    document.getElementById('btn-manage-expense-categories')?.addEventListener('click', () => {
      this.openManageExpenseCategoriesModal();
    });

    document.getElementById('form-add-expense-category')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleAddExpenseCategory();
    });

    document.getElementById('manage-expense-categories-list')?.addEventListener('click', (e) => {
      const delBtn = e.target.closest('.btn-delete-exp-cat');
      if (delBtn) {
        const catName = delBtn.getAttribute('data-cat-name');
        if (catName) this.handleDeleteExpenseCategory(catName);
      }
    });

    // Export & Print Buttons are handled exclusively in export.js to prevent duplicate events

// Daily sessions table removed from finance report (already present in Sessions view)

    // Event Delegation: Daily Expenses Table
    const dailySetMob = document.getElementById('daily-settlements-mobile-cards');
    if (dailySetMob) {
      dailySetMob.addEventListener('click', async (e) => {
        const btn = e.target.closest('.btn-delete-settlement');
        if (btn) {
          const sid = btn.getAttribute('data-settlement-id');
          await this.deleteSettlement(sid);
        }
      });
    }

    const mSetMob = document.getElementById('monthly-settlements-mobile-cards');
    if (mSetMob) {
      mSetMob.addEventListener('click', async (e) => {
        const btn = e.target.closest('.btn-delete-settlement');
        if (btn) {
          const sid = btn.getAttribute('data-settlement-id');
          await this.deleteSettlement(sid);
        }
      });
    }

    const expensesTbody = document.getElementById('finance-expenses-tbody');
    if (expensesTbody) {
      expensesTbody.addEventListener('click', (e) => {
        const delBtn = e.target.closest('.btn-delete-expense');
        if (delBtn) {
          const eid = delBtn.getAttribute('data-expense-id');
          if (eid) this.deleteExpense(eid);
        }
      });
    }

    // Event Delegation: Mobile Containers
// Mobile daily sessions cards removed from finance report

    const expensesMob = document.getElementById('finance-expenses-mobile-cards');
    if (expensesMob) {
      expensesMob.addEventListener('click', (e) => {
        const delBtn = e.target.closest('.btn-delete-expense');
        if (delBtn) {
          const eid = delBtn.getAttribute('data-expense-id');
          if (eid) this.deleteExpense(eid);
        }
      });
    }

    // Event Delegation: Monthly Expenses Table (Desktop)
    const mExpTbody = document.getElementById('monthly-expenses-tbody');
    if (mExpTbody) {
      mExpTbody.addEventListener('click', (e) => {
        const delBtn = e.target.closest('.btn-delete-expense');
        if (delBtn) {
          const eid = delBtn.getAttribute('data-expense-id');
          if (eid) this.deleteExpense(eid);
        }
      });
    }

    // Event Delegation: Monthly Expenses Cards (Mobile)
    const mExpMob = document.getElementById('monthly-expenses-mobile-cards');
    if (mExpMob) {
      mExpMob.addEventListener('click', (e) => {
        const delBtn = e.target.closest('.btn-delete-expense');
        if (delBtn) {
          const eid = delBtn.getAttribute('data-expense-id');
          if (eid) this.deleteExpense(eid);
        }
      });
    }
  }

  setDateQuick(type) {
    if (type === 'today') {
      this.currentDate = getLocalDateStr();
    } else if (type === 'yesterday') {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      this.currentDate = getLocalDateStr(d);
    }
    const datePicker = document.getElementById('finance-date-picker');
    if (datePicker) datePicker.value = this.currentDate;

    this.syncQuickDateButtons(this.currentDate);
    this.loadDailyReport();
  }

  syncQuickDateButtons(dateStr) {
    const btnToday = document.getElementById('btn-quick-fin-today');
    const btnYest = document.getElementById('btn-quick-fin-yesterday');
    const today = getLocalDateStr();
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

  openAddExpenseModal() {
    this.app.openAddExpenseModal();
  }

  populateExpenseCategoriesDropdown() {
    const select = document.getElementById('exp-category-select');
    if (!select) return;

    const categories = db.getClinicalOptions('expense_categories') || [];
    const prevVal = select.value;

    select.innerHTML = categories.map(cat => 
      `<option value="${escapeHTML(cat)}" ${cat === prevVal ? 'selected' : ''}>${escapeHTML(cat)}</option>`
    ).join('');

    if (this.app?.updateCustomSelectDisplay) {
      this.app.updateCustomSelectDisplay('exp-category-select');
    }
  }

  openManageExpenseCategoriesModal() {
    this.renderManageCategoriesList();
    this.app.openModal('modal-manage-expense-categories');
    const input = document.getElementById('input-new-expense-category');
    if (input) {
      input.value = '';
      setTimeout(() => input.focus(), 250);
    }
  }

  renderManageCategoriesList() {
    const container = document.getElementById('manage-expense-categories-list');
    if (!container) return;

    const categories = db.getClinicalOptions('expense_categories') || [];
    if (categories.length === 0) {
      container.innerHTML = `<div class="manage-categories-empty-hint">لا توجد بنود مصروفات حالياً. أضف بنداً جديداً بالأعلى.</div>`;
      return;
    }

    container.innerHTML = categories.map(cat => `
      <div class="custom-picker-row manage-category-item-row">
        <div class="manage-category-name-group">
          <i class="fa-solid fa-tag text-primary"></i>
          <span>${escapeHTML(cat)}</span>
        </div>
        <button type="button" class="btn btn-outline btn-sm btn-delete-exp-cat" data-cat-name="${escapeHTML(cat)}" title="حذف هذا البند من القائمة">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </div>
    `).join('');
  }

  async handleAddExpenseCategory() {
    const input = document.getElementById('input-new-expense-category');
    const newName = input?.value.trim();
    if (!newName) return;

    try {
      await db.addClinicalOption('expense_categories', newName);
      input.value = '';
      this.renderManageCategoriesList();
      this.populateExpenseCategoriesDropdown();
      const select = document.getElementById('exp-category-select');
      if (select) {
        select.value = newName;
        this.app?.updateCustomSelectDisplay('exp-category-select');
      }
      this.app.showToast(`تمت إضافة بند (${newName}) للقائمة بنجاح`);
    } catch (err) {
      this.app.showAlert('تعذر إضافة البند: ' + err.message, 'خطأ', 'danger');
    }
  }

  async handleDeleteExpenseCategory(catName) {
    const confirmed = await this.app.showConfirm(`هل تريد بالتأكيد حذف بند (${catName}) من قائمة المصروفات؟`, 'تأكيد الحذف');
    if (!confirmed) return;

    try {
      await db.deleteClinicalOption('expense_categories', catName);
      this.renderManageCategoriesList();
      this.populateExpenseCategoriesDropdown();
      this.app.showToast(`تم حذف بند (${catName}) من القائمة`);
    } catch (err) {
      this.app.showAlert('تعذر حذف البند: ' + err.message, 'خطأ', 'danger');
    }
  }

  // ================= Insurance Claim Settlements Handlers =================
  openSettleClaimModal(prefill = {}) {
    this.currentSettlingClaimId = prefill.claimId || null;
    const allCompanies = (typeof db.getAllInsuranceCompaniesWithTypes === 'function')
      ? db.getAllInsuranceCompaniesWithTypes()
      : db.getInsuranceCompaniesList();

    const compSelect = document.getElementById('settle-company-select');
    if (compSelect) {
      compSelect.innerHTML = allCompanies.map(c => 
        `<option value="${escapeHTML(c.name)}" ${c.name === prefill.company ? 'selected' : ''}>${escapeHTML(c.name)}</option>`
      ).join('');
      if (this.app?.updateCustomSelectDisplay) {
        this.app.updateCustomSelectDisplay('settle-company-select');
      }
    }

    const periodInput = document.getElementById('settle-claim-period');
    if (periodInput) {
      periodInput.value = prefill.period || '';
      periodInput.placeholder = 'مثال: مطالبة شهر 09-2026 أو أغسطس 2026';
    }

    const dateInput = document.getElementById('settle-date');
    if (dateInput) {
      dateInput.value = this.currentDate || getLocalDateStr();
    }

    const grossInput = document.getElementById('settle-gross-amount');
    if (grossInput) {
      grossInput.value = prefill.grossAmount ? prefill.grossAmount : '';
    }

    const dedInput = document.getElementById('settle-deductions');
    if (dedInput) dedInput.value = '';

    const refInput = document.getElementById('settle-ref-number');
    if (refInput) refInput.value = '';

    const notesInput = document.getElementById('settle-notes');
    if (notesInput) notesInput.value = '';

    const reasonSelect = document.getElementById('settle-deduction-reason');
    if (reasonSelect) {
      reasonSelect.value = 'لا توجد خصومات';
      if (this.app?.updateCustomSelectDisplay) {
        this.app.updateCustomSelectDisplay('settle-deduction-reason');
      }
    }

    const bankRadio = document.querySelector('input[name="settle-pay-method"][value="bank"]');
    if (bankRadio) bankRadio.checked = true;

    this.updateNetSettlementDisplay();
    this.app.openModal('modal-settle-claim');
  }

  openSettleClaimModalFromClaims() {
    const claimsMgr = this.app?.claimsManager;
    const company = claimsMgr?.currentCompany || '';
    const grossAmount = claimsMgr?.totalClaimAmount || 0;
    const period = (claimsMgr?.startDate && claimsMgr?.endDate) 
      ? `فترة ${claimsMgr.startDate} إلى ${claimsMgr.endDate}`
      : '';
    this.openSettleClaimModal({ company, grossAmount, period });
  }

  updateNetSettlementDisplay() {
    const gross = parseFloat(document.getElementById('settle-gross-amount')?.value) || 0;
    const ded = parseFloat(document.getElementById('settle-deductions')?.value) || 0;
    const net = Math.max(0, gross - ded);
    const disp = document.getElementById('settle-net-display');
    if (disp) {
      disp.textContent = `${net.toLocaleString('en-US')} ج.م`;
    }
  }

  async handleSubmitSettlement(_e) {
    const compSelect = document.getElementById('settle-company-select');
    const company = compSelect?.value?.trim();
    const period = document.getElementById('settle-claim-period')?.value?.trim();
    const date = document.getElementById('settle-date')?.value?.trim() || getLocalDateStr();
    const payMethodRadio = document.querySelector('input[name="settle-pay-method"]:checked');
    const paymentMethod = payMethodRadio?.value || 'bank';

    const gross = parseFloat(document.getElementById('settle-gross-amount')?.value) || 0;
    const deductions = parseFloat(document.getElementById('settle-deductions')?.value) || 0;
    const reason = document.getElementById('settle-deduction-reason')?.value || 'لا توجد خصومات';
    const refNum = document.getElementById('settle-ref-number')?.value?.trim() || '';
    const notes = document.getElementById('settle-notes')?.value?.trim() || '';

    if (!company) {
      await this.app.showAlert('يرجى اختيار شركة التأمين المحصل منها.', 'بيانات ناقصة', 'warning');
      return;
    }
    if (!period) {
      await this.app.showAlert('يرجى كتابة شهر أو فترة المطالبة.', 'بيانات ناقصة', 'warning');
      return;
    }
    if (gross <= 0) {
      await this.app.showAlert('يرجى إدخال مبلغ صحيح للمطالبة أكبر من صفر.', 'مبلغ غير صحيح', 'warning');
      return;
    }

    const netAmount = Math.max(0, gross - deductions);
    const currentUser = auth.getCurrentUser();

    const settlementData = {
      companyName: company,
      claimPeriod: period,
      settlementDate: date,
      paymentMethod,
      grossAmount: gross,
      deductions,
      deductionReason: deductions > 0 ? reason : 'تحصيل كامل',
      netAmount,
      referenceNumber: refNum,
      notes,
      recordedBy: currentUser?.name || 'مدير المركز',
      recordedByUid: currentUser?.uid || ''
    };

    try {
      const savedSettlement = await db.saveInsuranceSettlement(settlementData, currentUser);

      // Update linked claim if this settlement was initiated from a claim
      try {
        const linkedClaimId = this.currentSettlingClaimId;
        if (linkedClaimId) {
          await db.updateInsuranceClaim(linkedClaimId, {
            status: deductions > 0 ? 'partial' : 'settled',
            settledAmount: netAmount,
            deductions: deductions,
            deductionReason: deductions > 0 ? reason : 'تحصيل كامل',
            settledDate: date,
            settlementId: savedSettlement.id
          });
        } else {
          // Check if there is an exact pending claim for this company matching this period
          const allClaims = await db.getInsuranceClaims(company);
          const match = allClaims.find(c => c.status === 'pending' && (
            (c.startDate && period.includes(c.startDate)) ||
            (c.endDate && period.includes(c.endDate)) ||
            (c.claimCode && period.includes(c.claimCode)) ||
            (Math.abs((parseFloat(c.totalAmount) || 0) - gross) < 1)
          ));
          if (match) {
            await db.updateInsuranceClaim(match.id, {
              status: deductions > 0 ? 'partial' : 'settled',
              settledAmount: netAmount,
              deductions: deductions,
              deductionReason: deductions > 0 ? reason : 'تحصيل كامل',
              settledDate: date,
              settlementId: savedSettlement.id
            });
          }
        }
      } catch (claimErr) {
        console.warn('Update claim status notice:', claimErr);
      }
      this.currentSettlingClaimId = null;

      try {
        await db.logAudit(
          'تحصيل مطالبة تأمين',
          `تحصيل مطالبة ${company} صافي: ${netAmount} ج.م (${paymentMethod === 'cash' ? 'نقدي بالدرج' : 'تحويل بنكي/شيك'})`,
          currentUser
        );
      } catch (_) {}

      this.app.closeModal('modal-settle-claim');
      this.app.showToast(`تم تسجيل تحصيل مطالبة (${company}) بمبلغ صافي ${netAmount.toLocaleString('en-US')} ج.م`);
      await this.loadReport();
      if (this.app.claimsManager && typeof this.app.claimsManager.loadClaims === 'function') {
        await this.app.claimsManager.loadClaims();
      }
      this.app.refreshAll();
    } catch (err) {
      this.app.showAlert('تعذر تسجيل التحصيل: ' + err.message, 'خطأ', 'danger');
    }
  }

  async handleDeleteSettlement(id) {
    const confirmed = await this.app.showConfirm('هل أنت متأكد من حذف حركة تحصيل التأمين هذه؟', 'تأكيد الحذف');
    if (!confirmed) return;

    try {
      const currentUser = auth.getCurrentUser();
      await db.deleteInsuranceSettlement(id);

      // Revert any claim linked to this settlement
      try {
        const allClaims = await db.getInsuranceClaims();
        const linked = allClaims.find(c => c.settlementId === id);
        if (linked) {
          await db.updateInsuranceClaim(linked.id, {
            status: 'pending',
            settledAmount: 0,
            deductions: 0,
            deductionReason: '',
            settledDate: null,
            settlementId: null
          });
        }
      } catch (_) {}

      try { await db.logAudit('حذف تحصيل تأمين', `حذف حركة تحصيل تأمين برقم ${id}`, currentUser); } catch (_) {}
      this.app.showToast('تم حذف حركة التحصيل بنجاح');
      await this.loadReport();
      if (this.app.claimsManager && typeof this.app.claimsManager.loadClaims === 'function') {
        await this.app.claimsManager.loadClaims();
      }
      this.app.refreshAll();
    } catch (err) {
      this.app.showAlert('تعذر حذف الحركة: ' + err.message, 'خطأ', 'danger');
    }
  }

  async handleAddExpense(e) {
    e.preventDefault();
    const categorySelect = document.getElementById('exp-category-select');
    const notesInput = document.getElementById('exp-notes');
    const amountInput = document.getElementById('exp-amount');

    const category = categorySelect?.value?.trim();
    const notes = notesInput?.value?.trim() || '';
    const amountStr = amountInput?.value?.trim();
    const amount = parseFloat(amountStr);

    if (!category) {
      await this.app.showAlert('يرجى اختيار بند المصروف من القائمة.', 'بيانات مطلوبة', 'warning');
      return;
    }

    if (isNaN(amount) || amount <= 0) {
      await this.app.showAlert('يرجى إدخال مبلغ صحيح للمصروف أكبر من صفر.', 'مبلغ غير صحيح', 'warning');
      amountInput?.focus();
      return;
    }

    const fullTitle = notes ? `${category} (${notes})` : category;
    const currentUser = auth.getCurrentUser();
    const todayStr = getLocalDateStr();
    const expenseData = {
      title: fullTitle,
      category,
      notes,
      amount,
      date: this.currentDate || todayStr,
      recordedBy: currentUser?.name || 'مدير المركز'
    };

    await db.saveExpense(expenseData, currentUser);
    try { await db.logAudit('تسجيل مصروف', `تسجيل مصروف: ${fullTitle} بمبلغ ${amount} ج.م`, currentUser); } catch (_) {}

    this.app.closeModal('modal-expense');
    this.app.showToast('تم تسجيل وحفظ المصروف بنجاح');
    document.getElementById('form-expense')?.reset();
    if (this.app?.updateCustomSelectDisplay) {
      this.app.updateCustomSelectDisplay('exp-category-select');
    }
    await this.loadReport();
    this.app.refreshAll();
  }

  async deleteExpense(expenseId) {
    const currentUser = auth.getCurrentUser();
    if (!RolesManager.canDeleteFinance(currentUser)) {
      this.app.showAlert('عذراً، صلاحية حذف المصروفات مقصورة على مدير المركز فقط.', 'تنبيه الصلاحيات', 'warning');
      return;
    }
    const confirmed = await this.app.showConfirm('هل أنت متأكد من حذف هذا المصروف نهائياً؟ سيتم خصمه وتحديث إجماليات الحسابات والخزينة فوراً.', 'تأكيد حذف المصروف');
    if (confirmed) {
      await db.deleteExpense(expenseId);
      try { await db.logAudit('حذف مصروف', `حذف مصروف برقم ${expenseId}`, currentUser); } catch (_) {}
      this.app.showToast('تم حذف المصروف بنجاح وتحديث الحسابات');
      await this.loadReport();
      this.app.refreshAll();
    }
  }

  setReportMode(mode) {
    this.reportMode = mode;
    
    const btnDaily = document.getElementById('btn-mode-daily');
    const btnMonthly = document.getElementById('btn-mode-monthly');
    const btnClaims = document.getElementById('btn-mode-claims');
    const filterDaily = document.getElementById('filter-group-daily');
    const filterMonthly = document.getElementById('filter-group-monthly');
    const contentDaily = document.getElementById('finance-daily-content');
    const contentMonthly = document.getElementById('finance-monthly-content');
    const contentClaims = document.getElementById('finance-claims-content');
    const labelPatients = document.getElementById('rep-total-patients-label');
    const drawerCard = document.getElementById('card-cash-drawer-glance');

    if (mode === 'daily') {
      if (btnDaily) btnDaily.className = 'btn btn-primary btn-sm';
      if (btnMonthly) btnMonthly.className = 'btn btn-outline btn-sm';
      if (btnClaims) btnClaims.className = 'btn btn-outline btn-sm';

      if (filterDaily) filterDaily.style.display = 'flex';
      if (filterMonthly) filterMonthly.style.display = 'none';
      const topActions = document.getElementById('finance-top-actions');
      const filterCard = document.getElementById('finance-filter-bar-card');
      const kpiCards = document.getElementById('finance-kpi-stats-grid');
      if (topActions) topActions.style.display = 'flex';
      if (filterCard) filterCard.style.display = 'block';
      if (kpiCards) kpiCards.style.display = 'grid';
      if (contentDaily) contentDaily.style.display = 'block';
      if (contentMonthly) contentMonthly.style.display = 'none';
      if (contentClaims) contentClaims.style.display = 'none';
      if (drawerCard) drawerCard.style.display = 'block';

      if (labelPatients) labelPatients.textContent = 'إجمالي مرضى اليوم';
      const title = document.getElementById('finance-header-title');
      const sub = document.getElementById('finance-header-sub');
      if (title) title.innerHTML = '<i class="fa-solid fa-calculator text-primary"></i> الحسابات والتقرير اليومي';
      if (sub) sub.style.display = 'none';
      const viewFinance = document.getElementById('view-finance');
      if (viewFinance) {
        viewFinance.classList.toggle('mode-monthly', mode === 'monthly');
        viewFinance.classList.toggle('mode-daily', mode === 'daily');
        viewFinance.classList.toggle('mode-claims', mode === 'claims');
      }
      document.body.classList.toggle('finance-monthly-mode', mode === 'monthly');
      document.body.classList.toggle('finance-daily-mode', mode === 'daily');
      document.body.classList.toggle('finance-claims-mode', mode === 'claims');
      this.loadDailyReport();
    } else if (mode === 'monthly') {
      if (btnDaily) btnDaily.className = 'btn btn-outline btn-sm';
      if (btnMonthly) btnMonthly.className = 'btn btn-primary btn-sm';
      if (btnClaims) btnClaims.className = 'btn btn-outline btn-sm';

      if (filterDaily) filterDaily.style.display = 'none';
      if (filterMonthly) filterMonthly.style.display = 'flex';
      if (contentDaily) contentDaily.style.display = 'none';
      if (contentMonthly) contentMonthly.style.display = 'block';
      if (contentClaims) contentClaims.style.display = 'none';
      if (drawerCard) drawerCard.style.display = 'none';

      if (labelPatients) labelPatients.textContent = 'إجمالي مرضى الشهر';
      const title = document.getElementById('finance-header-title');
      const sub = document.getElementById('finance-header-sub');
      if (title) title.innerHTML = '<i class="fa-solid fa-chart-pie text-primary"></i> التقرير الشهري الشامل';
      if (sub) sub.style.display = 'none';
      const viewFinance = document.getElementById('view-finance');
      if (viewFinance) {
        viewFinance.classList.toggle('mode-monthly', mode === 'monthly');
        viewFinance.classList.toggle('mode-daily', mode === 'daily');
        viewFinance.classList.toggle('mode-claims', mode === 'claims');
      }
      document.body.classList.toggle('finance-monthly-mode', mode === 'monthly');
      document.body.classList.toggle('finance-daily-mode', mode === 'daily');
      document.body.classList.toggle('finance-claims-mode', mode === 'claims');
      this.loadMonthlyReport();
    } else if (mode === 'claims') {
      if (btnDaily) btnDaily.className = 'btn btn-outline btn-sm';
      if (btnMonthly) btnMonthly.className = 'btn btn-outline btn-sm';
      if (btnClaims) btnClaims.className = 'btn btn-primary btn-sm';

      if (filterDaily) filterDaily.style.display = 'none';
      if (filterMonthly) filterMonthly.style.display = 'none';
      if (contentDaily) contentDaily.style.display = 'none';
      if (contentMonthly) contentMonthly.style.display = 'none';
      if (contentClaims) contentClaims.style.display = 'block';
      if (drawerCard) drawerCard.style.display = 'none';

      // Hide top actions, filter bar card, and 4 KPI cards when in claims mode
      const topActions = document.getElementById('finance-top-actions');
      const filterCard = document.getElementById('finance-filter-bar-card');
      const kpiCards = document.getElementById('finance-kpi-stats-grid');
      if (topActions) topActions.style.display = 'none';
      if (filterCard) filterCard.style.display = 'none';
      if (kpiCards) kpiCards.style.display = 'none';

      const title = document.getElementById('finance-header-title');
      const sub = document.getElementById('finance-header-sub');
      if (title) title.innerHTML = '<i class="fa-solid fa-file-invoice-dollar text-primary"></i> مطالبات شركات التأمين وبطاقات التردد';
      if (sub) sub.style.display = 'none';

      // Mode switched to claims cleanly without premature alert
      setTimeout(() => {
        if (this.app.claimsManager) {
          this.app.claimsManager.setupScrollSync();
          if (typeof this.app.claimsManager.loadClaims === 'function') {
            this.app.claimsManager.loadClaims();
          }
        }
      }, 100);
    }
  }

  async loadReport() {
    if (this.reportMode === 'daily') {
      await this.loadDailyReport();
    } else {
      await this.loadMonthlyReport();
    }
  }

  async updateDashboardStats() {
    await this.loadDailyReport();
  }

  // ================= 1. DAILY REPORT =================
  async loadDailyReport() {
    const allSessions = await db.getSessions(this.currentDate);
    const allExpenses = await db.getExpenses(this.currentDate);
    const doctorObjects = await db.getDoctorsList();

    // Exclude Clinic Director from treating doctors breakdown
    const directorName = CLINIC_CONFIG.director?.name ? CLINIC_CONFIG.director.name.trim().replace(/\s+/g, ' ') : '';
    const treatingDoctors = doctorObjects.filter(d => d.role === 'doctor' && d.name !== directorName);

    // Active daily doctors for today's shift:
    // A doctor appears in today's daily sheet if:
    // 1. Today is their assigned shift (e.g. Sat/Mon/Wed vs Sun/Tue/Thu), OR
    // 2. They actually conducted sessions on this date (exchange/coverage)
    const activeDailyDoctorObjects = treatingDoctors.filter(d => {
      const hasSessionsToday = allSessions.some(s => s.doctor === d.name || s.doctorUid === d.uid);
      const onDuty = isDoctorOnDuty(d.shift, this.currentDate);
      return onDuty || hasSessionsToday;
    });

    // Fallback: If no doctors matched, use unique doctors with sessions or all treating doctors
    const doctors = (activeDailyDoctorObjects.length > 0
      ? activeDailyDoctorObjects.map(d => d.name)
      : Array.from(new Set(allSessions.map(s => s.doctor).filter(Boolean))))
      .filter(d => d !== directorName);

    let filteredSessions = allSessions;
    if (this.selectedDoctor !== 'all') {
      filteredSessions = allSessions.filter(s => s.doctor === this.selectedDoctor);
    }

    const todaySettlements = await db.getInsuranceSettlements(this.currentDate, null);
    const totalPatients = filteredSessions.length;
    const totalSessionsCash = filteredSessions.reduce((acc, curr) => acc + (parseFloat(curr.amountPaid) || 0), 0);
    const cashSettlements = todaySettlements.filter(s => s.paymentMethod === 'cash').reduce((acc, s) => acc + (parseFloat(s.netAmount) || 0), 0);
    const bankSettlements = todaySettlements.filter(s => s.paymentMethod !== 'cash').reduce((acc, s) => acc + (parseFloat(s.netAmount) || 0), 0);
    const totalDrawerCash = totalSessionsCash + cashSettlements;
    const totalExpenses = allExpenses.reduce((acc, curr) => acc + (parseFloat(curr.amount) || 0), 0);
    const netCash = totalDrawerCash - totalExpenses;

    const docCounts = {};
    allSessions.forEach(s => { docCounts[s.doctor] = (docCounts[s.doctor] || 0) + 1; });

    // Update KPI UI
    document.getElementById('rep-total-patients').textContent = totalPatients;
    document.getElementById('rep-total-cash').textContent = `${totalDrawerCash.toLocaleString('en-US')} ج.م`;
    document.getElementById('rep-total-expenses').textContent = `${totalExpenses.toLocaleString('en-US')} ج.م`;

    // Render Today Insurance Settlements
    const dailySetCard = document.getElementById('finance-daily-settlements-card');
    const dailySetBadge = document.getElementById('daily-settlements-total-badge');

    if (dailySetCard) {
      if (todaySettlements.length > 0) {
        dailySetCard.style.display = 'block';
        const totalNet = todaySettlements.reduce((acc, s) => acc + (parseFloat(s.netAmount) || 0), 0);
        if (dailySetBadge) {
          dailySetBadge.textContent = `صافي: ${totalNet.toLocaleString('en-US')} ج.م ${bankSettlements > 0 ? `(بنكي: ${bankSettlements.toLocaleString('en-US')})` : ''}`;
        }
        const canDel = RolesManager.canDeleteFinance(auth.getCurrentUser());

        const dailySetMob = document.getElementById('daily-settlements-mobile-cards');
        if (dailySetMob) {
          dailySetMob.innerHTML = todaySettlements.map(s => {
            const safeComp = escapeHTML(s.companyName);
            const safePeriod = escapeHTML(s.claimPeriod || '-');
            const gross = (parseFloat(s.grossAmount) || 0).toLocaleString('en-US');
            const ded = parseFloat(s.deductions) || 0;
            const net = (parseFloat(s.netAmount) || 0).toLocaleString('en-US');
            const isCash = s.paymentMethod === 'cash';
            const payBadge = isCash
              ? `<span class="badge badge-cash"><i class="fa-solid fa-money-bill-wave"></i> نقداً بالدرج</span>`
              : `<span class="badge badge-direct"><i class="fa-solid fa-building-columns"></i> تحويل بنكي</span>`;

            return `
              <div class="hero-styled-card fin-settlement-card">
                <div class="hsc-top">
                  <div class="hsc-patient-meta">
                    <div class="hsc-avatar fin-settlement-avatar">
                      <i class="fa-solid fa-file-invoice-dollar"></i>
                    </div>
                    <div class="hsc-name-box">
                      <span class="hsc-patient-name">${safeComp}</span>
                      <span class="hsc-doc-sub"><i class="fa-regular fa-calendar"></i> ${safePeriod}</span>
                    </div>
                  </div>
                  <div class="hsc-amount-box">
                    <span class="hsc-amount-val fin-settlement-amount-val">${net} <small>ج.م</small></span>
                  </div>
                </div>

                <div class="hsc-badges-row">
                  ${payBadge}
                  ${ded > 0 ? `<span class="badge badge-danger"><i class="fa-solid fa-tag"></i> خصم: ${ded.toLocaleString('en-US')} ج.م</span>` : ''}
                </div>

                <div class="hsc-divider"></div>

                <div class="fin-settlement-meta-row">
                  <div>الأصلي: <strong>${gross} ج.م</strong> • المسجل: ${escapeHTML(s.recordedBy || '-')}</div>
                  ${canDel ? `
                    <button type="button" class="btn btn-outline btn-sm btn-delete-record btn-delete-settlement" data-settlement-id="${s.id}">
                      <i class="fa-solid fa-trash"></i> حذف
                    </button>
                  ` : ''}
                </div>
              </div>
            `;
          }).join('');
        }
      } else {
        dailySetCard.style.display = 'none';
      }
    }
    
    const netCashEl = document.getElementById('rep-net-cash');
    if (netCashEl) {
      netCashEl.textContent = `${netCash.toLocaleString('en-US')} ج.م`;
      netCashEl.style.color = netCash >= 0 ? 'var(--success)' : 'var(--danger)';
    }

    // Cash Safe Drawer Glance Card Update
    const drawerCashEl = document.getElementById('drawer-net-cash-display');
    const drawerBreakdownEl = document.getElementById('drawer-calc-breakdown');
    if (drawerCashEl) {
      drawerCashEl.textContent = `${netCash.toLocaleString('en-US')} ج.م`;
      drawerCashEl.style.color = netCash >= 0 ? 'var(--success)' : 'var(--danger)';
    }
    if (drawerBreakdownEl) {
      drawerBreakdownEl.textContent = `المقبوضات النقدية (${totalDrawerCash.toLocaleString('en-US')} ج.م) - المصروفات (${totalExpenses.toLocaleString('en-US')} ج.م)`;
    // Check & Render Cash Handoff Status
    try {
      const handoff = await db.getCashHandoff(this.currentDate);
      const statusEl = document.getElementById('drawer-handoff-status');
      const btnHandoff = document.getElementById('btn-confirm-cash-handoff');
      if (statusEl) {
        if (handoff) {
          const displayNet = handoff.netCash || netCash;
          const displayBy = escapeHTML(handoff.handedBy || 'الاستقبال');
          statusEl.innerHTML = '<span class="badge badge-success badge-drawer-status"><i class="fa-solid fa-circle-check"></i><span>تم تسليم العهدة: ' + displayNet + ' ج.م بواسطة ' + displayBy + ' (' + handoff.time + ')</span></span>';
          if (btnHandoff) {
            btnHandoff.innerHTML = '<i class="fa-solid fa-check-double"></i> <span>تم التسليم (تحديث)</span>';
          }
        } else {
          statusEl.innerHTML = '<span class="drawer-status-open-text"><i class="fa-regular fa-clock"></i><span>لم يتم تسليم نقدية اليوم بعد</span></span>';
          if (btnHandoff) {
            btnHandoff.innerHTML = '<i class="fa-solid fa-hand-holding-dollar"></i> <span>تأكيد تسليم النقدية</span>';
          }
        }
      }
    } catch (_) {}
    }

    // Dynamic Doctor Filter
    const docFilter = document.getElementById('finance-doctor-filter');
    if (docFilter) {
      const currentVal = docFilter.value;
      docFilter.innerHTML = '<option value="all">كل الأطباء</option>' + 
        doctors.map(d => `<option value="${escapeHTML(d)}">${escapeHTML(d)}</option>`).join('');
      if (doctors.includes(currentVal) || currentVal === 'all') {
        docFilter.value = currentVal;
      }
    }

    // Doctors Breakdown Cards (Desktop Flex)
    const docContainer = document.getElementById('doctors-breakdown-container');
    if (docContainer) {
      if (doctors.length === 0) {
        docContainer.innerHTML = `<div class="fin-doc-list-empty">لا توجد جلسات أو أطباء مسجلين لهذا اليوم.</div>`;
      } else {
        docContainer.innerHTML = doctors.map(doc => {
          const docObj = treatingDoctors.find(d => d.name === doc);
          const shiftText = docObj?.shift ? getShiftLabel(docObj.shift) : '';
          const docSessions = allSessions.filter(s => s.doctor === doc || (docObj && s.doctorUid === docObj.uid));
          const patientCount = docSessions.length;
          const creditedSessions = docSessions.reduce((acc, s) => {
            if (s.entryType === 'examination') return acc + 1;
            return acc + (s.bodyPartsCount || 1);
          }, 0);

          let generalCount = 0;
          let specialCount = 0;
          docSessions.forEach(s => {
            if (s.entryType === 'examination') return;
            const count = s.bodyPartsCount || 1;
            const pType = (s.sessionPricingType || s.programType || '').toLowerCase().trim();
            const isSpec = Boolean(
              s.isSpecial ||
              s.sessionPricingType === 'special' ||
              pType === 'scoliosis' ||
              pType === 'hemiplegia' ||
              pType === 'quadriplegia' ||
              pType === 'special'
            );
            if (isSpec) specialCount += count;
            else generalCount += count;
          });

          return `
            <div class="fin-doc-breakdown-card">
              <i class="fa-solid fa-user-doctor fin-doc-breakdown-icon"></i>
              <div>
                <div class="fin-doc-breakdown-title">${escapeHTML(doc)} ${shiftText ? `<span class="fin-doc-shift-sub">(${escapeHTML(shiftText)})</span>` : ''}</div>
                <div class="fin-doc-breakdown-sub">${patientCount} مريض - ${creditedSessions} جلسة (${generalCount} عام • ${specialCount} خاص)</div>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    // Doctors Breakdown Stack Deck (Mobile)
    const dailyDocDeck = document.getElementById('daily-doctors-mobile-deck');
    if (dailyDocDeck) {
      if (doctors.length === 0) {
        dailyDocDeck.innerHTML = `<div class="fin-doc-deck-empty">لا توجد بيانات أطباء مسجلة لهذا اليوم.</div>`;
      } else {
        dailyDocDeck.style.display = 'block';
        dailyDocDeck.style.display = 'block';
        const cardsHTML = doctors.map((doc, index) => {
          const docObj = treatingDoctors.find(d => d.name === doc);
          const docSessions = allSessions.filter(s => s.doctor === doc || (docObj && s.doctorUid === docObj.uid));
          const patientCount = docSessions.length;
          const creditedSessions = docSessions.reduce((acc, s) => {
            if (s.entryType === 'examination') return acc + 1;
            return acc + (s.bodyPartsCount || 1);
          }, 0);

          let generalCount = 0;
          let specialCount = 0;
          let examCount = 0;

          docSessions.forEach(s => {
            if (s.entryType === 'examination') {
              examCount++;
              return;
            }
            const count = s.bodyPartsCount || 1;
            const pType = (s.sessionPricingType || s.programType || '').toLowerCase().trim();
            const isSpec = Boolean(
              s.isSpecial ||
              s.sessionPricingType === 'special' ||
              pType === 'scoliosis' ||
              pType === 'hemiplegia' ||
              pType === 'quadriplegia' ||
              pType === 'special'
            );
            if (isSpec) specialCount += count;
            else generalCount += count;
          });

          const cleanDoc = (escapeHTML(doc)).replace(/^د\.\s*/, '');
          const totalDailyPatients = allSessions.length;
          const pct = totalDailyPatients > 0 ? ((patientCount / totalDailyPatients) * 100).toFixed(1) : 0;

          return `
            <div class="hero-styled-card doc-stack-card ${index === 0 ? 'is-active-card' : 'is-peeking-card'}" data-stack-index="${index}">
              <div class="doc-stack-top-row">
                <div class="doc-stack-doc-info">
                  <div class="hsc-avatar doc-stack-avatar">
                    <i class="fa-solid fa-user-doctor"></i>
                  </div>
                  <div>
                    <div class="doc-stack-doc-name">د. ${cleanDoc}</div>
                    <div class="doc-stack-doc-sub">إحصائية اليوم</div>
                  </div>
                </div>
                <span class="badge badge-primary doc-stack-badge-pill">
                  ${patientCount} مريض
                </span>
              </div>
              <div class="hsc-divider"></div>
              <div class="doc-stack-stats-grid">
                <div class="doc-stack-stat-box">
                  <div class="doc-stack-stat-label">الجلسات المحتسبة</div>
                  <div class="doc-stack-stat-val">${creditedSessions} جلسة</div>
                </div>
                <div class="doc-stack-stat-box">
                  <div class="doc-stack-stat-label">نوع الجلسات</div>
                  <div class="doc-stack-types-val">
                    <span class="text-primary">عام: ${generalCount}</span> • <span class="text-warning">خاص: ${specialCount}</span>${examCount > 0 ? ` • <span class="text-muted">كشف: ${examCount}</span>` : ''}
                  </div>
                </div>
              </div>
              <div class="doc-stack-progress-track">
                <div class="doc-stack-progress-bar" style="width: ${pct}%;"></div>
              </div>
            </div>
          `;
        }).join('');

        const dotsHTML = doctors.map((_, i) => `<span class="doc-dot ${i === 0 ? 'active' : ''}" data-dot-index="${i}"></span>`).join('');

        dailyDocDeck.innerHTML = `
          <div class="doc-stack-wrapper">
            <div class="doc-stack-header-bar">
              <span class="doc-stack-header-title">
                <i class="fa-solid fa-user-doctor text-primary ms-1"></i> ${doctors.length} أطباء بالمركز
              </span>
              <div class="doc-stack-header-actions">
                ${doctors.length > 1 ? `
                  <span id="daily-doc-stack-counter" class="doc-stack-counter">1 من ${doctors.length}</span>
                  <button type="button" class="btn btn-outline btn-sm btn-doc-stack-toggle" id="btn-toggle-daily-doc-stack" title="تبديل بين التراكم والقائمة">
                    <i class="fa-solid fa-list" id="icon-daily-doc-stack-toggle"></i>
                  </button>
                ` : ''}
              </div>
            </div>
            <div class="doc-stack-container" id="daily-doc-stack-container">
              ${cardsHTML}
            </div>
            ${doctors.length > 1 ? `
              <div class="doc-stack-nav-bar" id="daily-doc-stack-nav-bar">
                <button type="button" class="doc-stack-nav-btn" id="btn-daily-doc-stack-prev">
                  <i class="fa-solid fa-chevron-right"></i> السابق
                </button>
                <div class="doc-stack-dots" id="daily-doc-stack-dots">
                  ${dotsHTML}
                </div>
                <button type="button" class="doc-stack-nav-btn" id="btn-daily-doc-stack-next">
                  التالي <i class="fa-solid fa-chevron-left"></i>
                </button>
              </div>
            ` : ''}
          </div>
        `;

        this.initStackDeck('daily-doc-stack');
      }
    }

    // Render Daily Sessions & Examinations Table for Print Sheet (Single-Row Merged per Patient)
    const reportTbody = document.getElementById('finance-report-tbody');
    if (reportTbody) {
      if (allSessions.length === 0) {
        reportTbody.innerHTML = '<tr><td colspan="7" class="daily-sessions-empty-cell">لا توجد جلسات أو كشوفات مسجلة لهذا اليوم.</td></tr>';
      } else {
        // Group sessions and examinations by patient to merge if patient had both on the same day
        const patientSessionsMap = new Map();
        allSessions.forEach(s => {
          if (s.status === 'cancelled') return;
          const key = s.patientId ? ('id_' + String(s.patientId).trim()) : ('name_' + (s.patientName || '').trim());
          if (!patientSessionsMap.has(key)) {
            patientSessionsMap.set(key, []);
          }
          patientSessionsMap.get(key).push(s);
        });

        // Sort patients chronologically by arrival time (earliest arrival first)
        const sortedPatientEntries = Array.from(patientSessionsMap.values()).sort((itemsA, itemsB) => {
          const timeA = itemsA.reduce((min, s) => {
            const t = s.createdAt || s.recordedAt || s.time || '';
            return (!min || (t && t < min)) ? t : min;
          }, '');
          const timeB = itemsB.reduce((min, s) => {
            const t = s.createdAt || s.recordedAt || s.time || '';
            return (!min || (t && t < min)) ? t : min;
          }, '');
          return timeA.localeCompare(timeB);
        });

        const rowsHTML = [];
        let rowIdx = 1;

        sortedPatientEntries.forEach((items) => {
          const first = items[0];
          const patientName = first.patientName || 'مريض';

          // Doctors
          const docNames = Array.from(new Set(items.map(s => s.doctor).filter(Boolean)));
          const doctorText = docNames.join(' • ') || 'طبيب المركز';

          // Body parts treated
          const partsSet = new Set();
          items.forEach(s => {
            if (Array.isArray(s.bodyParts)) {
              s.bodyParts.forEach(p => { if (p) partsSet.add(p.trim()); });
            } else if (typeof s.bodyParts === 'string' && s.bodyParts.trim()) {
              s.bodyParts.split(/[,،]/).forEach(p => { if (p.trim()) partsSet.add(p.trim()); });
            } else if (s.affectedArea) {
              s.affectedArea.split(/[,،]/).forEach(p => { if (p.trim()) partsSet.add(p.trim()); });
            }
          });

          // Action Type: session, examination, or merged "جلسة وكشف"
          const hasExam = items.some(s => s.entryType === 'examination');
          const hasSession = items.some(s => s.entryType === 'session' || !s.entryType);
          let actionType = 'جلسة';
          if (hasSession && hasExam) {
            actionType = 'جلسة وكشف';
          } else if (hasExam) {
            actionType = 'كشف';
          } else if (items.length > 1) {
            actionType = 'جلسة (' + items.length + ')';
          } else {
            actionType = 'جلسة';
          }

          const treatedBodyParts = partsSet.size > 0
            ? Array.from(partsSet).join('، ')
            : (hasExam && !hasSession ? 'فحص سريري' : 'عام');

          // Insurance Company (company name or "-" for cash)
          const isInsurance = items.some(s => s.payType === 'insurance' || s.contractType === 'direct' || s.contractType === 'indirect');
          let companyName = '-';
          if (isInsurance) {
            const matchedItem = items.find(s => s.insuranceName);
            companyName = (matchedItem && matchedItem.insuranceName) ? matchedItem.insuranceName : 'تأمين';
          }

          // Total Amount Paid (numeric only without "ج.م")
          const totalPaid = items.reduce((acc, curr) => acc + (parseFloat(curr.amountPaid) || 0), 0);
          const amountDisplay = totalPaid === 0 ? '0' : totalPaid.toLocaleString('en-US');

          rowsHTML.push(
            '<tr>' +
              '<td class="col-session-idx">' + (rowIdx++) + '</td>' +
              '<td class="col-session-patient">' + escapeHTML(patientName) + '</td>' +
              '<td class="col-session-treated">' + escapeHTML(treatedBodyParts) + '</td>' +
              '<td class="col-session-doctor">' + escapeHTML(doctorText) + '</td>' +
              '<td class="col-session-company">' + escapeHTML(companyName) + '</td>' +
              '<td class="col-session-action">' + escapeHTML(actionType) + '</td>' +
              '<td class="col-session-amount">' + amountDisplay + '</td>' +
            '</tr>'
          );
        });

        reportTbody.innerHTML = rowsHTML.join('');
      }
    }

    // Daily Expenses Table (Desktop)
    const expCard = document.getElementById('card-finance-daily-expenses');
    if (expCard) {
      expCard.classList.toggle('empty-expenses-print', allExpenses.length === 0);
    }
    const expTbody = document.getElementById('finance-expenses-tbody');
    if (expTbody) {
      if (allExpenses.length === 0) {
        expTbody.innerHTML = `
          <tr>
            <td colspan="4" class="expenses-table-empty-cell">
              <i class="fa-solid fa-receipt expenses-empty-icon"></i>
              <div class="expenses-empty-title">لا توجد مصروفات مسجلة لهذا اليوم</div>
              <div class="expenses-empty-subtitle">جميع بنود الصرف والخزينة اليومية مستقرة</div>
            </td>
          </tr>
        `;
      } else {
        expTbody.innerHTML = allExpenses.map(e => `
          <tr>
            <td class="col-expense-title">${escapeHTML(e.title)}</td>
            <td class="col-expense-amount">${escapeHTML(e.amount)}</td>
            <td class="col-expense-meta">${escapeHTML(e.recordedBy)}</td>
            <td class="col-expense-meta">${e.time}</td>
            <td class="no-print">
              ${RolesManager.canDeleteFinance(auth.getCurrentUser()) ? `
                <button type="button" class="btn btn-outline btn-sm btn-delete-record btn-delete-expense" data-expense-id="${e.id}" title="حذف">
                  <i class="fa-solid fa-trash"></i>
                </button>
              ` : '-'}
            </td>
          </tr>
        `).join('');
      }
    }

    // Daily Expenses Mobile Cards (Compact List)
    const expensesMob = document.getElementById('finance-expenses-mobile-cards');
    if (expensesMob) {
      if (allExpenses.length === 0) {
        expensesMob.innerHTML = `
          <div class="expenses-mobile-empty-card">
            <i class="fa-solid fa-receipt expenses-empty-icon"></i>
            <div class="expenses-empty-title">لا توجد مصروفات مسجلة لهذا اليوم</div>
            <div class="expenses-empty-hint">يمكنك تسجيل مصروف جديد بالضغط على زر "تسجيل مصروف" بالأعلى</div>
          </div>
        `;
      } else {
        const canDel = RolesManager.canDeleteFinance(auth.getCurrentUser());
        const hasMoreExp = allExpenses.length > 5;
        expensesMob.innerHTML = `
          <div class="expenses-compact-list">
            <div class="expenses-header-summary">
              <span><i class="fa-solid fa-receipt"></i> ${allExpenses.length} مصروفات</span>
              <span class="expenses-total-amount">${totalExpenses.toLocaleString('en-US')} ج.م</span>
            </div>
            <div class="expenses-scroll-wrapper">
              ${allExpenses.map((e, idx) => `
                <div class="expense-row-item ${idx >= 5 ? 'expense-item-collapsed d-none' : ''}">
                  <div class="expense-row-right">
                    <div class="expense-avatar-icon">
                      <i class="fa-solid fa-receipt"></i>
                    </div>
                    <div class="expense-text-meta">
                      <div class="expense-title-text">${escapeHTML(e.title)}</div>
                      <div class="expense-sub-text">
                        <span><i class="fa-regular fa-clock"></i> ${escapeHTML(e.time || '')}</span>
                        <span>•</span>
                        <span><i class="fa-regular fa-user"></i> ${escapeHTML(e.recordedBy || 'المسؤول')}</span>
                      </div>
                    </div>
                  </div>
                  <div class="expense-row-left">
                    <div class="expense-amount-badge">
                      -${(parseFloat(e.amount) || 0).toLocaleString('en-US')} <small>ج.م</small>
                    </div>
                    ${canDel ? `
                      <button type="button" class="btn-delete-expense-compact btn-delete-expense" data-expense-id="${e.id}" title="حذف المصروف">
                        <i class="fa-solid fa-trash"></i>
                      </button>
                    ` : ''}
                  </div>
                </div>
              `).join('')}
            </div>
            ${hasMoreExp ? `
              <button type="button" class="btn-toggle-expenses-more" data-expanded="false">
                <span>عرض باقي المصروفات (${allExpenses.length - 5}+)</span>
                <i class="fa-solid fa-chevron-down"></i>
              </button>
            ` : ''}
          </div>
        `;

        if (hasMoreExp) {
          expensesMob.querySelector('.btn-toggle-expenses-more')?.addEventListener('click', (ev) => {
            const btn = ev.currentTarget;
            const isExp = btn.getAttribute('data-expanded') === 'true';
            const hiddenRows = expensesMob.querySelectorAll('.expense-item-collapsed');
            if (isExp) {
              hiddenRows.forEach(r => r.classList.add('d-none'));
              btn.setAttribute('data-expanded', 'false');
              btn.innerHTML = `<span>عرض باقي المصروفات (${allExpenses.length - 5}+)</span> <i class="fa-solid fa-chevron-down"></i>`;
            } else {
              hiddenRows.forEach(r => r.classList.remove('d-none'));
              btn.setAttribute('data-expanded', 'true');
              btn.innerHTML = `<span>عرض أقل</span> <i class="fa-solid fa-chevron-up"></i>`;
            }
          });
        }
      }
    }

    // Dashboard Stats update
    const dashPatients = document.getElementById('stat-patients-today');
    const dashCash = document.getElementById('stat-cash-today');
    const dashInsurance = document.getElementById('stat-insurance-count');
    const dashExpenses = document.getElementById('stat-expenses-today');

    if (dashPatients) dashPatients.textContent = allSessions.length;
    if (dashCash) dashCash.textContent = `${totalDrawerCash.toLocaleString('en-US')} ج.م`;
    if (dashInsurance) dashInsurance.textContent = `${allSessions.filter(s => s.payType === 'insurance').length} حالات`;
    if (dashExpenses) dashExpenses.textContent = `${totalExpenses.toLocaleString('en-US')} ج.م`;

    const dashMobileCards = document.getElementById('dashboard-recent-mobile-cards');
    if (dashMobileCards) {
      // Sort newest recorded sessions first
      const sortedSessions = [...allSessions].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      const recent = sortedSessions.slice(0, 5);
      if (recent.length === 0) {
        dashMobileCards.innerHTML = `<div class="empty-state-card"><i class="fa-regular fa-calendar-xmark"></i> لا توجد جلسات مسجلة اليوم.</div>`;
      } else {
        dashMobileCards.innerHTML = recent.map(s => {
          const safePatient = escapeHTML(s.patientName);
          const safeDoc = escapeHTML(s.doctor);
          const safeIns = escapeHTML(s.insuranceName || 'تأمين');
          const safeAmount = escapeHTML(s.amountPaid);
          const safeRecAt = escapeHTML(s.recordedAt || '');
          const isExam = (s.entryType === 'examination');
          const safeCount = isExam
            ? '<span class="badge badge-exam-entry"><i class="fa-solid fa-stethoscope"></i> كشف</span>'
            : `${escapeHTML(s.bodyPartsCount || 1)} أعضاء`;

          const payBadge = s.payType === 'cash' 
            ? '<span class="badge badge-cash"><i class="fa-solid fa-money-bill"></i> نقدي</span>' 
            : (s.contractType === 'direct' 
              ? `<span class="badge badge-direct"><i class="fa-solid fa-file-contract"></i> ${safeIns}</span>` 
              : `<span class="badge badge-indirect"><i class="fa-solid fa-handshake"></i> ${safeIns}</span>`);

          return `
            <div class="hero-styled-card">
              <div class="hsc-top">
                <div class="hsc-patient-meta">
                  <div class="hsc-avatar"><i class="fa-solid fa-user-injured"></i></div>
                  <div class="hsc-name-box">
                    <span class="hsc-patient-name">${safePatient}</span>
                    <span class="hsc-doc-sub"><i class="fa-solid fa-user-doctor"></i> ${safeDoc}</span>
                  </div>
                </div>
                <div class="hsc-amount-box">
                  <span class="hsc-amount-val">${safeAmount} <small>ج.م</small></span>
                </div>
              </div>
              <div class="hsc-badges-row">
                ${payBadge}
              </div>
              <div class="hsc-divider"></div>
              <div class="hsc-bottom">
                <div class="hsc-tags">
                  <span class="hsc-tag-pill"><i class="fa-solid fa-bone"></i> ${safeCount}</span>
                  <span class="hsc-time-tag"><i class="fa-regular fa-clock"></i> ${safeRecAt}</span>
                </div>

              </div>
            </div>
          `;
        }).join('');
      }
    }
  }

  // ================= 2. MONTHLY REPORT =================
  renderMonthlySkeleton() {
    const docTbody = document.getElementById('monthly-doctors-tbody');
    const docMob = document.getElementById('monthly-doctors-mobile-cards');
    const summaryTbody = document.getElementById('monthly-financial-summary-tbody');
    const profitDisplay = document.getElementById('monthly-net-profit-display');

    if (profitDisplay) {
      profitDisplay.innerHTML = '<span class="skeleton-shimmer skeleton-line skeleton-profit-shimmer"></span>';
    }

    if (docTbody) {
      docTbody.innerHTML = Array.from({ length: 4 }).map(() => `
        <tr>
          <td class="skeleton-cell-pad"><div class="skeleton-shimmer skeleton-line sk-w-70 sk-h-14"></div></td>
          <td class="skeleton-cell-pad"><div class="skeleton-shimmer skeleton-line sk-w-50 sk-h-14 sk-mx-auto"></div></td>
          <td class="skeleton-cell-pad"><div class="skeleton-shimmer skeleton-line sk-w-50 sk-h-14 sk-mx-auto"></div></td>
          <td class="skeleton-cell-pad"><div class="skeleton-shimmer skeleton-line sk-w-60 sk-h-14 sk-mx-auto"></div></td>
          <td class="skeleton-cell-pad"><div class="skeleton-shimmer skeleton-line sk-w-40 sk-h-14 sk-mx-auto"></div></td>
        </tr>
      `).join('');
    }

    if (docMob) {
      docMob.innerHTML = Array.from({ length: 3 }).map(() => `
        <div class="hero-styled-card skeleton-card sk-cockpit-card mb-3">
          <div class="sk-doc-mob-top">
            <div class="skeleton-shimmer skeleton-line sk-w-130 sk-h-16"></div>
            <div class="skeleton-shimmer skeleton-badge sk-w-badge"></div>
          </div>
          <div class="sk-doc-mob-row">
            <div class="skeleton-shimmer skeleton-line sk-w-45 sk-h-12"></div>
            <div class="skeleton-shimmer skeleton-line sk-w-45 sk-h-12"></div>
          </div>
          <div class="skeleton-shimmer skeleton-line sk-w-100 sk-h-8"></div>
        </div>
      `).join('');
    }

    const summaryMob = document.getElementById('monthly-financial-summary-mobile');
    if (summaryTbody) {
      summaryTbody.innerHTML = Array.from({ length: 3 }).map(() => `
        <tr>
          <td class="skeleton-cell-pad"><div class="skeleton-shimmer skeleton-line sk-w-20 sk-h-14 sk-mx-auto"></div></td>
          <td class="skeleton-cell-pad"><div class="skeleton-shimmer skeleton-line sk-w-65 sk-h-14"></div></td>
          <td class="skeleton-cell-pad"><div class="skeleton-shimmer skeleton-line sk-w-50 sk-h-14 sk-mx-auto"></div></td>
          <td class="skeleton-cell-pad"><div class="skeleton-shimmer skeleton-line sk-w-40 sk-h-14 sk-mx-auto"></div></td>
          <td class="skeleton-cell-pad"><div class="skeleton-shimmer skeleton-line sk-w-30 sk-h-14 sk-mx-auto"></div></td>
        </tr>
      `).join('');
    }

    if (summaryMob) {
      summaryMob.innerHTML = `
        <div class="sk-summary-grid">
          <div class="hero-styled-card skeleton-card sk-cockpit-card sk-h-85"><div class="skeleton-shimmer skeleton-line sk-w-80 sk-h-20 sk-mx-auto"></div></div>
          <div class="hero-styled-card skeleton-card sk-cockpit-card sk-h-85"><div class="skeleton-shimmer skeleton-line sk-w-80 sk-h-20 sk-mx-auto"></div></div>
        </div>
        <div class="hero-styled-card skeleton-card sk-cockpit-card sk-h-110"><div class="skeleton-shimmer skeleton-line sk-w-90 sk-h-30 sk-mx-auto"></div></div>
      `;
    }
  }

  async loadMonthlyReport() {
    this.renderMonthlySkeleton();
    const rawSessions = await db.getSessions(this.currentMonth);
    // Exclude home visits strictly from monthly clinic report as requested
    const allSessions = (rawSessions || []).filter(s =>
      s.status !== 'cancelled' &&
      !s.isHomeVisit &&
      s.visitType !== 'home'
    );
    const allExpenses = await db.getExpenses(this.currentMonth);
    const rawDoctors = await db.getDoctors();
    const doctors = Array.from(new Set(rawDoctors.map(d => (d || '').trim().replace(/\s+/g, ' ')))).filter(Boolean);
    const docList = (typeof db.getDoctorsList === 'function') ? await db.getDoctorsList(false) : [];
    const allPatients = (typeof db.getPatients === 'function') ? await db.getPatients() : [];
    const patientMap = new Map();
    allPatients.forEach(p => {
      if (p.id) patientMap.set(p.id, p);
      if (p.name) patientMap.set(p.name.trim(), p);
    });

    const monthSettlements = await db.getInsuranceSettlements(null, this.currentMonth);
    const totalPatients = allSessions.length;
    const _totalClinicSessions = allSessions.reduce((acc, s) => {
      if (s.entryType === 'examination') return acc + 1;
      return acc + (s.bodyPartsCount || 1);
    }, 0);
    const totalSessionsIncome = allSessions.reduce((acc, curr) => acc + (parseFloat(curr.amountPaid) || 0), 0);
    const totalSettlementsNet = monthSettlements.reduce((acc, s) => acc + (parseFloat(s.netAmount) || 0), 0);
    const totalSettlementsDeductions = monthSettlements.reduce((acc, s) => acc + (parseFloat(s.deductions) || 0), 0);
    // Calculate Doctor Performance & Salaries upfront so it is available for tables, expenses & summary
    let totalAllDoctorsSalaries = 0;
    const doctorStats = doctors.map(doc => {
      const docObj = docList.find(d =>
        (d.name && d.name.trim() === doc.trim()) ||
        (d.name && (d.name.includes(doc) || doc.includes(d.name)))
      );

      const docSessions = allSessions.filter(s =>
        (s.doctor === doc || (s.doctor && s.doctor.trim() === doc.trim())) ||
        (docObj && s.doctorUid === docObj.uid)
      );

      const sessionsCount = docSessions.filter(s => s.entryType !== 'examination').reduce((acc, s) => acc + (s.bodyPartsCount || 1), 0);
      const examsCount = docSessions.filter(s => s.entryType === 'examination').length;

      const cashPatientIds = new Set(docSessions.filter(s => s.payType === 'cash').map(s => s.patientId || s.patientName));
      const insPatientIds = new Set(docSessions.filter(s => s.payType !== 'cash').map(s => s.patientId || s.patientName));
      const cashPatients = cashPatientIds.size;
      const insPatients = insPatientIds.size;

      let regCount = 0;
      let scolCount = 0;
      let hemiCount = 0;
      let quadCount = 0;
      let specCount = 0;

      docSessions.forEach(s => {
        if (s.entryType === 'examination') return;
        const count = s.bodyPartsCount || 1;

        const patient = patientMap.get(s.patientId) || patientMap.get((s.patientName || '').trim());
        let pType = (s.sessionPricingType || s.programType || '').toLowerCase().trim();

        // Fallback to patient's assigned program if session didn't explicitly store specialized program
        if (!pType || pType === 'regular') {
          if (patient) {
            const pProg = (patient.programType || patient.clinicalSheet?.programType || '').toLowerCase().trim();
            if (pProg && pProg !== 'regular') {
              pType = pProg;
            }
          }
        }

        // Fallback to diagnosis / affectedArea / notes
        if (!pType || pType === 'regular') {
          const diag = ((patient?.clinicalSheet?.diagnosis || '') + ' ' + (patient?.affectedArea || '') + ' ' + (s.notes || '')).toLowerCase();
          if (diag.includes('scoliosis') || diag.includes('اعوجاج') || diag.includes('جنف')) {
            pType = 'scoliosis';
          } else if (diag.includes('hemiplegia') || diag.includes('شلل نصفي') || diag.includes('جلطة')) {
            pType = 'hemiplegia';
          } else if (diag.includes('quadriplegia') || diag.includes('pediatric') || diag.includes('شلل رباعي') || diag.includes('أطفال') || diag.includes('ضمور')) {
            pType = 'quadriplegia';
          }
        }

        if (pType === 'pediatric') pType = 'quadriplegia';

        if (pType === 'scoliosis') scolCount += count;
        else if (pType === 'hemiplegia') hemiCount += count;
        else if (pType === 'quadriplegia') quadCount += count;
        else if (pType === 'special' || pType === 'custom_special') specCount += count;
        else regCount += count;
      });

      const regRate = (docObj && typeof docObj.regularSessionRate === 'number') ? docObj.regularSessionRate : 0;
      const scolRate = (docObj && typeof docObj.scoliosisRate === 'number') ? docObj.scoliosisRate : 0;
      const hemiRate = (docObj && typeof docObj.hemiplegiaRate === 'number') ? docObj.hemiplegiaRate : 0;
      const quadRate = (docObj && typeof docObj.quadriplegiaRate === 'number') ? docObj.quadriplegiaRate : ((docObj && typeof docObj.pediatricRate === 'number') ? docObj.pediatricRate : 0);
      const specRate = (docObj && typeof docObj.specialSessionRate === 'number') ? docObj.specialSessionRate : 0;

      const totalSalary = (regCount * regRate) +
                          (scolCount * scolRate) +
                          (hemiCount * hemiRate) +
                          (quadCount * quadRate) +
                          (specCount * specRate);

      totalAllDoctorsSalaries += totalSalary;

      return {
        doc,
        docObj,
        sessionsCount,
        examsCount,
        cashPatients,
        insPatients,
        regCount,
        scolCount,
        hemiCount,
        quadCount,
        specCount,
        totalSalary
      };
    });

    const totalIncome = totalSessionsIncome + totalSettlementsNet;
    const recordedExpenses = allExpenses.reduce((acc, curr) => acc + (parseFloat(curr.amount) || 0), 0);
    const totalExpenses = recordedExpenses + totalAllDoctorsSalaries;
    const netProfit = totalIncome - totalExpenses;

    // Update KPI UI
    const repPatients = document.getElementById('rep-total-patients');
    if (repPatients) repPatients.textContent = totalPatients;
    const repCash = document.getElementById('rep-total-cash');
    if (repCash) repCash.textContent = `${totalIncome.toLocaleString('en-US')} ج.م`;
    const repExp = document.getElementById('rep-total-expenses');
    if (repExp) repExp.textContent = `${totalExpenses.toLocaleString('en-US')} ج.م`;
    
    const netCashEl = document.getElementById('rep-net-cash');
    if (netCashEl) {
      netCashEl.textContent = `${netProfit.toLocaleString('en-US')} ج.م`;
      netCashEl.style.color = netProfit >= 0 ? 'var(--success)' : 'var(--danger)';
    }

    // Update Monthly Operating Profit Glance Cockpit (v1.4.48)
    const marginPct = totalIncome > 0 ? ((netProfit / totalIncome) * 100).toFixed(1) : 0;
    const mProfitEl = document.getElementById('monthly-net-profit-display');
    const mCalcEl = document.getElementById('monthly-calc-breakdown');
    const mMarginPct = document.getElementById('monthly-margin-pct');
    const mCashVal = document.getElementById('monthly-cash-income-val');
    const mSetVal = document.getElementById('monthly-settlements-income-val');
    const mExpVal = document.getElementById('monthly-total-expenses-val');
    const mPill = document.getElementById('monthly-margin-status-pill');

    if (mProfitEl) {
      mProfitEl.textContent = `${netProfit.toLocaleString('en-US')} ج.م`;
      mProfitEl.style.color = netProfit >= 0 ? 'var(--success)' : 'var(--danger)';
    }
    if (mCalcEl) {
      mCalcEl.textContent = `المقبوضات والتحصيلات (${totalIncome.toLocaleString('en-US')} ج.م) − المصروفات (${totalExpenses.toLocaleString('en-US')} ج.م)`;
    }
    if (mMarginPct) {
      mMarginPct.textContent = `هامش التشغيل: ${marginPct}%`;
    }
    if (mPill) {
      if (netProfit >= 0) {
        mPill.style.background = 'rgba(16, 185, 129, 0.12)';
        mPill.style.color = 'var(--success)';
        mPill.style.borderColor = 'rgba(16, 185, 129, 0.25)';
      } else {
        mPill.style.background = 'rgba(239, 68, 68, 0.12)';
        mPill.style.color = 'var(--danger)';
        mPill.style.borderColor = 'rgba(239, 68, 68, 0.25)';
      }
    }
    if (mCashVal) mCashVal.textContent = `${totalSessionsIncome.toLocaleString('en-US')} ج.م`;
    if (mSetVal) mSetVal.textContent = `${totalSettlementsNet.toLocaleString('en-US')} ج.م`;
    if (mExpVal) mExpVal.textContent = `${totalExpenses.toLocaleString('en-US')} ج.م`;

    // Render Monthly Settlements Table
    const mSetTbody = document.getElementById('monthly-settlements-tbody');
    const mSetBadge = document.getElementById('monthly-settlements-total-badge');
    const mSetCard = document.getElementById('card-monthly-settlements');
    if (mSetCard) {
      if (monthSettlements.length === 0) {
        mSetCard.style.display = 'none';
        mSetCard.classList.add('no-print');
      } else {
        mSetCard.style.display = 'block';
        mSetCard.classList.remove('no-print');
      }
    }
    if (mSetBadge) {
      mSetBadge.textContent = `صافي: ${totalSettlementsNet.toLocaleString('en-US')} ج.م ${totalSettlementsDeductions > 0 ? `(استقطاعات: ${totalSettlementsDeductions.toLocaleString('en-US')} ج.م)` : ''}`;
    }

    const mSetMob = document.getElementById('monthly-settlements-mobile-cards');
    if (mSetTbody) {
      if (monthSettlements.length === 0) {
        mSetTbody.innerHTML = `<tr><td colspan="9" class="expenses-table-empty-cell">لا توجد تحصيلات مطالبات مسجلة لهذا الشهر حتى الآن.</td></tr>`;
        if (mSetMob) mSetMob.innerHTML = `<div class="expenses-compact-empty">لا توجد تحصيلات مطالبات مسجلة لهذا الشهر حتى الآن.</div>`;
      } else {
        const canDel = RolesManager.canDeleteFinance(auth.getCurrentUser());
        mSetTbody.innerHTML = monthSettlements.map(s => `
          <tr>
            <td class="col-center-bold">${escapeHTML(s.settlementDate || '-')}</td>
            <td class="col-session-patient">${escapeHTML(s.companyName)}</td>
            <td class="col-center-meta">${escapeHTML(s.claimPeriod || '-')}</td>
            <td class="col-center-bold">${(parseFloat(s.grossAmount) || 0).toLocaleString('en-US')} ج.م</td>
            <td class="col-center-meta">
              ${(parseFloat(s.deductions) || 0) > 0 ? `${(parseFloat(s.deductions) || 0).toLocaleString('en-US')} ج.م (${escapeHTML(s.deductionReason || '')})` : '-'}
            </td>
            <td class="col-center-bold">${(parseFloat(s.netAmount) || 0).toLocaleString('en-US')} ج.م</td>
            <td class="text-center">
              <span class="badge ${s.paymentMethod === 'cash' ? 'badge-cash' : 'badge-direct'}">
                <i class="fa-solid ${s.paymentMethod === 'cash' ? 'fa-money-bill-wave' : 'fa-building-columns'}"></i>
                ${s.paymentMethod === 'cash' ? 'نقداً بالدرج' : 'تحويل بنكي / شيك'}
              </span>
            </td>
            <td class="no-print col-expense-meta text-center">${escapeHTML(s.recordedBy || '-')}</td>
            <td class="no-print text-center">
              ${canDel ? `
                <button type="button" class="btn btn-outline btn-sm btn-delete-record btn-delete-settlement" data-settlement-id="${s.id}" title="حذف حركة التحصيل">
                  <i class="fa-solid fa-trash"></i>
                </button>
              ` : '-'}
            </td>
          </tr>
        `).join('');

        if (mSetMob) {
          mSetMob.innerHTML = monthSettlements.map(s => {
            const safeComp = escapeHTML(s.companyName);
            const safePeriod = escapeHTML(s.claimPeriod || '-');
            const gross = (parseFloat(s.grossAmount) || 0).toLocaleString('en-US');
            const ded = parseFloat(s.deductions) || 0;
            const net = (parseFloat(s.netAmount) || 0).toLocaleString('en-US');
            const isCash = s.paymentMethod === 'cash';
            const payBadge = isCash
              ? `<span class="badge badge-cash"><i class="fa-solid fa-money-bill-wave"></i> نقداً بالدرج</span>`
              : `<span class="badge badge-direct"><i class="fa-solid fa-building-columns"></i> تحويل بنكي</span>`;

            return `
              <div class="hero-styled-card fin-settlement-card">
                <div class="hsc-top">
                  <div class="hsc-patient-meta">
                    <div class="hsc-avatar fin-settlement-avatar">
                      <i class="fa-solid fa-receipt"></i>
                    </div>
                    <div class="hsc-name-box">
                      <span class="hsc-patient-name">${safeComp}</span>
                      <span class="hsc-doc-sub"><i class="fa-solid fa-calendar-day"></i> ${escapeHTML(s.settlementDate || '')} • ${safePeriod}</span>
                    </div>
                  </div>
                  <div class="hsc-amount-box">
                    <span class="hsc-amount-val fin-settlement-amount-val">${net} <small>ج.م</small></span>
                  </div>
                </div>

                <div class="hsc-badges-row">
                  ${payBadge}
                  ${ded > 0 ? `<span class="badge badge-danger"><i class="fa-solid fa-tag"></i> خصم: ${ded.toLocaleString('en-US')} ج.م</span>` : ''}
                </div>

                <div class="hsc-divider"></div>

                <div class="fin-settlement-meta-row">
                  <div>الأصلي: <strong>${gross} ج.م</strong> • المسجل: ${escapeHTML(s.recordedBy || '-')}</div>
                  ${canDel ? `
                    <button type="button" class="btn btn-outline btn-sm btn-delete-record btn-delete-settlement" data-settlement-id="${s.id}">
                      <i class="fa-solid fa-trash"></i> حذف
                    </button>
                  ` : ''}
                </div>
              </div>
            `;
          }).join('');
        }
      }
    }

    // A. Doctors Breakdown Table (Monthly)
    const docTbody = document.getElementById('monthly-doctors-tbody');
    const docMob = document.getElementById('monthly-doctors-mobile-cards');

    if (docTbody) {
      if (doctors.length === 0 || totalPatients === 0) {
        docTbody.innerHTML = '<tr><td colspan="5" class="expenses-table-empty-cell">لا توجد بيانات جلسات مسجلة لهذا الشهر.</td></tr>';
      } else {
        const rowsHTML = doctorStats.map(stat => {
          const safeDoc = escapeHTML(stat.doc);
          return `
            <tr>
              <td class="col-session-doctor"><i class="fa-solid fa-user-doctor text-primary ms-1"></i> ${safeDoc}</td>
              <td class="col-center-bold dir-ltr">${stat.examsCount} / ${stat.sessionsCount}</td>
              <td class="col-center-bold dir-ltr">${stat.insPatients} / ${stat.cashPatients}</td>
              <td class="col-center-bold dir-ltr">${stat.quadCount} / ${stat.hemiCount} / ${stat.scolCount} / ${stat.regCount + stat.specCount}</td>
              <td class="col-center-bold text-success">${stat.totalSalary.toLocaleString('en-US')}</td>
            </tr>
          `;
        }).join('');

        const totalRowHTML = `
          <tr class="total-row fin-doc-total-row">
            <td colspan="4" class="fin-doc-total-label">مجموع رواتب الاطباء</td>
            <td class="fin-doc-total-val text-success">${totalAllDoctorsSalaries.toLocaleString('en-US')}</td>
          </tr>
        `;

        docTbody.innerHTML = rowsHTML + totalRowHTML;
      }
    }

    if (docMob) {
      if (doctors.length === 0 || totalPatients === 0) {
        docMob.innerHTML = `
          <div class="expenses-mobile-empty-card">
            <i class="fa-solid fa-user-doctor expenses-empty-icon text-primary"></i>
            <div class="expenses-empty-title">لا توجد جلسات مسجلة للأطباء في هذا الشهر حتى الآن</div>
            <div class="expenses-empty-hint">ستظهر إحصائية ورواتب الأطباء فور تسجيل أول جلسة بالشهر</div>
          </div>
        `;
      } else {
        const cardsHTML = doctors.map((doc, index) => {
          const docObj = docList.find(d =>
            (d.name && d.name.trim() === doc.trim()) ||
            (d.name && (d.name.includes(doc) || doc.includes(d.name)))
          );
          const docSessions = allSessions.filter(s => s.doctor === doc || (docObj && s.doctorUid === docObj.uid));
          const sessionsCount = docSessions.filter(s => s.entryType !== 'examination').reduce((acc, s) => acc + (s.bodyPartsCount || 1), 0);
          const examsCount = docSessions.filter(s => s.entryType === 'examination').length;


          let regCount = 0, scolCount = 0, hemiCount = 0, quadCount = 0, specCount = 0;
          docSessions.forEach(s => {
            if (s.entryType === 'examination') return;
            const count = s.bodyPartsCount || 1;
            const patient = patientMap.get(s.patientId) || patientMap.get((s.patientName || '').trim());
            let pType = (s.sessionPricingType || s.programType || '').toLowerCase().trim();

            if (!pType || pType === 'regular') {
              if (patient) {
                const pProg = (patient.programType || patient.clinicalSheet?.programType || '').toLowerCase().trim();
                if (pProg && pProg !== 'regular') pType = pProg;
              }
            }

            if (!pType || pType === 'regular') {
              const diag = ((patient?.clinicalSheet?.diagnosis || '') + ' ' + (patient?.affectedArea || '') + ' ' + (s.notes || '')).toLowerCase();
              if (diag.includes('scoliosis') || diag.includes('اعوجاج') || diag.includes('جنف')) {
                pType = 'scoliosis';
              } else if (diag.includes('hemiplegia') || diag.includes('شلل نصفي') || diag.includes('جلطة')) {
                pType = 'hemiplegia';
              } else if (diag.includes('quadriplegia') || diag.includes('pediatric') || diag.includes('شلل رباعي') || diag.includes('أطفال') || diag.includes('ضمور')) {
                pType = 'quadriplegia';
              }
            }

            if (pType === 'pediatric') pType = 'quadriplegia';

            if (pType === 'scoliosis') scolCount += count;
            else if (pType === 'hemiplegia') hemiCount += count;
            else if (pType === 'quadriplegia') quadCount += count;
            else if (pType === 'special' || pType === 'custom_special') specCount += count;
            else regCount += count;
          });

          const regRate = (docObj && typeof docObj.regularSessionRate === 'number') ? docObj.regularSessionRate : 0;
          const scolRate = (docObj && typeof docObj.scoliosisRate === 'number') ? docObj.scoliosisRate : 0;
          const hemiRate = (docObj && typeof docObj.hemiplegiaRate === 'number') ? docObj.hemiplegiaRate : 0;
          const quadRate = (docObj && typeof docObj.quadriplegiaRate === 'number') ? docObj.quadriplegiaRate : ((docObj && typeof docObj.pediatricRate === 'number') ? docObj.pediatricRate : 0);
          const specRate = (docObj && typeof docObj.specialSessionRate === 'number') ? docObj.specialSessionRate : 0;

          const totalSalary = (regCount * regRate) + (scolCount * scolRate) + (hemiCount * hemiRate) + (quadCount * quadRate) + (specCount * specRate);
          const cleanDoc = (escapeHTML(doc)).replace(/^د\.\s*/, '');

          return `
            <div class="hero-styled-card doc-stack-card ${index === 0 ? 'is-active-card' : 'is-peeking-card'}" data-stack-index="${index}">
              <div class="doc-stack-top-row">
                <div class="doc-stack-doc-info">
                  <div class="hsc-avatar doc-stack-avatar">
                    <i class="fa-solid fa-user-doctor"></i>
                  </div>
                  <div>
                    <div class="doc-stack-doc-name">${cleanDoc}</div>
                    <div class="doc-stack-doc-sub">إحصائية وراتب الشهر</div>
                  </div>
                </div>
                <span class="badge badge-success doc-stack-badge-pill">
                  ${totalSalary.toLocaleString('en-US')}
                </span>
              </div>
              <div class="hsc-divider"></div>
              <div class="doc-stack-stats-grid">
                <div class="doc-stack-stat-box">
                  <div class="doc-stack-stat-label">جلسات / كشوفات</div>
                  <div class="doc-stack-stat-val">
                    <span class="doc-stat-flex-val"><span>${sessionsCount}</span><span>/</span><span>${examsCount}</span></span>
                  </div>
                </div>
                <div class="doc-stack-stat-box">
                  <div class="doc-stack-stat-label">نوع الجلسات</div>
                  <div class="doc-stack-stat-val">
                    <span class="doc-stat-flex-val"><span class="text-primary">عام: ${regCount}</span><span>•</span><span class="text-warning">خاص: ${scolCount + hemiCount + quadCount + specCount}</span></span>
                  </div>
                </div>
              </div>
              <div class="doc-special-details-pill">
                <span class="fw-bold">تفاصيل الخاصة:</span> ${scolCount} Scoliosis • ${hemiCount} Hemiplegia • ${quadCount} Quadriplegia
              </div>
            </div>
          `;
        }).join('');

        const dotsHTML = doctors.map((_, i) => `<span class="doc-dot ${i === 0 ? 'active' : ''}" data-dot-index="${i}"></span>`).join('');

        docMob.innerHTML = `
          <div class="doc-stack-wrapper">
            <div class="doc-stack-header-bar">
              <span class="doc-stack-header-title">
                <i class="fa-solid fa-chart-pie text-primary ms-1"></i> ${doctors.length} أطباء بالمركز
              </span>
              <div class="doc-stack-header-actions">
                ${doctors.length > 1 ? `
                  <span id="monthly-doc-stack-counter" class="doc-stack-counter">1 من ${doctors.length}</span>
                  <button type="button" class="btn btn-outline btn-sm btn-doc-stack-toggle" id="btn-toggle-monthly-doc-stack" title="تبديل بين التراكم والقائمة">
                    <i class="fa-solid fa-list" id="icon-monthly-doc-stack-toggle"></i>
                  </button>
                ` : ''}
              </div>
            </div>
            <div class="doc-stack-container" id="monthly-doc-stack-container">
              ${cardsHTML}
            </div>
            ${doctors.length > 1 ? `
              <div class="doc-stack-nav-bar" id="monthly-doc-stack-nav-bar">
                <button type="button" class="doc-stack-nav-btn" id="btn-monthly-doc-stack-prev">
                  <i class="fa-solid fa-chevron-right"></i> السابق
                </button>
                <div class="doc-stack-dots" id="monthly-doc-stack-dots">
                  ${dotsHTML}
                </div>
                <button type="button" class="doc-stack-nav-btn" id="btn-monthly-doc-stack-next">
                  التالي <i class="fa-solid fa-chevron-left"></i>
                </button>
              </div>
            ` : ''}
          </div>
        `;

        this.initStackDeck('monthly-doc-stack');
      }
    }

    // B. Insurance & Cash Sessions Distribution Table
    const insTbody = document.getElementById('monthly-insurance-tbody');
    const insMob = document.getElementById('monthly-insurance-mobile-cards');

    let totalCashSessions = 0;
    let totalInsSessions = 0;

    allSessions.forEach(s => {
      const count = (s.entryType === 'examination') ? 1 : (s.bodyPartsCount || 1);
      if (s.payType === 'cash') {
        totalCashSessions += count;
      } else {
        totalInsSessions += count;
      }
    });

    if (insTbody) {
      insTbody.innerHTML = `
        <tr>
          <td class="ins-summary-td-cash">${totalCashSessions}</td>
          <td class="ins-summary-td-ins">${totalInsSessions}</td>
        </tr>
      `;
    }

    if (insMob) {
      insMob.innerHTML = `
        <div class="hero-styled-card fin-kpi-split-card">
          <div class="fin-kpi-sub-card cash">
            <div class="fin-kpi-sub-label"><i class="fa-solid fa-money-bill-wave text-success"></i> جلسات النقدي</div>
            <div class="fin-kpi-sub-val cash">${totalCashSessions}</div>
          </div>
          <div class="fin-kpi-sub-card insurance">
            <div class="fin-kpi-sub-label"><i class="fa-solid fa-shield-halved text-primary"></i> جلسات التأمين</div>
            <div class="fin-kpi-sub-val insurance">${totalInsSessions}</div>
          </div>
        </div>
      `;
    }

    // Render Monthly Expenses Breakdown by Category (v1.4.48)
    const mExpCatTbody = document.getElementById('monthly-expenses-categories-tbody');
    const mExpCatMob = document.getElementById('monthly-expenses-categories-mobile');
    const mExpCatBadge = document.getElementById('monthly-expense-categories-count-badge');

    const expCategories = {};
    allExpenses.forEach(e => {
      const cat = (e.title || 'مصروفات عامة').trim();
      if (!expCategories[cat]) {
        expCategories[cat] = { name: cat, count: 0, total: 0 };
      }
      expCategories[cat].count++;
      expCategories[cat].total += (parseFloat(e.amount) || 0);
    });

    if (totalAllDoctorsSalaries > 0) {
      const docsWithSal = doctorStats.filter(d => d.totalSalary > 0).length || doctors.length;
      expCategories['إجمالي راتب الاطباء'] = {
        name: 'إجمالي راتب الاطباء',
        count: docsWithSal,
        total: (expCategories['إجمالي راتب الاطباء']?.total || 0) + totalAllDoctorsSalaries
      };
    }

    const sortedCats = Object.values(expCategories).sort((a, b) => b.total - a.total);

    if (mExpCatBadge) {
      mExpCatBadge.textContent = `${sortedCats.length} بنود • ${totalExpenses.toLocaleString('en-US')} ج.م`;
    }

    if (mExpCatTbody) {
      if (sortedCats.length === 0) {
        mExpCatTbody.innerHTML = `<tr><td colspan="5" class="expenses-table-empty-cell">لا توجد مصروفات مسجلة لهذا الشهر.</td></tr>`;
      } else {
        let expCatIdx = 1;
        mExpCatTbody.innerHTML = sortedCats.map(cat => {
          const pct = totalExpenses > 0 ? ((cat.total / totalExpenses) * 100).toFixed(1) : 0;
          return `
            <tr>
              <td class="col-center-bold">${expCatIdx++}</td>
              <td class="col-session-patient">${escapeHTML(cat.name)}</td>
              <td class="col-center-bold">${cat.count} حركات</td>
              <td class="col-center-bold text-danger">${cat.total.toLocaleString('en-US')} ج.م</td>
              <td class="col-center-bold">${pct}%</td>
            </tr>
          `;
        }).join('');
      }
    }

    if (mExpCatMob) {
      if (sortedCats.length === 0) {
        mExpCatMob.innerHTML = `
          <div class="expenses-mobile-empty-card">
            <i class="fa-solid fa-receipt expenses-empty-icon text-danger"></i>
            <div class="expenses-empty-title">لا توجد مصروفات مسجلة لهذا الشهر حتى الآن</div>
          </div>
        `;
      } else {
        mExpCatMob.innerHTML = sortedCats.map(cat => {
          const pct = totalExpenses > 0 ? ((cat.total / totalExpenses) * 100).toFixed(1) : 0;
          return `
            <div class="hero-styled-card m-exp-cat-card">
              <div class="m-exp-cat-top">
                <div class="m-exp-cat-meta">
                  <div class="hsc-avatar m-exp-cat-avatar">
                    <i class="fa-solid fa-tag"></i>
                  </div>
                  <div class="m-exp-cat-title">${escapeHTML(cat.name)}</div>
                </div>
                <span class="badge badge-m-exp-amount">
                  ${cat.total.toLocaleString('en-US')} ج.م
                </span>
              </div>
              <div class="hsc-divider"></div>
              <div class="m-exp-cat-stats-row">
                <span class="text-muted">${cat.count} حركات صرف مسجلة</span>
                <span class="fw-bold">${pct}% من المصروفات</span>
              </div>
              <div class="m-exp-cat-progress-track">
                <div class="m-exp-cat-progress-bar" style="width: ${pct}%;"></div>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    // D. Monthly Financial Summary Table (المقبوضات وصافي الدخل)
    const finSummaryTbody = document.getElementById('monthly-financial-summary-tbody');
    const finSummaryTfoot = document.getElementById('monthly-financial-summary-tfoot');
    if (finSummaryTbody) {
      const cashPct = totalIncome > 0 ? ((totalSessionsIncome / totalIncome) * 100).toFixed(1) : 0;
      const settlePct = totalIncome > 0 ? ((totalSettlementsNet / totalIncome) * 100).toFixed(1) : 0;

      finSummaryTbody.innerHTML = `
        <tr>
          <td class="col-session-idx">1</td>
          <td class="col-session-patient">إيرادات الجلسات والكشوفات</td>
          <td class="text-center"><span class="badge badge-cash">نقداً بالخزينة (الدرج)</span></td>
          <td class="col-center-bold text-success">${totalSessionsIncome.toLocaleString('en-US')} ج.م</td>
          <td class="col-center-bold">${cashPct}%</td>
        </tr>
        <tr>
          <td class="col-session-idx">2</td>
          <td class="col-session-patient">تحصيلات ومطالبات شركات التأمين</td>
          <td class="text-center"><span class="badge badge-direct">تحويل بنكي / شيكات / درج</span></td>
          <td class="col-center-bold text-primary">${totalSettlementsNet.toLocaleString('en-US')} ج.م</td>
          <td class="col-center-bold">${settlePct}%</td>
        </tr>
      `;

      if (finSummaryTfoot) {
        finSummaryTfoot.innerHTML = `
          <tr class="fin-summary-row-income">
            <td colspan="3" class="fin-summary-td-label">إجمالي مقبوضات وتحصيلات المركز (الدخل العام)</td>
            <td class="fin-summary-td-amount text-success">${totalIncome.toLocaleString('en-US')} ج.م</td>
            <td class="fin-summary-td-pct">100%</td>
          </tr>
          <tr class="fin-summary-row-expense">
            <td colspan="3" class="fin-summary-td-label text-danger">إجمالي المصروفات التشغيلية للشهر</td>
            <td class="fin-summary-td-amount text-danger">-${totalExpenses.toLocaleString('en-US')} ج.م</td>
            <td class="fin-summary-td-pct text-danger">${totalIncome > 0 ? ((totalExpenses / totalIncome) * 100).toFixed(1) : 0}%</td>
          </tr>
          <tr class="fin-summary-row-profit">
            <td colspan="3" class="fin-summary-td-label text-profit">صافي الدخل التشغيلي للمركز (الأرباح)</td>
            <td class="fin-summary-td-amount text-profit">${netProfit.toLocaleString('en-US')} ج.م</td>
            <td class="fin-summary-td-pct text-profit">هامش: ${marginPct}%</td>
          </tr>
        `;
      }

      const finSummaryMob = document.getElementById('monthly-financial-summary-mobile');
      if (finSummaryMob) {
        finSummaryMob.innerHTML = `
          <div class="fin-summary-mob-grid">
            <!-- 1. Cash Sessions Receipts -->
            <div class="hero-styled-card fin-kpi-sub-card cash text-center">
              <div class="fin-kpi-sub-label">
                <i class="fa-solid fa-money-bill-wave text-success"></i> إيرادات الجلسات
              </div>
              <div class="fin-kpi-sub-val cash">
                ${totalSessionsIncome.toLocaleString('en-US')} ج.م
              </div>
              <div class="fin-doc-shift-sub">
                <span class="badge badge-cash badge-sm">نقداً بالخزينة</span> • ${cashPct}%
              </div>
            </div>

            <!-- 2. Insurance Claims Collections -->
            <div class="hero-styled-card fin-kpi-sub-card insurance text-center">
              <div class="fin-kpi-sub-label">
                <i class="fa-solid fa-file-invoice-dollar text-primary"></i> تحصيلات التأمين
              </div>
              <div class="fin-kpi-sub-val insurance">
                ${totalSettlementsNet.toLocaleString('en-US')} ج.م
              </div>
              <div class="fin-doc-shift-sub">
                <span class="badge badge-direct badge-sm">تحويلات/شيكات</span> • ${settlePct}%
              </div>
            </div>
          </div>

          <!-- 3. Total Income, Expenses & Net Profit Summary Card -->
          <div class="hero-styled-card fin-summary-cockpit-card">
            <div class="fin-cockpit-row">
              <span class="fin-doc-breakdown-title text-main">إجمالي دخل وتحصيلات المركز:</span>
              <span class="fin-doc-breakdown-sub text-success">${totalIncome.toLocaleString('en-US')} ج.م</span>
            </div>
            <div class="fin-cockpit-row">
              <span class="fin-doc-breakdown-title text-danger">إجمالي المصروفات التشغيلية:</span>
              <span class="fin-doc-breakdown-sub text-danger">-${totalExpenses.toLocaleString('en-US')} ج.م</span>
            </div>

            <div class="hsc-divider"></div>

            <div class="fin-cockpit-profit-box">
              <div>
                <div class="fin-cockpit-profit-title">
                  <i class="fa-solid fa-chart-line"></i> صافي الدخل التشغيلي (الأرباح)
                </div>
                <div class="fin-cockpit-profit-sub">
                  هامش الربح التشغيلي: <strong>${marginPct}%</strong>
                </div>
              </div>
              <div class="fin-cockpit-profit-val">
                ${netProfit.toLocaleString('en-US')} ج.م
              </div>
            </div>
          </div>
        `;
      }
    }

    const canDelFinance = RolesManager.canDeleteFinance(auth.getCurrentUser());

    // Monthly Expenses Mobile Cards (Compact List)
    const mExpCard = document.getElementById('card-monthly-expenses');
    if (mExpCard) {
      mExpCard.style.display = 'block';
    }
    const totalMExp = allExpenses.reduce((acc, curr) => acc + (parseFloat(curr.amount) || 0), 0);
    const mExpBadge = document.getElementById('monthly-expenses-count-badge');
    if (mExpBadge) {
      mExpBadge.textContent = allExpenses.length > 0
        ? `${allExpenses.length} مصروفات • ${totalMExp.toLocaleString('en-US')} ج.م`
        : '0 مصروفات';
    }

    const mExpMob = document.getElementById('monthly-expenses-mobile-cards');
    if (mExpMob) {
      if (allExpenses.length === 0) {
        mExpMob.innerHTML = `
          <div class="expenses-compact-list expenses-compact-empty">
            <i class="fa-solid fa-receipt expenses-empty-icon"></i>
            لا توجد مصروفات مسجلة لهذا الشهر.
          </div>
        `;
      } else {
        const hasMoreMExp = allExpenses.length > 5;
        mExpMob.innerHTML = `
          <div class="expenses-compact-list">
            <div class="expenses-header-summary">
              <span><i class="fa-solid fa-receipt"></i> ${allExpenses.length} مصروفات مسجلة</span>
              <span class="expenses-total-amount">إجمالي: ${totalMExp.toLocaleString('en-US')} ج.م</span>
            </div>
            <div class="expenses-scroll-wrapper">
              ${allExpenses.map((e, idx) => `
                <div class="expense-row-item ${idx >= 5 ? 'expense-item-collapsed d-none' : ''}">
                  <div class="expense-row-right">
                    <div class="expense-avatar-icon">
                      <i class="fa-solid fa-receipt"></i>
                    </div>
                    <div class="expense-text-meta">
                      <div class="expense-title-text">${escapeHTML(e.title)}</div>
                      <div class="expense-sub-text">
                        <span><i class="fa-regular fa-calendar"></i> ${escapeHTML(e.date || '')}</span>
                        <span>•</span>
                        <span><i class="fa-regular fa-user"></i> ${escapeHTML(e.recordedBy || 'المسؤول')}</span>
                      </div>
                    </div>
                  </div>
                  <div class="expense-row-left">
                    <div class="expense-amount-badge">
                      -${(parseFloat(e.amount) || 0).toLocaleString('en-US')} <small>ج.م</small>
                    </div>
                    ${canDelFinance ? `
                      <button type="button" class="btn-delete-expense-compact btn-delete-expense" data-expense-id="${e.id}" title="حذف المصروف">
                        <i class="fa-solid fa-trash"></i>
                      </button>
                    ` : ''}
                  </div>
                </div>
              `).join('')}
            </div>
            ${hasMoreMExp ? `
              <button type="button" class="btn-toggle-monthly-expenses-more" data-expanded="false">
                <span>عرض باقي المصروفات (${allExpenses.length - 5}+)</span>
                <i class="fa-solid fa-chevron-down"></i>
              </button>
            ` : ''}
          </div>
        `;

        if (hasMoreMExp) {
          mExpMob.querySelector('.btn-toggle-monthly-expenses-more')?.addEventListener('click', (ev) => {
            const btn = ev.currentTarget;
            const isExp = btn.getAttribute('data-expanded') === 'true';
            const hiddenRows = mExpMob.querySelectorAll('.expense-item-collapsed');
            if (isExp) {
              hiddenRows.forEach(r => r.classList.add('d-none'));
              btn.setAttribute('data-expanded', 'false');
              btn.innerHTML = `<span>عرض باقي المصروفات (${allExpenses.length - 5}+)</span> <i class="fa-solid fa-chevron-down"></i>`;
            } else {
              hiddenRows.forEach(r => r.classList.remove('d-none'));
              btn.setAttribute('data-expanded', 'true');
              btn.innerHTML = `<span>عرض أقل</span> <i class="fa-solid fa-chevron-up"></i>`;
            }
          });
        }
      }
    }
  }


  // ================= 3D Stack Deck Handler (Daily & Monthly Doctors) =================
  initStackDeck(prefix) {
    initStackDeck(prefix);
  }

  async handleConfirmCashHandoff() {
    const currentUser = auth.getCurrentUser();
    if (!currentUser) return;

    const drawerCashEl = document.getElementById('drawer-net-cash-display');
    const currentNetCash = drawerCashEl ? drawerCashEl.textContent.replace(' ج.م', '').trim() : '0';

    const confirmed = await this.app.showConfirm(
      'هل ترغب في تأكيد تسليم عهدة نقدية اليوم بقيمة (' + currentNetCash + ' ج.م) باسمك (' + currentUser.name + ')؟',
      'تأكيد تسليم نقدية الدرج'
    );

    if (!confirmed) return;

    try {
      await db.saveCashHandoff({
        date: this.currentDate,
        netCash: currentNetCash,
        handedBy: currentUser.name,
        handedByUid: currentUser.uid
      }, currentUser);

      try {
        await this.app.auditManager?.logAction(
          'تسليم نقدية الدرج',
          'تم تسليم عهدة نقدية الدرج ليوم ' + this.currentDate + ' بمبلغ ' + currentNetCash + ' ج.م',
          currentUser
        );
      } catch (_) {}

      this.app.showToast('تم تسجيل وتأكيد تسليم النقدية بنجاح!', 'success');

      if (window.app?.notificationsManager) {
        try {
          window.app.notificationsManager.sendNotification({
            type: 'cash_handoff',
            title: 'تسليم العهدة النقدية',
            body: `تم تسليم عهدة اليوم (${currentNetCash} ج.م) بواسطة ${currentUser.name}`,
            target: { role: 'admin' },
            data: { screen: 'finance', date: this.currentDate }
          });
        } catch (notifErr) {
          console.warn('Cash handoff notification notice:', notifErr);
        }
      }
      await this.loadDailyReport();
    } catch (err) {
      console.error('Cash handoff error:', err);
      this.app.showAlert('تعذر تسجيل تسليم النقدية: ' + err.message, 'خطأ', 'danger');
    }
  }

  getDataForExport() {
    return {
      mode: this.reportMode,
      date: this.currentDate,
      month: this.currentMonth,
      doctor: this.selectedDoctor
    };
  }
}
