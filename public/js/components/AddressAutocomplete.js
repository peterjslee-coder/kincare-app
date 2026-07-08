// ─── AddressAutocomplete (v1.75.0) ───
// A street-address text input with as-you-type suggestions (OpenStreetMap data
// via our /api/geocode/suggest proxy). Picking a suggestion fills the whole
// address via onSelect({ line1, city, state, zip, lat, lng, label }).
// Typing normally still works — it's a plain input if suggestions never come.
const AddressAutocomplete = window.AddressAutocomplete = ({ value, onChange, onSelect, placeholder, style, className }) => {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const timerRef = useRef(null);
  const boxRef = useRef(null);
  const skipNextSearch = useRef(false);

  useEffect(() => {
    const close = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('touchstart', close); };
  }, []);

  useEffect(() => {
    if (skipNextSearch.current) { skipNextSearch.current = false; return; }
    if (timerRef.current) clearTimeout(timerRef.current);
    const q = (value || '').trim();
    if (q.length < 4) { setItems([]); setOpen(false); return; }
    timerRef.current = setTimeout(async () => {
      try {
        const r = await apiFetch('/api/geocode/suggest?q=' + encodeURIComponent(q));
        if (r?.ok) {
          const d = await r.json();
          setItems(d.suggestions || []);
          setOpen((d.suggestions || []).length > 0);
        }
      } catch (e) { /* suggestions are best-effort */ }
    }, 300);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [value]);

  const pick = (s) => {
    skipNextSearch.current = true;
    setOpen(false);
    setItems([]);
    if (onSelect) onSelect(s);
  };

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <input
        type="text"
        className={className}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => { if (items.length) setOpen(true); }}
        placeholder={placeholder || 'Start typing an address…'}
        autoComplete="off"
        style={style}
      />
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 1200,
          background: 'var(--bg-card)', border: '1px solid var(--border-light)',
          borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', marginTop: 2,
          maxHeight: 220, overflowY: 'auto',
        }}>
          {items.map((s, i) => (
            <div key={i}
              onMouseDown={(e) => { e.preventDefault(); pick(s); }}
              onTouchStart={(e) => { e.preventDefault(); pick(s); }}
              style={{ padding: '10px 12px', fontSize: 14, cursor: 'pointer', color: 'var(--text-primary)', borderTop: i ? '1px solid var(--border-light)' : 'none' }}>
              📍 {s.label}
            </div>
          ))}
          <div style={{ padding: '4px 12px 6px', fontSize: 10, color: 'var(--text-muted)' }}>
            Suggestions from OpenStreetMap — keep typing if yours isn't listed
          </div>
        </div>
      )}
    </div>
  );
};
