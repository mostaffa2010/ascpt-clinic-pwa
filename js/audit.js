// ========================================================
// PhysioFlow Demo - Audit Trail & Staff Admin Management
// ========================================================

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

    const usersTbody = document.getElementById('users-table-tbody');
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

    const name = document.getElementById('newuser-name').value.trim();
    const email = document.getElementById('newuser-email').value.trim().toLowerCase();
    const password = document.getElementById('newuser-password').value;
    const role = document.getElementById('newuser-role').value;

    if (!name || name.length < 3) {
      await this.app.showAlert('يرجى إدخال اسم صحيح للموظف (3 أحرف على الأقل).', 'بيانات غير مكتملة', 'warning');
      document.getElementById('newuser-name')?.focus();
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      await this.app.showAlert('يرجى إدخال بريد إلكتروني صحيح (مثال: user@example.com).', 'بريد إلكتروني غير صالح', 'warning');
      document.getElementById('newuser-email')?.focus();
      return;
    }

    if (!password || password.length < 6) {
      await this.app.showAlert('كلمة المرور يجب ألا تقل عن 6 خانات/أحرف لضمان الأمان.', 'كلمة المرور قصيرة', 'warning');
      document.getElementById('newuser-password')?.focus();
      return;
    }

    if (!role) {
      await this.app.showAlert('يرجى اختيار الصلاحية / الدور الوظيفي للمستخدم.', 'الدور مطلوب', 'warning');
      return;
    }

    const existingUsers = await db.getUsers();
    if (existingUsers.some(u => u.email === email)) {
      await this.app.showAlert('هذا البريد الإلكتروني مسجل بالفعل لمستخدم آخر.', 'تنبيه', 'warning');
      return;
    }

    const newUser = {
      name,
      email,
      password,
      role
    };

    // حفظ المستخدم محلياً في ذاكرة الديمو المعزولة بالكامل
    await db.saveUser(newUser);
    await db.logAudit('إضافة موظف', `قام المدير بإضافة مستخدم جديد: ${name} بدقة دور (${RolesManager.getRoleLabel(role)})`, currentUser);
    await this.app.populateDoctorDropdowns();

    document.getElementById('form-add-user').reset();
    this.app.showToast('تم إنشاء حساب المستخدم بنجاح');
    await this.loadUsers();
    await this.loadAuditLogs();
  }

  async loadUsers() {
    const tbody = document.getElementById('admin-users-tbody');
    if (!tbody) return;

    const users = await db.getUsers();
    const currentUser = auth.getCurrentUser();

    tbody.innerHTML = users.map(u => {
      const isSelf = currentUser && currentUser.id === u.id;
      const safeName = escapeHTML(u.name);
      const safeEmail = escapeHTML(u.email);
      const safeRole = escapeHTML(u.role);
      const roleLabel = escapeHTML(RolesManager.getRoleLabel(u.role));

      return `
        <tr>
          <td style="font-weight: 700;">${safeName}</td>
          <td>${safeEmail}</td>
          <td><span class="badge badge-role-${safeRole}">${roleLabel}</span></td>
          <td>
            ${!isSelf ? `
              <button type="button" class="btn btn-outline btn-sm btn-delete-user" style="color: var(--danger);" data-user-id="${escapeHTML(u.id)}" data-user-name="${safeName}" title="حذف المستخدم">
                <i class="fa-solid fa-trash"></i>
              </button>
            ` : '<span style="font-size: 0.8rem; color: var(--text-muted); font-weight: 600;">حسابك الحالي</span>'}
          </td>
        </tr>
      `;
    }).join('');
  }

  async deleteUser(userId, userName) {
    const confirmed = await this.app.showConfirm(`هل أنت متأكد من حذف حساب الموظف: ${userName}؟`, 'تأكيد الحذف');
    if (confirmed) {
      const currentUser = auth.getCurrentUser();
      await db.deleteUser(userId);
      await db.logAudit('حذف موظف', `قام المدير بحذف حساب: ${userName}`, currentUser);
      this.app.showToast('تم حذف المستخدم بنجاح');
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
