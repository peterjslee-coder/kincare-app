// ─── What's New (v1.112.4) ───
//
// Pete, 10/13: "can we do a 'what's new' splash screen on the app for recent changes? … I would
// want it to have a quick screenshot of what's new and how to use it like 'for tasks that need to
// be done, like water Kitchen plant or change litter out next time'."
//
// The entries come from the server (src/whatsNew/entries.js — the one place a release announces
// itself). This file draws them: one card per entry, a small picture of the feature, the steps,
// and a few examples in the family's own words.
//
// The "screenshot" is drawn, not a PNG: the same colours and shapes as the real screen, filled
// with made-up content. A real screenshot would either show a real person's care data or go stale
// the first time the screen is restyled; this does neither, and it follows dark mode.
//
// Shown once per entry, after the legal gate and never over the ID gate. Help → "What's new"
// opens everything from the last few weeks again.

const WN_EXAMPLE_TAG = {
  position: 'absolute', top: 8, right: 8, padding: '2px 8px', borderRadius: 10,
  background: 'var(--bg-neutral)', color: 'var(--text-tertiary)', fontSize: 10, fontWeight: 700,
  letterSpacing: 0.4, textTransform: 'uppercase',
};
const wnCard = { padding: '10px 12px', marginBottom: 6, borderRadius: 10, border: '1px solid var(--border-color)', background: 'var(--bg-card)' };
const wnHead = { fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '2px 2px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' };
const wnPill = (bg, fg) => ({ padding: '4px 10px', borderRadius: 8, background: bg, color: fg, fontSize: 11, fontWeight: 700 });

const WN_PREVIEWS = {
  todos: () => (
    <div>
      <div style={wnHead}>
        <span>{'📌'} To-dos for the next visit (2) {'▲'}</span>
        <span style={wnPill('var(--bg-teal-light)', 'var(--role-color)')}>+ Add to-do</span>
      </div>
      {['Water the kitchen plant', 'Change the litter next time'].map((t, i) => (
        <div key={t} style={wnCard}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>{t}</div>
          <div style={{ fontSize: 10.5, color: 'var(--text-tertiary)', marginTop: 2 }}>Added by Sam {'·'} {i ? 'Oct 12' : 'today'}</div>
          <div style={{ ...wnPill('var(--accent-color-dark)', 'var(--text-on-primary)'), marginTop: 6, textAlign: 'center' }}>{'✓'} I did this</div>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', padding: '4px 2px', fontSize: 12 }}>
        <span style={{ color: 'var(--role-color)', fontWeight: 700 }}>{'✓'}</span>
        <span style={{ color: 'var(--text-secondary)', textDecoration: 'line-through' }}>Lock the stove against the wall</span>
        <span style={{ color: 'var(--text-tertiary)', fontSize: 10.5 }}>{'·'} Jane</span>
      </div>
    </div>
  ),
  foldedBar: () => (
    <div>
      <div className="care-todo-folded" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 40,
        padding: '0 12px', borderRadius: 10, background: 'var(--color-info-bg)', borderLeft: '4px solid var(--color-info)', marginBottom: 8 }}>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>{'📌'} To-do list {'·'} 3 items</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>Show {'▾'}</span>
      </div>
      <div style={{ textAlign: 'center', fontSize: 14, color: 'var(--text-tertiary)', margin: '-2px 0 4px' }}>{'↓'} tap</div>
      {['Water the kitchen plant', 'Change the litter next time'].map((t) => (
        <div key={t} style={{ ...wnCard, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{t}</span>
          <span style={wnPill('var(--accent-color-dark)', 'var(--text-on-primary)')}>{'✓'} I did this</span>
        </div>
      ))}
    </div>
  ),
  arrival: () => (
    <div style={{ padding: '12px 12px 10px', borderRadius: 12, border: '1.5px solid var(--role-color)', background: 'var(--color-success-bg)' }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>Looks like you{'’'}re with Mom</div>
      <div style={{ ...wnHead, margin: '0 0 6px' }}><span>{'📌'} Waiting at Mom{'’'}s (2)</span></div>
      {['Water the kitchen plant', 'Change the litter next time'].map((t) => (
        <div key={t} style={{ ...wnCard, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{t}</span>
          <span style={wnPill('var(--accent-color-dark)', 'var(--text-on-primary)')}>{'✓'} I did this</span>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <span style={wnPill('var(--role-color)', 'var(--text-on-primary)')}>Log this visit</span>
        <span style={wnPill('var(--bg-card)', 'var(--text-secondary)')}>Not now</span>
      </div>
    </div>
  ),
  handoff: () => (
    <div>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{'💊'} Evening meds</div>
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', margin: '2px 0 8px' }}>Today at 5:00 PM {'·'} for Mom</div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <span style={{ ...wnPill('var(--color-success)', 'var(--text-on-primary)'), flex: 1, textAlign: 'center' }}>{'✓'} Taken</span>
        <span style={wnPill('var(--bg-card)', 'var(--text-secondary)')}>Skip today</span>
      </div>
      <div style={{ ...wnHead, margin: '0 0 6px' }}><span>Not done yet? Hand it to{'…'}</span></div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <span style={wnPill('var(--role-color-light)', 'var(--role-color)')}>Jane D.</span>
        <span style={wnPill('var(--bg-card)', 'var(--text-secondary)')}>Sam R.</span>
      </div>
      <div style={{ ...wnPill('var(--role-color-light)', 'var(--role-color)'), textAlign: 'center', border: '1.5px solid var(--role-color)' }}>Hand this task to Jane {'—'} not completed</div>
    </div>
  ),
  documents: () => (
    <div>
      <div style={wnHead}><span>{'📁'} Documents Center</span><span style={wnPill('var(--bg-teal-light)', 'var(--role-color)')}>+ Upload</span></div>
      {[['🩺', 'Cardiology visit summary', 'Medical · Sep 30'], ['💊', 'Medication list', 'Medical · Oct 2'], ['📜', 'Durable power of attorney', 'Legal · shared with team']].map(([ic, t, s]) => (
        <div key={t} style={{ ...wnCard, display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 18 }}>{ic}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{t}</div>
            <div style={{ fontSize: 10.5, color: 'var(--text-tertiary)' }}>{s}</div>
          </div>
          <span aria-hidden="true" style={{ fontSize: 13 }}>{'🔒'}</span>
        </div>
      ))}
      <div style={{ ...wnCard, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-neutral)' }}>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>iPAi key {'·'} held by you</span>
        <span style={wnPill('var(--role-color-light)', 'var(--role-color)')}>On</span>
      </div>
    </div>
  ),
  readiness: () => (
    <div>
      <div style={wnHead}><span>{'⚖️'} Legal & money readiness</span></div>
      {[['Durable power of attorney', 'In place · agent: Jane', true], ['Healthcare directive', 'In place', true], ['Will or trust', 'Not yet — see local help', false]].map(([t, s, ok]) => (
        <div key={t} style={{ ...wnCard, display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ fontWeight: 700, color: ok ? 'var(--role-color)' : 'var(--color-warning)' }}>{ok ? '✓' : '!'}</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{t}</div>
            <div style={{ fontSize: 10.5, color: 'var(--text-tertiary)' }}>{s}</div>
          </div>
        </div>
      ))}
    </div>
  ),
  notice: () => (
    <div>
      <div style={wnHead}><span>{'🔔'} Notifications</span></div>
      <div style={{ ...wnCard, opacity: 0.55 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)', textDecoration: 'line-through' }}>Care task not checked off</div>
        <div style={{ fontSize: 10.5, color: 'var(--text-tertiary)' }}>Evening meds {'·'} 5:00 PM</div>
      </div>
      <div style={{ textAlign: 'center', fontSize: 14, color: 'var(--text-tertiary)', margin: '-2px 0 4px' }}>{'↓'}</div>
      <div style={wnCard}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>{'✓'} Care task checked off</div>
        <div style={{ fontSize: 10.5, color: 'var(--text-tertiary)' }}>Jane checked off Mom{'’'}s 5:00 PM task at 7:12 PM</div>
      </div>
    </div>
  ),
  id: () => (
    <div style={{ textAlign: 'center', padding: '6px 4px' }}>
      <div style={{ fontSize: 30 }}>{'🪪'}</div>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)', marginTop: 4 }}>Verify your ID</div>
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', margin: '4px 0 8px' }}>Driver{'’'}s license or passport {'·'} takes a minute</div>
      <span style={wnPill('var(--accent-color-dark)', 'var(--text-on-primary)')}>Upload a photo</span>
    </div>
  ),
};
window.WN_PREVIEW_KEYS = Object.keys(WN_PREVIEWS);

const WhatsNewModal = window.WhatsNewModal = ({ entries, onClose, onNavigate }) => {
  const [i, setI] = useState(0);
  const e = entries[Math.min(i, entries.length - 1)];
  if (!e) return null;
  const last = i >= entries.length - 1;
  const Preview = WN_PREVIEWS[e.preview];
  const btn = { minHeight: 44, padding: '0 16px', borderRadius: 12, fontSize: 14.5, fontWeight: 700, cursor: 'pointer' };
  return (
    <div role="dialog" aria-modal="true" aria-label="What's new in InPlace" data-testid="whats-new"
      style={{ position: 'fixed', inset: 0, zIndex: 10040, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'var(--bg-primary)', borderRadius: 18, width: '100%', maxWidth: 440, maxHeight: '92vh', overflowY: 'auto', boxSizing: 'border-box', padding: '18px 18px 16px', position: 'relative' }}>
        <button onClick={onClose} aria-label="Close"
          style={{ position: 'absolute', top: 8, right: 8, minWidth: 44, minHeight: 44, border: 'none', background: 'none', fontSize: 22, color: 'var(--text-tertiary)', cursor: 'pointer' }}>{'×'}</button>
        <div style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 20, background: 'var(--color-info-bg)', color: 'var(--color-info)', fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>
          What{'’'}s new{entries.length > 1 ? ` · ${i + 1} of ${entries.length}` : ''}
        </div>
        <h2 style={{ margin: '10px 40px 6px 0', fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>{e.title}</h2>
        <p style={{ margin: '0 0 12px', fontSize: 14, lineHeight: 1.55, color: 'var(--text-secondary)' }}>{e.body}</p>

        {Preview && (
          <div aria-hidden="true" style={{ position: 'relative', padding: '30px 12px 8px', borderRadius: 14, border: '1px solid var(--border-color)', background: 'var(--bg-surface)', pointerEvents: 'none', userSelect: 'none', marginBottom: 14 }}>
            <span style={WN_EXAMPLE_TAG}>Example</span>
            <Preview />
          </div>
        )}

        {Array.isArray(e.examples) && e.examples.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Good for things like</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {e.examples.map((x) => (
                <span key={x} style={{ padding: '5px 10px', borderRadius: 14, background: 'var(--role-color-light)', color: 'var(--role-color)', fontSize: 12.5, fontWeight: 600 }}>{'“'}{x}{'”'}</span>
              ))}
            </div>
          </div>
        )}

        {Array.isArray(e.howTo) && e.howTo.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>How to use it</div>
            <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13.5, lineHeight: 1.6, color: 'var(--text-primary)' }}>
              {e.howTo.map((s) => <li key={s}>{s}</li>)}
            </ol>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {e.action && onNavigate && (
            <button onClick={() => { onClose(); onNavigate(e.action.page); }}
              style={{ ...btn, border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--role-color)' }}>
              {e.action.label}
            </button>
          )}
          <button onClick={() => (last ? onClose() : setI(i + 1))}
            style={{ ...btn, flex: 1, border: 'none', background: 'var(--accent-color)', color: 'var(--text-on-primary)' }}>
            {last ? 'Got it' : 'Next'}
          </button>
        </div>
        {entries.length > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 2, marginTop: 8 }}>
            {entries.map((x, k) => (
              <button key={x.id} onClick={() => setI(k)} aria-label={`Show ${x.title}`}
                style={{ width: 28, height: 28, minWidth: 28, minHeight: 28, padding: 0, border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ display: 'block', width: 8, height: 8, borderRadius: '50%', background: k === i ? 'var(--role-color)' : 'var(--border-color)' }} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// Mounted once in app.js. `ready` is false while anything else owns the screen (legal gate, ID
// gate, demo, an admin viewing as someone).
const WhatsNewHost = window.WhatsNewHost = ({ userId, ready, onNavigate }) => {
  const [entries, setEntries] = useState(null);
  const [replay, setReplay] = useState(false);
  const fetched = useRef(null);

  useEffect(() => {
    if (!ready || !userId || fetched.current === userId) return;
    fetched.current = userId;
    let gone = false;
    (async () => {
      try {
        const res = await apiFetch('/api/whats-new');
        if (!res?.ok || gone) return;
        const d = await res.json();
        if (!gone && Array.isArray(d.entries) && d.entries.length) { setReplay(false); setEntries(d.entries); }
      } catch { /* the splash is a courtesy; never in the way */ }
    })();
    return () => { gone = true; };
  }, [userId, ready]);

  // Help → "What's new" (or anything else) re-opens everything recent.
  useEffect(() => {
    const open = async () => {
      try {
        const res = await apiFetch('/api/whats-new?all=1');
        if (!res?.ok) return;
        const d = await res.json();
        if (Array.isArray(d.entries) && d.entries.length) { setReplay(true); setEntries(d.entries); }
        else if (typeof window.__showToast === 'function') window.__showToast('Nothing new in the last few weeks', 'info');
      } catch {}
    };
    window.addEventListener('inplace:whatsNew', open);
    return () => window.removeEventListener('inplace:whatsNew', open);
  }, []);

  if (!entries || !entries.length) return null;
  const close = () => {
    const ids = entries.map((e) => e.id);
    setEntries(null);
    if (replay) return;
    apiFetch('/api/whats-new/seen', { method: 'POST', body: JSON.stringify({ ids }) }).catch(() => {});
  };
  return <WhatsNewModal entries={entries} onClose={close} onNavigate={onNavigate} />;
};
