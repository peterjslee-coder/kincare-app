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
  { id: 'great', emoji: '😀' }, { id: 'good', emoji: '🙂' },
  { id: 'okay', emoji: '😐' }, { id: 'low', emoji: '😕' }, { id: 'poor', emoji: '😟' },
];

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

  const toggle = (id) => setActs((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));

  const save = async () => {
    if (!chosen) { setError('Pick who you visited'); return; }
    if (!summary.trim() && acts.length === 0) {
      setError('Add a note or what you did — otherwise there’s nothing to record');
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
// So: a dismissible CARD, never a modal, never blocking. And it never asks the OS for
// location — if permission isn't already granted it stays silent forever, because
// demanding a new permission for a nudge nobody asked for is exactly nagging.
const VISIT_NUDGE_DISMISS_KEY = 'inplace.visitNudge.dismissedUntil';

const VisitNudgeCard = window.VisitNudgeCard = ({ recipients, alreadyLoggedToday, onLog }) => {
  const [match, setMatch] = useState(null); // { recipient, position }
  const [dismissed, setDismissed] = useState(false);

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
        if (!navigator.geolocation) return;

        // Never trigger a cold OS prompt for this. Only proceed if already granted.
        if (navigator.permissions?.query) {
          try {
            const st = await navigator.permissions.query({ name: 'geolocation' });
            if (st.state !== 'granted') return;
          } catch { return; }
        } else {
          return; // can't tell → assume not granted rather than risk the prompt
        }

        const pos = await new Promise((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (p) => resolve(p), () => resolve(null),
            { enableHighAccuracy: false, timeout: 8000, maximumAge: 120000 }
          );
        });
        if (!pos || cancelled) return;

        // Decide HERE, at full precision. Only a coarsened point is ever sent, and only if
        // the person actually chooses to log.
        const { latitude, longitude } = pos.coords;
        for (const r of withCoords) {
          const ft = haversineFeet(latitude, longitude, r.latitude, r.longitude);
          if (ft <= 1000) {
            if (!cancelled) setMatch({ recipient: r, position: { latitude, longitude } });
            return;
          }
        }
      } catch { /* the nudge is a bonus; it never breaks the dashboard */ }
    };
    run();
    return () => { cancelled = true; };
  }, [recipients, alreadyLoggedToday]);

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
