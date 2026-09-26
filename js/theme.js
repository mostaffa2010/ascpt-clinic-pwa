// ==========================================================================
// ASCPT Clinic PWA - Theme Manager & System Auto-Sync
// File: js/theme.js
// Handles OS/Device Theme Auto-Sync & Real-Time Media Query Changes
// ==========================================================================

export class ThemeManager {
  constructor(app) {
    this.app = app;
    this.mql = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    this.init();
  }

  init() {
    const saved = localStorage.getItem('ascpt_theme');
    let isDark;
    if (saved === 'dark') {
      isDark = true;
    } else if (saved === 'light') {
      isDark = false;
    } else {
      isDark = this.mql ? this.mql.matches : false;
    }

    this.applyTheme(isDark ? 'dark' : 'light');

    // Attach live change listener so toggling dark mode in phone settings instantly switches theme
    if (this.mql) {
      const handleSystemThemeChange = (e) => {
        const nextTheme = e.matches ? 'dark' : 'light';
        this.applyTheme(nextTheme);
        localStorage.removeItem('ascpt_theme');
      };

      if (typeof this.mql.addEventListener === 'function') {
        this.mql.addEventListener('change', handleSystemThemeChange);
      } else if (typeof this.mql.addListener === 'function') {
        this.mql.addListener(handleSystemThemeChange);
      }
    }

    const toggleBtns = document.querySelectorAll(
      '#btn-toggle-theme, #btn-toggle-theme-desktop, #btn-profile-toggle-theme, #btn-view-toggle-theme'
    );
    toggleBtns.forEach(btn => {
      btn.addEventListener('click', () => this.toggleTheme());
    });
  }

  toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    this.applyTheme(next);
    localStorage.setItem('ascpt_theme', next);
    if (this.app?.showToast) {
      this.app.showToast(next === 'dark' ? 'تم تفعيل الوضع الليلي 🌙' : 'تم تفعيل الوضع النهاري ☀️');
    }
  }

  applyTheme(theme) {
    const pIcon = document.getElementById('profile-theme-icon');
    const pLabel = document.getElementById('profile-theme-label');
    const vpIcon = document.getElementById('view-profile-theme-icon');
    const vpLabel = document.getElementById('view-profile-theme-label');

    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', '#0b1120');
      document.querySelectorAll('#btn-toggle-theme i, #btn-toggle-theme-desktop i').forEach(icon => {
        icon.className = 'fa-solid fa-sun text-warning';
        icon.style.removeProperty('color');
      });
      if (pIcon) {
        pIcon.className = 'fa-solid fa-sun text-warning';
        pIcon.style.removeProperty('color');
      }
      if (pLabel) pLabel.textContent = 'الوضع النهاري (فاتح)';
      if (vpIcon) {
        vpIcon.className = 'fa-solid fa-sun text-warning';
        vpIcon.style.removeProperty('color');
      }
      if (vpLabel) vpLabel.textContent = 'الوضع النهاري (فاتح)';
    } else {
      document.documentElement.removeAttribute('data-theme');
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', '#0284c7');
      document.querySelectorAll('#btn-toggle-theme i, #btn-toggle-theme-desktop i').forEach(icon => {
        icon.className = 'fa-solid fa-moon';
        icon.style.removeProperty('color');
      });
      if (pIcon) {
        pIcon.className = 'fa-solid fa-moon';
        pIcon.style.removeProperty('color');
      }
      if (pLabel) pLabel.textContent = 'الوضع الليلي (داكن)';
      if (vpIcon) {
        vpIcon.className = 'fa-solid fa-moon';
        vpIcon.style.removeProperty('color');
      }
      if (vpLabel) vpLabel.textContent = 'الوضع الليلي (داكن)';
    }
  }
}
