// ─── AddressAutocomplete (v1.75.0) ───
// A street-address text input with as-you-type suggestions (OpenStreetMap data
// via our /api/geocode/suggest proxy). Picking a suggestion fills the whole
// address via onSelect({ line1, city, state, zip, lat, lng, label }).
// Typing normally still works — it's a plain input if suggestions never come.
// v1.126.0 — Google Places when the server has a key (Pete, 10/28). A Google suggestion has a
// placeId and no address parts, so picking one asks /api/geocode/place/:id for them first.
// One session token ties a run of keystrokes and its pick together (that is how Google bills).
const AddressAutocomplete = window.AddressAutocomplete = ({ value, onChange, onSelect, placeholder, style, className }) => {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const timerRef = useRef(null);
  const boxRef = useRef(null);
  const skipNextSearch = useRef(false);
  const [provider, setProvider] = useState('osm');
  const newToken = () => {
    try { if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID(); } catch { /* fall through */ }
    return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2);
  };
  const tokenRef = useRef(newToken());

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
        const r = await apiFetch('/api/geocode/suggest?q=' + encodeURIComponent(q) + '&session=' + encodeURIComponent(tokenRef.current));
        if (r?.ok) {
          const d = await r.json();
          setProvider(d.provider || 'osm');
          setItems(d.suggestions || []);
          setOpen((d.suggestions || []).length > 0);
        }
      } catch (e) { /* suggestions are best-effort */ }
    }, 300);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [value]);

  const pick = async (s) => {
    skipNextSearch.current = true;
    setOpen(false);
    setItems([]);
    if (s.placeId) {
      const token = tokenRef.current;
      tokenRef.current = newToken();
      try {
        const r = await apiFetch('/api/geocode/place/' + encodeURIComponent(s.placeId) + '?session=' + encodeURIComponent(token));
        if (r?.ok) {
          const d = await r.json();
          if (d.place && onSelect) onSelect(d.place);
          return;
        }
      } catch (e) { /* fall through: keep what they typed */ }
      // Couldn't look it up: leave the text so they can finish typing it by hand.
      if (onChange) onChange(s.label || s.main || '');
      return;
    }
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
            {provider === 'google' ? 'Powered by Google' : "Suggestions from OpenStreetMap — keep typing if yours isn't listed"}
          </div>
        </div>
      )}
    </div>
  );
};
