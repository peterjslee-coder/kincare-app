// InPlace Service Worker — v1.57.14
const CACHE_NAME = 'inplace-build-4d74c7e6-msgvdniw';
const SW_VERSION = 'build-4d74c7e6-msgvdniw';
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

// Install: cache static assets, then wait for activation (no skipWaiting — avoids
// killing in-flight fetches during SW transition, which caused dashboard load failures)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      const promises = STATIC_ASSETS.map((url) =>
        cache.add(url).catch(() => console.log('SW: skip caching', url))
      );
      return Promise.all(promises);
    })
  );
  // NOT calling self.skipWaiting() — new SW activates on next navigation,
  // preventing TypeError: Failed to fetch on dashboard load after deploys
});

// Activate: delete old caches, notify clients of new version
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
      // Claim uncontrolled clients (first visit or hard refresh)
      return self.clients.claim();
    }).then(() => {
      // Notify all clients about the new version
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

  // Map tiles: let browser handle natively (no SW interception)
  if (url.hostname.includes('tile.openstreetmap.org')) {
    return; // Don't call event.respondWith — browser fetches directly
  }

  // API calls: network-first, with offline-queueable awareness
  if (url.pathname.startsWith('/api/')) {
    // Check if this is an offline-queueable POST (check-in, check-out, notes)
    const isQueueable = event.request.method === 'POST' && (
      url.pathname.match(/\/api\/sessions\/[^/]+\/check-in$/) ||
      url.pathname.match(/\/api\/sessions\/[^/]+\/check-out$/) ||
      url.pathname === '/api/notes'
    );

    event.respondWith(
      fetch(event.request).catch(() => {
        if (isQueueable) {
          // Return a special 503 with queueable flag so the client knows to queue
          return new Response(JSON.stringify({
            error: 'You appear to be offline',
            queueable: true,
            offlineMessage: 'Your action has been saved and will sync when you reconnect.',
          }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ error: 'You appear to be offline' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        });
      })
    );
    return;
  }

  // Navigation requests (HTML): ALWAYS network-first, never serve stale HTML
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response.ok && event.request.method === 'GET') {
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
      if (response.ok && url.origin === self.location.origin && event.request.method === 'GET') {
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

  const pushData = data.data || {};

  // Suppress notification if user is actively viewing this conversation
  // Ask the focused client if this conversation is active
  event.waitUntil(
    (async () => {
      if (pushData.type === 'message' && pushData.conversationId) {
        const windowClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of windowClients) {
          if (client.focused || client.visibilityState === 'visible') {
            try {
              // Use MessageChannel to ask the client if it's viewing this conversation
              const isViewing = await new Promise((resolve) => {
                const mc = new MessageChannel();
                mc.port1.onmessage = (e) => resolve(e.data?.viewing === true);
                client.postMessage({ type: 'CHECK_ACTIVE_CONVERSATION', conversationId: pushData.conversationId }, [mc.port2]);
                setTimeout(() => resolve(false), 200); // timeout fallback
              });
              if (isViewing) {
                console.log('SW: suppressed notification — user is viewing conversation', pushData.conversationId);
                return; // Don't show the notification
              }
            } catch {}
          }
        }
      }

      // v1.105.40 — the app-icon badge for the INSTALLED PWA (home-screen app). Works on
      // iOS 16.4+ and desktop Chrome/Edge; a no-op in a plain browser tab, which is fine.
      // The number is computed server-side and rides on every push, so the badge is
      // corrected on every notification — including downward, and including to 0.
      // The native iOS app gets the same number via aps.badge instead; see utils/apns.js.
      try {
        if (self.registration && typeof self.navigator?.setAppBadge === 'function') {
          const n = Number(data.badgeCount);
          if (Number.isFinite(n) && n > 0) await self.navigator.setAppBadge(n);
          else if (Number.isFinite(n)) await self.navigator.clearAppBadge();
        }
      } catch { /* badging is a bonus — never block the notification */ }

      const actions = [
        { action: 'open', title: 'Open' },
      ];
      if (pushData.mapsUrl) {
        actions.push({ action: 'directions', title: 'Directions' });
      }
      actions.push({ action: 'dismiss', title: 'Dismiss' });

      const options = {
        body: data.body,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-maskable-96.png',
        vibrate: [100, 50, 100],
        data: pushData,
        tag: data.tag || undefined,
        renotify: !!data.tag,
        actions,
      };

      await self.registration.showNotification(data.title, options);
    })()
  );
});

// Handle notification click — open the app with deep-link
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  // "Directions" action — open maps directly
  if (event.action === 'directions' && event.notification.data?.mapsUrl) {
    event.waitUntil(clients.openWindow(event.notification.data.mapsUrl));
    return;
  }

  const data = event.notification.data || {};
  let targetUrl = '/?page=dashboard';
  const type = String(data.type || '');
  if (type === 'message' && data.conversationId) {
    targetUrl = `/?conversation=${data.conversationId}`;
  } else if (type.startsWith('reimbursement')) {
    // v1.97.0 — straight to the item: page + team + focus token
    targetUrl = `/?page=care-team${data.careTeamId ? `&careTeamId=${encodeURIComponent(data.careTeamId)}` : ''}${data.focus ? `&focus=${encodeURIComponent(data.focus)}` : ''}`;
  } else if (type === 'care_request' || type === 'care_request_accepted') {
    targetUrl = `/?page=schedule${data.sessionId ? `&focus=${encodeURIComponent('session:' + data.sessionId)}` : ''}`;
  } else if (type === 'check_in_reminder' || type === 'check_out_reminder' || type === 'caregiver_arriving') {
    targetUrl = '/?page=dashboard';
  } else if (type === 'video_call' && data.conversationId) {
    targetUrl = `/?conversation=${data.conversationId}`;
  } else if (type === 'new_job') {
    targetUrl = '/?page=find-work';
  } else if (type === 'kindred_relay') {
    targetUrl = '/?page=messages';
  } else if (type === 'admin_setting_change') {
    targetUrl = '/?page=dashboard';
  } else if (data.page) {
    // Generic deep-link — carry the item focus and team through cold start
    targetUrl = `/?page=${encodeURIComponent(data.page)}${data.careTeamId ? `&careTeamId=${encodeURIComponent(data.careTeamId)}` : ''}${data.focus ? `&focus=${encodeURIComponent(data.focus)}` : ''}`;
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

// ─── Background Sync: replay queued offline actions ───
self.addEventListener('sync', (event) => {
  if (event.tag === 'offline-sync') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window' }).then((clients) => {
        for (const client of clients) {
          client.postMessage({ type: 'OFFLINE_SYNC_TRIGGER' });
        }
      })
    );
  }
});

// ─── Message handler: version reporting + push health check ───
self.addEventListener('message', (event) => {
  if (event.data?.type === 'GET_VERSION') {
    event.ports?.[0]?.postMessage({ version: SW_VERSION });
  }

  // v1.78.0 — user tapped the update pill: activate the waiting SW now.
  // Safe because it only ever fires on explicit user consent (never automatic —
  // automatic skipWaiting is what broke in-flight dashboards pre-v1.57.14).
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
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
