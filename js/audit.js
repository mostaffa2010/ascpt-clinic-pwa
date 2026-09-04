// ========================================================
// ASCPT - Staff User Management & Audit Trail Module
// Real Firebase Authentication & Cloud Firestore Provisioning
// ========================================================

import { initializeApp, deleteApp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signOut as secondarySignOut,
  updateProfile
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import {
  doc,
  setDoc,
  deleteDoc,
  getDocs,
  collection,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

import { CLINIC_CONFIG } from './clinic-config.js';
import { firestoreDb } from './firebase-init.js';
import { db } from './db.js';
import { auth } from './auth.js';
import { RolesManager } from './roles.js';
import { escapeHTML } from './utils.js';

export class AuditAndAdminManager {
  constructor(app) {
    this.app = app;
  }

  async init() {
    this.bindEvents();
    await this.loadUsers();
    await this.loadAuditLogs();
  }

  bindEvents() {
    const formAddUser = document.getElementById('form-add-user');
    if (formAddUser) {
      formAddUser.addEventListener('submit', (e) => this.handleAddUser(e));
    }

    const usersTbody = document.getElementById('admin-users-tbody');
    if (usersTbody) {
      usersTbody.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-delete-user');
        if (btn) {
          const userId = btn.getAttribute('data-user-id');
          const userName = btn.getAttribute('data-user-name');
          this.deleteUser(userId, userName);
        }
      });
    }
  }

  async handleAddUser(e) {
    e.preventDefault();
    const currentUser = auth.getCurrentUser();
    if (!RolesManager.canManageUsers(currentUser)) {
      await this.app.showAlert('عذراً، هذه الصلاحية لمدير المركز فقط.', 'تنبيه', 'warning');
      return;
    }

    const nameInput = document.getElementById('newuser-name');
    const emailInput = document.getElementById('newuser-email');
    const passwordInput = document.getElementById('newuser-password');
    const roleInput = document.getElementById('newuser-role');
    const btnSubmit = e.target.querySelector('button[type="submit"]');

    const name = nameInput?.value?.trim();
    const email = emailInput?.value?.trim().toLowerCase();
    const password = passwordInput?.value;
    const role = roleInput?.value;

    if (!name || name.length < 3) {
      await this.app.showAlert('يرجى إدخال اسم صحيح للموظف (3 أحرف على الأقل).', 'بيانات غير مكتملة', 'warning');
      nameInput?.focus();
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      await this.app.showAlert('يرجى إدخال بريد إلكتروني صحيح (مثال: doctor@ascpt.com).', 'بريد إلكتروني غير صالح', 'warning');
      emailInput?.focus();
      return;
    }

    if (!password || password.length < 6) {
      await this.app.showAlert('كلمة المرور يجب ألا تقل عن 6 خانات/أحرف لضمان الأمان.', 'كلمة المرور قصيرة', 'warning');
      passwordInput?.focus();
      return;
    }

    if (!role) {
      await this.app.showAlert('يرجى اختيار الصلاحية / الدور الوظيفي للمستخدم.', 'الدور مطلوب', 'warning');
      return;
    }

    const origBtnHtml = btnSubmit ? btnSubmit.innerHTML : '';
    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>جاري إنشاء الحساب في Firebase...</span>';
    }

    let tempApp = null;

    try {
      // 1. Create User in Firebase Authentication using an isolated secondary App instance
      // This guarantees the currently logged-in Admin session is NOT interrupted or signed out!
      const tempAppName = 'staff_provisioning_' + Date.now();
      tempApp = initializeApp(CLINIC_CONFIG.firebase, tempAppName);
      const tempAuth = getAuth(tempApp);

      const userCredential = await createUserWithEmailAndPassword(tempAuth, email, password);
      const newFirebaseUser = userCredential.user;

      try {
        await updateProfile(newFirebaseUser, { displayName: name });
      } catch (_) {}

      const newUid = newFirebaseUser.uid;

      // Immediately sign out and clean up the secondary app instance
      await secondarySignOut(tempAuth);
      try { await deleteApp(tempApp); } catch (_) {}
      tempApp = null;

      // 2. Write user profile document in Cloud Firestore under users/{newUid}
      const userProfileData = {
        uid: newUid,
        id: newUid,
        name,
        email,
        role,
        active: true,
        createdAt: new Date().toISOString(),
        createdBy: currentUser.uid || currentUser.id || 'admin',
        createdByName: currentUser.name || 'مدير المركز'
      };

      if (firestoreDb) {
        try {
          await setDoc(doc(firestoreDb, 'users', newUid), userProfileData);
        } catch (fsErr) {
          console.warn('Firestore profile write notice:', fsErr);
        }
      }

      // 3. Save to local cache in db layer for instant synchronization
      await db.saveUser(userProfileData);
      await db.logAudit('إضافة موظف', `قام المدير بإنشاء حساب حقيقي في Firebase للموظف: ${name} بدور: ${RolesManager.getRoleLabel(role)} (${email})`, currentUser);

      // 4. Refresh Doctor dropdowns across the application
      await this.app.populateDoctorDropdowns();

      // Reset form and notify
      e.target.reset();
      this.app.showToast(`تم إنشاء حساب ${name} بنجاح ويمكنه الآن تسجيل الدخول.`);

      await this.loadUsers();
      await this.loadAuditLogs();
    } catch (err) {
      console.error('Error creating staff member in Firebase:', err);
      if (tempApp) {
        try { await deleteApp(tempApp); } catch (_) {}
      }

      let errorMsg = 'حدث خطأ أثناء إنشاء الحساب في Firebase.';
      if (err.code === 'auth/email-already-exists') {
        errorMsg = 'هذا البريد الإلكتروني مسجل بالفعل في Firebase لمستخدم آخر.';
      } else if (err.code === 'auth/invalid-email') {
        errorMsg = 'صيغة البريد الإلكتروني غير صالحة.';
      } else if (err.code === 'auth/weak-password') {
        errorMsg = 'كلمة السر ضعيفة، يرجى اختيار كلمة سر أقوى.';
      } else if (err.message) {
        errorMsg = err.message;
      }

      await this.app.showAlert(errorMsg, 'خطأ في إنشاء الحساب', 'danger');
    } finally {
      if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = origBtnHtml;
      }
    }
  }

  async loadUsers() {
    const tbody = document.getElementById('admin-users-tbody');
    if (!tbody) return;

    let users = [];

    // Attempt to load live staff users from Cloud Firestore first
    if (firestoreDb) {
      try {
        const snap = await getDocs(collection(firestoreDb, 'users'));
        if (!snap.empty) {
          users = snap.docs.map(d => ({ ...d.data(), id: d.id }));
          localStorage.setItem('ascpt_users', JSON.stringify(users));
        } else {
          users = await db.getUsers();
        }
      } catch (fsErr) {
        console.warn('Could not load users from Firestore, using local cache:', fsErr);
        users = await db.getUsers();
      }
    } else {
      users = await db.getUsers();
    }

    const currentUser = auth.getCurrentUser();

    if (users.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 20px;">لا يوجد أطباء أو موظفين مسجلين حالياً. استخدم النموذج أعلاه لإنشاء حساب جديد.</td></tr>`;
      return;
    }

    tbody.innerHTML = users.map(u => {
      const isSelf = currentUser && (currentUser.uid === u.id || currentUser.id === u.id || currentUser.email === u.email);
      const safeName = escapeHTML(u.name || 'موظف');
      const safeEmail = escapeHTML(u.email || '-');
      const safeRole = escapeHTML(u.role || 'doctor');
      const roleLabel = escapeHTML(RolesManager.getRoleLabel(u.role));

      return `
        <tr>
          <td style="font-weight: 700;">${safeName}</td>
          <td dir="ltr" style="text-align: right;">${safeEmail}</td>
          <td><span class="badge badge-role-${safeRole}">${roleLabel}</span></td>
          <td>
            ${!isSelf ? `
              <button type="button" class="btn btn-outline btn-sm btn-delete-user" style="color: var(--danger); border-radius: 6px; padding: 4px 8px;" data-user-id="${escapeHTML(u.id)}" data-user-name="${safeName}" title="حذف المستخدم">
                <i class="fa-solid fa-trash"></i>
              </button>
            ` : '<span style="font-size: 0.8rem; color: var(--text-muted); font-weight: 700;">حسابك الحالي</span>'}
          </td>
        </tr>
      `;
    }).join('');
  }

  async deleteUser(userId, userName) {
    const confirmed = await this.app.showConfirm(`هل أنت متأكد من حذف حساب الموظف: ${userName} من النظام؟`, 'تأكيد الحذف');
    if (confirmed) {
      const currentUser = auth.getCurrentUser();

      // Delete from Firestore
      if (firestoreDb) {
        try {
          await deleteDoc(doc(firestoreDb, 'users', userId));
        } catch (e) {
          console.warn('Firestore delete user notice:', e);
        }
      }

      await db.deleteUser(userId);
      await db.logAudit('حذف موظف', `قام المدير بحذف حساب: ${userName}`, currentUser);
      await this.app.populateDoctorDropdowns();

      this.app.showToast('تم حذف الموظف من قائمة النظام.');
      await this.loadUsers();
      await this.loadAuditLogs();
    }
  }

  async loadAuditLogs() {
    const tbody = document.getElementById('audit-log-tbody');
    if (!tbody) return;

    const logs = await db.getAuditLogs();
    if (logs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 20px;">لا توجد سجلات تعديل مسجلة حتى الآن.</td></tr>`;
      return;
    }

    tbody.innerHTML = logs.map(l => `
      <tr>
        <td style="font-weight: 700;">${escapeHTML(l.userName)}</td>
        <td><span class="badge badge-role-${escapeHTML(l.userRole)}">${escapeHTML(RolesManager.getRoleLabel(l.userRole))}</span></td>
        <td><span class="badge badge-direct">${escapeHTML(l.actionType)}</span></td>
        <td>${escapeHTML(l.description)}</td>
        <td style="font-size: 0.8rem; color: var(--text-muted);">${escapeHTML(l.timestamp)}</td>
      </tr>
    `).join('');
  }
}
