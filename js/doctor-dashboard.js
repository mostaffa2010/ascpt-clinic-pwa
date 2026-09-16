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
    this._hasLoadedOnce = false;
  }

  init() {
    ['today', 'month', 'lifetime', 'home-visits'].forEach((t) => {
      document.getElementById(`btn-doc-filter-${t}`)?.addEventListener('click', () => {
        this.setFilter(t);
      });
    });
  }

  setFilter(filterType) {
    this.currentFilter = filterType;

    // Update active button state
    ['today', 'month', 'lifetime', 'home-visits'].forEach((t) => {
      const btn = document.getElementById(`btn-doc-filter-${t}`);
      if (btn) btn.classList.toggle('active', t === filterType);
    });

    const titles = {
      today: 'جلسات مرضاك اليوم بالمركز',
      month: 'حالات وجلسات هذا الشهر بالمركز',
      lifetime: 'سجل جميع مرضاك بالمركز',
      'home-visits': 'بيان الزيارات المنزلية قيد التسوية مع المركز'
    };
    const titleEl = document.getElementById('doc-table-title');
    if (titleEl) titleEl.textContent = titles[filterType] || 'جلسات مرضاك';

    this.renderTable();
  }

  renderSkeleton() {
    const mobileCards = document.getElementById('doctor-personal-mobile-cards');
    const tbody = document.getElementById('doctor-personal-tbody');
    const myApptsGrid = document.getElementById('my-appointments-grid');

    if (mobileCards && (!this.docSessions || this.docSessions.length === 0)) {
      mobileCards.innerHTML = Array.from({ length: 3 }).map(() => `
        <div class="hero-styled-card skeleton-card" style="padding: 12px 14px; margin-bottom: 10px; border-radius: 14px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <div class="skeleton-shimmer skeleton-avatar" style="width: 36px; height: 36px;"></div>
              <div style="display: flex; flex-direction: column; gap: 5px;">
                <div class="skeleton-shimmer skeleton-line" style="width: 130px; height: 16px;"></div>
                <div class="skeleton-shimmer skeleton-line" style="width: 80px; height: 12px;"></div>
              </div>
            </div>
            <div class="skeleton-shimmer skeleton-badge" style="width: 65px;"></div>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; padding-top: 8px; border-top: 1px dashed var(--border-color, #e2e8f0);">
            <div class="skeleton-shimmer skeleton-line" style="width: 100px; height: 12px;"></div>
            <div class="skeleton-shimmer skeleton-line" style="width: 45px; height: 12px;"></div>
          </div>
        </div>
      `).join('');
    }

    if (tbody && (!this.docSessions || this.docSessions.length === 0)) {
      tbody.innerHTML = Array.from({ length: 3 }).map(() => `
        <tr>
          <td colspan="7" style="padding: 12px;">
            <div style="display: flex; align-items: center; gap: 12px;">
              <div class="skeleton-shimmer skeleton-avatar" style="width: 32px; height: 32px;"></div>
              <div class="skeleton-shimmer skeleton-line" style="width: 25%; height: 14px;"></div>
              <div class="skeleton-shimmer skeleton-line" style="width: 15%; height: 14px;"></div>
              <div class="skeleton-shimmer skeleton-line" style="width: 20%; height: 14px;"></div>
              <div class="skeleton-shimmer skeleton-line" style="width: 15%; height: 14px;"></div>
            </div>
          </td>
        </tr>
      `).join('');
    }

    if (myApptsGrid && myApptsGrid.children.length === 0) {
      myApptsGrid.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 10px; padding: 10px 0;">
          <div class="skeleton-shimmer" style="height: 48px; border-radius: var(--radius-sm, 10px);"></div>
          <div class="skeleton-shimmer" style="height: 48px; border-radius: var(--radius-sm, 10px);"></div>
        </div>
      `;
    }
  }

  async render() {
    if (this._isRendering) return;
    this._isRendering = true;
    try {
      const user = auth.getCurrentUser();
      if (!user || user.role !== 'doctor') return;

      if (!this._hasLoadedOnce && !this.docSessions) {
        this.renderSkeleton();
      }

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

    // Scoped query: fetch current month's sessions and all home visits (Zero-Cost Scoped)
    // Always force-refresh doctor list to ensure newly configured rates from admin reflect immediately
    const docList = await db.getDoctorsList(true);
    const allSessions = await db.getSessions(currentMonth);
    const allHomeVisits = (typeof db.getHomeVisits === 'function')
      ? await db.getHomeVisits()
      : [];
    const allPatients = await db.getPatients();

    const docUid = user.uid || user.id;

    if (this.app?.appointmentsManager) {
      this.app.appointmentsManager.renderForDoctor(docUid).catch((e) => console.warn('appointments schedule notice:', e));
    }

    const isDocMatch = (s) => {
      if (s.doctorUid && docUid && s.doctorUid === docUid) return true;
      if (s.doctor && docName && (s.doctor.trim() === docName || s.doctor.includes(docName) || docName.includes(s.doctor))) return true;
      return false;
    };

    // Filter monthly sessions matching this doctor
    const monthDocSessions = allSessions.filter(isDocMatch);
    const docHomeVisits = allHomeVisits.filter(isDocMatch);

    // Merge monthly sessions and home visits without duplicates
    const mergedSessions = [...monthDocSessions];
    const existingIds = new Set(monthDocSessions.map(s => s.id));
    docHomeVisits.forEach(s => {
      if (!existingIds.has(s.id)) {
        mergedSessions.push(s);
        existingIds.add(s.id);
      }
    });
    this.docSessions = mergedSessions;

    // Filter patients assigned to this doctor by UID exclusively (with fallback for legacy records)
    this.docPatients = allPatients.filter(p => {
      if (p.doctorUid) return p.doctorUid === docUid;
      return p.doctor && (p.doctor.includes(docName) || docName.includes(p.doctor));
    });

    // 1. Today's sessions for this doctor
    const todaySessions = this.docSessions.filter((s) => s.date === todayStr && !s.isHomeVisit && s.visitType !== 'home');
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
    const monthSessions = this.docSessions.filter((s) => s.date && s.date.startsWith(currentMonth) && !s.isHomeVisit && s.visitType !== 'home');
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

    // 4. Active Patients under care for this doctor (Replaced Cash vs Insurance with Active Caseload in v2.2.3)
    const activePatients = (this.docPatients || []).filter(p => {
      if (p.status === 'discharged' || p.status === 'completed' || p.status === 'inactive') return false;
      return true;
    });

    let activeGeneralCount = 0;
    let activeSpecializedCount = 0;

    activePatients.forEach(p => {
      const prog = (p.programType || p.clinicalSheet?.programType || '').toLowerCase();
      if (prog === 'scoliosis' || prog === 'hemiplegia' || prog === 'quadriplegia' || prog === 'pediatric') {
        activeSpecializedCount++;
      } else {
        activeGeneralCount++;
      }
    });

    const activeNumEl = document.getElementById('stat-doc-active-num');
    const activeBreakdownEl = document.getElementById('stat-doc-active-breakdown');
    if (activeNumEl) {
      activeNumEl.textContent = activePatients.length;
    }
    if (activeBreakdownEl) {
      if (activePatients.length > 0) {
        activeBreakdownEl.innerHTML = `${activeGeneralCount} عام • ${activeSpecializedCount} تخصصي`;
      } else {
        activeBreakdownEl.textContent = 'لا توجد حالات نشطة حالياً';
      }
    }

    // Backward compatibility for legacy cash/ins values
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
    const docInfo = (Array.isArray(docList) ? docList : await db.getDoctorsList(true)).find(d => d.uid === docUid || (d.name && user.name && d.name.trim() === user.name.trim())) || user;
    const regRate = typeof docInfo.regularSessionRate === 'number' ? docInfo.regularSessionRate : 0;
    const scolRate = typeof docInfo.scoliosisRate === 'number' ? docInfo.scoliosisRate : 0;
    const hemiRate = typeof docInfo.hemiplegiaRate === 'number' ? docInfo.hemiplegiaRate : 0;
    const quadRate = typeof docInfo.quadriplegiaRate === 'number' ? docInfo.quadriplegiaRate : (typeof docInfo.pediatricRate === 'number' ? docInfo.pediatricRate : 0);
    const specRate = typeof docInfo.specialSessionRate === 'number' ? docInfo.specialSessionRate : 0;

    let monthRegularCount = 0;
    let monthScoliosisCount = 0;
    let monthHemiplegiaCount = 0;
    let monthQuadriplegiaCount = 0;
    let monthOtherCount = 0;

    monthSessions.forEach((s) => {
      if (s.entryType === 'examination') return;
      if (s.isHomeVisit || s.visitType === 'home') return;
      if (s.isPreSettled || (s.date && s.date < '2026-09-01')) return;
      const count = s.bodyPartsCount || 1;
      const pType = s.sessionPricingType || s.programType || (s.isSpecial ? 'special' : 'regular');
      if (pType === 'scoliosis') {
        monthScoliosisCount += count;
      } else if (pType === 'hemiplegia') {
        monthHemiplegiaCount += count;
      } else if (pType === 'quadriplegia' || pType === 'pediatric') {
        monthQuadriplegiaCount += count;
      } else if (pType === 'special' || pType === 'custom_special') {
        monthOtherCount += count;
      } else {
        monthRegularCount += count;
      }
    });

    const monthRegularDues = monthRegularCount * regRate;
    const monthScoliosisDues = monthScoliosisCount * scolRate;
    const monthHemiplegiaDues = monthHemiplegiaCount * hemiRate;
    const monthQuadriplegiaDues = monthQuadriplegiaCount * quadRate;
    const monthOtherDues = monthOtherCount * specRate;

    const totalMonthEarnings = monthRegularDues + monthScoliosisDues + monthHemiplegiaDues + monthQuadriplegiaDues + monthOtherDues;

    const totalMonthSessions = monthRegularCount + monthScoliosisCount + monthHemiplegiaCount + monthQuadriplegiaCount + monthOtherCount;

    const earningsTotalEl = document.getElementById('stat-doc-earnings-total');
    const monthTotalSessionsEl = document.getElementById('stat-doc-month-total-sessions');
    const programsContainer = document.getElementById('stat-doc-programs-container');
    const formulaHintEl = document.getElementById('stat-doc-earnings-formula-hint');

    if (earningsTotalEl) {
      earningsTotalEl.textContent = `${totalMonthEarnings.toLocaleString('en-US')} ج.م`;
    }

    if (monthTotalSessionsEl) {
      monthTotalSessionsEl.innerHTML = `<i class="fa-solid fa-clipboard-check text-primary"></i> <span>إجمالي: <strong>${totalMonthSessions}</strong> جلسة منجزة هذا الشهر</span>`;
    }

    if (programsContainer) {
      const activePrograms = [];

      if (monthRegularCount > 0) {
        activePrograms.push(`
          <div class="doc-prog-chip chip-regular">
            <span class="doc-prog-icon"><i class="fa-solid fa-bone"></i></span>
            <span class="doc-prog-name">علاج طبيعي عام:</span>
            <strong class="doc-prog-count">${monthRegularCount} جلسة</strong>
            ${monthRegularDues > 0 ? `<span class="doc-prog-dues">(${monthRegularDues.toLocaleString('en-US')} ج.م)</span>` : ''}
          </div>
        `);
      }

      if (monthScoliosisCount > 0) {
        activePrograms.push(`
          <div class="doc-prog-chip chip-scoliosis">
            <span class="doc-prog-icon"><i class="fa-solid fa-arrows-split-up-and-left"></i></span>
            <span class="doc-prog-name">Scoliosis:</span>
            <strong class="doc-prog-count">${monthScoliosisCount} جلسة</strong>
            ${monthScoliosisDues > 0 ? `<span class="doc-prog-dues">(${monthScoliosisDues.toLocaleString('en-US')} ج.م)</span>` : ''}
          </div>
        `);
      }

      if (monthHemiplegiaCount > 0) {
        activePrograms.push(`
          <div class="doc-prog-chip chip-hemiplegia">
            <span class="doc-prog-icon"><i class="fa-solid fa-brain"></i></span>
            <span class="doc-prog-name">Hemiplegia:</span>
            <strong class="doc-prog-count">${monthHemiplegiaCount} جلسة</strong>
            ${monthHemiplegiaDues > 0 ? `<span class="doc-prog-dues">(${monthHemiplegiaDues.toLocaleString('en-US')} ج.م)</span>` : ''}
          </div>
        `);
      }

      if (monthQuadriplegiaCount > 0) {
        activePrograms.push(`
          <div class="doc-prog-chip chip-quadriplegia">
            <span class="doc-prog-icon"><i class="fa-solid fa-wheelchair"></i></span>
            <span class="doc-prog-name">Quadriplegia:</span>
            <strong class="doc-prog-count">${monthQuadriplegiaCount} جلسة</strong>
            ${monthQuadriplegiaDues > 0 ? `<span class="doc-prog-dues">(${monthQuadriplegiaDues.toLocaleString('en-US')} ج.م)</span>` : ''}
          </div>
        `);
      }

      if (monthOtherCount > 0) {
        activePrograms.push(`
          <div class="doc-prog-chip chip-other">
            <span class="doc-prog-icon"><i class="fa-solid fa-notes-medical"></i></span>
            <span class="doc-prog-name">برامج أخرى:</span>
            <strong class="doc-prog-count">${monthOtherCount} جلسة</strong>
            ${monthOtherDues > 0 ? `<span class="doc-prog-dues">(${monthOtherDues.toLocaleString('en-US')} ج.م)</span>` : ''}
          </div>
        `);
      }

      if (activePrograms.length > 0) {
        programsContainer.innerHTML = activePrograms.join('');
      } else {
        programsContainer.innerHTML = `
          <div class="doc-prog-chip chip-empty" style="color: var(--text-muted); font-size: 0.8rem; border-style: dashed; padding: 6px 12px; border-radius: 8px;">
            <i class="fa-solid fa-folder-open" style="margin-left: 5px;"></i> لا توجد جلسات مسجلة لهذا الشهر حتى الآن
          </div>
        `;
      }
    }

    if (formulaHintEl) {
      const activeRates = [];
      if (regRate > 0) activeRates.push(`عام: ${regRate} ج.م`);
      if (scolRate > 0) activeRates.push(`Scoliosis: ${scolRate} ج.م`);
      if (hemiRate > 0) activeRates.push(`Hemiplegia: ${hemiRate} ج.م`);
      if (quadRate > 0) activeRates.push(`Quadriplegia: ${quadRate} ج.م`);

      if (activeRates.length > 0) {
        formulaHintEl.innerHTML = `<i class="fa-solid fa-tag text-primary"></i> تسعيرة الجلسات المعتمدة: ` + activeRates.join(' • ');
      } else {
        formulaHintEl.innerHTML = `<span style="color: var(--text-muted);"><i class="fa-solid fa-circle-info"></i> لم يتم تحديد أسعار الجلسات بعد من قِبل إدارة المركز</span>`;
      }
    }


    // Update Home Visits Counter Badge
    const activeHomeVisits = this.docSessions.filter((s) => (s.isHomeVisit || s.visitType === 'home') && !s.isPreSettled);
    const hvBadge = document.getElementById('badge-doc-home-visits');
    if (hvBadge) {
      if (activeHomeVisits.length > 0) {
        hvBadge.style.display = 'inline-block';
        hvBadge.textContent = activeHomeVisits.length;
      } else {
        hvBadge.style.display = 'none';
      }
    }

    this.renderTable();
    } finally {
      this._isRendering = false;
    }
  }

  renderTable() {
    if (!this.app.patientsManager?.patients || this.app.patientsManager.patients.length === 0) {
      this.app.patientsManager?.loadPatients().catch(() => {});
    }
    this._hasLoadedOnce = true;
    const tbody = document.getElementById('doctor-personal-tbody');
    if (!tbody) return;

    const todayStr = getLocalDateStr();
    const currentMonth = todayStr.substring(0, 7);

    let displayList = [];

    if (this.currentFilter === 'home-visits') {
      const hvSessions = this.docSessions.filter((s) => s.isHomeVisit || s.visitType === 'home');
      if (hvSessions.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 24px;">
              <i class="fa-solid fa-house-chimney-medical" style="font-size: 1.8rem; margin-bottom: 8px; display: block; color: #cbd5e1;"></i>
              لا توجد زيارات منزلية مسجلة لك حالياً.
            </td>
          </tr>
        `;
        const mobCont = document.getElementById('doctor-personal-mobile-cards');
        if (mobCont) {
          mobCont.innerHTML = `
            <div class="empty-state-card" style="text-align: center; padding: 28px 20px; color: var(--text-muted); background: var(--bg-surface); border-radius: 14px; border: 1.5px dashed var(--border-color);">
              <i class="fa-solid fa-house-chimney-medical" style="font-size: 1.8rem; margin-bottom: 8px; display: block; color: #cbd5e1;"></i>
              لا توجد زيارات منزلية مسجلة لك حالياً.
            </div>
          `;
        }
        return;
      }

      // Group by patient
      const patientGroups = new Map();
      hvSessions.forEach((s) => {
        const key = s.patientId || s.patientName;
        if (!patientGroups.has(key)) {
          patientGroups.set(key, {
            patientId: s.patientId,
            patientName: s.patientName,
            insuranceName: s.insuranceName || 'تأمين',
            sessions: []
          });
        }
        patientGroups.get(key).sessions.push(s);
      });

      // Render Table Rows (NO PRICES SHOWN)
      tbody.innerHTML = Array.from(patientGroups.values()).map((group) => {
        const sList = group.sessions.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
        const firstDate = sList[0]?.date || '-';
        const lastDate = sList[sList.length - 1]?.date || '-';
        const dateRange = (firstDate === lastDate) ? firstDate : `من ${firstDate} إلى ${lastDate}`;
        const isPre = sList.every((s) => Boolean(s.isPreSettled));
        const statusBadge = isPre
          ? '<span class="badge" style="background: rgba(100, 116, 139, 0.15); color: #475569; border: 1px solid #cbd5e1; font-weight: 800;"><i class="fa-solid fa-box-archive"></i> مسواة مسبقاً (أرشيف)</span>'
          : '<span class="badge badge-warning" style="font-weight: 800;"><i class="fa-solid fa-clock"></i> قيد التسوية مع المركز</span>';

        return `
          <tr>
            <td style="font-weight: 800; color: var(--primary);">${escapeHTML(group.patientName)}</td>
            <td><span class="badge badge-direct"><i class="fa-solid fa-file-contract"></i> ${escapeHTML(group.insuranceName)} (زيارة منزلية)</span></td>
            <td><span class="badge badge-role-doctor" style="font-size: 0.82rem; font-weight: 800;">${group.sessions.length} جلسات</span></td>
            <td style="font-weight: 700; direction: ltr; text-align: right;">${dateRange}</td>
            <td>${statusBadge}</td>
            <td style="text-align: center;">
              <button type="button" class="btn btn-outline btn-sm btn-icon-action" onclick="app.openPatientClinicalSheet('${escapeHTML(group.patientId)}')" title="الشيت الطبي">
                <i class="fa-solid fa-file-waveform text-primary"></i>
              </button>
            </td>
          </tr>
        `;
      }).join('');

      // Render Mobile Cards (NO PRICES SHOWN)
      const mobileContainer = document.getElementById('doctor-personal-mobile-cards');
      if (mobileContainer) {
        mobileContainer.innerHTML = Array.from(patientGroups.values()).map((group) => {
          const sList = group.sessions.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
          const firstDate = sList[0]?.date || '-';
          const lastDate = sList[sList.length - 1]?.date || '-';
          const dateRange = (firstDate === lastDate) ? firstDate : `من ${firstDate} إلى ${lastDate}`;
          const isPre = sList.every((s) => Boolean(s.isPreSettled));
          const statusBadge = isPre
            ? '<span class="badge" style="background: rgba(100, 116, 139, 0.15); color: #475569; border: 1px solid #cbd5e1; font-weight: 800; font-size: 0.72rem; padding: 2px 7px;"><i class="fa-solid fa-box-archive"></i> مسواة مسبقاً</span>'
            : '<span class="badge badge-warning" style="font-weight: 800; font-size: 0.72rem; padding: 2px 7px;"><i class="fa-solid fa-clock"></i> قيد التسوية</span>';

          const patientObj = (this.app.patientsManager?.patients || []).find(pt => pt.id === group.patientId) ||
                             (this.app.patientsManager?.patients || []).find(pt => pt.name === group.patientName);
          let bodyPartsList = [];
          if (patientObj) {
            bodyPartsList = this.app.patientsManager?.getPatientBodyParts(patientObj) || [];
          }
          if (bodyPartsList.length === 0) {
            group.sessions.forEach(s => {
              if (Array.isArray(s.bodyParts)) {
                s.bodyParts.forEach(bp => {
                  if (bp && !bodyPartsList.includes(bp)) bodyPartsList.push(bp);
                });
              }
            });
          }
          if (bodyPartsList.length === 0 && patientObj?.affectedArea) bodyPartsList = [patientObj.affectedArea];
          if (bodyPartsList.length === 0 && patientObj?.clinicalSheet?.affectedArea) bodyPartsList = [patientObj.clinicalSheet.affectedArea];
          const displayParts = bodyPartsList.length > 0 ? bodyPartsList.join(' • ') : 'علاج طبيعي عام';

          const safePatientId = escapeHTML(group.patientId || '');
          const safeName = escapeHTML(group.patientName || 'مريض');

          return `
            <div class="hero-styled-card" style="padding: 12px 14px; margin-bottom: 10px; border-radius: 14px; border-right: 4px solid var(--primary);">
              <div class="hsc-top" style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                <div class="hsc-patient-meta" style="display: flex; align-items: center; gap: 10px;">
                  <div class="hsc-avatar" style="background: rgba(2, 132, 199, 0.12); color: var(--primary);"><i class="fa-solid fa-user"></i></div>
                  <div class="hsc-name-box">
                    <span class="hsc-patient-name" style="font-weight: 800; font-size: 0.96rem; cursor: pointer;" onclick="patientsManager.openPatientSheet('${safePatientId}', '${safeName}')">${safeName}</span>
                    <div style="margin-top: 3px;">
                      <span class="badge" style="background: rgba(2, 132, 199, 0.08); color: var(--primary); border: 1px solid rgba(2, 132, 199, 0.22); font-size: 0.74rem; font-weight: 700; padding: 2px 8px; border-radius: 6px; display: inline-flex; align-items: center; gap: 5px;">
                        <i class="fa-solid fa-bone" style="font-size: 0.68rem;"></i>
                        <span>${escapeHTML(displayParts)}</span>
                      </span>
                    </div>
                  </div>
                </div>
                <div class="hsc-amount-box">
                  <span class="badge" style="background: rgba(2, 132, 199, 0.1); color: var(--primary); border: 1px solid rgba(2, 132, 199, 0.25); font-weight: 800; font-size: 0.82rem; padding: 4px 10px;">
                    ${group.sessions.length} جلسات
                  </span>
                </div>
              </div>

              <div class="hsc-divider" style="margin: 8px 0;"></div>

              <div class="hsc-bottom" style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
                <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                  ${statusBadge}
                  <span class="hsc-time-tag" style="font-size: 0.78rem; color: var(--text-muted); direction: ltr;">
                    <i class="fa-regular fa-calendar"></i> ${dateRange}
                  </span>
                </div>
                <button type="button" class="btn btn-outline btn-sm btn-icon-action" onclick="patientsManager.openPatientSheet('${safePatientId}', '${safeName}')" style="width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0;" title="الشيت الطبي">
                  <i class="fa-solid fa-file-waveform text-primary"></i>
                </button>
              </div>
            </div>
          `;
        }).join('');
      }
      return;
    }

    if (this.currentFilter === 'lifetime') {
      // Lifetime: Unique Patients treated by this doctor
      const patientMap = new Map();
      const rawSessions = this.docSessions.filter((s) => !s.isHomeVisit && s.visitType !== 'home');

      rawSessions.forEach((s) => {
        const key = s.patientId || s.patientName;
        if (!patientMap.has(key)) {
          patientMap.set(key, {
            patientId: s.patientId || '',
            patientName: s.patientName || 'مريض',
            payType: s.payType || 'cash',
            insuranceName: s.insuranceName || '',
            contractType: s.contractType || 'direct',
            sessionsCount: 0,
            firstDate: s.date || '',
            lastDate: s.date || '',
            programType: s.programType || s.sessionPricingType || 'regular',
            bodyParts: s.bodyParts || []
          });
        }
        const item = patientMap.get(key);
        item.sessionsCount++;
        if (s.date) {
          if (!item.firstDate || s.date < item.firstDate) item.firstDate = s.date;
          if (!item.lastDate || s.date > item.lastDate) item.lastDate = s.date;
        }
        if (s.programType && s.programType !== 'regular') item.programType = s.programType;
      });

      const uniquePatients = Array.from(patientMap.values()).sort((a, b) => (b.lastDate || '').localeCompare(a.lastDate || ''));

      const titleEl = document.getElementById('doc-table-title');
      if (titleEl) titleEl.textContent = `سجل جميع مرضاك بالمركز (${uniquePatients.length} مريض)`;

      if (uniquePatients.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 24px;">
              <i class="fa-solid fa-users-slash" style="font-size: 1.5rem; margin-bottom: 8px; display: block; color: #cbd5e1;"></i>
              لا يوجد مرضى مسجلين لك حالياً.
            </td>
          </tr>
        `;
        const mobCont = document.getElementById('doctor-personal-mobile-cards');
        if (mobCont) {
          mobCont.innerHTML = `
            <div class="empty-state-card" style="text-align: center; padding: 28px 20px; color: var(--text-muted); background: var(--bg-surface); border-radius: 14px; border: 1.5px dashed var(--border-color);">
              <i class="fa-solid fa-users-slash" style="font-size: 1.8rem; margin-bottom: 8px; display: block; color: #cbd5e1;"></i>
              لا يوجد مرضى مسجلين لك حالياً.
            </div>
          `;
        }
        return;
      }

      // Render Desktop Table for Lifetime (Unique Patients)
      tbody.innerHTML = uniquePatients.map((p) => {
        let billingBadge = '';
        if (p.payType === 'cash') {
          billingBadge = `<span class="badge badge-cash"><i class="fa-solid fa-money-bill"></i> نقدي</span>`;
        } else if (p.contractType === 'direct') {
          billingBadge = `<span class="badge badge-direct"><i class="fa-solid fa-file-contract"></i> ${escapeHTML(p.insuranceName || 'شركة')} (مباشر)</span>`;
        } else {
          billingBadge = `<span class="badge badge-indirect"><i class="fa-solid fa-handshake"></i> ${escapeHTML(p.insuranceName || 'شركة')} (غير مباشر)</span>`;
        }

        const safePatientId = escapeHTML(p.patientId);
        let progTag = '';
        if (p.programType === 'scoliosis') {
          progTag = `<span class="badge" style="background:rgba(2, 132, 199, 0.15); color:#0284c7; border:1px solid rgba(2, 132, 199, 0.35); font-size:0.7rem; font-weight:800;"><i class="fa-solid fa-arrows-split-up-and-left"></i> Scoliosis</span>`;
        } else if (p.programType === 'hemiplegia') {
          progTag = `<span class="badge" style="background:rgba(245, 158, 11, 0.15); color:#b45309; border:1px solid rgba(245, 158, 11, 0.35); font-size:0.7rem; font-weight:800;"><i class="fa-solid fa-brain"></i> Hemiplegia</span>`;
        } else if (p.programType === 'quadriplegia' || p.programType === 'pediatric') {
          progTag = `<span class="badge" style="background:rgba(225, 29, 72, 0.15); color:#e11d48; border:1px solid rgba(225, 29, 72, 0.35); font-size:0.7rem; font-weight:800;"><i class="fa-solid fa-wheelchair"></i> Quadriplegia</span>`;
        }

        return `
          <tr>
            <td style="font-weight: 800; color: var(--text-main); cursor: pointer;" onclick="patientsManager.openPatientSheet('${safePatientId}')" title="اضغط لفتح الشيت الطبي">
              <i class="fa-solid fa-user-injured" style="color: var(--primary); margin-left: 6px;"></i>
              ${escapeHTML(p.patientName)} ${progTag}
            </td>
            <td>${billingBadge}</td>
            <td><span class="badge badge-role-doctor" style="font-size: 0.82rem; font-weight: 800;"><i class="fa-solid fa-calendar-check"></i> ${p.sessionsCount} جلسات</span></td>
            <td style="font-size: 0.85rem; color: var(--text-muted); white-space: nowrap;">
              أحدث جلسة: <bdi dir="ltr">${escapeHTML(p.lastDate || '-')}</bdi>
            </td>
            <td style="font-size: 0.82rem; color: var(--text-muted);">
              ${p.firstDate && p.firstDate !== p.lastDate ? `أول جلسة: <bdi dir="ltr">${escapeHTML(p.firstDate)}</bdi>` : 'مريض نشط'}
            </td>
            <td style="text-align: center;">
              <button type="button" class="btn btn-primary btn-sm" onclick="patientsManager.openPatientSheet('${safePatientId}')" style="padding: 4px 10px; font-weight: 700; white-space: nowrap;">
                <i class="fa-solid fa-file-waveform"></i> الشيت الطبي
              </button>
            </td>
          </tr>
        `;
      }).join('');

      // Render Mobile Cards for Lifetime (Unique Patients)
      const mobileContainer = document.getElementById('doctor-personal-mobile-cards');
      if (mobileContainer) {
        mobileContainer.innerHTML = uniquePatients.map((p) => {
          const patientObj = (this.app.patientsManager?.patients || []).find(pt => pt.id === p.patientId) ||
                             (this.app.patientsManager?.patients || []).find(pt => pt.name === p.patientName);

          let bodyPartsList = [];
          if (patientObj) {
            bodyPartsList = this.app.patientsManager?.getPatientBodyParts(patientObj) || [];
          }
          if (bodyPartsList.length === 0 && p.bodyParts && p.bodyParts.length > 0) {
            bodyPartsList = p.bodyParts;
          }
          if (bodyPartsList.length === 0 && patientObj?.affectedArea) {
            bodyPartsList = [patientObj.affectedArea];
          }
          if (bodyPartsList.length === 0 && patientObj?.clinicalSheet?.affectedArea) {
            bodyPartsList = [patientObj.clinicalSheet.affectedArea];
          }

          const displayParts = bodyPartsList.length > 0 ? bodyPartsList.join(' • ') : 'علاج طبيعي عام';
          const safePatientId = escapeHTML(p.patientId);
          const safeName = escapeHTML(p.patientName);

          return `
            <div class="hero-styled-card" style="padding: 12px 14px; margin-bottom: 10px; border-radius: 14px; border-right: 4px solid var(--primary);">
              <div class="hsc-top" style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                <div class="hsc-patient-meta" style="display: flex; align-items: center; gap: 10px;">
                  <div class="hsc-avatar" style="background: rgba(2, 132, 199, 0.12); color: var(--primary);"><i class="fa-solid fa-user"></i></div>
                  <div class="hsc-name-box">
                    <span class="hsc-patient-name" style="font-weight: 800; font-size: 0.96rem; cursor: pointer;" onclick="patientsManager.openPatientSheet('${safePatientId}', '${safeName}')">${safeName}</span>
                    <div style="margin-top: 3px;">
                      <span class="badge" style="background: rgba(2, 132, 199, 0.08); color: var(--primary); border: 1px solid rgba(2, 132, 199, 0.22); font-size: 0.74rem; font-weight: 700; padding: 2px 8px; border-radius: 6px; display: inline-flex; align-items: center; gap: 5px;">
                        <i class="fa-solid fa-bone" style="font-size: 0.68rem;"></i>
                        <span>${escapeHTML(displayParts)}</span>
                      </span>
                    </div>
                  </div>
                </div>
                <div class="hsc-amount-box">
                  <span class="badge" style="background: rgba(2, 132, 199, 0.1); color: var(--primary); border: 1px solid rgba(2, 132, 199, 0.25); font-weight: 800; font-size: 0.82rem; padding: 4px 10px;">
                    ${p.sessionsCount} جلسات
                  </span>
                </div>
              </div>

              <div class="hsc-divider" style="margin: 8px 0;"></div>

              <div class="hsc-bottom" style="display: flex; justify-content: space-between; align-items: center;">
                <span class="hsc-time-tag" style="font-size: 0.78rem; color: var(--text-muted);">
                  <i class="fa-regular fa-calendar-check"></i> أحدث جلسة: <bdi dir="ltr">${escapeHTML(p.lastDate || '-')}</bdi>
                </span>
                <button type="button" class="btn btn-outline btn-sm btn-icon-action" onclick="patientsManager.openPatientSheet('${safePatientId}', '${safeName}')" style="width: 32px; height: 32px; border-radius: 50%;" title="الشيت الطبي">
                  <i class="fa-solid fa-file-waveform text-primary"></i>
                </button>
              </div>
            </div>
          `;
        }).join('');
      }
      return;
    }

    if (this.currentFilter === 'today') {
      displayList = this.docSessions.filter((s) => s.date === todayStr && !s.isHomeVisit && s.visitType !== 'home');
    } else if (this.currentFilter === 'month') {
      displayList = this.docSessions.filter((s) => s.date && s.date.startsWith(currentMonth) && !s.isHomeVisit && s.visitType !== 'home');
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
      } else if (pType === 'quadriplegia' || pType === 'pediatric') {
        progTag = `<span class="badge" style="background:rgba(225, 29, 72, 0.15); color:#e11d48; border:1px solid rgba(225, 29, 72, 0.35); font-size:0.7rem; font-weight:800;"><i class="fa-solid fa-wheelchair"></i> Quadriplegia</span>`;
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

    // 2. Render Handcrafted Mobile Cards (Unified style matching "All Patients" card)
    if (mobileContainer) {
      mobileContainer.innerHTML = displayList.map(s => {
        const isExam = (s.entryType === 'examination');
        const safePatientId = escapeHTML(s.patientId || '');
        const safeName = escapeHTML(s.patientName || 'مريض');
        const timeDisplay = s.recordedAt || '';

        const patientObj = (this.app.patientsManager?.patients || []).find(pt => pt.id === s.patientId) ||
                           (this.app.patientsManager?.patients || []).find(pt => pt.name === s.patientName);

        let bodyPartsList = [];
        if (patientObj) {
          bodyPartsList = this.app.patientsManager?.getPatientBodyParts(patientObj) || [];
        }
        if (bodyPartsList.length === 0 && Array.isArray(s.bodyParts) && s.bodyParts.length > 0) {
          bodyPartsList = s.bodyParts;
        } else if (bodyPartsList.length === 0 && s.bodyParts && typeof s.bodyParts === 'string') {
          bodyPartsList = [s.bodyParts];
        }
        if (bodyPartsList.length === 0 && patientObj?.affectedArea) {
          bodyPartsList = [patientObj.affectedArea];
        }
        if (bodyPartsList.length === 0 && patientObj?.clinicalSheet?.affectedArea) {
          bodyPartsList = [patientObj.clinicalSheet.affectedArea];
        }

        const displayParts = isExam ? 'فحص سريري / كشف' : (bodyPartsList.length > 0 ? bodyPartsList.join(' • ') : 'علاج طبيعي عام');
        const unitCount = s.bodyPartsCount || 1;
        const unitWord = unitCount === 1 ? 'جلسة' : unitCount === 2 ? 'جلستان' : 'جلسات';

        const amountBadge = isExam
          ? `<span class="badge" style="background: rgba(245, 158, 11, 0.12); color: #d97706; border: 1px solid rgba(245, 158, 11, 0.3); font-weight: 800; font-size: 0.82rem; padding: 4px 10px;"><i class="fa-solid fa-stethoscope"></i> كشف</span>`
          : `<span class="badge" style="background: rgba(2, 132, 199, 0.1); color: var(--primary); border: 1px solid rgba(2, 132, 199, 0.25); font-weight: 800; font-size: 0.82rem; padding: 4px 10px;">${unitCount} ${unitWord}</span>`;

        return `
          <div class="hero-styled-card" style="padding: 12px 14px; margin-bottom: 10px; border-radius: 14px; border-right: 4px solid var(--primary);">
            <div class="hsc-top" style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
              <div class="hsc-patient-meta" style="display: flex; align-items: center; gap: 10px;">
                <div class="hsc-avatar" style="background: rgba(2, 132, 199, 0.12); color: var(--primary);"><i class="fa-solid fa-user"></i></div>
                <div class="hsc-name-box">
                  <span class="hsc-patient-name" style="font-weight: 800; font-size: 0.96rem; cursor: pointer;" onclick="patientsManager.openPatientSheet('${safePatientId}', '${safeName}')">${safeName}</span>
                  <div style="margin-top: 3px;">
                    <span class="badge" style="background: rgba(2, 132, 199, 0.08); color: var(--primary); border: 1px solid rgba(2, 132, 199, 0.22); font-size: 0.74rem; font-weight: 700; padding: 2px 8px; border-radius: 6px; display: inline-flex; align-items: center; gap: 5px;">
                      <i class="fa-solid fa-bone" style="font-size: 0.68rem;"></i>
                      <span>${escapeHTML(displayParts)}</span>
                    </span>
                  </div>
                </div>
              </div>
              <div class="hsc-amount-box">
                ${amountBadge}
              </div>
            </div>

            <div class="hsc-divider" style="margin: 8px 0;"></div>

            <div class="hsc-bottom" style="display: flex; justify-content: space-between; align-items: center;">
              <span class="hsc-time-tag" style="font-size: 0.78rem; color: var(--text-muted);">
                <i class="fa-regular fa-calendar-check"></i> <bdi dir="ltr">${escapeHTML(s.date || '-')}</bdi>${timeDisplay ? ` • ${escapeHTML(timeDisplay)}` : ''}
              </span>
              <button type="button" class="btn btn-outline btn-sm btn-icon-action" onclick="patientsManager.openPatientSheet('${safePatientId}', '${safeName}')" style="width: 32px; height: 32px; border-radius: 50%;" title="الشيت الطبي">
                <i class="fa-solid fa-file-waveform text-primary"></i>
              </button>
            </div>
          </div>
        `;
      }).join('');
    }
  }
}
