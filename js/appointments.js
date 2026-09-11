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
      const currentUser = auth.getCurrentUser();
      const isDoctor = currentUser && currentUser.role === 'doctor';
      grid.innerHTML = this.buildGridHTML(this.doctors, isDoctor);
    } catch (err) {
      console.error('Appointments render error:', err);
      grid.innerHTML = this.buildErrorHTML(err);
    }
  }

  // ================= Doctor's Own Schedule (Stacked Cards Deck) =================
  async renderForDoctor(doctorUid) {
    const grid = document.getElementById('my-appointments-grid');
    if (!grid) return;
    try {
      await this.loadAll();
      grid.innerHTML = this.buildDoctorStackedScheduleHTML(doctorUid);
      this.initDocStackDeck();
    } catch (err) {
      console.error('Appointments (doctor) render error:', err);
      grid.innerHTML = this.buildErrorHTML(err);
    }
  }

  buildDoctorStackedScheduleHTML(doctorUid) {
    const slotsToRender = (this.slots && this.slots.length > 0) ? this.slots : DEFAULT_APPT_SLOTS;

    // Filter only slots where THIS doctor has booked appointments
    const activeSlots = slotsToRender.map((slot) => {
      const cellAppts = this.getCellAppointments(doctorUid, slot.key);
      if (cellAppts.length === 0) return null;
      return { slot, cellAppts };
    }).filter(Boolean);

    // If no appointments at all for this doctor:
    if (activeSlots.length === 0) {
      return `
        <div class="hero-styled-card doc-empty-schedule-card" style="text-align: center; padding: 36px 20px; margin: 4px 0;">
          <div style="width: 54px; height: 54px; border-radius: 50%; background: rgba(2, 132, 199, 0.12); color: var(--primary); display: inline-flex; align-items: center; justify-content: center; font-size: 1.4rem; margin-bottom: 12px;">
            <i class="fa-solid fa-mug-hot"></i>
          </div>
          <div style="font-weight: 800; font-size: 1.05rem; color: var(--text-main);">لا توجد مواعيد محجوزة لك اليوم</div>
          <div style="font-size: 0.82rem; color: var(--text-muted); margin-top: 5px;">ستظهر مواعيدك وحالاتك هنا فور قيام الاستقبال بالحجز لك.</div>
        </div>
      `;
    }

    const totalPatients = activeSlots.reduce((acc, curr) => acc + curr.cellAppts.length, 0);

    return `
      <div class="doc-stack-wrapper">
        <div class="doc-stack-header-bar">
          <span style="font-size: 0.86rem; font-weight: 800; color: var(--text-main);">
            <i class="fa-solid fa-layer-group" style="color: var(--primary); margin-left: 5px;"></i> ${activeSlots.length} مواعيد (${totalPatients} حالات)
          </span>
          <div style="display: flex; align-items: center; gap: 8px;">
            ${activeSlots.length > 1 ? `
            <span id="doc-stack-counter" style="font-size: 0.78rem; font-weight: 800; color: var(--primary); background: rgba(2, 132, 199, 0.12); padding: 2px 10px; border-radius: 999px;">1 من ${activeSlots.length}</span>
            <button type="button" class="btn btn-outline btn-sm" id="btn-toggle-doc-stack-layout" style="font-size: 0.75rem; padding: 3px 9px; border-radius: 8px; height: 28px;" title="تبديل بين التراكم والقائمة">
              <i class="fa-solid fa-list" id="icon-stack-toggle"></i>
            </button>
            ` : ''}
          </div>
        </div>

        <!-- The 3D Overlapping Stack Deck -->
        <div class="doc-stack-container" id="doc-stack-container">
          ${activeSlots.map(({ slot, cellAppts }, index) => {
            const countLabel = cellAppts.length === 1 ? 'حالة واحدة' : (cellAppts.length === 2 ? 'حالتان' : `${cellAppts.length} حالات`);

            return `
              <div class="hero-styled-card doc-stack-card ${index === 0 ? 'is-active-card' : 'is-peeking-card'}" data-stack-index="${index}">
                <div class="doc-card-header">
                  <div class="doc-card-time-badge">
                    <i class="fa-regular fa-clock" style="color: var(--primary); font-size: 1.15rem;"></i>
                    <span style="font-weight: 800; font-size: 1.05rem; color: var(--text-main);">${escapeHTML(slot.label)}</span>
                  </div>
                  <div style="display: flex; align-items: center; gap: 6px;">
                    <span class="badge badge-primary" style="font-size: 0.78rem; padding: 4px 10px; border-radius: 999px; font-weight: 800;">${countLabel}</span>
                    <i class="fa-solid fa-chevron-down doc-card-peek-indicator" style="font-size: 0.75rem; color: var(--text-muted);"></i>
                  </div>
                </div>

                <div class="hsc-divider" style="margin: 12px 0 14px 0;"></div>

                <div class="doc-card-patients-list">
                  ${cellAppts.map((a, pIdx) => {
                    const patientObj = (this.patients || []).find(p => p.id === a.patientId);
                    const phone = patientObj?.phone || '';
                    const billing = patientObj?.billing || '';
                    let billingBadge = '';
                    if (billing === 'cash') {
                      billingBadge = '<span class="badge badge-cash" style="font-size: 0.7rem; padding: 2px 7px;">نقدي</span>';
                    } else if (billing === 'insurance') {
                      const comp = patientObj?.insuranceCompany || 'تأمين';
                      billingBadge = `<span class="badge badge-direct" style="font-size: 0.7rem; padding: 2px 7px;">${escapeHTML(comp)}</span>`;
                    }

                    return `
                      <div class="doc-patient-item">
                        <div class="doc-patient-avatar">
                          <i class="fa-solid fa-user"></i>
                        </div>
                        <div class="doc-patient-info">
                          <div class="doc-patient-name">${escapeHTML(a.patientName)}</div>
                          ${phone ? `<div class="doc-patient-phone"><i class="fa-solid fa-phone" style="font-size: 0.7rem;"></i> ${escapeHTML(phone)}</div>` : ''}
                        </div>
                        <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
                          ${billingBadge}
                          <span class="doc-patient-order">#${pIdx + 1}</span>
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
        ${activeSlots.length > 1 ? `
        <div class="doc-stack-nav-bar" id="doc-stack-nav-bar">
          <button type="button" class="doc-stack-nav-btn" id="btn-doc-stack-prev">
            <i class="fa-solid fa-chevron-right"></i> السابق
          </button>

          <div class="doc-stack-dots" id="doc-stack-dots">
            ${activeSlots.map((_, i) => `
              <span class="doc-dot ${i === 0 ? 'active' : ''}" data-dot-index="${i}"></span>
            `).join('')}
          </div>

          <button type="button" class="doc-stack-nav-btn" id="btn-doc-stack-next">
            التالي <i class="fa-solid fa-chevron-left"></i>
          </button>
        </div>
        ` : ''}
      </div>
    `;
  }

  initDocStackDeck() {
    const container = document.getElementById('doc-stack-container');
    if (!container) return;
    const cards = Array.from(container.querySelectorAll('.doc-stack-card'));
    if (!cards.length) return;

    this.currentDocStackIndex = 0;
    this.isDocStackListMode = false;

    let cachedHeight = 170;
    const measureHeight = () => {
      const activeCard = cards[this.currentDocStackIndex] || cards[0];
      if (activeCard && activeCard.offsetHeight > 50) {
        cachedHeight = activeCard.offsetHeight;
      }
    };

    const updatePositions = (newIndex = 0) => {
      if (this.isDocStackListMode) return;
      this.currentDocStackIndex = Math.max(0, Math.min(newIndex, cards.length - 1));

      // Batch height update once without layout thrashing inside the loop
      const peekExtra = cards.length > 2 ? 64 : (cards.length === 2 ? 36 : 10);
      container.style.minHeight = `${cachedHeight + peekExtra}px`;

      for (let idx = 0; idx < cards.length; idx++) {
        const card = cards[idx];
        const diff = idx - this.currentDocStackIndex;

        if (diff === 0) {
          card.style.transform = 'translate3d(0, 0, 0) scale(1)';
          card.style.zIndex = '12';
          card.style.opacity = '1';
          card.style.pointerEvents = 'auto';
          card.classList.add('is-active-card');
          card.classList.remove('is-peeking-card', 'is-passed-card');
        } else if (diff === 1) {
          card.style.transform = 'translate3d(0, 28px, 0) scale(0.96)';
          card.style.zIndex = '10';
          card.style.opacity = '0.90';
          card.style.pointerEvents = 'auto';
          card.classList.add('is-peeking-card');
          card.classList.remove('is-active-card', 'is-passed-card');
        } else if (diff === 2) {
          card.style.transform = 'translate3d(0, 52px, 0) scale(0.92)';
          card.style.zIndex = '8';
          card.style.opacity = '0.72';
          card.style.pointerEvents = 'auto';
          card.classList.add('is-peeking-card');
          card.classList.remove('is-active-card', 'is-passed-card');
        } else if (diff > 2) {
          card.style.transform = 'translate3d(0, 68px, 0) scale(0.88)';
          card.style.zIndex = '6';
          card.style.opacity = '0';
          card.style.pointerEvents = 'none';
          card.classList.remove('is-active-card', 'is-peeking-card');
        } else {
          card.style.transform = 'translate3d(0, -50px, 0) scale(0.92)';
          card.style.zIndex = '4';
          card.style.opacity = '0';
          card.style.pointerEvents = 'none';
          card.classList.add('is-passed-card');
          card.classList.remove('is-active-card', 'is-peeking-card');
        }
      }

      // Update dots & counter
      const dots = document.querySelectorAll('#doc-stack-dots .doc-dot');
      dots.forEach((d, i) => {
        if (i === this.currentDocStackIndex) d.classList.add('active');
        else d.classList.remove('active');
      });

      const counterEl = document.getElementById('doc-stack-counter');
      if (counterEl) {
        counterEl.textContent = `${this.currentDocStackIndex + 1} من ${cards.length}`;
      }
    };

    // Card tap to bring to front
    cards.forEach((card, idx) => {
      card.addEventListener('click', (e) => {
        if (this.isDocStackListMode) return;
        if (idx !== this.currentDocStackIndex) {
          e.stopPropagation();
          updatePositions(idx);
        }
      });
    });

    // Navigation buttons
    document.getElementById('btn-doc-stack-next')?.addEventListener('click', () => {
      updatePositions(this.currentDocStackIndex + 1);
    });

    document.getElementById('btn-doc-stack-prev')?.addEventListener('click', () => {
      updatePositions(this.currentDocStackIndex - 1);
    });

    // Dots click
    document.getElementById('doc-stack-dots')?.addEventListener('click', (e) => {
      const dot = e.target.closest('.doc-dot');
      if (!dot) return;
      const idx = parseInt(dot.getAttribute('data-dot-index'), 10);
      updatePositions(idx);
    });

    // Touch Swipe on container
    let touchStartY = 0;
    let touchStartX = 0;
    container.addEventListener('touchstart', (e) => {
      if (this.isDocStackListMode) return;
      touchStartY = e.touches[0].clientY;
      touchStartX = e.touches[0].clientX;
    }, { passive: true });

    container.addEventListener('touchend', (e) => {
      if (this.isDocStackListMode) return;
      const deltaY = e.changedTouches[0].clientY - touchStartY;
      const deltaX = e.changedTouches[0].clientX - touchStartX;

      if (Math.abs(deltaY) > Math.abs(deltaX)) {
        // Vertical swipe
        if (deltaY < -40) updatePositions(this.currentDocStackIndex + 1);
        else if (deltaY > 40) updatePositions(this.currentDocStackIndex - 1);
      } else {
        // Horizontal swipe (RTL: deltaX > 40 is next, deltaX < -40 is prev)
        if (deltaX > 40) updatePositions(this.currentDocStackIndex + 1);
        else if (deltaX < -40) updatePositions(this.currentDocStackIndex - 1);
      }
    }, { passive: true });

    // Toggle Stack vs List Mode
    document.getElementById('btn-toggle-doc-stack-layout')?.addEventListener('click', () => {
      this.isDocStackListMode = !this.isDocStackListMode;
      const icon = document.getElementById('icon-stack-toggle');
      if (this.isDocStackListMode) {
        container.classList.add('is-list-layout');
        if (icon) icon.className = 'fa-solid fa-layer-group';
        cards.forEach((card) => {
          card.style.transform = '';
          card.style.opacity = '1';
          card.style.zIndex = '';
          card.style.pointerEvents = 'auto';
        });
        container.style.minHeight = 'auto';
      } else {
        container.classList.remove('is-list-layout');
        if (icon) icon.className = 'fa-solid fa-list';
        updatePositions(this.currentDocStackIndex);
      }
    });

    // Initial positioning
    setTimeout(() => updatePositions(0), 40);
  }

  buildErrorHTML(err) {
    return `<div style="padding: 20px; text-align: center; color: var(--danger);">
      <i class="fa-solid fa-triangle-exclamation"></i> تعذر تحميل جدول المواعيد.<br>
      <span style="font-size: 0.8rem; color: var(--text-muted);">${escapeHTML(err.message || 'خطأ غير معروف')}</span>
    </div>`;
  }

  buildGridHTML(doctorsToShow, isDoctorReadOnly = false) {
    if (!doctorsToShow || doctorsToShow.length === 0) {
      return `<div style="padding: 20px; text-align: center; color: var(--text-muted);">لا يوجد دكاترة مسجلين حالياً في طاقم العمل.</div>`;
    }

    const doctorsHeader = doctorsToShow.map((doc) => {
      const cleanDoc = (doc.name || '').replace(/^د\.\s*/, '');
      return `<th style="text-align:center; min-width: 150px;"><i class="fa-solid fa-user-doctor" style="color: var(--primary);"></i> د. ${escapeHTML(cleanDoc)}</th>`;
    }).join('');

    const slotsToRender = (this.slots && this.slots.length > 0) ? this.slots : DEFAULT_APPT_SLOTS;

    // 1. Desktop Matrix Table
    const desktopRows = slotsToRender.map((slot) => {
      const totalInSlot = this.getSlotTotalCount(slot.key);
      const overCapacity = totalInSlot > MAX_BEDS_PER_SLOT;

      const cells = doctorsToShow.map((doc) => {
        const cellAppts = this.getCellAppointments(doc.uid, slot.key);
        const chips = cellAppts.map((a) => `
          <div class="appt-chip" data-appt-id="${escapeHTML(a.id)}">
            <span class="appt-chip-patient" ${!isDoctorReadOnly ? `data-move-appt="${escapeHTML(a.id)}"` : ''} title="${!isDoctorReadOnly ? 'اضغط لنقل الموعد أو تعديله' : ''}">${escapeHTML(a.patientName)}</span>
            ${!isDoctorReadOnly ? `
            <div class="appt-chip-actions">
              <button type="button" class="appt-chip-move" data-move-appt="${escapeHTML(a.id)}" title="نقل الموعد لطبيب أو ساعة أخرى">
                <i class="fa-solid fa-arrow-right-arrow-left"></i>
              </button>
              <button type="button" class="appt-chip-remove" data-remove-appt="${escapeHTML(a.id)}" title="حذف">&times;</button>
            </div>` : ''}
          </div>
        `).join('');

        return `
          <td class="appt-cell ${overCapacity ? 'appt-cell-over' : ''}">
            ${chips}
            ${!isDoctorReadOnly ? `
            <button type="button" class="btn-add-appt" data-add-doctor="${escapeHTML(doc.uid)}" data-add-doctor-name="${escapeHTML(doc.name)}" data-add-slot="${escapeHTML(slot.key)}">
              <i class="fa-solid fa-plus"></i> حجز
            </button>` : ''}
          </td>
        `;
      }).join('');

      return `<tr>
        <td class="appt-time-label">
          <div class="appt-time-box" ${!isDoctorReadOnly ? `data-edit-slot="${escapeHTML(slot.key)}" data-slot-label="${escapeHTML(slot.label)}"` : 'style="cursor: default;"'} title="${!isDoctorReadOnly ? 'اضغط لتعديل وقت هذا الموعد' : ''}">
            <span class="appt-time-text">${escapeHTML(slot.label)}</span>
            ${!isDoctorReadOnly ? '<i class="fa-solid fa-pen-to-square appt-time-edit-icon"></i>' : ''}
          </div>
          ${overCapacity ? `<div class="appt-over-badge" title="عدد الحالات تجاوز عدد الأسرة"><i class="fa-solid fa-triangle-exclamation"></i> ${totalInSlot}/${MAX_BEDS_PER_SLOT}</div>` : ''}
        </td>
        ${cells}
      </tr>`;
    }).join('');

    const desktopHTML = `
      <div class="desktop-only-table">
        <table class="data-table appt-table">
          <thead><tr><th style="min-width: 100px; text-align: center;"><i class="fa-regular fa-clock" style="color: var(--primary);"></i> الميعاد</th>${doctorsHeader}</tr></thead>
          <tbody>${desktopRows}</tbody>
        </table>
      </div>
    `;

    // 2. Mobile Timeline Slot Cards
    const mobileTimelineHTML = `
      <div class="mobile-only-cards-container appt-timeline-container">
        ${slotsToRender.map((slot) => {
          const totalInSlot = this.getSlotTotalCount(slot.key);
          const isFull = totalInSlot >= MAX_BEDS_PER_SLOT;
          const overCapacity = totalInSlot > MAX_BEDS_PER_SLOT;

          const occupancyBadge = overCapacity
            ? `<span class="badge" style="background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4);"><i class="fa-solid fa-triangle-exclamation"></i> ممتلئ (${totalInSlot}/${MAX_BEDS_PER_SLOT})</span>`
            : (isFull
              ? `<span class="badge badge-cash"><i class="fa-solid fa-bed"></i> مكتمل (${totalInSlot}/${MAX_BEDS_PER_SLOT})</span>`
              : `<span class="badge badge-direct"><i class="fa-solid fa-bed"></i> ${totalInSlot} من ${MAX_BEDS_PER_SLOT} أسرة</span>`);

          // Only list doctors who actually have appointments in this slot
          const activeDocAppts = doctorsToShow.map((doc) => {
            const cellAppts = this.getCellAppointments(doc.uid, slot.key);
            if (cellAppts.length === 0) return null;
            const cleanDoc = (doc.name || '').replace(/^د\.\s*/, '');
            return { doc, cleanDoc, cellAppts };
          }).filter(Boolean);

          const isSingleDoc = doctorsToShow.length === 1;

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
                    ${activeDocAppts.map(({ cleanDoc, cellAppts }) => `
                      <div class="appt-active-doc-group">
                        ${!isSingleDoc ? `<div class="appt-slot-doc-name"><i class="fa-solid fa-user-doctor"></i> د. ${escapeHTML(cleanDoc)}:</div>` : ''}
                        ${cellAppts.map((a) => `
                          <div class="appt-chip" data-appt-id="${escapeHTML(a.id)}">
                            <span class="appt-chip-patient" ${!isDoctorReadOnly ? `data-move-appt="${escapeHTML(a.id)}"` : ''} title="${!isDoctorReadOnly ? 'اضغط لنقل الموعد' : ''}">${escapeHTML(a.patientName)}</span>
                            ${!isDoctorReadOnly ? `
                            <div class="appt-chip-actions">
                              <button type="button" class="appt-chip-move" data-move-appt="${escapeHTML(a.id)}" title="نقل الموعد">
                                <i class="fa-solid fa-arrow-right-arrow-left"></i>
                              </button>
                              <button type="button" class="appt-chip-remove" data-remove-appt="${escapeHTML(a.id)}" title="حذف">&times;</button>
                            </div>` : ''}
                          </div>
                        `).join('')}
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
                <!-- Single Compact Booking Button (Receptionist & Admin only) -->
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

    return desktopHTML + mobileTimelineHTML;
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
    const docSelect = document.getElementById('appt-doctor-select');
    if (docSelect) {
      docSelect.innerHTML = (this.doctors || []).map((d) => {
        const clean = (d.name || '').replace(/^د\.\s*/, '');
        const isSel = (doctorUid && d.uid === doctorUid) ? 'selected' : '';
        return `<option value="${escapeHTML(d.uid)}" ${isSel}>د. ${escapeHTML(clean)}</option>`;
      }).join('');

      if (!doctorUid && this.doctors && this.doctors.length > 0) {
        docSelect.value = this.doctors[0].uid;
        this.pendingDoctorUid = this.doctors[0].uid;
        this.pendingDoctorName = this.doctors[0].name;
      }
      if (this.app?.updateCustomSelectDisplay) {
        this.app.updateCustomSelectDisplay('appt-doctor-select');
      }
    }

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
      await db.addAppointment({
        doctorUid: chosenUid,
        doctorName: chosenName,
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
