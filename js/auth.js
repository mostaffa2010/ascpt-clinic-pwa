// ========================================================
// ASCPT - Authentication Architecture & Coordinator
// Provides clean boundary between Auth Provider and Application
// ========================================================

import { db } from './db.js';
import { RolesManager } from './roles.js';

/**
 * DemoAuthProvider
 * Encapsulates all demo/showcase local storage authentication logic.
 * Keeps demo mechanisms isolated from the production coordinator interface.
 */
class DemoAuthProvider {
  constructor() {
    this.storageKey = 'pc_demo_active_user';
    this.currentUser = {
      id: 'u-demo-admin',
      name: 'د. مصطفى محمود',
      email: 'admin@ascpt.clinic',
      role: 'admin'
    };
  }

  async init(onUserChanged) {
    const saved = localStorage.getItem(this.storageKey);
    if (saved) {
      try {
        this.currentUser = JSON.parse(saved);
      } catch (e) {
        console.warn('Demo auth state parse error, using default:', e);
      }
    }
    if (onUserChanged) onUserChanged(this.currentUser);
    return this.currentUser;
  }

  getCurrentUser() {
    return this.currentUser;
  }

  async switchRole(role) {
    const roleProfiles = {
      admin: { name: 'د. مصطفى محمود', role: 'admin' },
      doctor: { name: 'د. أحمد خليل', role: 'doctor' },
      receptionist: { name: 'أ. منار خالد', role: 'receptionist' }
    };

    const prof = roleProfiles[role] || roleProfiles.admin;
    this.currentUser = {
      id: 'u-demo-' + role,
      name: prof.name,
      email: `${role}@ascpt.clinic`,
      role: prof.role
    };

    localStorage.setItem(this.storageKey, JSON.stringify(this.currentUser));
    await db.logAudit('تبديل صلاحية العرض', `تم تبديل واجهة العرض لدور: ${RolesManager.getRoleLabel(role)} (${this.currentUser.name})`, this.currentUser);
    return this.currentUser;
  }

  async logout() {
    // In demo mode, logout brings up the role picker
    return true;
  }
}

/**
 * ProductionFirebaseAuthAdapter (Scaffold for Phase 2)
 * Clean adapter boundary waiting for real Firebase Auth initialization in Phase 2.
 */
class ProductionFirebaseAuthAdapter {
  constructor(firebaseAuthInstance) {
    this.auth = firebaseAuthInstance;
    this.currentUser = null;
  }

  async init(onUserChanged) {
    // Will attach onAuthStateChanged listener in Phase 2
    return null;
  }

  getCurrentUser() {
    return this.currentUser;
  }

  async logout() {
    // Will invoke Firebase signOut in Phase 2
    return true;
  }
}

/**
 * AuthService
 * Main Application Auth Coordinator
 * Delegates to the active provider (DemoAuthProvider during Phase 1 baseline)
 */
class AuthService {
  constructor() {
    // Default to Demo provider until Phase 2 Firebase Auth is activated
    this.provider = new DemoAuthProvider();
    this.onUserChanged = null;
  }

  setProvider(newProvider) {
    this.provider = newProvider;
  }

  async init(onUserChanged) {
    this.onUserChanged = onUserChanged;
    await this.provider.init((user) => {
      this.updateUI();
      if (this.onUserChanged) this.onUserChanged(user);
    });
    this.updateUI();
  }

  getCurrentUser() {
    return this.provider.getCurrentUser();
  }

  showLoginModal() {
    const modal = document.getElementById('modal-auth');
    if (modal) modal.classList.add('active');
  }

  hideLoginModal() {
    const modal = document.getElementById('modal-auth');
    if (modal) modal.classList.remove('active');
  }

  async switchRole(role) {
    if (typeof this.provider.switchRole === 'function') {
      const user = await this.provider.switchRole(role);
      this.hideLoginModal();
      this.updateUI();

      if (window.app) {
        window.app.showToast(`تم تسجيل الدخول بحساب: ${user.name} (${RolesManager.getRoleLabel(role)})`);
        if (role === 'doctor') {
          window.app.switchView('dashboard');
        } else if (role === 'receptionist') {
          if (window.app.currentView === 'patient-sheet' || window.app.currentView === 'admin') {
            window.app.switchView('patients');
          }
        }
      }

      if (this.onUserChanged) this.onUserChanged(user);
    }
  }

  async logout() {
    await this.provider.logout();
    this.showLoginModal();
  }

  updateUI() {
    const user = this.getCurrentUser();
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
    }
  }
}

export const auth = new AuthService();
