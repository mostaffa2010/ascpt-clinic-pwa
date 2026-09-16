import { CLINIC_CONFIG } from './clinic-config.js';
// ========================================================
// ASCPT - Weekly Recurring Appointments Schedule (Master Timetable & Daily Operations)
// ========================================================
// In Physical Therapy, an appointment is a Recurring Weekly Slot (e.g. Sat-Mon-Wed at 3:30 PM).
// Master recurring bookings persist automatically across weeks until completed/discharged.
// Single-day exceptions (e.g. patient apologies for today) are tracked without breaking future weeks.

import { escapeHTML, initStackDeck, getDoctorColor, getLocalDateStr, isDoctorOnDuty, getShiftLabel, getDayShiftKey, getLatestTherapySession } from './utils.js';
import { db } from './db.js';
import { auth } from './auth.js';

export const DEFAULT_APPT_SLOTS = [
  { key: '15:30', label: '٣:٣٠ م' },
  { key: '16:30', label: '٤:٣٠ م' },
  { key: '17:30', label: '٥:٣٠ م' },
  { key: '18:30', label: '٦:٣٠ م' },
  { key: '19:00', label: '٧:٠٠ م' }
];

export const MAX_BEDS_PER_SLOT = 6;

export const DAYS_CONFIG = [
  { dayIndex: 6, name: 'السبت', short: 'سبت', key: 'sat' },
  { dayIndex: 0, name: 'الأحد', short: 'أحد', key: 'sun' },
  { dayIndex: 1, name: 'الاثنين', short: 'إثنين', key: 'mon' },
  { dayIndex: 2, name: 'الثلاثاء', short: 'ثلاثاء', key: 'tue' },
  { dayIndex: 3, name: 'الأربعاء', short: 'أربعاء', key: 'wed' },
  { dayIndex: 4, name: 'الخميس', short: 'خميس', key: 'thu' }
];

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
  return { hour, minute, period, h24 };
}

export function formatRecurringDays(daysOfWeek) {
  if (!Array.isArray(daysOfWeek) || daysOfWeek.length === 0) return '';
  const order = [6, 0, 1, 2, 3, 4];
  const sorted = [...daysOfWeek].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  if (sorted.length === 6) return 'يومياً (عدا الجمعة)';
  if (sorted.length === 3 && sorted.includes(6) && sorted.includes(1) && sorted.includes(3)) return 'سبت - إثنين - أربع';
  if (sorted.length === 3 && sorted.includes(0) && sorted.includes(2) && sorted.includes(4)) return 'أحد - ثلاثاء - خميس';
  const dayNames = { 6: 'سبت', 0: 'أحد', 1: 'إثنين', 2: 'ثلاثاء', 3: 'أربعاء', 4: 'خميس' };
  return sorted.map(d => dayNames[d] || '').filter(Boolean).join(' • ');
}

export class AppointmentsManager {
  constructor(app) {
    this.app = app;
    this.appointments = [];
    this._hasLoadedOnce = false;
    this.doctors = [];
    this.patients = [];
    this.slots = [];
    this.pendingDoctorUid = null;
    this.pendingDoctorName = null;
    this.pendingTimeSlot = null;
    this.selectedPatientId = null;
    this.selectedPatientName = null;

    // View Mode: 'daily' (Operational) vs 'weekly' (Master Timetable)
    this.viewMode = 'daily';

    // Recurring Days Selection State
    this.selectedDaysForNewAppt = [6, 1, 3]; // Default: Sat/Mon/Wed
    this.selectedDaysForMoveAppt = [6, 1, 3];

    // Slot Editing State
    this.slotEditMode = 'edit';
    this.slotEditOldKey = null;
    this.movingAppt = null;
    this.doctorApptFilter = 'active';
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

    // Book New Appointment Header Button
    document.getElementById('btn-book-new-appt')?.addEventListener('click', () => {
      this.openAddModal(null, null, null);
    });

    // View Switcher Buttons
    document.getElementById('btn-view-mode-daily')?.addEventListener('click', () => {
      this.setViewMode('daily');
    });
    document.getElementById('btn-view-mode-weekly')?.addEventListener('click', () => {
      this.setViewMode('weekly');
    });

    // Form: Submit Appointment
    document.getElementById('modal-appointment-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submitAppointment();
    });

    // Days Presets in Add Modal
    document.getElementById('btn-preset-sat-mon-wed')?.addEventListener('click', () => {
      this.setNewApptDays([6, 1, 3], 'sat_mon_wed');
    });
    document.getElementById('btn-preset-sun-tue-thu')?.addEventListener('click', () => {
      this.setNewApptDays([0, 2, 4], 'sun_tue_thu');
    });
    document.getElementById('btn-preset-daily')?.addEventListener('click', () => {
      this.setNewApptDays([6, 0, 1, 2, 3, 4], 'daily');
    });

    // Individual Day Toggles in Add Modal
    document.getElementById('appt-modal-days-grid')?.addEventListener('click', (e) => {
      const toggle = e.target.closest('.appt-day-toggle');
      if (toggle && toggle.dataset.day !== undefined) {
        const dayIdx = parseInt(toggle.dataset.day, 10);
        this.toggleNewApptDay(dayIdx);
      }
    });

    // Days Presets in Move Modal
    document.getElementById('btn-move-preset-sat-mon-wed')?.addEventListener('click', () => {
      this.setMoveApptDays([6, 1, 3]);
    });
    document.getElementById('btn-move-preset-sun-tue-thu')?.addEventListener('click', () => {
      this.setMoveApptDays([0, 2, 4]);
    });
    document.getElementById('btn-move-preset-daily')?.addEventListener('click', () => {
      this.setMoveApptDays([6, 0, 1, 2, 3, 4]);
    });

    // Individual Day Toggles in Move Modal
    document.getElementById('move-modal-days-grid')?.addEventListener('click', (e) => {
      const toggle = e.target.closest('.appt-day-toggle');
      if (toggle && toggle.dataset.day !== undefined) {
        const dayIdx = parseInt(toggle.dataset.day, 10);
        this.toggleMoveApptDay(dayIdx);
      }
    });

    // Slot selection in Add Modal live update
    document.getElementById('appt-slot-select')?.addEventListener('change', () => {
      this.updateApptPreviewText();
    });

    // Patient picker trigger
    document.getElementById('appt-patient-picker-trigger')?.addEventListener('click', () => this.openPatientPicker());

    const searchInput = document.getElementById('appt-picker-search-input');
    if (searchInput) searchInput.addEventListener('input', () => this.renderPickerPatients());

    document.getElementById('appt-picker-patients-list')?.addEventListener('click', (e) => {
      const item = e.target.closest('.picker-item');
      if (item) this.selectPatientFromPicker(item.getAttribute('data-patient-id'));
    });

    // Move / Reschedule Appointment Form
    document.getElementById('form-move-appointment')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleConfirmMoveAppointment();
    });

    // Copy / Duplicate Appointment Form & Presets
    document.getElementById('form-copy-appointment')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleConfirmCopyAppointment();
    });

    document.getElementById('btn-copy-shift-sat-mon-wed')?.addEventListener('click', () => {
      this.setCopyShiftSelection([0, 2, 4]);
    });

    document.getElementById('btn-copy-shift-sun-tue-thu')?.addEventListener('click', () => {
      this.setCopyShiftSelection([1, 3, 5]);
    });

    // Add New Slot Trigger Button in Card Header
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

    // Period Segmented Control
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

    // Shift Coverage Overrides
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

    // Date Strip Navigation Controls
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

    // Action Bottom Sheet Buttons
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

    document.getElementById('btn-appt-sheet-apologize-today')?.addEventListener('click', () => {
      if (this.selectedApptForAction) this.toggleApologyForToday(this.selectedApptForAction);
    });

    document.getElementById('btn-appt-sheet-finish-course')?.addEventListener('click', () => {
      if (this.selectedApptForAction) this.handleFinishCourse(this.selectedApptForAction);
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

  setViewMode(mode) {
    this.viewMode = mode;
    const btnDaily = document.getElementById('btn-view-mode-daily');
    const btnWeekly = document.getElementById('btn-view-mode-weekly');
    if (btnDaily) btnDaily.classList.toggle('active', mode === 'daily');
    if (btnWeekly) btnWeekly.classList.toggle('active', mode === 'weekly');

    const navBar = document.querySelector('.appt-date-navigator-bar');
    if (navBar) {
      navBar.style.display = (mode === 'daily') ? 'block' : 'none';
    }

    this.render();
  }

  setNewApptDays(days, presetKey = null) {
    this.selectedDaysForNewAppt = [...days];
    this.updateDaysGridUI('appt-modal-days-grid', this.selectedDaysForNewAppt);
    this.updatePresetsUI('appt-presets-wrap', presetKey);
    this.updateApptPreviewText();
  }

  toggleNewApptDay(dayIdx) {
    const idx = this.selectedDaysForNewAppt.indexOf(dayIdx);
    if (idx > -1) {
      if (this.selectedDaysForNewAppt.length <= 1) {
        this.app.showAlert('يجب اختيار يوم واحد على الأقل للموعد الدوري.', 'تنبيه', 'warning');
        return;
      }
      this.selectedDaysForNewAppt.splice(idx, 1);
    } else {
      this.selectedDaysForNewAppt.push(dayIdx);
    }
    this.updateDaysGridUI('appt-modal-days-grid', this.selectedDaysForNewAppt);
    this.updatePresetsUI('appt-presets-wrap', null);
    this.updateApptPreviewText();
  }

  setMoveApptDays(days) {
    this.selectedDaysForMoveAppt = [...days];
    this.updateDaysGridUI('move-modal-days-grid', this.selectedDaysForMoveAppt);
  }

  toggleMoveApptDay(dayIdx) {
    const idx = this.selectedDaysForMoveAppt.indexOf(dayIdx);
    if (idx > -1) {
      if (this.selectedDaysForMoveAppt.length <= 1) {
        this.app.showAlert('يجب اختيار يوم واحد على الأقل للموعد الدوري.', 'تنبيه', 'warning');
        return;
      }
      this.selectedDaysForMoveAppt.splice(idx, 1);
    } else {
      this.selectedDaysForMoveAppt.push(dayIdx);
    }
    this.updateDaysGridUI('move-modal-days-grid', this.selectedDaysForMoveAppt);
  }

  updateDaysGridUI(gridId, selectedDays) {
    const grid = document.getElementById(gridId);
    if (!grid) return;
    grid.querySelectorAll('.appt-day-toggle').forEach(el => {
      const d = parseInt(el.dataset.day, 10);
      el.classList.toggle('active', selectedDays.includes(d));
    });
  }

  updatePresetsUI(containerId, activePreset) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.querySelectorAll('.appt-preset-pill').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.preset === activePreset);
    });
  }

  updateApptPreviewText() {
    const el = document.getElementById('appt-schedule-preview-text');
    if (!el) return;
    const daysStr = formatRecurringDays(this.selectedDaysForNewAppt);
    const slotKey = document.getElementById('appt-slot-select')?.value || this.pendingTimeSlot || '15:30';
    const slotObj = (this.slots || []).find(s => s.key === slotKey);
    const slotLabel = slotObj ? slotObj.label : slotKey;
    const docSelect = document.getElementById('appt-doctor-select');
    const docName = docSelect?.options[docSelect.selectedIndex]?.text?.split('(')[0]?.trim() || 'طبيب المركز';
    el.textContent = `سيتم تثبيت الموعد الدوري أسبوعياً كل (${daysStr}) الساعة ${slotLabel} مع ${docName}`;
  }

  getPatternFromDays(days) {
    if (!Array.isArray(days)) return 'custom';
    if (days.length === 6) return 'daily';
    if (days.length === 3 && days.includes(6) && days.includes(1) && days.includes(3)) return 'sat_mon_wed';
    if (days.length === 3 && days.includes(0) && days.includes(2) && days.includes(4)) return 'sun_tue_thu';
    return 'custom';
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
    const curDate = new Date(dateStr + 'T00:00:00');
    const dayOfWeek = curDate.getDay(); // 0..6
    if (dayOfWeek === 5) return []; // Friday is clinic holiday

    return (this.appointments || []).filter(a => {
      // Cancelled appointments at master level are excluded
      if (a.status === 'cancelled') return false;

      // 1. Recurring Appointment Model (Master Weekly Schedule)
      if (Array.isArray(a.daysOfWeek) && a.daysOfWeek.length > 0) {
        if (!a.daysOfWeek.includes(dayOfWeek)) return false;
        if (a.startDate && dateStr < a.startDate) return false;
        if (a.endDate && dateStr > a.endDate) return false;
        return true;
      }

      // 2. Direct date match (Legacy one-off or explicit date)
      if (a.date) {
        return a.date === dateStr;
      }

      // 3. Backward compatibility for legacy appointments with dayOfWeek pattern
      if (a.dayOfWeek) {
        const shiftKey = getDayShiftKey(dateStr);
        return a.dayOfWeek === shiftKey;
      }
      return false;
    }).map(a => {
      let effectiveStatus = (Array.isArray(a.daysOfWeek) && a.daysOfWeek.length > 0) ? 'scheduled' : (a.status || 'scheduled');

      // Check if apologized for today only (single-day cancellation exception)
      if (Array.isArray(a.cancelledDates) && a.cancelledDates.includes(dateStr)) {
        effectiveStatus = 'cancelled';
      } else {
        // Check if patient attended today in sessions collection
        const hasSessionToday = (this.sessions || []).some(s =>
          s.patientId === a.patientId &&
          (s.date === dateStr || s.createdAt?.startsWith(dateStr)) &&
          s.status !== 'cancelled'
        );
        if (hasSessionToday) {
          effectiveStatus = 'attended';
        } else if (a.dailyStatuses && a.dailyStatuses[dateStr]) {
          effectiveStatus = a.dailyStatuses[dateStr];
        }
      }

      return {
        ...a,
        effectiveStatus,
        isCancelledToday: effectiveStatus === 'cancelled',
        isAttendedToday: effectiveStatus === 'attended' || effectiveStatus === 'completed'
      };
    });
  }

  getSlotTotalCount(timeSlot, targetDate = this.selectedDate) {
    const dayAppts = this.getAppointmentsForDate(targetDate);
    return dayAppts.filter(a => a.timeSlot === timeSlot && a.effectiveStatus !== 'cancelled').length;
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
      if (docUid) await this.renderForDoctor(docUid);
    }
  }

  renderWeekdayStrip() {
    const container = document.getElementById('appt-weekday-strip');
    if (!container) return;

    const cur = new Date(this.selectedDate + 'T00:00:00');
    const dayOfWeek = cur.getDay();
    const diffToSat = (dayOfWeek + 1) % 7;
    const sat = new Date(cur);
    sat.setDate(cur.getDate() - diffToSat);

    const arabicDays = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس'];
    const days = [];
    const todayStr = getLocalDateStr();

    for (let i = 0; i < 6; i++) {
      const d = new Date(sat);
      d.setDate(sat.getDate() + i);
      const dateStr = getLocalDateStr(d);
      const dayAppts = this.getAppointmentsForDate(dateStr);
      const activeCount = dayAppts.filter(a => a.effectiveStatus !== 'cancelled').length;

      days.push({
        name: arabicDays[i],
        date: dateStr,
        count: activeCount,
        isToday: dateStr === todayStr,
        isSelected: dateStr === this.selectedDate
      });
    }

    container.innerHTML = days.map(d => `
      <div class="appt-weekday-pill ${d.isSelected ? 'active' : ''} ${d.isToday ? 'is-today' : ''}" data-date="${d.date}">
        <span class="awp-name">${d.name}</span>
        <span class="awp-date">${d.date.split('-').slice(1).join('/')}</span>
        <span class="awp-badge">${d.count} حالات</span>
      </div>
    `).join('');

    const statsPill = document.getElementById('appt-day-stats-pill');
    if (statsPill) {
      const totalToday = this.getAppointmentsForDate(this.selectedDate).filter(a => a.effectiveStatus !== 'cancelled').length;
      statsPill.innerHTML = `<i class="fa-solid fa-users text-primary"></i> إجمالي مواعيد اليوم: <strong style="color: var(--primary);">${totalToday}</strong> مريض`;
    }
  }

  subscribeToUpdates() {
    if (this._apptSubscribed) return;
    if (db.subscribeToAppointments) {
      this._apptSubscribed = true;
      db.subscribeToAppointments(async (list) => {
        this.appointments = list || [];
        const currentUser = auth.getCurrentUser();
        if (currentUser && currentUser.role === 'doctor') {
          const docUid = currentUser.uid || currentUser.id;
          if (docUid) await this.renderForDoctor(docUid);
        } else {
          await this.render();
        }
      });
    }
  }

  renderSkeleton(grid = document.getElementById('appointments-grid')) {
    if (!grid) return;
    grid.innerHTML = `
      <div class="skeleton-appointments" style="display: flex; flex-direction: column; gap: 12px; padding: 10px 0;">
        ${Array.from({ length: 4 }).map(() => `
          <div class="skeleton-card" style="padding: 14px; border-radius: var(--radius-md, 16px);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
              <div class="skeleton-shimmer skeleton-line" style="width: 110px; height: 18px;"></div>
              <div class="skeleton-shimmer skeleton-badge" style="width: 70px;"></div>
            </div>
            <div style="display: flex; gap: 10px; flex-wrap: wrap;">
              <div class="skeleton-shimmer" style="flex: 1; min-width: 140px; height: 46px; border-radius: var(--radius-sm, 10px);"></div>
              <div class="skeleton-shimmer" style="flex: 1; min-width: 140px; height: 46px; border-radius: var(--radius-sm, 10px);"></div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  async render(forceRefresh = false) {
    this.subscribeToUpdates();
    const grid = document.getElementById('appointments-grid');
    if (!grid) return;
    if (!this._hasLoadedOnce && (!this.appointments || this.appointments.length === 0)) {
      this.renderSkeleton(grid);
    }
    try {
      await this.loadAll(this.selectedDate, forceRefresh);
      this._hasLoadedOnce = true;
      const currentUser = auth.getCurrentUser();
      const isDoctor = currentUser && currentUser.role === 'doctor';

      if (this.viewMode === 'weekly') {
        grid.innerHTML = this.buildWeeklyMasterHTML(this.doctors, isDoctor);
      } else {
        this.renderWeekdayStrip();
        const calPicker = document.getElementById('appt-calendar-picker');
        if (calPicker && this.selectedDate) {
          calPicker.value = this.selectedDate;
        }
        grid.innerHTML = this.buildGridHTML(this.doctors, isDoctor);
      }
    } catch (err) {
      console.error('Appointments render error:', err);
      grid.innerHTML = this.buildErrorHTML(err);
    }
  }

  getCompletedAppts(doctorUid) {
    const today = this.selectedDate || getLocalDateStr();
    try {
      const raw = localStorage.getItem(`ascpt_completed_appts_${doctorUid}_${today}`);
      return raw ? JSON.parse(raw) : [];
    } catch (_) {
      return [];
    }
  }

  async toggleApptCompleted(apptId, doctorUid, patientName) {
    const today = this.selectedDate || getLocalDateStr();
    const completedApptIds = this.getCompletedAppts(doctorUid);
    const isCompleted = completedApptIds.includes(apptId);

    const appt = (this.appointments || []).find(a => a.id === apptId);
    if (!appt) return;

    if (!isCompleted) {
      // 1. Resolve Patient Object
      let patient = (this.patients || []).find(p => p.id === appt.patientId);
      if (!patient) {
        try {
          const allPatients = await db.getPatients();
          patient = allPatients.find(p => p.id === appt.patientId || p.name === (appt.patientName || patientName));
        } catch (_) {}
      }

      const targetPatientId = appt.patientId || patient?.id;

      // 2. First Session Restriction: Check if patient has any previous session
      let allPatientSessions = [];
      if (targetPatientId) {
        try {
          allPatientSessions = (await db.getSessionsForPatient(targetPatientId) || []).filter(s =>
            s.status !== 'cancelled' && (s.entryType === 'session' || !s.entryType)
          );
        } catch (_) {}
      }

      // Fallback search by patient name if ID search returned empty
      if (allPatientSessions.length === 0 && (appt.patientName || patientName)) {
        try {
          const allSess = await db.getSessions();
          allPatientSessions = (allSess || []).filter(s =>
            s.patientName === (appt.patientName || patientName) &&
            s.status !== 'cancelled' &&
            (s.entryType === 'session' || !s.entryType)
          );
        } catch (_) {}
      }

      const lastSession = getLatestTherapySession(allPatientSessions);
      if (!lastSession) {
        await this.app.showAlert(
          `عذراً يا دكتور، هذه الجلسة الأولى للمريض (${patientName}). طبقاً لتعليمات الإدارة، يجب أن يقوم الاستقبال بتسجيل الجلسة الأولى واستلام الحساب أولاً.`,
          'تنبيه: الجلسة الأولى للمريض',
          'warning'
        );
        return;
      }

      // 3. Subsequent Session: Auto-create session in sessions collection copying last session settings
      let createdSessionId = null;
      try {
        const todaySessions = (await db.getSessions(today) || []).filter(s =>
          (s.patientId === targetPatientId || s.patientName === (appt.patientName || patientName)) &&
          s.status !== 'cancelled' &&
          (s.entryType === 'session' || !s.entryType)
        );

        if (todaySessions.length === 0) {
          const docObj = (this.doctors || []).find(d => d.uid === doctorUid || d.id === doctorUid);
          const docName = appt.doctorName || docObj?.name || 'طبيب المركز';

          let sessionNumber = 1;
          let cycleNumber = 1;
          let approvedSessionsTotal = 12;
          if (patient) {
            const approvedTotal = parseInt(patient.approvedSessions, 10) || 12;
            const therapySessions = allPatientSessions.filter(x => (x.entryType === 'session' || !x.entryType) && x.status !== 'cancelled');
            const totalCount = therapySessions.length;
            sessionNumber = (totalCount % approvedTotal) + 1;
            cycleNumber = Math.floor(totalCount / approvedTotal) + 1;
            approvedSessionsTotal = approvedTotal;
          }

          let partsToUse = [];
          if (Array.isArray(lastSession.bodyParts) && lastSession.bodyParts.length > 0) {
            partsToUse = [...lastSession.bodyParts];
          } else if (appt.bodyPart) {
            partsToUse = [appt.bodyPart];
          } else if (patient?.bodyParts) {
            partsToUse = [...patient.bodyParts];
          }

          const safeDoctorUid = doctorUid || appt.doctorUid || auth.getCurrentUser()?.uid || '';
          const safePatientName = appt.patientName || patientName || patient?.name || 'مريض غير محدد';
          const safePatientId = targetPatientId || appt.patientId || patient?.id || '';
          const safeApptId = apptId || appt.id || '';

          const newSessionData = {
            id: null,
            entryType: 'session',
            examType: null,
            isSpecial: Boolean(lastSession.isSpecial || lastSession.sessionPricingType === 'special'),
            sessionPricingType: lastSession.sessionPricingType || lastSession.programType || 'regular',
            programType: lastSession.programType || lastSession.sessionPricingType || 'regular',
            date: today,
            patientId: safePatientId,
            patientName: safePatientName,
            doctor: docName,
            doctorUid: safeDoctorUid,
            bodyParts: partsToUse,
            bodyPartsCount: partsToUse.length || 1,
            payType: lastSession.payType || (patient?.billing === 'insurance' ? 'insurance' : 'cash'),
            insuranceName: lastSession.insuranceName || patient?.insuranceCompany || '',
            contractType: lastSession.contractType || patient?.contractType || '-',
            amountPaid: typeof lastSession.amountPaid === 'number' ? lastSession.amountPaid : 0,
            notes: `تم الإتمام والتسجيل تلقائياً بواسطة الطبيب (${docName.replace(/^د\.\s*/, '')})`,
            sessionNumber: typeof sessionNumber === 'number' ? sessionNumber : (lastSession.sessionNumber ? lastSession.sessionNumber + 1 : 1),
            cycleNumber: typeof cycleNumber === 'number' ? cycleNumber : 1,
            approvedSessionsTotal: typeof approvedSessionsTotal === 'number' ? approvedSessionsTotal : (patient?.approvedSessions || 12),
            approvedBodyPartsTotal: typeof patient?.approvedBodyParts === 'number' ? patient.approvedBodyParts : 1,
            autoCreatedByDoctor: true,
            sourceAppointmentId: safeApptId,
            status: 'active'
          };

          const currentUser = auth.getCurrentUser() || { name: docName, role: 'doctor', uid: safeDoctorUid };
          const savedSession = await db.saveSession(newSessionData, currentUser);
          createdSessionId = savedSession?.id || null;
          if (savedSession && window.app?.notificationsManager) {
            try {
              window.app.notificationsManager.sendNotification({
                type: 'session_completed',
                title: 'تم تسجيل جلسة من جدول الطبيب',
                body: `المريض: ${safePatientName} بواسطة د. ${docName}`,
                target: { role: 'receptionist' },
                data: { screen: 'sessions', date: today, patientId: safePatientId }
              });
            } catch (notifErr) {
              console.warn('Notification to reception notice:', notifErr);
            }
          }
        } else {
          createdSessionId = todaySessions[0]?.id || null;
        }
      } catch (err) {
        console.error('Error auto-creating session by doctor:', err);
        const errMsg = String(err?.message || err || '');
        const isPermissionDenied = errMsg.toLowerCase().includes('permission-denied') ||
                                   errMsg.toLowerCase().includes('permission') ||
                                   err?.code === 'permission-denied';

        if (isPermissionDenied) {
          // If Firestore security rules restrict direct session writes for doctor role,
          // complete the appointment in schedule so the doctor is not blocked, but warn clearly
          await this.app.showAlert(
            'تم تسجيل الموعد كمكتمل في جدولك، ولكن تعذر تسجيل الجلسة تلقائياً في سجل الاستقبال بسبب قيود صلاحيات Firestore السحابية (Permission Denied). يرجى السماح للأطباء بإنشاء الجلسات في Firestore Rules من Firebase Console أو تسجيلها يدوياً من الاستقبال.',
            'تنبيه: قيود صلاحيات السحاب',
            'warning'
          );
        } else {
          await this.app.showAlert('تعذر حفظ الجلسة في سجل الاستقبال: ' + err.message, 'خطأ في الحفظ', 'danger');
          return;
        }
      }

      // 4. Update completed list in localStorage and appointment status
      const updated = [...completedApptIds, apptId];
      try {
        localStorage.setItem(`ascpt_completed_appts_${doctorUid}_${today}`, JSON.stringify(updated));
      } catch (_) {}

      const isRecurring = Array.isArray(appt.daysOfWeek) && appt.daysOfWeek.length > 0;
      const dailyStatuses = { ...(appt.dailyStatuses || {}) };
      dailyStatuses[today] = 'completed';

      const dailySessionIds = { ...(appt.dailySessionIds || {}) };
      if (createdSessionId) {
        dailySessionIds[today] = createdSessionId;
      }

      const updates = {
        dailyStatuses,
        dailySessionIds,
        statusUpdatedAt: new Date().toISOString()
      };
      if (isRecurring) {
        if (appt.status === 'completed') {
          updates.status = 'scheduled';
          appt.status = 'scheduled';
        }
      } else {
        updates.status = 'completed';
        updates.completedAt = new Date().toISOString();
        updates.doctorUid = doctorUid;
      }
      await db.updateAppointment(apptId, updates);
      appt.dailyStatuses = dailyStatuses;
      appt.dailySessionIds = dailySessionIds;

      if (this.app?.showToast) {
        this.app.showToast(`عاش يا دكتور! تم إنهاء وتسجيل جلسة: ${patientName}`, 'success');
      }
    } else {
      // 5. Doctor Undo (زر التراجع):
      try {
        let sessionIdToDelete = appt?.dailySessionIds?.[today];
        if (!sessionIdToDelete) {
          const todaySessions = (await db.getSessions(today) || []).filter(s =>
            (s.patientId === appt.patientId || s.patientName === (appt.patientName || patientName)) &&
            s.status !== 'cancelled' &&
            s.autoCreatedByDoctor
          );
          if (todaySessions.length > 0) {
            sessionIdToDelete = todaySessions[0].id;
          }
        }
        if (sessionIdToDelete) {
          await db.deleteSession(sessionIdToDelete);
        }
      } catch (delErr) {
        console.warn('Error deleting auto-created session on undo:', delErr);
      }

      const updated = completedApptIds.filter(id => id !== apptId);
      try {
        localStorage.setItem(`ascpt_completed_appts_${doctorUid}_${today}`, JSON.stringify(updated));
      } catch (_) {}

      const dailyStatuses = { ...(appt.dailyStatuses || {}) };
      delete dailyStatuses[today];

      const dailySessionIds = { ...(appt.dailySessionIds || {}) };
      delete dailySessionIds[today];

      const isRecurring = Array.isArray(appt.daysOfWeek) && appt.daysOfWeek.length > 0;
      const updates = {
        dailyStatuses,
        dailySessionIds,
        statusUpdatedAt: new Date().toISOString()
      };
      if (!isRecurring) {
        updates.status = 'scheduled';
        updates.completedAt = null;
      }
      await db.updateAppointment(apptId, updates);
      appt.dailyStatuses = dailyStatuses;
      appt.dailySessionIds = dailySessionIds;

      if (this.app?.showToast) {
        this.app.showToast(`تم التراجع عن إكمال حالة: ${patientName} وإلغاء تسجيل الجلسة`, 'info');
      }
    }

    await this.renderForDoctor(doctorUid);
  }

  findClosestSlotIndex(slots) {
    if (!slots || slots.length === 0) return 0;
    const now = new Date();
    const curMin = now.getHours() * 60 + now.getMinutes();
    let bestIdx = 0;
    let minDiff = Infinity;
    slots.forEach((s, idx) => {
      const { h24, minute } = parseSlotKey(s.slot.key);
      const slotMin = h24 * 60 + parseInt(minute, 10);
      const diff = Math.abs(curMin - slotMin);
      if (diff < minDiff) {
        minDiff = diff;
        bestIdx = idx;
      }
    });
    return bestIdx;
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

    grid.querySelector('#btn-doc-appts-active')?.addEventListener('click', () => {
      this.doctorApptFilter = 'active';
      this.renderForDoctor(doctorUid);
    });

    grid.querySelector('#btn-doc-appts-completed')?.addEventListener('click', () => {
      this.doctorApptFilter = 'completed';
      this.renderForDoctor(doctorUid);
    });

    grid.querySelectorAll('.btn-complete-patient').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const apptId = btn.getAttribute('data-appt-id');
        const patientName = btn.getAttribute('data-patient-name');
        this.toggleApptCompleted(apptId, doctorUid, patientName);
      });
    });

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
      const dayName = new Intl.DateTimeFormat('ar-EG', { weekday: 'long' }).format(new Date(targetDate + 'T00:00:00'));
      return {
        html: `
          <div class="hero-styled-card doc-offduty-schedule-card" style="text-align: center; padding: 36px 20px; margin: 4px 0; border: 1.5px dashed rgba(2, 132, 199, 0.3); background: rgba(2, 132, 199, 0.03);">
            <div style="width: 58px; height: 58px; border-radius: 50%; background: rgba(2, 132, 199, 0.12); color: var(--primary); display: inline-flex; align-items: center; justify-content: center; font-size: 1.6rem; margin-bottom: 14px;">
              <i class="fa-solid fa-mug-hot"></i>
            </div>
            <div style="font-weight: 800; font-size: 1.15rem; color: var(--text-main);">اليوم (${dayName}) ليس ضمن أيام عملك الرسمية</div>
            <div style="font-size: 0.86rem; color: var(--text-muted); margin-top: 6px; line-height: 1.6;">
              شفتك المسجل بالمركز هو: <strong style="color: var(--primary);">${escapeHTML(shiftName)}</strong>.<br>
              استمتع بيوم إجازتك! ☕ (في حالة النزول كشيفت تغطية استثنائي، يمكن للاستقبال تفعيل شيفتك لليوم).
            </div>
          </div>
        `,
        initialIndex: 0
      };
    }

    const slotsToRender = (this.slots && this.slots.length > 0) ? this.slots : DEFAULT_APPT_SLOTS;
    const completedApptIds = this.getCompletedAppts(doctorUid);

    const allSlots = slotsToRender.map((slot) => {
      const cellAppts = this.getCellAppointments(doctorUid, slot.key, targetDate);
      if (cellAppts.length === 0) return null;

      const uncompletedAppts = cellAppts.filter(a => a.effectiveStatus !== 'completed' && a.effectiveStatus !== 'attended' && !completedApptIds.includes(a.id));
      const completedAppts = cellAppts.filter(a => a.effectiveStatus === 'completed' || a.effectiveStatus === 'attended' || completedApptIds.includes(a.id));
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

    const slotsToDisplay = isShowingCompleted 
      ? allSlots.filter(s => s.completedAppts.length > 0)
      : allSlots.filter(s => !s.isSlotFullyDone);

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
        <div class="doc-stack-container" id="doc-stack-container">
          ${slotsToDisplay.map(({ slot, cellAppts, uncompletedAppts, completedAppts, isSlotFullyDone }, index) => {
            const listToShow = isShowingCompleted ? completedAppts : uncompletedAppts;
            return `
              <div class="hero-styled-card doc-stack-card doc-slot-card ${index === initialIndex ? 'is-active-card' : 'is-peeking-card'}" data-card-index="${index}">
                <div class="doc-stack-card-header">
                  <div class="doc-stack-time-badge">
                    <i class="fa-regular fa-clock"></i>
                    <span>${escapeHTML(slot.label)}</span>
                  </div>
                  <div class="doc-stack-patient-count ${isSlotFullyDone ? 'done' : ''}">
                    ${isSlotFullyDone ? '<i class="fa-solid fa-check-double"></i> <span>مكتملة بالكامل</span>' : `<i class="fa-solid fa-users"></i> <span><strong>${uncompletedAppts.length}</strong> متبقي من ${cellAppts.length}</span>`}
                  </div>
                </div>

                <div class="doc-stack-patients-list">
                  ${listToShow.map(a => {
                    const isDone = completedApptIds.includes(a.id) || a.effectiveStatus === 'completed' || a.effectiveStatus === 'attended';
                    const daysStr = formatRecurringDays(a.daysOfWeek);
                    const patientObj = (this.patients || []).find(p => p.id === a.patientId) ||
                                       (this.app?.patientsManager?.patients || []).find(p => p.id === a.patientId) ||
                                       (this.patients || []).find(p => p.name === a.patientName) ||
                                       (this.app?.patientsManager?.patients || []).find(p => p.name === a.patientName);

                    let bodyPartText = (a.bodyPart && a.bodyPart !== 'علاج طبيعي عام') ? a.bodyPart : '';
                    if (!bodyPartText && patientObj) {
                      let partsList = [];
                      if (this.app?.patientsManager?.getPatientBodyParts) {
                        partsList = this.app.patientsManager.getPatientBodyParts(patientObj) || [];
                      }
                      if (partsList.length === 0 && Array.isArray(patientObj.bodyParts) && patientObj.bodyParts.length > 0) {
                        partsList = patientObj.bodyParts;
                      }
                      if (partsList.length === 0 && patientObj.affectedArea) {
                        partsList = [patientObj.affectedArea];
                      }
                      if (partsList.length === 0 && patientObj.clinicalSheet?.affectedArea) {
                        partsList = [patientObj.clinicalSheet.affectedArea];
                      }
                      if (partsList.length > 0) {
                        bodyPartText = partsList.join(' • ');
                      }
                    }
                    const displayBodyPart = bodyPartText || a.bodyPart || 'علاج طبيعي عام';

                    return `
                      <div class="doc-stack-patient-row ${isDone ? 'completed-row' : ''}">
                        <div class="doc-stack-patient-info">
                          <div class="doc-stack-patient-name">
                            <i class="fa-solid fa-user-injured text-primary"></i>
                            <span>${escapeHTML(a.patientName)}</span>
                            ${daysStr ? `<span class="badge" style="font-size: 0.65rem; background: rgba(2, 132, 199, 0.1); color: #0284c7; padding: 1px 5px; border-radius: 4px; margin-right: 5px;">${escapeHTML(daysStr)}</span>` : ''}
                          </div>
                          <div class="doc-stack-patient-details">
                            <span class="patient-body-part">${escapeHTML(displayBodyPart)}</span>
                            ${a.notes ? `<span class="patient-notes">• ${escapeHTML(a.notes)}</span>` : ''}
                          </div>
                        </div>
                        <div class="doc-stack-patient-actions">
                          ${isDone ? `
                            <button type="button" class="btn-undo-patient" data-appt-id="${escapeHTML(a.id)}" data-patient-name="${escapeHTML(a.patientName)}" title="تراجع عن الإكمال">
                              <i class="fa-solid fa-rotate-left"></i> <span>تراجع</span>
                            </button>
                          ` : `
                            <button type="button" class="btn-complete-patient" data-appt-id="${escapeHTML(a.id)}" data-patient-name="${escapeHTML(a.patientName)}" title="تم إنهاء الجلسة">
                              <i class="fa-solid fa-check"></i> <span>تم</span>
                            </button>
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
      `;
    }

    const dotsHTML = slotsToDisplay.map((_, i) => `
      <span class="doc-dot ${i === initialIndex ? 'active' : ''}" data-dot-index="${i}"></span>
    `).join('');

    const navBarHTML = slotsToDisplay.length > 1 ? `
      <div class="doc-stack-nav-bar" id="doc-stack-nav-bar">
        <button type="button" class="doc-stack-nav-btn" id="btn-doc-stack-prev">
          <i class="fa-solid fa-chevron-right"></i> السابق
        </button>
        <div class="doc-stack-dots" id="doc-stack-dots">
          ${dotsHTML}
        </div>
        <button type="button" class="doc-stack-nav-btn" id="btn-doc-stack-next">
          التالي <i class="fa-solid fa-chevron-left"></i>
        </button>
      </div>
    ` : '';

    return {
      html: `
        <div class="doc-schedule-wrapper">
          <div class="doc-schedule-filter-bar">
            <div class="filter-tab-pill ${!isShowingCompleted ? 'active' : ''}" id="btn-doc-appts-active">
              <i class="fa-solid fa-hourglass-half"></i>
              <span>الحالات المتبقية</span>
              <span class="filter-count-badge">${totalUncompletedPatients}</span>
            </div>
            <div class="filter-tab-pill ${isShowingCompleted ? 'active' : ''}" id="btn-doc-appts-completed">
              <i class="fa-solid fa-check-circle"></i>
              <span>الحالات المكتملة</span>
              <span class="filter-count-badge">${totalCompletedPatients}</span>
            </div>
          </div>
          ${slotsToDisplay.length > 1 ? `
            <div class="doc-stack-header-bar" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; padding: 0 4px;">
              <span style="font-size: 0.82rem; font-weight: 800; color: var(--text-main);">
                <i class="fa-solid fa-layer-group text-primary"></i> فترات المواعيد لليوم
              </span>
              <span id="doc-stack-counter" style="font-size: 0.78rem; font-weight: 800; color: var(--primary); background: rgba(2, 132, 199, 0.12); padding: 2px 10px; border-radius: 999px;">
                ${initialIndex + 1} من ${slotsToDisplay.length}
              </span>
            </div>
          ` : ''}
          ${contentHTML}
          ${navBarHTML}
        </div>
      `,
      initialIndex
    };
  }

  initDocStackDeck(initialIndex = 0) {
    initStackDeck({
      containerId: 'doc-stack-container',
      cardSelector: '.doc-stack-card',
      initialIndex: initialIndex || 0,
      prefix: 'doc-stack',
      dotsId: 'doc-stack-dots',
      counterId: 'doc-stack-counter',
      nextBtnId: 'btn-doc-stack-next',
      prevBtnId: 'btn-doc-stack-prev',
      activeOffsetPx: 28
    });
  }

  buildErrorHTML(err) {
    return `<div style="padding: 20px; color: var(--danger); text-align: center;">تعذر تحميل جدول المواعيد: ${escapeHTML(err.message)}</div>`;
  }

  buildWeeklyMasterHTML(doctorsToShow, isDoctorReadOnly = false) {
    const slotsToRender = (this.slots && this.slots.length > 0) ? this.slots : DEFAULT_APPT_SLOTS;
    const workingDays = DAYS_CONFIG;

    return `
      <div style="margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
        <div style="font-size: 0.88rem; font-weight: 800; color: var(--text-main);">
          <i class="fa-solid fa-table-cells text-primary"></i> الجدول الأسبوعي العام (خريطة المواعيد والحصص الدورية لكافة أيام الأسبوع)
        </div>
        <div style="font-size: 0.78rem; color: var(--text-muted);">
          اضغط على أي مريض لفتح خيارات الموعد، أو اضغط زر "+ حجز" لتسكين مريض جديد في نفس الفترة واليوم.
        </div>
      </div>

      <div class="appt-weekly-master-grid">
        <div class="weekly-header-cell" style="background: var(--primary); color: #fff;">
          <i class="fa-regular fa-clock"></i> الفترة
        </div>
        ${workingDays.map(d => `
          <div class="weekly-header-cell">
            <div style="font-size: 0.92rem; font-weight: 800;">${escapeHTML(d.name)}</div>
            <div style="font-size: 0.72rem; opacity: 0.8;">${d.dayIndex === 6 || d.dayIndex === 1 || d.dayIndex === 3 ? 'شفت سبت/إثنين/أربع' : 'شفت أحد/ثلاثاء/خميس'}</div>
          </div>
        `).join('')}

        ${slotsToRender.map(slot => `
          <div class="weekly-slot-time-cell">
            <span style="font-weight: 800; color: var(--primary); font-size: 0.95rem;">${escapeHTML(slot.label)}</span>
            <span style="font-size: 0.7rem; color: var(--text-muted);">${escapeHTML(slot.key)}</span>
          </div>

          ${workingDays.map(day => {
            const cellAppts = (this.appointments || []).filter(a => {
              if (a.status === 'cancelled' || a.status === 'discharged') return false;
              if (a.courseFinished && a.endDate && a.endDate < (this.selectedDate || getLocalDateStr())) return false;
              if (a.timeSlot !== slot.key) return false;
              if (Array.isArray(a.daysOfWeek) && a.daysOfWeek.includes(day.dayIndex)) return true;
              return false;
            });

            const total = cellAppts.length;
            const isFull = total >= MAX_BEDS_PER_SLOT;

            return `
              <div class="weekly-data-cell">
                <div class="weekly-cell-header">
                  <span>${day.short}</span>
                  <span class="badge ${isFull ? 'badge-cash' : 'badge-subtle'}" style="font-size: 0.68rem; padding: 1px 5px;">
                    ${total}/${MAX_BEDS_PER_SLOT}
                  </span>
                </div>
                <div class="weekly-cell-appts" style="display: flex; flex-direction: column; gap: 4px; flex: 1;">
                  ${cellAppts.map(a => {
                    const docObj = (this.doctors || []).find(d => d.uid === a.doctorUid);
                    const cleanDoc = (a.doctorName || docObj?.name || 'طبيب').replace(/^د\.\s*/, '');
                    const docColor = getDoctorColor(a.doctorUid || a.doctorName || 'default');
                    return `
                      <div class="weekly-appt-chip" data-appt-action-id="${escapeHTML(a.id)}" title="المريض: ${escapeHTML(a.patientName)} • الطبيب: د. ${escapeHTML(cleanDoc)}">
                        <span style="width: 7px; height: 7px; border-radius: 50%; background: ${docColor.color}; flex-shrink: 0;"></span>
                        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">${escapeHTML(a.patientName)}</span>
                      </div>
                    `;
                  }).join('')}
                </div>
                ${!isDoctorReadOnly ? `
                  <button type="button" class="btn btn-outline btn-sm btn-add-appt" data-add-slot="${escapeHTML(slot.key)}" data-add-day="${day.dayIndex}" style="font-size: 0.68rem; padding: 2px 4px; border-radius: 5px; border-style: dashed; color: var(--primary); margin-top: auto; cursor: pointer;">
                    <i class="fa-solid fa-plus"></i> حجز
                  </button>
                ` : ''}
              </div>
            `;
          }).join('')}
        `).join('')}
      </div>
    `;
  }

  buildGridHTML(doctorsToShow, isDoctorReadOnly = false) {
    const isFridayHoliday = new Date(this.selectedDate + 'T00:00:00').getDay() === 5;
    if (isFridayHoliday) {
      return `
        <div class="hero-styled-card" style="text-align: center; padding: 48px 20px; margin: 18px 0; border: 2px dashed rgba(56, 189, 248, 0.35); background: var(--bg-surface); border-radius: 18px;">
          <div style="width: 68px; height: 68px; border-radius: 50%; background: rgba(56, 189, 248, 0.12); color: var(--primary); display: inline-flex; align-items: center; justify-content: center; font-size: 2rem; margin-bottom: 16px;">
            <i class="fa-solid fa-mug-hot"></i>
          </div>
          <h3 style="font-weight: 800; font-size: 1.3rem; color: var(--text-main); margin: 0 0 8px 0;">يوم الجمعة عطلة أسبوعية للمركز</h3>
          <p style="font-size: 0.92rem; color: var(--text-muted); max-width: 440px; margin: 0 auto 16px auto; line-height: 1.6;">
            ${CLINIC_CONFIG.shortName || CLINIC_CONFIG.brandName || 'المركز'} مغلق يوم الجمعة، ولا توجد مواعيد أو جلسات علاجية مجدولة في هذا اليوم.
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

    return `
      <div class="appt-timeline-grid-container">
        ${slotsToRender.map((slot) => {
          const currentUser = auth.getCurrentUser();
          const rawSlotAppts = this.getAppointmentsForDate(this.selectedDate).filter(a => a.timeSlot === slot.key);
          const slotAppts = (isDoctorReadOnly && currentUser)
            ? rawSlotAppts.filter(a =>
                (a.doctorUid && (a.doctorUid === currentUser.uid || a.doctorUid === currentUser.id)) ||
                (currentUser.name && a.doctorName && (a.doctorName === currentUser.name || a.doctorName.includes(currentUser.name) || currentUser.name.includes(a.doctorName)))
              )
            : rawSlotAppts;

          const totalActiveInSlot = slotAppts.filter(a => a.effectiveStatus !== 'cancelled').length;
          const isFull = totalActiveInSlot >= MAX_BEDS_PER_SLOT;
          const overCapacity = totalActiveInSlot > MAX_BEDS_PER_SLOT;

          const occupancyBadge = overCapacity
            ? `<span class="badge" style="background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); font-weight: 800;"><i class="fa-solid fa-triangle-exclamation"></i> ممتلئ (${totalActiveInSlot}/${MAX_BEDS_PER_SLOT})</span>`
            : (isFull
              ? `<span class="badge badge-cash" style="font-weight: 800;"><i class="fa-solid fa-bed"></i> مكتمل (${totalActiveInSlot}/${MAX_BEDS_PER_SLOT})</span>`
              : `<span class="badge badge-direct" style="font-weight: 800;"><i class="fa-solid fa-bed"></i> ${totalActiveInSlot} من ${MAX_BEDS_PER_SLOT} أسرة</span>`);

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
                        <div class="appt-slot-doc-name" style="color: ${docColor.color}; font-weight: 800; font-size: 0.82rem; margin-bottom: 5px;">
                          <span style="width: 8px; height: 8px; border-radius: 50%; background: ${docColor.color}; display: inline-block; margin-left: 5px;"></span>
                          د. ${escapeHTML(cleanDoc)}:
                        </div>
                        <div class="appt-doc-chips-list" style="display: flex; flex-wrap: wrap; gap: 6px;">
                          ${cellAppts.map((a) => {
                            let statusBadge = '';
                            if (a.effectiveStatus === 'attended') {
                              statusBadge = `<span class="badge badge-appt-attended" style="font-size: 0.68rem; padding: 1px 6px; border-radius: 4px;"><i class="fa-solid fa-check-double"></i> حضر وسجل جلسة</span>`;
                            } else if (a.effectiveStatus === 'completed') {
                              statusBadge = `<span class="badge badge-appt-completed" style="font-size: 0.68rem; padding: 1px 6px; border-radius: 4px;"><i class="fa-solid fa-check"></i> تم إنهاء الجلسة</span>`;
                            } else if (a.effectiveStatus === 'cancelled') {
                              statusBadge = `<span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #d97706; border: 1px solid rgba(245, 158, 11, 0.35); font-size: 0.68rem; padding: 1px 6px; border-radius: 4px;"><i class="fa-solid fa-user-slash"></i> معتذر اليوم</span>`;
                            } else if (a.effectiveStatus === 'no-show') {
                              statusBadge = `<span class="badge badge-appt-noshow" style="font-size: 0.68rem; padding: 1px 6px; border-radius: 4px;"><i class="fa-solid fa-user-xmark"></i> لم يحضر</span>`;
                            } else {
                              statusBadge = `<span class="badge badge-primary" style="font-size: 0.68rem; padding: 1px 6px; border-radius: 4px;"><i class="fa-regular fa-clock"></i> في الانتظار</span>`;
                            }

                            const daysStr = formatRecurringDays(a.daysOfWeek);

                            return `
                              <div class="appt-chip clickable" data-appt-action-id="${escapeHTML(a.id)}" title="اضغط لعرض خيارات وإجراءات الموعد">
                                <span class="appt-chip-patient">${escapeHTML(a.patientName)}</span>
                                ${daysStr ? `<span class="badge" style="font-size: 0.65rem; background: rgba(2, 132, 199, 0.08); color: #0284c7; padding: 1px 5px; border-radius: 4px;">${escapeHTML(daysStr)}</span>` : ''}
                                ${statusBadge}
                                ${!isDoctorReadOnly ? `
                                <div class="appt-chip-actions">
                                  <button type="button" class="appt-chip-move" data-move-appt="${escapeHTML(a.id)}" title="تعديل الموعد والأيام">
                                    <i class="fa-solid fa-pen-to-square"></i>
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
      const daysStr = formatRecurringDays(a.daysOfWeek);
      subEl.textContent = `${pBilling}${daysStr ? ` • أيام: ${daysStr}` : ''}${pPhone ? ` • هاتف: ${pPhone}` : ''}`;
    }

    if (docEl) docEl.textContent = a.doctorName || docObj?.name || '-';
    if (timeEl) {
      const slotObj = (this.slots || []).find(s => s.key === a.timeSlot);
      timeEl.textContent = slotObj?.label || a.timeSlot || '-';
    }
    if (dateEl) {
      const daysStr = formatRecurringDays(a.daysOfWeek);
      dateEl.textContent = daysStr ? `${daysStr} (${this.selectedDate})` : (a.date || this.selectedDate || '-');
    }
    if (areaEl) {
      let areaText = (a.bodyPart && a.bodyPart !== 'علاج طبيعي عام') ? a.bodyPart : '';
      if (!areaText && patientObj) {
        let partsList = [];
        if (this.app?.patientsManager?.getPatientBodyParts) {
          partsList = this.app.patientsManager.getPatientBodyParts(patientObj) || [];
        }
        if (partsList.length === 0 && Array.isArray(patientObj.bodyParts) && patientObj.bodyParts.length > 0) {
          partsList = patientObj.bodyParts;
        }
        if (partsList.length === 0 && patientObj.affectedArea) {
          partsList = [patientObj.affectedArea];
        }
        if (partsList.length === 0 && patientObj.clinicalSheet?.affectedArea) {
          partsList = [patientObj.clinicalSheet.affectedArea];
        }
        if (partsList.length > 0) {
          areaText = partsList.join(' • ');
        }
      }
      areaEl.textContent = areaText || a.bodyPart || 'علاج طبيعي عام';
    }

    // Determine current effective status for selected date
    const isApologizedToday = Array.isArray(a.cancelledDates) && a.cancelledDates.includes(this.selectedDate);
    const hasSessionToday = (this.sessions || []).some(s =>
      s.patientId === a.patientId &&
      (s.date === this.selectedDate || s.createdAt?.startsWith(this.selectedDate)) &&
      s.status !== 'cancelled'
    );

    if (statusBadgeEl) {
      if (isApologizedToday) {
        statusBadgeEl.className = 'badge';
        statusBadgeEl.style.background = 'rgba(245, 158, 11, 0.15)';
        statusBadgeEl.style.color = '#d97706';
        statusBadgeEl.innerHTML = '<i class="fa-solid fa-user-slash"></i> معتذر عن جلسة اليوم';
      } else if (hasSessionToday) {
        statusBadgeEl.className = 'badge badge-appt-attended';
        statusBadgeEl.innerHTML = '<i class="fa-solid fa-check-double"></i> حضر وأجرى الجلسة اليوم';
      } else if (a.status === 'completed') {
        statusBadgeEl.className = 'badge badge-appt-completed';
        statusBadgeEl.innerHTML = '<i class="fa-solid fa-check"></i> مكتمل';
      } else if (a.status === 'no-show') {
        statusBadgeEl.className = 'badge badge-appt-noshow';
        statusBadgeEl.innerHTML = '<i class="fa-solid fa-user-xmark"></i> لم يحضر';
      } else {
        statusBadgeEl.className = 'badge badge-primary';
        statusBadgeEl.innerHTML = '<i class="fa-regular fa-clock"></i> محجوز (في الانتظار)';
      }
    }

    // Toggle Apologize button label
    const textApologize = document.getElementById('text-appt-sheet-apologize');
    if (textApologize) {
      textApologize.textContent = isApologizedToday ? 'إلغاء الاعتذار وإعادة الموعد لليوم' : 'اعتذار عن جلسة اليوم فقط';
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
        const cleanWa = phone.replace(/[^0-9]/g, '').replace(/^0/, '20');
        waBtn.href = `https://wa.me/${cleanWa}`;
        waBtn.style.display = 'inline-flex';
      } else {
        waBtn.style.display = 'none';
      }
    }

    this.app.openModal('modal-appt-actions');
  }

  async toggleApologyForToday(appt) {
    if (!appt) return;
    const targetDate = this.selectedDate || getLocalDateStr();
    let cancelledDates = Array.isArray(appt.cancelledDates) ? [...appt.cancelledDates] : [];
    const isCurrentlyCancelled = cancelledDates.includes(targetDate);

    if (isCurrentlyCancelled) {
      cancelledDates = cancelledDates.filter(d => d !== targetDate);
    } else {
      cancelledDates.push(targetDate);
    }

    try {
      await db.updateAppointment(appt.id, {
        cancelledDates,
        statusUpdatedAt: new Date().toISOString()
      });
      this.app.closeModal('modal-appt-actions');
      this.app.showToast(isCurrentlyCancelled ? 'تم إلغاء الاعتذار وإعادة الموعد لليوم' : 'تم تسجيل اعتذار المريض عن جلسة اليوم', 'info');
      await this.loadAll(this.selectedDate, true);
      await this.render();
    } catch (e) {
      console.error('Error toggling apology:', e);
      this.app.showAlert('حدث خطأ أثناء حفظ حالة الاعتذار.', 'خطأ', 'danger');
    }
  }

  async handleFinishCourse(appt) {
    if (!appt) return;
    const confirmed = confirm(`هل ترغب في إنهاء الحجز الدوري للمريض (${appt.patientName})؟\nسيتم تفريغ مكانه في جدول المواعيد لكافة الأسابيع القادمة.`);
    if (!confirmed) return;

    try {
      await db.updateAppointment(appt.id, {
        status: 'completed',
        endDate: this.selectedDate || getLocalDateStr(),
        completedAt: new Date().toISOString(),
        completedBy: auth.getCurrentUser()?.name || 'الاستقبال'
      });
      this.app.closeModal('modal-appt-actions');
      this.app.showToast(`تم إنهاء الحجز الدوري للمريض ${appt.patientName} وتفريغ المكان بنجاح`, 'success');
      await this.loadAll(this.selectedDate, true);
      await this.render();
    } catch (e) {
      console.error('Error finishing course:', e);
      this.app.showAlert('حدث خطأ أثناء إنهاء الحجز.', 'خطأ', 'danger');
    }
  }

  async handleCheckinFromAppt(appt) {
    if (!appt) return;
    this.app.closeModal('modal-appt-actions');

    try {
      await db.updateAppointmentStatus(appt.id, 'attended', {
        attendedAt: new Date().toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' })
      });
      appt.status = 'attended';
    } catch (e) {
      console.warn('Update attended status notice:', e);
    }

    this.app.switchView('sessions');

    if (this.app?.sessionsManager?.selectPatient) {
      await this.app.sessionsManager.selectPatient(appt.patientId);

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

  async handleStatusUpdateFromSheet(newStatus) {
    const a = this.selectedApptForAction;
    if (!a) return;
    this.app.closeModal('modal-appt-actions');
    if (newStatus === 'completed') {
      const docUid = a.doctorUid || auth.getCurrentUser()?.uid || '';
      await this.toggleApptCompleted(a.id, docUid, a.patientName);
      return;
    }
    const targetDate = this.selectedDate || getLocalDateStr();
    const isRecurring = Array.isArray(a.daysOfWeek) && a.daysOfWeek.length > 0;
    try {
      if (isRecurring) {
        const dailyStatuses = { ...(a.dailyStatuses || {}) };
        if (newStatus === 'scheduled') {
          delete dailyStatuses[targetDate];
        } else {
          dailyStatuses[targetDate] = newStatus;
        }
        const updates = {
          dailyStatuses,
          statusUpdatedAt: new Date().toISOString()
        };
        if (a.status === 'completed') {
          updates.status = 'scheduled';
          a.status = 'scheduled';
        }
        await db.updateAppointment(a.id, updates);
        a.dailyStatuses = dailyStatuses;

        if (a.doctorUid) {
          const completedApptIds = this.getCompletedAppts(a.doctorUid);
          let updated;
          if (newStatus === 'completed') {
            updated = completedApptIds.includes(a.id) ? completedApptIds : [...completedApptIds, a.id];
          } else {
            updated = completedApptIds.filter(id => id !== a.id);
          }
          try {
            localStorage.setItem(`ascpt_completed_appts_${a.doctorUid}_${targetDate}`, JSON.stringify(updated));
          } catch (_) {}
        }
      } else {
        await db.updateAppointmentStatus(a.id, newStatus);
        a.status = newStatus;
      }
      const statusLabels = {
        completed: 'تم إنهاء الجلسة لليوم',
        'no-show': 'تم تسجيل عدم الحضور (No-Show)',
        scheduled: 'تمت إعادة الحالة إلى مجدول'
      };
      this.app.showToast(statusLabels[newStatus] || 'تم تحديث حالة الموعد', 'info');
      await this.render();
    } catch (err) {
      this.app.showAlert('تعذر تحديث الحالة: ' + err.message, 'خطأ', 'danger');
    }
  }

  handleGridClick(e) {
    const currentUser = auth.getCurrentUser();
    if (currentUser && currentUser.role === 'doctor') {
      return;
    }
    const editSlotTrigger = e.target.closest('[data-edit-slot]');
    if (editSlotTrigger) {
      const slotKey = editSlotTrigger.getAttribute('data-edit-slot');
      const slotLabel = editSlotTrigger.getAttribute('data-slot-label');
      this.openEditSlotModal(slotKey, slotLabel);
      return;
    }

    const removeBtn = e.target.closest('[data-remove-appt]');
    if (removeBtn) {
      e.stopPropagation();
      this.deleteAppointment(removeBtn.getAttribute('data-remove-appt'));
      return;
    }

    const moveBtn = e.target.closest('[data-move-appt]');
    if (moveBtn) {
      e.stopPropagation();
      this.openMoveModal(moveBtn.getAttribute('data-move-appt'));
      return;
    }

    const copyBtn = e.target.closest('[data-copy-appt]');
    if (copyBtn) {
      e.stopPropagation();
      this.openMoveModal(copyBtn.getAttribute('data-copy-appt'));
      return;
    }

    const apptActionTrigger = e.target.closest('[data-appt-action-id]');
    if (apptActionTrigger) {
      const apptId = apptActionTrigger.getAttribute('data-appt-action-id');
      if (apptId) {
        this.openApptActionSheet(apptId);
        return;
      }
    }

    const addBtn = e.target.closest('.btn-add-appt');
    if (addBtn) {
      const dayAttr = addBtn.getAttribute('data-add-day');
      const dayIndex = dayAttr !== null ? parseInt(dayAttr, 10) : null;
      this.openAddModal(
        addBtn.getAttribute('data-add-doctor'),
        addBtn.getAttribute('data-add-doctor-name'),
        addBtn.getAttribute('data-add-slot'),
        dayIndex
      );
    }
  }

  // ================= Add Appointment Modal =================
  openAddModal(doctorUid, doctorName, timeSlot, dayIndex = null) {
    if (new Date(this.selectedDate + 'T00:00:00').getDay() === 5 && !dayIndex) {
      this.app.showAlert('يوم الجمعة عطلة رسمية بالمركز، لا يمكن حجز مواعيد في هذا اليوم.', 'عطلة أسبوعية', 'warning');
      return;
    }
    this.pendingDoctorUid = doctorUid || null;
    this.pendingDoctorName = doctorName || null;
    this.pendingTimeSlot = timeSlot || (this.slots && this.slots[0] ? this.slots[0].key : '15:30');
    this.selectedPatientId = null;
    this.selectedPatientName = null;

    const titleEl = document.getElementById('appt-modal-title');
    if (titleEl) {
      titleEl.innerHTML = `<i class="fa-solid fa-calendar-plus text-primary"></i> تثبيت حجز موعد دوري للمريض`;
    }

    // Populate Doctor Dropdown
    const docSelect = document.getElementById('appt-doctor-select');
    if (docSelect) {
      docSelect.innerHTML = `<option value="">-- اضغط لاختيار الطبيب المعالج --</option>` + (this.doctors || []).map((d) => {
        const clean = (d.name || '').replace(/^د\.\s*/, '');
        const isSel = (doctorUid && d.uid === doctorUid) ? 'selected' : '';
        const shiftLabel = getShiftLabel(d.shift || 'sat_mon_wed');
        return `<option value="${escapeHTML(d.uid)}" ${isSel}>د. ${escapeHTML(clean)} (شفت: ${escapeHTML(shiftLabel)})</option>`;
      }).join('');

      docSelect.value = doctorUid || (this.doctors[0] ? this.doctors[0].uid : '');
      this.pendingDoctorUid = docSelect.value;
      const matchedDoc = (this.doctors || []).find(d => d.uid === this.pendingDoctorUid);
      this.pendingDoctorName = matchedDoc ? matchedDoc.name : '';

      if (this.app?.updateCustomSelectDisplay) {
        this.app.updateCustomSelectDisplay('appt-doctor-select');
      }

      // Auto preset matching days based on doctor shift
      if (matchedDoc?.shift === 'sun_tue_thu') {
        this.setNewApptDays([0, 2, 4], 'sun_tue_thu');
      } else {
        this.setNewApptDays([6, 1, 3], 'sat_mon_wed');
      }

      docSelect.onchange = (e) => {
        this.pendingDoctorUid = e.target.value;
        const d = (this.doctors || []).find(x => x.uid === e.target.value);
        this.pendingDoctorName = d ? d.name : '';
        if (d?.shift === 'sun_tue_thu') {
          this.setNewApptDays([0, 2, 4], 'sun_tue_thu');
        } else {
          this.setNewApptDays([6, 1, 3], 'sat_mon_wed');
        }
        this.updateApptPreviewText();
      };
    }

    // Populate Slot Dropdown
    const slotSelect = document.getElementById('appt-slot-select');
    if (slotSelect) {
      const slotsToUse = (this.slots && this.slots.length > 0) ? this.slots : DEFAULT_APPT_SLOTS;
      slotSelect.innerHTML = slotsToUse.map(s => `
        <option value="${escapeHTML(s.key)}" ${s.key === this.pendingTimeSlot ? 'selected' : ''}>
          ${escapeHTML(s.label)} (${escapeHTML(s.key)})
        </option>
      `).join('');
      slotSelect.value = this.pendingTimeSlot;
      if (this.app?.updateCustomSelectDisplay) {
        this.app.updateCustomSelectDisplay('appt-slot-select');
      }
    }

    if (dayIndex !== null) {
      if (dayIndex === 6 || dayIndex === 1 || dayIndex === 3) {
        this.setNewApptDays([6, 1, 3], 'sat_mon_wed');
      } else if (dayIndex === 0 || dayIndex === 2 || dayIndex === 4) {
        this.setNewApptDays([0, 2, 4], 'sun_tue_thu');
      } else {
        this.setNewApptDays([dayIndex], null);
      }
    }

    const bodyPartInput = document.getElementById('appt-body-part');
    if (bodyPartInput) bodyPartInput.value = '';
    const trigger = document.getElementById('appt-patient-picker-trigger');
    if (trigger) trigger.querySelector('.btn-text').textContent = '-- اضغط للبحث واختيار المريض --';

    this.updateApptPreviewText();
    this.app.openModal('modal-appointment');
  }

  async openPatientPicker() {
    const searchInput = document.getElementById('appt-picker-search-input');
    if (searchInput) searchInput.value = '';
    await this.renderPickerPatients();
    this.app.openModal('modal-appt-patient-picker');
    setTimeout(() => {
      if (searchInput) searchInput.focus();
    }, 150);
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
        <div class="picker-item" data-patient-id="${escapeHTML(p.id)}" style="display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border-bottom: 1px solid var(--border-color); cursor: pointer;">
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

    const bodyPartInput = document.getElementById('appt-body-part');
    if (bodyPartInput && !bodyPartInput.value) {
      if (patient.bodyParts && patient.bodyParts.length > 0) {
        bodyPartInput.value = patient.bodyParts.join(' • ');
      } else if (patient.affectedArea) {
        bodyPartInput.value = patient.affectedArea;
      }
    }

    this.app.closeModal('modal-appt-patient-picker');
    this.updateApptPreviewText();
  }

  async submitAppointment() {
    const docSelect = document.getElementById('appt-doctor-select');
    const chosenUid = docSelect ? docSelect.value : this.pendingDoctorUid;
    const docObj = (this.doctors || []).find((d) => d.uid === chosenUid);
    const chosenName = docObj ? docObj.name : (this.pendingDoctorName || 'طبيب المركز');

    const slotSelect = document.getElementById('appt-slot-select');
    const chosenSlot = slotSelect ? slotSelect.value : this.pendingTimeSlot;

    if (!chosenUid) {
      this.app.showAlert('من فضلك اختر الطبيب المعالج.', 'بيانات ناقصة', 'warning');
      return;
    }

    if (!this.selectedPatientId) {
      this.app.showAlert('من فضلك اختر المريض من السجل.', 'بيانات ناقصة', 'warning');
      return;
    }

    if (!Array.isArray(this.selectedDaysForNewAppt) || this.selectedDaysForNewAppt.length === 0) {
      this.app.showAlert('من فضلك اختر يوماً واحداً على الأقل لأيام الحضور الأسبوعية.', 'بيانات ناقصة', 'warning');
      return;
    }

    try {
      const bodyPartVal = document.getElementById('appt-body-part')?.value.trim() || '';
      const daysPattern = this.getPatternFromDays(this.selectedDaysForNewAppt);
      const daysText = formatRecurringDays(this.selectedDaysForNewAppt);

      await db.addAppointment({
        doctorUid: chosenUid,
        doctorName: chosenName,
        timeSlot: chosenSlot,
        daysOfWeek: [...this.selectedDaysForNewAppt],
        daysPattern,
        startDate: this.selectedDate || getLocalDateStr(),
        patientId: this.selectedPatientId,
        patientName: this.selectedPatientName,
        bodyPart: bodyPartVal,
        status: 'scheduled',
        cancelledDates: [],
        createdBy: auth.getCurrentUser()?.name || 'الاستقبال'
      });

      this.app.closeModal('modal-appointment');
      this.app.showToast(`تم تثبيت الموعد الدوري أسبوعياً (${daysText}) بنجاح`, 'success');

      if (chosenUid && window.app?.notificationsManager) {
        try {
          window.app.notificationsManager.sendNotification({
            type: 'appointment_booked',
            title: `حجز موعد جديد: ${this.selectedPatientName}`,
            body: `موعد دوري أسبوعياً (${daysText}) مع د. ${chosenName}`,
            target: { doctorUid: chosenUid, role: 'doctor' },
            data: { screen: 'appointments', date: this.selectedDate || getLocalDateStr() }
          });
        } catch (notifErr) {
          console.warn('Appointment notification notice:', notifErr);
        }
      }
      await this.loadAll(this.selectedDate, true);
      await this.render();
      if (this.app?.patientsManager?.renderPatients) {
        this.app.patientsManager.renderPatients();
      }
    } catch (err) {
      console.error('Submit appointment error:', err);
      this.app.showAlert('تعذر حفظ الموعد: ' + err.message, 'خطأ', 'danger');
    }
  }

  async deleteAppointment(apptId) {
    const appt = (this.appointments || []).find((a) => a.id === apptId);
    const pName = appt ? appt.patientName : 'المريض';
    const confirmed = confirm(`هل أنت متأكد من حذف موعد ${pName} نهائياً؟`);
    if (!confirmed) return;

    try {
      await db.deleteAppointment(apptId);
      this.app.showToast(`تم حذف موعد ${pName} بنجاح`);
      await this.loadAll(this.selectedDate, true);
      await this.render();
      const currentUser = auth.getCurrentUser();
      if (currentUser && currentUser.role === 'doctor') {
        const uid = currentUser.uid || currentUser.id;
        if (uid) await this.renderForDoctor(uid);
      }
      if (this.app?.patientsManager?.renderPatients) {
        this.app.patientsManager.renderPatients();
      }
    } catch (err) {
      console.error('Delete appointment error:', err);
      this.app.showAlert('تعذر حذف الموعد: ' + err.message, 'خطأ', 'danger');
    }
  }

  // ================= Move / Edit Recurring Appointment Modal =================
  openMoveModal(apptId) {
    const appt = this.appointments.find((a) => a.id === apptId);
    if (!appt) return;

    this.movingAppt = appt;
    const nameEl = document.getElementById('move-appt-patient-name');
    if (nameEl) nameEl.textContent = appt.patientName;

    const currentSlotObj = (this.slots || []).find((s) => s.key === appt.timeSlot);
    const slotLabel = currentSlotObj ? currentSlotObj.label : appt.timeSlot;
    const daysStr = formatRecurringDays(appt.daysOfWeek);
    const infoEl = document.getElementById('move-appt-current-info');
    if (infoEl) {
      infoEl.textContent = `الموعد الحالي: د. ${appt.doctorName || '-'} — الساعة ${slotLabel}${daysStr ? ` (${daysStr})` : ''}`;
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

    // Set days for moving appt
    if (Array.isArray(appt.daysOfWeek) && appt.daysOfWeek.length > 0) {
      this.setMoveApptDays(appt.daysOfWeek);
    } else {
      this.setMoveApptDays([6, 1, 3]);
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

    if (!Array.isArray(this.selectedDaysForMoveAppt) || this.selectedDaysForMoveAppt.length === 0) {
      this.app.showAlert('يجب اختيار يوم واحد على الأقل للموعد الدوري.', 'بيانات ناقصة', 'warning');
      return;
    }

    const daysPattern = this.getPatternFromDays(this.selectedDaysForMoveAppt);
    const daysText = formatRecurringDays(this.selectedDaysForMoveAppt);

    try {
      await db.updateAppointment(apptId, {
        doctorUid: targetDoctorUid,
        doctorName: targetDoctorName,
        timeSlot: targetSlotKey,
        daysOfWeek: [...this.selectedDaysForMoveAppt],
        daysPattern,
        updatedAt: new Date().toISOString()
      });
      this.app.closeModal('modal-move-appointment');
      this.app.showToast(`تم تعديل موعد ${this.movingAppt.patientName} (${daysText} - ${targetSlotLabel}) بنجاح`);
      this.movingAppt = null;
      await this.refreshVisibleGrids();
    } catch (err) {
      this.app.showAlert('تعذر تعديل الموعد: ' + err.message, 'خطأ', 'danger');
    }
  }


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

  openEditSlotModal(slotKey, _slotLabel) {
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

}
