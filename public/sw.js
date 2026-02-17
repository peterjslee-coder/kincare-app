// InPlace Service Worker — v0.6.2
const CACHE_NAME = 'inplace-v0.6.2';
const STATIC_ASSETS = [
  '/',
  '/css/styles.css',
  '/js/utils.js',
  '/js/app.js',
  '/js/components/InPlaceIcon.js',
  '/js/components/SplashPage.js',
  '/js/components/LoginPage.js',
  '/js/components/RegisterPage.js',
  '/js/components/ForgotPasswordPage.js',
  '/js/components/ResetPasswordPage.js',
  '/js/components/Dashboard.js',
  '/js/components/CareProfile.js',
  '/js/components/Schedule.js',
  '/js/components/ActivityFeed.js',
  '/js/components/CaregiverScheduleModal.js',
  '/js/components/Caregivers.js',
  '/js/components/CareRecipients.js',
  '/js/components/Messages.js',
  '/js/components/RequestCareModal.js',
  '/js/components/MyAccount.js',
  '/js/components/CaredForView.js',
  '/js/components/CaretakerHub.js',
  '/js/components/AreaMap.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/manifest.json',
];

// CDN assets to cache
const CDN_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.23.5/babel.min.js',
];

// Install: cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Cache local assets (ignore failures for individual files)
      const localPromises = STATIC_ASSETS.map((url) =>
        cache.add(url).catch(() => console.log('SW: skip caching', url))
      );
      // Cache CDN assets
      const cdnPromises = CDN_ASSETS.map((url) =>
        cache.add(url).catch(() => console.log('SW: skip CDN caching', url))
      );
      return Promise.all([...localPromises, ...cdnPromises]);
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Fetch: network-first for API, cache-first for static
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API calls: always go to network
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ error: 'You appear to be offline' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    return;
  }

  // Static assets: cache-first, fallback to network
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // Cache successful responses
        if (response.ok && (url.origin === self.location.origin || url.hostname.includes('cdnjs'))) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
