// ─── Start and end — the one way a visit's time is set (v1.150.0) ───
//
// Pete, 11/22: "I don't want the number of hours to be the primary factor. It's generally start
// and end of time. If I pick a start time of eight and go for six hours and someone proposes
// that they need to end at 1330, then it's a 5 1/2 hour visit. That's it. It doesn't push it
// left to 730."
//
// So the two things a person sets are START and END. Length is worked out from them and only
// ever shown. Moving the start never slides the end, and moving the end never slides the
// start. The length pills are a shortcut that sets the END from the start (8:00 + "6 hr" →
// ends 2:00 PM); after that the end is an end like any other.
//
// The visit is still stored as start + duration_hours (pay, holds and the schedule all read
// that), so this hands back { start, end, hours } and the caller saves `hours`.
//
// Same day only, 15-minute steps, 30 minutes to 12 hours. An end at or before the start is
// shown as a problem and `hours` comes back null — it is never "fixed" by moving the other end.
//
// Props: start "HH:MM", end "HH:MM", onChange({ start, end, hours }), quick (array of hours for
// the pills, [] to hide them), label { start, end } overrides, compact (smaller pills), hideStart
// (the host already has its own start picker — Request care's hour grid).
const TimeRange = window.TimeRange = ({ start, end, onChange, quick, labels, compact, hideStart }) => {
  const toMin = (t) => {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const toHHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  const s = toMin(start);
  const e = toMin(end);
  const hours = TimeRange.hoursBetween(start, end);
  const problem = s != null && e != null && hours == null
    ? (e <= s ? 'End has to be after the start' : 'A visit can run 30 minutes to 12 hours')
    : null;

  const emit = (ns, ne) => onChange && onChange({ start: ns, end: ne, hours: TimeRange.hoursBetween(ns, ne) });
  const pills = quick || [2, 3, 4, 5, 6, 8];

  const label = { fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 };
  const field = { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-color)', fontSize: 14, boxSizing: 'border-box', background: 'var(--bg-surface)', color: 'var(--text-primary)' };

  return (
    <div>
      <div style={{ display: 'flex', gap: 10 }}>
        {!hideStart && (
          <div style={{ flex: 1 }}>
            <label style={label}>{(labels && labels.start) || 'Start'}</label>
            <input type="time" step="900" value={start || ''} onChange={(ev) => emit(ev.target.value, end)} style={field} />
          </div>
        )}
        <div style={{ flex: 1 }}>
          <label style={label}>{(labels && labels.end) || 'End'}</label>
          <input type="time" step="900" value={end || ''} onChange={(ev) => emit(start, ev.target.value)}
            style={{ ...field, borderColor: problem ? 'var(--color-error)' : 'var(--border-color)' }} />
        </div>
      </div>
      {s != null && pills.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {pills.map((h) => {
            const on = hours === h;
            const endMin = s + h * 60;
            if (endMin >= 24 * 60) return null;
            return (
              <button key={h} type="button" onClick={() => emit(start, toHHMM(endMin))} style={{
                padding: compact ? '4px 10px' : '6px 12px', borderRadius: 16, fontSize: compact ? 12 : 13, fontWeight: 600, cursor: 'pointer',
                border: on ? '1.5px solid var(--role-color, var(--accent-color))' : '1px solid var(--border-color)',
                background: on ? 'var(--role-color-bg, var(--bg-neutral))' : 'var(--bg-surface)',
                color: on ? 'var(--role-color, var(--accent-color))' : 'var(--text-secondary)',
              }}>{TimeRange.hoursLabel(h)}</button>
            );
          })}
        </div>
      )}
      <div style={{ marginTop: 6, fontSize: 12, color: problem ? 'var(--color-error)' : 'var(--text-tertiary)' }}>
        {problem || (hours != null ? `${TimeRange.clock(s)} – ${TimeRange.clock(e)} · ${TimeRange.hoursLabel(hours)}` : '')}
      </div>
    </div>
  );
};

// Hours from start to end in quarter hours, or null when it is not a real visit (missing, end
// not after start, shorter than 30 minutes or longer than 12 hours).
TimeRange.hoursBetween = (start, end) => {
  const p = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const s = p(start), e = p(end);
  if (s == null || e == null) return null;
  const mins = e - s;
  if (mins < 30 || mins > 12 * 60) return null;
  return Math.round(mins / 15) / 4;
};

// "HH:MM" end from a start and a length in hours, or '' when it would pass midnight.
TimeRange.endOf = (start, hours) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(start || ''));
  const h = parseFloat(hours);
  if (!m || !Number.isFinite(h)) return '';
  const min = Number(m[1]) * 60 + Number(m[2]) + Math.round(h * 60);
  if (min >= 24 * 60) return '';
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
};

TimeRange.clock = (min) => {
  let h = Math.floor(min / 60) % 24; const m = min % 60; const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${ap}`;
};

// 4.5 → "4½ hr", 5.25 → "5¼ hr", 1 → "1 hr"
TimeRange.hoursLabel = (h) => {
  const whole = Math.floor(h); const frac = Math.round((h - whole) * 4);
  const f = ['', '¼', '½', '¾'][frac] || '';
  return `${whole || (f ? '' : '0')}${f} hr`;
};
