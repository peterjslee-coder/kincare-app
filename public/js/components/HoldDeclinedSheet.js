// ─── The declined-card sheet (v1.117.0) ──────────────────────────────────
//
// Oct 5: the 24-hour hold for Tina's Oct 6 visit was declined (Sara's debit card, not enough
// money on it). Nobody who could fix it was told, and nothing anywhere offered "try it again".
// Pete, 10/14: "the most likely course of action will be sara checks her debit card, transfers
// money in, and then we try again. so the fix can't just be 'add another card' there needs to
// be a 'try that card again' option."
//
// So the first button is the same card, again. The second is a different card. Mounted ONCE
// at the app root, like CancelFeeSheet. Opens on:
//   • a focus token `holdDeclined:<sessionId>` (a push tap, the email link, a ?focus= cold
//     start, or the Needs-you row's Open) — claimed on mount and on every `inplace:focus`; or
//   • `window.dispatchEvent(new CustomEvent('inplace:open-hold-declined', { detail: { sessionId } }))`.

const holdVisitLine = (h) => {
  const bits = [];
  if (h.caregiverFirstName) bits.push(`${h.caregiverFirstName}’s visit`);
  else bits.push('The visit');
  if (h.recipientFirstName) bits.push(`with ${h.recipientFirstName}`);
  if (h.scheduledDate) {
    let day = String(h.scheduledDate).split('T')[0];
    try {
      if (typeof TimezoneHelper !== 'undefined' && TimezoneHelper.getDateLabel) {
        day = TimezoneHelper.getDateLabel(day, h.timezone || TimezoneHelper.DEFAULT_TZ);
      }
    } catch { /* the raw date is still a date */ }
    bits.push(`${day}${h.scheduledTime && typeof TimezoneHelper !== 'undefined' ? ` at ${TimezoneHelper.formatTime(h.scheduledTime)}` : ''}`);
  }
  return bits.join(' ');
};

const holdCap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const HoldDeclinedSheet = window.HoldDeclinedSheet = ({ onNavigate }) => {
  const [sessionId, setSessionId] = useState(null);
  const [hold, setHold] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { ok, text }

  useEffect(() => {
    const claim = () => {
      const f = window.__pendingFocus;
      if (!f || typeof f !== 'string' || !f.startsWith('holdDeclined:')) return;
      const id = f.slice('holdDeclined:'.length);
      window.__pendingFocus = null;
      if (id) setSessionId(id);
    };
    const onOpen = (e) => {
      const id = e && e.detail && e.detail.sessionId;
      if (id) setSessionId(String(id));
    };
    claim();
    window.addEventListener('inplace:focus', claim);
    window.addEventListener('inplace:open-hold-declined', onOpen);
    return () => {
      window.removeEventListener('inplace:focus', claim);
      window.removeEventListener('inplace:open-hold-declined', onOpen);
    };
  }, []);

  const load = useCallback(async (id) => {
    setLoadError(null);
    try {
      const res = await apiFetch(`/api/sessions/${id}/hold`);
      if (res?.ok) { setHold(await res.json()); return; }
      let msg = null;
      try { msg = (await res.json())?.error; } catch { /* keep the generic line */ }
      setLoadError(msg || 'We couldn’t load this visit’s payment.');
    } catch {
      setLoadError('We couldn’t reach InPlace. Check your connection and try again.');
    }
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    setHold(null); setResult(null);
    load(sessionId);
  }, [sessionId, load]);

  const close = () => { setSessionId(null); setHold(null); setLoadError(null); setResult(null); };

  const retry = async () => {
    if (busy) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await apiFetch(`/api/sessions/${sessionId}/retry-hold`, { method: 'POST', body: JSON.stringify({}) });
      const d = res ? await res.json().catch(() => ({})) : {};
      if (res?.ok || res?.status === 409) {
        setResult({ ok: true, text: d.message || 'The card went through. The visit is paid for.' });
        setHold((prev) => (prev ? { ...prev, status: 'held' } : prev));
        try { window.dispatchEvent(new Event('inplace:attention-stale')); } catch { /* the card re-reads on its own */ }
      } else {
        setResult({ ok: false, text: d.error || 'That didn’t go through. Try again in a minute.' });
        if (d && d.status) setHold((prev) => ({ ...(prev || {}), ...d }));
      }
    } catch {
      setResult({ ok: false, text: 'We couldn’t reach InPlace. Try again in a moment.' });
    }
    setBusy(false);
  };

  const useAnotherCard = () => {
    close();
    if (onNavigate) onNavigate('payments');
  };

  if (!sessionId) return null;

  const status = hold ? hold.status : null;
  const btn = (primary, disabled) => ({
    width: '100%', minHeight: 48, padding: '12px 16px', borderRadius: 12, fontSize: 15, fontWeight: 700,
    cursor: disabled ? 'wait' : 'pointer',
    border: primary ? 'none' : '1px solid var(--border-color)',
    background: primary ? (disabled ? 'var(--border-light)' : 'var(--accent-color-dark)') : 'var(--bg-surface)',
    color: primary ? (disabled ? 'var(--text-secondary)' : 'var(--text-on-primary)') : 'var(--text-primary)',
  });

  return (
    <div onClick={close} data-testid="hold-declined-sheet" style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1100,
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Card declined" style={{
        background: 'var(--bg-card)', width: '100%', maxWidth: 520, borderRadius: '16px 16px 0 0',
        padding: '20px 20px', paddingBottom: `calc(20px + ${window.__safeAreaBottom || 0}px)`,
        maxHeight: '90vh', overflowY: 'auto', boxSizing: 'border-box',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>
            {status === 'held' || status === 'paid' ? 'Visit paid for' : 'Card declined'}
          </div>
          <button onClick={close} aria-label="Close" style={{
            minWidth: 44, minHeight: 44, background: 'none', border: 'none', fontSize: 22,
            color: 'var(--text-tertiary)', cursor: 'pointer',
          }}>{'×'}</button>
        </div>

        {!hold && !loadError && (
          <div style={{ fontSize: 14, color: 'var(--text-secondary)', padding: '16px 0' }}>Loading{'…'}</div>
        )}
        {loadError && (
          <div style={{ padding: '12px 0' }}>
            <div style={{ fontSize: 14, color: 'var(--color-error)', marginBottom: 12 }}>{loadError}</div>
            <button onClick={() => load(sessionId)} style={btn(false, false)}>Try again</button>
          </div>
        )}

        {hold && (
          <div>
            <div style={{ fontSize: 13.5, color: 'var(--text-secondary)', marginTop: 2 }}>{holdVisitLine(hold)}</div>

            {status === 'declined' && !result?.ok && (
              <div style={{ marginTop: 12, fontSize: 14, lineHeight: 1.45, color: 'var(--text-primary)' }}>
                <b>{holdCap(hold.card) || 'The card'}</b> was declined {'—'} {hold.reason || 'the bank declined it'}.
                {' '}Nothing has been charged. The visit stays booked, but it can{'’'}t start until a card goes through.
                {hold.canRetrySameCard && (
                  <div style={{ marginTop: 8, color: 'var(--text-secondary)', fontSize: 13.5 }}>
                    If you{'’'}ve moved money onto it or called the bank, try it again {'—'} it goes to the bank right away.
                    InPlace also tries again on its own every few hours.
                  </div>
                )}
              </div>
            )}
            {(status === 'held' || status === 'paid') && !result && (
              <div style={{ marginTop: 12, fontSize: 14, lineHeight: 1.45, color: 'var(--text-primary)' }}>
                The card went through. There{'’'}s nothing you need to do.
              </div>
            )}
            {status === 'pending' && !result && (
              <div style={{ marginTop: 12, fontSize: 14, lineHeight: 1.45, color: 'var(--text-primary)' }}>
                The card for this visit hasn{'’'}t been tried yet. InPlace places a hold about 24 hours before the visit.
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

            <div style={{ marginTop: 16 }}>
              {status !== 'held' && status !== 'paid' && !result?.ok && (
                <>
                  {(hold.canRetrySameCard || status === 'pending') && (
                    <button onClick={retry} disabled={busy} style={btn(true, busy)}>
                      {busy ? 'Trying the card…' : 'Try the card again'}
                    </button>
                  )}
                  <button onClick={useAnotherCard} disabled={busy} style={{
                    ...btn(!(hold.canRetrySameCard || status === 'pending'), false), marginTop: 8,
                  }}>Use a different card</button>
                </>
              )}
              <button onClick={close} style={{ ...btn(false, false), marginTop: 8 }}>Close</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
