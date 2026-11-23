// ─── The hand-off note (v1.154.0) ───
//
// Pete, 11/23: "have the caretaker who's leaving fill out notes before the other caretaker
// shows up or checks in." Three pieces, one file:
//   HandoffSheet     — the leaving caregiver writes it (or skips)
//   HandoffIncoming  — the arriving caregiver reads it and taps Got it
//   HandoffReport    — the family sees it, and whether it was read, in the visit report
// Server: src/routes/handoffs.js. Theme colours only, so dark mode reads.

const _hoTime = (iso, tz) => {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz || 'America/New_York' }).format(new Date(iso));
  } catch (e) { return ''; }
};
const _hoClock = (hhmm) => {
  if (!hhmm) return '';
  const [h, m] = String(hhmm).split(':').map(Number);
  if (!Number.isFinite(h)) return '';
  return `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

function HandoffSnapshot({ snapshot }) {
  if (!snapshot) return null;
  const tasks = snapshot.tasks || [];
  const todos = snapshot.todos || [];
  if (!tasks.length && !todos.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {tasks.map((t, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13.5, color: 'var(--text-primary)' }}>
          <span>{t.title}</span>
          <span style={{ fontWeight: 600, color: t.done ? 'var(--color-success)' : 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
            {t.done ? `Done${t.at ? ' · ' + t.at : ''}` : t.skipped ? 'Skipped' : `Still due${t.at ? ' · ' + t.at : ''}`}
          </span>
        </div>
      ))}
      {todos.length > 0 && (
        <div style={{ fontSize: 13.5, color: 'var(--text-primary)' }}>
          <span style={{ color: 'var(--text-secondary)' }}>To-dos left: </span>{todos.join(' · ')}
        </div>
      )}
    </div>
  );
}

function HandoffSheet({ sessionId, timezone, onDone, onClose, checkingOut }) {
  const [data, setData] = React.useState(null);
  const [condition, setCondition] = React.useState(null);
  const [note, setNote] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => {
    let gone = false;
    (async () => {
      try {
        const r = await apiFetch(`/api/handoffs/session/${sessionId}`);
        if (r?.ok) { const d = await r.json(); if (!gone) setData(d); }
        else if (!gone) setData({ error: true });
      } catch (e) { if (!gone) setData({ error: true }); }
    })();
    return () => { gone = true; };
  }, [sessionId]);

  const send = async (skip) => {
    if (saving) return;
    setSaving(true);
    try {
      const r = await apiFetch(`/api/handoffs/session/${sessionId}`, {
        method: 'POST', body: JSON.stringify(skip ? { skip: true } : { condition, note }),
      });
      if (r?.ok) {
        if (!skip) showToast(`Sent to ${data?.next?.firstName || 'the next caregiver'}`, 'success');
        onDone && onDone();
      } else {
        const d = await r?.json?.().catch(() => null);
        showToast(d?.error || 'Could not save the hand-off', 'error');
      }
    } catch (e) { showToast('Could not reach the server — check your connection', 'error'); }
    setSaving(false);
  };

  const next = data?.next;
  const nextName = next?.firstName || 'the next caregiver';
  const canSend = !!condition || note.trim().length > 0;

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 10050 }}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Hand-off note"
        style={{ maxWidth: 480, width: '100%', maxHeight: '92vh', overflowY: 'auto', padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: 0, fontSize: 19, color: 'var(--text-primary)' }}>Hand-off for {nextName}</h3>
            {next && <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>{nextName} starts at {_hoClock(next.time)}</div>}
          </div>
          <button aria-label="Close" onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--text-secondary)', minWidth: 44, minHeight: 44 }}>{'×'}</button>
        </div>

        {!data && <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-secondary)' }}>Loading{'…'}</div>}
        {data?.error && <div style={{ padding: 12, color: 'var(--text-secondary)' }}>Could not load the hand-off. You can still check out.</div>}

        {data && !data.error && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.4, color: 'var(--text-secondary)' }}>RIGHT NOW</div>
              <div role="radiogroup" aria-label="How they are right now" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {(data.conditions || []).map((c) => {
                  const on = condition === c.key;
                  return (
                    <button key={c.key} type="button" role="radio" aria-checked={on} onClick={() => setCondition(on ? null : c.key)}
                      style={{ minHeight: 40, padding: '0 14px', borderRadius: 20, cursor: 'pointer', fontSize: 13.5, fontWeight: on ? 700 : 500,
                        background: on ? 'var(--color-success-bg)' : 'transparent', color: 'var(--text-primary)',
                        border: on ? '2px solid var(--role-color)' : '1px solid var(--border-color)' }}>{c.label}</button>
                  );
                })}
              </div>
            </div>

            {data.snapshot && ((data.snapshot.tasks || []).length > 0 || (data.snapshot.todos || []).length > 0) && (
              <div style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.4, color: 'var(--text-secondary)', marginBottom: 6 }}>FROM TODAY {'·'} FILLED IN FOR YOU</div>
                <HandoffSnapshot snapshot={data.snapshot} />
              </div>
            )}

            <div style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--bg-card)', border: '2px solid var(--role-color)' }}>
              <label htmlFor="handoff-note" style={{ display: 'block', fontSize: 12, fontWeight: 700, letterSpacing: 0.4, color: 'var(--text-secondary)' }}>ANYTHING {nextName.toUpperCase()} SHOULD KNOW?</label>
              <textarea id="handoff-note" value={note} onChange={(e) => setNote(e.target.value)} rows={4} maxLength={2000}
                placeholder="Tap the microphone on your keyboard to speak it"
                style={{ width: '100%', boxSizing: 'border-box', marginTop: 6, padding: 10, borderRadius: 8, fontSize: 15, lineHeight: 1.45,
                  border: '1px solid var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-primary)', resize: 'vertical' }} />
            </div>

            <button type="button" disabled={!canSend || saving} onClick={() => send(false)}
              style={{ minHeight: 52, borderRadius: 14, border: 'none', fontSize: 16, fontWeight: 700, cursor: canSend ? 'pointer' : 'default',
                background: canSend ? 'var(--role-color)' : 'var(--border-light)', color: canSend ? 'var(--text-on-primary)' : 'var(--text-secondary)' }}>
              {saving ? 'Sending…' : `Send to ${nextName}${checkingOut ? ' and check out' : ''}`}
            </button>
            <button type="button" disabled={saving} onClick={() => send(true)}
              style={{ minHeight: 44, border: 'none', background: 'none', color: 'var(--text-secondary)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
              {checkingOut ? 'Skip and check out' : 'Skip for now'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// The arriving caregiver: top of her check-in briefing, and on her visit card.
function HandoffIncoming({ sessionId, timezone, onRead }) {
  const [h, setH] = React.useState(null);
  const [readAt, setReadAt] = React.useState(null);
  React.useEffect(() => {
    let gone = false;
    (async () => {
      try {
        const r = await apiFetch(`/api/handoffs/session/${sessionId}`);
        if (r?.ok) { const d = await r.json(); if (!gone && d.incoming) { setH(d.incoming); setReadAt(d.incoming.readAt); } }
      } catch (e) { /* nothing to show */ }
    })();
    return () => { gone = true; };
  }, [sessionId]);
  if (!h) return null;
  const gotIt = async () => {
    try {
      const r = await apiFetch(`/api/handoffs/${h.id}/read`, { method: 'POST' });
      if (r?.ok) { const d = await r.json(); setReadAt(d.readAt || new Date().toISOString()); onRead && onRead(); }
      else showToast('Could not mark it read', 'error');
    } catch (e) { showToast('Could not reach the server — check your connection', 'error'); }
  };
  return (
    <div data-testid="handoff-incoming" style={{ padding: 14, borderRadius: 14, marginBottom: 14, background: 'var(--bg-card)', border: '2px solid var(--role-color)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Hand-off from {h.fromFirstName || 'the caregiver before you'}</div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Written {_hoTime(h.writtenAt, timezone)}</div>
      </div>
      {h.conditionLabel && (
        <div><span style={{ display: 'inline-block', padding: '4px 10px', borderRadius: 12, fontSize: 12.5, fontWeight: 700, background: 'var(--color-success-bg)', color: 'var(--text-primary)' }}>{h.conditionLabel}</span></div>
      )}
      {h.note && <div style={{ fontSize: 14.5, lineHeight: 1.5, color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>{h.note}</div>}
      <HandoffSnapshot snapshot={h.snapshot} />
      {readAt
        ? <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-success)' }}>{'✓'} Read {_hoTime(readAt, timezone)}</div>
        : <button type="button" onClick={gotIt} style={{ minHeight: 48, borderRadius: 12, border: 'none', background: 'var(--color-success)', color: 'var(--text-on-primary)', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>Got it</button>}
    </div>
  );
}

// The family: in the visit report. Shows what this visit handed on, and what it was handed.
function HandoffReport({ sessionId, timezone }) {
  const [d, setD] = React.useState(null);
  React.useEffect(() => {
    let gone = false;
    (async () => {
      try {
        const r = await apiFetch(`/api/handoffs/session/${sessionId}`);
        if (r?.ok) { const j = await r.json(); if (!gone) setD(j); }
      } catch (e) { /* the report stands without it */ }
    })();
    return () => { gone = true; };
  }, [sessionId]);
  const o = d?.outgoing;
  if (!o) return null;
  return (
    <div data-testid="handoff-report" style={{ marginTop: 14, padding: 14, borderRadius: 12, background: 'var(--bg-card)', border: o.skipped ? '1px dashed var(--border-color)' : '2px solid var(--role-color)' }}>
      {o.skipped ? (
        <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>No hand-off note left for {o.toFirstName || 'the next caregiver'}.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Hand-off to {o.toFirstName || 'the next caregiver'}</span>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{_hoTime(o.writtenAt, timezone)}</span>
          </div>
          {o.conditionLabel && <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{o.conditionLabel}</div>}
          {o.note && <div style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>{o.note}</div>}
          <HandoffSnapshot snapshot={o.snapshot} />
          {/* Only who HAS read it — never a "hasn't read" line (Pete, 11/22, read receipts). */}
          {o.readAt && (
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-success)' }}>
              {`✓ ${o.toFirstName || 'They'} read it at ${_hoTime(o.readAt, timezone)}`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

window.HandoffSheet = HandoffSheet;
window.HandoffIncoming = HandoffIncoming;
window.HandoffReport = HandoffReport;
