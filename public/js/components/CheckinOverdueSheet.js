// ─── "Hasn't checked in" — more time, a message, or cancel (v1.128.0) ─────
//
// Nov 14: Tina was on her way for Betty's 9:00 visit when the app cancelled it at 8:30 and
// voided the card hold, without asking anyone. Pete, 11/15: "I want an 'extend the check in?'
// and 'text Tina?' after the terms of the appointment are up… it shouldn't have even asked me
// if I wanted to extend or cancel/etc until 30 minutes after the appointment start."
//
// So when a visit's arrival window runs out (strict 10 min, flexible/open 30), the family is
// asked. Three answers: give her more time, message her in InPlace, or cancel with no charge.
// Doing nothing is also an answer — the visit stays open until its scheduled end.
//
// Mounted ONCE at the app root, like HoldDeclinedSheet. Opens on a focus token
// `checkinOverdue:<sessionId>` (the push tap, the Needs-you row's Choose) — claimed on mount
// and on every `inplace:focus`.

const CheckinOverdueSheet = window.CheckinOverdueSheet = ({ onNavigate }) => {
  const [sessionId, setSessionId] = useState(null);
  const [view, setView] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [busy, setBusy] = useState(null); // 'extend:15' | 'message' | 'cancel'
  const [result, setResult] = useState(null); // { ok, text }
  const [confirmCancel, setConfirmCancel] = useState(false);

  useEffect(() => {
    const claim = () => {
      const f = window.__pendingFocus;
      if (!f || typeof f !== 'string' || !f.startsWith('checkinOverdue:')) return;
      const id = f.slice('checkinOverdue:'.length);
      window.__pendingFocus = null;
      if (id) setSessionId(id);
    };
    claim();
    window.addEventListener('inplace:focus', claim);
    return () => window.removeEventListener('inplace:focus', claim);
  }, []);

  const load = useCallback(async (id) => {
    setLoadError(null);
    try {
      const res = await apiFetch(`/api/sessions/${id}/checkin-overdue`);
      if (res?.ok) { setView(await res.json()); return; }
      let msg = null;
      try { msg = (await res.json())?.error; } catch { /* keep the generic line */ }
      setLoadError(msg || 'We couldn’t load this visit.');
    } catch {
      setLoadError('We couldn’t reach InPlace. Check your connection and try again.');
    }
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    setView(null); setResult(null); setConfirmCancel(false);
    load(sessionId);
  }, [sessionId, load]);

  const close = () => { setSessionId(null); setView(null); setLoadError(null); setResult(null); setConfirmCancel(false); };
  const stale = () => { try { window.dispatchEvent(new Event('inplace:attention-stale')); } catch { /* re-reads on its own */ } };

  const post = async (key, path, body) => {
    if (busy) return;
    setBusy(key); setResult(null);
    try {
      const res = await apiFetch(path, { method: 'POST', body: JSON.stringify(body || {}) });
      const d = res ? await res.json().catch(() => ({})) : {};
      if (res?.ok || res?.status === 409) {
        setResult({ ok: true, text: d.message || 'Done.' });
        if (d.state) setView((prev) => ({ ...(prev || {}), ...d }));
        stale();
      } else {
        setResult({ ok: false, text: d.error || 'That didn’t go through. Try again in a minute.' });
      }
    } catch {
      setResult({ ok: false, text: 'We couldn’t reach InPlace. Try again in a moment.' });
    }
    setBusy(null);
  };

  const message = async () => {
    if (busy || !view?.caregiverUserId) return;
    setBusy('message'); setResult(null);
    try {
      const res = await apiFetch('/api/messages/conversations', {
        method: 'POST', body: JSON.stringify({ type: 'direct', memberIds: [view.caregiverUserId] }),
      });
      const d = res ? await res.json().catch(() => ({})) : {};
      if (res?.ok && d.conversationId) {
        window.__pendingConversation = d.conversationId;
        setBusy(null);
        close();
        if (onNavigate) onNavigate('messages');
        return;
      }
      setResult({ ok: false, text: d.error || `We couldn’t open a message to ${who} just now.` });
    } catch {
      setResult({ ok: false, text: 'We couldn’t reach InPlace. Try again in a moment.' });
    }
    setBusy(null);
  };

  if (!sessionId) return null;

  const t = (hhmm) => (hhmm && typeof TimezoneHelper !== 'undefined' ? TimezoneHelper.formatTime(hhmm) : hhmm || '');
  const who = view?.caregiverFirstName || 'Your caregiver';
  const state = view?.state;
  const btn = (primary, disabled) => ({
    width: '100%', minHeight: 48, padding: '12px 16px', borderRadius: 12, fontSize: 15, fontWeight: 700,
    cursor: disabled ? 'wait' : 'pointer',
    border: primary ? 'none' : '1px solid var(--border-color)',
    background: primary ? (disabled ? 'var(--border-light)' : 'var(--accent-color-dark)') : 'var(--bg-surface)',
    color: primary ? (disabled ? 'var(--text-secondary)' : 'var(--text-on-primary)') : 'var(--text-primary)',
  });
  const sectionLabel = { fontSize: 12, fontWeight: 700, letterSpacing: 0.4, color: 'var(--text-tertiary)', margin: '16px 0 8px' };

  return (
    <div onClick={close} data-testid="checkin-overdue-sheet" style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1100,
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Caregiver hasn't checked in" style={{
        background: 'var(--bg-card)', width: '100%', maxWidth: 520, borderRadius: '16px 16px 0 0',
        padding: '20px 20px', paddingBottom: `calc(20px + ${window.__safeAreaBottom || 0}px)`,
        maxHeight: '90vh', overflowY: 'auto', boxSizing: 'border-box',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>
            {state === 'checked_in' ? `${who} checked in` : `${who} hasn’t checked in`}
          </div>
          <button onClick={close} aria-label="Close" style={{
            minWidth: 44, minHeight: 44, background: 'none', border: 'none', fontSize: 22,
            color: 'var(--text-tertiary)', cursor: 'pointer',
          }}>{'×'}</button>
        </div>

        {!view && !loadError && (
          <div style={{ fontSize: 14, color: 'var(--text-secondary)', padding: '16px 0' }}>Loading{'…'}</div>
        )}
        {loadError && (
          <div style={{ padding: '12px 0' }}>
            <div style={{ fontSize: 14, color: 'var(--color-error)', marginBottom: 12 }}>{loadError}</div>
            <button onClick={() => load(sessionId)} style={btn(false, false)}>Try again</button>
          </div>
        )}

        {view && (
          <div>
            <div style={{ fontSize: 13.5, color: 'var(--text-secondary)', marginTop: 2 }}>
              {view.recipientFirstName ? `${view.recipientFirstName}’s visit` : 'The visit'} at {t(view.scheduledTime)}
              {view.flexTiming === 'flexible' || view.flexTiming === 'open' ? ` · flexible (±${view.arrivalWindowMinutes} min)` : ''}
            </div>

            {state === 'waiting' && !result?.ok && (
              <div style={{ marginTop: 12, fontSize: 14, lineHeight: 1.45, color: 'var(--text-primary)' }}>
                {who} was due to check in by <b>{t(view.deadlineTime)}</b>. Nothing has been cancelled or charged.
                {view.endTime && <> If you do nothing, the visit stays open until {t(view.endTime)}, then is cancelled with no charge.</>}
              </div>
            )}
            {state === 'within_window' && !result && (
              <div style={{ marginTop: 12, fontSize: 14, lineHeight: 1.45, color: 'var(--text-primary)' }}>
                {who} still has until <b>{t(view.deadlineTime)}</b> to check in. There{'’'}s nothing you need to do yet.
              </div>
            )}
            {state === 'checked_in' && !result && (
              <div style={{ marginTop: 12, fontSize: 14, lineHeight: 1.45, color: 'var(--text-primary)' }}>
                {who} has checked in. There{'’'}s nothing you need to do.
              </div>
            )}
            {state === 'time_change_pending' && !result && (
              <div style={{ marginTop: 12, fontSize: 14, lineHeight: 1.45, color: 'var(--text-primary)' }}>
                A new time for this visit is waiting on an answer. Nothing will be cancelled while it is.
              </div>
            )}
            {state === 'closed' && !result && (
              <div style={{ marginTop: 12, fontSize: 14, lineHeight: 1.45, color: 'var(--text-primary)' }}>
                This visit isn{'’'}t waiting on a check-in any more.
              </div>
            )}

            {result && (
              <div role="status" style={{
                marginTop: 12, padding: '10px 12px', borderRadius: 10, fontSize: 14, lineHeight: 1.45,
                background: result.ok ? 'var(--color-success-bg, var(--bg-surface))' : 'var(--color-error-bg)',
                color: result.ok ? 'var(--text-primary)' : 'var(--color-error)',
                border: '1px solid var(--border-color)',
              }}>{result.text}</div>
            )}

            {state === 'waiting' && !result?.ok && (
              <div>
                {(view.extendChoices || []).length > 0 && (
                  <>
                    <div style={sectionLabel}>GIVE {who.toUpperCase()} MORE TIME</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {view.extendChoices.map((m) => (
                        <button key={m} onClick={() => post(`extend:${m}`, `/api/sessions/${sessionId}/extend-checkin`, { minutes: m })}
                          disabled={!!busy} style={{ ...btn(true, busy === `extend:${m}`), flex: 1 }}>
                          {busy === `extend:${m}` ? '…' : `+${m} min`}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {view.caregiverUserId && (
                  <button onClick={message} disabled={!!busy} style={{ ...btn(false, busy === 'message'), marginTop: 8 }}>
                    {busy === 'message' ? 'Opening…' : `Message ${who}`}
                  </button>
                )}
                {!confirmCancel ? (
                  <button onClick={() => setConfirmCancel(true)} disabled={!!busy} style={{
                    ...btn(false, false), marginTop: 8, color: 'var(--color-error)',
                  }}>Cancel the visit</button>
                ) : (
                  <div style={{ marginTop: 12, padding: 12, borderRadius: 12, border: '1px solid var(--border-color)' }}>
                    <div style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--text-primary)', marginBottom: 10 }}>
                      Cancel this visit? Nothing will be charged, and {who}{'’'}s account will be paused until the InPlace team reviews the missed visit.
                    </div>
                    <button onClick={() => post('cancel', `/api/sessions/${sessionId}/cancel-no-show`)} disabled={!!busy}
                      style={{ ...btn(true, busy === 'cancel'), background: busy === 'cancel' ? 'var(--border-light)' : 'var(--color-error)' }}>
                      {busy === 'cancel' ? 'Cancelling…' : 'Yes, cancel the visit'}
                    </button>
                    <button onClick={() => setConfirmCancel(false)} disabled={!!busy} style={{ ...btn(false, false), marginTop: 8 }}>Keep the visit</button>
                  </div>
                )}
              </div>
            )}

            <button onClick={close} style={{ ...btn(false, false), marginTop: 16 }}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
};
