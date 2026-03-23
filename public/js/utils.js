const { useState, useEffect, useRef, useCallback, createContext, useContext } = React;
const API_BASE = window.location.origin;

// ─── Accessibility: Text size ───
const applyTextSize = window.applyTextSize = (size) => {
  document.body.classList.remove('text-size-large', 'text-size-xlarge');
  if (size === 'large') document.body.classList.add('text-size-large');
  else if (size === 'xlarge') document.body.classList.add('text-size-xlarge');
  try { localStorage.setItem('inplace_textSize', size || 'default'); } catch {}
};
// Apply immediately from localStorage (before API loads) for instant visual
try {
  const savedSize = localStorage.getItem('inplace_textSize');
  if (savedSize && savedSize !== 'default') applyTextSize(savedSize);
} catch {}

// ─── Phone formatting: (555) 123-4567 or international passthrough ───
const formatPhone = window.formatPhone = (value, isInternational) => {
  if (!value) return '';
  if (isInternational) {
    // Free-form: allow +, digits, spaces, dashes — no forced formatting
    return String(value).replace(/[^\d\s\-\+]/g, '').slice(0, 30);
  }
  const d = String(value).replace(/\D/g, '');
  if (!d) return '';
  if (d.length <= 3) return '(' + d;
  if (d.length <= 6) return '(' + d.slice(0, 3) + ') ' + d.slice(3);
  return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6, 10);
};

// ─── International phone disclaimer text ───
const INTL_PHONE_DISCLAIMER = window.INTL_PHONE_DISCLAIMER = 'InPlace is primarily US-based. With an international number, you should not expect to receive calls from a caregiver. Plan on using the in-app chat feature primarily. Voice and video options are coming soon.';

const SERVICE_TYPE_LABELS = {
  companionship: 'Companionship', companion: 'Companionship',
  personal_care: 'Personal Care', meal_prep: 'Meal Prep',
  transportation: 'Transportation', rides: 'Rides', meals: 'Meals',
  health_wellness: 'Health & Wellness', full_day: 'Full Day',
  overnight: 'Overnight', respite: 'Respite Care',
};
const formatServiceType = window.formatServiceType = (type) => {
  if (!type) return '';
  return SERVICE_TYPE_LABELS[type] || type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
};

let AUTH_TOKEN = null;
const setAuthToken = window.setAuthToken = (token) => {
  AUTH_TOKEN = token;
  // Token is now stored in httpOnly cookie by the server — no localStorage
  // Keep in-memory for WebSocket auth and in-flight requests
};

// Active role for dual-role users (which view/mode they're in)
let ACTIVE_ROLE = localStorage.getItem('active_role') || null;
const setActiveRole = window.setActiveRole = (role) => {
  ACTIVE_ROLE = role;
  if (role) localStorage.setItem('active_role', role);
  else localStorage.removeItem('active_role');
};
const getActiveRole = window.getActiveRole = () => ACTIVE_ROLE;

// Read CSRF token from cookie (set by server, JS-readable)
const getCsrfToken = window.getCsrfToken = () => {
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return match ? match[1] : null;
};

// Track whether a refresh is already in flight (prevent thundering herd)
let _refreshPromise = null;

const apiFetch = window.apiFetch = async (url, options = {}) => {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (AUTH_TOKEN) headers['Authorization'] = `Bearer ${AUTH_TOKEN}`;
  if (ACTIVE_ROLE) headers['X-Active-Role'] = ACTIVE_ROLE;
  const csrf = getCsrfToken();
  if (csrf) headers['X-CSRF-Token'] = csrf;
  const response = await fetch(API_BASE + url, { ...options, headers, credentials: 'same-origin' });
  if (response.status === 401 && url !== '/api/auth/refresh') {
    // Attempt silent token refresh before logging out
    try {
      if (!_refreshPromise) {
        _refreshPromise = fetch(API_BASE + '/api/auth/refresh', {
          method: 'POST', credentials: 'same-origin',
          headers: getCsrfToken() ? { 'X-CSRF-Token': getCsrfToken() } : {},
        });
      }
      const refreshRes = await _refreshPromise;
      _refreshPromise = null;
      if (refreshRes.ok) {
        const data = await refreshRes.json();
        setAuthToken(data.token);
        // Retry the original request with new token
        const retryHeaders = { 'Content-Type': 'application/json', ...options.headers };
        if (data.token) retryHeaders['Authorization'] = `Bearer ${data.token}`;
        if (ACTIVE_ROLE) retryHeaders['X-Active-Role'] = ACTIVE_ROLE;
        const newCsrf = getCsrfToken();
        if (newCsrf) retryHeaders['X-CSRF-Token'] = newCsrf;
        return fetch(API_BASE + url, { ...options, headers: retryHeaders, credentials: 'same-origin' });
      }
    } catch (e) { _refreshPromise = null; }
    // Refresh failed — log out
    setAuthToken(null);
    const _lcsrf = getCsrfToken();
    fetch(API_BASE + '/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: _lcsrf ? { 'X-CSRF-Token': _lcsrf } : {} }).catch(() => {});
    return null;
  }
  return response;
};

// ─── Auth/Flow Event Tracking ───
// Fire-and-forget event tracker for login, registration, password reset, demo, etc.
// Never blocks UI. Silently fails. Used across all auth-related pages.
const trackAuthEvent = window.trackAuthEvent = (flow, eventType, extra = {}) => {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (AUTH_TOKEN) headers['Authorization'] = `Bearer ${AUTH_TOKEN}`;
    fetch('/api/onboarding-events', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        flow,
        eventType,
        email: extra.email || null,
        step: extra.step || null,
        stepName: extra.stepName || null,
        errorMessage: extra.error || null,
        errorSource: extra.source || null,
        metadata: {
          ...extra,
          online: navigator.onLine,
          screenWidth: window.innerWidth,
          userAgent: navigator.userAgent,
          timestamp: new Date().toISOString(),
        },
      }),
    }).catch(() => {});
  } catch (e) { /* ignore tracking errors */ }
};

// ─── Global error capture — sends JS errors to onboarding_events table ───
window.onerror = function(msg, source, line, col) {
  trackAuthEvent('frontend-error', 'error', {
    error: String(msg).slice(0, 200),
    source: (source || '').split('/').pop(),
    line, col,
  });
};
window.addEventListener('unhandledrejection', function(e) {
  trackAuthEvent('frontend-error', 'unhandled_rejection', {
    error: String(e.reason?.message || e.reason || '').slice(0, 200),
  });
});

// ─── Shared timestamp parser ───
// PostgreSQL TIMESTAMPTZ comes back as "2026-02-20 01:29:26.086383+00"
// Some browsers choke on the space (need T) and bare "+00" (need +00:00 or Z).
// This normalizes to ISO 8601 so new Date() works everywhere.
const parseTimestamp = window.parseTimestamp = (ts) => {
  if (!ts) return null;
  let d = String(ts);
  // Replace space with T if no T present
  if (!d.includes('T')) d = d.replace(' ', 'T');
  // If bare offset like +00 or -05 (no colon, no minutes), append :00
  d = d.replace(/([+-]\d{2})$/, '$1:00');
  // If no timezone indicator at all, assume UTC
  if (!/[Zz]$/.test(d) && !/[+-]\d{2}:\d{2}$/.test(d)) d += 'Z';
  const date = new Date(d);
  return isNaN(date.getTime()) ? null : date;
};

// Caregiver Availability Data (simulated)
const CAREGIVER_AVAILABILITY = window.CAREGIVER_AVAILABILITY = {
  'Maria Santos': {
    skills: ['Dementia Care', 'Meal Prep', 'Companionship', 'Medication Reminders'],
    rate: '$34/hr',
    weeklySchedule: {
      'Mon': [{ start: '8:00 AM', end: '4:00 PM' }],
      'Tue': [{ start: '8:00 AM', end: '2:00 PM' }],
      'Wed': [{ start: '10:00 AM', end: '6:00 PM' }],
      'Thu': [{ start: '8:00 AM', end: '4:00 PM' }],
      'Fri': [{ start: '8:00 AM', end: '12:00 PM' }],
      'Sat': [],
      'Sun': [],
    },
    bookedSlots: [
      { date: '2026-02-16', start: '10:00 AM', end: '12:00 PM', client: 'Barbara Lowe' },
      { date: '2026-02-17', start: '8:00 AM', end: '10:00 AM', client: 'Another Client' },
      { date: '2026-02-18', start: '2:00 PM', end: '4:00 PM', client: 'Barbara Lowe' },
      { date: '2026-02-19', start: '8:00 AM', end: '11:00 AM', client: 'Another Client' },
    ],
  },
  'Sarah Chen': {
    skills: ['Meal Prep', 'Companionship', 'Light Housekeeping', 'Personal Care'],
    rate: '$28/hr',
    weeklySchedule: {
      'Mon': [{ start: '9:00 AM', end: '5:00 PM' }],
      'Tue': [{ start: '9:00 AM', end: '5:00 PM' }],
      'Wed': [],
      'Thu': [{ start: '9:00 AM', end: '3:00 PM' }],
      'Fri': [{ start: '9:00 AM', end: '5:00 PM' }],
      'Sat': [{ start: '10:00 AM', end: '2:00 PM' }],
      'Sun': [],
    },
    bookedSlots: [
      { date: '2026-02-16', start: '9:00 AM', end: '11:00 AM', client: 'Another Client' },
      { date: '2026-02-20', start: '1:00 PM', end: '3:00 PM', client: 'Barbara Lowe' },
    ],
  },
  'James Okafor': {
    skills: ['Companionship', 'Transportation', 'Health & Wellness', 'Errands'],
    rate: '$32/hr',
    weeklySchedule: {
      'Mon': [{ start: '7:00 AM', end: '3:00 PM' }],
      'Tue': [{ start: '7:00 AM', end: '3:00 PM' }],
      'Wed': [{ start: '7:00 AM', end: '3:00 PM' }],
      'Thu': [],
      'Fri': [{ start: '7:00 AM', end: '1:00 PM' }],
      'Sat': [{ start: '8:00 AM', end: '12:00 PM' }],
      'Sun': [],
    },
    bookedSlots: [
      { date: '2026-02-17', start: '7:00 AM', end: '9:00 AM', client: 'Barbara Lowe' },
      { date: '2026-02-18', start: '11:00 AM', end: '1:00 PM', client: 'Another Client' },
    ],
  },
};

// Helper: get next 7 days starting from today (care-location timezone)
const getNextSevenDays = window.getNextSevenDays = () => {
  const days = [];
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  // Use care-location timezone if TimezoneHelper is loaded, else local
  const todayStr = (typeof TimezoneHelper !== 'undefined') ? TimezoneHelper.getToday() : (() => { const n = new Date(); return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0'); })();
  const [ty, tm, td] = todayStr.split('-').map(Number);
  const today = new Date(ty, tm - 1, td);
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const dateStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    days.push({
      date: dateStr,
      dayName: dayNames[d.getDay()],
      label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : dayNames[d.getDay()],
      shortDate: `${d.getMonth() + 1}/${d.getDate()}`,
    });
  }
  return days;
};

// Helper: generate available time slots for a caregiver on a given day
const getAvailableSlots = window.getAvailableSlots = (caregiverName, dayInfo) => {
  const avail = CAREGIVER_AVAILABILITY[caregiverName];
  if (!avail) return [];
  const daySchedule = avail.weeklySchedule[dayInfo.dayName] || [];
  if (daySchedule.length === 0) return [];

  const slots = [];
  daySchedule.forEach(block => {
    const parseTime = (t) => {
      const [time, ampm] = t.split(' ');
      let [h, m] = time.split(':').map(Number);
      if (ampm === 'PM' && h !== 12) h += 12;
      if (ampm === 'AM' && h === 12) h = 0;
      return h * 60 + m;
    };
    const startMin = parseTime(block.start);
    const endMin = parseTime(block.end);
    for (let m = startMin; m + 60 <= endMin; m += 60) {
      const h = Math.floor(m / 60);
      const ampm = h >= 12 ? 'PM' : 'AM';
      const displayH = h > 12 ? h - 12 : h === 0 ? 12 : h;
      const slotStart = `${displayH}:00 ${ampm}`;
      const endH = Math.floor((m + 60) / 60);
      const endAmpm = endH >= 12 ? 'PM' : 'AM';
      const displayEndH = endH > 12 ? endH - 12 : endH === 0 ? 12 : endH;
      const slotEnd = `${displayEndH}:00 ${endAmpm}`;

      const isBooked = (avail.bookedSlots || []).some(b => {
        if (b.date !== dayInfo.date) return false;
        const bStart = parseTime(b.start);
        const bEnd = parseTime(b.end);
        return m < bEnd && (m + 60) > bStart;
      });

      slots.push({ start: slotStart, end: slotEnd, booked: isBooked, startMin: m });
    }
  });
  return slots;
};

// Helper: check if caregiver has matching skills for a service type
const caregiverMatchesService = window.caregiverMatchesService = (caregiverName, serviceType) => {
  const avail = CAREGIVER_AVAILABILITY[caregiverName];
  if (!avail) return false;
  const serviceMap = {
    'companionship': ['Companionship'],
    'personal_care': ['Personal Care'],
    'housekeeping': ['Light Housekeeping', 'Housekeeping'],
    'meal_prep': ['Meal Prep'],
    'transportation': ['Transportation', 'Errands'],
    'health_wellness': ['Health & Wellness', 'Medication Reminders'],
  };
  const matchSkills = serviceMap[serviceType] || [];
  return avail.skills.some(s => matchSkills.some(ms => s.toLowerCase().includes(ms.toLowerCase())));
};

// ─── Loading Spinner Component ───
const LoadingSpinner = window.LoadingSpinner = ({ text = 'Loading...' }) => {
  return React.createElement('div', { className: 'loading-spinner-container' },
    React.createElement('div', { className: 'loading-spinner' }),
    React.createElement('div', { className: 'loading-spinner-text' }, text)
  );
};

// ─── Empty State Component ───
const EmptyState = window.EmptyState = ({ icon = '📭', title, text, actionLabel, onAction }) => {
  return React.createElement('div', { className: 'empty-state' },
    React.createElement('div', { className: 'empty-state-icon' }, icon),
    title && React.createElement('div', { className: 'empty-state-title' }, title),
    text && React.createElement('div', { className: 'empty-state-text' }, text),
    actionLabel && onAction && React.createElement('button', {
      onClick: onAction,
      style: { marginTop: 16, padding: '10px 24px', background: '#1b6b5a', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' }
    }, actionLabel)
  );
};

// ─── Toast Notification System ───
const ToastContext = window.ToastContext = createContext(null);

const useToast = window.useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Fallback: return a no-op if context is not available
    return { showToast: () => {} };
  }
  return ctx;
};

const ToastProvider = window.ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);
  const toastId = useRef(0);

  const showToast = useCallback((message, type = 'success') => {
    const id = ++toastId.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3500);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const icons = { success: '✓', error: '✕', info: 'ℹ' };

  return React.createElement(ToastContext.Provider, { value: { showToast } },
    children,
    React.createElement('div', { className: 'toast-container' },
      toasts.map(t =>
        React.createElement('div', { key: t.id, className: `toast toast-${t.type}` },
          React.createElement('span', { className: 'toast-icon' }, icons[t.type] || icons.info),
          React.createElement('span', { className: 'toast-message' }, t.message),
          React.createElement('button', { className: 'toast-close', onClick: () => removeToast(t.id) }, '×')
        )
      )
    )
  );
};

// ─── WebSocket Real-Time Connection ───
let _socket = null;
const _socketListeners = new Map(); // event -> Set of callbacks

const connectSocket = window.connectSocket = (token) => {
  if (_socket) _socket.disconnect();
  if (!token || typeof io === 'undefined') return;
  _socket = io(API_BASE, { auth: { token }, transports: ['websocket', 'polling'] });
  window._socket = _socket;
  _socket.on('connect', () => console.log('WS connected'));
  _socket.on('disconnect', () => console.log('WS disconnected'));
  // Re-register all listeners
  for (const [event, callbacks] of _socketListeners) {
    for (const cb of callbacks) {
      _socket.on(event, cb);
    }
  }
};

const disconnectSocket = window.disconnectSocket = () => {
  if (_socket) { _socket.disconnect(); _socket = null; window._socket = null; }
};

const onSocketEvent = window.onSocketEvent = (event, callback) => {
  if (!_socketListeners.has(event)) _socketListeners.set(event, new Set());
  _socketListeners.get(event).add(callback);
  if (_socket) _socket.on(event, callback);
  // Return cleanup function
  return () => {
    _socketListeners.get(event)?.delete(callback);
    if (_socket) _socket.off(event, callback);
  };
};

// ─── Push Notification Helpers ───

// Convert URL-safe base64 VAPID key to Uint8Array
const _urlBase64ToUint8Array = (base64String) => {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
};

// Compare two ArrayBuffers for equality
const _arrayBuffersEqual = (buf1, buf2) => {
  if (!buf1 || !buf2) return false;
  const a = new Uint8Array(buf1);
  const b = new Uint8Array(buf2);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) return false; }
  return true;
};

// Subscribe to push notifications (requires user gesture for permission prompt)
const subscribeToPush = window.subscribeToPush = async () => {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.warn('Push: not supported in this browser');
      return null;
    }

    const reg = await navigator.serviceWorker.ready;

    // Get current VAPID public key from server
    const keyRes = await apiFetch('/api/push/vapid-key');
    if (!keyRes || !keyRes.ok) {
      console.warn('Push: server VAPID key not available');
      return null;
    }
    const { publicKey } = await keyRes.json();
    if (!publicKey) {
      console.warn('Push: server returned empty VAPID key');
      return null;
    }
    const currentKeyBytes = _urlBase64ToUint8Array(publicKey);

    // Check if already subscribed
    let sub = await reg.pushManager.getSubscription();
    if (sub) {
      // Verify the subscription was created with the current VAPID key
      const subKey = sub.options && sub.options.applicationServerKey;
      if (subKey && _arrayBuffersEqual(subKey, currentKeyBytes.buffer)) {
        // Keys match — sync to server
        await apiFetch('/api/push/subscribe', {
          method: 'POST',
          body: JSON.stringify({ subscription: sub }),
        });
        console.log('Push: existing subscription synced (key matches)');
        return sub;
      } else {
        // VAPID key changed — unsubscribe old and re-subscribe with new key
        console.log('Push: VAPID key changed — re-subscribing...');
        await sub.unsubscribe();
        sub = null; // fall through to create new subscription
      }
    }

    // Create new subscription (triggers browser permission prompt if needed)
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: currentKeyBytes,
    });

    // Save subscription to server
    await apiFetch('/api/push/subscribe', {
      method: 'POST',
      body: JSON.stringify({ subscription: sub }),
    });

    console.log('Push: subscribed successfully with current VAPID key');
    return sub;
  } catch (err) {
    if (err.name === 'NotAllowedError') {
      console.warn('Push: user denied notification permission');
    } else {
      console.error('Push subscription error:', err);
    }
    return null;
  }
};

// Check push subscription health and re-sync if needed
// Call periodically (e.g., every 30 min) to keep subscriptions fresh
const checkPushHealth = window.checkPushHealth = async () => {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();

    if (!sub) {
      // Subscription lost (e.g., browser cleared it, or SW was updated) — re-subscribe
      console.log('Push health: no active subscription — re-subscribing...');
      await subscribeToPush();
      return;
    }

    // Verify server knows about this subscription
    if (!AUTH_TOKEN) return; // not logged in

    const statusRes = await apiFetch('/api/push/status');
    if (statusRes && statusRes.ok) {
      const status = await statusRes.json();
      if (status.userSubscriptions === 0) {
        // Server has no subscriptions for this user — re-sync
        console.log('Push health: server has no subscriptions — syncing...');
        await apiFetch('/api/push/subscribe', {
          method: 'POST',
          body: JSON.stringify({ subscription: sub }),
        });
      }
    }
  } catch (err) {
    console.warn('Push health check error:', err.message);
  }
};
