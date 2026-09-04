import { escapeHTML } from './utils.js';
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
    this.currentDate = new Date().toISOString().split('T')[0];
    this.currentMonth = this.currentDate.substring(0, 7); // YYYY-MM
    this.selectedDoctor = 'all';
  }

  async init() {
    this.bindEvents();
    
    const datePicker = document.getElementById('finance-date-picker');
    if (datePicker) datePicker.value = this.currentDate;

    const monthPicker = document.getElementById('finance-month-picker');
    if (monthPicker) monthPicker.value = this.currentMonth;

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
  }

  setDateQuick(type) {
    if (type === 'today') {
      this.currentDate = new Date().toISOString().split('T')[0];
    } else if (type === 'yesterday') {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      this.currentDate = d.toISOString().split('T')[0];
    }
    const datePicker = document.getElementById('finance-date-picker');
    if (datePicker) datePicker.value = this.currentDate;

    this.syncQuickDateButtons(this.currentDate);
    this.loadDailyReport();
  }

  syncQuickDateButtons(dateStr) {
    const btnToday = document.getElementById('btn-quick-fin-today');
    const btnYest = document.getElementById('btn-quick-fin-yesterday');
    const today = new Date().toISOString().split('T')[0];
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

  openAddExpenseModal() {
    this.app.openAddExpenseModal();
  }

  async handleAddExpense(e) {
    e.preventDefault();
    const title = document.getElementById('expense-title')?.value.trim();
    const amountStr = document.getElementById('expense-amount')?.value.trim();
    const amount = parseFloat(amountStr);

    if (!title) {
      await this.app.showAlert('يرجى إدخال بند أو بيان المصروف.', 'بيانات مطلوبة', 'warning');
      document.getElementById('expense-title')?.focus();
      return;
    }

    if (isNaN(amount) || amount <= 0) {
      await this.app.showAlert('يرجى إدخال مبلغ صحيح للمصروف أكبر من صفر.', 'مبلغ غير صحيح', 'warning');
      document.getElementById('expense-amount')?.focus();
      return;
    }

    const currentUser = auth.getCurrentUser();
    const todayStr = new Date().toISOString().split('T')[0];
    const expenseData = {
      title,
      amount,
      date: this.currentDate || todayStr,
      recordedBy: currentUser?.name || 'مدير المركز'
    };

    await db.saveExpense(expenseData, currentUser);
    await db.logAudit('تسجيل مصروف', `تسجيل مصروف: ${title} بمبلغ ${amount} ج.م`, currentUser);

    this.app.closeModal('modal-expense');
    this.app.showToast('تم تسجيل وحفظ المصروف بنجاح');
    document.getElementById('form-expense')?.reset();
    await this.loadReport();
    this.app.refreshAll();
  }

  async deleteExpense(expenseId) {
    const confirmed = await this.app.showConfirm('هل أنت متأكد من حذف هذا المصروف؟', 'تأكيد الحذف');
    if (confirmed) {
      const currentUser = auth.getCurrentUser();
      await db.deleteExpense(expenseId);
      await db.logAudit('حذف مصروف', `حذف مصروف برقم ${expenseId}`, currentUser);
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

  // ================= 1. DAILY REPORT =================
  async loadDailyReport() {
    const allSessions = await db.getSessions(this.currentDate);
    const allExpenses = await db.getExpenses(this.currentDate);
    const doctors = await db.getDoctors();

    let filteredSessions = allSessions;
    if (this.selectedDoctor !== 'all') {
      filteredSessions = allSessions.filter(s => s.doctor === this.selectedDoctor);
    }

    const totalPatients = filteredSessions.length;
    const totalCash = filteredSessions.reduce((acc, curr) => acc + (parseFloat(curr.amountPaid) || 0), 0);
    const totalExpenses = allExpenses.reduce((acc, curr) => acc + (parseFloat(curr.amount) || 0), 0);
    const netCash = totalCash - totalExpenses;

    const docCounts = {};
    allSessions.forEach(s => { docCounts[s.doctor] = (docCounts[s.doctor] || 0) + 1; });

    // Update KPI UI
    document.getElementById('rep-total-patients').textContent = totalPatients;
    document.getElementById('rep-total-cash').textContent = `${totalCash.toLocaleString('en-US')} ج.م`;
    document.getElementById('rep-total-expenses').textContent = `${totalExpenses.toLocaleString('en-US')} ج.م`;
    
    const netCashEl = document.getElementById('rep-net-cash');
    if (netCashEl) {
      netCashEl.textContent = `${netCash.toLocaleString('en-US')} ج.م`;
      netCashEl.style.color = netCash >= 0 ? 'var(--success)' : 'var(--danger)';
    }

    // Dynamic Doctor Filter
    const docFilter = document.getElementById('finance-doctor-filter');
    if (docFilter) {
      const currentVal = docFilter.value;
      docFilter.innerHTML = '<option value="all">كل الأطباء</option>' + 
        doctors.map(d => `<option value="${d}">${d}</option>`).join('');
      if (doctors.includes(currentVal) || currentVal === 'all') {
        docFilter.value = currentVal;
      }
    }

    // Doctors Breakdown Cards
    const docContainer = document.getElementById('doctors-breakdown-container');
    if (docContainer) {
      docContainer.innerHTML = doctors.map(doc => {
        const count = docCounts[doc] || 0;
        return `
          <div style="background-color: var(--bg-subtle); border: 1px solid var(--border-color); padding: 10px 16px; border-radius: var(--radius-md); display: flex; align-items: center; gap: 10px;">
            <i class="fa-solid fa-user-doctor" style="color: var(--primary);"></i>
            <div>
              <div style="font-weight: 700; font-size: 0.9rem;">${doc}</div>
              <div style="font-size: 0.8rem; color: var(--text-muted);">${count} مريض اليوم</div>
            </div>
          </div>
        `;
      }).join('');
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

          const rawParts = Array.isArray(s.bodyParts) ? s.bodyParts.join('، ') : (s.bodyParts || '');
          const parts = escapeHTML(rawParts);
          const count = escapeHTML(s.bodyPartsCount || (Array.isArray(s.bodyParts) ? s.bodyParts.length : 1));

          return `
            <tr>
              <td style="font-weight: 700;">${safePatient}</td>
              <td>${safeDoc}</td>
              <td>${payBadge}</td>
              <td>${safeIns === 'شركة' && s.payType === 'cash' ? '-' : safeIns}</td>
              <td>${contractLabel}</td>
              <td><span class="badge badge-role-doctor">${count} أعضاء (${parts})</span></td>
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
      }
    }

    // Daily Expenses Table
    const expTbody = document.getElementById('finance-expenses-tbody');
    if (expTbody) {
      if (allExpenses.length === 0) {
        expTbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 20px;">لا توجد مصروفات مسجلة لهذا اليوم.</td></tr>`;
      } else {
        expTbody.innerHTML = allExpenses.map(e => `
          <tr>
            <td style="font-weight: 600;">${escapeHTML(e.title)}</td>
            <td style="font-weight: 700; color: var(--danger);">${escapeHTML(e.amount)} ج.م</td>
            <td style="font-size: 0.8rem; color: var(--text-muted);">${escapeHTML(e.recordedBy)}</td>
            <td style="font-size: 0.8rem; color: var(--text-muted);">${e.time}</td>
            <td class="no-print">
              ${RolesManager.canDelete(auth.getCurrentUser()) ? `
                <button type="button" class="btn btn-outline btn-sm btn-delete-record btn-delete-expense" style="color: var(--danger);" data-expense-id="${e.id}" title="حذف">
                  <i class="fa-solid fa-trash"></i>
                </button>
              ` : '-'}
            </td>
          </tr>
        `).join('');
      }
    }

    // Dashboard Stats update
    const dashPatients = document.getElementById('stat-patients-today');
    const dashCash = document.getElementById('stat-cash-today');
    const dashInsurance = document.getElementById('stat-insurance-count');
    const dashExpenses = document.getElementById('stat-expenses-today');

    if (dashPatients) dashPatients.textContent = allSessions.length;
    if (dashCash) dashCash.textContent = `${totalCash.toLocaleString('en-US')} ج.م`;
    if (dashInsurance) dashInsurance.textContent = `${allSessions.filter(s => s.payType === 'insurance').length} حالات`;
    if (dashExpenses) dashExpenses.textContent = `${totalExpenses.toLocaleString('en-US')} ج.م`;

    const dashTbody = document.querySelector('#dashboard-recent-table tbody');
    if (dashTbody) {
      const recent = allSessions.slice(0, 5);
      if (recent.length === 0) {
        dashTbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 15px;">لا توجد جلسات مسجلة اليوم.</td></tr>`;
      } else {
        dashTbody.innerHTML = recent.map(s => {
          const safePatient = escapeHTML(s.patientName);
          const safeDoc = escapeHTML(s.doctor);
          const safeIns = escapeHTML(s.insuranceName || 'تأمين');
          const safeAmount = escapeHTML(s.amountPaid);
          const safeRecAt = escapeHTML(s.recordedAt);
          const safeCount = escapeHTML(s.bodyPartsCount || 1);

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
              <td>${safeCount} أعضاء</td>
              <td style="font-weight: 700; color: var(--success);">${safeAmount} ج.م</td>
              <td style="font-size: 0.8rem; color: var(--text-muted);">${safeRecAt}</td>
            </tr>
          `;
        }).join('');
      }
    }
  }

  // ================= 2. MONTHLY REPORT =================
  async loadMonthlyReport() {
    const allSessions = await db.getSessions(this.currentMonth);
    const allExpenses = await db.getExpenses(this.currentMonth);
    const doctors = await db.getDoctors();

    const totalPatients = allSessions.length;
    const totalCash = allSessions.reduce((acc, curr) => acc + (parseFloat(curr.amountPaid) || 0), 0);
    const totalExpenses = allExpenses.reduce((acc, curr) => acc + (parseFloat(curr.amount) || 0), 0);
    const netCash = totalCash - totalExpenses;

    // Update KPI UI
    document.getElementById('rep-total-patients').textContent = totalPatients;
    document.getElementById('rep-total-cash').textContent = `${totalCash.toLocaleString('en-US')} ج.م`;
    document.getElementById('rep-total-expenses').textContent = `${totalExpenses.toLocaleString('en-US')} ج.م`;
    
    const netCashEl = document.getElementById('rep-net-cash');
    if (netCashEl) {
      netCashEl.textContent = `${netCash.toLocaleString('en-US')} ج.م`;
      netCashEl.style.color = netCash >= 0 ? 'var(--success)' : 'var(--danger)';
    }

    // A. Doctors Breakdown Table (Monthly)
    const docTbody = document.getElementById('monthly-doctors-tbody');
    if (docTbody) {
      if (doctors.length === 0 || totalPatients === 0) {
        docTbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 20px;">لا توجد بيانات جلسات مسجلة لهذا الشهر.</td></tr>`;
      } else {
        docTbody.innerHTML = doctors.map(doc => {
          const docSessions = allSessions.filter(s => s.doctor === doc);
          const cashCount = docSessions.filter(s => s.payType === 'cash').length;
          const insCount = docSessions.filter(s => s.payType === 'insurance').length;
          const total = docSessions.length;
          const pct = totalPatients > 0 ? ((total / totalPatients) * 100).toFixed(1) : 0;

          const safeDoc = escapeHTML(doc);
          return `
            <tr>
              <td style="font-weight: 700;"><i class="fa-solid fa-user-doctor" style="color: var(--primary); margin-left: 6px;"></i> ${safeDoc}</td>
              <td style="color: var(--success); font-weight: 700;">${cashCount} مريض</td>
              <td style="color: var(--primary); font-weight: 700;">${insCount} مريض</td>
              <td style="font-weight: 800; font-size: 0.95rem;">${total} مريض</td>
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
      }
    }

    // C. Monthly Expenses Table
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
