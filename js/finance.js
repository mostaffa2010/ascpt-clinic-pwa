import { escapeHTML, getLocalDateStr, initStackDeck } from './utils.js';
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
    await this.loadReport();
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

    // Event Delegation: Finance Daily Report Sessions Table
    const reportTbody = document.getElementById('finance-report-tbody');
    if (reportTbody) {
      reportTbody.addEventListener('click', (e) => {
        const editBtn = e.target.closest('.btn-edit-session');
        if (editBtn) {
          const sid = editBtn.getAttribute('data-session-id');
          if (sid) this.app.sessionsManager.editSession(sid);
          return;
        }

        const delBtn = e.target.closest('.btn-delete-session');
        if (delBtn) {
          const sid = delBtn.getAttribute('data-session-id');
          if (sid) this.app.sessionsManager.deleteSession(sid);
          return;
        }
      });
    }

    // Event Delegation: Daily Expenses Table
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
    const reportMob = document.getElementById('finance-report-mobile-cards');
    if (reportMob) {
      reportMob.addEventListener('click', (e) => {
        const editBtn = e.target.closest('.btn-edit-session');
        if (editBtn) {
          const sid = editBtn.getAttribute('data-session-id');
          if (sid) this.app.sessionsManager.editSession(sid);
          return;
        }
        const delBtn = e.target.closest('.btn-delete-session');
        if (delBtn) {
          const sid = delBtn.getAttribute('data-session-id');
          if (sid) this.app.sessionsManager.deleteSession(sid);
          return;
        }
      });
    }

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
    if (dedInput) dedInput.value = '0';

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

  async handleSubmitSettlement(e) {
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
    const confirmed = await this.app.showConfirm('هل أنت متأكد من حذف هذا المصروف؟', 'تأكيد الحذف');
    if (confirmed) {
      const currentUser = auth.getCurrentUser();
      await db.deleteExpense(expenseId);
      try { await db.logAudit('حذف مصروف', `حذف مصروف برقم ${expenseId}`, currentUser); } catch (_) {}
      this.app.showToast('تم حذف المصروف بنجاح');
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

      if (labelPatients) labelPatients.textContent = 'إجمالي مرضى اليوم';
      const title = document.getElementById('finance-header-title');
      const sub = document.getElementById('finance-header-sub');
      if (title) title.innerHTML = '<i class="fa-solid fa-calculator" style="color: var(--primary);"></i> الحسابات والتقرير اليومي';
      if (sub) sub.textContent = 'متابعة الإيرادات والمصروفات والتقارير اليومية والشهرية الذكية';
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

      if (labelPatients) labelPatients.textContent = 'إجمالي مرضى الشهر';
      const title = document.getElementById('finance-header-title');
      const sub = document.getElementById('finance-header-sub');
      if (title) title.innerHTML = '<i class="fa-solid fa-chart-pie" style="color: var(--primary);"></i> التقرير الشهري الشامل';
      if (sub) sub.textContent = 'متابعة أداء أطباء المركز وتوزيع جهات التأمين والمصروفات الشهرية';
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
      if (sub) sub.textContent = 'إعداد وتجهيز مطالبات مستحقات المركز لدى شركات التأمين وبطاقات التردد الرسمية';

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
    const rawDoctors = await db.getDoctors();
    const doctors = Array.from(new Set(rawDoctors.map(d => (d || '').trim().replace(/\s+/g, ' ')))).filter(Boolean);

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
            <td style="font-weight: 700;">${(parseFloat(s.grossAmount) || 0).toLocaleString('en-US')} ج.م</td>
            <td style="color: var(--danger); font-size: 0.85rem;">
              ${(parseFloat(s.deductions) || 0) > 0 ? `${(parseFloat(s.deductions) || 0).toLocaleString('en-US')} ج.م (${escapeHTML(s.deductionReason || '')})` : '-'}
            </td>
            <td style="font-weight: 800; color: var(--success); font-size: 0.95rem;">${(parseFloat(s.netAmount) || 0).toLocaleString('en-US')} ج.م</td>
            <td>
              <span class="badge ${s.paymentMethod === 'cash' ? 'badge-cash' : 'badge-direct'}">
                <i class="fa-solid ${s.paymentMethod === 'cash' ? 'fa-money-bill-wave' : 'fa-building-columns'}"></i>
                ${s.paymentMethod === 'cash' ? 'نقداً بالدرج' : 'تحويل بنكي / شيك'}
              </span>
            </td>
            <td style="font-size: 0.8rem; color: var(--text-muted);">${escapeHTML(s.recordedBy || '-')}</td>
            <td class="no-print">
              ${canDel ? `
                <button type="button" class="btn btn-outline btn-sm btn-delete-record btn-delete-settlement" style="color: var(--danger);" data-settlement-id="${s.id}" title="حذف حركة التحصيل">
                  <i class="fa-solid fa-trash"></i>
                </button>
              ` : '-'}
            </td>
          </tr>
        `).join('');
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
      drawerBreakdownEl.textContent = `المقبوضات النقدية (${totalCash.toLocaleString('en-US')} ج.م) - المصروفات (${totalExpenses.toLocaleString('en-US')} ج.م)`;
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
      docContainer.innerHTML = doctors.map(doc => {
        const docSessions = allSessions.filter(s => s.doctor === doc);
        const patientCount = docSessions.length;
        const creditedSessions = docSessions.reduce((acc, s) => {
          if (s.entryType === 'examination') return acc + 1;
          return acc + (s.bodyPartsCount || 1);
        }, 0);

        return `
          <div style="background-color: var(--bg-subtle); border: 1px solid var(--border-color); padding: 10px 16px; border-radius: var(--radius-md); display: flex; align-items: center; gap: 10px;">
            <i class="fa-solid fa-user-doctor" style="color: var(--primary);"></i>
            <div>
              <div style="font-weight: 700; font-size: 0.9rem;">${escapeHTML(doc)}</div>
              <div style="font-size: 0.8rem; color: var(--text-muted);">${patientCount} مريض - ${creditedSessions} جلسة</div>
            </div>
          </div>
        `;
      }).join('');
    }

    // Doctors Breakdown Stack Deck (Mobile)
    const dailyDocDeck = document.getElementById('daily-doctors-mobile-deck');
    if (dailyDocDeck) {
      if (doctors.length === 0) {
        dailyDocDeck.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 20px; font-size: 0.88rem;">لا توجد بيانات أطباء مسجلة لهذا اليوم.</div>`;
      } else {
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

    // Daily Sessions Table
    const tbody = document.getElementById('finance-report-tbody');
    if (tbody) {
      if (filteredSessions.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 25px;">لا توجد حركات جلسات مسجلة في هذا التاريخ.</td></tr>`;
      } else {
        tbody.innerHTML = filteredSessions.map(s => {
          const safeId = escapeHTML(s.id);
          const safePatient = escapeHTML(s.patientName);
          const safeDoc = escapeHTML(s.doctor);
          const safeIns = escapeHTML(s.insuranceName || 'شركة');
          const safeAmount = escapeHTML(s.amountPaid);
          const safeRecBy = escapeHTML(s.recordedBy);

          let payBadge = '';
          if (s.payType === 'cash') {
            payBadge = `<span class="badge badge-cash"><i class="fa-solid fa-money-bill"></i> نقدي</span>`;
          } else if (s.contractType === 'direct') {
            payBadge = `<span class="badge badge-direct"><i class="fa-solid fa-file-contract"></i> ${safeIns} (مباشر)</span>`;
          } else {
            payBadge = `<span class="badge badge-indirect"><i class="fa-solid fa-handshake"></i> ${safeIns} (غير مباشر)</span>`;
          }

          let contractLabel = '-';
          if (s.payType === 'insurance') {
            if (s.contractType === 'direct') {
              contractLabel = `<span class="badge badge-direct"><i class="fa-solid fa-file-contract"></i> مباشر</span>`;
            } else {
              contractLabel = `<span class="badge badge-indirect"><i class="fa-solid fa-handshake"></i> غير مباشر</span>`;
            }
          }

          const isExam = (s.entryType === 'examination');
          let partsCell = '';
          if (isExam) {
            partsCell = `<span class="badge" style="background: var(--bg-subtle); color: var(--primary); border: 1px solid var(--border-color); font-weight: 800; font-size: 0.76rem; padding: 3px 8px;"><i class="fa-solid fa-stethoscope"></i> فحص سريري / كشف</span>`;
          } else {
            const rawParts = Array.isArray(s.bodyParts) ? s.bodyParts.join('، ') : (s.bodyParts || '');
            const parts = escapeHTML(rawParts);
            const count = escapeHTML(s.bodyPartsCount || (Array.isArray(s.bodyParts) ? s.bodyParts.length : 1));
            partsCell = `<span class="badge badge-role-doctor">${count} أعضاء (${parts})</span>`;
          }

          return `
            <tr>
              <td style="font-weight: 700;">${safePatient}</td>
              <td>${safeDoc}</td>
              <td>${payBadge}</td>
              <td>${safeIns === 'شركة' && s.payType === 'cash' ? '-' : safeIns}</td>
              <td>${contractLabel}</td>
              <td>${partsCell}</td>
              <td style="font-weight: 700; color: var(--success);">${safeAmount} ج.م</td>
              <td style="font-size: 0.8rem; color: var(--text-muted);">${safeRecBy}</td>
              <td class="no-print">
                <div style="display: flex; gap: 4px;">
                  <button type="button" class="btn btn-outline btn-sm btn-edit-session" data-session-id="${safeId}" title="تعديل بيانات الجلسة">
                    <i class="fa-solid fa-pen-to-square"></i>
                  </button>
                  ${RolesManager.canDelete(auth.getCurrentUser()) ? `
                    <button type="button" class="btn btn-outline btn-sm btn-delete-record btn-delete-session" style="color: var(--danger);" data-session-id="${safeId}" title="حذف">
                      <i class="fa-solid fa-trash"></i>
                    </button>
                  ` : ''}
                </div>
              </td>
            </tr>
          `;        }).join('');

        const mobContainer = document.getElementById('finance-report-mobile-cards');
        if (mobContainer) {
          const canDelete = RolesManager.canDelete(auth.getCurrentUser());
          mobContainer.innerHTML = filteredSessions.map(s => {
            const safeId = escapeHTML(s.id);
            const safePatient = escapeHTML(s.patientName);
            const safeDoc = escapeHTML(s.doctor);
            const safeIns = escapeHTML(s.insuranceName || 'شركة');
            const safeAmount = escapeHTML(s.amountPaid);

            let payBadge = '';
            if (s.payType === 'cash') {
              payBadge = '<span class="badge badge-cash"><i class="fa-solid fa-money-bill"></i> نقدي</span>';
            } else if (s.contractType === 'direct') {
              payBadge = `<span class="badge badge-direct"><i class="fa-solid fa-file-contract"></i> ${safeIns} (مباشر)</span>`;
            } else {
              payBadge = `<span class="badge badge-indirect"><i class="fa-solid fa-handshake"></i> ${safeIns} (غير مباشر)</span>`;
            }

            const isExam = (s.entryType === 'examination');
            let partsBadge = '';
            if (isExam) {
              partsBadge = '<span class="badge" style="background: rgba(109, 40, 217, 0.15); color: #7c3aed; font-weight: 800; font-size: 0.78rem;"><i class="fa-solid fa-stethoscope"></i> كشف طبي</span>';
            } else {
              const rawParts = Array.isArray(s.bodyParts) ? s.bodyParts.join('، ') : (s.bodyParts || '');
              const parts = escapeHTML(rawParts);
              const count = escapeHTML(s.bodyPartsCount || (Array.isArray(s.bodyParts) ? s.bodyParts.length : 1));
              partsBadge = `<span class="badge" style="background: rgba(2, 132, 199, 0.12); color: var(--primary); font-weight: 700; font-size: 0.78rem;"><i class="fa-solid fa-bone"></i> ${count} أعضاء (${parts})</span>`;
            }

            return `
              <div class="hero-styled-card" style="margin-bottom: 0;">
                <div class="hsc-top">
                  <div>
                    <div style="font-weight: 800; font-size: 1rem; color: var(--text-main);">${safePatient}</div>
                    <div style="font-size: 0.82rem; color: var(--text-muted); margin-top: 3px;">
                      <i class="fa-solid fa-user-doctor" style="color: var(--primary);"></i> ${safeDoc}
                    </div>
                  </div>
                  <div>${payBadge}</div>
                </div>
                <div class="hsc-divider" style="margin: 10px 0;"></div>
                <div class="hsc-bottom">
                  <div>${partsBadge}</div>
                  <div style="display: flex; align-items: center; gap: 10px;">
                    <span style="font-weight: 800; font-size: 1.1rem; color: var(--success);">${safeAmount} ج.م</span>
                    <div style="display: flex; gap: 4px;">
                      <button type="button" class="btn btn-outline btn-sm btn-edit-session" data-session-id="${safeId}" style="width: 32px; height: 32px; border-radius: 50%; padding: 0; display: inline-flex; align-items: center; justify-content: center;" title="تعديل">
                        <i class="fa-solid fa-pen-to-square"></i>
                      </button>
                      ${canDelete ? `
                      <button type="button" class="btn btn-outline btn-sm btn-delete-record btn-delete-session" style="width: 32px; height: 32px; border-radius: 50%; padding: 0; color: var(--danger); display: inline-flex; align-items: center; justify-content: center;" data-session-id="${safeId}" title="حذف">
                        <i class="fa-solid fa-trash"></i>
                      </button>
                      ` : ''}
                    </div>
                  </div>
                </div>
              </div>
            `;
          }).join('');
        }
      }
    }

    // Daily Expenses Table (Desktop)
    const expTbody = document.getElementById('finance-expenses-tbody');
    if (expTbody) {
      if (allExpenses.length === 0) {
        expTbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 20px;">لا توجد مصروفات مسجلة لهذا اليوم.</td></tr>`;
      } else {
        expTbody.innerHTML = allExpenses.map(e => `
          <tr>
            <td style="font-weight: 600;">${escapeHTML(e.title)}</td>
            <td style="font-weight: 700; color: var(--danger);">${escapeHTML(e.amount)} ج.م</td>
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
          <div class="expenses-compact-list" style="padding: 24px 16px; text-align: center; color: var(--text-muted); font-size: 0.88rem;">
            <i class="fa-solid fa-receipt" style="font-size: 1.5rem; opacity: 0.4; margin-bottom: 8px; display: block;"></i>
            لا توجد مصروفات مسجلة لهذا اليوم.
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
              <td style="font-weight: 700; color: var(--success);">${safeAmount} ج.م</td>
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
    const allSessions = await db.getSessions(this.currentMonth);
    const allExpenses = await db.getExpenses(this.currentMonth);
    const rawDoctors = await db.getDoctors();
    const doctors = Array.from(new Set(rawDoctors.map(d => (d || '').trim().replace(/\s+/g, ' ')))).filter(Boolean);

    const monthSettlements = await db.getInsuranceSettlements(null, this.currentMonth);
    const totalPatients = allSessions.length;
    const totalSessionsIncome = allSessions.reduce((acc, curr) => acc + (parseFloat(curr.amountPaid) || 0), 0);
    const totalSettlementsNet = monthSettlements.reduce((acc, s) => acc + (parseFloat(s.netAmount) || 0), 0);
    const totalSettlementsDeductions = monthSettlements.reduce((acc, s) => acc + (parseFloat(s.deductions) || 0), 0);
    const totalIncome = totalSessionsIncome + totalSettlementsNet;
    const totalExpenses = allExpenses.reduce((acc, curr) => acc + (parseFloat(curr.amount) || 0), 0);
    const netProfit = totalIncome - totalExpenses;

    // Update KPI UI
    document.getElementById('rep-total-patients').textContent = totalPatients;
    document.getElementById('rep-total-cash').textContent = `${totalIncome.toLocaleString('en-US')} ج.م`;
    document.getElementById('rep-total-expenses').textContent = `${totalExpenses.toLocaleString('en-US')} ج.م`;
    
    const netCashEl = document.getElementById('rep-net-cash');
    if (netCashEl) {
      netCashEl.textContent = `${netProfit.toLocaleString('en-US')} ج.م`;
      netCashEl.style.color = netProfit >= 0 ? 'var(--success)' : 'var(--danger)';
    }

    // Render Monthly Settlements Table
    const mSetTbody = document.getElementById('monthly-settlements-tbody');
    const mSetBadge = document.getElementById('monthly-settlements-total-badge');
    if (mSetBadge) {
      mSetBadge.textContent = `صافي: ${totalSettlementsNet.toLocaleString('en-US')} ج.م ${totalSettlementsDeductions > 0 ? `(استقطاعات: ${totalSettlementsDeductions.toLocaleString('en-US')} ج.م)` : ''}`;
    }

    if (mSetTbody) {
      if (monthSettlements.length === 0) {
        mSetTbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--text-muted); padding: 20px;">لا توجد تحصيلات مطالبات مسجلة لهذا الشهر حتى الآن.</td></tr>`;
      } else {
        const canDel = RolesManager.canDeleteFinance(auth.getCurrentUser());
        mSetTbody.innerHTML = monthSettlements.map(s => `
          <tr>
            <td style="font-weight: 700;">${escapeHTML(s.settlementDate || '-')}</td>
            <td style="font-weight: 800; color: var(--text-main);">${escapeHTML(s.companyName)}</td>
            <td style="font-size: 0.85rem;">${escapeHTML(s.claimPeriod || '-')}</td>
            <td style="font-weight: 700;">${(parseFloat(s.grossAmount) || 0).toLocaleString('en-US')} ج.م</td>
            <td style="color: var(--danger); font-size: 0.85rem;">
              ${(parseFloat(s.deductions) || 0) > 0 ? `${(parseFloat(s.deductions) || 0).toLocaleString('en-US')} ج.م (${escapeHTML(s.deductionReason || '')})` : '-'}
            </td>
            <td style="font-weight: 800; color: var(--success); font-size: 0.95rem;">${(parseFloat(s.netAmount) || 0).toLocaleString('en-US')} ج.م</td>
            <td>
              <span class="badge ${s.paymentMethod === 'cash' ? 'badge-cash' : 'badge-direct'}">
                <i class="fa-solid ${s.paymentMethod === 'cash' ? 'fa-money-bill-wave' : 'fa-building-columns'}"></i>
                ${s.paymentMethod === 'cash' ? 'نقداً بالدرج' : 'تحويل بنكي / شيك'}
              </span>
            </td>
            <td style="font-size: 0.8rem; color: var(--text-muted);">${escapeHTML(s.recordedBy || '-')}</td>
            <td class="no-print">
              ${canDel ? `
                <button type="button" class="btn btn-outline btn-sm btn-delete-record btn-delete-settlement" style="color: var(--danger);" data-settlement-id="${s.id}" title="حذف حركة التحصيل">
                  <i class="fa-solid fa-trash"></i>
                </button>
              ` : '-'}
            </td>
          </tr>
        `).join('');
      }
    }

    // A. Doctors Breakdown Table (Monthly)
    const docTbody = document.getElementById('monthly-doctors-tbody');
    if (docTbody) {
      if (doctors.length === 0 || totalPatients === 0) {
        docTbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 20px;">لا توجد بيانات جلسات مسجلة لهذا الشهر.</td></tr>`;
      } else {
        docTbody.innerHTML = doctors.map(doc => {
          const docSessions = allSessions.filter(s => s.doctor === doc);
          const cashCount = docSessions.filter(s => s.payType === 'cash').length;
          const insCount = docSessions.filter(s => s.payType === 'insurance').length;
          const total = docSessions.length;
          const pct = totalPatients > 0 ? ((total / totalPatients) * 100).toFixed(1) : 0;

          // Credited sessions rule:
          // If session: s.bodyPartsCount || 1 (minimum 1)
          // If examination: exactly 1 always
          const creditedSessions = docSessions.reduce((acc, s) => {
            if (s.entryType === 'examination') return acc + 1;
            return acc + (s.bodyPartsCount || 1);
          }, 0);

          const safeDoc = escapeHTML(doc);
          return `
            <tr>
              <td style="font-weight: 700;"><i class="fa-solid fa-user-doctor" style="color: var(--primary); margin-left: 6px;"></i> ${safeDoc}</td>
              <td style="color: var(--success); font-weight: 700;">${cashCount} مريض</td>
              <td style="color: var(--primary); font-weight: 700;">${insCount} مريض</td>
              <td style="font-weight: 800; font-size: 0.95rem;">${total} مريض</td>
              <td style="font-weight: 800; color: var(--primary); font-size: 0.95rem;">${creditedSessions} جلسة</td>
              <td>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="font-weight: 700; width: 45px;">${pct}%</span>
                  <div style="flex: 1; background-color: var(--bg-subtle); height: 8px; border-radius: 4px; overflow: hidden;">
                    <div style="width: ${pct}%; background-color: var(--primary); height: 100%;"></div>
                  </div>
                </div>
              </td>
            </tr>
          `;
        }).join('');

        const docMob = document.getElementById('monthly-doctors-mobile-cards');
        if (docMob) {
          if (doctors.length === 0) {
            docMob.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 20px; font-size: 0.88rem;">لا توجد بيانات أطباء مسجلة لهذا الشهر.</div>`;
          } else {
            const cardsHTML = doctors.map((doc, index) => {
              const docSessions = allSessions.filter(s => s.doctor === doc);
              const cashCount = docSessions.filter(s => s.payType === 'cash').length;
              const insCount = docSessions.filter(s => s.payType === 'insurance').length;
              const total = docSessions.length;
              const pct = totalPatients > 0 ? ((total / totalPatients) * 100).toFixed(1) : 0;
              const creditedSessions = docSessions.reduce((acc, s) => {
                if (s.entryType === 'examination') return acc + 1;
                return acc + (s.bodyPartsCount || 1);
              }, 0);
              const cleanDoc = (escapeHTML(doc)).replace(/^د\.\s*/, '');

              return `
                <div class="hero-styled-card doc-stack-card ${index === 0 ? 'is-active-card' : 'is-peeking-card'}" data-stack-index="${index}">
                  <div style="display: flex; align-items: center; justify-content: space-between;">
                    <div style="display: flex; align-items: center; gap: 10px;">
                      <div class="hsc-avatar" style="width: 40px; height: 40px; font-size: 1.1rem;">
                        <i class="fa-solid fa-user-doctor"></i>
                      </div>
                      <div>
                        <div style="font-weight: 800; font-size: 1.02rem; color: var(--text-main);">د. ${cleanDoc}</div>
                        <div style="font-size: 0.78rem; color: var(--text-muted);">إحصائية الشهر الحالي</div>
                      </div>
                    </div>
                    <span class="badge badge-primary" style="font-size: 0.82rem; font-weight: 800; padding: 4px 10px; border-radius: 999px;">
                      ${pct}% من المركز
                    </span>
                  </div>
                  <div class="hsc-divider" style="margin: 12px 0;"></div>
                  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                    <div style="background: var(--bg-subtle); padding: 8px 12px; border-radius: 12px; text-align: center;">
                      <div style="font-size: 0.74rem; color: var(--text-muted); font-weight: 700;">إجمالي الحالات</div>
                      <div style="font-weight: 800; font-size: 1.05rem; color: var(--text-main); margin-top: 2px;">${total} مريض (${creditedSessions} جلسة)</div>
                    </div>
                    <div style="background: var(--bg-subtle); padding: 8px 12px; border-radius: 12px; text-align: center;">
                      <div style="font-size: 0.74rem; color: var(--text-muted); font-weight: 700;">طبيعة السداد</div>
                      <div style="font-weight: 800; font-size: 0.92rem; margin-top: 2px;">
                        <span style="color: var(--success);">نقدي: ${cashCount}</span> • <span style="color: var(--primary);">تأمين: ${insCount}</span>
                      </div>
                    </div>
                  </div>
                </div>
              `;
            }).join('');

            const dotsHTML = doctors.map((_, i) => `<span class="doc-dot ${i === 0 ? 'active' : ''}" data-dot-index="${i}"></span>`).join('');

            docMob.innerHTML = `
              <div class="doc-stack-wrapper">
                <div class="doc-stack-header-bar">
                  <span style="font-size: 0.86rem; font-weight: 800; color: var(--text-main);">
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
      }
    }

    // B. Insurance & Cash Distribution Table
    const insTbody = document.getElementById('monthly-insurance-tbody');
    if (insTbody) {
      if (totalPatients === 0) {
        insTbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 20px;">لا توجد حركات مسجلة لهذا الشهر.</td></tr>`;
      } else {
        const categories = {};
        allSessions.forEach(s => {
          if (s.payType === 'cash') {
            const key = 'نقدي (Cash)';
            if (!categories[key]) categories[key] = { name: key, type: 'سداد نقدي مباشر', count: 0 };
            categories[key].count++;
          } else {
            const compName = s.insuranceName || 'شركة غير محددة';
            const contract = s.contractType === 'direct' ? 'تعاقد مباشر' : 'تعاقد غير مباشر';
            const key = `${compName} (${contract})`;
            if (!categories[key]) categories[key] = { name: compName, type: contract, count: 0 };
            categories[key].count++;
          }
        });

        insTbody.innerHTML = Object.values(categories).map(item => {
          const pct = ((item.count / totalPatients) * 100).toFixed(1);
          const safeName = escapeHTML(item.name);
          const safeType = escapeHTML(item.type);
          return `
            <tr>
              <td style="font-weight: 700;">${safeName}</td>
              <td><span class="badge ${item.type.includes('نقدي') ? 'badge-cash' : (item.type.includes('غير مباشر') ? 'badge-indirect' : 'badge-direct')}"><i class="fa-solid ${item.type.includes('نقدي') ? 'fa-money-bill' : (item.type.includes('غير مباشر') ? 'fa-handshake' : 'fa-file-contract')}"></i> ${safeType}</span></td>
              <td style="font-weight: 800; color: var(--primary); font-size: 0.95rem;">${item.count} حالة</td>
              <td style="font-weight: 700;">${pct}%</td>
            </tr>
          `;
        }).join('');

        const insMob = document.getElementById('monthly-insurance-mobile-cards');
        if (insMob) {
          insMob.innerHTML = Object.values(categories).map(item => {
            const pct = ((item.count / totalPatients) * 100).toFixed(1);
            const safeName = escapeHTML(item.name);
            const safeType = escapeHTML(item.type);
            const badgeClass = item.type.includes('نقدي') ? 'badge-cash' : (item.type.includes('غير مباشر') ? 'badge-indirect' : 'badge-direct');
            const iconClass = item.type.includes('نقدي') ? 'fa-money-bill' : (item.type.includes('غير مباشر') ? 'fa-handshake' : 'fa-file-contract');

            return `
              <div class="hero-styled-card" style="margin-bottom: 0;">
                <div style="display: flex; align-items: center; justify-content: space-between;">
                  <div style="font-weight: 800; font-size: 0.98rem; color: var(--text-main);">${safeName}</div>
                  <span class="badge ${badgeClass}"><i class="fa-solid ${iconClass}"></i> ${safeType}</span>
                </div>
                <div class="hsc-divider" style="margin: 10px 0;"></div>
                <div style="display: flex; align-items: center; justify-content: space-between; font-size: 0.88rem;">
                  <span style="font-weight: 800; color: var(--primary);">${item.count} حالة مسجلة</span>
                  <span style="font-weight: 800; color: var(--text-muted);">${pct}%</span>
                </div>
              </div>
            `;
          }).join('');
        }
      }
    }

    // C. Monthly Expenses Table (Desktop)
    const mExpTbody = document.getElementById('monthly-expenses-tbody');
    if (mExpTbody) {
      if (allExpenses.length === 0) {
        mExpTbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 20px;">لا توجد مصروفات مسجلة لهذا الشهر.</td></tr>`;
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
              <td style="font-weight: 700; color: var(--danger);">${safeAmount} ج.م</td>
              <td style="font-size: 0.8rem; color: var(--text-muted);">${safeRecBy}</td>
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

  getDataForExport() {
    return {
      mode: this.reportMode,
      date: this.currentDate,
      month: this.currentMonth,
      doctor: this.selectedDoctor
    };
  }
}
