// ========================================================
// ASCPT - Production Firebase Authentication Service
// Pinned CDN Modules: Firebase v12.18.0
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

  async init(onUserChanged) {
    this.onUserChanged = onUserChanged;

    if (!isConfigured || !firebaseAuth) {
      console.warn('ASCPT Auth Notice: Firebase configuration is missing or pending.');
      this.showLoginModal();
      return;
    }

    onAuthStateChanged(firebaseAuth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          let role = ROLES.ADMIN;
          let name = firebaseUser.displayName || firebaseUser.email.split('@')[0];

          // Safely attempt to fetch user profile from Firestore users/{uid}
          if (firestoreDb) {
            try {
              const userDocRef = doc(firestoreDb, 'users', firebaseUser.uid);
              const userSnap = await getDoc(userDocRef);

              if (userSnap.exists()) {
                const profile = userSnap.data();

                // Check if account has been deactivated
                if (profile.active === false) {
                  await signOut(firebaseAuth);
                  this.currentUser = null;
                  this.updateUI();
                  this.showLoginModal();
                  this.showLoginError('تم تعطيل هذا الحساب من قبل إدارة المركز.');
                  return;
                }

                if (profile.name) name = profile.name;
                if (profile.role) role = profile.role;
              }
            } catch (fsErr) {
              console.warn('Firestore profile read notice (falling back to Auth defaults):', fsErr.message);
            }
          }

          this.currentUser = {
            uid: firebaseUser.uid,
            name: name || 'طبيب المركز',
            email: firebaseUser.email,
            role: role || ROLES.ADMIN,
            active: true
          };

          this.hideLoginModal();
          this.hideLoginError();
          this.updateUI();

          if (this.onUserChanged) this.onUserChanged(this.currentUser);

          if (window.app && typeof window.app.showToast === 'function') {
            window.app.showToast(`تم تسجيل الدخول: ${this.currentUser.name} (${RolesManager.getRoleLabel(this.currentUser.role)})`);
          }
        } catch (authProcErr) {
          console.error('Error processing authenticated user state:', authProcErr);
          this.currentUser = {
            uid: firebaseUser.uid,
            name: firebaseUser.displayName || firebaseUser.email,
            email: firebaseUser.email,
            role: ROLES.ADMIN,
            active: true
          };
          this.hideLoginModal();
          this.updateUI();
          if (this.onUserChanged) this.onUserChanged(this.currentUser);
        }
      } else {
        // User is signed out
        this.currentUser = null;
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
      const msg = 'خدمة المصادقة غير مهيأة. يرجى التحقق من اتصال الإنترنت أو إعدادات النظام.';
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
      return userCredential.user;
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
    this.updateUI();
    this.showLoginModal();
  }

  mapAuthError(err) {
    const code = err?.code || '';
    const errorMap = {
      'auth/invalid-credential': 'البريد الإلكتروني أو كلمة السر غير صحيحة. يرجى التأكد من الحروف وحالة الأحرف.',
      'auth/user-not-found': 'لا يوجد حساب مسجل بهذا البريد الإلكتروني.',
      'auth/wrong-password': 'كلمة السر غير صحيحة.',
      'auth/invalid-email': 'صيغة البريد الإلكتروني غير صالحة.',
      'auth/user-disabled': 'تم تعطيل هذا الحساب من قبل إدارة المركز.',
      'auth/too-many-requests': 'تم حظر المحاولات مؤقتاً لكثرة المحاولات الخاطئة. يرجى الانتظار دقيقة والمحاولة مجدداً.',
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
    if (!this.currentUser) return; // Cannot close modal if unauthenticated
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
