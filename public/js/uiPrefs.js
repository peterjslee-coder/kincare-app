// ─── Which sections you keep folded up (v1.105.171) ───
//
// Pete: "it should stick, too...if I minimize the reimbursements because i don't really look
// at that...the next time i log in i want it minimized too. if I leave the care notes open
// because I return to that a lot, I want it to remain up."
//
// "The next time I log in" is the requirement, and it is why this is a server-side blob on
// the user rather than localStorage. He uses the phone and the Mac; a preference that only
// exists on the device he set it on is one he has to set twice, and would silently reset
// every time the PWA's storage is cleared.
//
// Ordering matters and it is the whole design: the toggle is INSTANT locally and the save is
// a background detail. Nobody should watch a spinner to fold a section, and a save that fails
// should cost the preference, never the interaction.

const UI_PREFS_ENDPOINT = '/api/auth/me/ui-prefs';

// Seeded from /api/auth/me at login (app.js). A plain object, not state — many components
// read it and none of them need to re-render when another one writes.
window.__uiPrefs = window.__uiPrefs || {};

window.__setUiPrefs = (raw) => {
  let parsed = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch { parsed = {}; }
  }
  window.__uiPrefs = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
};

// ─── Coalesced writes ───
//
// Opening three sections in a row is three taps in about a second. Sending three requests is
// wasteful and, worse, they can land out of order — the server merges per key so the result
// is still correct, but there is no reason to find out. One request, 600ms after the last
// tap, carrying every key that changed.
let pending = {};
let timer = null;

const flush = () => {
  timer = null;
  const patch = pending;
  pending = {};
  if (!Object.keys(patch).length) return;
  try {
    // keepalive: "collapse a section, close the app" must not silently do nothing — the same
    // lesson as the one-tap attention cards in v1.105.129.
    apiFetch(UI_PREFS_ENDPOINT, {
      method: 'PATCH',
      body: JSON.stringify({ patch }),
      keepalive: true,
    }).catch(() => { /* the preference is lost; the fold already happened */ });
  } catch { /* never let a preference break a tap */ }
};

const queue = (key, value) => {
  pending[key] = value;
  if (timer) clearTimeout(timer);
  timer = setTimeout(flush, 600);
};

// Anything still queued when the app goes away goes now.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('pagehide', () => { if (timer) { clearTimeout(timer); flush(); } });
}

/**
 * A section's open/closed state, remembered on the account.
 *
 *   const [open, setOpen] = useStickySection('careTeam.reimbursements', true);
 *
 * `fallback` is what a person who has never touched this section sees, so converting an
 * existing section means passing its current default and nobody notices anything changed.
 */
const useStickySection = window.useStickySection = (key, fallback = true) => {
  const [open, setOpenLocal] = React.useState(() => {
    const v = window.__uiPrefs ? window.__uiPrefs[key] : undefined;
    return typeof v === 'boolean' ? v : fallback;
  });

  // `setOpen(value, { remember: false })` opens or closes the section WITHOUT changing what
  // the account remembers. That is for the app acting on its own — a push notification about
  // a note has to unfold the notes to show it, and silently rewriting his saved preference
  // because he followed a link is not something he asked for. A person's own tap always
  // remembers; the app's does not.
  const setOpen = React.useCallback((next, opts) => {
    const remember = !opts || opts.remember !== false;
    setOpenLocal((prev) => {
      const value = typeof next === 'function' ? next(prev) : next;
      if (value !== prev && remember) {
        window.__uiPrefs[key] = value;
        queue(key, value);
      }
      return value;
    });
  }, [key]);

  return [open, setOpen];
};

window.__flushUiPrefs = flush; // tests, and anything that needs the queue emptied now
