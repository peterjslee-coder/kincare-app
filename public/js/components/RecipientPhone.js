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

// v1.130.1 — the quick things the person can tell the family with one tap. `attention` ones
// arrive as "needs attention" (they are the ones someone should act on soon).
// v1.130.2 — the Text button's one-tap messages. Plain things a person says to family.
const TEXT_QUICK = ['Call me when you can', "I'm OK", 'Thank you', 'I love you'];

// "Peter", "Peter & Sara", "Peter, Sara & Daniel", "Peter, Sara & 2 more"
const simpleNames = (people) => {
  const n = (people || []).map((p) => p.firstName).filter(Boolean);
  if (n.length <= 1) return n[0] || 'the family';
  if (n.length === 2) return `${n[0]} & ${n[1]}`;
  if (n.length === 3) return `${n[0]}, ${n[1]} & ${n[2]}`;
  return `${n[0]}, ${n[1]} & ${n.length - 2} more`;
};

// A small row of overlapping faces.
const SimpleFaces = ({ people, size = 48, ring }) => (
  <div style={{ display: 'flex', flexShrink: 0 }}>
    {(people || []).slice(0, 3).map((p, i) => (
      <div key={p.userId} style={{ marginLeft: i ? -size * 0.3 : 0 }}>
        <SimpleFace photo={p.photo} name={p.firstName} size={size} ring={ring} />
      </div>
    ))}
  </div>
);

const TELL_FAMILY_QUICK = [
  { text: "I'm hungry", icon: '🍽️', attention: false },
  { text: 'I have pain', icon: '🩹', attention: true },
  { text: "I don't feel well", icon: '🤒', attention: true },
  { text: 'I need help', icon: '🆘', attention: true },
  { text: "I'm fine", icon: '😊', attention: false },
];

// v1.130.1 — Pete: "Faces and names reminders are important." The person's own profile photo,
// round, with their first initial when there is none (or it fails to load).
const SimpleFace = ({ photo, name, size = 56, ring }) => {
  const [broken, setBroken] = useState(false);
  const base = { width: size, height: size, borderRadius: size / 2, flexShrink: 0, border: `3px solid ${ring || 'var(--bg-card)'}`, boxSizing: 'border-box' };
  if (photo && !broken) {
    return <img src={photo} alt="" onError={() => setBroken(true)} style={{ ...base, objectFit: 'cover', background: 'var(--bg-surface)' }} />;
  }
  return (
    <div aria-hidden="true" style={{ ...base, background: 'var(--role-color-light, #f3e5f5)', color: 'var(--role-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.round(size * 0.45), fontWeight: 800 }}>
      {(name || '?').charAt(0).toUpperCase()}
    </div>
  );
};

// ─── v1.152.0 — InPlace Hub ───
//
// Pete, 11/23: a Galaxy Tab A11 on a 3D-printed stand, "a little TV that stays on the counter".
// "Almost look only...but should mimic/compliment what's on mom's app": the big date WITH the
// year, who is here, today and the week ahead, faces with names, the latest note, and the very
// same buttons the leader set for her Simple screen. It shows when the leader has turned the Hub
// on AND the screen is wide and sideways, so her phone keeps the phone layout.
const hubViewport = () => {
  try { return window.innerWidth >= 900 && window.innerWidth > window.innerHeight; } catch { return false; }
};

// "21:00" → minutes past midnight
const hubMinutes = (hhmm) => { const [h, m] = String(hhmm || '').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
// Night when now is in [dimFrom, dimTo), wrapping past midnight.
const hubIsNight = (now, from, to) => {
  const n = now.getHours() * 60 + now.getMinutes();
  const a = hubMinutes(from), b = hubMinutes(to);
  if (a === b) return false;
  return a < b ? (n >= a && n < b) : (n >= a || n < b);
};

const hubLine = (c) => {
  const at = c.time ? simpleFmtTime(c.time) : '';
  if (c.kind === 'visit') {
    if (c.inProgress) return `${c.who || 'Your caregiver'} is here`;
    return `${c.who || 'A caregiver'} comes${at ? ` at ${at}` : ''}`;
  }
  return `${c.title}${c.location ? ` at ${c.location}` : ''}`;
};

const HubBoard = ({ hub, first, now, show, calls, note, s, failed, readFlash, reading, acking, unread, awake, onWake, onRead, onAck, onText, onTell, onMessages }) => {
  const today = hub.today;
  const days = hub.days || [];
  const todayItems = days.filter((d) => d.date === today);
  const later = days.filter((d) => d.date > today);
  const dateLine = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
  const clock = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const [clockNum, clockAp] = clock.split(' ');
  const part = now.getHours() < 12 ? 'Morning' : now.getHours() < 17 ? 'Afternoon' : 'Evening';

  // ── Night: dark, a big clock, and the first thing tomorrow. A tap brightens it a while. ──
  if (hubIsNight(now, hub.dimFrom, hub.dimTo) && !awake) {
    const next = later[0] || null;
    return (
      <div onClick={onWake} data-testid="hub-night" style={{ height: '100vh', background: '#16130f', color: '#d9cfc2', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '3vh', textAlign: 'center', cursor: 'pointer', userSelect: 'none' }}>
        <div style={{ fontSize: '4.4vh', color: '#8f857a' }}>{weekday}, {dateLine}</div>
        <div style={{ fontSize: '20vh', fontWeight: 800, lineHeight: 1, color: '#efe6da' }}>{clockNum} <span style={{ fontSize: '8vh' }}>{clockAp}</span></div>
        <div style={{ fontSize: '5.4vh', fontWeight: 700, color: '#efe6da' }}>Good night{first ? `, ${first}` : ''}.</div>
        {next && <div style={{ fontSize: '4.2vh', color: '#b3a898' }}>{simpleFmtDay(next.date)}: {hubLine(next)}{next.time && next.kind !== 'visit' ? ` — ${simpleFmtTime(next.time)}` : ''}</div>}
      </div>
    );
  }

  const card = { background: 'var(--bg-card)', borderRadius: '2.4vh', padding: '2vh 2.6vh', border: '2px solid var(--border-color)', boxSizing: 'border-box', minHeight: 0 };
  const label = { fontSize: '2.4vh', fontWeight: 800, letterSpacing: 1, color: 'var(--text-secondary)', textTransform: 'uppercase' };
  const row = { display: 'flex', gap: '2vh', fontSize: '3.4vh', padding: '0.9vh 0', color: 'var(--text-primary)', lineHeight: 1.2 };
  const btn = (bg, fg) => ({
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1.6vh', minHeight: '10vh',
    borderRadius: '2.4vh', border: 'none', background: bg, color: fg, fontSize: '3.8vh', fontWeight: 800,
    fontFamily: 'inherit', textDecoration: 'none', cursor: 'pointer', padding: '0 2vh', boxSizing: 'border-box',
  });
  const waiting = show.text && s.text && Array.isArray(s.text.waiting) && s.text.waiting.length ? s.text.waiting[s.text.waiting.length - 1] : null;
  // Rows are sized in vh, so the same number fit on any screen: about seven under the clock, five
  // when "is here" takes its card. Today first (up to three), the week gets what is left, so
  // nothing is ever cut off mid-line.
  const todayShown = todayItems.filter((c) => !(c.kind === 'visit' && c.inProgress));
  const budget = (hub.here ? 5 : 7) - (failed ? 1 : 0);
  const todayRows = todayShown.slice(0, 3);
  const weekRows = later.slice(0, Math.max(0, budget - Math.max(1, todayRows.length)));
  const weekGroups = [];
  for (const c of weekRows) {
    const last = weekGroups[weekGroups.length - 1];
    if (last && last.date === c.date) last.items.push(c); else weekGroups.push({ date: c.date, items: [c] });
  }
  const shortDay = (d) => {
    const x = new Date(d + 'T12:00:00');
    const t = new Date(); t.setHours(12, 0, 0, 0);
    return Math.round((x - t) / 86400000) === 1 ? 'Tomorrow' : x.toLocaleDateString('en-US', { weekday: 'short' });
  };
  const hasButtons = calls.length > 0 || (show.text && s.text) || show.tellFamily || show.messages;

  return (
    <div className="simple-view hub-board" data-testid="hub-board" style={{ height: '100vh', background: 'var(--bg-surface)', padding: '3vh 3.2vw', boxSizing: 'border-box', display: 'grid', gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 1fr)', gridTemplateRows: hasButtons ? 'minmax(0, 1fr) auto' : 'minmax(0, 1fr)', gap: '2.4vh 2vw', overflow: 'hidden' }}>
      {/* Left: the day */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2vh', minHeight: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '2vw' }}>
          <div>
            <div style={{ fontSize: '4.6vh', fontWeight: 700, color: 'var(--text-secondary)', lineHeight: 1.1 }}>{weekday}</div>
            <div style={{ fontSize: '4.2vh', color: 'var(--text-secondary)', lineHeight: 1.2 }} data-testid="hub-date">{dateLine}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '12vh', fontWeight: 800, lineHeight: 1, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{clockNum} <span style={{ fontSize: '5vh' }}>{clockAp}</span></div>
            <div style={{ fontSize: '2.8vh', color: 'var(--text-secondary)' }}>{part}</div>
          </div>
        </div>

        {failed && <div style={{ ...card, fontSize: '3vh' }}>Can't reach InPlace right now. It will try again by itself.</div>}

        {hub.here && (
          <div style={{ ...card, display: 'flex', alignItems: 'center', gap: '2vh', flexShrink: 0 }}>
            <SimpleFace photo={hub.here.photo} name={hub.here.firstName} size={Math.round(window.innerHeight * 0.1)} />
            <div>
              <div style={{ fontSize: '4.2vh', fontWeight: 800, color: 'var(--text-primary)' }}>{hub.here.firstName} is here</div>
              {hub.here.until && <div style={{ fontSize: '3vh', color: 'var(--text-secondary)' }}>until {simpleFmtTime(hub.here.until)}</div>}
            </div>
          </div>
        )}

        {show.comingUp && (
          <div style={card}>
            <div style={{ ...label, color: 'var(--role-color)' }}>Today</div>
            {todayRows.length === 0
              ? <div style={{ ...row, color: 'var(--text-secondary)' }}>Nothing else today.</div>
              : todayRows.map((c, i) => (
                <div key={c.kind + c.id} style={{ ...row, borderTop: i ? '2px solid var(--border-color)' : 'none' }}>
                  <span style={{ width: '16vh', flexShrink: 0, fontWeight: 700 }}>{c.time ? simpleFmtTime(c.time) : ''}</span>
                  <span style={{ minWidth: 0 }}>{hubLine(c)}</span>
                </div>
              ))}
          </div>
        )}

        {show.comingUp && weekGroups.length > 0 && (
          <div style={{ ...card, overflow: 'hidden' }}>
            <div style={label}>{hub.week ? 'This week' : 'Tomorrow'}</div>
            {weekGroups.map((g, gi) => g.items.map((c, i) => (
              <div key={c.kind + c.id} style={{ ...row, borderTop: gi || i ? '2px solid var(--border-color)' : 'none' }}>
                <span style={{ width: '16vh', flexShrink: 0, fontWeight: 700 }}>{i === 0 ? shortDay(g.date) : ''}</span>
                <span style={{ minWidth: 0 }}>{hubLine(c)}{c.time && c.kind !== 'visit' ? ` · ${simpleFmtTime(c.time)}` : ''}</span>
              </div>
            )))}
          </div>
        )}
      </div>

      {/* Right: from the family, and who's who */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2vh', minHeight: 0, overflow: 'hidden' }}>
        {readFlash && (
          <div style={{ ...card, borderColor: 'var(--color-success, #1b7a3d)', borderWidth: 3, fontSize: '3.2vh', fontWeight: 700 }}>{'✓'} {readFlash}</div>
        )}
        {note && (
          <div style={{ ...card, borderColor: 'var(--role-color)', borderWidth: 3, flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1.6vh', marginBottom: '1vh' }}>
              <SimpleFace photo={note.fromPhoto} name={note.from} size={Math.round(window.innerHeight * 0.07)} />
              <div style={{ fontSize: '2.8vh', color: 'var(--text-secondary)' }}>From {note.from} {'·'} {simpleAgo(note.createdAt)}</div>
            </div>
            <div style={{ fontSize: '3.8vh', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{note.content}</div>
            <button onClick={() => onRead(note.id)} disabled={reading} style={{ ...btn('var(--role-color)', 'var(--text-on-primary)'), width: '100%', marginTop: '1.6vh', minHeight: '8vh', fontSize: '3.4vh' }}>
              {'👍'} I read it!
            </button>
          </div>
        )}
        {!note && waiting && (
          <div style={{ ...card, borderColor: 'var(--role-color)', borderWidth: 3, flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1.6vh', marginBottom: '1vh' }}>
              <SimpleFace photo={waiting.fromPhoto} name={waiting.from} size={Math.round(window.innerHeight * 0.07)} />
              <div style={{ fontSize: '2.8vh', color: 'var(--text-secondary)' }}>{waiting.isReply ? `${waiting.from} wrote back` : `Message from ${waiting.from}`}</div>
            </div>
            <div style={{ fontSize: '3.8vh', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{waiting.content}</div>
            <div style={{ display: 'flex', gap: '1.6vh', marginTop: '1.6vh' }}>
              <button onClick={onAck} disabled={acking} style={{ ...btn('var(--role-color)', 'var(--text-on-primary)'), minHeight: '8vh', fontSize: '3.4vh' }}>Got it</button>
              <button onClick={onText} style={{ ...btn('var(--bg-card)', 'var(--text-primary)'), border: '2px solid var(--border-color)', minHeight: '8vh', fontSize: '3.4vh' }}>Write back</button>
            </div>
          </div>
        )}

        {hub.faces && (hub.people || []).length > 0 && (
          <div style={{ ...card, flexShrink: 0 }}>
            <div style={label}>Who's who</div>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${hub.people.length <= 4 ? hub.people.length : 3}, minmax(0, 1fr))`, gap: '1.6vh', marginTop: '1.4vh', textAlign: 'center' }}>
              {hub.people.map((p) => (
                <div key={p.userId} style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <SimpleFace photo={p.photo} name={p.firstName} size={Math.round(window.innerHeight * 0.1)} ring={p.today ? 'var(--role-color)' : undefined} />
                  </div>
                  <div style={{ fontSize: '3.2vh', fontWeight: 800, color: 'var(--text-primary)', marginTop: '0.6vh', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.firstName}</div>
                  <div style={{ fontSize: '2.3vh', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.label}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Bottom: the same buttons as her Simple screen */}
      {hasButtons && (
        <div style={{ gridColumn: '1 / 3', display: 'flex', gap: '2vw' }}>
          {calls.map((c) => (
            <a key={c.userId} href={`tel:${c.phone}`} style={btn('var(--color-success, #1b7a3d)', '#fff')} aria-label={`Call ${c.firstName}`}>
              <SimpleFace photo={c.photo} name={c.firstName} size={Math.round(window.innerHeight * 0.07)} ring="#fff" /> Call {c.firstName}
            </a>
          ))}
          {show.text && s.text && (
            <button onClick={onText} style={btn('var(--role-color)', 'var(--text-on-primary)')} aria-label={`Text ${simpleNames(s.text.to)}`}>
              <span aria-hidden="true">{'💬'}</span> Text {s.text.to.length > 2 ? 'my family' : simpleNames(s.text.to)}
            </button>
          )}
          {show.tellFamily && (
            <button onClick={onTell} style={{ ...btn('var(--bg-card)', 'var(--text-primary)'), border: '3px solid var(--role-color)' }}>
              <span aria-hidden="true">{'✍️'}</span> Tell the family
            </button>
          )}
          {show.messages && (
            <button onClick={onMessages} style={btn('var(--role-color)', 'var(--text-on-primary)')}>
              <span aria-hidden="true">{'💬'}</span> Messages
              {unread > 0 && <span style={{ background: '#fff', color: 'var(--role-color)', borderRadius: 20, padding: '0 1.4vh', fontSize: '3vh' }}>{unread}</span>}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

const SimpleView = window.SimpleView = ({ initial }) => {
  const [data, setData] = useState(initial || null);
  const [loading, setLoading] = useState(!initial);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(new Date());
  const [panel, setPanel] = useState(null); // null | 'messages' | 'tell'
  const [unread, setUnread] = useState(0);
  const [tellText, setTellText] = useState('');
  const [sending, setSending] = useState(false);
  const [sentMsg, setSentMsg] = useState('');
  // v1.152.0 — InPlace Hub: the same screen on a tablet held sideways on the kitchen counter.
  const [wide, setWide] = useState(hubViewport());
  const [wakeUntil, setWakeUntil] = useState(0); // a tap on the night screen brightens it a while
  useEffect(() => {
    const onResize = () => setWide(hubViewport());
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => { window.removeEventListener('resize', onResize); window.removeEventListener('orientationchange', onResize); };
  }, []);

  // v1.130.1 — tell the family the screen was looked at (and that the note on it was seen).
  // Only on an open or a return to the front, never on the minute refresh: a phone lying on
  // the counter with the app up is not someone looking at it.
  const markOpened = React.useCallback((d) => {
    try {
      if (!d?.careRecipientId || document.visibilityState !== 'visible') return;
      apiFetch(`/api/care-recipients/${d.careRecipientId}/simple-screen/opened`, {
        method: 'POST', body: JSON.stringify({ noteId: d.simpleScreen?.noteForYou?.id || null }),
      }).catch(() => {});
    } catch { /* a record of a look must never break the look */ }
  }, []);

  const load = React.useCallback(async (opened) => {
    try {
      const res = await apiFetch('/api/dashboard');
      if (res?.ok) {
        const d = await res.json();
        setData(d); setFailed(false);
        if (opened) markOpened(d);
      } else setFailed(true);
    } catch { setFailed(true); }
    setLoading(false);
  }, []);

  const [reading, setReading] = useState(false);
  const [readFlash, setReadFlash] = useState('');
  const markRead = async (noteId) => {
    if (!data?.careRecipientId || reading) return;
    setReading(true);
    try {
      const res = await apiFetch(`/api/care-recipients/${data.careRecipientId}/notes-for-me/${noteId}/read`, { method: 'POST' });
      if (res?.ok) {
        // Reading it takes it away; a short thank-you says the family will know.
        const from = data.simpleScreen?.noteForYou?.from;
        setData((prev) => prev && prev.simpleScreen ? ({ ...prev, simpleScreen: { ...prev.simpleScreen, noteForYou: null } }) : prev);
        setReadFlash(from ? `Thank you! ${from} will see that you read it.` : 'Thank you!');
        setTimeout(() => setReadFlash(''), 8000);
      }
    } catch { /* the button stays; they can tap again */ }
    setReading(false);
  };

  // v1.133.0 — "Got it" on a waiting message. Takes it off her screen; the family sees
  // "Betty saw it" under it in Messages.
  const [acking, setAcking] = useState(false);
  const ackText = async () => {
    if (!data?.careRecipientId || acking) return;
    setAcking(true);
    try {
      const res = await apiFetch(`/api/care-recipients/${data.careRecipientId}/simple-screen/text-ack`, { method: 'POST' });
      if (res?.ok) {
        const from = data.simpleScreen?.text?.waiting?.[0]?.from;
        setData((prev) => prev && prev.simpleScreen && prev.simpleScreen.text
          ? ({ ...prev, simpleScreen: { ...prev.simpleScreen, text: { ...prev.simpleScreen.text, waiting: [] } } }) : prev);
        setReadFlash(from ? `Thank you! ${from} will see that you got it.` : 'Thank you!');
        setTimeout(() => setReadFlash(''), 8000);
      }
    } catch { /* the button stays; they can tap again */ }
    setAcking(false);
  };

  const loadUnread = React.useCallback(async () => {
    try {
      const res = await apiFetch('/api/messages/conversations');
      if (res?.ok) {
        const d = await res.json();
        setUnread((d.conversations || []).reduce((sum, c) => sum + (c.unreadCount || 0), 0));
      }
    } catch { /* the badge is a courtesy */ }
  }, []);

  const showMessages = !!data?.simpleScreen?.show?.messages;

  useEffect(() => {
    if (!initial) load(true); else markOpened(initial);
    // A phone left on the kitchen counter: refresh every minute, and the moment it is picked up.
    // v1.130.3 — this screen never changes pages, and a page change is when the app applies a
    // waiting update (index.html → window.__swApplyPendingUpdate). Betty's phone sat on the
    // old screen after v1.130.2 shipped. So ask on every tick and every return to the front;
    // it only applies when nothing is being typed, behind the "App updated" card.
    const tryUpdate = () => { try { window.__swApplyPendingUpdate && window.__swApplyPendingUpdate(); } catch { /* never block the screen */ } };
    const iv = setInterval(() => { setNow(new Date()); load(); tryUpdate(); }, 60000);
    const onVis = () => { if (document.visibilityState === 'visible') { setNow(new Date()); load(true); tryUpdate(); } };
    document.addEventListener('visibilitychange', onVis);
    const offs = [];
    if (typeof onSocketEvent === 'function') {
      offs.push(onSocketEvent('activity_update', () => load()));
      offs.push(onSocketEvent('simple_screen_refresh', () => load()));
      offs.push(onSocketEvent('simple_mode_changed', () => load()));
      offs.push(onSocketEvent('new_message', () => load())); // v1.130.2 — a reply to her text
    }
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVis); offs.forEach((o) => o && o()); };
  }, []);

  useEffect(() => {
    if (!showMessages) return undefined;
    loadUnread();
    const iv = setInterval(loadUnread, 30000);
    const off = typeof onSocketEvent === 'function' ? onSocketEvent('new_message', () => loadUnread()) : null;
    return () => { clearInterval(iv); if (off) off(); };
  }, [showMessages]);

  const hubOn = !!(data?.simpleScreen?.hub?.on) && wide;
  const page = { minHeight: '100vh', background: 'var(--bg-surface)', padding: '20px 16px 32px', boxSizing: 'border-box', maxWidth: hubOn ? 900 : 560, margin: '0 auto' };
  const card = { background: 'var(--bg-card)', borderRadius: 20, padding: '20px', marginBottom: 18, border: '2px solid var(--border-color)' };
  const label = { fontSize: 20, fontWeight: 700, color: 'var(--text-secondary)', margin: '0 0 10px' };
  const bigBtn = (bg, fg) => ({
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, width: '100%',
    minHeight: 88, marginBottom: 14, borderRadius: 22, textDecoration: 'none', border: 'none', cursor: 'pointer',
    background: bg, color: fg, fontSize: 30, fontWeight: 800, fontFamily: 'inherit', boxSizing: 'border-box',
  });
  const backBar = (
    <button onClick={() => { setPanel(null); setSentMsg(''); load(); }} style={{ ...bigBtn('var(--bg-card)', 'var(--text-primary)'), border: '2px solid var(--border-color)', minHeight: 72, fontSize: 26 }}>
      {'←'} Back to home
    </button>
  );

  if (loading) return <div style={{ ...page, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, color: 'var(--text-secondary)' }}>One moment…</div>;

  const s = data?.simpleScreen || {};
  const show = s.show || { calls: true, comingUp: true, notesFromFamily: true };

  // Opening the thread is reading it: the ordinary conversation read marks it read for her
  // (and skips it while an admin is viewing as her).
  const openText = () => {
    setSentMsg(''); setTellText(''); setPanel('text');
    if (s.text?.conversationId) apiFetch(`/api/messages/conversations/${s.text.conversationId}`).catch(() => {});
  };

  // ── Messages: the ordinary Messages screen, under a big way home ──
  if (panel === 'messages' && show.messages && typeof Messages !== 'undefined') {
    return (
      <div style={{ ...page, padding: '12px 12px 0', maxWidth: 720 }}>
        {backBar}
        <div style={{ height: 'calc(100vh - 110px)', overflow: 'hidden', borderRadius: 16, background: 'var(--bg-card)' }}>
          <Messages />
        </div>
      </div>
    );
  }

  // ── v1.130.2 — the Text button: her last message and the replies to it, big ──
  if (panel === 'text' && show.text && s.text) {
    const t = s.text;
    const names = simpleNames(t.to);
    const sendText = async (body) => {
      const c = String(body || '').trim();
      if (!c || sending) return;
      setSending(true);
      try {
        const res = await apiFetch(`/api/messages/conversations/${t.conversationId}`, { method: 'POST', body: JSON.stringify({ content: c }) });
        if (res?.ok) { setTellText(''); setSentMsg(`Sent to ${names}`); await load(); }
        else setSentMsg("That didn't send. Please try again.");
      } catch { setSentMsg("That didn't send. Please try again."); }
      setSending(false);
    };
    const bubble = (fromMe) => ({
      maxWidth: '88%', alignSelf: fromMe ? 'flex-end' : 'flex-start', padding: '14px 18px', borderRadius: 22,
      background: fromMe ? 'var(--role-color)' : 'var(--bg-card)', color: fromMe ? 'var(--text-on-primary)' : 'var(--text-primary)',
      border: fromMe ? 'none' : '2px solid var(--border-color)', fontSize: 26, fontWeight: 600, lineHeight: 1.3,
      whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
    });
    return (
      <div style={page} className="simple-view">
        {backBar}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '6px 0 14px' }}>
          <SimpleFaces people={t.to} size={52} />
          <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.2 }}>Text {names}</div>
        </div>

        {(t.mine || t.replies.length > 0) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 18 }}>
            {t.mine && (
              <>
                <div style={{ fontSize: 18, color: 'var(--text-secondary)', alignSelf: 'flex-end' }}>You, {simpleAgo(t.mine.createdAt)}</div>
                <div style={bubble(true)}>{t.mine.content}</div>
              </>
            )}
            {t.replies.map((r) => (
              <div key={r.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                <SimpleFace photo={r.fromPhoto} name={r.from} size={48} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                  <div style={{ fontSize: 18, color: 'var(--text-secondary)' }}>{r.from}, {simpleAgo(r.createdAt)}</div>
                  <div style={bubble(false)}>{r.content}</div>
                </div>
              </div>
            ))}
            {t.mine && t.replies.length === 0 && (
              <div style={{ fontSize: 20, color: 'var(--text-secondary)' }}>No answer yet. They'll write back here.</div>
            )}
          </div>
        )}

        {sentMsg && (
          <div style={{ ...card, borderColor: 'var(--role-color)', borderWidth: 3, fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>
            {sentMsg.startsWith('Sent') ? '✅ ' : ''}{sentMsg}
          </div>
        )}

        {TEXT_QUICK.map((q) => (
          <button key={q} disabled={sending} onClick={() => sendText(q)}
            style={{ ...bigBtn('var(--bg-card)', 'var(--text-primary)'), border: '2px solid var(--border-color)', minHeight: 76, fontSize: 26 }}>
            {q}
          </button>
        ))}
        <div style={{ ...card, marginTop: 8 }}>
          <div style={label}>Or write your own</div>
          <textarea value={tellText} maxLength={1000} rows={3} onChange={(e) => setTellText(e.target.value)}
            placeholder="Type here, or tap the microphone on the keyboard to talk"
            style={{ width: '100%', fontSize: 24, padding: 14, borderRadius: 14, border: '2px solid var(--border-color)', boxSizing: 'border-box', fontFamily: 'inherit', resize: 'vertical' }} />
          <button disabled={sending || !tellText.trim()} onClick={() => sendText(tellText)}
            style={{ ...bigBtn('var(--role-color)', 'var(--text-on-primary)'), marginTop: 12, marginBottom: 0, opacity: (sending || !tellText.trim()) ? 0.6 : 1 }}>
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    );
  }

  // ── Tell the family ──
  if (panel === 'tell' && show.tellFamily) {
    const send = async (text, attention) => {
      const t = String(text || '').trim();
      if (!t || sending) return;
      setSending(true);
      try {
        const res = await apiFetch(`/api/care-recipients/${data.careRecipientId}/from-me`, {
          method: 'POST', body: JSON.stringify({ content: t, needsAttention: !!attention }),
        });
        if (res?.ok) { setSentMsg(`Sent: "${t}"`); setTellText(''); }
        else setSentMsg("That didn't send. Please try again.");
      } catch { setSentMsg("That didn't send. Please try again."); }
      setSending(false);
    };
    return (
      <div style={page} className="simple-view">
        {backBar}
        <div style={{ fontSize: 30, fontWeight: 800, color: 'var(--text-primary)', margin: '6px 0 16px' }}>Tell the family</div>
        {sentMsg && (
          <div style={{ ...card, borderColor: 'var(--role-color)', borderWidth: 3, fontSize: 24, fontWeight: 700, color: 'var(--text-primary)' }}>
            {sentMsg.startsWith('Sent') ? '✅ ' : ''}{sentMsg}
          </div>
        )}
        {TELL_FAMILY_QUICK.map((q) => (
          <button key={q.text} disabled={sending} onClick={() => send(q.text, q.attention)}
            style={{ ...bigBtn('var(--bg-card)', 'var(--text-primary)'), border: '2px solid var(--border-color)', justifyContent: 'flex-start', paddingLeft: 24, fontSize: 28 }}>
            <span aria-hidden="true">{q.icon}</span> {q.text}
          </button>
        ))}
        <div style={{ ...card, marginTop: 8 }}>
          <div style={label}>Or write it</div>
          <textarea value={tellText} maxLength={500} rows={3} onChange={(e) => setTellText(e.target.value)}
            placeholder="My shoulder hurts"
            style={{ width: '100%', fontSize: 24, padding: 14, borderRadius: 14, border: '2px solid var(--border-color)', boxSizing: 'border-box', fontFamily: 'inherit', resize: 'vertical' }} />
          <button disabled={sending || !tellText.trim()} onClick={() => send(tellText, false)}
            style={{ ...bigBtn('var(--role-color)', 'var(--text-on-primary)'), marginTop: 12, marginBottom: 0, opacity: (sending || !tellText.trim()) ? 0.6 : 1 }}>
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    );
  }

  const first = (data?.userName || '').split(' ')[0];
  const calls = show.calls ? (s.callContacts || []) : [];
  const coming = s.comingUp || [];
  const note = show.notesFromFamily ? s.noteForYou : null;

  // v1.130.2 — one line each, under a Today / Tomorrow heading: "Tina comes at 10:00 AM",
  // "Haircut at Angie's — 1:00 PM", "Church pickup — 9:30 AM".
  const comingLine = (c) => {
    const at = c.time ? simpleFmtTime(c.time) : '';
    if (c.kind === 'visit') {
      if (c.inProgress) return `${c.who || 'Your caregiver'} is here now`;
      return `${c.who || 'A caregiver'} comes${at ? ` at ${at}` : ''}`;
    }
    return `${c.title}${c.location ? ` at ${c.location}` : ''}${at ? ` — ${at}` : ''}`;
  };
  const comingDays = [];
  for (const c of coming) {
    const day = simpleFmtDay(c.date);
    const last = comingDays[comingDays.length - 1];
    if (last && last.day === day) last.items.push(c); else comingDays.push({ day, items: [c] });
  }

  if (hubOn) {
    return (
      <HubBoard hub={s.hub} first={first} now={now} show={show} calls={calls} note={note} s={s} failed={failed}
        readFlash={readFlash} reading={reading} acking={acking} unread={unread}
        awake={Date.now() < wakeUntil} onWake={() => setWakeUntil(Date.now() + 120000)}
        onRead={markRead} onAck={ackText} onText={openText}
        onTell={() => setPanel('tell')} onMessages={() => setPanel('messages')} />
    );
  }

  return (
    <div style={page} className="simple-view">
      {/* v1.130.1 — Pete: "'good evening betty' takes up too much space. something like 'Hi
          Betty!'" One line for the greeting, one for the day and time. */}
      <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.15 }}>Hi{first ? ` ${first}` : ''}!</div>
      <div style={{ fontSize: 22, color: 'var(--text-secondary)', margin: '4px 0 16px', lineHeight: 1.3 }}>
        {now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })} {'·'} {now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
      </div>

      {failed && (
        <div style={{ ...card, fontSize: 22, color: 'var(--text-primary)' }}>Can't reach InPlace right now. It will try again by itself.</div>
      )}

      {readFlash && (
        <div style={{ ...card, borderColor: 'var(--color-success, #1b7a3d)', borderWidth: 3, fontSize: 24, fontWeight: 700, color: 'var(--text-primary)' }}>
          {'✓'} {readFlash}
        </div>
      )}

      {/* v1.130.1 — the whole note is the button. Pete: "just have her click on the message to
          clear it." Reading it takes it away; the family sees when. */}
      {note && (
        <button onClick={() => markRead(note.id)} disabled={reading} aria-label={`Note from ${note.from}. Tap when you have read it.`}
          style={{ ...card, display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer', borderColor: 'var(--role-color)', borderWidth: 3, fontFamily: 'inherit' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
            <SimpleFace photo={note.fromPhoto} name={note.from} size={56} />
            <div style={{ ...label, margin: 0 }}>From {note.from}</div>
          </div>
          <div style={{ fontSize: 30, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{note.content}</div>
          <div style={{ fontSize: 18, color: 'var(--text-secondary)', marginTop: 10 }}>{simpleAgo(note.createdAt)}</div>
          <div style={{ ...bigBtn('var(--role-color)', 'var(--text-on-primary)'), marginTop: 14, marginBottom: 0, minHeight: 76, fontSize: 28 }}>
            {'👍'} I read it!
          </div>
        </button>
      )}

      {calls.map((c) => (
        <a key={c.userId} href={`tel:${c.phone}`} style={{ ...bigBtn('var(--color-success, #1b7a3d)', '#fff'), justifyContent: 'flex-start', padding: '10px 18px' }} aria-label={`Call ${c.firstName}`}>
          <SimpleFace photo={c.photo} name={c.firstName} size={68} ring="#fff" />
          <span style={{ flex: 1, textAlign: 'center' }}><span aria-hidden="true" style={{ fontSize: 30 }}>{'📞'}</span> Call {c.firstName}</span>
        </a>
      ))}

      {/* v1.130.2 — a message waiting: show it on the home screen, big, so it is not missed.
          v1.133.0 — Pete, 11/18: it "sits on betty's screen until she acknowledges it". It
          stays until she taps Got it (or writes back); "Message from Peter" when the family
          started it, "Peter wrote back" when it answers something she sent. */}
      {show.text && s.text && Array.isArray(s.text.waiting) && s.text.waiting.length > 0 && (
        <div style={{ ...card, borderColor: 'var(--role-color)', borderWidth: 3 }}>
          {s.text.waiting.map((w, i) => (
            <div key={w.id} style={{ marginTop: i ? 16 : 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                <SimpleFace photo={w.fromPhoto} name={w.from} size={56} />
                <div style={{ ...label, margin: 0 }}>{w.isReply ? `${w.from} wrote back` : `Message from ${w.from}`}</div>
              </div>
              <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{w.content}</div>
            </div>
          ))}
          <button onClick={ackText} disabled={acking} data-testid="simple-text-got-it"
            style={{ ...bigBtn('var(--role-color)', 'var(--text-on-primary)'), marginTop: 18, marginBottom: 10, opacity: acking ? 0.6 : 1 }}>
            {acking ? 'One moment…' : 'Got it'}
          </button>
          <button onClick={openText}
            style={{ ...bigBtn('var(--bg-card)', 'var(--text-primary)'), border: '2px solid var(--border-color)', minHeight: 72, fontSize: 26, marginBottom: 0 }}>
            Write back
          </button>
        </div>
      )}

      {show.text && s.text && (
        <button onClick={openText} style={{ ...bigBtn('var(--role-color)', 'var(--text-on-primary)'), justifyContent: 'flex-start', padding: '10px 18px' }} aria-label={`Text ${simpleNames(s.text.to)}`}>
          <SimpleFaces people={s.text.to} size={60} ring="#fff" />
          <span style={{ flex: 1, textAlign: 'center', fontSize: 28 }}><span aria-hidden="true">{'💬'}</span> Text {s.text.to.length > 2 ? 'my family' : simpleNames(s.text.to)}</span>
        </button>
      )}

      {show.messages && (
        <button onClick={() => setPanel('messages')} style={bigBtn('var(--role-color)', 'var(--text-on-primary)')}>
          <span aria-hidden="true" style={{ fontSize: 32 }}>{'💬'}</span> Messages
          {unread > 0 && <span style={{ background: '#fff', color: 'var(--role-color)', borderRadius: 20, padding: '2px 14px', fontSize: 24 }}>{unread}</span>}
        </button>
      )}

      {show.tellFamily && (
        <button onClick={() => setPanel('tell')} style={{ ...bigBtn('var(--bg-card)', 'var(--text-primary)'), border: '3px solid var(--role-color)' }}>
          <span aria-hidden="true" style={{ fontSize: 32 }}>{'✍️'}</span> Tell the family
        </button>
      )}

      {show.comingUp && (
        <div style={{ ...card, marginTop: 8 }}>
          <div style={label}>Coming up</div>
          {comingDays.length === 0 ? (
            <div style={{ fontSize: 24, color: 'var(--text-primary)' }}>Nothing today or tomorrow.</div>
          ) : comingDays.map((g) => (
            <div key={g.day} style={{ marginTop: 6 }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--role-color)', margin: '6px 0 2px' }}>{g.day}</div>
              {g.items.map((c, i) => (
                <div key={c.kind + c.id} style={{ padding: '10px 0', borderTop: i ? '2px solid var(--border-color)' : 'none', display: 'flex', alignItems: 'center', gap: 14 }}>
                  {c.kind === 'visit'
                    ? <SimpleFace photo={c.whoPhoto} name={c.who} size={64} />
                    : <div aria-hidden="true" style={{ width: 64, height: 64, borderRadius: 32, background: 'var(--bg-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30, flexShrink: 0 }}>{'📅'}</div>}
                  <div style={{ minWidth: 0, fontSize: 26, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.25 }}>{comingLine(c)}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// v1.130.1 — "Mon 8:05 PM" style, and the read/seen line under a note.
const simpleClock = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  const t = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return sameDay ? `today ${t}` : `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} ${t}`;
};
const simpleGap = (fromIso, toIso) => {
  const mins = Math.max(0, Math.round((new Date(toIso) - new Date(fromIso)) / 60000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
};
const noteStatusLine = (n, name) => {
  if (!n || !n.createdAt) return '';
  const parts = [`Sent ${simpleClock(n.createdAt)}`];
  if (n.seenAt) parts.push(`on screen ${simpleClock(n.seenAt)}`);
  if (n.readAt) parts.push(`✓ read ${simpleClock(n.readAt)} (${simpleGap(n.createdAt, n.readAt)})`);
  else if (!n.seenAt) parts.push(`${name} hasn't opened the app since`);
  else parts.push('not marked read yet');
  return parts.join(' · ');
};

// What the leader can tick, in the order it appears on the phone.
const SIMPLE_SECTIONS = [
  ['notesFromFamily', 'Notes from the family', 'The latest note you leave shows big at the top.'],
  ['text', 'Text button', 'A big button that texts the people you pick below, as one group. You all see the whole thread in Messages; NAME sees only their last text and your replies.'],
  ['calls', 'Call buttons', 'Big buttons that ring the people you pick below. They don\u2019t work inside iPhone Assistive Access yet; use the Calls app there.'],
  ['messages', 'Messages', 'Read and send messages with the care team.'],
  ['tellFamily', 'Tell the family', 'One-tap notes like "I’m hungry" or "I have pain", or typed. You get a "tap to read" notice; pain and "I need help" come as needs attention.'],
  ['comingUp', 'Coming up', 'Today\u2019s and tomorrow\u2019s visits and appointments, like "Haircut at Angie\u2019s — 1:00 PM".'],
];

const SimpleModeSettings = window.SimpleModeSettings = ({ recipientId, firstName }) => {
  const { showToast } = useToast();
  const [cfg, setCfg] = useState(null);
  const [on, setOn] = useState(false);
  const [picked, setPicked] = useState([]);
  const [textPicked, setTextPicked] = useState([]);
  const [show, setShow] = useState({});
  const [saving, setSaving] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [sending, setSending] = useState(false);
  const [lastNote, setLastNote] = useState(null);
  const [hub, setHub] = useState(null); // v1.152.0 — InPlace Hub
  const name = firstName || 'them';

  const load = async () => {
    try {
      const res = await apiFetch(`/api/care-recipients/${recipientId}/simple-mode`);
      if (res?.ok) {
        const d = await res.json();
        setCfg(d); setOn(d.on); setPicked(d.callUserIds || []); setTextPicked(d.textUserIds || []); setShow(d.show || {}); setLastNote(d.lastNote || null); setHub(d.hub || null);
      }
    } catch { /* the card stays in its loading state */ }
  };
  useEffect(() => {
    load();
    // v1.130.1 — "Betty read your note" lands while this page is open: show it.
    const off = typeof onSocketEvent === 'function' ? onSocketEvent('activity_update', (p) => { if (p && p.type === 'note_read') load(); }) : null;
    return () => { if (off) off(); };
  }, [recipientId]);

  const save = async (patch, okText = 'Saved') => {
    setSaving(true);
    const body = { on, callUserIds: picked, textUserIds: textPicked, show, ...patch };
    try {
      const res = await apiFetch(`/api/care-recipients/${recipientId}/simple-mode`, { method: 'PUT', body: JSON.stringify(body) });
      const d = await res?.json().catch(() => ({}));
      if (res?.ok) {
        setOn(d.on); setPicked(d.callUserIds); setTextPicked(d.textUserIds || []); setShow(d.show || show);
        if (d.hub) setHub(d.hub);
        if (patch.clearNote) setLastNote(null);
        showToast(okText, 'success');
      } else showToast(d?.error || 'Could not save', 'error');
    } catch { showToast('Could not save', 'error'); }
    setSaving(false);
  };

  const togglePerson = (id) => {
    const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
    if (next.length > (cfg?.maxCalls || 3)) { showToast(`Pick up to ${cfg?.maxCalls || 3} people`, 'error'); return; }
    save({ callUserIds: next });
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
      if (res?.ok) {
        setNoteText('');
        setLastNote({ id: d.note?.id, content: text, createdAt: d.note?.created_at || new Date().toISOString(), seenAt: null, readAt: null });
        showToast(`Sent to ${name}'s phone`, 'success');
      }
      else showToast(d?.error || 'Could not send the note', 'error');
    } catch { showToast('Could not send the note', 'error'); }
    setSending(false);
  };

  if (!cfg) return null;
  if (!cfg.hasOwnLogin) return null;
  // v1.130.2 — three big buttons at most; the server enforces it too.
  const buttonsUsed = (show.calls ? picked.length : 0) + (show.text ? 1 : 0) + (show.tellFamily ? 1 : 0) + (show.messages ? 1 : 0);

  const box = { marginBottom: 20, paddingBottom: 20, borderBottom: '1px solid var(--border-light, #f0f0f0)' };
  const sub = { fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', margin: '4px 0 6px' };
  return (
    <div style={box}>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--role-color)', marginBottom: 6 }}>{name}'s phone</div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'var(--text-primary)', cursor: 'pointer', marginBottom: 6 }}>
        <input type="checkbox" checked={on} disabled={saving} onChange={(e) => save({ on: e.target.checked })} style={{ width: 20, height: 20, accentColor: 'var(--role-color)' }} />
        <span><strong>Simple screen</strong>: one screen, very large text. {name} sees only what you tick below. No menus, no money.</span>
      </label>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px 30px', lineHeight: 1.5 }}>
        Only the team leader can change this. Works inside iPhone Assistive Access.
      </p>

      {on && (
        <>
          <div style={sub}>What {name} can see <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>· up to {cfg.maxButtons || 3} big buttons (each call button, Text, Tell the family, Messages): {buttonsUsed} used</span></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
            {SIMPLE_SECTIONS.map(([key, title, desc]) => (
              <label key={key} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer' }}>
                <input type="checkbox" disabled={saving} checked={!!show[key]} onChange={(e) => save({ show: { ...show, [key]: e.target.checked } })}
                  style={{ width: 16, height: 16, marginTop: 2, accentColor: 'var(--role-color)' }} />
                <span><strong>{title}</strong> <span style={{ color: 'var(--text-secondary)' }}>— {desc.replace('NAME', name)}</span></span>
              </label>
            ))}
          </div>

          <div style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 12px', padding: '8px 10px', borderRadius: 8, background: 'var(--bg-surface)' }}>
            {cfg.lastOpenedAt
              ? <>Last opened the app: <strong>{simpleClock(cfg.lastOpenedAt)}</strong> {'·'} {cfg.opens7d} time{cfg.opens7d === 1 ? '' : 's'} in the last 7 days</>
              : <>{name} hasn't opened the simple screen yet.</>}
          </div>

          {/* v1.152.0 — InPlace Hub: the same screen on a tablet on the kitchen counter */}
          {hub && (
            <div data-testid="hub-settings" style={{ margin: '0 0 16px', padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border-color)', background: 'var(--bg-surface)' }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer' }}>
                <input type="checkbox" disabled={saving} checked={!!hub.on} onChange={(e) => save({ hub: { on: e.target.checked } }, e.target.checked ? 'Hub on' : 'Hub off')}
                  style={{ width: 18, height: 18, marginTop: 1, accentColor: 'var(--role-color)' }} />
                <span><strong>InPlace Hub</strong> <span style={{ color: 'var(--text-secondary)' }}>— a tablet on {name}'s counter, held sideways, shows this screen like a little TV: the date with the year, a big clock, who's here, the week ahead and who's who. The buttons are the same ones you pick here.</span></span>
              </label>
              {hub.on && (
                <div style={{ margin: '10px 0 0 26px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer' }}>
                    <input type="checkbox" disabled={saving} checked={!!hub.faces} onChange={(e) => save({ hub: { faces: e.target.checked } })} style={{ width: 16, height: 16, accentColor: 'var(--role-color)' }} />
                    <span><strong>Who's who</strong> <span style={{ color: 'var(--text-secondary)' }}>— faces and names: caregivers with the days they come, and the family</span></span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer' }}>
                    <input type="checkbox" disabled={saving} checked={!!hub.week} onChange={(e) => save({ hub: { week: e.target.checked } })} style={{ width: 16, height: 16, accentColor: 'var(--role-color)' }} />
                    <span><strong>The week ahead</strong> <span style={{ color: 'var(--text-secondary)' }}>— the next seven days of visits and appointments (off: today and tomorrow)</span></span>
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 13, color: 'var(--text-primary)' }}>
                    <strong>Night</strong> <span style={{ color: 'var(--text-secondary)' }}>— dark with a big clock from</span>
                    <input type="time" value={hub.dimFrom} disabled={saving} onChange={(e) => e.target.value && save({ hub: { dimFrom: e.target.value } })} style={{ fontSize: 13, padding: '4px 6px' }} aria-label="Night starts" />
                    <span style={{ color: 'var(--text-secondary)' }}>to</span>
                    <input type="time" value={hub.dimTo} disabled={saving} onChange={(e) => e.target.value && save({ hub: { dimTo: e.target.value } })} style={{ fontSize: 13, padding: '4px 6px' }} aria-label="Night ends" />
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
                    To set up the tablet: install InPlace Care from Google Play, sign in as {name}, and turn the tablet sideways. Pin the app (Settings → Security → Pin app) so it stays on this screen.
                  </p>
                </div>
              )}
            </div>
          )}

          {show.text && (
            <>
              <div style={sub}>Who the Text button goes to (one group)</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 6 }}>
                {cfg.candidates.map((c) => (
                  <label key={c.userId} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer' }}>
                    <input type="checkbox" disabled={saving} checked={textPicked.includes(c.userId)}
                      onChange={() => {
                        const next = textPicked.includes(c.userId) ? textPicked.filter((x) => x !== c.userId) : [...textPicked, c.userId];
                        if (next.length > (cfg.maxText || 6)) { showToast(`Pick up to ${cfg.maxText || 6} people`, 'error'); return; }
                        setTextPicked(next);
                        save({ textUserIds: next });
                      }}
                      style={{ width: 16, height: 16, accentColor: 'var(--role-color)' }} />
                    {c.firstName} {c.lastName}
                  </label>
                ))}
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 14px', lineHeight: 1.5 }}>
                {textPicked.length
                  ? `The group "${name}'s texts" is in Messages for everyone picked.`
                  : `Pick at least one person, and the Text button appears on ${name}'s screen.`}
              </p>
            </>
          )}

          {show.calls && (
            <>
              <div style={sub}>Who the call buttons ring (up to {cfg.maxCalls})</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                {cfg.candidates.map((c) => (
                  <label key={c.userId} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: c.hasPhone ? 'var(--text-primary)' : 'var(--text-muted)', cursor: c.hasPhone ? 'pointer' : 'default' }}>
                    <input type="checkbox" disabled={!c.hasPhone || saving} checked={picked.includes(c.userId)} onChange={() => togglePerson(c.userId)} style={{ width: 16, height: 16, accentColor: 'var(--role-color)' }} />
                    {c.firstName} {c.lastName}{!c.hasPhone && ' — no phone number on their account'}
                  </label>
                ))}
              </div>
            </>
          )}

          {show.notesFromFamily && (
            <>
              <div style={sub}>Leave {name} a note</div>
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
                <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 8, background: 'var(--bg-surface)', fontSize: 13, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
                  <span>
                    {lastNote.readAt ? `${name} read: ` : `On ${name}'s screen now: `}<span style={{ color: 'var(--text-primary)' }}>"{lastNote.content}"</span>
                    <br /><span style={{ fontSize: 12 }}>{noteStatusLine(lastNote, name)}</span>
                    {!lastNote.readAt && <><br /><span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Sending a new note replaces this one.</span></>}
                  </span>
                  {!lastNote.readAt && (
                    <button onClick={() => save({ clearNote: true }, `Cleared from ${name}'s screen`)} disabled={saving}
                      style={{ padding: '6px 12px', background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid #d0d0d0', borderRadius: 8, fontWeight: 600, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                      Clear
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
};
