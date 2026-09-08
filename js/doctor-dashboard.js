import { escapeHTML, getLocalDateStr } from './utils.js';
// ========================================================
// ASCPT - Doctor Personal Clinical Dashboard
// ========================================================

import { db } from './db.js';
import { auth } from './auth.js';

export class DoctorDashboardManager {
  constructor(app) {
    this.app = app;
    this.currentFilter = 'today'; // 'today' | 'month' | 'lifetime'
  }

  setFilter(filterType) {
    this.currentFilter = filterType;

    // Update active button state
    ['today', 'month', 'lifetime'].forEach(t => {
      const btn = document.getElementById(`btn-doc-filter-${t}`);
      if (btn) btn.classList.toggle('active', t === filterType);
    });

    const titles = {
      today: 'جلسات مرضاك اليوم',
      month: 'حالات وجلسات هذا الشهر',
      lifetime: 'سجل جميع مرضاك (Lifetime)'
    };
    const titleEl = document.getElementById('doc-table-title');
    if (titleEl) titleEl.textContent = titles[filterType] || 'جلسات مرضاك';

    this.renderTable();
  }

  async render() {
    const user = auth.getCurrentUser();
    if (!user || user.role !== 'doctor') return;

    const docName = user.name;
    const subEl = document.getElementById('doctor-dashboard-sub');
    if (subEl) {
      subEl.innerHTML = `مرحباً بك يا <strong>${escapeHTML(docName)}</strong> • متابعة حالاتك الطبية وجلساتك السريرية`;
    }

    const allSessions = await db.getSessions();
    const allPatients = await db.getPatients();

    const docUid = user.uid || user.id;

    if (this.app?.appointmentsManager) {
      this.app.appointmentsManager.renderForDoctor(docUid).catch((e) => console.warn('appointments schedule notice:', e));
    }

    // Filter sessions matching this doctor by UID exclusively (with fallback for legacy records)
    this.docSessions = allSessions.filter(s => {
      if (s.doctorUid) return s.doctorUid === docUid;
      return s.doctor && (s.doctor.includes(docName) || docName.includes(s.doctor));
    });

    // Filter patients assigned to this doctor by UID exclusively (with fallback for legacy records)
    this.docPatients = allPatients.filter(p => {
      if (p.doctorUid) return p.doctorUid === docUid;
      return p.doctor && (p.doctor.includes(docName) || docName.includes(p.doctor));
    });

    const todayStr = getLocalDateStr();
    const currentMonth = todayStr.substring(0, 7);

    // 1. Today's sessions for this doctor
    const todaySessions = this.docSessions.filter(s => s.date === todayStr);
    const todayCountEl = document.getElementById('stat-doc-today-count');
    if (todayCountEl) {
      const todayCredited = todaySessions.reduce((acc, s) => {
        if (s.entryType === 'examination') return acc + 1;
        return acc + (s.bodyPartsCount || 1);
      }, 0);
      todayCountEl.textContent = `${todaySessions.length} مريض - ${todayCredited} جلسة`;
    }

    // 2. This month's sessions
    const monthSessions = this.docSessions.filter(s => s.date && s.date.startsWith(currentMonth));
    const monthCountEl = document.getElementById('stat-doc-month-count');
    if (monthCountEl) {
      const monthCredited = monthSessions.reduce((acc, s) => {
        if (s.entryType === 'examination') return acc + 1;
        return acc + (s.bodyPartsCount || 1);
      }, 0);
      monthCountEl.textContent = `${monthSessions.length} مريض - ${monthCredited} جلسة`;
    }

    // 3. Lifetime patients treated by this doctor
    const treatedPatientIds = new Set(this.docSessions.map(s => s.patientId));
    this.docPatients.forEach(p => treatedPatientIds.add(p.id));
    const lifetimeCountEl = document.getElementById('stat-doc-lifetime-count');
    if (lifetimeCountEl) {
      lifetimeCountEl.textContent = `${treatedPatientIds.size} مريض`;
    }

    // 4. Case breakdown (Cash vs Insurance) for this doctor
    let cashCount = 0;
    let insCount = 0;
    monthSessions.forEach(s => {
      if (s.payType === 'cash') cashCount++;
      else insCount++;
    });
    const ratioEl = document.getElementById('stat-doc-types-ratio');
    if (ratioEl) {
      ratioEl.textContent = `${cashCount} نقدي • ${insCount} تأمين`;
    }

    // 5. Estimated doctor dues this month
    const compEl = document.getElementById('stat-doc-month-comp');
    if (compEl) {
      try {
        const doctorRates = await db.getDoctorRates();
        const currentDocName = (this.currentUser?.name || '').trim().replace(/\s+/g, ' ');
        const myRate = doctorRates[currentDocName] || null;

        if (myRate) {
          let myComp = 0;
          if (myRate.type === 'percentage') {
            const docRev = monthSessions.reduce((sum, s) => sum + (parseFloat(s.amountPaid) || 0), 0);
            myComp = Math.round(docRev * (parseFloat(myRate.value) / 100));
            compEl.textContent = `${myComp.toLocaleString('en-US')} ج.م`;
          } else if (myRate.type === 'fixed') {
            const monthCredited = monthSessions.reduce((acc, s) => acc + (s.entryType === 'examination' ? 1 : (s.bodyPartsCount || 1)), 0);
            myComp = Math.round(monthCredited * (parseFloat(myRate.value) || 0));
            compEl.textContent = `${myComp.toLocaleString('en-US')} ج.م`;
          }
        } else {
          compEl.textContent = 'غير محدد';
        }
      } catch (_) {
        compEl.textContent = '-';
      }
    }

    this.renderTable();
  }

  renderTable() {
    const tbody = document.getElementById('doctor-personal-tbody');
    if (!tbody) return;

    const todayStr = getLocalDateStr();
    const currentMonth = todayStr.substring(0, 7);

    let displayList = [];

    if (this.currentFilter === 'today') {
      displayList = this.docSessions.filter(s => s.date === todayStr);
    } else if (this.currentFilter === 'month') {
      displayList = this.docSessions.filter(s => s.date && (s.date.startsWith(currentMonth) || s.date.startsWith('2026-08')));
    } else {
      // Lifetime: all sessions for this doctor (or latest 50)
      displayList = [...this.docSessions];
    }

    if (displayList.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 24px;">
            <i class="fa-solid fa-folder-open" style="font-size: 1.5rem; margin-bottom: 8px; display: block; color: #cbd5e1;"></i>
            لا توجد جلسات مسجلة لك في هذا النطاق.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = displayList.map(s => {
      // 3-Color Badge System
      let billingBadge = '';
      if (s.payType === 'cash') {
        billingBadge = `<span class="badge badge-cash"><i class="fa-solid fa-money-bill"></i> نقدي</span>`;
      } else if (s.contractType === 'direct') {
        billingBadge = `<span class="badge badge-direct"><i class="fa-solid fa-file-contract"></i> ${escapeHTML(s.insuranceName || 'شركة')} (مباشر)</span>`;
      } else {
        billingBadge = `<span class="badge badge-indirect"><i class="fa-solid fa-handshake"></i> ${escapeHTML(s.insuranceName || 'شركة')} (غير مباشر)</span>`;
      }

      const isExam = (s.entryType === 'examination');
      let partsDisplay = '';
      if (isExam) {
        partsDisplay = `<span class="badge" style="background: #f8fafc; color: #0284c7; border: 1px solid #bae6fd; font-weight: 800; font-size: 0.76rem; padding: 3px 8px;"><i class="fa-solid fa-stethoscope"></i> فحص سريري / كشف</span>`;
      } else {
        const parts = Array.isArray(s.bodyParts) ? s.bodyParts.join('، ') : (s.bodyParts || '-');
        partsDisplay = escapeHTML(parts);
      }

      const timeDisplay = s.recordedAt || '';
      const dateDisplay = s.date || '';
      const safePatientId = escapeHTML(s.patientId || '');

      return `
        <tr>
          <td style="font-weight: 800; color: #0f172a; cursor: pointer;" onclick="patientsManager.openPatientSheet('${safePatientId}')" title="اضغط لفتح الشيت الطبي">
            <i class="fa-solid fa-user-injured" style="color: var(--primary); margin-left: 6px;"></i>
            ${escapeHTML(s.patientName)}
          </td>
          <td>${billingBadge}</td>
          <td style="font-size: 0.85rem; color: #334155;">${partsDisplay}</td>
          <td style="font-size: 0.85rem; color: var(--text-muted); white-space: nowrap;">
            <bdi dir="ltr">${escapeHTML(dateDisplay)}</bdi> ${timeDisplay ? `• ${escapeHTML(timeDisplay)}` : ''}
          </td>
          <td style="font-size: 0.82rem; color: var(--text-muted); max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            ${escapeHTML(s.notes || '-')}
          </td>
          <td style="text-align: center;">
            <button type="button" class="btn btn-primary btn-sm" onclick="patientsManager.openPatientSheet('${safePatientId}')" style="padding: 4px 10px; font-weight: 700; white-space: nowrap;">
              <i class="fa-solid fa-file-waveform"></i> الشيت الطبي
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }
}
