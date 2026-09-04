// ========================================================
// ASCPT - Service Worker & Offline PWA Cache Engine
// Alexandria Specialized Center for Physical Therapy
// Version: 1.1.1 (Cache: ascpt-clinic-v2.2.0)
// ========================================================

const CACHE_NAME = 'ascpt-clinic-v2.2.0';

// App Shell assets required for offline rendering
const APP_SHELL_ASSETS = [
  '/',
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './css/print.css',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './assets/vendor/xlsx/xlsx.full.min.js',
  './js/app.js',
  './js/auth.js',
  './js/db.js',
  './js/doctor-dashboard.js',
  './js/patients.js',
  './js/sessions.js',
  './js/finance.js',
  './js/claims.js',
  './js/export.js',
  './js/audit.js',
  './js/roles.js',
  './js/pwa.js',
  './js/utils.js',
  './js/clinic-config.js',
  './js/firebase-init.js'
];

// Pre-cache core application shell during installation
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL_ASSETS).catch((err) => {
        console.warn('ASCPT pre-cache asset notice:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Clean up old caches upon activation and claim clients immediately
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

// Cache-First with Network Revalidation for PWA App Shell
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith('http')) return;

  // Exclude external Firebase SDK calls to allow direct browser/CDN handling
  if (event.request.url.includes('gstatic.com') || event.request.url.includes('googleapis.com')) {
    return;
  }

  // Normalize navigation requests to root / index.html
  if (event.request.mode === 'navigate' || event.request.url.endsWith('/index.html')) {
    event.respondWith(
      caches.match(event.request)
        .then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          return caches.match('./index.html') || caches.match('/') || caches.match('./');
        })
        .then((cached) => {
          if (cached) return cached;
          return fetch(event.request);
        })
        .catch(() => {
          return caches.match('./index.html') || caches.match('/') || caches.match('./');
        })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              try { cache.put(event.request, clone); } catch (e) {}
            });
          }
        }).catch(() => {});
        return cachedResponse;
      }

      return fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              try { cache.put(event.request, clone); } catch (e) {}
            });
          }
          return networkResponse;
        })
        .catch(() => {
          return caches.match('./index.html') || caches.match('/');
        });
    })
  );
});
