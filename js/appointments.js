// ========================================================
// ASCPT - Weekly Appointments Schedule (Customizable Recurring Template)
// ========================================================
// A booking is (doctor + time slot + patient).
// Time slots represent horizontal rows across all doctors.
// Slots can now be customized, added, or deleted directly from the UI.

import { escapeHTML, initStackDeck, getDoctorColor, getLocalDateStr, isDoctorOnDuty, getShiftLabel, getDayShiftKey } from './utils.js';
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
    this.doctorApptFilter = 'active'; // 'active' | 'completed'
    this.shiftOverrides = [];
    this.selectedDate = getLocalDateStr();
    this.selectedApptForAction = null;
    this._apptSubscribed = false;
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

    // Add New Slot Trigger Button in Card Header
    document.getElementById('form-move-appointment')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleConfirmMoveAppointment();
    });

    // Bind Copy Appointment Actions & Presets
    document.getElementById('form-copy-appointment')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleConfirmCopyAppointment();
    });

    document.getElementById('btn-copy-shift-sat-mon-wed')?.addEventListener('click', () => {
      this.setCopyShiftSelection([0, 2, 4]); // السبت (0)، الاثنين (2)، الأربعاء (4)
    });

    document.getElementById('btn-copy-shift-sun-tue-thu')?.addEventListener('click', () => {
      this.setCopyShiftSelection([1, 3, 5]); // الأحد (1)، الثلاثاء (3)، الخميس (5)
    });

    document.getElementById('btn-appt-sheet-copy')?.addEventListener('click', () => {
      const a = this.selectedApptForAction;
      this.app.closeModal('modal-appt-actions');
      if (a) this.openCopyModal(a.id);
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
          this.app.updateCustomSelectDisplay('slot-input-hour');
          this.app.updateCustomSelectDisplay('slot-input-minute');
          this.updatePeriodSegmentedDisplay(p);
          this.updateSlotPreview();
        }
      });
    }

    // Period Segmented Control (مساءً / صباحاً)
    const modalSlot = document.getElementById('modal-edit-appointment-slot');
    if (modalSlot) {
      modalSlot.addEventListener('click', (e) => {
        const pBtn = e.target.closest('.btn-slot-period');
        if (pBtn) {
          const p = pBtn.dataset.period;
          const pSel = document.getElementById('slot-input-period');
          if (pSel) {
            pSel.value = p;
            pSel.dispatchEvent(new Event('change', { bubbles: true }));
          }
          this.updatePeriodSegmentedDisplay(p);
          this.updateSlotPreview();
        }
      });
    }

    this.renderSlotQuickChips();

    // Shift Coverage Overrides (v1.4.76)
    document.getElementById('btn-open-shift-coverage')?.addEventListener('click', () => {
      this.openShiftCoverageModal();
    });

    document.getElementById('form-shift-coverage')?.addEventListener('submit', (e) => {
      this.handleSubmitShiftCoverage(e);
    });

    document.getElementById('coverage-active-list')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-delete-coverage');
      if (btn) {
        const id = btn.getAttribute('data-override-id');
        this.handleDeleteShiftCoverage(id);
      }
    });

    // Date Strip Navigation Controls (v2.0.0)
    document.getElementById('btn-appt-prev-day')?.addEventListener('click', () => this.navigateDay(-1));
    document.getElementById('btn-appt-next-day')?.addEventListener('click', () => this.navigateDay(1));
    document.getElementById('btn-appt-today')?.addEventListener('click', () => this.changeSelectedDate(getLocalDateStr()));

    const calPicker = document.getElementById('appt-calendar-picker');
    if (calPicker) {
      calPicker.value = this.selectedDate;
      calPicker.addEventListener('change', (e) => {
        if (e.target.value) this.changeSelectedDate(e.target.value);
      });
    }

    document.getElementById('appt-weekday-strip')?.addEventListener('click', (e) => {
      const pill = e.target.closest('.appt-weekday-pill');
      if (pill && pill.dataset.date) {
        this.changeSelectedDate(pill.dataset.date);
      }
    });

    // Action Bottom Sheet Buttons (v2.0.0)
    document.getElementById('btn-appt-sheet-checkin')?.addEventListener('click', () => {
      if (this.selectedApptForAction) this.handleCheckinFromAppt(this.selectedApptForAction);
    });

    document.getElementById('btn-appt-sheet-complete')?.addEventListener('click', () => {
      this.handleStatusUpdateFromSheet('completed');
    });

    document.getElementById('btn-appt-sheet-noshow')?.addEventListener('click', () => {
      this.handleStatusUpdateFromSheet('no-show');
    });

    document.getElementById('btn-appt-sheet-reset-scheduled')?.addEventListener('click', () => {
      this.handleStatusUpdateFromSheet('scheduled');
    });

    document.getElementById('btn-appt-sheet-move')?.addEventListener('click', () => {
      const a = this.selectedApptForAction;
      this.app.closeModal('modal-appt-actions');
      if (a) this.openMoveModal(a.id);
    });

    document.getElementById('btn-appt-sheet-delete')?.addEventListener('click', () => {
      const a = this.selectedApptForAction;
      this.app.closeModal('modal-appt-actions');
      if (a) this.deleteAppointment(a.id);
    });
  }

  async loadAll(targetDate = null, forceRefresh = false) {
    const dateToLoad = targetDate || this.selectedDate || getLocalDateStr();
    this.selectedDate = dateToLoad;

    const [appointments, doctors, patients, slots, sessions, shiftOverrides] = await Promise.all([
      db.getAppointments(forceRefresh),
      db.getDoctorsList(),
      db.getPatients(),
      db.getAppointmentSlots ? db.getAppointmentSlots() : DEFAULT_APPT_SLOTS,
      db.getSessions ? db.getSessions(dateToLoad) : [],
      db.getShiftOverrides ? db.getShiftOverrides(dateToLoad) : []
    ]);
    this.appointments = appointments || [];
    this.doctors = doctors || [];
    this.patients = patients || [];
    this.slots = (Array.isArray(slots) && slots.length > 0) ? slots : DEFAULT_APPT_SLOTS;
    this.sessions = sessions || [];
    this.shiftOverrides = shiftOverrides || [];
  }

  getAppointmentsForDate(dateStr) {
    if (!dateStr) return [];
    return (this.appointments || []).filter(a => {
      // 1. Direct date match
      if (a.date) {
        return a.date === dateStr;
      }
      // 2. Backward compatibility for legacy appointments without a date
      const shiftKey = getDayShiftKey(dateStr);
      if (a.dayOfWeek) {
        return a.dayOfWeek === shiftKey;
      }
      const doc = (this.doctors || []).find(d =>
        (a.doctorUid && (d.uid === a.doctorUid || d.id === a.doctorUid)) ||
        (a.doctorName && (d.name === a.doctorName || a.doctorName.includes(d.name) || d.name.includes(a.doctorName)))
      );
      return isDoctorOnDuty(doc?.shift, dateStr, this.shiftOverrides, a.doctorUid || doc?.uid);
    });
  }

  getSlotTotalCount(timeSlot, targetDate = this.selectedDate) {
    const dayAppts = this.getAppointmentsForDate(targetDate);
    return dayAppts.filter(a => a.timeSlot === timeSlot && a.status !== 'cancelled').length;
  }

  getCellAppointments(doctorUid, timeSlot, targetDate = this.selectedDate) {
    const dayAppts = this.getAppointmentsForDate(targetDate);
    const docObj = (this.doctors || []).find(d => d.uid === doctorUid || d.id === doctorUid);
    const docName = docObj?.name || '';

    return dayAppts.filter(a => {
      if (a.timeSlot !== timeSlot) return false;
      if (a.doctorUid && (a.doctorUid === doctorUid || (docObj && a.doctorUid === docObj.id))) return true;
      if (a.doctorName && docName && (a.doctorName === docName || a.doctorName.includes(docName) || docName.includes(a.doctorName))) return true;
      return false;
    });
  }

  navigateDay(delta) {
    const cur = new Date(this.selectedDate + 'T00:00:00');
    cur.setDate(cur.getDate() + delta);
    // Skip Friday automatically when moving through days
    if (cur.getDay() === 5) {
      cur.setDate(cur.getDate() + (delta >= 0 ? 1 : -1));
    }
    this.changeSelectedDate(getLocalDateStr(cur));
  }

  async changeSelectedDate(newDate) {
    if (!newDate) return;
    this.selectedDate = newDate;
    const calPicker = document.getElementById('appt-calendar-picker');
    if (calPicker) calPicker.value = newDate;
    await this.loadAll(newDate);
    await this.render();
    const currentUser = auth.getCurrentUser();
    if (currentUser && currentUser.role === 'doctor') {
      const docUid = currentUser.uid || currentUser.id;
      await this.renderForDoctor(docUid);
    }
  }

  renderWeekdayStrip() {
    const container = document.getElementById('appt-weekday-strip');
    if (!container) return;

    const cur = new Date(this.selectedDate + 'T00:00:00');
    const dayOfWeek = cur.getDay(); // 0: Sun, 1: Mon, ... 6: Sat
    const diffToSat = (dayOfWeek + 1) % 7; // Sat is day 0 of Egyptian work week
    const sat = new Date(cur);
    sat.setDate(cur.getDate() - diffToSat);

    // 6 working days: Saturday through Thursday (Friday is official weekly holiday)
    const arabicDays = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس'];
    const days = [];
    const todayStr = getLocalDateStr();

    for (let i = 0; i < 6; i++) {
      const d = new Date(sat);
      d.setDate(sat.getDate() + i);
      const dateStr = getLocalDateStr(d);
      const dayAppts = this.getAppointmentsForDate(dateStr);
      const activeCount = dayAppts.filter(a => a.status !== 'cancelled').length;

      days.push({
        name: arabicDays[i],
        dateStr,
        dayNum: d.getDate(),
        monthNum: d.getMonth() + 1,
        count: activeCount,
        isActive: dateStr === this.selectedDate,
        isToday: dateStr === todayStr
      });
    }

    container.innerHTML = days.map(d => `
      <button type="button" class="appt-weekday-pill ${d.isActive ? 'active' : ''} ${d.isToday ? 'is-today' : ''}" data-date="${d.dateStr}">
        <span class="awp-name">${d.name}</span>
        <span class="awp-date">${d.dayNum}/${d.monthNum}</span>
        ${d.count > 0 ? `<span class="awp-badge">${d.count}</span>` : ''}
      </button>
    `).join('');

    // Update Stats Pill
    const statsPill = document.getElementById('appt-day-stats-pill');
    if (statsPill) {
      const isFri = new Date(this.selectedDate + 'T00:00:00').getDay() === 5;
      if (isFri) {
        statsPill.innerHTML = `<span style="color: var(--danger); font-weight: 800;"><i class="fa-solid fa-calendar-xmark"></i> عطلة المركز الأسبوعية (المركز مغلق)</span>`;
        return;
      }
      const curAppts = this.getAppointmentsForDate(this.selectedDate);
      const total = curAppts.filter(a => a.status !== 'cancelled').length;
      const attended = curAppts.filter(a => a.status === 'attended').length;
      const completed = curAppts.filter(a => a.status === 'completed').length;
      const noshow = curAppts.filter(a => a.status === 'no-show').length;

      statsPill.innerHTML = `
        <span style="color: var(--text-main); font-weight: 800;">إجمالي اليوم: ${total}</span>
        ${attended > 0 ? `<span style="color: var(--primary);">• ${attended} حضر</span>` : ''}
        ${completed > 0 ? `<span style="color: var(--success);">• ${completed} مكتمل</span>` : ''}
        ${noshow > 0 ? `<span style="color: var(--danger);">• ${noshow} لم يحضر</span>` : ''}
      `;
    }
  }

  subscribeToUpdates() {
    if (db.subscribeToAppointments && !this._apptSubscribed) {
      this._apptSubscribed = true;
      db.subscribeToAppointments(async () => {
        const currentUser = auth.getCurrentUser();
        if (currentUser && currentUser.role === 'doctor') {
          const docUid = currentUser.uid || currentUser.id;
          await this.renderForDoctor(docUid);
        } else {
          await this.render();
        }
      });
    }
  }

  // ================= Full Grid: every active doctor as a column =================
  async render(forceRefresh = false) {
    this.subscribeToUpdates();
    const grid = document.getElementById('appointments-grid');
    if (!grid) return;
    try {
      await this.loadAll(this.selectedDate, forceRefresh);
      const currentUser = auth.getCurrentUser();
      const isDoctor = currentUser && currentUser.role === 'doctor';
      this.renderWeekdayStrip();
      const calPicker = document.getElementById('appt-calendar-picker');
      if (calPicker && this.selectedDate) {
        calPicker.value = this.selectedDate;
      }
      grid.innerHTML = this.buildGridHTML(this.doctors, isDoctor);
    } catch (err) {
      console.error('Appointments render error:', err);
      grid.innerHTML = this.buildErrorHTML(err);
    }
  }

  // ================= Doctor's Own Schedule (Stacked Cards Deck + Smart Hybrid) =================
  getCompletedAppts(doctorUid) {
    const today = getLocalDateStr();
    const key = `ascpt_done_appts_${doctorUid}_${today}`;
    try {
      return JSON.parse(localStorage.getItem(key) || '[]');
    } catch (_) {
      return [];
    }
  }

  async toggleApptCompleted(apptId, doctorUid, patientName) {
    const appt = (this.appointments || []).find(a => a.id === apptId);
    const isCurrentlyDone = appt ? (appt.status === 'completed') : false;
    const newStatus = isCurrentlyDone ? 'scheduled' : 'completed';

    // 1. Update Firestore in background
    try {
      await db.updateAppointmentStatus(apptId, newStatus, {
        completedByUid: doctorUid,
        completedByName: (this.doctors || []).find(d => d.uid === doctorUid)?.name || '',
        completedAt: new Date().toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' })
      });
      if (appt) appt.status = newStatus;
    } catch (e) {
      console.warn('Update status error:', e);
    }

    // 2. LocalStorage backup
    const targetDate = this.selectedDate || getLocalDateStr();
    const key = `ascpt_done_appts_${doctorUid}_${targetDate}`;
    let list = this.getCompletedAppts(doctorUid);
    if (isCurrentlyDone) {
      list = list.filter(id => id !== apptId);
    } else {
      list.push(apptId);
    }
    try { localStorage.setItem(key, JSON.stringify(list)); } catch (_) {}

    if (this.app?.showToast) {
      const nameTxt = patientName ? `موعد ${patientName}` : 'موعد المريض';
      this.app.showToast(isCurrentlyDone ? `تم استرجاع ${nameTxt} للمتبقية` : `تم إنهاء ${nameTxt} بنجاح`);
    }
    await this.refreshVisibleGrids();
  }

  findClosestSlotIndex(slots) {
    if (!slots || slots.length === 0) return 0;
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    let closestIdx = 0;
    let minDiff = Infinity;

    slots.forEach((s, idx) => {
      const [h, m] = (s.slot?.key || '').split(':').map(Number);
      if (!isNaN(h) && !isNaN(m)) {
        const slotMinutes = h * 60 + m;
        // In-progress window: 20 mins before slot to 45 mins after
        if (currentMinutes >= slotMinutes - 20 && currentMinutes <= slotMinutes + 45) {
          minDiff = -1;
          closestIdx = idx;
          return;
        }
        const diff = Math.abs(currentMinutes - slotMinutes);
        if (minDiff !== -1 && diff < minDiff) {
          minDiff = diff;
          closestIdx = idx;
        }
      }
    });

    return closestIdx;
  }

  async renderForDoctor(doctorUid) {
    this.subscribeToUpdates();
    const grid = document.getElementById('my-appointments-grid');
    if (!grid) return;
    try {
      await this.loadAll();
      const { html, initialIndex } = this.buildDoctorStackedScheduleHTML(doctorUid);
      grid.innerHTML = html;
      this.initDocStackDeck(initialIndex);
      this.bindDoctorScheduleEvents(doctorUid);
    } catch (err) {
      console.error('Appointments (doctor) render error:', err);
      grid.innerHTML = this.buildErrorHTML(err);
    }
  }

  bindDoctorScheduleEvents(doctorUid) {
    const grid = document.getElementById('my-appointments-grid');
    if (!grid) return;

    // Filter toggles: Active vs Completed
    grid.querySelector('#btn-doc-appts-active')?.addEventListener('click', () => {
      this.doctorApptFilter = 'active';
      this.renderForDoctor(doctorUid);
    });

    grid.querySelector('#btn-doc-appts-completed')?.addEventListener('click', () => {
      this.doctorApptFilter = 'completed';
      this.renderForDoctor(doctorUid);
    });

    // Per-patient Complete ("تم") buttons
    grid.querySelectorAll('.btn-complete-patient').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const apptId = btn.getAttribute('data-appt-id');
        const patientName = btn.getAttribute('data-patient-name');
        this.toggleApptCompleted(apptId, doctorUid, patientName);
      });
    });

    // Per-patient Undo buttons
    grid.querySelectorAll('.btn-undo-patient').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const apptId = btn.getAttribute('data-appt-id');
        const patientName = btn.getAttribute('data-patient-name');
        this.toggleApptCompleted(apptId, doctorUid, patientName);
      });
    });
  }

  buildDoctorStackedScheduleHTML(doctorUid) {
    const targetDate = this.selectedDate || getLocalDateStr();
    const docObj = (this.doctors || []).find(d => d.uid === doctorUid);
    const doctorShift = docObj?.shift || 'sat_mon_wed';
    const shiftOverrides = this.shiftOverrides || [];
    const onDutyToday = isDoctorOnDuty(doctorShift, targetDate, shiftOverrides, doctorUid);

    if (!onDutyToday) {
      const shiftName = getShiftLabel(doctorShift);
      const dayName = new Intl.DateTimeFormat('ar-EG', { weekday: 'long' }).format(new Date());
      return {
        html: `
          <div class="hero-styled-card doc-offduty-schedule-card" style="text-align: center; padding: 36px 20px; margin: 4px 0; border: 1.5px dashed rgba(2, 132, 199, 0.3); background: rgba(2, 132, 199, 0.03);">
            <div style="width: 58px; height: 58px; border-radius: 50%; background: rgba(2, 132, 199, 0.12); color: var(--primary); display: inline-flex; align-items: center; justify-content: center; font-size: 1.6rem; margin-bottom: 14px;">
              <i class="fa-solid fa-mug-hot"></i>
            </div>
            <div style="font-weight: 800; font-size: 1.15rem; color: var(--text-main);">اليوم (${dayName}) ليس ضمن أيام عملك الرسمية</div>
            <div style="font-size: 0.86rem; color: var(--text-muted); margin-top: 6px; line-height: 1.6;">
              شفتك المسجل بالمركز هو: <strong style="color: var(--primary);">${escapeHTML(shiftName)}</strong>.<br>
              استمتع بيوم إجازتك! ☕ (في حالة النزول كشيفت تغطية استثنائي، يمكن للاستقبال أو الإدارة تفعيل شيفتك لليوم).
            </div>
          </div>
        `,
        initialIndex: 0
      };
    }

    const slotsToRender = (this.slots && this.slots.length > 0) ? this.slots : DEFAULT_APPT_SLOTS;
    const completedApptIds = this.getCompletedAppts(doctorUid);

    // All booked slots for this doctor for targetDate
    const allSlots = slotsToRender.map((slot) => {
      const cellAppts = this.getCellAppointments(doctorUid, slot.key, targetDate);
      if (cellAppts.length === 0) return null;

      const uncompletedAppts = cellAppts.filter(a => a.status !== 'completed' && !completedApptIds.includes(a.id));
      const completedAppts = cellAppts.filter(a => a.status === 'completed' || completedApptIds.includes(a.id));
      const isSlotFullyDone = uncompletedAppts.length === 0;

      return {
        slot,
        cellAppts,
        uncompletedAppts,
        completedAppts,
        isSlotFullyDone
      };
    }).filter(Boolean);

    if (allSlots.length === 0) {
      return {
        html: `
          <div class="hero-styled-card doc-empty-schedule-card" style="text-align: center; padding: 36px 20px; margin: 4px 0;">
            <div style="width: 54px; height: 54px; border-radius: 50%; background: rgba(2, 132, 199, 0.12); color: var(--primary); display: inline-flex; align-items: center; justify-content: center; font-size: 1.4rem; margin-bottom: 12px;">
              <i class="fa-solid fa-mug-hot"></i>
            </div>
            <div style="font-weight: 800; font-size: 1.05rem; color: var(--text-main);">لا توجد مواعيد محجوزة لك اليوم</div>
            <div style="font-size: 0.82rem; color: var(--text-muted); margin-top: 5px;">ستظهر مواعيدك وحالاتك هنا فور قيام الاستقبال بالحجز لك.</div>
          </div>
        `,
        initialIndex: 0
      };
    }

    const totalUncompletedPatients = allSlots.reduce((acc, curr) => acc + curr.uncompletedAppts.length, 0);
    const totalCompletedPatients = allSlots.reduce((acc, curr) => acc + curr.completedAppts.length, 0);

    const isShowingCompleted = this.doctorApptFilter === 'completed';

    // When showing Active, display slots that have uncompleted patients (or if all done, empty message)
    // When showing Completed, display slots that have completed patients
    const slotsToDisplay = isShowingCompleted 
      ? allSlots.filter(s => s.completedAppts.length > 0)
      : allSlots.filter(s => !s.isSlotFullyDone);

    // Smart Auto-Focus: Find closest time slot to current clock among slotsToDisplay
    const initialIndex = !isShowingCompleted ? this.findClosestSlotIndex(slotsToDisplay) : 0;

    let contentHTML = '';

    if (slotsToDisplay.length === 0) {
      if (isShowingCompleted) {
        contentHTML = `
          <div class="hero-styled-card doc-empty-schedule-card" style="text-align: center; padding: 30px 20px; margin: 4px 0;">
            <div style="font-weight: 800; font-size: 0.98rem; color: var(--text-main);">لا توجد حالات مكتملة بعد اليوم</div>
            <div style="font-size: 0.80rem; color: var(--text-muted); margin-top: 4px;">عند الضغط على "تم" لأي مريض ستظهر بياناته هنا.</div>
          </div>
        `;
      } else {
        contentHTML = `
          <div class="hero-styled-card doc-empty-schedule-card" style="text-align: center; padding: 36px 20px; margin: 4px 0;">
            <div style="width: 54px; height: 54px; border-radius: 50%; background: rgba(16, 185, 129, 0.15); color: var(--success); display: inline-flex; align-items: center; justify-content: center; font-size: 1.6rem; margin-bottom: 12px;">
              <i class="fa-solid fa-circle-check"></i>
            </div>
            <div style="font-weight: 800; font-size: 1.1rem; color: var(--text-main);">تم إنهاء جميع حالاتك لليوم بنجاح!</div>
            <div style="font-size: 0.84rem; color: var(--text-muted); margin-top: 6px;">عاش يا دكتور، جميع المرضى والزيارات المجدولة أُكملت.</div>
          </div>
        `;
      }
    } else {
      contentHTML = `
        <!-- The 3D Overlapping Stack Deck -->
        <div class="doc-stack-container" id="doc-stack-container">
          ${slotsToDisplay.map(({ slot, cellAppts, uncompletedAppts, completedAppts, isSlotFullyDone }, index) => {
            // In active view, show count of remaining vs total
            let countLabel = '';
            if (isShowingCompleted) {
              countLabel = `${completedAppts.length} مكتمل`;
            } else if (cellAppts.length > 1) {
              countLabel = `${uncompletedAppts.length} متبقي من ${cellAppts.length}`;
            } else {
              countLabel = 'حالة واحدة';
            }

            // In active view, show all patients in this slot (with completed ones dimmed/checked off)
            // In completed view, show the completed ones
            const patientsToShow = isShowingCompleted ? completedAppts : cellAppts;

            return `
              <div class="hero-styled-card doc-stack-card ${index === initialIndex ? 'is-active-card' : 'is-peeking-card'}" data-stack-index="${index}">
                <div class="doc-card-header">
                  <div class="doc-card-time-badge">
                    <i class="fa-regular fa-clock" style="color: var(--primary); font-size: 1.15rem;"></i>
                    <span style="font-weight: 800; font-size: 1.05rem; color: var(--text-main);">${escapeHTML(slot.label)}</span>
                  </div>
                  <div style="display: flex; align-items: center; gap: 6px;">
                    <span class="badge ${isSlotFullyDone ? 'badge-cash' : 'badge-primary'}" style="font-size: 0.78rem; padding: 4px 10px; border-radius: 999px; font-weight: 800;">
                      ${countLabel}
                    </span>
                    <i class="fa-solid fa-chevron-down doc-card-peek-indicator" style="font-size: 0.75rem; color: var(--text-muted);"></i>
                  </div>
                </div>

                <div class="hsc-divider" style="margin: 10px 0 12px 0;"></div>

                <div class="doc-card-patients-list">
                  ${patientsToShow.map((a, pIdx) => {
                    const isDone = completedApptIds.includes(a.id);
                    const patientObj = (this.patients || []).find(p => p.id === a.patientId);
                    const phone = patientObj?.phone || '';

                    // Clinical Fallback Chain: Body Part / Area being treated
                    let treatedArea = a.bodyPart || patientObj?.clinicalSheet?.affectedArea || '';
                    if (!treatedArea) {
                      const pSessions = (this.sessions || []).filter(s => s.patientId === a.patientId || s.patientName === a.patientName);
                      pSessions.sort((x, y) => new Date(y.date || y.createdAt || 0) - new Date(x.date || x.createdAt || 0));
                      if (pSessions.length > 0) {
                        const latestSess = pSessions[0];
                        if (Array.isArray(latestSess.bodyParts) && latestSess.bodyParts.length > 0) {
                          treatedArea = latestSess.bodyParts.join('، ');
                        } else if (typeof latestSess.bodyParts === 'string') {
                          treatedArea = latestSess.bodyParts;
                        }
                      }
                    }

                    let bodyPartBadge = '';
                    if (treatedArea) {
                      bodyPartBadge = `<span class="badge" style="font-size: 0.70rem; padding: 2px 8px; border-radius: 999px; font-weight: 800; display: inline-flex; align-items: center; gap: 4px; background: rgba(2, 132, 199, 0.1); color: var(--primary); border: 1px solid rgba(2, 132, 199, 0.28);"><i class="fa-solid fa-bone"></i> ${escapeHTML(treatedArea)}</span>`;
                    } else {
                      bodyPartBadge = `<span class="badge" style="font-size: 0.70rem; padding: 2px 8px; border-radius: 999px; font-weight: 800; display: inline-flex; align-items: center; gap: 4px; background: rgba(245, 158, 11, 0.1); color: var(--warning); border: 1px solid rgba(245, 158, 11, 0.28);"><i class="fa-solid fa-stethoscope"></i> كشف / تقييم جديد</span>`;
                    }

                    return `
                      <div class="doc-patient-item" style="padding: 8px 10px; border-radius: 12px; background: var(--bg-subtle); margin-bottom: 7px; display: flex; align-items: center; justify-content: space-between; gap: 8px; ${isDone ? 'opacity: 0.72;' : ''}">
                        <div style="display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1;">
                          <div class="doc-patient-avatar" style="width: 34px; height: 34px; border-radius: 9px; font-size: 0.88rem; flex-shrink: 0; display: flex; align-items: center; justify-content: center; ${isDone ? 'background: rgba(16, 185, 129, 0.15); color: #10b981;' : ''}">
                            <i class="fa-solid ${isDone ? 'fa-check' : 'fa-user'}"></i>
                          </div>
                          <div class="doc-patient-info" style="min-width: 0;">
                            <div class="doc-patient-name" style="font-weight: 800; font-size: 0.88rem; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; ${isDone ? 'text-decoration: line-through;' : ''}">${escapeHTML(a.patientName)}</div>
                            <div style="display: flex; align-items: center; gap: 6px; margin-top: 2px;">
                              ${bodyPartBadge}
                              ${phone ? `<a href="tel:${escapeHTML(phone)}" style="font-size: 0.72rem; color: var(--text-muted); text-decoration: none; display: inline-flex; align-items: center; gap: 3px;" title="اتصال"><i class="fa-solid fa-phone" style="font-size: 0.65rem;"></i> <bdi dir="ltr">${escapeHTML(phone)}</bdi></a>` : ''}
                            </div>
                          </div>
                        </div>

                        <!-- Per-Patient Done / Undo Action Button -->
                        <div style="flex-shrink: 0;">
                          ${!isDone ? `
                            <button type="button" class="btn btn-outline btn-sm btn-complete-patient" data-appt-id="${escapeHTML(a.id)}" data-patient-name="${escapeHTML(a.patientName)}" style="padding: 4px 10px; font-size: 0.76rem; font-weight: 800; border-radius: 999px; color: #10b981; border-color: rgba(16, 185, 129, 0.4); background: rgba(16, 185, 129, 0.08); display: inline-flex; align-items: center; gap: 4px; cursor: pointer;" title="تأكيد إنهاء جلسة هذا المريض">
                              <i class="fa-solid fa-check"></i> <span>تم</span>
                            </button>
                          ` : `
                            <div style="display: flex; align-items: center; gap: 4px;">
                              <span style="display: inline-flex; align-items: center; gap: 3px; font-size: 0.72rem; font-weight: 800; color: #10b981; background: rgba(16, 185, 129, 0.12); padding: 3px 8px; border-radius: 999px;">
                                <i class="fa-solid fa-check-double"></i> مكتمل
                              </span>
                              <button type="button" class="btn btn-sm btn-undo-patient" data-appt-id="${escapeHTML(a.id)}" data-patient-name="${escapeHTML(a.patientName)}" title="استرجاع للمتبقية" style="padding: 2px 6px; font-size: 0.74rem; color: var(--text-muted); background: transparent; border: none; cursor: pointer;">
                                <i class="fa-solid fa-rotate-left"></i>
                              </button>
                            </div>
                          `}
                        </div>
                      </div>
                    `;
                  }).join('')}
                </div>
              </div>
            `;
          }).join('')}
        </div>

        <!-- Stack Navigation Controls -->
        ${slotsToDisplay.length > 1 ? `
        <div class="doc-stack-nav-bar" id="doc-stack-nav-bar">
          <button type="button" class="doc-stack-nav-btn" id="btn-doc-stack-prev">
            <i class="fa-solid fa-chevron-right"></i> السابق
          </button>

          <div class="doc-stack-dots" id="doc-stack-dots">
            ${slotsToDisplay.map((_, i) => `
              <span class="doc-dot ${i === initialIndex ? 'active' : ''}" data-dot-index="${i}"></span>
            `).join('')}
          </div>

          <button type="button" class="doc-stack-nav-btn" id="btn-doc-stack-next">
            التالي <i class="fa-solid fa-chevron-left"></i>
          </button>
        </div>
        ` : ''}
      `;
    }

    const html = `
      <div class="doc-stack-wrapper">
        <div class="doc-stack-header-bar" style="flex-wrap: wrap; gap: 8px;">
          <div style="display: flex; align-items: center; gap: 6px;">
            <button type="button" class="btn btn-sm ${!isShowingCompleted ? 'btn-primary' : 'btn-outline'}" id="btn-doc-appts-active" style="font-size: 0.76rem; padding: 4px 10px; border-radius: 999px; font-weight: 800;">
              المتبقية (${totalUncompletedPatients})
            </button>
            <button type="button" class="btn btn-sm ${isShowingCompleted ? 'btn-primary' : 'btn-outline'}" id="btn-doc-appts-completed" style="font-size: 0.76rem; padding: 4px 10px; border-radius: 999px; font-weight: 800;">
              المكتملة (${totalCompletedPatients})
            </button>
          </div>

          <div style="display: flex; align-items: center; gap: 8px;">
            ${slotsToDisplay.length > 1 ? `
            <span id="doc-stack-counter" style="font-size: 0.78rem; font-weight: 800; color: var(--primary); background: rgba(2, 132, 199, 0.12); padding: 2px 10px; border-radius: 999px;">${initialIndex + 1} من ${slotsToDisplay.length}</span>
            <button type="button" class="btn btn-outline btn-sm" id="btn-toggle-doc-stack-layout" style="font-size: 0.75rem; padding: 3px 9px; border-radius: 8px; height: 28px;" title="تبديل بين التراكم والقائمة">
              <i class="fa-solid fa-list" id="icon-stack-toggle"></i>
            </button>
            ` : ''}
          </div>
        </div>

        ${contentHTML}
      </div>
    `;

    return { html, initialIndex };
  }

    initDocStackDeck(initialIndex = 0) {
    initStackDeck({
      prefix: 'doc-stack',
      initialIndex
    });
  }

    buildErrorHTML(err) {
    return `<div style="padding: 20px; text-align: center; color: var(--danger);">
      <i class="fa-solid fa-triangle-exclamation"></i> تعذر تحميل جدول المواعيد.<br>
      <span style="font-size: 0.8rem; color: var(--text-muted);">${escapeHTML(err.message || 'خطأ غير معروف')}</span>
    </div>`;
  }

  buildGridHTML(doctorsToShow, isDoctorReadOnly = false) {
    // Check if Friday: Official weekly clinic holiday
    const isFridayHoliday = new Date(this.selectedDate + 'T00:00:00').getDay() === 5;
    if (isFridayHoliday) {
      return `
        <div class="hero-styled-card" style="text-align: center; padding: 48px 20px; margin: 18px 0; border: 2px dashed rgba(56, 189, 248, 0.35); background: var(--bg-surface); border-radius: 18px;">
          <div style="width: 68px; height: 68px; border-radius: 50%; background: rgba(56, 189, 248, 0.12); color: var(--primary); display: inline-flex; align-items: center; justify-content: center; font-size: 2rem; margin-bottom: 16px;">
            <i class="fa-solid fa-mug-hot"></i>
          </div>
          <h3 style="font-weight: 800; font-size: 1.3rem; color: var(--text-main); margin: 0 0 8px 0;">يوم الجمعة عطلة أسبوعية للمركز</h3>
          <p style="font-size: 0.92rem; color: var(--text-muted); max-width: 440px; margin: 0 auto 16px auto; line-height: 1.6;">
            مركز الإسكندرية التخصصي مغلق يوم الجمعة، ولا توجد مواعيد أو جلسات علاجية مجدولة في هذا اليوم.
          </p>
          <div style="display: flex; justify-content: center; gap: 8px;">
            <span class="badge" style="background: rgba(239, 68, 68, 0.1); color: var(--danger); border: 1px solid rgba(239, 68, 68, 0.3); font-weight: 800; padding: 6px 18px; border-radius: 999px; font-size: 0.85rem;">
              <i class="fa-solid fa-ban"></i> الحجز مغلق
            </span>
          </div>
        </div>
      `;
    }

    if (!doctorsToShow || doctorsToShow.length === 0) {
      return `<div style="padding: 20px; text-align: center; color: var(--text-muted);">لا يوجد دكاترة مسجلين حالياً في طاقم العمل.</div>`;
    }

    const slotsToRender = (this.slots && this.slots.length > 0) ? this.slots : DEFAULT_APPT_SLOTS;

    // Responsive Appointments Cards Grid (v1.4.57: Matrix table removed, 2-Column Responsive Card Grid)
    return `
      <div class="appt-timeline-grid-container">
        ${slotsToRender.map((slot) => {
          const currentUser = auth.getCurrentUser();
          const rawSlotAppts = this.getAppointmentsForDate(this.selectedDate).filter(a => a.timeSlot === slot.key && a.status !== 'cancelled');
          const slotAppts = (isDoctorReadOnly && currentUser)
            ? rawSlotAppts.filter(a =>
                (a.doctorUid && (a.doctorUid === currentUser.uid || a.doctorUid === currentUser.id)) ||
                (currentUser.name && a.doctorName && (a.doctorName === currentUser.name || a.doctorName.includes(currentUser.name) || currentUser.name.includes(a.doctorName)))
              )
            : rawSlotAppts;

          const totalInSlot = slotAppts.length;
          const isFull = totalInSlot >= MAX_BEDS_PER_SLOT;
          const overCapacity = totalInSlot > MAX_BEDS_PER_SLOT;

          const occupancyBadge = overCapacity
            ? `<span class="badge" style="background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); font-weight: 800;"><i class="fa-solid fa-triangle-exclamation"></i> ممتلئ (${totalInSlot}/${MAX_BEDS_PER_SLOT})</span>`
            : (isFull
              ? `<span class="badge badge-cash" style="font-weight: 800;"><i class="fa-solid fa-bed"></i> مكتمل (${totalInSlot}/${MAX_BEDS_PER_SLOT})</span>`
              : `<span class="badge badge-direct" style="font-weight: 800;"><i class="fa-solid fa-bed"></i> ${totalInSlot} من ${MAX_BEDS_PER_SLOT} أسرة</span>`);

          // Group slot appointments by doctor dynamically from actual slot appointments
          const docGroupsMap = new Map();
          slotAppts.forEach(a => {
            const docKey = a.doctorUid || a.doctorName || 'general';
            if (!docGroupsMap.has(docKey)) {
              const docObj = (this.doctors || []).find(d =>
                (a.doctorUid && (d.uid === a.doctorUid || d.id === a.doctorUid)) ||
                (a.doctorName && (d.name === a.doctorName || a.doctorName.includes(d.name) || d.name.includes(a.doctorName)))
              );
              const docName = a.doctorName || docObj?.name || 'طبيب المركز';
              const cleanDoc = docName.replace(/^د\.\s*/, '');
              const docColor = getDoctorColor(a.doctorUid || docName);
              docGroupsMap.set(docKey, {
                doc: docObj,
                cleanDoc,
                docColor,
                cellAppts: []
              });
            }
            docGroupsMap.get(docKey).cellAppts.push(a);
          });
          const activeDocAppts = Array.from(docGroupsMap.values());

          return `
            <div class="hero-styled-card appt-slot-card">
              <div class="appt-slot-header">
                <div class="appt-slot-time-pill" ${!isDoctorReadOnly ? `data-edit-slot="${escapeHTML(slot.key)}" data-slot-label="${escapeHTML(slot.label)}"` : 'style="cursor: default;"'} title="${!isDoctorReadOnly ? 'اضغط لتعديل وقت الموعد' : ''}">
                  <i class="fa-regular fa-clock" style="color: var(--primary);"></i>
                  <span style="font-weight: 800; font-size: 0.95rem;">${escapeHTML(slot.label)}</span>
                  ${!isDoctorReadOnly ? '<i class="fa-solid fa-pen-to-square" style="font-size: 0.72rem; color: var(--text-muted); margin-right: 4px;"></i>' : ''}
                </div>
                ${occupancyBadge}
              </div>

              <div class="hsc-divider" style="margin: 8px 0 10px 0;"></div>

              <div class="appt-slot-body">
                ${activeDocAppts.length > 0 ? `
                  <div class="appt-chips-wrap">
                    ${activeDocAppts.map(({ cleanDoc, cellAppts, docColor }) => `
                      <div class="appt-active-doc-group">
                        ${true ? `
                          <div class="appt-slot-doc-name" style="color: ${docColor.color}; font-weight: 800; font-size: 0.82rem; margin-bottom: 5px;">
                            <span style="width: 8px; height: 8px; border-radius: 50%; background: ${docColor.color}; display: inline-block; margin-left: 5px;"></span>
                            د. ${escapeHTML(cleanDoc)}:
                          </div>` : ''}
                        <div class="appt-doc-chips-list" style="display: flex; flex-wrap: wrap; gap: 6px;">
                          ${cellAppts.map((a) => {
                            let statusBadge = '';
                            if (a.status === 'completed') {
                              statusBadge = `<span class="badge badge-appt-completed" style="font-size: 0.68rem; padding: 1px 6px; border-radius: 4px;"><i class="fa-solid fa-check"></i> مكتمل</span>`;
                            } else if (a.status === 'attended') {
                              statusBadge = `<span class="badge badge-appt-attended" style="font-size: 0.68rem; padding: 1px 6px; border-radius: 4px;"><i class="fa-solid fa-bolt"></i> حضر</span>`;
                            } else if (a.status === 'no-show') {
                              statusBadge = `<span class="badge badge-appt-noshow" style="font-size: 0.68rem; padding: 1px 6px; border-radius: 4px;"><i class="fa-solid fa-user-xmark"></i> لم يحضر</span>`;
                            }

                            return `
                              <div class="appt-chip clickable" data-appt-action-id="${escapeHTML(a.id)}" title="اضغط لفتح خيارات وتفاصيل الموعد">
                                <span class="appt-chip-patient">${escapeHTML(a.patientName)}</span>
                                ${statusBadge}
                                ${!isDoctorReadOnly ? `
                                <div class="appt-chip-actions">
                                  <button type="button" class="appt-chip-copy" data-copy-appt="${escapeHTML(a.id)}" title="نسخ الموعد ليوم آخر">
                                    <i class="fa-regular fa-copy"></i>
                                  </button>
                                  <button type="button" class="appt-chip-move" data-move-appt="${escapeHTML(a.id)}" title="نقل الموعد">
                                    <i class="fa-solid fa-arrow-right-arrow-left"></i>
                                  </button>
                                  <button type="button" class="appt-chip-remove" data-remove-appt="${escapeHTML(a.id)}" title="حذف">&times;</button>
                                </div>` : ''}
                              </div>
                            `;
                          }).join('')}
                        </div>
                      </div>
                    `).join('')}
                  </div>
                ` : `
                  <div class="appt-slot-empty-clean">
                    <i class="fa-regular fa-calendar-check" style="opacity: 0.4;"></i>
                    <span>${isDoctorReadOnly ? 'لا توجد مواعيد محجوزة لك' : `لا توجد حجوزات مسجلة (الأسرة الـ ${MAX_BEDS_PER_SLOT} شاغرة)`}</span>
                  </div>
                `}

                ${!isDoctorReadOnly ? `
                <div class="appt-quick-booking-container" style="margin-top: 10px;">
                  <button type="button" class="btn btn-outline btn-sm appt-single-book-btn btn-add-appt" data-add-slot="${escapeHTML(slot.key)}">
                    <i class="fa-solid fa-plus-circle"></i> حجز سرير في هذه الساعة
                  </button>
                </div>` : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  openApptActionSheet(apptId) {
    const a = (this.appointments || []).find(x => x.id === apptId);
    if (!a) return;
    this.selectedApptForAction = a;

    const patientObj = (this.patients || []).find(p => p.id === a.patientId);
    const docObj = (this.doctors || []).find(d => d.uid === a.doctorUid);

    const nameEl = document.getElementById('appt-sheet-patient-name');
    const subEl = document.getElementById('appt-sheet-sub-info');
    const docEl = document.getElementById('appt-sheet-doc-val');
    const timeEl = document.getElementById('appt-sheet-time-val');
    const dateEl = document.getElementById('appt-sheet-date-val');
    const areaEl = document.getElementById('appt-sheet-area-val');
    const statusBadgeEl = document.getElementById('appt-sheet-status-badge');
    const callBtn = document.getElementById('btn-appt-sheet-call');
    const waBtn = document.getElementById('btn-appt-sheet-whatsapp');

    if (nameEl) nameEl.textContent = a.patientName || 'مريض';
    if (subEl) {
      const pPhone = patientObj?.phone || '';
      const pBilling = patientObj?.billing === 'insurance' ? `تأمين (${patientObj.insuranceCompany || ''})` : 'نقدي';
      subEl.textContent = `${pBilling}${pPhone ? ` • هاتف: ${pPhone}` : ''}`;
    }

    if (docEl) docEl.textContent = a.doctorName || docObj?.name || '-';
    if (timeEl) {
      const slotObj = (this.slots || []).find(s => s.key === a.timeSlot);
      timeEl.textContent = slotObj?.label || a.timeSlot || '-';
    }
    if (dateEl) {
      dateEl.textContent = a.date || this.selectedDate || '-';
    }
    if (areaEl) {
      areaEl.textContent = a.bodyPart || patientObj?.clinicalSheet?.affectedArea || 'علاج طبيعي عام';
    }

    if (statusBadgeEl) {
      const st = a.status || 'scheduled';
      if (st === 'completed') {
        statusBadgeEl.className = 'badge badge-appt-completed';
        statusBadgeEl.innerHTML = '<i class="fa-solid fa-check"></i> مكتمل';
      } else if (st === 'attended') {
        statusBadgeEl.className = 'badge badge-appt-attended';
        statusBadgeEl.innerHTML = '<i class="fa-solid fa-bolt"></i> تم الحضور / جلسة مسجلة';
      } else if (st === 'no-show') {
        statusBadgeEl.className = 'badge badge-appt-noshow';
        statusBadgeEl.innerHTML = '<i class="fa-solid fa-user-xmark"></i> لم يحضر (No-Show)';
      } else {
        statusBadgeEl.className = 'badge badge-primary';
        statusBadgeEl.innerHTML = '<i class="fa-regular fa-clock"></i> محجوز';
      }
    }

    const phone = patientObj?.phone || '';
    if (callBtn) {
      if (phone) {
        callBtn.href = `tel:${phone}`;
        callBtn.style.display = 'inline-flex';
      } else {
        callBtn.style.display = 'none';
      }
    }
    if (waBtn) {
      if (phone) {
        const cleanPhone = phone.replace(/\D/g, '');
        const waNum = cleanPhone.startsWith('0') ? '2' + cleanPhone : cleanPhone;
        waBtn.href = `https://wa.me/${waNum}`;
        waBtn.style.display = 'inline-flex';
      } else {
        waBtn.style.display = 'none';
      }
    }

    this.app.openModal('modal-appt-actions');
  }

  async handleCheckinFromAppt(appt) {
    if (!appt) return;
    this.app.closeModal('modal-appt-actions');

    // 1. Mark as attended in Firestore
    try {
      await db.updateAppointmentStatus(appt.id, 'attended', {
        attendedAt: new Date().toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' })
      });
      appt.status = 'attended';
    } catch (e) {
      console.warn('Update attended status notice:', e);
    }

    // 2. Switch to sessions view
    this.app.switchView('sessions');

    // 3. Select patient in sessionsManager
    if (this.app?.sessionsManager?.selectPatient) {
      await this.app.sessionsManager.selectPatient(appt.patientId);

      // Pre-select doctor if matched
      if (appt.doctorName) {
        const docSelect = document.getElementById('session-doctor-select');
        if (docSelect) {
          docSelect.value = appt.doctorName;
          this.app.updateCustomSelectDisplay('session-doctor-select');
        }
      }
    }

    if (this.app?.showToast) {
      this.app.showToast(`تم فتح تسجيل الجلسة للمريض: ${appt.patientName}`, 'success');
    }
  }

  async handleStatusUpdateFromSheet(status) {
    const appt = this.selectedApptForAction;
    if (!appt) return;
    this.app.closeModal('modal-appt-actions');

    try {
      const meta = {};
      if (status === 'completed') {
        meta.completedAt = new Date().toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' });
        meta.completedBy = auth.getCurrentUser()?.name || 'الاستقبال';
      } else if (status === 'no-show') {
        meta.noShowMarkedAt = new Date().toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' });
      }

      await db.updateAppointmentStatus(appt.id, status, meta);
      appt.status = status;

      const titles = {
        completed: 'تم إنهاء الجلسة',
        'no-show': 'تم تحديد الحالة: لم يحضر',
        scheduled: 'تمت إعادة الحالة إلى محجوز'
      };
      if (this.app?.showToast) {
        this.app.showToast(`${titles[status] || 'تم تحديث الموعد'}: ${appt.patientName}`);
      }
      await this.refreshVisibleGrids();
    } catch (err) {
      this.app.showAlert('تعذر تحديث حالة الموعد: ' + err.message, 'خطأ', 'danger');
    }
  }

  handleGridClick(e) {
    const currentUser = auth.getCurrentUser();
    if (currentUser && currentUser.role === 'doctor') {
      return; // Strict read-only for doctors
    }
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
      e.stopPropagation();
      this.deleteAppointment(removeBtn.getAttribute('data-remove-appt'));
      return;
    }

    // 2.5 Move / reschedule appointment
    const moveBtn = e.target.closest('[data-move-appt]');
    if (moveBtn) {
      e.stopPropagation();
      this.openMoveModal(moveBtn.getAttribute('data-move-appt'));
      return;
    }

    // 2.6 Copy appointment to other days
    const copyBtn = e.target.closest('[data-copy-appt]');
    if (copyBtn) {
      e.stopPropagation();
      this.openCopyModal(copyBtn.getAttribute('data-copy-appt'));
      return;
    }

    // 2.7 Open Action Sheet for appointment
    const apptActionTrigger = e.target.closest('[data-appt-action-id]');
    if (apptActionTrigger) {
      const apptId = apptActionTrigger.getAttribute('data-appt-action-id');
      if (apptId) {
        this.openApptActionSheet(apptId);
        return;
      }
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
    // Check if Friday
    if (new Date(this.selectedDate + 'T00:00:00').getDay() === 5) {
      this.app.showAlert('يوم الجمعة عطلة رسمية بالمركز، لا يمكن حجز مواعيد في هذا اليوم.', 'عطلة أسبوعية', 'warning');
      return;
    }
    this.pendingDoctorUid = doctorUid || null;
    this.pendingDoctorName = doctorName || null;
    this.pendingTimeSlot = timeSlot;
    this.selectedPatientId = null;
    this.selectedPatientName = null;

    const slotLabel = (this.slots || []).find((s) => s.key === timeSlot)?.label || timeSlot;
    const titleEl = document.getElementById('appt-modal-title');
    if (titleEl) {
      titleEl.innerHTML = `<i class="fa-solid fa-calendar-plus" style="color: var(--primary);"></i> حجز سرير - الساعة ${escapeHTML(slotLabel)}`;
    }

    // Populate and sync Doctor Dropdown in modal
    const today = getLocalDateStr();
    const docSelect = document.getElementById('appt-doctor-select');
    const warningEl = document.getElementById('appt-doc-shift-warning');
    if (docSelect) {
      docSelect.innerHTML = `<option value="">-- اضغط لاختيار الطبيب المعالج --</option>` + (this.doctors || []).map((d) => {
        const clean = (d.name || '').replace(/^د\.\s*/, '');
        const isSel = (doctorUid && d.uid === doctorUid) ? 'selected' : '';
        const onDuty = isDoctorOnDuty(d.shift, today, this.shiftOverrides, d.uid);
        const dutyBadge = onDuty ? '🟢 مناوب اليوم' : '⚪ ليس بشيفت اليوم';
        return `<option value="${escapeHTML(d.uid)}" ${isSel}>د. ${escapeHTML(clean)} (${dutyBadge})</option>`;
      }).join('');

      docSelect.value = doctorUid || '';
      this.pendingDoctorUid = doctorUid || '';
      const matchedDoc = (this.doctors || []).find(d => d.uid === doctorUid);
      this.pendingDoctorName = matchedDoc ? matchedDoc.name : '';
      if (this.app?.updateCustomSelectDisplay) {
        this.app.updateCustomSelectDisplay('appt-doctor-select');
      }

      const updateShiftWarning = (uid) => {
        if (!warningEl) return;
        if (!uid) {
          warningEl.style.display = 'none';
          return;
        }
        const doc = (this.doctors || []).find(d => d.uid === uid);
        const onDuty = isDoctorOnDuty(doc?.shift, today, this.shiftOverrides, uid);
        warningEl.style.display = onDuty ? 'none' : 'block';
      };

      updateShiftWarning(doctorUid);
      docSelect.onchange = (e) => {
        this.pendingDoctorUid = e.target.value;
        const d = (this.doctors || []).find(x => x.uid === e.target.value);
        this.pendingDoctorName = d ? d.name : '';
        updateShiftWarning(e.target.value);
      };
    }

    const bodyPartInput = document.getElementById('appt-body-part');
    if (bodyPartInput) bodyPartInput.value = '';
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

    container.innerHTML = filtered.map((p) => {
      let badge = '';
      if (p.billing === 'cash') {
        badge = `<span class="badge badge-cash">نقدي</span>`;
      } else {
        const safeComp = escapeHTML(p.insuranceCompany || 'تأمين');
        badge = `<span class="badge badge-direct">${safeComp}</span>`;
      }

      return `
        <div class="picker-item" data-patient-id="${escapeHTML(p.id)}" style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-weight: 700; color: var(--text-main); font-size: 0.95rem;">
              <i class="fa-solid fa-user" style="color: var(--primary); margin-left: 6px;"></i> ${escapeHTML(p.name)}
            </div>
            <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 3px;">
              <i class="fa-solid fa-phone" style="font-size: 0.75rem;"></i> ${escapeHTML(p.phone)}
            </div>
          </div>
          <div>${badge}</div>
        </div>
      `;
    }).join('');
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
    const docSelect = document.getElementById('appt-doctor-select');
    const chosenUid = docSelect ? docSelect.value : this.pendingDoctorUid;
    const docObj = (this.doctors || []).find((d) => d.uid === chosenUid);
    const chosenName = docObj ? docObj.name : (this.pendingDoctorName || 'طبيب المركز');

    if (!chosenUid) {
      this.app.showAlert('من فضلك اختر الطبيب المعالج.', 'بيانات ناقصة', 'warning');
      return;
    }

    if (!this.selectedPatientId) {
      this.app.showAlert('من فضلك اختر المريض من السجل.', 'بيانات ناقصة', 'warning');
      return;
    }

    try {
      const bodyPartVal = document.getElementById('appt-body-part')?.value.trim() || '';
      const today = getLocalDateStr();
      const matchedDoc = (this.doctors || []).find(d => d.uid === chosenUid);
      const onDuty = isDoctorOnDuty(matchedDoc?.shift, today, this.shiftOverrides, chosenUid);

      if (!onDuty && chosenUid) {
        // Automatically activate shift coverage for this doctor for today
        try {
          await db.addShiftOverride({
            doctorUid: chosenUid,
            doctorName: chosenName,
            date: today,
            type: 'coverage',
            createdBy: auth.getCurrentUser()?.name || 'الاستقبال'
          });
        } catch (covErr) {
          console.warn('Auto coverage activation notice:', covErr);
        }
      }

      await db.addAppointment({
        doctorUid: chosenUid,
        doctorName: chosenName,
        timeSlot: this.pendingTimeSlot,
        date: this.selectedDate,
        dayOfWeek: getDayShiftKey(this.selectedDate),
        patientId: this.selectedPatientId,
        patientName: this.selectedPatientName,
        bodyPart: bodyPartVal,
        status: 'scheduled',
        createdBy: auth.getCurrentUser()?.name || ''
      });
      this.app.closeModal('modal-appointment');
      this.app.showToast(!onDuty ? 'تم حجز الموعد وتفعيل تغطية الشيفت للطبيب لليوم بنجاح' : 'تم حجز الموعد بنجاح');
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
      <button type="button" class="btn btn-outline btn-sm slot-quick-btn" data-h="${c.h}" data-m="${c.m}" data-p="${c.p}">
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

  updatePeriodSegmentedDisplay(period) {
    const pmBtn = document.getElementById('btn-period-pm');
    const amBtn = document.getElementById('btn-period-am');
    if (!pmBtn || !amBtn) return;
    if (period === 'AM') {
      amBtn.classList.add('active');
      amBtn.style.background = 'var(--primary)';
      amBtn.style.color = '#ffffff';
      pmBtn.classList.remove('active');
      pmBtn.style.background = 'transparent';
      pmBtn.style.color = 'var(--text-muted)';
    } else {
      pmBtn.classList.add('active');
      pmBtn.style.background = 'var(--primary)';
      pmBtn.style.color = '#ffffff';
      amBtn.classList.remove('active');
      amBtn.style.background = 'transparent';
      amBtn.style.color = 'var(--text-muted)';
    }
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

    this.app.updateCustomSelectDisplay('slot-input-hour');
    this.app.updateCustomSelectDisplay('slot-input-minute');
    this.updatePeriodSegmentedDisplay(parsed.period);
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

    this.app.updateCustomSelectDisplay('slot-input-hour');
    this.app.updateCustomSelectDisplay('slot-input-minute');
    this.updatePeriodSegmentedDisplay('PM');
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
    this.doctorApptFilter = 'active'; // 'active' | 'completed'
      await this.refreshVisibleGrids();
    } catch (err) {
      this.app.showAlert('تعذر نقل الموعد: ' + err.message, 'خطأ', 'danger');
    }
  }

    // ================= Shift Coverage Management (v1.4.76) =================
  async openShiftCoverageModal() {
    const today = getLocalDateStr();
    const dateInput = document.getElementById('coverage-date-input');
    if (dateInput) dateInput.value = today;

    // Populate Doctor Select
    const docSelect = document.getElementById('coverage-doc-select');
    if (docSelect) {
      docSelect.innerHTML = `<option value="">-- اضغط لاختيار الطبيب --</option>` + (this.doctors || []).map(d => {
        const clean = (d.name || '').replace(/^د\.\s*/, '');
        const shiftLabel = getShiftLabel(d.shift || 'sat_mon_wed');
        return `<option value="${escapeHTML(d.uid)}">د. ${escapeHTML(clean)} (شفت: ${escapeHTML(shiftLabel)})</option>`;
      }).join('');
      if (this.app?.updateCustomSelectDisplay) {
        this.app.updateCustomSelectDisplay('coverage-doc-select');
      }
    }

    const notesInp = document.getElementById('coverage-notes-input');
    if (notesInp) notesInp.value = '';

    await this.renderCoverageActiveList();
    this.app.openModal('modal-shift-coverage');
  }

  async renderCoverageActiveList() {
    const today = getLocalDateStr();
    const listEl = document.getElementById('coverage-active-list');
    const badgeEl = document.getElementById('coverage-active-badge');
    if (!listEl) return;

    try {
      const overrides = await db.getShiftOverrides(today);
      this.shiftOverrides = overrides;
      if (badgeEl) badgeEl.textContent = `${overrides.length} أطباء`;

      if (overrides.length === 0) {
        listEl.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 12px; font-size: 0.78rem;">لا توجد تغطيات استثنائية مسجلة لهذا اليوم حتى الآن.</div>`;
        return;
      }

      listEl.innerHTML = overrides.map(o => {
        const safeName = escapeHTML(o.doctorName || 'طبيب');
        const safeBy = escapeHTML(o.createdBy || 'الإدارة');
        const safeNote = escapeHTML(o.notes || '');
        const safeId = escapeHTML(o.id);
        return `
          <div class="coverage-item" style="display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; border-radius: 8px; background: var(--bg-surface); border: 1px solid var(--border-color); font-size: 0.8rem;">
            <div style="display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1;">
              <div style="width: 28px; height: 28px; border-radius: 6px; background: rgba(16, 185, 129, 0.12); color: var(--success); display: flex; align-items: center; justify-content: center; font-size: 0.85rem; flex-shrink: 0;">
                <i class="fa-solid fa-user-check"></i>
              </div>
              <div style="min-width: 0;">
                <div style="font-weight: 800; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">د. ${safeName}</div>
                <div style="font-size: 0.7rem; color: var(--text-muted);">${safeNote ? `${safeNote} • ` : ''}المسجل: ${safeBy}</div>
              </div>
            </div>
            <button type="button" class="btn btn-outline btn-sm btn-delete-coverage" data-override-id="${safeId}" style="color: var(--danger); border-color: rgba(239, 68, 68, 0.3); padding: 3px 8px; font-size: 0.72rem; border-radius: 6px; cursor: pointer;" title="إلغاء التغطية">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        `;
      }).join('');
    } catch (err) {
      listEl.innerHTML = `<div style="color: var(--danger); font-size: 0.76rem; padding: 6px;">تعذر تحميل قائمة التغطيات: ${escapeHTML(err.message)}</div>`;
    }
  }

  async handleSubmitShiftCoverage(e) {
    if (e) e.preventDefault();
    const docSelect = document.getElementById('coverage-doc-select');
    const docUid = docSelect?.value;
    const dateVal = document.getElementById('coverage-date-input')?.value || getLocalDateStr();
    const notesVal = document.getElementById('coverage-notes-input')?.value.trim() || '';

    if (!docUid) {
      this.app.showAlert('من فضلك اختر الطبيب المعالج.', 'بيانات ناقصة', 'warning');
      return;
    }

    const matchedDoc = (this.doctors || []).find(d => d.uid === docUid);
    const docName = matchedDoc ? matchedDoc.name : 'طبيب';
    const currentUser = auth.getCurrentUser();

    try {
      await db.addShiftOverride({
        doctorUid: docUid,
        doctorName: docName,
        date: dateVal,
        notes: notesVal,
        type: 'coverage',
        createdBy: currentUser?.name || 'الاستقبال'
      });

      this.app.showToast(`تم تفعيل تغطية الشيفت للدكتور ${docName} بتاريخ ${dateVal}`);
      await this.renderCoverageActiveList();
      await this.refreshVisibleGrids();
    } catch (err) {
      this.app.showAlert('تعذر حفظ التغطية: ' + err.message, 'خطأ', 'danger');
    }
  }

  async handleDeleteShiftCoverage(overrideId) {
    if (!overrideId) return;
    const confirmed = await this.app.showConfirm('هل تريد إلغاء تغطية الشيفت لهذا الطبيب؟', 'تأكيد الإلغاء');
    if (!confirmed) return;

    try {
      await db.deleteShiftOverride(overrideId);
      this.app.showToast('تم إلغاء التغطية بنجاح');
      await this.renderCoverageActiveList();
      await this.refreshVisibleGrids();
    } catch (err) {
      this.app.showAlert('تعذر إلغاء التغطية: ' + err.message, 'خطأ', 'danger');
    }
  }

  async refreshVisibleGrids() {
    if (document.getElementById('appointments-grid')) await this.render(true);
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


  // ================= Copy / Duplicate Appointment Modal =================
  openCopyModal(apptId) {
    const appt = (this.appointments || []).find(a => a.id === apptId) || this.selectedApptForAction;
    if (!appt) return;

    this.copyingAppt = appt;
    const nameEl = document.getElementById('copy-appt-patient-name');
    if (nameEl) nameEl.textContent = appt.patientName || 'مريض';

    const currentSlotObj = (this.slots || []).find(s => s.key === appt.timeSlot);
    const slotLabel = currentSlotObj ? currentSlotObj.label : appt.timeSlot;
    const origDate = appt.date || this.selectedDate || getLocalDateStr();

    const infoEl = document.getElementById('copy-appt-current-info');
    if (infoEl) {
      infoEl.textContent = `الموعد الأصلي: د. ${appt.doctorName || '-'} • الساعة ${slotLabel} (${origDate})`;
    }

    // Populate Doctors Dropdown
    const docSel = document.getElementById('copy-appt-doctor');
    if (docSel) {
      docSel.innerHTML = (this.doctors || []).map(d => `
        <option value="${escapeHTML(d.uid)}" data-name="${escapeHTML(d.name)}" ${d.uid === appt.doctorUid ? 'selected' : ''}>
          ${escapeHTML(d.name)}
        </option>
      `).join('');
    }

    // Populate Slots Dropdown
    const slotSel = document.getElementById('copy-appt-slot');
    if (slotSel) {
      const slotsToUse = (this.slots && this.slots.length > 0) ? this.slots : DEFAULT_APPT_SLOTS;
      slotSel.innerHTML = slotsToUse.map(s => `
        <option value="${escapeHTML(s.key)}" ${s.key === appt.timeSlot ? 'selected' : ''}>
          ${escapeHTML(s.label)}
        </option>
      `).join('');
    }

    // Render 6 working days of the week (Saturday to Thursday)
    const cur = new Date(origDate + 'T00:00:00');
    const dayOfWeek = cur.getDay(); // 0: Sun, 1: Mon, ... 6: Sat
    const diffToSat = (dayOfWeek + 1) % 7;
    const sat = new Date(cur);
    sat.setDate(cur.getDate() - diffToSat);

    const arabicDays = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس'];
    const gridEl = document.getElementById('copy-appt-days-grid');
    if (gridEl) {
      gridEl.innerHTML = '';
      for (let i = 0; i < 6; i++) {
        const d = new Date(sat);
        d.setDate(sat.getDate() + i);
        const dateStr = getLocalDateStr(d);
        const isCurrent = (dateStr === origDate);

        const pill = document.createElement('div');
        pill.className = `copy-day-pill ${isCurrent ? 'is-current' : ''}`;
        pill.dataset.date = dateStr;
        pill.dataset.dayIndex = String(i);
        pill.innerHTML = `
          <span class="cdp-name">${arabicDays[i]}</span>
          <span class="cdp-date">${d.getDate()}/${d.getMonth() + 1}</span>
          ${isCurrent 
            ? '<span class="badge badge-sm cdp-tag" style="background: var(--border-color); color: var(--text-muted);">الموعد الأصلي</span>'
            : '<span class="badge badge-sm cdp-tag cdp-status-badge" style="display: none; background: var(--primary); color: #fff;"><i class="fa-solid fa-check"></i> تم التحديد</span>'
          }
        `;

        if (!isCurrent) {
          pill.addEventListener('click', () => {
            pill.classList.toggle('active');
            const statusBadge = pill.querySelector('.cdp-status-badge');
            if (statusBadge) {
              statusBadge.style.display = pill.classList.contains('active') ? 'inline-flex' : 'none';
            }
          });
        }

        gridEl.appendChild(pill);
      }
    }

    this.app.openModal('modal-copy-appointment');
  }

  setCopyShiftSelection(dayIndices) {
    const gridEl = document.getElementById('copy-appt-days-grid');
    if (!gridEl) return;
    const pills = gridEl.querySelectorAll('.copy-day-pill');
    pills.forEach(p => {
      if (p.classList.contains('is-current')) return;
      const idx = parseInt(p.dataset.dayIndex, 10);
      const shouldSelect = dayIndices.includes(idx);
      p.classList.toggle('active', shouldSelect);
      const statusBadge = p.querySelector('.cdp-status-badge');
      if (statusBadge) {
        statusBadge.style.display = shouldSelect ? 'inline-flex' : 'none';
      }
    });
  }

  async handleConfirmCopyAppointment() {
    if (!this.copyingAppt) return;
    const gridEl = document.getElementById('copy-appt-days-grid');
    const selectedPills = gridEl ? gridEl.querySelectorAll('.copy-day-pill.active') : [];

    const targetDates = Array.from(selectedPills).map(p => p.dataset.date).filter(Boolean);

    if (targetDates.length === 0) {
      this.app.showAlert('من فضلك اختر يوماً واحداً على الأقل لنسخ الموعد إليه.', 'تحديد الأيام', 'warning');
      return;
    }

    const docSel = document.getElementById('copy-appt-doctor');
    const slotSel = document.getElementById('copy-appt-slot');
    const chosenDocUid = docSel ? docSel.value : this.copyingAppt.doctorUid;
    const chosenDocName = docSel?.options[docSel.selectedIndex]?.getAttribute('data-name') || this.copyingAppt.doctorName;
    const chosenSlot = slotSel ? slotSel.value : this.copyingAppt.timeSlot;

    const btnSubmit = document.getElementById('btn-submit-copy-appt');
    if (btnSubmit) btnSubmit.disabled = true;

    let createdCount = 0;
    try {
      for (const targetDate of targetDates) {
        // Double check Friday
        if (new Date(targetDate + 'T00:00:00').getDay() === 5) continue;

        // Avoid exact duplicate
        const alreadyExists = (this.appointments || []).some(a =>
          a.patientId === this.copyingAppt.patientId &&
          a.date === targetDate &&
          a.timeSlot === chosenSlot &&
          a.status !== 'cancelled'
        );
        if (alreadyExists) continue;

        await db.addAppointment({
          doctorUid: chosenDocUid,
          doctorName: chosenDocName,
          timeSlot: chosenSlot,
          patientId: this.copyingAppt.patientId,
          patientName: this.copyingAppt.patientName,
          date: targetDate,
          bodyPart: this.copyingAppt.bodyPart || '',
          status: 'scheduled',
          copiedFromId: this.copyingAppt.id,
          createdBy: auth.getCurrentUser()?.name || 'الاستقبال'
        });
        createdCount++;
      }

      this.app.closeModal('modal-copy-appointment');
      if (createdCount > 0) {
        this.app.showToast(`تم نسخ موعد ${this.copyingAppt.patientName} بنجاح إلى (${createdCount} أيام)!`);
      } else {
        this.app.showToast(`الموعد مسجل بالفعل في الأيام المختارة.`);
      }
      this.copyingAppt = null;
      await this.refreshVisibleGrids();
    } catch (err) {
      console.error('Error copying appointment:', err);
      this.app.showAlert('تعذر نسخ الموعد: ' + err.message, 'خطأ', 'danger');
    } finally {
      if (btnSubmit) btnSubmit.disabled = false;
    }
  }
