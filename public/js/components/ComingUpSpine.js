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

  // ─── v1.140.0 — the day stays on the card until midnight (Pete, 11/20) ───
  // "the today bar which Tina showing up a doctors appointment and lunch should stay there maybe
  // with a progress marker through the day so that anyone who opens the app can look at the
  // appointment, click on it and see what was said." What's over fades and gets a ✓; an
  // appointment with notes keeps a "Notes from Tina" line; an orange NOW line marks the time.
  const nowMs = TimezoneHelper.realNowMs();
  const evEndMs = (p) => {
    const ev = p.ev;
    if (ev && ev.end_time) {
      const t = TimezoneHelper.buildDateTime(p.date, ev.end_time, ev.timezone || TimezoneHelper.DEFAULT_TZ).getTime();
      if (t > p.ms) return t;
    }
    return p.ms + 60 * 60000;
  };
  for (const p of points) {
    if (p.kind === 'event') { p.endMs = evEndMs(p); p.done = p.endMs <= nowMs; p.started = p.ms <= nowMs; }
    else p.done = p.ms <= nowMs;
  }
  const before = points.some((p) => p.ms <= nowMs);
  const after = points.some((p) => p.ms > nowMs);
  if (before && after) {
    const at = points.findIndex((p) => p.ms > nowMs);
    points.splice(at, 0, { kind: 'now', ms: nowMs, order: 1.5 });
  }
  const doneCount = points.filter((p) => p.kind === 'event' && p.done).length + (hero && hero.isDone ? 1 : 0);

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
    + (doneCount ? ` · ${doneCount} done` : allInside ? ` · all during ${cgFirst}'s visit` : '');

  const allDone = points.filter((p) => p.kind !== 'now').every((p) => p.done);
  const label = hero?.hasPendingTC ? 'Time change proposed' : hero?.isActive ? 'In progress now'
    : allDone ? 'Today · done' : before ? 'Today' : 'Coming up';
  const labelColor = hero?.hasPendingTC ? 'var(--color-purple)' : hero?.isActive ? 'var(--color-warning)'
    : allDone ? 'var(--color-success)' : 'var(--accent-color)';
  const ahead = points.filter(p => p.kind !== 'end' && p.kind !== 'now' && !p.done).map(p => p.ms);
  const soonMs = ahead.length ? Math.min(...ahead) - nowMs : Infinity;
  const borderColor = hero?.hasPendingTC ? 'var(--color-purple)' : hero?.isActive ? 'var(--color-warning)'
    : allDone ? 'var(--border-color)' : soonMs <= 3600000 ? 'var(--accent-color)' : 'var(--role-color)';

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

      {/* v1.140.0 — how far through the visit we are */}
      {hero && (hero.isActive || hero.isDone) && hero.endMs > hero.startMs && (() => {
        const frac = Math.max(0, Math.min(1, (nowMs - hero.startMs) / (hero.endMs - hero.startMs)));
        return (
          <div data-testid="spine-progress" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '-4px 0 14px' }}>
            <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--border-light)', position: 'relative' }}>
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${frac * 100}%`, borderRadius: 3, background: 'var(--role-color)' }}></div>
              {frac < 1 && <div style={{ position: 'absolute', left: `${frac * 100}%`, top: -4, width: 14, height: 14, marginLeft: -7, borderRadius: '50%', background: 'var(--accent-color)', boxShadow: '0 0 0 2px var(--bg-card)' }}></div>}
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{TimezoneHelper.formatTime(hero.time)}{'\u2013'}{TimezoneHelper.formatTime(hero.endTime)}</span>
          </div>
        );
      })()}

      {points.map((p, i) => {
        if (p.kind === 'now') {
          return (
            <div key="now" data-testid="spine-now" style={{ display: 'flex', alignItems: 'center', margin: '0 0 10px' }}>
              <div style={{ width: RAIL, minWidth: RAIL, display: 'flex', justifyContent: 'center' }}>
                <span style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-on-primary)', background: 'var(--accent-color)', borderRadius: 10, padding: '3px 4px', letterSpacing: 0.3 }}>NOW</span>
              </div>
              <div style={{ flex: 1, height: 2, background: 'var(--accent-color)', marginLeft: 4 }}></div>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-color)', marginLeft: 8 }}>
                {new Date(nowMs).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz })}
              </span>
            </div>
          );
        }
        if (p.kind === 'start') {
          return (
            <div key="visit-start" style={{ display: 'flex', alignItems: 'stretch' }}>
              {rail(i, { top: 17, size: 18, color: lineSolid })}
              <button type="button" onClick={() => onOpenVisit && onOpenVisit(hero.id)} style={{
                ...rowBase, background: 'var(--bg-highlight)', border: `1px solid ${lineSolid}`,
                opacity: hero.isDone ? 0.7 : 1,
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
                    ) : `${timeFor(hero.date, hero.time)} – ${TimezoneHelper.formatTime(hero.endTime)}${hero.isDone ? ' \u00b7 \u2713 done' : ''}`}
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
                {oneDay ? '' : `${TimezoneHelper.getDateLabel(hero.endDate, tz)} · `}{TimezoneHelper.formatTime(hero.endTime)} · {cgFirst}'s visit {p.done ? 'ended \u2713' : 'ends'}
              </div>
            </div>
          );
        }
        const ev = p.ev;
        const inside = inVisit(p.ms);
        const started = p.started;
        const done = p.done;
        const notes = Number(ev.notes_count) || 0;
        return (
          <div key={`ev-${ev.id}`} style={{ display: 'flex', alignItems: 'stretch' }}>
            {rail(i, { top: 20, size: 14, color: done ? 'var(--color-success)' : 'var(--accent-color)' })}
            <button type="button" data-testid={done ? 'spine-event-done' : 'spine-event'} onClick={() => onOpenEvent && onOpenEvent(ev)} style={{
              ...rowBase, flexWrap: 'wrap', background: 'var(--bg-secondary, var(--bg-card))',
              border: `1px solid ${done && notes ? 'var(--color-success)' : 'var(--border-color)'}`,
              opacity: done && !notes ? 0.7 : 1,
            }}>
              <div style={{
                width: 38, height: 38, minWidth: 38, borderRadius: 10, background: 'var(--border-light)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
              }} aria-hidden="true">{careEventIcon(ev.category)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-color)' }}>
                  {done ? `${timeFor(p.date, ev.event_time)} \u00b7 \u2713 done` : started ? 'Happening now' : `${timeFor(p.date, ev.event_time)}${ev.end_time ? ` – ${TimezoneHelper.formatTime(ev.end_time)}` : ''}`}
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
              {notes > 0 && (
                <div data-testid="spine-notes" style={{ flexBasis: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8,
                  background: 'var(--role-color)', color: 'var(--text-on-primary)', fontSize: 13, fontWeight: 600 }}>
                  <span aria-hidden="true">{'\u{1F4DD}'}</span>
                  <span style={{ flex: 1 }}>{notes === 1 ? `Notes from ${ev.notes_first_author || 'the team'}` : `${notes} notes`} {'\u00b7'} tap to read</span>
                  <span aria-hidden="true">{'\u203A'}</span>
                </div>
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
};
