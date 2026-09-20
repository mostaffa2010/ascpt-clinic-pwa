// ========================================================
// ASCPT - Service Worker & Offline PWA Cache Engine
// Alexandria Specialized Center for Physical Therapy
// Version: 2.10.20 (Cache: ascpt-clinic-v2.10.22)
// True Offline Navigation & Fault-Tolerant Cache Architecture
// ========================================================

const CACHE_NAME = 'ascpt-clinic-v2.10.40';

// Core App Shell assets required for offline rendering
const APP_SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/style.css',
  '/css/style.css?v=1.4.3',
  '/css/print.css',
  '/css/print.css?v=1.4.3',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/badge-96x96.png',
  '/icons/favicon-32x32.png',
  '/icons/splash/splash-1290x2796.png',
  '/icons/splash/splash-1179x2556.png',
  '/icons/splash/splash-1284x2778.png',
  '/icons/splash/splash-1170x2532.png',
  '/icons/splash/splash-1125x2436.png',
  '/icons/splash/splash-1242x2688.png',
  '/icons/splash/splash-828x1792.png',
  '/icons/splash/splash-1242x2208.png',
  '/icons/splash/splash-750x1334.png',
  '/icons/splash/splash-2048x2732.png',
  '/icons/splash/splash-1668x2388.png',
  '/icons/splash/splash-1640x2360.png',
  '/icons/splash/splash-1620x2160.png',
  '/assets/vendor/xlsx/xlsx.full.min.js',
  '/js/app.js',
  '/js/app.js?v=1.4.3',
  '/js/auth.js',
  '/js/db.js',
  '/js/doctor-dashboard.js',
  '/js/appointments.js',
  '/js/patients.js',
  '/js/sessions.js',
  '/js/finance.js',
  '/js/claims.js',
  '/js/export.js',
  '/js/audit.js',
  '/js/roles.js',
  '/js/pwa.js',
  '/js/utils.js',
  '/js/clinic-config.js',
  '/js/firebase-init.js',
  '/js/notifications.js',
  'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700;800&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap'
];

// 1. Install Event: Cache all shell assets resiliently one by one
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.allSettled(
        APP_SHELL_ASSETS.map(async (url) => {
          try {
            const res = await fetch(url, { cache: 'reload' });
            if (res.ok) {
              await cache.put(url, res.clone());
              if (url === '/index.html' || url === '/') {
                await cache.put('/index.html', res.clone());
                await cache.put('/', res.clone());
              }
            }
          } catch (e) {
            console.warn('Pre-cache miss for:', url, e.message);
          }
        })
      );
    }).then(() => self.skipWaiting())
  );
});

// 2. Activate Event: Clean up old caches and claim clients immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. Fetch Event: True Offline-First Navigation & Dynamic Fallback
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith('http')) return;

  const url = event.request.url;

  // Let Firebase backend data APIs pass directly to Firebase SDK
  // so Firestore's built-in IndexedDB persistentLocalCache and Auth manage them
  if (
    url.includes('firestore.googleapis.com') ||
    url.includes('identitytoolkit.googleapis.com') ||
    url.includes('securetoken.googleapis.com') ||
    url.includes('/api/')
  ) {
    return;
  }

  // A. Navigation Requests (PWA launch, URL navigation, refresh, or offline startup)
  if (event.request.mode === 'navigate' || url.endsWith('/index.html')) {
    event.respondWith(
      (async () => {
        try {
          // If network is available, fetch and keep offline cache updated
          const networkResponse = await fetch(event.request);
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            const cache = await caches.open(CACHE_NAME);
            cache.put('/index.html', copy.clone());
            cache.put('/', copy.clone());
          }
          return networkResponse;
        } catch (networkError) {
          // Device is OFFLINE: serve cached index.html immediately with query-agnostic matching
          const cache = await caches.open(CACHE_NAME);
          let cachedPage = (await cache.match('/index.html')) ||
                           (await cache.match('/', { ignoreSearch: true })) ||
                           (await cache.match(event.request, { ignoreSearch: true }));

          // Fallback: search across all active/previous caches
          if (!cachedPage) {
            const allCacheKeys = await caches.keys();
            for (const cKey of allCacheKeys) {
              const anyCache = await caches.open(cKey);
              cachedPage = (await anyCache.match('/index.html')) ||
                           (await anyCache.match('/', { ignoreSearch: true })) ||
                           (await anyCache.match(event.request, { ignoreSearch: true }));
              if (cachedPage) break;
            }
          }

          if (cachedPage) {
            return cachedPage;
          }

          // Resilient Offline Fallback Card (Never return raw black text screen)
          return new Response(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>غير متصل بالإنترنت - ASCPT</title>
  <style>
    body { margin: 0; background: #0f172a; color: #f8fafc; font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; text-align: center; padding: 20px; box-sizing: border-box; }
    .offline-box { background: #1e293b; padding: 32px 24px; border-radius: 18px; max-width: 380px; width: 100%; border: 1.5px solid #334155; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
    .offline-icon { font-size: 2.8rem; margin-bottom: 14px; }
    h2 { color: #38bdf8; margin: 0 0 10px; font-size: 1.25rem; font-weight: 800; }
    p { color: #94a3b8; font-size: 0.92rem; line-height: 1.6; margin: 0 0 24px; }
    .btn-retry { background: #0284c7; color: #ffffff; border: none; padding: 12px 28px; border-radius: 10px; font-weight: 800; font-size: 0.95rem; cursor: pointer; width: 100%; }
  </style>
</head>
<body>
  <div class="offline-box">
    <div class="offline-icon">📡</div>
    <h2>أنت غير متصل بالإنترنت</h2>
    <p>لا يمكن تحديث التطبيق أثناء انقطاع الاتصال. يرجى التأكد من اتصال الإنترنت ثم إعادة المحاولة.</p>
    <button class="btn-retry" onclick="window.location.href='/'">إعادة المحاولة</button>
  </div>
</body>
</html>`, {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          });
        }
      })()
    );
    return;
  }

  // B. Static Assets: Cache-First with Background Network Revalidation
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cachedResponse = (await cache.match(event.request)) ||
                             (await cache.match(event.request, { ignoreSearch: true }));

      if (cachedResponse) {
        // Revalidate in background if online
        fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              cache.put(event.request, networkResponse.clone());
            }
          })
          .catch(() => {});
        return cachedResponse;
      }

      try {
        const networkResponse = await fetch(event.request);
        if (networkResponse && networkResponse.status === 200) {
          cache.put(event.request, networkResponse.clone());
        }
        return networkResponse;
      } catch (err) {
        return new Response('', { status: 408 });
      }
    })()
  );
});

// ========================================================
// Push Notifications & Background Click Handlers (v2.10.0)
// ========================================================
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload = {};
  try {
    payload = event.data.json();
  } catch (e) {
    payload = {
      notification: {
        title: 'مركز الإسكندرية التخصصي (ASCPT)',
        body: event.data.text()
      }
    };
  }

  const notificationData = payload.notification || {};
  const customData = payload.data || {};

  const title = notificationData.title || customData.title || 'مركز الإسكندرية التخصصي (ASCPT)';
  const options = {
    body: notificationData.body || customData.body || '',
    icon: notificationData.icon || '/icons/icon-192.png',
    badge: notificationData.badge || '/icons/badge-96x96.png',
    dir: 'rtl',
    lang: 'ar',
    vibrate: [500, 200, 500, 200, 500],
    tag: customData.type || 'ascpt-notification',
    renotify: true,
    requireInteraction: true,
    data: {
      url: customData.url || '/',
      screen: customData.screen || '',
      patientId: customData.patientId || '',
      date: customData.date || ''
    }
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const targetUrl = data.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          if (data.screen) {
            client.postMessage({
              type: 'NAVIGATE_TO_VIEW',
              screen: data.screen,
              patientId: data.patientId,
              date: data.date
            });
          }
          return;
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
