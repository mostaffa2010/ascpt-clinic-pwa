// ================= Global Bulletproof Event-Driven Lock on window.print =================
if (typeof window !== 'undefined' && !window.__print_lock_installed) {
  window.__print_lock_installed = true;
  const _origPrint = window.print.bind(window);
  let _isPrintingNow = false;

  window.print = function() {
    if (_isPrintingNow) {
      console.warn('Prevented duplicate window.print() call.');
      return;
    }
    _isPrintingNow = true;

    // 1. Remove focus immediately so Android Chrome cannot replay click event on return
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      try { document.activeElement.blur(); } catch (e) {}
    }

    // 2. Disable all print buttons on the page
    const printBtns = document.querySelectorAll(
      '#btn-print-report, #btn-print-sheet-top, #btn-print-sheet-bottom, .btn-print-sheet, #btn-print-claim-statement, #btn-print-attendance-cards, #btn-card-print-current'
    );
    printBtns.forEach(btn => {
      btn.setAttribute('disabled', 'true');
      btn.style.pointerEvents = 'none';
    });

    try {
      _origPrint();
    } catch (e) {
      console.error('Print trigger notice:', e);
    }

    // 3. Unlock ONLY 1 second AFTER the user returns to the app from print activity
    const unlock = () => {
      setTimeout(() => {
        _isPrintingNow = false;
        printBtns.forEach(btn => {
          btn.removeAttribute('disabled');
          btn.style.pointerEvents = '';
        });
      }, 1000);
    };

    const onReturn = () => {
      window.removeEventListener('focus', onReturn);
      window.removeEventListener('afterprint', onReturn);
      document.removeEventListener('visibilitychange', onVisChange);
      unlock();
    };

    const onVisChange = () => {
      if (document.visibilityState === 'visible') {
        onReturn();
      }
    };

    window.addEventListener('focus', onReturn, { once: true });
    window.addEventListener('afterprint', onReturn, { once: true });
    document.addEventListener('visibilitychange', onVisChange);

    // Fallback unlock after 6 seconds in case browser doesn't dispatch focus event
    setTimeout(unlock, 6000);
  };
}

import { escapeHTML } from './utils.js';
import { ClaimsManager } from './claims.js';
// ========================================================
// ASCPT - Main Application Coordinator
// ========================================================

import { PWAManager } from './pwa.js';
import { auth } from './auth.js';
import { db } from './db.js';
import { PatientsManager } from './patients.js';
import { SessionsManager } from './sessions.js';
import { FinanceManager } from './finance.js';
import { DoctorDashboardManager } from './doctor-dashboard.js';
import { ExportManager } from './export.js';
import { AuditAndAdminManager } from './audit.js';

class App {
  constructor() {
    this.currentView = 'dashboard';
    this.dialogResolve = null;

    // ربط مبكر وفوري لضمان عمل كافة الأزرار بدون أي تأخير
    window.app = this;
    window.auth = auth;
    this.patientsManager = new PatientsManager(this);
    this.sessionsManager = new SessionsManager(this);
    this.financeManager = new FinanceManager(this);
    this.exportManager = new ExportManager(this, this.financeManager);
    this.auditManager = new AuditAndAdminManager(this);
    this.claimsManager = new ClaimsManager(this);
    this.doctorDashboardManager = new DoctorDashboardManager(this);

    window.patientsManager = this.patientsManager;
    window.sessionsManager = this.sessionsManager;
    window.financeManager = this.financeManager;
    window.exportManager = this.exportManager;
    window.auditManager = this.auditManager;
    window.claimsManager = this.claimsManager;
    window.doctorDashboardManager = this.doctorDashboardManager;
  }

  async init() {
    // 1. تفعيل PWA
    PWAManager.init();

    // 2. ضبط عرض التاريخ
    const dateDisplay = document.getElementById('dashboard-date-display');
    if (dateDisplay) {
      const today = new Date();
      dateDisplay.textContent = today.toLocaleDateString('ar-EG-u-nu-latn', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    }

    // 3. ربط أحداث التنقل والحوارات وتأمين الواجهة
    this.bindNavigation();
    this.bindHardwareBackButton();
    this.disablePullToRefresh();
    this.disableBrowserContextMenu();
    this.bindModalsAndAuth();
    this.bindCustomDialog();

    // 4. تهيئة المصادقة والوحدات بأمان تام (Fault-Tolerant)
    try { await this.claimsManager.init(); } catch (e) { console.warn('claimsManager init notice:', e); }
    try {
      await auth.init(async (user) => {
        await this.refreshAll();
      });
    } catch (e) { console.warn('auth init notice:', e); }

    // 5. تحميل الوحدات
    try { await this.populateDoctorDropdowns(); } catch (e) { console.warn('populateDoctorDropdowns notice:', e); }
    try { await this.patientsManager.init(); } catch (e) { console.warn('patientsManager init notice:', e); }
    try { await this.sessionsManager.init(); } catch (e) { console.warn('sessionsManager init notice:', e); }
    try { await this.financeManager.init(); } catch (e) { console.warn('financeManager init notice:', e); }
    try { this.exportManager.init(); } catch (e) { console.warn('exportManager init notice:', e); }
    try { await this.auditManager.init(); } catch (e) { console.warn('auditManager init notice:', e); }

    // مزامنة أزرار القوائم المخصصة
    ['claim-company-select', 'patient-filter-type', 'session-doctor-select', 'finance-doctor-filter', 'newuser-role', 'p-doctor'].forEach(id => {
      this.updateCustomSelectDisplay(id);
    });

    // توجيه أي تنبيهات لتبدو بهوية التطبيق المخصصة
    window.alert = (msg) => this.showAlert(msg, 'تنبيه المركز', 'info');
    window.confirm = (msg) => this.showConfirm(msg, 'تأكيد الإجراء');

        // ربط أزرار دليل الـ Demo والنافذة التعريفية
    document.getElementById('btn-open-demo-guide')?.addEventListener('click', () => this.openDemoOnboarding());
    document.getElementById('sidebar-btn-demo-guide')?.addEventListener('click', () => this.openDemoOnboarding());
    document.getElementById('btn-dismiss-onboarding')?.addEventListener('click', () => this.dismissDemoOnboarding());
    document.getElementById('btn-close-demo-onboarding')?.addEventListener('click', () => this.dismissDemoOnboarding());

    // إظهار النافذة التعريفية تلقائياً عند أول دخول فقط
    if (localStorage.getItem('pc_demo_onboarding_seen') !== 'true') {
      setTimeout(() => {
        this.openDemoOnboarding();
      }, 600);
    }

    console.log('PhysioFlow Demo Application fully initialized.');
  }

  bindNavigation() {
    // Desktop Sidebar Links
    document.querySelectorAll('.sidebar-nav .nav-link').forEach(btn => {
      btn.addEventListener('click', () => {
        const view = btn.getAttribute('data-view');
        this.switchView(view);
      });
    });

    // Mobile Bottom Nav Items
    document.querySelectorAll('.bottom-nav .b-nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const view = btn.getAttribute('data-view');
        this.switchView(view);
      });
    });

    // Logout Buttons
    document.getElementById('btn-logout-mobile')?.addEventListener('click', () => auth.logout());
    document.getElementById('btn-logout-desktop')?.addEventListener('click', () => auth.logout());
  }

  switchView(viewName, isBackNavigation = false) {
    const user = auth.getCurrentUser();
    // تقييد صلاحيات التنقل حسب الدور
    if (user?.role === 'doctor') {
      if (viewName !== 'dashboard' && viewName !== 'patients' && viewName !== 'patient-sheet') {
        viewName = 'dashboard';
      }
    } else if (user?.role === 'receptionist') {
      if (viewName === 'admin' || viewName === 'patient-sheet') {
        viewName = 'dashboard';
      }
    }

    if (this.currentView === viewName && !isBackNavigation) return;

    if (!isBackNavigation) {
      const depth = (history.state?.depth || 0) + 1;
      history.pushState({ view: viewName, depth }, '');
    }

    this.currentView = viewName;

    // Toggle active classes on view sections
    document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
    const targetSection = document.getElementById(`view-${viewName}`);
    if (targetSection) targetSection.classList.add('active');

    // Update active state on Desktop sidebar
    document.querySelectorAll('.sidebar-nav .nav-link').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-view') === viewName);
    });

    // Update active state on Mobile bottom nav
    document.querySelectorAll('.bottom-nav .b-nav-item').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-view') === viewName);
    });

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Refresh specific view data if needed
    if (viewName === 'dashboard') {
      if (user?.role === 'doctor') {
        if (this.doctorDashboardManager) this.doctorDashboardManager.render();
      } else {
        if (this.financeManager) this.financeManager.updateDashboardStats();
      }
    }
    if (viewName === 'finance') this.financeManager.loadDailyReport();
    if (viewName === 'sessions') this.sessionsManager.loadTodaySessions();
    if (viewName === 'patients') this.patientsManager.loadPatients();
    if (viewName === 'admin') {
      this.auditManager.loadUsers();
      this.auditManager.loadAuditLogs();
    }
  }

  bindModalsAndAuth() {
    const formLogin = document.getElementById('form-login');
    if (formLogin) {
      formLogin.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email')?.value.trim();
        const password = document.getElementById('login-password')?.value;
        const errMsg = document.getElementById('login-error-msg');

        if (!email || !password) {
          await this.showAlert('يرجى إدخال البريد الإلكتروني وكلمة المرور للمتابعة.', 'بيانات الدخول مطلوبة', 'warning');
          return;
        }

        const result = await auth.login(email, password);
        if (!result.success) {
          errMsg.textContent = result.message;
          errMsg.style.display = 'block';
        } else {
          errMsg.style.display = 'none';
        }
      });
    }

    document.querySelectorAll('.modal-backdrop').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal && modal.id !== 'modal-auth' && modal.id !== 'modal-custom-dialog') {
          modal.classList.remove('active');
        }
      });
    });

    // Universal Modal Close Event Delegation ([data-close-modal])
    document.addEventListener('click', (e) => {
      const closeBtn = e.target.closest('[data-close-modal]');
      if (closeBtn) {
        const modalId = closeBtn.getAttribute('data-close-modal');
        if (modalId) this.closeModal(modalId);
      }
    });

    // Universal View Switch Event Delegation ([data-view-target])
    document.addEventListener('click', (e) => {
      const viewBtn = e.target.closest('[data-view-target]');
      if (viewBtn) {
        const targetView = viewBtn.getAttribute('data-view-target');
        if (targetView) this.switchView(targetView);
      }
    });

    // Universal Custom Picker Trigger Delegation ([data-open-picker])
    document.addEventListener('click', (e) => {
      const pickerBtn = e.target.closest('[data-open-picker]');
      if (pickerBtn) {
        const selId = pickerBtn.getAttribute('data-open-picker');
        const title = pickerBtn.getAttribute('data-picker-title') || 'اختر من القائمة';
        this.openCustomPicker(selId, title);
      }
    });

    // Universal Calendar Picker Trigger Delegation ([data-open-calendar])
    document.addEventListener('click', (e) => {
      const calInp = e.target.closest('[data-open-calendar]');
      if (calInp) {
        const inpId = calInp.getAttribute('data-open-calendar');
        this.openCalendarPicker(inpId);
      }
    });

    // Event Delegation: Custom Picker Options List
    const customPickerList = document.getElementById('custom-picker-list');
    if (customPickerList) {
      customPickerList.addEventListener('click', (e) => {
        const row = e.target.closest('[data-select-id]');
        if (row) {
          const selectId = row.getAttribute('data-select-id');
          const val = row.getAttribute('data-select-value');
          this.selectCustomOption(selectId, val);
        }
      });
    }

    // Event Delegation: Calendar Days Grid
    const calDaysContainer = document.getElementById('cal-days-container');
    if (calDaysContainer) {
      calDaysContainer.addEventListener('click', (e) => {
        const cell = e.target.closest('[data-cal-d]');
        if (cell) {
          const y = parseInt(cell.dataset.calY);
          const m = parseInt(cell.dataset.calM);
          const d = parseInt(cell.dataset.calD);
          this.calendarSelectDay(y, m, d);
        }
      });
    }

    // Calendar Modal Controls
    document.getElementById('cal-btn-prev')?.addEventListener('click', () => this.calendarNavigate(-1));
    document.getElementById('cal-btn-next')?.addEventListener('click', () => this.calendarNavigate(1));
    document.getElementById('cal-btn-confirm')?.addEventListener('click', () => this.calendarConfirmSelection());
    document.querySelectorAll('[data-cal-quick]').forEach(btn => {
      btn.addEventListener('click', () => this.calendarSelectQuick(btn.getAttribute('data-cal-quick')));
    });

    // Sales Banner, Demo & Training Buttons
    document.getElementById('btn-reset-demo-data')?.addEventListener('click', () => this.resetDemoData());
    ['demo-role-select-desktop'].forEach(selId => {
      document.getElementById(selId)?.addEventListener('change', (e) => auth.switchRole(e.target.value));
    });
    document.getElementById('btn-reset-training-data')?.addEventListener('click', () => this.resetTrainingData());
    document.getElementById('btn-exit-training-data')?.addEventListener('click', () => this.toggleTrainingMode(false));
    document.getElementById('btn-toggle-training-desktop')?.addEventListener('click', () => this.toggleTrainingMode());
    document.getElementById('btn-auth-demo-mode')?.addEventListener('click', () => {
      this.toggleTrainingMode(true);
      this.closeModal('modal-auth');
    });

    // Patient Picker Modal: Add New Patient Action
    document.getElementById('btn-picker-add-new-patient')?.addEventListener('click', () => {
      this.closeModal('modal-patient-picker');
      this.patientsManager.openAddModal();
    });

    // Admin Backup Controls
    document.getElementById('btn-download-backup')?.addEventListener('click', () => this.downloadBackup());
    document.getElementById('btn-restore-backup')?.addEventListener('click', () => this.triggerRestoreBackup());
    document.getElementById('backup-file-input')?.addEventListener('change', (e) => this.handleFileRestore(e));
  }

  bindCustomDialog() {
    const btnConfirm = document.getElementById('dialog-btn-confirm');
    const btnCancel = document.getElementById('dialog-btn-cancel');

    if (btnConfirm) {
      btnConfirm.addEventListener('click', () => {
        this.closeModal('modal-custom-dialog');
        if (this.dialogResolve) this.dialogResolve(true);
      });
    }

    if (btnCancel) {
      btnCancel.addEventListener('click', () => {
        this.closeModal('modal-custom-dialog');
        if (this.dialogResolve) this.dialogResolve(false);
      });
    }
  }

  // ================= Disable Pull-To-Refresh on Mobile =================
  disableBrowserContextMenu() {
    window.addEventListener('contextmenu', (e) => {
      const tag = e.target.tagName;
      if (tag !== 'INPUT' && tag !== 'TEXTAREA' && !e.target.isContentEditable) {
        e.preventDefault();
      }
    });

    window.addEventListener('selectstart', (e) => {
      const tag = e.target.tagName;
      if (tag !== 'INPUT' && tag !== 'TEXTAREA' && !e.target.isContentEditable) {
        e.preventDefault();
      }
    });
  }

  disablePullToRefresh() {
    // منع سحب المتصفح عبر معايير CSS القياسية دون حظر لمسات iOS
    document.documentElement.style.overscrollBehaviorY = 'none';
    document.body.style.overscrollBehaviorY = 'none';
  }

  // ================= Hardware Back Button & Mobile Gestures =================
  bindHardwareBackButton() {
    // ضبط الحالة المبدئية للشاشة الرئيسية
    if (!history.state) {
      history.replaceState({ view: 'dashboard', depth: 0 }, '');
    }

    window.addEventListener('popstate', async (event) => {
      // 1. إذا كانت هناك أي نافذة منبثقة أو قائمة مفتوحة، نغلقها فقط
      const activeModal = document.querySelector('.modal-backdrop.active:not(#modal-auth)');
      if (activeModal) {
        activeModal.classList.remove('active');
        return;
      }

      // 2. إذا كانت هناك شاشة سابقة في سجل التنقل
      if (event.state && event.state.view) {
        if (event.state.view !== this.currentView) {
          this.switchView(event.state.view, true);
        }
      } else {
        // 3. وصل إلى الشاشة الرئيسية (Dashboard) ويريد الخروج من التطبيق
        if (this.currentView === 'dashboard') {
          const wantExit = await this.showConfirm(
            'هل ترغب في الخروج من تطبيق PhysioFlow وإغلاقه؟',
            'تأكيد الخروج'
          );
          if (wantExit) {
            // الخروج الفعلي
            history.back();
          } else {
            // البقاء داخل التطبيق واستعادة الحالة
            history.pushState({ view: 'dashboard', depth: 0 }, '');
          }
        } else {
          // العودة للشاشة الرئيسية
          this.switchView('dashboard', true);
        }
      }
    });
  }

  // ================= Demo Showcase & Onboarding Methods =================
  openDemoOnboarding() {
    this.openModal('modal-demo-onboarding');
  }

  dismissDemoOnboarding() {
    const chk = document.getElementById('chk-dont-show-onboarding');
    if (chk && chk.checked) {
      localStorage.setItem('pc_demo_onboarding_seen', 'true');
    }
    this.closeModal('modal-demo-onboarding');
  }

  async resetDemoData() {
    const confirmed = await this.showConfirm(
      'هل ترغب في إعادة ضبط جميع بيانات الـ Demo للحالة الأصلية؟\n\nسيتم استعادة الـ 185 مريض، و 635 جلسة، ومصروفات شهرين كاملين، وتصفير أي تعديلات أو إضافات أجريتها.',
      'تأكيد إعادة ضبط الـ Demo'
    );
    if (confirmed) {
      db.resetDemo();

      // إعادة ضبط الحساب النشط لمدير المركز
      if (typeof auth !== 'undefined' && auth.switchRole) {
        await auth.switchRole('admin');
      }

      // إذا كان المستخدم داخل شيت مريض فرعي يعود لشاشة المرضى بأمان
      if (this.currentView === 'patient-sheet') {
        this.switchView('patients');
      }

      // إعادة ضبط محددات التاريخ لليوم الحالي
      if (this.sessionsManager && typeof this.sessionsManager.setDateQuick === 'function') {
        this.sessionsManager.setDateQuick('today');
      }
      if (this.financeManager && typeof this.financeManager.setDateQuick === 'function') {
        this.financeManager.setDateQuick('today');
      }

      // تحديث كامل الشاشات والبيانات في الذاكرة دون reload
      await this.refreshAll();

      this.showToast('تمت استعادة جميع بيانات الـ Demo للحالة الأصلية بنجاح 🔄');
    }
  }

  // ================= Custom Medical Calendar Picker =================
  openCalendarPicker(targetInputId) {
    this.calendarTargetInputId = targetInputId;
    const input = document.getElementById(targetInputId);
    let initDate = new Date();

    if (input && input.value) {
      const parts = input.value.split('-');
      if (parts.length === 3) {
        initDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
      }
    }

    this.calendarViewingYear = initDate.getFullYear();
    this.calendarViewingMonth = initDate.getMonth();
    this.calendarSelectedDate = input?.value || initDate.toISOString().split('T')[0];

    this.renderCalendar();
    this.openModal('modal-custom-calendar');
  }

  calendarNavigate(direction) {
    this.calendarViewingMonth += direction;
    if (this.calendarViewingMonth < 0) {
      this.calendarViewingMonth = 11;
      this.calendarViewingYear--;
    } else if (this.calendarViewingMonth > 11) {
      this.calendarViewingMonth = 0;
      this.calendarViewingYear++;
    }
    this.renderCalendar();
  }

  calendarSelectDay(y, m, d) {
    const mm = String(m + 1).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    this.calendarSelectedDate = `${y}-${mm}-${dd}`;
    this.renderCalendar();
  }

  calendarSelectQuick(type) {
    const today = new Date();
    if (type === 'today') {
      this.calendarSelectedDate = today.toISOString().split('T')[0];
    } else if (type === 'yesterday') {
      const yest = new Date();
      yest.setDate(yest.getDate() - 1);
      this.calendarSelectedDate = yest.toISOString().split('T')[0];
    } else if (type === 'firstOfMonth') {
      const mm = String(this.calendarViewingMonth + 1).padStart(2, '0');
      this.calendarSelectedDate = `${this.calendarViewingYear}-${mm}-01`;
    }
    this.calendarConfirmSelection();
  }

  calendarConfirmSelection() {
    if (this.calendarTargetInputId && this.calendarSelectedDate) {
      const input = document.getElementById(this.calendarTargetInputId);
      if (input) {
        input.value = this.calendarSelectedDate;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    this.closeModal('modal-custom-calendar');
  }

  renderCalendar() {
    const monthNames = [
      'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
      'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
    ];

    const y = this.calendarViewingYear;
    const m = this.calendarViewingMonth;

    // Header Title
    const monthYearEl = document.getElementById('cal-month-year');
    if (monthYearEl) {
      monthYearEl.textContent = `${monthNames[m]} ${y}`;
    }

    // Selected Subtitle
    const subEl = document.getElementById('cal-selected-sub');
    if (subEl && this.calendarSelectedDate) {
      const [sy, sm, sd] = this.calendarSelectedDate.split('-').map(Number);
      const selObj = new Date(sy, sm - 1, sd);
      subEl.textContent = selObj.toLocaleDateString('ar-EG-u-nu-latn', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });
    }

    const container = document.getElementById('cal-days-container');
    if (!container) return;

    const firstDay = new Date(y, m, 1);
    const lastDate = new Date(y, m + 1, 0).getDate();
    const prevMonthLastDate = new Date(y, m, 0).getDate();

    // السبت = 0, الأحد = 1, ... الجمعة = 6
    const startDayIndex = (firstDay.getDay() + 1) % 7;

    const todayStr = new Date().toISOString().split('T')[0];
    let cellsHtml = '';

    // أيام الشهر السابق للحشو
    for (let i = startDayIndex - 1; i >= 0; i--) {
      const pDate = prevMonthLastDate - i;
      cellsHtml += `<div class="cal-day-cell other-month">${pDate}</div>`;
    }

    // أيام الشهر الحالي
    for (let d = 1; d <= lastDate; d++) {
      const mm = String(m + 1).padStart(2, '0');
      const dd = String(d).padStart(2, '0');
      const dateStr = `${y}-${mm}-${dd}`;

      const isSelected = dateStr === this.calendarSelectedDate;
      const isToday = dateStr === todayStr;

      let cls = 'cal-day-cell';
      if (isSelected) cls += ' selected';
      if (isToday) cls += ' today';

      cellsHtml += `
        <button type="button" class="${cls}" data-cal-y="${y}" data-cal-m="${m}" data-cal-d="${d}">
          ${d}
        </button>
      `;
    }

    // إكمال الشبكة حتى 35 أو 42 خلية
    const totalCells = startDayIndex + lastDate;
    const remaining = (7 - (totalCells % 7)) % 7;
    for (let n = 1; n <= remaining; n++) {
      cellsHtml += `<div class="cal-day-cell other-month">${n}</div>`;
    }

    container.innerHTML = cellsHtml;
  }

  // ================= Custom Month Picker =================
  openMonthPicker(targetInputId) {
    this.monthPickerTargetInputId = targetInputId;
    const input = document.getElementById(targetInputId);
    let initDate = new Date();

    if (input && input.value) {
      const parts = input.value.split('-');
      if (parts.length >= 2) {
        initDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, 1);
      }
    }

    this.monthPickerViewingYear = initDate.getFullYear();
    this.monthPickerSelectedMonth = initDate.getMonth();
    this.monthPickerSelectedYear = initDate.getFullYear();

    this.renderMonthPicker();
    this.openModal('modal-custom-month-picker');
  }

  monthPickerNavigateYear(direction) {
    this.monthPickerViewingYear += direction;
    this.renderMonthPicker();
  }

  monthPickerSelectMonth(m) {
    this.monthPickerSelectedMonth = m;
    this.monthPickerSelectedYear = this.monthPickerViewingYear;
    this.renderMonthPicker();
  }

  monthPickerSelectQuick(type) {
    const now = new Date();
    if (type === 'current') {
      this.monthPickerSelectedYear = now.getFullYear();
      this.monthPickerSelectedMonth = now.getMonth();
    } else if (type === 'last') {
      now.setMonth(now.getMonth() - 1);
      this.monthPickerSelectedYear = now.getFullYear();
      this.monthPickerSelectedMonth = now.getMonth();
    }
    this.monthPickerViewingYear = this.monthPickerSelectedYear;
    this.monthPickerConfirm();
  }

  monthPickerConfirm() {
    if (this.monthPickerTargetInputId) {
      const mm = String(this.monthPickerSelectedMonth + 1).padStart(2, '0');
      const val = `${this.monthPickerSelectedYear}-${mm}`;
      const input = document.getElementById(this.monthPickerTargetInputId);
      if (input) {
        input.value = val;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    this.closeModal('modal-custom-month-picker');
  }

  renderMonthPicker() {
    const monthNames = [
      'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
      'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
    ];

    const yearEl = document.getElementById('month-picker-year');
    if (yearEl) yearEl.textContent = this.monthPickerViewingYear;

    const subEl = document.getElementById('month-picker-sub');
    if (subEl) {
      subEl.textContent = `${monthNames[this.monthPickerSelectedMonth]} ${this.monthPickerSelectedYear}`;
    }

    const container = document.getElementById('month-picker-months-container');
    if (!container) return;

    const now = new Date();
    const curY = now.getFullYear();
    const curM = now.getMonth();

    container.innerHTML = monthNames.map((name, idx) => {
      const isSelected = (idx === this.monthPickerSelectedMonth && this.monthPickerViewingYear === this.monthPickerSelectedYear);
      const isCurrent = (idx === curM && this.monthPickerViewingYear === curY);

      let cls = 'cal-month-cell';
      if (isSelected) cls += ' selected';
      if (isCurrent) cls += ' current-month';

      const numStr = String(idx + 1).padStart(2, '0');
      return `
        <button type="button" class="${cls}" onclick="app.monthPickerSelectMonth(${idx})">
          <div style="font-size: 0.95rem;">${name}</div>
          <div style="font-size: 0.72rem; opacity: 0.75;">(${numStr})</div>
        </button>
      `;
    }).join('');
  }



  // ================= Sandbox & Training Mode =================
  updateTrainingModeUI() {
    const isTraining = db.isTraining;
    const banner = document.getElementById('sandbox-banner');
    if (banner) banner.style.display = isTraining ? 'flex' : 'none';

    // في وضع التدريب نخفي زر التدريب العلوي لتوفير مساحة لأن الشريط السفلي يحتوي على زر الخروج
    const mBtn = document.getElementById('btn-toggle-training-mobile');
    if (mBtn) mBtn.style.display = isTraining ? 'none' : 'inline-flex';

    const dText = document.getElementById('training-btn-text-desktop');
    if (dText) dText.textContent = isTraining ? 'الخروج من التدريب (بيانات حقيقية)' : 'تفعيل الوضع التدريبي (Sandbox)';
  }

  async toggleTrainingMode(forceState = null) {
    const nextState = forceState !== null ? forceState : !db.isTraining;
    db.setTrainingMode(nextState);

    this.updateTrainingModeUI();

    if (nextState) {
      this.showToast('تم تفعيل الوضع التدريبي بنجاح - بيانات آمنة للشرح والتجربة');
    } else {
      this.showToast('تم الرجوع إلى قاعدة بيانات ASCPT السحابية الحقيقية');
    }

    await this.refreshAll();
  }

  async resetTrainingData() {
    const confirmed = await this.showConfirm(
      'هل ترغب في إعادة تعيين عينات التدريب الافتراضية (المرضى والجلسات التجريبية للشرح)؟',
      'إعادة ضبط عينات التدريب'
    );
    if (confirmed) {
      db.initSandboxData(true);
      await this.refreshAll();
      this.showToast('تمت استعادة عينات التدريب بنجاح');
    }
  }

  // ================= Backup & Restore =================
  async downloadBackup() {
    try {
      const backup = await db.createFullBackup();
      const str = JSON.stringify(backup, null, 2);
      const blob = new Blob([str], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const dateStr = new Date().toISOString().split('T')[0];
      a.href = url;
      a.download = `نسخة_احتياطية_PhysioFlow_${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      this.showToast('تم تنزيل النسخة الاحتياطية بنجاح');
    } catch (err) {
      this.showAlert('تعذر إنشاء النسخة الاحتياطية: ' + err.message, 'خطأ', 'danger');
    }
  }

  triggerRestoreBackup() {
    const input = document.getElementById('backup-file-input');
    if (input) input.click();
  }

  async handleFileRestore(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      const confirmed = await this.showConfirm(
        `هل أنت متأكد من استعادة النسخة الاحتياطية المؤرخة في: ${data.timestamp || 'غير محدد'}؟ سيتم دمج وتحديث السجلات.`,
        'تأكيد استعادة البيانات'
      );

      if (confirmed) {
        await db.restoreFromBackup(data);
        await this.refreshAll();
        this.showToast('تمت استعادة البيانات بنجاح');
      }
    } catch (err) {
      this.showAlert('فشلت استعادة البيانات: ' + err.message, 'خطأ في الملف', 'danger');
    } finally {
      event.target.value = '';
    }
  }

  // اختصارات مباشرة للأزرار
  exportToExcel() {
    if (this.exportManager) this.exportManager.exportToExcel();
  }

  printReport() {
    if (this.exportManager) this.exportManager.printReport();
  }

  openAddExpenseModal() {
    const form = document.getElementById('form-expense');
    if (form && typeof form.reset === "function") form.reset();
    const titleEl = document.getElementById('expense-title');
    const amountEl = document.getElementById('expense-amount');
    if (titleEl) titleEl.value = '';
    if (amountEl) amountEl.value = '';
    this.openModal('modal-expense');
  }

  openAddPatientModal() {
    if (this.patientsManager) this.patientsManager.openAddModal();
  }

  // ================= Custom Picker Management =================
  openCustomPicker(selectId, modalTitle = 'اختر من القائمة') {
    const select = document.getElementById(selectId);
    if (!select) return;

    const titleEl = document.getElementById('custom-picker-title');
    if (titleEl) titleEl.innerHTML = `<i class="fa-solid fa-list-check"></i> ${modalTitle}`;

    const container = document.getElementById('custom-picker-list');
    if (!container) return;

    const options = Array.from(select.options);
    const currentVal = select.value;

    container.innerHTML = options.map((opt) => {
      const isSelected = opt.value === currentVal;
      return `
        <div class="custom-picker-row ${isSelected ? 'active-choice' : ''}" data-select-id="${selectId}" data-select-value="${escapeHTML(opt.value)}">
          <span>${opt.text}</span>
          ${isSelected ? '<i class="fa-solid fa-check check-icon"></i>' : ''}
        </div>
      `;
    }).join('');

    this.openModal('modal-custom-picker');
  }

  selectCustomOption(selectId, value) {
    const select = document.getElementById(selectId);
    if (!select) return;

    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    this.updateCustomSelectDisplay(selectId);
    this.closeModal('modal-custom-picker');
  }

  updateCustomSelectDisplay(selectId) {
    const select = document.getElementById(selectId);
    const btn = document.getElementById(`btn-select-${selectId}`);
    if (!select || !btn) return;

    const textSpan = btn.querySelector('.btn-text');
    if (textSpan) {
      const selectedOpt = select.options[select.selectedIndex];
      textSpan.textContent = selectedOpt ? selectedOpt.text : '-- اختر --';
    }
  }

  showAlert(message, title = 'تنبيه المركز', type = 'info') {
    return new Promise((resolve) => {
      this.dialogResolve = resolve;
      const modal = document.getElementById('modal-custom-dialog');
      const titleEl = document.getElementById('dialog-title');
      const msgEl = document.getElementById('dialog-message');
      const iconEl = document.getElementById('dialog-icon');
      const btnCancel = document.getElementById('dialog-btn-cancel');
      const btnConfirm = document.getElementById('dialog-btn-confirm');

      if (titleEl) titleEl.textContent = title;
      if (msgEl) msgEl.textContent = message;
      if (btnCancel) btnCancel.style.display = 'none';
      if (btnConfirm) {
        btnConfirm.textContent = 'حسناً';
        btnConfirm.className = 'btn btn-primary';
      }

      if (iconEl) {
        iconEl.className = `custom-dialog-icon ${type}`;
        if (type === 'warning') iconEl.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>';
        else if (type === 'danger') iconEl.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i>';
        else if (type === 'success') iconEl.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
        else iconEl.innerHTML = '<i class="fa-solid fa-circle-info"></i>';
      }

      this.openModal('modal-custom-dialog');
    });
  }

  showConfirm(message, title = 'تأكيد الإجراء') {
    return new Promise((resolve) => {
      this.dialogResolve = resolve;
      const titleEl = document.getElementById('dialog-title');
      const msgEl = document.getElementById('dialog-message');
      const iconEl = document.getElementById('dialog-icon');
      const btnCancel = document.getElementById('dialog-btn-cancel');
      const btnConfirm = document.getElementById('dialog-btn-confirm');

      if (titleEl) titleEl.textContent = title;
      if (msgEl) msgEl.textContent = message;
      if (btnCancel) btnCancel.style.display = 'inline-flex';
      if (btnConfirm) {
        btnConfirm.textContent = 'تأكيد';
        btnConfirm.className = 'btn btn-danger';
      }

      if (iconEl) {
        iconEl.className = 'custom-dialog-icon warning';
        iconEl.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>';
      }

      this.openModal('modal-custom-dialog');
    });
  }

  openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add('active');
      if (modalId !== 'modal-auth' && modalId !== 'modal-custom-dialog') {
        history.pushState({ modal: modalId, view: this.currentView }, '');
      }
    }
  }

  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('active');
      if (history.state && history.state.modal === modalId) {
        history.back();
      }
    }
  }

  showToast(message) {
    const toast = document.getElementById('toast-notification');
    const msgEl = document.getElementById('toast-message');
    if (toast && msgEl) {
      msgEl.textContent = message;
      toast.classList.add('show');
      setTimeout(() => {
        toast.classList.remove('show');
      }, 3000);
    }
  }

  async populateDoctorDropdowns() {
    const doctors = await db.getDoctors();

    const pDoc = document.getElementById('p-doctor');
    if (pDoc) {
      const prev = pDoc.value;
      pDoc.innerHTML = doctors.map(d => `<option value="${d}">${d}</option>`).join('');
      if (prev && doctors.includes(prev)) pDoc.value = prev;
    }

    const sessDoc = document.getElementById('session-doctor-select');
    if (sessDoc) {
      const prev = sessDoc.value;
      sessDoc.innerHTML = doctors.map(d => `<option value="${d}">${d}</option>`).join('');
      if (prev && doctors.includes(prev)) sessDoc.value = prev;
    }

    // Sync custom button displays
    this.updateCustomSelectDisplay('p-doctor');
    this.updateCustomSelectDisplay('session-doctor-select');
    this.updateCustomSelectDisplay('finance-doctor-filter');
  }

  async refreshAll() {
    await this.populateDoctorDropdowns();
    if (this.patientsManager) await this.patientsManager.loadPatients();
    if (this.sessionsManager) await this.sessionsManager.loadTodaySessions();
    if (this.financeManager) await this.financeManager.loadDailyReport();
    if (this.doctorDashboardManager) await this.doctorDashboardManager.render();
    if (this.claimsManager && typeof this.claimsManager.loadClaims === 'function') {
      await this.claimsManager.loadClaims();
    }
    if (this.auditManager && typeof this.auditManager.loadAuditLogs === 'function') {
      await this.auditManager.loadAuditLogs();
    }
  }
}

// تشغيل فوري وآمن يضمن عمل التطبيق مهما كانت حالة التحميل
function startApp() {
  if (window.__ascpt_app_started) return;
  window.__ascpt_app_started = true;
  const appInstance = new App();
  appInstance.init();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp);
} else {
  startApp();
}
