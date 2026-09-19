// ========================================================
// ASCPT - PWA Network Status & Context-Aware Force-Reload
// ========================================================

import { triggerHaptic } from './utils.js';

export class PWAManager {
  static init() {
    this.initOnlineStatus();
    this.initInstallPrompt();
    this.initPullToReload();
  }

  static initOnlineStatus() {
    let previousState = navigator.onLine;
    const updateOnlineStatus = () => {
      const isOnline = navigator.onLine;
      const dot = document.getElementById('net-status-dot');
      if (dot) {
        dot.className = isOnline ? 'status-dot' : 'status-dot offline';
        dot.title = isOnline ? 'متصل بالإنترنت' : 'وضع غير متصل (البيانات تحفظ محلياً)';
      }
      if (previousState !== isOnline) {
        previousState = isOnline;
        if (!isOnline) {
          if (window.app && typeof window.app.showToast === 'function') {
            window.app.showToast('وضع غير متصل بالإنترنت — البيانات تُحفظ محلياً بأمان', 'warning');
          }
        } else {
          if (window.app && typeof window.app.showToast === 'function') {
            window.app.showToast('تم استعادة الاتصال بالإنترنت بنجاح', 'success');
          }
        }
      }
    };

    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    updateOnlineStatus();
  }

  static initInstallPrompt() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      console.log('PWA install prompt ready.');
    });
  }

  static initPullToReload() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const indicator = document.getElementById('pull-to-reload-indicator');
    const icon = document.getElementById('pull-to-reload-icon');
    const progressCircle = document.getElementById('pull-progress-circle');
    if (!indicator || !icon || !progressCircle) return;

    const CIRCLE_CIRCUMFERENCE = 119.38;

    const getViewIcon = () => {
      const activeNav = document.querySelector('.bottom-nav .b-nav-item.active, .sidebar .nav-link.active');
      const view = activeNav?.getAttribute('data-view') || window.app?.currentView || 'dashboard';
      const iconMap = {
        'dashboard': 'fa-solid fa-chart-pie',
        'patients': 'fa-solid fa-users',
        'sessions': 'fa-solid fa-calendar-check',
        'finance': 'fa-solid fa-file-invoice-dollar',
        'appointments': 'fa-solid fa-calendar-week',
        'claims': 'fa-solid fa-file-shield',
        'doctor-dashboard': 'fa-solid fa-user-doctor'
      };
      return iconMap[view] || 'fa-solid fa-rotate';
    };

    let startY = 0;
    let startX = 0;
    let isPulling = false;
    let isReady = false;
    let isExecuting = false;
    const PULL_THRESHOLD = 85;

    const canPull = (targetEl = null) => {
      if (isExecuting) return false;
      const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
      if (scrollY > 5) return false;

      // 1. Strict Modal Guard: Never pull-to-reload if ANY modal or dialog is currently open (.active / .show / stack)
      const hasOpenModal = document.querySelector(
        '.modal-backdrop.active, .modal-backdrop.show, .modal-backdrop[style*="display: block"], .modal-backdrop[style*="display: flex"], [role="dialog"].active'
      );
      if (hasOpenModal) return false;

      if (window.app?._openModalStack && window.app._openModalStack.length > 0) return false;

      // 2. Strict Target Guard: Never pull-to-reload if touch originates inside any form or modal element
      if (targetEl && typeof targetEl.closest === 'function') {
        if (targetEl.closest('.modal-backdrop, .modal-content, .modal-body, .custom-picker-content, [role="dialog"], form, .drawer')) {
          return false;
        }
      }

      return true;
    };

    window.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      if (!canPull(e.target)) return;
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
      isPulling = false;
      isReady = false;

      // Dynamically display the icon of the current active screen
      const viewIconClass = getViewIcon();
      icon.className = `${viewIconClass} pull-to-reload-icon`;
      progressCircle.style.strokeDashoffset = CIRCLE_CIRCUMFERENCE;
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
      if (!startY || isExecuting) return;
      if (e.touches.length !== 1) return;

      if (!canPull(e.target)) {
        startY = 0;
        isPulling = false;
        indicator.classList.remove('active', 'ready');
        indicator.style.transform = 'translate(-50%, -150%)';
        return;
      }

      const currentY = e.touches[0].clientY;
      const currentX = e.touches[0].clientX;
      const deltaY = currentY - startY;
      const deltaX = Math.abs(currentX - startX);

      if (deltaY > 8 && deltaY > deltaX && canPull(e.target)) {
        isPulling = true;
        indicator.classList.add('active');
        indicator.style.transition = 'none';

        const damped = Math.min(deltaY * 0.42, 80);
        indicator.style.transform = `translate(-50%, ${damped}px)`;

        const ratio = Math.min(Math.max(deltaY / PULL_THRESHOLD, 0), 1);
        const offset = CIRCLE_CIRCUMFERENCE * (1 - ratio);
        progressCircle.style.strokeDashoffset = offset;

        if (deltaY >= PULL_THRESHOLD) {
          if (!isReady) {
            isReady = true;
            indicator.classList.add('ready');
            triggerHaptic('medium');
          }
        } else {
          if (isReady) {
            isReady = false;
            indicator.classList.remove('ready');
          }
        }
      }
    }, { passive: true });

    const handleRelease = async () => {
      if (!isPulling || isExecuting) {
        startY = 0;
        return;
      }

      if (isReady) {
        // Cancel pull-to-refresh when offline, smooth spring-back, and show toast
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          indicator.style.transition = 'transform 0.25s ease, opacity 0.25s ease';
          indicator.style.transform = 'translate(-50%, -150%)';
          indicator.classList.remove('active', 'ready', 'loading');
          startY = 0;
          isPulling = false;
          isReady = false;
          isExecuting = false;
          triggerHaptic('warning');
          if (window.app && typeof window.app.showToast === 'function') {
            window.app.showToast('أنت غير متصل بالإنترنت حالياً', 'warning');
          }
          return;
        }

        isExecuting = true;
        indicator.classList.remove('ready');
        indicator.classList.add('loading');
        indicator.style.transition = 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)';
        indicator.style.transform = 'translate(-50%, 55px)';
        triggerHaptic('success');

        await PWAManager.forceReload();
      } else {
        indicator.style.transition = 'transform 0.25s ease, opacity 0.25s ease';
        indicator.style.transform = 'translate(-50%, -150%)';
        indicator.classList.remove('active', 'ready');
      }

      startY = 0;
      isPulling = false;
      isReady = false;
    };

    window.addEventListener('touchend', handleRelease, { passive: true });
    window.addEventListener('touchcancel', handleRelease, { passive: true });
  }

  static async forceReload() {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      if (window.app && typeof window.app.showToast === 'function') {
        window.app.showToast('أنت غير متصل بالإنترنت حالياً', 'warning');
      }
      return;
    }

    try {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const reg of registrations) {
          await reg.update().catch(() => {});
        }
      }
    } catch (_) {}

    // Preserve active screen state across reload
    const activeView = window.app?.currentView || 'dashboard';
    let patientParam = '';
    if (activeView === 'patient-sheet' && window.app?.patientsManager?.currentSheetPatient?.id) {
      patientParam = `&patientId=${encodeURIComponent(window.app.patientsManager.currentSheetPatient.id)}`;
    }

    try {
      sessionStorage.setItem('ascpt_active_view', activeView);
      if (patientParam) {
        sessionStorage.setItem('ascpt_active_patient_id', window.app.patientsManager.currentSheetPatient.id);
      }
    } catch (_) {}

    const cleanUrl = window.location.href.split('#')[0].split('?')[0];
    window.location.replace(`${cleanUrl}?view=${encodeURIComponent(activeView)}${patientParam}&reload=${Date.now()}`);
  }
}
