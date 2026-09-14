// ========================================================
// ASCPT - Service Worker & Offline PWA Cache Engine
// Alexandria Specialized Center for Physical Therapy
// Version: 1.4.95 (Cache: ascpt-clinic-v1.4.95)
// Network-First for App Shell with Offline Fallback
// ========================================================

const CACHE_NAME = 'ascpt-clinic-v1.4.95';

const APP_SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/style.css?v=1.4.95',
  '/css/print.css',
  '/css/print.css?v=1.4.95',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/assets/vendor/xlsx/xlsx.full.min.js',
  '/js/app.js',
  '/js/app.js?v=1.4.95',
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
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700;800&display=swap'
];

// 1. Install Event: Cache all shell assets resiliently
self.addEventListener('install', (event) => {
  self.skipWaiting();
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
    })
  );
});

// 2. Activate Event: Immediately purge all old caches and claim clients
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

// 3. Fetch Event: Network-First for Navigation to guarantee instant updates
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith('http')) return;

  const url = event.request.url;

  // Let cloud database APIs pass directly to network
  if (
    url.includes('supabase.co') ||
    url.includes('firestore.googleapis.com') ||
    url.includes('identitytoolkit.googleapis.com') ||
    url.includes('/api/')
  ) {
    return;
  }

  // A. Navigation Requests (HTML / Page launch): Network-First with Cache fallback
  if (event.request.mode === 'navigate' || url.endsWith('/index.html') || url.endsWith('/')) {
    event.respondWith(
      fetch(event.request)
        .then(async (networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const cache = await caches.open(CACHE_NAME);
            cache.put('/index.html', networkResponse.clone());
            cache.put('/', networkResponse.clone());
          }
          return networkResponse;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE_NAME);
          const cachedPage = (await cache.match('/index.html')) || (await cache.match('/'));
          if (cachedPage) return cachedPage;
          return new Response('Offline - ASCPT Clinic', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
        })
    );
    return;
  }

  // B. Static Assets: Cache-First with Background Network Revalidation
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cachedResponse = await cache.match(event.request);
      if (cachedResponse) {
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
    })
  );
});
