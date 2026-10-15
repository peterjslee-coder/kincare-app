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
