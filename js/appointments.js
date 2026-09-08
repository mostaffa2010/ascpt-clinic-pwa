// ========================================================
// ASCPT - Weekly Appointments Schedule (Customizable Recurring Template)
// ========================================================
// A booking is (doctor + time slot + patient).
// Time slots represent horizontal rows across all doctors.
// Slots can now be customized, added, or deleted directly from the UI.

import { escapeHTML } from './utils.js';
import { db } from './db.js';
import { auth } from './auth.js';

export const DEFAULT_APPT_SLOTS = [
  { key: '15:30', label: '٣:٣٠ م' },
  { key: '16:30', label: '٤:٣٠ م' },
  { key: '17:30', label: '٥:٣٠ م' },
  { key: '18:30', label: '٦:٣٠ م' },
  { key: '19:00', label: '٧:٠٠ م' }
];

const MAX_BEDS_PER_SLOT = 6;

const ARABIC_DIGITS = { '0': '٠', '1': '١', '2': '٢', '3': '٣', '4': '٤', '5': '٥', '6': '٦', '7': '٧', '8': '٨', '9': '٩' };

export function formatTimeSlotLabel(hour, minute, period) {
  const hStr = String(hour);
  const mStr = String(minute).padStart(2, '0');
  const hAr = hStr.split('').map(c => ARABIC_DIGITS[c] || c).join('');
  const mAr = mStr.split('').map(c => ARABIC_DIGITS[c] || c).join('');
  const pAr = period === 'PM' ? 'م' : 'ص';
  return `${hAr}:${mAr} ${pAr}`;
}

export function buildSlotKey(hour, minute, period) {
  let h24 = parseInt(hour, 10);
  if (period === 'PM' && h24 < 12) h24 += 12;
  if (period === 'AM' && h24 === 12) h24 = 0;
  return `${String(h24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function parseSlotKey(key) {
  const parts = (key || '15:30').split(':');
  let h24 = parseInt(parts[0], 10) || 15;
  const minute = parts[1] || '30';
  let period = 'PM';
  let hour = h24;
  if (h24 === 0) {
    hour = 12;
    period = 'AM';
  } else if (h24 < 12) {
    period = 'AM';
  } else if (h24 === 12) {
    period = 'PM';
  } else {
    hour = h24 - 12;
    period = 'PM';
  }
  return { hour: String(hour), minute, period };
}

export class AppointmentsManager {
  constructor(app) {
    this.app = app;
    this.appointments = [];
    this.doctors = [];
    this.patients = [];
    this.slots = [];
    this.pendingDoctorUid = null;
    this.pendingDoctorName = null;
    this.pendingTimeSlot = null;
    this.selectedPatientId = null;
    this.selectedPatientName = null;

    // Slot Editing State
    this.slotEditMode = 'edit'; // 'edit' | 'add'
    this.slotEditOldKey = null;
    this.movingAppt = null;
  }

  async init() {
    try { await this.loadAll(); } catch (_) {}
    const grid = document.getElementById('appointments-grid');
    if (grid) grid.addEventListener('click', (e) => this.handleGridClick(e));

    const myGrid = document.getElementById('my-appointments-grid');
    if (myGrid) myGrid.addEventListener('click', (e) => this.handleGridClick(e));

    document.getElementById('modal-appointment-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submitAppointment();
    });

    document.getElementById('appt-patient-picker-trigger')?.addEventListener('click', () => this.openPatientPicker());

    const searchInput = document.getElementById('appt-picker-search-input');
    if (searchInput) searchInput.addEventListener('input', () => this.renderPickerPatients());

    document.getElementById('appt-picker-patients-list')?.addEventListener('click', (e) => {
      const item = e.target.closest('.picker-item');
      if (item) this.selectPatientFromPicker(item.getAttribute('data-patient-id'));
    });

    // Add New Slot Trigger Button in Card Header
    document.getElementById('form-move-appointment')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleConfirmMoveAppointment();
    });

    document.getElementById('btn-add-new-slot')?.addEventListener('click', () => this.openAddSlotModal());

    // Slot Edit Form Controls
    document.getElementById('form-edit-appointment-slot')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleSaveSlotTime();
    });

    document.getElementById('btn-delete-slot-row')?.addEventListener('click', () => this.handleDeleteSlotRow());

    // Slot Input Changes (update preview live)
    ['slot-input-hour', 'slot-input-minute', 'slot-input-period'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', () => this.updateSlotPreview());
    });

    // Quick Chips delegation in Edit Slot Modal
    const chipsContainer = document.getElementById('slot-quick-chips');
    if (chipsContainer) {
      chipsContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.slot-quick-btn');
        if (btn) {
          const h = btn.dataset.h;
          const m = btn.dataset.m;
          const p = btn.dataset.p;
          const hSel = document.getElementById('slot-input-hour');
          const mSel = document.getElementById('slot-input-minute');
          const pSel = document.getElementById('slot-input-period');
          if (hSel) hSel.value = h;
          if (mSel) mSel.value = m;
          if (pSel) pSel.value = p;
          this.updateSlotPreview();
        }
      });
    }

    this.renderSlotQuickChips();
  }

  async loadAll() {
    const [appointments, doctors, patients, slots] = await Promise.all([
      db.getAppointments(),
      db.getDoctorsList(),
      db.getPatients(),
      db.getAppointmentSlots ? db.getAppointmentSlots() : DEFAULT_APPT_SLOTS
    ]);
    this.appointments = appointments;
    this.doctors = doctors;
    this.patients = patients;
    this.slots = (Array.isArray(slots) && slots.length > 0) ? slots : DEFAULT_APPT_SLOTS;
  }

  getSlotTotalCount(timeSlot) {
    return this.appointments.filter((a) => a.timeSlot === timeSlot).length;
  }

  getCellAppointments(doctorUid, timeSlot) {
    return this.appointments.filter((a) => a.doctorUid === doctorUid && a.timeSlot === timeSlot);
  }

  // ================= Full Grid: every active doctor as a column =================
  async render() {
    const grid = document.getElementById('appointments-grid');
    if (!grid) return;
    try {
      await this.loadAll();
      grid.innerHTML = this.buildGridHTML(this.doctors);
    } catch (err) {
      console.error('Appointments render error:', err);
      grid.innerHTML = this.buildErrorHTML(err);
    }
  }

  // ================= Doctor's Own Single Column (Doctor Dashboard) =================
  async renderForDoctor(doctorUid) {
    const grid = document.getElementById('my-appointments-grid');
    if (!grid) return;
    try {
      await this.loadAll();
      const me = this.doctors.find((d) => d.uid === doctorUid);
      grid.innerHTML = this.buildGridHTML(me ? [me] : []);
    } catch (err) {
      console.error('Appointments (doctor) render error:', err);
      grid.innerHTML = this.buildErrorHTML(err);
    }
  }

  buildErrorHTML(err) {
    return `<div style="padding: 20px; text-align: center; color: var(--danger);">
      <i class="fa-solid fa-triangle-exclamation"></i> تعذر تحميل جدول المواعيد.<br>
      <span style="font-size: 0.8rem; color: var(--text-muted);">${escapeHTML(err.message || 'خطأ غير معروف')}</span>
    </div>`;
  }

  buildGridHTML(doctorsToShow) {
    if (!doctorsToShow || doctorsToShow.length === 0) {
      return `<div style="padding: 20px; text-align: center; color: var(--text-muted);">لا يوجد دكاترة مسجلين حالياً في طاقم العمل.</div>`;
    }

    const doctorsHeader = doctorsToShow.map((doc) =>
      `<th style="text-align:center; min-width: 150px;"><i class="fa-solid fa-user-doctor" style="color: var(--primary);"></i> ${escapeHTML(doc.name)}</th>`
    ).join('');

    const slotsToRender = (this.slots && this.slots.length > 0) ? this.slots : DEFAULT_APPT_SLOTS;

    const rows = slotsToRender.map((slot) => {
      const totalInSlot = this.getSlotTotalCount(slot.key);
      const overCapacity = totalInSlot > MAX_BEDS_PER_SLOT;

      const cells = doctorsToShow.map((doc) => {
        const cellAppts = this.getCellAppointments(doc.uid, slot.key);
        const chips = cellAppts.map((a) => `
          <div class="appt-chip" data-appt-id="${escapeHTML(a.id)}">
            <span class="appt-chip-patient" data-move-appt="${escapeHTML(a.id)}" title="اضغط لنقل الموعد أو تعديله">${escapeHTML(a.patientName)}</span>
            <div class="appt-chip-actions">
              <button type="button" class="appt-chip-move" data-move-appt="${escapeHTML(a.id)}" title="نقل الموعد لطبيب أو ساعة أخرى">
                <i class="fa-solid fa-arrow-right-arrow-left"></i>
              </button>
              <button type="button" class="appt-chip-remove" data-remove-appt="${escapeHTML(a.id)}" title="حذف">&times;</button>
            </div>
          </div>
        `).join('');

        return `
          <td class="appt-cell ${overCapacity ? 'appt-cell-over' : ''}">
            ${chips}
            <button type="button" class="btn-add-appt" data-add-doctor="${escapeHTML(doc.uid)}" data-add-doctor-name="${escapeHTML(doc.name)}" data-add-slot="${escapeHTML(slot.key)}">
              <i class="fa-solid fa-plus"></i> حجز
            </button>
          </td>
        `;
      }).join('');

      return `<tr>
        <td class="appt-time-label">
          <div class="appt-time-box" data-edit-slot="${escapeHTML(slot.key)}" data-slot-label="${escapeHTML(slot.label)}" title="اضغط لتعديل وقت هذا الموعد">
            <span class="appt-time-text">${escapeHTML(slot.label)}</span>
            <i class="fa-solid fa-pen-to-square appt-time-edit-icon"></i>
          </div>
          ${overCapacity ? `<div class="appt-over-badge" title="عدد الحالات في هذا الموعد (${totalInSlot}) تجاوز عدد الأسرة (${MAX_BEDS_PER_SLOT})"><i class="fa-solid fa-triangle-exclamation"></i> ${totalInSlot}/${MAX_BEDS_PER_SLOT}</div>` : ''}
        </td>
        ${cells}
      </tr>`;
    }).join('');

    return `
      <table class="data-table appt-table">
        <thead><tr><th style="min-width: 100px; text-align: center;"><i class="fa-regular fa-clock" style="color: var(--primary);"></i> الميعاد</th>${doctorsHeader}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  handleGridClick(e) {
    // 1. Edit slot row time
    const editSlotTrigger = e.target.closest('[data-edit-slot]');
    if (editSlotTrigger) {
      const slotKey = editSlotTrigger.getAttribute('data-edit-slot');
      const slotLabel = editSlotTrigger.getAttribute('data-slot-label');
      this.openEditSlotModal(slotKey, slotLabel);
      return;
    }

    // 2. Remove appointment
    const removeBtn = e.target.closest('[data-remove-appt]');
    if (removeBtn) {
      this.deleteAppointment(removeBtn.getAttribute('data-remove-appt'));
      return;
    }

    // 2.5 Move / reschedule appointment
    const moveBtn = e.target.closest('[data-move-appt]');
    if (moveBtn) {
      this.openMoveModal(moveBtn.getAttribute('data-move-appt'));
      return;
    }

    // 3. Add appointment
    const addBtn = e.target.closest('.btn-add-appt');
    if (addBtn) {
      this.openAddModal(
        addBtn.getAttribute('data-add-doctor'),
        addBtn.getAttribute('data-add-doctor-name'),
        addBtn.getAttribute('data-add-slot')
      );
    }
  }

  // ================= Add Appointment Modal =================
  openAddModal(doctorUid, doctorName, timeSlot) {
    this.pendingDoctorUid = doctorUid;
    this.pendingDoctorName = doctorName;
    this.pendingTimeSlot = timeSlot;
    this.selectedPatientId = null;
    this.selectedPatientName = null;

    const slotLabel = (this.slots || []).find((s) => s.key === timeSlot)?.label || timeSlot;
    document.getElementById('appt-modal-title').textContent = `حجز موعد - د. ${doctorName} - الساعة ${slotLabel}`;

    const trigger = document.getElementById('appt-patient-picker-trigger');
    if (trigger) trigger.querySelector('.btn-text').textContent = '-- اختر مريض من السجل --';

    this.app.openModal('modal-appointment');
  }

  async openPatientPicker() {
    const searchInput = document.getElementById('appt-picker-search-input');
    if (searchInput) searchInput.value = '';
    await this.renderPickerPatients();
    this.app.openModal('modal-appt-patient-picker');
    if (searchInput) setTimeout(() => searchInput.focus(), 250);
  }

  normalizeArabic(text) {
    if (!text) return '';
    return text.toString().trim().toLowerCase()
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/[\u064B-\u065F\u0670]/g, '');
  }

  getPatientSearchScore(p, rawQuery) {
    const q = this.normalizeArabic(rawQuery);
    if (!q) return 1;
    const name = this.normalizeArabic(p.name);
    const words = name.split(/\s+/);
    if (words[0] && words[0].startsWith(q)) return 10000 - words[0].length;
    if (words[1] && words[1].startsWith(q)) return 5000 - words[1].length;
    for (let i = 2; i < words.length; i++) {
      if (words[i].startsWith(q)) return 2000 - (i * 10);
    }
    if (name.includes(q)) return 500;
    const phone = (p.phone || '').replace(/[^0-9]/g, '');
    const cleanDigits = rawQuery.replace(/[^0-9]/g, '');
    if (cleanDigits && phone.includes(cleanDigits)) return phone.startsWith(cleanDigits) ? 200 : 100;
    return -1;
  }

  async renderPickerPatients() {
    const container = document.getElementById('appt-picker-patients-list');
    if (!container) return;
    const rawSearch = document.getElementById('appt-picker-search-input')?.value.trim() || '';

    let scored = [];
    for (const p of this.patients) {
      if (!rawSearch) {
        scored.push({ patient: p, score: 0 });
      } else {
        const score = this.getPatientSearchScore(p, rawSearch);
        if (score > 0) scored.push({ patient: p, score });
      }
    }
    scored.sort((a, b) => (b.score !== a.score) ? b.score - a.score : a.patient.name.localeCompare(b.patient.name, 'ar'));
    const filtered = scored.map((item) => item.patient);

    if (filtered.length === 0) {
      container.innerHTML = `<div style="text-align: center; padding: 24px; color: var(--text-muted); font-size: 0.9rem;">لا يوجد مريض بهذا الاسم أو الرقم.</div>`;
      return;
    }

    container.innerHTML = filtered.map((p) => `
      <div class="picker-item" data-patient-id="${escapeHTML(p.id)}">
        <div>
          <div style="font-weight: 700; color: var(--text-main); font-size: 0.95rem;">
            <i class="fa-solid fa-user" style="color: var(--primary); margin-left: 6px;"></i> ${escapeHTML(p.name)}
          </div>
          <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 3px;">
            <i class="fa-solid fa-phone" style="font-size: 0.75rem;"></i> ${escapeHTML(p.phone)}
          </div>
        </div>
      </div>
    `).join('');
  }

  selectPatientFromPicker(patientId) {
    const patient = this.patients.find((p) => p.id === patientId);
    if (!patient) return;
    this.selectedPatientId = patient.id;
    this.selectedPatientName = patient.name;
    const trigger = document.getElementById('appt-patient-picker-trigger');
    if (trigger) trigger.querySelector('.btn-text').textContent = patient.name;
    this.app.closeModal('modal-appt-patient-picker');
  }

  async submitAppointment() {
    if (!this.selectedPatientId) {
      this.app.showAlert('من فضلك اختر المريض من السجل.', 'بيانات ناقصة', 'warning');
      return;
    }

    try {
      await db.addAppointment({
        doctorUid: this.pendingDoctorUid,
        doctorName: this.pendingDoctorName,
        timeSlot: this.pendingTimeSlot,
        patientId: this.selectedPatientId,
        patientName: this.selectedPatientName,
        createdBy: auth.getCurrentUser()?.name || ''
      });
      this.app.closeModal('modal-appointment');
      this.app.showToast('تم حجز الموعد بنجاح');
      await this.refreshVisibleGrids();
    } catch (err) {
      this.app.showAlert('تعذر حجز الموعد: ' + err.message, 'خطأ', 'danger');
    }
  }

  async deleteAppointment(apptId) {
    const confirmed = await this.app.showConfirm('هل تريد إلغاء هذا الموعد؟', 'تأكيد الإلغاء');
    if (!confirmed) return;
    try {
      await db.deleteAppointment(apptId);
      this.app.showToast('تم إلغاء الموعد');
      await this.refreshVisibleGrids();
    } catch (err) {
      this.app.showAlert('تعذر إلغاء الموعد: ' + err.message, 'خطأ', 'danger');
    }
  }

  // ================= Slot Management Modals & Handlers =================
  renderSlotQuickChips() {
    const container = document.getElementById('slot-quick-chips');
    if (!container) return;
    const chips = [
      { h: '1', m: '00', p: 'PM', label: '١:٠٠ م' },
      { h: '1', m: '30', p: 'PM', label: '١:٣٠ م' },
      { h: '2', m: '00', p: 'PM', label: '٢:٠٠ م' },
      { h: '2', m: '30', p: 'PM', label: '٢:٣٠ م' },
      { h: '3', m: '00', p: 'PM', label: '٣:٠٠ م' },
      { h: '3', m: '30', p: 'PM', label: '٣:٣٠ م' },
      { h: '4', m: '00', p: 'PM', label: '٤:٠٠ م' },
      { h: '4', m: '30', p: 'PM', label: '٤:٣٠ م' },
      { h: '5', m: '00', p: 'PM', label: '٥:٠٠ م' },
      { h: '5', m: '30', p: 'PM', label: '٥:٣٠ م' },
      { h: '6', m: '00', p: 'PM', label: '٦:٠٠ م' },
      { h: '6', m: '30', p: 'PM', label: '٦:٣٠ م' },
      { h: '7', m: '00', p: 'PM', label: '٧:٠٠ م' },
      { h: '7', m: '30', p: 'PM', label: '٧:٣٠ م' },
      { h: '8', m: '00', p: 'PM', label: '٨:٠٠ م' }
    ];
    container.innerHTML = chips.map(c => `
      <button type="button" class="btn btn-outline btn-sm slot-quick-btn" data-h="${c.h}" data-m="${c.m}" data-p="${c.p}" style="padding: 3px 8px; font-size: 0.78rem; font-weight: 700; border-radius: 6px;">
        ${c.label}
      </button>
    `).join('');
  }

  updateSlotPreview() {
    const hour = document.getElementById('slot-input-hour')?.value || '3';
    const minute = document.getElementById('slot-input-minute')?.value || '30';
    const period = document.getElementById('slot-input-period')?.value || 'PM';
    const label = formatTimeSlotLabel(hour, minute, period);
    const previewEl = document.getElementById('slot-preview-label');
    if (previewEl) previewEl.textContent = label;
  }

  openEditSlotModal(slotKey, slotLabel) {
    this.slotEditMode = 'edit';
    this.slotEditOldKey = slotKey;

    const modalTitle = document.getElementById('modal-slot-title');
    if (modalTitle) modalTitle.innerHTML = '<i class="fa-solid fa-clock" style="color: var(--primary);"></i> تعديل موعد في الجدول';

    const oldKeyInput = document.getElementById('slot-edit-old-key');
    if (oldKeyInput) oldKeyInput.value = slotKey;

    const modeInput = document.getElementById('slot-edit-mode');
    if (modeInput) modeInput.value = 'edit';

    const btnDelete = document.getElementById('btn-delete-slot-row');
    if (btnDelete) btnDelete.style.display = 'inline-flex';

    const submitBtnText = document.querySelector('#btn-save-slot-time span');
    if (submitBtnText) submitBtnText.textContent = 'حفظ التعديل';

    const parsed = parseSlotKey(slotKey);
    const hSel = document.getElementById('slot-input-hour');
    const mSel = document.getElementById('slot-input-minute');
    const pSel = document.getElementById('slot-input-period');
    if (hSel) hSel.value = parsed.hour;
    if (mSel) mSel.value = parsed.minute;
    if (pSel) pSel.value = parsed.period;

    this.updateSlotPreview();
    this.app.openModal('modal-edit-appointment-slot');
  }

  openAddSlotModal() {
    this.slotEditMode = 'add';
    this.slotEditOldKey = null;

    const modalTitle = document.getElementById('modal-slot-title');
    if (modalTitle) modalTitle.innerHTML = '<i class="fa-solid fa-calendar-plus" style="color: var(--primary);"></i> إضافة موعد جديد للجدول';

    const oldKeyInput = document.getElementById('slot-edit-old-key');
    if (oldKeyInput) oldKeyInput.value = '';

    const modeInput = document.getElementById('slot-edit-mode');
    if (modeInput) modeInput.value = 'add';

    const btnDelete = document.getElementById('btn-delete-slot-row');
    if (btnDelete) btnDelete.style.display = 'none';

    const submitBtnText = document.querySelector('#btn-save-slot-time span');
    if (submitBtnText) submitBtnText.textContent = 'إضافة الموعد';

    const hSel = document.getElementById('slot-input-hour');
    const mSel = document.getElementById('slot-input-minute');
    const pSel = document.getElementById('slot-input-period');
    if (hSel) hSel.value = '8';
    if (mSel) mSel.value = '00';
    if (pSel) pSel.value = 'PM';

    this.updateSlotPreview();
    this.app.openModal('modal-edit-appointment-slot');
  }

  async handleSaveSlotTime() {
    const hour = document.getElementById('slot-input-hour')?.value || '3';
    const minute = document.getElementById('slot-input-minute')?.value || '30';
    const period = document.getElementById('slot-input-period')?.value || 'PM';
    const newKey = buildSlotKey(hour, minute, period);
    const newLabel = formatTimeSlotLabel(hour, minute, period);

    try {
      if (this.slotEditMode === 'add') {
        await db.addAppointmentSlot(newKey, newLabel);
        this.app.showToast(`تمت إضافة موعد (${newLabel}) إلى الجدول بنجاح`);
      } else {
        await db.updateAppointmentSlot(this.slotEditOldKey, newKey, newLabel);
        this.app.showToast(`تم تعديل الموعد إلى (${newLabel}) بنجاح`);
      }
      this.app.closeModal('modal-edit-appointment-slot');
      await this.refreshVisibleGrids();
    } catch (err) {
      this.app.showAlert('تعذر حفظ الموعد: ' + err.message, 'خطأ', 'danger');
    }
  }

  async handleDeleteSlotRow() {
    if (!this.slotEditOldKey) return;
    const keyToDelete = this.slotEditOldKey;
    const affected = this.appointments.filter(a => a.timeSlot === keyToDelete);

    let confirmMsg = 'هل أنت متأكد من حذف هذا الموعد وصفه بالكامل من الجدول؟';
    if (affected.length > 0) {
      confirmMsg = `تنبيه: هذا الموعد يحتوي على (${affected.length}) حجوزات لمرضى مسجلين. حذفه سيؤدي لإلغاء هذه الحجوزات نهائياً. هل أنت متأكد من الحذف؟`;
    }

    const confirmed = await this.app.showConfirm(confirmMsg, 'تأكيد حذف الموعد');
    if (!confirmed) return;

    try {
      await db.deleteAppointmentSlot(keyToDelete);
      this.app.closeModal('modal-edit-appointment-slot');
      this.app.showToast('تم حذف الموعد من الجدول');
      await this.refreshVisibleGrids();
    } catch (err) {
      this.app.showAlert('تعذر حذف الموعد: ' + err.message, 'خطأ', 'danger');
    }
  }

  // ================= Move / Reschedule Appointment Modal =================
  openMoveModal(apptId) {
    const appt = this.appointments.find((a) => a.id === apptId);
    if (!appt) return;

    this.movingAppt = appt;
    const nameEl = document.getElementById('move-appt-patient-name');
    if (nameEl) nameEl.textContent = appt.patientName;

    const currentSlotObj = (this.slots || []).find((s) => s.key === appt.timeSlot);
    const slotLabel = currentSlotObj ? currentSlotObj.label : appt.timeSlot;
    const infoEl = document.getElementById('move-appt-current-info');
    if (infoEl) {
      infoEl.textContent = `الموعد الحالي: د. ${appt.doctorName || '-'} — الساعة ${slotLabel}`;
    }

    const docSel = document.getElementById('move-appt-doctor');
    if (docSel) {
      docSel.innerHTML = this.doctors.map((d) => `
        <option value="${escapeHTML(d.uid)}" data-name="${escapeHTML(d.name)}" ${d.uid === appt.doctorUid ? 'selected' : ''}>
          ${escapeHTML(d.name)}
        </option>
      `).join('');
    }

    const slotSel = document.getElementById('move-appt-slot');
    if (slotSel) {
      const slotsToUse = (this.slots && this.slots.length > 0) ? this.slots : DEFAULT_APPT_SLOTS;
      slotSel.innerHTML = slotsToUse.map((s) => {
        const count = this.getSlotTotalCount(s.key);
        return `
          <option value="${escapeHTML(s.key)}" ${s.key === appt.timeSlot ? 'selected' : ''}>
            ${escapeHTML(s.label)} (${count}/${MAX_BEDS_PER_SLOT} حالات)
          </option>
        `;
      }).join('');
    }

    if (this.app?.updateCustomSelectDisplay) {
      this.app.updateCustomSelectDisplay('move-appt-doctor');
      this.app.updateCustomSelectDisplay('move-appt-slot');
    }

    this.app.openModal('modal-move-appointment');
  }

  async handleConfirmMoveAppointment() {
    if (!this.movingAppt) return;
    const apptId = this.movingAppt.id;
    const docSel = document.getElementById('move-appt-doctor');
    const slotSel = document.getElementById('move-appt-slot');

    const targetDoctorUid = docSel?.value;
    const targetDoctorName = docSel?.options[docSel.selectedIndex]?.getAttribute('data-name') || '';
    const targetSlotKey = slotSel?.value;
    const targetSlotLabel = (this.slots || []).find((s) => s.key === targetSlotKey)?.label || targetSlotKey;

    if (!targetDoctorUid || !targetSlotKey) {
      this.app.showAlert('من فضلك اختر الطبيب والميعاد المطلوب النقل إليه.', 'بيانات ناقصة', 'warning');
      return;
    }

    // If no change, simply close modal
    if (targetDoctorUid === this.movingAppt.doctorUid && targetSlotKey === this.movingAppt.timeSlot) {
      this.app.closeModal('modal-move-appointment');
      return;
    }

    try {
      await db.updateAppointment(apptId, {
        doctorUid: targetDoctorUid,
        doctorName: targetDoctorName,
        timeSlot: targetSlotKey
      });
      this.app.closeModal('modal-move-appointment');
      this.app.showToast(`تم نقل موعد ${this.movingAppt.patientName} إلى د. ${targetDoctorName} (${targetSlotLabel}) بنجاح`);
      this.movingAppt = null;
      await this.refreshVisibleGrids();
    } catch (err) {
      this.app.showAlert('تعذر نقل الموعد: ' + err.message, 'خطأ', 'danger');
    }
  }

  async refreshVisibleGrids() {
    if (document.getElementById('appointments-grid')) await this.render();
    const myGrid = document.getElementById('my-appointments-grid');
    if (myGrid) {
      const uid = auth.getCurrentUser()?.uid;
      if (uid) await this.renderForDoctor(uid);
    }
    if (this.app?.patientsManager?.renderPatients) {
      this.app.patientsManager.renderPatients();
    }
  }
}
