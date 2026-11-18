// ─── The + (v1.133.0) ───────────────────────────────────────────────────────
//
// Pete, 11/18 (feedback 7e187fb2): "I need it to be easier to put Events on Betty's calendar.
// Right now I have to go to care team scroll down and find it... I would love a expanding plus
// log visit/event thing. It has to work on mobile primarily." Then, choosing between mockups:
// "I want to be able to add wherever I am, and don't mind losing caregivers."
//
// So the phone's bottom bar is Home · Loved One · (+) · Messages · Account, and the + fans out
// four choices: Log visit · Add event · Message <name> · Request care. The desktop sidebar's
// orange action opens the same menu. Each choice opens what already exists — nothing here is a
// second copy of a form:
//   Log visit    → LogVisitSheet (FamilyVisitLog.js), over the current screen
//   Add event    → CareEventFormModal (CareEvents.js), over the current screen, iPAi fill-in kept
//   Message Betty → her simple-screen Text group in Messages (only when that is on and you are in it)
//   Request care → the Schedule page, like the old "+ Request Care"
//
// What each person may do comes from GET /api/care-recipients/quick-add, so the menu never
// offers something the server would refuse. Mounted ONCE at the app root (app.js), family only.
// Opened with window.__openQuickAdd(anchorRect) — the anchor is the + button, so the fan grows
// out of it; with no anchor near the bottom of the screen (the sidebar) it grows from the
// bottom centre.
//
// Layering: above the bottom bar (900), below modals (1000+), so the sheets it opens cover it.

const QUICK_ADD_Z = 950;

const QuickAddIcon = ({ kind, size = 24 }) => {
  const p = {
    visit: <><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" /><path d="m8.5 14 2.5 2.5 4.5-5" /></>,
    event: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4M12 13v5M9.5 15.5h5" /></>,
    request: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5 1.4 0 2.6.4 3.6 1.1" /><path d="M18 13v7M14.5 16.5h7" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    close: <path d="M6 6l12 12M18 6 6 18" />,
  }[kind];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={kind === 'plus' || kind === 'close' ? 2.4 : 2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{p}</svg>
  );
};

// Offsets from the + centre, by how many choices there are. Chosen so the lowest labels sit
// well clear of the bottom bar (Pete: the text must "not underlap the bottom border").
const QUICK_ADD_LAYOUT = {
  4: [[-135, -112], [-55, -207], [55, -207], [135, -112]],
  3: [[-118, -112], [0, -200], [118, -112]],
  2: [[-72, -140], [72, -140]],
  1: [[0, -140]],
};

const QuickAdd = window.QuickAdd = () => {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState(null);
  const [recipients, setRecipients] = useState(null);
  const [selectedId, setSelectedId] = useState(() => {
    try { return localStorage.getItem('inplace.quickAdd.recipient') || null; } catch { return null; }
  });
  const [sheet, setSheet] = useState(null); // 'visit' | 'event'
  const [sheetFor, setSheetFor] = useState(null);

  const load = async () => {
    try {
      const res = await apiFetch('/api/care-recipients/quick-add');
      if (res?.ok) {
        const d = await res.json();
        setRecipients(Array.isArray(d.recipients) ? d.recipients : []);
      }
    } catch { /* the menu still offers Request care */ }
  };

  useEffect(() => {
    load();
    window.__openQuickAdd = (rect) => {
      setAnchor(rect || null);
      setOpen(true);
      load();
    };
    return () => { delete window.__openQuickAdd; };
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const list = recipients || [];
  const selected = list.find((r) => r.id === selectedId) || list[0] || null;
  const name = selected ? (selected.firstName || 'them') : null;

  const pick = (id) => {
    setSelectedId(id);
    try { localStorage.setItem('inplace.quickAdd.recipient', id); } catch { /* remembered for this visit only */ }
  };

  const done = () => {
    try { window.dispatchEvent(new CustomEvent('inplace:quick-added')); } catch { /* the page refreshes on its own */ }
  };

  const items = [];
  if (selected) {
    items.push({ key: 'visit', label: 'Log visit', icon: 'visit', run: () => { setSheetFor(selected); setSheet('visit'); setOpen(false); } });
    if (selected.canAddEvent) {
      items.push({ key: 'event', label: 'Add event', icon: 'event', run: () => { setSheetFor(selected); setSheet('event'); setOpen(false); } });
    }
    if (selected.messageConversationId) {
      items.push({
        key: 'message', label: `Message ${name}`, face: true,
        run: () => {
          setOpen(false);
          const id = selected.messageConversationId;
          window.__pendingConversation = id;
          try { window.dispatchEvent(new CustomEvent('inplace:open-conversation', { detail: { conversationId: id } })); } catch { /* the page read below opens it */ }
          if (window.__navigateTo) window.__navigateTo('messages');
        },
      });
    }
  }
  items.push({
    key: 'request', label: 'Request care', icon: 'request', accent: true,
    run: () => { setOpen(false); if (window.__navigateTo) window.__navigateTo('schedule'); },
  });

  // Where the fan grows from.
  const vw = typeof window !== 'undefined' ? window.innerWidth : 390;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 844;
  const fromBar = anchor && anchor.top > vh * 0.6;
  const cx = fromBar ? anchor.left + anchor.width / 2 : vw / 2;
  const cy = fromBar ? anchor.top + anchor.height / 2 : vh - 64;
  const layout = QUICK_ADD_LAYOUT[Math.min(items.length, 4)] || QUICK_ADD_LAYOUT[4];
  const clampX = (x) => Math.max(62, Math.min(vw - 62, x));
  const headTop = cy + (items.length >= 3 ? -300 : -240);

  const initial = (n) => String(n || '?').trim().charAt(0).toUpperCase();

  return (
    <>
      {open && (
        <div role="dialog" aria-modal="true" aria-label={name ? `Add for ${name}` : 'Add'} data-testid="quick-add"
          style={{ position: 'fixed', inset: 0, zIndex: QUICK_ADD_Z }}>
          <button aria-label="Close" onClick={() => setOpen(false)}
            style={{ position: 'absolute', inset: 0, border: 'none', padding: 0, margin: 0, background: 'rgba(15, 30, 27, 0.6)', cursor: 'pointer' }} />

          {/* Who it is for. One person: a heading. Several: pick, remembered for next time. */}
          <div style={{ position: 'absolute', left: 12, right: 12, top: Math.max(12, headTop), display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 8, pointerEvents: 'none' }}>
            {list.length > 1 ? list.map((r) => {
              const on = selected && r.id === selected.id;
              return (
                <button key={r.id} onClick={() => pick(r.id)} aria-pressed={!!on}
                  style={{
                    pointerEvents: 'auto', minHeight: 44, padding: '6px 16px', borderRadius: 22, cursor: 'pointer',
                    border: on ? '2px solid #ffffff' : '2px solid rgba(255,255,255,0.5)',
                    background: on ? '#ffffff' : 'rgba(15,30,27,0.75)', color: on ? 'var(--text-primary)' : '#ffffff',
                    fontSize: 15, fontWeight: 700, fontFamily: 'inherit',
                  }}>{r.firstName}</button>
              );
            }) : (
              <span style={{ color: '#ffffff', fontSize: 15, fontWeight: 700, background: 'rgba(15,30,27,0.75)', padding: '6px 14px', borderRadius: 20 }}>
                {name ? `Add for ${name}` : 'Add'}
              </span>
            )}
          </div>

          {items.map((it, i) => {
            const [dx, dy] = layout[i] || [0, -140];
            const x = clampX(cx + dx);
            const y = cy + dy;
            return (
              <button key={it.key} onClick={it.run} data-testid={`quick-add-${it.key}`}
                style={{
                  position: 'absolute', left: x - 64, top: y - 28, width: 128, border: 'none', background: 'none', padding: 0,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, cursor: 'pointer', fontFamily: 'inherit',
                }}>
                {it.face ? (
                  <span aria-hidden="true" style={{
                    width: 56, height: 56, boxSizing: 'border-box', borderRadius: 28, border: '3px solid #ffffff', overflow: 'hidden',
                    background: 'var(--role-color-light)', color: 'var(--role-color-dark)', fontSize: 22, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 10px rgba(0,0,0,0.25)',
                  }}>
                    {selected && selected.photo
                      ? <img src={selected.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : initial(name)}
                  </span>
                ) : (
                  <span aria-hidden="true" style={{
                    width: 56, height: 56, borderRadius: 28, background: '#ffffff',
                    color: it.accent ? 'var(--accent-color-dark)' : 'var(--role-color)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 10px rgba(0,0,0,0.25)',
                  }}><QuickAddIcon kind={it.icon} /></span>
                )}
                <span style={{ background: '#ffffff', color: '#1f2a28', fontSize: 14, fontWeight: 700, padding: '5px 10px', borderRadius: 8, whiteSpace: 'nowrap', maxWidth: 124, overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.label}</span>
              </button>
            );
          })}

          {/* The × sits exactly where the + was. */}
          <button aria-label="Close add menu" onClick={() => setOpen(false)} data-testid="quick-add-close"
            style={{
              position: 'absolute', left: cx - 30, top: cy - 30, width: 60, height: 60, boxSizing: 'border-box', borderRadius: 30,
              border: '4px solid #ffffff', background: 'var(--role-color)', color: '#ffffff', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(15,66,56,0.35)', padding: 0,
            }}><QuickAddIcon kind="close" /></button>
        </div>
      )}

      {sheet === 'visit' && sheetFor && typeof LogVisitSheet !== 'undefined' && (
        <LogVisitSheet recipients={[sheetFor]} presetRecipientId={sheetFor.id} position={null}
          onClose={() => { setSheet(null); setSheetFor(null); }}
          onSaved={() => done()} />
      )}
      {sheet === 'event' && sheetFor && typeof CareEventFormModal !== 'undefined' && (
        <CareEventFormModal recipientId={sheetFor.id} recipientFirstName={sheetFor.firstName}
          timezone={sheetFor.timezone} existing={null}
          savedMessage={sheetFor.firstName ? `Added to ${sheetFor.firstName}'s calendar` : 'Event added'}
          onClose={() => { setSheet(null); setSheetFor(null); }}
          onSaved={() => done()} />
      )}
    </>
  );
};

// The bar's own + button. A real <button>, 44px+ target, raised above the bar.
const QuickAddButton = window.QuickAddButton = () => (
  <div className="bottom-nav-item quick-add-slot" style={{ position: 'relative' }}>
    <button type="button" aria-label="Add" data-testid="nav-quick-add" data-tour="nav-quick-add"
      onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); if (window.__openQuickAdd) window.__openQuickAdd(r); }}
      style={{
        marginTop: -30, width: 58, height: 58, boxSizing: 'border-box', borderRadius: 29, border: '4px solid var(--bg-surface)',
        background: 'var(--role-color)', color: '#ffffff', cursor: 'pointer', padding: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(15,66,56,0.35)',
      }}><QuickAddIcon kind="plus" size={26} /></button>
  </div>
);
