// InPlace Service Worker — v1.9.3
const CACHE_NAME = 'inplace-v1.9.3';
const STATIC_ASSETS = [
  '/',
  '/css/styles.css',
  '/js/utils.js',
  '/js/app.js',
  '/js/components/InPlaceIcon.js',
  '/js/components/SplashPage.js',
  '/js/components/InviteLandingPage.js',
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
  '/js/components/TwoFactorSetup.js',
  '/js/components/MyAccount.js',
  '/js/components/CareTeamManage.js',
  '/js/components/CareTeamPage.js',
  '/js/components/CaredForView.js',
  '/js/components/AvailabilityTab.js',
  '/js/components/CaregiverCalendar.js',
  '/js/components/CaretakerHub.js',
  '/js/components/AreaMap.js',
  '/js/components/Analytics.js',
  '/js/components/EmailVerificationBanner.js',
  '/js/components/DemoPickerPage.js',
  '/js/components/StripePaymentForm.js',
  '/js/components/CaregiverOnboarding.js',
  '/js/components/FamilyPayments.js',
  '/js/components/AdminPanel.js',
  '/js/components/DisclaimerModal.js',
  '/js/components/FeedbackButton.js',
  '/js/components/FindWork.js',
  '/icons/icon-48.png',
  '/icons/icon-72.png',
  '/icons/icon-96.png',
  '/icons/icon-128.png',
  '/icons/icon-144.png',
  '/icons/icon-192.png',
  '/icons/icon-384.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-48.png',
  '/icons/icon-maskable-72.png',
  '/icons/icon-maskable-96.png',
  '/icons/icon-maskable-128.png',
  '/icons/icon-maskable-144.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-384.png',
  '/icons/icon-maskable-512.png',
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

// Fetch strategy
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API calls: always network
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

  // CDN assets (React, Babel): cache-first (they never change)
  if (url.hostname.includes('cdnjs') || url.hostname.includes('unpkg')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // App assets (HTML, JS, CSS): network-first, fall back to cache
  // This ensures updates are always picked up when online
  event.respondWith(
    fetch(event.request).then((response) => {
      if (response.ok && url.origin === self.location.origin) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
      }
      return response;
    }).catch(() => {
      return caches.match(event.request).then((cached) => {
        return cached || new Response('Offline', { status: 503 });
      });
    })
  );
});

// ─── Push Notifications ───
self.addEventListener('push', (event) => {
  let data = { title: 'InPlace', body: 'You have a new notification' };
  try {
    if (event.data) data = event.data.json();
  } catch (e) {
    // fallback to default
  }

  const options = {
    body: data.body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    vibrate: [100, 50, 100],
    data: data.data || {},
    actions: [
      { action: 'open', title: 'Open' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

// Handle notification click — open the app with deep-link
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  // Build deep-link URL from notification data
  const data = event.notification.data || {};
  let targetUrl = '/';
  if (data.type === 'message' && data.conversationId) {
    targetUrl = `/?conversation=${data.conversationId}`;
  } else if (data.type === 'care_request' || data.type === 'care_request_accepted') {
    targetUrl = '/?page=schedule';
  } else if (data.type === 'video_call' && data.conversationId) {
    targetUrl = `/?conversation=${data.conversationId}`;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus existing window and navigate if open
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.postMessage({ type: 'PUSH_NAVIGATE', data });
          return client.focus();
        }
      }
      // Otherwise open a new window with deep-link
      return clients.openWindow(targetUrl);
    })
  );
});
