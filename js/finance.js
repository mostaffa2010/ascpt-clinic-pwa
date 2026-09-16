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

    ['daily-settlements-tbody', 'monthly-settlements-tbody'].forEach(id => {
      document.getElementById(id)?.addEventListener('click', (e) => {
        const delBtn = e.target.closest('.btn-delete-settlement');
        if (delBtn) {
          const sid = delBtn.getAttribute('data-settlement-id');
          if (sid) this.handleDeleteSettlement(sid);
        }
      });
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
      container.innerHTML = `<div style="text-align: center; color: var(--text-muted); font-size: 0.85rem; padding: 20px;">لا توجد بنود مصروفات حالياً. أضف بنداً جديداً بالأعلى.</div>`;
      return;
    }

    container.innerHTML = categories.map(cat => `
      <div class="custom-picker-row" style="display: flex; justify-content: space-between; align-items: center; padding: 9px 12px; background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 8px; margin-bottom: 6px;">
        <div style="font-weight: 700; font-size: 0.88rem; color: var(--text-main); display: flex; align-items: center; gap: 8px;">
          <i class="fa-solid fa-tag" style="color: var(--primary);"></i>
          <span>${escapeHTML(cat)}</span>
        </div>
        <button type="button" class="btn btn-outline btn-sm btn-delete-exp-cat" data-cat-name="${escapeHTML(cat)}" style="color: var(--danger); border-color: rgba(239, 68, 68, 0.3); padding: 4px 9px; border-radius: 6px;" title="حذف هذا البند من القائمة">
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
      if (title) title.innerHTML = '<i class="fa-solid fa-calculator" style="color: var(--primary);"></i> الحسابات والتقرير اليومي';
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
      if (title) title.innerHTML = '<i class="fa-solid fa-chart-pie" style="color: var(--primary);"></i> التقرير الشهري الشامل';
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
      if (title) title.innerHTML = '<i class="fa-solid fa-file-invoice-dollar" style="color: var(--primary);"></i> مطالبات شركات التأمين وبطاقات التردد';
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
    const dailySetTbody = document.getElementById('daily-settlements-tbody');
    const dailySetBadge = document.getElementById('daily-settlements-total-badge');

    if (dailySetCard && dailySetTbody) {
      if (todaySettlements.length > 0) {
        dailySetCard.style.display = 'block';
        const totalNet = todaySettlements.reduce((acc, s) => acc + (parseFloat(s.netAmount) || 0), 0);
        if (dailySetBadge) {
          dailySetBadge.textContent = `صافي: ${totalNet.toLocaleString('en-US')} ج.م ${bankSettlements > 0 ? `(بنكي: ${bankSettlements.toLocaleString('en-US')})` : ''}`;
        }
        const canDel = RolesManager.canDeleteFinance(auth.getCurrentUser());
        dailySetTbody.innerHTML = todaySettlements.map(s => `
          <tr>
            <td style="font-weight: 800; color: var(--text-main);">${escapeHTML(s.companyName)}</td>
            <td style="font-size: 0.85rem;">${escapeHTML(s.claimPeriod || '-')}</td>
            <td style="font-weight: 700;">${(parseFloat(s.grossAmount) || 0).toLocaleString('en-US')}</td>
            <td style="color: var(--danger); font-size: 0.85rem;">
              ${(parseFloat(s.deductions) || 0) > 0 ? `${(parseFloat(s.deductions) || 0).toLocaleString('en-US')} (${escapeHTML(s.deductionReason || '')})` : '-'}
            </td>
            <td style="font-weight: 800; color: var(--success); font-size: 0.95rem;">${(parseFloat(s.netAmount) || 0).toLocaleString('en-US')}</td>
            <td>
              <span class="badge ${s.paymentMethod === 'cash' ? 'badge-cash' : 'badge-direct'}">
                <i class="fa-solid ${s.paymentMethod === 'cash' ? 'fa-money-bill-wave' : 'fa-building-columns'}"></i>
                ${s.paymentMethod === 'cash' ? 'نقداً بالدرج' : 'تحويل بنكي / شيك'}
              </span>
            </td>
            <td class="no-print" style="font-size: 0.8rem; color: var(--text-muted);">${escapeHTML(s.recordedBy || '-')}</td>
            <td class="no-print">
              ${canDel ? `
                <button type="button" class="btn btn-outline btn-sm btn-delete-record btn-delete-settlement" style="color: var(--danger);" data-settlement-id="${s.id}" title="حذف حركة التحصيل">
                  <i class="fa-solid fa-trash"></i>
                </button>
              ` : '-'}
            </td>
          </tr>
        `).join('');

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
              <div class="hero-styled-card" style="margin-bottom: 8px;">
                <div class="hsc-top">
                  <div class="hsc-patient-meta">
                    <div class="hsc-avatar" style="background: rgba(2, 132, 199, 0.12); color: var(--primary);">
                      <i class="fa-solid fa-file-invoice-dollar"></i>
                    </div>
                    <div class="hsc-name-box">
                      <span class="hsc-patient-name">${safeComp}</span>
                      <span class="hsc-doc-sub"><i class="fa-regular fa-calendar"></i> ${safePeriod}</span>
                    </div>
                  </div>
                  <div class="hsc-amount-box">
                    <span class="hsc-amount-val" style="color: var(--success); font-size: 1.15rem; font-weight: 900;">${net} <small>ج.م</small></span>
                  </div>
                </div>

                <div class="hsc-badges-row">
                  ${payBadge}
                  ${ded > 0 ? `<span class="badge badge-danger"><i class="fa-solid fa-tag"></i> خصم: ${ded.toLocaleString('en-US')} ج.م</span>` : ''}
                </div>

                <div class="hsc-divider" style="margin: 8px 0;"></div>

                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.78rem; color: var(--text-muted);">
                  <div>الأصلي: <strong>${gross} ج.م</strong> • المسجل: ${escapeHTML(s.recordedBy || '-')}</div>
                  ${canDel ? `
                    <button type="button" class="btn btn-outline btn-sm btn-delete-record btn-delete-settlement" style="color: var(--danger); border-color: rgba(239, 68, 68, 0.3); padding: 3px 8px; font-size: 0.74rem;" data-settlement-id="${s.id}">
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
        dailySetTbody.innerHTML = '';
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
          statusEl.innerHTML = '<span class="badge badge-success" style="font-size: 0.78rem; font-weight: 800; padding: 4px 10px; display: inline-flex; align-items: center; gap: 5px;"><i class="fa-solid fa-circle-check"></i><span>تم تسليم العهدة: ' + displayNet + ' ج.م بواسطة ' + displayBy + ' (' + handoff.time + ')</span></span>';
          if (btnHandoff) {
            btnHandoff.innerHTML = '<i class="fa-solid fa-check-double"></i> <span>تم التسليم (تحديث)</span>';
          }
        } else {
          statusEl.innerHTML = '<span style="font-size: 0.8rem; color: var(--text-muted); display: inline-flex; align-items: center; gap: 6px;"><i class="fa-regular fa-clock"></i><span>لم يتم تسليم نقدية اليوم بعد</span></span>';
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
        docContainer.innerHTML = `<div style="color: var(--text-muted); font-size: 0.85rem; padding: 6px;">لا توجد جلسات أو أطباء مسجلين لهذا اليوم.</div>`;
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

          return `
            <div style="background-color: var(--bg-subtle); border: 1px solid var(--border-color); padding: 8px 14px; border-radius: var(--radius-md); display: flex; align-items: center; gap: 10px;">
              <i class="fa-solid fa-user-doctor" style="color: var(--primary); font-size: 1.1rem;"></i>
              <div>
                <div style="font-weight: 700; font-size: 0.88rem;">${escapeHTML(doc)} ${shiftText ? `<span style="font-size: 0.72rem; color: var(--text-muted); font-weight: 600;">(${escapeHTML(shiftText)})</span>` : ''}</div>
                <div style="font-size: 0.8rem; color: var(--text-muted); font-weight: 700;">${patientCount} مريض - ${creditedSessions} جلسة</div>
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
        dailyDocDeck.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 20px; font-size: 0.88rem;">لا توجد بيانات أطباء مسجلة لهذا اليوم.</div>`;
      } else {
        dailyDocDeck.style.display = 'block';
        dailyDocDeck.style.display = 'block';
        const cardsHTML = doctors.map((doc, index) => {
          const docSessions = allSessions.filter(s => s.doctor === doc);
          const patientCount = docSessions.length;
          const creditedSessions = docSessions.reduce((acc, s) => {
            if (s.entryType === 'examination') return acc + 1;
            return acc + (s.bodyPartsCount || 1);
          }, 0);
          const cashCount = docSessions.filter(s => s.payType === 'cash').length;
          const insCount = docSessions.filter(s => s.payType === 'insurance').length;
          const cleanDoc = (escapeHTML(doc)).replace(/^د\.\s*/, '');
          const totalDailyPatients = allSessions.length;
          const pct = totalDailyPatients > 0 ? ((patientCount / totalDailyPatients) * 100).toFixed(1) : 0;

          return `
            <div class="hero-styled-card doc-stack-card ${index === 0 ? 'is-active-card' : 'is-peeking-card'}" data-stack-index="${index}">
              <div style="display: flex; align-items: center; justify-content: space-between;">
                <div style="display: flex; align-items: center; gap: 10px;">
                  <div class="hsc-avatar" style="width: 40px; height: 40px; font-size: 1.1rem;">
                    <i class="fa-solid fa-user-doctor"></i>
                  </div>
                  <div>
                    <div style="font-weight: 800; font-size: 1.02rem; color: var(--text-main);">د. ${cleanDoc}</div>
                    <div style="font-size: 0.78rem; color: var(--text-muted);">إحصائية اليوم</div>
                  </div>
                </div>
                <span class="badge badge-primary" style="font-size: 0.8rem; font-weight: 800; padding: 4px 10px; border-radius: 999px;">
                  ${patientCount} مريض
                </span>
              </div>
              <div class="hsc-divider" style="margin: 12px 0;"></div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                <div style="background: var(--bg-subtle); padding: 8px 12px; border-radius: 12px; text-align: center;">
                  <div style="font-size: 0.74rem; color: var(--text-muted); font-weight: 700;">الجلسات المحتسبة</div>
                  <div style="font-weight: 800; font-size: 1.05rem; color: var(--text-main); margin-top: 2px;">${creditedSessions} جلسة</div>
                </div>
                <div style="background: var(--bg-subtle); padding: 8px 12px; border-radius: 12px; text-align: center;">
                  <div style="font-size: 0.74rem; color: var(--text-muted); font-weight: 700;">طبيعة السداد</div>
                  <div style="font-weight: 800; font-size: 0.92rem; margin-top: 2px;">
                    <span style="color: var(--success);">نقدي: ${cashCount}</span> • <span style="color: var(--primary);">تأمين: ${insCount}</span>
                  </div>
                </div>
              </div>
              <div style="width: 100%; height: 6px; background: var(--bg-subtle); border-radius: 999px; overflow: hidden; margin-top: 10px;">
                <div style="width: ${pct}%; height: 100%; background: var(--primary); border-radius: 999px;"></div>
              </div>
            </div>
          `;
        }).join('');

        const dotsHTML = doctors.map((_, i) => `<span class="doc-dot ${i === 0 ? 'active' : ''}" data-dot-index="${i}"></span>`).join('');

        dailyDocDeck.innerHTML = `
          <div class="doc-stack-wrapper">
            <div class="doc-stack-header-bar">
              <span style="font-size: 0.86rem; font-weight: 800; color: var(--text-main);">
                <i class="fa-solid fa-user-doctor" style="color: var(--primary); margin-left: 5px;"></i> ${doctors.length} أطباء بالمركز
              </span>
              <div style="display: flex; align-items: center; gap: 8px;">
                ${doctors.length > 1 ? `
                  <span id="daily-doc-stack-counter" style="font-size: 0.78rem; font-weight: 800; color: var(--primary); background: rgba(2, 132, 199, 0.12); padding: 2px 10px; border-radius: 999px;">1 من ${doctors.length}</span>
                  <button type="button" class="btn btn-outline btn-sm" id="btn-toggle-daily-doc-stack" style="font-size: 0.75rem; padding: 3px 9px; border-radius: 8px; height: 28px;" title="تبديل بين التراكم والقائمة">
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
        reportTbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 10px; font-size: 7pt;">لا توجد جلسات أو كشوفات مسجلة لهذا اليوم.</td></tr>';
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
              '<td style="text-align: center; font-weight: 700;">' + (rowIdx++) + '</td>' +
              '<td style="font-weight: 700; color: #000000;">' + escapeHTML(patientName) + '</td>' +
              '<td style="font-weight: 600;">' + escapeHTML(treatedBodyParts) + '</td>' +
              '<td style="font-weight: 600;">' + escapeHTML(doctorText) + '</td>' +
              '<td style="font-weight: 600; text-align: center;">' + escapeHTML(companyName) + '</td>' +
              '<td style="text-align: center; font-weight: 800; color: #0369a1;">' + escapeHTML(actionType) + '</td>' +
              '<td style="text-align: center; font-weight: 800; color: #15803d; white-space: nowrap;">' + amountDisplay + '</td>' +
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
        expTbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 4px; font-size: 7pt; font-weight: 700;">لا توجد مصروفات مسجلة لهذا اليوم.</td></tr>`;
      } else {
        expTbody.innerHTML = allExpenses.map(e => `
          <tr>
            <td style="font-weight: 600;">${escapeHTML(e.title)}</td>
            <td style="font-weight: 700; color: var(--danger);">${escapeHTML(e.amount)}</td>
            <td style="font-size: 0.8rem; color: var(--text-muted);">${escapeHTML(e.recordedBy)}</td>
            <td style="font-size: 0.8rem; color: var(--text-muted);">${e.time}</td>
            <td class="no-print">
              ${RolesManager.canDeleteFinance(auth.getCurrentUser()) ? `
                <button type="button" class="btn btn-outline btn-sm btn-delete-record btn-delete-expense" style="color: var(--danger);" data-expense-id="${e.id}" title="حذف">
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
          <div style="background: var(--bg-surface); border: 1.5px dashed var(--border-color); border-radius: 12px; padding: 22px 14px; text-align: center; color: var(--text-muted); margin-bottom: 12px;">
            <i class="fa-solid fa-receipt" style="font-size: 1.8rem; opacity: 0.35; margin-bottom: 8px; display: block;"></i>
            <div style="font-weight: 700; font-size: 0.88rem; color: var(--text-main); margin-bottom: 3px;">لا توجد مصروفات مسجلة لهذا اليوم</div>
            <div style="font-size: 0.75rem;">يمكنك تسجيل مصروف جديد بالضغط على زر "تسجيل مصروف" بالأعلى</div>
          </div>
        `;
      } else {
        const canDel = RolesManager.canDeleteFinance(auth.getCurrentUser());
        const hasMoreExp = allExpenses.length > 5;
        expensesMob.innerHTML = `
          <div class="expenses-compact-list">
            <div class="expenses-header-summary">
              <span><i class="fa-solid fa-receipt"></i> ${allExpenses.length} مصروفات</span>
              <span style="color: var(--danger); font-size: 0.88rem; font-weight: 800;">${totalExpenses.toLocaleString('en-US')} ج.م</span>
            </div>
            <div class="expenses-scroll-wrapper">
              ${allExpenses.map((e, idx) => `
                <div class="expense-row-item ${idx >= 5 ? 'expense-item-collapsed' : ''}" style="${idx >= 5 ? 'display: none;' : ''}">
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
              <button type="button" class="btn-toggle-expenses-more" data-expanded="false" style="width: 100%; padding: 10px; background: none; border: none; border-top: 1px solid var(--border-color); color: var(--primary); font-size: 0.84rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px;">
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
              hiddenRows.forEach(r => r.style.display = 'none');
              btn.setAttribute('data-expanded', 'false');
              btn.innerHTML = `<span>عرض باقي المصروفات (${allExpenses.length - 5}+)</span> <i class="fa-solid fa-chevron-down"></i>`;
            } else {
              hiddenRows.forEach(r => r.style.display = 'flex');
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

    const dashTbody = document.querySelector('#dashboard-recent-table tbody');
    const dashMobileCards = document.getElementById('dashboard-recent-mobile-cards');
    if (dashTbody) {
      // Sort newest recorded sessions first
      const sortedSessions = [...allSessions].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      const recent = sortedSessions.slice(0, 5);
      if (recent.length === 0) {
        dashTbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 15px;">لا توجد جلسات مسجلة اليوم.</td></tr>`;
        if (dashMobileCards) {
          dashMobileCards.innerHTML = `<div class="empty-state-card"><i class="fa-regular fa-calendar-xmark"></i> لا توجد جلسات مسجلة اليوم.</div>`;
        }
      } else {
        dashTbody.innerHTML = recent.map(s => {
          const safePatient = escapeHTML(s.patientName);
          const safeDoc = escapeHTML(s.doctor);
          const safeIns = escapeHTML(s.insuranceName || 'تأمين');
          const safeAmount = escapeHTML(s.amountPaid);
          const safeRecAt = escapeHTML(s.recordedAt || '');
          const isExam = (s.entryType === 'examination');
          const safeCount = isExam
            ? '<span class="badge" style="background: var(--bg-subtle); color: var(--primary); font-weight: 700; font-size: 0.75rem;"><i class="fa-solid fa-stethoscope"></i> كشف</span>'
            : `${escapeHTML(s.bodyPartsCount || 1)} أعضاء`;

          return `
            <tr>
              <td style="font-weight: 700;">${safePatient}</td>
              <td>${safeDoc}</td>
              <td>
                ${s.payType === 'cash' 
                  ? '<span class="badge badge-cash"><i class="fa-solid fa-money-bill"></i> نقدي</span>' 
                  : (s.contractType === 'direct' 
                    ? `<span class="badge badge-direct"><i class="fa-solid fa-file-contract"></i> ${safeIns}</span>` 
                    : `<span class="badge badge-indirect"><i class="fa-solid fa-handshake"></i> ${safeIns}</span>`)}
              </td>
              <td>${safeCount}</td>
              <td style="font-weight: 700; color: var(--success);">${safeAmount}</td>
              <td style="font-size: 0.8rem; color: var(--text-muted);">${safeRecAt}</td>
              <td class="cell-action">
                ${s.patientId ? `
                  <button type="button" class="btn btn-outline btn-sm btn-session-sheet-action" onclick="patientsManager.openPatientSheet('${escapeHTML(s.patientId)}')" style="border-radius: var(--radius-pill); font-size: 0.78rem; padding: 4px 12px;" title="فتح الشيت الطبي">
                    <i class="fa-solid fa-file-waveform"></i> الشيت الطبي
                  </button>
                ` : ''}
              </td>
            </tr>
          `;
        }).join('');

        if (dashMobileCards) {
          dashMobileCards.innerHTML = recent.map(s => {
            const safePatient = escapeHTML(s.patientName);
            const safeDoc = escapeHTML(s.doctor);
            const safeIns = escapeHTML(s.insuranceName || 'تأمين');
            const safeAmount = escapeHTML(s.amountPaid);
            const safeRecAt = escapeHTML(s.recordedAt || '');
            const isExam = (s.entryType === 'examination');
            const safeCount = isExam
              ? '<span class="badge" style="background: rgba(56, 189, 248, 0.15); color: var(--primary); font-weight: 700; font-size: 0.75rem;"><i class="fa-solid fa-stethoscope"></i> كشف</span>'
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
                <div class="hsc-divider" style="margin: 10px 0 12px 0;"></div>
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
  }

  // ================= 2. MONTHLY REPORT =================
  async loadMonthlyReport() {
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
    const docList = (typeof db.getDoctorsList === 'function') ? await db.getDoctorsList(true) : [];
    const allPatients = (typeof db.getPatients === 'function') ? await db.getPatients() : [];
    const patientMap = new Map();
    allPatients.forEach(p => {
      if (p.id) patientMap.set(p.id, p);
      if (p.name) patientMap.set(p.name.trim(), p);
    });

    const monthSettlements = await db.getInsuranceSettlements(null, this.currentMonth);
    const totalPatients = allSessions.length;
    const totalClinicSessions = allSessions.reduce((acc, s) => {
      if (s.entryType === 'examination') return acc + 1;
      return acc + (s.bodyPartsCount || 1);
    }, 0);
    const totalSessionsIncome = allSessions.reduce((acc, curr) => acc + (parseFloat(curr.amountPaid) || 0), 0);
    const totalSettlementsNet = monthSettlements.reduce((acc, s) => acc + (parseFloat(s.netAmount) || 0), 0);
    const totalSettlementsDeductions = monthSettlements.reduce((acc, s) => acc + (parseFloat(s.deductions) || 0), 0);
    const totalIncome = totalSessionsIncome + totalSettlementsNet;
    const totalExpenses = allExpenses.reduce((acc, curr) => acc + (parseFloat(curr.amount) || 0), 0);
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
        mSetTbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--text-muted); padding: 20px;">لا توجد تحصيلات مطالبات مسجلة لهذا الشهر حتى الآن.</td></tr>`;
        if (mSetMob) mSetMob.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 20px; font-size: 0.85rem;">لا توجد تحصيلات مطالبات مسجلة لهذا الشهر حتى الآن.</div>`;
      } else {
        const canDel = RolesManager.canDeleteFinance(auth.getCurrentUser());
        mSetTbody.innerHTML = monthSettlements.map(s => `
          <tr>
            <td style="font-weight: 700; text-align: center;">${escapeHTML(s.settlementDate || '-')}</td>
            <td style="font-weight: 800; color: #000000;">${escapeHTML(s.companyName)}</td>
            <td style="font-size: 0.85rem; text-align: center;">${escapeHTML(s.claimPeriod || '-')}</td>
            <td style="font-weight: 700; text-align: center;">${(parseFloat(s.grossAmount) || 0).toLocaleString('en-US')} ج.م</td>
            <td style="font-size: 0.85rem; text-align: center;">
              ${(parseFloat(s.deductions) || 0) > 0 ? `${(parseFloat(s.deductions) || 0).toLocaleString('en-US')} ج.م (${escapeHTML(s.deductionReason || '')})` : '-'}
            </td>
            <td style="font-weight: 800; text-align: center;">${(parseFloat(s.netAmount) || 0).toLocaleString('en-US')} ج.م</td>
            <td style="text-align: center;">
              <span class="badge ${s.paymentMethod === 'cash' ? 'badge-cash' : 'badge-direct'}">
                <i class="fa-solid ${s.paymentMethod === 'cash' ? 'fa-money-bill-wave' : 'fa-building-columns'}"></i>
                ${s.paymentMethod === 'cash' ? 'نقداً بالدرج' : 'تحويل بنكي / شيك'}
              </span>
            </td>
            <td class="no-print" style="font-size: 0.8rem; color: var(--text-muted); text-align: center;">${escapeHTML(s.recordedBy || '-')}</td>
            <td class="no-print" style="text-align: center;">
              ${canDel ? `
                <button type="button" class="btn btn-outline btn-sm btn-delete-record btn-delete-settlement" style="color: var(--danger);" data-settlement-id="${s.id}" title="حذف حركة التحصيل">
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
              <div class="hero-styled-card" style="margin-bottom: 8px;">
                <div class="hsc-top">
                  <div class="hsc-patient-meta">
                    <div class="hsc-avatar" style="background: rgba(16, 185, 129, 0.12); color: var(--success);">
                      <i class="fa-solid fa-receipt"></i>
                    </div>
                    <div class="hsc-name-box">
                      <span class="hsc-patient-name">${safeComp}</span>
                      <span class="hsc-doc-sub"><i class="fa-solid fa-calendar-day"></i> ${escapeHTML(s.settlementDate || '')} • ${safePeriod}</span>
                    </div>
                  </div>
                  <div class="hsc-amount-box">
                    <span class="hsc-amount-val" style="color: var(--success); font-size: 1.15rem; font-weight: 900;">${net} <small>ج.م</small></span>
                  </div>
                </div>

                <div class="hsc-badges-row">
                  ${payBadge}
                  ${ded > 0 ? `<span class="badge badge-danger"><i class="fa-solid fa-tag"></i> خصم: ${ded.toLocaleString('en-US')} ج.م</span>` : ''}
                </div>

                <div class="hsc-divider" style="margin: 8px 0;"></div>

                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.78rem; color: var(--text-muted);">
                  <div>الأصلي: <strong>${gross} ج.م</strong> • المسجل: ${escapeHTML(s.recordedBy || '-')}</div>
                  ${canDel ? `
                    <button type="button" class="btn btn-outline btn-sm btn-delete-record btn-delete-settlement" style="color: var(--danger); border-color: rgba(239, 68, 68, 0.3); padding: 3px 8px; font-size: 0.74rem;" data-settlement-id="${s.id}">
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
        docTbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 16px;">لا توجد بيانات جلسات مسجلة لهذا الشهر.</td></tr>';
      } else {
        docTbody.innerHTML = doctors.map(doc => {
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

          const safeDoc = escapeHTML(doc);
          return `
            <tr>
              <td style="font-weight: 700;"><i class="fa-solid fa-user-doctor" style="color: var(--primary); margin-left: 6px;"></i> ${safeDoc}</td>
              <td style="text-align: center; font-weight: 800;">
                <div style="display: flex; direction: rtl; justify-content: center; align-items: center; gap: 4px; font-weight: 800;">
                  <span>${sessionsCount}</span>
                  <span style="color: #64748b;">/</span>
                  <span>${examsCount}</span>
                </div>
              </td>
              <td style="text-align: center; font-weight: 800;">
                <div style="display: flex; direction: rtl; justify-content: center; align-items: center; gap: 4px; font-weight: 800;">
                  <span>${cashPatients}</span>
                  <span style="color: #64748b;">/</span>
                  <span>${insPatients}</span>
                </div>
              </td>
              <td style="text-align: center; font-weight: 800;">
                <div style="display: flex; direction: rtl; justify-content: center; align-items: center; gap: 3px; font-weight: 800;">
                  <span>${regCount + specCount}</span>
                  <span style="color: #64748b;">/</span>
                  <span>${scolCount}</span>
                  <span style="color: #64748b;">/</span>
                  <span>${hemiCount}</span>
                  <span style="color: #64748b;">/</span>
                  <span>${quadCount}</span>
                </div>
              </td>
              <td style="text-align: center; font-weight: 900; color: var(--success); font-size: 0.95rem;">${totalSalary.toLocaleString('en-US')}</td>
            </tr>
          `;
        }).join('');
      }
    }

    if (docMob) {
      if (doctors.length === 0 || totalPatients === 0) {
        docMob.innerHTML = `
          <div style="background: var(--bg-surface); border: 1.5px dashed var(--border-color); border-radius: 12px; padding: 22px 14px; text-align: center; color: var(--text-muted); margin-bottom: 12px;">
            <i class="fa-solid fa-user-doctor" style="font-size: 1.8rem; color: var(--primary); opacity: 0.35; margin-bottom: 8px; display: block;"></i>
            <div style="font-weight: 700; font-size: 0.88rem; color: var(--text-main); margin-bottom: 3px;">لا توجد جلسات مسجلة للأطباء في هذا الشهر حتى الآن</div>
            <div style="font-size: 0.75rem;">ستظهر إحصائية ورواتب الأطباء فور تسجيل أول جلسة بالشهر</div>
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

          const cashPatients = (new Set(docSessions.filter(s => s.payType === 'cash').map(s => s.patientId || s.patientName))).size;
          const insPatients = (new Set(docSessions.filter(s => s.payType !== 'cash').map(s => s.patientId || s.patientName))).size;

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
              <div style="display: flex; align-items: center; justify-content: space-between;">
                <div style="display: flex; align-items: center; gap: 10px;">
                  <div class="hsc-avatar" style="width: 40px; height: 40px; font-size: 1.1rem;">
                    <i class="fa-solid fa-user-doctor"></i>
                  </div>
                  <div>
                    <div style="font-weight: 800; font-size: 1.02rem; color: var(--text-main);">${cleanDoc}</div>
                    <div style="font-size: 0.78rem; color: var(--text-muted);">إحصائية وراتب الشهر</div>
                  </div>
                </div>
                <span class="badge badge-success" style="font-size: 0.95rem; font-weight: 900; padding: 4px 10px; border-radius: 999px;">
                  ${totalSalary.toLocaleString('en-US')}
                </span>
              </div>
              <div class="hsc-divider" style="margin: 12px 0;"></div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                <div style="background: var(--bg-subtle); padding: 8px 10px; border-radius: 10px; text-align: center;">
                  <div style="font-size: 0.72rem; color: var(--text-muted); font-weight: 700;">جلسات / كشوفات</div>
                  <div style="font-weight: 800; font-size: 0.96rem; color: var(--text-main); margin-top: 2px;">
                    <span style="direction: rtl; display: inline-flex; gap: 4px;"><span>${sessionsCount}</span><span>/</span><span>${examsCount}</span></span>
                  </div>
                </div>
                <div style="background: var(--bg-subtle); padding: 8px 10px; border-radius: 10px; text-align: center;">
                  <div style="font-size: 0.72rem; color: var(--text-muted); font-weight: 700;">مرضى (نقدي / شركات)</div>
                  <div style="font-weight: 800; font-size: 0.96rem; color: var(--text-main); margin-top: 2px;">
                    <span style="direction: rtl; display: inline-flex; gap: 4px;"><span>${cashPatients}</span><span>/</span><span>${insPatients}</span></span>
                  </div>
                </div>
              </div>
              <div style="margin-top: 8px; font-size: 0.76rem; color: var(--text-muted); text-align: center; background: var(--bg-subtle); padding: 5px 8px; border-radius: 8px;">
                <span style="font-weight: 700;">نوع الجلسات:</span> ${regCount + specCount} عادية • ${scolCount} Scoliosis • ${hemiCount} Hemiplegia • ${quadCount} Quadriplegia
              </div>
            </div>
          `;
        }).join('');

        const dotsHTML = doctors.map((_, i) => `<span class="doc-dot ${i === 0 ? 'active' : ''}" data-dot-index="${i}"></span>`).join('');

        docMob.innerHTML = `
          <div class="doc-stack-wrapper">
            <div class="doc-stack-header-bar">
              <span style="font-size: 0.86rem; font-weight: 800; color: var(--text-main); border-bottom: none;">
                <i class="fa-solid fa-chart-pie" style="color: var(--primary); margin-left: 5px;"></i> ${doctors.length} أطباء بالمركز
              </span>
              <div style="display: flex; align-items: center; gap: 8px;">
                ${doctors.length > 1 ? `
                  <span id="monthly-doc-stack-counter" style="font-size: 0.78rem; font-weight: 800; color: var(--primary); background: rgba(2, 132, 199, 0.12); padding: 2px 10px; border-radius: 999px;">1 من ${doctors.length}</span>
                  <button type="button" class="btn btn-outline btn-sm" id="btn-toggle-monthly-doc-stack" style="font-size: 0.75rem; padding: 3px 9px; border-radius: 8px; height: 28px;" title="تبديل بين التراكم والقائمة">
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
          <td style="text-align: center; font-weight: 900; font-size: 1.1rem; color: var(--success); padding: 8px;">${totalCashSessions}</td>
          <td style="text-align: center; font-weight: 900; font-size: 1.1rem; color: var(--primary); padding: 8px;">${totalInsSessions}</td>
        </tr>
      `;
    }

    if (insMob) {
      insMob.innerHTML = `
        <div class="hero-styled-card" style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 12px; text-align: center; margin-bottom: 8px;">
          <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 10px; padding: 10px;">
            <div style="font-size: 0.78rem; font-weight: 700; color: var(--text-muted);"><i class="fa-solid fa-money-bill-wave" style="color: var(--success);"></i> جلسات النقدي</div>
            <div style="font-size: 1.25rem; font-weight: 900; color: var(--success); margin-top: 4px;">${totalCashSessions}</div>
          </div>
          <div style="background: rgba(2, 132, 199, 0.08); border: 1px solid rgba(2, 132, 199, 0.2); border-radius: 10px; padding: 10px;">
            <div style="font-size: 0.78rem; font-weight: 700; color: var(--text-muted);"><i class="fa-solid fa-shield-halved" style="color: var(--primary);"></i> جلسات التأمين</div>
            <div style="font-size: 1.25rem; font-weight: 900; color: var(--primary); margin-top: 4px;">${totalInsSessions}</div>
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
    const sortedCats = Object.values(expCategories).sort((a, b) => b.total - a.total);

    if (mExpCatBadge) {
      mExpCatBadge.textContent = `${sortedCats.length} بنود • ${totalExpenses.toLocaleString('en-US')} ج.م`;
    }

    if (mExpCatTbody) {
      if (sortedCats.length === 0) {
        mExpCatTbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 20px;">لا توجد مصروفات مسجلة لهذا الشهر.</td></tr>`;
      } else {
        let expCatIdx = 1;
        mExpCatTbody.innerHTML = sortedCats.map(cat => {
          const pct = totalExpenses > 0 ? ((cat.total / totalExpenses) * 100).toFixed(1) : 0;
          return `
            <tr>
              <td style="text-align: center; font-weight: 700;">${expCatIdx++}</td>
              <td style="font-weight: 700; color: #000000;">${escapeHTML(cat.name)}</td>
              <td style="font-weight: 700; text-align: center;">${cat.count} حركات</td>
              <td style="font-weight: 800; color: var(--danger); text-align: center;">${cat.total.toLocaleString('en-US')} ج.م</td>
              <td style="font-weight: 800; text-align: center;">${pct}%</td>
            </tr>
          `;
        }).join('');
      }
    }

    if (mExpCatMob) {
      if (sortedCats.length === 0) {
        mExpCatMob.innerHTML = `
          <div style="background: var(--bg-surface); border: 1.5px dashed var(--border-color); border-radius: 12px; padding: 22px 14px; text-align: center; color: var(--text-muted); margin-bottom: 12px;">
            <i class="fa-solid fa-receipt" style="font-size: 1.8rem; color: var(--danger); opacity: 0.35; margin-bottom: 8px; display: block;"></i>
            <div style="font-weight: 700; font-size: 0.88rem; color: var(--text-main); margin-bottom: 3px;">لا توجد مصروفات مسجلة لهذا الشهر حتى الآن</div>
          </div>
        `;
      } else {
        mExpCatMob.innerHTML = sortedCats.map(cat => {
          const pct = totalExpenses > 0 ? ((cat.total / totalExpenses) * 100).toFixed(1) : 0;
          return `
            <div class="hero-styled-card" style="margin-bottom: 8px;">
              <div style="display: flex; align-items: center; justify-content: space-between;">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <div class="hsc-avatar" style="width: 34px; height: 34px; font-size: 0.9rem; background: rgba(239, 68, 68, 0.12); color: var(--danger);">
                    <i class="fa-solid fa-tag"></i>
                  </div>
                  <div style="font-weight: 800; font-size: 0.95rem; color: var(--text-main);">${escapeHTML(cat.name)}</div>
                </div>
                <span class="badge" style="background: rgba(239, 68, 68, 0.12); color: var(--danger); font-weight: 800; font-size: 0.85rem;">
                  ${cat.total.toLocaleString('en-US')} ج.م
                </span>
              </div>
              <div class="hsc-divider" style="margin: 10px 0;"></div>
              <div style="display: flex; align-items: center; justify-content: space-between; font-size: 0.82rem;">
                <span style="color: var(--text-muted);">${cat.count} حركات صرف مسجلة</span>
                <span style="font-weight: 800; color: var(--text-main);">${pct}% من المصروفات</span>
              </div>
              <div style="width: 100%; height: 6px; background: var(--bg-subtle); border-radius: 999px; overflow: hidden; margin-top: 8px;">
                <div style="width: ${pct}%; height: 100%; background: var(--danger); border-radius: 999px;"></div>
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
          <td style="text-align: center; font-weight: 700;">1</td>
          <td style="font-weight: 700; color: #000000;">إيرادات الجلسات والكشوفات</td>
          <td style="text-align: center;"><span class="badge badge-cash">نقداً بالخزينة (الدرج)</span></td>
          <td style="text-align: center; font-weight: 800; color: var(--success);">${totalSessionsIncome.toLocaleString('en-US')} ج.م</td>
          <td style="text-align: center; font-weight: 800;">${cashPct}%</td>
        </tr>
        <tr>
          <td style="text-align: center; font-weight: 700;">2</td>
          <td style="font-weight: 700; color: #000000;">تحصيلات ومطالبات شركات التأمين</td>
          <td style="text-align: center;"><span class="badge badge-direct">تحويل بنكي / شيكات / درج</span></td>
          <td style="text-align: center; font-weight: 800; color: var(--primary);">${totalSettlementsNet.toLocaleString('en-US')} ج.م</td>
          <td style="text-align: center; font-weight: 800;">${settlePct}%</td>
        </tr>
      `;

      if (finSummaryTfoot) {
        finSummaryTfoot.innerHTML = `
          <tr style="background-color: #f1f5f9; font-weight: 800;">
            <td colspan="3" style="text-align: right; font-weight: 900; color: #000000;">إجمالي مقبوضات وتحصيلات المركز (الدخل العام)</td>
            <td style="text-align: center; font-weight: 900; color: var(--success); font-size: 8pt;">${totalIncome.toLocaleString('en-US')} ج.م</td>
            <td style="text-align: center; font-weight: 900;">100%</td>
          </tr>
          <tr style="background-color: #fef2f2;">
            <td colspan="3" style="text-align: right; font-weight: 800; color: var(--danger);">إجمالي المصروفات التشغيلية للشهر</td>
            <td style="text-align: center; font-weight: 800; color: var(--danger); font-size: 8pt;">-${totalExpenses.toLocaleString('en-US')} ج.م</td>
            <td style="text-align: center; font-weight: 700; color: var(--danger);">${totalIncome > 0 ? ((totalExpenses / totalIncome) * 100).toFixed(1) : 0}%</td>
          </tr>
          <tr style="background-color: #f0fdf4; border-top: 2px solid #16a34a;">
            <td colspan="3" style="text-align: right; font-weight: 900; color: #15803d; font-size: 8pt;">صافي الدخل التشغيلي للمركز (الأرباح)</td>
            <td style="text-align: center; font-weight: 900; color: #15803d; font-size: 8.5pt;">${netProfit.toLocaleString('en-US')} ج.م</td>
            <td style="text-align: center; font-weight: 900; color: #15803d;">هامش: ${marginPct}%</td>
          </tr>
        `;
      }
    }

    // C. Monthly Expenses Table (Desktop)
    const mExpTbody = document.getElementById('monthly-expenses-tbody');
    const canDelFinance = RolesManager.canDeleteFinance(auth.getCurrentUser());
    if (mExpTbody) {
      if (allExpenses.length === 0) {
        mExpTbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 20px;">لا توجد مصروفات مسجلة لهذا الشهر.</td></tr>`;
      } else {
        mExpTbody.innerHTML = allExpenses.map(e => {
          const safeDate = escapeHTML(e.date || '-');
          const safeTitle = escapeHTML(e.title);
          const safeAmount = escapeHTML(e.amount);
          const safeRecBy = escapeHTML(e.recordedBy || '-');
          return `
            <tr>
              <td>${safeDate}</td>
              <td style="font-weight: 600;">${safeTitle}</td>
              <td style="font-weight: 700; color: var(--danger);">${safeAmount}</td>
              <td style="font-size: 0.8rem; color: var(--text-muted);">${safeRecBy}</td>
              <td class="no-print" style="text-align: center;">
                ${canDelFinance ? `
                  <button type="button" class="btn btn-outline btn-sm btn-delete-record btn-delete-expense" style="color: var(--danger);" data-expense-id="${e.id}" title="حذف المصروف">
                    <i class="fa-solid fa-trash"></i>
                  </button>
                ` : '-'}
              </td>
            </tr>
          `;
        }).join('');
      }
    }

    // Monthly Expenses Mobile Cards (Compact List)
    const mExpMob = document.getElementById('monthly-expenses-mobile-cards');
    if (mExpMob) {
      if (allExpenses.length === 0) {
        mExpMob.innerHTML = `
          <div class="expenses-compact-list" style="padding: 24px 16px; text-align: center; color: var(--text-muted); font-size: 0.88rem;">
            <i class="fa-solid fa-receipt" style="font-size: 1.5rem; opacity: 0.4; margin-bottom: 8px; display: block;"></i>
            لا توجد مصروفات مسجلة لهذا الشهر.
          </div>
        `;
      } else {
        const totalMExp = allExpenses.reduce((acc, curr) => acc + (parseFloat(curr.amount) || 0), 0);
        const hasMoreMExp = allExpenses.length > 5;
        mExpMob.innerHTML = `
          <div class="expenses-compact-list">
            <div class="expenses-header-summary">
              <span><i class="fa-solid fa-receipt"></i> ${allExpenses.length} مصروفات مسجلة</span>
              <span style="color: var(--danger); font-size: 0.88rem; font-weight: 800;">إجمالي: ${totalMExp.toLocaleString('en-US')} ج.م</span>
            </div>
            <div class="expenses-scroll-wrapper">
              ${allExpenses.map((e, idx) => `
                <div class="expense-row-item ${idx >= 5 ? 'expense-item-collapsed' : ''}" style="${idx >= 5 ? 'display: none;' : ''}">
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
              <button type="button" class="btn-toggle-monthly-expenses-more" data-expanded="false" style="width: 100%; padding: 10px; background: none; border: none; border-top: 1px solid var(--border-color); color: var(--primary); font-size: 0.84rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px;">
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
              hiddenRows.forEach(r => r.style.display = 'none');
              btn.setAttribute('data-expanded', 'false');
              btn.innerHTML = `<span>عرض باقي المصروفات (${allExpenses.length - 5}+)</span> <i class="fa-solid fa-chevron-down"></i>`;
            } else {
              hiddenRows.forEach(r => r.style.display = 'flex');
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
