// ─── The 24-hour day bar (v1.135.0) ───
//
// Pete, 11/18: "rewicker the calendar view to show across the 24 hours (as a function of the
// color which works well, green is filled, orange is requested, etc) to show of the 24 hours in
// that block left to right, how much is filled. So, appointment at 8 starts about 1/3 from the
// left border and stretches to about 2/3 of the way in green because it's 8 hours ... they can
// stack/overlap." Mockup approved: claude.ai/artifact/5Bo9poGmgr3NvcqiX7LUDG.
//
// Left edge is midnight, right edge is midnight. Caregiver visits only (Pete's call). A visit
// that runs past midnight is cut at the right edge and picks up at the left edge of the next
// day. Two visits at the same time stack on two lines.
//
// dayBarSegments() is pure (tested in tests/dayBar.test.js); <DayBar/> only draws.

const DAY_BAR_KIND = window.DAY_BAR_KIND = {
  confirmed: { label: 'Confirmed', bg: 'var(--role-color)', text: 'var(--text-on-primary)' },
  requested: { label: 'Requested / open', bg: 'repeating-linear-gradient(135deg, #d9711c 0 4px, #f6c99d 4px 7px)', text: '#5c2a05' },
  now: { label: 'Happening now', bg: '#6f4bd8', text: '#ffffff' },
  done: { label: 'Done', bg: '#9aa39f', text: '#ffffff' },
};

const dayBarKind = window.dayBarKind = (status, dateStr, todayStr) => {
  if (status === 'in_progress') return 'now';
  if (status === 'completed') return 'done';
  if (['open', 'requested', 'pending'].includes(status)) return 'requested';
  // Confirmed (or accepted) and already in the past: it happened.
  return dateStr < todayStr ? 'done' : 'confirmed';
};

const _dbHours = (hhmm) => {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/);
  return m ? Math.min(24, Number(m[1]) + Number(m[2]) / 60) : null;
};

const _dbPrevDate = (dateStr) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const p = new Date(y, m - 1, d - 1);
  return p.getFullYear() + '-' + String(p.getMonth() + 1).padStart(2, '0') + '-' + String(p.getDate()).padStart(2, '0');
};

/**
 * The pieces of a day's bar.
 * @param sessionsByDate { 'YYYY-MM-DD': [session] } (scheduled_date, scheduled_time, duration_hours, status, caregiver_name)
 * @returns [{ id, start, end, kind, lane, label }] hours 0–24, lanes from 0
 */
const dayBarSegments = window.dayBarSegments = (sessionsByDate, dateStr, todayStr) => {
  const segs = [];
  const label = (s) => {
    const n = String(s.caregiver_name || '').trim().split(/\s+/)[0];
    return n || (['open', 'requested', 'pending'].includes(s.status) ? 'Open' : '');
  };
  // Today's own visits.
  (sessionsByDate[dateStr] || []).forEach((s) => {
    const start = _dbHours(s.scheduled_time);
    if (start === null) return;
    const dur = Number(s.duration_hours) > 0 ? Number(s.duration_hours) : 2;
    segs.push({ id: s.id, start, end: Math.min(24, start + dur), kind: dayBarKind(s.status, dateStr, todayStr), label: label(s) });
  });
  // Yesterday's overnights that run into today.
  const prev = _dbPrevDate(dateStr);
  (sessionsByDate[prev] || []).forEach((s) => {
    const start = _dbHours(s.scheduled_time);
    if (start === null) return;
    const dur = Number(s.duration_hours) > 0 ? Number(s.duration_hours) : 2;
    const spill = start + dur - 24;
    if (spill > 0) segs.push({ id: s.id + ':cont', start: 0, end: Math.min(24, spill), kind: dayBarKind(s.status, prev, todayStr), label: label(s) });
  });
  // Lanes: earliest first, each into the first lane that is free by then.
  segs.sort((a, b) => a.start - b.start || b.end - a.end);
  const laneEnds = [];
  segs.forEach((g) => {
    let lane = laneEnds.findIndex((e) => e <= g.start + 1e-6);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
    laneEnds[lane] = g.end;
    g.lane = lane;
  });
  return segs;
};

/** Hours covered (confirmed, now or done), counted once even where visits overlap. */
const dayBarCoveredHours = window.dayBarCoveredHours = (segs) => {
  const iv = segs.filter((g) => g.kind !== 'requested').map((g) => [g.start, g.end]).sort((a, b) => a[0] - b[0]);
  let total = 0; let cur = null;
  iv.forEach(([s, e]) => {
    if (!cur || s > cur[1]) { if (cur) total += cur[1] - cur[0]; cur = [s, e]; }
    else cur[1] = Math.max(cur[1], e);
  });
  if (cur) total += cur[1] - cur[0];
  return Math.round(total * 10) / 10;
};

const DayBar = window.DayBar = ({ segments, laneHeight = 6, gap = 2, radius = 3, labels = false, fontSize = 10.5, ariaLabel }) => {
  const segs = segments || [];
  const lanes = Math.max(1, ...segs.map((g) => g.lane + 1));
  const height = lanes * laneHeight + (lanes - 1) * gap;
  const pct = (h) => (h / 24 * 100) + '%';
  const fmt = (h) => {
    const hh = Math.floor(h) % 24; const mm = Math.round((h - Math.floor(h)) * 60);
    const ap = hh < 12 ? 'a' : 'p'; const h12 = hh % 12 === 0 ? 12 : hh % 12;
    return h12 + (mm ? ':' + String(mm).padStart(2, '0') : '') + ap;
  };
  return (
    <div role="img" aria-label={ariaLabel || (segs.length ? segs.map((g) => `${DAY_BAR_KIND[g.kind].label} ${fmt(g.start)} to ${fmt(g.end)}`).join(', ') : 'Nothing scheduled')}
      style={{ position: 'relative', width: '100%', height, background: 'var(--bg-surface, #fff)', borderRadius: radius, boxShadow: 'inset 0 0 0 1px var(--border-color)', flexShrink: 0 }}>
      {[6, 12, 18].map((q) => (
        <div key={q} aria-hidden="true" style={{ position: 'absolute', left: pct(q), top: 0, bottom: 0, width: 1, background: 'var(--border-color)' }} />
      ))}
      {segs.map((g) => {
        const k = DAY_BAR_KIND[g.kind] || DAY_BAR_KIND.confirmed;
        return (
          <div key={g.id} title={`${g.label ? g.label + ' · ' : ''}${fmt(g.start)}–${fmt(g.end)} · ${k.label}`} style={{
            position: 'absolute', left: pct(g.start), width: `calc(${pct(g.end - g.start)} - 1px)`, minWidth: 2,
            top: g.lane * (laneHeight + gap), height: laneHeight,
            borderRadius: Math.min(radius, laneHeight / 2), background: k.bg, overflow: 'hidden',
          }}>
            {labels && g.label && (
              <span style={{ display: 'block', padding: '0 5px', fontSize, fontWeight: 600, color: k.text, lineHeight: laneHeight + 'px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.label}</span>
            )}
          </div>
        );
      })}
    </div>
  );
};

const DayBarAxis = window.DayBarAxis = () => (
  <div aria-hidden="true" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
    <span>12a</span><span>6a</span><span>12p</span><span>6p</span><span>12a</span>
  </div>
);

const DayBarLegend = window.DayBarLegend = () => (
  <div style={{ display: 'flex', gap: '6px 14px', flexWrap: 'wrap', fontSize: 11, color: 'var(--text-muted)' }}>
    {Object.keys(DAY_BAR_KIND).map((k) => (
      <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span aria-hidden="true" style={{ width: 18, height: 8, borderRadius: 4, background: DAY_BAR_KIND[k].bg, display: 'inline-block' }} />
        {DAY_BAR_KIND[k].label}
      </span>
    ))}
  </div>
);
