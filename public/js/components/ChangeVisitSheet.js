// ─── Change a booked visit — the one sheet (v1.124.0) ───
//
// Pete, 10/19: "Tina accepted an appointment on 7 Nov. She's asking to change it to 14 Nov. I
// can't suggest a change … I need a way to edit confirmed appointments for her review, just
// like she can for me."
//
// Three things were wrong at once:
//   1. Neither side could move a visit to another DAY — the sheet had start time and length.
//   2. The family's sheet lived inside Home (Dashboard.js) only. Visit details opened from
//      Betty's page, Schedule or Care Team had no "Change" button at all, because those hosts
//      never passed the callback that opened it.
//   3. The family's and the caregiver's sheets were two hand-kept copies.
//
// So one sheet, mounted by whoever opens it: Dashboard, CaretakerHub, and VisitDetailModal on
// its own when its host has no sheet. It sends a REQUEST — the visit moves only when the other
// person accepts (PUT …/time-change/:id/respond), same as a time change always has.
//
// session: { id, date, time, durationHours, recipientName, caregiverName, timezone }
// role:    'family' | 'caregiver' — who is asking (sets the policy line and the toast)
const ChangeVisitSheet = window.ChangeVisitSheet = ({ session, role, onClose, onDone }) => {
  const s = session || {};
  const tz = s.timezone || TimezoneHelper.DEFAULT_TZ;
  const curDate = String(s.date || '').split(/[T ]/)[0];
  const curTime = s.time || '';
  const curDur = parseFloat(s.durationHours) || 2;

  const [newDate, setNewDate] = React.useState(curDate);
  const [newTime, setNewTime] = React.useState(curTime);
  const [newDur, setNewDur] = React.useState(String(curDur));
  const [reason, setReason] = React.useState('');
  const [sending, setSending] = React.useState(false);

  let today = '';
  try { today = TimezoneHelper.getToday(tz); } catch { today = ''; }

  // Every half hour from 1 to 12, plus the current length if it is something else (a 7-hour
  // visit must still be pickable as "no change in length").
  const lengths = Array.from({ length: 23 }, (_, i) => 1 + i / 2);
  if (!lengths.includes(curDur)) { lengths.push(curDur); lengths.sort((a, b) => a - b); }
  const startMin = TimeChange.toMin(newTime);

  const c = TimeChange.describe({
    fromDate: curDate, toDate: newDate || curDate,
    fromTime: curTime, fromHours: curDur,
    toTime: newTime, toHours: parseFloat(newDur) || curDur,
  });
  const unchanged = c.kind === 'same';
  const other = role === 'caregiver' ? 'the family' : (s.caregiverName ? s.caregiverName.split(' ')[0] : 'the caregiver');

  const label = { fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 };
  const field = { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-color)', fontSize: 14, boxSizing: 'border-box', background: 'var(--bg-surface)', color: 'var(--text-primary)' };

  const send = async () => {
    setSending(true);
    try {
      const r = await apiFetch(`/api/sessions/${s.id}/propose-time-change`, {
        method: 'POST',
        body: JSON.stringify({
          proposedDate: newDate || curDate,
          proposedTime: newTime,
          proposedDuration: parseFloat(newDur),
          reason: reason || null,
        }),
      });
      if (r && r.ok) {
        if (typeof showToast === 'function') showToast(`Sent to ${other} to accept — the visit stays as it is until then`, 'success');
        try { window.dispatchEvent(new Event('inplace:attention-stale')); } catch { /* nothing listening */ }
        if (onDone) onDone();
        if (onClose) onClose();
      } else {
        const d = r ? await r.json().catch(() => ({})) : {};
        if (typeof showToast === 'function') showToast((d && d.error) || 'That did not go through — nothing was changed', 'error');
      }
    } catch {
      if (typeof showToast === 'function') showToast('That did not go through — nothing was changed', 'error');
    }
    setSending(false);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}
      onClick={(e) => { e.stopPropagation(); if (e.target === e.currentTarget && onClose) onClose(); }}>
      <div style={{ background: 'var(--bg-surface)', borderRadius: 14, padding: 22, width: 420, maxWidth: '92vw', maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 17, color: 'var(--color-purple)' }}>{'⏰'} Change this visit</h3>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 14px' }}>
          {[s.recipientName, s.caregiverName ? `with ${s.caregiverName}` : null].filter(Boolean).join(' ')}
          {' — now '}{curDate ? TimeChange.dateLabel(curDate) : ''}{c.from ? `, ${c.from}` : ''}
        </p>

        <div style={{ marginBottom: 10 }}>
          <label style={label}>Day</label>
          <input type="date" value={newDate} min={today || undefined} onChange={(e) => setNewDate(e.target.value)} style={field} />
        </div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={label}>Start</label>
            <input type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} style={field} />
          </div>
          <div style={{ flex: 1.3 }}>
            <label style={label}>How long</label>
            <select value={String(parseFloat(newDur) || '')} onChange={(e) => setNewDur(e.target.value)} style={field}>
              {lengths.map((h) => (
                <option key={h} value={String(h)}>
                  {TimeChange.hours(h).replace(/ hr$/, h > 1 ? ' hrs' : ' hr')}{startMin != null ? ` · ends ${TimeChange.clock(startMin + h * 60)}` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ marginBottom: 12, padding: '9px 11px', borderRadius: 8, background: unchanged ? 'var(--bg-neutral)' : 'var(--color-purple-bg)', fontSize: 13 }}>
          <div style={{ fontWeight: 700, color: unchanged ? 'var(--text-secondary)' : 'var(--color-purple)' }}>{unchanged ? 'Same as now — change the day, start or length' : c.headline}</div>
          {!unchanged && (
            <div style={{ color: 'var(--text-secondary)', marginTop: 2 }}>
              New visit: {newDate ? TimeChange.dateLabel(newDate) : ''}{c.to ? `, ${c.to}` : ''} ({c.toHours})
            </div>
          )}
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={label}>Note for {other} (optional)</label>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g., Can we do the following Saturday instead?"
            style={{ ...field, minHeight: 50, fontSize: 13, resize: 'vertical' }} />
        </div>

        <div style={{ padding: '8px 10px', background: 'var(--bg-neutral)', borderRadius: 8, marginBottom: 14, fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Nothing changes until {other} accepts. {role === 'caregiver'
            ? 'If this is within 24 hours of the visit, the family may cancel at no charge and leave a review instead.'
            : 'If this is within 24 hours of the visit, the caregiver may decline and cancel, and may be owed for time outside the original window.'}
          {c.dateChanged ? ' Any card hold for the old day is released, and a new one is placed the day before the new date.' : ''}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose}
            style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Cancel
          </button>
          <button disabled={sending || unchanged || !newTime || !newDate} onClick={send}
            style={{ padding: '9px 16px', borderRadius: 8, border: 'none', background: (sending || unchanged) ? 'var(--text-muted)' : 'var(--color-purple)', color: 'var(--text-on-primary)', fontSize: 13, fontWeight: 700, cursor: sending ? 'wait' : 'pointer' }}>
            {sending ? 'Sending…' : `Send to ${other}`}
          </button>
        </div>
      </div>
    </div>
  );
};
