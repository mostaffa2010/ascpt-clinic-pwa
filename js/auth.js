// ========================================================
// ASCPT - Production Firebase Authentication Service
// Pinned CDN Modules: Firebase v12.18.0
// Strict Role-Based Access Control
// ========================================================

import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import {
  doc,
  getDoc
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
import { firebaseAuth, firestoreDb, isConfigured } from './firebase-init.js';
import { RolesManager, ROLES } from './roles.js';

class AuthService {
  constructor() {
    this.currentUser = null;
    this.onUserChanged = null;
    this.isInitialized = false;
  }

  async resolveUserProfile(firebaseUser) {
    let role = null;
    let name = firebaseUser.displayName || null;

    // 1. Check local staff cache (ascpt_users) for immediate synchronous resolution
    try {
      const cachedUsers = JSON.parse(localStorage.getItem('ascpt_users') || '[]');
      const cached = cachedUsers.find(u =>
        u.uid === firebaseUser.uid ||
        u.id === firebaseUser.uid ||
        (u.email && u.email.toLowerCase() === firebaseUser.email.toLowerCase())
      );
      if (cached) {
        if (cached.role) role = cached.role;
        if (cached.name) name = cached.name;
      }
    } catch (_) {}

    // 2. Attempt Firestore profile check with a tight timeout
    if (firestoreDb) {
      try {
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000));
        const fetchPromise = async () => {
          const userDocRef = doc(firestoreDb, 'users', firebaseUser.uid);
          const userSnap = await getDoc(userDocRef);
          return userSnap.exists() ? userSnap.data() : null;
        };

        const profile = await Promise.race([fetchPromise(), timeoutPromise]);
        if (profile) {
          if (profile.active === false) {
            throw new Error('ACCOUNT_DISABLED');
          }
          if (profile.role) role = profile.role;
          if (profile.name) name = profile.name;
        }
      } catch (err) {
        if (err.message === 'ACCOUNT_DISABLED') throw err;
      }
    }

    // 3. Fallback only if no role was resolved from cache or Firestore:
    if (!role) {
      if (firebaseUser.email && firebaseUser.email.toLowerCase().startsWith('admin@')) {
        role = ROLES.ADMIN;
      } else {
        role = ROLES.DOCTOR; // Non-admin accounts NEVER default to admin!
      }
    }

    return {
      uid: firebaseUser.uid,
      id: firebaseUser.uid,
      name: name || (firebaseUser.email ? firebaseUser.email.split('@')[0] : 'طبيب المركز'),
      email: firebaseUser.email,
      role: role,
      active: true
    };
  }

  async init(onUserChanged) {
    this.onUserChanged = onUserChanged;

    if (!isConfigured || !firebaseAuth) {
      console.warn('ASCPT Auth Notice: Firebase configuration is missing or pending.');
      document.body.classList.add('not-authenticated');
      this.showLoginModal();
      return;
    }

    onAuthStateChanged(firebaseAuth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          this.currentUser = await this.resolveUserProfile(firebaseUser);

          // Unlock application gate
          document.body.classList.remove('not-authenticated');
          this.hideLoginModal();
          this.hideLoginError();
          this.updateUI();

          if (this.onUserChanged) this.onUserChanged(this.currentUser);

          if (window.app && typeof window.app.showToast === 'function') {
            window.app.showToast(`مرحباً بك: ${this.currentUser.name} (${RolesManager.getRoleLabel(this.currentUser.role)})`);
          }
        } catch (err) {
          if (err.message === 'ACCOUNT_DISABLED') {
            await signOut(firebaseAuth);
            this.currentUser = null;
            document.body.classList.add('not-authenticated');
            this.updateUI();
            this.showLoginModal();
            this.showLoginError('تم تعطيل هذا الحساب من قبل إدارة المركز.');
            return;
          }
        }
      } else {
        // User is signed out
        this.currentUser = null;
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

      // Resolve proper role immediately
      this.currentUser = await this.resolveUserProfile(user);

      document.body.classList.remove('not-authenticated');
      this.hideLoginModal();
      this.hideLoginError();
      this.updateUI();

      if (this.onUserChanged) this.onUserChanged(this.currentUser);

      return user;
    } catch (err) {
      console.error('Firebase Login error:', err.code, err.message);
      const friendlyMsg = this.mapAuthError(err);
      this.showLoginError(friendlyMsg);
      throw new Error(friendlyMsg);
    }
  }

  async logout() {
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
    return errorMap[code] || 'حدث خطأ أثناء تسجيل الدخول. يرجى التحقق من البيانات والمحاولة مجدداً.';
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
