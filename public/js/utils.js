const { useState, useEffect, useRef, useCallback, createContext, useContext } = React;
const API_BASE = window.location.origin;

let AUTH_TOKEN = null;
const setAuthToken = window.setAuthToken = (token) => {
  AUTH_TOKEN = token;
  if (token) localStorage.setItem('auth_token', token);
  else localStorage.removeItem('auth_token');
};

const apiFetch = window.apiFetch = async (url, options = {}) => {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (AUTH_TOKEN) headers['Authorization'] = `Bearer ${AUTH_TOKEN}`;
  const response = await fetch(API_BASE + url, { ...options, headers });
  if (response.status === 401) { setAuthToken(null); return null; }
  return response;
};

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
      { date: '2026-02-16', start: '10:00 AM', end: '12:00 PM', client: 'Betty Lee' },
      { date: '2026-02-17', start: '8:00 AM', end: '10:00 AM', client: 'Another Client' },
      { date: '2026-02-18', start: '2:00 PM', end: '4:00 PM', client: 'Betty Lee' },
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
      { date: '2026-02-20', start: '1:00 PM', end: '3:00 PM', client: 'Betty Lee' },
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
      { date: '2026-02-17', start: '7:00 AM', end: '9:00 AM', client: 'Betty Lee' },
      { date: '2026-02-18', start: '11:00 AM', end: '1:00 PM', client: 'Another Client' },
    ],
  },
};

// Helper: get next 7 days starting from today
const getNextSevenDays = window.getNextSevenDays = () => {
  const days = [];
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const today = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    days.push({
      date: d.toISOString().split('T')[0],
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
const EmptyState = window.EmptyState = ({ icon = '📭', title, text }) => {
  return React.createElement('div', { className: 'empty-state' },
    React.createElement('div', { className: 'empty-state-icon' }, icon),
    title && React.createElement('div', { className: 'empty-state-title' }, title),
    text && React.createElement('div', { className: 'empty-state-text' }, text)
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
  if (_socket) { _socket.disconnect(); _socket = null; }
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
// Subscribe to push notifications (call after login)
const subscribeToPush = window.subscribeToPush = async () => {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    const reg = await navigator.serviceWorker.ready;
    // Check if already subscribed
    let sub = await reg.pushManager.getSubscription();
    if (sub) {
      // Already subscribed — just save to server
      await apiFetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub }),
      });
      return sub;
    }
    // Get VAPID key from server
    const keyRes = await fetch('/api/push/vapid-key');
    if (!keyRes.ok) return null;
    const { publicKey } = await keyRes.json();
    // Convert VAPID key to Uint8Array
    const urlBase64ToUint8Array = (base64String) => {
      const padding = '='.repeat((4 - base64String.length % 4) % 4);
      const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
      const rawData = atob(base64);
      return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
    };
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    // Save subscription to server
    await apiFetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub }),
    });
    return sub;
  } catch (err) {
    console.log('Push subscription error:', err);
    return null;
  }
};
