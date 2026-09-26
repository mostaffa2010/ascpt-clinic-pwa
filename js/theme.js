// ==========================================================================
// ASCPT Clinic PWA - Flexible Theme Manager (Auto / Dark / Light)
// File: js/theme.js
// Handles OS/Device Theme Auto-Sync, Manual Overrides, & Real-Time Sync
// ==========================================================================

export class ThemeManager {
  constructor(app) {
    this.app = app;
    this.mql = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    this.mode = 'auto'; // 'auto' | 'dark' | 'light'
    this.init();
  }

  init() {
    const saved = localStorage.getItem('ascpt_theme');
    if (saved === 'dark' || saved === 'light') {
      this.mode = saved;
    } else {
      this.mode = 'auto';
    }

    // Apply the effective theme immediately without toast on boot
    this.applyTheme(this.getEffectiveTheme(), false);
    this.updateSegmentedUI();

    // Attach live change listener so toggling dark mode in phone settings instantly switches theme when in auto mode
    if (this.mql) {
      const handleSystemThemeChange = (e) => {
        if (this.mode === 'auto') {
          const nextTheme = e.matches ? 'dark' : 'light';
          this.applyTheme(nextTheme, false);
          this.updateSegmentedUI();
        }
      };

      if (typeof this.mql.addEventListener === 'function') {
        this.mql.addEventListener('change', handleSystemThemeChange);
      } else if (typeof this.mql.addListener === 'function') {
        this.mql.addListener(handleSystemThemeChange);
      }
    }

    // Event delegation / direct listeners for 3-option segmented control
    const segmentBtns = document.querySelectorAll('.theme-segment-btn[data-theme-mode]');
    segmentBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const selectedMode = btn.getAttribute('data-theme-mode');
        if (selectedMode) {
          this.setThemeMode(selectedMode, true);
        }
      });
    });

    // Standalone / legacy toggle buttons (toggle between dark and light)
    const toggleBtns = document.querySelectorAll(
      '#btn-toggle-theme, #btn-toggle-theme-desktop, #btn-profile-toggle-theme, #btn-view-toggle-theme'
    );
    toggleBtns.forEach(btn => {
      btn.addEventListener('click', () => this.toggleTheme());
    });
  }

  getEffectiveTheme() {
    if (this.mode === 'dark') return 'dark';
    if (this.mode === 'light') return 'light';
    // 'auto': follows system OS preference
    return (this.mql && this.mql.matches) ? 'dark' : 'light';
  }

  setThemeMode(mode, showFeedback = true) {
    if (mode !== 'auto' && mode !== 'dark' && mode !== 'light') return;
    this.mode = mode;
    localStorage.setItem('ascpt_theme', mode);

    const effective = this.getEffectiveTheme();
    this.applyTheme(effective, showFeedback);
    this.updateSegmentedUI();
  }

  toggleTheme() {
    const current = this.getEffectiveTheme();
    const nextMode = current === 'dark' ? 'light' : 'dark';
    this.setThemeMode(nextMode, true);
  }

  updateSegmentedUI() {
    const segmentBtns = document.querySelectorAll('.theme-segment-btn[data-theme-mode]');
    segmentBtns.forEach(btn => {
      const btnMode = btn.getAttribute('data-theme-mode');
      const isActive = btnMode === this.mode;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
    });

    const vpSub = document.querySelector('.profile-setting-theme-block .profile-setting-sub');
    if (vpSub) {
      if (this.mode === 'auto') {
        const isDark = this.mql && this.mql.matches;
        vpSub.textContent = `تلقائي حسب نظام الهاتف (${isDark ? 'الداكن حالياً' : 'الفاتح حالياً'})`;
      } else if (this.mode === 'dark') {
        vpSub.textContent = 'الوضع الداكن مفعل دائماً';
      } else {
        vpSub.textContent = 'الوضع الفاتح مفعل دائماً';
      }
    }
  }

  applyTheme(theme, showFeedback = false) {
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
        vpIcon.className = this.mode === 'auto' ? 'fa-solid fa-circle-half-stroke text-primary' : 'fa-solid fa-moon text-primary';
        vpIcon.style.removeProperty('color');
      }
      if (vpLabel) vpLabel.textContent = 'مظهر التطبيق';
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
        vpIcon.className = this.mode === 'auto' ? 'fa-solid fa-circle-half-stroke text-primary' : 'fa-solid fa-sun text-warning';
        vpIcon.style.removeProperty('color');
      }
      if (vpLabel) vpLabel.textContent = 'مظهر التطبيق';
    }

    if (showFeedback && this.app?.showToast) {
      if (this.mode === 'auto') {
        this.app.showToast('تم ضبط المظهر: تلقائي حسب الهاتف 📱');
      } else if (this.mode === 'dark') {
        this.app.showToast('تم تفعيل الوضع الداكن 🌙');
      } else {
        this.app.showToast('تم تفعيل الوضع الفاتح ☀️');
      }
    }
  }
}
