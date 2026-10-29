// ─── Coming Up spine (v1.126.0) ─────────────────────────────────────────
//
// Pete, 10/28: tomorrow had a visit with Tina, a haircut and a church lunch, rendered as three
// identical boxes. "Is there any way we can sort of link all the things together visually
// instead of three different boxes? I don't want the three events to get overlooked because
// it's a big blob." He picked direction A of the "Linked Day Timeline" canvas: one card,
// one vertical line, every item its own row.
//
// The line is the visit. It runs solid from the caregiver's arrival to the scheduled end, so
// an appointment that falls inside it reads as "while Tina is there" without anyone having to
// compare times; anything outside the visit hangs off a dashed line, which is the honest
// picture of "nobody is scheduled with her then". With no visit in the window it is simply a
// timeline of the day's appointments.
//
// This replaces the session hero and the care-event heroes (v1.106.17) in Dashboard.js. The
// inputs are computed there exactly as before — same 24h window, same imminentId bookkeeping,
// same countdown — so Next Up's de-duplication is untouched.

const _spineFullDate = (dateStr) => {
  const [y, m, d] = String(dateStr || '').split(/[T ]/)[0].split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

// "09:00" + 8h → "17:00". Naive wall-clock arithmetic on purpose: both ends are care-local.
const _spineAddHours = (timeStr, hours) => {
  const [h, m] = String(timeStr || '00:00').split(':').map(Number);
  const total = ((h || 0) * 60 + (m || 0) + Math.round((Number(hours) || 0) * 60)) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

const _spineInitials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2)
  .map(p => p[0] || '').join('').toUpperCase() || '?';

const _spineFirst = (name) => String(name || '').trim().split(/\s+/)[0] || '';

const ComingUpSpine = window.ComingUpSpine = ({ hero, events, onOpenVisit, onOpenEvent }) => {
  const evs = events || [];
  if (!hero && !evs.length) return null;

  // ─── Points on the line ───
  const points = [];
  if (hero) {
    points.push({ kind: 'start', ms: hero.startMs, date: hero.date, order: 0 });
    points.push({ kind: 'end', ms: hero.endMs, date: hero.endDate, order: 2 });
  }
  for (const { ev, startMs } of evs) {
    points.push({ kind: 'event', ev, ms: startMs, date: (ev.event_date || '').split('T')[0], order: 1 });
  }
  points.sort((a, b) => (a.ms - b.ms) || (a.order - b.order));

  const inVisit = (ms) => !!hero && ms >= hero.startMs && ms <= hero.endMs;
  const tz = hero?.tz || evs[0]?.ev?.timezone || TimezoneHelper.DEFAULT_TZ;

  // ─── Header ───
  const dates = [...new Set(points.filter(p => p.kind !== 'end').map(p => p.date))];
  const oneDay = dates.length === 1;
  const dayLabel = oneDay ? TimezoneHelper.getDateLabel(dates[0], tz) : '';
  const fullDate = oneDay ? _spineFullDate(dates[0]) : '';
  const heading = !oneDay ? 'Next 24 hours'
    : (dayLabel === 'Today' || dayLabel === 'Tomorrow') ? `${dayLabel} · ${fullDate}` : fullDate;

  const count = (hero ? 1 : 0) + evs.length;
  const recipients = [...new Set([
    ...(hero ? [_spineFirst(hero.recipientName)] : []),
    ...evs.map(({ ev }) => ev.recipientFirstName),
  ].filter(Boolean))];
  const cgFirst = hero ? _spineFirst(hero.caregiverName) : '';
  const allInside = !!hero && evs.length > 0 && evs.every(({ startMs }) => inVisit(startMs));
  const subtitle = `${count} ${count === 1 ? 'thing' : 'things'}`
    + (recipients.length === 1 ? ` for ${recipients[0]}` : '')
    + (allInside ? ` · all during ${cgFirst}'s visit` : '');

  const label = hero?.hasPendingTC ? 'Time change proposed' : hero?.isActive ? 'In progress now' : 'Coming up';
  const labelColor = hero?.hasPendingTC ? 'var(--color-purple)' : hero?.isActive ? 'var(--color-warning)' : 'var(--accent-color)';
  const soonMs = Math.min(...points.filter(p => p.kind !== 'end').map(p => p.ms)) - TimezoneHelper.realNowMs();
  const borderColor = hero?.hasPendingTC ? 'var(--color-purple)' : hero?.isActive ? 'var(--color-warning)'
    : soonMs <= 3600000 ? 'var(--accent-color)' : 'var(--role-color)';

  const lineSolid = 'var(--role-color)';
  const RAIL = 30;

  // Each row draws its own dot and the half-lines above and below it, so the line is continuous
  // across rows of any height without measuring anything.
  const rail = (i, dot) => {
    const prev = points[i - 1];
    const next = points[i + 1];
    const p = points[i];
    const segIn = (a, b) => !!hero && a.ms >= hero.startMs && b.ms <= hero.endMs;
    // No visit in the window: a plain neutral line — dashed means "outside the visit", which
    // says nothing when there is no visit.
    const seg = (inside) => inside
      ? { background: lineSolid, width: 4, left: 12 }
      : hero ? { borderLeft: '2px dashed var(--border-color)', width: 0, left: 13 }
        : { background: 'var(--border-color)', width: 2, left: 13 };
    return (
      <div style={{ width: RAIL, minWidth: RAIL, position: 'relative' }} aria-hidden="true">
        {prev && <div style={{ position: 'absolute', top: 0, height: dot.top + dot.size / 2, ...seg(segIn(prev, p)) }}></div>}
        {next && <div style={{ position: 'absolute', top: dot.top + dot.size / 2, bottom: 0, ...seg(segIn(p, next)) }}></div>}
        <div style={{
          position: 'absolute', top: dot.top, left: 14 - dot.size / 2, width: dot.size, height: dot.size,
          borderRadius: '50%', boxSizing: 'border-box', background: dot.hollow ? 'var(--bg-card)' : dot.color,
          border: dot.hollow ? `3px solid ${dot.color}` : 'none', boxShadow: '0 0 0 4px var(--bg-card)',
        }}></div>
      </div>
    );
  };

  const timeFor = (date, timeStr) => {
    const t = timeStr ? TimezoneHelper.formatTime(timeStr) : 'All day';
    return oneDay ? t : `${TimezoneHelper.getDateLabel(date, tz)} · ${t}`;
  };

  const rowBase = {
    flex: 1, minWidth: 0, marginBottom: 10, padding: 12, borderRadius: 12, cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', font: 'inherit',
    color: 'var(--text-primary)', width: '100%', boxSizing: 'border-box',
  };

  return (
    <div className="next-up-hero-shimmer" style={{
      marginBottom: 16, padding: '16px 14px 6px', borderRadius: 16, border: `3px solid ${borderColor}`,
      background: 'var(--bg-card)', boxShadow: '0 4px 16px rgba(27, 107, 90, 0.10)',
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Header: the day, how many things, and the visit countdown */}
      {/* Wraps: a long countdown ("Starting now — awaiting check-in") would otherwise squeeze the
          heading into a one-word-per-line column on a phone. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 14 }}>
        <div style={{ minWidth: 0, flex: '1 1 180px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: labelColor }}>{label}</div>
          <div style={{ fontSize: 19, fontWeight: 700, color: 'var(--text-primary)', marginTop: 3 }}>{heading}</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>{subtitle}</div>
        </div>
        {hero && hero.countdownStr && (
          <div style={{
            fontSize: 13, fontWeight: 700, color: hero.countdownColor, whiteSpace: 'nowrap',
            background: hero.isActive || hero.countdownColor === 'var(--accent-color)' ? 'var(--color-warning-bg)' : 'var(--color-success-bg)',
            padding: '5px 11px', borderRadius: 20, fontVariantNumeric: 'tabular-nums',
          }}>
            {hero.isActive || hero.msUntil <= 0 ? hero.countdownStr : `in ${hero.countdownStr}`}
          </div>
        )}
      </div>

      {points.map((p, i) => {
        if (p.kind === 'start') {
          return (
            <div key="visit-start" style={{ display: 'flex', alignItems: 'stretch' }}>
              {rail(i, { top: 17, size: 18, color: lineSolid })}
              <button type="button" onClick={() => onOpenVisit && onOpenVisit(hero.id)} style={{
                ...rowBase, background: 'var(--bg-highlight)', border: `1px solid ${lineSolid}`,
              }}>
                <div style={{
                  width: 38, height: 38, minWidth: 38, borderRadius: '50%', background: lineSolid,
                  color: 'var(--text-on-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 700, fontSize: 13,
                }} aria-hidden="true">{_spineInitials(hero.caregiverName)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--role-color)' }}>
                    {hero.hasPendingTC && hero.tcProposedTime ? (
                      <>
                        <span style={{ textDecoration: 'line-through', opacity: 0.6 }}>{timeFor(hero.date, hero.time)}</span>{' '}
                        <span style={{ color: 'var(--color-purple)' }}>{TimezoneHelper.formatTime(hero.tcProposedTime)} proposed</span>
                      </>
                    ) : `${timeFor(hero.date, hero.time)} – ${TimezoneHelper.formatTime(hero.endTime)}`}
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 1 }}>
                    {hero.caregiverName}
                    {hero.onMyWay && !hero.isActive && (
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-success)', background: 'var(--color-success-bg)', padding: '2px 8px', borderRadius: 10 }}>En Route</span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 1 }}>
                    {[hero.recipientName ? `with ${_spineFirst(hero.recipientName)}` : '',
                      hero.serviceType || '',
                      hero.durationHours ? `${hero.durationHours}hr` : ''].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div style={{ fontSize: 20, color: 'var(--text-tertiary)' }} aria-hidden="true">›</div>
              </button>
            </div>
          );
        }
        if (p.kind === 'end') {
          return (
            <div key="visit-end" style={{ display: 'flex', alignItems: 'stretch' }}>
              {rail(i, { top: 10, size: 14, color: lineSolid, hollow: true })}
              <div style={{ flex: 1, padding: '7px 4px 14px', fontSize: 13, color: 'var(--text-secondary)' }}>
                {oneDay ? '' : `${TimezoneHelper.getDateLabel(hero.endDate, tz)} · `}{TimezoneHelper.formatTime(hero.endTime)} · {cgFirst}'s visit ends
              </div>
            </div>
          );
        }
        const ev = p.ev;
        const inside = inVisit(p.ms);
        const started = p.ms <= TimezoneHelper.realNowMs();
        return (
          <div key={`ev-${ev.id}`} style={{ display: 'flex', alignItems: 'stretch' }}>
            {rail(i, { top: 20, size: 14, color: 'var(--accent-color)' })}
            <button type="button" onClick={() => onOpenEvent && onOpenEvent(ev)} style={{
              ...rowBase, background: 'var(--bg-secondary, var(--bg-card))', border: '1px solid var(--border-color)',
            }}>
              <div style={{
                width: 38, height: 38, minWidth: 38, borderRadius: 10, background: 'var(--border-light)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
              }} aria-hidden="true">{careEventIcon(ev.category)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-color)' }}>
                  {started ? 'Happening now' : timeFor(p.date, ev.event_time)}{ev.end_time ? ` – ${TimezoneHelper.formatTime(ev.end_time)}` : ''}
                </div>
                <div style={{
                  fontSize: 16, fontWeight: 700, lineHeight: 1.25, marginTop: 1,
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere',
                }}>{ev.title}</div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 1 }}>
                  {[ev.recipientFirstName ? `for ${ev.recipientFirstName}` : '', ev.location || ''].filter(Boolean).join(' · ')}
                </div>
                {/* Only on the visit's own day: "not during Maria's visit" about tomorrow's
                    dentist, when Maria's visit was this morning, is true and useless. */}
                {hero && !inside && p.date === hero.date && (
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginTop: 3 }}>Not during {cgFirst}'s visit</div>
                )}
              </div>
              <div style={{ fontSize: 20, color: 'var(--text-tertiary)' }} aria-hidden="true">›</div>
            </button>
          </div>
        );
      })}
    </div>
  );
};
