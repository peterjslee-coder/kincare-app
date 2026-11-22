// ─── Updates from InPlace, caregiver side (v1.146.0) ───
//
// Pete, 11/22: "a messaging option for all caregivers. An update. Tips. Newsletter of sorts."
// It lands as a card pinned at the top of her Home (and a push). "Got it" folds it away;
// "Reply to <name>" sends a private message to whoever wrote it. Every one she has had is in
// My Account › Settings › Updates from InPlace. Server: src/routes/caregiverUpdates.js.

const CG_UPDATE_KIND = {
  tip: { icon: '\u{1F4A1}', label: 'TIP FROM INPLACE' },
  news: { icon: '\u{1F4E3}', label: 'UPDATE FROM INPLACE' },
  thanks: { icon: '\u{1F49B}', label: 'A NOTE FROM INPLACE' },
};

function cgUpdateDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch { return ''; }
}

const cgUpdateBtn = {
  minHeight: 40, padding: '0 16px', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer',
};

function CaregiverUpdateReply({ update, onSent, onCancel }) {
  const [text, setText] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  const first = String(update.from || 'InPlace').split(' ')[0];
  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true); setErr('');
    try {
      const res = await apiFetch(`/api/caregiver-updates/${update.id}/reply`, {
        method: 'POST', body: JSON.stringify({ text: text.trim() }),
      });
      if (res && res.ok) { onSent && onSent(); return; }
      const d = res ? await res.json().catch(() => ({})) : {};
      setErr(d.error || 'Your reply didn’t send. Try again.');
    } catch { setErr('Your reply didn’t send. Try again.'); }
    setBusy(false);
  };
  return (
    <div style={{ marginTop: 10 }}>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={2000}
        placeholder={`Only ${first} sees this`} aria-label={`Reply to ${first}`}
        style={{ width: '100%', boxSizing: 'border-box', padding: 10, borderRadius: 10, border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 15, fontFamily: 'inherit', resize: 'vertical' }} />
      {err && <div role="alert" style={{ color: 'var(--color-error)', fontSize: 13, marginTop: 4 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button type="button" onClick={send} disabled={!text.trim() || busy}
          style={{ ...cgUpdateBtn, border: 'none', background: 'var(--role-color)', color: 'var(--text-on-primary)', opacity: (!text.trim() || busy) ? 0.55 : 1 }}>
          {busy ? 'Sending…' : `Send to ${first}`}
        </button>
        <button type="button" onClick={onCancel}
          style={{ ...cgUpdateBtn, border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-secondary)' }}>Cancel</button>
      </div>
    </div>
  );
}

function CaregiverUpdateBody({ update }) {
  const k = CG_UPDATE_KIND[update.kind] || CG_UPDATE_KIND.tip;
  return (
    <React.Fragment>
      <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--role-color)' }}>
        <span aria-hidden="true">{k.icon}</span>{' '}{k.label}
        <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{' · '}{cgUpdateDate(update.createdAt)}</span>
      </div>
      <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)', marginTop: 6, lineHeight: 1.3 }}>{update.title}</div>
      <div style={{ fontSize: 15, color: 'var(--text-primary)', marginTop: 6, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{update.body}</div>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 8 }}>{'— '}{update.from}, InPlace</div>
    </React.Fragment>
  );
}

/** The pinned card at the top of the caregiver's Home. Renders nothing when there is none. */
const CaregiverUpdateCard = window.CaregiverUpdateCard = () => {
  const [update, setUpdate] = React.useState(null);
  const [replying, setReplying] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const seenRef = React.useRef(null);

  const load = React.useCallback(async () => {
    try {
      const res = await apiFetch('/api/caregiver-updates/mine');
      if (!res || !res.ok) return;
      const d = await res.json();
      setUpdate(d.pinned || null);
    } catch { /* a missing tip is not worth an error */ }
  }, []);

  React.useEffect(() => {
    load();
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  React.useEffect(() => {
    if (!update || update.seenAt || seenRef.current === update.id) return;
    seenRef.current = update.id;
    apiFetch(`/api/caregiver-updates/${update.id}/seen`, { method: 'POST' }).catch(() => {});
  }, [update]);

  if (sent) {
    return (
      <div className="card" role="status" style={{ marginBottom: 16, padding: '12px 16px', color: 'var(--color-success)', fontWeight: 600, fontSize: 14 }}>
        {'✓ Sent. '}{String((update && update.from) || 'InPlace').split(' ')[0]} will see it in Messages.
      </div>
    );
  }
  if (!update) return null;
  const first = String(update.from || 'InPlace').split(' ')[0];

  const gotIt = async () => {
    const id = update.id;
    setUpdate(null);
    try { await apiFetch(`/api/caregiver-updates/${id}/got-it`, { method: 'POST' }); } catch { /* it comes back next load */ }
    load();
  };

  return (
    <section aria-label="Update from InPlace" data-testid="caregiver-update-card"
      style={{ marginBottom: 16, padding: '14px 16px', borderRadius: 14, background: 'var(--bg-highlight)', border: '1px solid var(--border-color)', borderLeft: '4px solid var(--role-color)' }}>
      <CaregiverUpdateBody update={update} />
      {replying ? (
        <CaregiverUpdateReply update={update} onCancel={() => setReplying(false)}
          onSent={() => { setReplying(false); setSent(true); setTimeout(() => { setSent(false); load(); }, 4000); }} />
      ) : (
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button type="button" onClick={gotIt}
            style={{ ...cgUpdateBtn, border: 'none', background: 'var(--role-color)', color: 'var(--text-on-primary)' }}>Got it</button>
          <button type="button" onClick={() => setReplying(true)}
            style={{ ...cgUpdateBtn, border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-primary)' }}>Reply to {first}</button>
        </div>
      )}
    </section>
  );
};

/** My Account › Settings: every update she has had, newest first. */
const CaregiverUpdatesHistory = window.CaregiverUpdatesHistory = () => {
  const [items, setItems] = React.useState(null);
  const [open, setOpen] = React.useState(null);
  const [replyTo, setReplyTo] = React.useState(null);
  const load = React.useCallback(async () => {
    try {
      const res = await apiFetch('/api/caregiver-updates/mine');
      if (!res || !res.ok) { setItems([]); return; }
      const d = await res.json();
      setItems(d.history || []);
    } catch { setItems([]); }
  }, []);
  React.useEffect(() => { load(); }, [load]);

  return (
    <div className="card" style={{ marginBottom: 16 }} data-testid="caregiver-updates-history">
      <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>Updates from InPlace</h3>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10 }}>Tips and news sent to every caregiver. Replies are private.</div>
      {items === null && <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>Loading{'…'}</div>}
      {items && items.length === 0 && <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>Nothing yet. New ones show up on your Home.</div>}
      {items && items.map((u) => {
        const k = CG_UPDATE_KIND[u.kind] || CG_UPDATE_KIND.tip;
        const isOpen = open === u.id;
        return (
          <div key={u.id} style={{ borderTop: '1px solid var(--border-color)', padding: '10px 0' }}>
            <button type="button" onClick={() => setOpen(isOpen ? null : u.id)} aria-expanded={isOpen}
              style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 10, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', color: 'var(--text-primary)' }}>
              <span aria-hidden="true" style={{ fontSize: 18 }}>{k.icon}</span>
              <span style={{ flex: 1, fontSize: 15, fontWeight: 600 }}>{u.title}</span>
              <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{cgUpdateDate(u.createdAt)}</span>
            </button>
            {isOpen && (
              <div style={{ marginTop: 8, paddingLeft: 28 }}>
                <div style={{ fontSize: 14.5, lineHeight: 1.5, whiteSpace: 'pre-wrap', color: 'var(--text-primary)' }}>{u.body}</div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 6 }}>{'— '}{u.from}{u.repliedAt ? ' · you replied' : ''}</div>
                {replyTo === u.id ? (
                  <CaregiverUpdateReply update={u} onCancel={() => setReplyTo(null)} onSent={() => { setReplyTo(null); load(); }} />
                ) : (
                  <button type="button" onClick={() => setReplyTo(u.id)}
                    style={{ ...cgUpdateBtn, marginTop: 8, border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-primary)' }}>
                    Reply to {String(u.from || 'InPlace').split(' ')[0]}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
