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
    const role = currentUser ? currentUser.role : ROLES.ADMIN;
    const body = document.body;

    // تفعيل Body Class لدعم الحجب الصارم عبر CSS فورياً
    body.classList.remove('role-admin', 'role-doctor', 'role-receptionist');
    body.classList.add('role-' + role);

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
      } else {
        // المدير يرى كل شيء
        item.style.setProperty('display', 'flex', 'important');
      }
    });

    // 2. التبديل الذكي بين لوحة الإدارة ولوحة الطبيب المعالج في الشاشة الرئيسية
    const adminDashboard = document.getElementById('dashboard-admin-view');
    const doctorDashboard = document.getElementById('dashboard-doctor-view');

    if (role === ROLES.DOCTOR) {
      if (adminDashboard) adminDashboard.style.display = 'none';
      if (doctorDashboard) doctorDashboard.style.display = 'block';
      if (window.doctorDashboardManager) {
        window.doctorDashboardManager.render();
      }
    } else {
      if (adminDashboard) adminDashboard.style.display = 'block';
      if (doctorDashboard) doctorDashboard.style.display = 'none';
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
    return currentUser && currentUser.role === ROLES.ADMIN;
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
