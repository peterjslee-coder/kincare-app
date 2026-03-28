// InPlace Service Worker — v1.50.40
const CACHE_NAME = 'inplace-v1.51.64';
const SW_VERSION = '1.51.64';
const STATIC_ASSETS = [
  '/',
  '/css/styles.css',
  '/vendor/react.production.min.js',
  '/vendor/react-dom.production.min.js',
  '/vendor/socket.io.min.js',
  '/vendor/twilio-video.min.js',
  '/vendor/leaflet.js',
  '/vendor/leaflet.css',
  '/js-compiled/bundle.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/badge-monochrome-96.png',
  '/manifest.json',
];

// Install: cache static assets, skip waiting immediately
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      const promises = STATIC_ASSETS.map((url) =>
        cache.add(url).catch(() => console.log('SW: skip caching', url))
      );
      return Promise.all(promises);
    })
  );
  self.skipWaiting();
});

// Activate: delete ALL old caches aggressively, then claim clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => {
          console.log('SW: deleting old cache', k);
          return caches.delete(k);
        })
      )
    ).then(() => {
      // Force all open tabs to use this new SW immediately
      return self.clients.claim();
    }).then(() => {
      // Notify all clients to reload for the new version
      return self.clients.matchAll({ type: 'window' }).then((clients) => {
        for (const client of clients) {
          client.postMessage({ type: 'SW_UPDATED', version: SW_VERSION });
        }
      });
    })
  );
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

  // Navigation requests (HTML): ALWAYS network-first, never serve stale HTML
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        return caches.match(event.request).then((cached) => {
          return cached || caches.match('/').then(r => r || new Response('Offline', { status: 503 }));
        });
      })
    );
    return;
  }

  // CDN assets: network-first with cache fallback (ensures fresh SDK loads)
  if (url.hostname.includes('cdnjs') || url.hostname.includes('unpkg') ||
      url.hostname.includes('cdn.socket.io') || url.hostname.includes('sdk.twilio.com')) {
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        return caches.match(event.request).then((cached) => {
          return cached || new Response('', { status: 503 });
        });
      })
    );
    return;
  }

  // App assets (JS bundle, CSS, images): network-first with cache fallback
  // The ?v= query string busts browser cache, but SW also always tries network first
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
    badge: '/icons/icon-maskable-96.png',
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

  const data = event.notification.data || {};
  let targetUrl = '/?page=dashboard';
  if (data.type === 'message' && data.conversationId) {
    targetUrl = `/?conversation=${data.conversationId}`;
  } else if (data.type === 'care_request' || data.type === 'care_request_accepted') {
    targetUrl = '/?page=schedule';
  } else if (data.type === 'check_in_reminder' || data.type === 'check_out_reminder' || data.type === 'caregiver_arriving') {
    targetUrl = '/?page=dashboard';
  } else if (data.type === 'video_call' && data.conversationId) {
    targetUrl = `/?conversation=${data.conversationId}`;
  } else if (data.type === 'new_job') {
    targetUrl = '/?page=find-work';
  } else if (data.type === 'kindred_relay') {
    targetUrl = '/?page=messages';
  } else if (data.type === 'admin_setting_change') {
    targetUrl = '/?page=dashboard';
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.postMessage({ type: 'PUSH_NAVIGATE', data });
          return client.focus();
        }
      }
      return clients.openWindow(targetUrl);
    })
  );
});

// ─── Message handler: version reporting + push health check ───
self.addEventListener('message', (event) => {
  if (event.data?.type === 'GET_VERSION') {
    event.ports?.[0]?.postMessage({ version: SW_VERSION });
  }

  // Force update check requested by page
  if (event.data?.type === 'FORCE_UPDATE') {
    self.registration.update();
  }

  // Push keepalive: page can ask SW to verify push subscription is active
  if (event.data?.type === 'CHECK_PUSH_SUBSCRIPTION') {
    event.waitUntil(
      self.registration.pushManager.getSubscription().then((sub) => {
        const active = !!(sub && sub.endpoint);
        self.clients.matchAll().then((clients) => {
          for (const client of clients) {
            client.postMessage({
              type: 'PUSH_SUBSCRIPTION_STATUS',
              active,
              endpoint: sub ? sub.endpoint.slice(-20) : null,
            });
          }
        });
      })
    );
  }
});
