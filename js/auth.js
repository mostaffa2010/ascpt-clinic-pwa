// ========================================================
// ASCPT - Production Firebase Authentication Service
// Pinned CDN Modules: Firebase v12.18.0
// Strict Fail-Closed Security & Authoritative Profile Verification
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

  /**
   * Authoritatively fetches and validates the user profile from Firestore users/{uid}.
   * Strict Fail-Closed Policy:
   * - No localStorage role fallbacks.
   * - No email prefix heuristics (e.g. email heuristics).
   * - No default doctor role assumptions.
   * If profile is missing, inactive, or invalid, access is completely denied.
   */
  async resolveUserProfile(firebaseUser) {
    if (!firestoreDb) {
      throw new Error('FIRESTORE_UNAVAILABLE');
    }

    let userSnap;
    try {
      const userDocRef = doc(firestoreDb, 'users', firebaseUser.uid);
      userSnap = await getDoc(userDocRef);
    } catch (fsErr) {
      console.error('Firestore profile verification error:', fsErr);
      throw new Error('FIRESTORE_UNAVAILABLE');
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

    return {
      uid: firebaseUser.uid,
      id: firebaseUser.uid,
      name: profile.name || firebaseUser.displayName || firebaseUser.email,
      email: firebaseUser.email,
      role: profile.role,
      active: true
    };
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
          // Authoritatively verify profile (Fail-Closed)
          this.currentUser = await this.resolveUserProfile(firebaseUser);

          // Unlock application only upon successful authoritative verification
          document.body.classList.remove('not-authenticated');
          this.hideLoginModal();
          this.hideLoginError();
          this.updateUI();

          if (this.onUserChanged) this.onUserChanged(this.currentUser);

          if (window.app && typeof window.app.showToast === 'function') {
            window.app.showToast(`مرحباً بك: ${this.currentUser.name} (${RolesManager.getRoleLabel(this.currentUser.role)})`);
          }
        } catch (err) {
          console.error('Auth verification failed, enforcing Fail-Closed:', err.message);

          // Force immediate sign out to prevent any privileged or ambiguous state
          try {
            await signOut(firebaseAuth);
          } catch (_) {}

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
            userMsg = 'صلاحيات هذا الحساب غير محددة أو غير صالحة. يرجى مراجعة إدارة المركز.';
          } else if (err.message === 'FIRESTORE_UNAVAILABLE') {
            userMsg = 'تعذر التحقق من صلاحيات الحساب بسبب انقطاع الاتصال بقاعدة البيانات. يرجى التحقق من اتصال الإنترنت.';
          }

          this.showLoginError(userMsg);
          if (this.onUserChanged) this.onUserChanged(null);
        }
      } else {
        // User is completely signed out
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

      // Authoritatively resolve and enforce role upon login (Fail-Closed)
      this.currentUser = await this.resolveUserProfile(user);

      document.body.classList.remove('not-authenticated');
      this.hideLoginModal();
      this.hideLoginError();
      this.updateUI();

      if (this.onUserChanged) this.onUserChanged(this.currentUser);
      return user;
    } catch (err) {
      console.error('Firebase Login error:', err.code, err.message);

      // If user was partially signed in on Firebase Auth, sign out to enforce Fail-Closed
      if (firebaseAuth.currentUser) {
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
    if (!this.currentUser) return; // Never dismiss if unauthenticated
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
