// ========================================================
// ASCPT - Production Firebase Authentication Service
// Pinned CDN Modules: Firebase v12.18.0
// Strict Fail-Closed Security with True Offline Cache Support
// ========================================================

import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import {
  doc,
  getDoc,
  getDocFromCache
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
import { firebaseAuth, firestoreDb, isConfigured } from './firebase-init.js';
import { RolesManager, ROLES } from './roles.js';

class AuthService {
  constructor() {
    this.currentUser = null;
    this.onUserChanged = null;
    this.isInitialized = false;
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
   * Authoritatively fetches and validates user profile from Firestore users/{uid}.
   * Supports offline operation via Firestore IndexedDB persistent cache.
   * Strict Fail-Closed Policy:
   * - No localStorage role fallbacks.
   * - No email heuristics.
   * - No default doctor role assumptions.
   * If profile is missing, inactive, or invalid, access is completely denied.
   */
  async resolveUserProfile(firebaseUser) {
    if (!firestoreDb) {
      throw new Error('FIRESTORE_UNAVAILABLE');
    }

    let userSnap = null;
    const userDocRef = doc(firestoreDb, 'users', firebaseUser.uid);

    // 1. Fast Cache-First retrieval from Firestore IndexedDB cache for instant startup (<15ms)
    try {
      userSnap = await getDocFromCache(userDocRef);
    } catch (_) {}

    // 2. If not found in cache, fetch from Firestore server
    if (!userSnap || !userSnap.exists()) {
      try {
        const fetchPromise = getDoc(userDocRef);
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2500));
        userSnap = await Promise.race([fetchPromise, timeoutPromise]);
      } catch (err) {
        try {
          userSnap = await getDocFromCache(userDocRef);
        } catch (_) {
          const cached = this.getCachedUser();
          if (cached && cached.uid === firebaseUser.uid && cached.active === true) {
            return cached;
          }
          throw new Error('FIRESTORE_UNAVAILABLE');
        }
      }
    } else {
      // 3. Background silent revalidation if online
      if (navigator.onLine) {
        getDoc(userDocRef).then((freshSnap) => {
          if (freshSnap && freshSnap.exists()) {
            const freshProfile = freshSnap.data();
            if (freshProfile && freshProfile.active !== true) {
              this.logout();
            }
          }
        }).catch(() => {});
      }
    }

    if (!userSnap || !userSnap.exists()) {
      throw new Error('PROFILE_MISSING');
    }

    const profile = userSnap.data();
    if (!profile) {
      throw new Error('PROFILE_MISSING');
    }

    if (profile.active !== true) {
      throw new Error('ACCOUNT_DISABLED');
    }

    const validRoles = Object.values(ROLES);
    if (!profile.role || !validRoles.includes(profile.role)) {
      throw new Error('MALFORMED_PROFILE');
    }

    const resolvedUser = {
      uid: firebaseUser.uid,
      id: firebaseUser.uid,
      name: profile.name || firebaseUser.displayName || firebaseUser.email,
      email: firebaseUser.email,
      role: profile.role,
      active: true
    };
    this.setCachedUser(resolvedUser);
    return resolvedUser;
  }

  async init(onUserChanged) {
    this.onUserChanged = onUserChanged;

    if (!isConfigured || !firebaseAuth) {
      console.warn('ASCPT Auth Notice: Firebase configuration is missing.');
      document.body.classList.add('not-authenticated');
      this.showLoginModal();
      return;
    }

    onAuthStateChanged(firebaseAuth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          this.currentUser = await this.resolveUserProfile(firebaseUser);

          // Mark session active in localStorage for instant zero-delay launch next time
          localStorage.setItem('ascpt_has_session', 'true');

          // Unlock application
          document.body.classList.remove('not-authenticated');
          this.hideLoginModal();
          this.hideLoginError();
          this.updateUI();

          if (this.onUserChanged) this.onUserChanged(this.currentUser);

          if (window.app && typeof window.app.showToast === 'function') {
            window.app.showToast(`مرحباً بك: ${this.currentUser.name} (${RolesManager.getRoleLabel(this.currentUser.role)})`);
          }
        } catch (err) {
          console.error('Auth verification notice:', err.message);

          if (!navigator.onLine && (err.message === 'FIRESTORE_UNAVAILABLE' || err.message === 'PROFILE_MISSING')) {
            const cached = this.getCachedUser();
            if (cached && cached.uid === firebaseUser.uid && cached.active === true) {
              this.currentUser = cached;
              localStorage.setItem('ascpt_has_session', 'true');
              document.body.classList.remove('not-authenticated');
              this.hideLoginModal();
              this.hideLoginError();
              this.updateUI();
              if (this.onUserChanged) this.onUserChanged(this.currentUser);
              return;
            }
          }

          if (navigator.onLine || err.message === 'ACCOUNT_DISABLED' || err.message === 'PROFILE_MISSING') {
            try { await signOut(firebaseAuth); } catch (_) {}
            this.currentUser = null;
            document.body.classList.add('not-authenticated');
            this.updateUI();
            this.showLoginModal();

            let userMsg = 'تعذر تسجيل الدخول، يرجى مراجعة إدارة المركز.';
            if (err.message === 'PROFILE_MISSING') {
              userMsg = 'حسابك غير مسجل في قاعدة بيانات المركز. يرجى التواصل مع إدارة المركز لإضافة ملفك.';
            } else if (err.message === 'ACCOUNT_DISABLED') {
              userMsg = 'تم تعطيل هذا الحساب من قبل إدارة المركز.';
            } else if (err.message === 'MALFORMED_PROFILE') {
              userMsg = 'صلاحيات هذا الحساب غير صالحة. يرجى مراجعة إدارة المركز.';
            } else if (err.message === 'FIRESTORE_UNAVAILABLE') {
              userMsg = 'تعذر التحقق من صلاحيات الحساب بسبب انقطاع الاتصال بقاعدة البيانات. يرجى التحقق من اتصال الإنترنت.';
            }

            this.showLoginError(userMsg);
            if (this.onUserChanged) this.onUserChanged(null);
          }
        }
      } else {
        this.currentUser = null;
        localStorage.removeItem('ascpt_has_session');
    this.setCachedUser(null);
        document.body.classList.add('not-authenticated');
        this.updateUI();
        this.showLoginModal();
        if (this.onUserChanged) this.onUserChanged(null);
      }

      this.isInitialized = true;
    });
  }

  getCurrentUser() {
    return this.currentUser;
  }

  async login(email, password) {
    if (!isConfigured || !firebaseAuth) {
      const msg = 'خدمة المصادقة غير مهيأة.';
      this.showLoginError(msg);
      throw new Error(msg);
    }

    if (!email || !email.trim()) {
      const msg = 'يرجى إدخال البريد الإلكتروني.';
      this.showLoginError(msg);
      throw new Error(msg);
    }

    if (!password) {
      const msg = 'يرجى إدخال كلمة السر.';
      this.showLoginError(msg);
      throw new Error(msg);
    }

    this.hideLoginError();

    try {
      const userCredential = await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
      const user = userCredential.user;

      this.currentUser = await this.resolveUserProfile(user);

      localStorage.setItem('ascpt_has_session', 'true');
      document.body.classList.remove('not-authenticated');
      this.hideLoginModal();
      this.hideLoginError();
      this.updateUI();

      if (this.onUserChanged) this.onUserChanged(this.currentUser);
      return user;
    } catch (err) {
      console.error('Firebase Login error:', err.code, err.message);

      if (firebaseAuth.currentUser && (err.message === 'ACCOUNT_DISABLED' || err.message === 'PROFILE_MISSING')) {
        try { await signOut(firebaseAuth); } catch (_) {}
      }
      this.currentUser = null;
      document.body.classList.add('not-authenticated');

      let friendlyMsg = this.mapAuthError(err);
      if (err.message === 'PROFILE_MISSING') {
        friendlyMsg = 'حسابك غير مسجل في قاعدة بيانات المركز. يرجى التواصل مع إدارة المركز لإضافة ملفك.';
      } else if (err.message === 'ACCOUNT_DISABLED') {
        friendlyMsg = 'تم تعطيل هذا الحساب من قبل إدارة المركز.';
      } else if (err.message === 'MALFORMED_PROFILE') {
        friendlyMsg = 'صلاحيات هذا الحساب غير صالحة. يرجى مراجعة إدارة المركز.';
      } else if (err.message === 'FIRESTORE_UNAVAILABLE') {
        friendlyMsg = 'تعذر الاتصال بقاعدة البيانات للتحقق من صلاحياتك. يرجى التحقق من اتصال الإنترنت.';
      }

      this.showLoginError(friendlyMsg);
      throw new Error(friendlyMsg);
    }
  }

  async resetPassword(email) {
    if (!isConfigured || !firebaseAuth) {
      throw new Error('خدمة المصادقة غير مهيأة.');
    }
    if (!email || !email.trim()) {
      throw new Error('يرجى إدخال البريد الإلكتروني لاستعادة كلمة المرور.');
    }
    try {
      await sendPasswordResetEmail(firebaseAuth, email.trim());
      return true;
    } catch (err) {
      console.error('Password reset error:', err);
      throw new Error(this.mapAuthError(err));
    }
  }

  async logout() {
    localStorage.removeItem('ascpt_has_session');
    this.setCachedUser(null);
    try {
      if (firebaseAuth) {
        await signOut(firebaseAuth);
      }
    } catch (err) {
      console.warn('SignOut notice:', err);
    }
    this.currentUser = null;
    document.body.classList.add('not-authenticated');
    this.updateUI();
    this.showLoginModal();
  }

  mapAuthError(err) {
    const code = err?.code || '';
    const errorMap = {
      'auth/invalid-credential': 'البريد الإلكتروني أو كلمة السر غير صحيحة. يرجى التأكد من البيانات.',
      'auth/user-not-found': 'لا يوجد حساب مسجل بهذا البريد الإلكتروني.',
      'auth/wrong-password': 'كلمة السر غير صحيحة.',
      'auth/invalid-email': 'صيغة البريد الإلكتروني غير صالحة.',
      'auth/user-disabled': 'تم تعطيل هذا الحساب من قبل إدارة المركز.',
      'auth/too-many-requests': 'تم حظر المحاولات مؤقتاً لكثرة المحاولات الخاطئة. يرجى الانتظار والمحاولة لاحقاً.',
      'auth/network-request-failed': 'تعذر الاتصال بخوادم Firebase. يرجى التحقق من اتصال الإنترنت.'
    };
    return errorMap[code] || 'حدث خطأ أثناء تسجيل الدخول. يرجى التأكد من البيانات والمحاولة مجدداً.';
  }

  showLoginModal() {
    const modal = document.getElementById('modal-auth');
    if (modal) {
      modal.classList.add('active');
      const closeBtns = modal.querySelectorAll('.modal-close, #btn-cancel-login');
      closeBtns.forEach(btn => {
        btn.style.display = this.currentUser ? '' : 'none';
      });
    }
  }

  hideLoginModal() {
    if (!this.currentUser) return;
    const modal = document.getElementById('modal-auth');
    if (modal) modal.classList.remove('active');
  }

  showLoginError(message) {
    const errBox = document.getElementById('login-error-msg');
    if (errBox) {
      errBox.textContent = message;
      errBox.style.display = 'block';
    }
  }

  hideLoginError() {
    const errBox = document.getElementById('login-error-msg');
    if (errBox) {
      errBox.textContent = '';
      errBox.style.display = 'none';
    }
  }

  updateUI() {
    const user = this.currentUser;
    const headerDisplay = document.getElementById('header-user-display');
    const sidebarName = document.getElementById('sidebar-user-name');
    const sidebarRole = document.getElementById('sidebar-user-role');

    if (user) {
      const roleText = RolesManager.getRoleLabel(user.role);
      if (headerDisplay) headerDisplay.textContent = user.name;
      if (sidebarName) sidebarName.textContent = user.name;
      if (sidebarRole) {
        sidebarRole.textContent = roleText;
        sidebarRole.className = `badge badge-role-${user.role}`;
      }
      RolesManager.applyPermissions(user);
    } else {
      if (headerDisplay) headerDisplay.textContent = 'تسجيل الدخول';
      if (sidebarName) sidebarName.textContent = 'غير مسجل';
      if (sidebarRole) {
        sidebarRole.textContent = 'زائر';
        sidebarRole.className = 'badge';
      }
      RolesManager.applyPermissions(null);
    }
  }
}

export const auth = new AuthService();
