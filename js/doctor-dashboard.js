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
    this._sessionsSubscribed = false;
    this._isRendering = false;
  }

  init() {
    ['today', 'month', 'lifetime'].forEach(t => {
      document.getElementById(`btn-doc-filter-${t}`)?.addEventListener('click', () => {
        this.setFilter(t);
      });
    });
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
      lifetime: 'سجل جميع مرضاك'
    };
    const titleEl = document.getElementById('doc-table-title');
    if (titleEl) titleEl.textContent = titles[filterType] || 'جلسات مرضاك';

    this.renderTable();
  }

  async render() {
    if (this._isRendering) return;
    this._isRendering = true;
    try {
      const user = auth.getCurrentUser();
      if (!user || user.role !== 'doctor') return;

    const docName = user.name;
    const subEl = document.getElementById('doctor-dashboard-sub');
    if (subEl) {
      subEl.innerHTML = `مرحباً بك يا <strong>${escapeHTML(docName)}</strong> • متابعة حالاتك الطبية وجلساتك السريرية`;
    }

    const todayStr = getLocalDateStr();
    const currentMonth = todayStr.substring(0, 7);

    // Real-time listener for today's activity on doctor dashboard (Instant sync when reception adds sessions)
    if (db.subscribeToTodaySessions && !this._sessionsSubscribed) {
      this._sessionsSubscribed = true;
      db.subscribeToTodaySessions(todayStr, async () => {
        // Re-render doctor metrics and table automatically when a new session is recorded
        await this.render();
      });
    }

    // Scoped query: fetch only current month's sessions (Zero-Cost Scoped)
    const allSessions = await db.getSessions(currentMonth);
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

    // 1. Today's sessions for this doctor
    const todaySessions = this.docSessions.filter(s => s.date === todayStr);
    const todayCredited = todaySessions.reduce((acc, s) => {
      if (s.entryType === 'examination') return acc + 1;
      return acc + (s.bodyPartsCount || 1);
    }, 0);

    const todayNumEl = document.getElementById('stat-doc-today-num');
    const todaySubEl = document.getElementById('stat-doc-today-sub');
    if (todayNumEl) todayNumEl.textContent = todayCredited;
    if (todaySubEl) {
      todaySubEl.textContent = todaySessions.length > 0 ? `من ${todaySessions.length} زيارة مريض` : 'لا توجد زيارات اليوم';
    }
    const todayCountEl = document.getElementById('stat-doc-today-count');
    if (todayCountEl) todayCountEl.textContent = `${todaySessions.length} زيارة • ${todayCredited} جلسة`;

    // 2. This month's sessions
    const monthSessions = this.docSessions.filter(s => s.date && s.date.startsWith(currentMonth));
    const monthCredited = monthSessions.reduce((acc, s) => {
      if (s.entryType === 'examination') return acc + 1;
      return acc + (s.bodyPartsCount || 1);
    }, 0);

    const monthNumEl = document.getElementById('stat-doc-month-num');
    const monthSubEl = document.getElementById('stat-doc-month-sub');
    if (monthNumEl) monthNumEl.textContent = monthCredited;
    if (monthSubEl) {
      monthSubEl.textContent = monthSessions.length > 0 ? `من ${monthSessions.length} زيارة مريض` : 'لا توجد جلسات هذا الشهر';
    }
    const monthCountEl = document.getElementById('stat-doc-month-count');
    if (monthCountEl) monthCountEl.textContent = `${monthSessions.length} زيارة • ${monthCredited} جلسة`;

    // 3. Lifetime patients treated by this doctor
    const treatedPatientIds = new Set(this.docSessions.map(s => s.patientId));
    this.docPatients.forEach(p => treatedPatientIds.add(p.id));

    const patientsNumEl = document.getElementById('stat-doc-patients-num');
    const patientsSubEl = document.getElementById('stat-doc-patients-sub');
    if (patientsNumEl) patientsNumEl.textContent = treatedPatientIds.size;
    if (patientsSubEl) patientsSubEl.textContent = 'ملفات مسجلة باسمك';

    const lifetimeCountEl = document.getElementById('stat-doc-lifetime-count');
    if (lifetimeCountEl) lifetimeCountEl.textContent = `${treatedPatientIds.size} مريض`;

    // 4. Case breakdown (Cash vs Insurance) for this doctor
    let cashCount = 0;
    let insCount = 0;
    monthSessions.forEach(s => {
      if (s.payType === 'cash') cashCount++;
      else insCount++;
    });

    const cashValEl = document.getElementById('stat-doc-cash-val');
    const insValEl = document.getElementById('stat-doc-ins-val');
    if (cashValEl) cashValEl.textContent = cashCount;
    if (insValEl) insValEl.textContent = insCount;

    const ratioEl = document.getElementById('stat-doc-types-ratio');
    if (ratioEl) ratioEl.textContent = `${cashCount} نقدي • ${insCount} تأمين`;

    // 5. Monthly Earnings Calculation (KPI Card 5 - Cumulative for this month)
    const docList = await db.getDoctorsList();
    const docInfo = docList.find(d => d.uid === docUid || (d.name && user.name && d.name.trim() === user.name.trim())) || user;
    const isSenior = (docInfo.seniorityLevel === 'senior' || user.seniorityLevel === 'senior');
    const regRate = typeof docInfo.regularSessionRate === 'number' ? docInfo.regularSessionRate : 0;
    const scolRate = typeof docInfo.scoliosisRate === 'number' ? docInfo.scoliosisRate : 0;
    const hemiRate = typeof docInfo.hemiplegiaRate === 'number' ? docInfo.hemiplegiaRate : 0;
    const pedRate = typeof docInfo.pediatricRate === 'number' ? docInfo.pediatricRate : 0;
    const specRate = typeof docInfo.specialSessionRate === 'number' ? docInfo.specialSessionRate : 0;

    let monthRegularCount = 0;
    let monthScoliosisCount = 0;
    let monthHemiplegiaCount = 0;
    let monthPediatricCount = 0;
    let monthOtherCount = 0;

    monthSessions.forEach(s => {
      if (s.entryType === 'examination') return;
      const count = s.bodyPartsCount || 1;
      const pType = s.sessionPricingType || s.programType || (s.isSpecial ? 'special' : 'regular');
      if (pType === 'scoliosis') {
        monthScoliosisCount += count;
      } else if (pType === 'hemiplegia') {
        monthHemiplegiaCount += count;
      } else if (pType === 'pediatric') {
        monthPediatricCount += count;
      } else if (pType === 'special' || pType === 'custom_special') {
        monthOtherCount += count;
      } else {
        monthRegularCount += count;
      }
    });

    const monthRegularDues = monthRegularCount * regRate;
    const monthScoliosisDues = monthScoliosisCount * scolRate;
    const monthHemiplegiaDues = monthHemiplegiaCount * hemiRate;
    const monthPediatricDues = monthPediatricCount * pedRate;
    const monthOtherDues = monthOtherCount * specRate;

    const totalMonthEarnings = monthRegularDues + monthScoliosisDues + monthHemiplegiaDues + monthPediatricDues + monthOtherDues;

    const earningsTotalEl = document.getElementById('stat-doc-earnings-total');
    const earningsRegEl = document.getElementById('stat-doc-earnings-regular');
    const earningsSpecEl = document.getElementById('stat-doc-earnings-special');
    const formulaHintEl = document.getElementById('stat-doc-earnings-formula-hint');

    if (earningsTotalEl) {
      earningsTotalEl.textContent = `${totalMonthEarnings.toLocaleString('en-US')} ج.م`;
    }
    if (earningsRegEl) {
      earningsRegEl.textContent = `عادية: ${monthRegularCount} (${monthRegularDues} ج.م) • Scoliosis: ${monthScoliosisCount} (${monthScoliosisDues} ج.م)`;
    }
    if (earningsSpecEl) {
      earningsSpecEl.textContent = `Hemiplegia: ${monthHemiplegiaCount} (${monthHemiplegiaDues} ج.م) • أطفال: ${monthPediatricCount} (${monthPediatricDues} ج.م)`;
    }
    if (formulaHintEl) {
      const activeRates = [];
      if (regRate > 0) activeRates.push(`عادية: ${regRate} ج.م`);
      if (scolRate > 0) activeRates.push(`Scoliosis: ${scolRate} ج.م`);
      if (hemiRate > 0) activeRates.push(`Hemiplegia: ${hemiRate} ج.م`);
      if (pedRate > 0) activeRates.push(`أطفال: ${pedRate} ج.م`);

      if (activeRates.length > 0) {
        formulaHintEl.innerHTML = `أجر الجلسات: ` + activeRates.join(' • ');
      } else {
        formulaHintEl.innerHTML = `<span style="color: var(--text-muted);"><i class="fa-solid fa-circle-info"></i> لم يتم تحديد أسعار الجلسات بعد من قِبل إدارة المركز</span>`;
      }
    }

    this.renderTable();
    } finally {
      this._isRendering = false;
    }
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
      displayList = this.docSessions.filter(s => s.date && s.date.startsWith(currentMonth));
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
      const mobCont = document.getElementById('doctor-personal-mobile-cards');
      if (mobCont) {
        mobCont.innerHTML = `
          <div class="empty-state-card" style="text-align: center; padding: 28px 20px; color: var(--text-muted); background: var(--bg-surface); border-radius: 14px; border: 1.5px dashed var(--border-color);">
            <i class="fa-solid fa-folder-open" style="font-size: 1.8rem; margin-bottom: 8px; display: block; color: #cbd5e1;"></i>
            لا توجد جلسات مسجلة لك في هذا النطاق.
          </div>
        `;
      }
      return;
    }

    const mobileContainer = document.getElementById('doctor-personal-mobile-cards');

    // 1. Render Desktop Table
    tbody.innerHTML = displayList.map(s => {
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
        partsDisplay = `<span class="badge" style="background: var(--bg-subtle); color: var(--primary); border: 1px solid var(--border-color); font-weight: 800; font-size: 0.76rem; padding: 3px 8px;"><i class="fa-solid fa-stethoscope"></i> فحص سريري / كشف (1 جلسة)</span>`;
      } else {
        const parts = Array.isArray(s.bodyParts) ? s.bodyParts.join('، ') : (s.bodyParts || '-');
        const unitCount = s.bodyPartsCount || 1;
        const unitWord = unitCount === 1 ? 'جلسة' : unitCount === 2 ? 'جلستان' : 'جلسات';
        partsDisplay = `<span class="badge" style="background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; font-weight: 800; font-size: 0.76rem; padding: 2px 6px; margin-left: 6px;">${unitCount} ${unitWord}</span> ${escapeHTML(parts)}`;
      }

      const timeDisplay = s.recordedAt || '';
      const dateDisplay = s.date || '';
      const safePatientId = escapeHTML(s.patientId || '');
      const pType = s.sessionPricingType || s.programType || (s.isSpecial ? 'special' : 'regular');
      let progTag = '';
      if (pType === 'scoliosis') {
        progTag = `<span class="badge" style="background:rgba(2, 132, 199, 0.15); color:#0284c7; border:1px solid rgba(2, 132, 199, 0.35); font-size:0.7rem; font-weight:800;"><i class="fa-solid fa-arrows-split-up-and-left"></i> Scoliosis</span>`;
      } else if (pType === 'hemiplegia') {
        progTag = `<span class="badge" style="background:rgba(245, 158, 11, 0.15); color:#b45309; border:1px solid rgba(245, 158, 11, 0.35); font-size:0.7rem; font-weight:800;"><i class="fa-solid fa-brain"></i> Hemiplegia</span>`;
      } else if (pType === 'pediatric') {
        progTag = `<span class="badge" style="background:rgba(236, 72, 153, 0.15); color:#be185d; border:1px solid rgba(236, 72, 153, 0.35); font-size:0.7rem; font-weight:800;"><i class="fa-solid fa-child"></i> أطفال</span>`;
      }

      return `
        <tr>
          <td style="font-weight: 800; color: var(--text-main); cursor: pointer;" onclick="patientsManager.openPatientSheet('${safePatientId}')" title="اضغط لفتح الشيت الطبي">
            <i class="fa-solid fa-user-injured" style="color: var(--primary); margin-left: 6px;"></i>
            ${escapeHTML(s.patientName)} ${progTag}
          </td>
          <td>${billingBadge}</td>
          <td style="font-size: 0.85rem; color: var(--text-muted);">${partsDisplay}</td>
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

    // 2. Render Handcrafted Mobile Cards
    if (mobileContainer) {
      mobileContainer.innerHTML = displayList.map(s => {
        let billingBadge = '';
        if (s.payType === 'cash') {
          billingBadge = `<span class="badge badge-cash"><i class="fa-solid fa-money-bill"></i> نقدي</span>`;
        } else if (s.contractType === 'direct') {
          billingBadge = `<span class="badge badge-direct"><i class="fa-solid fa-file-contract"></i> ${escapeHTML(s.insuranceName || 'شركة')}</span>`;
        } else {
          billingBadge = `<span class="badge badge-indirect"><i class="fa-solid fa-handshake"></i> ${escapeHTML(s.insuranceName || 'شركة')}</span>`;
        }

        const isExam = (s.entryType === 'examination');
        const safePatientId = escapeHTML(s.patientId || '');
        const safeName = escapeHTML(s.patientName || '');
        const timeDisplay = s.recordedAt || '';
        const safeParts = Array.isArray(s.bodyParts) ? s.bodyParts.join('، ') : (s.bodyParts || '');
        const unitCount = s.bodyPartsCount || 1;
        const unitWord = unitCount === 1 ? 'جلسة' : unitCount === 2 ? 'جلستان' : 'جلسات';

        return `
          <div class="hero-styled-card">
            <div class="hsc-top">
              <div class="hsc-patient-meta">
                <div class="hsc-avatar"><i class="fa-solid fa-user-injured"></i></div>
                <div class="hsc-name-box">
                  <span class="hsc-patient-name" style="cursor: pointer;" onclick="patientsManager.openPatientSheet('${safePatientId}')">${safeName}</span>
                  <span class="hsc-doc-sub"><i class="fa-solid fa-calendar-day"></i> ${s.date || ''}</span>
                </div>
              </div>
              <div class="hsc-amount-box">
                ${isExam 
                  ? `<span class="badge badge-exam-tag"><i class="fa-solid fa-stethoscope"></i> كشف</span>`
                  : `<span class="badge badge-primary" style="font-weight: 800; font-size: 0.76rem;"><i class="fa-solid fa-heart-pulse"></i> ${unitCount} ${unitWord}</span>`
                }
              </div>
            </div>

            <div class="hsc-badges-row">
              ${billingBadge}
            </div>

            <div class="hsc-divider" style="margin: 10px 0 12px 0;"></div>

            <div class="hsc-bottom">
              <div class="hsc-tags">
                ${safeParts ? `<span class="hsc-tag-pill"><i class="fa-solid fa-bone"></i> ${safeParts}</span>` : ''}
                ${timeDisplay ? `<span class="hsc-time-tag"><i class="fa-regular fa-clock"></i> ${timeDisplay}</span>` : ''}
              </div>
              <div class="hsc-actions">
                <button type="button" class="btn btn-primary btn-sm btn-hero-sheet" onclick="patientsManager.openPatientSheet('${safePatientId}')" title="فتح الشيت الطبي">
                  <i class="fa-solid fa-file-waveform"></i> الشيت الطبي
                </button>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }
  }
}
