// ─── The care recipient's own phone (v1.129.4) ───
//
// Pete, 11/17, holding Betty's phone for one night: "I want to put inplace on her phone for her
// to be able to use. preferably while in accessibility mode."
//
// OwnLoginSetup — the team leader gives the person they care for a sign-in of their own,
// linked to the profile the family already built. An email and a password the leader picks,
// typed into the recipient's phone. No invite email to fish out, no registration wizard.

const OwnLoginSetup = window.OwnLoginSetup = ({ recipientId, firstName, onDone }) => {
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(null);
  const name = firstName || 'them';

  const pwOk = password.length >= 8 && /[A-Z]/.test(password) && /[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password);

  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !pwOk) return;
    setSaving(true);
    try {
      const res = await apiFetch(`/api/care-recipients/${recipientId}/own-login`, {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res?.json().catch(() => ({}));
      if (res?.ok) {
        setDone({ email: data.email || email.trim() });
        setPassword('');
        showToast(`${name}'s sign-in is ready`, 'success');
      } else {
        showToast(data?.error || 'Could not set up the sign-in', 'error');
      }
    } catch { showToast('Could not set up the sign-in', 'error'); }
    setSaving(false);
  };

  const box = { marginBottom: 20, paddingBottom: 20, borderBottom: '1px solid var(--border-light, #f0f0f0)' };
  const input = { width: '100%', padding: '10px 12px', border: '1px solid #d0d0d0', borderRadius: 8, fontSize: 15, fontFamily: 'inherit', boxSizing: 'border-box' };

  if (done) {
    return (
      <div style={box}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--role-color)', marginBottom: 6 }}>{name}'s own sign-in is ready</div>
        <ol style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 12px', paddingLeft: 18, lineHeight: 1.6 }}>
          <li>On {name}'s phone, open InPlace and sign in as <strong>{done.email}</strong> with the password you chose. Leave "Remember me" on.</li>
          <li>Tap <strong>Allow</strong> when the phone asks about notifications.</li>
          <li>{name} sees care once an ID is approved, or once an admin marks the ID as seen in person.</li>
        </ol>
        <button onClick={() => onDone && onDone()} style={{ padding: '8px 16px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
          Done
        </button>
      </div>
    );
  }

  return (
    <div style={box}>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--role-color)', marginBottom: 6 }}>{name}'s own sign-in</div>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 12px', lineHeight: 1.5 }}>
        Put InPlace on {name}'s phone. You choose the email and password, and the sign-in opens {name}'s own view of this profile. It can't book care or spend money.
      </p>
      {!open ? (
        <button onClick={() => setOpen(true)} style={{ padding: '10px 18px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
          Set up {name}'s sign-in
        </button>
      ) : (
        <form onSubmit={submit}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Email for {name}'s account</label>
          <input type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="an address you can open" style={{ ...input, marginBottom: 10 }} />
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Password</label>
          <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
            <input type={showPw ? 'text' : 'password'} autoComplete="new-password" value={password}
              onChange={(e) => setPassword(e.target.value)} style={{ ...input, flex: 1 }} />
            <button type="button" onClick={() => setShowPw(!showPw)} style={{ padding: '0 12px', background: 'var(--bg-surface)', border: '1px solid #d0d0d0', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>
              {showPw ? 'Hide' : 'Show'}
            </button>
          </div>
          <div style={{ fontSize: 12, color: pwOk || !password ? 'var(--text-muted)' : 'var(--accent-color)', marginBottom: 12 }}>
            8 or more characters, with an uppercase letter, a number and a symbol.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" disabled={saving || !email.trim() || !pwOk} style={{ padding: '10px 18px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer', opacity: (saving || !email.trim() || !pwOk) ? 0.6 : 1 }}>
              {saving ? 'Setting up…' : 'Create sign-in'}
            </button>
            <button type="button" onClick={() => setOpen(false)} style={{ padding: '10px 18px', background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid #d0d0d0', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

// ─── v1.130.0 — the simple phone screen ───
//
// Pete, 11/17: "simple, accessibility mode accessed things like 'call peter' and reminders that
// appointments are coming up, or notes from me on app like 'I will be there at 10. Stay in the
// house'." It runs inside Apple's Assistive Access frame on the person's own iPhone, so it is
// one screen, very large type, no navigation, nothing to get lost in.
//
// SimpleModeSettings — the leader's side (Care Team → Accessibility Options).
// SimpleView        — the person's side.

const simpleFmtTime = (t) => {
  if (!t) return '';
  const [h, m] = String(t).split(':').map(Number);
  if (!Number.isFinite(h)) return '';
  const ap = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m || 0).padStart(2, '0')} ${ap}`;
};

// Care-location dates are naive YYYY-MM-DD strings; compare them as calendar days.
const simpleFmtDay = (dateStr) => {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  const t = new Date(); t.setHours(12, 0, 0, 0);
  const diff = Math.round((d - t) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff > 1 && diff < 7) return d.toLocaleDateString('en-US', { weekday: 'long' });
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
};

const simpleAgo = (iso) => {
  if (!iso) return '';
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} minutes ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return hrs === 1 ? '1 hour ago' : `${hrs} hours ago`;
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
};

const SimpleView = window.SimpleView = ({ initial }) => {
  const [data, setData] = useState(initial || null);
  const [loading, setLoading] = useState(!initial);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(new Date());

  const load = React.useCallback(async () => {
    try {
      const res = await apiFetch('/api/dashboard');
      if (res?.ok) { setData(await res.json()); setFailed(false); }
      else setFailed(true);
    } catch { setFailed(true); }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!initial) load();
    // A phone left on the kitchen counter: refresh every minute, and the moment it is picked up.
    const iv = setInterval(() => { setNow(new Date()); load(); }, 60000);
    const onVis = () => { if (document.visibilityState === 'visible') { setNow(new Date()); load(); } };
    document.addEventListener('visibilitychange', onVis);
    let off = null;
    if (typeof onSocketEvent === 'function') off = onSocketEvent('activity_update', () => load());
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVis); if (off) off(); };
  }, []);

  const page = { minHeight: '100vh', background: 'var(--bg-surface)', padding: '20px 16px 32px', boxSizing: 'border-box', maxWidth: 560, margin: '0 auto' };
  const card = { background: 'var(--bg-card)', borderRadius: 20, padding: '20px', marginBottom: 18, border: '2px solid var(--border-color)' };
  const label = { fontSize: 20, fontWeight: 700, color: 'var(--text-secondary)', margin: '0 0 10px' };

  if (loading) return <div style={{ ...page, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, color: 'var(--text-secondary)' }}>One moment…</div>;

  const s = data?.simpleScreen || {};
  const first = (data?.userName || '').split(' ')[0];
  const hour = now.getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const calls = s.callContacts || [];
  const coming = s.comingUp || [];
  const note = s.noteForYou;

  const comingLine = (c) => {
    const when = `${simpleFmtDay(c.date)}${c.time ? ` at ${simpleFmtTime(c.time)}` : ''}`;
    if (c.kind === 'visit') {
      if (c.inProgress) return { big: `${c.who || 'Your caregiver'} is here now`, small: null };
      return { big: `${c.who || 'A caregiver'} comes ${when}`, small: null };
    }
    return { big: c.title, small: `${when}${c.location ? ` · ${c.location}` : ''}` };
  };

  return (
    <div style={page} className="simple-view">
      <div style={{ fontSize: 34, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.15 }}>{greet}{first ? `, ${first}` : ''}</div>
      <div style={{ fontSize: 24, color: 'var(--text-secondary)', margin: '6px 0 22px', lineHeight: 1.3 }}>
        {now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        <br />{now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
      </div>

      {failed && (
        <div style={{ ...card, fontSize: 22, color: 'var(--text-primary)' }}>Can't reach InPlace right now. It will try again by itself.</div>
      )}

      {note && (
        <div style={{ ...card, borderColor: 'var(--role-color)', borderWidth: 3 }}>
          <div style={label}>From {note.from}</div>
          <div style={{ fontSize: 30, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{note.content}</div>
          <div style={{ fontSize: 18, color: 'var(--text-secondary)', marginTop: 10 }}>{simpleAgo(note.createdAt)}</div>
        </div>
      )}

      {calls.map((c) => (
        <a key={c.userId} href={`tel:${c.phone}`} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14,
          minHeight: 88, marginBottom: 14, borderRadius: 22, textDecoration: 'none',
          background: 'var(--color-success, #1b7a3d)', color: '#fff', fontSize: 32, fontWeight: 800,
        }} aria-label={`Call ${c.firstName}`}>
          <span aria-hidden="true" style={{ fontSize: 34 }}>{'📞'}</span> Call {c.firstName}
        </a>
      ))}

      <div style={{ ...card, marginTop: calls.length ? 8 : 0 }}>
        <div style={label}>Coming up</div>
        {coming.length === 0 ? (
          <div style={{ fontSize: 24, color: 'var(--text-primary)' }}>Nothing scheduled in the next few days.</div>
        ) : coming.map((c, i) => {
          const l = comingLine(c);
          return (
            <div key={c.kind + c.id} style={{ padding: '12px 0', borderTop: i ? '2px solid var(--border-color)' : 'none' }}>
              <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.25 }}>{l.big}</div>
              {l.small && <div style={{ fontSize: 22, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.3 }}>{l.small}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const SimpleModeSettings = window.SimpleModeSettings = ({ recipientId, firstName }) => {
  const { showToast } = useToast();
  const [cfg, setCfg] = useState(null);
  const [on, setOn] = useState(false);
  const [picked, setPicked] = useState([]);
  const [saving, setSaving] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [sending, setSending] = useState(false);
  const [lastNote, setLastNote] = useState(null);
  const name = firstName || 'them';

  const load = async () => {
    try {
      const res = await apiFetch(`/api/care-recipients/${recipientId}/simple-mode`);
      if (res?.ok) { const d = await res.json(); setCfg(d); setOn(d.on); setPicked(d.callUserIds || []); setLastNote(d.lastNote || null); }
    } catch { /* the card stays in its loading state */ }
  };
  useEffect(() => { load(); }, [recipientId]);

  const save = async (nextOn, nextPicked) => {
    setSaving(true);
    try {
      const res = await apiFetch(`/api/care-recipients/${recipientId}/simple-mode`, {
        method: 'PUT', body: JSON.stringify({ on: nextOn, callUserIds: nextPicked }),
      });
      const d = await res?.json().catch(() => ({}));
      if (res?.ok) { setOn(d.on); setPicked(d.callUserIds); showToast('Saved', 'success'); }
      else { showToast(d?.error || 'Could not save', 'error'); setOn(cfg?.on || false); }
    } catch { showToast('Could not save', 'error'); }
    setSaving(false);
  };

  const togglePerson = (id) => {
    const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
    if (next.length > (cfg?.maxCalls || 3)) { showToast(`Pick up to ${cfg?.maxCalls || 3} people`, 'error'); return; }
    setPicked(next);
    save(on, next);
  };

  const sendNote = async () => {
    const text = noteText.trim();
    if (!text) return;
    setSending(true);
    try {
      const res = await apiFetch('/api/notes', {
        method: 'POST', body: JSON.stringify({ careRecipientId: recipientId, content: text, noteType: 'for_recipient' }),
      });
      const d = await res?.json().catch(() => ({}));
      if (res?.ok) { setNoteText(''); setLastNote(d.note || null); showToast(`Sent to ${name}'s phone`, 'success'); }
      else showToast(d?.error || 'Could not send the note', 'error');
    } catch { showToast('Could not send the note', 'error'); }
    setSending(false);
  };

  if (!cfg) return null;
  if (!cfg.hasOwnLogin) return null;

  const box = { marginBottom: 20, paddingBottom: 20, borderBottom: '1px solid var(--border-light, #f0f0f0)' };
  return (
    <div style={box}>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--role-color)', marginBottom: 6 }}>{name}'s phone</div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'var(--text-primary)', cursor: 'pointer', marginBottom: 6 }}>
        <input type="checkbox" checked={on} disabled={saving} onChange={(e) => save(e.target.checked, picked)} style={{ width: 20, height: 20, accentColor: 'var(--role-color)' }} />
        <span><strong>Simple screen</strong> — very large text, call buttons, what's coming up, and your latest note. Nothing else.</span>
      </label>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px 30px', lineHeight: 1.5 }}>
        Only the team leader can turn this off. Works inside iPhone Assistive Access.
      </p>

      {on && (
        <>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', margin: '4px 0 6px' }}>Call buttons (up to {cfg.maxCalls})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
            {cfg.candidates.map((c) => (
              <label key={c.userId} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: c.hasPhone ? 'var(--text-primary)' : 'var(--text-muted)', cursor: c.hasPhone ? 'pointer' : 'default' }}>
                <input type="checkbox" disabled={!c.hasPhone || saving} checked={picked.includes(c.userId)} onChange={() => togglePerson(c.userId)} style={{ width: 16, height: 16, accentColor: 'var(--role-color)' }} />
                {c.firstName} {c.lastName}{!c.hasPhone && ' — no phone number on their account'}
              </label>
            ))}
          </div>

          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>Leave {name} a note</div>
          <textarea value={noteText} maxLength={500} rows={3} onChange={(e) => setNoteText(e.target.value)}
            placeholder="I'll be there at 10. Stay in the house."
            style={{ width: '100%', padding: '10px 12px', border: '1px solid #d0d0d0', borderRadius: 8, fontSize: 15, fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical' }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Shows big on {name}'s screen, and the phone gets a "tap to read" notice.</span>
            <button onClick={sendNote} disabled={sending || !noteText.trim()} style={{ padding: '8px 16px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer', opacity: (sending || !noteText.trim()) ? 0.6 : 1, whiteSpace: 'nowrap' }}>
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
          {lastNote && (
            <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 8, background: 'var(--bg-surface)', fontSize: 13, color: 'var(--text-secondary)' }}>
              On {name}'s screen now: <span style={{ color: 'var(--text-primary)' }}>"{lastNote.content}"</span>
            </div>
          )}
        </>
      )}
    </div>
  );
};
