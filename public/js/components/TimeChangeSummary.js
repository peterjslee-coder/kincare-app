// ─── The time-change review, top half (v1.123.0) ───
//
// Pete, 10/19: Tina kept the 9:00 start and shortened Thursday's visit to end at 3:00. The
// review sheet showed CURRENT 9:00 AM / PROPOSED 9:00 AM with the hours in small grey type
// underneath — you had to read the small print to see anything had changed. It made sense
// only once you dug in.
//
// Now: the change in one line first ("End at 3:00 PM instead of 5:00 PM"), who and which day
// under it, then the two whole windows as Was / New rows with the part that moved in colour.
// Rows, not side-by-side boxes, because "9:00 AM – 5:00 PM" does not fit in half a phone.
//
// Shared by the family's sheet (Dashboard) and the caregiver's (CaretakerHub).
const TimeChangeSummary = window.TimeChangeSummary = ({ proposal, session, proposerName }) => {
  const p = proposal || {};
  const s = session || {};
  const sDate = String(p.original_date || s.date || s.scheduled_date || '').split(/[T ]/)[0];
  const c = TimeChange.describe({
    fromTime: p.original_time, fromHours: p.original_duration,
    toTime: p.proposed_time, toHours: p.proposed_duration,
    fromDate: sDate, toDate: p.proposed_date || sDate, // v1.124.0
  });
  const fromStart = TimeChange.toMin(p.original_time);
  const toStart = TimeChange.toMin(p.proposed_time);
  const fromEnd = fromStart == null ? null : fromStart + Math.round((Number(p.original_duration) || 0) * 60);
  const toEnd = toStart == null ? null : toStart + Math.round((Number(p.proposed_duration) || 0) * 60);

  const tz = s.timezone || s.tz || TimezoneHelper.DEFAULT_TZ;
  let day = '';
  try { day = sDate ? TimezoneHelper.getDateLabel(sDate, tz) : ''; } catch { day = ''; }

  const strong = { color: 'var(--color-purple)', fontWeight: 800 };
  const quiet = { color: 'var(--text-secondary)', fontWeight: 600 };
  const row = (label, start, end, hrs, isNew, dayText) => (
    <div style={{
      display: 'flex', alignItems: 'baseline', gap: 10, padding: '9px 12px', borderRadius: 10,
      background: isNew ? 'var(--color-purple-bg)' : 'var(--bg-neutral)',
      border: isNew ? '2px solid var(--color-purple)' : '2px solid transparent',
    }}>
      <div style={{ width: 34, flexShrink: 0, fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px', color: isNew ? 'var(--color-purple)' : 'var(--text-muted)' }}>{label}</div>
      <div style={{ flex: 1, fontSize: 15, ...(isNew ? {} : { color: 'var(--text-secondary)' }) }}>
        {/* v1.124.0 — the day leads when it is the thing that moved */}
        {dayText ? <div style={{ fontSize: 13, marginBottom: 1, ...(isNew ? strong : {}) }}>{dayText}</div> : null}
        <span style={isNew && c.startChanged ? strong : (isNew ? quiet : {})}>{TimeChange.clock(start)}</span>
        <span style={{ color: 'var(--text-muted)' }}> – </span>
        <span style={isNew && c.endChanged ? strong : (isNew ? quiet : {})}>{TimeChange.clock(end)}</span>
      </div>
      <div style={{ fontSize: 12, whiteSpace: 'nowrap', ...(isNew && c.hoursChanged ? strong : { color: 'var(--text-muted)' }) }}>{hrs}</div>
    </div>
  );

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.3 }}>{c.headline}</div>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '4px 0 12px' }}>
        {[proposerName ? `${proposerName} asked` : null, day && !c.dateChanged ? `${s.recipientName ? `${String(s.recipientName).split(' ')[0]}'s visit ` : 'Visit '}${TimeChange.onDay(day)}` : null, c.sub].filter(Boolean).join(' · ')}
      </div>
      {fromStart != null && toStart != null ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {row('Was', fromStart, fromEnd, c.fromHours, false, c.dateChanged ? c.fromDate : null)}
          {row('New', toStart, toEnd, c.toHours, true, c.dateChanged ? c.toDate : null)}
        </div>
      ) : null}
    </div>
  );
};
