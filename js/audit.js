// ========================================================
// ASCPT - Staff User Management & Audit Trail Module (v1.4.96)
// Authoritative Supabase PostgreSQL Integration
// ========================================================

import { supabase } from './clinic-config.js';
import { db } from './db.js';
import { auth } from './auth.js';
import { RolesManager } from './roles.js';
import { escapeHTML, initStackDeck, getShiftLabel } from './utils.js';

export class AuditAndAdminManager {
  constructor(app) {
    this.app = app;
  }

  async init() {
    this.bindEvents();
  }

  bindEvents() {
    const formCreateUser = document.getElementById('form-add-user') || document.getElementById('form-admin-create-user');
    if (formCreateUser) {
      formCreateUser.addEventListener('submit', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.handleCreateUser(e);
      });
    }

    const btnSubmit = document.getElementById('btn-admin-submit-create-user');
    if (btnSubmit) {
      btnSubmit.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.handleCreateUser(e);
      });
    }

    const roleSelect = document.getElementById('newuser-role') || document.getElementById('admin-new-user-role');
    if (roleSelect) {
      roleSelect.addEventListener('change', () => {
        const isDoctor = roleSelect.value === 'doctor';
        const shiftGroup = document.getElementById('form-group-newuser-shift');
        const ratesGroup = document.getElementById('form-group-newuser-rates');
        const docFields = document.getElementById('admin-doctor-extra-fields');
        if (shiftGroup) shiftGroup.style.display = isDoctor ? 'block' : 'none';
        if (ratesGroup) ratesGroup.style.display = isDoctor ? 'block' : 'none';
        if (docFields) docFields.style.display = isDoctor ? 'grid' : 'none';
      });
    }

    const searchInput = document.getElementById('audit-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', () => this.filterAuditLogs());
    }

    const filterAction = document.getElementById('audit-filter-action');
    if (filterAction) {
      filterAction.addEventListener('change', () => this.filterAuditLogs());
    }

    const btnPurge = document.getElementById('btn-admin-purge-audit');
    if (btnPurge) {
      btnPurge.addEventListener('click', () => this.handlePurgeAudit());
    }

    // Card delegators for staff list
    const usersMob = document.getElementById('admin-users-mobile-cards');
    if (usersMob) {
      usersMob.addEventListener('click', (e) => {
        const resetBtn = e.target.closest('.btn-reset-user-password');
        if (resetBtn) {
          const uid = resetBtn.getAttribute('data-user-id');
          const name = resetBtn.getAttribute('data-user-name');
          if (uid) this.resetUserPassword(uid, name);
          return;
        }

        const toggleBtn = e.target.closest('.btn-toggle-user-status');
        if (toggleBtn) {
          const uid = toggleBtn.getAttribute('data-user-id');
          const name = toggleBtn.getAttribute('data-user-name');
          const currentActive = toggleBtn.getAttribute('data-current-status') === 'true';
          if (uid) this.toggleUserStatus(uid, name, currentActive);
          return;
        }

        const deleteBtn = e.target.closest('.btn-delete-staff-user');
        if (deleteBtn) {
          const uid = deleteBtn.getAttribute('data-user-id');
          const name = deleteBtn.getAttribute('data-user-name');
          if (uid) this.deleteUser(uid, name);
          return;
        }

        const shiftBtn = e.target.closest('.btn-change-doctor-shift');
        if (shiftBtn) {
          const uid = shiftBtn.getAttribute('data-user-id');
          const name = shiftBtn.getAttribute('data-user-name');
          const currentShift = shiftBtn.getAttribute('data-current-shift') || 'sat_mon_wed';
          const regRate = parseFloat(shiftBtn.getAttribute('data-regular-rate')) || 0;
          const specRate = parseFloat(shiftBtn.getAttribute('data-special-rate')) || 0;
          if (uid) this.openDoctorRateModal(uid, name, currentShift, regRate, specRate);
        }
      });
    }
  }

  async handleCreateUser(e) {
    if (e) {
      try { e.preventDefault(); } catch (_) {}
      try { e.stopPropagation(); } catch (_) {}
    }

    const nameInput = document.getElementById('newuser-name') || document.getElementById('admin-new-user-name');
    const emailInput = document.getElementById('newuser-email') || document.getElementById('admin-new-user-email');
    const passwordInput = document.getElementById('newuser-password') || document.getElementById('admin-new-user-password');
    const roleSelect = document.getElementById('newuser-role') || document.getElementById('admin-new-user-role');
    const shiftSelect = document.getElementById('newuser-shift') || document.getElementById('admin-new-doctor-shift');
    const regRateInput = document.getElementById('newuser-regular-rate') || document.getElementById('admin-new-doctor-rate-regular');
    const specRateInput = document.getElementById('newuser-special-rate') || document.getElementById('admin-new-doctor-rate-special');

    const name = nameInput?.value.trim();
    const email = emailInput?.value.trim().toLowerCase();
    const password = passwordInput?.value;
    const role = roleSelect?.value || 'doctor';
    const shift = (role === 'doctor' && shiftSelect) ? shiftSelect.value : null;
    const regularSessionRate = (role === 'doctor' && regRateInput) ? parseFloat(regRateInput.value) || 0 : null;
    const specialSessionRate = (role === 'doctor' && specRateInput) ? parseFloat(specRateInput.value) || 0 : null;

    if (!name || !email || !password || !role) {
      await this.app.showAlert('يرجى ملء جميع الحقول الإلزامية لإنشاء الحساب.', 'بيانات ناقصة', 'warning');
      return;
    }

    if (password.length < 6) {
      await this.app.showAlert('كلمة المرور يجب ألا تقل عن 6 أحرف.', 'كلمة مرور ضعيفة', 'warning');
      return;
    }

    const btnSubmit = document.getElementById('btn-admin-submit-create-user');
    const origBtnHtml = btnSubmit ? btnSubmit.innerHTML : '';
    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>جاري إنشاء الحساب...</span>';
    }

    try {
      let authUid = null;
      try {
        const { data: authData, error: authErr } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { name, role } }
        });
        if (!authErr && authData?.user?.id) {
          authUid = authData.user.id;
        }
      } catch (authException) {
        console.warn('Auth signUp warning:', authException);
      }

      const finalUserId = authUid || ('u_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7));
      const now = new Date().toISOString();

      const profileData = {
        id: finalUserId,
        name,
        email,
        role,
        is_active: true,
        data: {
          id: finalUserId,
          uid: finalUserId,
          name,
          email,
          role,
          shift: role === 'doctor' ? (shift || 'sat_mon_wed') : null,
          regularSessionRate: role === 'doctor' ? (regularSessionRate || 0) : null,
          specialSessionRate: role === 'doctor' ? (specialSessionRate || 0) : null,
          active: true,
          createdAt: now
        }
      };

      const { error: profErr } = await supabase.from('profiles').upsert(profileData);
      if (profErr) {
        throw new Error('فشل تسجيل الموظف في قاعدة البيانات: ' + profErr.message);
      }

      // Log audit
      const shiftDesc = (role === 'doctor' && shift) ? ` (شفت: ${shift === 'sat_mon_wed' ? 'السبت/الاثنين/الأربعاء' : shift === 'sun_tue_thu' ? 'الأحد/الثلاثاء/الخميس' : 'طوال الأسبوع'})` : '';
      await db.logAudit('إنشاء حساب موظف', `تم إنشاء حساب للموظف: ${name} بدور: ${RolesManager.getRoleLabel(role)}${shiftDesc} (${email})`, auth.getCurrentUser());

      if (nameInput) nameInput.value = '';
      if (emailInput) emailInput.value = '';
      if (passwordInput) passwordInput.value = '';
      if (regRateInput) regRateInput.value = '';
      if (specRateInput) specRateInput.value = '';

      this.app.showToast(`تم إنشاء وتوثيق حساب ${name} بنجاح كـ (${RolesManager.getRoleLabel(role)})`);

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
    this.app.showToast(`لإعادة تعيين كلمة مرور (${userName})، يمكن للموظف استخدام رابط الاستعادة أو من لوحة Supabase.`);
  }

  async toggleUserStatus(userId, userName, currentActive) {
    const actionText = currentActive ? 'تعطيل' : 'تنشيط';
    const confirmed = await this.app.showConfirm(
      `هل أنت متأكد من رغبتك في ${actionText} حساب الموظف (${userName})؟`,
      `تأكيد ${actionText} الحساب`
    );
    if (!confirmed) return;

    try {
      const newActive = !currentActive;
      const { data: existing } = await supabase.from('profiles').select('*').eq('id', userId).single();
      const updatedData = { ...(existing?.data || {}), active: newActive };

      const { error } = await supabase.from('profiles').update({
        is_active: newActive,
        data: updatedData
      }).eq('id', userId);

      if (error) throw error;

      await db.logAudit(actionText + ' حساب موظف', `قام المدير بـ${actionText} حساب الموظف: ${userName}`, auth.getCurrentUser());

      this.app.showToast(`تم ${actionText} حساب ${userName} بنجاح.`);
      await this.app.populateDoctorDropdowns();
      await this.loadUsers();
      await this.loadAuditLogs();
    } catch (err) {
      console.error('Failed to toggle user status:', err);
      await this.app.showAlert('تعذر تغيير حالة الحساب: ' + err.message, 'خطأ', 'danger');
    }
  }

  async deleteUser(userId, userName) {
    const confirmed = await this.app.showConfirm(
      `تحذير: هل أنت متأكد من حذف حساب (${userName}) نهائياً؟ هذا الإجراء لا يمكن التراجع عنه.`,
      'تأكيد الحذف النهائي للموظف'
    );
    if (!confirmed) return;

    try {
      const { error } = await supabase.from('profiles').delete().eq('id', userId);
      if (error) throw error;

      await db.logAudit('حذف موظف', `قام المدير بحذف حساب الموظف: ${userName} نهائياً`, auth.getCurrentUser());

      this.app.showToast(`تم حذف حساب ${userName} بنجاح.`);
      await this.app.populateDoctorDropdowns();
      await this.loadUsers();
      await this.loadAuditLogs();
    } catch (err) {
      console.error('Failed to delete staff user:', err);
      await this.app.showAlert('تعذر حذف الحساب: ' + err.message, 'خطأ', 'danger');
    }
  }

  openDoctorRateModal(userId, userName, currentShift, regRate, specRate) {
    const nameEl = document.getElementById('modal-doctor-rate-name');
    const idInput = document.getElementById('modal-doctor-rate-uid');
    const shiftSelect = document.getElementById('modal-doctor-rate-shift');
    const regInput = document.getElementById('modal-doctor-rate-regular');
    const specInput = document.getElementById('modal-doctor-rate-special');

    if (nameEl) nameEl.textContent = userName;
    if (idInput) idInput.value = userId;
    if (shiftSelect) shiftSelect.value = currentShift;
    if (regInput) regInput.value = regRate;
    if (specInput) specInput.value = specRate;

    this.app.openModal('modal-doctor-rate');

    const form = document.getElementById('form-doctor-rate-update');
    if (form) {
      form.onsubmit = async (e) => {
        e.preventDefault();
        const newShift = shiftSelect ? shiftSelect.value : currentShift;
        const newReg = regInput ? (parseFloat(regInput.value) || 0) : 0;
        const newSpec = specInput ? (parseFloat(specInput.value) || 0) : 0;

        try {
          const { data: existing } = await supabase.from('profiles').select('*').eq('id', userId).single();
          const updatedData = {
            ...(existing?.data || {}),
            shift: newShift,
            regularSessionRate: newReg,
            specialSessionRate: newSpec
          };

          const { error } = await supabase.from('profiles').update({
            data: updatedData
          }).eq('id', userId);

          if (error) throw error;

          await db.logAudit('تعديل إعدادات الطبيب', `تعديل شفت وتسعيرة الطبيب: ${userName}`, auth.getCurrentUser());

          this.app.closeModal('modal-doctor-rate');
          this.app.showToast(`تم تحديث شفت وتسعيرة جلسات الطبيب (${userName}) بنجاح.`);
          await this.app.populateDoctorDropdowns();
          await this.loadUsers();
          await this.loadAuditLogs();
        } catch (err) {
          await this.app.showAlert('تعذر تحديث تسعيرة الطبيب: ' + err.message, 'خطأ', 'danger');
        }
      };
    }
  }

  async loadUsers() {
    const mobContainer = document.getElementById('admin-users-mobile-cards');
    if (!mobContainer) return;

    let users = [];
    try {
      users = await db.getUsers();
    } catch (err) {
      console.error('Error loading users:', err);
    }

    const currentUser = auth.getCurrentUser();

    // Update KPI Stats
    const totalUsersEl = document.getElementById('stat-admin-total-users');
    const doctorsCountEl = document.getElementById('stat-admin-doctors-count');
    const staffCountEl = document.getElementById('stat-admin-staff-count');
    if (totalUsersEl) totalUsersEl.textContent = users.length;
    if (doctorsCountEl) doctorsCountEl.textContent = users.filter(u => u.role === 'doctor').length;
    if (staffCountEl) staffCountEl.textContent = users.filter(u => u.role === 'receptionist' || u.role === 'admin').length;

    if (users.length === 0) {
      mobContainer.innerHTML = `
        <div class="empty-state-card" style="text-align: center; padding: 28px 20px; color: var(--text-muted); background: var(--bg-surface); border-radius: 14px; border: 1.5px dashed var(--border-color);">
          <i class="fa-solid fa-users-slash" style="font-size: 1.8rem; margin-bottom: 8px; display: block; color: #cbd5e1;"></i>
          لا يوجد أطباء أو موظفين مسجلين حالياً.
        </div>
      `;
      return;
    }

    mobContainer.innerHTML = users.map(u => {
      const isSelf = currentUser && (currentUser.uid === u.id || currentUser.id === u.id || currentUser.email === u.email);
      const safeName = escapeHTML(u.name || 'موظف');
      const safeEmail = escapeHTML(u.email || '-');
      const roleLabel = escapeHTML(RolesManager.getRoleLabel(u.role));

      let shiftDisplay = '<span style="color: var(--text-muted); font-size: 0.8rem; font-weight: 600;">دوام إداري</span>';
      if (u.role === 'doctor') {
        const sKey = u.shift || u.data?.shift || 'sat_mon_wed';
        const sLabel = getShiftLabel(sKey);
        const sIcon = sKey === 'sat_mon_wed' ? 'fa-calendar-days' : (sKey === 'sun_tue_thu' ? 'fa-calendar-week' : 'fa-calendar-check');
        const regRate = typeof u.regularSessionRate === 'number' ? u.regularSessionRate : (u.data?.regularSessionRate || 0);
        const specRate = typeof u.specialSessionRate === 'number' ? u.specialSessionRate : (u.data?.specialSessionRate || 0);
        shiftDisplay = `
          <button type="button" class="btn btn-outline btn-sm btn-change-doctor-shift" data-user-id="${escapeHTML(u.id)}" data-user-name="${safeName}" data-current-shift="${sKey}" data-regular-rate="${regRate}" data-special-rate="${specRate}" style="border-radius: 6px; padding: 5px 8px; font-size: 0.78rem; text-align: right; color: var(--text-main); border-color: var(--border-color); display: inline-flex; align-items: center; justify-content: space-between; gap: 8px;" title="تعديل الشفت">
            <div>
              <div style="font-weight: 800; color: var(--primary); display: flex; align-items: center; gap: 5px;">
                <i class="fa-solid ${sIcon}"></i> <span>${escapeHTML(sLabel)}</span>
              </div>
              <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 2px;">
                عادية: <strong style="color: var(--text-main);">${regRate} ج.م</strong> • خاصة: <strong style="color: #b45309;">${specRate} ج.م</strong>
              </div>
            </div>
            <i class="fa-solid fa-pen-to-square" style="color: var(--primary); font-size: 0.8rem;"></i>
          </button>
        `;
      }

      return `
        <div class="hero-styled-card" style="border-right: 4px solid ${u.role === 'admin' ? 'var(--primary)' : (u.role === 'doctor' ? '#10b981' : '#f59e0b')};">
          <div class="hsc-top">
            <div class="hsc-patient-meta">
              <div class="hsc-avatar" style="background: rgba(2, 132, 199, 0.12); color: var(--primary);">
                <i class="fa-solid ${u.role === 'doctor' ? 'fa-user-doctor' : (u.role === 'admin' ? 'fa-user-shield' : 'fa-user-tie')}"></i>
              </div>
              <div class="hsc-name-box">
                <span class="hsc-patient-name" style="font-size: 0.95rem;">${safeName}</span>
                <span class="hsc-doc-sub" style="color: var(--text-muted); font-size: 0.78rem;">${safeEmail}</span>
              </div>
            </div>
            <div>
              <span class="badge" style="background: ${u.role === 'admin' ? 'rgba(2, 132, 199, 0.15)' : (u.role === 'doctor' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)')}; color: ${u.role === 'admin' ? 'var(--primary)' : (u.role === 'doctor' ? '#10b981' : '#d97706')}; font-weight: 800; font-size: 0.78rem;">
                ${roleLabel}
              </span>
            </div>
          </div>

          <div class="hsc-divider" style="margin: 10px 0;"></div>

          <div class="hsc-bottom" style="align-items: center; justify-content: space-between;">
            <div>
              ${shiftDisplay}
            </div>
            <div class="hsc-actions">
              ${!isSelf ? `
                <button type="button" class="btn btn-outline btn-sm btn-icon-action btn-toggle-user-status" data-user-id="${escapeHTML(u.id)}" data-user-name="${safeName}" data-current-status="${u.active}" style="color: ${u.active ? 'var(--warning)' : 'var(--success)'}; width: 28px; height: 28px; padding: 0; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%;" title="${u.active ? 'تعطيل الحساب' : 'تنشيط الحساب'}">
                  <i class="fa-solid ${u.active ? 'fa-ban' : 'fa-check'}"></i>
                </button>
                <button type="button" class="btn btn-outline btn-sm btn-icon-action btn-delete-staff-user" data-user-id="${escapeHTML(u.id)}" data-user-name="${safeName}" style="color: var(--danger); border-color: rgba(239, 68, 68, 0.35); width: 28px; height: 28px; padding: 0; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%;" title="حذف نهائي">
                  <i class="fa-solid fa-trash"></i>
                </button>
              ` : `
                <span style="font-size: 0.72rem; font-weight: 700; color: var(--text-muted); background: var(--bg-subtle); padding: 3px 8px; border-radius: 6px;">حسابك الحالي</span>
              `}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  async loadAuditLogs() {
    const mobContainer = document.getElementById('audit-log-mobile-cards');
    const counterEl = document.getElementById('stat-admin-audit-count');
    if (!mobContainer) return;

    let logs = [];
    try {
      logs = await db.getAuditLogs(50);
    } catch (err) {
      console.error('Error loading audit logs:', err);
    }

    if (counterEl) counterEl.textContent = logs.length;

    if (logs.length === 0) {
      mobContainer.innerHTML = `
        <div class="empty-state-card" style="text-align: center; padding: 28px 20px; color: var(--text-muted); background: var(--bg-surface); border-radius: 14px; border: 1.5px dashed var(--border-color);">
          <i class="fa-solid fa-shield-halved" style="font-size: 1.8rem; margin-bottom: 8px; display: block; color: #cbd5e1;"></i>
          سجل العمليات فارغ حالياً.
        </div>
      `;
      return;
    }

    mobContainer.innerHTML = logs.map(l => {
      const safeAction = escapeHTML(l.action || 'عملية');
      const safeDetails = escapeHTML(l.details || '-');
      const safeUser = escapeHTML(l.userName || 'طاقم المركز');
      const safeTime = l.timestamp ? new Date(l.timestamp).toLocaleString('ar-EG-u-nu-latn') : '-';

      return `
        <div class="hero-styled-card">
          <div class="hsc-top" style="margin-bottom: 6px;">
            <span class="badge" style="background: rgba(2, 132, 199, 0.12); color: var(--primary); font-weight: 800; font-size: 0.8rem;">
              <i class="fa-solid fa-shield-halved"></i> ${safeAction}
            </span>
            <span style="font-size: 0.76rem; color: var(--text-muted);">${safeTime}</span>
          </div>
          <div style="font-size: 0.86rem; color: var(--text-main); margin-bottom: 8px; font-weight: 600;">
            ${safeDetails}
          </div>
          <div style="font-size: 0.78rem; color: var(--text-muted);">
            <i class="fa-solid fa-user-check"></i> منفذ العملية: <strong>${safeUser}</strong>
          </div>
        </div>
      `;
    }).join('');
  }

  async filterAuditLogs() {
    const searchVal = (document.getElementById('audit-search-input')?.value || '').trim().toLowerCase();
    const actionVal = document.getElementById('audit-filter-action')?.value || 'all';

    const cards = document.querySelectorAll('#audit-log-mobile-cards .hero-styled-card');
    cards.forEach(c => {
      const text = c.textContent.toLowerCase();
      const matchSearch = !searchVal || text.includes(searchVal);
      const matchAction = actionVal === 'all' || text.includes(actionVal.toLowerCase());
      c.style.display = (matchSearch && matchAction) ? 'block' : 'none';
    });
  }

  async handlePurgeAudit() {
    const confirmed = await this.app.showConfirm(
      'هل أنت متأكد من تنظيف وأرشفة العمليات القديمة (الأقدم من 90 يوماً)؟',
      'تأكيد تنظيف السجل'
    );
    if (!confirmed) return;

    try {
      await db.purgeOldAuditLogs();
      this.app.showToast('تم تنظيف سجل العمليات القديمة بنجاح.');
      await this.loadAuditLogs();
    } catch (err) {
      this.app.showAlert('تعذر تنظيف السجل: ' + err.message, 'خطأ', 'danger');
    }
  }
}
