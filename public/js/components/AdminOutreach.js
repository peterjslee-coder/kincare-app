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
const OUT_TEMPLATE_KEY = 'inplace.outreach.introTemplate';

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
const outMins = (ms) => {
  const m = Math.round((Number(ms) || 0) / 60000);
  return m < 1 ? 'under a minute' : m === 1 ? '1 minute' : m < 90 ? `${m} minutes` : `${Math.round(m / 6) / 10} hours`;
};
const OutJourney = ({ j }) => {
  if (!j) return null;
  const opened = j.opens > 0;
  return (
    <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-color)', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
      <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>Her link</div>
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
        Make one link per place you post: a flyer, a Facebook post, a church bulletin, an ad. Everyone who comes in through it is counted, and so is everyone who signs up.
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

const OutVoicemailPlayer = ({ messageId, apiFetch, showToast }) => {
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
      {loading ? 'Loading…' : '▶ Play voicemail'}
    </button>
  );
};

const OutStatusPill = ({ status }) => {
  const s = OUT_STATUS[status] || { label: status, tone: 'muted' };
  return (
    <span style={{ ...OUT_TONE[s.tone], padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>{s.label}</span>
  );
};

const OutreachThread = ({ contactId, apiFetch, showToast, onClose, onChanged }) => {
  const [data, setData] = React.useState(null);
  const [draft, setDraft] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const endRef = React.useRef(null);
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
        showToast(d.status === 'joined' ? 'She already has an account with that email' : 'Signup invite emailed', 'success');
        load(false); onChanged();
      } else {
        showToast(await outErr(res, 'Invite didn\'t send'), 'error');
      }
    } catch {
      showToast('Invite didn\'t send', 'error');
    }
    setBusy(false);
  };

  const field = { padding: 8, border: '1px solid var(--input-border)', background: 'var(--input-bg)', color: 'var(--text-primary)', borderRadius: 8, fontSize: 14, width: '100%', boxSizing: 'border-box' };
  const btn = { padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: 13, cursor: 'pointer' };
  const primary = { ...btn, background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', fontWeight: 600 };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'var(--overlay-bg)', zIndex: 1000, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 480, height: '100%', background: 'var(--bg-card)', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-md)' }}>
        <div style={{ padding: '14px 16px', paddingTop: 'calc(14px + var(--sat, 0px))', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>{c ? outName(c) : 'Loading…'}</div>
            {c && (
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
                <a href={`tel:${c.phone}`} style={{ color: 'var(--role-color)' }}>{outPhone(c.phone)}</a>
                {c.email ? ` · ${c.email}` : ''}
              </div>
            )}
          </div>
          {c && <OutStatusPill status={c.joined_user_id && c.status !== 'opted_out' ? 'joined' : c.status} />}
          {c && !call && (
            <button onClick={startCall} title="Call from InPlace's number" style={{ ...btn, padding: '4px 10px', fontSize: 13 }}>📞 Call</button>
          )}
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: 24, lineHeight: 1, cursor: 'pointer', color: 'var(--text-secondary)' }}>×</button>
        </div>

        {call && (
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: 10, ...OUT_TONE.info }}>
            <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>
              {call.state === 'live' ? `On the call · ${outClock(call.secs)}` : call.state === 'ringing' ? 'Ringing…' : 'Connecting…'}
              <span style={{ fontWeight: 400, fontSize: 12 }}> · from InPlace's number</span>
            </span>
            {call.state === 'live' && <button onClick={toggleMute} style={{ ...btn, padding: '4px 10px', fontSize: 12 }}>{call.muted ? 'Unmute' : 'Mute'}</button>}
            <button onClick={endCall} style={{ ...btn, padding: '4px 12px', fontSize: 12, background: 'var(--color-error)', color: 'var(--text-on-primary)', border: 'none' }}>Hang up</button>
          </div>
        )}

        {c && (
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-color)', display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <input style={field} type="email" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} />
              <button style={{ ...primary, whiteSpace: 'nowrap' }} disabled={busy || !email.trim()} onClick={invite}>{c.invite_id ? 'Resend invite' : 'Send invite'}</button>
            </div>
            <textarea style={{ ...field, minHeight: 44, fontSize: 13 }} placeholder="Notes (only admins see these)" value={notes}
              onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (c.notes || '') && patch({ notes })} />
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {optedOut
                ? <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>She replied STOP. InPlace won't text her again unless she texts START.</span>
                : ['interested', 'declined', 'wrong_number', 'opted_out'].filter((s) => s !== c.status).map((s) => (
                  <button key={s} style={{ ...btn, padding: '4px 10px', fontSize: 12 }}
                    onClick={() => (s !== 'opted_out' || window.confirm('Mark as do-not-text? This can\'t be undone from here.')) && patch({ status: s }, 'Saved')}>
                    {s === 'opted_out' ? 'Do not text' : `Mark ${OUT_STATUS[s].label.toLowerCase()}`}
                  </button>
                ))}
            </div>
          </div>
        )}

        {data && <OutJourney j={data.journey} />}

        <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
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
                </div>
                <div style={{ fontSize: 11, color: bad ? 'var(--color-error)' : 'var(--text-muted)', marginTop: 2, textAlign: mine ? 'right' : 'left' }}>
                  {outWhen(m.created_at)}
                  {m.kind === 'voicemail' && m.duration ? ` · ${outClock(m.duration)}` : ''}
                  {mine && (m.automated ? ' · sent automatically' : m.sender_first_name ? ` · ${m.sender_first_name}` : '')}
                  {mine && m.kind !== 'call' && m.status && !bad && m.status !== 'sending' ? ` · ${m.status}` : ''}
                  {bad ? ` · not delivered${m.error ? ` (${m.error})` : ''}` : ''}
                </div>
              </div>
            );
          })}
          <div ref={endRef} />
        </div>

        {c && !optedOut && (
          <div style={{ padding: 12, borderTop: '1px solid var(--border-color)', display: 'flex', gap: 8, paddingBottom: 'calc(12px + var(--sab, 0px))' }}>
            <textarea style={{ ...field, minHeight: 44, resize: 'vertical' }} placeholder="Text her from InPlace…" value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); }} />
            <button style={primary} disabled={busy || !draft.trim()} onClick={send}>Send</button>
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
  const shown = filter === 'all' ? contacts : filter === 'unread' ? contacts.filter((x) => x.unread) : contacts.filter((x) => x.status === filter);
  const textable = (x) => x.status === 'new' && !x.opted_out_at && !x.intro_sent_at;
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
                ? <>Texts go out from InPlace's outreach number, <b>{outPhone(data.number)}</b>. Replies land here. A reply with an email address gets a signup invite automatically.</>
                : <span style={{ color: 'var(--color-error)' }}>The outreach number isn't set up yet, so texting is off. You can still import and organize the list.</span>}
            </div>
          </div>
          <button style={btn} onClick={() => setShowImport((v) => !v)}>{showImport ? 'Close import' : 'Import list'}</button>
          <button style={primary} disabled={!selectedList.length || !data.number || sending} onClick={() => setComposer(true)}>
            Text intro{selectedList.length ? ` to ${selectedList.length}` : ''}
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
          <div className="card-header">Intro text to {selectedList.length} {selectedList.length === 1 ? 'person' : 'people'}</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
            <code>{'{first}'}</code> becomes each person's first name, and <code>{'{link}'}</code> becomes her own link to InPlace, so you can see who opened it. Keep "Reply STOP to opt out" — it's required, and the server won't send without it.
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
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', padding: '12px 0' }}>No one here yet. Use “Import list” to paste the sitter list.</div>
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
            </div>
          </div>
        ))}
      </div>

      <OutCampaignLinks apiFetch={apiFetch} showToast={showToast} />

      {openId && (
        <OutreachThread contactId={openId} apiFetch={apiFetch} showToast={showToast}
          onClose={() => { setOpenId(null); load(); }} onChanged={load} />
      )}
    </div>
  );
};
