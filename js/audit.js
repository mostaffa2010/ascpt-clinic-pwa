// ========================================================
// ASCPT - Staff User Management & Audit Trail Module
// Production Architecture: Exclusively Server-Controlled via Backend Admin SDK
// Endpoint: /api/admin/users
// ========================================================

import {
  getDocs,
  collection,
  query,
  orderBy,
  limit
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

import { firestoreDb, firebaseAuth } from './firebase-init.js';
import { auth } from './auth.js';
import { RolesManager } from './roles.js';
import { escapeHTML, initStackDeck } from './utils.js';

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
      });
    }

    const usersMob = document.getElementById('admin-users-mobile-cards');
    if (usersMob) {
      usersMob.addEventListener('click', async (e) => {
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
    const mobContainer = document.getElementById('admin-users-mobile-cards');
    if (!tbody && !mobContainer) return;

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

    // Update KPI Stats
    const totalUsersEl = document.getElementById('stat-admin-total-users');
    const doctorsCountEl = document.getElementById('stat-admin-doctors-count');
    const staffCountEl = document.getElementById('stat-admin-staff-count');
    if (totalUsersEl) totalUsersEl.textContent = users.length;
    if (doctorsCountEl) doctorsCountEl.textContent = users.filter(u => u.role === 'doctor').length;
    if (staffCountEl) staffCountEl.textContent = users.filter(u => u.role === 'receptionist' || u.role === 'admin').length;

    // Desktop Table
    if (tbody) {
      if (users.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 20px;">لا يوجد أطباء أو موظفين مسجلين حالياً. استخدم النموذج أعلاه لإنشاء حساب جديد.</td></tr>`;
      } else {
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
      }
    }

    // Mobile Stack Deck
    if (mobContainer) {
      if (users.length === 0) {
        mobContainer.innerHTML = `<div class="hero-styled-card" style="text-align: center; color: var(--text-muted); padding: 25px;">لا يوجد أطباء أو موظفين مسجلين حالياً.</div>`;
      } else {
        const cardsHTML = users.map((u, index) => {
          const isSelf = currentUser && (currentUser.uid === u.id || currentUser.id === u.id || currentUser.email === u.email);
          const safeName = escapeHTML(u.name || 'موظف');
          const safeEmail = escapeHTML(u.email || '-');
          const safeRole = escapeHTML(u.role || 'doctor');
          const roleLabel = escapeHTML(RolesManager.getRoleLabel(u.role));

          let avatarIcon = 'fa-user-doctor';
          let avatarColorClass = 'blue';
          if (safeRole === 'admin') {
            avatarIcon = 'fa-user-shield';
            avatarColorClass = 'purple';
          } else if (safeRole === 'receptionist') {
            avatarIcon = 'fa-user-tie';
            avatarColorClass = 'amber';
          }

          return `
            <div class="hero-styled-card doc-stack-card ${index === 0 ? 'is-active-card' : 'is-peeking-card'}" data-stack-index="${index}">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px;">
                <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
                  <div class="stat-icon ${avatarColorClass}" style="width: 40px; height: 40px; border-radius: 12px; font-size: 1.1rem; flex-shrink: 0; display: flex; align-items: center; justify-content: center;">
                    <i class="fa-solid ${avatarIcon}"></i>
                  </div>
                  <div style="min-width: 0;">
                    <div style="font-weight: 800; font-size: 0.98rem; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                      ${safeName}
                    </div>
                    <div dir="ltr" style="font-size: 0.78rem; color: var(--text-muted); text-align: right; margin-top: 1px;">
                      <i class="fa-regular fa-envelope" style="font-size: 0.72rem;"></i> ${safeEmail}
                    </div>
                  </div>
                </div>
                <span class="badge badge-role-${safeRole}" style="font-size: 0.76rem; padding: 4px 10px; border-radius: 999px; flex-shrink: 0;">
                  ${roleLabel}
                </span>
              </div>

              <div class="hsc-divider" style="margin: 12px 0 10px 0;"></div>

              <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                ${!isSelf ? `
                  <div style="display: flex; gap: 8px; width: 100%;">
                    <button type="button" class="btn btn-outline btn-sm btn-reset-password" style="flex: 1; border-radius: 10px; height: 36px; font-size: 0.82rem; font-weight: 700; color: var(--primary);" data-user-id="${escapeHTML(u.id)}" data-user-name="${safeName}">
                      <i class="fa-solid fa-key"></i> كلمة المرور
                    </button>
                    <button type="button" class="btn btn-outline btn-sm btn-delete-user" style="border-radius: 10px; height: 36px; padding: 0 14px; font-size: 0.82rem; font-weight: 700; color: var(--danger); border-color: rgba(239, 68, 68, 0.3);" data-user-id="${escapeHTML(u.id)}" data-user-name="${safeName}">
                      <i class="fa-solid fa-trash"></i> حذف
                    </button>
                  </div>
                ` : `
                  <div style="width: 100%; text-align: center; font-size: 0.82rem; font-weight: 800; color: var(--success); background: rgba(16, 185, 129, 0.1); padding: 7px 12px; border-radius: 10px;">
                    <i class="fa-solid fa-circle-check"></i> حسابك الحالي المسجل
                  </div>
                `}
              </div>
            </div>
          `;
        }).join('');

        const dotsHTML = users.map((_, i) => `<span class="doc-dot ${i === 0 ? 'active' : ''}" data-dot-index="${i}"></span>`).join('');

        mobContainer.innerHTML = `
          <div class="doc-stack-wrapper">
            <div class="doc-stack-header-bar">
              <span style="font-size: 0.86rem; font-weight: 800; color: var(--text-main);">
                <i class="fa-solid fa-users" style="color: var(--primary); margin-left: 5px;"></i> ${users.length} موظفين بالفريق
              </span>
              <div style="display: flex; align-items: center; gap: 8px;">
                ${users.length > 1 ? `
                  <span id="admin-stack-counter" style="font-size: 0.78rem; font-weight: 800; color: var(--primary); background: rgba(2, 132, 199, 0.12); padding: 2px 10px; border-radius: 999px;">1 من ${users.length}</span>
                  <button type="button" class="btn btn-outline btn-sm" id="btn-toggle-admin-stack" style="font-size: 0.75rem; padding: 3px 9px; border-radius: 8px; height: 28px;" title="تبديل بين التراكم والقائمة">
                    <i class="fa-solid fa-list" id="icon-admin-stack-toggle"></i>
                  </button>
                ` : ''}
              </div>
            </div>
            <div class="doc-stack-container" id="admin-stack-container">
              ${cardsHTML}
            </div>
            ${users.length > 1 ? `
              <div class="doc-stack-nav-bar" id="admin-stack-nav-bar">
                <button type="button" class="doc-stack-nav-btn" id="btn-admin-stack-prev">
                  <i class="fa-solid fa-chevron-right"></i> السابق
                </button>
                <div class="doc-stack-dots" id="admin-stack-dots">
                  ${dotsHTML}
                </div>
                <button type="button" class="doc-stack-nav-btn" id="btn-admin-stack-next">
                  التالي <i class="fa-solid fa-chevron-left"></i>
                </button>
              </div>
            ` : ''}
          </div>
        `;

        this.initStackDeck('admin-stack');
      }
    }
  }

  async loadAuditLogs() {
    const tbody = document.getElementById('audit-log-tbody');
    const mobLogs = document.getElementById('audit-log-mobile-cards');
    if (!tbody && !mobLogs) return;

    // Automatic 60-day audit log purge in background
    try { await db.purgeOldAuditLogs(); } catch (_) {}

    let logs = [];
    if (firestoreDb) {
      try {
        const q = query(
          collection(firestoreDb, 'audit_logs'),
          orderBy('timestampRaw', 'desc'),
          limit(50)
        );
        const snap = await getDocs(q);
        logs = snap.docs.map(d => ({ ...d.data(), id: d.id }));
      } catch (err) {
        console.warn('Error loading audit logs from Firestore:', err.message);
      }
    }

    // Update KPI Stat
    const auditCountEl = document.getElementById('stat-admin-audit-count');
    if (auditCountEl) auditCountEl.textContent = logs.length;

    // Desktop Table
    if (tbody) {
      if (logs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 20px;">لا توجد سجلات تدقيق مسجلة حتى الآن.</td></tr>`;
      } else {
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

    // Mobile Timeline
    if (mobLogs) {
      if (logs.length === 0) {
        mobLogs.innerHTML = `<div class="hero-styled-card" style="text-align: center; color: var(--text-muted); padding: 25px;">لا توجد حركات رقابة مسجلة حتى الآن.</div>`;
      } else {
        const hasMoreAudit = logs.length > 6;
        mobLogs.innerHTML = `
          <div class="audit-mobile-timeline">
            ${logs.map((l, idx) => {
              const safeName = escapeHTML(l.userName);
              const safeRole = escapeHTML(l.userRole);
              const roleLabel = escapeHTML(RolesManager.getRoleLabel(l.userRole));
              const safeAction = escapeHTML(l.actionType);
              const safeDesc = escapeHTML(l.description);
              const safeTime = escapeHTML(l.timestamp);

              return `
                <div class="audit-mobile-item ${idx >= 6 ? 'audit-item-collapsed' : ''}" style="${idx >= 6 ? 'display: none;' : ''}">
                  <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                    <span class="badge badge-direct" style="font-size: 0.76rem; font-weight: 800; padding: 3px 8px; border-radius: 6px;">
                      ${safeAction}
                    </span>
                    <span style="font-size: 0.74rem; color: var(--text-muted); font-weight: 600;">
                      <i class="fa-regular fa-clock" style="font-size: 0.7rem;"></i> ${safeTime}
                    </span>
                  </div>
                  <div style="font-weight: 700; font-size: 0.88rem; color: var(--text-main); margin: 6px 0;">
                    ${safeDesc}
                  </div>
                  <div style="display: flex; align-items: center; gap: 6px; font-size: 0.78rem; color: var(--text-muted);">
                    <i class="fa-solid fa-user-pen" style="color: var(--primary);"></i>
                    <span style="font-weight: 700; color: var(--text-main);">${safeName}</span>
                    <span>•</span>
                    <span class="badge badge-role-${safeRole}" style="font-size: 0.68rem; padding: 2px 6px;">${roleLabel}</span>
                  </div>
                </div>
              `;
            }).join('')}
            ${hasMoreAudit ? `
              <button type="button" class="btn-toggle-audit-more btn btn-outline btn-sm" data-expanded="false" style="width: 100%; border-radius: 12px; margin-top: 6px; padding: 8px; font-size: 0.82rem; font-weight: 700; color: var(--primary); border-color: var(--primary); display: flex; align-items: center; justify-content: center; gap: 6px;">
                <span>عرض باقي الحركات (${logs.length - 6}+)</span>
                <i class="fa-solid fa-chevron-down"></i>
              </button>
            ` : ''}
          </div>
        `;

        if (hasMoreAudit) {
          mobLogs.querySelector('.btn-toggle-audit-more')?.addEventListener('click', (ev) => {
            const btn = ev.currentTarget;
            const isExp = btn.getAttribute('data-expanded') === 'true';
            const hiddenLogs = mobLogs.querySelectorAll('.audit-item-collapsed');
            if (isExp) {
              hiddenLogs.forEach(r => r.style.display = 'none');
              btn.setAttribute('data-expanded', 'false');
              btn.innerHTML = `<span>عرض باقي الحركات (${logs.length - 6}+)</span> <i class="fa-solid fa-chevron-down"></i>`;
            } else {
              hiddenLogs.forEach(r => r.style.display = 'block');
              btn.setAttribute('data-expanded', 'true');
              btn.innerHTML = `<span>عرض أقل</span> <i class="fa-solid fa-chevron-up"></i>`;
            }
          });
        }
      }
    }
  }

  // ================= 3D Stack Deck Handler (Admin Staff Members) =================
  initStackDeck(prefix) {
    initStackDeck(prefix);
  }
}
