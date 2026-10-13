// ─── Care tools come with booked care (v1.114.0) ─────────────────────────
//
// Pete, 10/13: "unless they are scheduling/paying care on app, they don't get to use all the
// features. ... I hate the 'unlock for premium features' crap on a lot of sites, but the
// software IS the hook."
//
// So this is not an upsell screen. It opens only when someone actually tries a care tool while
// theirs are off (the server answers 403 CARE_TOOLS_LOCKED; utils.js apiFetch announces it as
// `inplace:care-tools-locked`). It says plainly what the tools come with, what is always free,
// and that nothing they already entered is going anywhere. No banner, no badge, no countdown.
//
// Mounted ONCE at the app root (app.js), like CancelFeeSheet.

const careToolsMoney = (cents) => {
  const d = Math.ceil((Number(cents) || 0) / 100);
  return `$${d.toLocaleString('en-US')}`;
};

const CareToolsSheet = window.CareToolsSheet = () => {
  const [info, setInfo] = useState(null);

  useEffect(() => {
    let last = 0;
    const onLocked = (e) => {
      const now = Date.now();
      if (now - last < 1500) return; // one screen firing three requests is one sheet
      last = now;
      setInfo((e && e.detail) || {});
    };
    window.addEventListener('inplace:care-tools-locked', onLocked);
    return () => window.removeEventListener('inplace:care-tools-locked', onLocked);
  }, []);

  if (!info) return null;
  const close = () => setInfo(null);
  const book = () => {
    close();
    if (typeof window.__openRequestCareModal === 'function') window.__openRequestCareModal();
  };
  const need = Number(info.careNeededCents) || 0;
  const days = Number(info.windowDays) || 30;

  return (
    <div onClick={close} data-testid="care-tools-sheet" style={{
      // 1300: above the install banner and the demo bar (1200), which otherwise cover the buttons.
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1300,
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Care tools" style={{
        background: 'var(--bg-card)', width: '100%', maxWidth: 520, borderRadius: '16px 16px 0 0',
        padding: '20px 20px', paddingBottom: `calc(20px + ${window.__safeAreaBottom || 0}px)`,
        maxHeight: '90vh', overflowY: 'auto', boxSizing: 'border-box',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>
            {info.featureName ? `${info.featureName} come with booked care` : 'This comes with booked care'}
          </div>
          <button onClick={close} aria-label="Close" style={{
            minWidth: 44, minHeight: 44, background: 'none', border: 'none', fontSize: 22,
            color: 'var(--text-tertiary)', cursor: 'pointer',
          }}>{'×'}</button>
        </div>

        <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.55, margin: '6px 0 12px' }}>
          InPlace’s care tools — care notes, tasks, the care calendar, to-dos, reimbursements,
          hours reports, video calls and iPAi — are included when your family books care through InPlace.
          {need > 0
            ? ` Book about ${careToolsMoney(need)} of care in a ${days}-day stretch and they turn on for everyone on your team.`
            : ' Book a visit through InPlace and they turn on for everyone on your team.'}
        </p>

        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, background: 'var(--bg-surface)',
          border: '1px solid var(--border-color)', borderRadius: 10, padding: '10px 12px', marginBottom: 14 }}>
          <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>Always free</div>
          Messages, the visit log, medication reminders, medical records and legal documents.
          Everything you’ve already added stays right where it is for you to see.
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={book} style={{
            flex: '1 1 160px', minHeight: 44, borderRadius: 10, border: 'none', background: 'var(--role-color)',
            color: 'var(--text-on-primary)', fontSize: 15, fontWeight: 700, cursor: 'pointer',
          }}>Book care</button>
          <button onClick={close} style={{
            flex: '1 1 120px', minHeight: 44, borderRadius: 10, border: '1px solid var(--border-color)',
            background: 'var(--bg-surface)', color: 'var(--text-secondary)', fontSize: 15, cursor: 'pointer',
          }}>Not now</button>
        </div>
      </div>
    </div>
  );
};
