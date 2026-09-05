// ========================================================
// ASCPT - Service Worker & Offline PWA Cache Engine
// Alexandria Specialized Center for Physical Therapy
// Version: 2.9.0 (Cache: ascpt-clinic-v2.9.1)
// True Offline Navigation & Fault-Tolerant Cache Architecture
// ========================================================

const CACHE_NAME = 'ascpt-clinic-v2.9.1';

// Core App Shell assets required for offline rendering
const APP_SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/style.css',
  '/css/print.css',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/assets/vendor/xlsx/xlsx.full.min.js',
  '/js/app.js',
  '/js/auth.js',
  '/js/db.js',
  '/js/doctor-dashboard.js',
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
  '/js/firebase-init.js'
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

  // Let Firebase Auth and Firestore network calls pass directly to Firebase SDK
  // so Firestore's built-in IndexedDB persistentLocalCache manages them
  if (
    url.includes('firebase') ||
    url.includes('googleapis.com') ||
    url.includes('gstatic.com') ||
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
          // Device is OFFLINE (e.g. Wi-Fi turned off): serve cached index.html immediately!
          const cache = await caches.open(CACHE_NAME);
          const cachedPage = (await cache.match('/index.html')) ||
                             (await cache.match('/')) ||
                             (await cache.match(event.request));
          if (cachedPage) {
            return cachedPage;
          }
          return new Response('Offline - ASCPT Clinic', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
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
      const cachedResponse = await cache.match(event.request);

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
