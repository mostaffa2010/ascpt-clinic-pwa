// ========================================================
// PhysioFlow - Roles & Permissions System (RBAC)
// ========================================================

export const ROLES = {
  ADMIN: 'admin',
  DOCTOR: 'doctor',
  RECEPTIONIST: 'receptionist'
};

export const ROLE_LABELS = {
  admin: 'مدير المركز',
  doctor: 'طبيب معالج',
  receptionist: 'سكرتارية / استقبال'
};

export class RolesManager {
  static getRoleLabel(role) {
    return ROLE_LABELS[role] || role;
  }

  static applyPermissions(currentUser) {
    if (!currentUser) {
      try {
        const raw = localStorage.getItem('ascpt_cached_user');
        if (raw) currentUser = JSON.parse(raw);
      } catch (_) {}
    }

    const role = currentUser ? currentUser.role : null;
    const body = document.body;
    const docEl = document.documentElement;

    // تفعيل Body & HTML Class لدعم الحجب الصارم عبر CSS فورياً
    body.classList.remove('role-admin', 'role-doctor', 'role-receptionist');
    docEl.classList.remove('role-admin', 'role-doctor', 'role-receptionist');
    if (role) {
      body.classList.add('role-' + role);
      docEl.classList.add('role-' + role);
    }

    // 1. التحكم في أشرطة التنقل (Sidebar & Mobile Bottom Nav)
    // الطبيب المعالج: يرى "الرئيسية (الخاصة بحالاته)" و "سجل المرضى العام" فقط
    const navItems = document.querySelectorAll('.nav-link, .b-nav-item');
    navItems.forEach(item => {
      const view = item.getAttribute('data-view');
      if (role === ROLES.DOCTOR) {
        item.style.setProperty('display', (view === 'dashboard' || view === 'patients') ? 'flex' : 'none', 'important');
      } else if (role === ROLES.RECEPTIONIST) {
        // السكرتارية ترى الرئيسية، المرضى، الجلسات، الحسابات (وتُحجب لوحة المدير فقط)
        item.style.setProperty('display', view === 'admin' ? 'none' : 'flex', 'important');
      } else if (role === ROLES.ADMIN) {
        // المدير يرى كل شيء
        item.style.setProperty('display', 'flex', 'important');
      } else {
        // زائر غير مسجل: إخفاء الجلسات والحسابات الحساسة
        item.style.setProperty('display', (view === 'dashboard' || view === 'patients') ? 'flex' : 'none', 'important');
      }
    });

    // 2. التبديل الذكي بين لوحة الإدارة ولوحة الطبيب المعالج في الشاشة الرئيسية
    const adminDashboard = document.getElementById('dashboard-admin-view');
    const doctorDashboard = document.getElementById('dashboard-doctor-view');

    if (role === ROLES.DOCTOR) {
      if (adminDashboard) adminDashboard.style.setProperty('display', 'none', 'important');
      if (doctorDashboard) doctorDashboard.style.setProperty('display', 'block', 'important');
      if (window.doctorDashboardManager) {
        window.doctorDashboardManager.render();
      }
    } else {
      if (adminDashboard) adminDashboard.style.setProperty('display', 'block', 'important');
      if (doctorDashboard) doctorDashboard.style.setProperty('display', 'none', 'important');
    }

    // 3. حماية التنقل: توجيه الطبيب للرئيسية إذا كان يقف على شاشة محجوبة (الحسابات/الجلسات/المدير)
    if (role === ROLES.DOCTOR && window.app) {
      const allowedViews = ['dashboard', 'patients', 'patient-sheet'];
      if (!allowedViews.includes(window.app.currentView)) {
        window.app.switchView('dashboard');
      }
    }

    // 3. عناصر خاصة بالمدير فقط (Admin Only)
    const adminElements = document.querySelectorAll('.admin-only');
    adminElements.forEach(el => {
      el.style.setProperty('display', role === ROLES.ADMIN ? '' : 'none', 'important');
    });

    // 4. زر إضافة مريض جديد (متاح للاستقبال والمدير فقط، ومخفي تماماً عن الطبيب)
    const addPatientBtn = document.getElementById('btn-open-add-patient');
    if (addPatientBtn) {
      addPatientBtn.style.setProperty('display', role === ROLES.DOCTOR ? 'none' : '', 'important');
    }

    // 5. إعادة رسم جدول المرضى لتطبيق إخفاء أزرار التعديل والحذف للطبيب
    if (window.patientsManager && typeof window.patientsManager.renderPatients === 'function') {
      window.patientsManager.renderPatients();
    }
  }

  // صلاحية الحذف العامة (للجلسات والحسابات)
  static canDelete(currentUser) {
    return currentUser && (currentUser.role === ROLES.ADMIN || currentUser.role === ROLES.RECEPTIONIST);
  }

  // حذف المرضى متاح للمدير والاستقبال (ممنوع تماماً على الطبيب المعالج)
  static canDeletePatient(currentUser) {
    return currentUser && (currentUser.role === ROLES.ADMIN || currentUser.role === ROLES.RECEPTIONIST);
  }

  // حذف وتعديل الحسابات والمصروفات متاح للمدير فقط
  static canDeleteFinance(currentUser) {
    if (!currentUser) return false;
    const role = (currentUser.role || "").toLowerCase();
    return role === ROLES.ADMIN || role === "admin" || currentUser.isAdmin === true;
  }

  // الدخول والاطلاع على الشيت الطبي متاح للأطباء والمدير
  static canAccessClinicalSheet(currentUser) {
    return currentUser && (currentUser.role === ROLES.ADMIN || currentUser.role === ROLES.DOCTOR);
  }

  // طباعة وتصدير الشيت الطبي متاح للأطباء والمدير
  static canPrintSheet(currentUser) {
    return currentUser && (currentUser.role === ROLES.ADMIN || currentUser.role === ROLES.DOCTOR);
  }

  // إدارة المستخدمين والأزرار للمدير فقط
  static canManageUsers(currentUser) {
    return currentUser && currentUser.role === ROLES.ADMIN;
  }
}
