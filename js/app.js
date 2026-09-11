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

import { escapeHTML, getLocalDateStr } from './utils.js';
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
import { AppointmentsManager } from './appointments.js';
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
    this.appointmentsManager = new AppointmentsManager(this);

    window.patientsManager = this.patientsManager;
    window.sessionsManager = this.sessionsManager;
    window.appointmentsManager = this.appointmentsManager;
    window.financeManager = this.financeManager;
    window.exportManager = this.exportManager;
    window.auditManager = this.auditManager;
    window.claimsManager = this.claimsManager;
    window.doctorDashboardManager = this.doctorDashboardManager;
  }

  async init() {
    // 1. تفعيل PWA والوضع الليلي
    PWAManager.init();
    this.initTheme();

    // 2. ضبط عرض التاريخ والترحيب الذكي الديناميكي
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
    const hour = new Date().getHours();
    const greetingText = (hour >= 5 && hour < 12) ? 'صباح الخير' : (hour >= 12 && hour < 17 ? 'مساء الخير' : 'مساء النور');
    const heroGreetEl = document.getElementById('hero-greeting-text');
    if (heroGreetEl) heroGreetEl.textContent = greetingText;
    const docGreetEl = document.getElementById('doc-hero-greeting');
    if (docGreetEl) docGreetEl.textContent = greetingText + " يا دكتور";

    // 3. ربط أحداث التنقل والحوارات وتأمين الواجهة
    this.bindNavigation();
    this.bindHardwareBackButton();
    this.disablePullToRefresh();
    this.disableBrowserContextMenu();
    this.bindModalsAndAuth();
    this.bindCustomDialog();

    // 4. تهيئة المصادقة والوحدات بأمان تام (Fault-Tolerant)
    try { await this.claimsManager.init(); } catch (e) { console.warn('claimsManager init notice:', e); }
    try { this.doctorDashboardManager?.init(); } catch (e) { console.warn('doctorDashboardManager init notice:', e); }
    try {
      await auth.init(async (user) => {
        if (user) {
          const heroName = document.getElementById('hero-greeting-name');
          if (heroName) heroName.textContent = user.name || 'دكتور';
          try { await db.syncAndSeedCloudOptions(); } catch (_) {}
          this.updateBackupStatusHint();
          this.checkBackupReminderToast(user);
        }
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
    try { await this.appointmentsManager.init(); } catch (e) { console.warn('appointmentsManager init notice:', e); }

    // مزامنة أزرار القوائم المخصصة
    ['claim-company-select', 'patient-filter-type', 'session-doctor-select', 'finance-doctor-filter', 'newuser-role', 'p-doctor', 'p-gender', 'p-approved-body-parts', 'renew-approved-body-parts'].forEach(id => {
      this.updateCustomSelectDisplay(id);
    });

    // توجيه أي تنبيهات لتبدو بهوية التطبيق المخصصة
    window.alert = (msg) => this.showAlert(msg, 'تنبيه المركز', 'info');
    window.confirm = (msg) => this.showConfirm(msg, 'تأكيد الإجراء');



    console.log('ASCPT Clinic Management System fully initialized.');
  }

  // ================= Dark / Light Theme Manager =================
  initTheme() {
    const saved = localStorage.getItem('ascpt_theme');
    const isDark = saved === 'dark' || (!saved && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    this.applyTheme(isDark ? 'dark' : 'light');

    const toggleBtns = document.querySelectorAll('#btn-toggle-theme, #btn-toggle-theme-desktop');
    toggleBtns.forEach(btn => {
      btn.addEventListener('click', () => this.toggleTheme());
    });
  }

  toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    this.applyTheme(next);
    localStorage.setItem('ascpt_theme', next);
    this.showToast(next === 'dark' ? 'تم تفعيل الوضع الليلي 🌙' : 'تم تفعيل الوضع النهاري ☀️');
  }

  applyTheme(theme) {
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', '#0b1120');
      document.querySelectorAll('#btn-toggle-theme i, #btn-toggle-theme-desktop i').forEach(icon => {
        icon.className = 'fa-solid fa-sun';
        icon.style.color = '#f59e0b';
      });
    } else {
      document.documentElement.removeAttribute('data-theme');
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', '#0284c7');
      document.querySelectorAll('#btn-toggle-theme i, #btn-toggle-theme-desktop i').forEach(icon => {
        icon.className = 'fa-solid fa-moon';
        icon.style.color = '';
      });
    }
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

    // Logout Buttons with Confirmation
    const handleLogout = async () => {
      const confirmed = await this.showConfirm('هل ترغب في تسجيل الخروج من نظام المركز؟', 'تأكيد تسجيل الخروج');
      if (confirmed) {
        await auth.logout();
        this.showToast('تم تسجيل الخروج بنجاح.');
      }
    };
    document.getElementById('btn-logout-mobile')?.addEventListener('click', handleLogout);
    document.getElementById('btn-logout-desktop')?.addEventListener('click', handleLogout);
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
        if (this.financeManager) this.financeManager.loadDailyReport();
      }
    }
    if (viewName === 'finance') this.financeManager.loadDailyReport();
    if (viewName === 'sessions') this.sessionsManager.loadTodaySessions();
    if (viewName === 'patients') this.patientsManager.loadPatients();
    if (viewName === 'admin') {
      this.auditManager.loadUsers();
      this.auditManager.loadAuditLogs();
    }
    if (viewName === 'appointments') this.appointmentsManager.render();
  }

  bindModalsAndAuth() {
    const formLogin = document.getElementById('form-login');
    const btnLogin = document.getElementById('btn-do-login');
    const emailInput = document.getElementById('login-email');
    const passwordInput = document.getElementById('login-password');
    const errMsg = document.getElementById('login-error-msg');
    const btnText = document.getElementById('btn-login-text');

    const handleLoginAction = async (e) => {
      if (e) {
        try { e.preventDefault(); } catch (_) {}
        try { e.stopPropagation(); } catch (_) {}
      }

      const email = emailInput?.value?.trim();
      const password = passwordInput?.value;

      if (!email || !password) {
        if (errMsg) {
          errMsg.textContent = 'يرجى إدخال البريد الإلكتروني وكلمة السر للمتابعة.';
          errMsg.style.display = 'block';
        }
        return;
      }

      try {
        if (btnLogin) {
          btnLogin.disabled = true;
          if (btnText) btnText.textContent = 'جاري تسجيل الدخول...';
        }
        if (errMsg) errMsg.style.display = 'none';

        await auth.login(email, password);
      } catch (err) {
        if (errMsg) {
          errMsg.textContent = err.message || 'فشل تسجيل الدخول، يرجى مراجعة البيانات.';
          errMsg.style.display = 'block';
        }
      } finally {
        if (btnLogin) {
          btnLogin.disabled = false;
          if (btnText) btnText.textContent = 'تسجيل الدخول';
        }
      }
    };

    if (formLogin) {
      formLogin.addEventListener('submit', handleLoginAction);
    }
    if (btnLogin) {
      btnLogin.addEventListener('click', handleLoginAction);
    }
    passwordInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleLoginAction(e);
    });
    emailInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        passwordInput?.focus();
      }
    });

    // Toggle Password Visibility (Native masked security support)
    const btnTogglePassword = document.getElementById('btn-toggle-password');
    if (btnTogglePassword) {
      btnTogglePassword.addEventListener('click', () => {
        if (passwordInput) {
          const isMasked = passwordInput.style.webkitTextSecurity !== 'none' && passwordInput.type !== 'text-plain';
          if (isMasked) {
            passwordInput.style.webkitTextSecurity = 'none';
            passwordInput.type = 'text';
          } else {
            passwordInput.style.webkitTextSecurity = 'disc';
          }
          const icon = document.getElementById('icon-toggle-password');
          if (icon) {
            icon.className = isMasked ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
          }
        }
      });
    }

    // Forgot Password Trigger
    document.getElementById('btn-forgot-password')?.addEventListener('click', async () => {
      const emailInput = document.getElementById('login-email');
      const email = emailInput?.value?.trim();
      if (!email) {
        await this.showAlert('يرجى كتابة البريد الإلكتروني في خانة البريد أولاً، ثم الضغط على "نسيت كلمة السر".', 'استعادة كلمة السر', 'warning');
        emailInput?.focus();
        return;
      }
      try {
        await auth.resetPassword(email);
        await this.showAlert(`تم إرسال رابط استعادة كلمة السر إلى بريدك الإلكتروني (${email}). يرجى فحص صندوق الوارد ورسائل الـ Spam.`, 'تم الإرسال بنجاح', 'success');
      } catch (err) {
        await this.showAlert(err.message || 'فشل إرسال رابط استعادة كلمة السر.', 'خطأ', 'danger');
      }
    });

    // Close Auth Modal buttons
    document.getElementById('btn-close-auth-modal')?.addEventListener('click', () => auth.hideLoginModal());
    document.getElementById('btn-cancel-login')?.addEventListener('click', () => auth.hideLoginModal());

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



    // Multi-Picker Add New Button
    document.getElementById('btn-multi-picker-add-new')?.addEventListener('click', () => {
      this.handleMultiPickerAddNew();
    });

    // Multi-Picker Confirm Button
    document.getElementById('btn-multi-picker-confirm')?.addEventListener('click', () => {
      this.confirmMultiPickerSelection();
    });

    // Event Delegation: Multi-Picker Options List
    const multiPickerList = document.getElementById('multi-picker-options-list');
    if (multiPickerList) {
      multiPickerList.addEventListener('click', (e) => {
        const delBtn = e.target.closest('[data-action="delete-multi-option"]');
        if (delBtn) {
          e.stopPropagation();
          const val = delBtn.getAttribute('data-val');
          const contract = delBtn.getAttribute('data-contract') || '';
          this.handleMultiPickerDeleteOption(val, contract);
          return;
        }

        const row = e.target.closest('.multi-picker-row');
        if (row) {
          const val = row.getAttribute('data-val');
          const contract = row.getAttribute('data-contract') || '';
          this.toggleMultiPickerOption(val, contract);
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

    // Month Picker Modal Controls
    document.getElementById('month-picker-prev-year')?.addEventListener('click', () => this.monthPickerNavigateYear(-1));
    document.getElementById('month-picker-next-year')?.addEventListener('click', () => this.monthPickerNavigateYear(1));
    document.getElementById('month-picker-quick-current')?.addEventListener('click', () => this.monthPickerSelectQuick('current'));
    document.getElementById('month-picker-quick-last')?.addEventListener('click', () => this.monthPickerSelectQuick('last'));
    document.getElementById('month-picker-confirm-btn')?.addEventListener('click', () => this.monthPickerConfirm());

    // Event Delegation: Month Picker Months Grid
    const monthPickerMonthsContainer = document.getElementById('month-picker-months-container');
    if (monthPickerMonthsContainer) {
      monthPickerMonthsContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-month-index]');
        if (btn) {
          const idx = parseInt(btn.getAttribute('data-month-index'), 10);
          this.monthPickerSelectMonth(idx);
        }
      });
    }



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
        const inputEl = document.getElementById('dialog-input');
        const isPrompt = inputEl && inputEl.style.display !== 'none';
        const val = isPrompt ? inputEl.value.trim() : true;
        if (inputEl) inputEl.style.display = 'none';
        this.closeModal('modal-custom-dialog');
        if (this.dialogResolve) this.dialogResolve(val);
      });
    }

    if (btnCancel) {
      btnCancel.addEventListener('click', () => {
        const inputEl = document.getElementById('dialog-input');
        const isPrompt = inputEl && inputEl.style.display !== 'none';
        if (inputEl) inputEl.style.display = 'none';
        this.closeModal('modal-custom-dialog');
        if (this.dialogResolve) this.dialogResolve(isPrompt ? null : false);
      });
    }

    const dialogInput = document.getElementById('dialog-input');
    if (dialogInput) {
      dialogInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          btnConfirm?.click();
        }
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
      // 1. إذا كانت هناك أي نافذة منبثقة مفتوحة، نغلق النافذة العلوية الأخيرة فقط
      const activeModals = Array.from(document.querySelectorAll('.modal-backdrop.active:not(#modal-auth)'));
      if (activeModals.length > 0) {
        const topModal = activeModals[activeModals.length - 1];
        topModal.classList.remove('active');
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
            'هل ترغب في الخروج من تطبيق ASCPT وإغلاقه؟',
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
    this.calendarSelectedDate = input?.value || getLocalDateStr(initDate);

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
      this.calendarSelectedDate = getLocalDateStr(today);
    } else if (type === 'yesterday') {
      const yest = new Date();
      yest.setDate(yest.getDate() - 1);
      this.calendarSelectedDate = getLocalDateStr(yest);
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

    const todayStr = getLocalDateStr();
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
        <button type="button" class="${cls}" data-month-index="${idx}">
          <div style="font-size: 0.95rem;">${name}</div>
          <div style="font-size: 0.72rem; opacity: 0.75;">(${numStr})</div>
        </button>
      `;
    }).join('');
  }





  // ================= Backup Reminder (local, no server/cost involved) =================
  // Purely informational: reads/writes a timestamp in this browser's
  // localStorage only. It never uploads anything anywhere, so it stays
  // free and requires no account linking of any kind.
  updateBackupStatusHint() {
    const hintEl = document.getElementById('backup-status-hint');
    if (!hintEl) return;
    const lastBackupRaw = localStorage.getItem('ascpt_last_backup_at');
    if (!lastBackupRaw) {
      hintEl.textContent = '⚠️ لم يتم عمل أي نسخة احتياطية بعد على هذا الجهاز.';
      hintEl.style.color = 'var(--danger)';
      return;
    }
    const lastBackup = new Date(lastBackupRaw);
    const daysSince = Math.floor((Date.now() - lastBackup.getTime()) / 86400000);
    const dateLabel = lastBackup.toLocaleDateString('ar-EG-u-nu-latn', { year: 'numeric', month: 'long', day: 'numeric' });
    if (daysSince >= 7) {
      hintEl.textContent = `⚠️ آخر نسخة احتياطية كانت منذ ${daysSince} يوم (${dateLabel}) — يُنصح بعمل نسخة جديدة الآن.`;
      hintEl.style.color = 'var(--danger)';
    } else {
      hintEl.textContent = `آخر نسخة احتياطية: ${dateLabel} (منذ ${daysSince} يوم).`;
      hintEl.style.color = 'var(--text-muted)';
    }
  }

  checkBackupReminderToast(user) {
    if (!user || user.role !== 'admin') return;
    const lastBackupRaw = localStorage.getItem('ascpt_last_backup_at');
    const daysSince = lastBackupRaw
      ? Math.floor((Date.now() - new Date(lastBackupRaw).getTime()) / 86400000)
      : Infinity;
    if (daysSince < 7) return;

    // Only nag once per calendar day, not on every page load/refresh.
    const todayStr = getLocalDateStr();
    if (localStorage.getItem('ascpt_backup_reminder_shown_on') === todayStr) return;
    localStorage.setItem('ascpt_backup_reminder_shown_on', todayStr);

    this.showToast(
      lastBackupRaw
        ? `تنبيه: آخر نسخة احتياطية كانت منذ ${daysSince} يوم. يُفضّل عمل نسخة جديدة من شاشة الإدارة.`
        : 'تنبيه: لم يتم عمل أي نسخة احتياطية بعد. يُفضّل عمل نسخة من شاشة الإدارة للحفاظ على بيانات المركز.'
    );
  }

  // ================= Backup & Restore =================
  async downloadBackup() {
    try {
      const backup = await db.createFullBackup();
      const str = JSON.stringify(backup, null, 2);
      const blob = new Blob([str], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const dateStr = getLocalDateStr();
      a.href = url;
      a.download = `نسخة_احتياطية_ASCPT_${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      localStorage.setItem('ascpt_last_backup_at', new Date().toISOString());
      this.updateBackupStatusHint();
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
    if (this.financeManager && typeof this.financeManager.populateExpenseCategoriesDropdown === 'function') {
      this.financeManager.populateExpenseCategoriesDropdown();
    }
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
      const contractType = opt.getAttribute('data-contract') || '';
      let badgeHtml = '';
      if (contractType === 'direct') {
        badgeHtml = `<span class="badge" style="font-size: 0.72rem; padding: 2px 8px; font-weight: 800; background: rgba(56, 189, 248, 0.15); color: var(--primary); border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 6px; white-space: nowrap;">تعاقد مباشر</span>`;
      } else if (contractType === 'indirect') {
        badgeHtml = `<span class="badge" style="font-size: 0.72rem; padding: 2px 8px; font-weight: 800; background: rgba(251, 191, 36, 0.15); color: var(--warning); border: 1px solid rgba(251, 191, 36, 0.3); border-radius: 6px; white-space: nowrap;">تعاقد غير مباشر</span>`;
      }

      // Clean company display name by removing the parenthetical contract tag if present
      const cleanLabel = opt.text.replace(/\s*\((تعاقد مباشر|تعاقد غير مباشر)\)\s*/g, '').trim();

      return `
        <div class="custom-picker-row ${isSelected ? 'active-choice' : ''}" data-select-id="${selectId}" data-select-value="${escapeHTML(opt.value)}" style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
          <span style="font-weight: 700; color: var(--text-main);">${escapeHTML(cleanLabel)}</span>
          <div style="display: flex; align-items: center; gap: 8px;">
            ${badgeHtml}
            ${isSelected ? '<i class="fa-solid fa-check check-icon" style="color: var(--primary);"></i>' : ''}
          </div>
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

  // ================= Universal Multi-Select & Option Management Custom Picker =================
  openMultiPicker({ category, title, currentSelected = [], onConfirm, isSingleSelect = false, contractType = null }) {
    this.activeMultiPicker = {
      category,
      title,
      selected: isSingleSelect ? (currentSelected ? [currentSelected] : []) : [...currentSelected],
      onConfirm,
      isSingleSelect,
      contractType
    };

    const titleEl = document.getElementById('multi-picker-title');
    if (titleEl) titleEl.innerHTML = `<i class="fa-solid fa-list-check" style="color: var(--primary);"></i> ${title}`;

    const confirmBtn = document.getElementById('btn-multi-picker-confirm');
    if (confirmBtn) {
      confirmBtn.style.display = isSingleSelect ? 'none' : 'inline-flex';
    }

    this.renderMultiPickerOptions();
    this.openModal('modal-multi-picker');
  }

  renderMultiPickerOptions() {
    if (!this.activeMultiPicker) return;
    const { category, selected, isSingleSelect, contractType } = this.activeMultiPicker;
    const container = document.getElementById('multi-picker-options-list');
    if (!container) return;

    let options = [];
    if (category === 'insurance_company') {
      if (contractType) {
        options = db.getInsuranceCompanies(contractType).map(c => ({ name: c, contract: contractType }));
      } else {
        const direct = db.getInsuranceCompanies('direct').map(c => ({ name: c, contract: 'direct' }));
        const indirect = db.getInsuranceCompanies('indirect').map(c => ({ name: c, contract: 'indirect' }));
        options = [...direct, ...indirect];
      }
    } else if (category === 'card_treatments') {
      const modalities = (typeof db !== 'undefined' && db.getClinicalOptions) ? db.getClinicalOptions('modality') : [];
      const defaultTreatments = ['pulsed Ultrasound', 'Heat application', 'Interferential current', 'Therapeutic ex', 'Laser Therapy', 'Cryotherapy'];
      options = Array.from(new Set([...defaultTreatments, ...modalities]));
    } else {
      options = db.getClinicalOptions(category);
    }

    const filtered = options;

    if (filtered.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); padding: 24px; font-size: 0.88rem;">
          <i class="fa-solid fa-folder-open" style="font-size: 1.5rem; display: block; margin-bottom: 8px; color: var(--text-muted);"></i>
          لا توجد خيارات مضافة حالياً. اضغط على "إضافة خيار" بالأسفل لإضافة أول عنصر.
        </div>
      `;
      this.updateMultiPickerConfirmBtn();
      return;
    }

    container.innerHTML = filtered.map(opt => {
      const name = typeof opt === 'object' ? opt.name : opt;
      const cType = typeof opt === 'object' ? opt.contract : '';
      const isSelected = selected.includes(name);

      let badgeHtml = '';
      if (cType === 'direct') {
        badgeHtml = `<span class="badge" style="font-size: 0.72rem; padding: 2px 8px; font-weight: 800; background: rgba(56, 189, 248, 0.15); color: var(--primary); border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 6px;">تعاقد مباشر</span>`;
      } else if (cType === 'indirect') {
        badgeHtml = `<span class="badge" style="font-size: 0.72rem; padding: 2px 8px; font-weight: 800; background: rgba(251, 191, 36, 0.15); color: var(--warning); border: 1px solid rgba(251, 191, 36, 0.3); border-radius: 6px;">تعاقد غير مباشر</span>`;
      }

      const iconClass = isSingleSelect
        ? (isSelected ? 'fa-solid fa-circle-dot' : 'fa-regular fa-circle')
        : (isSelected ? 'fa-solid fa-square-check' : 'fa-regular fa-square');

      return `
        <div class="multi-picker-row ${isSelected ? 'selected active-choice' : ''}" data-val="${escapeHTML(name)}" data-contract="${escapeHTML(cType)}" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-radius: 8px; border: 1.5px solid ${isSelected ? 'var(--primary)' : 'var(--border-color)'}; background: ${isSelected ? 'var(--primary-light)' : 'var(--bg-surface)'}; cursor: pointer; transition: all 0.15s ease;">
          <div style="display: flex; align-items: center; gap: 10px; flex: 1;">
            <i class="${iconClass}" style="color: ${isSelected ? 'var(--primary)' : 'var(--text-muted)'}; font-size: 1.15rem; flex-shrink: 0;"></i>
            <span style="font-weight: 700; font-size: 0.9rem; color: var(--text-main);">${escapeHTML(name)}</span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            ${badgeHtml}
            <button type="button" class="btn-delete-option-direct" data-action="delete-multi-option" data-val="${escapeHTML(name)}" data-contract="${escapeHTML(cType)}" style="background: none; border: none; color: #ef4444; padding: 4px 6px; cursor: pointer; font-size: 0.9rem; border-radius: 4px;" title="حذف من النظام">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');

    this.updateMultiPickerConfirmBtn();
  }

  updateMultiPickerConfirmBtn() {
    if (!this.activeMultiPicker || this.activeMultiPicker.isSingleSelect) return;
    const count = this.activeMultiPicker.selected.length;
    const txt = document.getElementById('multi-picker-confirm-text');
    if (txt) {
      txt.textContent = `تأكيد الاختيار (${count})`;
    }
  }

  toggleMultiPickerOption(val, contractType = '') {
    if (!this.activeMultiPicker) return;
    const { isSingleSelect, selected, onConfirm } = this.activeMultiPicker;

    if (isSingleSelect) {
      this.activeMultiPicker.selected = [val];
      if (typeof onConfirm === 'function') {
        onConfirm(val, contractType);
      }
      this.closeModal('modal-multi-picker');
      return;
    }

    const idx = selected.indexOf(val);
    if (idx >= 0) {
      selected.splice(idx, 1);
    } else {
      selected.push(val);
    }

    this.renderMultiPickerOptions();
  }

  confirmMultiPickerSelection() {
    if (!this.activeMultiPicker) return;
    const { selected, onConfirm } = this.activeMultiPicker;
    if (typeof onConfirm === 'function') {
      onConfirm(selected);
    }
    this.closeModal('modal-multi-picker');
  }

  async handleMultiPickerAddNew() {
    if (!this.activeMultiPicker) return;
    const { category, contractType } = this.activeMultiPicker;

    const titles = {
      modality: 'إضافة وسيلة فيزيائية جديدة',
      procedure: 'إضافة إجراء علاجي يدوي جديد',
      exercise: 'إضافة تمرين علاجي جديد',
      body_parts: 'إضافة عضو أو منطقة علاجية جديدة',
      card_treatments: 'إضافة وسيلة جديدة لكارت التردد',
      insurance_company: 'إضافة شركة تأمين جديدة'
    };
    const title = titles[category] || 'إضافة خيار جديد';

    const val = await this.showPrompt(
      'اكتب اسم العنصر الجديد لإضافته بشكل دائم للنظام:',
      title,
      'اكتب الاسم هنا...'
    );

    if (val && val.trim()) {
      const cleanVal = val.trim();
      if (category === 'insurance_company') {
        const cType = contractType || 'direct';
        await db.addInsuranceCompany(cType, cleanVal);
        this.activeMultiPicker.selected = [cleanVal];
        if (typeof this.activeMultiPicker.onConfirm === 'function') {
          this.activeMultiPicker.onConfirm(cleanVal, cType);
        }
        this.showToast(`تمت إضافة شركة التأمين: ${cleanVal}`);
        this.closeModal('modal-multi-picker');
        return;
      } else if (category === 'card_treatments') {
        await db.addClinicalOption('modality', cleanVal);
      } else {
        await db.addClinicalOption(category, cleanVal);
      }

      if (!this.activeMultiPicker.selected.includes(cleanVal)) {
        this.activeMultiPicker.selected.push(cleanVal);
      }
      this.showToast(`تمت إضافة: ${cleanVal}`);
      this.renderMultiPickerOptions();
    }
  }

  async handleMultiPickerDeleteOption(val, optContract) {
    if (!this.activeMultiPicker) return;
    const { category, contractType } = this.activeMultiPicker;

    const confirmed = await this.showConfirm(`هل أنت متأكد من حذف "${val}" نهائياً من النظام؟`, 'حذف عنصر');
    if (!confirmed) return;

    if (category === 'insurance_company') {
      const cType = optContract || contractType || 'direct';
      await db.deleteInsuranceCompany(cType, val);
      this.activeMultiPicker.selected = this.activeMultiPicker.selected.filter(x => x !== val);
    } else if (category === 'card_treatments') {
      await db.deleteClinicalOption('modality', val);
      this.activeMultiPicker.selected = this.activeMultiPicker.selected.filter(x => x !== val);
    } else {
      await db.deleteClinicalOption(category, val);
      this.activeMultiPicker.selected = this.activeMultiPicker.selected.filter(x => x !== val);
    }

    this.showToast(`تم حذف: ${val}`);
    this.renderMultiPickerOptions();
  }

  showAlert(message, title = 'تنبيه المركز', type = 'info') {
    return new Promise((resolve) => {
      this.dialogResolve = resolve;
      const inputEl = document.getElementById('dialog-input'); if (inputEl) inputEl.style.display = 'none';
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
      const inputEl = document.getElementById('dialog-input'); if (inputEl) inputEl.style.display = 'none';
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

  showPrompt(message, title = 'إدخال بيانات', placeholder = '', isPassword = false) {
    return new Promise((resolve) => {
      this.dialogResolve = resolve;
      const titleEl = document.getElementById('dialog-title');
      const msgEl = document.getElementById('dialog-message');
      const iconEl = document.getElementById('dialog-icon');
      const inputEl = document.getElementById('dialog-input');
      const btnCancel = document.getElementById('dialog-btn-cancel');
      const btnConfirm = document.getElementById('dialog-btn-confirm');

      if (titleEl) titleEl.textContent = title;
      if (msgEl) msgEl.textContent = message;
      if (btnCancel) {
        btnCancel.style.display = 'inline-flex';
        btnCancel.textContent = 'إلغاء';
      }
      if (btnConfirm) {
        btnConfirm.textContent = 'تأكيد';
        btnConfirm.className = 'btn btn-primary';
      }

      if (inputEl) {
        inputEl.style.display = 'block';
        inputEl.value = '';
        inputEl.placeholder = placeholder;
        inputEl.style.webkitTextSecurity = isPassword ? 'disc' : 'none';
      }

      if (iconEl) {
        iconEl.className = 'custom-dialog-icon info';
        iconEl.innerHTML = isPassword ? '<i class="fa-solid fa-key"></i>' : '<i class="fa-solid fa-pen-to-square"></i>';
      }

      this.openModal('modal-custom-dialog');
      setTimeout(() => {
        if (inputEl) inputEl.focus();
      }, 150);
    });
  }

  openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add('active');
      const transientModals = [
        'modal-auth',
        'modal-custom-dialog',
        'modal-custom-picker',
        'modal-custom-calendar',
        'modal-custom-month-picker'
      ];
      if (!transientModals.includes(modalId)) {
        history.pushState({ modal: modalId, view: this.currentView }, '');
      }
    }
  }

  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('active');
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
    const doctorObjects = await db.getDoctorsList();

    const pDoc = document.getElementById('p-doctor');
    if (pDoc) {
      const prev = pDoc.value;
      pDoc.innerHTML = doctorObjects.map(d =>
        `<option value="${escapeHTML(d.name)}" data-uid="${escapeHTML(d.uid)}">${escapeHTML(d.name)}</option>`
      ).join('');
      if (prev && doctorObjects.some(d => d.name === prev)) pDoc.value = prev;
    }

    const sessDoc = document.getElementById('session-doctor-select');
    if (sessDoc) {
      const prev = sessDoc.value;
      sessDoc.innerHTML = doctorObjects.map(d =>
        `<option value="${escapeHTML(d.name)}" data-uid="${escapeHTML(d.uid)}">${escapeHTML(d.name)}</option>`
      ).join('');
      if (prev && doctorObjects.some(d => d.name === prev)) sessDoc.value = prev;
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
