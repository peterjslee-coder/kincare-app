// ─── The cancellation-fee sheet (v1.109.9) ───────────────────────────────
//
// Pete (9d286a8a): "I got a notice that the session that I canceled would be charged unless
// there was a reason why. And it said tell us. So I tapped on the push notification and it
// just brought me to the homepage. No explanation or no indication that there's a place for
// me to indicate something is wrong."
//
// He was right that there was no place. The server has had GET /cancel-fee, /waive and
// /dispute since v1.105.19; nothing on the client ever called them, and __handlePushNavigate
// had no branch for the fee pushes, so the tap did nothing at all. This is that place.
//
// Mounted ONCE at the app root, so it works from any page. It opens on either:
//   • a focus token `cancelFee:<sessionId>` (a push tap, a ?focus= cold-start URL, or the
//     Needs-you card's Open) — claimed on mount and on every `inplace:focus`, like the other
//     __pendingFocus consumers, so a cold start that sets the token before React is ready
//     still lands here; or
//   • `window.dispatchEvent(new CustomEvent('inplace:open-cancel-fee', { detail: { sessionId } }))`.
//
// Family: "Something's wrong" — a sentence, which pauses the charge and puts it in front of a
// person. Caregiver: "Waive this fee" — it is her lost wage, so the discretion is hers.

const cancelFeeMoney = (cents) => `$${((Number(cents) || 0) / 100).toFixed(2)}`;

const cancelFeeWhen = (iso, tz) => {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-US', {
      weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      timeZone: tz || (typeof TimezoneHelper !== 'undefined' ? TimezoneHelper.DEFAULT_TZ : undefined),
      timeZoneName: 'short',
    });
  } catch { return String(iso); }
};

const cancelFeeVisitLine = (fee) => {
  const bits = [];
  if (fee.serviceType) bits.push(String(fee.serviceType).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()));
  if (fee.recipientFirstName) bits.push(`for ${fee.recipientFirstName}`);
  if (fee.scheduledDate) {
    let day = String(fee.scheduledDate).split('T')[0];
    try {
      if (typeof TimezoneHelper !== 'undefined' && TimezoneHelper.getDateLabel) {
        day = TimezoneHelper.getDateLabel(day, fee.timezone || TimezoneHelper.DEFAULT_TZ);
      }
    } catch { /* the raw date is still a date */ }
    bits.push(`on ${day}${fee.scheduledTime && typeof TimezoneHelper !== 'undefined' ? ` at ${TimezoneHelper.formatTime(fee.scheduledTime)}` : ''}`);
  }
  return bits.join(' ');
};

// What a settled fee says. Plain words, no states the person has to decode.
const CANCEL_FEE_SETTLED = {
  waived: (fee) => (fee.viewer === 'caregiver'
    ? 'You waived this fee. The family was not charged.'
    : `${fee.caregiverFirstName || 'Your caregiver'} waived this fee. You haven’t been charged.`),
  disputed: (fee) => (fee.viewer === 'caregiver'
    ? 'The family raised a question about this fee. The charge is paused while a person at InPlace looks at it.'
    : 'You told us something’s wrong. The charge is paused while a person at InPlace looks at it. If it isn’t resolved within five days, it’s dropped automatically.'),
  charged: (fee) => (fee.viewer === 'caregiver'
    ? `The fee was collected. You’re being paid ${cancelFeeMoney(fee.amountCents)} for this visit.`
    : `The fee of ${cancelFeeMoney(fee.amountCents)} was charged.`),
  dropped: () => 'This fee was dropped. Nobody was charged.',
  none: () => 'There’s no cancellation fee on this visit.',
};

const CancelFeeSheet = window.CancelFeeSheet = () => {
  const { showToast } = useToast();
  const [sessionId, setSessionId] = useState(null);
  const [fee, setFee] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmWaive, setConfirmWaive] = useState(false);
  const [doneMessage, setDoneMessage] = useState(null);

  // ── Claim the focus token, and listen for a direct open ──
  useEffect(() => {
    const claim = () => {
      const f = window.__pendingFocus;
      if (!f || typeof f !== 'string' || !f.startsWith('cancelFee:')) return;
      const id = f.slice('cancelFee:'.length);
      window.__pendingFocus = null;
      if (id) setSessionId(id);
    };
    const onOpen = (e) => {
      const id = e && e.detail && e.detail.sessionId;
      if (id) setSessionId(String(id));
    };
    claim();
    window.addEventListener('inplace:focus', claim);
    window.addEventListener('inplace:open-cancel-fee', onOpen);
    return () => {
      window.removeEventListener('inplace:focus', claim);
      window.removeEventListener('inplace:open-cancel-fee', onOpen);
    };
  }, []);

  const load = useCallback(async (id) => {
    setLoadError(null);
    try {
      const res = await apiFetch(`/api/sessions/${id}/cancel-fee`);
      if (res?.ok) { setFee(await res.json()); return; }
      let msg = null;
      try { msg = (await res.json())?.error; } catch { /* keep the generic line */ }
      setLoadError(msg || 'We couldn’t load this cancellation fee.');
    } catch {
      setLoadError('We couldn’t reach InPlace. Check your connection and try again.');
    }
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    setFee(null); setReason(''); setConfirmWaive(false); setDoneMessage(null);
    load(sessionId);
  }, [sessionId, load]);

  const close = () => { setSessionId(null); setFee(null); setLoadError(null); };

  const settled = (status, message) => {
    setFee((prev) => (prev ? { ...prev, status, canWaive: false, canDispute: false } : prev));
    if (message) setDoneMessage(message);
    // Whatever Needs-you row was waiting on this fee is answered now.
    try { window.dispatchEvent(new Event('inplace:attention-stale')); } catch { /* the card re-reads on its own next visit */ }
  };

  const dispute = async () => {
    if (busy) return;
    const text = reason.trim();
    if (text.length < 5) { showToast('Tell us briefly what’s wrong.', 'error'); return; }
    setBusy(true);
    try {
      const res = await apiFetch(`/api/sessions/${sessionId}/cancel-fee/dispute`, {
        method: 'POST', body: JSON.stringify({ reason: text }),
      });
      const d = res ? await res.json().catch(() => ({})) : {};
      if (res?.ok) {
        settled('disputed', d.message || 'Thanks — we’ve paused the charge and a person will look at this.');
      } else if (res?.status === 409) {
        // Already told us (another device, a second tap). That is the answer they wanted.
        settled(d.status || 'disputed', d.error || null);
      } else {
        showToast(d.error || 'That didn’t go through. Try again.', 'error');
        load(sessionId);
      }
    } catch {
      showToast('We couldn’t reach InPlace. Try again in a moment.', 'error');
    }
    setBusy(false);
  };

  const waive = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await apiFetch(`/api/sessions/${sessionId}/cancel-fee/waive`, { method: 'POST', body: JSON.stringify({}) });
      const d = res ? await res.json().catch(() => ({})) : {};
      if (res?.ok) {
        settled('waived', 'Done — the family won’t be charged.');
      } else if (res?.status === 409) {
        settled(d.status || 'waived', d.error || null);
      } else {
        showToast(d.error || 'That didn’t go through. Try again.', 'error');
        load(sessionId);
      }
    } catch {
      showToast('We couldn’t reach InPlace. Try again in a moment.', 'error');
    }
    setConfirmWaive(false);
    setBusy(false);
  };

  if (!sessionId) return null;

  const isCaregiver = fee && fee.viewer === 'caregiver';
  const amount = fee ? cancelFeeMoney(fee.amountCents) : '';
  const status = fee ? (fee.status || 'none') : null;
  const btn = (primary, disabled) => ({
    width: '100%', minHeight: 48, padding: '12px 16px', borderRadius: 12, fontSize: 15, fontWeight: 700,
    cursor: disabled ? 'wait' : 'pointer',
    border: primary ? 'none' : '1px solid var(--border-color)',
    background: primary ? (disabled ? 'var(--border-light)' : 'var(--accent-color-dark)') : 'var(--bg-surface)',
    color: primary ? (disabled ? 'var(--text-secondary)' : 'var(--text-on-primary)') : 'var(--text-secondary)',
  });

  return (
    <div onClick={close} data-testid="cancel-fee-sheet" style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1100,
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Cancellation fee" style={{
        background: 'var(--bg-card)', width: '100%', maxWidth: 520, borderRadius: '16px 16px 0 0',
        padding: '20px 20px', paddingBottom: `calc(20px + ${window.__safeAreaBottom || 0}px)`,
        maxHeight: '90vh', overflowY: 'auto', boxSizing: 'border-box',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>
            {fee ? (isCaregiver ? `Late cancellation — ${amount}` : `Cancellation fee — ${amount}`) : 'Cancellation fee'}
          </div>
          <button onClick={close} aria-label="Close" style={{
            minWidth: 44, minHeight: 44, background: 'none', border: 'none', fontSize: 22,
            color: 'var(--text-tertiary)', cursor: 'pointer',
          }}>{'×'}</button>
        </div>

        {!fee && !loadError && (
          <div style={{ fontSize: 14, color: 'var(--text-secondary)', padding: '16px 0' }}>Loading{'…'}</div>
        )}
        {loadError && (
          <div style={{ padding: '12px 0' }}>
            <div style={{ fontSize: 14, color: 'var(--color-error)', marginBottom: 12 }}>{loadError}</div>
            <button onClick={() => load(sessionId)} style={btn(false, false)}>Try again</button>
          </div>
        )}

        {fee && (
          <div>
            {cancelFeeVisitLine(fee) && (
              <div style={{ fontSize: 13.5, color: 'var(--text-secondary)', marginTop: 2 }}>{cancelFeeVisitLine(fee)}</div>
            )}

            {status === 'pending' && (
              <div style={{ marginTop: 12, fontSize: 14, lineHeight: 1.45, color: 'var(--text-primary)' }}>
                {isCaregiver
                  ? <>The family cancelled inside 24 hours, so you{'’'}re still paid for the visit. You{'’'}ll get <b>{amount}</b> automatically on <b>{cancelFeeWhen(fee.deadline, fee.timezone)}</b>.</>
                  : <>Cancelling inside 24 hours means the caregiver still gets paid {'—'} they held that time for you. <b>{amount}</b> will be charged on <b>{cancelFeeWhen(fee.deadline, fee.timezone)}</b> unless you tell us something{'’'}s wrong before then.</>}
              </div>
            )}

            {status !== 'pending' && !doneMessage && (
              <div style={{ marginTop: 12, fontSize: 14, lineHeight: 1.45, color: 'var(--text-primary)' }}>
                {(CANCEL_FEE_SETTLED[status] || CANCEL_FEE_SETTLED.none)(fee)}
              </div>
            )}
            {doneMessage && (
              <div role="status" style={{
                marginTop: 12, padding: '10px 12px', borderRadius: 10, fontSize: 14, lineHeight: 1.45,
                background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border-color)',
              }}>{doneMessage}</div>
            )}

            {/* ── Family: say what's wrong ── */}
            {fee.canDispute && (
              <div style={{ marginTop: 16 }}>
                <label htmlFor="cancel-fee-reason" style={{ display: 'block', fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }}>
                  Something{'’'}s wrong?
                </label>
                <textarea id="cancel-fee-reason" value={reason} onChange={(e) => setReason(e.target.value)}
                  rows={3} maxLength={2000}
                  placeholder="e.g. The caregiver told me it was fine, or the app cancelled it, not me."
                  style={{
                    width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10,
                    border: '1px solid var(--border-color)', background: 'var(--bg-surface)',
                    color: 'var(--text-primary)', fontSize: 14, fontFamily: 'inherit', resize: 'vertical',
                  }} />
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: '6px 0 10px' }}>
                  This pauses the charge and a person at InPlace reads it.
                </div>
                <button onClick={dispute} disabled={busy || reason.trim().length < 5} style={{
                  ...btn(true, busy), opacity: reason.trim().length < 5 && !busy ? 0.55 : 1,
                }}>{busy ? 'Sending…' : 'Tell InPlace something’s wrong'}</button>
                <button onClick={close} style={{ ...btn(false, false), marginTop: 8 }}>It{'’'}s fine {'—'} close</button>
              </div>
            )}

            {/* ── Caregiver: waive it ── */}
            {fee.canWaive && (
              <div style={{ marginTop: 16 }}>
                {!confirmWaive ? (
                  <>
                    <button onClick={() => setConfirmWaive(true)} style={btn(false, false)}>Waive this fee</button>
                    <button onClick={close} style={{ ...btn(true, false), marginTop: 8 }}>Keep it {'—'} close</button>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 14, color: 'var(--text-primary)', marginBottom: 10 }}>
                      Waive {amount}? The family won{'’'}t be charged and you won{'’'}t be paid for this visit. This can{'’'}t be undone.
                    </div>
                    <button onClick={waive} disabled={busy} style={btn(true, busy)}>{busy ? 'Waiving…' : `Yes, waive ${amount}`}</button>
                    <button onClick={() => setConfirmWaive(false)} disabled={busy} style={{ ...btn(false, false), marginTop: 8 }}>No, keep it</button>
                  </>
                )}
              </div>
            )}

            {!fee.canDispute && !fee.canWaive && (
              <button onClick={close} style={{ ...btn(false, false), marginTop: 16 }}>Close</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
