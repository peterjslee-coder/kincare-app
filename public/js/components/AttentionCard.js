// ─── "What needs you" — the list behind the number (v1.105.42) ───
//
// Pete, 8/6, screenshot of a red 78 on the app icon: "I don't know how to clear any of
// them and I don't know what they are."
//
// Two complaints, and the second one survives fixing the first. Even with a correct count,
// a badge is a number with no referent: tapping the icon opens the dashboard, and the app
// never says which four things it is talking about. A number you can't decompose is a
// number you can only ignore — which is precisely the outcome the count's definition was
// designed to avoid.
//
// So this card is the badge, itemised. Same endpoint the icon reads, so they cannot
// disagree, and every row goes to the place where you clear it. When there is nothing
// waiting, it renders nothing at all — the dashboard is crowded (his words) and a card
// saying "you're all caught up" is decoration.
//
// ─── v1.105.129 — say what it is, and let one tap end it ───
//
// Pete, 8/24: "I'm not happy with how the 'needs you' is displayed. It doesn't match the app
// appearance and is clumsy looking. You know what looks good? the pop-ups that appear when
// you're offered a job. They're up top, they have a different colour, they're noticeable, and
// I can click to approve/expand right there. If something needs me let's get it clear on WHAT
// they're needed for and make it a one-click event to clear it out or open it up for more."
//
// The old card was a count per CATEGORY — "1 reimbursement waiting for your approval" — which
// is the badge broken into three smaller badges. It still never said whose, for how much, or
// for when, and every row's only move was to navigate somewhere else and start looking.
//
// This is the exclusive-offer card from CaretakerHub, applied to the same data: an eyebrow in
// the accent colour, one bordered card per THING, the sentence that names it, and the button
// that ends it sitting on the card. Orange rather than the offers' violet — the two must not
// be mistaken for one another; a job you may take and a decision that is blocking somebody
// are different kinds of urgent.
//
// The items, and the single request that clears each one, come from the server
// (utils/attention.js) next to the query that found them — see the note there.

// ─── v1.105.142 — send on tap. The hold window was a mistake. ───
//
// Pete (ab4fb08c, dictated): "There's something wrong with the Needs you buttons on top. I
// click off that her medication was delivered and it goes away, but then it reasserts. I click
// on it again. It goes away and then I can go click completed below in the care team panel,
// but then it says it's already been checked off."
//
// v1.105.129 held every action for five seconds before sending it, so that one tap could be
// taken back. Undo for actions with no server-side undo, bought with a lie: the row vanished
// before anything had happened.
//
// The lie does not survive contact with the rest of the app. The card lives inside Dashboard
// and unmounts whenever he navigates; unmounting flushes the pending request and remounts with
// fresh state, which immediately re-reads the server — and the server has not finished the
// write yet, so the row he cleared comes straight back. He taps it again, that second request
// arrives after the first one landed, the endpoint correctly answers 409 "Already checked
// off", and my error path puts the row back a THIRD time wearing the server's error. Every
// other surface (Next Up, the care-team panel) never heard about any of it.
//
// So: send on tap. The row is gone when the server says it is gone, undo is offered only where
// the server actually has an undo, and a 409 means the task is done — which is what the person
// asked for, so it is a success, not an error to hand back to them.
const ATTENTION_DONE_LINGER_MS = 6000;

// What the confirmation row says after you tap. Spelled out rather than derived: "Accept"
// + "d" is "Acceptd", and a card whose job is to be legible cannot afford that.
const ATTENTION_PAST = {
  Approve: 'Approved.',
  Accept: 'Accepted.',
  'Mark done': 'Marked done.',
};

const ATTENTION_KINDS = {
  reimbursement: { icon: '💵', chip: 'MONEY' },
  timeOffer:     { icon: '🕑', chip: 'SCHEDULE' },
  timeChange:    { icon: '🕑', chip: 'SCHEDULE' },
  careTask:      { icon: '✅', chip: 'CARE TASK' },
};

// "14:30" → "2:30 PM". The server sends wall-clock times in the care recipient's zone; they
// are already the right numbers, so this formats rather than converts. Converting them here
// is the timezone-frame mistake this codebase has now made three times.
const attentionClock = (t) => {
  if (!t) return '';
  const [h, m] = String(t).split(':').map(Number);
  if (!Number.isFinite(h)) return '';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m || 0).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

const attentionDay = (dateStr, tz) => {
  if (!dateStr) return '';
  const d = String(dateStr).split('T')[0];
  try {
    if (typeof TimezoneHelper !== 'undefined' && TimezoneHelper.getDateLabel) {
      return TimezoneHelper.getDateLabel(d, tz || TimezoneHelper.DEFAULT_TZ);
    }
  } catch { /* fall through to the raw date rather than losing the row */ }
  return d;
};

// One sentence under the title: the specifics that make the item recognisable without
// opening it. Never the same words as the title.
const attentionDetail = (item) => {
  if (item.kind === 'reimbursement') {
    const bits = [item.detail, item.when ? attentionDay(item.when, null) : null].filter(Boolean);
    return bits.join(' · ');
  }
  if (item.kind === 'timeChange') {
    const day = attentionDay(item.date, item.tz);
    const from = attentionClock(item.fromTime);
    const to = attentionClock(item.toTime);
    if (from && to) return `${day}${day ? ' · ' : ''}${from} → ${to}`;
    return day;
  }
  if (item.kind === 'timeOffer') {
    const day = attentionDay(item.proposedDate, item.tz);
    const at = attentionClock(item.proposedTime);
    return `${day}${at ? ` at ${at}` : ''}`;
  }
  if (item.kind === 'careTask') {
    return item.dueAt ? `Due ${attentionDay(item.dueAt, item.tz)}` : 'Due now';
  }
  return item.detail || '';
};

const AttentionCard = window.AttentionCard = ({ onNavigate }) => {
  const [payload, setPayload] = React.useState(null);
  // v1.105.51 — a failed load used to render exactly nothing, which on this card means
  // "you're all caught up". That is the one lie this component cannot afford: the app icon
  // may be showing a number while the card that is supposed to itemise it isn't there.
  // (Also `res.ok` not `res?.ok` — apiFetch returns null on its 401 path, which threw
  // straight into the same silent catch.)
  const [loadFailed, setLoadFailed] = React.useState(false);
  // id → true while its request is in flight. The row stays on screen, busy, rather than
  // disappearing before anything has happened.
  const [busy, setBusy] = React.useState({});
  // id → { item, verbPast } for a few seconds after it really is done, so an undoable action
  // has somewhere to put its Undo.
  const [done, setDone] = React.useState({});
  // id → message, when the request came back non-OK. The row comes BACK on failure; a
  // request that failed has not cleared anything, and pretending otherwise is how a
  // reimbursement stays pending while everyone believes it was approved.
  const [failed, setFailed] = React.useState({});

  const load = React.useCallback(async () => {
    try {
      const res = await apiFetch('/api/push/attention/items');
      if (!res?.ok) { setLoadFailed(true); return; }
      setPayload(await res.json());
      setLoadFailed(false);
    } catch { setLoadFailed(true); }
  }, []);

  React.useEffect(() => {
    load();
    // Same trigger as the icon badge: whatever you just cleared, the card agrees when you
    // come back to it.
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [load]);

  const send = React.useCallback(async (item) => {
    setFailed((prev) => { const next = { ...prev }; delete next[item.id]; return next; });
    setBusy((prev) => ({ ...prev, [item.id]: true }));
    let ok = false;
    let message = null;
    try {
      const res = await apiFetch(item.action.path, {
        method: item.action.method || 'POST',
        body: JSON.stringify(item.action.body || {}),
      });
      ok = !!res?.ok;
      // 409 is this endpoint saying the thing is ALREADY in the state you asked for — a care
      // task already checked off, a proposal already answered. The person wanted it done; it
      // is done. Handing them "Already checked off" as a failure is how one tap turned into
      // three in Pete's report.
      if (!ok && res?.status === 409) ok = true;
      if (!ok) {
        try { message = (await res.json())?.error; } catch { /* keep the generic line */ }
      }
    } catch (e) {
      message = null;
    }
    setBusy((prev) => { const next = { ...prev }; delete next[item.id]; return next; });
    if (ok) {
      // Only NOW is it true. Reload from the server rather than decrementing a local number,
      // and tell the rest of the app, because the same task is drawn in Next Up and in the
      // care-team panel and neither of them was listening.
      load();
      try { window.dispatchEvent(new Event('inplace:attention-changed')); } catch { /* no-op */ }
      if (item.undoable && item.undo) {
        setDone((prev) => ({ ...prev, [item.id]: { item, verbPast: ATTENTION_PAST[item.verb] || 'Done.' } }));
        setTimeout(() => {
          setDone((prev) => { const next = { ...prev }; delete next[item.id]; return next; });
        }, ATTENTION_DONE_LINGER_MS);
      }
    } else {
      setFailed((prev) => ({ ...prev, [item.id]: message || "That didn't go through. Try again." }));
    }
  }, [load]);

  const act = React.useCallback((item) => {
    if (busy[item.id]) return; // one tap is one request
    send(item);
  }, [send, busy]);

  const undo = React.useCallback(async (id) => {
    const entry = done[id];
    setDone((prev) => { const next = { ...prev }; delete next[id]; return next; });
    if (!entry?.item?.undo) return;
    try {
      await apiFetch(entry.item.undo.path, { method: entry.item.undo.method || 'POST' });
    } catch { /* the reload below will show the truth either way */ }
    load();
    try { window.dispatchEvent(new Event('inplace:attention-changed')); } catch { /* no-op */ }
  }, [done, load]);

  const open = React.useCallback((item) => {
    // Open the exact item, not just the page it lives on. Consumed by Dashboard /
    // CaretakerHub, which open the visit detail for `session:<id>`.
    if (item.focus) window.__pendingFocus = item.focus;
    if (onNavigate) onNavigate(item.page);
    // This card lives inside Dashboard, and onNavigate is setCurrentPage, which does
    // not remount it — so a mount-time read of __pendingFocus would never fire when
    // the target page is the one we are already on. Announce it instead.
    if (item.focus) setTimeout(() => window.dispatchEvent(new Event('inplace:focus')), 0);
  }, [onNavigate]);

  if (loadFailed && !payload) {
    return (
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border-color)',
        borderRadius: 12, padding: '12px 16px', marginBottom: 16,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span style={{ flex: 1, fontSize: 13, color: 'var(--text-secondary)' }}>
          Couldn't load what needs you.
        </span>
        <button onClick={load} style={{
          minHeight: 44, padding: '0 12px', background: 'none', border: 'none',
          color: 'var(--accent-color)', font: 'inherit', fontSize: 14, fontWeight: 700,
          cursor: 'pointer',
        }}>Retry</button>
      </div>
    );
  }

  const items = (payload && Array.isArray(payload.items)) ? payload.items : [];
  const doneIds = Object.keys(done);
  // Nothing is hidden optimistically any more: a row leaves this list when the SERVER stops
  // returning it. The done rows below are things that really are done, lingering only long
  // enough to offer the undo the server actually supports.
  const visible = items;
  if (!visible.length && !doneIds.length) return null;

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        fontSize: 12, fontWeight: 700, color: 'var(--accent-color)',
        textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10,
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <span aria-hidden="true">{'❗'}</span> Needs you ({visible.length})
      </div>

      {doneIds.map((id) => {
        const { verbPast } = done[id];
        return (
          <div key={`done-${id}`} style={{
            marginBottom: 10, padding: '12px 16px', borderRadius: 12,
            border: '1px dashed var(--border-color)', background: 'var(--bg-card)',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span aria-hidden="true" style={{ fontSize: 16 }}>{'✓'}</span>
            <span style={{ flex: 1, fontSize: 13.5, color: 'var(--text-secondary)' }}>
              {verbPast}
            </span>
            <button onClick={() => undo(id)} style={{
              minHeight: 44, padding: '0 14px', background: 'none', border: 'none',
              color: 'var(--accent-color)', font: 'inherit', fontSize: 14, fontWeight: 700,
              cursor: 'pointer',
            }}>Undo</button>
          </div>
        );
      })}

      {visible.map((item) => {
        const kind = ATTENTION_KINDS[item.kind] || { icon: '❗', chip: 'NEEDS YOU' };
        const detail = attentionDetail(item);
        return (
          <div key={item.id} className="card" style={{
            marginBottom: 10, padding: '16px 18px',
            border: '2px solid var(--accent-color)', borderRadius: 12,
            background: 'var(--bg-attention-card)',
            boxShadow: '0 2px 8px rgba(232,114,74,0.15)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
              <span style={{
                background: 'var(--accent-color-dark)', color: 'var(--text-on-primary)',
                padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700,
              }}>{kind.icon} {kind.chip}</span>
              {item.forWhom && (
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>for {item.forWhom}</span>
              )}
              {item.isWithin24h && (
                <span style={{
                  background: 'var(--color-warning-bg)', color: 'var(--color-warning)',
                  padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 700,
                }}>Within 24 hours</span>
              )}
            </div>

            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{item.title}</div>
            {detail && (
              <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 3 }}>{detail}</div>
            )}
            {item.kind !== 'reimbursement' && item.detail && (
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4, fontStyle: 'italic' }}>
                {'“'}{item.detail}{'”'}
              </div>
            )}
            {item.note && (
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 6 }}>{item.note}</div>
            )}
            {failed[item.id] && (
              <div style={{
                marginTop: 8, padding: '6px 10px', borderRadius: 8,
                background: 'var(--color-error-bg)', color: 'var(--color-error)',
                fontSize: 12.5, fontWeight: 600,
              }}>{failed[item.id]}</div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <button onClick={() => act(item)} disabled={!!busy[item.id]}
                style={{
                  flex: '1 1 auto', minHeight: 44, padding: '12px 24px',
                  background: busy[item.id] ? 'var(--border-light)' : 'var(--accent-color-dark)',
                  color: busy[item.id] ? 'var(--text-secondary)' : 'var(--text-on-primary)',
                  border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 700,
                  cursor: busy[item.id] ? 'wait' : 'pointer',
                  boxShadow: busy[item.id] ? 'none' : '0 2px 8px rgba(216,90,43,0.3)',
                }}>{busy[item.id] ? 'Working\u2026' : item.verb}</button>
              <button onClick={() => open(item)} style={{
                minHeight: 44, padding: '10px 18px', background: 'var(--bg-surface)',
                color: 'var(--accent-color)', border: '2px solid var(--accent-color)',
                borderRadius: 12, fontSize: 13.5, fontWeight: 700, cursor: 'pointer',
              }}>Open{' '}{'›'}</button>
            </div>
          </div>
        );
      })}

      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
        This is the number on the app icon. It clears as you deal with each one.
      </div>
    </div>
  );
};
