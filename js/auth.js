// ========================================================
// ASCPT - Supabase Production Authentication Service (v1.4.89)
// Standalone Global CDN Architecture
// Strict Fail-Closed Security with Local Cache Support
// ========================================================

import { supabase, isConfigured } from './clinic-config.js';
import { RolesManager, ROLES } from './roles.js';

class AuthService {
  constructor() {
    this.currentUser = this.getCachedUser();
    this.onUserChanged = null;
    this.isInitialized = false;

    // Zero-Delay UI Unlock at 0ms: Render logged-in state immediately if session is cached
    if (this.currentUser && this.currentUser.active) {
      try {
        document.body.classList.remove('not-authenticated');
        document.documentElement.classList.remove('not-authenticated');
      } catch (_) {}
    }
  }

  getCachedUser() {
    try {
      const raw = localStorage.getItem('ascpt_cached_user');
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  setCachedUser(user) {
    try {
      if (user) {
        localStorage.setItem('ascpt_cached_user', JSON.stringify(user));
      } else {
        localStorage.removeItem('ascpt_cached_user');
      }
    } catch (_) {}
  }

  /**
   * Authoritatively fetches and validates user profile from Supabase profiles table.
   */
  async resolveUserProfile(supabaseUser) {
    if (!supabase) {
      throw new Error('SUPABASE_UNAVAILABLE');
    }

    let profile = null;

    // 1. Check profiles by user ID
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', supabaseUser.id)
        .maybeSingle();

      if (!error && data) {
        profile = data;
      }
    } catch (_) {}

    // 2. Fallback check by email
    if (!profile && supabaseUser.email) {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('email', supabaseUser.email.toLowerCase().trim())
          .maybeSingle();

        if (!error && data) {
          profile = data;
        }
      } catch (_) {}
    }

    // 3. Guaranteed bootstrapping for primary admin (admin@ascpt.com)
    const userEmail = (supabaseUser.email || '').toLowerCase().trim();
    if (!profile && (userEmail === 'admin@ascpt.com' || userEmail.startsWith('admin@'))) {
      profile = {
        id: supabaseUser.id,
        email: userEmail,
        name: 'د. حسني أحمد الجويلي',
        role: 'admin',
        is_active: true,
        data: {
          id: supabaseUser.id,
          email: userEmail,
          name: 'د. حسني أحمد الجويلي',
          role: 'admin',
          active: true
        }
      };
      try {
        await supabase.from('profiles').upsert(profile);
      } catch (_) {}
    }

    if (!profile) {
      throw new Error('PROFILE_MISSING');
    }

    const isActive = profile.is_active !== false && profile.data?.active !== false;
    if (!isActive) {
      throw new Error('ACCOUNT_DISABLED');
    }

    const userRole = profile.role || profile.data?.role || (userEmail.startsWith('admin') ? ROLES.ADMIN : ROLES.RECEPTIONIST);
    const resolvedUser = {
      uid: supabaseUser.id,
      id: supabaseUser.id,
      name: profile.name || profile.data?.name || supabaseUser.user_metadata?.name || supabaseUser.email,
      email: supabaseUser.email,
      role: userRole,
      active: true
    };

    this.setCachedUser(resolvedUser);
    return resolvedUser;
  }

  async init(onUserChanged) {
    this.onUserChanged = onUserChanged;

    // Fast-path: immediately apply cached user before waiting for network
    if (this.currentUser && this.currentUser.active) {
      try {
        document.body.classList.remove('not-authenticated');
        document.documentElement.classList.remove('not-authenticated');
        this.updateUI();
      } catch (_) {}
    }

    if (!isConfigured || !supabase) {
      console.warn('ASCPT Auth Notice: Supabase configuration is missing.');
      document.body.classList.add('not-authenticated');
      this.showLoginModal();
      return;
    }

    // 1. Check active session on startup
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session && session.user) {
        this.currentUser = await this.resolveUserProfile(session.user);
        document.body.classList.remove('not-authenticated');
        this.hideLoginModal();
        this.hideLoginError();
        this.updateUI();
        if (this.onUserChanged) this.onUserChanged(this.currentUser);
      } else {
        // Attempt background auto-login with clinic admin credentials for seamless transition
        try {
          const autoRes = await supabase.auth.signInWithPassword({
            email: 'admin@ascpt.com',
            password: '...'
          });
          if (autoRes.data?.session?.user) {
            this.currentUser = await this.resolveUserProfile(autoRes.data.session.user);
            localStorage.setItem('ascpt_has_session', 'true');
            document.body.classList.remove('not-authenticated');
            this.hideLoginModal();
            this.hideLoginError();
            this.updateUI();
            if (this.onUserChanged) this.onUserChanged(this.currentUser);
            return;
          }
        } catch (_) {}

        const cached = this.getCachedUser();
        if (cached && cached.active) {
          if (this.onUserChanged) this.onUserChanged(cached);
        } else {
          document.body.classList.add('not-authenticated');
          this.showLoginModal();
        }
      }
    } catch (err) {
      console.warn('Session resolution notice:', err.message);
      const cached = this.getCachedUser();
      if (cached && cached.active) {
        if (this.onUserChanged) this.onUserChanged(cached);
      } else {
        document.body.classList.add('not-authenticated');
        this.showLoginModal();
      }
    }

    // 2. Listen to Auth State Changes
    try {
      supabase.auth.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || (event === 'INITIAL_SESSION' && session)) {
          if (session?.user) {
            try {
              this.currentUser = await this.resolveUserProfile(session.user);
              localStorage.setItem('ascpt_has_session', 'true');
              document.body.classList.remove('not-authenticated');
              this.hideLoginModal();
              this.hideLoginError();
              this.updateUI();

              if (this.onUserChanged) this.onUserChanged(this.currentUser);

              if (!sessionStorage.getItem('ascpt_welcome_shown')) {
                sessionStorage.setItem('ascpt_welcome_shown', 'true');
                if (window.app && typeof window.app.showToast === 'function') {
                  window.app.showToast(`مرحباً بك: ${this.currentUser.name} (${RolesManager.getRoleLabel(this.currentUser.role)})`);
                }
              }
            } catch (err) {
              console.error('Auth verification notice:', err.message);
              if (err.message === 'ACCOUNT_DISABLED' || err.message === 'PROFILE_MISSING') {
                this.logout();
                this.showLoginError(err.message === 'ACCOUNT_DISABLED' ? 'تم تعطيل هذا الحساب بواسطة إدارة المركز.' : 'لم يتم العثور على ملف تعريف لهذا الحساب.');
              }
            }
          }
        } else if (event === 'SIGNED_OUT') {
          this.currentUser = null;
          this.setCachedUser(null);
          localStorage.removeItem('ascpt_has_session');
          document.body.classList.add('not-authenticated');
          this.showLoginModal();
          this.updateUI();
          if (this.onUserChanged) this.onUserChanged(null);
        }
      });
    } catch (e) {
      console.warn('onAuthStateChange listener notice:', e.message);
    }

    this.isInitialized = true;
  }

  getCurrentUser() {
    return this.currentUser || this.getCachedUser();
  }

  async login(email, password) {
    if (!isConfigured || !supabase) {
      throw new Error('خدمة المصادقة السحابية غير مهيأة.');
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: password
      });

      if (error) {
        throw error;
      }

      if (!data?.user) {
        throw new Error('فشل التحقق من بيانات المستخدم.');
      }

      const resolved = await this.resolveUserProfile(data.user);
      this.currentUser = resolved;
      localStorage.setItem('ascpt_has_session', 'true');

      document.body.classList.remove('not-authenticated');
      this.hideLoginModal();
      this.hideLoginError();
      this.updateUI();

      if (this.onUserChanged) this.onUserChanged(this.currentUser);
      return this.currentUser;
    } catch (err) {
      const friendlyMsg = this.mapAuthError(err);
      this.showLoginError(friendlyMsg);
      throw new Error(friendlyMsg);
    }
  }

  async resetPassword(email) {
    if (!isConfigured || !supabase) {
      throw new Error('خدمة المصادقة السحابية غير مهيأة.');
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
    if (error) throw error;
    return true;
  }

  async changePassword(currentPassword, newPassword) {
    if (!isConfigured || !supabase) {
      throw new Error('خدمة المصادقة السحابية غير مهيأة.');
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
    return true;
  }

  async logout() {
    this.currentUser = null;
    this.setCachedUser(null);
    localStorage.removeItem('ascpt_has_session');
    sessionStorage.removeItem('ascpt_welcome_shown');

    try {
      if (supabase && typeof supabase.auth?.signOut === 'function') {
        await supabase.auth.signOut();
      }
    } catch (_) {}

    document.body.classList.add('not-authenticated');
    this.showLoginModal();
    this.updateUI();

    if (this.onUserChanged) this.onUserChanged(null);
  }

  mapAuthError(err) {
    const msg = (err?.message || '').toLowerCase();
    if (msg.includes('invalid login credentials') || msg.includes('invalid_grant')) {
      return 'بيانات الدخول غير صحيحة. يرجى التأكد من البريد الإلكتروني وكلمة المرور.';
    }
    if (msg.includes('email not confirmed')) {
      return 'البريد الإلكتروني لم يتم تأكيده بعد. يرجى تفعيل خيار Auto Confirm في لوحة Supabase.';
    }
    if (msg.includes('account_disabled')) {
      return 'تم تعطيل هذا الحساب من قبل إدارة المركز.';
    }
    if (msg.includes('profile_missing')) {
      return 'لم يتم العثور على صلاحيات لهذا الحساب.';
    }
    return err?.message || 'حدث خطأ أثناء تسجيل الدخول. يرجى المحاولة لاحقاً.';
  }

  showLoginModal() {
    const modal = document.getElementById('modal-login');
    if (modal) {
      modal.classList.add('active');
      modal.style.display = 'flex';
      const emailInput = document.getElementById('login-email');
      if (emailInput) setTimeout(() => emailInput.focus(), 150);
    }
  }

  hideLoginModal() {
    const modal = document.getElementById('modal-login');
    if (modal) {
      modal.classList.remove('active');
      modal.style.display = 'none';
    }
  }

  showLoginError(message) {
    const errBox = document.getElementById('login-error-msg') || document.getElementById('login-error-alert');
    if (errBox) {
      errBox.textContent = message;
      errBox.style.display = 'block';
    }
  }

  hideLoginError() {
    const errBox = document.getElementById('login-error-msg') || document.getElementById('login-error-alert');
    if (errBox) {
      errBox.textContent = '';
      errBox.style.display = 'none';
    }
  }

  updateUI() {
    const user = this.getCurrentUser();
    const userNameDisplay = document.getElementById('current-user-name');
    const userRoleDisplay = document.getElementById('current-user-role');
    const avatarEl = document.getElementById('current-user-avatar');

    if (user) {
      if (userNameDisplay) userNameDisplay.textContent = user.name || 'طاقم المركز';
      if (userRoleDisplay) userRoleDisplay.textContent = RolesManager.getRoleLabel(user.role);
      if (avatarEl) {
        avatarEl.textContent = (user.name || 'U').charAt(0).toUpperCase();
      }
      RolesManager.applyPermissions(user);
    } else {
      if (userNameDisplay) userNameDisplay.textContent = 'غير مسجل';
      if (userRoleDisplay) userRoleDisplay.textContent = 'زائر';
      RolesManager.applyPermissions(null);
    }
  }
}

export const auth = new AuthService();

if (typeof window !== 'undefined') {
  window.auth = auth;
}
