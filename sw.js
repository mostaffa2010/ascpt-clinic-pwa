// ========================================================
// ASCPT - Service Worker & Offline PWA Cache Engine
// Alexandria Specialized Center for Physical Therapy
// Version: 1.0.0 (Cache: ascpt-clinic-v1.0.0)
// ========================================================

const CACHE_NAME = 'ascpt-clinic-v1.1.0';

// App Shell assets required for offline rendering
// (Note: demo-data.js is retained in app shell strictly during Phase 1 working baseline)
const APP_SHELL_ASSETS = [
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
  './js/demo-data.js',
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
// (Excludes external Firebase SDK CDN calls to allow standard browser/CDN caching)
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith('http')) return;

  // Do not intercept or cache external Firebase SDK calls in this Service Worker
  if (event.request.url.includes('gstatic.com') || event.request.url.includes('googleapis.com')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Return cached asset immediately & refresh in background when online
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

      // If not in cache, fetch from network and store in cache
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
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html') || caches.match('./');
          }
          return caches.match('./index.html');
        });
    })
  );
});
