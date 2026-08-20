// ─── Picking a family to vouch for (v1.105.109) ───
//
// Pete: "i don't like the vouch picker, the 'type a number that corresponds with a name'…
// there needs to be a cleaner picker, like when you search for contacts in messages."
//
// It was three browser dialogs in a row: a `prompt()` holding a numbered list you had to read
// and transcribe, a second `prompt()` for the note, and a `confirm()` carrying the honesty
// warning. Transcribing an index is a step that goes wrong silently — pick the wrong number
// and you have vouched a caregiver into a stranger's family, which is the most consequential
// thing an admin can do on this screen.
//
// It was also quietly capped. `pickFamily` fetched `limit=100` and filtered in the browser, so
// the 101st family could not be vouched for at all and nothing said so. This searches on the
// SERVER, so there is no list to page past.
//
// The warning that used to live inside the confirm() is on screen the whole time you are
// choosing, rather than after you have chosen.

const VouchPicker = window.VouchPicker = ({ caregiverName, mode = 'vouch', onCancel, onSubmit }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  const isConvert = mode === 'convert';

  useEffect(() => { if (inputRef.current) inputRef.current.focus(); }, []);

  // Debounced server-side search. An empty query still searches, so the panel opens with
  // families already listed rather than an empty box that looks broken.
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const qs = `?role=family&limit=25${query.trim() ? `&search=${encodeURIComponent(query.trim())}` : ''}`;
        const r = await apiFetch(`/api/admin/users${qs}`);
        if (cancelled) return;
        if (!r?.ok) { setError('Could not load families.'); setResults([]); return; }
        const d = await r.json();
        setError('');
        setResults((d.users || []).filter((u) => !u.is_demo));
      } catch {
        if (!cancelled) { setError('Could not load families.'); setResults([]); }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, query ? 250 : 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query]);

  const famName = (f) => `${f.first_name || ''} ${f.last_name || ''}`.trim() || f.email;

  const submit = async () => {
    if (!selected || submitting) return;
    setSubmitting(true);
    setError('');
    const ok = await onSubmit(selected, note.trim());
    // The caller closes on success. On failure we stay open with the choice intact, so the
    // work of finding the right family is not thrown away.
    if (!ok) { setSubmitting(false); setError('That did not go through. Nothing was changed.'); }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1100,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }} onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: 'var(--bg-card)', borderRadius: 14, width: '100%', maxWidth: 520,
        maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
      }}>
        <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border-light)' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
            {isConvert ? 'Convert to a family vouch' : `Vouch for ${caregiverName}`}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.45 }}>
            Which family? A vouch applies to that family <strong>only</strong>.
          </div>
        </div>

        <div style={{
          margin: '12px 20px 0', padding: '10px 12px', borderRadius: 8,
          background: 'var(--color-warning-bg)', border: '1px solid #ffe0c0',
          fontSize: 12.5, color: 'var(--color-warning)', lineHeight: 1.5,
        }}>
          This is <strong>not</strong> a background check and will never display as one. That
          family sees {'“'}Approved by admin {'—'} no background check.{'”'}
          {isConvert && ' After converting, they will no longer display as background-checked anywhere, and a real check is required for any other family.'}
        </div>

        <div style={{ padding: '12px 20px 0' }}>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelected(null); }}
            placeholder="Search families by name or email"
            style={{
              width: '100%', padding: '10px 12px', borderRadius: 9, fontSize: 15,
              border: '1px solid var(--border-light)', background: 'var(--bg-primary)',
              color: 'var(--text-primary)', boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px', minHeight: 120 }}>
          {searching && results.length === 0 && (
            <div style={{ padding: 16, fontSize: 13, color: 'var(--text-tertiary)' }}>Searching{'…'}</div>
          )}
          {!searching && results.length === 0 && (
            <div style={{ padding: 16, fontSize: 13, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
              {query.trim()
                ? `No family account matches “${query.trim()}”.`
                : 'No family accounts found.'}
            </div>
          )}
          {results.map((f) => {
            const isSel = !!selected && selected.id === f.id;
            return (
              <button key={f.id} onClick={() => setSelected(f)} style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                padding: '10px 12px', marginBottom: 4, borderRadius: 9, cursor: 'pointer',
                font: 'inherit',
                border: isSel ? '2px solid var(--role-color)' : '1px solid var(--border-light)',
                background: isSel ? 'var(--bg-highlight)' : 'var(--bg-primary)',
              }}>
                <span aria-hidden="true" style={{
                  width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                  background: 'var(--accent-color)', color: 'var(--text-on-primary)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 700, fontSize: 13,
                }}>{(f.first_name || f.email || '?')[0].toUpperCase()}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{famName(f)}</span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--text-tertiary)', overflowWrap: 'anywhere' }}>{f.email}</span>
                </span>
                {isSel && <span aria-hidden="true" style={{ color: 'var(--role-color)', fontWeight: 700 }}>{'✓'}</span>}
              </button>
            );
          })}
        </div>

        {!isConvert && (
          <div style={{ padding: '0 20px 8px' }}>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={`Optional note — why can you vouch for ${caregiverName}?`}
              rows={2}
              style={{
                width: '100%', padding: '9px 11px', borderRadius: 9, fontSize: 13.5,
                border: '1px solid var(--border-light)', background: 'var(--bg-primary)',
                color: 'var(--text-primary)', resize: 'vertical', boxSizing: 'border-box',
                fontFamily: 'inherit',
              }}
            />
          </div>
        )}

        {error && (
          <div style={{ padding: '0 20px 8px', fontSize: 13, color: 'var(--color-error)' }}>{error}</div>
        )}

        <div style={{
          display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap',
          padding: '12px 20px 16px', borderTop: '1px solid var(--border-light)',
        }}>
          <button onClick={onCancel} style={{
            padding: '10px 18px', borderRadius: 9, border: '1px solid var(--border-light)',
            background: 'var(--bg-surface)', color: 'var(--text-secondary)',
            fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}>Cancel</button>
          <button onClick={submit} disabled={!selected || submitting} style={{
            padding: '10px 18px', borderRadius: 9, border: 'none',
            background: !selected || submitting ? 'var(--border-light)' : 'var(--role-color)',
            color: 'var(--text-on-primary)', fontSize: 14, fontWeight: 700,
            cursor: !selected || submitting ? 'not-allowed' : 'pointer',
          }}>
            {submitting
              ? 'Saving…'
              : selected
                ? (isConvert ? `Convert for ${famName(selected)}` : `Vouch for ${famName(selected)}`)
                : (isConvert ? 'Convert' : 'Create vouch')}
          </button>
        </div>
      </div>
    </div>
  );
};
