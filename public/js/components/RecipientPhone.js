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

// ─── v1.153.0 — in-app calls on the Simple screen and InPlace Hub ───
//
// Pete, 11/23: "I want calling in app. I want her to be able to receive video and voice
// calls." Answering used to live only inside Messages, so a call to her rang nowhere she could
// pick it up, and her Call buttons handed a number to a dialer a Wi-Fi tablet does not have.
// This is the same Twilio calling Messages uses (VideoCallOverlay), hosted by her screen: a
// full-screen "Peter is calling" with one big Answer, and Call buttons that ring the person's
// InPlace app. While she has Messages open, Messages hosts calls instead (`enabled` false), so a
// call never draws twice.
const DROP_IN_ANSWER_MS = 5000; // 1.3 — the chime, then the Hub answers a drop-in by itself
const useSimpleCallHost = (enabled, { answers = true } = {}) => {
  const idle = { active: false, roomName: null, callType: null, remoteParticipantName: null, remoteParticipantPhoto: null, callDirection: null, otherId: null };
  const [callState, setCallState] = useState(idle);
  const [incoming, setIncoming] = useState(null);
  const [ringStatus, setRingStatus] = useState(null);
  const activeRef = React.useRef(false);
  activeRef.current = callState.active;
  // 1.3 — join a call already answered on the phone's own call screen.
  const joinRef = React.useRef(() => {});
  joinRef.current = (c) => {
    if (!c || !c.roomName) return;
    setIncoming(null);
    setCallState({ active: true, roomName: c.roomName, callType: c.callType, remoteParticipantName: c.callerName, remoteParticipantPhoto: c.callerPhoto || null, callDirection: 'incoming', otherId: c.callerId });
    if (window._socket) window._socket.emit('call_accept', { callerId: c.callerId, roomName: c.roomName });
  };

  useEffect(() => {
    if (!enabled || typeof onSocketEvent !== 'function') return undefined;
    // A call that arrived as a push while the screen was off (app.js parks it here).
    // v1.155.2 — app.js now also parks a call that rang over the live socket (stamped `at`);
    // this screen already heard that one directly, so only a fresh, unseen one is picked up.
    const pickUp = () => {
      if (!answers) return;
      try {
        const pc = window.__pendingCall;
        // 1.3 — answered on the phone's own call screen (Android full-screen ring, CallKit):
        // join at once; nobody should have to press Answer twice.
        if (pc && pc.answeredNatively) { window.__pendingCall = null; joinRef.current(pc); return; }
        if (pc) { window.__pendingCall = null; if (!pc.at || Date.now() - pc.at < 30000) setIncoming((cur) => cur || pc); }
      } catch { /* nothing waiting */ }
    };
    pickUp();
    window.addEventListener('inplace:pending-call', pickUp); // v1.156.1 — a push tap while open
    window.addEventListener('inplace:native-call-answered', pickUp); // 1.3
    const offs = [
      onSocketEvent('call_ring_status', (d) => setRingStatus(d?.via || null)),
      answers && onSocketEvent('call_incoming', (d) => {
        if (typeof warmVideoSdk === 'function') warmVideoSdk();
        if (activeRef.current) return;
        // 1.3 — the phone itself is ringing (InPlace not on screen, or iOS): one way to answer.
        if (window.NativeCalls && window.NativeCalls.ringsHere && window.NativeCalls.ringsHere(d)) return;
        setIncoming(d);
        setTimeout(() => setIncoming((p) => (p && p.roomName === d.roomName ? null : p)), 45000);
      }),
      onSocketEvent('call_ended', () => { setIncoming(null); setCallState(idle); }),
      onSocketEvent('call_declined', () => { setIncoming(null); setCallState(idle); }),
      // v1.156.1 — answered on another of this person's devices: stop ringing here.
      onSocketEvent('call_answered_elsewhere', (d) => setIncoming((p) => (p && p.roomName === d?.roomName ? null : p))),
    ];
    return () => { offs.forEach((o) => o && o()); window.removeEventListener('inplace:pending-call', pickUp); window.removeEventListener('inplace:native-call-answered', pickUp); };
  }, [enabled]);

  // Ring out loud while the card is up: a call is the one thing allowed to make a noise.
  useEffect(() => {
    if (!incoming || incoming.dropIn) return undefined;
    let ctx = null; let timer = null; let stopped = false;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        ctx = new Ctx();
        if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(() => {});
        const burst = () => {
          if (stopped || !ctx) return;
          [0, 0.5].forEach((off) => {
            const t0 = ctx.currentTime + off;
            const osc = ctx.createOscillator(); const gain = ctx.createGain();
            osc.type = 'sine'; osc.frequency.setValueAtTime(880, t0);
            gain.gain.setValueAtTime(0, t0); gain.gain.linearRampToValueAtTime(0.25, t0 + 0.04);
            gain.gain.setValueAtTime(0.25, t0 + 0.34); gain.gain.linearRampToValueAtTime(0, t0 + 0.4);
            osc.connect(gain); gain.connect(ctx.destination); osc.start(t0); osc.stop(t0 + 0.45);
          });
        };
        burst(); timer = setInterval(burst, 3000);
      }
    } catch { /* no audio — the card is still there */ }
    return () => { stopped = true; if (timer) clearInterval(timer); try { if (ctx && ctx.close) ctx.close(); } catch { /* gone */ } };
  }, [incoming]);

  // 1.3 — opts.dropIn: a drop-in on a Hub (video; the server checks the signed consent and the
  // leader's choice, and the Hub answers by itself after a chime).
  const startCall = (person, callType, opts = {}) => {
    if (!person || !window._socket) return false;
    if (typeof warmVideoSdk === 'function') warmVideoSdk();
    const roomName = 'inplace-simple-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    if (opts.dropIn) callType = 'video';
    window._socket.emit('call_invite', { targetUserId: person.userId, roomName, callType, ...(opts.dropIn ? { dropIn: true } : {}) });
    setRingStatus(null);
    setCallState({ active: true, roomName, callType, remoteParticipantName: person.firstName, remoteParticipantPhoto: person.photo || null, callDirection: 'outgoing', otherId: person.userId });
    return true;
  };
  const answer = () => {
    if (!incoming) return;
    setCallState({ active: true, roomName: incoming.roomName, callType: incoming.callType, remoteParticipantName: incoming.callerName, remoteParticipantPhoto: incoming.callerPhoto || null, callDirection: 'incoming', otherId: incoming.callerId });
    if (window._socket) window._socket.emit('call_accept', { callerId: incoming.callerId, roomName: incoming.roomName });
    setIncoming(null);
  };
  const decline = () => {
    if (incoming && window._socket) window._socket.emit('call_decline', { callerId: incoming.callerId, roomName: incoming.roomName });
    setIncoming(null);
  };
  // 1.3 — a drop-in (the server already checked the signed consent): the doorbell chime, who is
  // checking in, and the Hub answers by itself a few seconds later. "Not now" still declines.
  const answerRef = React.useRef(answer);
  answerRef.current = answer;
  useEffect(() => {
    if (!incoming || !incoming.dropIn) return undefined;
    try { if (typeof playDoorbell === 'function') playDoorbell(); } catch { /* no sound */ }
    const t = setTimeout(() => answerRef.current(), DROP_IN_ANSWER_MS);
    return () => clearTimeout(t);
  }, [incoming && incoming.roomName, incoming && incoming.dropIn]);
  const endCall = () => {
    if (callState.active && callState.otherId && window._socket) {
      window._socket.emit('call_hangup', { targetUserId: callState.otherId, roomName: callState.roomName });
    }
    setCallState(idle);
  };

  let ui = null;
  if (enabled && (incoming || callState.active)) {
    const first = incoming ? String(incoming.callerName || 'Someone').split(' ')[0] : '';
    const card = incoming ? (
      <div role="dialog" aria-label={`${first} is calling`} data-testid="simple-incoming-call" className="no-text-scale"
        style={{ position: 'fixed', inset: 0, zIndex: 10050, background: '#1f1a16', color: '#f3ebe0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 'min(4vh, 28px)', padding: 24, textAlign: 'center' }}>
        <SimpleFace photo={incoming.callerPhoto} name={first} size={Math.round(Math.min(window.innerHeight * 0.26, 220))} ring="#e8b04a" />
        <div style={{ fontSize: 'min(7vh, 48px)', fontWeight: 800 }} data-testid={incoming.dropIn ? 'simple-drop-in' : undefined}>{incoming.dropIn ? `${first} is checking in` : `${first} is calling`}</div>
        <div style={{ fontSize: 'min(3.6vh, 26px)', color: '#cbbfae' }}>{incoming.dropIn ? 'Video, starting in a moment' : incoming.callType === 'video' ? 'Video call' : 'Voice call'}</div>
        <button onClick={answer} data-testid="simple-answer-call"
          style={{ minWidth: 'min(70vw, 520px)', minHeight: 'min(14vh, 110px)', borderRadius: 60, border: 'none', background: '#1b7a3d', color: '#fff', fontSize: 'min(6vh, 42px)', fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
          {'📞'} Answer
        </button>
        <button onClick={decline}
          style={{ minHeight: 56, padding: '0 36px', borderRadius: 40, border: '2px solid #6b5d4f', background: 'transparent', color: '#f3ebe0', fontSize: 'min(3.6vh, 24px)', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
          Not now
        </button>
      </div>
    ) : null;
    const overlay = callState.active && typeof VideoCallOverlay !== 'undefined'
      ? React.createElement(VideoCallOverlay, { callState, onEndCall: endCall, currentUserId: null, ringStatus })
      : null;
    const node = <>{card}{overlay}</>;
    ui = typeof ReactDOM !== 'undefined' && ReactDOM.createPortal ? ReactDOM.createPortal(node, document.body) : node;
  }
  return { startCall, ui, busy: !!(incoming || callState.active) };
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
  // v1.153.2 — "Thanksgiving dinner at Peter and Debbie's" with location "Peter and Debbie's"
  // read twice on the tablet. The location is added only when the title doesn't already say it.
  const loc = c.location && !String(c.title || '').toLowerCase().includes(String(c.location).toLowerCase()) ? c.location : '';
  return `${c.title}${loc ? ` at ${loc}` : ''}`;
};

// v1.153.1 — Betty's account has Large text on, and the text-size rule (`div { font-size:
// inherit !important }`) flattened every size on the board: the clock came out the size of the
// date. The Hub is drawn to the screen in vh, so its roots carry `no-text-scale`, which
// styles.css excludes from that rule. tests/hubNoTextScale.test.js pins both halves.

// v1.153.1 — Pete: "I prefer the green color scheme because it's easier to read." The care
// recipient's role colour is purple; the Hub is always green.
const HUB_THEME = { '--role-color': '#1b6b5a', '--role-color-light': '#e1f0eb', '--text-on-primary': '#ffffff' };

// v1.155.0 — photos on the Hub. The team chose these for her screen (a family member adds one,
// or switches one on; a caregiver ticks "Show on <name>'s screen" at check-out). The newest is
// shown big with who sent it and when, and it moves on to the next every 20 seconds.
const hubPhotoWhen = (iso, now) => {
  const t = new Date(iso);
  if (isNaN(t)) return '';
  const day = (d) => { const x = new Date(d); x.setHours(12, 0, 0, 0); return x; };
  const diff = Math.round((day(now) - day(t)) / 86400000);
  if (diff <= 0) { const h = t.getHours(); return h < 12 ? 'this morning' : h < 17 ? 'this afternoon' : 'this evening'; }
  if (diff === 1) return 'yesterday';
  if (diff < 7) return 'on ' + t.toLocaleDateString('en-US', { weekday: 'long' });
  return 'on ' + t.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
};
const HUB_PHOTO_MS = 20000;
const HubPhoto = ({ photos, now, card, stored, onShape }) => {
  const [i, setI] = React.useState(0);
  const [broken, setBroken] = React.useState({});
  // v1.155.1 — a photo framed for the screen (from Add photo) fills its space; anything else
  // (a tall phone photo, a caregiver's visit photo) shows whole.
  // v1.155.2 — Pete: "What I crop to isn't the same aspect as on the screen."
  // v1.155.3 — and "I liked the old half-screen view": the photo fills the column again, and
  // instead of forcing a fixed shape the Hub measures its photo space and reports the shape
  // (onShape → simple_mode.hub.photoAspect). Add photo frames to that measured shape.
  const boxRef = React.useRef(null);
  const [slot, setSlot] = React.useState(null);
  React.useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const measure = () => { const r = el.getBoundingClientRect(); if (r.width > 50 && r.height > 50) setSlot(r.width / r.height); };
    measure();
    let ro = null;
    try { ro = new ResizeObserver(measure); ro.observe(el); } catch { /* measured once */ }
    return () => { try { ro && ro.disconnect(); } catch { /* gone */ } };
  });
  React.useEffect(() => {
    if (!slot || !onShape) return;
    if (stored && Math.abs(stored - slot) < 0.03) return;
    const t = setTimeout(() => onShape(slot), 3000); // let the layout settle first
    return () => clearTimeout(t);
  }, [slot && Math.round(slot * 100), stored]);
  const [fills, setFills] = React.useState({});
  const list = (photos || []).filter((p) => !broken[p.kind + p.id]);
  const key = list.map((p) => p.id).join(',');
  React.useEffect(() => { setI(0); }, [key]);
  React.useEffect(() => {
    if (list.length < 2) return undefined;
    const iv = setInterval(() => setI((n) => n + 1), HUB_PHOTO_MS);
    return () => clearInterval(iv);
  }, [key]);
  if (!list.length) return null;
  const p = list[i % list.length];
  const when = hubPhotoWhen(p.createdAt, now);
  return (
    // v1.155.5 — Pete: "tapping the picture advances to the next picture."
    <div ref={boxRef} data-testid="hub-photo" onClick={() => setI((n) => n + 1)} style={{ cursor: list.length > 1 ? 'pointer' : 'default', ...card, padding: 0, flex: '1 1 auto', minHeight: '26vh', position: 'relative', overflow: 'hidden', background: '#000', flexShrink: 1 }}>
      <img key={p.kind + p.id} src={p.url} alt={p.caption || (p.from ? `Photo from ${p.from}` : 'Photo')}
        onError={() => setBroken((b) => ({ ...b, [p.kind + p.id]: true }))}
        onLoad={(e) => { const r = e.target.naturalWidth / (e.target.naturalHeight || 1); const k = p.kind + p.id; const f = Math.abs(r - (slot || stored || r)) < 0.12; setFills((m) => (m[k] === f ? m : { ...m, [k]: f })); }}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: fills[p.kind + p.id] ? 'cover' : 'contain' }} />
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '5vh 2.4vh 1.6vh', background: 'linear-gradient(transparent, rgba(0,0,0,0.75))', color: '#fff' }}>
        {p.caption && <div style={{ fontSize: '4vh', fontWeight: 800, lineHeight: 1.2, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.caption}</div>}
        <div style={{ fontSize: '3.2vh', opacity: 0.9 }}>{p.from ? `From ${p.from}` : 'A photo'}{when ? ` · ${when}` : ''}</div>
      </div>
    </div>
  );
};

// v1.155.2 — "Tina will be here soon". Pete: "Yes to the Chime and card with photo. Maybe a
// pop up style that disappears either after she checks it [off] or Tina checks in." The server
// sends `hub.arriving` from 15 minutes before a confirmed visit until it is checked in; this
// card covers the board with a doorbell chime (again every 5 minutes, three times at most)
// until she taps OK. OK is remembered for that visit on this tablet.
const ARRIVING_CHIME_EVERY_MS = 5 * 60000;
const ARRIVING_CHIMES = 3;
const playDoorbell = () => {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(() => {});
    [[659.25, 0], [523.25, 0.45]].forEach(([f, off]) => {
      const t0 = ctx.currentTime + off;
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.type = 'sine'; osc.frequency.setValueAtTime(f, t0);
      gain.gain.setValueAtTime(0, t0); gain.gain.linearRampToValueAtTime(0.3, t0 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 1.1);
      osc.connect(gain); gain.connect(ctx.destination); osc.start(t0); osc.stop(t0 + 1.15);
    });
    setTimeout(() => { try { ctx.close(); } catch { /* gone */ } }, 2500);
  } catch { /* no audio — the card is still there */ }
};
// v1.155.4 — Pete, on the mockup: "go with the pop ups automatically. they look great." One
// pop-up at a time, about 75% of the screen, a chime, one big answer. In order of importance:
//   arrival      "Tina will be here soon"            OK               (until OK or check-in)
//   message      "Message from Peter" + the words     Got it / Write back
//   appointment  "In 1 hour · Haircut at Angie's"     OK               (the hour before)
//   photo        a new photo for her screen, shown big OK
// Dismissing a pop-up is remembered on this tablet per item; the board keeps showing the item
// in its usual place. Nothing pops up during her night hours — it waits for the morning, if it
// still matters then. Photos already there when the Hub loads are not announced (no flood
// the first time it is set up, or after an update reloads it).
const popSeen = (k) => { try { return localStorage.getItem('inplace-hub-pop-' + k) === '1'; } catch { return false; } };
const popMark = (k) => { try { localStorage.setItem('inplace-hub-pop-' + k, '1'); } catch { /* this session only */ } };
const HubPopup = ({ popKey, chimes, face, name, kicker, head, sub, img, buttons }) => {
  React.useEffect(() => {
    let n = 0;
    const ring = () => { if (n < chimes) { n += 1; playDoorbell(); } };
    ring();
    const iv = setInterval(ring, ARRIVING_CHIME_EVERY_MS);
    return () => clearInterval(iv);
  }, [popKey]);
  const btnStyle = (primary) => ({
    flex: 1, minHeight: '12vh', borderRadius: '3vh', fontSize: '5.4vh', fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
    border: primary ? 'none' : '3px solid var(--border-color)', background: primary ? 'var(--role-color)' : 'var(--bg-card)', color: primary ? 'var(--text-on-primary)' : 'var(--text-primary)',
  });
  return (
    <div data-testid="hub-popup" data-kind={popKey.split(':')[0]} className="no-text-scale"
      style={{ ...HUB_THEME, position: 'fixed', inset: 0, zIndex: 900, background: 'rgba(16, 40, 33, 0.82)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="hub-new-shimmer"
        style={{ width: '78vw', height: '78vh', boxSizing: 'border-box', background: 'var(--bg-surface)', borderRadius: '4vh', padding: '4vh 5vh', display: 'flex', flexDirection: 'column', gap: '3vh', border: '4px solid var(--role-color)' }}>
        <div style={{ display: 'flex', alignItems: img ? 'stretch' : 'center', gap: '4vh', flex: 1, minHeight: 0 }}>
          {img
            ? <img src={img} alt="" style={{ height: '100%', maxWidth: '55%', objectFit: 'contain', borderRadius: '2vh', background: '#000', flex: 'none' }} />
            : <SimpleFace photo={face} name={name} size={Math.round(window.innerHeight * 0.26)} ring="var(--role-color)" />}
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            {kicker && <div style={{ fontSize: '4vh', fontWeight: 700, color: 'var(--role-color)' }}>{kicker}</div>}
            <div style={{ fontSize: '7vh', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.15, overflowWrap: 'anywhere', display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{head}</div>
            {sub && <div style={{ fontSize: '4.6vh', color: 'var(--text-secondary)', marginTop: '1.2vh' }}>{sub}</div>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '3vh' }}>
          {buttons.map((b, i) => (
            <button key={b.label} data-testid={'hub-popup-' + (i ? 'second' : 'ok')} onClick={b.onClick} style={btnStyle(i === 0)}>{b.label}</button>
          ))}
        </div>
      </div>
    </div>
  );
};

const HubPopups = ({ hub, s, note, now, onRead, onAck, onText }) => {
  const [, bump] = React.useState(0);
  const done = (k) => { popMark(k); bump((n) => n + 1); };
  // Photos already on the board when it loads are not news (no flood on setup or after an
  // update). Done before the first draw, so a pop-up never flashes and chimes for one.
  React.useState(() => { for (const p of (hub.photos || [])) popMark('photo:' + p.kind + p.id); return true; });
  if (hubIsNight(now, hub.dimFrom, hub.dimTo)) return null;

  const a = hub.arriving;
  if (a && !popSeen('arrive:' + a.sessionId)) {
    const k = 'arrive:' + a.sessionId;
    return <HubPopup key={k} popKey={k} chimes={ARRIVING_CHIMES} face={a.photo} name={a.firstName}
      kicker="On the way" head={`${a.firstName} will be here soon`} sub={a.time ? `at ${simpleFmtTime(a.time)}` : null}
      buttons={[{ label: 'OK', onClick: () => done(k) }]} />;
  }
  if (note && !popSeen('note:' + note.id)) {
    const k = 'note:' + note.id;
    return <HubPopup key={k} popKey={k} chimes={ARRIVING_CHIMES} face={note.fromPhoto} name={note.from}
      kicker={`From ${note.from}`} head={note.content}
      buttons={[{ label: 'I read it', onClick: () => { done(k); onRead(note.id); } }, { label: 'Later', onClick: () => done(k) }]} />;
  }
  const waiting = s.text && Array.isArray(s.text.waiting) && s.text.waiting.length ? s.text.waiting[s.text.waiting.length - 1] : null;
  if (waiting && !popSeen('msg:' + waiting.id)) {
    const k = 'msg:' + waiting.id;
    return <HubPopup key={k} popKey={k} chimes={ARRIVING_CHIMES} face={waiting.fromPhoto} name={waiting.from}
      kicker={waiting.isReply ? `${waiting.from} wrote back` : `Message from ${waiting.from}`} head={waiting.content}
      buttons={[{ label: 'Got it', onClick: () => { done(k); onAck(); } }, { label: 'Write back', onClick: () => { done(k); onText(); } }]} />;
  }
  // An appointment or plan today within the next hour.
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const appt = (hub.days || []).find((d) => {
    if (d.kind === 'visit' || d.date !== hub.today || !d.time) return false;
    const [h, m] = d.time.split(':').map(Number);
    const left = h * 60 + m - nowMin;
    return left >= 0 && left <= 60 && !popSeen('appt:' + d.id);
  });
  if (appt) {
    const k = 'appt:' + appt.id;
    const [h, m] = appt.time.split(':').map(Number);
    const left = h * 60 + m - nowMin;
    return <HubPopup key={k} popKey={k} chimes={1} face={null} name={appt.title || 'Today'}
      kicker={left <= 5 ? 'Now' : left >= 55 ? 'In 1 hour' : `In ${left} minutes`} head={hubLine(appt)} sub={`at ${simpleFmtTime(appt.time)}`}
      buttons={[{ label: 'OK', onClick: () => done(k) }]} />;
  }
  const photo = (hub.showPhotos !== false && hub.photos && hub.photos[0]) || null;
  if (photo && !popSeen('photo:' + photo.kind + photo.id)) {
    const k = 'photo:' + photo.kind + photo.id;
    return <HubPopup key={k} popKey={k} chimes={1} img={photo.url}
      kicker={photo.from ? `New photo from ${photo.from}` : 'A new photo'} head={photo.caption || 'A new photo for you'}
      buttons={[{ label: 'OK', onClick: () => done(k) }]} />;
  }
  return null;
};

const HUB_WAKE_MS = 60000;    // v1.155.4 — a tap at night brightens the board this long
const PANEL_IDLE_MS = 90000;  // v1.155.1 — an open panel goes home after this long untouched
const SENT_HOME_MS = 3000;    // ...and this soon after a text is sent

// v1.155.5 — Pete picked "Daylight sky" from the mockup: the board's background follows the
// day, "maybe the evening fades to a darker blue though." Soft gold in the morning, clear blue
// in the afternoon, deepening blue through the evening. Cards stay near-white so every word
// keeps its contrast; the night screen is unchanged.
const SKY_STOPS = [
  // [hour, top colour, bottom colour]
  [5, '#fff4dc', '#fde3ae'],
  [11, '#f1f7fd', '#d6e8f7'],
  [16, '#e6effa', '#c4d8f0'],
  [18, '#d3def3', '#a9bfe6'],
  [21, '#b9c8ea', '#8ea6d8'],
];
const mixHex = (a, b, t) => {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const x = p(a), y = p(b);
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
};
const hubSky = (now) => {
  const h = now.getHours() + now.getMinutes() / 60;
  let lo = SKY_STOPS[0], hi = SKY_STOPS[SKY_STOPS.length - 1];
  for (let k = 0; k < SKY_STOPS.length - 1; k += 1) if (h >= SKY_STOPS[k][0] && h < SKY_STOPS[k + 1][0]) { lo = SKY_STOPS[k]; hi = SKY_STOPS[k + 1]; }
  if (h < SKY_STOPS[0][0]) hi = lo;
  if (h >= SKY_STOPS[SKY_STOPS.length - 1][0]) lo = hi;
  const t = hi[0] === lo[0] ? 0 : (h - lo[0]) / (hi[0] - lo[0]);
  return `linear-gradient(165deg, ${mixHex(lo[1], hi[1], t)} 0%, ${mixHex(lo[2], hi[2], t)} 100%)`;
};
// v1.155.5 — weather at the care location (src/utils/weather.js), drawn with emoji like the
// rest of the Simple screen.
const WX_EMOJI = { clear: '\u2600\uFE0F', partly: '\u26C5', cloud: '\u2601\uFE0F', fog: '\u{1F32B}\uFE0F', rain: '\u{1F327}\uFE0F', snow: '\u2744\uFE0F', storm: '\u26C8\uFE0F' };
const wxEmoji = (icon, isDay) => (icon === 'clear' && isDay === false ? '\u{1F319}' : (WX_EMOJI[icon] || WX_EMOJI.cloud));
const WEATHER_SHOW_MS = 10000;
const HubWeather = ({ wx, onClose }) => {
  React.useEffect(() => { const t = setTimeout(onClose, WEATHER_SHOW_MS); return () => clearTimeout(t); }, []);
  const t = wx.today;
  return (
    <div data-testid="hub-weather" className="no-text-scale" onClick={onClose}
      style={{ ...HUB_THEME, position: 'fixed', inset: 0, zIndex: 880, background: 'rgba(10, 30, 50, 0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
      <div style={{ width: '78vw', height: '76vh', boxSizing: 'border-box', background: '#f4f8fc', borderRadius: '4vh', border: '4px solid #2a6db5', padding: '4vh 5vh', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', color: '#0c3a66' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4vh' }}>
          <div style={{ fontSize: '22vh', lineHeight: 1 }} aria-hidden="true">{wxEmoji(t.icon, true)}</div>
          <div>
            <div style={{ fontSize: '4.4vh', fontWeight: 700 }}>Today</div>
            <div style={{ fontSize: '13vh', fontWeight: 800, lineHeight: 1 }}>{t.hi}{'\u00B0'} <span style={{ fontSize: '6vh', fontWeight: 700 }}>/ {t.lo}{'\u00B0'}</span></div>
            <div style={{ fontSize: '5.4vh', fontWeight: 700 }}>{t.label}{t.rainChance >= 40 ? ` \u00B7 ${t.rainChance}% chance of rain` : ''}</div>
          </div>
        </div>
        {(wx.parts || []).length > 0 && (
          <div style={{ display: 'flex', gap: '2.4vh' }}>
            {wx.parts.map((p) => (
              <div key={p.name} style={{ flex: 1, background: '#e3eefa', borderRadius: '2.4vh', padding: '1.6vh 0', textAlign: 'center' }}>
                <div style={{ fontSize: '3.8vh', fontWeight: 700 }}>{p.name}</div>
                <div style={{ fontSize: '6vh', fontWeight: 800 }}><span aria-hidden="true">{wxEmoji(p.icon, p.name !== 'Evening')}</span> {p.temp}{'\u00B0'}</div>
              </div>
            ))}
          </div>
        )}
        <div style={{ height: '1.2vh', background: '#c4dcf3', borderRadius: '1vh', overflow: 'hidden' }}>
          <div className="hub-weather-bar" style={{ height: '100%', background: '#2a6db5', animation: `hubWeatherBar ${WEATHER_SHOW_MS}ms linear forwards` }} />
        </div>
      </div>
    </div>
  );
};

// ─── HubHeartbeat (v1.158.0) — a Hub nobody touches keeps itself current ───
// Pete, 11/24: "does the app refresh itself?" A phone gets a new version the next time the app
// opens; the Hub never closes, so it never did. Now it:
//   • reports every 2 min — version, locked to InPlace, battery — for the status line in
//     Hub settings (server keeps it in memory only, utils/hubStatus.js);
//   • checks /api/version every 10 min and reloads itself onto a new version at a quiet moment:
//     no call, and nobody has touched the screen for 3 minutes. Once per version, so a reload
//     that comes back on the old version can never loop;
//   • reloads when the family taps "Refresh the Hub" (socket hub_refresh) — after a call, never
//     in the middle of one.
const HUB_REPORT_MS = 2 * 60 * 1000;
const HUB_VERSION_MS = 10 * 60 * 1000;
const HUB_QUIET_MS = 3 * 60 * 1000;
function hubReload() {
  try {
    if (window.caches) { caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))).finally(() => window.location.reload()); return; }
  } catch { /* fall through */ }
  window.location.reload();
}
function HubHeartbeat({ recipientId, busy }) {
  const busyRef = React.useRef(busy);
  busyRef.current = busy;
  const wantReload = React.useRef(false);
  const lastTouch = React.useRef(Date.now());
  React.useEffect(() => {
    if (!recipientId) return undefined;
    const onTouch = () => { lastTouch.current = Date.now(); };
    document.addEventListener('pointerdown', onTouch, true);
    const report = async () => {
      const body = { version: window.APP_VERSION || null };
      try {
        const C = window.Capacitor;
        const k = C && C.isNativePlatform && C.isNativePlatform() && C.Plugins && C.Plugins.InPlaceKiosk;
        if (k && k.getStatus) { const st = await k.getStatus(); body.kiosk = { deviceOwner: !!st.deviceOwner, locked: !!st.locked }; }
      } catch { /* not a Hub tablet build */ }
      try {
        if (navigator.getBattery) { const b = await navigator.getBattery(); body.battery = { level: Math.round(b.level * 100), charging: !!b.charging }; }
      } catch { /* no battery reading */ }
      try { await apiFetch(`/api/care-recipients/${recipientId}/simple-screen/hub-status`, { method: 'POST', body: JSON.stringify(body) }); } catch { /* next time */ }
    };
    const quiet = () => !busyRef.current && Date.now() - lastTouch.current > HUB_QUIET_MS;
    const checkVersion = async () => {
      try {
        const r = await fetch('/api/version', { cache: 'no-store' });
        if (!r.ok) return;
        const d = await r.json();
        if (!d.version || d.version === window.APP_VERSION) return;
        const KEY = 'inplace_hub_reloaded_for';
        let tried = null;
        try { tried = sessionStorage.getItem(KEY); } catch { /* private mode */ }
        if (tried === d.version) return; // reloaded for this one already; don't loop
        wantReload.current = d.version;
      } catch { /* offline: try later */ }
    };
    const maybeReload = () => {
      if (wantReload.current && quiet()) {
        try { if (typeof wantReload.current === 'string') sessionStorage.setItem('inplace_hub_reloaded_for', wantReload.current); } catch { /* ok */ }
        hubReload();
      }
    };
    report();
    const t1 = setInterval(report, HUB_REPORT_MS);
    const t2 = setInterval(checkVersion, HUB_VERSION_MS);
    const t3 = setInterval(maybeReload, 30 * 1000);
    const first = setTimeout(checkVersion, 60 * 1000);
    const off = typeof onSocketEvent === 'function' ? onSocketEvent('hub_refresh', () => {
      if (!busyRef.current) hubReload(); else wantReload.current = true;
    }) : null;
    return () => {
      document.removeEventListener('pointerdown', onTouch, true);
      clearInterval(t1); clearInterval(t2); clearInterval(t3); clearTimeout(first);
      if (off) off();
    };
  }, [recipientId]);
  // A family-asked refresh waits only for the call to end, not for 3 quiet minutes.
  React.useEffect(() => { if (!busy && wantReload.current === true) hubReload(); }, [busy]);
  return null;
}

// v1.158.0 — "Online · seen 2 min ago · version 1.158.0 · locked · charging 100%", and Refresh.
function HubStatusLine({ status, name, recipientId }) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const ago = (iso) => {
    const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    return h < 24 ? `${h} hr ago` : `${Math.round(h / 24)} days ago`;
  };
  const refresh = async () => {
    setBusy(true);
    try {
      const r = await apiFetch(`/api/care-recipients/${recipientId}/simple-screen/hub-refresh`, { method: 'POST', body: '{}' });
      const d = r ? await r.json().catch(() => ({})) : {};
      if (r && r.ok) showToast(d.sent ? 'The Hub is refreshing' : "The Hub isn't connected right now", d.sent ? 'success' : 'error');
      else showToast(d.error || "Couldn't reach the Hub", 'error');
    } catch { showToast("Couldn't reach the Hub", 'error'); }
    setBusy(false);
  };
  const bits = [];
  if (status) {
    bits.push(status.online ? `Online · seen ${ago(status.at)}` : `Offline · last seen ${ago(status.at)}`);
    if (status.version) bits.push(`version ${status.version}`);
    if (status.kiosk && status.kiosk.deviceOwner) bits.push(status.kiosk.locked ? 'locked to InPlace' : 'not locked');
    if (status.battery) bits.push(`${status.battery.charging ? 'charging' : 'on battery'} ${status.battery.level}%`);
  }
  const offline = !status || !status.online;
  const unplugged = status && status.battery && !status.battery.charging;
  return (
    <div data-testid="hub-status" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12.5, padding: '6px 8px', borderRadius: 8, background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
      <span style={{ color: offline || unplugged ? 'var(--color-error)' : 'var(--text-secondary)' }}>
        {status ? bits.join(' · ') : `No report from ${name}'s Hub yet`}
      </span>
      <button type="button" disabled={busy} onClick={refresh} data-testid="hub-refresh"
        style={{ marginLeft: 'auto', padding: '4px 10px', borderRadius: 6, border: '1px solid var(--role-color)', background: 'none', color: 'var(--role-color)', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
        {'\u21BB'} Refresh the Hub
      </button>
    </div>
  );
}

// ─── HubKiosk (1.3) — keep the tablet on InPlace ───
// Tells the Android app the family's "Keep the tablet on InPlace" choice each time the Hub loads
// or the choice changes. The app acts on it only on a tablet set up as a Hub (device owner, one
// adb command); everywhere else — every phone, every browser, the 1.2 build without the plugin —
// this does nothing at all.
function HubKiosk({ on }) {
  React.useEffect(() => {
    try {
      const C = window.Capacitor;
      if (!C || !C.isNativePlatform || !C.isNativePlatform()) return;
      if (typeof C.isPluginAvailable === 'function' && !C.isPluginAvailable('InPlaceKiosk')) return;
      const k = C.Plugins && C.Plugins.InPlaceKiosk;
      if (k && k.set) k.set({ on: !!on }).catch(() => {});
    } catch { /* not a Hub tablet */ }
  }, [on]);
  return null;
}

// v1.156.0 — noticing when she is up. Pete: "don't record audio. Speaking enough to be awake,
// call it 10 seconds, should be noted and with movement or other noise be considered awake."
// Runs only when the server says so (hub.noticeAwake: a signed consent and the leader's switch),
// never during a call (the call needs the camera), and only on the Hub itself.
// Nothing leaves the tablet but, once a minute: was there movement, how many seconds sounded
// like talking, how many touches. Frames are compared in memory at 64×48 and thrown away; the
// microphone is only measured for loudness in the speech band. Nothing is recorded or saved.
const AWAKE_TICK_MS = 1000;
const AWAKE_REPORT_MS = 60000;
const MOTION_PIXEL_DELTA = 28;   // a pixel "changed" if its brightness moved this much
const MOTION_SHARE = 0.02;       // ...and a frame "moved" if 2% of pixels changed
const VOICE_OVER_FLOOR = 2.2;    // speech-band loudness this many times the room's quiet level
const HubAwake = ({ recipientId }) => {
  React.useEffect(() => {
    // Touches anywhere on the Hub — the night screen included — count as "she's up".
    let touches = 0;
    const onTouch = () => { touches += 1; };
    document.addEventListener('pointerdown', onTouch, true);
    const touchesRef = { get current() { return touches; }, set current(v) { touches = v; } };
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !recipientId) return undefined;
    let stream = null, ctx = null, analyser = null, tick = null, report = null, stopped = false;
    let prev = null, motion = false, voiceSec = 0, floor = null;
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 48;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    const video = document.createElement('video'); video.muted = true; video.playsInline = true;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: 160, height: 120, frameRate: 5 }, audio: { echoCancellation: false, noiseSuppression: false } });
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        video.srcObject = stream; await video.play().catch(() => {});
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx && stream.getAudioTracks().length) {
          ctx = new Ctx();
          analyser = ctx.createAnalyser(); analyser.fftSize = 1024;
          ctx.createMediaStreamSource(stream).connect(analyser);
        }
      } catch (e) {
        // No camera yet (the tablet app before 1.3) or permission refused: report once, then nothing.
        try { reportClientError(e, { page: 'hub-awake' }); } catch (_) { /* nothing */ }
        return;
      }
      const bins = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
      tick = setInterval(() => {
        try {
          g.drawImage(video, 0, 0, 64, 48);
          const px = g.getImageData(0, 0, 64, 48).data;
          const lum = new Uint8Array(64 * 48);
          for (let i = 0, j = 0; i < px.length; i += 4, j += 1) lum[j] = (px[i] * 3 + px[i + 1] * 6 + px[i + 2]) / 10;
          if (prev) {
            let changed = 0;
            for (let j = 0; j < lum.length; j += 1) if (Math.abs(lum[j] - prev[j]) > MOTION_PIXEL_DELTA) changed += 1;
            if (changed / lum.length > MOTION_SHARE) motion = true;
          }
          prev = lum;
        } catch { /* a dropped frame */ }
        if (analyser && bins) {
          analyser.getByteFrequencyData(bins);
          const hz = (ctx.sampleRate / 2) / bins.length;
          let sum = 0, n = 0;
          for (let k = Math.floor(300 / hz); k < Math.min(bins.length, Math.ceil(3400 / hz)); k += 1) { sum += bins[k]; n += 1; }
          const level = n ? sum / n : 0;
          floor = floor == null ? level : Math.min(level, floor * 0.995 + level * 0.005); // slow-rising quiet level
          if (level > Math.max(6, floor * VOICE_OVER_FLOOR)) voiceSec += AWAKE_TICK_MS / 1000;
        }
      }, AWAKE_TICK_MS);
      report = setInterval(() => {
        const touches = touchesRef.current; touchesRef.current = 0;
        const body = { motion, voiceSeconds: Math.round(voiceSec), touches };
        motion = false; voiceSec = 0;
        if (!body.motion && body.voiceSeconds < 10 && !body.touches) return;
        apiFetch(`/api/drop-in/${recipientId}/awake`, { method: 'POST', body: JSON.stringify(body) }).catch(() => {});
      }, AWAKE_REPORT_MS);
    })();
    return () => {
      stopped = true;
      clearInterval(tick); clearInterval(report);
      try { stream && stream.getTracks().forEach((t) => t.stop()); } catch { /* gone */ }
      try { ctx && ctx.close(); } catch { /* gone */ }
      document.removeEventListener('pointerdown', onTouch, true);
    };
  }, [recipientId]);
  return null;
};

const HubBoard = ({ hub, first, now, show, calls, note, s, failed, readFlash, reading, acking, unread, awake, onWake, onRead, onAck, onText, onMessages, onCall, onHubShape }) => {
  const [showWx, setShowWx] = React.useState(false); // before the night return: hooks first
  const today = hub.today;
  const days = hub.days || [];
  const dateLine = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
  const clock = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const [clockNum, clockAp] = clock.split(' ');
  const part = now.getHours() < 12 ? 'Morning' : now.getHours() < 17 ? 'Afternoon' : 'Evening';
  const later = days.filter((d) => d.date > today);

  // ── Night ──
  if (hubIsNight(now, hub.dimFrom, hub.dimTo) && !awake) {
    const next = later[0] || null;
    return (
      <div onClick={onWake} data-testid="hub-night" className="no-text-scale" style={{ height: '100vh', background: '#16130f', color: '#d9cfc2', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '3vh', textAlign: 'center', cursor: 'pointer', userSelect: 'none' }}>
        <div style={{ fontSize: '5.6vh', color: '#8f857a' }}>{weekday}, {dateLine}</div>
        <div style={{ fontSize: '24vh', fontWeight: 800, lineHeight: 1, color: '#efe6da' }}>{clockNum} <span style={{ fontSize: '9vh' }}>{clockAp}</span></div>
        <div style={{ fontSize: '6.4vh', fontWeight: 700, color: '#efe6da' }}>Good night{first ? `, ${first}` : ''}.</div>
        {/* v1.155.4 — Pete: "it says 'Tina comes at 9:00 AM - 9:00 AM'". A visit's line already
            carries its time; only plans get it added. */}
        {next && <div style={{ fontSize: '5vh', color: '#b3a898' }}>{simpleFmtDay(next.date)}: {hubLine(next)}{next.time && next.kind !== 'visit' ? ` — ${simpleFmtTime(next.time)}` : ''}</div>}
      </div>
    );
  }

  // ── Today as a timeline (v1.153.1, Pete's pick) ──
  // "Tina is here until 5:00 · then Faith at 5:00", then the rest of today in order. Routine
  // visits do not repeat down the week; "Coming up" is her appointments and plans only.
  const todayLeft = days.filter((d) => d.date === today && !(d.kind === 'visit' && d.inProgress));
  const nextVisitToday = todayLeft.find((d) => d.kind === 'visit') || null;
  const thenLine = hub.here && nextVisitToday ? `then ${nextVisitToday.who || 'a caregiver'} at ${simpleFmtTime(nextVisitToday.time)}` : null;
  const todayRows = todayLeft.filter((d) => !(thenLine && d === nextVisitToday)).slice(0, hub.here ? 2 : 3);
  // v1.155.1 — Pete: "Instead of 'coming up' let's do 'tomorrow'...Tina at 9am, Faith at 5pm."
  // Tomorrow's visits as one line of names and times, then up to two of tomorrow's plans.
  const tomorrow = (() => { const x = new Date(today + 'T12:00:00'); x.setDate(x.getDate() + 1); return x.toISOString().slice(0, 10); })();
  const tmr = days.filter((d) => d.date === tomorrow);
  const tmrVisits = tmr.filter((d) => d.kind === 'visit');
  const tmrPlans = tmr.filter((d) => d.kind !== 'visit').slice(0, hub.here ? 1 : 2);
  const tmrVisitLine = tmrVisits.map((v) => `${v.who || 'A caregiver'}${v.time ? ` at ${simpleFmtTime(v.time)}` : ''}`).join(', ');
  const tmrName = new Date(tomorrow + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' });

  const card = { background: 'rgba(255, 255, 255, 0.86)', borderRadius: '2.6vh', padding: '2.2vh 2.8vh', border: '2px solid rgba(255, 255, 255, 0.9)', boxSizing: 'border-box', minHeight: 0, flexShrink: 0 };
  const wx = hub.weather || null;
  const label = { fontSize: '3vh', fontWeight: 800, letterSpacing: 1, color: 'var(--text-secondary)', textTransform: 'uppercase' };
  const row = { display: 'flex', gap: '2.4vh', fontSize: '4.6vh', padding: '1vh 0', color: 'var(--text-primary)', lineHeight: 1.2, alignItems: 'baseline' };
  const btn = (bg, fg) => ({
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1.8vh', minHeight: '12vh',
    borderRadius: '2.6vh', border: 'none', background: bg, color: fg, fontSize: '4.8vh', fontWeight: 800,
    fontFamily: 'inherit', textDecoration: 'none', cursor: 'pointer', padding: '0 2vh', boxSizing: 'border-box',
  });
  const waiting = show.text && s.text && Array.isArray(s.text.waiting) && s.text.waiting.length ? s.text.waiting[s.text.waiting.length - 1] : null;
  const timeCol = { width: '21vh', flexShrink: 0, fontWeight: 800 };
  // Tell the family is gone from the Hub (Pete, 11/23: remove it).
  // v1.155.1 — the Hub's own Call buttons when the leader chose some; otherwise the phone's.
  const hubCalls = (hub.calls && hub.calls.length) ? hub.calls : calls;
  const hasButtons = hubCalls.length > 0 || (show.text && s.text) || show.messages;

  return (
    <div className="simple-view hub-board no-text-scale" data-testid="hub-board" onPointerDown={() => { if (awake && hubIsNight(now, hub.dimFrom, hub.dimTo)) onWake(); }} style={{ ...HUB_THEME, '--text-primary': '#14213d', '--text-secondary': '#3d4a63', height: '100vh', background: hubSky(now), padding: '3vh 3vw', boxSizing: 'border-box', display: 'grid', gridTemplateColumns: 'minmax(0, 1.15fr) minmax(0, 1fr)', gridTemplateRows: hasButtons ? 'minmax(0, 1fr) auto' : 'minmax(0, 1fr)', gap: '2.6vh 2.2vw', overflow: 'hidden' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2.2vh', minHeight: 0, overflow: 'hidden' }}>
        {/* v1.158.1 — Pete, 11/24 (option B): the clock on top with the weather beside it, and
            the day and date on one full-width line under it. Side by side, "Tuesday" crowded
            the clock and its bottom didn't line up with anything. */}
        <div>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1vh 2vw' }}>
            <div style={{ fontSize: '16vh', fontWeight: 800, lineHeight: 0.95, color: 'var(--text-primary)', whiteSpace: 'nowrap' }} data-testid="hub-clock">{clockNum}<span style={{ fontSize: '5.6vh', marginLeft: '1vh' }}>{clockAp}</span></div>
            <div style={{ flexShrink: 0, paddingBottom: '1.4vh' }}>
            {wx && wx.now
              ? (
                <button type="button" data-testid="hub-weather-button" onClick={() => setShowWx(true)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '1.2vh', padding: '0.8vh 2vh', borderRadius: '5vh', border: '2px solid rgba(255,255,255,0.95)', background: 'rgba(255,255,255,0.75)', color: 'var(--text-primary)', fontSize: '3.8vh', fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer' }}>
                  <span aria-hidden="true">{wxEmoji(wx.now.icon, wx.now.isDay)}</span> {wx.now.temp}{'\u00B0'} {'\u00B7'} {wx.now.label}
                </button>
              )
              : <div style={{ fontSize: '3.4vh', color: 'var(--text-secondary)' }}>{part}</div>}
            </div>
          </div>
          <div style={{ marginTop: '1.2vh', fontSize: '4.6vh', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} data-testid="hub-date">
            <span style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{weekday}</span><span style={{ color: 'var(--text-secondary)' }}>, {dateLine}</span>
          </div>
        </div>

        {failed && <div style={{ ...card, fontSize: '3.4vh' }}>Can't reach InPlace right now. It will try again by itself.</div>}

        {hub.here && (
          <div style={{ ...card, display: 'flex', alignItems: 'center', gap: '2.2vh' }}>
            <SimpleFace photo={hub.here.photo} name={hub.here.firstName} size={Math.round(window.innerHeight * 0.12)} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '5.2vh', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.1 }}>{hub.here.firstName} is here</div>
              {hub.here.until && <div style={{ fontSize: '3.8vh', color: 'var(--text-secondary)', lineHeight: 1.25 }}>until {simpleFmtTime(hub.here.until)}{thenLine ? <><br />{thenLine}</> : null}</div>}
            </div>
          </div>
        )}

        {/* v1.155.6 — Pete: "yes to the next caregiver." Nobody here: who comes next, with their face. */}
        {!hub.here && hub.next && (
          <div data-testid="hub-next" style={{ ...card, display: 'flex', alignItems: 'center', gap: '2.2vh' }}>
            <SimpleFace photo={hub.next.photo} name={hub.next.firstName} size={Math.round(window.innerHeight * 0.12)} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '3vh', fontWeight: 800, letterSpacing: 1, color: 'var(--role-color)', textTransform: 'uppercase' }}>Next</div>
              <div style={{ fontSize: '5.2vh', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.1 }}>{hub.next.firstName}</div>
              <div style={{ fontSize: '3.8vh', color: 'var(--text-secondary)', lineHeight: 1.25 }}>{hub.next.day}{hub.next.time ? ` at ${simpleFmtTime(hub.next.time)}` : ''}</div>
            </div>
          </div>
        )}

        {show.comingUp && (todayRows.length > 0 || !hub.here) && (
          <div style={card}>
            <div style={{ ...label, color: 'var(--role-color)' }}>Today</div>
            {todayRows.length === 0
              ? <div style={{ ...row, color: 'var(--text-secondary)' }}>Nothing else today <span aria-hidden="true">{'\u{1F60C}'}</span></div>
              : todayRows.map((c, i) => (
                <div key={c.kind + c.id} style={{ ...row, borderTop: i ? '2px solid var(--border-color)' : 'none' }}>
                  <span style={timeCol}>{c.time ? simpleFmtTime(c.time) : ''}</span>
                  <span style={{ minWidth: 0, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{c.kind === 'visit' ? `${c.who || 'A caregiver'} comes` : hubLine(c)}</span>
                </div>
              ))}
          </div>
        )}

        {show.comingUp && (
          <div style={{ ...card, overflow: 'hidden' }} data-testid="hub-tomorrow">
            <div style={label}>Tomorrow <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 600 }}>{'·'} {tmrName}</span></div>
            {!tmrVisitLine && tmrPlans.length === 0 && (
              <div style={{ ...row, fontSize: '3.8vh', color: 'var(--text-secondary)' }}>Nothing planned yet</div>
            )}
            {tmrVisitLine && (
              <div style={{ ...row, fontSize: '3.8vh', lineHeight: 1.2 }}>
                <span style={{ minWidth: 0, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{tmrVisitLine}</span>
              </div>
            )}
            {tmrPlans.map((c, i) => (
              <div key={c.kind + c.id} style={{ ...row, fontSize: '3.8vh', alignItems: 'flex-start', borderTop: (i || tmrVisitLine) ? '2px solid var(--border-color)' : 'none' }}>
                {c.time && <span style={{ ...timeCol, width: '15vh' }}>{simpleFmtTime(c.time)}</span>}
                <span style={{ minWidth: 0, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.2 }}>{hubLine(c)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '2.2vh', minHeight: 0, overflow: 'hidden' }}>
        {readFlash && (
          <div style={{ ...card, borderColor: 'var(--role-color)', borderWidth: 3, fontSize: '4vh', fontWeight: 700 }}>{'✓'} {readFlash}</div>
        )}
        {note && (
          <div key={'note-' + note.id} className="hub-new-shimmer" data-testid="hub-note" style={{ ...card, borderColor: 'var(--role-color)', borderWidth: 3 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1.8vh', marginBottom: '1vh' }}>
              <SimpleFace photo={note.fromPhoto} name={note.from} size={Math.round(window.innerHeight * 0.08)} />
              <div style={{ fontSize: '3.4vh', color: 'var(--text-secondary)' }}>From {note.from}</div>
            </div>
            <div style={{ fontSize: '4.6vh', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.25, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{note.content}</div>
            <button onClick={() => onRead(note.id)} disabled={reading} style={{ ...btn('var(--role-color)', 'var(--text-on-primary)'), width: '100%', marginTop: '1.8vh', minHeight: '10vh', fontSize: '4.4vh' }}>
              {'👍'} I read it!
            </button>
          </div>
        )}
        {!note && waiting && (
          <div key={'msg-' + (waiting.id || waiting.createdAt || waiting.content)} className="hub-new-shimmer" data-testid="hub-waiting" style={{ ...card, borderColor: 'var(--role-color)', borderWidth: 3 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1.8vh', marginBottom: '1vh' }}>
              <SimpleFace photo={waiting.fromPhoto} name={waiting.from} size={Math.round(window.innerHeight * 0.08)} />
              <div style={{ fontSize: '3.4vh', color: 'var(--text-secondary)' }}>{waiting.isReply ? `${waiting.from} wrote back` : `Message from ${waiting.from}`}</div>
            </div>
            <div style={{ fontSize: '4.6vh', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.25, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{waiting.content}</div>
            <div style={{ display: 'flex', gap: '1.8vh', marginTop: '1.8vh' }}>
              <button onClick={onAck} disabled={acking} style={{ ...btn('var(--role-color)', 'var(--text-on-primary)'), minHeight: '10vh', fontSize: '4.4vh' }}>Got it</button>
              <button onClick={onText} style={{ ...btn('var(--bg-card)', 'var(--text-primary)'), border: '2px solid var(--border-color)', minHeight: '10vh', fontSize: '4.4vh' }}>Write back</button>
            </div>
          </div>
        )}

        {!note && !waiting && !readFlash && hub.showPhotos !== false && (
          <HubPhoto photos={hub.photos} now={now} card={card} stored={hub.photoAspect} onShape={onHubShape} />
        )}

        {hub.faces && (hub.people || []).length > 0 && (
          <div style={card}>
            <div style={label}>Who's coming this week</div>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(hub.people.length, 4)}, minmax(0, 1fr))`, gap: '1.8vh', marginTop: '1.6vh', textAlign: 'center' }}>
              {hub.people.map((p) => (
                <div key={p.userId} style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <SimpleFace photo={p.photo} name={p.firstName} size={Math.round(window.innerHeight * 0.13)} ring={p.today ? 'var(--role-color)' : undefined} />
                  </div>
                  <div style={{ fontSize: '4.2vh', fontWeight: 800, color: 'var(--text-primary)', marginTop: '0.8vh', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.firstName}</div>
                  <div style={{ fontSize: '3.2vh', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.label}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {showWx && wx && <HubWeather wx={wx} onClose={() => setShowWx(false)} />}
      {hasButtons && (
        <div style={{ gridColumn: '1 / 3', display: 'flex', gap: '2.2vw' }}>
          {hubCalls.map((c) => (
            <button key={c.userId} data-testid="hub-call" onClick={() => onCall && onCall(c, s.callType || 'voice')} style={btn('#1b7a3d', '#fff')} aria-label={`Call ${c.firstName}`}>
              <SimpleFace photo={c.photo} name={c.firstName} size={Math.round(window.innerHeight * 0.08)} ring="#fff" /> Call {c.firstName}
            </button>
          ))}
          {show.text && s.text && (
            <button onClick={onText} style={btn('var(--role-color)', 'var(--text-on-primary)')} aria-label={`Text ${simpleNames(s.text.to)}`}>
              <span aria-hidden="true">{'💬'}</span> Text {s.text.to.length > 2 ? 'my family' : simpleNames(s.text.to)}
            </button>
          )}
          {show.messages && (
            <button onClick={onMessages} style={btn('var(--role-color)', 'var(--text-on-primary)')}>
              <span aria-hidden="true">{'💬'}</span> Messages
              {unread > 0 && <span style={{ background: '#fff', color: 'var(--role-color)', borderRadius: 20, padding: '0 1.6vh', fontSize: '3.6vh' }}>{unread}</span>}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

const SimpleViewInner = ({ initial, onPanelChange, startCall, callBusy }) => {
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
  // v1.155.4 — Pete: "it went to daytime mode, but hasn't turned back to night mode. it should
  // do it auto after a minute or so." Waking now lasts a minute, and a timer redraws the screen
  // the moment it ends instead of waiting for the next clock tick; any touch while awake starts
  // the minute again.
  useEffect(() => {
    if (!wakeUntil) return undefined;
    const t = setTimeout(() => setNow(new Date()), Math.max(0, wakeUntil - Date.now()) + 50);
    return () => clearTimeout(t);
  }, [wakeUntil]);
  useEffect(() => {
    const onResize = () => setWide(hubViewport());
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => { window.removeEventListener('resize', onResize); window.removeEventListener('orientationchange', onResize); };
  }, []);

  // v1.153.0 — the call host (SimpleView) steps aside while Messages, which hosts its own calls, is open.
  useEffect(() => { if (onPanelChange) onPanelChange(panel); }, [panel]);

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

  // v1.155.1 — Pete: "the screen that mom types a message on [should] return to the main
  // screen after some short period of inactivity...she sends a text, and it returns to the
  // previous screen within a couple seconds." A panel left open goes home by itself: 90 s with
  // no touch or key (3 min while there is unsent typing), and 3 s after a text is sent.
  const goHome = () => { setPanel(null); setSentMsg(''); load(); };
  const lastTouch = React.useRef(Date.now());
  const touched = () => { lastTouch.current = Date.now(); };
  useEffect(() => {
    if (!panel) return undefined;
    lastTouch.current = Date.now();
    const iv = setInterval(() => {
      const limit = (tellText || '').trim() ? 180000 : PANEL_IDLE_MS;
      if (Date.now() - lastTouch.current > limit) goHome();
    }, 5000);
    return () => clearInterval(iv);
  }, [panel, tellText]);

  const hubOn = !!(data?.simpleScreen?.hub?.on) && wide;
  const page = { minHeight: '100vh', background: 'var(--bg-surface)', padding: '20px 16px 32px', boxSizing: 'border-box', maxWidth: hubOn ? 900 : 560, margin: '0 auto' };
  const card = { background: 'var(--bg-card)', borderRadius: 20, padding: '20px', marginBottom: 18, border: '2px solid var(--border-color)' };
  const label = { fontSize: 20, fontWeight: 700, color: 'var(--text-secondary)', margin: '0 0 10px' };
  const bigBtn = (bg, fg) => ({
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, width: '100%',
    minHeight: 88, marginBottom: 14, borderRadius: 22, textDecoration: 'none', border: 'none', cursor: 'pointer',
    background: bg, color: fg, fontSize: 30, fontWeight: 800, fontFamily: 'inherit', boxSizing: 'border-box',
  });
  // v1.155.1 — "make the back button a little bit more obvious": filled green, pinned to the top.
  const backBar = (
    <div style={{ position: 'sticky', top: 0, zIndex: 5, background: 'var(--bg-surface)', paddingBottom: 4 }}>
      <button data-testid="simple-back-home" onClick={goHome} style={{ ...bigBtn('var(--role-color)', 'var(--text-on-primary)'), minHeight: 80, fontSize: 30, marginBottom: 10 }}>
        <span aria-hidden="true" style={{ fontSize: 38, lineHeight: 1 }}>{'←'}</span> Back to home
      </button>
    </div>
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
      <div onPointerDown={touched} onKeyDown={touched} style={{ ...page, padding: '12px 12px 0', maxWidth: 720 }}>
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
        if (res?.ok) {
          setTellText(''); setSentMsg(`Sent to ${names}`);
          // Home in a few seconds, with the confirmation carried onto the home screen.
          setTimeout(() => {
            setPanel((p) => (p === 'text' ? null : p)); setSentMsg('');
            setReadFlash(`Sent to ${names}`); setTimeout(() => setReadFlash(''), 8000);
            load();
          }, SENT_HOME_MS);
        }
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
      <div style={page} className="simple-view" onPointerDown={touched} onKeyDown={touched} onInput={touched}>
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
      <div style={page} className="simple-view" onPointerDown={touched} onKeyDown={touched} onInput={touched}>
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
      <>
      <HubBoard hub={s.hub} first={first} now={now} show={show} calls={calls} note={note} s={s} failed={failed}
        readFlash={readFlash} reading={reading} acking={acking} unread={unread}
        awake={Date.now() < wakeUntil} onWake={() => setWakeUntil(Date.now() + HUB_WAKE_MS)}
        onRead={markRead} onAck={ackText} onText={openText}
        onMessages={() => setPanel('messages')} onCall={startCall}
        onHubShape={(aspect) => { if (data && data.careRecipientId) apiFetch(`/api/care-recipients/${data.careRecipientId}/simple-screen/hub-shape`, { method: 'POST', body: JSON.stringify({ photoAspect: aspect }) }).catch(() => {}); }} />
      {s.hub && s.hub.noticeAwake && !callBusy && data && data.careRecipientId && <HubAwake recipientId={data.careRecipientId} />}
      {s.hub && <HubKiosk on={s.hub.kiosk !== false} />}
      {s.hub && data && data.careRecipientId && <HubHeartbeat recipientId={data.careRecipientId} busy={!!callBusy} />}
      {s.hub && <HubPopups hub={s.hub} s={s} note={note} now={now} onRead={markRead} onAck={ackText} onText={openText} />}
      </>
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

      {/* v1.153.0 — an InPlace call to their app, not a number handed to a dialer. */}
      {calls.map((c) => (
        <button key={c.userId} onClick={() => startCall && startCall(c, s.callType || 'voice')} style={{ ...bigBtn('var(--color-success, #1b7a3d)', '#fff'), justifyContent: 'flex-start', padding: '10px 18px' }} aria-label={`Call ${c.firstName}`}>
          <SimpleFace photo={c.photo} name={c.firstName} size={68} ring="#fff" />
          <span style={{ flex: 1, textAlign: 'center' }}><span aria-hidden="true" style={{ fontSize: 30 }}>{s.callType === 'video' ? '🎥' : '📞'}</span> Call {c.firstName}</span>
        </button>
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

// v1.153.0 — the screen the person sees, wrapped in the call host so a call can reach them on
// every panel but Messages (which hosts its own).
const SimpleView = window.SimpleView = (props) => {
  const [panel, setPanel] = useState(null);
  const host = useSimpleCallHost(panel !== 'messages');
  return (
    <>
      <SimpleViewInner {...props} onPanelChange={setPanel} startCall={host.startCall} callBusy={host.busy} />
      {host.ui}
    </>
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
  ['calls', 'Call buttons', 'Big buttons that ring the people you pick below in their InPlace app, as a voice or video call.'],
  ['messages', 'Messages', 'Read and send messages with the care team.'],
  ['tellFamily', 'Tell the family', 'One-tap notes like "I’m hungry" or "I have pain", or typed. You get a "tap to read" notice; pain and "I need help" come as needs attention.'],
  ['comingUp', 'Coming up', 'Today\u2019s and tomorrow\u2019s visits and appointments, like "Haircut at Angie\u2019s — 1:00 PM".'],
];

// v1.156.0 — drop-in and awake noticing, in the Hub settings. Pete: "we just need an
// acknowledgment that someone with a durable POA or that person has signed up for drop-ins...
// We just wanna make sure it is recorded as purposeful." Rules: src/utils/dropIn.js.
const HubDropInSettings = window.HubDropInSettings = ({ recipientId, name: nameProp, signOnly, onDone, onDropIn }) => {
  const { showToast } = useToast();
  const [v, setV] = useState(null);
  const [typed, setTyped] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showWording, setShowWording] = useState(false);
  const load = async () => { try { const r = await apiFetch(`/api/drop-in/${recipientId}`); if (r && r.ok) setV(await r.json()); } catch { /* hidden */ } };
  useEffect(() => { if (recipientId) load(); }, [recipientId]);
  if (!v) return null;
  const name = nameProp || v.firstName || 'them';
  const call = async (path, method, body, okMsg) => {
    setBusy(true);
    try {
      const r = await apiFetch(`/api/drop-in/${recipientId}${path}`, { method, body: JSON.stringify(body || {}) });
      const d = r ? await r.json().catch(() => ({})) : {};
      if (r && r.ok) { setV(d); if (okMsg) showToast(okMsg, 'success'); if (onDone && (path === '/consent' || path === '/decline')) onDone(); } else showToast(d.error || "Couldn't save that", 'error');
    } catch { showToast("Couldn't save that", 'error'); }
    setBusy(false);
  };
  const box = { marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border-color)', fontSize: 13, color: 'var(--text-primary)' };
  const muted = { fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, margin: '6px 0 0' };
  const wordingBox = (text) => (
    <div style={{ whiteSpace: 'pre-wrap', fontSize: 12.5, lineHeight: 1.5, background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8, padding: '10px 12px', margin: '8px 0', maxHeight: 220, overflowY: 'auto' }}>{text}</div>
  );
  return (
    <div data-testid="hub-dropin-settings" style={box}>
      <strong>Drop-in and noticing when {name} is up</strong>
      {/* 1.3 — drop in now: only when the server says this person may (consent, chosen, Hub on). */}
      {!signOnly && onDropIn && v.mayDropIn && v.hubUserId && (
        <div style={{ margin: '8px 0 4px' }}>
          <button type="button" data-testid="dropin-now" onClick={() => onDropIn(v.hubUserId)}
            style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: 'var(--role-color)', color: 'var(--text-on-primary)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            {'\u{1F44B}'} Drop in on {name}
          </button>
          <div style={muted}>The Hub chimes, shows that you're checking in, and opens video by itself after a few seconds. The tablet needs InPlace 1.3 for its camera.</div>
        </div>
      )}
      {v.consent ? (
        <div style={{ marginTop: 6 }}>
          <div data-testid="dropin-consent-signed" style={{ color: 'var(--color-success)', fontWeight: 600 }}>
            {'\u2713'} Signed by {v.consent.signerName} ({v.consent.capacityLabel}), {new Date(v.consent.signedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </div>
          <button type="button" onClick={() => setShowWording(!showWording)} style={{ background: 'none', border: 'none', padding: 0, marginTop: 4, color: 'var(--accent-color)', cursor: 'pointer', fontSize: 12.5 }}>
            {showWording ? 'Hide what was signed' : 'Read what was signed'}
          </button>
          {showWording && wordingBox(v.consent.wording)}
          {v.canRevoke && (
            <div><button type="button" disabled={busy} data-testid="dropin-revoke"
              onClick={() => { if (window.confirm('Withdraw this consent? Drop-in and noticing stop right away.')) call('/revoke', 'POST', {}, 'Consent withdrawn'); }}
              style={{ marginTop: 8, fontSize: 12.5, padding: '6px 12px', borderRadius: 8, border: '1px solid var(--color-error)', background: 'none', color: 'var(--color-error)', cursor: 'pointer' }}>Withdraw consent</button></div>
          )}
        </div>
      ) : (
        <div style={{ marginTop: 6 }}>
          <div style={{ color: 'var(--text-secondary)' }}>Not signed. Nothing below works until it is.</div>
          {wordingBox(v.wording)}
          {v.request && v.request.forMe && (
            <div style={{ margin: '6px 0', fontWeight: 600 }}>{v.request.byFirstName} asked you to review this.</div>
          )}
          {v.canSign ? (
            <div data-testid="dropin-sign">
              <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer', margin: '6px 0' }}>
                <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ width: 18, height: 18, marginTop: 1 }} />
                <span>I agree, signing as {v.capacity === 'self' ? 'myself' : `${name}'s ${v.capacityLabel}`}.</span>
              </label>
              <input className="form-input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type your full name" style={{ width: '100%', boxSizing: 'border-box' }} />
              <button type="button" disabled={busy || !agree || typed.trim().length < 2}
                onClick={() => call('/consent', 'POST', { signerName: typed.trim(), agree: true, wordingVersion: v.wordingVersion }, 'Consent signed and recorded')}
                style={{ marginTop: 8, padding: '8px 14px', borderRadius: 8, border: 'none', background: 'var(--role-color)', color: 'var(--text-on-primary)', fontWeight: 700, cursor: 'pointer', opacity: (!agree || typed.trim().length < 2) ? 0.5 : 1 }}>Approve and sign</button>
              {v.request && v.request.forMe && (
                <button type="button" disabled={busy} data-testid="dropin-decline" onClick={() => call('/decline', 'POST', {}, 'Answered: not now')}
                  style={{ marginTop: 8, marginLeft: 8, padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>Not now</button>
              )}
            </div>
          ) : v.isLeader && v.signers.length ? (
            // v1.156.1 — Pete: "someone can sign up / setup and she gets a 'needs you' card to click approve."
            <div data-testid="dropin-ask">
              {v.request
                ? <div style={{ fontSize: 13 }}>Waiting for {v.request.ofFirstName} to review it. <button type="button" disabled={busy} onClick={() => call('/decline', 'POST', {})} style={{ background: 'none', border: 'none', color: 'var(--accent-color)', cursor: 'pointer', padding: 0, fontSize: 12.5 }}>Withdraw the ask</button></div>
                : v.signers.map((p) => (
                  <button key={p.userId} type="button" disabled={busy} data-testid={'dropin-ask-' + p.userId}
                    onClick={() => call('/request', 'POST', { userId: p.userId }, `Sent to ${p.firstName}. It's on their Needs you card.`)}
                    style={{ marginTop: 6, marginRight: 8, padding: '8px 14px', borderRadius: 8, border: 'none', background: 'var(--role-color)', color: 'var(--text-on-primary)', fontWeight: 700, cursor: 'pointer' }}>
                    Ask {p.firstName} to approve <span style={{ fontWeight: 400, opacity: 0.85 }}>({p.capacityLabel})</span>
                  </button>
                ))}
            </div>
          ) : (
            <p style={muted}>Only {name}, or the agent recorded under {name}'s durable power of attorney or as healthcare agent, can sign this. Record who that is in Legal readiness, then that person signs here.</p>
          )}
        </div>
      )}
      {v.isLeader && !signOnly && (
        <div style={{ marginTop: 12, opacity: v.consent ? 1 : 0.55 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Who may drop in</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px' }}>
            {v.candidates.map((c) => {
              const on = v.chosen.includes(c.userId);
              return (
                <label key={c.userId} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" disabled={busy} checked={on} data-testid={'dropin-person-' + c.userId}
                    onChange={() => call('/settings', 'PUT', { userIds: on ? v.chosen.filter((x) => x !== c.userId) : [...v.chosen, c.userId] })}
                    style={{ width: 16, height: 16, accentColor: 'var(--role-color)' }} />
                  {c.name}
                </label>
              );
            })}
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, cursor: 'pointer' }}>
            <input type="checkbox" disabled={busy} checked={v.noticeAwake} data-testid="dropin-notice"
              onChange={(e) => call('/settings', 'PUT', { noticeAwake: e.target.checked })}
              style={{ width: 16, height: 16, accentColor: 'var(--role-color)' }} />
            <span><strong>Notice when {name} is up</strong> <span style={{ color: 'var(--text-secondary)' }}>— movement, about 10 seconds of talking, or a touch. Only the times are kept; nothing is recorded. Last night goes into {name}'s care notes each morning, and the caregiver sees it at check-in.</span></span>
          </label>
          {/* v1.158.2 — proof it is working: the last time it noticed her up. */}
          {v.noticeAwake && (
            <p style={{ ...muted, color: 'var(--text-secondary)' }} data-testid="dropin-last-noticed">
              {v.lastNoticed
                ? <>Last noticed {name} up: {new Date(v.lastNoticed.startedAt).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}{'\u2013'}{new Date(v.lastNoticed.endedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  {' \u00b7 '}{[v.lastNoticed.motion && 'movement', v.lastNoticed.talking && 'talking', v.lastNoticed.touches && 'touching the screen'].filter(Boolean).join(', ')}</>
                : <>Nothing noticed yet. Within a minute or two of someone moving in front of the tablet, it shows here.</>}
            </p>
          )}
          <p style={muted}>The tablet needs InPlace 1.3 (with camera access) for drop-in and noticing. While it's watching, Android shows a small green dot in the tablet's top corner.</p>
        </div>
      )}
    </div>
  );
};

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
  const [callType, setCallType] = useState('voice'); // v1.153.0
  // v1.153.0 — ring their screen from here. Outgoing only: answering stays with Messages.
  const callHost = useSimpleCallHost(true, { answers: false });
  const name = firstName || 'them';

  const load = async () => {
    try {
      const res = await apiFetch(`/api/care-recipients/${recipientId}/simple-mode`);
      if (res?.ok) {
        const d = await res.json();
        setCfg(d); setOn(d.on); setPicked(d.callUserIds || []); setTextPicked(d.textUserIds || []); setShow(d.show || {}); setLastNote(d.lastNote || null); setHub(d.hub || null); setCallType(d.callType || 'voice');
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
        if (d.callType) setCallType(d.callType);
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

          {/* v1.153.0 — call their screen (Simple screen or Hub) in InPlace */}
          {cfg.recipientUserId && (
            <div style={{ display: 'flex', gap: 8, margin: '0 0 14px', flexWrap: 'wrap' }}>
              {[['voice', '📞 Voice call'], ['video', '🎥 Video call']].map(([t, l]) => (
                <button key={t} data-testid={`call-recipient-${t}`}
                  onClick={() => { if (!callHost.startCall({ userId: cfg.recipientUserId, firstName: name, photo: cfg.recipientPhoto || null }, t)) showToast('Not connected right now. Try again in a moment.', 'error'); }}
                  style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--role-color)', background: 'var(--bg-card)', color: 'var(--role-color)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                  {l} {name}
                </button>
              ))}
            </div>
          )}
          {callHost.ui}

          {/* v1.152.0 — InPlace Hub: the same screen on a tablet on the kitchen counter */}
          {hub && (
            <div data-testid="hub-settings" style={{ margin: '0 0 16px', padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border-color)', background: 'var(--bg-surface)' }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer' }}>
                <input type="checkbox" disabled={saving} checked={!!hub.on} onChange={(e) => save({ hub: { on: e.target.checked } }, e.target.checked ? 'Hub on' : 'Hub off')}
                  style={{ width: 18, height: 18, marginTop: 1, accentColor: 'var(--role-color)' }} />
                <span><strong>InPlace Hub</strong> <span style={{ color: 'var(--text-secondary)' }}>— a tablet on {name}'s counter, held sideways, shows this screen like a little TV: the date with the year, a big clock, who's here, today and tomorrow, who's who and photos. Its buttons are the ones you pick here.</span></span>
              </label>
              {hub.on && (
                <div style={{ margin: '10px 0 0 26px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer' }}>
                    <input type="checkbox" disabled={saving} checked={!!hub.faces} onChange={(e) => save({ hub: { faces: e.target.checked } })} style={{ width: 16, height: 16, accentColor: 'var(--role-color)' }} />
                    <span><strong>Who's who</strong> <span style={{ color: 'var(--text-secondary)' }}>— faces and names of the caregivers coming this week, and when each comes next</span></span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer' }}>
                    <input type="checkbox" disabled={saving} checked={hub.photos !== false} onChange={(e) => save({ hub: { photos: e.target.checked } })} style={{ width: 16, height: 16, accentColor: 'var(--role-color)' }} data-testid="hub-photos-setting" />
                    <span><strong>Photos</strong> <span style={{ color: 'var(--text-secondary)' }}>— the photos the team chooses for {name}'s screen. Add one from Care photos on Home, or tap any care photo and pick "Show on {name}'s screen". A caregiver's photo shows only if they tick it at check-out.</span></span>
                  </label>
                  {/* v1.155.1 — the Hub's own Call buttons (Pete: "a 'call Peter' button at the bottom
                      to split the 'text my family' button"). "The week ahead" went: the board now
                      shows Today and Tomorrow. */}
                  <div data-testid="hub-call-picker" style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                    <strong>Call buttons on the Hub</strong> <span style={{ color: 'var(--text-secondary)' }}>— up to 2, with their photo, beside Text. None picked: the same Call buttons as {name}'s phone.</span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                      {(cfg.candidates || []).map((c) => {
                        const ids = hub.callUserIds || [];
                        const on = ids.includes(c.userId);
                        const full = !on && ids.length >= 2;
                        return (
                          <label key={c.userId} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: full ? 'not-allowed' : 'pointer', opacity: full ? 0.5 : 1 }}>
                            <input type="checkbox" disabled={saving || full} checked={on}
                              onChange={(e) => save({ hub: { callUserIds: e.target.checked ? [...ids, c.userId] : ids.filter((x) => x !== c.userId) } })}
                              style={{ width: 16, height: 16, accentColor: 'var(--role-color)' }} />
                            Call {c.firstName}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 13, color: 'var(--text-primary)' }}>
                    <strong>Night</strong> <span style={{ color: 'var(--text-secondary)' }}>— dark with a big clock from</span>
                    <input type="time" value={hub.dimFrom} disabled={saving} onChange={(e) => e.target.value && save({ hub: { dimFrom: e.target.value } })} style={{ fontSize: 13, padding: '4px 6px' }} aria-label="Night starts" />
                    <span style={{ color: 'var(--text-secondary)' }}>to</span>
                    <input type="time" value={hub.dimTo} disabled={saving} onChange={(e) => e.target.value && save({ hub: { dimTo: e.target.value } })} style={{ fontSize: 13, padding: '4px 6px' }} aria-label="Night ends" />
                  </div>
                  {/* v1.158.0 — the Hub's live status, and a way to refresh it from here. */}
                  <HubStatusLine status={cfg.hubStatus} name={name} recipientId={recipientId} />
                  {/* 1.3 — kiosk mode on a tablet set up as a Hub (Kiosk.java). Off lets the family use
                      the tablet for something else (Wi-Fi, an update) without touching adb. */}
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer' }}>
                    <input type="checkbox" disabled={saving} checked={hub.kiosk !== false} onChange={(e) => save({ hub: { kiosk: e.target.checked } }, e.target.checked ? 'Tablet stays on InPlace' : 'Tablet unlocked')} style={{ width: 16, height: 16, accentColor: 'var(--role-color)' }} data-testid="hub-kiosk-setting" />
                    <span><strong>Keep the tablet on InPlace</strong> <span style={{ color: 'var(--text-secondary)' }}>— on a tablet set up as a Hub, Home and the app switcher can't leave this screen, and it comes back here after a restart. Turn off to use the tablet for something else, like Wi-Fi settings.</span></span>
                  </label>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
                    To set up the tablet: install InPlace Care from Google Play, sign in as {name}, and turn the tablet sideways. Pin the app (Settings → Security → Pin app) so it stays on this screen, or ask InPlace to set it up as a Hub so it stays put by itself.
                  </p>
                  {typeof HubDropInSettings !== 'undefined' && <HubDropInSettings recipientId={recipientId} name={name}
                    onDropIn={(hubUserId) => { if (!callHost.startCall({ userId: hubUserId, firstName: name, photo: cfg.recipientPhoto || null }, 'video', { dropIn: true })) showToast('Not connected right now. Try again in a moment.', 'error'); }} />}
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
                  <label key={c.userId} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer' }}>
                    <input type="checkbox" disabled={saving} checked={picked.includes(c.userId)} onChange={() => togglePerson(c.userId)} style={{ width: 16, height: 16, accentColor: 'var(--role-color)' }} />
                    {c.firstName} {c.lastName}
                  </label>
                ))}
              </div>
              {/* v1.153.0 — in-app calls: voice or video */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 13, color: 'var(--text-primary)', margin: '-6px 0 14px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Calls start as</span>
                {[['voice', 'Voice'], ['video', 'Video']].map(([v, l]) => (
                  <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input type="radio" name={`calltype-${recipientId}`} disabled={saving} checked={(callType || 'voice') === v} onChange={() => save({ callType: v })} style={{ accentColor: 'var(--role-color)' }} />
                    {l}
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
