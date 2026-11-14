// ─── DateOfBirthInput — Month / Day / Year as three plain dropdowns (v1.127.3) ───
//
// Pete, Nov 13 2026, signing up on his iPhone for the App Review recording: "I can't pick a day
// on the birthdate selector, it's just month and year." The field was a bare
// <input type="date">, which leaves the whole interaction to the platform's date picker —
// and in the iOS web view that is a calendar popover where the year/month wheel is the
// obvious control and the day grid is easy to lose. For a BIRTH date it is the wrong tool
// anyway: a calendar starts at today and asks an 80-year-old to page back eight decades.
//
// Three selects work the same on every phone, read clearly, and need no native picker. The
// value in and out is the same 'YYYY-MM-DD' string the old input produced ('' until all three
// are chosen), so every caller and every server check is unchanged.

const DateOfBirthInput = window.DateOfBirthInput = ({ value, onChange, invalid, minAge = 13, maxAge = 110, style }) => {
  const parse = (v) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || '');
    return m ? { y: m[1], m: String(Number(m[2])), d: String(Number(m[3])) } : { y: '', m: '', d: '' };
  };
  const [parts, setParts] = useState(() => parse(value));

  // Follow a value set from outside (a pre-filled form, a reset) without clobbering a
  // half-finished pick the person is still making.
  useEffect(() => {
    if (value) setParts(parse(value));
  }, [value]);

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const thisYear = new Date().getFullYear();
  const years = [];
  for (let y = thisYear - minAge; y >= thisYear - maxAge; y--) years.push(String(y));

  const daysIn = (y, m) => (m ? new Date(Number(y) || 2000, Number(m), 0).getDate() : 31);
  const maxDay = daysIn(parts.y, parts.m);

  const update = (key, v) => {
    const next = { ...parts, [key]: v };
    // February 30th and friends: pull the day back into the month instead of silently
    // producing a date the server will reject.
    if (next.d && Number(next.d) > daysIn(next.y, next.m)) next.d = String(daysIn(next.y, next.m));
    setParts(next);
    const out = next.y && next.m && next.d
      ? `${next.y}-${String(next.m).padStart(2, '0')}-${String(next.d).padStart(2, '0')}`
      : '';
    onChange(out);
  };

  const sel = {
    flex: 1, minWidth: 0, padding: '10px 8px', fontSize: 16, borderRadius: 8,
    border: invalid ? '1px solid var(--color-error)' : '1px solid var(--border-color, #ccc)',
    background: invalid ? 'var(--bg-accent-light)' : 'var(--bg-card, #fff)', color: 'var(--text-primary)',
    fontFamily: 'inherit',
    ...(style || {}),
  };

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <select aria-label="Birth month" value={parts.m} onChange={(e) => update('m', e.target.value)} style={{ ...sel, flex: 1.6 }}>
        <option value="">Month</option>
        {MONTHS.map((name, i) => <option key={name} value={String(i + 1)}>{name}</option>)}
      </select>
      <select aria-label="Birth day" value={parts.d} onChange={(e) => update('d', e.target.value)} style={sel}>
        <option value="">Day</option>
        {Array.from({ length: maxDay }, (_, i) => String(i + 1)).map(d => <option key={d} value={d}>{d}</option>)}
      </select>
      <select aria-label="Birth year" value={parts.y} onChange={(e) => update('y', e.target.value)} style={{ ...sel, flex: 1.2 }}>
        <option value="">Year</option>
        {years.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  );
};
