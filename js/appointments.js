// ========================================================
// ASCPT - Weekly Appointments Schedule (Fixed Recurring Template)
// ========================================================
// This is NOT tied to specific calendar dates. A booked slot
// (day + time + doctor) keeps showing the same patient every week
// until someone deletes it and books a different patient in its
// place - matching how the clinic's paper schedule sheet works.

import { escapeHTML } from './utils.js';
import { db } from './db.js';
import { auth } from './auth.js';

export const APPT_DAYS = [
  { key: 'sat', label: 'السبت' },
  { key: 'sun', label: 'الأحد' },
  { key: 'mon', label: 'الاثنين' },
  { key: 'tue', label: 'الثلاثاء' },
  { key: 'wed', label: 'الأربعاء' },
  { key: 'thu', label: 'الخميس' }
];

// The last slot is intentionally shorter (30 min instead of 60) -
// the clinic closes a bit earlier on that last appointment.
export const APPT_SLOTS = [
  { key: '15:30', label: '٣:٣٠' },
  { key: '16:30', label: '٤:٣٠' },
  { key: '17:30', label: '٥:٣٠' },
  { key: '18:30', label: '٦:٣٠' },
  { key: '19:00', label: '٧:٠٠' }
];

// Total treatment beds in the clinic. Exceeding this across ALL
// doctors combined at the same day+time only shows a soft warning -
// it never blocks adding another patient (matches the paper sheet:
// the secretary decides, the system just gives her a heads-up).
const MAX_BEDS_PER_SLOT = 6;

export class AppointmentsManager {
  constructor(app) {
    this.app = app;
    this.appointments = [];
    this.doctors = [];
    this.patients = [];
  }

  async init() {
    // Full grid (Admin/Receptionist view)
    const grid = document.getElementById('appointments-grid');
    if (grid) {
      grid.addEventListener('click', (e) => this.handleGridClick(e, null));
    }

    // Doctor's own filtered grid (inside the Doctor Dashboard)
    const myGrid = document.getElementById('my-appointments-grid');
    if (myGrid) {
      myGrid.addEventListener('click', (e) => this.handleGridClick(e, auth.getCurrentUser()?.uid));
    }

    document.getElementById('modal-appointment-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submitAppointment();
    });
  }

  async loadAll() {
    const [appointments, doctors, patients] = await Promise.all([
      db.getAppointments(),
      db.getDoctorsList(),
      db.getPatients()
    ]);
    this.appointments = appointments;
    this.doctors = doctors;
    this.patients = patients;
  }

  getSlotCount(day, timeSlot) {
    return this.appointments.filter((a) => a.day === day && a.timeSlot === timeSlot).length;
  }

  getCellAppointments(day, timeSlot, doctorUid = null) {
    return this.appointments.filter((a) =>
      a.day === day && a.timeSlot === timeSlot && (!doctorUid || a.doctorUid === doctorUid)
    );
  }

  // ================= Full Grid (all doctors mixed per cell, like the paper sheet) =================
  async render() {
    const grid = document.getElementById('appointments-grid');
    if (!grid) return;
    try {
      await this.loadAll();
      grid.innerHTML = this.buildGridHTML(null);
    } catch (err) {
      console.error('Appointments render error:', err);
      grid.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--danger);">
        <i class="fa-solid fa-triangle-exclamation"></i> تعذر تحميل جدول المواعيد.<br>
        <span style="font-size: 0.8rem; color: var(--text-muted);">${escapeHTML(err.message || 'خطأ غير معروف')}</span>
      </div>`;
    }
  }

  // ================= Doctor's Own Column (used inside the Doctor Dashboard) =================
  async renderForDoctor(doctorUid) {
    const grid = document.getElementById('my-appointments-grid');
    if (!grid) return;
    try {
      await this.loadAll();
      grid.innerHTML = this.buildGridHTML(doctorUid);
    } catch (err) {
      console.error('Appointments (doctor) render error:', err);
      grid.innerHTML = `<div style="padding: 16px; text-align: center; color: var(--danger); font-size: 0.85rem;">
        <i class="fa-solid fa-triangle-exclamation"></i> تعذر تحميل الجدول: ${escapeHTML(err.message || 'خطأ غير معروف')}
      </div>`;
    }
  }

  buildGridHTML(filterDoctorUid) {
    const daysHeader = APPT_DAYS.map((d) => `<th style="text-align:center; min-width: 140px;">${d.label}</th>`).join('');

    const rows = APPT_SLOTS.map((slot) => {
      const cells = APPT_DAYS.map((day) => {
        const totalInSlot = this.getSlotCount(day.key, slot.key);
        const cellAppts = this.getCellAppointments(day.key, slot.key, filterDoctorUid);
        const overCapacity = totalInSlot > MAX_BEDS_PER_SLOT;

        const chips = cellAppts.map((a) => `
          <div class="appt-chip" data-appt-id="${escapeHTML(a.id)}" title="اضغط للحذف">
            <span class="appt-chip-patient">${escapeHTML(a.patientName)}</span>
            ${filterDoctorUid ? '' : `<span class="appt-chip-doctor">${escapeHTML(a.doctorName)}</span>`}
            <button type="button" class="appt-chip-remove" data-remove-appt="${escapeHTML(a.id)}" title="حذف">&times;</button>
          </div>
        `).join('');

        return `
          <td class="appt-cell ${overCapacity ? 'appt-cell-over' : ''}">
            ${overCapacity ? `<div class="appt-over-badge" title="عدد الحالات في هذا الموعد (${totalInSlot}) تجاوز عدد الأسرة (${MAX_BEDS_PER_SLOT})"><i class="fa-solid fa-triangle-exclamation"></i> تجاوز الأسرّة (${totalInSlot}/${MAX_BEDS_PER_SLOT})</div>` : ''}
            ${chips}
            <button type="button" class="btn-add-appt" data-add-day="${day.key}" data-add-slot="${slot.key}" ${filterDoctorUid ? `data-add-doctor="${escapeHTML(filterDoctorUid)}"` : ''}>
              <i class="fa-solid fa-plus"></i> حجز
            </button>
          </td>
        `;
      }).join('');

      return `<tr><td class="appt-time-label">${slot.label}</td>${cells}</tr>`;
    }).join('');

    return `
      <table class="data-table appt-table">
        <thead><tr><th></th>${daysHeader}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  handleGridClick(e, presetDoctorUid) {
    const removeBtn = e.target.closest('[data-remove-appt]');
    if (removeBtn) {
      this.deleteAppointment(removeBtn.getAttribute('data-remove-appt'), presetDoctorUid);
      return;
    }
    const addBtn = e.target.closest('.btn-add-appt');
    if (addBtn) {
      const day = addBtn.getAttribute('data-add-day');
      const slot = addBtn.getAttribute('data-add-slot');
      const doctorUid = addBtn.getAttribute('data-add-doctor') || presetDoctorUid || '';
      this.openAddModal(day, slot, doctorUid);
    }
  }

  // ================= Add Appointment Modal =================
  openAddModal(day, timeSlot, presetDoctorUid) {
    const dayLabel = APPT_DAYS.find((d) => d.key === day)?.label || day;
    const slotLabel = APPT_SLOTS.find((s) => s.key === timeSlot)?.label || timeSlot;

    document.getElementById('appt-modal-day').value = day;
    document.getElementById('appt-modal-slot').value = timeSlot;
    document.getElementById('appt-modal-title').textContent = `حجز موعد - ${dayLabel} الساعة ${slotLabel}`;

    const doctorSelect = document.getElementById('appt-modal-doctor');
    doctorSelect.innerHTML = this.doctors.map((doc) =>
      `<option value="${escapeHTML(doc.uid)}">${escapeHTML(doc.name)}</option>`
    ).join('');
    if (presetDoctorUid) {
      doctorSelect.value = presetDoctorUid;
      doctorSelect.disabled = true;
    } else {
      doctorSelect.disabled = false;
    }

    const patientSelect = document.getElementById('appt-modal-patient');
    patientSelect.innerHTML = '<option value="">-- اختر مريض من السجل --</option>' +
      this.patients.map((p) => `<option value="${escapeHTML(p.id)}">${escapeHTML(p.name)}</option>`).join('');

    this.app.openModal('modal-appointment');
  }

  async submitAppointment() {
    const day = document.getElementById('appt-modal-day').value;
    const timeSlot = document.getElementById('appt-modal-slot').value;
    const doctorSelect = document.getElementById('appt-modal-doctor');
    const doctorUid = doctorSelect.value;
    const doctorName = doctorSelect.selectedOptions[0]?.textContent || '';
    const patientSelect = document.getElementById('appt-modal-patient');
    const patientId = patientSelect.value;
    const patientName = patientSelect.selectedOptions[0]?.textContent || '';

    if (!doctorUid || !patientId) {
      this.app.showAlert('من فضلك اختر الدكتور والمريض.', 'بيانات ناقصة', 'warning');
      return;
    }

    try {
      await db.addAppointment({
        day,
        timeSlot,
        doctorUid,
        doctorName,
        patientId,
        patientName,
        createdBy: auth.getCurrentUser()?.name || ''
      });
      this.app.closeModal('modal-appointment');
      this.app.showToast('تم حجز الموعد بنجاح');
      await this.refreshVisibleGrids();
    } catch (err) {
      this.app.showAlert('تعذر حجز الموعد: ' + err.message, 'خطأ', 'danger');
    }
  }

  async deleteAppointment(apptId, filterDoctorUid) {
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

  async refreshVisibleGrids() {
    if (document.getElementById('appointments-grid')) await this.render();
    const myGrid = document.getElementById('my-appointments-grid');
    if (myGrid) {
      const uid = auth.getCurrentUser()?.uid;
      if (uid) await this.renderForDoctor(uid);
    }
  }
}
