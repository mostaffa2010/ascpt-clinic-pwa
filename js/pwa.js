// ========================================================
// ASCPT - PWA Network Status & Custom Force-Reload Engine
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
    const textEl = document.getElementById('pull-to-reload-text');
    if (!indicator || !icon || !textEl) return;

    let startY = 0;
    let startX = 0;
    let isPulling = false;
    let isReady = false;
    let isExecuting = false;
    const PULL_THRESHOLD = 90;

    const canPull = () => {
      if (isExecuting) return false;
      const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
      if (scrollY > 5) return false;
      const openModal = document.querySelector('.modal-backdrop.show, .modal-backdrop[style*="display: block"], .modal-backdrop[style*="display: flex"]');
      return !openModal;
    };

    window.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      if (!canPull()) return;
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
      isPulling = false;
      isReady = false;
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
      if (!startY || isExecuting) return;
      if (e.touches.length !== 1) return;

      const currentY = e.touches[0].clientY;
      const currentX = e.touches[0].clientX;
      const deltaY = currentY - startY;
      const deltaX = Math.abs(currentX - startX);

      if (deltaY > 10 && deltaY > deltaX && canPull()) {
        isPulling = true;
        indicator.classList.add('active');
        indicator.style.transition = 'none';

        const damped = Math.min(deltaY * 0.45, 110);
        indicator.style.transform = `translate(-50%, ${damped}px)`;

        if (deltaY >= PULL_THRESHOLD) {
          if (!isReady) {
            isReady = true;
            indicator.classList.add('ready');
            textEl.textContent = 'أفلت للتحديث الشامل وإعادة التحميل';
            triggerHaptic('medium');
          }
        } else {
          if (isReady) {
            isReady = false;
            indicator.classList.remove('ready');
            textEl.textContent = 'اسحب للأسفل للتحديث الشامل';
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
        isExecuting = true;
        indicator.style.transition = 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)';
        indicator.style.transform = 'translate(-50%, 65px)';
        icon.className = 'fa-solid fa-spinner fa-spin pull-to-reload-icon';
        textEl.textContent = 'جاري التحديث الشامل وتخطي الكاش...';
        triggerHaptic('success');

        await PWAManager.forceReload();
      } else {
        indicator.style.transition = 'transform 0.25s ease, opacity 0.25s ease';
        indicator.style.transform = 'translate(-50%, -130%)';
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
    try {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const reg of registrations) {
          await reg.update().catch(() => {});
        }
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        for (const key of keys) {
          await caches.delete(key);
        }
      }
    } catch (_) {}

    const cleanUrl = window.location.href.split('#')[0].split('?')[0];
    window.location.replace(`${cleanUrl}?reload=${Date.now()}`);
  }
}
