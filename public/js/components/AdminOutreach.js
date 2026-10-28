// ─── Admin → Outreach (v1.113.0) ───
//
// Pete, 10/13: ~70 private-pay sitters from the NRV Agency on Aging's list, reached by text, and
// "if it comes from me, it has to go back to the app somehow." So every text leaves from InPlace's
// outreach number and every reply lands here, in that person's thread. A reply with an email
// address is answered automatically (signup invite by email + a thank-you text); only replies
// that need a person turn up as unread.
//
// Opt-out is hers: STOP marks her opted out, the server refuses to text her again, and nothing
// on this screen can undo it — only her START can.

const OUT_STATUS = {
  new: { label: 'Not texted', tone: 'muted' },
  texted: { label: 'Texted', tone: 'info' },
  replied: { label: 'Replied', tone: 'warning' },
  interested: { label: 'Interested', tone: 'success' },
  invited: { label: 'Invite sent', tone: 'success' },
  joined: { label: 'On InPlace', tone: 'success' },
  declined: { label: 'Declined', tone: 'muted' },
  wrong_number: { label: 'Wrong number', tone: 'muted' },
  opted_out: { label: 'Opted out', tone: 'error' },
};
const OUT_TONE = {
  muted: { background: 'var(--badge-muted-bg)', color: 'var(--badge-muted-text)' },
  info: { background: 'var(--color-info-bg)', color: 'var(--color-info)' },
  warning: { background: 'var(--color-warning-bg)', color: 'var(--color-warning)' },
  success: { background: 'var(--color-success-bg)', color: 'var(--color-success)' },
  error: { background: 'var(--color-error-bg)', color: 'var(--color-error)' },
};
// v1.122.0 — new key: the saved cold-intro wording must not come back as the post-call follow-up.
const OUT_TEMPLATE_KEY = 'inplace.outreach.joinFollowupTemplate'; // v1.124.2 — new key, new default

const outErr = async (res, fallback) => {
  const d = res ? await res.json().catch(() => ({})) : {};
  return d.error || fallback;
};
const outName = (c) => [c.first_name, c.last_name].filter(Boolean).join(' ') || 'Unknown sender';
const outPhone = (p) => {
  const d = String(p || '').replace(/\D/g, '').slice(-10);
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : (p || '');
};
const outGreeting = (c) => {
  const f = String(c?.first_name || '').trim();
  if (!f) return 'there';
  if (f.includes(' & ')) return f;
  const nick = f.match(/["“]([^"”]+)["”]/);
  return nick ? nick[1] : f.split(/\s+/)[0];
};
const outRender = (tpl, c) => String(tpl || '').replace(/\{first\}/gi, outGreeting(c)).replace(/\{last\}/gi, c?.last_name || '').replace(/\{link\}/gi, 'yourinplace.com/i/Ab3xYz').trim();
// v1.117.0 — journey tracking. Screen names come from the app's router; these read better.
const OUT_PAGE_LABEL = {
  splash: 'Welcome page', register: 'Sign-up', login: 'Sign-in', invite: 'Invite page',
  'platform-onboarding': 'Caregiver sign-up', 'signup-onboarding': 'Sign-up steps', 'resume-onboarding': 'Finishing sign-up',
  demo: 'Demo', dashboard: 'Home', 'find-work': 'Find Work', messages: 'Messages', account: 'Account',
};
const outPage = (p) => OUT_PAGE_LABEL[p] || String(p || '').replace(/-/g, ' ');
// v1.125.1 — a pasted or picked number may carry the +1 country code; formatPhone takes the
// first ten digits, so "+1 540 555 0123" would come out as (154) 055-5012. Drop it first.
const outUsDigits = (v) => {
  const d = String(v || '').replace(/\D/g, '');
  return d.length === 11 && d[0] === '1' ? d.slice(1) : d;
};
const outMins = (ms) => {
  const m = Math.round((Number(ms) || 0) / 60000);
  return m < 1 ? 'under a minute' : m === 1 ? '1 minute' : m < 90 ? `${m} minutes` : `${Math.round(m / 6) / 10} hours`;
};
const OutJourney = ({ j }) => {
  if (!j) return null;
  const opened = j.opens > 0;
  return (
    <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-color)', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
      <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>Their link</div>
      {!j.link && !opened && !j.siteMs && <div>No personal link sent yet. Put <code>{'{link}'}</code> in a text to send one.</div>}
      {j.link && !opened && <div>Not opened yet · <span style={{ color: 'var(--text-muted)' }}>{j.link.split('//').pop()}</span></div>}
      {opened && <div>Opened {outWhen(j.firstOpenedAt)}{j.opens > 1 ? ` · ${j.opens} times, last ${outWhen(j.lastOpenedAt)}` : ''}</div>}
      {j.siteMs > 0 && (
        <div>{outMins(j.siteMs)} in the app over {j.sessions} {j.sessions === 1 ? 'visit' : 'visits'}{j.daysActive > 1 ? ` on ${j.daysActive} days` : ''} · last seen {outWhen(j.lastSeenAt)}</div>
      )}
      {j.signedUpAt && <div>Signed up {outWhen(j.signedUpAt)}</div>}
      {j.pages && j.pages.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {j.pages.map((p) => `${outPage(p.page)} ${outMins(p.ms).replace('under a minute', '<1 min').replace(/ minutes?/, ' min')}`).join(' · ')}
        </div>
      )}
    </div>
  );
};

// v1.125.0 — the progress ladder. Pete, 10/26: "see steps along the way and how far they made it
// ... all the way to signup". Every step is something the app already records (server:
// utils/outreachProgress.js). A step with no date is done but undated (payouts, a Checkr clear).
const OUT_FLAG = {
  bg_needs_review: { label: 'Background check needs your review', tone: 'error' },
  bg_under_review: { label: 'Background check under review', tone: 'warning' },
  id_rejected: { label: 'ID rejected — needs a new one', tone: 'warning' },
};
const outStall = (p) => (p && p.stalledDays != null && p.stalledDays >= 2 ? `${p.stalledDays} days` : null);
const outStepNote = (s) => {
  const bits = [];
  if (s.key === 'read_page' && s.ms) bits.push(outMins(s.ms));
  if (s.key === 'link_opened' && s.count > 1) bits.push(`${s.count} times`);
  if (s.inPerson) bits.push('seen in person');
  return bits.join(' · ');
};
const OutProgress = ({ p }) => {
  const [all, setAll] = React.useState(false);
  if (!p || !p.steps) return null;
  const fi = p.steps.findIndex((s) => s.key === p.furthest);
  const nextIdx = p.next ? fi + 1 : -1;
  const shownSteps = all ? p.steps : p.steps.slice(0, Math.max(fi + 2, 4));
  const stall = outStall(p);
  const flag = OUT_FLAG[p.flag];
  return (
    <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-color)', fontSize: 13 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Progress</span>
        <span style={{ color: 'var(--text-secondary)' }}>{p.furthestLabel}</span>
        {stall && <span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 10, ...OUT_TONE.warning }}>stopped here {stall}</span>}
      </div>
      {flag && <div style={{ fontSize: 12, padding: '4px 10px', borderRadius: 8, marginBottom: 6, ...OUT_TONE[flag.tone] }}>{flag.label}</div>}
      <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {shownSteps.map((s, i) => {
          const isNext = i === nextIdx;
          const note = outStepNote(s);
          return (
            <li key={s.key} aria-label={`${s.label}: ${s.done ? 'done' : 'not yet'}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', color: s.done ? 'var(--text-primary)' : 'var(--text-muted)' }}>
              <span aria-hidden="true" style={{
                width: 16, height: 16, borderRadius: 8, flexShrink: 0, fontSize: 10, lineHeight: '16px', textAlign: 'center',
                background: s.done ? 'var(--role-color)' : 'transparent', color: 'var(--text-on-primary)',
                border: s.done ? 'none' : `1.5px ${isNext ? 'solid' : 'dashed'} ${isNext ? 'var(--role-color)' : 'var(--border-color)'}`,
              }}>{s.done ? '✓' : ''}</span>
              <span style={{ flex: 1, fontWeight: i === fi ? 600 : 400 }}>
                {s.label}{isNext ? <span style={{ color: 'var(--role-color)', fontSize: 11 }}> · next</span> : null}
                {note ? <span style={{ color: 'var(--text-muted)', fontSize: 12 }}> · {note}</span> : null}
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                {s.done ? (s.at ? outWhen(s.at) : 'done') : ''}
              </span>
            </li>
          );
        })}
      </ol>
      {shownSteps.length < p.steps.length && (
        <button onClick={() => setAll(true)} style={{ background: 'none', border: 'none', padding: '4px 0 0', color: 'var(--role-color)', fontSize: 12, cursor: 'pointer' }}>
          Show all {p.steps.length} steps
        </button>
      )}
    </div>
  );
};

// v1.125.0 — the funnel across everyone: how many reached each step. Tap a step to list the
// people who stopped there.
const OutFunnel = ({ funnel, filter, setFilter, contacts }) => {
  if (!funnel || !funnel.length) return null;
  const stoppedAt = (key) => contacts.filter((x) => x.progress && x.progress.furthest === key).length;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>How far people got — tap a step to see who stopped there</div>
      <div style={{ display: 'flex', gap: 4, overflowX: 'auto', paddingBottom: 4, WebkitOverflowScrolling: 'touch' }}>
        {funnel.map((f, i) => {
          const id = `step:${f.key}`;
          const on = filter === id;
          const stopped = stoppedAt(f.key);
          return (
            <React.Fragment key={f.key}>
              {i > 0 && <span aria-hidden="true" style={{ alignSelf: 'center', color: 'var(--text-muted)', fontSize: 12 }}>›</span>}
              <button onClick={() => setFilter(on ? 'all' : id)} title={`${stopped} stopped at ${f.label}`} style={{
                flexShrink: 0, minWidth: 74, padding: '6px 8px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                border: on ? '1.5px solid var(--role-color)' : '1px solid var(--border-color)',
                background: on ? 'var(--color-info-bg)' : 'var(--bg-primary)', opacity: f.count ? 1 : 0.55,
              }}>
                <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.1 }}>{f.count}</div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.25 }}>{f.label}</div>
                {stopped > 0 && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{stopped} stopped here</div>}
              </button>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

// Campaign links — one per flyer, post or ad, so Admin can see which one brought people in.
const OutCampaignLinks = ({ apiFetch, showToast }) => {
  const [links, setLinks] = React.useState(null);
  const [label, setLabel] = React.useState('');
  const [audience, setAudience] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const load = async () => {
    try { const r = await apiFetch('/api/admin/links'); if (r?.ok) setLinks((await r.json()).links); } catch { /* shown as empty */ }
  };
  React.useEffect(() => { load(); }, []);
  const make = async () => {
    setBusy(true);
    try {
      const r = await apiFetch('/api/admin/links', { method: 'POST', body: JSON.stringify({ label: label.trim(), audience: audience || null }) });
      if (r?.ok) { setLabel(''); showToast('Link made', 'success'); load(); }
      else showToast(await outErr(r, 'Couldn\'t make the link'), 'error');
    } catch { showToast('Couldn\'t make the link', 'error'); }
    setBusy(false);
  };
  const copy = async (url) => {
    try { await navigator.clipboard.writeText(url); showToast('Copied', 'success'); } catch { window.prompt('Copy this link', url); }
  };
  const field = { padding: 8, border: '1px solid var(--input-border)', background: 'var(--input-bg)', color: 'var(--text-primary)', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' };
  const btn = { padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: 13, cursor: 'pointer' };
  return (
    <div className="card">
      <div className="card-header">Tracked links</div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, lineHeight: 1.5 }}>
        Make one link per place you post: a flyer, a Facebook post, a church bulletin, an ad. Everyone who comes in through it is counted, and so is everyone who signs up. A link for caregivers, families or older adults opens that group's own page; “Anyone” opens the home page.
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <input style={{ ...field, flex: '1 1 200px' }} placeholder="Where it goes, e.g. Facebook — NRV caregivers group" value={label} onChange={(e) => setLabel(e.target.value)} />
        <select style={field} value={audience} onChange={(e) => setAudience(e.target.value)}>
          <option value="">Anyone</option>
          <option value="caregiver">Caregivers</option>
          <option value="family">Families</option>
          <option value="care_for">Older adults</option>
        </select>
        <button style={{ ...btn, background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', fontWeight: 600 }} disabled={busy || !label.trim()} onClick={make}>Make link</button>
      </div>
      {links && links.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No links yet.</div>}
      {links && links.map((l) => (
        <div key={l.code} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid var(--border-light)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{l.label}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{l.url.split('//').pop()}{l.audience ? ` · ${{ caregiver: 'caregivers', family: 'families', care_for: 'older adults' }[l.audience]}` : ''}</div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right', whiteSpace: 'nowrap' }}>
            {l.visitors} {l.visitors === 1 ? 'visitor' : 'visitors'} · {l.signups} signed up
          </div>
          <button style={{ ...btn, padding: '4px 10px', fontSize: 12 }} onClick={() => copy(l.url)}>Copy</button>
        </div>
      ))}
    </div>
  );
};
const outSegments = (s) => {
  const gsm = /^[A-Za-z0-9 \r\n@£$¥èéùìòÇØøÅå_ÆæßÉ!"#%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]*$/.test(s || '');
  const len = (s || '').length;
  return len <= (gsm ? 160 : 70) ? 1 : Math.ceil(len / (gsm ? 153 : 67));
};
const outWhen = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

// v1.116.0 — browser calling. The SDK is self-hosted and loaded only when a call starts.
let outVoiceSdk = null;
const outLoadVoiceSdk = () => {
  if (window.Twilio && window.Twilio.Device) return Promise.resolve(window.Twilio);
  if (outVoiceSdk) return outVoiceSdk;
  outVoiceSdk = new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = '/vendor/twilio-voice-2.18.5.min.js';
    sc.onload = () => (window.Twilio && window.Twilio.Device ? resolve(window.Twilio) : reject(new Error('Voice SDK missing')));
    sc.onerror = () => { outVoiceSdk = null; reject(new Error('Voice SDK failed to load')); };
    document.head.appendChild(sc);
  });
  return outVoiceSdk;
};
const outClock = (secs) => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;

const OutVoicemailPlayer = ({ messageId, apiFetch, showToast, label = '▶ Play voicemail' }) => {
  const [src, setSrc] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  React.useEffect(() => () => { if (src) URL.revokeObjectURL(src); }, [src]);
  const load = async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/admin/outreach/recording/${messageId}`);
      if (res?.ok) setSrc(URL.createObjectURL(await res.blob()));
      else showToast(await outErr(res, "Couldn't load the voicemail"), 'error');
    } catch {
      showToast("Couldn't load the voicemail", 'error');
    }
    setLoading(false);
  };
  if (src) return <audio controls autoPlay src={src} style={{ width: '100%', marginTop: 6, height: 36 }} />;
  return (
    <button onClick={load} disabled={loading} style={{ marginTop: 6, padding: '4px 10px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: 12, cursor: 'pointer' }}>
      {loading ? 'Loading…' : label}
    </button>
  );
};

// v1.122.0 — a recorded call: play it, read the transcript, see what iPAi took from it.
const OutCallDetail = ({ m, apiFetch, showToast, onUseConsent }) => {
  const [open, setOpen] = React.useState(false);
  let notes = null;
  try { notes = m.ai_notes ? JSON.parse(m.ai_notes) : null; } catch { notes = null; }
  if (!m.media_url && !m.transcript && !notes) return null;
  return (
    <div style={{ marginTop: 6, fontSize: 12, lineHeight: 1.45 }}>
      {notes && notes.summary && (
        <div style={{ marginBottom: 4 }}>
          <b>iPAi:</b> {notes.summary}
          {notes.textsOk ? <span> · <b>OK'd texts</b> (“{notes.consentQuote}”)</span> : null}
          {notes.textsOk && onUseConsent ? (
            // v1.125.3 — one tap: this call, this quote, recorded as Pete's OK to text.
            <div style={{ marginTop: 6 }}>
              <button onClick={() => onUseConsent(m.id, notes.consentQuote)} style={{ padding: '4px 10px', borderRadius: 8, border: 'none', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                ✓ Use this as their OK to text
              </button>
            </div>
          ) : null}
        </div>
      )}
      {notes && notes.error && <div style={{ marginBottom: 4 }}>{notes.error}</div>}
      {m.media_url && !notes && !m.transcript && <div style={{ marginBottom: 4 }}>Transcribing…</div>}
      {m.media_url && <OutVoicemailPlayer messageId={m.id} apiFetch={apiFetch} showToast={showToast} label="▶ Play recording" />}
      {m.transcript && (
        <div>
          <a href="#" onClick={(e) => { e.preventDefault(); setOpen((v) => !v); }} style={{ color: 'inherit', textDecoration: 'underline' }}>
            {open ? 'Hide transcript' : 'Transcript'}
          </a>
          {open && <div style={{ marginTop: 4, whiteSpace: 'pre-wrap', maxHeight: 220, overflowY: 'auto' }}>{m.transcript}</div>}
        </div>
      )}
    </div>
  );
};

const OutStatusPill = ({ status }) => {
  const s = OUT_STATUS[status] || { label: status, tone: 'muted' };
  return (
    <span style={{ ...OUT_TONE[s.tone], padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>{s.label}</span>
  );
};

// v1.125.2 — Pete, 10/28, screenshot of Monique's thread on his iPhone: "I still can't see how to
// text Monique." The composer was there — under the app's bottom nav. On a phone, Admin renders
// inside a container that is its own stacking context, so this panel's zIndex 1000 was resolved
// INSIDE it and the nav (900, at the root) painted over the bottom of the screen. Same trap, same
// fix as Messages (v1.105.x): render to document.body, out of that box entirely.
const outToBody = (node) => (node && typeof ReactDOM !== 'undefined' && ReactDOM.createPortal
  ? ReactDOM.createPortal(node, document.body)
  : node);

const OutreachThread = ({ contactId, apiFetch, showToast, onClose, onChanged, callScript }) => {
  const [data, setData] = React.useState(null);
  const [draft, setDraft] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const endRef = React.useRef(null);
  const draftRef = React.useRef(null);
  // v1.125.1 — Pete, 10/28, on his phone: "the texting portion is locked at the bottom of the
  // screen. I can't see what I text. I can't edit it. I can't scroll through it". Six fixed
  // sections (consent, email, notes, status, a 13-step ladder, the link journey) sat ABOVE a
  // message list that was the only part allowed to shrink — on a phone it shrank to nothing.
  // Now those sections fold into one "Details" row inside the same scroll as the conversation,
  // folded by default once there is a conversation to read.
  const [showDetails, setShowDetails] = React.useState(null); // null = decide from the data
  // v1.125.3 — recording a verbal OK from a call: null = closed, string = what they said.
  const [consentDraft, setConsentDraft] = React.useState(null);
  // v1.125.1 — fit the panel to what is actually visible. With the keyboard up, iOS scrolls the
  // page and a fixed full-height panel slides its header off the top ("the top of the screen
  // blocks the view and I have to scroll up to see who I'm talking to"). The visual viewport is
  // the part of the screen the keyboard leaves; the page behind is pinned while the panel is
  // open and put back where it was on close.
  const [vvBox, setVvBox] = React.useState(null);
  React.useEffect(() => {
    const body = document.body;
    const savedY = window.scrollY || 0;
    const prev = { position: body.style.position, top: body.style.top, width: body.style.width };
    body.style.position = 'fixed'; body.style.top = `-${savedY}px`; body.style.width = '100%';
    const vv = window.visualViewport;
    const apply = () => {
      if (!vv) return;
      const scrolled = Math.round(window.scrollY || 0);
      setVvBox({ top: Math.max(0, Math.round(vv.offsetTop || 0) - scrolled), height: Math.round(vv.height) });
      if (scrolled > 0) window.scrollTo(0, 0);
    };
    apply();
    if (vv) { vv.addEventListener('resize', apply); vv.addEventListener('scroll', apply); }
    return () => {
      if (vv) { vv.removeEventListener('resize', apply); vv.removeEventListener('scroll', apply); }
      body.style.position = prev.position; body.style.top = prev.top; body.style.width = prev.width;
      window.scrollTo(0, savedY);
    };
  }, []);
  // v1.125.1 — Back closes the conversation, not Admin. Pete, 10/24: "I can't go back a screen
  // without exiting Admin to move to the next person." The thread now owns one history entry;
  // app.js's popstate handler hands Back to window.__modalBackHandler before it touches pages.
  // One stable function for the life of the thread, so "is the handler still mine?" is an
  // identity check that holds across renders.
  const closedRef = React.useRef(false);
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;
  const closeRef = React.useRef(null);
  if (!closeRef.current) {
    closeRef.current = () => {
      if (closedRef.current) return;
      closedRef.current = true;
      if (window.__modalBackHandler === closeRef.current) window.__modalBackHandler = null;
      onCloseRef.current();
    };
  }
  const close = closeRef.current;
  React.useEffect(() => {
    window.history.pushState({ modal: 'outreach-thread' }, '', window.location.pathname);
    window.__modalBackHandler = close;
    return () => { if (window.__modalBackHandler === close) window.__modalBackHandler = null; };
  }, []);
  // × and the backdrop: close, then take back the history entry this thread pushed, so the next
  // Back press is a real one. The popstate that history.back() fires lands on the handler, which
  // is still this thread's (already-closed, so a no-op) — it never reaches the page router.
  const closeByButton = () => {
    if (window.history.state && window.history.state.modal === 'outreach-thread') {
      window.__modalBackHandler = () => {};
      close();
      window.history.back();
    } else {
      close();
    }
  };
  // v1.116.0 — { state: 'connecting'|'ringing'|'live', muted, secs } while a browser call is up.
  const [call, setCall] = React.useState(null);
  const callRef = React.useRef(null);
  const deviceRef = React.useRef(null);
  React.useEffect(() => {
    if (!call || call.state !== 'live') return undefined;
    const t = setInterval(() => setCall((c) => (c ? { ...c, secs: c.secs + 1 } : c)), 1000);
    return () => clearInterval(t);
  }, [call && call.state]);
  const endCall = () => {
    try { callRef.current && callRef.current.disconnect(); } catch { /* already gone */ }
    try { deviceRef.current && deviceRef.current.destroy(); } catch { /* already gone */ }
    callRef.current = null; deviceRef.current = null;
    setCall(null);
    setTimeout(() => { load(false); onChanged(); }, 1500);
  };
  React.useEffect(() => () => {
    try { callRef.current && callRef.current.disconnect(); } catch { /* closing */ }
    try { deviceRef.current && deviceRef.current.destroy(); } catch { /* closing */ }
  }, []);
  const startCall = async () => {
    setCall({ state: 'connecting', muted: false, secs: 0 });
    try {
      const res = await apiFetch('/api/admin/outreach/voice-token');
      if (!res?.ok) { showToast(await outErr(res, "Couldn't start the call"), 'error'); setCall(null); return; }
      const { token } = await res.json();
      const Twilio = await outLoadVoiceSdk();
      const device = new Twilio.Device(token, { codecPreferences: ['opus', 'pcmu'], closeProtection: 'A call is in progress.' });
      deviceRef.current = device;
      const c = await device.connect({ params: { contactId } });
      callRef.current = c;
      setCall({ state: 'ringing', muted: false, secs: 0 });
      c.on('accept', () => setCall((x) => (x ? { ...x, state: 'live' } : x)));
      c.on('disconnect', endCall);
      c.on('cancel', endCall);
      c.on('reject', endCall);
      c.on('error', (e) => { showToast(`Call error: ${e?.message || 'unknown'}`, 'error'); endCall(); });
    } catch (e) {
      showToast(e && /permission|NotAllowed/i.test(String(e.message || e.name)) ? 'Allow microphone access to call from here' : "Couldn't start the call", 'error');
      endCall();
    }
  };
  const toggleMute = () => {
    if (!callRef.current) return;
    const next = !call.muted;
    try { callRef.current.mute(next); } catch { /* not connected yet */ }
    setCall((x) => (x ? { ...x, muted: next } : x));
  };

  const load = async (first) => {
    try {
      const res = await apiFetch(`/api/admin/outreach/${contactId}/messages`);
      if (res?.ok) {
        const d = await res.json();
        setData(d);
        if (first) { setEmail(d.contact.email || ''); setNotes(d.contact.notes || ''); }
      } else if (first) {
        showToast(await outErr(res, 'Failed to load the conversation'), 'error');
      }
    } catch {
      if (first) showToast('Failed to load the conversation', 'error');
    }
  };
  React.useEffect(() => {
    load(true);
    const t = setInterval(() => load(false), 10000);
    return () => clearInterval(t);
  }, [contactId]);
  React.useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [data?.messages?.length]);
  // The composer grows with what is typed (up to a cap, then scrolls inside itself), so a long
  // text can be read and edited in full before it goes.
  React.useEffect(() => {
    const t = draftRef.current;
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = `${Math.min(t.scrollHeight, 160)}px`;
  }, [draft]);

  const c = data?.contact;
  const optedOut = c && (c.status === 'opted_out' || c.opted_out_at);

  const patch = async (body, okMsg) => {
    try {
      const res = await apiFetch(`/api/admin/outreach/${contactId}`, { method: 'PATCH', body: JSON.stringify(body) });
      if (res?.ok) { if (okMsg) showToast(okMsg, 'success'); load(false); onChanged(); }
      else showToast(await outErr(res, 'Failed to save'), 'error');
    } catch {
      showToast('Failed to save', 'error');
    }
  };

  // v1.125.3 — Pete, 10/28: a recorded "yes, I'd like more info" is consent he will stand behind.
  // Logged on the contact as his override: the words, the call they were said on, and who.
  const lastCall = data ? [...data.messages].reverse().find((m) => m.kind === 'call') : null;
  const recordConsent = async (callMessageId, words) => {
    const evidence = String(words || '').trim();
    if (evidence.length < 3) { showToast('Write what they said', 'error'); return; }
    await patch({ textsOk: true, evidence, callMessageId: callMessageId || undefined }, 'OK to text recorded — you can text them now');
    setConsentDraft(null);
  };
  const lastCallQuote = (() => {
    try { const n = lastCall && lastCall.ai_notes ? JSON.parse(lastCall.ai_notes) : null; return n && n.textsOk ? n.consentQuote : ''; } catch { return ''; }
  })();

  const send = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      const res = await apiFetch(`/api/admin/outreach/${contactId}/messages`, { method: 'POST', body: JSON.stringify({ body: draft.trim() }) });
      if (res?.ok) { setDraft(''); load(false); onChanged(); }
      else showToast(await outErr(res, 'Text didn\'t send'), 'error');
    } catch {
      showToast('Text didn\'t send', 'error');
    }
    setBusy(false);
  };

  const invite = async () => {
    setBusy(true);
    try {
      const res = await apiFetch(`/api/admin/outreach/${contactId}/invite`, { method: 'POST', body: JSON.stringify({ email: email.trim() }) });
      if (res?.ok) {
        const d = await res.json();
        showToast(d.status === 'joined' ? `${(c && c.first_name) || 'This person'} already has an account with that email` : 'Signup invite emailed', 'success');
        load(false); onChanged();
      } else {
        showToast(await outErr(res, 'Invite didn\'t send'), 'error');
      }
    } catch {
      showToast('Invite didn\'t send', 'error');
    }
    setBusy(false);
  };

  // 16px, not 14: iOS zooms the whole page into any text box smaller than that, which is one of
  // the ways the header ended up off the top of the screen (v1.125.1).
  const field = { padding: 8, border: '1px solid var(--input-border)', background: 'var(--input-bg)', color: 'var(--text-primary)', borderRadius: 8, fontSize: 16, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' };
  const btn = { padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: 13, cursor: 'pointer' };
  const primary = { ...btn, background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', fontWeight: 600 };

  const detailsOpen = showDetails !== null ? showDetails : !(data && data.messages.length > 0);
  const p = data && data.progress;
  const detailsSummary = c ? [
    optedOut ? 'Opted out' : c.texts_ok_at ? 'OK to text ✓' : 'No OK to text yet',
    p && p.furthestLabel ? p.furthestLabel : null,
    c.email || null,
  ].filter(Boolean).join(' · ') : '';
  const panelBox = vvBox ? { top: vvBox.top, height: vvBox.height } : { top: 0, height: '100%' };

  return outToBody(
    <div onClick={closeByButton} style={{ position: 'fixed', inset: 0, background: 'var(--overlay-bg)', zIndex: 1000 }}>
      <div className="outreach-thread-panel" onClick={(e) => e.stopPropagation()} style={{
        position: 'absolute', right: 0, ...panelBox, width: '100%', maxWidth: 480,
        background: 'var(--bg-card)', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-md)', overflow: 'hidden',
      }}>
        {/* Pinned: who this is. Back arrow on the left, where a thumb on a phone expects it. */}
        <div style={{ flexShrink: 0, padding: '10px 12px', paddingTop: `calc(10px + ${vvBox && vvBox.top > 0 ? '0px' : 'var(--sat, 0px)'})`, borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={closeByButton} aria-label="Back to everyone" style={{ background: 'none', border: 'none', padding: '4px 6px 4px 0', fontSize: 15, cursor: 'pointer', color: 'var(--role-color)', whiteSpace: 'nowrap', flexShrink: 0 }}>‹ All</button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c ? outName(c) : 'Loading…'}</div>
            {c && (
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <a href={`tel:${c.phone}`} style={{ color: 'var(--role-color)' }}>{outPhone(c.phone)}</a>
                {c.email ? ` · ${c.email}` : ''}
              </div>
            )}
          </div>
          {c && <OutStatusPill status={c.joined_user_id && c.status !== 'opted_out' ? 'joined' : c.status} />}
          {c && !call && (
            <button onClick={startCall} title="Call from InPlace's number" style={{ ...btn, padding: '4px 10px', fontSize: 13, flexShrink: 0 }}>📞 Call</button>
          )}
        </div>

        {call && (
          <div style={{ flexShrink: 0, padding: '10px 16px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: 10, ...OUT_TONE.info }}>
            <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>
              {call.state === 'live' ? `On the call · ${outClock(call.secs)}` : call.state === 'ringing' ? 'Ringing…' : 'Connecting…'}
              <span style={{ fontWeight: 400, fontSize: 12 }}> · from InPlace's number</span>
            </span>
            {call.state === 'live' && <button onClick={toggleMute} style={{ ...btn, padding: '4px 10px', fontSize: 12 }}>{call.muted ? 'Unmute' : 'Mute'}</button>}
            <button onClick={endCall} style={{ ...btn, padding: '4px 12px', fontSize: 12, background: 'var(--color-error)', color: 'var(--text-on-primary)', border: 'none' }}>Hang up</button>
          </div>
        )}
        {call && Array.isArray(callScript) && (
          // v1.122.0 — Pete's script, on screen for the whole call. The consent line is the one
          // iPAi listens for in the recording; say it as written.
          <div style={{ flexShrink: 0, padding: '10px 16px', borderBottom: '1px solid var(--border-color)', fontSize: 13, lineHeight: 1.5, maxHeight: vvBox ? Math.round(vvBox.height * 0.3) : 240, overflowY: 'auto' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 4 }}>Script</div>
            {callScript.map((l, i) => (
              <div key={i} style={l.consent
                ? { margin: '6px 0', padding: '6px 10px', borderRadius: 8, fontWeight: 600, ...OUT_TONE.warning }
                : l.branch === 'voicemail' && l.say
                  ? { margin: '3px 0 10px', padding: '6px 10px', borderRadius: 8, ...OUT_TONE.info }
                  : { margin: '3px 0', color: l.note ? 'var(--text-secondary)' : 'var(--text-primary)', fontStyle: l.note ? 'italic' : 'normal' }}>
                {l.consent ? '❓ Ask exactly: ' : ''}{String(l.say || l.note).replace(/\{first\}/g, (c && c.first_name) || 'there')}
              </div>
            ))}
          </div>
        )}

        {/* ONE scroll region: details (folded) above the whole conversation. Nothing above the
            messages is fixed any more, so nothing can squeeze them to zero. */}
        <div className="outreach-thread-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
          {c && (
            <button onClick={() => setShowDetails(!detailsOpen)} aria-expanded={detailsOpen} style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 16px', border: 'none', borderBottom: '1px solid var(--border-color)',
              background: 'var(--bg-primary)', color: 'var(--text-secondary)', fontSize: 12, textAlign: 'left', cursor: 'pointer',
            }}>
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{detailsOpen ? '▾' : '▸'} Details</span>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detailsSummary}</span>
            </button>
          )}
          {c && detailsOpen && (
            <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-color)', display: 'grid', gap: 8 }}>
              {!optedOut && (
                // v1.122.0 — texts need a recorded OK.
                <div style={{ fontSize: 12, lineHeight: 1.5, padding: '6px 10px', borderRadius: 8, ...(c.texts_ok_at ? OUT_TONE.success : OUT_TONE.muted) }}>
                  {c.texts_ok_at
                    ? <>✓ OK to text · {c.texts_ok_evidence || 'recorded'}{' '}
                        <a href="#" onClick={(e) => { e.preventDefault(); if (window.confirm('Withdraw the OK to text? Texting this person will be blocked.')) patch({ textsOk: false }, 'OK withdrawn'); }} style={{ color: 'inherit', textDecoration: 'underline' }}>Withdraw</a></>
                    : <>No OK to text yet. On the call, ask if you can text them. Then either they text JOIN to this number, or you record their yes here.</>}
                </div>
              )}
              {!optedOut && !c.texts_ok_at && consentDraft === null && (
                <button style={{ ...btn, justifySelf: 'start' }} onClick={() => setConsentDraft(lastCallQuote || '')}>
                  Record OK from the call{lastCall ? '' : ' (no recorded call yet)'}
                </button>
              )}
              {!optedOut && !c.texts_ok_at && consentDraft !== null && (
                <div style={{ display: 'grid', gap: 6, padding: 10, borderRadius: 8, border: '1px solid var(--border-color)' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    What did they say when you asked if you could text them? {lastCall ? `Saved with the ${outWhen(lastCall.created_at)} call and its recording` : 'There is no recorded call in this thread, so this is saved as your note only'}, as your OK.
                  </div>
                  <textarea style={{ ...field, minHeight: 44 }} placeholder="e.g. Yeah, yeah, I would like more info" value={consentDraft} onChange={(e) => setConsentDraft(e.target.value)} />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button style={primary} disabled={consentDraft.trim().length < 3} onClick={() => recordConsent(lastCall && lastCall.id, consentDraft)}>Save OK to text</button>
                    <button style={btn} onClick={() => setConsentDraft(null)}>Cancel</button>
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <input style={{ ...field, minWidth: 0 }} type="email" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} />
                <button style={{ ...primary, whiteSpace: 'nowrap', flexShrink: 0 }} disabled={busy || !email.trim()} onClick={invite}>{c.invite_id ? 'Resend invite' : 'Send invite'}</button>
              </div>
              <textarea style={{ ...field, minHeight: 44 }} placeholder="Notes (only admins see these)" value={notes}
                onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (c.notes || '') && patch({ notes })} />
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {optedOut
                  ? <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Replied STOP. InPlace won't text this number again unless it texts START.</span>
                  : ['interested', 'declined', 'wrong_number', 'opted_out'].filter((s) => s !== c.status).map((s) => (
                    <button key={s} style={{ ...btn, padding: '4px 10px', fontSize: 12 }}
                      onClick={() => (s !== 'opted_out' || window.confirm('Mark as do-not-text? This can\'t be undone from here.')) && patch({ status: s }, 'Saved')}>
                      {s === 'opted_out' ? 'Do not text' : `Mark ${OUT_STATUS[s].label.toLowerCase()}`}
                    </button>
                  ))}
              </div>
            </div>
          )}
          {data && detailsOpen && <OutProgress p={data.progress} />}
          {data && detailsOpen && <OutJourney j={data.journey} />}

          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {data && data.messages.length === 0 && (
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center', marginTop: 24 }}>No texts yet.</div>
            )}
            {data && data.messages.map((m) => {
              const mine = m.direction === 'out';
              const bad = ['failed', 'undelivered'].includes(m.status);
              return (
                <div key={m.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%' }}>
                  <div style={{
                    padding: '8px 12px', borderRadius: 14, fontSize: 14, lineHeight: 1.4, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    background: mine ? 'var(--bubble-sent-bg)' : 'var(--bubble-received-bg)',
                    color: mine ? 'var(--bubble-sent-text)' : 'var(--bubble-received-text)',
                    border: bad ? '2px solid var(--color-error)' : 'none',
                  }}>
                    {m.kind === 'voicemail' ? '📞 ' : m.kind === 'call' ? '📞 ' : ''}{m.body}
                    {m.kind === 'voicemail' && m.media_url && <OutVoicemailPlayer messageId={m.id} apiFetch={apiFetch} showToast={showToast} />}
                    {m.kind === 'call' && <OutCallDetail m={m} apiFetch={apiFetch} showToast={showToast}
                      onUseConsent={c && !c.texts_ok_at && !optedOut ? (id, quote) => recordConsent(id, quote) : null} />}
                  </div>
                  <div style={{ fontSize: 11, color: bad ? 'var(--color-error)' : 'var(--text-muted)', marginTop: 2, textAlign: mine ? 'right' : 'left' }}>
                    {outWhen(m.created_at)}
                    {(m.kind === 'voicemail' || m.kind === 'call') && m.duration ? ` · ${outClock(m.duration)}` : ''}
                    {mine && (m.automated ? ' · sent automatically' : m.sender_first_name ? ` · ${m.sender_first_name}` : '')}
                    {mine && m.kind !== 'call' && m.status && !bad && m.status !== 'sending' ? ` · ${m.status}` : ''}
                    {bad ? ` · not delivered${m.error ? ` (${m.error})` : ''}` : ''}
                  </div>
                </div>
              );
            })}
            <div ref={endRef} />
          </div>
        </div>

        {c && !optedOut && !c.texts_ok_at && (
          <div style={{ flexShrink: 0, padding: 12, borderTop: '1px solid var(--border-color)', fontSize: 13, color: 'var(--text-secondary)', paddingBottom: `calc(12px + ${vvBox && vvBox.height < window.innerHeight - 120 ? '0px' : 'var(--sab, 0px)'})` }}>
            Texting opens when they text this number (JOIN or anything else), or when you record their yes from the call.
            {consentDraft === null && (
              <div style={{ marginTop: 8 }}>
                <button style={primary} onClick={() => { setShowDetails(true); setConsentDraft(lastCallQuote || ''); }}>Record OK from the call</button>
              </div>
            )}
          </div>
        )}
        {c && !optedOut && c.texts_ok_at && (
          <div style={{ flexShrink: 0, padding: 10, borderTop: '1px solid var(--border-color)', display: 'flex', gap: 8, alignItems: 'flex-end', paddingBottom: `calc(10px + ${vvBox && vvBox.height < window.innerHeight - 120 ? '0px' : 'var(--sab, 0px)'})` }}>
            <textarea ref={draftRef} rows={1} style={{ ...field, minHeight: 40, maxHeight: 160, resize: 'none', overflowY: 'auto', fontSize: 16, lineHeight: 1.35 }} placeholder={`Text ${outGreeting(c)} from InPlace…`} value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); }} />
            <button style={{ ...primary, flexShrink: 0 }} disabled={busy || !draft.trim()} onClick={send}>Send</button>
          </div>
        )}
      </div>
    </div>
  );
};

const AdminOutreachTab = window.AdminOutreachTab = ({ apiFetch, showToast, onUnreadChange }) => {
  const [data, setData] = React.useState(null);
  const [filter, setFilter] = React.useState('all');
  const [selected, setSelected] = React.useState(() => new Set());
  const [openId, setOpenId] = React.useState(null);
  const [showImport, setShowImport] = React.useState(false);
  const [importText, setImportText] = React.useState('');
  const [importSource, setImportSource] = React.useState('NRV Agency on Aging private-pay sitter list');
  const [composer, setComposer] = React.useState(false);
  // v1.125.1 — add one person by hand (Pete, 10/28: "a way that I can enter a phone number in or
  // pick from Contacts as well. You can't just be a pre-populated list based on an import.")
  const [showAdd, setShowAdd] = React.useState(false);
  const [add, setAdd] = React.useState({ firstName: '', lastName: '', phone: '', notes: '' });
  // The browser's own contact picker. Chrome on Android has it; iPhone browsers and the iPhone
  // app's web view do not (that needs a native plugin and a new app build), so the button only
  // appears where it works.
  const canPickContact = typeof navigator !== 'undefined' && navigator.contacts && typeof navigator.contacts.select === 'function';
  const [template, setTemplate] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const load = async () => {
    try {
      const res = await apiFetch('/api/admin/outreach');
      if (res?.ok) {
        const d = await res.json();
        setData(d);
        setTemplate((t) => {
          if (t) return t;
          try { return localStorage.getItem(OUT_TEMPLATE_KEY) || d.defaultIntro; } catch { return d.defaultIntro; }
        });
        if (onUnreadChange) onUnreadChange(d.contacts.reduce((n, x) => n + (x.unread ? 1 : 0), 0));
      } else {
        showToast(await outErr(res, 'Failed to load outreach'), 'error');
      }
    } catch {
      showToast('Failed to load outreach', 'error');
    }
  };
  const sending = !!data?.sending;
  React.useEffect(() => {
    load();
    const t = setInterval(load, sending ? 3000 : 20000);
    return () => clearInterval(t);
  }, [sending]);

  const contacts = data?.contacts || [];
  const counts = contacts.reduce((a, x) => { a[x.status] = (a[x.status] || 0) + 1; return a; }, {});
  const unreadCount = contacts.filter((x) => x.unread).length;
  const shown = filter === 'all' ? contacts
    : filter === 'unread' ? contacts.filter((x) => x.unread)
    : filter.startsWith('step:') ? contacts.filter((x) => x.progress && x.progress.furthest === filter.slice(5)) // v1.125.0
    : contacts.filter((x) => x.status === filter);
  // v1.122.0 — the follow-up text goes only to people who OK'd texts. Since v1.124.1 that means they texted in (JOIN).
  const textable = (x) => !!x.texts_ok_at && x.status !== 'opted_out' && !x.opted_out_at && !x.intro_sent_at && x.status !== 'joined';
  const shownTextable = shown.filter(textable);
  const selectedList = contacts.filter((x) => selected.has(x.id) && textable(x));

  const toggle = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const selectAllShown = () => setSelected((s) => {
    const n = new Set(s);
    const all = shownTextable.every((x) => n.has(x.id));
    shownTextable.forEach((x) => (all ? n.delete(x.id) : n.add(x.id)));
    return n;
  });

  const doImport = async () => {
    setBusy(true);
    try {
      const res = await apiFetch('/api/admin/outreach/import', { method: 'POST', body: JSON.stringify({ text: importText, source: importSource }) });
      if (res?.ok) {
        const d = await res.json();
        showToast(`Added ${d.added}${d.duplicates ? ` · ${d.duplicates} already here` : ''}${d.skipped.length ? ` · ${d.skipped.length} lines skipped` : ''}`, 'success');
        setImportText(''); setShowImport(false); load();
      } else {
        showToast(await outErr(res, 'Import failed'), 'error');
      }
    } catch {
      showToast('Import failed', 'error');
    }
    setBusy(false);
  };

  const pickContact = async () => {
    try {
      const [p] = await navigator.contacts.select(['name', 'tel'], { multiple: false });
      if (!p) return;
      const full = String((p.name && p.name[0]) || '').trim();
      const parts = full.split(/\s+/).filter(Boolean);
      const tel = (p.tel || []).find((t) => String(t).replace(/\D/g, '').length >= 10) || (p.tel || [])[0] || '';
      setAdd((a) => ({ ...a, firstName: parts.shift() || a.firstName, lastName: parts.join(' ') || a.lastName, phone: formatPhone(outUsDigits(tel)) }));
    } catch { /* picker closed */ }
  };
  const addPerson = async () => {
    setBusy(true);
    try {
      const res = await apiFetch('/api/admin/outreach/contacts', { method: 'POST', body: JSON.stringify(add) });
      if (res?.ok) {
        const d = await res.json();
        showToast(d.existing ? 'Already on your list — here is their conversation' : 'Added', 'success');
        setAdd({ firstName: '', lastName: '', phone: '', notes: '' }); setShowAdd(false);
        await load();
        setOpenId(d.id);
      } else {
        showToast(await outErr(res, "Couldn't add them"), 'error');
      }
    } catch {
      showToast("Couldn't add them", 'error');
    }
    setBusy(false);
  };
  const addDigits = outUsDigits(add.phone);

  const sendIntro = async () => {
    if (!window.confirm(`Text ${selectedList.length} ${selectedList.length === 1 ? 'person' : 'people'} from InPlace now?`)) return;
    setBusy(true);
    try {
      try { localStorage.setItem(OUT_TEMPLATE_KEY, template); } catch { /* private window */ }
      const res = await apiFetch('/api/admin/outreach/send-intro', { method: 'POST', body: JSON.stringify({ ids: selectedList.map((x) => x.id), template }) });
      if (res?.ok) {
        const d = await res.json();
        showToast(`Sending to ${d.queued}${d.skipped ? ` (${d.skipped} skipped)` : ''}…`, 'success');
        setSelected(new Set()); setComposer(false); load();
      } else {
        showToast(await outErr(res, 'Couldn\'t start sending'), 'error');
      }
    } catch {
      showToast('Couldn\'t start sending', 'error');
    }
    setBusy(false);
  };

  const field = { padding: 8, border: '1px solid var(--input-border)', background: 'var(--input-bg)', color: 'var(--text-primary)', borderRadius: 8, fontSize: 14, width: '100%', boxSizing: 'border-box' };
  const btn = { padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: 13, cursor: 'pointer' };
  const primary = { ...btn, background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', fontWeight: 600 };
  const chip = (id, label, n) => (
    <button key={id} onClick={() => setFilter(id)} style={{
      ...btn, padding: '5px 11px', fontSize: 12, borderRadius: 16,
      background: filter === id ? 'var(--role-color)' : 'var(--bg-primary)',
      color: filter === id ? 'var(--text-on-primary)' : 'var(--text-primary)',
      border: filter === id ? 'none' : '1px solid var(--border-color)',
    }}>{label}{n !== undefined ? ` ${n}` : ''}</button>
  );

  if (!data) return <div className="card" style={{ fontSize: 13 }}>Loading&hellip;</div>;

  const preview = selectedList[0] || shownTextable[0] || contacts[0];
  const previewText = outRender(template, preview);

  return (
    <div>
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>Caregiver outreach</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2, lineHeight: 1.5 }}>
              {data.number
                ? <>Call first (📞 in each thread — recorded, with the script on screen) and ask if you can text them. Texts go out from <b>{outPhone(data.number)}</b> only to people who OK'd them — by texting that number, or by saying yes on a recorded call (Details → Record OK from the call). Replies land here; a reply with an email address gets a signup invite automatically.</>
                : <span style={{ color: 'var(--color-error)' }}>The outreach number isn't set up yet, so texting is off. You can still import and organize the list.</span>}
            </div>
          </div>
          <button style={btn} onClick={() => { setShowAdd((v) => !v); setShowImport(false); }}>{showAdd ? 'Close add' : '+ Add person'}</button>
          <button style={btn} onClick={() => { setShowImport((v) => !v); setShowAdd(false); }}>{showImport ? 'Close import' : 'Import list'}</button>
          <button style={primary} disabled={!selectedList.length || !data.number || sending} onClick={() => setComposer(true)}>
            Text follow-up{selectedList.length ? ` to ${selectedList.length}` : ''}
          </button>
        </div>
        {data.sending && (
          <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, ...OUT_TONE.info, fontSize: 13 }}>
            Sending… {data.sending.sent + data.sending.failed} of {data.sending.total}{data.sending.failed ? ` (${data.sending.failed} failed)` : ''}
          </div>
        )}
        {!data.introWindow.open && (
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-secondary)' }}>{data.introWindow.reason} Replies to people who've written back can go any time.</div>
        )}
      </div>

      {showAdd && (
        <div className="card">
          <div className="card-header">Add a person</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, lineHeight: 1.5 }}>
            You can call them right away. Texting opens once they text the outreach number (JOIN), same as everyone else.
            {!canPickContact && <> On iPhone: in Contacts, press and hold their number, tap Copy, and paste it below.</>}
          </div>
          {canPickContact && (
            <button style={{ ...btn, marginBottom: 8 }} onClick={pickContact}>Pick from Contacts</button>
          )}
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input style={{ ...field, fontSize: 16 }} placeholder="First name" autoComplete="off" value={add.firstName} onChange={(e) => setAdd({ ...add, firstName: e.target.value })} />
            <input style={{ ...field, fontSize: 16 }} placeholder="Last name" autoComplete="off" value={add.lastName} onChange={(e) => setAdd({ ...add, lastName: e.target.value })} />
          </div>
          <input style={{ ...field, fontSize: 16, marginBottom: 8 }} type="tel" inputMode="tel" placeholder="(540) 555-0123" autoComplete="off" value={add.phone}
            onChange={(e) => setAdd({ ...add, phone: formatPhone(outUsDigits(e.target.value)) })} />
          <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '-4px 0 8px' }}>US numbers only — the outreach line can't call or text outside the US.</div>
          <input style={{ ...field, fontSize: 16, marginBottom: 8 }} placeholder="Notes (optional) — e.g. CNA, Christiansburg, met at church" value={add.notes} onChange={(e) => setAdd({ ...add, notes: e.target.value })} />
          <button style={primary} disabled={busy || addDigits.length !== 10 || !(add.firstName.trim() || add.lastName.trim())} onClick={addPerson}>Add and open</button>
        </div>
      )}

      {showImport && (
        <div className="card">
          <div className="card-header">Import a list</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, lineHeight: 1.5 }}>
            Paste one person per line, e.g. <code>Gambill, Juanita ..... 540-831-9027 (CNA, Christiansburg)</code>. Anything after the number goes into notes. Numbers already here are skipped, and two names on one number become one conversation.
          </div>
          <input style={{ ...field, marginBottom: 8 }} placeholder="Where this list came from" value={importSource} onChange={(e) => setImportSource(e.target.value)} />
          <textarea style={{ ...field, minHeight: 160, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }} value={importText} onChange={(e) => setImportText(e.target.value)} />
          <div style={{ marginTop: 8 }}><button style={primary} disabled={busy || !importText.trim()} onClick={doImport}>Import</button></div>
        </div>
      )}

      {composer && (
        <div className="card">
          <div className="card-header">Follow-up text to {selectedList.length} {selectedList.length === 1 ? 'person' : 'people'}</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
            <code>{'{first}'}</code> becomes each person's first name, and <code>{'{link}'}</code> becomes their own link to InPlace, so you can see who opened it. Keep "Reply STOP to opt out" — it's required, and the server won't send without it.
          </div>
          <textarea style={{ ...field, minHeight: 120 }} value={template} onChange={(e) => setTemplate(e.target.value)} />
          {!/\{link\}/i.test(template) && (
            <div style={{ fontSize: 12, margin: '6px 0 0', padding: '6px 10px', borderRadius: 8, ...OUT_TONE.warning }}>
              No <code>{'{link}'}</code> in this text, so you won't see who opens it.{' '}
              <button style={{ background: 'none', border: 'none', color: 'inherit', textDecoration: 'underline', cursor: 'pointer', fontSize: 12, padding: 0 }}
                onClick={() => setTemplate(/yourinplace\.com/i.test(template) ? template.replace(/\(?yourinplace\.com\)?/i, (m) => m.replace(/yourinplace\.com/i, '{link}')) : `${template.trim()} {link}`)}>Add it</button>
            </div>
          )}
          <div style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 10px' }}>
            {previewText.length} characters · {outSegments(previewText)} text{outSegments(previewText) === 1 ? '' : 's'} each
            {' · '}<button style={{ background: 'none', border: 'none', color: 'var(--role-color)', cursor: 'pointer', fontSize: 12, padding: 0 }}
              onClick={() => setTemplate(data.defaultIntro)}>reset to default</button>
          </div>
          {preview && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>What {outName(preview)} will see</div>
              <div style={{ padding: '8px 12px', borderRadius: 14, background: 'var(--bubble-received-bg)', color: 'var(--bubble-received-text)', fontSize: 14, lineHeight: 1.4, maxWidth: 360, whiteSpace: 'pre-wrap' }}>{previewText}</div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={primary} disabled={busy || !template.trim() || !data.introWindow.open} onClick={sendIntro}>Send now</button>
            <button style={btn} onClick={() => setComposer(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="card">
        <OutFunnel funnel={data.funnel} filter={filter} setFilter={setFilter} contacts={contacts} />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {chip('all', 'All', contacts.length)}
          {unreadCount > 0 && chip('unread', 'Unread', unreadCount)}
          {Object.keys(OUT_STATUS).filter((s) => counts[s]).map((s) => chip(s, OUT_STATUS[s].label, counts[s]))}
        </div>
        {shownTextable.length > 0 && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)', padding: '4px 0 8px', cursor: 'pointer' }}>
            <input type="checkbox" checked={shownTextable.every((x) => selected.has(x.id))} onChange={selectAllShown} />
            Select everyone not yet texted ({shownTextable.length})
          </label>
        )}
        {contacts.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', padding: '12px 0' }}>No one here yet. Use “+ Add person” for one number, or “Import list” to paste a list.</div>
        )}
        {shown.map((x) => (
          <div key={x.id} onClick={() => setOpenId(x.id)} style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '10px 4px', borderTop: '1px solid var(--border-light)', cursor: 'pointer',
          }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: 22, flexShrink: 0 }}>
              {textable(x) && <input type="checkbox" checked={selected.has(x.id)} onChange={() => toggle(x.id)} aria-label={`Select ${outName(x)}`} />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {x.unread ? <span style={{ width: 8, height: 8, borderRadius: 4, background: 'var(--role-color)', flexShrink: 0 }} /> : null}
                <span style={{ fontWeight: x.unread ? 700 : 600, color: 'var(--text-primary)', fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{outName(x)}</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{outPhone(x.phone)}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
                {x.last_body ? `${x.last_direction === 'out' ? 'You: ' : ''}${x.last_body}` : (x.notes || '')}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
              <OutStatusPill status={x.status} />
              {Number(x.failed_count) > 0
                ? <span style={{ fontSize: 11, color: 'var(--color-error)' }}>not delivered</span>
                : <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{x.link_opened_at ? '🔗 opened · ' : ''}{outWhen(x.last_message_at)}</span>}
              {x.progress && x.progress.furthest && (
                <span style={{ fontSize: 11, color: outStall(x.progress) ? 'var(--color-warning)' : 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                  {x.progress.furthestLabel}{outStall(x.progress) ? ` · ${outStall(x.progress)}` : ''}
                </span>
              )}
              {x.progress && OUT_FLAG[x.progress.flag] && (
                <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 10, ...OUT_TONE[OUT_FLAG[x.progress.flag].tone] }}>{OUT_FLAG[x.progress.flag].label}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <OutCampaignLinks apiFetch={apiFetch} showToast={showToast} />

      {openId && (
        <OutreachThread contactId={openId} apiFetch={apiFetch} showToast={showToast} callScript={data && data.callScript}
          onClose={() => { setOpenId(null); load(); }} onChanged={load} />
      )}
    </div>
  );
};
