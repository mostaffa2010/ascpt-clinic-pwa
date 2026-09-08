// ========================================================
// ASCPT - Staff User Management & Audit Trail Module
// Production Architecture: Exclusively Server-Controlled via Backend Admin SDK
// Endpoint: /api/admin/users
// ========================================================

import {
  getDocs,
  collection,
  query,
  orderBy
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

import { firestoreDb, firebaseAuth } from './firebase-init.js';
import { auth } from './auth.js';
import { db } from './db.js';
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
      usersTbody.addEventListener('click', async (e) => {
        const btnDelete = e.target.closest('.btn-delete-user');
        if (btnDelete) {
          const userId = btnDelete.getAttribute('data-user-id');
          const userName = btnDelete.getAttribute('data-user-name');
          await this.deleteUser(userId, userName);
          return;
        }

        const btnPass = e.target.closest('.btn-reset-password');
        if (btnPass) {
          const userId = btnPass.getAttribute('data-user-id');
          const userName = btnPass.getAttribute('data-user-name');
          await this.resetUserPassword(userId, userName);
          return;
        }

        const btnRate = e.target.closest('.btn-edit-doc-rate');
        if (btnRate) {
          const docName = btnRate.getAttribute('data-doc');
          if (docName && this.app.openDoctorRateModal) {
            this.app.openDoctorRateModal(docName);
          }
          return;
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

    if (!name || name.length < 2) {
      await this.app.showAlert('يرجى إدخال اسم صحيح للموظف (حرفين على الأقل).', 'بيانات غير مكتملة', 'warning');
      nameInput?.focus();
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      await this.app.showAlert('يرجى إدخال بريد إلكتروني صحيح (مثال: staff@ascpt.clinic).', 'بريد إلكتروني غير صالح', 'warning');
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
      btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>جاري إنشاء الحساب عبر الخادم...</span>';
    }

    try {
      // 1. Obtain verified Firebase ID Token from currently authenticated Admin
      if (!firebaseAuth.currentUser) {
        throw new Error('جلسة تسجيل الدخول منتهية، يرجى إعادة تسجيل الدخول.');
      }
      const idToken = await firebaseAuth.currentUser.getIdToken(true);

      // 2. Invoke trusted backend serverless endpoint
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ name, email, password, role })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'فشل إنشاء الحساب عبر الخادم.');
      }

      // 3. Clear form inputs on verified success
      if (nameInput) nameInput.value = '';
      if (emailInput) emailInput.value = '';
      if (passwordInput) passwordInput.value = '';

      this.app.showToast(`تم إنشاء وتوثيق حساب ${name} بنجاح كـ (${RolesManager.getRoleLabel(role)})`);

      // 4. Reload verified users directory and doctor dropdowns
      await this.app.populateDoctorDropdowns();
      await this.loadUsers();
      await this.loadAuditLogs();
    } catch (err) {
      console.error('User provisioning failed:', err);
      await this.app.showAlert(err.message || 'حدث خطأ أثناء إنشاء الحساب.', 'خطأ في إنشاء الحساب', 'danger');
    } finally {
      if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = origBtnHtml;
      }
    }
  }

  async resetUserPassword(userId, userName) {
    const newPass = await this.app.showPrompt(
      `أدخل كلمة المرور الجديدة للموظف (${userName}):\n(يجب ألا تقل عن 6 خانات)`,
      'تعيين كلمة مرور جديدة',
      '6 أحرف على الأقل',
      true
    );
    if (!newPass) return;
    if (newPass.length < 6) {
      await this.app.showAlert('كلمة المرور يجب ألا تقل عن 6 خانات/أحرف.', 'خطأ', 'warning');
      return;
    }

    try {
      if (!firebaseAuth.currentUser) {
        throw new Error('جلسة تسجيل الدخول منتهية.');
      }
      const idToken = await firebaseAuth.currentUser.getIdToken(true);
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ targetUid: userId, password: newPass })
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'فشل تغيير كلمة المرور.');
      this.app.showToast(`تم تعيين كلمة مرور جديدة للموظف (${userName}) بنجاح 🔑`);
      await this.loadAuditLogs();
    } catch (err) {
      await this.app.showAlert(err.message, 'خطأ', 'danger');
    }
  }

  async deleteUser(userId, userName) {
    const confirmed = await this.app.showConfirm(
      `هل أنت متأكد من حذف حساب الموظف: (${userName}) نهائياً من النظام؟`,
      'تأكيد الحذف النهائي'
    );

    if (!confirmed) return;

    try {
      if (!firebaseAuth.currentUser) {
        throw new Error('جلسة تسجيل الدخول منتهية.');
      }
      const idToken = await firebaseAuth.currentUser.getIdToken(true);

      const response = await fetch('/api/admin/users', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ targetUid: userId })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'فشل حذف الموظف من الخادم.');
      }

      this.app.showToast(`تم حذف حساب ${userName} نهائياً.`);
      await this.app.populateDoctorDropdowns();
      await this.loadUsers();
      await this.loadAuditLogs();
    } catch (err) {
      console.error('User deletion error:', err);
      await this.app.showAlert(err.message || 'فشل حذف الموظف.', 'خطأ', 'danger');
    }
  }

  async loadUsers() {
    const tbody = document.getElementById('admin-users-tbody');
    if (!tbody) return;

    try {
      let users = [];
      if (firestoreDb) {
        try {
          const snap = await getDocs(collection(firestoreDb, 'users'));
          users = snap.docs.map(d => ({ ...d.data(), id: d.id }));
        } catch (err) {
          console.error('Error loading users from Firestore:', err);
        }
      }

      const currentUser = auth.getCurrentUser();
      let doctorRates = {};
      try {
        if (typeof db !== 'undefined' && typeof db.getDoctorRates === 'function') {
          doctorRates = await db.getDoctorRates();
        }
      } catch (e) {
        console.warn('getDoctorRates notice:', e.message);
      }

      if (users.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 20px;">لا يوجد أطباء أو موظفين مسجلين حالياً. استخدم النموذج أعلاه لإنشاء حساب جديد.</td></tr>`;
        return;
      }

    tbody.innerHTML = users.map(u => {
      const isSelf = currentUser && (currentUser.uid === u.id || currentUser.id === u.id || currentUser.email === u.email);
      const safeName = escapeHTML(u.name || 'موظف');
      const safeEmail = escapeHTML(u.email || '-');
      const safeRole = escapeHTML(u.role || 'doctor');
      const roleLabel = escapeHTML(RolesManager.getRoleLabel(u.role));

      const isDoc = (u.role === 'doctor' || u.role === 'admin');
      const cleanUName = (u.name || '').trim().replace(/\s+/g, ' ');
      const rateInfo = isDoc ? (doctorRates[cleanUName] || null) : null;
      let rateBadge = '';
      if (isDoc) {
        if (rateInfo) {
          if (rateInfo.type === 'percentage') {
            rateBadge = `<span class="badge" style="background: #f0fdf4; color: #166534; font-weight: 800; font-size: 0.76rem;">نسبة ${rateInfo.value}%</span>`;
          } else {
            rateBadge = `<span class="badge" style="background: #e0f2fe; color: #0284c7; font-weight: 800; font-size: 0.76rem;">${rateInfo.value} ج.م / جلسة</span>`;
          }
        } else {
          rateBadge = `<span class="badge" style="background: #f1f5f9; color: var(--text-muted); font-size: 0.74rem;">غير محدد</span>`;
        }
      } else {
        rateBadge = `<span style="color: var(--text-muted); font-size: 0.78rem;">-</span>`;
      }

      return `
        <tr>
          <td style="font-weight: 700;">${safeName}</td>
          <td dir="ltr" style="text-align: right;">${safeEmail}</td>
          <td><span class="badge badge-role-${safeRole}">${roleLabel}</span></td>
          <td>
            <div style="display: flex; align-items: center; gap: 6px;">
              ${rateBadge}
              ${isDoc ? `
                <button type="button" class="btn btn-outline btn-sm btn-edit-doc-rate" data-doc="${safeName}" title="تحديد / تعديل نظام المستحقات" style="padding: 2px 6px; border-radius: 6px; font-size: 0.72rem; color: var(--primary); border-color: #bae6fd; background: #f0f9ff; cursor: pointer;">
                  <i class="fa-solid fa-coins"></i>
                </button>
              ` : ''}
            </div>
          </td>
          <td>
            ${!isSelf ? `
              <div style="display: flex; gap: 6px; align-items: center;">
                <button type="button" class="btn btn-outline btn-sm btn-reset-password" style="color: var(--primary); border-radius: 6px; padding: 4px 8px;" data-user-id="${escapeHTML(u.id)}" data-user-name="${safeName}" title="إعادة تعيين كلمة المرور">
                  <i class="fa-solid fa-key"></i>
                </button>
                <button type="button" class="btn btn-outline btn-sm btn-delete-user" style="color: var(--danger); border-radius: 6px; padding: 4px 8px;" data-user-id="${escapeHTML(u.id)}" data-user-name="${safeName}" title="حذف المستخدم نهائياً">
                  <i class="fa-solid fa-trash"></i>
                </button>
              </div>
            ` : '<span style="font-size: 0.8rem; color: var(--text-muted); font-weight: 700;">حسابك الحالي</span>'}
          </td>
        </tr>
      `;
    }).join('');
    } catch (err) {
      console.error('loadUsers unexpected error:', err);
      tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--danger); padding: 20px;"><i class="fa-solid fa-triangle-exclamation"></i> تعذر تحميل قائمة فريق العمل: ${escapeHTML(err.message)}</td></tr>`;
    }
  }

  async loadAuditLogs() {
    const tbody = document.getElementById('audit-log-tbody');
    if (!tbody) return;

    let logs = [];
    if (firestoreDb) {
      try {
        const q = query(collection(firestoreDb, 'audit_logs'), orderBy('timestampRaw', 'desc'));
        const snap = await getDocs(q);
        logs = snap.docs.map(d => ({ ...d.data(), id: d.id }));
      } catch (err) {
        console.warn('Error loading audit logs from Firestore:', err.message);
      }
    }

    if (logs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 20px;">لا توجد سجلات تدقيق مسجلة حتى الآن.</td></tr>`;
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
