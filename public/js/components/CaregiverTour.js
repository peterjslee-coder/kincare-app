// ─── The caregiver's first-visit tour (v1.105.194) ───
//
// Pete, Sep 12 2026: "a guided walk-through of checking in and leaving notes and checking
// out. A quick click through hitting the right buttons as a tutorial." And after Tina's
// dead Find Work button: an illustrated guide to where things are, once the steps are done.
//
// Eight stops, one sentence each, one thing lit per screen.
//   1–3  coachmarks over the REAL screens (Home, Find Work, Messages + Care Notes)
//   4–7  a PRACTICE visit on screens shaped like the real check-in: briefing → arrive →
//        during → check out. Every one carries a PRACTICE ribbon. It writes NOTHING — no
//        session, no note, no location sent, no pay. The one real thing it does is ask the
//        phone for location permission at "check in", so the prompt is behind her before
//        her first real visit (Pete: "yes on the location").
//   8    where things live — five cells
//
// Skippable at every stop. Done or skipped is remembered on the ACCOUNT (users.ui_prefs,
// `tour.caregiver.done`), and "Show me around again" in Help starts it over.

const TOUR_SCRIM = 'rgba(20,32,44,0.72)';

const CaregiverTour = window.CaregiverTour = ({ onNavigate, onClose, firstName }) => {
  const [i, setI] = React.useState(0);
  const [rects, setRects] = React.useState([]);       // lit rectangles for the current stop
  const [pin, setPin] = React.useState(null);          // practice check-in: null | 'asking' | 'pinned' | 'denied' | 'unavailable'
  const [note, setNote] = React.useState('');
  const [taskDone, setTaskDone] = React.useState(false);
  const [mood, setMood] = React.useState(null);

  const stops = [
    { id: 'home', page: 'dashboard', anchors: ['[data-tour="up-next"]', '[data-tour="calendar"]'],
      title: 'This is your day',
      body: 'Every visit you’ve accepted, and any care task due while you’re there, in the order it happens. Tap one to open it.' },
    // The FIRST card, not the whole list — lighting a full-screen list dims nothing.
    { id: 'find-work', page: 'find-work', anchors: ['[data-tour="job-first"]', '[data-tour="jobs"]'],
      title: 'Work finds you here',
      body: 'Families who know you can send a visit straight to you — those sit at the top. Accepting a weekly one means the whole series, so you won’t be asked six times.' },
    { id: 'messages', page: 'messages', anchors: ['[data-tour="conversation-row"]', '[data-tour="nav-care-notes"]'],
      title: 'Talk here, read there',
      body: 'Messages is the family and their care team. Care Notes, in the bottom bar, is their record of how things are going — it’s there only when a family shares it with you.' },
    { id: 'p-briefing', practice: true },
    { id: 'p-checkin', practice: true },
    { id: 'p-during', practice: true },
    { id: 'p-checkout', practice: true },
    { id: 'map' },
  ];
  const stop = stops[i];
  const total = stops.length;

  const finish = (how) => {
    try { if (window.__setUiPref) { window.__setUiPref('tour.caregiver.done', Date.now()); window.__setUiPref('tour.caregiver.later', null); } } catch { /* remembered next time */ }
    if (how === 'done' && onNavigate) onNavigate('dashboard');
    if (onClose) onClose(how);
  };
  const next = () => (i + 1 < total ? setI(i + 1) : finish('done'));
  const back = () => setI(Math.max(0, i - 1));

  // The PWA install banner sits at z-index 1200, exactly where the coach card lands. Hide it for
  // the tour's lifetime; it comes back on its own when the tour closes.
  React.useEffect(() => {
    const banner = document.querySelector('.pwa-install-banner');
    if (!banner) return undefined;
    const prev = banner.style.display;
    banner.style.display = 'none';
    return () => { banner.style.display = prev; };
  }, []);

  // ── Coachmark stops: go to the page, find the thing, light it ──
  React.useEffect(() => {
    if (!stop || stop.practice || stop.id === 'map') { setRects([]); return undefined; }
    let cancelled = false;
    if (onNavigate && stop.page) onNavigate(stop.page);
    let tries = 0;
    const measure = () => {
      if (cancelled) return;
      // The first selector that matches is the primary (the hole in the scrim); a nav
      // selector, when present, is a second outline. Fallback selectors never stack.
      const found = [];
      for (const sel of stop.anchors) {
        const el = document.querySelector(sel);
        if (!el) continue;
        if (sel.includes('nav-') || found.length === 0) found.push(el);
      }
      if (found.length === 0 && tries < 12) { tries += 1; setTimeout(measure, 150); return; }
      if (found[0] && tries < 12) {
        try { found[0].scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* fine */ }
        tries = 12; setTimeout(measure, 380); return;
      }
      setRects(found.map((el) => {
        const r = el.getBoundingClientRect();
        return { top: r.top - 6, left: r.left - 6, width: r.width + 12, height: r.height + 12 };
      }));
    };
    measure();
    const onResize = () => { tries = 12; measure(); };
    window.addEventListener('resize', onResize);
    return () => { cancelled = true; window.removeEventListener('resize', onResize); };
  }, [i]);

  // ── Practice check-in: the ONE real thing — the location prompt ──
  const askLocation = () => {
    if (!navigator.geolocation) { setPin('unavailable'); return; }
    setPin('asking');
    navigator.geolocation.getCurrentPosition(
      () => setPin('pinned'),          // the coordinates are never read, never sent
      () => setPin('denied'),
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 }
    );
  };

  const dots = (
    <span style={{ display: 'flex', gap: 4 }} aria-label={`Stop ${i + 1} of ${total}`}>
      {stops.map((s, k) => (
        <i key={s.id} style={{ width: 6, height: 6, borderRadius: '50%', display: 'block', background: k === i ? 'var(--accent-color)' : 'var(--border-light)' }} />
      ))}
    </span>
  );
  const btn = (label, onClick, kind) => (
    <button onClick={onClick} style={{
      border: kind === 'ghost' ? '1px solid var(--border-light)' : 'none', borderRadius: 8, padding: '8px 14px',
      font: 'inherit', fontWeight: 700, fontSize: 13, cursor: 'pointer',
      background: kind === 'ghost' ? 'transparent' : kind === 'ok' ? 'var(--color-success)' : 'var(--role-color)',
      color: kind === 'ghost' ? 'var(--text-primary)' : 'var(--text-on-primary)',
    }}>{label}</button>
  );
  const skip = (
    <button onClick={() => finish('skipped')} style={{ background: 'none', border: 'none', font: 'inherit', fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}>Skip tour</button>
  );
  const footer = (nextLabel, opts) => {
    const o = opts || {};
    return (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, gap: 8, flexWrap: 'wrap' }}>
        {dots}
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {skip}
          {i > 0 && btn('Back', back, 'ghost')}
          {btn(nextLabel || 'Next', o.onNext || next, o.kind)}
        </span>
      </div>
    );
  };

  // ── Coachmark ──
  if (!stop.practice && stop.id !== 'map') {
    return (
      <div role="dialog" aria-label="Tour" style={{ position: 'fixed', inset: 0, zIndex: 1300, pointerEvents: 'none' }}>
        {rects.length === 0 && <div style={{ position: 'absolute', inset: 0, background: TOUR_SCRIM }} />}
        {rects.map((r, k) => (
          <div key={k} style={{
            position: 'absolute', top: r.top, left: r.left, width: r.width, height: r.height, borderRadius: 12,
            boxShadow: k === 0 ? `0 0 0 9999px ${TOUR_SCRIM}` : 'none',
            outline: '2px solid var(--accent-color)', outlineOffset: 3,
          }} />
        ))}
        <div className="ip-path-step" key={stop.id} style={{
          position: 'absolute', left: 14, right: 14, bottom: 'calc(env(safe-area-inset-bottom, 0px) + 84px)',
          maxWidth: 480, margin: '0 auto', pointerEvents: 'auto',
          background: 'var(--bg-card)', color: 'var(--text-primary)', borderRadius: 12, padding: '12px 14px',
          boxShadow: '0 8px 28px rgba(0,0,0,0.28)', fontSize: 13, lineHeight: 1.45,
        }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--role-color)', marginBottom: 2 }}>{stop.title}</div>
          <div>{stop.body}</div>
          {footer()}
        </div>
      </div>
    );
  }

  // ── Practice screens (full-screen, over everything, ribboned) ──
  const shell = (children) => (
    <div role="dialog" aria-label="Practice visit" style={{ position: 'fixed', inset: 0, zIndex: 1300, background: 'var(--bg-primary)', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
      <div aria-hidden="true" style={{
        position: 'fixed', top: 22, right: -46, transform: 'rotate(38deg)', background: 'var(--accent-color)', color: 'var(--text-on-primary)',
        fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', padding: '4px 48px', textTransform: 'uppercase', zIndex: 1,
      }}>Practice</div>
      <div style={{ maxWidth: 520, margin: '0 auto', padding: '18px 16px calc(env(safe-area-inset-bottom, 0px) + 24px)', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-color)', letterSpacing: '0.1em', textTransform: 'uppercase', paddingRight: 96, lineHeight: 1.4 }}>Practice visit {'·'} nothing is recorded</div>
        {children}
      </div>
    </div>
  );
  const card = (children, style) => <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: 14, boxShadow: '0 2px 8px rgba(0,0,0,0.08)', ...(style || {}) }}>{children}</div>;
  const h = (t, sub) => (
    <div>
      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--role-color)' }}>{t}</div>
      {sub && <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{sub}</div>}
    </div>
  );
  const coach = (title, body) => (
    <div style={{ background: 'var(--bg-highlight)', border: '1px solid var(--border-teal-light, #d0e8e3)', borderRadius: 10, padding: '10px 12px', fontSize: 13, lineHeight: 1.45 }}>
      <b style={{ color: 'var(--role-color)' }}>{title}</b> {body}
    </div>
  );

  if (stop.id === 'p-briefing') {
    return shell(<>
      {h('Before you go in', 'Barbara Lowe · Fri 2:00 PM · Blacksburg')}
      {card(<>
        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--role-color)', marginBottom: 4 }}>What to know today</div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.45 }}>Early-stage dementia. Repeats questions {'—'} that{'’'}s fine, answer again. Loves the garden. No medical care: if something{'’'}s wrong, call 911.</div>
      </>)}
      {card(<>
        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--role-color)', marginBottom: 4 }}>{'💊'} Due during your visit</div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.45 }}>Evening Meds at 7 PM {'—'} remind, don{'’'}t administer. You{'’'}ll check it off as done or skipped.</div>
      </>)}
      {coach('Every visit starts here.', 'The family writes this and it changes, so read it each time. The button below takes you to check-in.')}
      {footer('On to check-in')}
    </>);
  }

  if (stop.id === 'p-checkin') {
    const pinnedMsg = pin === 'pinned' ? 'Pinned. On a real visit the family would now see “' + (firstName || 'You') + ' arrived”.'
      : pin === 'denied' ? 'Your phone said no. That’s okay for practice — for a real visit, allow location for InPlace in your phone’s settings.'
      : pin === 'unavailable' ? 'This browser can’t share location. On your phone it will.'
      : null;
    return shell(<>
      {h('Check in', 'Barbara Lowe · 2:00 PM · Blacksburg')}
      {card(<div style={{ textAlign: 'center', padding: '10px 0' }}>
        <div style={{ fontSize: 36 }}>{'📍'}</div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.45 }}>When you tap, we pin where you are {'—'} once. The family sees that you arrived, never a live track.</div>
      </div>)}
      <button onClick={askLocation} disabled={pin === 'asking' || pin === 'pinned'} style={{
        width: '100%', padding: 14, borderRadius: 10, border: 'none', font: 'inherit', fontWeight: 700, fontSize: 16, cursor: 'pointer',
        background: 'var(--color-success)', color: 'var(--text-on-primary)', opacity: pin === 'asking' ? 0.7 : 1,
      }}>{pin === 'asking' ? 'Pinning…' : pin === 'pinned' ? '✓ Checked in' : 'I’m here — check in'}</button>
      {pinnedMsg && <div style={{ fontSize: 13, color: pin === 'pinned' ? 'var(--color-success)' : 'var(--text-secondary)', lineHeight: 1.45 }}>{pinnedMsg}</div>}
      {coach('This is the button.', 'Tap it when you’re at the door. Your phone will ask to share your location — say yes; that’s what tells the family you’re there. This practice tap sends nothing.')}
      {footer(pin ? 'Next' : 'Skip this one')}
    </>);
  }

  if (stop.id === 'p-during') {
    return shell(<>
      {h('With Barbara', 'Checked in 1:58 PM · 1h 12m so far')}
      {card(<>
        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--role-color)', marginBottom: 6 }}>{'📝'} Leave a note</div>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="e.g. Walked to the mailbox and back. Ate half her lunch. Cheerful."
          style={{ width: '100%', padding: '9px 10px', borderRadius: 8, border: '1px solid var(--border-color)', font: 'inherit', fontSize: 14, background: 'var(--bg-surface)', color: 'var(--text-primary)', boxSizing: 'border-box', resize: 'vertical' }} />
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11.5, fontWeight: 600, background: 'var(--role-color-light)', color: 'var(--role-color)', borderRadius: 999, padding: '4px 10px' }}>{'📷'} Add photo</span>
          <span style={{ fontSize: 11.5, fontWeight: 600, background: 'var(--color-warning-bg)', color: 'var(--color-warning)', borderRadius: 999, padding: '4px 10px' }}>{'⚠'} Needs attention</span>
        </div>
      </>)}
      {card(<div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={() => setTaskDone(!taskDone)} aria-label="Mark the practice task done" style={{
          width: 34, height: 34, borderRadius: '50%', border: taskDone ? 'none' : '2px solid var(--color-warning)', background: taskDone ? 'var(--color-success)' : 'var(--bg-card)',
          color: 'var(--text-on-primary)', fontWeight: 800, cursor: 'pointer', flexShrink: 0,
        }}>{taskDone ? '✓' : ''}</button>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{'💊'} Evening Meds</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{taskDone ? 'Done · you' : 'Due 7:00 PM · reminder only'}</div>
        </div>
      </div>)}
      {coach('Say what you saw.', 'A note reaches the family the moment you save it; photos too. Tick the task when you’ve reminded her — it records that care happened, it never advises on medication.')}
      {footer('Next')}
    </>);
  }

  if (stop.id === 'p-checkout') {
    return shell(<>
      {h('Check out', 'Barbara Lowe · 1:58 – 5:01 PM · 3h 3m')}
      {card(<>
        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--role-color)', marginBottom: 6 }}>How was she today?</div>
        <div style={{ display: 'flex', gap: 10 }}>
          {['🙂', '😐', '😟'].map((m) => (
            <button key={m} onClick={() => setMood(m)} style={{ background: mood === m ? 'var(--role-color-light)' : 'transparent', border: mood === m ? '2px solid var(--role-color)' : '1px solid var(--border-color)', borderRadius: 10, padding: '4px 10px', cursor: 'pointer', fontSize: 24 }}>{m}</button>
          ))}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 8 }}>Anything the family should know before next time?</div>
      </>)}
      {card(<div style={{ fontSize: 13, lineHeight: 1.5 }}><b>After this:</b> the family confirms the visit, and your pay for it goes to your bank in 2{'–'}3 business days. You{'’'}ll see it under Account {'→'} Earnings.</div>, { background: 'var(--bg-highlight)', boxShadow: 'none' })}
      {coach('Last button of the visit.', 'Check out when you leave. Your time and pay come from the check-in and check-out — that’s why both matter.')}
      {footer('Check out', { kind: 'ok' })}
    </>);
  }

  // ── Where things live ──
  const cells = [
    ['🏠', 'Home', 'Your day, in order. Visits you’ve accepted and any care task due while you’re there.'],
    ['🔍', 'Find Work', 'Visits families send straight to you sit at the top. Open jobs nearby below. A weekly one is one accept.'],
    ['💬', 'Messages', 'The family and their care team. Calls live here too.'],
    ['📝', 'Care Notes', 'A family’s record of how things are going — only when they’ve shared it with you.'],
    ['👤', 'Account', 'Earnings and where they land, when you’re free, your rate, your photo — and this tour again.'],
  ];
  return shell(<>
    <div style={{ background: 'var(--bg-hero, linear-gradient(135deg,#2e5984,#1d3a57))', color: 'var(--text-on-primary)', borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ fontSize: 12, opacity: 0.85 }}>Practice visit done {'—'} nothing was recorded</div>
      <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>You know your way around.</div>
    </div>
    {card(<>
      <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>Where things live</div>
      {cells.map(([ic, t, d]) => (
        <div key={t} style={{ display: 'flex', gap: 10, padding: '9px 0', borderTop: '1px solid var(--border-color)', alignItems: 'flex-start' }}>
          <span style={{ fontSize: 20, lineHeight: 1 }}>{ic}</span>
          <div><div style={{ fontWeight: 700, fontSize: 13.5 }}>{t}</div><div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.4 }}>{d}</div></div>
        </div>
      ))}
    </>, { padding: '10px 14px' })}
    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>This list stays on your Home screen until your first real visit, and lives in Help after that.</div>
    {footer('Done', { onNext: () => finish('done') })}
  </>);
};

// ── The card on Home: the offer, then the map ──
//
// The First Steps card's last state. When the list empties this takes its place: offer the
// tour once; "Later" folds it to one line; done → the five-cell map until her first real
// check-out. Demo accounts never see it (there is nothing to practise for).
const CaregiverTourCard = window.CaregiverTourCard = ({ firstName, completedCount }) => {
  const prefs = window.__uiPrefs || {};
  const [, force] = React.useState(0);
  const done = !!prefs['tour.caregiver.done'];
  const later = !!prefs['tour.caregiver.later'];
  const start = () => { if (window.__startCaregiverTour) window.__startCaregiverTour(); };
  const setLater = () => { try { window.__setUiPref('tour.caregiver.later', true); } catch { /* ignore */ } force((n) => n + 1); };

  if (done) {
    if ((completedCount || 0) > 0) return null;
    const cells = [
      ['🏠', 'Home', 'your day'], ['🔍', 'Find Work', 'offers to you, then open jobs'],
      ['💬', 'Messages', 'the family'], ['📝', 'Care Notes', 'their record, when shared'],
      ['👤', 'Account', 'earnings, availability, rate'],
    ];
    return (
      <div data-tour="map" style={{ background: 'var(--bg-surface)', borderRadius: 14, border: '1px solid var(--border-color)', padding: '12px 16px', marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Where things live</div>
          <button onClick={start} style={{ background: 'none', border: 'none', font: 'inherit', fontSize: 12, color: 'var(--role-color)', fontWeight: 600, cursor: 'pointer' }}>Tour again</button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 6, fontSize: 12.5, color: 'var(--text-secondary)' }}>
          {cells.map(([ic, t, d]) => <span key={t}>{ic} <b style={{ color: 'var(--text-primary)' }}>{t}</b> {'—'} {d}</span>)}
        </div>
      </div>
    );
  }

  if (later) {
    return (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, background: 'var(--bg-surface)', borderRadius: 12, border: '1px solid var(--border-color)', padding: '10px 14px', marginBottom: 16, fontSize: 13 }}>
        <span style={{ color: 'var(--text-secondary)' }}>Two-minute tour of the app, whenever you like.</span>
        <button onClick={start} style={{ background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, padding: '7px 12px', font: 'inherit', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', whiteSpace: 'nowrap' }}>Show me</button>
      </div>
    );
  }

  return (
    <div className="ip-path-step" style={{ background: 'var(--bg-surface)', borderRadius: 14, border: '1.5px solid var(--role-color)', padding: '16px 18px', marginBottom: 20 }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--role-color)' }}>That{'’'}s everything{firstName ? ', ' + firstName : ''}. You{'’'}re set up.</div>
      <div style={{ fontSize: 13.5, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.45 }}>Before your first visit, want a two-minute look at where things are? It ends with a practice visit {'—'} nothing gets recorded.</div>
      <button onClick={start} style={{ width: '100%', marginTop: 12, padding: 11, background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, font: 'inherit', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Show me around</button>
      <button onClick={setLater} style={{ width: '100%', marginTop: 6, padding: 9, background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border-light)', borderRadius: 8, font: 'inherit', fontSize: 13, cursor: 'pointer' }}>Later</button>
    </div>
  );
};
