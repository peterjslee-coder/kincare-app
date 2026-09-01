// ─── Family Visit Log (v1.105.38) ───
//
// Pete: "how can i check in with mom… make a care session?" — he couldn't. Check-in belongs
// to the assigned caregiver, and a session with nobody assigned just sits as an open
// request. So the care a family actually gives never reached the record that feeds the
// doctor report and iPAi.
//
// Two pieces here:
//   LogVisitSheet   — the form. Works from anywhere, any time, no location involved.
//   VisitNudgeCard  — the dashboard card when you're already at the house.
//
// The sheet is the feature. The nudge is convenience on top, and everything about it
// degrades to nothing: no permission, denied, no GPS, indoors with no fix — the card simply
// never appears and the button is unaffected.

// Pete's straw man, approved. "Just company" is the one a caregiver-shaped form would leave
// out, and for a son visiting his mother it may be the truest answer available.
const VISIT_ACTIVITIES = window.VISIT_ACTIVITIES = [
  { id: 'meal', label: 'Meal' },
  { id: 'medication_reminder', label: 'Medication reminder' },
  { id: 'errand', label: 'Errand' },
  { id: 'appointment', label: 'Appointment' },
  { id: 'housework', label: 'Housework' },
  { id: 'company', label: 'Just company' },
];

const VISIT_MOODS = [
  { id: 'great', emoji: '😀', label: 'seemed great' }, { id: 'good', emoji: '🙂', label: 'seemed good' },
  { id: 'okay', emoji: '😐', label: 'seemed okay' }, { id: 'low', emoji: '😕', label: 'seemed low' },
  { id: 'poor', emoji: '😟', label: 'seemed poor' },
];

// ─── v1.105.164 — the mood, where it can be read at a glance ───
//
// Pete: "there's no way to see the emoji (sad to happy) on notes and visits. a little emoji
// next to 'family visit' to show would be helpful and not require it to all be expandable."
//
// Every visit has been asked "how did she seem?" since the feature shipped, the answer is
// stored on the row and returned by the API as `moodRating` — and it has never once been
// drawn. The one number in a visit that you can scan a month of at a time was the one thing
// you had to open each visit to see.
//
// Exported rather than duplicated: the family profile and the care team's Care Notes both
// show visits, and a second copy of this map is a second chance for 😐 to mean two things.
const visitMoodEmoji = window.visitMoodEmoji = (id) =>
  (VISIT_MOODS.find((m) => m.id === id) || {}).emoji || null;
const visitMoodLabel = window.visitMoodLabel = (id) =>
  (VISIT_MOODS.find((m) => m.id === id) || {}).label || null;

// `datetime-local` wants the LOCAL wall clock, not an ISO instant.
const toLocalInput = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

const LogVisitSheet = window.LogVisitSheet = ({ recipients, presetRecipientId, position, onClose, onSaved }) => {
  const { showToast } = useToast();
  const list = (recipients || []).map((r) => ({
    id: r.id,
    name: `${r.first_name || r.firstName || ''} ${r.last_name || r.lastName || ''}`.trim() || 'your loved one',
    firstName: r.first_name || r.firstName || 'them',
  }));
  const [chosen, setChosen] = useState(
    presetRecipientId ? list.find((r) => r.id === presetRecipientId) || null : (list.length === 1 ? list[0] : null)
  );
  const [mood, setMood] = useState('good');
  const [acts, setActs] = useState([]);
  const [summary, setSummary] = useState('');
  // Retroactive by design — Pete: "she'll probably write a long screed when she gets home."
  // Backdating is the normal case here, not an edge case.
  const [when, setWhen] = useState(() => toLocalInput(new Date()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // v1.105.74 — Pete, from his phone: "I need to be able to add a picture when I log a visit.
  // There doesn't seem to be a way for me to add a picture when I am just quickly logging a
  // visit." Downscaled on this device before it ever hits the wire — an untouched iPhone photo
  // is 3–5MB and the route caps at 5MB.
  // v1.105.111 — Pete, 40ad8896: the picker should take more than one picture. A visit is
  // often several things worth recording — the fridge, the pill organiser, her in the garden —
  // and one slot forced a choice between them.
  const [photos, setPhotos] = useState([]);      // data URIs, already downscaled
  const [photoBusy, setPhotoBusy] = useState(false);
  const photoInputRef = React.useRef(null);
  const MAX_PHOTOS = 4;                          // mirrors the server's cap

  const pickPhotos = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setPhotoBusy(true);
    setError('');
    const room = MAX_PHOTOS - photos.length;
    const taking = files.slice(0, Math.max(0, room));
    const added = [];
    let failed = 0;
    for (const f of taking) {
      try {
        // Downscaled on THIS device before it ever hits the wire — an untouched iPhone photo
        // is 3–5MB, and four of them would exceed the route's body limit and be rejected by
        // middleware before the handler could explain why. Slightly harder than the
        // single-photo path was, because now there can be four.
        const dataUrl = await downscaleImage(f, { maxDim: 1400, quality: 0.82 });
        if (dataUrl) added.push(dataUrl); else failed++;
      } catch (e) {
        console.error('Visit photo error:', e);
        failed++;
      }
    }
    if (added.length) setPhotos((prev) => [...prev, ...added]);
    // Say what happened to the ones that did NOT make it. Silently dropping a photo someone
    // chose is the same class of quiet failure as a swallowed save.
    if (failed && !added.length) setError('That image could not be read — try another');
    else if (failed) setError(`${failed} of those could not be read — the rest were added`);
    else if (files.length > taking.length) setError(`Up to ${MAX_PHOTOS} photos — the first ${taking.length} were added`);
    setPhotoBusy(false);
    if (photoInputRef.current) photoInputRef.current.value = '';
  };

  const removePhoto = (i) => setPhotos((prev) => prev.filter((_, n) => n !== i));

  const toggle = (id) => setActs((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));

  const save = async () => {
    if (!chosen) { setError('Pick who you visited'); return; }
    // A photo is a record on its own — that was the whole point of the request.
    if (!summary.trim() && acts.length === 0 && photos.length === 0) {
      setError('Add a note, a photo, or what you did — otherwise there’s nothing to record');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body = {
        careRecipientId: chosen.id,
        summary: summary.trim() || null,
        moodRating: mood,
        activities: acts,
        visitedAt: new Date(when).toISOString(),
        loggedVia: position ? 'geo_prompt' : 'manual',
      };
      // Only sent when the nudge supplied it. The server coarsens before storing, and the
      // geofence decision was already made on this device at full precision.
      if (position) { body.latitude = position.latitude; body.longitude = position.longitude; }
      // `photos` is the list; `photo` stays populated with the first so a server that has
      // not been redeployed yet still records something rather than nothing.
      if (photos.length) { body.photos = photos; body.photo = photos[0]; }

      const res = await apiFetch('/api/family-visits', { method: 'POST', body: JSON.stringify(body) });
      if (res?.ok) {
        showToast('Visit logged', 'success');
        if (onSaved) onSaved();
        onClose();
      } else {
        const d = await res?.json().catch(() => ({}));
        setError((d && d.error) || 'That didn’t save — please try again');
      }
    } catch (e) {
      console.error('Log visit error:', e);
      setError('That didn’t save — check your connection and try again');
    }
    setSaving(false);
  };

  const label = { display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', margin: '14px 0 6px' };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000,
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{
        width: '100%', maxWidth: 460, maxHeight: '92vh', overflowY: 'auto',
        borderRadius: '16px 16px 0 0', margin: 0,
        paddingBottom: 'max(16px, env(safe-area-inset-bottom))',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 2 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>
            {chosen ? `Time with ${chosen.firstName}` : 'Log a visit'}
          </h3>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: 20, color: 'var(--text-muted)', cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        <p style={{ margin: 0, fontSize: 11.5, color: 'var(--text-muted)' }}>Only your care team sees this.</p>

        {list.length > 1 && (
          <>
            <label style={label}>Who did you visit?</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {list.map((r) => (
                <button key={r.id} onClick={() => setChosen(r)} style={{
                  padding: '6px 12px', borderRadius: 16, fontSize: 13, cursor: 'pointer',
                  border: `1px solid ${chosen?.id === r.id ? 'var(--role-color)' : 'var(--border-light)'}`,
                  background: chosen?.id === r.id ? 'var(--role-color)' : 'var(--bg-card)',
                  color: chosen?.id === r.id ? 'var(--text-on-primary)' : 'var(--text-secondary)',
                  fontWeight: chosen?.id === r.id ? 700 : 400,
                }}>{r.name}</button>
              ))}
            </div>
          </>
        )}

        <label style={label} htmlFor="fv-when">When</label>
        <input id="fv-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)}
          style={{ width: '100%', padding: '9px 11px', border: '1px solid var(--border-light)', borderRadius: 9, fontSize: 13, background: 'var(--bg-card)', color: 'var(--text-primary)' }} />

        <label style={label}>How did {chosen ? chosen.firstName : 'they'} seem?</label>
        <div style={{ display: 'flex', gap: 6 }}>
          {VISIT_MOODS.map((m) => (
            <button key={m.id} onClick={() => setMood(m.id)} aria-label={m.id}
              aria-pressed={mood === m.id}
              style={{
                flex: 1, padding: '8px 0', fontSize: 18, cursor: 'pointer', borderRadius: 9,
                border: `1px solid ${mood === m.id ? 'var(--role-color)' : 'var(--border-light)'}`,
                background: mood === m.id ? 'var(--color-success-bg)' : 'var(--bg-card)',
              }}>{m.emoji}</button>
          ))}
        </div>

        <label style={label}>What did you do? <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span></label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {VISIT_ACTIVITIES.map((a) => (
            <button key={a.id} onClick={() => toggle(a.id)} aria-pressed={acts.includes(a.id)} style={{
              padding: '6px 11px', borderRadius: 16, fontSize: 12.5, cursor: 'pointer',
              border: `1px solid ${acts.includes(a.id) ? 'var(--role-color)' : 'var(--border-light)'}`,
              background: acts.includes(a.id) ? 'var(--role-color)' : 'var(--bg-card)',
              color: acts.includes(a.id) ? 'var(--text-on-primary)' : 'var(--text-secondary)',
              fontWeight: acts.includes(a.id) ? 650 : 400,
            }}>{a.label}</button>
          ))}
        </div>

        <label style={label} htmlFor="fv-note">Anything worth remembering?</label>
        <textarea id="fv-note" value={summary} onChange={(e) => setSummary(e.target.value)}
          placeholder="How they seemed, what you talked about, anything the team should know…"
          style={{ width: '100%', minHeight: 84, padding: 10, border: '1px solid var(--border-light)', borderRadius: 9, fontSize: 13, resize: 'vertical', background: 'var(--bg-card)', color: 'var(--text-primary)' }} />

        {/* v1.105.74 — `capture` is deliberately NOT set: it would force the camera and Pete's
            case is often a picture already in the roll. Both sources stay available.
            v1.105.111 — and now more than one of them (40ad8896). */}
        <label style={label}>
          Photos (optional){photos.length > 0 ? ` — ${photos.length} of ${MAX_PHOTOS}` : ''}
        </label>

        {photos.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(88px, 100%), 1fr))', gap: 6, marginBottom: 6 }}>
            {photos.map((p, i) => (
              <div key={i} style={{ position: 'relative' }}>
                <img src={p} alt={`Attached to this visit (${i + 1} of ${photos.length})`}
                  style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', borderRadius: 9, border: '1px solid var(--border-light)', display: 'block' }} />
                <button onClick={() => removePhoto(i)} aria-label={`Remove photo ${i + 1}`} style={{
                  position: 'absolute', top: 4, right: 4, width: 26, height: 26, borderRadius: '50%',
                  border: 'none', background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 13, cursor: 'pointer', lineHeight: 1,
                }}>{'\u2715'}</button>
              </div>
            ))}
          </div>
        )}

        {photos.length < MAX_PHOTOS && (
          <button onClick={() => photoInputRef.current && photoInputRef.current.click()} disabled={photoBusy} style={{
            width: '100%', padding: '11px', borderRadius: 9, fontSize: 13, fontWeight: 600,
            border: '1px dashed var(--border-light)', background: 'var(--bg-card)',
            color: photoBusy ? 'var(--text-tertiary)' : 'var(--text-secondary)',
            cursor: photoBusy ? 'default' : 'pointer',
          }}>{photoBusy
            ? 'Preparing photos\u2026'
            : photos.length ? '\uD83D\uDCF7  Add another' : '\uD83D\uDCF7  Add photos'}</button>
        )}
        <input ref={photoInputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple
          style={{ display: 'none' }}
          onChange={(e) => pickPhotos(e.target.files)} />

        {error && (
          <div role="alert" style={{ marginTop: 10, fontSize: 13, color: 'var(--color-error)', background: 'var(--bg-error-light)', border: '1px solid var(--color-error)', borderRadius: 8, padding: '8px 12px' }}>{error}</div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button onClick={save} disabled={saving} style={{
            flex: 1, padding: '11px', background: 'var(--role-color)', color: 'var(--text-on-primary)',
            border: 'none', borderRadius: 9, fontSize: 14, fontWeight: 700, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1,
          }}>{saving ? 'Saving…' : 'Save'}</button>
          <button onClick={onClose} style={{
            padding: '11px 18px', background: 'var(--bg-card)', color: 'var(--text-secondary)',
            border: '1px solid var(--border-light)', borderRadius: 9, fontSize: 14, cursor: 'pointer',
          }}>Cancel</button>
        </div>
      </div>
    </div>
  );
};

// ─── The nudge ───
//
// Pete: "we're assuming if I'm at Betty's house that she's there, i have something to say
// or observe, and we're nudging here, not nagging."
//
// So: a dismissible CARD, never a modal, never blocking, and never a location prompt the
// person didn't ask for.
//
// ─── v1.105.45 — why this never fired on an iPhone ───
//
// The original gate was `navigator.permissions.query({ name: 'geolocation' })`, and it
// returned if that wasn't available. WebKit doesn't implement the Permissions API for
// geolocation — Safari and WKWebView either lack navigator.permissions or reject that
// specific query — so on iOS this bailed on its third line, and the feature has never once
// run there. Same shape as the setAppBadge bug in v1.105.43: a capability check written
// against Chrome that silently disables a feature on the only platform that has the
// hardware for it.
//
// The instinct behind the gate was right — a cold OS location prompt for a nudge nobody
// asked for IS nagging. So the fix isn't to drop it, it's to replace a check we cannot
// perform with a decision the person makes on purpose: an explicit, one-time opt-in. After
// that, the grant is remembered on this device. Before it, the invite is a card you can
// decline forever, and no prompt is ever raised.
const VISIT_NUDGE_DISMISS_KEY = 'inplace.visitNudge.dismissedUntil';
const VISIT_GEO_OPTIN_KEY = 'inplace.visitNudge.optIn';         // '1' once they say yes
const VISIT_GEO_INVITE_KEY = 'inplace.visitNudge.inviteHidden'; // '1' once they say no
// v1.105.59 — the last distance we measured, so "is this on, and how far am I?" has an
// answer that survives a re-render and a reopen. Device-only; never sent anywhere.
const VISIT_GEO_LAST_KEY = 'inplace.visitNudge.lastCheck';      // { ft, name, at }

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

const prettyFeet = (ft) => (ft > 5280 ? `${(ft / 5280).toFixed(1)} miles` : `${ft} ft`);

const recordLastCheck = (ft, name) => {
  lsSet(VISIT_GEO_LAST_KEY, JSON.stringify({ ft, name, at: Date.now() }));
};

const readLastCheck = () => {
  try {
    const v = JSON.parse(lsGet(VISIT_GEO_LAST_KEY) || 'null');
    return v && Number.isFinite(v.ft) ? v : null;
  } catch { return null; }
};

// Can we read the person's location without springing a prompt on them?
// Opt-in wins — they asked for this, on this device. Otherwise ask the Permissions API
// where it genuinely works. Never assume.
const visitGeoAllowed = window.__visitGeoAllowed = async () => {
  if (lsGet(VISIT_GEO_OPTIN_KEY) === '1') return true;
  if (navigator.permissions?.query) {
    try {
      const st = await navigator.permissions.query({ name: 'geolocation' });
      return st.state === 'granted';
    } catch { return false; } // WebKit rejects 'geolocation' — the opt-in covers it
  }
  return false;
};

// ─── Asking the phone where it is ───
//
// Three wrong causes for one failure before the code was made to report itself. The answer
// came back as `web:ceiling:timeout → watch:ceiling:timeout in 42s` — our own outer
// deadline both times, meaning NEITHER callback ever fired. Not denied, not failed: the
// browser Geolocation API is a stub in Capacitor's WKWebView without @capacitor/geolocation.
//
// v1.105.54 — the acquisition logic moved to getDeviceLocation() in utils.js, because
// caregiver check-in and check-out were calling the same dead API and had the same problem
// invisibly. What stays here is what is specific to this card: the wording, and showing
// the diagnostic.
const GEO_MESSAGES = {
  denied: "iOS is blocking location for InPlace. Turn it on in Settings › Privacy › Location Services › InPlace › While Using, then tap again.",
  timeout: "Your phone didn't answer with a location. This looks like the app itself rather than your phone or your signal — I've logged the details.",
  unavailable: "Your phone couldn't work out where it is right now. Tap to try again.",
  unsupported: "This device can't share its location with InPlace.",
  unknown: "Couldn't get a location fix. Tap to try again.",
};

const getPosition = () => getDeviceLocation({ timeoutMs: 20000 });

// ─── The invite ───
// Shown only when there is somewhere to be near, we have no permission we can act on, and
// they haven't already said no. Tapping "Yes" is what raises the OS prompt — user-initiated,
// which is the whole difference between asking and nagging.
//
// It also answers the question Pete would otherwise have to guess at: it reports the
// distance once, so "is this thing even working?" has an answer that isn't "stand in the
// kitchen and hope". That number is computed on the device and never sent anywhere.
const VisitGeoInvite = ({ recipients, onEnabled }) => {
  const [hidden, setHidden] = useState(() => lsGet(VISIT_GEO_INVITE_KEY) === '1');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { ok, text }

  const withCoords = (recipients || []).filter((r) => r.latitude != null && r.longitude != null);
  if (hidden || !withCoords.length || !canAskLocation()) return null;

  const nameOf = (r) => r.first_name || r.firstName || 'them';

  const enable = async () => {
    setBusy(true);
    const { pos, reason, tried, elapsedMs, detail } = await getPosition();
    setBusy(false);
    if (!pos) {
      // v1.105.53 — I have now guessed at this failure twice and been wrong twice. So it
      // reports itself: which stage was tried, what each one answered, and how long it took.
      // Shown to the person (small, muted — they can read it to me) and sent to Sentry.
      const diag = `${(tried || []).join(' → ')} in ${Math.round((elapsedMs || 0) / 100) / 10}s${detail ? ` — ${detail}` : ''}`;
      try {
        reportClientError(new Error(`[geo] ${reason}: ${diag}`), {
          page: 'visit-geo-optin',
          standalone: !!window.Capacitor?.isNativePlatform?.(),
        });
      } catch {}
      setResult({ ok: false, text: GEO_MESSAGES[reason] || GEO_MESSAGES.unknown, diag });
      return;
    }
    lsSet(VISIT_GEO_OPTIN_KEY, '1');
    const { latitude, longitude } = pos.coords;
    let best = null;
    for (const r of withCoords) {
      const ft = haversineFeet(latitude, longitude, r.latitude, r.longitude);
      if (!best || ft < best.ft) best = { ft, r };
    }
    recordLastCheck(best.ft, nameOf(best.r));
    setResult({
      ok: true,
      text: best.ft <= 1000
        ? `You're about ${best.ft} ft from ${nameOf(best.r)}'s — close enough. The nudge will offer to log a visit.`
        : `Saved. You're ${prettyFeet(best.ft)} from ${nameOf(best.r)}'s right now, so no nudge — it appears within 1,000 ft.`,
    });
    // v1.105.59 — Pete, 8/11: "there was no 'ok, I'll ask you next time' toast."
    //
    // There WAS one — for about one frame. onEnabled() bumps `retry` in the parent, the
    // effect re-runs, visitGeoAllowed() is now true, so the parent stops rendering this
    // card and (with no match, because he was three days early) renders null. The
    // confirmation destroyed itself the instant it was set.
    //
    // So: hand off to the parent only when the handoff is to something the person can
    // SEE — the nudge card, i.e. when we're actually in range. Out of range, this card
    // stays put with the distance on it, and VisitGeoStatus carries the number afterwards.
    if (onEnabled && best.ft <= 1000) onEnabled();
  };

  return (
    <div className="card" style={{ border: '1px solid var(--border-light)', marginBottom: 12 }}>
      <div style={{ fontWeight: 700, fontSize: 14.5, marginBottom: 3 }}>
        Notice when you're at {nameOf(withCoords[0])}'s?
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
        When you open InPlace at the house, it can offer to log a visit. It checks only while
        the app is open — never in the background. Your location is worked out on this phone,
        and nothing is sent unless you choose to log something.
      </div>
      {result && (
        <div style={{ fontSize: 12.5, marginTop: 9, color: result.ok ? 'var(--text-primary)' : 'var(--color-error)' }}>
          {result.text}
          {result.diag && (
            <div style={{ fontSize: 11, marginTop: 5, color: 'var(--text-tertiary)', fontFamily: 'ui-monospace, monospace' }}>
              {result.diag}
            </div>
          )}
        </div>
      )}
      {!result?.ok && (
        <div style={{ display: 'flex', gap: 8, marginTop: 11, flexWrap: 'wrap' }}>
          <button onClick={enable} disabled={busy} style={{
            padding: '9px 15px', background: 'var(--role-color)', color: 'var(--text-on-primary)',
            border: 'none', borderRadius: 9, fontSize: 13, fontWeight: 650,
            cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
          }}>{busy ? 'Checking…' : 'Yes, notice'}</button>
          <button onClick={() => { setHidden(true); lsSet(VISIT_GEO_INVITE_KEY, '1'); }} style={{
            padding: '9px 15px', background: 'var(--bg-card)', color: 'var(--text-secondary)',
            border: '1px solid var(--border-light)', borderRadius: 9, fontSize: 13, cursor: 'pointer',
          }}>No thanks</button>
        </div>
      )}
    </div>
  );
};

// ─── The quiet status line (v1.105.59) ───
//
// Pete, 8/11: "Best I can tell there's no way to know how far I am from Betty's (not that
// I want to be pushed that info often)."
//
// Exactly right on both halves — so this is one muted line, no colour, no card chrome, and
// it never pushes anything. It shows what the last check found and offers to redo it on
// demand. It also says out loud that the check happens on open, which is the honest
// description of what this feature is.
// v1.105.148 — "It says last check I was 2.3 miles away, but I don't know when that was."
// The timestamp was being STORED all along (recordLastCheck writes `at`) and never shown, so a
// reading from three days ago and one from ten seconds ago looked identical.
const agoLabel = (ts) => {
  // No timestamp is not "a long time ago" — it is "we do not know". Number(null) is 0, which
  // would have dated a reading to 1970 and printed "20695 days ago" with total confidence.
  // Caught by its own test; the line falls back to "at last check" when this returns null.
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = Date.now() - n;
  if (ms < 0) return null;
  const mins = Math.round(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
};

const VisitGeoStatus = ({ recipients }) => {
  const [last, setLast] = useState(readLastCheck);
  const [busy, setBusy] = useState(false);
  const [pinState, setPinState] = useState('idle'); // idle → confirming → saving → done/failed
  const [pinNote, setPinNote] = useState(null);

  // Admin-only (v1.105.169). Not a diagnostic readout this time — Pete asked to keep seeing
  // it while the distance is wrong and for nobody else to. Hooks are all above this line;
  // an early return that sits between them is the "late hooks" lint failure.
  const adminOnly = !!(window.__isAdmin);

  const withCoords = (recipients || []).filter((r) => r.latitude != null && r.longitude != null);
  if (!adminOnly) return null;
  if (!withCoords.length) return null;

  const nameOf = (r) => r.first_name || r.firstName || 'them';

  const nearestTo = (latitude, longitude) => {
    let best = null;
    for (const r of withCoords) {
      const ft = haversineFeet(latitude, longitude, r.latitude, r.longitude);
      if (!best || ft < best.ft) best = { ft, r };
    }
    return best;
  };

  const recheck = async () => {
    setBusy(true);
    const { pos } = await getPosition();
    setBusy(false);
    if (!pos) return;
    const { latitude, longitude } = pos.coords;
    const best = nearestTo(latitude, longitude);
    recordLastCheck(best.ft, nameOf(best.r));
    setLast(readLastCheck());
  };

  // ─── v1.105.148 — when the house is pinned in the wrong place ───
  //
  // Pete: "I'm definitely inside of 1000 feet from her house, I've hit check now and it's
  // tagged my location… but it still doesn't say that I'm at her location."
  //
  // Every fix so far has assumed the phone was wrong. The other half of the subtraction is the
  // HOME point, and it comes from geocoding an address — which can land on a street centroid,
  // a ZIP centroid, or the wrong side of a rural road, and then no amount of GPS accuracy will
  // ever close the gap. A stable, confident 2.3 miles while standing in the kitchen is that
  // shape of wrong.
  //
  // So: if you are AT the house, say so and the house moves to where you are. Full precision,
  // deliberately — this is care_recipients.latitude, the same field the address geocoder
  // writes, on a record this family owns.
  const pinHere = async () => {
    setPinState('saving');
    setPinNote(null);
    const { pos } = await getPosition();
    if (!pos) { setPinState('idle'); setPinNote("Couldn't read your location."); return; }
    const { latitude, longitude } = pos.coords;
    const target = nearestTo(latitude, longitude)?.r;
    if (!target) { setPinState('idle'); return; }
    try {
      const res = await apiFetch(`/api/care-recipients/${target.id}`, {
        method: 'PUT', body: JSON.stringify({ latitude, longitude }),
      });
      if (res?.ok) {
        recordLastCheck(0, nameOf(target));
        setLast(readLastCheck());
        setPinState('done');
        setPinNote(`Saved. ${nameOf(target)}'s home is where you are now.`);
      } else {
        const d = await res.json().catch(() => ({}));
        setPinState('idle');
        setPinNote(d.error || "Couldn't save that.");
      }
    } catch {
      setPinState('idle');
      setPinNote("Couldn't save that.");
    }
  };

  const when = last ? agoLabel(last.at) : null;
  const looksWrong = last && last.ft > 1000 && pinState !== 'done';

  // ─── v1.105.169 — one line, and only mine ───
  //
  // Pete: "the header about checking in at Betty's. It's not working, takes up critical
  // space. make it one line. and make it just for me. no one else should see it. it's
  // distracting."
  //
  // Two separate asks, and the second one is the important one. This line explains a
  // feature that does not yet do what it says — the 2.3-miles-in-the-kitchen bug is still
  // open — and a broken explanation on every family member's dashboard is worse than no
  // explanation. It stays for the person debugging it and disappears for everyone else.
  // When the distance is right, this comes back out from behind the gate.
  //
  // It cost three lines: the distance, then the sentence explaining when the nudge fires,
  // then "Standing at the house and this looks wrong? Pin it here". The explanation goes
  // (it was answering a question nobody had asked twice), and the pin becomes a word.
  const row = {
    display: 'flex', alignItems: 'baseline', gap: 6,
    fontSize: 11.5, color: 'var(--text-tertiary)', marginBottom: 10, lineHeight: 1.5,
  };
  // The guarantee, rather than the hope: the text is what gives way on a narrow screen, and
  // the actions never do — an ellipsised "check now" is a line that is one line and useless.
  const text = { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
  const link = (colour) => ({
    flexShrink: 0, background: 'none', border: 'none', padding: 0, font: 'inherit',
    color: colour, textDecoration: 'underline', cursor: 'pointer', whiteSpace: 'nowrap',
  });

  // A note replaces the line instead of being added under it, or "one line" lasts until the
  // first time anything happens.
  if (pinNote) {
    return (
      <div style={row}>
        <span style={text}>{pinNote}</span>
        <button onClick={() => { setPinNote(null); setPinState('idle'); }} style={link('var(--text-secondary)')}>ok</button>
      </div>
    );
  }

  if (pinState === 'confirming') {
    return (
      <div style={row}>
        <span style={text}>Standing at {last ? `${last.name}'s` : 'the house'} right now?</span>
        <button onClick={pinHere} style={{ ...link('var(--accent-color)'), fontWeight: 700 }}>yes, pin it</button>
        <button onClick={() => setPinState('idle')} style={link('var(--text-tertiary)')}>cancel</button>
      </div>
    );
  }

  return (
    <div style={row}>
      <span style={text}>
        {last
          ? `${prettyFeet(last.ft)} from ${last.name}'s${when ? ` · ${when}` : ''}`
          : 'Distance not checked yet'}
      </span>
      <button onClick={recheck} disabled={busy} style={{ ...link('var(--text-secondary)'), cursor: busy ? 'default' : 'pointer' }}>
        {busy ? 'checking…' : 'check now'}
      </button>
      {looksWrong && (
        <button onClick={() => setPinState('confirming')} disabled={pinState === 'saving'} style={link('var(--text-secondary)')}>
          {pinState === 'saving' ? 'saving…' : 'pin here'}
        </button>
      )}
    </div>
  );
};

const VisitNudgeCard = window.VisitNudgeCard = ({ recipients, alreadyLoggedToday, onLog }) => {
  const [match, setMatch] = useState(null); // { recipient, position }
  const [dismissed, setDismissed] = useState(false);
  const [allowed, setAllowed] = useState(null); // null = still deciding
  const [retry, setRetry] = useState(0);        // bumped when the opt-in is accepted

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        if (alreadyLoggedToday) return;
        // Storage throws in private mode and locked-down webviews — see v1.105.35.
        try {
          const until = parseInt(localStorage.getItem(VISIT_NUDGE_DISMISS_KEY) || '0', 10);
          if (until && Date.now() < until) return;
        } catch {}

        const withCoords = (recipients || []).filter((r) => r.latitude != null && r.longitude != null);
        if (withCoords.length === 0) return;
        if (!canAskLocation()) return;

        // Never trigger a cold OS prompt for this. Proceed only on an explicit opt-in, or a
        // permission the browser will actually tell us about. See visitGeoAllowed.
        const ok = await visitGeoAllowed();
        if (!cancelled) setAllowed(ok);
        if (!ok || cancelled) return;

        const { pos } = await getPosition();
        if (!pos || cancelled) return;

        // Decide HERE, at full precision. Only a coarsened point is ever sent, and only if
        // the person actually chooses to log.
        const { latitude, longitude } = pos.coords;
        let best = null;
        for (const r of withCoords) {
          const ft = haversineFeet(latitude, longitude, r.latitude, r.longitude);
          if (!best || ft < best.ft) best = { ft, r };
        }
        // v1.105.59 — record it every time, so the status line is current rather than
        // frozen at whatever the opt-in happened to measure.
        if (best) recordLastCheck(best.ft, best.r.first_name || best.r.firstName || 'them');
        if (best && best.ft <= 1000) {
          if (!cancelled) setMatch({ recipient: best.r, position: { latitude, longitude } });
        }
      } catch { /* the nudge is a bonus; it never breaks the dashboard */ }
    };
    run();
    return () => { cancelled = true; };
  }, [recipients, alreadyLoggedToday, retry]);

  // No usable permission yet → offer the opt-in instead of silently doing nothing. This is
  // the branch iOS has always landed in; before v1.105.45 it rendered nothing, and there was
  // no way to tell the feature apart from a broken one.
  if (allowed === false && !alreadyLoggedToday) {
    return <VisitGeoInvite recipients={recipients} onEnabled={() => setRetry((n) => n + 1)} />;
  }

  // v1.105.59 — opted in, but not near the house (or dismissed). This used to be `null`:
  // the feature was on and looked identical to the feature being broken, which is the
  // whole complaint. One muted line instead.
  if (allowed === true && (!match || dismissed) && !alreadyLoggedToday) {
    return <VisitGeoStatus recipients={recipients} />;
  }

  if (!match || dismissed) return null;
  const first = match.recipient.first_name || match.recipient.firstName || 'them';

  return (
    <div className="card" style={{ border: '1.5px solid var(--role-color)', background: 'var(--color-success-bg)', marginBottom: 12, position: 'relative' }}>
      <button onClick={() => {
        setDismissed(true);
        // Six hours, not forever — you might log on the way out instead.
        try { localStorage.setItem(VISIT_NUDGE_DISMISS_KEY, String(Date.now() + 6 * 3600 * 1000)); } catch {}
      }} aria-label="Dismiss" style={{ position: 'absolute', top: 8, right: 10, background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 16, cursor: 'pointer', lineHeight: 1 }}>✕</button>
      <div style={{ fontWeight: 700, fontSize: 14.5, marginBottom: 2, paddingRight: 22 }}>Looks like you're with {first}</div>
      <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>Want to note how they're doing? Takes a few seconds.</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 11, flexWrap: 'wrap' }}>
        <button onClick={() => onLog(match.recipient.id, match.position)} style={{
          padding: '9px 15px', background: 'var(--role-color)', color: 'var(--text-on-primary)',
          border: 'none', borderRadius: 9, fontSize: 13, fontWeight: 650, cursor: 'pointer',
        }}>Log this visit</button>
        <button onClick={() => {
          setDismissed(true);
          try { localStorage.setItem(VISIT_NUDGE_DISMISS_KEY, String(Date.now() + 6 * 3600 * 1000)); } catch {}
        }} style={{
          padding: '9px 15px', background: 'var(--bg-card)', color: 'var(--text-secondary)',
          border: '1px solid var(--border-light)', borderRadius: 9, fontSize: 13, cursor: 'pointer',
        }}>Not now</button>
      </div>
    </div>
  );
};

// Client-side twin of geofenceEvidence() in src/utils/geocode.js. Deliberately duplicated
// rather than round-tripped: the whole point is that the decision happens on the device and
// the precise position never leaves it.
function haversineFeet(lat1, lng1, lat2, lng2) {
  const R = 3958.8; // miles
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)) * 5280);
}
window.__visitHaversineFeet = haversineFeet;
