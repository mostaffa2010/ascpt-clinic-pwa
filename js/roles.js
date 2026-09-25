// ========================================================
// ASCPT - Roles & Permissions System (RBAC)
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
      let isVisible = true;
      if (role === ROLES.DOCTOR) {
        isVisible = (view === 'dashboard' || view === 'patients');
      } else if (role === ROLES.RECEPTIONIST) {
        // السكرتارية ترى الرئيسية، المرضى، الجلسات، الحسابات (وتُحجب لوحة المدير فقط)
        isVisible = (view !== 'admin');
      } else if (role === ROLES.ADMIN) {
        // المدير يرى كل شيء
        isVisible = true;
      } else {
        // زائر غير مسجل: إخفاء الجلسات والحسابات الحساسة
        isVisible = (view === 'dashboard' || view === 'patients');
      }
      item.classList.toggle('d-none', !isVisible);
      item.style.removeProperty('display');
    });

    // 2. التبديل الذكي بين لوحة الإدارة ولوحة الطبيب المعالج في الشاشة الرئيسية
    const adminDashboard = document.getElementById('dashboard-admin-view');
    const doctorDashboard = document.getElementById('dashboard-doctor-view');

    if (role === ROLES.DOCTOR) {
      if (adminDashboard) {
        adminDashboard.classList.add('d-none');
        adminDashboard.style.removeProperty('display');
      }
      if (doctorDashboard) {
        doctorDashboard.classList.remove('d-none');
        doctorDashboard.style.removeProperty('display');
      }
      if (window.doctorDashboardManager) {
        window.doctorDashboardManager.render();
      }
    } else {
      if (adminDashboard) {
        adminDashboard.classList.remove('d-none');
        adminDashboard.style.removeProperty('display');
      }
      if (doctorDashboard) {
        doctorDashboard.classList.add('d-none');
        doctorDashboard.style.removeProperty('display');
      }
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
      el.classList.toggle('d-none', role !== ROLES.ADMIN);
      el.style.removeProperty('display');
    });

    // 4. زر إضافة مريض جديد (متاح للاستقبال والمدير فقط، ومخفي تماماً عن الطبيب)
    const addPatientBtn = document.getElementById('btn-open-add-patient');
    if (addPatientBtn) {
      addPatientBtn.classList.toggle('d-none', role === ROLES.DOCTOR);
      addPatientBtn.style.removeProperty('display');
    }

    // 5. إعادة رسم جدول المرضى لتطبيق إخفاء أزرار التعديل والحذف للطبيب (إذا كانت البيانات محملة مسبقاً)
    if (window.patientsManager && typeof window.patientsManager.renderPatients === 'function' && window.patientsManager._hasLoadedOnce) {
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
