// ========================================================
// ASCPT - Lightweight Universal Localization Engine (i18n)
// Zero-Dependency, Offline-First, Per-Device Storage
// Strict Medical Data Preservation: Patient names & clinical
// database records remain strictly Arabic / unchanged.
// ========================================================

export const TRANSLATIONS = {
  ar: {
    // Branding & Navigation
    app_brand: 'ASCPT',
    app_full_name: 'مركز الإسكندرية التخصصي للعلاج الطبيعي',
    nav_dashboard: 'الرئيسية',
    nav_patients: 'سجل المرضى',
    nav_sessions: 'تسجيل الجلسات',
    nav_finance: 'الحسابات والتقرير اليومي',
    nav_appointments: 'جدول المواعيد',
    nav_admin: 'لوحة المدير والصلاحيات',
    bnav_dashboard: 'الرئيسية',
    bnav_patients: 'المرضى',
    bnav_sessions: 'الجلسات',
    bnav_finance: 'الحسابات',
    bnav_appointments: 'المواعيد',

    // Top Header
    header_login: 'تسجيل الدخول',
    header_profile_title: 'الملف الشخصي وإعدادات الحساب (اضغط للعرض)',
    header_notifications: 'مركز الإشعارات',
    header_notifications_title: 'الإشعارات',
    header_mark_all_read: 'قراءة الكل',
    header_lang_toggle_title: 'تبديل اللغة / Change Language',

    // Profile & Settings Modal
    profile_modal_title: 'الملف الشخصي',
    profile_modal_subtitle: 'بيانات وإعدادات حساب المستخدم',
    profile_push_title: 'الإشعارات الفورية (Push)',
    profile_push_desc: 'تلقي تنبيهات المرضى والمواعيد',
    profile_push_btn: 'تفعيل',
    profile_admin_panel: 'لوحة المدير والصلاحيات',
    profile_theme_dark: 'الوضع الليلي (داكن)',
    profile_theme_light: 'الوضع النهاري (فاتح)',
    profile_lang_label: 'اللغة: English',
    profile_change_pwd: 'تغيير كلمة المرور',
    profile_logout: 'تسجيل الخروج / تبديل الحساب',
    profile_footer_tag: 'نظام آمن • إدارة المراكز الطبية',

    // Roles
    role_admin: 'مدير المركز',
    role_doctor: 'طبيب معالج',
    role_receptionist: 'سكرتارية / استقبال',

    // Global Core Actions
    btn_close: 'إغلاق',
    btn_save: 'حفظ',
    btn_cancel: 'إلغاء',
    btn_edit: 'تعديل',
    btn_delete: 'حذف',
    btn_print: 'طباعة',
    btn_search: 'بحث',
    btn_add_patient: 'إضافة مريض جديد',
    btn_refresh: 'تحديث',
    btn_apply: 'تطبيق',
    btn_confirm: 'تأكيد',

    // Common Messages
    toast_switched_en: 'Switched to English 🌐',
    toast_switched_ar: 'تم التحويل إلى اللغة العربية 🌐',
    active_account: 'الحساب نشط'
  },
  en: {
    // Branding & Navigation
    app_brand: 'ASCPT',
    app_full_name: 'Alexandria Specialized Center for Physical Therapy',
    nav_dashboard: 'Dashboard',
    nav_patients: 'Patients Directory',
    nav_sessions: 'Sessions Log',
    nav_finance: 'Finance & Reports',
    nav_appointments: 'Appointments',
    nav_admin: 'Administration',
    bnav_dashboard: 'Home',
    bnav_patients: 'Patients',
    bnav_sessions: 'Sessions',
    bnav_finance: 'Finance',
    bnav_appointments: 'Schedule',

    // Top Header
    header_login: 'Login',
    header_profile_title: 'User Profile & Settings (Click to view)',
    header_notifications: 'Notification Center',
    header_notifications_title: 'Notifications',
    header_mark_all_read: 'Mark all read',
    header_lang_toggle_title: 'Change Language / تبديل اللغة',

    // Profile & Settings Modal
    profile_modal_title: 'User Profile',
    profile_modal_subtitle: 'Account details & settings',
    profile_push_title: 'Push Notifications',
    profile_push_desc: 'Receive patient & appointment alerts',
    profile_push_btn: 'Enable',
    profile_admin_panel: 'Admin Panel & Roles',
    profile_theme_dark: 'Dark Mode',
    profile_theme_light: 'Light Mode',
    profile_lang_label: 'Language: العربية',
    profile_change_pwd: 'Change Password',
    profile_logout: 'Logout / Switch Account',
    profile_footer_tag: 'Secure System • Clinic Management',

    // Roles
    role_admin: 'Clinic Director',
    role_doctor: 'Treating Doctor',
    role_receptionist: 'Reception / Front Desk',

    // Global Core Actions
    btn_close: 'Close',
    btn_save: 'Save',
    btn_cancel: 'Cancel',
    btn_edit: 'Edit',
    btn_delete: 'Delete',
    btn_print: 'Print',
    btn_search: 'Search',
    btn_add_patient: 'Add New Patient',
    btn_refresh: 'Refresh',
    btn_apply: 'Apply',
    btn_confirm: 'Confirm',

    // Common Messages
    toast_switched_en: 'Switched to English 🌐',
    toast_switched_ar: 'تم التحويل إلى اللغة العربية 🌐',
    active_account: 'Account Active'
  }
};

class I18nService {
  constructor() {
    this.currentLanguage = this.getStoredLanguage();
    if (typeof window !== 'undefined') {
      window.i18n = this;
    }
    if (typeof globalThis !== 'undefined') {
      globalThis.i18n = this;
    }
  }

  getStoredLanguage() {
    try {
      if (typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem('ascpt_language');
        return (stored === 'en') ? 'en' : 'ar';
      }
    } catch (_) {}
    return 'ar';
  }

  getLanguage() {
    return this.currentLanguage;
  }

  isRTL() {
    return this.currentLanguage === 'ar';
  }

  t(key, fallback = '') {
    const lang = this.currentLanguage;
    if (TRANSLATIONS[lang] && TRANSLATIONS[lang][key] !== undefined) {
      return TRANSLATIONS[lang][key];
    }
    if (TRANSLATIONS.ar && TRANSLATIONS.ar[key] !== undefined) {
      return TRANSLATIONS.ar[key];
    }
    return fallback || key;
  }

  setLanguage(lang) {
    if (lang !== 'ar' && lang !== 'en') return;
    this.currentLanguage = lang;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('ascpt_language', lang);
      }
    } catch (_) {}

    if (typeof document !== 'undefined') {
      const docEl = document.documentElement;
      docEl.setAttribute('lang', lang);
      // Strictly maintain dir="rtl" to protect mobile touch hit-testing and avoid UI freeze
      docEl.setAttribute('dir', 'rtl');
      if (document.body) {
        document.body.setAttribute('dir', 'rtl');
      }

      if (lang === 'en') {
        docEl.classList.add('lang-en');
        docEl.classList.remove('lang-ar');
        if (document.body) {
          document.body.classList.add('lang-en');
          document.body.classList.remove('lang-ar');
        }
      } else {
        docEl.classList.add('lang-ar');
        docEl.classList.remove('lang-en');
        if (document.body) {
          document.body.classList.add('lang-ar');
          document.body.classList.remove('lang-en');
        }
      }

      this.applyTranslations();
    }

    try {
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new CustomEvent('ascpt-language-changed', {
          detail: { language: lang, isRTL: lang === 'ar' }
        }));
      }
    } catch (_) {}
  }

  applyTranslations() {
    if (typeof document === 'undefined') return;
    const lang = this.currentLanguage;

    // 1. Elements with data-i18n
    const elements = document.querySelectorAll('[data-i18n]');
    elements.forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (key && TRANSLATIONS[lang] && TRANSLATIONS[lang][key] !== undefined) {
        el.textContent = TRANSLATIONS[lang][key];
      }
    });

    // 2. Elements with data-i18n-title
    const titleElements = document.querySelectorAll('[data-i18n-title]');
    titleElements.forEach(el => {
      const key = el.getAttribute('data-i18n-title');
      if (key && TRANSLATIONS[lang] && TRANSLATIONS[lang][key] !== undefined) {
        el.setAttribute('title', TRANSLATIONS[lang][key]);
      }
    });

    // 3. Elements with data-i18n-placeholder
    const placeholderElements = document.querySelectorAll('[data-i18n-placeholder]');
    placeholderElements.forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (key && TRANSLATIONS[lang] && TRANSLATIONS[lang][key] !== undefined) {
        el.setAttribute('placeholder', TRANSLATIONS[lang][key]);
      }
    });

    // 4. Update Header Toggle Buttons Text
    const headerToggleText = document.getElementById('lang-toggle-text');
    if (headerToggleText) {
      headerToggleText.textContent = (lang === 'ar') ? 'EN' : 'عربي';
    }
    const headerToggleBtn = document.getElementById('btn-lang-toggle');
    if (headerToggleBtn) {
      headerToggleBtn.setAttribute('title', (lang === 'ar') ? 'Switch to English' : 'التحويل للغة العربية');
    }

    const desktopToggleText = document.getElementById('lang-toggle-text-desktop');
    if (desktopToggleText) {
      desktopToggleText.textContent = (lang === 'ar') ? 'EN' : 'عربي';
    }

    // 5. Update Profile Modal Language Row
    const profileLangLabel = document.getElementById('profile-lang-label');
    if (profileLangLabel) {
      profileLangLabel.textContent = (lang === 'ar') ? 'اللغة: English' : 'Language: العربية';
    }
    const profileLangBadge = document.getElementById('profile-lang-badge');
    if (profileLangBadge) {
      profileLangBadge.textContent = (lang === 'ar') ? 'EN' : 'AR';
    }
  }

  init() {
    const lang = this.getStoredLanguage();
    this.setLanguage(lang);
  }
}

export const i18n = new I18nService();
