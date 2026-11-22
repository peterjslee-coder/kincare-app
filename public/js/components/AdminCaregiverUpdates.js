// ─── Admin → Caregiver updates (v1.146.0) ───
//
// Pete, 11/22: "a messaging option for all caregivers. An update. Tips. Newsletter of sorts."
// Write it once; it goes to every caregiver (onboarding ones too) as a card pinned on their
// Home plus a push that never carries the message. Replies come back to the sender privately,
// in Messages. Below the composer: what was sent and how many opened / said Got it / replied.
// Server: src/routes/caregiverUpdates.js.

const ACU_KINDS = [
  { id: 'tip', icon: '\u{1F4A1}', label: 'Tip' },
  { id: 'news', icon: '\u{1F4E3}', label: 'News' },
  { id: 'thanks', icon: '\u{1F49B}', label: 'Thank you' },
];
const ACU_STATE = {
  replied: { label: 'Replied', color: 'var(--color-success)' },
  got_it: { label: 'Got it', color: 'var(--color-success)' },
  seen: { label: 'Opened', color: 'var(--text-secondary)' },
  not_opened: { label: 'Not opened', color: 'var(--text-muted)' },
};

const acuInput = {
  width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10,
  border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)',
  fontSize: 15, fontFamily: 'inherit',
};
const acuBtn = { minHeight: 40, padding: '0 16px', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer' };

const AdminCaregiverUpdatesTab = window.AdminCaregiverUpdatesTab = ({ apiFetch, showToast }) => {
  const [kind, setKind] = React.useState('tip');
  const [title, setTitle] = React.useState('');
  const [body, setBody] = React.useState('');
  const [audience, setAudience] = React.useState(null);
  const [sending, setSending] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [updates, setUpdates] = React.useState(null);
  const [openId, setOpenId] = React.useState(null);
  const [receipts, setReceipts] = React.useState({});
  const [editing, setEditing] = React.useState(null); // { id, kind, title, body }

  const load = React.useCallback(async () => {
    try {
      const [a, l] = await Promise.all([
        apiFetch('/api/caregiver-updates/admin/audience'),
        apiFetch('/api/caregiver-updates/admin'),
      ]);
      if (a && a.ok) setAudience((await a.json()).count);
      if (l && l.ok) setUpdates((await l.json()).updates || []);
      else setUpdates([]);
    } catch { setUpdates([]); }
  }, [apiFetch]);
  React.useEffect(() => { load(); }, [load]);

  const send = async () => {
    if (sending) return;
    setSending(true);
    try {
      const res = await apiFetch('/api/caregiver-updates/admin', {
        method: 'POST', body: JSON.stringify({ kind, title: title.trim(), body: body.trim() }),
      });
      const d = res ? await res.json().catch(() => ({})) : {};
      if (res && res.ok) {
        showToast && showToast(`Sent to ${d.sentTo} caregiver${d.sentTo === 1 ? '' : 's'}`, 'success');
        setTitle(''); setBody(''); setConfirming(false);
        load();
      } else {
        showToast && showToast(d.error || 'It didn’t send', 'error');
      }
    } catch { showToast && showToast('It didn’t send', 'error'); }
    setSending(false);
  };

  const openReceipts = async (id) => {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    try {
      const res = await apiFetch(`/api/caregiver-updates/admin/${id}/receipts`);
      if (res && res.ok) {
        const d = await res.json();
        setReceipts((r) => ({ ...r, [id]: d.receipts || [] }));
      }
    } catch { /* the counts above still show */ }
  };

  const saveEdit = async () => {
    if (!editing) return;
    const res = await apiFetch(`/api/caregiver-updates/admin/${editing.id}`, {
      method: 'PATCH', body: JSON.stringify({ kind: editing.kind, title: editing.title, body: editing.body }),
    }).catch(() => null);
    if (res && res.ok) { showToast && showToast('Saved. Nobody gets a new notification.', 'success'); setEditing(null); load(); }
    else showToast && showToast('Couldn’t save it', 'error');
  };

  const withdraw = async (id) => {
    if (!window.confirm || !window.confirm('Withdraw this update? Caregivers stop seeing it.')) return;
    const res = await apiFetch(`/api/caregiver-updates/admin/${id}/withdraw`, { method: 'POST' }).catch(() => null);
    if (res && res.ok) { showToast && showToast('Withdrawn', 'success'); load(); }
    else showToast && showToast('Couldn’t withdraw it', 'error');
  };

  const ready = title.trim() && body.trim();
  const k = ACU_KINDS.find((x) => x.id === kind) || ACU_KINDS[0];

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 17 }}>Send an update to caregivers</h3>
        <div style={{ fontSize: 13.5, color: 'var(--text-secondary)', marginBottom: 12 }}>
          Goes to every caregiver{audience != null ? ` (${audience} right now, onboarding included)` : ''} as a card on their Home and a push.
          The push says only that there{'’'}s something from InPlace. Replies come to you privately in Messages.
        </div>
        <div role="radiogroup" aria-label="Kind" style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          {ACU_KINDS.map((x) => (
            <button key={x.id} type="button" role="radio" aria-checked={kind === x.id} onClick={() => setKind(x.id)}
              style={{ ...acuBtn, minHeight: 36, border: '1px solid ' + (kind === x.id ? 'var(--role-color)' : 'var(--border-color)'), background: kind === x.id ? 'var(--bg-highlight)' : 'transparent', color: 'var(--text-primary)' }}>
              <span aria-hidden="true">{x.icon}</span>{' '}{x.label}
            </button>
          ))}
        </div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Title — e.g. Check-in works best at the door" aria-label="Title" style={{ ...acuInput, marginBottom: 8 }} />
        <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} rows={5} placeholder="The message" aria-label="Message" style={{ ...acuInput, resize: 'vertical' }} />
        <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'right', marginTop: 2 }}>{body.length}/2000</div>

        {ready && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 4 }}>THEY{'’'}LL SEE</div>
            <div style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--bg-highlight)', borderLeft: '4px solid var(--role-color)' }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--role-color)' }}>
                <span aria-hidden="true">{k.icon}</span>{' '}{kind === 'tip' ? 'TIP FROM INPLACE' : kind === 'news' ? 'UPDATE FROM INPLACE' : 'A NOTE FROM INPLACE'}
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, marginTop: 4 }}>{title.trim()}</div>
              <div style={{ fontSize: 14.5, marginTop: 4, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{body.trim()}</div>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          {!confirming ? (
            <button type="button" disabled={!ready} onClick={() => setConfirming(true)}
              style={{ ...acuBtn, border: 'none', background: 'var(--role-color)', color: 'var(--text-on-primary)', opacity: ready ? 1 : 0.5 }}>
              Send to all caregivers
            </button>
          ) : (
            <React.Fragment>
              <button type="button" onClick={send} disabled={sending}
                style={{ ...acuBtn, border: 'none', background: 'var(--role-color)', color: 'var(--text-on-primary)' }}>
                {sending ? 'Sending…' : `Yes, send to ${audience != null ? audience : 'all'}`}
              </button>
              <button type="button" onClick={() => setConfirming(false)}
                style={{ ...acuBtn, border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-secondary)' }}>Not yet</button>
            </React.Fragment>
          )}
        </div>
      </div>

      <div className="card">
        <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>Sent</h3>
        {updates === null && <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>Loading{'…'}</div>}
        {updates && updates.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>Nothing sent yet.</div>}
        {updates && updates.map((u) => {
          const kk = ACU_KINDS.find((x) => x.id === u.kind) || ACU_KINDS[0];
          const isEditing = editing && editing.id === u.id;
          return (
            <div key={u.id} style={{ borderTop: '1px solid var(--border-color)', padding: '10px 0', opacity: u.withdrawnAt ? 0.55 : 1 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span aria-hidden="true">{kk.icon}</span>
                <span style={{ flex: 1, fontWeight: 600, fontSize: 15 }}>{u.title}{u.withdrawnAt ? ' (withdrawn)' : ''}</span>
                <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{new Date(u.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 3, paddingLeft: 24 }}>
                Sent to {u.stats.sentTo}{' · '}{u.stats.seen} opened{' · '}{u.stats.gotIt} got it{' · '}{u.stats.replied} replied
                {u.editedAt ? ' · edited' : ''}
              </div>
              <div style={{ display: 'flex', gap: 12, paddingLeft: 24, marginTop: 4 }}>
                <button type="button" onClick={() => openReceipts(u.id)} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--role-color)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  {openId === u.id ? 'Hide who' : 'Who read it'}
                </button>
                {!u.withdrawnAt && (
                  <React.Fragment>
                    <button type="button" onClick={() => setEditing({ id: u.id, kind: u.kind, title: u.title, body: u.body })} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--role-color)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Fix a typo</button>
                    <button type="button" onClick={() => withdraw(u.id)} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--color-error)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Withdraw</button>
                  </React.Fragment>
                )}
              </div>
              {isEditing && (
                <div style={{ paddingLeft: 24, marginTop: 8 }}>
                  <input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} maxLength={120} aria-label="Title" style={{ ...acuInput, marginBottom: 6 }} />
                  <textarea value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} maxLength={2000} rows={4} aria-label="Message" style={{ ...acuInput, resize: 'vertical' }} />
                  <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                    <button type="button" onClick={saveEdit} style={{ ...acuBtn, border: 'none', background: 'var(--role-color)', color: 'var(--text-on-primary)' }}>Save (no new push)</button>
                    <button type="button" onClick={() => setEditing(null)} style={{ ...acuBtn, border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-secondary)' }}>Cancel</button>
                  </div>
                </div>
              )}
              {openId === u.id && (
                <div style={{ paddingLeft: 24, marginTop: 6 }}>
                  {!receipts[u.id] && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading{'…'}</div>}
                  {(receipts[u.id] || []).map((r) => {
                    const st = ACU_STATE[r.state] || ACU_STATE.not_opened;
                    return (
                      <div key={r.userId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, padding: '3px 0' }}>
                        <span>{r.name}</span><span style={{ color: st.color, fontWeight: 600 }}>{st.label}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
