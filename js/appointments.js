// ========================================================
// ASCPT - Weekly Appointments Schedule (Fixed Recurring Template)
// ========================================================
// This is NOT tied to specific calendar dates or specific days of
// the week. A booking is (doctor + time slot + patient) only -
// in real clinic life this doctor sees this same patient at this
// same time on every day he works that week (e.g. Sat/Mon/Wed),
// so one record covers all of those days at once. A slot keeps
// showing the same patient every week until someone deletes it
// and books a different patient in its place.

import { escapeHTML } from './utils.js';
import { db } from './db.js';
import { auth } from './auth.js';

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
// doctors combined at the same time slot only shows a soft warning -
// it never blocks adding another patient (matches the paper sheet:
// the secretary decides, the system just gives her a heads-up).
const MAX_BEDS_PER_SLOT = 6;

export class AppointmentsManager {
  constructor(app) {
    this.app = app;
    this.appointments = [];
    this.doctors = [];
    this.patients = [];
    this.pendingDoctorUid = null;
    this.pendingDoctorName = null;
    this.pendingTimeSlot = null;
    this.selectedPatientId = null;
    this.selectedPatientName = null;
  }

  async init() {
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

  // Count across ALL doctors at this time slot (beds are shared clinic-wide).
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

    const rows = APPT_SLOTS.map((slot) => {
      const totalInSlot = this.getSlotTotalCount(slot.key);
      const overCapacity = totalInSlot > MAX_BEDS_PER_SLOT;

      const cells = doctorsToShow.map((doc) => {
        const cellAppts = this.getCellAppointments(doc.uid, slot.key);
        const chips = cellAppts.map((a) => `
          <div class="appt-chip" data-appt-id="${escapeHTML(a.id)}">
            <span class="appt-chip-patient">${escapeHTML(a.patientName)}</span>
            <button type="button" class="appt-chip-remove" data-remove-appt="${escapeHTML(a.id)}" title="حذف">&times;</button>
          </div>
        `).join('');

        return `
          <td class="appt-cell ${overCapacity ? 'appt-cell-over' : ''}">
            ${chips}
            <button type="button" class="btn-add-appt" data-add-doctor="${escapeHTML(doc.uid)}" data-add-doctor-name="${escapeHTML(doc.name)}" data-add-slot="${slot.key}">
              <i class="fa-solid fa-plus"></i> حجز
            </button>
          </td>
        `;
      }).join('');

      return `<tr>
        <td class="appt-time-label">
          ${slot.label}
          ${overCapacity ? `<div class="appt-over-badge" title="عدد الحالات في هذا الموعد (${totalInSlot}) تجاوز عدد الأسرة (${MAX_BEDS_PER_SLOT})"><i class="fa-solid fa-triangle-exclamation"></i> ${totalInSlot}/${MAX_BEDS_PER_SLOT}</div>` : ''}
        </td>
        ${cells}
      </tr>`;
    }).join('');

    return `
      <table class="data-table appt-table">
        <thead><tr><th></th>${doctorsHeader}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  handleGridClick(e) {
    const removeBtn = e.target.closest('[data-remove-appt]');
    if (removeBtn) {
      this.deleteAppointment(removeBtn.getAttribute('data-remove-appt'));
      return;
    }
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

    const slotLabel = APPT_SLOTS.find((s) => s.key === timeSlot)?.label || timeSlot;
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

  async refreshVisibleGrids() {
    if (document.getElementById('appointments-grid')) await this.render();
    const myGrid = document.getElementById('my-appointments-grid');
    if (myGrid) {
      const uid = auth.getCurrentUser()?.uid;
      if (uid) await this.renderForDoctor(uid);
    }
  }
}
