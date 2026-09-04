// ========================================================
// ASCPT - Staff User Management & Audit Trail Module
// Real Firebase Authentication & Cloud Firestore Provisioning
// ========================================================

import { initializeApp, deleteApp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as secondarySignOut,
  updateProfile
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import {
  doc,
  setDoc,
  deleteDoc,
  getDocs,
  collection
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

import { CLINIC_CONFIG } from './clinic-config.js';
import { firestoreDb, firebaseAuth } from './firebase-init.js';
import { db } from './db.js';
import { auth } from './auth.js';
import { RolesManager } from './roles.js';
import { escapeHTML } from './utils.js';

const withTimeout = (promise, ms = 3000) => {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms))
  ]);
};

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
      usersTbody.addEventListener('click', async (e) => {
        const btnDelete = e.target.closest('.btn-delete-user');
        if (btnDelete) {
          const userId = btnDelete.getAttribute('data-user-id');
          const userName = btnDelete.getAttribute('data-user-name');
          await this.deleteUser(userId, userName);
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
    const btnSubmit = e.target.querySelector('button[type="submit"]') || document.querySelector('#form-add-user button[type="submit"]');

    const name = nameInput?.value?.trim();
    const email = emailInput?.value?.trim().toLowerCase();
    const password = passwordInput?.value;
    const role = roleInput?.value || 'doctor';

    if (!name || name.length < 3) {
      await this.app.showAlert('يرجى إدخال اسم صحيح للموظف (3 أحرف على الأقل).', 'بيانات غير مكتملة', 'warning');
      nameInput?.focus();
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      await this.app.showAlert('يرجى إدخال بريد إلكتروني صحيح (مثال: receptionist@ascpt.com).', 'بريد إلكتروني غير صالح', 'warning');
      emailInput?.focus();
      return;
    }

    if (!password || password.length < 6) {
      await this.app.showAlert('كلمة المرور يجب ألا تقل عن 6 خانات/أحرف لضمان الأمان.', 'كلمة المرور قصيرة', 'warning');
      passwordInput?.focus();
      return;
    }

    const origBtnHtml = btnSubmit ? btnSubmit.innerHTML : '<i class="fa-solid fa-plus"></i> إنشاء الحساب';
    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>جاري إنشاء الحساب في Firebase...</span>';
    }

    let tempApp = null;

    try {
      const tempAppName = 'staff_provisioning_' + Date.now();
      tempApp = initializeApp(CLINIC_CONFIG.firebase, tempAppName);
      const tempAuth = getAuth(tempApp);

      let newUid = null;

      try {
        // 1. Try creating user in Firebase Authentication
        const userCredential = await createUserWithEmailAndPassword(tempAuth, email, password);
        newUid = userCredential.user.uid;
        try {
          await updateProfile(userCredential.user, { displayName: name });
        } catch (_) {}
      } catch (authCreateErr) {
        // 2. If already exists in Auth, link it using the credentials to set the profile and role
        if (authCreateErr.code === 'auth/email-already-in-use' || authCreateErr.code === 'auth/email-already-exists') {
          try {
            const existingCred = await signInWithEmailAndPassword(tempAuth, email, password);
            newUid = existingCred.user.uid;
            try {
              await updateProfile(existingCred.user, { displayName: name });
            } catch (_) {}
          } catch (loginErr) {
            throw new Error('هذا البريد الإلكتروني مسجل مسبقاً في Firebase بكلمة سر مختلفة. يرجى إدخال كلمة السر الصحيحة المسجلة له أو استخدام بريد إلكتروني آخر.');
          }
        } else {
          throw authCreateErr;
        }
      }

      // Destroy secondary auth instance
      try {
        await secondarySignOut(tempAuth);
        await deleteApp(tempApp);
      } catch (_) {}
      tempApp = null;

      // 3. Prepare user profile document
      const userProfileData = {
        uid: newUid,
        id: newUid,
        name,
        email,
        role, // Strictly the selected role: 'doctor' or 'receptionist'
        active: true,
        createdAt: new Date().toISOString(),
        createdBy: currentUser.uid || currentUser.id || 'admin',
        createdByName: currentUser.name || 'مدير المركز'
      };

      // 4. Save to Cloud Firestore users/{newUid}
      if (firestoreDb) {
        try {
          await withTimeout(setDoc(doc(firestoreDb, 'users', newUid), userProfileData, { merge: true }), 3500);
        } catch (fsErr) {
          console.warn('Firestore profile write notice (cached locally):', fsErr.message);
        }
      }

      // 5. Update local cache in db layer
      await db.saveUser(userProfileData);
      await db.logAudit('إضافة موظف', `قام المدير بإنشاء حساب للموظف: ${name} بدور: ${RolesManager.getRoleLabel(role)} (${email})`, currentUser);

      // 6. Refresh Doctor dropdowns
      await this.app.populateDoctorDropdowns();

      // 7. Reset form fields
      if (nameInput) nameInput.value = '';
      if (emailInput) emailInput.value = '';
      if (passwordInput) passwordInput.value = '';

      this.app.showToast(`تم إنشاء وتأكيد حساب ${name} بنجاح بدور: (${RolesManager.getRoleLabel(role)})`);

      // 8. Reload staff table & audit log
      await this.loadUsers();
      await this.loadAuditLogs();
    } catch (err) {
      console.error('Error in handleAddUser:', err);
      if (tempApp) {
        try { await deleteApp(tempApp); } catch (_) {}
      }

      let errorMsg = 'حدث خطأ أثناء تسجيل الموظف.';
      if (err.code === 'auth/email-already-in-use' || err.code === 'auth/email-already-exists') {
        errorMsg = 'هذا البريد الإلكتروني مسجل بالفعل في Firebase.';
      } else if (err.code === 'auth/invalid-email') {
        errorMsg = 'صيغة البريد الإلكتروني غير صالحة.';
      } else if (err.code === 'auth/weak-password') {
        errorMsg = 'كلمة السر ضعيفة، يرجى اختيار كلمة سر أقوى (6 خانات على الأقل).';
      } else if (err.message) {
        errorMsg = err.message;
      }

      await this.app.showAlert(errorMsg, 'تنبيه إنشاء الحساب', 'danger');
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

    if (firestoreDb) {
      try {
        const snap = await withTimeout(getDocs(collection(firestoreDb, 'users')), 3000);
        if (snap && !snap.empty) {
          users = snap.docs.map(d => ({ ...d.data(), id: d.id }));
          localStorage.setItem('ascpt_users', JSON.stringify(users));
        } else {
          users = await db.getUsers();
        }
      } catch (fsErr) {
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
              <button type="button" class="btn btn-outline btn-sm btn-delete-user" style="color: var(--danger); border-radius: 6px; padding: 4px 10px;" data-user-id="${escapeHTML(u.id)}" data-user-name="${safeName}" title="حذف المستخدم نهائياً">
                <i class="fa-solid fa-trash"></i> <span>حذف</span>
              </button>
            ` : '<span style="font-size: 0.8rem; color: var(--text-muted); font-weight: 700;">حسابك الحالي</span>'}
          </td>
        </tr>
      `;
    }).join('');
  }

  async deleteUser(userId, userName) {
    const confirmed = await this.app.showConfirm(
      `هل أنت متأكد من حذف حساب الموظف: (${userName}) نهائياً من النظام وقاعدة البيانات؟`,
      'تأكيد الحذف النهائي'
    );

    if (!confirmed) return;

    const currentUser = auth.getCurrentUser();

    // 1. Attempt deletion from Backend Privileged Endpoint (to delete from Firebase Auth too)
    try {
      const idToken = await firebaseAuth?.currentUser?.getIdToken();
      if (idToken) {
        await fetch('/api/admin/users', {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
          },
          body: JSON.stringify({ targetUid: userId })
        });
      }
    } catch (apiErr) {
      console.warn('Backend delete endpoint notice:', apiErr.message);
    }

    // 2. Delete from Cloud Firestore
    if (firestoreDb) {
      try {
        await withTimeout(deleteDoc(doc(firestoreDb, 'users', userId)), 2500);
      } catch (e) {
        console.warn('Firestore delete user notice:', e.message);
      }
    }

    // 3. Delete from local cache
    await db.deleteUser(userId);
    await db.logAudit('حذف موظف', `قام المدير بحذف حساب: ${userName} نهائياً`, currentUser);
    await this.app.populateDoctorDropdowns();

    this.app.showToast(`تم حذف حساب ${userName} نهائياً.`);
    await this.loadUsers();
    await this.loadAuditLogs();
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
