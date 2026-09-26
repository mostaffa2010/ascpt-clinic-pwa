// ========================================================
// ASCPT - Unified Push Notifications & In-App Center Manager
// Alexandria Specialized Center for Physical Therapy
// Module: js/notifications.js (Phase 2.10.1)
// ========================================================

import {
  collection,
  doc,
  setDoc,
  updateDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
  writeBatch
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

import { firestoreDb, isConfigured } from './firebase-init.js';
import { CLINIC_CONFIG } from './clinic-config.js';
import { auth } from './auth.js';
import { escapeHTML } from './utils.js';

function urlB64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function formatRelativeTimeArabic(dateIso) {
  if (!dateIso) return '';
  const now = new Date();
  const past = new Date(dateIso);
  const diffSec = Math.floor((now - past) / 1000);

  if (diffSec < 45) return 'الآن';
  if (diffSec < 90) return 'منذ دقيقة';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    if (diffMin === 2) return 'منذ دقيقتين';
    if (diffMin >= 3 && diffMin <= 10) return `منذ ${diffMin} دقائق`;
    return `منذ ${diffMin} دقيقة`;
  }
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) {
    if (diffHours === 1) return 'منذ ساعة';
    if (diffHours === 2) return 'منذ ساعتين';
    if (diffHours >= 3 && diffHours <= 10) return `منذ ${diffHours} ساعات`;
    return `منذ ${diffHours} ساعة`;
  }
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'أمس';
  if (diffDays === 2) return 'منذ يومين';
  if (diffDays <= 7) return `منذ ${diffDays} أيام`;
  return past.toLocaleDateString('ar-EG-u-nu-latn');
}

export class NotificationsManager {
  constructor(app) {
    this.app = app;
    this.notifications = [];
    this.unsubscribeListener = null;
    this.isDropdownOpen = false;
    this.currentToken = null;
  }

  init() {
    this.closeDropdown();
    this.updateBadge(0);
    this.bindDomEvents();
    this.bindServiceWorkerMessages();
    this.setupAuthSync();
  }

  bindDomEvents() {
    const btnBell = document.getElementById('btn-notifications-bell');
    const dropdown = document.getElementById('notification-dropdown');
    const btnMarkAll = document.getElementById('btn-mark-all-read');
    const btnTogglePush = document.getElementById('btn-toggle-push-notifications');

    const btnPrimerConfirm = document.getElementById('btn-primer-confirm');
    const btnPrimerDismiss = document.getElementById('btn-primer-dismiss');
    const btnPrimerX = document.getElementById('btn-close-primer-x');



    if (btnBell) {
      btnBell.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleDropdown();
      });
    }

    if (btnMarkAll) {
      btnMarkAll.addEventListener('click', (e) => {
        e.stopPropagation();
        this.markAllAsRead();
      });
    }

    if (btnTogglePush) {
      btnTogglePush.addEventListener('click', (e) => {
        e.preventDefault();
        this.openPrimerModal();
      });
    }

    if (btnPrimerConfirm) {
      btnPrimerConfirm.addEventListener('click', () => {
        if (this.app?.closeModal) {
          this.app.closeModal('modal-notification-primer');
        }
        this.requestPermissionAndSubscribe();
      });
    }

    if (btnPrimerDismiss) {
      btnPrimerDismiss.addEventListener('click', () => {
        if (this.app?.closeModal) {
          this.app.closeModal('modal-notification-primer');
        }
      });
    }

    if (btnPrimerX) {
      btnPrimerX.addEventListener('click', () => {
        if (this.app?.closeModal) {
          this.app.closeModal('modal-notification-primer');
        }
      });
    }

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
      if (this.isDropdownOpen) {
        if (dropdown && !dropdown.contains(e.target) && (!btnBell || !btnBell.contains(e.target))) {
          this.closeDropdown();
        }
      }
    });

    // Close dropdown on ESC
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isDropdownOpen) {
        this.closeDropdown();
      }
    });

    // Close dropdown on outside scroll (desktop wheel, window scroll, and mobile touch scroll)
    const handleOutsideScroll = (e) => {
      if (!this.isDropdownOpen || !dropdown) return;
      // Allow scrolling inside the notifications list without closing
      if (e.target && (dropdown === e.target || dropdown.contains(e.target))) {
        return;
      }
      this.closeDropdown();
    };

    window.addEventListener('scroll', handleOutsideScroll, { passive: true, capture: true });
    document.addEventListener('scroll', handleOutsideScroll, { passive: true, capture: true });
    document.addEventListener('wheel', handleOutsideScroll, { passive: true, capture: true });
    document.addEventListener('touchmove', handleOutsideScroll, { passive: true, capture: true });
  }

  openPrimerModal() {
    if (Notification.permission === 'granted') {
      if (this.app?.showToast) {
        this.app.showToast('الإشعارات الفورية مفعلة بالفعل على هذا الجهاز ✓', 'info');
      }
      return;
    }

    if (this.app?.openModal) {
      this.app.openModal('modal-notification-primer');
    }
  }

  bindServiceWorkerMessages() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        const data = event.data;
        if (data && data.type === 'NAVIGATE_TO_VIEW') {
          if (data.screen && this.app && typeof this.app.switchView === 'function') {
            this.app.switchView(data.screen);
            if (data.patientId && this.app.patientsManager) {
              setTimeout(() => {
                this.app.patientsManager.openClinicalSheet(data.patientId);
              }, 200);
            }
          }
        }
      });
    }
  }

  setupAuthSync() {
    if (this.app) {
      const originalCheckSession = this.app.checkSession?.bind(this.app);
      if (originalCheckSession) {
        this.app.checkSession = async () => {
          await originalCheckSession();
          this.startListening();
          this.checkCurrentPermissionState();
        };
      }
    }
    this.startListening();
    this.checkCurrentPermissionState();
  }

  startListening() {
    if (this.unsubscribeListener) {
      this.unsubscribeListener();
      this.unsubscribeListener = null;
    }

    const currentUser = auth.getCurrentUser();
    if (!currentUser || !currentUser.uid) {
      this.updateBadge(0);
      return;
    }

    if (!firestoreDb || !isConfigured) {
      this.fetchNotificationsFromApi(currentUser.uid);
      return;
    }

    try {
      const notifCol = collection(firestoreDb, 'users', currentUser.uid, 'notifications');
      const q = query(notifCol, orderBy('createdAt', 'desc'), limit(8));

      this.unsubscribeListener = onSnapshot(q, (snapshot) => {
        let freshIncoming = null;
        snapshot.docChanges().forEach((change) => {
          if (change.type === 'added') {
            const data = change.doc.data();
            const createdAt = new Date(data.createdAt || Date.now()).getTime();
            if (!data.read && (Date.now() - createdAt < 35000)) {
              freshIncoming = { id: change.doc.id, ...data };
            }
          }
        });

        const notifs = [];
        snapshot.forEach((docSnap) => {
          notifs.push({ id: docSnap.id, ...docSnap.data() });
        });
        this.notifications = notifs;
        this.renderNotifications();

        if (freshIncoming) {
          if (navigator.vibrate) {
            try { navigator.vibrate([250, 100, 250]); } catch (_) {}
          }
          if (this.app?.showToast) {
            this.app.showToast(`🔔 ${freshIncoming.title} — ${freshIncoming.body}`, 'info');
          }
        }
      }, (err) => {
        console.warn('Notifications real-time listener notice (falling back to server API):', err.message);
        this.fetchNotificationsFromApi(currentUser.uid);
      });
    } catch (err) {
      console.warn('Failed to attach notifications listener:', err.message);
      this.fetchNotificationsFromApi(currentUser.uid);
    }
  }

  async fetchNotificationsFromApi(uid) {
    if (!uid) return;
    try {
      const resp = await fetch(`/api/notifications/token?uid=${encodeURIComponent(uid)}`);
      if (resp.ok) {
        const data = await resp.json();
        if (data.success && Array.isArray(data.notifications)) {
          this.notifications = data.notifications;
          this.renderNotifications();
        }
      }
    } catch (apiErr) {
      console.warn('Fetch notifications API notice:', apiErr.message);
    }
  }

  toggleDropdown() {
    if (this.isDropdownOpen) {
      this.closeDropdown();
    } else {
      this.openDropdown();
    }
  }

  openDropdown() {
    const dropdown = document.getElementById('notification-dropdown');
    if (!dropdown) return;
    dropdown.classList.add('is-open');
    dropdown.style.removeProperty('display');
    this.isDropdownOpen = true;
    this.renderNotifications();
  }

  closeDropdown() {
    const dropdown = document.getElementById('notification-dropdown');
    if (!dropdown) return;
    dropdown.classList.remove('is-open');
    dropdown.style.removeProperty('display');
    this.isDropdownOpen = false;
  }

  updateBadge(count) {
    const badge = document.getElementById('notification-badge');
    if (!badge) return;
    const num = Number(count) || 0;
    if (num > 0) {
      badge.textContent = num > 99 ? '99+' : String(num);
      badge.classList.add('is-open');
      badge.hidden = false;
      badge.style.removeProperty('display');
    } else {
      badge.textContent = '';
      badge.classList.remove('is-open');
      badge.hidden = true;
      badge.style.removeProperty('display');
    }
  }

  renderNotifications() {
    const listEl = document.getElementById('notifications-list');
    const unreadCount = this.notifications.filter(n => !n.read).length;
    this.updateBadge(unreadCount);

    if (!listEl) return;

    if (this.notifications.length === 0) {
      listEl.innerHTML = `
        <div class="notification-empty-state">
          <div class="notif-empty-icon"><i class="fa-regular fa-bell-slash"></i></div>
          <div class="notif-empty-title">لا توجد إشعارات جديدة</div>
          <div class="notif-empty-sub">ستظهر هنا التنبيهات الفورية لحضور المرضى والمواعيد والعهد</div>
        </div>
      `;
      return;
    }

    listEl.innerHTML = this.notifications.map((n) => {
      const isUnread = !n.read;
      const timeStr = formatRelativeTimeArabic(n.createdAt);
      let iconClass = 'fa-solid fa-bell';
      let iconColor = 'var(--primary)';
      let iconBg = 'rgba(2, 132, 199, 0.12)';

      if (n.type === 'patient_checkin') {
        iconClass = 'fa-solid fa-user-check';
        iconColor = '#10b981';
        iconBg = 'rgba(16, 185, 129, 0.12)';
      } else if (n.type === 'appointment_booked') {
        iconClass = 'fa-solid fa-calendar-plus';
        iconColor = '#0284c7';
        iconBg = 'rgba(2, 132, 199, 0.12)';
      } else if (n.type === 'session_completed') {
        iconClass = 'fa-solid fa-circle-check';
        iconColor = '#059669';
        iconBg = 'rgba(5, 150, 105, 0.12)';
      } else if (n.type === 'cash_handoff') {
        iconClass = 'fa-solid fa-vault';
        iconColor = '#d97706';
        iconBg = 'rgba(217, 119, 6, 0.12)';
      } else if (n.type === 'admin_broadcast') {
        iconClass = 'fa-solid fa-bullhorn';
        iconColor = '#8b5cf6';
        iconBg = 'rgba(139, 92, 246, 0.12)';
      }

      return `
        <div class="notification-item ${isUnread ? 'is-unread' : ''}" data-notif-id="${n.id}">
          <div class="notif-avatar" style="color: ${iconColor}; background: ${iconBg};">
            <i class="${iconClass}"></i>
          </div>
          <div class="notif-content-wrap">
            <div class="notif-title-row">
              <span class="notif-title">${escapeHTML(n.title)}</span>
              <span class="notif-time">${timeStr}</span>
            </div>
            <div class="notif-body">${escapeHTML(n.body)}</div>
          </div>
          ${isUnread ? '<span class="notif-unread-dot" title="غير مقروء"></span>' : ''}\n        </div>
      `;
    }).join('');

    listEl.querySelectorAll('.notification-item').forEach((item) => {
      item.addEventListener('click', () => {
        const notifId = item.dataset.notifId;
        const notif = this.notifications.find(n => n.id === notifId);
        if (notif) {
          this.handleNotificationClick(notif);
        }
      });
    });
  }

  async handleNotificationClick(notif) {
    if (!notif.read) {
      await this.markAsRead(notif.id);
    }
    this.closeDropdown();

    const data = notif.data || {};
    const currentUser = auth.getCurrentUser();
    const role = (currentUser?.role || '').toLowerCase();

    // فحص ما إذا كان الإشعار مرتبطاً بحضور أو جلسة أو مريض
    const isCheckinOrSession = notif.type === 'patient_checkin' ||
      notif.type === 'session_completed' ||
      notif.type === 'appointment_booked' ||
      notif.title?.includes('حضور') ||
      notif.title?.includes('جلسة') ||
      notif.title?.includes('كشف') ||
      notif.body?.includes('حضور') ||
      notif.body?.includes('جلسة') ||
      notif.body?.includes('كشف') ||
      Boolean(data.patientId);

    if (data.patientId && isCheckinOrSession) {
      // 1. موظف الاستقبال / السكرتارية: فتح شاشة تسجيل الجلسة مع اختيار المريض تلقائياً
      if (role === 'receptionist' || role === 'reception') {
        if (this.app?.switchView) {
          this.app.switchView('sessions');
          setTimeout(() => {
            if (this.app.sessionsManager && typeof this.app.sessionsManager.selectPatient === 'function') {
              this.app.sessionsManager.selectPatient(data.patientId);
            }
          }, 150);
          return;
        }
      }

      // 2. الطبيب المعالج أو المدير: فتح الشيت الطبي للمريض مباشرة
      if (role === 'doctor' || role === 'admin' || !role) {
        if (this.app?.patientsManager) {
          if (typeof this.app.patientsManager.openPatientSheet === 'function') {
            await this.app.patientsManager.openPatientSheet(data.patientId);
            return;
          } else if (typeof this.app.patientsManager.openClinicalSheet === 'function') {
            await this.app.patientsManager.openClinicalSheet(data.patientId);
            return;
          }
        }
      }
    }

    if (data.screen && this.app && typeof this.app.switchView === 'function') {
      this.app.switchView(data.screen);
      if (data.patientId) {
        setTimeout(() => {
          if ((role === 'receptionist' || role === 'reception') && this.app.sessionsManager) {
            this.app.sessionsManager.selectPatient(data.patientId);
          } else if (this.app.patientsManager) {
            if (typeof this.app.patientsManager.openPatientSheet === 'function') {
              this.app.patientsManager.openPatientSheet(data.patientId);
            } else if (typeof this.app.patientsManager.openClinicalSheet === 'function') {
              this.app.patientsManager.openClinicalSheet(data.patientId);
            }
          }
        }, 150);
      }
    }
  }

  async markAsRead(notificationId) {
    const currentUser = auth.getCurrentUser();
    if (!currentUser || !currentUser.uid) return;
    try {
      const docRef = doc(firestoreDb, 'users', currentUser.uid, 'notifications', notificationId);
      await updateDoc(docRef, { read: true });
    } catch (e) {
      console.warn('markAsRead notice:', e.message);
    }
  }

  async markAllAsRead(silent = false) {
    const currentUser = auth.getCurrentUser();
    if (!currentUser || !currentUser.uid) return;

    // Optimistic UI update
    this.notifications.forEach(n => n.read = true);
    this.renderNotifications();
    this.updateBadge(0);

    // 1. Call serverless endpoint to mark all read in Firestore
    try {
      await fetch('/api/notifications/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'mark_all_read',
          uid: currentUser.uid
        })
      });
    } catch (err) {
      console.warn('Mark all read server notice:', err.message);
    }

    // 2. Also attempt client Firestore update
    if (firestoreDb) {
      try {
        const batch = writeBatch(firestoreDb);
        this.notifications.forEach((n) => {
          const ref = doc(firestoreDb, 'users', currentUser.uid, 'notifications', n.id);
          batch.update(ref, { read: true });
        });
        await batch.commit();
      } catch (e) {
        console.warn('markAllAsRead client notice:', e.message);
      }
    }

    if (!silent && this.app?.showToast) {
      this.app.showToast('تم تحديد جميع الإشعارات كمقروءة');
    }
  }

  async onUserAuthenticated(user) {
    if (!user || !user.uid) return;
    this.startListening();
    this.checkCurrentPermissionState();

    // Auto-sync token if browser permission is already granted
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        await this.autoRegisterToken(user);
      } catch (e) {
        console.warn('Auto token registration notice:', e.message);
      }
    }
  }

  async getFcmToken(reg) {
    try {
      const { getMessaging, getToken } = await import(
        'https://www.gstatic.com/firebasejs/12.18.0/firebase-messaging.js'
      );
      const { firebaseApp } = await import('./firebase-init.js');
      if (firebaseApp) {
        const messaging = getMessaging(firebaseApp);
        const vapidKey = CLINIC_CONFIG.firebase?.vapidKey;
        const sdkToken = await getToken(messaging, {
          vapidKey,
          serviceWorkerRegistration: reg
        });
        if (sdkToken && typeof sdkToken === 'string' && sdkToken.length > 20) {
          return sdkToken.trim();
        }
      }
    } catch (sdkErr) {
      console.warn('Firebase Messaging SDK getToken fallback:', sdkErr.message);
    }

    try {
      const vapidKey = CLINIC_CONFIG.firebase?.vapidKey;
      let sub = await reg.pushManager.getSubscription();
      if (!sub && vapidKey) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlB64ToUint8Array(vapidKey)
        });
      }
      if (sub) {
        const subJson = sub.toJSON();
        let ep = subJson.endpoint || '';
        if (ep.includes('/fcm/send/')) ep = ep.split('/fcm/send/')[1];
        else if (ep.includes('/gcm/send/')) ep = ep.split('/gcm/send/')[1];
        return ep.trim();
      }
    } catch (pushErr) {
      console.warn('pushManager.subscribe notice:', pushErr.message);
    }
    return null;
  }

  async autoRegisterToken(currentUser) {
    if (!currentUser || !currentUser.uid) return;
    if (!('serviceWorker' in navigator) || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    try {
      const reg = await navigator.serviceWorker.ready;
      const cleanToken = await this.getFcmToken(reg);
      if (!cleanToken) return;

      await fetch('/api/notifications/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'register',
          uid: currentUser.uid,
          token: cleanToken,
          role: currentUser.role || 'staff',
          name: currentUser.name || '',
          userAgent: navigator.userAgent
        })
      });
      console.log('FCM token auto-registered for:', currentUser.name);
    } catch (err) {
      console.warn('Auto register token notice:', err.message);
    }
  }

  async sendTestNotification() {
    const user = auth.getCurrentUser();
    if (!user || !user.uid) {
      if (this.app?.showAlert) this.app.showAlert('يرجى تسجيل الدخول أولاً.', 'تنبيه', 'warning');
      return;
    }

    if (!('Notification' in window) || Notification.permission !== 'granted') {
      this.openPrimerModal();
      return;
    }

    if (this.app?.showToast) {
      this.app.showToast('جاري إرسال إشعار تجريبي فوري لهاتفك... 🔔', 'info');
    }

    try {
      const res = await this.sendNotification({
        type: 'test_notification',
        title: '🔔 تجربة الإشعارات — ASCPT',
        body: `مرحباً د. ${(user.name || '').replace(/^د\.\s*/, '')}، نظام الإشعارات الفورية يعمل بنجاح على هذا الهاتف!`,
        target: { recipientUid: user.uid },
        data: { screen: 'dashboard' }
      });
      console.log('Test notification sent response:', res);
      if (res && res.sentCount > 0) {
        if (this.app?.showToast) {
          this.app.showToast('تم إرسال الإشعار التجريبي لهاتفك بنجاح! ✓', 'success');
        }
      } else {
        if (this.app?.showToast) {
          this.app.showToast('تم حفظ الإشعار في القائمة، تأكد من اتصال هاتفك بالإنترنت.', 'info');
        }
      }
    } catch (err) {
      console.error('Test notification dispatch error:', err);
    }
  }

  async checkCurrentPermissionState() {
    const statusText = document.getElementById('push-status-text');
    const btnToggle = document.getElementById('btn-toggle-push-notifications');

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isStandalone = Boolean(window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches);

    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      if (isIOS && !isStandalone) {
        if (statusText) statusText.textContent = 'على أجهزة آيفون: اضغط زر المشاركة ثم "إضافة للشاشة الرئيسية" لتفعيل الإشعارات';
        if (btnToggle) {
          btnToggle.innerHTML = '<i class="fa-solid fa-arrow-up-from-bracket"></i> إضافة للشاشة';
          btnToggle.disabled = false;
          btnToggle.className = 'btn btn-outline btn-sm btn-push-ios';
          btnToggle.removeAttribute('style');
          btnToggle.onclick = (e) => {
            e.preventDefault();
            this.app?.showAlert(
              'خطوات تفعيل الإشعارات على هواتف آيفون (iOS 16.4+):\n\n' +
              '1. في متصفح سفاري (Safari)، اضغط على زر المشاركة ⎋ (المربع بسهم لأعلى أسفل الشاشة).\n' +
              '2. مرر للأسفل واختر "إضافة إلى الشاشة الرئيسية" (Add to Home Screen).\n' +
              '3. افتح تطبيق ASCPT من شاشة الهاتف الرئيسية، وستتمكن من تفعيل الإشعارات فوراً.',
              'تفعيل الإشعارات على آيفون',
              'info'
            );
          };
        }
      } else {
        if (statusText) statusText.textContent = 'الإشعارات الفورية غير مدعومة على هذا المتصفح';
        if (btnToggle) {
          btnToggle.disabled = true;
          btnToggle.textContent = 'غير مدعوم';
        }
      }
      return;
    }

    if (Notification.permission === 'granted') {
      if (statusText) statusText.textContent = 'الإشعارات الفورية مفعلة بنجاح على هذا الجهاز';
      if (btnToggle) {
        btnToggle.innerHTML = '<i class="fa-solid fa-check"></i> مفعل';
        btnToggle.disabled = false;
        btnToggle.className = 'btn btn-push-active';
        btnToggle.removeAttribute('style');
      }
    } else if (Notification.permission === 'denied') {
      if (statusText) statusText.textContent = 'تم حظر الإشعارات من إعدادات المتصفح. يمكنك السماح بها من قفل الموقع';
      if (btnToggle) {
        btnToggle.innerHTML = '<i class="fa-solid fa-ban"></i> محظور';
        btnToggle.disabled = true;
        btnToggle.className = 'btn btn-push-denied';
        btnToggle.removeAttribute('style');
      }
    } else {
      if (statusText) statusText.textContent = 'تلقي تنبيهات المرضى والمواعيد والعهد فورياً على هذا الجهاز';
      if (btnToggle) {
        btnToggle.innerHTML = '<i class="fa-solid fa-bell"></i> تفعيل';
        btnToggle.disabled = false;
        btnToggle.className = 'btn btn-push-inactive';
        btnToggle.removeAttribute('style');
      }
    }
  }

  async requestPermissionAndSubscribe() {
    const currentUser = auth.getCurrentUser();
    if (!currentUser || !currentUser.uid) {
      if (this.app?.showAlert) this.app.showAlert('يرجى تسجيل الدخول أولاً لتفعيل الإشعارات.', 'تنبيه', 'warning');
      return;
    }

    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
      const isStandalone = Boolean(window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches);
      if (isIOS && !isStandalone) {
        this.app?.showAlert(
          'على أجهزة آيفون (iOS 16.4+):\nتتطلب أبل إضافة التطبيق إلى الشاشة الرئيسية أولاً لتشغيل الإشعارات:\n\n' +
          '1. اضغط على زر المشاركة ⎋ في سفاري.\n' +
          '2. اختر "إضافة إلى الشاشة الرئيسية" (Add to Home Screen).\n' +
          '3. افتح التطبيق من أيقونة الشاشة الرئيسية واضغط تفعيل.',
          'مطلوب إضافة التطبيق للشاشة الرئيسية',
          'info'
        );
      } else {
        if (this.app?.showAlert) this.app.showAlert('هذا المتصفح لا يدعم خدمة إشعارات الويب Web Push.', 'غير مدعوم', 'warning');
      }
      return;
    }

    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        this.checkCurrentPermissionState();
        if (this.app?.showAlert) {
          this.app.showAlert('تم رفض إذن الإشعارات. يرجى تفعيلها من إعدادات المتصفح لتلقي التنبيهات.', 'تنبيه', 'warning');
        }
        return;
      }

      const vapidKey = CLINIC_CONFIG.firebase?.vapidKey;
      if (!vapidKey) {
        throw new Error('VAPID Key غير مهيأ في إعدادات النظام.');
      }

      const reg = await navigator.serviceWorker.ready;
      let tokenString = await this.getFcmToken(reg);
      if (!tokenString) {
        throw new Error('تعذر إنشاء رمز الجهاز من خدمة الإشعارات.');
      }

      // 1. Save token via Serverless endpoint (Runs as Firebase Admin, completely bypassing client rules)
      let savedViaServer = false;
      try {
        const resp = await fetch('/api/notifications/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'register',
            uid: currentUser.uid,
            token: tokenString,
            role: currentUser.role || 'staff',
            name: currentUser.name || '',
            userAgent: navigator.userAgent
          })
        });
        if (resp.ok) {
          const resJson = await resp.json();
          if (resJson.success) {
            savedViaServer = true;
          }
        }
      } catch (srvErr) {
        console.warn('Server token registration notice:', srvErr.message);
      }

      // 2. Direct Firestore fallback (wrapped safely so permission-denied never blocks the user)
      if (!savedViaServer && firestoreDb) {
        let subJson = null;
        try {
          const sub = await reg.pushManager.getSubscription();
          if (sub) subJson = sub.toJSON();
        } catch (_) {}
        try {
          let tokenHash = 0;
          for (let i = 0; i < tokenString.length; i++) {
            tokenHash = ((tokenHash << 5) - tokenHash) + tokenString.charCodeAt(i);
            tokenHash |= 0;
          }
          const tokenDocId = 'tok_' + Math.abs(tokenHash);

          const tokenRef = doc(firestoreDb, 'users', currentUser.uid, 'fcm_tokens', tokenDocId);
          await setDoc(tokenRef, {
            token: tokenString,
            subscription: subJson,
            deviceType: /Mobi|Android|iPhone/i.test(navigator.userAgent) ? 'mobile' : 'desktop',
            userAgent: navigator.userAgent.substring(0, 150),
            role: currentUser.role || 'staff',
            updatedAt: new Date().toISOString()
          }, { merge: true });
        } catch (fsErr) {
          console.warn('Direct Firestore token write notice:', fsErr.message);
        }
      }

      this.checkCurrentPermissionState();
      this.startListening();

      if (this.app?.showToast) {
        this.app.showToast('تم تفعيل الإشعارات الفورية بنجاح على هذا الجهاز! 🔔', 'success');
      }
    } catch (err) {
      console.error('Subscription error:', err);
      if (this.app?.showAlert) {
        this.app.showAlert('تعذر تفعيل الإشعارات: ' + (err.message || 'خطأ غير معروف'), 'خطأ', 'danger');
      }
    }
  }

  async sendNotification({ type, title, body, target, data }) {
    if (!navigator.onLine) {
      console.warn('Device is offline. Notification skipped gracefully.');
      return;
    }

    try {
      const response = await fetch('/api/notifications/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          type: type || 'general',
          title,
          body,
          target: target || {},
          data: data || {}
        })
      });

      const result = await response.json();
      return result;
    } catch (err) {
      console.warn('sendNotification notice:', err.message);
    }
  }
}
