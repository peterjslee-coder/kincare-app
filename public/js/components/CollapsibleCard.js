// ─── One way to fold a section (v1.105.171) ───
//
// Pete: "make all the menus collapsible on the care team and betty pages. it should stick,
// too."
//
// Thirteen places in this client had already grown their own version of this: a `*Open`
// useState, a flex row with space-between, the card-header reused inside it, and a ▼ that
// rotates 180deg. They agreed by luck rather than by construction, none of them remembered
// anything, and each new one was a copy of whichever was nearest.
//
// So this is the shape, once. `storageKey` is what makes it stick — see js/uiPrefs.js — and
// `defaultOpen` is what somebody who has never touched this section sees, which means
// converting an existing section is a matter of passing its current default and nobody
// notices anything changed.
//
// `right` is for the buttons some headers carry (Reimbursements has four). They sit before
// the chevron and stop their own clicks, because a header that folds the section when you
// meant to press Add is worse than a header with no fold at all.
const CollapsibleCard = window.CollapsibleCard = ({
  storageKey,
  defaultOpen = true,
  icon = null,
  title,
  count = null,
  right = null,
  cardStyle = null,
  className = 'card',
  children,
}) => {
  const [open, setOpen] = useStickySection(storageKey, defaultOpen);

  return (
    <div className={className} style={cardStyle || undefined}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(!open); }
        }}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
        <div className="card-header" style={{ margin: 0, minWidth: 0 }}>
          {icon && <span className="card-icon">{icon}</span>}
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
          {count !== null && count !== undefined && count !== 0 && (
            <span style={{
              marginLeft: 8, fontSize: 12, fontWeight: 600, color: 'var(--role-color)',
              background: 'var(--bg-teal-light)', padding: '2px 8px', borderRadius: 10, flexShrink: 0,
            }}>{count}</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {/* A collapsed section's actions are actions on something you cannot see, so they
              go away with it. The chevron never does. */}
          {open && right ? <span onClick={(e) => e.stopPropagation()}>{right}</span> : null}
          <span aria-hidden="true" style={{
            fontSize: 18, color: 'var(--text-muted)',
            transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'rotate(0)',
          }}>{'▼'}</span>
        </div>
      </div>
      {open && <div style={{ marginTop: 14 }}>{children}</div>}
    </div>
  );
};
