const { useState, useEffect, useRef, useCallback, useMemo, createContext, useContext } = React;
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
  housekeeping: 'Housekeeping',
};
// ─── What a job pays, computed once (v1.105.106) ───
//
// Julia, dc5e86b5: "$24 and then $29 listed on same job (doesn't match up)."
//
// She was right, and it was not a display preference — it was arithmetic that could not be
// reconciled. The two job cards each computed the money inline, twice over, like this:
//
//   basePerHour   = Math.round(baseCost / hours)     ← whole dollars
//   effectiveTotal = baseCost                        ← then rendered with .toFixed(0)
//
// Two independent roundings of the same money. A 1.2-hour job at $29 showed a "$24/hr" pill
// and a bare "$29", and 24 x 1.2 is 28.8, not 29 — so multiplying what she could see never
// gave what she could see. Worse, the $29 carried NO LABEL at all: a rate and a total sitting
// side by side, one of them unexplained. Of course it didn't match up.
//
// So: derive everything from ONE total, round only at the very end, and never round a rate
// independently of the total it came from.
//
// `estimated_cost` IS the caregiver's take — sessions.js sets
// `caregiver_payout: estimatedCost` with the comment "caregiver gets the full amount"; the
// platform fee is added ON TOP for the family. So it is honest to label this as what she earns.
const jobPay = window.jobPay = (job) => {
  const hours = parseFloat(job && job.durationHours) || 0;
  const surcharge = parseFloat(job && job.shortNoticeSurcharge) || 0;
  const proposedRate = parseFloat(job && job.proposedRate) || 0;
  const baseCost = parseFloat(job && job.estimatedCost) || 0;

  // One total. Everything below is derived from it.
  const total = proposedRate > 0 ? (proposedRate * hours) + surcharge : baseCost;
  const perHour = hours > 0 ? total / hours : 0;
  // What it would pay without the short-notice bonus — from the SAME total, not a
  // separately-rounded figure.
  const basePerHour = hours > 0 ? (total - surcharge) / hours : 0;

  return {
    hours,
    surcharge,
    hasBonus: surcharge > 0,
    total,
    perHour,
    basePerHour,
  };
};

// ─── Which hours a calendar needs to show (v1.105.110) ───
//
// Tyler, 16328059: "Calendar starts at 0am and looks odd on the dashboard."
//
// CaregiverCalendar drew a fixed `hourStart = 0, hourEnd = 24` grid. Twenty-four rows, of
// which the overnight ten are almost always empty, so the thing you actually came to look at
// starts a screen and a half down.
//
// The tempting fix is to hardcode 7–21 instead. That is wrong here: overnight supervision is
// a service type InPlace sells, and a caregiver working 10pm–6am would find her own shift
// clipped off the top of the calendar with nothing to say it had been.
//
// So: a comfortable default window, WIDENED by whatever is really on the grid. A normal week
// shows a third fewer rows; an overnight week shows midnight. Nothing is ever hidden, which is
// the property that matters — a calendar that silently omits a booked visit is worse than a
// tall one.
const DEFAULT_CALENDAR_HOURS = { start: 7, end: 21 };

/**
 * @param {Array<{hour:number, span?:number}>} spans  things occupying the grid
 * @param {{start:number, end:number}} [fallback]
 * @returns {{start:number, end:number}} half-open [start, end), clamped to 0..24
 */
const calendarHourRange = window.calendarHourRange = (spans, fallback = DEFAULT_CALENDAR_HOURS) => {
  let start = fallback.start;
  let end = fallback.end;
  for (const s of spans || []) {
    // `Number(null)` is 0, and 0 is a perfectly good hour — so a missing time would silently
    // drag the window back to midnight, which is the exact complaint being fixed.
    if (s == null || s.hour == null || s.hour === '') continue;
    const h = Number(s.hour);
    if (!Number.isFinite(h)) continue;
    const span = Number(s.span);
    const finish = h + (Number.isFinite(span) && span > 0 ? Math.ceil(span) : 1);
    if (h < start) start = h;
    if (finish > end) end = finish;
    // A shift that runs past midnight has a tail in the early hours of the next day. Show
    // them: an overnight caregiver looking at a calendar that stops at midnight cannot see
    // half her own week.
    if (finish > 24) start = 0;
  }
  start = Math.max(0, Math.min(23, Math.floor(start)));
  end = Math.max(start + 1, Math.min(24, Math.ceil(end)));
  return { start, end };
};

// How long an exclusive ("Just for You") offer has left, and whether it has lapsed —
// both from a `now` the CALLER controls (v1.105.106).
//
// These used to be inlined four times in CaretakerHub, each calling `new Date()` during
// render: twice in the two filters that decide which section a job belongs to, and once per
// card for the countdown. List membership therefore depended on the wall clock at the instant
// React happened to render, so any unrelated re-render could move a card from "Just for You"
// into Find Work mid-tap. Passing `now` in makes one render see one moment.
const exclusiveMinutesLeft = window.exclusiveMinutesLeft = (job, nowMs) => {
  const until = job && job.exclusiveUntil ? new Date(job.exclusiveUntil).getTime() : null;
  if (!until || Number.isNaN(until)) return null;
  return Math.max(0, Math.floor((until - nowMs) / 60000));
};

const isExclusiveExpired = window.isExclusiveExpired = (job, nowMs) => {
  const left = exclusiveMinutesLeft(job, nowMs);
  return left !== null && left <= 0;
};

// Money the reader can check with a calculator. Whole dollars stay whole ($29, not $29.00);
// anything else keeps its cents ($24.17), because rounding a rate to the dollar is exactly
// what stopped the numbers reconciling.
const formatMoney = window.formatMoney = (n) => {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2)}`;
};

const formatServiceType = window.formatServiceType = (type) => {
  if (!type) return '';
  // Handle "other:Custom text" format
  if (type.startsWith('other:')) return type.slice(6).trim() || 'Other';
  if (type === 'other') return 'Other';
  return SERVICE_TYPE_LABELS[type] || type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
};

let AUTH_TOKEN = null;
const setAuthToken = window.setAuthToken = (token) => {
  AUTH_TOKEN = token;
  // Token is now stored in httpOnly cookie by the server — no localStorage
  // Keep in-memory for WebSocket auth and in-flight requests
};
const getAuthToken = window.getAuthToken = () => AUTH_TOKEN;

// Active role for dual-role users (which view/mode they're in)
// v1.105.35 — guarded. This runs at MODULE SCOPE in the 2nd file of the concatenated
// bundle, so a throw here stops the single shared scope from ever defining a component or
// app.js: a blank page, before React exists, with no ErrorBoundary to catch it. Storage
// throws in Safari private mode and in locked-down webviews, which is exactly the
// population least able to tell us what they saw.
let ACTIVE_ROLE = (() => { try { return localStorage.getItem('active_role') || null; } catch { return null; } })();
const setActiveRole = window.setActiveRole = (role) => {
  ACTIVE_ROLE = role;
  // v1.105.35 — the in-memory value is what the app actually reads; persistence is a
  // convenience. Losing it must never cost the user the click.
  try {
    if (role) localStorage.setItem('active_role', role);
    else localStorage.removeItem('active_role');
  } catch {}
};
const getActiveRole = window.getActiveRole = () => ACTIVE_ROLE;

// Read CSRF token from cookie (set by server, JS-readable)
const getCsrfToken = window.getCsrfToken = () => {
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return match ? match[1] : null;
};

// Track whether a refresh is already in flight (prevent thundering herd)
let _refreshPromise = null;
let _proactiveRefreshTimer = null;

// Proactive token refresh — silently renew the JWT before it expires
// so the user never sees a logout. Fires once per day (well within 7d expiry).
const startProactiveRefresh = window.startProactiveRefresh = () => {
  if (_proactiveRefreshTimer) clearInterval(_proactiveRefreshTimer);
  const REFRESH_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
  _proactiveRefreshTimer = setInterval(async () => {
    try {
      const res = await fetch(API_BASE + '/api/auth/refresh', {
        method: 'POST', credentials: 'same-origin',
        headers: getCsrfToken() ? { 'X-CSRF-Token': getCsrfToken() } : {},
      });
      if (res.ok) {
        const data = await res.json();
        if (data.token) setAuthToken(data.token);
        console.log('Auth: proactive token refresh succeeded');
      }
    } catch (e) {
      console.warn('Auth: proactive refresh failed:', e.message);
    }
  }, REFRESH_INTERVAL);
  // Also refresh immediately on visibility change (app comes to foreground)
  document.addEventListener('visibilitychange', _onVisibilityRefresh);
};

// When app returns to foreground after being backgrounded, refresh the token
// This covers the Android case where the app was suspended for hours
let _lastVisibilityRefresh = 0;
const _onVisibilityRefresh = async () => {
  if (document.visibilityState !== 'visible') return;
  const now = Date.now();
  // Don't refresh more than once per hour
  if (now - _lastVisibilityRefresh < 60 * 60 * 1000) return;
  _lastVisibilityRefresh = now;
  try {
    const res = await fetch(API_BASE + '/api/auth/refresh', {
      method: 'POST', credentials: 'same-origin',
      headers: getCsrfToken() ? { 'X-CSRF-Token': getCsrfToken() } : {},
    });
    if (res.ok) {
      const data = await res.json();
      if (data.token) setAuthToken(data.token);
      console.log('Auth: visibility refresh succeeded');
    }
  } catch (e) { /* silent */ }
};

// ─── Admin Impersonation (View As) ───
// When set, apiFetch uses this token instead of the admin's own token.
// This makes all API calls return data as the impersonated user would see it.
// v1.105.35 — guarded for the same reason as ACTIVE_ROLE above (module scope, no boundary).
let IMPERSONATION_TOKEN = (() => { try { return sessionStorage.getItem('inplace_impersonation_token') || null; } catch { return null; } })();
const setImpersonationToken = window.setImpersonationToken = (token) => {
  IMPERSONATION_TOKEN = token;
  try {
    if (token) sessionStorage.setItem('inplace_impersonation_token', token);
    else sessionStorage.removeItem('inplace_impersonation_token');
  } catch {}
};
const getImpersonationToken = window.getImpersonationToken = () => IMPERSONATION_TOKEN;

// ─── v1.105.46 — every request gets a deadline ───
//
// Pete, standing in Betty's kitchen: "I clicked ok, but it's just loading." Nothing in
// Sentry, nothing in the server logs — because the request never arrived. A phone on one
// bar opens a socket that never answers, and `fetch` has NO default timeout: it waits
// essentially forever. So the spinner spins forever, no catch block runs, no error is
// reported, and the person is left holding a phone that is doing nothing and saying
// nothing. Every save in this app could do that; the visit log is just where he found it.
//
// A deadline turns an invisible hang into an ordinary error that existing catch blocks
// already handle ("check your connection and try again"). Uploads get a long one — a
// receipt photo on cellular legitimately takes a while — and a caller can override.
const API_TIMEOUT_MS = 25000;
const API_UPLOAD_TIMEOUT_MS = 120000;

// ─── v1.105.49 — showing a notification from the page, safely ───
//
// `new Notification(...)` is not implemented on iOS. Not "returns false" — the constructor
// is absent in WKWebView and, in an iOS 16.4+ home-screen web app, `'Notification' in
// window` is TRUE and permission can be 'granted' while constructing one still throws.
// So the usual guard passes and the call blows up, taking the rest of the handler with it.
//
// That cost two real things: an incoming call fired nothing on iPhone AND skipped the
// navigation on the line after it; and inside a useEffect the throw reached the
// ErrorBoundary, so a call arriving while the app was backgrounded replaced the message
// thread with "Something went wrong".
//
// The portable path is the service worker's showNotification, which WebKit does support in
// an installed app — and it routes clicks through sw.js's existing notificationclick
// handler, so pass `data.page` rather than an onclick. Never throws; returns whether
// anything was actually shown.
const showLocalNotification = window.showLocalNotification = async (title, options = {}) => {
  try {
    // v1.105.54 — the native shell first, when the build has @capacitor/local-notifications.
    // v1.105.49 routed these through the service worker because `new Notification` throws on
    // iOS; but a WKWebView may have no usable service-worker notification path either, so
    // an incoming call could still be silent there. This is the one that definitely works.
    const ln = _capPlugin('LocalNotifications');
    if (ln?.schedule) {
      try {
        // v1.105.57 — authorization first. iOS accepts schedule() from an unauthorized app
        // and simply displays nothing, so returning true off a resolved promise would be
        // this week's "Exported!" toast again: reporting success for something the person
        // never saw. Falls through to the service-worker path rather than lying.
        if (ln.checkPermissions) {
          const perm = await ln.checkPermissions();
          if (perm?.display !== 'granted') return false;
        }
        await ln.schedule({
          notifications: [{
            id: Math.abs((options.tag || title).split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0)) % 2147483647,
            title,
            body: options.body || '',
            extra: options.data || {},
          }],
        });
        return true;
      } catch { /* fall through */ }
    }
    if (typeof Notification === 'function' && Notification.permission !== 'granted') return false;
    const reg = await navigator.serviceWorker?.getRegistration?.();
    if (reg?.showNotification) {
      await reg.showNotification(title, options);
      return true;
    }
    // No service worker (a plain tab, a dev page) — the constructor is fine there.
    if (typeof Notification === 'function' && Notification.permission === 'granted') {
      new Notification(title, options);
      return true;
    }
  } catch { /* a notification is never worth taking the view down */ }
  return false;
};

// Close whatever we opened under a tag. Needed because showNotification hands back no
// handle — you have to go and find it again.
const closeLocalNotification = window.closeLocalNotification = async (tag) => {
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.();
    const open = await reg?.getNotifications?.({ tag });
    (open || []).forEach((n) => n.close());
  } catch { /* nothing to do */ }
};

// ─── v1.105.54 — one way to ask this phone where it is ───
//
// Pete's diagnostic, from the card that now reports itself:
//     web:ceiling:timeout → watch:ceiling:timeout in 42s
//
// "ceiling" is OUR outer deadline, which means neither the success NOR the error callback
// was ever invoked — by getCurrentPosition or by watchPosition — for 42 seconds. A denial
// would have come back as denied(1); a real failure as timeout(3). Nothing came back at
// all. That is the signature of a stub: Capacitor's WKWebView does not connect the browser
// Geolocation API to Core Location, and @capacitor/geolocation — the plugin that does —
// is not installed. Not permission, not signal, not GPS, not indoors. The API is scenery.
//
// This matters well beyond the visit nudge. Caregiver CHECK-IN and CHECK-OUT called
// navigator.geolocation directly too, so the location evidence that proves a caregiver
// was at the home has never been captured on an iPhone — it just sat there with a null
// location and no error, which is why nobody noticed.
//
// So: one helper, used everywhere. It prefers the native plugin when a build provides one,
// falls back to the browser API, and always answers — with the reason and a trace of what
// it tried, so the next failure explains itself instead of being inferred from a photo.
const _geoReason = (err) => {
  if (!err) return 'timeout';
  if (err.code === 1) return 'denied';       // PERMISSION_DENIED
  if (err.code === 2) return 'unavailable';  // POSITION_UNAVAILABLE
  if (err.code === 3) return 'timeout';      // TIMEOUT
  if (/denied|permission/i.test(err.message || '')) return 'denied';
  return 'unknown';
};

const _capPlugin = (name) => {
  try {
    if (!window.Capacitor?.isNativePlatform?.()) return null;
    return window.Capacitor?.Plugins?.[name] || null;
  } catch { return null; }
};
window.__capPlugin = _capPlugin;

const _geoWeb = (options, ceilingMs, useWatch) => new Promise((resolve) => {
  const api = navigator.geolocation;
  const stage = useWatch ? 'watch' : 'web';
  if (!api || (useWatch && !api.watchPosition)) return resolve({ pos: null, reason: 'unsupported', stage: `${stage}:absent` });
  let settled = false, id = null;
  const done = (v) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (id !== null) { try { api.clearWatch(id); } catch {} }
    resolve(v);
  };
  const timer = setTimeout(() => done({ pos: null, reason: 'timeout', stage: `${stage}:ceiling` }), ceilingMs);
  const ok = (p) => done({ pos: p, reason: null, stage });
  const bad = (e) => done({ pos: null, reason: _geoReason(e), stage, code: e?.code, detail: e?.message });
  try {
    if (useWatch) id = api.watchPosition(ok, bad, options);
    else api.getCurrentPosition(ok, bad, options);
  } catch (e) { done({ pos: null, reason: 'unsupported', stage: `${stage}:threw`, detail: e?.message }); }
});

const _geoNative = async (options, ceilingMs) => {
  const plugin = _capPlugin('Geolocation');
  if (!plugin?.getCurrentPosition) return { pos: null, reason: 'unsupported', stage: 'native:absent' };
  try {
    const p = await Promise.race([
      plugin.getCurrentPosition(options),
      new Promise((r) => setTimeout(() => r(null), ceilingMs)),
    ]);
    if (p?.coords) return { pos: p, reason: null, stage: 'native' };
    return { pos: null, reason: 'timeout', stage: 'native:ceiling' };
  } catch (e) {
    return { pos: null, reason: _geoReason(e), stage: 'native', detail: e?.message };
  }
};

// Can this device be asked at all? Note this must NOT be a bare `navigator.geolocation`
// check: that object EXISTS in the native webview (it's the stub that never answers), and
// conversely a plugin build could answer without it. Ask about both.
const canAskLocation = window.canAskLocation = () =>
  !!(_capPlugin('Geolocation') || (typeof navigator !== 'undefined' && navigator.geolocation));

/**
 * Ask this device where it is. Always settles.
 * @returns {{pos: GeolocationPosition|null, reason: string|null, tried: string[], elapsedMs: number}}
 */
const getDeviceLocation = window.getDeviceLocation = async ({ highAccuracy = false, timeoutMs = 20000 } = {}) => {
  const started = Date.now();
  const tried = [];
  const opts = { enableHighAccuracy: highAccuracy, timeout: timeoutMs, maximumAge: 60000 };
  const record = (r) => {
    tried.push(`${r.stage}:${r.reason || 'ok'}${r.code ? `(${r.code})` : ''}`);
    return { ...r, tried, elapsedMs: Date.now() - started };
  };

  if (_capPlugin('Geolocation')) {
    const n = record(await _geoNative(opts, timeoutMs + 2000));
    if (n.pos || n.reason === 'denied') return n;
  }
  const first = record(await _geoWeb(opts, timeoutMs + 2000, false));
  if (first.pos || first.reason === 'denied' || first.reason === 'unsupported') return first;
  // A watch sometimes answers where getCurrentPosition won't — though not on a stubbed API.
  return record(await _geoWeb(opts, timeoutMs, true));
};

// ─── v1.105.49 — opening an external URL that was fetched first ───
//
// `window.open(url, '_blank')` after an `await` is silently blocked on Safari and in
// WKWebView: the transient user activation from the tap is spent by the time the URL comes
// back from the server. Chrome is far more permissive, which is why this pattern passed
// review and then did nothing on the platform most of these users are on. The casualties
// were the Stripe payout dashboard and the background-check invitation — i.e. a caregiver
// could not finish getting paid or get vetted from an iPhone, with no error to report.
//
// The native shell has @capacitor/browser (already used for OAuth); everywhere else,
// navigating the current window is not subject to the popup blocker.
const openExternalUrl = window.openExternalUrl = (url) => {
  if (!url) return false;
  try {
    if (window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.Browser) {
      window.Capacitor.Plugins.Browser.open({ url, presentationStyle: 'popover' });
      return true;
    }
    const w = window.open(url, '_blank');
    if (w) return true;
    // Blocked (Safari after an await) — go there in this window instead of doing nothing.
    window.location.href = url;
    return true;
  } catch {
    try { window.location.href = url; return true; } catch { return false; }
  }
};

// ─── v1.105.49 — saving a file, and knowing whether it worked ───
//
// `<a download>` is not implemented in WKWebView. Capacitor installs no download delegate,
// so the click is dropped on the floor — and every export in this app then showed a green
// "Exported 34 reimbursements" toast on the very next line. That is the worst version of
// a silent failure: the app actively asserting something happened that didn't.
//
// Returns TRUE only if the file was really handed off. Callers must gate their success
// message on it. On the native shell the honest route is the OS share sheet; if that isn't
// available we say so rather than pretending.
// ─── v1.105.69 — copying text, and knowing whether it worked ───
//
// Four sites did this by hand and all four could lie. `navigator.clipboard` is undefined in a
// non-secure context and in older WebViews, so `navigator.clipboard.writeText(...)` throws a
// TypeError SYNCHRONOUSLY — before any .then/.catch is attached, which means an attached
// fallback never runs. Two sites used `navigator.clipboard?.writeText(url)` instead: no throw,
// but the promise is discarded and a success toast fires on the very next line regardless.
//
// The 2FA backup codes were the worst of them. Its fallback selected `#backup-codes-text`, an
// element that exists nowhere in this repo, and those codes are the only way back into an
// account whose authenticator is lost.
//
// Returns true only when the text is actually on the clipboard.
const copyText = window.copyText = async (text) => {
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through — permission denied, insecure context, or no user activation */ }
  // execCommand('copy') is deprecated and still the only thing that works in some WebViews.
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length); // iOS ignores select() alone
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return !!ok;
  } catch { return false; }
};

const saveBlob = window.saveBlob = async (blob, filename) => {
  const isNative = !!window.Capacitor?.isNativePlatform?.();
  if (!isNative) {
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return true;
    } catch { return false; }
  }
  // v1.105.54 — the native shell, when the build has @capacitor/filesystem and
  // @capacitor/share: write the file, then hand it to the OS share sheet. This is what
  // actually makes "Save" and "Export CSV" produce a file on an iPhone.
  const fs = _capPlugin('Filesystem');
  const share = _capPlugin('Share');
  if (fs?.writeFile && share?.share) {
    try {
      const b64 = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onerror = () => reject(new Error('read failed'));
        r.onload = () => resolve(String(r.result).split(',')[1] || '');
        r.readAsDataURL(blob);
      });
      const written = await fs.writeFile({ path: filename, data: b64, directory: 'CACHE' });
      await share.share({ title: filename, url: written?.uri, dialogTitle: filename });
      return true;
    } catch (e) {
      if (e?.message && /cancel/i.test(e.message)) return false;
      /* fall through to the Web Share API */
    }
  }
  try {
    const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return true;
    }
  } catch (e) {
    if (e?.name === 'AbortError') return false; // they closed the share sheet; not an error
  }
  return false;
};

// Report a client-side problem to the server's Sentry sink. Raw fetch on purpose — routing
// this through apiFetch would let a timeout report time out. keepalive so it survives the
// view being torn down.
const reportClientError = window.reportClientError = (err, extra = {}) => {
  try {
    fetch(API_BASE + '/api/client-error', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        message: String(err?.message || err || 'unknown').slice(0, 300),
        stack: String(err?.stack || '').slice(0, 4000),
        version: window.APP_VERSION || null,
        userAgent: navigator?.userAgent || null,
        url: (window.location.hash || window.location.pathname) || null,
        ...extra,
      }),
    }).catch(() => {});
  } catch {}
};

const apiFetch = window.apiFetch = async (url, options = {}) => {
  // For FormData (file uploads), don't set Content-Type — browser sets multipart boundary automatically
  const isFormData = options.body instanceof FormData;
  const headers = isFormData ? { ...options.headers } : { 'Content-Type': 'application/json', ...options.headers };
  // Use impersonation token if active (admin viewing as another user)
  const effectiveToken = IMPERSONATION_TOKEN || AUTH_TOKEN;
  if (effectiveToken) headers['Authorization'] = `Bearer ${effectiveToken}`;
  if (ACTIVE_ROLE && !IMPERSONATION_TOKEN) headers['X-Active-Role'] = ACTIVE_ROLE;
  if (window.APP_VERSION) headers['X-App-Version'] = window.APP_VERSION;
  const csrf = getCsrfToken();
  if (csrf) headers['X-CSRF-Token'] = csrf;

  // Respect a signal the caller already supplied; otherwise impose our own deadline.
  const timeoutMs = options.timeoutMs || (isFormData ? API_UPLOAD_TIMEOUT_MS : API_TIMEOUT_MS);
  let timer = null;
  let controller = null;
  if (!options.signal && typeof AbortController === 'function') {
    controller = new AbortController();
    timer = setTimeout(() => controller.abort(), timeoutMs);
  }

  let response;
  try {
    response = await fetch(API_BASE + url, {
      ...options, headers, credentials: 'same-origin',
      ...(controller ? { signal: controller.signal } : {}),
    });
  } catch (err) {
    if (timer) clearTimeout(timer);
    // An abort is our deadline firing, not a bug in the caller. Make it legible in the
    // logs, since a hang like this leaves no trace anywhere else.
    if (err?.name === 'AbortError') {
      const e = new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s: ${url}`);
      e.name = 'ApiTimeoutError';
      try { reportClientError(e, { page: url }); } catch {}
      throw e;
    }
    throw err;
  }
  if (timer) clearTimeout(timer);

  // ─── IP Verification Challenge ───
  // If admin endpoint returns 403 with IP_VERIFICATION_REQUIRED, trigger passkey re-auth
  if (response.status === 403 && url.startsWith('/api/admin')) {
    try {
      const errBody = await response.clone().json();
      if (errBody.code === 'IP_VERIFICATION_REQUIRED') {
        // Dispatch event so AdminPanel can show the verification modal
        window.dispatchEvent(new CustomEvent('ip-verification-required', { detail: { ip: errBody.ip, originalUrl: url, originalOptions: options } }));
        return null; // Return null so callers handle gracefully
      }
    } catch (e) { /* not JSON, fall through */ }
  }

  if (response.status === 401 && url !== '/api/auth/refresh') {
    // If impersonation token expired, end impersonation instead of refreshing
    if (IMPERSONATION_TOKEN) {
      console.warn('Impersonation token expired — ending test mode');
      setImpersonationToken(null);
      sessionStorage.removeItem('inplace_impersonation_user');
      const backup = sessionStorage.getItem('inplace_admin_token_backup');
      sessionStorage.removeItem('inplace_admin_token_backup');
      if (backup) setAuthToken(backup);
      window.location.reload();
      return null;
    }
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
    // v1.97.0 — CSRF header was missing here: once an auth cookie exists (right
    // after login), verifyCsrf 403'd every tracking POST from the native app
    const _csrf = typeof getCsrfToken === 'function' ? getCsrfToken() : null;
    if (_csrf) headers['X-CSRF-Token'] = _csrf;
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

// Subscribe to native push notifications via Capacitor plugin
// Used in native Android/iOS apps where Web Push (PushManager) isn't available
const subscribeNativePush = window.subscribeNativePush = async () => {
  try {
    const PushNotifications = window.Capacitor?.Plugins?.PushNotifications;
    if (!PushNotifications) {
      console.warn('NativePush: Capacitor PushNotifications plugin not available');
      return null;
    }

    // Request permission from OS
    const permResult = await PushNotifications.requestPermissions();
    if (permResult.receive !== 'granted') {
      console.warn('NativePush: permission denied by user');
      return null;
    }

    // Register with FCM (Android) / APNS (iOS)
    // This triggers the 'registration' event with the device token
    return new Promise((resolve) => {
      let resolved = false;

      // Listen for successful registration
      PushNotifications.addListener('registration', async (token) => {
        if (resolved) return;
        resolved = true;
        console.log('NativePush: registered with token', token.value?.substring(0, 20) + '...');

        // Send token to our server
        try {
          const platform = window.Capacitor.getPlatform(); // 'android' or 'ios'
          await apiFetch('/api/push/subscribe-native', {
            method: 'POST',
            body: JSON.stringify({
              token: token.value,
              platform: platform,
            }),
          });
          console.log('NativePush: token saved to server');
        } catch (err) {
          console.error('NativePush: failed to save token to server:', err);
        }

        resolve(token);
      });

      // Listen for registration errors
      PushNotifications.addListener('registrationError', (err) => {
        if (resolved) return;
        resolved = true;
        console.error('NativePush: registration error:', err);
        resolve(null);
      });

      // Also set up notification received/action listeners
      PushNotifications.addListener('pushNotificationReceived', (notification) => {
        console.log('NativePush: notification received in foreground:', notification.title);
        const nData = notification.data || {};
        // Suppress toast if user is already viewing this conversation
        if (nData.type === 'message' && nData.conversationId && window.__activeConversationId === nData.conversationId) {
          console.log('NativePush: suppressed — user is viewing this conversation');
          return;
        }
        // Show in-app toast for foreground notifications
        if (window.useToast) {
          try { window.__showToast?.(notification.title || 'New notification', 'info'); } catch {}
        }
      });

      PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        console.log('NativePush: notification tapped:', action.notification?.title);
        const data = action.notification?.data;
        // v1.97.0 — central router: same deep-link handling as web push and
        // the in-app notification list (page + item focus, e.g. straight to
        // a reimbursement's approve view)
        if (window.__handlePushNavigate) window.__handlePushNavigate(data || {});
        else if (data?.page) window.__navigateTo?.(data.page);
      });

      // Trigger the registration
      PushNotifications.register();

      // Timeout after 15 seconds
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          console.warn('NativePush: registration timed out');
          resolve(null);
        }
      }, 15000);
    });
  } catch (err) {
    console.error('NativePush: error:', err);
    return null;
  }
};

// ─── Native push token refresh handler ───
// FCM/APNS may rotate the device token at any time. This listener catches
// the new token and re-registers it with the server. Should be called once
// on app startup (after login) — separate from the initial subscribe flow.
const initNativeTokenRefresh = window.initNativeTokenRefresh = () => {
  try {
    const PushNotifications = window.Capacitor?.Plugins?.PushNotifications;
    if (!PushNotifications) return;

    // Remove any existing listener to avoid duplicates, then re-add
    PushNotifications.removeAllListeners().then(() => {
      // Re-register the core listeners
      PushNotifications.addListener('registration', async (token) => {
        console.log('NativePush: token refreshed', token.value?.substring(0, 20) + '...');
        try {
          const platform = window.Capacitor.getPlatform();
          await apiFetch('/api/push/subscribe-native', {
            method: 'POST',
            body: JSON.stringify({ token: token.value, platform }),
          });
          console.log('NativePush: refreshed token saved to server');
        } catch (err) {
          console.error('NativePush: failed to save refreshed token:', err);
        }
      });

      PushNotifications.addListener('registrationError', (err) => {
        console.error('NativePush: registration error during refresh:', err);
      });

      PushNotifications.addListener('pushNotificationReceived', (notification) => {
        console.log('NativePush: foreground notification:', notification.title);
        const nData = notification.data || {};
        // Suppress toast if user is already viewing this conversation
        if (nData.type === 'message' && nData.conversationId && window.__activeConversationId === nData.conversationId) return;
        if (window.useToast) {
          try { window.__showToast?.(notification.title || 'New notification', 'info'); } catch {}
        }
      });

      PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        const data = action.notification?.data;
        // v1.97.0 — central router (see above)
        if (window.__handlePushNavigate) window.__handlePushNavigate(data || {});
        else if (data?.page) window.__navigateTo?.(data.page);
      });
    }).catch(() => {});
  } catch (err) {
    console.warn('NativePush: token refresh init error:', err);
  }
};

// Check push subscription health and re-sync if needed
// Call periodically (e.g., every 30 min) to keep subscriptions fresh
// ─── App-icon badge (v1.105.40) ───
//
// Pete: "notification on the app icon when there are unread events that need attention.
// For instance, if Sara needs to approve reimbursements."
//
// A push carries the number down (see sw.js and utils/apns.js), but the thing people
// actually notice is the badge NOT clearing after they've dealt with something. So the app
// re-asks the server whenever it comes to the front, which is exactly when a stale badge
// would be visible and annoying.
//
// ⚠️ v1.105.43 — this used to return early unless navigator.setAppBadge existed, and that
// was the second reason Pete's icon stayed at 78. iOS WKWebView has no Badging API at all,
// so inside the native app this function bailed on its first line: it never called the
// endpoint, so the server never learned the app was open, so the silent badge correction
// added in v1.105.42 never fired. The guard was written for a browser tab, where doing
// nothing is right, and it quietly disabled the one platform that needed it most.
//
// So: ALWAYS ask the server. That call is what triggers the server-side correction for
// native (see routes/push.js syncBadgeToDevices). Only the local setAppBadge — the part
// that genuinely needs the API — is conditional.
const refreshAppBadge = window.refreshAppBadge = async () => {
  try {
    const res = await apiFetch('/api/push/attention');
    if (!res?.ok) return;
    const { total } = await res.json();
    const n = Number(total) || 0;
    // v1.105.54 — the native shell, when the build provides @capacitor/badge. This is the
    // half of the badge fix that has been waiting on a build since v1.105.42: it sets the
    // icon directly on open/resume, instead of depending on a push arriving to correct it.
    const badgePlugin = _capPlugin('Badge');
    if (badgePlugin) {
      try {
        if (n > 0) await badgePlugin.set({ count: n });
        else await badgePlugin.clear();
        return;
      } catch { /* fall through to the web API */ }
    }
    if (typeof navigator === 'undefined' || typeof navigator.setAppBadge !== 'function') return;
    if (n > 0) await navigator.setAppBadge(n);
    else await navigator.clearAppBadge();
  } catch { /* a badge must never be load-bearing */ }
};

// Re-check whenever the app comes back to the front — installed PWA, browser tab, or
// native WebView alike. That is exactly when a stale badge is on screen, and on iOS it is
// the only signal the server gets that the app is open. Registered unconditionally for the
// same reason the guard came out of refreshAppBadge above.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshAppBadge();
  });
  // Capacitor fires 'resume' on the document when the native app returns to the
  // foreground. On iOS this is more reliable than visibilitychange in a WKWebView.
  document.addEventListener('resume', () => { refreshAppBadge(); });
}

const checkPushHealth = window.checkPushHealth = async () => {
  try {
    // ─── v1.105.49 — the native branch, which never existed ───
    //
    // The two guards below are the setAppBadge bug again, twenty lines from the comment
    // warning about it. `PushManager` and `Notification` are both absent in WKWebView, so
    // inside the iOS app this function returned on its first line — every 30 minutes,
    // forever. And it is the ONLY thing that notices the server has no devices for you and
    // re-registers. So an iPhone whose APNs token rotated or got pruned stopped receiving
    // notifications entirely and never recovered, short of a fresh login.
    //
    // Native devices don't have a PushManager subscription to inspect; the check that makes
    // sense for them is "does the server still know about a device for me", and the repair
    // is to re-register the token.
    if (window.Capacitor?.isNativePlatform?.()) {
      if (!AUTH_TOKEN) return;
      const res = await apiFetch('/api/push/status');
      if (!res?.ok) return;
      const status = await res.json();
      if (status.userSubscriptions === 0 && typeof subscribeNativePush === 'function') {
        console.log('Push health: server has no devices for this user — re-registering native token');
        await subscribeNativePush();
      }
      return;
    }

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

// ─── Automatic photo downscaling (v1.104.0, Sentry INPLACE-1) ───
// Phone cameras produce 3–10MB photos; base64 in a JSON body inflates that by
// ~33%, blowing past server body limits (the /api/notes 413s), and raw files
// can exceed multer's 5MB multipart cap. Every photo upload path downscales
// through here automatically so no user ever hits a size wall.
//
// downscaleImage(file, {maxDim, quality}) → Promise<dataURL|null>
//   null = not a downscalable image (non-image, GIF, or decode failure) —
//   caller decides whether to pass the original through or reject.
// downscaleImageFile(file, {maxDim, quality}) → Promise<File>
//   Always resolves: JPEG File when downscaling helps, otherwise the original
//   untouched (never blocks an upload). Safe to map over mixed file lists.
const downscaleImage = window.downscaleImage = (file, opts = {}) => new Promise((resolve) => {
  const { maxDim = 1600, quality = 0.85 } = opts;
  if (!file || !file.type || !file.type.startsWith('image/') || file.type === 'image/gif') {
    return resolve(null); // GIFs skipped — canvas would strip animation
  }
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    URL.revokeObjectURL(url);
    try {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const sc = maxDim / Math.max(width, height);
        width = Math.round(width * sc);
        height = Math.round(height * sc);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    } catch (e) { resolve(null); }
  };
  img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
  img.src = url;
});

const downscaleImageFile = window.downscaleImageFile = async (file, opts = {}) => {
  try {
    const dataUrl = await downscaleImage(file, opts);
    if (!dataUrl) return file;
    const blob = await (await fetch(dataUrl)).blob();
    if (blob.size >= file.size) return file; // already small/optimized — keep original
    const name = (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], name, { type: 'image/jpeg' });
  } catch (e) { return file; }
};
