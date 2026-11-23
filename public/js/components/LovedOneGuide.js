// ─── Betty's page, regrouped (v1.121.0, Batch 2 step 1) ───
//
// Pete, 10/15 (feedback a747e1cb): "I find myself constantly clicking on the wrong section of
// the care team or Betty's. Like where is reimbursements versus where are care tasks versus
// where are care notes… We need to figure out a way to make it more intuitive." And later:
// "get rid of the folded page where you gotta read everything to figure out where to go."
//
// He picked the shape after two mockups: ONE page you scroll (no tabs, no new navigation
// anywhere else in the app), in his order, with a bar on top that follows you as you scroll
// and jumps when tapped:
//
//   Betty · To do · Notes · Calendar · Money & legal · About
//
// The bar is a guide, not a gate: every section stays on the page. Jumping to a section
// unfolds its folded cards for this visit only — useStickySection's `remember: false`, the
// same rule a push notification follows — so the folding Pete chose himself is not rewritten
// because he tapped a shortcut.

const LOVED_ONE_GUIDE_TOP = 0;

/** One labeled stop on the page. The id is what the bar and deep links aim at. */
const LovedOneSection = window.LovedOneSection = ({ id, label, hideLabel, children }) => (
  <section id={`lo-${id}`} data-lo-section={id} aria-label={label}
    style={{ scrollMarginTop: 60, display: 'flex', flexDirection: 'column' }}>
    {/* `hideLabel` for the first stop: the person's card right under the bar already says who. */}
    {!hideLabel && (
      <div style={{
        fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase',
        color: 'var(--text-tertiary)', margin: '18px 2px 8px',
      }}>{label}</div>
    )}
    {children}
  </section>
);

/**
 * The sticky bar. `sections` = [{ id, label, openKeys: [useStickySection keys], dot }].
 * Scroll-spy uses an IntersectionObserver against the viewport, which works whether the page
 * scrolls in .main-content (desktop) or the document (some phone layouts).
 */
const LovedOneGuideBar = window.LovedOneGuideBar = ({ sections }) => {
  const [active, setActive] = React.useState(sections[0] && sections[0].id);
  const barRef = React.useRef(null);
  const jumpingRef = React.useRef(false);
  const ids = sections.map((s) => s.id).join('|');

  React.useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const els = sections.map((s) => document.getElementById(`lo-${s.id}`)).filter(Boolean);
    if (!els.length) return undefined;
    const visible = new Map();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) visible.set(e.target.dataset.loSection, e.isIntersecting ? e.boundingClientRect.top : null);
      if (jumpingRef.current) return;
      // The section whose top is nearest the bar, among those on screen.
      let best = null, bestTop = Infinity;
      for (const s of sections) {
        const top = visible.get(s.id);
        if (top !== null && top !== undefined && Math.abs(top) < bestTop) { best = s.id; bestTop = Math.abs(top); }
      }
      if (best) setActive(best);
    }, { rootMargin: '-56px 0px -55% 0px', threshold: [0, 0.01] });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [ids]);

  // Keep the active chip in view on narrow screens.
  React.useEffect(() => {
    const chip = barRef.current && barRef.current.querySelector(`[data-lo-chip="${active}"]`);
    if (chip && chip.scrollIntoView) {
      try { chip.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch { /* old Safari */ }
    }
  }, [active]);

  const jump = (s) => {
    setActive(s.id);
    jumpingRef.current = true;
    if (s.openKeys && s.openKeys.length) {
      window.dispatchEvent(new CustomEvent('inplace:open-section', { detail: { keys: s.openKeys } }));
    }
    // After the unfold has rendered, so the target's position is final.
    setTimeout(() => {
      const el = document.getElementById(`lo-${s.id}`);
      // Instant, not smooth: on staging a smooth scroll was cancelled by the unfold re-render
      // and the page never moved while the chip lit up. A jump that lands beats a pretty one.
      if (el) el.scrollIntoView({ block: 'start' });
      setTimeout(() => { jumpingRef.current = false; }, 700);
    }, 30);
  };

  // Arriving with a section to open (from the Care Team page's link) — jump once it's drawn.
  React.useEffect(() => {
    const want = lovedOneSectionFocus();
    const s = want && sections.find((x) => x.id === want);
    if (s) setTimeout(() => jump(s), 400);
  }, [ids]);

  return (
    <nav ref={barRef} aria-label="Sections of this page" data-testid="loved-one-guide"
      style={{
        position: 'sticky', top: LOVED_ONE_GUIDE_TOP, zIndex: 5,
        display: 'flex', gap: 6, overflowX: 'auto', scrollbarWidth: 'none',
        padding: '8px 2px', margin: '0 -2px 4px',
        background: 'var(--bg-primary)', borderBottom: '1px solid var(--border-light)',
      }}>
      {sections.map((s) => {
        const on = s.id === active;
        return (
          <button key={s.id} type="button" data-lo-chip={s.id} onClick={() => jump(s)}
            aria-current={on ? 'true' : undefined}
            style={{
              position: 'relative', flex: 'none', minHeight: 36, padding: '6px 14px',
              borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
              border: on ? '1.5px solid var(--role-color)' : '1px solid var(--border-color)',
              background: on ? 'var(--role-color)' : 'var(--bg-card)',
              color: on ? 'var(--text-on-primary)' : 'var(--text-secondary)',
            }}>
            {s.label}
            {s.dot && (
              <span aria-label="needs you" style={{
                position: 'absolute', top: -2, right: -2, width: 9, height: 9, borderRadius: '50%',
                background: 'var(--accent-color)', border: '2px solid var(--bg-primary)',
              }} />
            )}
          </button>
        );
      })}
    </nav>
  );
};

// ─── v1.121.0 (Batch 2 step 4) — reimbursements live on the loved one's page ───
//
// Pete's grouping puts money with the person it was spent on: "money, legal, and readiness".
// The ledger moved from the Care Team page into Money & legal. Every push, Needs-you card and
// in-app notification already sent says page "care-team" + focus "reimbursement:<id>", and
// phones hold those for days — so instead of trusting every sender to be updated, every
// place that turns a tap into a page asks this first. Families only: the Care Team page and
// Betty's page are both family pages, and anyone else keeps whatever they had.
const lovedOneRoute = window.lovedOneRoute = (page, focus, careTeamId) => {
  if (page !== 'care-team') return page;
  // reimbursement:<id> for one request; schedule:<id> for a monthly series.
  if (typeof focus !== 'string' || !(focus.startsWith('reimbursement:') || focus.startsWith('schedule:'))) return page;
  if ((window.__currentRole || 'family') !== 'family') return page;
  if (careTeamId) window.__pendingLovedOneTeamId = careTeamId;
  return 'care-profile';
};

/**
 * Which loved one should Betty's page open on? Normally the first. After a reimbursement
 * deep link, the one whose team that reimbursement belongs to — by team id when the tap
 * carried one, else by finding the reimbursement in the user's teams (one or two, usually).
 */
const pickLovedOne = window.pickLovedOne = async (recipients) => {
  const list = recipients || [];
  if (list.length < 2) { window.__pendingLovedOneTeamId = null; return list[0] || null; }
  const focus = typeof window.__pendingFocus === 'string' ? window.__pendingFocus : '';
  const wantTeam = window.__pendingLovedOneTeamId;
  window.__pendingLovedOneTeamId = null;
  if (!wantTeam && !focus.startsWith('reimbursement:')) return list[0];
  try {
    const r = await apiFetch('/api/care-teams');
    const teams = r && r.ok ? ((await r.json()).careTeams || []) : [];
    let team = wantTeam ? teams.find((t) => t.id === wantTeam) : null;
    if (!team && focus.startsWith('reimbursement:')) {
      const rid = focus.slice('reimbursement:'.length);
      for (const t of teams) {
        const rr = await apiFetch(`/api/reimbursements/team/${t.id}`);
        const d = rr && rr.ok ? await rr.json() : null;
        if (d && (d.reimbursements || []).some((x) => x.id === rid)) { team = t; break; }
      }
    }
    return (team && list.find((x) => x.id === team.care_recipient_id)) || list[0];
  } catch { return list[0]; }
};

/** The ledger for this loved one's care team, inside Money & legal. */
const LovedOneReimbursements = window.LovedOneReimbursements = ({ recipientId }) => {
  const [team, setTeam] = React.useState(null);
  React.useEffect(() => {
    let live = true;
    setTeam(null);
    (async () => {
      try {
        const r = await apiFetch('/api/care-teams');
        if (!r || !r.ok) return;
        const t = ((await r.json()).careTeams || []).find((x) => x.care_recipient_id === recipientId);
        if (!t) return;
        const r2 = await apiFetch(`/api/care-teams/${t.id}`);
        if (!r2 || !r2.ok) return;
        const d = await r2.json();
        if (live) setTeam(d.careTeam);
      } catch { /* the rest of the page stands without it */ }
    })();
    return () => { live = false; };
  }, [recipientId]);
  if (!team || typeof Reimbursements === 'undefined') return null;
  return <Reimbursements careTeamId={team.id} members={team.members || []} myUserId={team.myUserId} />;
};

// A jump that arrives from another page (the Care Team page's "Reimbursements →" link):
// window.__pendingFocus = 'lovedOne:money'. Consumed by the bar once its sections exist.
const lovedOneSectionFocus = () => {
  const f = window.__pendingFocus;
  if (typeof f !== 'string' || !f.startsWith('lovedOne:')) return null;
  window.__pendingFocus = null;
  return f.slice('lovedOne:'.length);
};

// ─── v1.121.0 (Batch 2 step 5) — Calendar: the loved one's visits, by when ───
//
// Pete: "calendar that shows upcoming stuff inside 24 hours, week, and recent (with the
// +orange request care button)" — and the same sense of priority as Home: the next thing
// first. Appointments (CareEventsSection) stay below with their own add/edit.
//
// Times are care-location times (CLAUDE.md): a visit's start is built in the loved one's zone
// with TimezoneHelper.buildDateTime, which on the client returns the true instant, and is
// compared with the real clock.
const LOVED_ONE_UPCOMING = new Set(['requested', 'open', 'pending', 'confirmed', 'in_progress']);
const LOVED_ONE_DAY_MS = 24 * 60 * 60 * 1000;
const LOVED_ONE_WEEK_SHOWN = 4; // the page is a summary; Schedule has the rest

const lovedOneShiftDate = (dateStr, days) => {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + days * LOVED_ONE_DAY_MS);
  return t.toISOString().slice(0, 10); // a UTC-midnight date shifted by whole days: safe here
};

/** Pure: sessions → { next24, week, recent } for one loved one. `startOf(s)` gives the instant. */
const lovedOneVisitBuckets = window.lovedOneVisitBuckets = (sessions, recipientId, nowMs, startOf) => {
  const next24 = [], week = [], recent = [];
  for (const s of sessions || []) {
    if (s.care_recipient_id !== recipientId) continue;
    const start = startOf(s);
    const end = Number.isFinite(start) ? start + (Number(s.duration_hours) || 0) * 3600e3 : NaN;
    if (s.status === 'completed') {
      if (Number.isFinite(start) && nowMs - start <= 7 * LOVED_ONE_DAY_MS) recent.push({ s, start });
      continue;
    }
    if (!LOVED_ONE_UPCOMING.has(s.status)) continue; // cancelled, declined, expired, no-show
    // Under way now, or starts within a day → the top. One whose time has fully passed is not
    // "next" — staging showed yesterday's visit under "Next 24 hours". A visit nobody checked
    // out of is Home's Needs-you job, not the calendar's.
    if (s.status === 'in_progress' || !Number.isFinite(start) || start - nowMs <= LOVED_ONE_DAY_MS) {
      if (s.status !== 'in_progress' && Number.isFinite(end) && end <= nowMs) continue;
      next24.push({ s, start });
    } else if (start - nowMs <= 7 * LOVED_ONE_DAY_MS) week.push({ s, start });
  }
  const asc = (a, b) => (a.start || 0) - (b.start || 0);
  return { next24: next24.sort(asc), week: week.sort(asc), recent: recent.sort((a, b) => b.start - a.start).slice(0, 3) };
};

const LovedOneVisits = window.LovedOneVisits = ({ recipientId, recipientFirstName, timezone, onNavigate }) => {
  const [sessions, setSessions] = React.useState(null);
  const [openId, setOpenId] = React.useState(null);
  const tz = timezone || TimezoneHelper.DEFAULT_TZ;

  const load = React.useCallback(async () => {
    const today = TimezoneHelper.getToday(tz);
    try {
      const r = await apiFetch(`/api/sessions?from=${lovedOneShiftDate(today, -7)}&to=${lovedOneShiftDate(today, 8)}&limit=200`);
      if (r && r.ok) setSessions((await r.json()).sessions || []);
      else setSessions((prev) => prev || []);
    } catch { setSessions((prev) => prev || []); }
  }, [recipientId, tz]);
  React.useEffect(() => { load(); }, [load]);

  if (sessions === null) return null;
  const startOf = (s) => {
    try { return TimezoneHelper.buildDateTime(s.scheduled_date, s.scheduled_time, tz).getTime(); } catch { return NaN; }
  };
  const { next24, week, recent } = lovedOneVisitBuckets(sessions, recipientId, TimezoneHelper.realNowMs(), startOf);
  const name = recipientFirstName || 'them';

  const statusChip = (s) => {
    const c = s.status === 'in_progress' ? { t: 'Happening now', fg: 'var(--color-success)' }
      : s.status === 'confirmed' ? null
      : s.status === 'completed' ? null
      : { t: s.caregiver_name ? 'Waiting to confirm' : 'Looking for a caregiver', fg: 'var(--color-warning)' };
    return c ? <span style={{ fontSize: 11, fontWeight: 700, color: c.fg, marginLeft: 6 }}>· {c.t}</span> : null;
  };
  const row = ({ s }) => {
    const who = s.caregiver_name ? s.caregiver_name.split(' ')[0] : null;
    const hrs = Number(s.duration_hours) || 0;
    return (
      <button key={s.id} type="button" data-visit-id={s.id} onClick={() => setOpenId(s.id)}
        style={{ display: 'flex', width: '100%', textAlign: 'left', alignItems: 'center', gap: 12, minHeight: 48,
          padding: '10px 4px', border: 'none', borderTop: '1px solid var(--border-light)', background: 'none', cursor: 'pointer' }}>
        <div style={{ width: 64, flexShrink: 0, fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>
          {TimezoneHelper.getDateLabel(s.scheduled_date, tz)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
            {TimezoneHelper.formatTime(s.scheduled_time)}{hrs ? ` · ${hrs % 1 ? hrs.toFixed(1) : hrs} hr${hrs === 1 ? '' : 's'}` : ''}
            {statusChip(s)}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
            {who ? `with ${who}` : 'No caregiver yet'}
          </div>
        </div>
        <span style={{ fontSize: 18, color: 'var(--text-muted)' }}>›</span>
      </button>
    );
  };
  const heading = (t, testid) => (
    <div data-testid={testid} style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '12px 2px 4px' }}>{t}</div>
  );

  return (
    <div className="card" data-testid="loved-one-visits" style={{ paddingTop: 6 }}>
      {heading('Next 24 hours', 'visits-next24')}
      {next24.length ? next24.map(row) : (
        <div style={{ fontSize: 13, color: 'var(--text-tertiary)', padding: '2px 2px 6px' }}>No visits for {name} in the next 24 hours.</div>
      )}
      {week.length > 0 && (<>{heading('This week', 'visits-week')}{week.slice(0, LOVED_ONE_WEEK_SHOWN).map(row)}
        {week.length > LOVED_ONE_WEEK_SHOWN && (
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', padding: '6px 2px 0' }}>
            +{week.length - LOVED_ONE_WEEK_SHOWN} more this week on the full schedule
          </div>
        )}</>)}
      {recent.length > 0 && (<>{heading('Recent', 'visits-recent')}{recent.map(row)}</>)}
      {onNavigate && (
        <button type="button" onClick={() => onNavigate('schedule')}
          style={{ marginTop: 8, padding: '8px 2px', minHeight: 40, border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, color: 'var(--role-color)' }}>
          Full schedule ›
        </button>
      )}
      {openId && typeof VisitDetailModal !== 'undefined' && (
        <VisitDetailModal sessionId={openId} role="family" onClose={() => setOpenId(null)} onRefresh={load} />
      )}
    </div>
  );
};
