import { CLINIC_CONFIG } from './clinic-config.js';
import { escapeHTML, getLocalDateStr, sequencePatientSessionsChronologically } from './utils.js';
// ========================================================
// PhysioFlow - Patients Management Module
// ========================================================

import { db } from './db.js';
import { auth } from './auth.js';
import { RolesManager } from './roles.js';

export class PatientsManager {
  constructor(app) {
    this.app = app;
    this.patients = [];
    this._hasLoadedOnce = false;
    this.currentSheetPatient = null;
    window.patientsManager = this;
    this.insEditMode = false;
    this.currentContractType = "direct";
    this.sortBy = localStorage.getItem('ascpt_patient_sort') || 'recent';
    this.currentPage = 1;

    // Medical Imaging & Polish Studio & Lightbox (v1.4.78)
    this.currentPatientImages = [];
    this.polishQueue = [];
    this.currentPolishIndex = 0;
    this.polishRotation = 0;
    this.polishBrightness = 100;
    this.polishContrast = 100;
    this.polishPreset = 'normal';
    this.rawOriginalImageObj = null;
    this.currentPolishImageObj = null;
    this.isCropMode = false;
    this.cropBox = null;
    this.lightboxIndex = 0;
    this.lightboxZoom = 1;
    this.lightboxRotation = 0;
    this.pageSize = 12;
    this.viewMode = 'cards';
    try {
      localStorage.setItem('ascpt_patients_view_mode', 'cards');
    } catch (_) {}
    this.newlyAddedPatientId = null;
    this.pendingPromptPatientId = null;
    this.chipsEditMode = {
      modality: false,
      procedure: false,
      exercise: false
    };
    this.filterTodayOnly = false;
    this.batchHvDates = [];
    this.batchHvSelectedPattern = 'sat_mon_wed';
    this.activeBatchPatient = null;
  }

  async init() {
    this.bindEvents();
    this.renderAllInsuranceChips();
  }

  bindEvents() {
    const searchInput = document.getElementById('patient-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', () => { this.currentPage = 1; this.renderPatients(); });
    }

    const filterType = document.getElementById('patient-filter-type');
    if (filterType) {
      filterType.addEventListener('change', () => { this.currentPage = 1; this.renderPatients(); });
    }

    const btnToday = document.getElementById('btn-filter-today-patients');
    if (btnToday) {
      btnToday.addEventListener('click', () => this.toggleTodayFilter());
    }

    // Sort Toggle Buttons (Recent vs Alphabetical)
    document.getElementById('btn-sort-recent')?.addEventListener('click', () => this.setSort('recent'));
    document.getElementById('btn-sort-alphabetical')?.addEventListener('click', () => this.setSort('alphabetical'));

    // View Mode Toggle (Cards vs Table v1.4.57)
    document.getElementById('patients-view-mode-toggle')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-view-mode');
      if (!btn) return;
      this.setViewMode(btn.getAttribute('data-view-mode'));
    });

    // Post-Registration Action Prompt Handlers
    document.getElementById('btn-prompt-record-session')?.addEventListener('click', async () => {
      const pid = this.pendingPromptPatientId;
      this.app.closeModal('modal-patient-action-prompt');
      if (pid) {
        this.app.switchView('sessions');
        if (this.app?.sessionsManager?.selectPatient) {
          await this.app.sessionsManager.selectPatient(pid);
        }
      }
    });

    document.getElementById('btn-prompt-stay-patients')?.addEventListener('click', () => {
      this.app.closeModal('modal-patient-action-prompt');
    });

    const btnOpenAdd = document.getElementById('btn-open-add-patient');
    if (btnOpenAdd) {
      btnOpenAdd.addEventListener('click', () => this.openAddModal());
    }

    // Batch Home Visits Modal Event Bindings
    // Session Type Selection: Home Visits vs Clinic Batch
    document.querySelectorAll('input[name="batch-session-type"]').forEach((radio) => {
      radio.addEventListener('change', (e) => {
        this.setBatchSessionType(e.target.value);
      });
    });
    document.getElementById('btn-type-home-visit')?.addEventListener('click', () => {
      this.setBatchSessionType('home_visit');
    });
    document.getElementById('btn-type-clinic-batch')?.addEventListener('click', () => {
      this.setBatchSessionType('clinic_batch');
    });

    document.querySelectorAll('.btn-batch-pattern').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const pat = e.currentTarget.getAttribute('data-pattern') || 'sat_mon_wed';
        this.setBatchPattern(pat);
      });
    });

    document.getElementById('btn-generate-batch-hv-dates')?.addEventListener('click', () => {
      this.generateBatchHomeVisitDates();
    });

    document.getElementById('btn-add-batch-hv-single-date')?.addEventListener('click', () => {
      this.addBatchHvSingleDate();
    });

    document.getElementById('form-batch-home-visits')?.addEventListener('submit', (e) => {
      this.handleSaveBatchHomeVisits(e);
    });

    const btnViewSessions = document.getElementById('btn-view-patient-sessions');
    if (btnViewSessions) {
      btnViewSessions.addEventListener('click', () => this.openPatientSessionsModal());
    }

    // Body Parts Multi-Picker in Patient Modal
    document.getElementById('btn-open-patient-body-parts')?.addEventListener('click', () => {
      this.app.openMultiPicker({
        category: 'body_parts',
        title: 'المنطقة أو الأعضاء المعالجة للمريض',
        currentSelected: this.selectedPatientBodyParts || [],
        onConfirm: (selected) => {
          this.updatePatientBodyPartsPreview(selected);
        }
      });
    });

    // Toggle Insurance Fields in Patient Form
    const billingRadios = document.querySelectorAll('input[name="p-billing"]');
    billingRadios.forEach(r => {
      r.addEventListener('change', (e) => {
        const insBox = document.getElementById('p-insurance-details');
        if (insBox) {
          const isIns = e.target.value === 'insurance';
          insBox.style.display = isIns ? 'block' : 'none';
          if (isIns) {
            setTimeout(() => {
              insBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }, 60);
          }
        }
      });
    });

    // Contract Type Radios in Patient Form
    document.querySelectorAll('input[name="p-contract-type"]').forEach(r => {
      r.addEventListener('change', (e) => this.onContractTypeChanged(e.target.value));
    });

    // Modern Patient Form Gender Segmented Buttons
    document.getElementById('btn-gender-male')?.addEventListener('click', () => this.setGender('male'));
    document.getElementById('btn-gender-female')?.addEventListener('click', () => this.setGender('female'));

    // Toggle Insurance Edit Mode in Patient Form
    document.getElementById('btn-toggle-chips-ins-patient')?.addEventListener('click', () => this.toggleInsuranceEditMode('patient'));

    // Event Delegation: Patient Modal Insurance Chips Containers
    ['p-ins-direct-container', 'p-ins-indirect-container'].forEach(id => {
      const container = document.getElementById(id);
      if (container) {
        container.addEventListener('click', async (e) => {
          const delTag = e.target.closest('[data-action="delete-insurance"]');
          if (delTag) {
            e.stopPropagation();
            this.deleteInsuranceDirect(delTag.dataset.contract, delTag.dataset.company);
            return;
          }
          const addBtn = e.target.closest('[data-action="add-insurance"]');
          if (addBtn) {
            e.stopPropagation();
            const contract = addBtn.dataset.contract || this.currentContractType || 'direct';
            const contractLabel = contract === 'direct' ? 'تعاقد مباشر' : 'تعاقد غير مباشر';
            const name = await this.app.showPrompt(
              `اكتب اسم شركة التأمين الجديدة (${contractLabel}):`,
              'إضافة شركة تأمين جديدة',
              'مثال: شركة أكسا / أليانز'
            );
            if (name && name.trim()) {
              await db.addInsuranceCompany(contract, name.trim());
              this.renderAllInsuranceChips();
              this.selectInsuranceCompany(contract, name.trim());
              this.app.showToast(`تمت إضافة شركة "${name.trim()}" بنجاح`);
            }
            return;
          }
          const chip = e.target.closest('[data-action="select-insurance"]');
          if (chip) {
            this.selectInsuranceCompany(chip.dataset.contract, chip.dataset.company);
          }
        });
      }
    });

    // Patient Sheet Navigation & Print Buttons
    document.getElementById('btn-back-to-patients-top')?.addEventListener('click', () => this.app.switchView('patients'));
    document.getElementById('btn-back-to-patients-bottom')?.addEventListener('click', () => this.app.switchView('patients'));
        const btnTop = document.getElementById('btn-print-sheet-top');
    if (btnTop) {
      btnTop.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (btnTop.disabled) return;
        this.printCurrentSheet();
      };
    }
    const btnBottom = document.getElementById('btn-print-sheet-bottom');
    if (btnBottom) {
      btnBottom.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (btnBottom.disabled) return;
        this.printCurrentSheet();
      };
    }

    document.getElementById('btn-print-insurance-letter')?.addEventListener('click', () => this.openInsuranceLetterModal());
    document.getElementById('form-insurance-letter')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submitInsuranceLetter();
    });

    // Renew Insurance Approval Form Submit
    const formRenew = document.getElementById('form-renew-approval');
    if (formRenew) {
      formRenew.addEventListener('submit', (e) => this.handleConfirmRenewApproval(e));
    }

    // Dynamic Approval Units Calculation Listeners
    document.getElementById('p-approved-sessions')?.addEventListener('input', () => this.updateApprovalUnitsSummary('patient'));
    document.getElementById('p-approved-body-parts')?.addEventListener('change', () => this.updateApprovalUnitsSummary('patient'));
    document.getElementById('renew-sessions-count')?.addEventListener('input', () => this.updateApprovalUnitsSummary('renew'));
    document.getElementById('renew-approved-body-parts')?.addEventListener('change', () => this.updateApprovalUnitsSummary('renew'));

    // Multi-Picker Triggers for Clinical Sheet
    document.getElementById('btn-open-picker-modalities')?.addEventListener('click', () => {
      this.app.openMultiPicker({
        category: 'modality',
        title: 'الأجهزة والوسائل الفيزيائية',
        currentSelected: this.currentSheetModalities || [],
        onConfirm: (selected) => {
          this.currentSheetModalities = selected;
          this.updateSheetPickerPreview('modality', selected);
        }
      });
    });

    document.getElementById('btn-open-picker-procedures')?.addEventListener('click', () => {
      this.app.openMultiPicker({
        category: 'procedure',
        title: 'الإجراءات والعلاج اليدوي',
        currentSelected: this.currentSheetProcedures || [],
        onConfirm: (selected) => {
          this.currentSheetProcedures = selected;
          this.updateSheetPickerPreview('procedure', selected);
        }
      });
    });

    document.getElementById('btn-open-picker-exercises')?.addEventListener('click', () => {
      this.app.openMultiPicker({
        category: 'exercise',
        title: 'التمارين العلاجية والتأهيل',
        currentSelected: this.currentSheetExercises || [],
        onConfirm: (selected) => {
          this.currentSheetExercises = selected;
          this.updateSheetPickerPreview('exercise', selected);
        }
      });
    });

    // Custom Picker Trigger for Insurance Company in Patient Modal
    document.getElementById('btn-open-picker-p-insurance')?.addEventListener('click', () => {
      const cType = document.querySelector('input[name="p-contract-type"]:checked')?.value || 'direct';
      this.app.openMultiPicker({
        category: 'insurance_company',
        title: 'اختر شركة التأمين',
        contractType: cType,
        isSingleSelect: true,
        currentSelected: document.getElementById('p-insurance-company')?.value || '',
        onConfirm: (compName, optContract) => {
          this.selectInsuranceCompany(optContract || cType, compName);
        }
      });
    });

    // Cash Receipt Form Submit
    document.getElementById('form-cash-receipt')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.printCashReceipt();
    });

    // Medical Statement Form Submit
    document.getElementById('form-medical-statement')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.printMedicalStatement();
    });

    // Patient Sheet Form Submit
    const formSheet = document.getElementById('form-patient-sheet');
    if (formSheet) {
      formSheet.addEventListener('submit', (e) => this.handleSaveSheet(e));
    }



    // Toggle Chips Edit Mode Buttons in Clinical Sheet
    document.getElementById('btn-toggle-chips-modality')?.addEventListener('click', () => this.toggleChipsEditMode('modality'));
    document.getElementById('btn-toggle-chips-procedure')?.addEventListener('click', () => this.toggleChipsEditMode('procedure'));
    document.getElementById('btn-toggle-chips-exercise')?.addEventListener('click', () => this.toggleChipsEditMode('exercise'));

    // Event Delegation: Clinical Sheet Chips Containers (Modality, Procedure, Exercise)
    [
      { id: 'sheet-modalities-container', cat: 'modality' },
      { id: 'sheet-procedures-container', cat: 'procedure' },
      { id: 'sheet-exercises-container', cat: 'exercise' }
    ].forEach(({ id, cat }) => {
      const container = document.getElementById(id);
      if (container) {
        container.addEventListener('click', async (e) => {
          const delTag = e.target.closest('[data-action="delete-option"]');
          if (delTag) {
            e.preventDefault();
            e.stopPropagation();
            const optName = delTag.dataset.option || delTag.closest('.chip-choice')?.getAttribute('data-val');
            await this.deleteOptionDirect(delTag.dataset.category || cat, optName);
            return;
          }

          const addBtn = e.target.closest('[data-action="add-option"]');
          if (addBtn) {
            e.preventDefault();
            e.stopPropagation();
            this.openAddOptionModal(addBtn.dataset.category || cat);
            return;
          }

          const chip = e.target.closest('.chip-choice');
          if (chip && !this.chipsEditMode[cat]) {
            e.preventDefault();
            chip.classList.toggle('selected');
          }
        });
      }
    });

    // Real-time phone input digits filter
    const phoneInp = document.getElementById('p-phone');
    if (phoneInp) {
      phoneInp.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/[^0-9]/g, '');
      });
    }

    // Medical Imaging Event Listeners (v1.4.78)
    document.getElementById('btn-trigger-add-imaging')?.addEventListener('click', () => {
      document.getElementById('imaging-file-input')?.click();
    });

    document.getElementById('imaging-file-input')?.addEventListener('change', (e) => {
      this.handleImagingFilesSelected(e);
    });

    // Polish Studio Controls & Cropper (v1.4.79)
    document.getElementById('btn-polish-crop')?.addEventListener('click', () => this.startCropMode());
    document.getElementById('btn-apply-crop')?.addEventListener('click', () => this.applyCrop());
    document.getElementById('btn-cancel-crop')?.addEventListener('click', () => this.endCropMode());
    document.getElementById('btn-polish-rotate-left')?.addEventListener('click', () => this.rotatePolish(-90));
    document.getElementById('btn-polish-rotate-right')?.addEventListener('click', () => this.rotatePolish(90));
    document.getElementById('btn-polish-reset')?.addEventListener('click', () => this.resetPolish());
    document.getElementById('btn-polish-save-current')?.addEventListener('click', () => this.saveCurrentPolishedImage());
    document.getElementById('btn-polish-skip-or-cancel')?.addEventListener('click', () => this.skipOrCancelPolish());

    this.setupCropBoxDrag();

    document.querySelectorAll('.polish-preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.setPolishPreset(btn.dataset.preset);
      });
    });

    // Polish Category Chips (v1.4.82)
    document.querySelectorAll('.btn-cat-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        this.setPolishCategory(btn.dataset.cat);
      });
    });

    // Smart Auto-detection while typing in Polish note / title
    document.getElementById('polish-title-input')?.addEventListener('input', (e) => {
      const text = e.target.value.trim();
      const detected = this.detectCategoryFromText(text);
      if (detected) {
        this.setPolishCategory(detected);
      }
    });

    // Category changer modal choices
    document.querySelectorAll('.btn-change-cat-choice').forEach(btn => {
      btn.addEventListener('click', () => {
        this.handleChangeCategory(btn.dataset.cat);
      });
    });

    // Lightbox category badge click
    document.getElementById('lightbox-category-badge')?.addEventListener('click', () => {
      if (this.currentPatientImages && this.currentPatientImages[this.lightboxIndex]) {
        const curImg = this.currentPatientImages[this.lightboxIndex];
        this.openChangeCategoryModal(curImg.id, curImg.category);
      }
    });

    document.getElementById('polish-contrast-slider')?.addEventListener('input', (e) => {
      this.polishContrast = parseInt(e.target.value, 10);
      const valEl = document.getElementById('polish-contrast-val');
      if (valEl) valEl.textContent = `${this.polishContrast}%`;
      this.renderPolishCanvas();
    });

    document.getElementById('polish-brightness-slider')?.addEventListener('input', (e) => {
      this.polishBrightness = parseInt(e.target.value, 10);
      const valEl = document.getElementById('polish-brightness-val');
      if (valEl) valEl.textContent = `${this.polishBrightness}%`;
      this.renderPolishCanvas();
    });

    // Lightbox Controls
    document.getElementById('btn-lightbox-close')?.addEventListener('click', () => this.closeLightbox());
    document.getElementById('btn-lightbox-next')?.addEventListener('click', () => this.lightboxNext());
    document.getElementById('btn-lightbox-prev')?.addEventListener('click', () => this.lightboxPrev());
    document.getElementById('btn-lightbox-zoom-in')?.addEventListener('click', () => this.lightboxZoomIn());
    document.getElementById('btn-lightbox-zoom-out')?.addEventListener('click', () => this.lightboxZoomOut());
    document.getElementById('btn-lightbox-zoom-reset')?.addEventListener('click', () => this.lightboxZoomReset());
    document.getElementById('btn-lightbox-rotate')?.addEventListener('click', () => this.lightboxRotate());

    this.setupLightboxTouch();

    window.addEventListener('keydown', (e) => {
      const lb = document.getElementById('modal-image-lightbox');
      if (lb && lb.style.display !== 'none') {
        if (e.key === 'ArrowLeft') {
          this.lightboxNext();
        } else if (e.key === 'ArrowRight') {
          this.lightboxPrev();
        } else if (e.key === 'Escape') {
          this.closeLightbox();
        }
      }
    });

    // Modal Add Clinical Option Form Submit
    const formAddOption = document.getElementById('form-add-clinical-option');
    if (formAddOption) {
      formAddOption.addEventListener('submit', (e) => this.handleSaveNewOption(e));
    }

    // Form Submission for Patient
    const form = document.getElementById('form-patient');
    if (form) {
      form.addEventListener('submit', (e) => this.handleSavePatient(e));
    }

    // Event Delegation: Patients Directory Table (sheet, edit, delete)
    const tbody = document.getElementById('patients-tbody');
    if (tbody) {
      tbody.addEventListener('click', (e) => {
        const sheetAction = e.target.closest('.btn-patient-sheet-action, .patient-sheet-link');
        if (sheetAction) {
          const pid = sheetAction.getAttribute('data-patient-id');
          if (pid) this.openPatientSheet(pid);
          return;
        }
        const docsBtn = e.target.closest('.btn-patient-docs');
        if (docsBtn) {
          const pid = docsBtn.getAttribute('data-patient-id');
          if (pid) this.openPatientDocsModal(pid);
          return;
        }
        const renewBtn = e.target.closest('.btn-renew-approval');
        if (renewBtn) {
          const pid = renewBtn.getAttribute('data-patient-id');
          if (pid) this.openRenewApprovalModal(pid);
          return;
        }
        const editBtn = e.target.closest('.btn-edit-patient');
        if (editBtn) {
          const pid = editBtn.getAttribute('data-patient-id');
          if (pid) this.openEditModal(pid);
          return;
        }
        const delBtn = e.target.closest('.btn-delete-patient');
        if (delBtn) {
          const pid = delBtn.getAttribute('data-patient-id');
          if (pid) this.confirmDelete(pid);
          return;
        }
        const insLetterBtn = e.target.closest('.btn-insurance-letter-row');
        if (insLetterBtn) {
          const pid = insLetterBtn.getAttribute('data-patient-id');
          if (pid) this.openInsuranceLetterModalForPatient(pid);
          return;
        }
      });
    }
  }

  async loadPatients(forceRefresh = false) {
    if (!this._hasLoadedOnce && (!this.patients || this.patients.length === 0)) {
      this.renderSkeleton();
    }
    // Real-time zero-cost listener: subscribe to changes across the patients directory
    if (db.subscribeToPatients && !this._patientsSubscribed) {
      this._patientsSubscribed = true;
      db.subscribeToPatients((updatedPatients) => {
        this.patients = updatedPatients;
        this._hasLoadedOnce = true;
        this.renderPatients();
      });
    }

    // Pre-load today and current month sessions to populate real-time patient metrics & body parts
    if (this.app?.sessionsManager) {
      try { await this.app.sessionsManager.loadTodaySessions(); } catch (_) {}
    }
    if (db && typeof db.getSessions === 'function') {
      try {
        const curMonth = new Date().toISOString().slice(0, 7);
        await db.getSessions(curMonth);
      } catch (_) {}
    }
    if (this.app?.appointmentsManager && (!this.app.appointmentsManager.appointments || this.app.appointmentsManager.appointments.length === 0)) {
      try { await this.app.appointmentsManager.loadAll(); } catch (_) {}
    }

    this.patients = await db.getPatients(forceRefresh);
    this._hasLoadedOnce = true;
    this.renderPatients();
    this.checkAndMigrateLegacyInsuranceNames();
  }

  // ================= Smart Arabic Search & Relevance Ranking =================
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

    // 1. First name starts directly with query (Top Priority: 10,000+)
    if (words[0] && words[0].startsWith(q)) {
      return 10000 - words[0].length;
    }

    // 2. Second word (Father's name) starts with query (Priority: 5,000+)
    if (words[1] && words[1].startsWith(q)) {
      return 5000 - words[1].length;
    }

    // 3. Third or subsequent word starts with query (Priority: 2,000+)
    for (let i = 2; i < words.length; i++) {
      if (words[i].startsWith(q)) {
        return 2000 - (i * 10);
      }
    }

    // 4. Substring match in full name
    if (name.includes(q)) {
      return 500;
    }

    // 5. Phone match
    const phone = (p.phone || '').replace(/[^0-9]/g, '');
    const cleanDigits = rawQuery.replace(/[^0-9]/g, '');
    if (cleanDigits && phone.includes(cleanDigits)) {
      return phone.startsWith(cleanDigits) ? 200 : 100;
    }

    // 6. Insurance match
    if (p.insuranceCompany && this.normalizeArabic(p.insuranceCompany).includes(q)) {
      return 50;
    }

    return -1;
  }

  setSort(type) {
    this.sortBy = type === 'alphabetical' ? 'alphabetical' : 'recent';
    this.currentPage = 1;
    localStorage.setItem('ascpt_patient_sort', this.sortBy);
    this.updateSortUI();
    this.renderPatients();
  }

  updateSortUI() {
    const btnRecent = document.getElementById('btn-sort-recent');
    const btnAlpha = document.getElementById('btn-sort-alphabetical');
    if (btnRecent && btnAlpha) {
      btnRecent.classList.toggle('active', this.sortBy === 'recent');
      btnAlpha.classList.toggle('active', this.sortBy === 'alphabetical');
    }
  }

  toggleTodayFilter() {
    this.filterTodayOnly = !this.filterTodayOnly;
    this.currentPage = 1;
    const btn = document.getElementById('btn-filter-today-patients');
    if (btn) {
      if (this.filterTodayOnly) {
        btn.classList.add('btn-today-active');
      } else {
        btn.classList.remove('btn-today-active');
      }
    }
    this.renderPatients();
  }

  getTodayPatientIdentifiers() {
    const todayIds = new Set();
    const todayNames = new Set();
    const todayStr = getLocalDateStr();

    // 1. Collect attended patients for today (sessions recorded today)
    const attendedIds = new Set();
    const attendedNames = new Set();
    const cachedTodaySessions = db._sessionsByDateCache?.get(todayStr)?.data;
    const sessions = Array.isArray(cachedTodaySessions)
      ? cachedTodaySessions
      : (this.app?.sessionsManager?.sessions || []);

    sessions.forEach(s => {
      const sDate = s.date || (s.createdAt ? s.createdAt.substring(0, 10) : '');
      if (sDate === todayStr && s.status !== 'cancelled') {
        if (s.patientId) attendedIds.add(String(s.patientId).trim());
        if (s.patientName) attendedNames.add(this.normalizeArabic(s.patientName));
      }
    });

    // 2. Weekly appointments schedule scheduled specifically for TODAY (day-of-week / date filtered)
    let todayAppts = [];
    if (this.app?.appointmentsManager?.getAppointmentsForDate) {
      todayAppts = this.app.appointmentsManager.getAppointmentsForDate(todayStr) || [];
    } else {
      const allAppts = this.app?.appointmentsManager?.appointments || [];
      const curDate = new Date(todayStr + 'T00:00:00');
      const dayOfWeek = curDate.getDay();
      if (dayOfWeek !== 5) {
        todayAppts = allAppts.filter(a => {
          if (a.status === 'completed' || a.status === 'cancelled') return false;
          if (Array.isArray(a.daysOfWeek) && a.daysOfWeek.length > 0) {
            return a.daysOfWeek.includes(dayOfWeek);
          }
          if (a.date) return a.date === todayStr;
          return false;
        });
      }
    }

    // 3. Keep ONLY scheduled patients who have NOT yet attended today
    todayAppts.forEach(a => {
      if (a.effectiveStatus === 'cancelled' || a.isCancelledToday) return;
      const pId = a.patientId ? String(a.patientId).trim() : '';
      const pName = a.patientName ? this.normalizeArabic(a.patientName) : '';

      // If already attended today, exclude from "حالات اليوم المتبقية في الجدول"
      if ((pId && attendedIds.has(pId)) || (pName && attendedNames.has(pName)) || a.isAttendedToday) {
        return;
      }

      if (pId) todayIds.add(pId);
      if (pName) todayNames.add(pName);
    });

    return { todayIds, todayNames };
  }

  renderSkeleton() {
    const mobileContainer = document.getElementById('patients-mobile-cards');
    const tbody = document.getElementById('patients-tbody');

    if (mobileContainer && (!this.patients || this.patients.length === 0)) {
      mobileContainer.innerHTML = Array.from({ length: 4 }).map(() => `
        <div class="patient-card skeleton-card" style="padding: 11px 13px; margin-bottom: 10px; border-radius: 14px;">
          <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 8px;">
            <div style="display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1;">
              <div class="skeleton-shimmer skeleton-avatar"></div>
              <div style="display: flex; flex-direction: column; gap: 6px; flex: 1;">
                <div class="skeleton-shimmer skeleton-line" style="width: 45%; height: 16px;"></div>
                <div class="skeleton-shimmer skeleton-line" style="width: 30%; height: 12px;"></div>
              </div>
            </div>
            <div style="display: flex; gap: 6px;">
              <div class="skeleton-shimmer skeleton-badge" style="width: 50px;"></div>
              <div class="skeleton-shimmer skeleton-badge" style="width: 50px;"></div>
            </div>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px; padding-top: 8px; border-top: 1px dashed var(--border-color, #e2e8f0);">
            <div class="skeleton-shimmer skeleton-line" style="width: 35%; height: 12px;"></div>
            <div class="skeleton-shimmer skeleton-line" style="width: 20%; height: 12px;"></div>
          </div>
        </div>
      `).join('');
    }

    if (tbody && (!this.patients || this.patients.length === 0)) {
      tbody.innerHTML = Array.from({ length: 4 }).map(() => `
        <tr>
          <td colspan="7" style="padding: 12px;">
            <div style="display: flex; align-items: center; gap: 12px;">
              <div class="skeleton-shimmer skeleton-avatar" style="width: 32px; height: 32px;"></div>
              <div class="skeleton-shimmer skeleton-line" style="width: 25%; height: 14px;"></div>
              <div class="skeleton-shimmer skeleton-line" style="width: 15%; height: 14px;"></div>
              <div class="skeleton-shimmer skeleton-line" style="width: 20%; height: 14px;"></div>
              <div class="skeleton-shimmer skeleton-line" style="width: 15%; height: 14px;"></div>
              <div class="skeleton-shimmer skeleton-line" style="width: 15%; height: 14px;"></div>
            </div>
          </td>
        </tr>
      `).join('');
    }
  }

  renderPatients() {
    const tbody = document.getElementById('patients-tbody');
    const mobileContainer = document.getElementById('patients-mobile-cards');
    if (!tbody) return;

    if (!this._hasLoadedOnce && (!this.patients || this.patients.length === 0)) {
      this.renderSkeleton();
      return;
    }

    const rawSearch = document.getElementById('patient-search-input')?.value.trim() || '';
    const filterType = document.getElementById('patient-filter-type')?.value || 'all';
    const normSearch = this.normalizeArabic(rawSearch);
    const cleanDigits = rawSearch.replace(/[^0-9]/g, '');

    const { todayIds, todayNames } = this.getTodayPatientIdentifiers();
    const countBadge = document.getElementById('badge-today-patients-count');
    
    // Count matches among all patients
    const todayMatches = this.patients.filter(p => {
      const pId = String(p.id || '').trim();
      const pName = this.normalizeArabic(p.name || '');
      return todayIds.has(pId) || (pName && todayNames.has(pName));
    });
    if (countBadge) countBadge.textContent = todayMatches.length;

    let filtered = this.patients.filter(p => {
      // 0. Filter Today Only if active
      if (this.filterTodayOnly) {
        const pId = String(p.id || '').trim();
        const pName = this.normalizeArabic(p.name || '');
        const isToday = todayIds.has(pId) || (pName && todayNames.has(pName));
        if (!isToday) return false;
      }
      // 1. Smart Normalized Arabic & Phone Search
      let matchSearch = true;
      if (rawSearch) {
        const normName = this.normalizeArabic(p.name);
        const normPhone = (p.phone || '').replace(/[^0-9]/g, '');
        const normComp = this.normalizeArabic(p.insuranceCompany || '');
        const normDoc = this.normalizeArabic(p.doctor || '');
        const normProg = this.normalizeArabic(p.programType || '');
        const normArea = this.normalizeArabic(p.clinicalSheet?.affectedArea || p.affectedArea || p.clinicalSheet?.diagnosis || p.diagnosis || '');
        const normAddr = this.normalizeArabic(p.address || '');

        matchSearch = 
          normName.includes(normSearch) ||
          (cleanDigits.length > 0 && normPhone.includes(cleanDigits)) ||
          normComp.includes(normSearch) ||
          normDoc.includes(normSearch) ||
          normProg.includes(normSearch) ||
          normArea.includes(normSearch) ||
          normAddr.includes(normSearch);
      }

      if (!matchSearch) return false;

      // 2. Billing Filter
      if (filterType === 'cash') return p.billing === 'cash';
      if (filterType === 'insurance_direct') return p.billing === 'insurance' && p.contractType === 'direct';
      if (filterType === 'insurance_indirect') return p.billing === 'insurance' && p.contractType === 'indirect';

      return true;
    });

    this.updateSortUI();
    const totalCountBadge = document.getElementById('patients-total-count-badge');
    if (totalCountBadge) {
      totalCountBadge.textContent = `${filtered.length} مريض`;
    }

    // 3. Smart Sorting (Search Relevance OR User Toggle: Recent / Alphabetical)
    if (rawSearch) {
      filtered.sort((a, b) => {
        const scoreA = this.getPatientSearchScore(a, rawSearch);
        const scoreB = this.getPatientSearchScore(b, rawSearch);
        if (scoreB !== scoreA) {
          return scoreB - scoreA;
        }
        return (a.name || '').localeCompare(b.name || '', 'ar');
      });
    } else {
      if (this.sortBy === 'alphabetical') {
        filtered.sort((a, b) => {
          const nameA = this.normalizeArabic(a.name || '');
          const nameB = this.normalizeArabic(b.name || '');
          return nameA.localeCompare(nameB, 'ar');
        });
      } else {
        filtered.sort((a, b) => {
          const timeA = a.createdAt || a.lastUpdatedAt || '';
          const timeB = b.createdAt || b.lastUpdatedAt || '';
          return timeB.localeCompare(timeA);
        });
      }
    }

    if (filtered.length === 0) {
      if (this.filterTodayOnly) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 36px 20px;">
          <i class="fa-solid fa-calendar-xmark" style="font-size: 1.8rem; color: var(--text-muted); margin-bottom: 8px; display: block;"></i>
          لا توجد حالات مسجلة في مواعيد أو جلسات اليوم.<br>
          <button type="button" class="btn btn-outline btn-sm" id="btn-reset-today-filter" style="margin-top: 10px;">
            عرض كافة المرضى
          </button>
        </td></tr>`;
        if (mobileContainer) {
          mobileContainer.innerHTML = `
            <div class="hero-styled-card" style="text-align: center; padding: 36px 20px;">
              <div style="width: 56px; height: 56px; border-radius: 50%; background: var(--primary-light); color: var(--primary); display: inline-flex; align-items: center; justify-content: center; font-size: 1.4rem; margin-bottom: 12px;">
                <i class="fa-solid fa-calendar-xmark"></i>
              </div>
              <div style="font-weight: 800; font-size: 1.05rem; color: var(--text-main);">لا توجد حالات مسجلة اليوم</div>
              <div style="font-size: 0.84rem; color: var(--text-muted); margin-top: 5px; margin-bottom: 16px;">لا توجد مواعيد أو جلسات مسجلة للمرضى لهذا اليوم.</div>
              <button type="button" class="btn btn-outline btn-sm" id="btn-reset-today-filter-mob" style="border-radius: 999px; padding: 8px 20px; font-weight: 700; color: var(--primary); border-color: var(--primary);">
                عرض كافة المرضى
              </button>
            </div>
          `;
          document.getElementById('btn-reset-today-filter-mob')?.addEventListener('click', () => this.toggleTodayFilter());
        }
        document.getElementById('btn-reset-today-filter')?.addEventListener('click', () => this.toggleTodayFilter());
        return;
      }

      if (rawSearch) {
        const emptySearchCard = `
          <div class="hero-styled-card" style="text-align: center; padding: 36px 20px;">
            <div style="width: 56px; height: 56px; border-radius: 50%; background: rgba(2, 132, 199, 0.12); color: var(--primary); display: inline-flex; align-items: center; justify-content: center; font-size: 1.4rem; margin-bottom: 12px;">
              <i class="fa-solid fa-magnifying-glass"></i>
            </div>
            <div style="font-weight: 800; font-size: 1.05rem; color: var(--text-main);">لا توجد نتائج مطابقة</div>
            <div style="font-size: 0.84rem; color: var(--text-muted); margin-top: 5px; margin-bottom: 16px;">لم يتم العثور على مريض مطابق لكلمة: <strong>"${escapeHTML(rawSearch)}"</strong></div>
            <button type="button" class="btn btn-primary btn-sm" onclick="patientsManager.openAddModal()" style="display: inline-flex; align-items: center; gap: 8px; border-radius: 999px; padding: 8px 20px; font-weight: 700;">
              <i class="fa-solid fa-user-plus"></i> <span>تسجيل مريض جديد الآن</span>
            </button>
          </div>
        `;
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 30px;">لا يوجد مرضى مطابقين لكلمة البحث: <strong>"${escapeHTML(rawSearch)}"</strong></td></tr>`;
        if (mobileContainer) mobileContainer.innerHTML = emptySearchCard;
        return;
      }

      if (filterType !== 'all') {
        const emptyFilterCard = `
          <div class="hero-styled-card" style="text-align: center; padding: 36px 20px;">
            <div style="width: 56px; height: 56px; border-radius: 50%; background: rgba(2, 132, 199, 0.12); color: var(--primary); display: inline-flex; align-items: center; justify-content: center; font-size: 1.4rem; margin-bottom: 12px;">
              <i class="fa-solid fa-filter"></i>
            </div>
            <div style="font-weight: 800; font-size: 1.05rem; color: var(--text-main);">لا توجد حالات بهذا النظام</div>
            <div style="font-size: 0.84rem; color: var(--text-muted); margin-top: 5px; margin-bottom: 16px;">لم يتم العثور على أي مريض مسجل بهذا النظام حالياً.</div>
            <button type="button" class="btn btn-primary btn-sm" onclick="patientsManager.openAddModal()" style="display: inline-flex; align-items: center; gap: 8px; border-radius: 999px; padding: 8px 20px; font-weight: 700;">
              <i class="fa-solid fa-user-plus"></i> <span>تسجيل مريض جديد الآن</span>
            </button>
          </div>
        `;
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 30px;">لا توجد حالات مسجلة بهذا النظام.</td></tr>`;
        if (mobileContainer) mobileContainer.innerHTML = emptyFilterCard;
        return;
      }

      if (!this._hasLoadedOnce) {
        this.renderSkeleton();
        return;
      }

      const emptyAllCard = `
        <div class="hero-styled-card" style="text-align: center; padding: 36px 20px;">
          <div style="width: 56px; height: 56px; border-radius: 50%; background: var(--primary-light); color: var(--primary); display: inline-flex; align-items: center; justify-content: center; font-size: 1.4rem; margin-bottom: 12px;">
            <i class="fa-solid fa-users"></i>
          </div>
          <div style="font-weight: 800; font-size: 1.05rem; color: var(--text-main);">سجل المرضى فارغ</div>
          <div style="font-size: 0.84rem; color: var(--text-muted); margin-top: 5px; margin-bottom: 16px;">لم يتم تسجيل أي مرضى بعد. ابدأ بإضافة أول مريض في المركز.</div>
          <button type="button" class="btn btn-primary btn-sm" onclick="patientsManager.openAddModal()" style="display: inline-flex; align-items: center; gap: 8px; border-radius: 999px; padding: 8px 20px; font-weight: 700;">
            <i class="fa-solid fa-user-plus"></i> <span>تسجيل مريض جديد الآن</span>
          </button>
        </div>
      `;
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 30px;">سجل المرضى فارغ.</td></tr>`;
      if (mobileContainer) mobileContainer.innerHTML = emptyAllCard;
      return;
    }

    const currentUser = auth.getCurrentUser();
    const canAccessSheet = RolesManager.canAccessClinicalSheet(currentUser);
    const canDeletePatient = RolesManager.canDeletePatient(currentUser);
    const isDoctor = currentUser?.role === 'doctor';

    setTimeout(() => this.setupScrollSync(), 50);

    // 1. Render Desktop Table
    tbody.innerHTML = filtered.map(p => {
      const isNewlyAdded = (p.id && p.id === this.newlyAddedPatientId);
      const rowHighlightClass = isNewlyAdded ? 'patient-row-newly-added' : '';
      let billingBadge = '';
      const safeComp = escapeHTML(p.insuranceCompany || 'تأمين');
      const approvedVisits = p.approvedSessions || 12;
      const approvedParts = p.approvedBodyParts || 1;
      if (p.billing === 'cash') {
        billingBadge = `<span class="badge badge-cash"><i class="fa-solid fa-money-bill"></i> نقدي</span>`;
      } else if (p.contractType === 'direct') {
        billingBadge = `<span class="badge badge-direct" title="${approvedVisits} زيارة معتمدة (${approvedParts} أعضاء)"><i class="fa-solid fa-file-contract"></i> ${safeComp} (${approvedVisits} زيارة - ${approvedParts} أعضاء)</span>`;
      } else {
        billingBadge = `<span class="badge badge-indirect" title="${approvedVisits} زيارة معتمدة (${approvedParts} أعضاء)"><i class="fa-solid fa-handshake"></i> ${safeComp} (${approvedVisits} زيارة - ${approvedParts} أعضاء)</span>`;
      }

      const safeId = escapeHTML(p.id);
      const safeName = escapeHTML(p.name);
      const safeAge = escapeHTML(p.age);
      const safePhone = escapeHTML(p.phone);
      const safeAddress = escapeHTML(p.address || '-');
      const areaInfo = this.getPatientTreatedAreaDisplay(p);
      const safeEditor = escapeHTML(p.lastUpdatedBy || p.createdBy || '-');
      const cleanWaPhone = (p.phone || '').replace(/[^0-9]/g, '').replace(/^0/, '20');
      const isFemale = (p.gender === 'female');
      const genderClass = isFemale ? 'gender-female' : 'gender-male';
      const genderBadgeClass = isFemale ? 'badge-gender-female' : 'badge-gender-male';
      const genderIcon = isFemale ? 'fa-solid fa-venus' : 'fa-solid fa-mars';
      const genderText = isFemale ? 'أنثى' : 'ذكر';


      return `
        <tr class="${genderClass} ${rowHighlightClass}">
          <td style="font-weight: 800; color: var(--primary); cursor: ${canAccessSheet ? 'pointer' : 'default'}; white-space: nowrap;"
              class="${canAccessSheet ? 'patient-sheet-link' : 'btn-edit-patient'}"
              data-patient-id="${safeId}"
              onclick="patientsManager.openPatientSheet('${safeId}')"
              title="${canAccessSheet ? 'اضغط لفتح الشيت الطبي' : 'تعديل بيانات المريض'}">
            <i class="fa-solid ${canAccessSheet ? 'fa-file-waveform' : 'fa-user'}" style="margin-left: 6px;"></i> ${safeName}
          </td>
          <td style="white-space: nowrap;"><span class="badge ${genderBadgeClass}" style="font-size: 0.74rem; padding: 2px 8px;"><i class="${genderIcon}"></i> ${genderText} • ${safeAge} سنة</span></td>
          <td style="white-space: nowrap;">
            <a href="tel:${safePhone}" style="color: var(--primary); text-decoration: none; white-space: nowrap; direction: ltr; display: inline-flex; align-items: center; gap: 4px;">
              <i class="fa-solid fa-phone" style="font-size: 0.75rem;"></i> <bdi dir="ltr">${safePhone}</bdi>
            </a>
          </td>
          <td style="white-space: nowrap;">${safeAddress}</td>
          <td style="white-space: nowrap;"><span class="patient-area-badge ${areaInfo.badgeClass}" style="font-size: 0.74rem; padding: 2px 8px; border-radius: 6px; display: inline-flex; align-items: center; gap: 5px;"><i class="${areaInfo.icon}"></i> ${escapeHTML(areaInfo.text)}</span></td>
          <td style="white-space: nowrap;">${billingBadge}</td>
          <td style="font-size: 0.8rem; color: var(--text-muted); white-space: nowrap;">${safeEditor}</td>
          <td style="white-space: nowrap;">
            <div style="display: flex; gap: 6px; align-items: center; flex-wrap: nowrap;">
              ${canAccessSheet ? `
                <button type="button" class="btn btn-primary btn-sm btn-patient-sheet-action" data-patient-id="${safeId}" title="شيت العلاج الطبيعي">
                  <i class="fa-solid fa-file-waveform"></i> الشيت الطبي
                </button>
              ` : ''}
              ${!isDoctor ? `
                <button type="button" class="btn btn-outline btn-sm btn-patient-docs" data-patient-id="${safeId}" style="color: #0284c7; border-color: #0284c7; font-weight: 700; gap: 4px; display: inline-flex; align-items: center;" title="المستندات والطباعة">
                  <i class="fa-solid fa-file-invoice"></i> <span style="font-size: 0.76rem;">مستندات</span>
                </button>
              ` : ''}
              <a href="https://wa.me/${cleanWaPhone}" target="_blank" class="btn btn-outline btn-sm" style="color: #10b981; border-color: #10b981;" title="محادثة واتساب">
                <i class="fa-brands fa-whatsapp"></i>
              </a>
              ${!isDoctor ? `
                <button type="button" class="btn btn-outline btn-sm btn-edit-patient" data-patient-id="${safeId}" title="تعديل بيانات المريض">
                  <i class="fa-solid fa-pen-to-square"></i>
                </button>
              ` : ''}
              ${!isDoctor && canDeletePatient ? `
                <button type="button" class="btn btn-outline btn-sm btn-delete-patient" style="color: var(--danger);" data-patient-id="${safeId}" title="حذف المريض">
                  <i class="fa-solid fa-trash"></i>
                </button>
              ` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');

    // 2. Render Handcrafted Mobile Cards (10 per page pagination)
    if (mobileContainer) {
      const pageLimit = this.pageSize || 10;
      const totalPages = Math.ceil(filtered.length / pageLimit) || 1;
      if (this.currentPage > totalPages) this.currentPage = totalPages;
      if (this.currentPage < 1) this.currentPage = 1;

      const startIdx = (this.currentPage - 1) * pageLimit;
      const visiblePatients = filtered.slice(startIdx, startIdx + pageLimit);

      mobileContainer.innerHTML = visiblePatients.map(p => {
        const isNewlyAdded = Boolean(p.id && p.id === this.newlyAddedPatientId);
        const rowHighlightClass = isNewlyAdded ? 'patient-row-newly-added' : '';
        let billingBadge = '';
        const safeComp = escapeHTML(p.insuranceCompany || 'تأمين');
        const approvedVisits = p.approvedSessions || 12;
        const approvedParts = p.approvedBodyParts || 1;
        if (p.billing === 'cash') {
          billingBadge = `<span class="badge badge-cash" style="font-size: 0.72rem; padding: 2px 7px; font-weight: 700; white-space: nowrap;"><i class="fa-solid fa-money-bill"></i> نقدي</span>`;
        } else if (p.contractType === 'direct') {
          billingBadge = `<span class="badge badge-direct" style="font-size: 0.72rem; padding: 2px 7px; font-weight: 700; max-width: 135px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-flex; align-items: center; gap: 3px;" title="${safeComp} - ${approvedVisits} زيارة (${approvedParts} أعضاء)"><i class="fa-solid fa-file-contract"></i> ${safeComp}</span>`;
        } else {
          billingBadge = `<span class="badge badge-indirect" style="font-size: 0.72rem; padding: 2px 7px; font-weight: 700; max-width: 135px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-flex; align-items: center; gap: 3px;" title="${safeComp} - ${approvedVisits} زيارة (${approvedParts} أعضاء)"><i class="fa-solid fa-handshake"></i> ${safeComp}</span>`;
        }

        const safeId = escapeHTML(p.id);
        const safeName = escapeHTML(p.name);
        const safeAge = escapeHTML(p.age);
        const safeAddress = escapeHTML(p.address || '');
        const mobileAreaInfo = this.getPatientTreatedAreaDisplay(p);
        const safeDoctor = escapeHTML(p.doctor || '');
  
        const isFemale = (p.gender === 'female');
        const genderClass = isFemale ? 'gender-female' : 'gender-male';
        const genderBadgeClass = isFemale ? 'badge-gender-female' : 'badge-gender-male';
        const genderIcon = isFemale ? 'fa-solid fa-venus' : 'fa-solid fa-mars';
        const genderText = isFemale ? 'أنثى' : 'ذكر';
        const avatarIcon = isFemale ? 'fa-solid fa-person-dress' : 'fa-solid fa-person';


        return `
          <div class="hero-styled-card hero-patient-card ${genderClass} ${rowHighlightClass}" style="padding: 11px 13px; margin-bottom: 10px; border-radius: 14px;">
            <!-- Row 1: Identity (Right) & Action Hub (Left) -->
            <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 8px;">
              <!-- Right Info: Avatar, Name, Gender/Age, Doctor Badge (No Phone Number) -->
              <div style="display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1;">
                <div class="hsc-avatar patient-avatar" style="width: 40px; height: 40px; font-size: 1.2rem; flex-shrink: 0; border-radius: 50%;">
                  <i class="${avatarIcon}"></i>
                </div>
                <div style="display: flex; flex-direction: column; gap: 3px; min-width: 0;">
                  <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                    <span class="hsc-patient-name" style="cursor: pointer; font-size: 0.98rem; font-weight: 800; line-height: 1.35;" onclick="patientsManager.openPatientSheet('${safeId}')" title="اضغط لفتح الشيت الطبي">${safeName}</span>
                    <span class="badge ${genderBadgeClass}" style="font-size: 0.68rem; padding: 2px 7px; border-radius: 999px;">
                      <i class="${genderIcon}"></i> ${genderText} • ${safeAge} سنة
                    </span>
                  </div>
                  <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 2px;">
                    <span class="patient-area-badge ${mobileAreaInfo.badgeClass}" style="font-size: 0.74rem; padding: 2px 8px; border-radius: 6px; display: inline-flex; align-items: center; gap: 5px;">
                      <i class="${mobileAreaInfo.icon}"></i> ${escapeHTML(mobileAreaInfo.text)}
                    </span>
                  </div>
                </div>
              </div>

              <!-- Left Action Hub: Insurance Badge on Top, Matched Actions Below -->
              <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 6px; flex-shrink: 0;">
                <div>${billingBadge}</div>
                <div style="display: flex; align-items: center; gap: 5px;">
                  ${!isDoctor ? `
                    <button type="button" class="btn btn-quick-attend" onclick="patientsManager.quickLogSession('${safeId}')" title="تسجيل جلسة سريعة لهذا المريض">
                      <i class="fa-solid fa-bolt"></i> <span>جلسة</span>
                    </button>
                  ` : ''}
                  ${canAccessSheet ? `
                    <button type="button" class="btn btn-hero-sheet btn-patient-sheet-action" onclick="patientsManager.openPatientSheet('${safeId}')" title="فتح الشيت الطبي">
                      <i class="fa-solid fa-file-waveform"></i> <span>الشيت</span>
                    </button>
                  ` : ''}
                </div>
              </div>
            </div>

            <!-- Row 2: Location/Address (Right) & Utility Icons (Left) -->
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-top: 7px; padding-top: 6px; border-top: 1px dashed var(--border-color);">
              <!-- Right: Address -->
              <div style="display: flex; align-items: center; gap: 5px; font-size: 0.76rem; min-width: 0; flex: 1;">
                <span class="hsc-meta-text" style="font-size: 0.74rem; gap: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                  <i class="fa-solid fa-location-dot" style="color: var(--primary);"></i> ${safeAddress && safeAddress !== '-' ? safeAddress : (CLINIC_CONFIG.contact?.city || 'المركز')}
                </span>
              </div>

              <!-- Left: Utility Tool Icons (WhatsApp, Docs, Edit, Delete) -->
              <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
                <button type="button" class="btn btn-outline btn-sm btn-icon-action btn-whatsapp-action" onclick="patientsManager.openWhatsAppTemplates('${escapeHTML(p.phone || '')}', '${safeName}', '${safeDoctor}')" style="color: #10b981; border-color: rgba(16, 185, 129, 0.35); background: rgba(16, 185, 129, 0.08); width: 28px; height: 28px; padding: 0; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%;" title="خيارات واتساب الذكية">
                  <i class="fa-brands fa-whatsapp" style="font-size: 0.92rem;"></i>
                </button>
                ${!isDoctor ? `
                  <button type="button" class="btn btn-outline btn-sm btn-icon-action btn-patient-docs" onclick="event.stopPropagation(); patientsManager.openPatientDocsModal('${safeId}')" style="width: 28px; height: 28px; padding: 0; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; font-size: 0.76rem; border-color: var(--border-color);" title="المستندات">
                    <i class="fa-solid fa-file-invoice text-primary"></i>
                  </button>
                  <button type="button" class="btn btn-outline btn-sm btn-icon-action btn-edit-patient" onclick="patientsManager.openEditModal('${safeId}')" style="width: 28px; height: 28px; padding: 0; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; font-size: 0.76rem; border-color: var(--border-color);" title="تعديل">
                    <i class="fa-solid fa-pen-to-square text-primary"></i>
                  </button>
                ` : ''}
                ${!isDoctor && canDeletePatient ? `
                  <button type="button" class="btn btn-outline btn-sm btn-icon-action btn-delete-patient" style="color: var(--danger); border-color: rgba(239, 68, 68, 0.35); background: rgba(239, 68, 68, 0.08); width: 28px; height: 28px; padding: 0; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; font-size: 0.76rem;" onclick="patientsManager.confirmDelete('${safeId}')" title="حذف">
                    <i class="fa-solid fa-trash"></i>
                  </button>
                ` : ''}
              </div>
            </div>
          </div>
        `;
      }).join('') + (totalPages > 1 ? `
        <div class="mobile-pagination-bar no-print">
          <button type="button" class="btn btn-outline btn-sm btn-page-nav" id="btn-patients-prev-page" ${this.currentPage <= 1 ? 'disabled style="opacity: 0.4; pointer-events: none;"' : ''}>
            <i class="fa-solid fa-chevron-right"></i> <span>السابق</span>
          </button>
          <div class="page-indicator">
            <span class="page-num-pill">صفحة ${this.currentPage} من ${totalPages}</span>
            <small class="page-range-sub">(${startIdx + 1} - ${Math.min(startIdx + pageLimit, filtered.length)} من ${filtered.length})</small>
          </div>
          <button type="button" class="btn btn-outline btn-sm btn-page-nav" id="btn-patients-next-page" ${this.currentPage >= totalPages ? 'disabled style="opacity: 0.4; pointer-events: none;"' : ''}>
            <span>التالي</span> <i class="fa-solid fa-chevron-left"></i>
          </button>
        </div>
      ` : '');

      if (totalPages > 1) {
        mobileContainer.querySelector('#btn-patients-prev-page')?.addEventListener('click', () => {
          if (this.currentPage > 1) {
            this.currentPage--;
            this.renderPatients();
            document.getElementById('card-patients-directory')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        });
        mobileContainer.querySelector('#btn-patients-next-page')?.addEventListener('click', () => {
          if (this.currentPage < totalPages) {
            this.currentPage++;
            this.renderPatients();
            document.getElementById('card-patients-directory')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        });
      }
    }
    this.applyViewModeUI();
  }


  // ================= Dynamic Patient Body Parts Resolution (Two-Way Session Sync) =================
  getPatientTreatedAreaDisplay(p) {
    if (!p) return { text: 'لم تحدد الأعضاء بعد', icon: 'fa-solid fa-bone', badgeClass: 'prog-regular' };

    const prog = (p.programType === 'pediatric') ? 'quadriplegia' : (p.programType || p.clinicalSheet?.programType || 'regular');
    const pParts = this.getPatientBodyParts(p);
    const hasParts = pParts.length > 0;
    const partsText = pParts.join(' • ');

    if (prog === 'quadriplegia') {
      return {
        text: hasParts ? `Quadriplegia • ${partsText}` : 'Quadriplegia',
        icon: 'fa-solid fa-wheelchair',
        badgeClass: 'prog-quadriplegia'
      };
    }

    if (prog === 'hemiplegia') {
      return {
        text: hasParts ? `Hemiplegia • ${partsText}` : 'Hemiplegia',
        icon: 'fa-solid fa-brain',
        badgeClass: 'prog-hemiplegia'
      };
    }

    if (prog === 'scoliosis') {
      return {
        text: hasParts ? `Scoliosis • ${partsText}` : 'Scoliosis',
        icon: 'fa-solid fa-arrows-split-up-and-left',
        badgeClass: 'prog-scoliosis'
      };
    }

    // Regular (عام / عظام)
    return {
      text: hasParts ? partsText : 'لم تحدد الأعضاء بعد',
      icon: 'fa-solid fa-bone',
      badgeClass: 'prog-regular'
    };
  }

  getPatientBodyParts(patient) {
    if (!patient) return [];
    if (Array.isArray(patient.bodyParts) && patient.bodyParts.length > 0) {
      return patient.bodyParts;
    }
    if (Array.isArray(patient.clinicalSheet?.bodyParts) && patient.clinicalSheet.bodyParts.length > 0) {
      return patient.clinicalSheet.bodyParts;
    }
    if (patient.affectedArea) {
      const split = patient.affectedArea.split(/[,،]/).map(s => s.trim()).filter(Boolean);
      if (split.length > 0) return split;
    }

    // Fallback: look in loaded sessions (today's sessions, month sessions, and session cache)
    const allAvailableSessions = [];
    if (this.app?.sessionsManager?.sessions) {
      allAvailableSessions.push(...this.app.sessionsManager.sessions);
    }
    if (typeof db !== 'undefined' && db._sessionDocCache) {
      allAvailableSessions.push(...db._sessionDocCache.values());
    }

    const patientSessions = allAvailableSessions.filter(s =>
      s && s.patientId === patient.id && Array.isArray(s.bodyParts) && s.bodyParts.length > 0
    );

    if (patientSessions.length > 0) {
      patientSessions.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      return patientSessions[0].bodyParts;
    }

    return [];
  }

  // ================= Patient Body Parts Multi-Picker Support =================
  updatePatientBodyPartsPreview(selectedParts = []) {
    this.selectedPatientBodyParts = Array.isArray(selectedParts) ? [...selectedParts] : [];
    const previewEl = document.getElementById('patient-body-parts-preview');
    const badgeEl = document.getElementById('patient-body-parts-badge');
    const hiddenInp = document.getElementById('p-body-parts');

    if (badgeEl) badgeEl.textContent = `${this.selectedPatientBodyParts.length} أعضاء`;
    if (hiddenInp) hiddenInp.value = JSON.stringify(this.selectedPatientBodyParts);

    if (previewEl) {
      if (this.selectedPatientBodyParts.length === 0) {
        previewEl.innerHTML = `<span style="color: var(--text-muted); font-size: 0.88rem;">-- اضغط لاختيار وتحديد الأعضاء المعالجة --</span>`;
      } else {
        previewEl.innerHTML = this.selectedPatientBodyParts.map(part => `
          <span class="clinical-selected-chip">
            <i class="fa-solid fa-bone"></i> <span>${escapeHTML(part)}</span>
          </span>
        `).join('');
      }
    }
  }

  // ================= 1-Tap Quick Attendance & Smart WhatsApp Action Sheet =================
  quickLogSession(patientId) {
    if (!patientId) return;
    const user = auth.getCurrentUser();
    if (user && user.role === 'doctor') {
      this.app.showAlert('تسجيل الجلسات متاح لموظفي الاستقبال والإدارة فقط.', 'صلاحية الاستقبال', 'warning');
      return;
    }
    this.app.switchView('sessions');
    setTimeout(() => {
      if (this.app.sessionsManager) {
        this.app.sessionsManager.selectPatient(patientId);
      }
    }, 150);
  }

  openWhatsAppTemplates(phone, name, doctor) {
    if (!phone || phone.length < 5) {
      this.app.showToast('لا يوجد رقم هاتف صالح مسجل لهذا المريض', 'warning');
      return;
    }
    const cleanPhone = phone.replace(/[^0-9]/g, '').replace(/^0/, '20');
    const displayPhone = (phone.startsWith('20') && phone.length === 12) ? '0' + phone.slice(2) : phone;
    const nameEl = document.getElementById('wa-modal-patient-name');
    const phoneEl = document.getElementById('wa-modal-patient-phone');
    if (nameEl) nameEl.textContent = name || 'المريض';
    if (phoneEl) phoneEl.textContent = displayPhone;

    const btnAppt = document.getElementById('btn-wa-tpl-appt');
    const btnRenew = document.getElementById('btn-wa-tpl-renew');
    const btnDirect = document.getElementById('btn-wa-tpl-direct');

    const apptMsg = `السلام عليكم ورحمة الله وبركاته أستاذ/ة ${name}،\nنذكركم بموعد جلستكم القادمة مع ${doctor || 'الطبيب المعالج'} ب${CLINIC_CONFIG.brandName}.\nنتمنى لكم دوام الصحة والعافية.`;
    const renewMsg = `السلام عليكم ورحمة الله وبركاته أستاذ/ة ${name}،\nنود إعلامكم باقتراب انتهاء الجلسات المعتمدة من شركة التأمين ب${CLINIC_CONFIG.shortName}، يرجى إحضار أصل تجديد الموافقة لمواصلة الخطة العلاجية دون انقطاع.\nشكراً لتعاونكم معنا.`;

    const openWhatsAppDirect = (msg) => {
      const url = msg 
        ? `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(msg)}`
        : `https://api.whatsapp.com/send?phone=${cleanPhone}`;
      window.open(url, '_blank');
      this.app.closeModal('modal-whatsapp-templates');
    };

    if (btnAppt) btnAppt.onclick = () => openWhatsAppDirect(apptMsg);
    if (btnRenew) btnRenew.onclick = () => openWhatsAppDirect(renewMsg);
    if (btnDirect) btnDirect.onclick = () => openWhatsAppDirect('');

    this.app.openModal('modal-whatsapp-templates');
  }

  // ================= Insurance Interactive Buttons for Patient Registration =================
  renderAllInsuranceChips() {
    // Companies are selected via Custom Picker
    const directCont = document.getElementById('p-ins-direct-container');
    const indirectCont = document.getElementById('p-ins-indirect-container');
    if (directCont) { directCont.innerHTML = ''; directCont.style.display = 'none'; }
    if (indirectCont) { indirectCont.innerHTML = ''; indirectCont.style.display = 'none'; }
  }

  renderInsuranceChips(contractType, containerId) {
    const container = document.getElementById(containerId);
    if (container) { container.innerHTML = ''; container.style.display = 'none'; }
    this.renderInsuranceQuickChips();
  }

  renderInsuranceQuickChips(contractType = null) {
    const cType = contractType || this.currentContractType || 'direct';
    const container = document.getElementById('p-insurance-quick-chips');
    if (!container) return;

    const companies = db.getInsuranceCompanies(cType) || [];
    const currentVal = document.getElementById('p-insurance-company')?.value || '';

    // Show top 8 companies as quick chips
    const quickList = companies.slice(0, 8);
    // Strict contract isolation: ONLY include currentVal if it actually belongs to this contractType
    if (currentVal && companies.includes(currentVal) && !quickList.includes(currentVal)) {
      quickList.unshift(currentVal);
    }

    container.innerHTML = quickList.map(comp => {
      const isSel = (comp === currentVal);
      return `
        <button type="button" class="ins-quick-chip ${isSel ? 'selected' : ''}" data-company="${escapeHTML(comp)}" data-contract="${cType}">
          <i class="fa-solid ${isSel ? 'fa-circle-check' : 'fa-building-shield'}"></i>
          <span>${escapeHTML(comp)}</span>
        </button>
      `;
    }).join('');

    // Attach click listeners to chips
    container.querySelectorAll('.ins-quick-chip').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const compName = btn.getAttribute('data-company');
        const contract = btn.getAttribute('data-contract') || cType;
        this.selectInsuranceCompany(contract, compName);
      });
    });
  }

  selectInsuranceCompany(contractType, compName) {
    if (this.insEditMode) return;

    const input = document.getElementById('p-insurance-company');
    if (input) input.value = compName;

    const preview = document.getElementById('p-selected-ins-preview');
    if (preview) {
      preview.innerHTML = `<span class="badge badge-success" style="font-size:0.75rem; padding: 2px 8px; border-radius: 999px;"><i class="fa-solid fa-check"></i> ${escapeHTML(compName)}</span>`;
    }

    const btnText = document.getElementById('p-insurance-btn-text');
    if (btnText) {
      const cLabel = contractType === 'direct' ? 'تعاقد مباشر' : 'تعاقد غير مباشر';
      btnText.innerHTML = `المختارة: <strong>${escapeHTML(compName)}</strong> (${cLabel}) - اضغط للتغيير`;
    }

    // Keep contract switcher radio in strict sync
    const contractRadios = document.querySelectorAll('input[name="p-contract-type"]');
    contractRadios.forEach(r => {
      if (r.value === contractType) r.checked = true;
    });
    this.currentContractType = contractType;

    this.renderInsuranceQuickChips(contractType);
  }

  onContractTypeChanged(contractType) {
    this.currentContractType = contractType;
    const directCont = document.getElementById('p-ins-direct-container');
    const indirectCont = document.getElementById('p-ins-indirect-container');
    if (directCont) directCont.style.display = 'none';
    if (indirectCont) indirectCont.style.display = 'none';

    // If current selected company does not belong to the newly selected contract, reset selection cleanly
    const companies = db.getInsuranceCompanies(contractType) || [];
    const compInput = document.getElementById('p-insurance-company');
    const currentVal = compInput?.value || '';
    if (currentVal && !companies.includes(currentVal)) {
      if (compInput) compInput.value = '';
      const preview = document.getElementById('p-selected-ins-preview');
      if (preview) preview.innerHTML = '';
      const btnText = document.getElementById('p-insurance-btn-text');
      if (btnText) btnText.innerHTML = 'بحث في كل الشركات أو إضافة شركة جديدة...';
    }

    this.renderInsuranceQuickChips(contractType);
  }

  toggleInsuranceEditMode() {
    const user = auth.getCurrentUser();
    if (!user || user.role === 'doctor') {
      this.app.showAlert('تعديل وحذف شركات التأمين متاح للإدارة والاستقبال فقط.', 'تنبيه');
      return;
    }

    this.insEditMode = !this.insEditMode;
    const isEdit = this.insEditMode;

    const btn = document.getElementById('btn-toggle-chips-ins-patient');
    if (btn) {
      if (isEdit) {
        btn.className = 'btn-edit-chips active';
        btn.innerHTML = '<i class="fa-solid fa-check"></i> <span class="edit-text">تم الانتهاء</span>';
      } else {
        btn.className = 'btn-edit-chips';
        btn.innerHTML = '<i class="fa-solid fa-pen-to-square"></i> <span class="edit-text">تعديل الشركات</span>';
      }
    }

    this.renderAllInsuranceChips();
  }

  async deleteInsuranceDirect(contractType, compName) {
    const user = auth.getCurrentUser();
    if (!user || user.role === 'doctor') return;

    const confirmed = await this.app.showConfirm(`هل أنت متأكد من حذف شركة "${compName}" نهائياً؟`, 'حذف شركة تأمين');
    if (confirmed) {
      await db.deleteInsuranceCompany(contractType, compName);
      this.renderAllInsuranceChips();
      this.app.showToast(`تم حذف شركة "${compName}" بنجاح`);
    }
  }


  validatePhoneLive() {
    const phoneInput = document.getElementById('p-phone');
    const feedback = document.getElementById('p-phone-feedback');
    if (!phoneInput) return false;

    let val = phoneInput.value.trim().replace(/[\s\-().]/g, '');
    if (val.startsWith('+20')) val = '0' + val.slice(3);
    else if (val.startsWith('20') && val.length === 12) val = '0' + val.slice(2);

    if (!val) {
      phoneInput.classList.remove('input-error', 'input-success');
      if (feedback) { feedback.style.display = 'none'; feedback.innerHTML = ''; }
      return false;
    }

    const isValid = /^01[0125][0-9]{8}$/.test(val);

    if (isValid) {
      phoneInput.classList.remove('input-error');
      phoneInput.classList.add('input-success');
      if (feedback) {
        feedback.className = 'form-feedback-msg success';
        feedback.style.display = 'flex';
        feedback.innerHTML = '<i class="fa-solid fa-circle-check" style="margin-top: 2px;"></i> <span>رقم موبايل مصري صحيح ومكتمل (11 رقماً).</span>';
      }
      return true;
    } else {
      phoneInput.classList.remove('input-success');
      phoneInput.classList.add('input-error');
      let whatIsWrong = '';
      let whatToDo = 'اكتب 11 رقماً يبدأ بأحد شبكات المحمول المصرية (010، 011، 012، 015).';

      if (!val.startsWith('01')) {
        whatIsWrong = 'الرقم لا يبدأ بـ 01.';
      } else if (val.length >= 3 && !/^01[0125]/.test(val)) {
        whatIsWrong = `كود الشبكة (${val.slice(0, 3)}) غير معروف.`;
      } else if (val.length < 11) {
        whatIsWrong = `الرقم ناقص (${val.length} أرقام فقط من 11).`;
      } else if (val.length > 11) {
        whatIsWrong = `الرقم زائد عن 11 رقماً (${val.length} رقماً).`;
      } else {
        whatIsWrong = 'صيغة الرقم غير صحيحة.';
      }

      if (feedback) {
        feedback.className = 'form-feedback-msg error';
        feedback.style.display = 'flex';
        feedback.innerHTML = `<i class="fa-solid fa-circle-exclamation" style="margin-top: 2px; flex-shrink: 0;"></i> <div><strong>خطأ:</strong> ${whatIsWrong}<br><span style="color: #7f1d1d;"><strong>الصحيح:</strong> ${whatToDo}</span></div>`;
      }
      return false;
    }
  }

  clearPhoneValidation() {
    const phoneInput = document.getElementById('p-phone');
    const feedback = document.getElementById('p-phone-feedback');
    if (phoneInput) phoneInput.classList.remove('input-error', 'input-success');
    if (feedback) { feedback.style.display = 'none'; feedback.innerHTML = ''; }
  }

  updateApprovalUnitsSummary(scope = 'patient') {
    if (scope === 'patient') {
      const v = parseInt(document.getElementById('p-approved-sessions')?.value) || 12;
      const p = parseInt(document.getElementById('p-approved-body-parts')?.value) || 1;
      const totalUnits = v * p;
      const txt = document.getElementById('p-approval-units-text');
      if (txt) {
        txt.textContent = `الرصيد: ${v} زيارة للمريض • يعادل ${totalUnits} جلسة/وحدة عمل للطبيب (${v} زيارة × ${p} عضو)`;
      }
    } else if (scope === 'renew') {
      const v = parseInt(document.getElementById('renew-sessions-count')?.value) || 12;
      const p = parseInt(document.getElementById('renew-approved-body-parts')?.value) || 1;
      const totalUnits = v * p;
      const txt = document.getElementById('renew-approval-units-text');
      if (txt) {
        txt.textContent = `الرصيد: ${v} زيارة للمريض • يعادل ${totalUnits} جلسة/وحدة عمل للطبيب (${v} زيارة × ${p} عضو)`;
      }
    }
  }

  setGender(gender) {
    const hiddenInp = document.getElementById('p-gender');
    if (hiddenInp) hiddenInp.value = gender;
    this.updateGenderToggleUI(gender);
  }

  updateGenderToggleUI(gender) {
    const maleBtn = document.getElementById('btn-gender-male');
    const femaleBtn = document.getElementById('btn-gender-female');
    if (maleBtn && femaleBtn) {
      if (gender === 'female') {
        maleBtn.classList.remove('active');
        femaleBtn.classList.add('active');
      } else {
        femaleBtn.classList.remove('active');
        maleBtn.classList.add('active');
      }
    }
  }

  openAddModal() {
    document.getElementById('form-patient').reset();
    this.clearPhoneValidation();
    document.getElementById('p-id').value = '';
    this.setGender('male');
    this.updatePatientBodyPartsPreview([]);
    const insComp = document.getElementById('p-insurance-company');
    if (insComp) insComp.value = '';
    const insPrev = document.getElementById('p-selected-ins-preview');
    if (insPrev) insPrev.textContent = '';
    const insBtnText = document.getElementById('p-insurance-btn-text');
    if (insBtnText) insBtnText.textContent = 'بحث في كل الشركات أو إضافة شركة جديدة...';
    this.renderInsuranceQuickChips('direct');
    document.querySelectorAll('#p-ins-direct-container .insurance-company-card, #p-ins-indirect-container .insurance-company-card').forEach(btn => {
      btn.classList.remove('selected');
    });
    document.getElementById('modal-patient-title').innerHTML = '<i class="fa-solid fa-user-plus"></i> تسجيل مريض جديد';
    document.getElementById('p-insurance-details').style.display = 'none';
    const appSessionsInp = document.getElementById('p-approved-sessions');
    if (appSessionsInp) appSessionsInp.value = '12';
    const appPartsSelect = document.getElementById('p-approved-body-parts');
    if (appPartsSelect) appPartsSelect.value = '1';
    this.app.updateCustomSelectDisplay('p-approved-body-parts');
    this.updateApprovalUnitsSummary('patient');
    this.onContractTypeChanged('direct');
    const directRadio = document.querySelector('input[name="p-contract-type"][value="direct"]');
    if (directRadio) directRadio.checked = true;
    this.app.openModal('modal-patient');
  }

  openEditModalFromSheet(patientId) {
    this.editingFromSheet = true;
    this.openEditModal(patientId);
  }

  async confirmDeleteFromSheet(patientId) {
    const p = this.patients.find(item => item.id === patientId);
    if (!p) return;

    const confirmed = await this.app.showConfirm(
      `هل أنت متأكد من حذف ملف المريض (${p.name}) نهائياً من المركز؟`,
      'حذف المريض'
    );

    if (confirmed) {
      await db.deletePatient(patientId);
      await db.logAudit('حذف مريض', `قام بحذف ملف المريض: ${p.name}`, auth.getCurrentUser());
      await this.loadPatients();
      this.app.switchView('patients');
      this.app.showToast(`تم حذف ملف المريض (${p.name}) بنجاح`);
    }
  }

  openEditModal(patientId) {
    const p = this.patients.find(item => item.id === patientId);
    if (!p) return;

    document.getElementById('p-id').value = p.id;
    document.getElementById('p-name').value = p.name;
    document.getElementById('p-age').value = p.age;
    this.setGender(p.gender === 'female' ? 'female' : 'male');
    document.getElementById('p-phone').value = p.phone;
    document.getElementById('p-address').value = p.address || '';
    const initialParts = this.getPatientBodyParts(p);
    this.updatePatientBodyPartsPreview(initialParts);

    const progRadios = document.querySelectorAll('input[name="p-program-type"]');
    const pProg = (p.programType === 'pediatric') ? 'quadriplegia' : (p.programType || 'regular');
    progRadios.forEach(r => { r.checked = (r.value === pProg); });
    const isIns = (p.billing === 'insurance') || (!p.billing && Boolean(p.insuranceCompany && String(p.insuranceCompany).trim().length > 0)) || (p.payType === 'insurance');
    const effectiveBilling = isIns ? 'insurance' : 'cash';
    const billingRadios = document.querySelectorAll('input[name="p-billing"]');
    billingRadios.forEach(r => { r.checked = (r.value === effectiveBilling); });

    const insBox = document.getElementById('p-insurance-details');
    if (effectiveBilling === 'insurance') {
      insBox.style.display = 'block';
      document.getElementById('p-insurance-company').value = p.insuranceCompany || '';
      const cType = p.contractType || 'direct';
      if (p.insuranceCompany) {
        this.selectInsuranceCompany(cType, p.insuranceCompany);
      } else {
        const insBtnText = document.getElementById('p-insurance-btn-text');
        if (insBtnText) insBtnText.textContent = 'بحث في كل الشركات أو إضافة شركة جديدة...';
    this.renderInsuranceQuickChips('direct');
      }
      const contractRadios = document.querySelectorAll('input[name="p-contract-type"]');
      contractRadios.forEach(r => { r.checked = (r.value === cType); });
      this.onContractTypeChanged(cType);
      const appSessionsInp = document.getElementById('p-approved-sessions');
      if (appSessionsInp) appSessionsInp.value = p.approvedSessions || 12;
      const appPartsSelect = document.getElementById('p-approved-body-parts');
      if (appPartsSelect) appPartsSelect.value = String(p.approvedBodyParts || 1);
      this.app.updateCustomSelectDisplay('p-approved-body-parts');
      this.updateApprovalUnitsSummary('patient');
    } else {
      insBox.style.display = 'none';
    }

    document.getElementById('modal-patient-title').innerHTML = '<i class="fa-solid fa-pen-to-square"></i> تعديل بيانات مريض';
    this.app.openModal('modal-patient');
  }

  async handleSavePatient(e) {
    e.preventDefault();
    const saveBtn = document.getElementById('btn-save-patient');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الحفظ...';
      setTimeout(() => {
        saveBtn.disabled = false;
        saveBtn.innerHTML = 'حفظ المريض';
      }, 1500);
    }
    const currentUser = auth.getCurrentUser();
    const id = document.getElementById('p-id').value;
    const name = document.getElementById('p-name').value.trim();
    const age = parseInt(document.getElementById('p-age').value);
    const gender = document.getElementById('p-gender').value;
    const phone = document.getElementById('p-phone').value.trim();
    const address = document.getElementById('p-address').value.trim();
    const selectedParts = this.selectedPatientBodyParts || [];
    const billing = document.querySelector('input[name="p-billing"]:checked')?.value || 'cash';

    // 1. Name Validation (must be at least 2 words and not contain numbers)
    const nameWords = name.split(/\s+/).filter(w => w.length > 0);
    if (nameWords.length < 2 || name.length < 5) {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = 'حفظ المريض'; }
      await this.app.showAlert('يرجى إدخال اسم المريض ثنائياً على الأقل (الاسم واسم العائلة).', 'اسم المريض غير مكتمل', 'warning');
      document.getElementById('p-name')?.focus();
      return;
    }
    if (/[0-9]/.test(name)) {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = 'حفظ المريض'; }
      await this.app.showAlert('اسم المريض يجب ألا يحتوي على أرقام.', 'خطأ في الاسم', 'warning');
      document.getElementById('p-name')?.focus();
      return;
    }

    // 2. Age Validation (must be between 1 and 120)
    if (isNaN(age) || age < 1 || age > 120) {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = 'حفظ المريض'; }
      await this.app.showAlert('يرجى إدخال سن صحيح للمريض (بين 1 و 120 سنة).', 'خطأ في السن', 'warning');
      document.getElementById('p-age')?.focus();
      return;
    }

    // 2.أ. Gender Validation
    if (gender !== 'male' && gender !== 'female') {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = 'حفظ المريض'; }
      await this.app.showAlert('يرجى اختيار نوع المريض (ذكر / أنثى).', 'بيانات ناقصة', 'warning');
      document.getElementById('p-gender')?.focus();
      return;
    }

    // 3. Strict Egyptian Mobile Phone Validation (010, 011, 012, 015 - exactly 11 digits)
    let cleanPhone = phone.replace(/[\s\-().]/g, '');
    if (cleanPhone.startsWith('+20')) cleanPhone = '0' + cleanPhone.slice(3);
    else if (cleanPhone.startsWith('20') && cleanPhone.length === 12) cleanPhone = '0' + cleanPhone.slice(2);

    const egyptianMobileRegex = /^01[0125][0-9]{8}$/;
    if (!egyptianMobileRegex.test(cleanPhone)) {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = 'حفظ المريض'; }
      const phoneInput = document.getElementById('p-phone');
      phoneInput?.classList.add('input-error');

      let whatIsWrong = '';
      if (!cleanPhone.startsWith('01')) {
        whatIsWrong = `الرقم المدخل (${cleanPhone}) لا يبدأ بـ 01.`;
      } else if (cleanPhone.length !== 11) {
        whatIsWrong = `عدد أرقام الهاتف الحالي (${cleanPhone.length} أرقام) والمطلوب 11 رقماً.`;
      } else {
        whatIsWrong = `كود الشبكة (${cleanPhone.slice(0, 3)}) غير معتمد في شبكات مصر.`;
      }

      const alertMsg = `⚠️ خطأ في رقم الموبايل:\n${whatIsWrong}\n\n✅ كيف تملأ الحقل بشكل صحيح؟\nيجب كتابة 11 رقماً بالضبط، يبدأ بأحد أكواد شبكات المحمول:\n• 010 (فودافون)\n• 011 (إتصالات)\n• 012 (أورنج)\n• 015 (وي)\n\nمثال صحيح: 01012345678`;

      await this.app.showAlert(alertMsg, 'رقم الموبايل غير صحيح', 'warning');
      phoneInput?.focus();
      return;
    }
    const normalizedPhone = cleanPhone;

    // Duplicate Phone Check for new patients
    if (!id) {
      const existingPatient = this.patients.find(p => p.phone === normalizedPhone);
      if (existingPatient) {
        const confirmDup = await this.app.showConfirm(
          `رقم الهاتف (${normalizedPhone}) مسجل بالفعل للمريض (${existingPatient.name}). هل ترغب في الاستمرار وتسجيل ملف جديد بنفس الرقم؟`,
          'تنبيه رقم مكرر'
        );
        if (!confirmDup) {
          if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = 'حفظ المريض'; }
          return;
        }
      }
    }



    // 5. Insurance Company Validation
    let insuranceCompany = '';
    let contractType = '';
    if (billing === 'insurance') {
      insuranceCompany = document.getElementById('p-insurance-company').value.trim();
      if (!insuranceCompany || insuranceCompany.length < 2) {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = 'حفظ المريض'; }
        await this.app.showAlert('يرجى كتابة أو اختيار اسم شركة التأمين أو جهة التعاقد.', 'جهة التأمين مطلوبة', 'warning');
        document.getElementById('p-insurance-company')?.focus();
        return;
      }
      contractType = document.querySelector('input[name="p-contract-type"]:checked')?.value || document.querySelector('input[name="p-contract"]:checked')?.value || 'direct';
    }

    let approvedSessions = 12;
    let approvedBodyParts = 1;
    if (billing === 'insurance') {
      approvedSessions = parseInt(document.getElementById('p-approved-sessions')?.value) || 12;
      approvedBodyParts = parseInt(document.getElementById('p-approved-body-parts')?.value) || 1;
    }

    const programType = document.querySelector('input[name="p-program-type"]:checked')?.value || 'regular';

    const existingP = id ? this.patients.find(p => p.id === id) : null;
    const doctor = existingP?.doctor || '';
    const doctorUid = existingP?.doctorUid || '';
    const partsText = selectedParts.join('، ');

    const patientData = {
      id: id || null,
      name,
      age,
      gender,
      phone: normalizedPhone,
      address,
      doctor,
      doctorUid,
      bodyParts: selectedParts,
      affectedArea: partsText || existingP?.affectedArea || '',
      diagnosis: partsText || existingP?.diagnosis || '',
      programType,
      billing,
      insuranceCompany,
      contractType,
      approvedSessions,
      approvedBodyParts
    };

    if (!id && billing === 'insurance') {
      patientData.currentApprovalStartDate = getLocalDateStr();
    } else if (id && billing === 'insurance') {
      patientData.currentApprovalStartDate = existingP?.currentApprovalStartDate || getLocalDateStr();
    }

    try {
      const isNew = !id;
      const actionResult = await db.savePatient(patientData, currentUser);
      const savedId = (actionResult && actionResult.id) ? actionResult.id : (patientData.id || id);
      const auditDesc = id 
        ? `تعديل ملف المريض: ${name}`
        : `تسجيل مريض جديد: ${name} (نظام: ${billing})`;
        
      try { await db.logAudit(id ? 'تعديل مريض' : 'إضافة مريض', auditDesc, currentUser); } catch (_) {}

      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = 'حفظ المريض';
      }

      this.app.closeModal('modal-patient');
      this.renderAllInsuranceChips();
      await this.loadPatients(true);
      this.renderPatients();

      if (isNew && savedId) {
        this.pendingPromptPatientId = savedId;
        this.newlyAddedPatientId = savedId;
        const promptName = document.getElementById('action-prompt-patient-name');
        if (promptName) promptName.textContent = name;
        this.app.openModal('modal-patient-action-prompt');
      } else {
        this.app.showToast('تم تعديل بيانات المريض بنجاح');
      }
    } catch (err) {
      console.error('handleSavePatient error:', err);
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = 'حفظ المريض';
      }
      await this.app.showAlert('تعذر حفظ بيانات المريض: ' + err.message, 'خطأ في الحفظ', 'danger');
    }
  }

  async confirmDelete(patientId) {
    const p = this.patients.find(item => item.id === patientId);
    if (!p) return;

    const confirmed = await this.app.showConfirm(`هل أنت متأكد من حذف ملف المريض: ${p.name}؟ هذا الإجراء لا يمكن التراجع عنه.`, 'تأكيد حذف المريض');
    if (confirmed) {
      const currentUser = auth.getCurrentUser();
      await db.deletePatient(patientId);
      await db.logAudit('حذف مريض', `قام بحذف ملف المريض: ${p.name}`, currentUser);
      this.app.showToast('تم حذف ملف المريض');
      this.renderAllInsuranceChips();
    await this.loadPatients();
    }
  }

  openRenewApprovalModal(patientId) {
    const patient = this.patients.find(p => p.id === patientId);
    if (!patient) return;

    this.openedFromDocs = true;
    this.activeDocsPatientId = patientId;
    this.app.closeModal('modal-patient-docs', { skipHistory: true });

    document.getElementById('renew-patient-id').value = patient.id;
    document.getElementById('renew-patient-name').textContent = patient.name;
    const cTypeLabel = patient.contractType === 'indirect' ? 'تعاقد غير مباشر' : 'تعاقد مباشر';
    document.getElementById('renew-company-name').textContent = `${patient.insuranceCompany || 'شركة التأمين'} (${cTypeLabel})`;
    document.getElementById('renew-sessions-count').value = patient.approvedSessions || 12;
    const renewPartsSelect = document.getElementById('renew-approved-body-parts');
    if (renewPartsSelect) renewPartsSelect.value = String(patient.approvedBodyParts || 1);
    this.app.updateCustomSelectDisplay('renew-approved-body-parts');
    this.updateApprovalUnitsSummary('renew');
    document.getElementById('renew-approval-date').value = getLocalDateStr();
    document.getElementById('renew-approval-no').value = patient.insuranceApprovalNo || '';

    this.app.openModal('modal-renew-approval', { noSlide: true, alreadyInHistory: true });
  }

  async handleConfirmRenewApproval(e) {
    e.preventDefault();
    const pid = document.getElementById('renew-patient-id')?.value;
    const newSessions = parseInt(document.getElementById('renew-sessions-count')?.value) || 12;
    const newParts = parseInt(document.getElementById('renew-approved-body-parts')?.value) || patient?.approvedBodyParts || 1;
    const renewDate = document.getElementById('renew-approval-date')?.value || getLocalDateStr();
    const newApprovalNo = document.getElementById('renew-approval-no')?.value?.trim() || '';

    const patient = this.patients.find(p => p.id === pid);
    if (!patient) return;

    try {
      const currentUser = auth.getCurrentUser();
      const updates = {
        approvedSessions: newSessions,
        approvedBodyParts: newParts,
        currentApprovalStartDate: renewDate,
        lastRenewalDate: renewDate,
        lastRenewedBy: currentUser?.name || 'الاستقبال'
      };
      if (newApprovalNo) {
        updates.insuranceApprovalNo = newApprovalNo;
      }

      await db.savePatient({ ...patient, ...updates }, currentUser);
      try {
        await db.logAudit(
          'تجديد موافقة تأمين',
          `تجديد موافقة التأمين للمريض ${patient.name} (${newSessions} جلسة - سريان من ${renewDate})`,
          currentUser
        );
      } catch (_) {}

      this.app.closeModal('modal-renew-approval');
      this.app.showToast(`تم تجديد جواب الموافقة للمريض (${patient.name}) وبدء دورة جديدة (${newSessions} جلسة) بنجاح.`);
      await this.loadPatients();
      if (this.app?.sessionsManager?.loadTodaySessions) {
        await this.app.sessionsManager.loadTodaySessions();
      }
    } catch (err) {
      this.app.showAlert('تعذر تجديد الموافقة: ' + err.message, 'خطأ', 'danger');
    }
  }

  // ================= Clinical Patient Sheet =================
  // ================= Top & Bottom Horizontal Scroll Synchronization =================
  setViewMode(mode) {
    this.viewMode = mode;
    try { localStorage.setItem('ascpt_patients_view_mode', mode); } catch (_) {}
    this.applyViewModeUI();
  }

  applyViewModeUI() {
    this.viewMode = 'cards';
    const tableContainer = document.getElementById('patients-table-container');
    const cardsContainer = document.getElementById('patients-mobile-cards');
    const topWrap = document.getElementById('patients-top-scroll-wrap');
    const toggleGroup = document.getElementById('patients-view-mode-toggle');

    if (tableContainer) tableContainer.style.display = 'none';
    if (cardsContainer) cardsContainer.style.display = 'grid';
    if (topWrap) topWrap.style.display = 'none';
    if (toggleGroup) toggleGroup.style.display = 'none';
  }

  setupScrollSync() {
    const topWrap = document.getElementById('patients-top-scroll-wrap');
    const container = document.getElementById('patients-table-container') || document.querySelector('#view-patients .table-responsive');
    const dummy = document.getElementById('patients-top-scroll-dummy');
    const table = document.getElementById('patients-data-table');

    if (!topWrap || !container || !dummy || !table) return;

    const syncMetrics = () => {
      if (table.scrollWidth > container.clientWidth) {
        dummy.style.width = table.scrollWidth + 'px';
        topWrap.style.display = 'block';
      } else {
        topWrap.style.display = 'none';
      }
    };

    setTimeout(syncMetrics, 60);
    window.addEventListener('resize', syncMetrics);

    let isTopScrolling = false;
    let isTableScrolling = false;

    topWrap.onscroll = () => {
      if (!isTopScrolling) {
        isTableScrolling = true;
        container.scrollLeft = topWrap.scrollLeft;
      }
      isTopScrolling = false;
    };

    container.onscroll = () => {
      if (!isTableScrolling) {
        isTopScrolling = true;
        topWrap.scrollLeft = container.scrollLeft;
      }
      isTableScrolling = false;
    };
  }

  async openPatientSheet(patientId, fallbackName = null) {
    const currentUser = auth.getCurrentUser();
    if (!RolesManager.canAccessClinicalSheet(currentUser)) {
      this.app.showAlert('الدخول على الشيت الطبي متاح للأطباء المعالجين ومدير المركز فقط.', 'صلاحية الأطباء');
      return;
    }

    if (!this.patients || this.patients.length === 0) {
      await this.loadPatients();
    }

    let p = (this.patients || []).find(item => item.id === patientId || String(item.id) === String(patientId));
    if (!p && fallbackName) {
      p = (this.patients || []).find(item => item.name === fallbackName);
    }
    if (!p && patientId) {
      p = (this.patients || []).find(item => item.name === patientId);
    }
    if (!p) {
      await this.loadPatients(true);
      p = (this.patients || []).find(item => item.id === patientId || String(item.id) === String(patientId) || item.name === patientId || (fallbackName && item.name === fallbackName));
    }
    if (!p) {
      this.app.showAlert('تعذر العثور على ملف هذا المريض في السجلات.', 'تنبيه');
      return;
    }

    this.currentSheetPatient = p;
    const sheet = p.clinicalSheet || {};

    // 0. Load Patient Past Sessions (Zero-Cost Scoped Patient Lookup)
    try {
      const pSessions = await db.getSessionsForPatient(p.id);
      pSessions.sort((a, b) => new Date(b.date) - new Date(a.date));
      this.currentPatientSessions = pSessions;

      const actualSessions = pSessions.filter(s => s.entryType !== 'examination');
      const examCount = pSessions.length - actualSessions.length;
      
      const sessBadge = document.getElementById('sheet-sessions-badge-count');
      if (sessBadge) {
        if (examCount > 0 && actualSessions.length > 0) {
          sessBadge.textContent = `${actualSessions.length} جلسة • ${examCount} كشف`;
        } else if (examCount > 0) {
          sessBadge.textContent = `${examCount} كشف طبي`;
        } else {
          sessBadge.textContent = `${actualSessions.length} جلسة`;
        }
      }
    } catch (e) {
      this.currentPatientSessions = [];
    }

    // 1. Fill Header info with Pattern A (Gender Customization: Male / Female)
    const isFemale = (p.gender === 'female');
    const cardEl = document.getElementById('patient-clinical-card');
    if (cardEl) {
      cardEl.classList.remove('gender-male', 'gender-female');
      cardEl.classList.add(isFemale ? 'gender-female' : 'gender-male');
    }

    const avatarIcon = document.getElementById('sheet-pcm-avatar-icon');
    if (avatarIcon) {
      avatarIcon.className = isFemale ? 'fa-solid fa-person-dress' : 'fa-solid fa-person';
    }

    const nameEl = document.getElementById('sheet-patient-name');
    if (nameEl) nameEl.textContent = p.name;

    const ageEl = document.getElementById('sheet-patient-age');
    if (ageEl) ageEl.textContent = p.age || '-';

    const genderBadge = document.getElementById('sheet-patient-gender-badge');
    const genderIcon = document.getElementById('sheet-gender-icon');
    const genderText = document.getElementById('sheet-patient-gender-text');
    if (genderBadge) {
      genderBadge.className = isFemale ? 'badge badge-gender-female' : 'badge badge-gender-male';
    }
    if (genderIcon) {
      genderIcon.className = isFemale ? 'fa-solid fa-venus' : 'fa-solid fa-mars';
    }
    if (genderText) {
      genderText.textContent = isFemale ? 'أنثى' : 'ذكر';
    }

    const phoneEl = document.getElementById('sheet-patient-phone');
    if (phoneEl) phoneEl.textContent = p.phone || '-';

    const addrEl = document.getElementById('sheet-patient-address');
    if (addrEl) addrEl.textContent = p.address || 'غير محدد';

    // Auto-resolve first session doctor if patient.doctor is empty
    if ((!p.doctor || p.doctor === '' || p.doctor === 'طبيب المركز') && Array.isArray(this.currentPatientSessions) && this.currentPatientSessions.length > 0) {
      const sortedChronological = [...this.currentPatientSessions].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      const firstSessionWithDoctor = sortedChronological.find(s => s.doctor && s.doctor.trim().length > 0);
      if (firstSessionWithDoctor) {
        p.doctor = firstSessionWithDoctor.doctor;
        p.doctorUid = firstSessionWithDoctor.doctorUid || '';
        if (db && typeof db.savePatient === 'function') {
          db.savePatient(p, auth.getCurrentUser()).catch(() => {});
        }
      }
    }

    const docEl = document.getElementById('sheet-patient-doctor');
    if (docEl) docEl.textContent = p.doctor || 'طبيب المركز';

    const phoneLink = document.getElementById('sheet-patient-phone-link');
    if (phoneLink) {
      const cleanPhone = (p.phone || '').replace(/[^0-9]/g, '');
      phoneLink.href = `tel:${cleanPhone}`;
    }

        const badgeEl = document.getElementById('sheet-patient-billing-badge');
    const sessBtnText = document.getElementById('sheet-sessions-btn-text');
    const sessBtn = document.getElementById('btn-view-patient-sessions');
    const insLetterBtn = document.getElementById('btn-print-insurance-letter');
    if (insLetterBtn) insLetterBtn.style.display = (p.billing === 'cash') ? 'none' : 'inline-flex';

    if (badgeEl) {
      const therapySessions = this.currentPatientSessions.filter(s => s.entryType !== 'examination');
      const examCount = this.currentPatientSessions.length - therapySessions.length;
      const therapyCount = therapySessions.length;

      if (p.billing === 'cash') {
        badgeEl.innerHTML = '<span class="badge badge-cash" style="font-size: 0.78rem; padding: 4px 10px; font-weight: 700; white-space: nowrap; display: inline-flex; align-items: center; gap: 5px;"><i class="fa-solid fa-money-bill-wave"></i> نقدي</span>';
        if (sessBtnText) {
          if (examCount > 0 && therapyCount > 0) {
            sessBtnText.innerHTML = `سجل الجلسات (<strong>${therapyCount}</strong> جلسة • <strong>${examCount}</strong> كشف)`;
          } else if (examCount > 0) {
            sessBtnText.innerHTML = `سجل الحركات (<strong>${examCount}</strong> كشف)`;
          } else {
            sessBtnText.innerHTML = `سجل الجلسات (<strong>${therapyCount}</strong>)`;
          }
        }
        if (sessBtn) {
          sessBtn.className = 'pcm-sessions-chip';
        }
      } else {
        const cType = p.contractType === 'direct' ? 'مباشر' : 'غير مباشر';
        const badgeClass = p.contractType === 'direct' ? 'badge-direct' : 'badge-indirect';
        const iconClass = p.contractType === 'direct' ? 'fa-file-contract' : 'fa-handshake';
        const approvedTotal = p.approvedSessions || 12;
        const cycleStart = p.currentApprovalStartDate || '';
        const cycleSessions = this.currentPatientSessions.filter(s => s.entryType !== 'examination' && (!cycleStart || (s.date || '').localeCompare(cycleStart) >= 0));
        const currentCount = cycleSessions.length;
        const isNearLimit = currentCount >= approvedTotal - 2;
        const isCompleted = currentCount >= approvedTotal;

        badgeEl.innerHTML = `<span class="badge ${badgeClass}" style="font-size: 0.78rem; padding: 4px 10px; font-weight: 700; display: inline-flex; align-items: center; gap: 5px;"><i class="fa-solid ${iconClass}"></i> ${escapeHTML(p.insuranceCompany || 'تأمين')} (${cType})</span>`;

        if (sessBtnText) {
          let extraStatus = '';
          if (isCompleted) extraStatus = ' <i class="fa-solid fa-circle-exclamation text-danger" title="اكتملت الموافقة"></i>';
          else if (isNearLimit) extraStatus = ' <i class="fa-solid fa-triangle-exclamation text-warning" title="اقتراب الانتهاء"></i>';
          const examExtra = examCount > 0 ? ` • <strong>${examCount}</strong> كشف` : '';
          sessBtnText.innerHTML = `سجل الجلسات: <strong>${currentCount} من ${approvedTotal}</strong>${examExtra}${extraStatus}`;
        }
        if (sessBtn) {
          sessBtn.className = 'pcm-sessions-chip';
          if (isCompleted) sessBtn.classList.add('cycle-completed');
          else if (isNearLimit) sessBtn.classList.add('cycle-near-limit');
        }
      }
    }

    // 1.1 Render 3 Quick Actions inside Patient Sheet (WhatsApp, Edit, Delete)
    const actionsEl = document.getElementById('sheet-patient-quick-actions');
    if (actionsEl) {
      const cleanPhone = (p.phone || '').replace(/[^0-9]/g, '').replace(/^0/, '20');
      const canDelete = RolesManager.canDelete(currentUser);

      actionsEl.innerHTML = `
        <a href="https://wa.me/${cleanPhone}" target="_blank" class="btn btn-outline btn-sm pcm-action-circle wa" title="محادثة واتساب">
          <i class="fa-brands fa-whatsapp"></i>
        </a>
        <button type="button" class="btn btn-outline btn-sm pcm-action-circle edit" onclick="patientsManager.openEditModalFromSheet('${p.id}')" title="تعديل بيانات المريض">
          <i class="fa-solid fa-pen-to-square"></i>
        </button>
        ${canDelete ? `
          <button type="button" class="btn btn-outline btn-sm pcm-action-circle del" onclick="patientsManager.confirmDeleteFromSheet('${p.id}')" title="حذف المريض">
            <i class="fa-solid fa-trash"></i>
          </button>
        ` : ''}
      `;
    }

    const updateEl = document.getElementById('sheet-last-update-text');
    if (updateEl) {
      updateEl.textContent = sheet.lastUpdated 
        ? `${sheet.lastUpdated} (بواسطة: ${sheet.updatedBy || 'الطبيب'})`
        : 'لم يتم تعديل الشيت بعد (شيت جديد)';
    }

    // 2. Fill Diagnosis & Affected Area
    document.getElementById('sheet-diagnosis').value = sheet.diagnosis || '';
    document.getElementById('sheet-affected-area').value = sheet.affectedArea || '';

    // 3, 4, 5. Dynamic Clinical Chips (Manager Controlled)
    this.renderAllClinicalChips(sheet);
    const exerciseDetailsEl = document.getElementById('sheet-exercise-details');
    if (exerciseDetailsEl) exerciseDetailsEl.value = sheet.exerciseDetails || '';

    // 6. Plan & Notes
    document.getElementById('sheet-sessions-count').value = sheet.plannedSessions || '';
    document.getElementById('sheet-doctor-notes').value = sheet.doctorNotes || '';

    // 7. Switch View
    this.app.switchView('patient-sheet');
    setTimeout(() => this.setupSheetTextareas(), 60);

    // 8. Load and Render Patient Medical Imaging (v1.4.78)
    this.loadAndRenderPatientImages(p.id);
  }

  setupSheetTextareas() {
    ['sheet-diagnosis', 'sheet-exercise-details', 'sheet-doctor-notes'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        const minH = (id === 'sheet-doctor-notes') ? 105 : 95;
        el.style.height = 'auto';
        el.style.height = Math.max(el.scrollHeight, minH) + 'px';
        if (!el.__autoResizeBound) {
          el.__autoResizeBound = true;
          el.addEventListener('input', () => {
            el.style.height = 'auto';
            el.style.height = Math.max(el.scrollHeight, minH) + 'px';
          });
        }
      }
    });
  }

  async handleSaveSheet(e) {
    e.preventDefault();
    if (!this.currentSheetPatient) return;

    const diagnosis = document.getElementById('sheet-diagnosis')?.value.trim();
    const affectedArea = document.getElementById('sheet-affected-area')?.value.trim();

    if (!diagnosis) {
      await this.app.showAlert('يرجى كتابة التشخيص الطبي أو شكوى المريض الرئيسية قبل حفظ الشيت.', 'بيانات مطلوبة', 'warning');
      document.getElementById('sheet-diagnosis')?.focus();
      return;
    }

    if (!affectedArea) {
      await this.app.showAlert('يرجى تحديد المنطقة أو العضو المصاب المراد علاجه.', 'بيانات مطلوبة', 'warning');
      document.getElementById('sheet-affected-area')?.focus();
      return;
    }

    const currentUser = auth.getCurrentUser();
    const saveBtn = document.getElementById('btn-save-sheet');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الحفظ...';
      setTimeout(() => {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> حفظ الشيت الطبي';
      }, 1500);
    }

    // Collect Modalities, Procedures, Exercises
    const modalities = this.currentSheetModalities || [];
    const procedures = this.currentSheetProcedures || [];
    const exercises = this.currentSheetExercises || [];

    const clinicalSheet = {
      diagnosis: document.getElementById('sheet-diagnosis').value.trim(),
      affectedArea: document.getElementById('sheet-affected-area').value.trim(),
      modalities,
      customModalities: '',
      procedures,
      customProcedures: '',
      exercises,
      exerciseDetails: document.getElementById('sheet-exercise-details').value.trim(),
      plannedSessions: document.getElementById('sheet-sessions-count').value.trim(),
      doctorNotes: document.getElementById('sheet-doctor-notes').value.trim(),
      lastUpdated: new Date().toLocaleString('en-US'),
      updatedBy: currentUser?.name || 'الطبيب المعالج'
    };

    this.currentSheetPatient.clinicalSheet = clinicalSheet;
    await db.savePatient(this.currentSheetPatient, currentUser);

    await db.logAudit(
      'تحديث الشيت الطبي',
      `قام ${currentUser?.name || 'الطبيب'} بتحديث الشيت الطبي وخطة العلاج للمريض: ${this.currentSheetPatient.name}`,
      currentUser
    );

    const updateEl = document.getElementById('sheet-last-update-text');
    if (updateEl) {
      updateEl.textContent = `${clinicalSheet.lastUpdated} (بواسطة: ${clinicalSheet.updatedBy})`;
    }

    this.app.showToast('تم حفظ وتحديث الشيت الطبي للمريض بنجاح');
    this.renderAllInsuranceChips();
    await this.loadPatients();
  }

  // Automated One-Time Unification for Legacy Insurance Names (أبوقير للأسمدة -> أبو قير)
  async checkAndMigrateLegacyInsuranceNames() {
    try {
      const migrationDoneKey = 'ascpt_migrated_aboqir_legacy_v2';
      if (localStorage.getItem(migrationDoneKey)) return;

      const patients = this.patients || [];
      const isLegacyAboQir = (name) => {
        if (!name) return false;
        const norm = this.normalizeArabic(name).replace(/\s+/g, '');
        return norm.includes('ابوقير') && norm.includes('اسمد');
      };

      const targets = patients.filter(p => isLegacyAboQir(p.insuranceCompany));
      if (targets.length === 0) {
        localStorage.setItem(migrationDoneKey, 'true');
        return;
      }

      console.log(`[ASCPT Migration] Unifying ${targets.length} legacy patient records from 'أبوقير للأسمدة' to 'أبو قير'...`);
      const currentUser = auth.getCurrentUser() || { name: 'تحديث النظام التلقائي' };

      for (const p of targets) {
        const updated = {
          ...p,
          insuranceCompany: 'أبو قير',
          contractType: 'direct'
        };
        await db.savePatient(updated, currentUser);
      }

      // Also update any sessions in local/remote db recorded with legacy name
      try {
        const sessions = await db.getSessions();
        const sessionTargets = (sessions || []).filter(s => isLegacyAboQir(s.insuranceName));
        for (const s of sessionTargets) {
          await db.saveSession({
            ...s,
            insuranceName: 'أبو قير',
            contractType: 'direct'
          }, currentUser);
        }
      } catch (sessErr) {
        console.warn('[ASCPT Migration] Sessions unification notice:', sessErr);
      }

      localStorage.setItem(migrationDoneKey, 'true');
      await this.loadPatients(true);
      this.renderPatients();
      if (this.app?.financeManager?.loadMonthlyReport) {
        try { this.app.financeManager.loadMonthlyReport(); } catch (_) {}
      }
      console.log('[ASCPT Migration] Completed unifying all records to "أبو قير" (تعاقد مباشر).');
    } catch (err) {
      console.warn('[ASCPT Migration] Migration notice:', err);
    }
  }

  // ================= Dynamic Clinical Chips (Manager Controlled) =================
  toggleChipsEditMode(category) {
    const user = auth.getCurrentUser();
    if (!RolesManager.canManageUsers(user)) {
      this.app.showAlert('تعديل وحذف الأزرار متاح لمدير المركز فقط.', 'صلاحية المدير');
      return;
    }

    this.chipsEditMode[category] = !this.chipsEditMode[category];
    const isEdit = this.chipsEditMode[category];

    const btn = document.getElementById(`btn-toggle-chips-${category}`);
    if (btn) {
      if (isEdit) {
        btn.className = 'btn-edit-chips active';
        btn.innerHTML = '<i class="fa-solid fa-check"></i> <span class="edit-text">تم الانتهاء</span>';
      } else {
        btn.className = 'btn-edit-chips';
        btn.innerHTML = '<i class="fa-solid fa-pen-to-square"></i> <span class="edit-text">تعديل الأزرار</span>';
      }
    }

    const containerMap = {
      modality: 'sheet-modalities-container',
      procedure: 'sheet-procedures-container',
      exercise: 'sheet-exercises-container'
    };

    const curSelected = Array.from(document.querySelectorAll(`#${containerMap[category]} .sheet-chip.selected`))
      .map(b => b.getAttribute('data-val'));

    this.renderCategoryChips(category, containerMap[category], curSelected);
  }

  updateSheetPickerPreview(category, selectedList = []) {
    const containerMap = {
      modality: { preview: 'sheet-modalities-selected-preview', badge: 'sheet-modalities-count-badge', chipsWrap: 'sheet-modalities-chips-wrap', placeholder: '-- اضغط لاختيار وتحديد الأجهزة المقررة --', icon: 'fa-bolt-lightning' },
      procedure: { preview: 'sheet-procedures-selected-preview', badge: 'sheet-procedures-count-badge', chipsWrap: 'sheet-procedures-chips-wrap', placeholder: '-- اضغط لاختيار وتحديد إجراءات العلاج اليدوي --', icon: 'fa-hand-holding-hand' },
      exercise: { preview: 'sheet-exercises-selected-preview', badge: 'sheet-exercises-count-badge', chipsWrap: 'sheet-exercises-chips-wrap', placeholder: '-- اضغط لاختيار وتحديد التمارين العلاجية --', icon: 'fa-person-running' }
    };
    const cfg = containerMap[category];
    if (!cfg) return;

    const previewEl = document.getElementById(cfg.preview);
    const badgeEl = document.getElementById(cfg.badge);
    const chipsWrapEl = document.getElementById(cfg.chipsWrap);

    if (badgeEl) badgeEl.textContent = `${selectedList.length} محدد`;

    if (previewEl) {
      if (!selectedList || selectedList.length === 0) {
        previewEl.innerHTML = `<span style="color: var(--text-muted); font-size: 0.88rem;">${cfg.placeholder}</span>`;
      } else {
        previewEl.innerHTML = `<span style="font-weight: 700; color: var(--primary); font-size: 0.88rem;"><i class="fa-solid fa-check-circle"></i> تم تحديد ${selectedList.length} عنصر (انظر الشارات بالأسفل)</span>`;
      }
    }

    if (chipsWrapEl) {
      if (!selectedList || selectedList.length === 0) {
        chipsWrapEl.innerHTML = '';
      } else {
        chipsWrapEl.innerHTML = selectedList.map(item => `
          <span class="sheet-interactive-tag">
            <i class="fa-solid ${cfg.icon}"></i>
            <span>${escapeHTML(item)}</span>
            <button type="button" class="sheet-tag-remove-btn" data-category="${category}" data-item="${escapeHTML(item)}" title="إلغاء هذا الاختيار">&times;</button>
          </span>
        `).join('');

        // Bind remove event on tags
        chipsWrapEl.querySelectorAll('.sheet-tag-remove-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const cat = btn.getAttribute('data-category');
            const itemToRemove = btn.getAttribute('data-item');
            this.removeSheetTag(cat, itemToRemove);
          });
        });
      }
    }

    // Populate hidden container for backward compatibility
    const hiddenContainer = document.getElementById(`sheet-${category === 'modality' ? 'modalities' : category === 'procedure' ? 'procedures' : 'exercises'}-container`);
    if (hiddenContainer) {
      hiddenContainer.innerHTML = selectedList.map(item => `
        <button type="button" class="sheet-chip selected" data-val="${escapeHTML(item)}"></button>
      `).join('');
    }
  }

  removeSheetTag(category, item) {
    if (category === 'modality') {
      this.currentSheetModalities = (this.currentSheetModalities || []).filter(i => i !== item);
      this.updateSheetPickerPreview('modality', this.currentSheetModalities);
    } else if (category === 'procedure') {
      this.currentSheetProcedures = (this.currentSheetProcedures || []).filter(i => i !== item);
      this.updateSheetPickerPreview('procedure', this.currentSheetProcedures);
    } else if (category === 'exercise') {
      this.currentSheetExercises = (this.currentSheetExercises || []).filter(i => i !== item);
      this.updateSheetPickerPreview('exercise', this.currentSheetExercises);
    }
  }

  renderAllClinicalChips(sheet = {}) {
    this.currentSheetModalities = Array.isArray(sheet.modalities) ? [...sheet.modalities] : [];
    this.currentSheetProcedures = Array.isArray(sheet.procedures) ? [...sheet.procedures] : [];
    this.currentSheetExercises = Array.isArray(sheet.exercises) ? [...sheet.exercises] : [];

    this.updateSheetPickerPreview('modality', this.currentSheetModalities);
    this.updateSheetPickerPreview('procedure', this.currentSheetProcedures);
    this.updateSheetPickerPreview('exercise', this.currentSheetExercises);
  }

  renderCategoryChips(category, containerId, selectedList = []) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const options = db.getClinicalOptions(category);
    const iconMap = {
      modality: 'fa-solid fa-bolt-lightning',
      procedure: 'fa-solid fa-hand-holding-hand',
      exercise: 'fa-solid fa-person-running'
    };
    const defaultIcon = iconMap[category] || 'fa-solid fa-circle-check';
    const isEdit = Boolean(this.chipsEditMode[category]);

    let html = options.map(opt => {
      const isSelected = selectedList.includes(opt);
      const editClass = isEdit ? 'in-edit-mode' : '';
      const safeOpt = opt.replace(/'/g, "\\'");
      const deleteIconHtml = isEdit
        ? `<span class="chip-delete-tag" data-action="delete-option" data-category="${category}" data-option="${safeOpt}" title="حذف هذا الزر"><i class="fa-solid fa-circle-xmark"></i></span>`
        : '';

      return `
        <button type="button" class="chip-choice sheet-chip ${isSelected ? 'selected' : ''} ${editClass}" data-group="${category}" data-val="${opt}">
          <i class="${defaultIcon}"></i> <span>${opt}</span>
          ${deleteIconHtml}
        </button>
      `;
    }).join('');

    if (isEdit) {
      const addLabels = {
        modality: 'إضافة جهاز جديد',
        procedure: 'إضافة إجراء جديد',
        exercise: 'إضافة تمرين جديد'
      };
      html += `
        <button type="button" class="chip-add-new-btn" data-action="add-option" data-category="${category}">
          <i class="fa-solid fa-plus"></i> <span>${addLabels[category] || 'إضافة جديد'}</span>
        </button>
      `;
    }

    container.innerHTML = html;
  }

  async deleteOptionDirect(category, optionName) {
    const user = auth.getCurrentUser();
    if (!RolesManager.canManageUsers(user)) return;

    const confirmed = await this.app.showConfirm(
      `هل أنت متأكد من حذف زر "${optionName}" نهائياً من قائمة الأطباء؟`,
      'حذف زر دائم'
    );
    if (confirmed) {
      await db.deleteClinicalOption(category, optionName);
      const containerMap = {
        modality: 'sheet-modalities-container',
        procedure: 'sheet-procedures-container',
        exercise: 'sheet-exercises-container'
      };
      const curSelected = Array.from(document.querySelectorAll(`#${containerMap[category]} .sheet-chip.selected`))
        .map(b => b.getAttribute('data-val'))
        .filter(v => v !== optionName);

      this.renderCategoryChips(category, containerMap[category], curSelected);
      this.app.showToast(`تم حذف زر "${optionName}" بنجاح`);
      await db.logAudit('حذف زر سريري', `حذف زر ${optionName} من قسم ${category}`, user);
    }
  }

  openAddOptionModal(category) {
    const user = auth.getCurrentUser();
    if (!RolesManager.canManageUsers(user)) {
      this.app.showAlert('إضافة الأزرار الدائمة متاح لمدير المركز فقط.', 'صلاحية المدير');
      return;
    }

    const titles = {
      modality: 'إضافة جهاز فيزيائي جديد',
      procedure: 'إضافة إجراء / علاج يدوي جديد',
      exercise: 'إضافة تمرين علاجي جديد'
    };

    document.getElementById('opt-target-category').value = category;
    document.getElementById('modal-opt-title').innerHTML = `<i class="fa-solid fa-circle-plus"></i> ${titles[category] || 'إضافة زر جديد'}`;
    document.getElementById('opt-new-name').value = '';
    this.app.openModal('modal-add-clinical-option');
  }

  async handleSaveNewOption(e) {
    e.preventDefault();
    const category = document.getElementById('opt-target-category').value;
    const nameInput = document.getElementById('opt-new-name');
    const name = nameInput.value.trim();

    if (!name) {
      await this.app.showAlert('يرجى كتابة اسم الزر الجديد أولاً قبل الحفظ.', 'بيانات مطلوبة', 'warning');
      nameInput?.focus();
      return;
    }
    if (!category) return;

    await db.addClinicalOption(category, name);
    const containerMap = {
      modality: 'sheet-modalities-container',
      procedure: 'sheet-procedures-container',
      exercise: 'sheet-exercises-container'
    };

    const curSelected = Array.from(document.querySelectorAll(`#${containerMap[category]} .sheet-chip.selected`)).map(b => b.getAttribute('data-val'));
    curSelected.push(name);
    this.renderCategoryChips(category, containerMap[category], curSelected);

    this.app.closeModal('modal-add-clinical-option');
    this.app.showToast(`تمت إضافة زر "${name}" بنجاح`);
    await db.logAudit('إضافة زر سريري', `إضافة زر ${name} في قسم ${category}`, auth.getCurrentUser());
  }

  // ================= Patient Sessions History Modal (Timeline Cards) =================
  openPatientSessionsModal() {
    if (!this.currentSheetPatient) return;
    const p = this.currentSheetPatient;
    const sessions = this.currentPatientSessions || [];
    const currentUser = (typeof auth !== 'undefined' && auth.getCurrentUser) ? auth.getCurrentUser() : null;
    const canDelete = RolesManager.canDelete(currentUser);

    const nameEl = document.getElementById('modal-p-sess-patient-name');
    if (nameEl) nameEl.textContent = p.name;
    
    const therapySessions = sessions.filter(s => s.entryType !== 'examination');
    const examCount = sessions.length - therapySessions.length;

    const countEl = document.getElementById('modal-p-sess-total-badge');
    if (countEl) {
      if (examCount > 0 && therapySessions.length > 0) {
        countEl.textContent = `${therapySessions.length} جلسة علاجية • ${examCount} كشف`;
      } else if (examCount > 0) {
        countEl.textContent = `${examCount} كشف طبي`;
      } else {
        countEl.textContent = `${therapySessions.length} جلسة`;
      }
    }

    const listEl = document.getElementById('modal-p-sess-list');
    if (!listEl) return;

    if (sessions.length === 0) {
      listEl.innerHTML = `
        <div class="stc-empty-box">
          <i class="fa-solid fa-calendar-xmark"></i>
          <h4>لا توجد حركات مسجلة لهذا المريض بعد</h4>
          <p>يتم تسجيل حضور الجلسات والكشوفات من شاشة "تسجيل الجلسات" اليومية</p>
        </div>
      `;
    } else {
      const approvedTotal = parseInt(p.approvedSessions, 10) || 12;
      const seqMap = sequencePatientSessionsChronologically(sessions, approvedTotal);

      listEl.innerHTML = sessions.map((s, idx) => {
        const isExam = (s.entryType === 'examination');
        let sessionBadgeHTML = '';
        if (isExam) {
          sessionBadgeHTML = `<span class="badge badge-examination"><i class="fa-solid fa-stethoscope"></i> كشف واستشارة</span>`;
        } else {
          const seqInfo = seqMap.get(s.id);
          const sessNum = seqInfo?.sessionNumber || s.sessionNumber || 1;
          const cycleNum = seqInfo?.cycleNumber || s.cycleNumber || 1;
          const cycleSuffix = cycleNum > 1 ? ` (دورة ${cycleNum})` : '';

          if (s.isHomeVisit || s.visitType === 'home') {
            sessionBadgeHTML = `<span class="stc-num-badge" style="background: rgba(5, 150, 105, 0.12); color: #059669; border: 1px solid rgba(5, 150, 105, 0.3);"><i class="fa-solid fa-house-chimney-medical"></i> زيارة منزلية #${sessNum}${cycleSuffix}</span>`;
          } else {
            sessionBadgeHTML = `<span class="stc-num-badge">الجلسة #${sessNum}${cycleSuffix}</span>`;
          }
        }

        const isLatest = (idx === 0);

        let payBadge = '';
        if (s.payType === 'cash') {
          payBadge = `<span class="badge badge-cash" style="font-size: 0.74rem; padding: 3px 8px;"><i class="fa-solid fa-money-bill-wave"></i> نقدي (${s.amountPaid || 0} ج.م)</span>`;
        } else if (s.contractType === 'direct') {
          payBadge = `<span class="badge badge-direct" style="font-size: 0.74rem; padding: 3px 8px;"><i class="fa-solid fa-file-contract"></i> ${escapeHTML(s.insuranceName || 'تأمين')} (مباشر) • ${s.amountPaid || 0} ج.م</span>`;
        } else {
          payBadge = `<span class="badge badge-indirect" style="font-size: 0.74rem; padding: 3px 8px;"><i class="fa-solid fa-handshake"></i> ${escapeHTML(s.insuranceName || 'تأمين')} (غير مباشر) • ${s.amountPaid || 0} ج.م</span>`;
        }

        let dateLabel = s.date;
        try {
          const d = new Date(s.date + 'T00:00:00');
          if (!isNaN(d.getTime())) {
            const days = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
            dateLabel = `${days[d.getDay()]} ${s.date}`;
          }
        } catch (e) {}

        let partBadgeHTML = '';
        if (isExam) {
          partBadgeHTML = `<span class="stc-part-pill pill-examination"><i class="fa-solid fa-stethoscope"></i> فحص وتقييم</span>`;
        } else {
          const parts = Array.isArray(s.bodyParts) ? s.bodyParts.join('، ') : (s.bodyParts || 'غير محدد');
          partBadgeHTML = `<span class="stc-part-pill"><i class="fa-solid fa-location-crosshairs"></i> ${escapeHTML(parts)}</span>`;
        }

        return `
          <div class="session-timeline-card ${isLatest ? 'is-latest' : ''}">
            <div class="stc-header">
              <div class="stc-left-meta">
                ${sessionBadgeHTML}
                ${isLatest ? '<span class="badge badge-success" style="font-size: 0.68rem; padding: 2px 7px;"><i class="fa-solid fa-sparkles"></i> الأحدث</span>' : ''}
                <div class="stc-datetime">
                  <i class="fa-regular fa-calendar text-primary"></i>
                  <span>${dateLabel}</span>
                  ${s.recordedAt ? `<span class="stc-time">• <i class="fa-regular fa-clock"></i> ${s.recordedAt}</span>` : ''}
                </div>
              </div>
              <div class="stc-pay">
                ${payBadge}
              </div>
            </div>

            <div class="stc-body">
              <div class="stc-doctor">
                <i class="fa-solid fa-user-doctor text-primary"></i>
                <span>${isExam ? 'طبيب الكشف:' : 'الطبيب المعالج:'} <strong>${escapeHTML(s.doctor)}</strong></span>
              </div>
              <div class="stc-part">
                ${partBadgeHTML}
              </div>
            </div>

            ${s.notes ? `
              <div class="stc-notes">
                <i class="fa-regular fa-comment-dots text-primary" style="margin-top: 2px;"></i>
                <span>${escapeHTML(s.notes)}</span>
              </div>
            ` : ''}

            <div class="stc-footer" style="display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;">
              <small><i class="fa-solid fa-user-check"></i> المسجل: ${escapeHTML(s.recordedBy || 'موظف الاستقبال')}</small>
              ${canDelete ? `
                <button type="button" class="btn btn-outline btn-sm btn-icon-action btn-delete-history-session" onclick="patientsManager.deletePatientSession('${escapeHTML(s.id)}')" style="color: var(--danger); border-color: rgba(239, 68, 68, 0.35); background: rgba(239, 68, 68, 0.06); padding: 2px 8px; font-size: 0.74rem; display: inline-flex; align-items: center; gap: 4px;" title="حذف هذه الجلسة">
                  <i class="fa-solid fa-trash"></i> <span>حذف</span>
                </button>
              ` : ''}
            </div>
          </div>
        `;
      }).join('');
    }

    this.app.openModal('modal-patient-sessions-history');
  }

  printCurrentSheet() {
    if (this._isPrinting) return;
    this._isPrinting = true;
    setTimeout(() => { this._isPrinting = false; }, 2500);

    const currentUser = auth.getCurrentUser();
    if (!RolesManager.canPrintSheet(currentUser)) {
      this.app.showAlert('عفواً، طباعة وحفظ الشيت الطبي متاح لإدارة المركز فقط.', 'صلاحية الطباعة');
      return;
    }

    if (!this.currentSheetPatient) {
      this.app.showAlert('يرجى فتح شيت المريض أولاً قبل الطباعة.', 'تنبيه', 'warning');
      return;
    }

    const p = this.currentSheetPatient;
    const sheet = p.clinicalSheet || {};

    // 1. Fill Printable Template
    const now = new Date().toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' });
    const today = new Date().toLocaleDateString('ar-EG-u-nu-latn');
    document.getElementById('print-sheet-meta').textContent = `تاريخ ووقت الطباعة: ${today} ${now}`;

    document.getElementById('p-print-name').textContent = p.name || '';
    document.getElementById('p-print-age').textContent = p.age ? `${p.age} سنة` : '-';
    document.getElementById('p-print-phone').textContent = p.phone || '-';
    document.getElementById('p-print-address').textContent = p.address || '-';
    document.getElementById('p-print-doctor').textContent = p.doctor || p.doctorName || '-';
    document.getElementById('p-print-billing').textContent = (p.billing === 'cash' || p.payType === 'cash')
      ? 'سداد نقدي' 
      : `${p.insuranceCompany || p.insuranceName || 'تأمين'} (${p.contractType === 'direct' ? 'تعاقد مباشر' : 'تعاقد غير مباشر'})`;

    // 2. Diagnosis
    document.getElementById('p-print-diagnosis').textContent = 
      `${sheet.diagnosis || 'لم يحدد'} | العضو/المنطقة: ${sheet.affectedArea || 'غير محدد'}`;

    // 3. Modalities
    const mods = [...(sheet.modalities || [])];
    if (sheet.customModalities) mods.push(sheet.customModalities);
    document.getElementById('p-print-modalities').textContent = mods.length > 0 ? mods.join(' • ') : 'لا توجد أجهزة مقررة';

    // 4. Procedures
    const procs = [...(sheet.procedures || [])];
    if (sheet.customProcedures) procs.push(sheet.customProcedures);
    document.getElementById('p-print-procedures').textContent = procs.length > 0 ? procs.join(' • ') : 'لا توجد إجراءات يدوية مقررة';

    // 5. Exercises
    const exList = [...(sheet.exercises || [])];
    document.getElementById('p-print-exercises').textContent = exList.length > 0 ? exList.join(' • ') : 'لا توجد تمارين محددة';
    document.getElementById('p-print-exercise-details').textContent = sheet.exerciseDetails ? `التفاصيل: ${sheet.exerciseDetails}` : '';

    // 6. Plan & Notes
    const planText = sheet.plannedSessions ? `الخطة: ${sheet.plannedSessions} | ` : '';
    document.getElementById('p-print-notes').textContent = `${planText}${sheet.doctorNotes || 'لا توجد ملاحظات إضافية'}`;

    // 3. Activate print class and trigger print with layout stabilization
    const printEl = document.getElementById('printable-patient-sheet');
    if (printEl) printEl.style.display = 'block';
    document.body.classList.add('printing-sheet');

    setTimeout(() => {
      window.print();
      const cleanPrintClass = () => {
        document.body.classList.remove('printing-sheet');
        if (printEl) printEl.style.display = 'none';
        window.removeEventListener('afterprint', cleanPrintClass);
      };
      window.addEventListener('afterprint', cleanPrintClass, { once: true });
      setTimeout(cleanPrintClass, 3000);
    }, 150);
  }

  // ================= Insurance Renewal Letter (A5) =================
  openInsuranceLetterModalForPatient(patientId, noSlide = false, fromDocs = false) {
    const p = this.patients.find((item) => item.id === patientId);
    if (!p) return;
    this.openedFromDocs = fromDocs;
    this.activeDocsPatientId = patientId;
    this.currentSheetPatient = p;
    this.openInsuranceLetterModal(noSlide, fromDocs);
  }

  openInsuranceLetterModal(noSlide = false, fromDocs = false) {
    if (!this.currentSheetPatient) return;
    const p = this.currentSheetPatient;
    const sheet = p.clinicalSheet || {};

    document.getElementById('ins-letter-company').value = p.insuranceCompany || '';
    document.getElementById('ins-letter-diagnosis').value = sheet.diagnosis || '';
    document.getElementById('ins-letter-sessions').value = '';
    const notesInp = document.getElementById('ins-letter-notes');
    if (notesInp) notesInp.value = '';

    this.app.openModal('modal-insurance-letter', { noSlide, alreadyInHistory: fromDocs });
  }

  async submitInsuranceLetter() {
    if (this._isPrinting) return;

    const p = this.currentSheetPatient;
    if (!p) return;

    const diagnosis = document.getElementById('ins-letter-diagnosis')?.value.trim();
    const sessionsRaw = document.getElementById('ins-letter-sessions')?.value.trim();
    const sessionCount = parseInt(sessionsRaw, 10);
    const notes = document.getElementById('ins-letter-notes')?.value.trim() || '';

    if (!diagnosis) {
      this.app.showAlert('يرجى كتابة التشخيص.', 'بيانات مطلوبة', 'warning');
      return;
    }
    if (!sessionCount || sessionCount <= 0) {
      this.app.showAlert('يرجى كتابة عدد جلسات صحيح.', 'بيانات مطلوبة', 'warning');
      return;
    }

    this._isPrinting = true;
    setTimeout(() => { this._isPrinting = false; }, 2500);

    const currentUser = auth.getCurrentUser();
    const todayLabel = new Date().toLocaleDateString('ar-EG-u-nu-latn', { year: 'numeric', month: 'long', day: 'numeric' });

    try {
      // 1. Save a copy of the letter in the database first
      await db.addInsuranceLetter({
        patientId: p.id,
        patientName: p.name,
        insuranceCompany: p.insuranceCompany || '',
        diagnosis,
        sessionCount,
        notes,
        issuedBy: currentUser?.name || '',
        createdByUid: currentUser?.uid || ''
      });

      // 2. Fill the printable A5 template
      document.getElementById('ins-print-company').textContent = p.insuranceCompany || p.insuranceName || '-';
      document.getElementById('ins-print-patient-name').textContent = p.name || '';
      document.getElementById('ins-print-diagnosis').textContent = diagnosis || '-';
      document.getElementById('ins-print-sessions').textContent = sessionCount || '1';
      document.getElementById('ins-print-date').textContent = `تحريراً في: ${todayLabel}`;

      const notesContainer = document.getElementById('ins-print-notes-container');
      const notesEl = document.getElementById('ins-print-notes');
      if (notesContainer && notesEl) {
        if (notes) {
          notesEl.textContent = notes;
          notesContainer.style.display = 'block';
        } else {
          notesEl.textContent = '';
          notesContainer.style.display = 'none';
        }
      }

      // Gender-correct wording when known; falls back to the neutral
      // slash form for older patient records saved before this field existed.
      const honorificEl = document.getElementById('ins-print-honorific');
      const sufferVerbEl = document.getElementById('ins-print-verb-suffer');
      const needVerbEl = document.getElementById('ins-print-verb-need');
      if (p.gender === 'male') {
        honorificEl.textContent = 'السيد';
        sufferVerbEl.textContent = 'يعاني';
        needVerbEl.textContent = 'يحتاج';
      } else if (p.gender === 'female') {
        honorificEl.textContent = 'السيدة';
        sufferVerbEl.textContent = 'تعاني';
        needVerbEl.textContent = 'تحتاج';
      } else {
        honorificEl.textContent = 'السيد/ة';
        sufferVerbEl.textContent = 'يعاني/تعاني';
        needVerbEl.textContent = 'يحتاج/تحتاج';
      }

      this.app.closeModal('modal-insurance-letter');
      this.app.closeModal('modal-patient-docs');

      const printEl = document.getElementById('printable-insurance-letter');
      if (printEl) printEl.style.display = 'block';
      document.body.classList.add('printing-insurance-letter');

      setTimeout(() => {
        window.print();
        const cleanPrintClass = () => {
          document.body.classList.remove('printing-insurance-letter');
          if (printEl) printEl.style.display = 'none';
          window.removeEventListener('afterprint', cleanPrintClass);
        };
        window.addEventListener('afterprint', cleanPrintClass, { once: true });
        setTimeout(cleanPrintClass, 3000);
      }, 150);
    } catch (err) {
      this.app.showAlert('تعذر حفظ/طباعة الخطاب: ' + err.message, 'خطأ', 'danger');
    }
  }

  // ================= Patient Documents Hub (نافذة المستندات والطباعة) =================
  openPatientDocsModal(patientId, options = {}) {
    const p = this.patients.find(item => item.id === patientId);
    if (!p) return;

    this.activeDocsPatientId = patientId;
    this.openedFromDocs = false;
    document.getElementById('p-docs-modal-name').textContent = p.name;
    const isIns = p.billing === 'insurance';
    const cType = p.contractType === 'indirect' ? 'غير مباشر' : 'مباشر';
    document.getElementById('p-docs-modal-info').textContent = isIns
      ? `${p.insuranceCompany || 'شركة التأمين'} (${cType}) • السن: ${p.age} سنة`
      : `مريض نقدي • كود: ${p.id.slice(-5)} • السن: ${p.age} سنة`;

    const badge = document.getElementById('p-docs-modal-badge');
    if (badge) {
      badge.className = `badge ${isIns ? 'badge-direct' : 'badge-cash'}`;
      badge.textContent = isIns ? 'تأمين' : 'نقدي';
    }

    const container = document.getElementById('p-docs-actions-container');
    if (!container) return;

    // Prevent ghost clicks (touch bleed-through) when opening or returning from sub-modals
    container.style.pointerEvents = 'none';
    setTimeout(() => {
      if (container) container.style.pointerEvents = 'auto';
    }, 280);

    if (!isIns) {
      // Cash Patient Actions
      container.innerHTML = `
        <button type="button" class="btn btn-outline" onclick="patientsManager.openCashReceiptModal('${p.id}')" style="justify-content: flex-start; padding: 12px 16px; border-radius: 10px; font-weight: 800; font-size: 0.95rem; gap: 12px; border-color: var(--border-color); background: var(--bg-surface);">
          <i class="fa-solid fa-receipt" style="font-size: 1.3rem; color: var(--success);"></i>
          <div style="text-align: right;">
            <div>طباعة إيصال استلام نقدية</div>
            <small style="color: var(--text-muted); font-weight: 600; font-size: 0.74rem;">إيصال معتمد بالمبلغ والبيان لجلسات المريض</small>
          </div>
        </button>
        <button type="button" class="btn btn-outline" onclick="patientsManager.openMedicalStatementModal('${p.id}')" style="justify-content: flex-start; padding: 12px 16px; border-radius: 10px; font-weight: 800; font-size: 0.95rem; gap: 12px; border-color: var(--border-color); background: var(--bg-surface);">
          <i class="fa-solid fa-file-lines" style="font-size: 1.3rem; color: var(--primary);"></i>
          <div style="text-align: right;">
            <div>إصدار إفادة طبية (إلى من يهمه الأمر)</div>
            <small style="color: var(--text-muted); font-weight: 600; font-size: 0.74rem;">تقرير بالتشخيص ونسبة التحسن وملاحظات الجلسات</small>
          </div>
        </button>
      `;
    } else {
      // Insurance Patient Actions
      container.innerHTML = `
        <button type="button" class="btn btn-outline" onclick="patientsManager.openMedicalStatementModal('${p.id}')" style="justify-content: flex-start; padding: 12px 16px; border-radius: 10px; font-weight: 800; font-size: 0.95rem; gap: 12px; border-color: var(--border-color); background: var(--bg-surface);">
          <i class="fa-solid fa-file-lines" style="font-size: 1.3rem; color: var(--primary);"></i>
          <div style="text-align: right;">
            <div>إصدار إفادة طبية (إلى من يهمه الأمر)</div>
            <small style="color: var(--text-muted); font-weight: 600; font-size: 0.74rem;">تقرير بالتشخيص ونسبة التحسن وملاحظات الجلسات</small>
          </div>
        </button>
        <button type="button" class="btn btn-outline" onclick="patientsManager.openRenewApprovalModal('${p.id}')" style="justify-content: flex-start; padding: 12px 16px; border-radius: 10px; font-weight: 800; font-size: 0.95rem; gap: 12px; border-color: var(--border-color); background: var(--bg-surface);">
          <i class="fa-solid fa-rotate-right" style="font-size: 1.3rem; color: #0284c7;"></i>
          <div style="text-align: right;">
            <div>تجديد جواب الموافقة (وبدء دورة جديدة)</div>
            <small style="color: var(--text-muted); font-weight: 600; font-size: 0.74rem;">اعتماد جواب جديد وتصفير العداد للبدء من الجلسة 1</small>
          </div>
        </button>
        <button type="button" class="btn btn-outline" onclick="patientsManager.openInsuranceLetterFromRow('${p.id}')" style="justify-content: flex-start; padding: 12px 16px; border-radius: 10px; font-weight: 800; font-size: 0.95rem; gap: 12px; border-color: var(--border-color); background: var(--bg-surface);">
          <i class="fa-solid fa-file-shield" style="font-size: 1.3rem; color: #2563eb;"></i>
          <div style="text-align: right;">
            <div>طباعة خطاب تجديد تأمين (A5)</div>
            <small style="color: var(--text-muted); font-weight: 600; font-size: 0.74rem;">خطاب رسمي لشركة التأمين بطلب تجديد الجلسات</small>
          </div>
        </button>
        <button type="button" class="btn btn-outline" onclick="patientsManager.openBatchHomeVisitsModal('${p.id}')" style="justify-content: flex-start; padding: 12px 16px; border-radius: 10px; font-weight: 800; font-size: 0.95rem; gap: 12px; border-color: var(--border-color); background: var(--bg-surface);">
          <i class="fa-solid fa-calendar-check" style="font-size: 1.3rem; color: #0284c7;"></i>
          <div style="text-align: right;">
            <div>تسجيل جوابات الجلسات (مجمعة / منزلية)</div>
            <small style="color: var(--text-muted); font-weight: 600; font-size: 0.74rem;">تسجيل حزمة جلسات حضور بالمركز أو زيارات منزلية لجواب التأمين</small>
          </div>
        </button>
      `;
    }

    this.app.openModal('modal-patient-docs', options);
  }

  openInsuranceLetterFromRow(patientId) {
    this.app.closeModal('modal-patient-docs', { skipHistory: true });
    this.openInsuranceLetterModalForPatient(patientId, true, true);
  }

  // ================= Cash Receipt Methods =================
  openCashReceiptModal(patientId) {
    this.openedFromDocs = true;
    this.activeDocsPatientId = patientId;
    this.app.closeModal('modal-patient-docs', { skipHistory: true });
    const p = this.patients.find(item => item.id === patientId);
    if (!p) return;

    this.activeReceiptPatient = p;
    document.getElementById('receipt-patient-id').value = p.id;
    document.getElementById('receipt-patient-name').value = p.name;
    document.getElementById('receipt-amount').value = '400';
    document.getElementById('receipt-item-desc').value = 'جلسة علاج طبيعي';
    document.getElementById('receipt-date').value = getLocalDateStr();

    this.app.openModal('modal-cash-receipt', { noSlide: true, alreadyInHistory: true });
  }

  printCashReceipt() {
    if (this._isPrinting) return;
    this._isPrinting = true;
    setTimeout(() => { this._isPrinting = false; }, 2500);

    const p = this.activeReceiptPatient;
    if (!p) return;

    const amount = document.getElementById('receipt-amount')?.value || '400';
    const itemDesc = document.getElementById('receipt-item-desc')?.value.trim() || 'جلسة علاج طبيعي';
    const dateVal = document.getElementById('receipt-date')?.value || getLocalDateStr();

    const isFemaleReceipt = (p.gender === 'female');
    const isMaleReceipt = (p.gender === 'male');
    const receiptHonorificEl = document.getElementById('receipt-print-honorific');
    if (receiptHonorificEl) {
      receiptHonorificEl.textContent = isFemaleReceipt ? 'السيدة' : (isMaleReceipt ? 'السيد' : 'السيد / السيدة');
    }

    document.getElementById('receipt-print-patient-name').textContent = p.name;
    document.getElementById('receipt-print-amount-text').textContent = `${amount} ج.م`;
    document.getElementById('receipt-print-item-desc').textContent = itemDesc;
    const receiptDateValEl = document.getElementById('receipt-print-date-val');
    if (receiptDateValEl) {
      receiptDateValEl.textContent = dateVal;
    } else {
      const receiptDateContainer = document.getElementById('receipt-print-date');
      if (receiptDateContainer) {
        receiptDateContainer.innerHTML = `تحريراً في: <bdi dir="ltr">${escapeHTML(dateVal)}</bdi>`;
      }
    }

    this.app.closeModal('modal-cash-receipt');
    this.app.closeModal('modal-patient-docs');

    const printEl = document.getElementById('printable-cash-receipt');
    if (printEl) printEl.style.display = 'block';
    document.body.classList.add('printing-receipt');

    setTimeout(() => {
      window.print();
      const cleanup = () => {
        document.body.classList.remove('printing-receipt');
        if (printEl) printEl.style.display = 'none';
        window.removeEventListener('afterprint', cleanup);
      };
      window.addEventListener('afterprint', cleanup, { once: true });
      setTimeout(cleanup, 3000);
    }, 150);
  }

  // ================= Medical Statement Methods =================
  openMedicalStatementModal(patientId) {
    this.openedFromDocs = true;
    this.activeDocsPatientId = patientId;
    this.app.closeModal('modal-patient-docs', { skipHistory: true });
    const p = this.patients.find(item => item.id === patientId);
    if (!p) return;

    this.activeStatementPatient = p;
    document.getElementById('statement-patient-id').value = p.id;
    document.getElementById('statement-patient-name').value = p.name;
    
    // Fetch diagnosis directly from the patient's clinical sheet (or patient record) without hardcoded fallback
    const sheetDiag = (p.clinicalSheet && p.clinicalSheet.diagnosis)
      ? p.clinicalSheet.diagnosis.trim()
      : (p.diagnosis ? p.diagnosis.trim() : '');
    document.getElementById('statement-diagnosis').value = sheetDiag;

    // Clear body text so it relies cleanly on the placeholder without forcing the user to erase
    document.getElementById('statement-body-text').value = '';
    document.getElementById('statement-date').value = getLocalDateStr();

    this.app.openModal('modal-medical-statement', { noSlide: true, alreadyInHistory: true });
  }

  printMedicalStatement() {
    if (this._isPrinting) return;
    this._isPrinting = true;
    setTimeout(() => { this._isPrinting = false; }, 2500);

    const p = this.activeStatementPatient;
    if (!p) return;

    const diag = document.getElementById('statement-diagnosis')?.value.trim() || '-';
    const bodyText = document.getElementById('statement-body-text')?.value.trim() || '';
    const dateVal = document.getElementById('statement-date')?.value || getLocalDateStr();

    const isFemaleStmt = (p.gender === 'female');
    const isMaleStmt = (p.gender === 'male');
    const stmtHonorificEl = document.getElementById('statement-print-honorific');
    const stmtRelVerbEl = document.getElementById('statement-print-rel-verb');

    if (stmtHonorificEl) {
      stmtHonorificEl.textContent = isFemaleStmt ? 'السيدة' : (isMaleStmt ? 'السيد' : 'السيد / السيدة');
    }
    if (stmtRelVerbEl) {
      stmtRelVerbEl.textContent = isFemaleStmt ? 'والتي تعاني من:' : (isMaleStmt ? 'والذي يعاني من:' : 'والذي / والتي تعاني من:');
    }

    document.getElementById('statement-print-patient-name').textContent = p.name;
    document.getElementById('statement-print-diagnosis').textContent = diag;
    document.getElementById('statement-print-custom-body').textContent = bodyText;
    document.getElementById('statement-print-date').textContent = `تحريراً في: ${dateVal}`;

    this.app.closeModal('modal-medical-statement');
    this.app.closeModal('modal-patient-docs');

    const printEl = document.getElementById('printable-medical-statement');
    if (printEl) printEl.style.display = 'block';
    document.body.classList.add('printing-statement');

    setTimeout(() => {
      window.print();
      const cleanup = () => {
        document.body.classList.remove('printing-statement');
        if (printEl) printEl.style.display = 'none';
        window.removeEventListener('afterprint', cleanup);
      };
      window.addEventListener('afterprint', cleanup, { once: true });
      setTimeout(cleanup, 3000);
    }, 150);
  }

  // ================= 12. Medical Imaging, Polish Studio & Lightbox (v1.4.78) =================
  async loadAndRenderPatientImages(patientId) {
    const grid = document.getElementById('sheet-imaging-gallery-grid');
    const badge = document.getElementById('sheet-imaging-count-badge');
    if (!grid) return;

    try {
      this.currentPatientImages = await db.getPatientImages(patientId);
      if (badge) {
        badge.textContent = `${this.currentPatientImages.length} صورة`;
      }

      if (this.currentPatientImages.length === 0) {
        grid.innerHTML = `
          <div class="imaging-gallery-empty" style="grid-column: 1 / -1;">
            <div style="width: 48px; height: 48px; border-radius: 50%; background: var(--primary-light); color: var(--primary); display: inline-flex; align-items: center; justify-content: center; font-size: 1.3rem; margin-bottom: 8px;">
              <i class="fa-solid fa-images"></i>
            </div>
            <div style="font-weight: 800; font-size: 0.95rem; color: var(--text-main);">لا توجد أشعات أو تحاليل مرفقة للمريض بعد</div>
            <div style="font-size: 0.78rem; margin-top: 4px;">اضغط على زر <strong>"إضافة أشعة / تحليل"</strong> لتصوير أو رفع مستندات وأشعات المريض مع خاصية التوضيح.</div>
          </div>
        `;
        return;
      }

      const CATEGORY_MAP = {
        mri: { label: 'رنين مغناطيسي (MRI)', short: 'رنين MRI', cls: 'badge-cat-mri' },
        xray: { label: 'أشعة عادية (X-Ray)', short: 'X-Ray عادية', cls: 'badge-cat-xray' },
        ct: { label: 'أشعة مقطعية (CT)', short: 'CT مقطعية', cls: 'badge-cat-ct' },
        sonar: { label: 'سونار / دوبلر', short: 'سونار', cls: 'badge-cat-sonar' },
        lab: { label: 'تحليل دم ومختبر', short: 'تحليل', cls: 'badge-cat-lab' },
        report: { label: 'تقرير طبي', short: 'تقرير', cls: 'badge-cat-report' },
        other: { label: 'مستند / أخرى', short: 'أخرى', cls: 'badge-cat-other' }
      };

      grid.innerHTML = this.currentPatientImages.map((img, idx) => {
        const catInfo = CATEGORY_MAP[img.category] || CATEGORY_MAP.other;
        const dateStr = img.createdAt ? new Date(img.createdAt).toLocaleDateString('ar-EG-u-nu-latn') : '';
        const safeTitle = (img.title || catInfo.label).replace(/"/g, '&quot;');
        const safeId = img.id;

        return `
          <div class="imaging-card" data-index="${idx}" title="${safeTitle} - اضغط للعرض بالشاشة الكاملة">
            <div class="imaging-card-thumb-wrap">
              <span class="imaging-card-badge ${catInfo.cls}" data-image-id="${safeId}" data-current-cat="${img.category || 'other'}" title="اضغط لتعديل تصنيف الأشعة">${catInfo.short || catInfo.label} <i class="fa-solid fa-pen" style="font-size: 0.58rem; opacity: 0.8; margin-right: 2px;"></i></span>
              <button type="button" class="imaging-card-delete-btn" data-image-id="${safeId}" title="حذف الصورة">
                <i class="fa-solid fa-trash"></i>
              </button>
              <img src="${img.dataUrl}" alt="${safeTitle}" class="imaging-card-thumb" loading="lazy">
            </div>
            <div class="imaging-card-meta">
              <div class="imaging-card-title">${safeTitle}</div>
              <div class="imaging-card-date"><i class="fa-regular fa-calendar" style="opacity: 0.6;"></i> ${dateStr}</div>
            </div>
          </div>
        `;
      }).join('');

      // Attach click delegates
      if (!grid._hasDelegates) {
        grid._hasDelegates = true;
        grid.addEventListener('click', async (e) => {
          const badgeBtn = e.target.closest('.imaging-card-badge');
          if (badgeBtn) {
            e.preventDefault();
            e.stopPropagation();
            const imgId = badgeBtn.getAttribute('data-image-id');
            const currentCat = badgeBtn.getAttribute('data-current-cat');
            this.openChangeCategoryModal(imgId, currentCat);
            return;
          }

          const delBtn = e.target.closest('.imaging-card-delete-btn');
          if (delBtn) {
            e.preventDefault();
            e.stopPropagation();
            const imgId = delBtn.getAttribute('data-image-id');
            await this.handleDeletePatientImage(imgId);
            return;
          }

          const card = e.target.closest('.imaging-card');
          if (card) {
            const index = parseInt(card.getAttribute('data-index'), 10);
            this.openLightbox(index);
          }
        });
      }
    } catch (err) {
      console.error('loadAndRenderPatientImages error:', err);
    }
  }

  async handleDeletePatientImage(imageId) {
    if (!this.currentSheetPatient || !imageId) return;
    const confirmed = await this.app.showConfirm('هل أنت متأكد من رغبتك في حذف هذه الأشعة / الصورة من شيت المريض؟', 'تأكيد الحذف');
    if (!confirmed) return;

    try {
      await db.deletePatientImage(this.currentSheetPatient.id, imageId);
      this.app.showToast('تم حذف الصورة من شيت المريض');
      await this.loadAndRenderPatientImages(this.currentSheetPatient.id);
    } catch (err) {
      this.app.showAlert('تعذر حذف الصورة: ' + err.message, 'خطأ', 'danger');
    }
  }

  handleImagingFilesSelected(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = ''; // Reset input to allow selecting same files if needed
    if (!files.length) return;

    this.polishQueue = files;
    this.currentPolishIndex = 0;
    this.loadPolishQueueItem();
  }

  loadPolishQueueItem() {
    if (this.currentPolishIndex >= this.polishQueue.length) {
      this.app.closeModal('modal-image-polish');
      this.app.showToast('تم الانتهاء من حفظ جميع الصور المختارة');
      if (this.currentSheetPatient) {
        this.loadAndRenderPatientImages(this.currentSheetPatient.id);
      }
      return;
    }

    const file = this.polishQueue[this.currentPolishIndex];
    const reader = new FileReader();

    reader.onload = (evt) => {
      const img = new Image();
      img.onload = () => {
        this.rawOriginalImageObj = img;
        this.currentPolishImageObj = img;
        this.polishRotation = 0;
        this.polishBrightness = 100;
        this.polishContrast = 100;
        this.polishPreset = 'normal';
        this.endCropMode();

        // Update UI
        const badge = document.getElementById('polish-queue-badge');
        if (badge) {
          badge.textContent = `صورة ${this.currentPolishIndex + 1} من ${this.polishQueue.length}`;
        }

        const titleInp = document.getElementById('polish-title-input');
        if (titleInp) titleInp.value = '';

        // Auto-detect category from file name or default to xray (v1.4.82)
        let initialCat = 'xray';
        if (file && file.name) {
          const detectedFromFileName = this.detectCategoryFromText(file.name);
          if (detectedFromFileName) initialCat = detectedFromFileName;
        }
        this.setPolishCategory(initialCat);

        const bSlider = document.getElementById('polish-brightness-slider');
        const cSlider = document.getElementById('polish-contrast-slider');
        if (bSlider) bSlider.value = '100';
        if (cSlider) cSlider.value = '100';
        const bVal = document.getElementById('polish-brightness-val');
        const cVal = document.getElementById('polish-contrast-val');
        if (bVal) bVal.textContent = '100%';
        if (cVal) cVal.textContent = '100%';

        document.querySelectorAll('.polish-preset-btn').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.preset === 'normal');
        });

        const saveBtnText = document.getElementById('polish-save-btn-text');
        if (saveBtnText) {
          saveBtnText.textContent = (this.currentPolishIndex === this.polishQueue.length - 1)
            ? 'حفظ الصورة للشيت'
            : 'حفظ والتالي';
        }

        this.renderPolishCanvas();
        this.app.openModal('modal-image-polish');
      };
      img.src = evt.target.result;
    };

    reader.readAsDataURL(file);
  }

  renderPolishCanvas() {
    const canvas = document.getElementById('polish-canvas');
    if (!canvas || !this.currentPolishImageObj) return;

    const img = this.currentPolishImageObj;
    const ctx = canvas.getContext('2d');

    const rot = (this.polishRotation % 360 + 360) % 360;
    const isSideways = (rot === 90 || rot === 270);

    const origW = img.naturalWidth || img.width;
    const origH = img.naturalHeight || img.height;

    // Display max preview size: up to 700px for responsive rendering
    const maxPrev = 700;
    let scale = 1;
    if (Math.max(origW, origH) > maxPrev) {
      scale = maxPrev / Math.max(origW, origH);
    }
    const drawW = Math.round(origW * scale);
    const drawH = Math.round(origH * scale);

    canvas.width = isSideways ? drawH : drawW;
    canvas.height = isSideways ? drawW : drawH;

    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Apply Filter string
    let filterStr = `brightness(${this.polishBrightness}%) contrast(${this.polishContrast}%)`;
    if (this.polishPreset === 'xray') {
      filterStr += ` grayscale(100%) contrast(155%) brightness(108%)`;
    } else if (this.polishPreset === 'scanner') {
      filterStr += ` grayscale(100%) contrast(220%) brightness(125%)`;
    } else if (this.polishPreset === 'invert') {
      filterStr += ` invert(100%) contrast(130%) grayscale(100%)`;
    }
    ctx.filter = filterStr;

    // Center and rotate
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();
  }

  setPolishCategory(cat) {
    const sel = document.getElementById('polish-category-select');
    if (sel) sel.value = cat;
    document.querySelectorAll('.btn-cat-chip').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.cat === cat);
    });

    const CATEGORY_MAP = {
      mri: { label: 'رنين مغناطيسي (MRI)', cls: 'badge-cat-mri' },
      xray: { label: 'أشعة عادية (X-Ray)', cls: 'badge-cat-xray' },
      ct: { label: 'أشعة مقطعية (CT)', cls: 'badge-cat-ct' },
      sonar: { label: 'سونار / دوبلر', cls: 'badge-cat-sonar' },
      lab: { label: 'تحليل دم ومختبر', cls: 'badge-cat-lab' },
      report: { label: 'تقرير طبي', cls: 'badge-cat-report' },
      other: { label: 'مستند / أخرى', cls: 'badge-cat-other' }
    };

    const catInfo = CATEGORY_MAP[cat] || CATEGORY_MAP.other;
    const topBadge = document.getElementById('polish-selected-cat-badge');
    if (topBadge) {
      topBadge.textContent = catInfo.label;
      topBadge.className = `badge ${catInfo.cls}`;
    }

    if (cat === 'xray' && this.polishPreset === 'normal') {
      this.setPolishPreset('xray');
    }
  }

  detectCategoryFromText(text) {
    if (!text) return null;
    const lower = text.toLowerCase();
    if (lower.includes('ct') || lower.includes('مقطعي') || lower.includes('اشعة مقطعية') || lower.includes('أشعة مقطعية')) return 'ct';
    if (lower.includes('mri') || lower.includes('رنين')) return 'mri';
    if (lower.includes('x-ray') || lower.includes('xray') || lower.includes('عادية') || lower.includes('اشعة عادية') || lower.includes('أشعة عادية')) return 'xray';
    if (lower.includes('sonar') || lower.includes('سونار') || lower.includes('دوبلر') || lower.includes('ultrasound')) return 'sonar';
    if (lower.includes('تحليل') || lower.includes('دم') || lower.includes('lab') || lower.includes('مختبر')) return 'lab';
    if (lower.includes('تقرير') || lower.includes('كشف') || lower.includes('report') || lower.includes('روشتة')) return 'report';
    return null;
  }

  openChangeCategoryModal(imageId, currentCat) {
    this.targetImageIdForCategory = imageId;
    document.querySelectorAll('.btn-change-cat-choice').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.cat === currentCat);
    });
    this.app.openModal('modal-change-image-category');
  }

  async handleChangeCategory(newCat) {
    if (!this.targetImageIdForCategory || !this.currentSheetPatient) return;
    try {
      this.app.showToast('جاري تحديث تصنيف الأشعة...');
      await db.updatePatientImage(this.currentSheetPatient.id, this.targetImageIdForCategory, { category: newCat });
      this.app.closeModal('modal-change-image-category');
      this.app.showToast('تم تحديث تصنيف الأشعة بنجاح');
      await this.loadAndRenderPatientImages(this.currentSheetPatient.id);
      if (this.currentPatientImages && this.lightboxIndex !== undefined && document.getElementById('modal-image-lightbox')?.style.display === 'flex') {
        this.updateLightboxDisplay();
      }
    } catch (err) {
      this.app.showAlert('تعذر تحديث تصنيف الأشعة: ' + err.message, 'خطأ', 'danger');
    }
  }

  setPolishPreset(preset) {
    this.polishPreset = preset;
    document.querySelectorAll('.polish-preset-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.preset === preset);
    });

    const bSlider = document.getElementById('polish-brightness-slider');
    const cSlider = document.getElementById('polish-contrast-slider');
    const bVal = document.getElementById('polish-brightness-val');
    const cVal = document.getElementById('polish-contrast-val');

    if (preset === 'xray') {
      this.polishContrast = 145;
      this.polishBrightness = 105;
    } else if (preset === 'scanner') {
      this.polishContrast = 190;
      this.polishBrightness = 120;
    } else if (preset === 'invert') {
      this.polishContrast = 130;
      this.polishBrightness = 100;
    } else {
      this.polishContrast = 100;
      this.polishBrightness = 100;
    }

    if (bSlider) bSlider.value = String(this.polishBrightness);
    if (cSlider) cSlider.value = String(this.polishContrast);
    if (bVal) bVal.textContent = `${this.polishBrightness}%`;
    if (cVal) cVal.textContent = `${this.polishContrast}%`;

    this.renderPolishCanvas();
  }

  rotatePolish(deg) {
    this.polishRotation = (this.polishRotation + deg + 360) % 360;
    this.renderPolishCanvas();
  }

  resetPolish() {
    if (this.rawOriginalImageObj) {
      this.currentPolishImageObj = this.rawOriginalImageObj;
    }
    this.polishRotation = 0;
    this.endCropMode();
    this.setPolishPreset('normal');
    this.renderPolishCanvas();
    this.app.showToast('تمت استعادة الصورة الأصلية');
  }

  // ================= Polish Studio Cropper (v1.4.79) =================
  startCropMode() {
    if (!this.currentPolishImageObj) return;
    this.isCropMode = true;

    const canvas = document.getElementById('polish-canvas');
    const cropBoxEl = document.getElementById('polish-crop-box');
    const stdToolbar = document.getElementById('polish-standard-toolbar');
    const cropToolbar = document.getElementById('polish-crop-toolbar');

    if (stdToolbar) stdToolbar.style.display = 'none';
    if (cropToolbar) cropToolbar.style.display = 'flex';
    if (cropBoxEl) cropBoxEl.style.display = 'block';

    const cW = canvas.clientWidth || canvas.width || 300;
    const cH = canvas.clientHeight || canvas.height || 200;
    const padX = Math.round(cW * 0.08);
    const padY = Math.round(cH * 0.08);

    this.cropBox = {
      x: padX,
      y: padY,
      w: Math.max(50, cW - padX * 2),
      h: Math.max(50, cH - padY * 2)
    };

    this.updateCropBoxDOM();
  }

  endCropMode() {
    this.isCropMode = false;
    const cropBoxEl = document.getElementById('polish-crop-box');
    const stdToolbar = document.getElementById('polish-standard-toolbar');
    const cropToolbar = document.getElementById('polish-crop-toolbar');

    if (cropBoxEl) cropBoxEl.style.display = 'none';
    if (cropToolbar) cropToolbar.style.display = 'none';
    if (stdToolbar) stdToolbar.style.display = 'flex';
  }

  updateCropBoxDOM() {
    const cropBoxEl = document.getElementById('polish-crop-box');
    if (!cropBoxEl || !this.cropBox) return;
    cropBoxEl.style.left = `${this.cropBox.x}px`;
    cropBoxEl.style.top = `${this.cropBox.y}px`;
    cropBoxEl.style.width = `${this.cropBox.w}px`;
    cropBoxEl.style.height = `${this.cropBox.h}px`;
  }

  setupCropBoxDrag() {
    const cropBoxEl = document.getElementById('polish-crop-box');
    const canvas = document.getElementById('polish-canvas');
    if (!cropBoxEl || !canvas || cropBoxEl._hasCropDrag) return;
    cropBoxEl._hasCropDrag = true;

    let isDragging = false;
    let dragType = 'move';
    let startX = 0, startY = 0;
    let startBox = { x: 0, y: 0, w: 0, h: 0 };

    const onStart = (clientX, clientY, target) => {
      isDragging = true;
      const handle = target.closest('.crop-handle');
      if (handle) {
        dragType = handle.dataset.handle; // 'tl', 'tr', 'bl', 'br'
      } else {
        dragType = 'move';
      }
      startX = clientX;
      startY = clientY;
      startBox = { ...this.cropBox };
    };

    const onMove = (clientX, clientY) => {
      if (!isDragging || !this.cropBox) return;
      const cW = canvas.clientWidth || canvas.width || 300;
      const cH = canvas.clientHeight || canvas.height || 200;
      const dx = clientX - startX;
      const dy = clientY - startY;
      const minSize = 35;

      if (dragType === 'move') {
        const newX = Math.max(0, Math.min(cW - startBox.w, startBox.x + dx));
        const newY = Math.max(0, Math.min(cH - startBox.h, startBox.y + dy));
        this.cropBox.x = Math.round(newX);
        this.cropBox.y = Math.round(newY);
      } else if (dragType === 'br') {
        const newW = Math.max(minSize, Math.min(cW - startBox.x, startBox.w + dx));
        const newH = Math.max(minSize, Math.min(cH - startBox.y, startBox.h + dy));
        this.cropBox.w = Math.round(newW);
        this.cropBox.h = Math.round(newH);
      } else if (dragType === 'bl') {
        const maxDx = startBox.w - minSize;
        const clampedDx = Math.max(-startBox.x, Math.min(maxDx, dx));
        this.cropBox.x = Math.round(startBox.x + clampedDx);
        this.cropBox.w = Math.round(startBox.w - clampedDx);
        this.cropBox.h = Math.round(Math.max(minSize, Math.min(cH - startBox.y, startBox.h + dy)));
      } else if (dragType === 'tr') {
        const maxDy = startBox.h - minSize;
        const clampedDy = Math.max(-startBox.y, Math.min(maxDy, dy));
        this.cropBox.y = Math.round(startBox.y + clampedDy);
        this.cropBox.h = Math.round(startBox.h - clampedDy);
        this.cropBox.w = Math.round(Math.max(minSize, Math.min(cW - startBox.x, startBox.w + dx)));
      } else if (dragType === 'tl') {
        const maxDx = startBox.w - minSize;
        const maxDy = startBox.h - minSize;
        const clampedDx = Math.max(-startBox.x, Math.min(maxDx, dx));
        const clampedDy = Math.max(-startBox.y, Math.min(maxDy, dy));
        this.cropBox.x = Math.round(startBox.x + clampedDx);
        this.cropBox.w = Math.round(startBox.w - clampedDx);
        this.cropBox.y = Math.round(startBox.y + clampedDy);
        this.cropBox.h = Math.round(startBox.h - clampedDy);
      }

      this.updateCropBoxDOM();
    };

    const onEnd = () => {
      isDragging = false;
    };

    // Mouse Listeners
    cropBoxEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
      onStart(e.clientX, e.clientY, e.target);
    });
    window.addEventListener('mousemove', (e) => {
      if (isDragging) {
        e.preventDefault();
        onMove(e.clientX, e.clientY);
      }
    });
    window.addEventListener('mouseup', () => {
      if (isDragging) onEnd();
    });

    // Touch Listeners
    cropBoxEl.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        e.preventDefault();
        onStart(e.touches[0].clientX, e.touches[0].clientY, e.target);
      }
    }, { passive: false });
    window.addEventListener('touchmove', (e) => {
      if (isDragging && e.touches.length === 1) {
        e.preventDefault();
        onMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: false });
    window.addEventListener('touchend', () => {
      if (isDragging) onEnd();
    });
  }

  applyCrop() {
    const canvas = document.getElementById('polish-canvas');
    if (!canvas || !this.currentPolishImageObj || !this.cropBox) {
      this.endCropMode();
      return;
    }

    const dispW = canvas.clientWidth || canvas.width;
    const dispH = canvas.clientHeight || canvas.height;

    // Render un-filtered rotated canvas to extract clean cropped source
    const rot = (this.polishRotation % 360 + 360) % 360;
    const isSideways = (rot === 90 || rot === 270);
    const origW = this.currentPolishImageObj.naturalWidth || this.currentPolishImageObj.width;
    const origH = this.currentPolishImageObj.naturalHeight || this.currentPolishImageObj.height;

    const maxDim = 1600;
    let scale = 1;
    if (Math.max(origW, origH) > maxDim) {
      scale = maxDim / Math.max(origW, origH);
    }
    const drawW = Math.round(origW * scale);
    const drawH = Math.round(origH * scale);

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = isSideways ? drawH : drawW;
    tempCanvas.height = isSideways ? drawW : drawH;
    const tempCtx = tempCanvas.getContext('2d');

    tempCtx.translate(tempCanvas.width / 2, tempCanvas.height / 2);
    tempCtx.rotate((rot * Math.PI) / 180);
    tempCtx.drawImage(this.currentPolishImageObj, -drawW / 2, -drawH / 2, drawW, drawH);

    // Map screen crop coordinates to temp canvas coordinates
    const scaleToTempX = tempCanvas.width / dispW;
    const scaleToTempY = tempCanvas.height / dispH;

    const cropX = Math.max(0, Math.round(this.cropBox.x * scaleToTempX));
    const cropY = Math.max(0, Math.round(this.cropBox.y * scaleToTempY));
    const cropW = Math.min(tempCanvas.width - cropX, Math.round(this.cropBox.w * scaleToTempX));
    const cropH = Math.min(tempCanvas.height - cropY, Math.round(this.cropBox.h * scaleToTempY));

    if (cropW <= 10 || cropH <= 10) {
      this.endCropMode();
      return;
    }

    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = cropW;
    cropCanvas.height = cropH;
    const cropCtx = cropCanvas.getContext('2d');
    cropCtx.drawImage(tempCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    const croppedDataUrl = cropCanvas.toDataURL('image/png');
    const croppedImg = new Image();
    croppedImg.onload = () => {
      this.currentPolishImageObj = croppedImg;
      this.polishRotation = 0; // Rotation is baked into cropped image
      this.endCropMode();
      this.renderPolishCanvas();
      this.app.showToast('تم قص الصورة بنجاح');
    };
    croppedImg.src = croppedDataUrl;
  }

  getPolishedExportDataUrl() {
    const img = this.currentPolishImageObj;
    if (!img) return null;

    const rot = (this.polishRotation % 360 + 360) % 360;
    const isSideways = (rot === 90 || rot === 270);

    const origW = img.naturalWidth || img.width;
    const origH = img.naturalHeight || img.height;

    // Scale to medical standard high-res: max 1500px
    const maxDim = 1200;
    let scale = 1;
    if (Math.max(origW, origH) > maxDim) {
      scale = maxDim / Math.max(origW, origH);
    }
    const fullW = Math.round(origW * scale);
    const fullH = Math.round(origH * scale);

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = isSideways ? fullH : fullW;
    exportCanvas.height = isSideways ? fullW : fullH;

    const ctx = exportCanvas.getContext('2d');
    ctx.save();

    let filterStr = `brightness(${this.polishBrightness}%) contrast(${this.polishContrast}%)`;
    if (this.polishPreset === 'xray') {
      filterStr += ` grayscale(100%) contrast(155%) brightness(108%)`;
    } else if (this.polishPreset === 'scanner') {
      filterStr += ` grayscale(100%) contrast(220%) brightness(125%)`;
    } else if (this.polishPreset === 'invert') {
      filterStr += ` invert(100%) contrast(130%) grayscale(100%)`;
    }
    ctx.filter = filterStr;

    ctx.translate(exportCanvas.width / 2, exportCanvas.height / 2);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.drawImage(img, -fullW / 2, -fullH / 2, fullW, fullH);
    ctx.restore();

    let dataUrl = exportCanvas.toDataURL('image/webp', 0.75);
    if (!dataUrl.startsWith('data:image/webp')) {
      dataUrl = exportCanvas.toDataURL('image/jpeg', 0.75);
    }
    return dataUrl;
  }

  async saveCurrentPolishedImage() {
    if (!this.currentSheetPatient) {
      this.app.showAlert('يرجى اختيار مريض أولاً.', 'تنبيه', 'warning');
      return;
    }

    const saveBtn = document.getElementById('btn-polish-save-current');
    if (saveBtn) saveBtn.disabled = true;

    try {
      const dataUrl = this.getPolishedExportDataUrl();
      if (!dataUrl) throw new Error('تعذر معالجة الصورة');

      const catVal = document.getElementById('polish-category-select')?.value || 'other';
      const titleVal = document.getElementById('polish-title-input')?.value.trim() || '';
      const currentUser = auth.getCurrentUser();

      await db.addPatientImage(this.currentSheetPatient.id, {
        category: catVal,
        title: titleVal,
        dataUrl,
        createdBy: currentUser?.name || 'الطبيب المعالج',
        createdByUid: currentUser?.uid || ''
      });

      this.app.showToast('تم حفظ الصورة بنجاح');
      this.currentPolishIndex++;
      this.loadPolishQueueItem();
    } catch (err) {
      this.app.showAlert('تعذر حفظ الصورة: ' + err.message, 'خطأ', 'danger');
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  skipOrCancelPolish() {
    this.currentPolishIndex++;
    if (this.currentPolishIndex >= this.polishQueue.length) {
      this.app.closeModal('modal-image-polish');
      if (this.currentSheetPatient) {
        this.loadAndRenderPatientImages(this.currentSheetPatient.id);
      }
    } else {
      this.loadPolishQueueItem();
    }
  }

  // ================= Lightbox Viewer Methods =================
  openLightbox(index) {
    if (!this.currentPatientImages || this.currentPatientImages.length === 0) return;
    this.lightboxIndex = Math.max(0, Math.min(index, this.currentPatientImages.length - 1));
    this.lightboxZoom = 1;
    this.lightboxRotation = 0;

    const overlay = document.getElementById('modal-image-lightbox');
    if (overlay) {
      overlay.style.display = 'flex';
      this.updateLightboxDisplay();
    }
  }

  closeLightbox() {
    const overlay = document.getElementById('modal-image-lightbox');
    if (overlay) {
      overlay.style.display = 'none';
    }
  }

  updateLightboxDisplay() {
    if (!this.currentPatientImages || !this.currentPatientImages[this.lightboxIndex]) return;

    const img = this.currentPatientImages[this.lightboxIndex];
    const CATEGORY_MAP = {
      mri: 'رنين مغناطيسي (MRI)',
      xray: 'أشعة عادية (X-Ray)',
      ct: 'أشعة مقطعية (CT)',
      sonar: 'سونار / دوبلر',
      lab: 'تحليل دم ومختبر',
      report: 'تقرير طبي',
      other: 'مستند / أخرى'
    };

    const catInfo = CATEGORY_MAP[img.category] || CATEGORY_MAP.other;
    const catBadge = document.getElementById('lightbox-category-badge');
    if (catBadge) {
      catBadge.textContent = catInfo.label || 'مستند / أخرى';
      catBadge.className = `badge ${catInfo.cls || 'badge-cat-other'}`;
    }

    const titleEl = document.getElementById('lightbox-patient-title');
    if (titleEl) {
      titleEl.textContent = this.currentSheetPatient ? this.currentSheetPatient.name : 'ملف المريض';
    }

    const notesEl = document.getElementById('lightbox-notes-text');
    if (notesEl) {
      const dateStr = img.createdAt ? new Date(img.createdAt).toLocaleDateString('ar-EG-u-nu-latn') : '';
      const notes = img.title ? `${img.title} • ` : '';
      notesEl.textContent = `${notes}تاريخ الإضافة: ${dateStr}`;
    }

    const counter = document.getElementById('lightbox-counter-badge');
    if (counter) {
      counter.textContent = `${this.lightboxIndex + 1} من ${this.currentPatientImages.length}`;
    }

    const mainImg = document.getElementById('lightbox-img');
    if (mainImg) {
      mainImg.src = img.dataUrl;
      this.applyLightboxTransform();
    }

    const downloadLink = document.getElementById('btn-lightbox-download');
    if (downloadLink) {
      downloadLink.href = img.dataUrl;
      downloadLink.download = `${img.category || 'scan'}-${this.lightboxIndex + 1}.webp`;
    }

    this.renderLightboxFilmstrip();
  }

  applyLightboxTransform() {
    const mainImg = document.getElementById('lightbox-img');
    if (mainImg) {
      mainImg.style.transform = `scale(${this.lightboxZoom}) rotate(${this.lightboxRotation}deg)`;
    }
  }

  renderLightboxFilmstrip() {
    const strip = document.getElementById('lightbox-filmstrip-bar');
    if (!strip) return;

    strip.innerHTML = this.currentPatientImages.map((img, idx) => {
      const isAct = idx === this.lightboxIndex ? 'active' : '';
      return `
        <div class="lightbox-filmstrip-item ${isAct}" data-strip-index="${idx}">
          <img src="${img.dataUrl}" alt="Thumb ${idx + 1}">
        </div>
      `;
    }).join('');

    // Click handler for filmstrip items
    strip.querySelectorAll('.lightbox-filmstrip-item').forEach(item => {
      item.addEventListener('click', () => {
        const idx = parseInt(item.getAttribute('data-strip-index'), 10);
        this.lightboxIndex = idx;
        this.lightboxZoom = 1;
        this.lightboxRotation = 0;
        this.updateLightboxDisplay();
      });
    });

    // Scroll active thumbnail into view
    const activeItem = strip.querySelector('.lightbox-filmstrip-item.active');
    if (activeItem) {
      activeItem.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }

  lightboxNext() {
    if (!this.currentPatientImages || this.currentPatientImages.length <= 1) return;
    this.lightboxIndex = (this.lightboxIndex + 1) % this.currentPatientImages.length;
    this.lightboxZoom = 1;
    this.lightboxRotation = 0;
    this.updateLightboxDisplay();
  }

  lightboxPrev() {
    if (!this.currentPatientImages || this.currentPatientImages.length <= 1) return;
    this.lightboxIndex = (this.lightboxIndex - 1 + this.currentPatientImages.length) % this.currentPatientImages.length;
    this.lightboxZoom = 1;
    this.lightboxRotation = 0;
    this.updateLightboxDisplay();
  }

  lightboxZoomIn() {
    this.lightboxZoom = Math.min(this.lightboxZoom + 0.35, 4.0);
    this.applyLightboxTransform();
  }

  lightboxZoomOut() {
    this.lightboxZoom = Math.max(this.lightboxZoom - 0.35, 0.6);
    this.applyLightboxTransform();
  }

  lightboxZoomReset() {
    this.lightboxZoom = 1;
    this.lightboxRotation = 0;
    this.applyLightboxTransform();
  }

  lightboxRotate() {
    this.lightboxRotation = (this.lightboxRotation + 90) % 360;
    this.applyLightboxTransform();
  }

  setupLightboxTouch() {
    const stage = document.getElementById('lightbox-stage');
    if (!stage || stage._hasTouch) return;
    stage._hasTouch = true;

    let startX = 0;
    let startY = 0;
    let startTime = 0;

    stage.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        startX = e.touches[0].screenX;
        startY = e.touches[0].screenY;
        startTime = Date.now();
      }
    }, { passive: true });

    stage.addEventListener('touchend', (e) => {
      if (e.changedTouches.length === 1) {
        const endX = e.changedTouches[0].screenX;
        const endY = e.changedTouches[0].screenY;
        const diffX = endX - startX;
        const diffY = endY - startY;
        const elapsed = Date.now() - startTime;

        // Check if horizontal swipe and not slow drag
        if (Math.abs(diffX) > 40 && Math.abs(diffY) < 70 && elapsed < 800) {
          if (diffX < 0) {
            // Swiped left
            this.lightboxNext();
          } else {
            // Swiped right
            this.lightboxPrev();
          }
        }
      }
    }, { passive: true });

    // Desktop mouse wheel zoom
    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.deltaY < 0) {
        this.lightboxZoomIn();
      } else {
        this.lightboxZoomOut();
      }
    }, { passive: false });
  }


  // ================= Batch Home Visits Methods (جوابات التأمين والزيارات المنزلية) =================
  setBatchSessionType(type) {
    this.batchSessionType = type; // 'home_visit' | 'clinic_batch'
    const isHome = (type === 'home_visit');

    const radioHome = document.querySelector('input[name="batch-session-type"][value="home_visit"]');
    const radioClinic = document.querySelector('input[name="batch-session-type"][value="clinic_batch"]');
    if (radioHome && isHome) radioHome.checked = true;
    if (radioClinic && !isHome) radioClinic.checked = true;

    const btnHome = document.getElementById('btn-type-home-visit');
    const btnClinic = document.getElementById('btn-type-clinic-batch');

    if (btnHome && btnClinic) {
      if (isHome) {
        btnHome.style.border = '1.5px solid #059669';
        btnHome.style.background = 'rgba(5, 150, 105, 0.12)';
        btnHome.style.color = '#059669';

        btnClinic.style.border = '1.5px solid var(--border-color)';
        btnClinic.style.background = 'var(--bg-surface)';
        btnClinic.style.color = 'var(--text-muted)';
      } else {
        btnClinic.style.border = '1.5px solid var(--primary)';
        btnClinic.style.background = 'rgba(2, 132, 199, 0.12)';
        btnClinic.style.color = 'var(--primary)';

        btnHome.style.border = '1.5px solid var(--border-color)';
        btnHome.style.background = 'var(--bg-surface)';
        btnHome.style.color = 'var(--text-muted)';
      }
    }

    const titleEl = document.getElementById('modal-batch-title-text');
    if (titleEl) {
      titleEl.innerHTML = isHome
        ? '<i class="fa-solid fa-house-chimney-medical" style="color: #059669;"></i> <span>تسجيل جواب زيارات منزلية</span>'
        : '<i class="fa-solid fa-hospital-user text-primary"></i> <span>تسجيل جلسات مجمعة بالمركز</span>';
    }

    const docLabel = document.getElementById('batch-hv-doc-label');
    if (docLabel) {
      docLabel.innerHTML = isHome
        ? '<i class="fa-solid fa-user-doctor text-primary"></i> الطبيب المعالج (الذي أجرى الزيارات) <span class="required-star">*</span>'
        : '<i class="fa-solid fa-user-doctor text-primary"></i> الطبيب المعالج بالمركز <span class="required-star">*</span>';
    }

    const preLabel = document.getElementById('batch-hv-presettled-label');
    if (preLabel) {
      preLabel.textContent = isHome
        ? 'زيارات سابقة تم تسويتها مسبقاً مع الطبيب (أرشيف مسوّى - لا تظهر قيد التسوية)'
        : 'جلسات سابقة مسواة مسبقاً (أرشيف مسوّى - لا تظهر قيد التسوية)';
    }
  }

  setBatchPattern(pattern) {
    this.batchHvSelectedPattern = pattern || 'sat_mon_wed';
    const patterns = ['sat_mon_wed', 'sun_tue_thu', 'both'];

    patterns.forEach((p) => {
      const btn = document.querySelector(`.btn-batch-pattern[data-pattern="${p}"]`);
      if (!btn) return;
      const isActive = p === this.batchHvSelectedPattern;
      btn.classList.toggle('active', isActive);

      if (isActive) {
        btn.style.setProperty('background', 'var(--primary)', 'important');
        btn.style.setProperty('color', '#ffffff', 'important');
        btn.style.setProperty('border', '1.5px solid var(--primary)', 'important');
        btn.style.setProperty('box-shadow', '0 2px 8px rgba(2, 132, 199, 0.35)', 'important');
      } else {
        btn.style.setProperty('background', 'transparent', 'important');
        btn.style.setProperty('color', 'var(--text-main)', 'important');
        btn.style.setProperty('border', '1.5px solid var(--border-color)', 'important');
        btn.style.removeProperty('box-shadow');
      }
    });
  }

  async openBatchHomeVisitsModal(patientId, defaultType = 'clinic_batch') {
    const p = this.patients.find((item) => item.id === patientId);
    if (!p) return;

    this.openedFromDocs = true;
    this.activeDocsPatientId = patientId;
    this.activeBatchPatient = p;
    this.batchHvDates = [];
    this.batchHvSelectedPattern = 'sat_mon_wed';
    this.batchSessionType = defaultType;

    const nameEl = document.getElementById('batch-hv-patient-name');
    if (nameEl) nameEl.textContent = p.name;

    const infoEl = document.getElementById('batch-hv-patient-info');
    const isIns = p.billing === 'insurance';
    const cType = p.contractType === 'indirect' ? 'غير مباشر' : 'مباشر';
    if (infoEl) {
      infoEl.textContent = isIns
        ? `${p.insuranceCompany || 'شركة التأمين'} (${cType}) • السن: ${p.age || '-'} سنة`
        : `مريض نقدي • كود: ${p.id.slice(-5)} • السن: ${p.age || '-'} سنة`;
    }

    const badge = document.getElementById('batch-hv-patient-badge');
    if (badge) {
      badge.className = `badge ${isIns ? 'badge-direct' : 'badge-cash'}`;
      badge.textContent = isIns ? 'تأمين' : 'نقدي';
    }

    // Set and sync batch session type (Home vs Clinic)
    this.setBatchSessionType(defaultType);

    // Populate Doctor Dropdown with full doctor objects
    const docSelect = document.getElementById('batch-hv-doctor');
    if (docSelect) {
      const doctorObjects = await db.getDoctorsList();
      docSelect.innerHTML = '<option value="">-- اضغط لاختيار الطبيب المعالج --</option>' + (doctorObjects || []).map((d) => {
        const cleanName = (d.name || '').trim();
        const isSel = (p.doctorId && d.uid === p.doctorId) ? 'selected' : '';
        return `<option value="${escapeHTML(d.uid)}" data-name="${escapeHTML(cleanName)}" ${isSel}>${escapeHTML(cleanName)}</option>`;
      }).join('');

      if (p.doctorId && doctorObjects.some((d) => d.uid === p.doctorId)) {
        docSelect.value = p.doctorId;
      } else {
        docSelect.value = '';
      }

      if (this.app?.updateCustomSelectDisplay) {
        this.app.updateCustomSelectDisplay('batch-hv-doctor');
      }
    }

    // Default start date = today
    const startDateInput = document.getElementById('batch-hv-start-date');
    if (startDateInput) startDateInput.value = getLocalDateStr();

    // Default count
    const countInput = document.getElementById('batch-hv-count');
    if (countInput) countInput.value = p.approvedSessions || 12;

    // Reset and visually apply default pattern selection
    this.setBatchPattern('sat_mon_wed');

    // Ensure pattern click listeners are actively wired
    document.querySelectorAll('.btn-batch-pattern').forEach((btn) => {
      if (!btn._hasPatternListener) {
        btn._hasPatternListener = true;
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const pat = e.currentTarget.getAttribute('data-pattern') || 'sat_mon_wed';
          this.setBatchPattern(pat);
        });
      }
    });

    // Reset presettled checkbox
    const preChk = document.getElementById('batch-hv-presettled');
    if (preChk) preChk.checked = false;

    const refInput = document.getElementById('batch-hv-letter-ref');
    if (refInput) refInput.value = '';

    this.renderBatchHvDates();
    this.app.closeModal('modal-patient-docs', { skipHistory: true });
    this.app.openModal('modal-batch-home-visits', { noSlide: true, alreadyInHistory: true });
  }

  generateBatchHomeVisitDates() {
    const countInput = document.getElementById('batch-hv-count');
    const startDateInput = document.getElementById('batch-hv-start-date');

    const totalCount = Math.min(50, Math.max(1, parseInt(countInput?.value, 10) || 12));
    const startStr = startDateInput?.value || getLocalDateStr();

    const pattern = this.batchHvSelectedPattern || 'sat_mon_wed';
    let allowedDays;
    if (pattern === 'sun_tue_thu') {
      allowedDays = [0, 2, 4];
    } else if (pattern === 'both' || pattern === 'sat_to_thu' || pattern === 'all_week') {
      allowedDays = [0, 1, 2, 3, 4, 6];
    } else {
      allowedDays = [6, 1, 3];
    }

    const generated = [];
    const curDate = new Date(startStr + 'T00:00:00');

    let safetyCounter = 0;
    while (generated.length < totalCount && safetyCounter < 150) {
      safetyCounter++;
      const dayOfWeek = curDate.getDay();

      if (dayOfWeek !== 5 && allowedDays.includes(dayOfWeek)) {
        const y = curDate.getFullYear();
        const m = String(curDate.getMonth() + 1).padStart(2, '0');
        const d = String(curDate.getDate()).padStart(2, '0');
        generated.push(`${y}-${m}-${d}`);
      }
      curDate.setDate(curDate.getDate() + 1);
    }

    this.batchHvDates = generated;
    this.renderBatchHvDates();
  }

  renderBatchHvDates() {
    const container = document.getElementById('batch-hv-dates-chips');
    const countEl = document.getElementById('batch-hv-dates-count');
    if (countEl) countEl.textContent = this.batchHvDates.length;

    if (!container) return;

    if (!this.batchHvDates || this.batchHvDates.length === 0) {
      container.innerHTML = '<span style="color: var(--text-muted); font-size: 0.8rem; margin: auto;">اضغط على "توليد قائمة التواريخ" أو أضف تواريخ يدوياً أدناه</span>';
      return;
    }

    const dayNames = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

    container.innerHTML = this.batchHvDates.map((dateStr, idx) => {
      const dObj = new Date(dateStr + 'T00:00:00');
      const dName = dayNames[dObj.getDay()] || '';
      return `
        <span class="badge" style="background: rgba(2, 132, 199, 0.12); color: #0284c7; border: 1px solid rgba(2, 132, 199, 0.3); padding: 4px 8px; font-size: 0.78rem; font-weight: 700; border-radius: 6px; display: inline-flex; align-items: center; gap: 6px;">
          <span>${idx + 1}. ${dateStr} (${dName})</span>
          <button type="button" class="btn-remove-batch-date" data-index="${idx}" style="background: transparent; border: none; color: #ef4444; font-weight: 800; cursor: pointer; padding: 0 2px; font-size: 0.85rem;" title="حذف هذا التاريخ">&times;</button>
        </span>
      `;
    }).join('');

    container.querySelectorAll('.btn-remove-batch-date').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.currentTarget.getAttribute('data-index'), 10);
        if (!isNaN(idx)) {
          this.removeBatchHvDate(idx);
        }
      });
    });
  }

  removeBatchHvDate(idx) {
    if (idx >= 0 && idx < this.batchHvDates.length) {
      this.batchHvDates.splice(idx, 1);
      this.renderBatchHvDates();
    }
  }

  addBatchHvSingleDate() {
    const input = document.getElementById('batch-hv-manual-date');
    const val = input?.value?.trim();
    if (!val) {
      this.app.showToast('من فضلك حدد تاريخاً لإضافته', 'warning');
      return;
    }

    const dObj = new Date(val + 'T00:00:00');
    if (dObj.getDay() === 5) {
      this.app.showAlert('يوم الجمعة عطلة رسمية بالمركز ولا يمكن تسجيل جلسات فيه.', 'تنبيه عطلة', 'warning');
      return;
    }

    if (!this.batchHvDates.includes(val)) {
      this.batchHvDates.push(val);
      this.batchHvDates.sort();
      this.renderBatchHvDates();
      if (input) input.value = '';
    } else {
      this.app.showToast('هذا التاريخ مضاف بالفعل في القائمة', 'info');
    }
  }

  async handleSaveBatchHomeVisits(e) {
    if (e && e.preventDefault) e.preventDefault();

    if (!this.activeBatchPatient) {
      this.app.showAlert('بيانات المريض غير متوفرة', 'خطأ', 'danger');
      return;
    }

    const docSelect = document.getElementById('batch-hv-doctor');
    const doctorUid = docSelect?.value;
    const selectedOpt = docSelect && docSelect.selectedIndex >= 0 ? docSelect.options[docSelect.selectedIndex] : null;
    const doctorName = selectedOpt ? (selectedOpt.getAttribute('data-name') || selectedOpt.text || '').trim() : '';

    if (!doctorUid) {
      this.app.showAlert('من فضلك اختر الطبيب المعالج الذي أجرى الزيارات.', 'بيانات ناقصة', 'warning');
      return;
    }

    if (!this.batchHvDates || this.batchHvDates.length === 0) {
      this.app.showAlert('يجب توليد أو إضافة تاريخ جلسة واحدة على الأقل.', 'بيانات ناقصة', 'warning');
      return;
    }

    const isPreSettled = Boolean(document.getElementById('batch-hv-presettled')?.checked);
    const letterRef = document.getElementById('batch-hv-letter-ref')?.value?.trim() || '';

    const p = this.activeBatchPatient;
    const saveBtn = document.getElementById('btn-submit-batch-hv');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري تسجيل الجلسات...';
    }

    const isHome = (this.batchSessionType === 'home_visit');
    const labelType = isHome ? 'زيارة منزلية' : 'جلسات مجمعة بالمركز';
    const preSettledFlag = isPreSettled;
    const approvedTotal = parseInt(p.approvedSessions, 10) || 12;

    // 1. Fetch existing sessions for this patient to compute correct chronological sequence
    const existingPatientSessions = (await db.getSessionsForPatient(p.id)) || [];
    const nonExamsExisting = existingPatientSessions.filter(s =>
      (s.entryType === 'session' || !s.entryType) && s.status !== 'cancelled'
    );

    // 2. Draft new batch sessions with unique IDs
    const newSessionDrafts = this.batchHvDates.map((dateStr) => {
      const sessionId = 'batch_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
      return {
        id: sessionId,
        patientId: p.id,
        patientName: p.name,
        doctor: doctorName,
        doctorUid: doctorUid,
        date: dateStr,
        payType: p.billing || 'insurance',
        billing: p.billing || 'insurance',
        contractType: p.contractType || 'direct',
        insuranceName: p.insuranceCompany || (p.billing === 'cash' ? 'نقدي' : 'تأمين'),
        programType: p.programType || p.clinicalSheet?.programType || 'regular',
        sessionPricingType: p.programType || 'regular',
        bodyParts: p.treatedParts || p.clinicalSheet?.treatedParts || [],
        bodyPartsCount: (p.treatedParts && p.treatedParts.length) || p.approvedBodyParts || 1,
        amountPaid: 0,
        isHomeVisit: isHome,
        visitType: isHome ? 'home' : 'clinic',
        isPreSettled: preSettledFlag,
        letterRef: letterRef,
        notes: `${labelType} - جواب تأمين${letterRef ? ` (${letterRef})` : ''}${preSettledFlag ? ' • مسواة مسبقاً' : ''}`
      };
    });

    // 3. Combine existing + new drafts and sequence chronologically (Option A)
    const combined = [...nonExamsExisting, ...newSessionDrafts];
    combined.sort((a, b) => {
      const dComp = (a.date || '').localeCompare(b.date || '');
      if (dComp !== 0) return dComp;
      const tA = a.createdAt || a.recordedAt || '';
      const tB = b.createdAt || b.recordedAt || '';
      if (tA && tB) return tA.localeCompare(tB);
      return (a.id || '').localeCompare(b.id || '');
    });

    // 4. Assign sessionNumber and cycleNumber to all sessions in the sequence
    const newIds = new Set(newSessionDrafts.map(n => n.id));
    const sessionsToCreate = [];

    combined.forEach((s, idx) => {
      const numInCycle = (idx % approvedTotal) + 1;
      const cycleNum = Math.floor(idx / approvedTotal) + 1;

      if (newIds.has(s.id)) {
        s.sessionNumber = numInCycle;
        s.cycleNumber = cycleNum;
        s.approvedSessionsTotal = approvedTotal;
        sessionsToCreate.push(s);
      } else if (s.sessionNumber !== numInCycle || s.cycleNumber !== cycleNum) {
        // Existing session whose sequence shifted chronologically due to retroactive past sessions
        s.sessionNumber = numInCycle;
        s.cycleNumber = cycleNum;
        s.approvedSessionsTotal = approvedTotal;
        sessionsToCreate.push(s);
      }
    });

    try {
      const currentUser = (typeof window !== 'undefined' && window.auth?.getCurrentUser) ? window.auth.getCurrentUser() : null;
      await db.saveBatchSessions(sessionsToCreate, currentUser);

      this.app.closeModal('modal-batch-home-visits');
      this.app.showToast(isHome
        ? `تم بنجاح تسجيل جواب الزيارات المنزلية (${sessionsToCreate.length} زيارة) للمريض ${p.name}`
        : `تم بنجاح تسجيل الجلسات المجمعة بالمركز (${sessionsToCreate.length} جلسة) للمريض ${p.name}`
      );

      if (this.app?.doctorDashboardManager && typeof this.app.doctorDashboardManager.render === 'function') {
        this.app.doctorDashboardManager.render().catch(() => {});
      }
      if (this.app?.sessionsManager && typeof this.app.sessionsManager.updateHomeVisitsBadge === 'function') {
        this.app.sessionsManager.updateHomeVisitsBadge().catch(() => {});
      }
      this.activeBatchPatient = null;
      this.batchHvDates = [];
    } catch (err) {
      this.app.showAlert('تعذر تسجيل حزمة الجلسات: ' + err.message, 'خطأ', 'danger');
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="fa-solid fa-check-double"></i> تأكيد وحفظ الجواب بالكامل';
      }
    }
  }

  async deletePatientSession(sessionId) {
    const currentUser = auth.getCurrentUser();
    if (!RolesManager.canDelete(currentUser)) {
      this.app.showAlert('عفواً، حذف الجلسات متاح للإدارة والاستقبال فقط.', 'صلاحية غير كافية', 'warning');
      return;
    }

    const s = (await db.getSessionById(sessionId)) || (this.currentPatientSessions || []).find(x => x.id === sessionId);
    const itemLabel = (s?.isHomeVisit || s?.visitType === 'home') ? 'الزيارة المنزلية' : (s?.entryType === 'examination' ? 'الكشف' : 'الجلسة');
    const dateLabel = s?.date ? ` بتاريخ ${s.date}` : '';

    const confirmed = await this.app.showConfirm(
      `هل أنت متأكد من حذف ${itemLabel}${dateLabel} للمريض (${this.currentSheetPatient?.name || ''})؟`,
      `تأكيد حذف ${itemLabel}`
    );

    if (!confirmed) return;

    try {
      await db.deleteSession(sessionId);
      await db.logAudit(`حذف ${itemLabel}`, `حذف ${itemLabel} للمريض ${this.currentSheetPatient?.name || ''} برقم ${sessionId}`, currentUser);
      this.app.showToast(`تم حذف ${itemLabel} بنجاح`);

      if (this.currentSheetPatient) {
        await this.openPatientClinicalSheet(this.currentSheetPatient.id);
        this.openPatientSessionsModal();
      }

      if (this.app?.doctorDashboardManager && typeof this.app.doctorDashboardManager.render === 'function') {
        this.app.doctorDashboardManager.render().catch(() => {});
      }
      if (this.app?.sessionsManager && typeof this.app.sessionsManager.updateHomeVisitsBadge === 'function') {
        this.app.sessionsManager.updateHomeVisitsBadge().catch(() => {});
      }
    } catch (err) {
      console.error('deletePatientSession error:', err);
      this.app.showAlert('تعذر حذف الجلسة: ' + err.message, 'خطأ', 'danger');
    }
  }

}
