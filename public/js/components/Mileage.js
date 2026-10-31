// ─── Visit mileage (v1.126.1) ───
//
// Pete, 10/28: track the miles a caregiver drives for the loved one during a visit and pay a
// family-set rate — "the intent isn't to encourage road trips but to make sure cost/gas is
// covered." The caregiver never types a number of miles: she picks where she went and the
// server works out the drive (Google when the key is set, a labelled straight-line estimate
// before then). Server side: src/utils/mileage.js, src/routes/mileage.js.
//
//   PlaceSearch            — search-as-you-type for a place (Google or OSM, says which)
//   VisitMileageCard       — on the caregiver's in-progress visit card: trips + "Log a trip"
//   LogTripSheet           — the calculator
//   MileageCheckoutSummary — inside the check-out sheet
//   VisitMileageReport     — the family's visit details; approve / don't pay extra miles
//   MileageSettingsCard    — the care team leader turns it on, sets rate and cap

const mileageMoney = (cents) => `$${((Number(cents) || 0) / 100).toFixed(2)}`;
const mileageMi = (m) => `${(Math.round((Number(m) || 0) * 10) / 10).toFixed(1)} mi`;
const mileageRate = (c) => `${Number(c) || 0}¢`;

const mileageToken = () => {
  try { if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID(); } catch { /* fall through */ }
  return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2);
};

const mileageBtn = (primary, disabled) => ({
  minHeight: 44, padding: '10px 14px', borderRadius: 22, fontSize: 15, fontWeight: 700, whiteSpace: 'nowrap',
  cursor: disabled ? 'default' : 'pointer', fontFamily: 'inherit',
  border: primary ? 'none' : '1px solid var(--border-color)',
  background: primary ? (disabled ? 'var(--border-light)' : 'var(--role-color)') : 'var(--bg-surface)',
  color: primary ? (disabled ? 'var(--text-secondary)' : 'var(--text-on-primary)') : 'var(--text-primary)',
});

const tripRouteLabel = (t) => {
  const names = (t.stops || []).map((s) => s.label).filter(Boolean);
  // v1.127.0 — a leg can start where the last one ended, so show the stored start.
  const start = t.startLabel || (t.startKind === 'here' ? 'Your location' : 'Home');
  return [start, ...names, ...(t.roundTrip ? [start] : [])].join(' → ');
};

// ─── PlaceSearch ───
const PlaceSearch = window.PlaceSearch = ({ near, onPick, placeholder, autoFocus }) => {
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  const [provider, setProvider] = useState(null);
  const [searching, setSearching] = useState(false);
  const tokenRef = useRef(mileageToken());
  const timerRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const text = q.trim();
    if (text.length < 2) { setItems([]); return; }
    timerRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const qs = `q=${encodeURIComponent(text)}&session=${encodeURIComponent(tokenRef.current)}${near ? `&near=${encodeURIComponent(near)}` : ''}`;
        const r = await apiFetch('/api/geocode/suggest?' + qs);
        if (r?.ok) {
          const d = await r.json();
          setProvider(d.provider || 'osm');
          setItems(d.suggestions || []);
          // v1.126.6 — keep the list above the phone keyboard
          setTimeout(() => { try { if (listRef.current) listRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { /* ignore */ } }, 50);
        } else {
          setItems([]);
        }
      } catch { setItems([]); }
      setSearching(false);
    }, 300);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [q, near]);

  const pick = (s) => {
    const stop = s.placeId
      ? { placeId: s.placeId, label: s.main, address: s.secondary, session: tokenRef.current }
      : { label: s.line1 || s.label, address: s.label, lat: s.lat, lng: s.lng };
    setQ(''); setItems([]);
    tokenRef.current = mileageToken(); // one Google session per pick
    if (onPick) onPick(stop);
  };

  return (
    <div>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} autoFocus={autoFocus}
        aria-label={placeholder || 'Search for a place'}
        placeholder={placeholder || 'Search: pharmacy, store, doctor, address'}
        autoComplete="off"
        style={{
          width: '100%', boxSizing: 'border-box', padding: '12px 14px', borderRadius: 12,
          border: '2px solid var(--role-color)', background: 'var(--input-bg)', color: 'var(--text-primary)',
          fontSize: 16, fontFamily: 'inherit',
        }} />
      {(items.length > 0 || (searching && q.trim().length >= 2)) && (
        <div ref={listRef} style={{ border: '1px solid var(--border-color)', borderRadius: 12, marginTop: 6, overflow: 'hidden', background: 'var(--bg-card)' }}>
          {items.length === 0 && <div style={{ padding: '12px 14px', fontSize: 14, color: 'var(--text-secondary)' }}>Searching{'…'}</div>}
          {items.map((s, i) => (
            <button key={s.placeId || s.label + i} onClick={() => pick(s)} style={{
              display: 'block', width: '100%', textAlign: 'left', padding: '12px 14px', minHeight: 44,
              background: 'var(--bg-card)', border: 'none', borderTop: i ? '1px solid var(--border-light)' : 'none',
              cursor: 'pointer', fontFamily: 'inherit', color: 'var(--text-primary)',
            }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{s.main || s.line1 || s.label}</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                {s.secondary || [s.city, s.state].filter(Boolean).join(', ')}
                {s.distanceMiles != null ? ` · ${s.distanceMiles} mi` : ''}
              </div>
            </button>
          ))}
          {items.length > 0 && (
            <div style={{ padding: '6px 14px 8px', fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right' }}>
              {provider === 'google' ? 'Powered by Google' : 'Suggestions from OpenStreetMap'}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ─── LogTripSheet ───
// v1.127.0 — Pete, 10/30: "We have to figure out how to log legs from where the trip initiates
// to where it ends." Each trip is a LEG: it starts where the last one ended (the server knows
// where that was), it is one way unless the caregiver picks round trip, and the drive back is
// its own leg ("Back to Betty's home"). Restarting at the home mid-errand is refused server-side.
const LogTripSheet = window.LogTripSheet = ({ sessionId, recipientId, recipientName, rateCents, nextFrom, homeLabel, onClose, onSaved }) => {
  const { showToast } = useToast();
  const awayFromHome = !!(nextFrom && !nextFrom.atHome && nextFrom.known);
  const [from, setFrom] = useState(awayFromHome ? 'last' : 'home');
  const [here, setHere] = useState(null);
  const [locating, setLocating] = useState(false);
  const [stops, setStops] = useState([]);
  const [roundTrip, setRoundTrip] = useState(false);
  const [note, setNote] = useState('');
  const [quote, setQuote] = useState(null);
  const [quoteError, setQuoteError] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(true);
  const home = homeLabel || (recipientName ? `${recipientName}'s home` : 'Their home');
  const startsAtHome = from === 'home';
  const hasHomeStop = stops.some((s) => s.home);

  const body = () => ({ from, here: from === 'here' ? here : undefined, stops, roundTrip });

  // Re-quote whenever the route changes. The server is the only thing that measures.
  useEffect(() => {
    setQuote(null); setQuoteError(null);
    if (stops.length === 0) return;
    if (from === 'here' && !here) return;
    let cancelled = false;
    setQuoting(true);
    (async () => {
      try {
        const r = await apiFetch(`/api/mileage/sessions/${sessionId}/quote`, { method: 'POST', body: JSON.stringify(body()) });
        const d = await r?.json().catch(() => ({}));
        if (cancelled) return;
        if (r?.ok) setQuote(d.trip);
        else {
          setQuoteError(d?.error || "We couldn't work out the distance.");
          if (d?.code === 'home_unmapped') setFrom('here');
          if (d?.code === 'chain_break') setFrom('last');
        }
      } catch { if (!cancelled) setQuoteError("We couldn't work out the distance. Check your connection."); }
      if (!cancelled) setQuoting(false);
    })();
    return () => { cancelled = true; };
  }, [JSON.stringify(stops), from, here && here.lat, here && here.lng, roundTrip]);

  const useMyLocation = async () => {
    setLocating(true);
    try {
      const { pos, reason } = await getDeviceLocation({ timeoutMs: 8000 });
      if (pos) { setHere({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setFrom('here'); }
      else showToast(reason === 'denied' ? 'Location is off for InPlace. Turn it on in Settings, or start from the home.' : "Couldn't get your location.", 'error');
    } catch { showToast("Couldn't get your location.", 'error'); }
    setLocating(false);
  };

  const save = async () => {
    if (!quote) return;
    if (note.trim().length < 3) { showToast('Add a few words about what the trip was for', 'error'); return; }
    setSaving(true);
    try {
      const r = await apiFetch(`/api/mileage/sessions/${sessionId}/trips`, { method: 'POST', body: JSON.stringify({ ...body(), note: note.trim() }) });
      const d = await r?.json().catch(() => ({}));
      if (r?.ok) { showToast(`Trip added · ${mileageMi(d.trip.miles)}`, 'success'); if (onSaved) onSaved(d.mileage); onClose(); }
      else showToast(d?.error || "Couldn't save the trip", 'error');
    } catch { showToast("Couldn't save the trip. Check your connection.", 'error'); }
    setSaving(false);
  };

  const pill = (on) => ({
    flex: 1, minHeight: 44, borderRadius: 22, fontFamily: 'inherit', fontSize: 14, cursor: 'pointer',
    border: on ? '2px solid var(--role-color)' : '1px solid var(--border-color)',
    background: on ? 'var(--role-color-light)' : 'var(--bg-surface)',
    color: on ? 'var(--role-color-dark)' : 'var(--text-primary)', fontWeight: on ? 700 : 500,
  });
  const label = { fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '0.4px', marginBottom: 6 };

  return ReactDOM.createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Log a trip" style={{
        background: 'var(--bg-card)', width: '100%', maxWidth: 520, borderRadius: '16px 16px 0 0',
        padding: 20, paddingBottom: `calc(20px + ${window.__safeAreaBottom || 0}px)`,
        maxHeight: '92vh', overflowY: 'auto', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>Log a trip</div>
          <button onClick={onClose} aria-label="Close" style={{ minWidth: 44, minHeight: 44, background: 'none', border: 'none', fontSize: 22, color: 'var(--text-tertiary)', cursor: 'pointer' }}>{'×'}</button>
        </div>
        <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
          Errands for {recipientName || 'the person you care for'} only: appointments, pharmacy, groceries. Your drive to and from the visit isn{'’'}t counted.
        </div>

        <div>
          <div style={label}>FROM</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {awayFromHome
              ? <button onClick={() => setFrom('last')} style={pill(from === 'last')}>{nextFrom.label || 'Where you left off'}</button>
              : <button onClick={() => setFrom('home')} style={pill(from === 'home')}>{home}</button>}
            <button onClick={() => (here ? setFrom('here') : useMyLocation())} disabled={locating} style={pill(from === 'here')}>
              {locating ? 'Finding you…' : 'Use my location'}
            </button>
          </div>
          {awayFromHome && from === 'last' && (
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 6 }}>
              Your last trip ended here. Log each leg from where it started, and the drive back as its own leg.
            </div>
          )}
        </div>

        <div>
          <div style={label}>GOING TO</div>
          {stops.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: '1px solid var(--border-color)', borderRadius: 12, marginBottom: 6 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary)' }}>{s.label}</div>
                {s.address && <div style={{ fontSize: 13, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.address}</div>}
              </div>
              <button aria-label={`Remove ${s.label}`} onClick={() => { setStops(stops.filter((_, j) => j !== i)); if (stops.length === 1) setAdding(true); }}
                style={{ minWidth: 44, minHeight: 44, background: 'none', border: 'none', fontSize: 20, color: 'var(--text-tertiary)', cursor: 'pointer' }}>{'×'}</button>
            </div>
          ))}
          {!startsAtHome && !hasHomeStop && (adding || stops.length === 0) && stops.length < 5 && (
            <button onClick={() => { setStops([...stops, { home: true, label: home }]); setAdding(false); }}
              style={{ ...pill(false), width: '100%', marginBottom: 8, flex: 'none' }}>
              {'↩'} Back to {home}
            </button>
          )}
          {(adding || stops.length === 0) && stops.length < 5 && !hasHomeStop && (
            <PlaceSearch near={recipientId} autoFocus={stops.length > 0}
              placeholder={stops.length ? 'Add another stop' : 'Search: CVS, Kroger, a doctor, an address'}
              onPick={(s) => { setStops([...stops, s]); setAdding(false); }} />
          )}
        </div>

        {stops.length > 0 && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setRoundTrip(false)} style={pill(!roundTrip)}>One way</button>
            {!hasHomeStop && <button onClick={() => setRoundTrip(true)} style={pill(roundTrip)}>Round trip</button>}
            {!adding && stops.length < 5 && !hasHomeStop && <button onClick={() => setAdding(true)} style={pill(false)}>+ Add stop</button>}
          </div>
        )}

        {(quoting || quote || quoteError) && (
          <div role="status" style={{ background: 'var(--bg-elevated)', borderRadius: 12, padding: 14 }}>
            {quoting && <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Working out the drive{'…'}</div>}
            {!quoting && quoteError && <div style={{ fontSize: 14, color: 'var(--color-error)' }}>{quoteError}</div>}
            {!quoting && quote && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--role-color-dark)' }}>{mileageMi(quote.miles)}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    {quote.source === 'estimate' ? 'Estimated from the map (straight-line × road factor)' : `Driving route${quote.minutes ? ` · about ${quote.minutes} min` : ''}`}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>{mileageMoney(quote.cents)}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>at {mileageRate(quote.rateCents || rateCents)}/mi</div>
                </div>
              </div>
            )}
          </div>
        )}

        {quote && (
          <div>
            <label htmlFor="mileage-note" style={{ ...label, display: 'block' }}>WHAT WAS IT FOR?</label>
            <input id="mileage-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200}
              placeholder="e.g. Picked up a prescription"
              style={{ width: '100%', boxSizing: 'border-box', padding: '12px 14px', borderRadius: 12, border: '1px solid var(--border-color)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: 16, fontFamily: 'inherit' }} />
          </div>
        )}

        <button onClick={save} disabled={!quote || saving || note.trim().length < 3} style={{ ...mileageBtn(true, !quote || saving || note.trim().length < 3), minHeight: 52, fontSize: 17 }}>
          {saving ? 'Saving…' : quote ? `Add trip · ${mileageMi(quote.miles)}` : 'Add trip'}
        </button>
      </div>
    </div>,
    document.body
  );
};

const useVisitMileage = (sessionId) => {
  const [m, setM] = useState(null);
  const [error, setError] = useState(null);
  const load = async () => {
    if (!sessionId) return;
    try {
      const r = await apiFetch(`/api/mileage/sessions/${sessionId}`);
      if (r?.ok) { const d = await r.json(); setM(d.mileage); setError(null); }
      else setError("Couldn't load mileage");
    } catch { setError("Couldn't load mileage"); }
  };
  useEffect(() => { load(); }, [sessionId]);
  return [m, setM, load, error];
};

const MileageTripRow = ({ t, onRemove, busy }) => (
  <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '10px 0', borderTop: '1px solid var(--border-light)' }}>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>{tripRouteLabel(t)}</div>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
        {'“'}{t.note}{'”'}{t.source === 'estimate' ? ' · estimated' : ''}
      </div>
    </div>
    <div style={{ textAlign: 'right', flex: 'none' }}>
      <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>{mileageMi(t.miles)}</div>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{mileageMoney(t.cents)}</div>
    </div>
    {onRemove && (
      <button aria-label="Remove this trip" disabled={busy} onClick={onRemove}
        style={{ minWidth: 44, minHeight: 44, marginTop: -8, background: 'none', border: 'none', fontSize: 20, color: 'var(--text-tertiary)', cursor: 'pointer' }}>{'×'}</button>
    )}
  </div>
);

// ─── VisitMileageCard (caregiver, during the visit) ───
const VisitMileageCard = window.VisitMileageCard = ({ sessionId, recipientId, recipientName }) => {
  const { showToast } = useToast();
  const [m, setM, load] = useVisitMileage(sessionId);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!m || !m.enabled) return null;
  const pct = m.capMiles ? Math.min(100, Math.round((m.totalMiles / m.capMiles) * 100)) : 0;
  const remove = async (t) => {
    if (!confirm(`Remove the trip "${t.note}"?`)) return;
    setBusy(true);
    try {
      const r = await apiFetch(`/api/mileage/trips/${t.id}`, { method: 'DELETE' });
      const d = await r?.json().catch(() => ({}));
      if (r?.ok) setM({ ...m, ...d.mileage });
      else showToast(d?.error || "Couldn't remove the trip", 'error');
    } catch { showToast("Couldn't remove the trip", 'error'); }
    setBusy(false);
  };
  return (
    <div onClick={(e) => e.stopPropagation()} data-testid="visit-mileage-card" style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-light)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Mileage today</div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{mileageRate(m.rateCents)} a mile</div>
      </div>
      {m.trips.map((t) => <MileageTripRow key={t.id} t={t} busy={busy} onRemove={m.canLog ? () => remove(t) : null} />)}
      {m.trips.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{mileageMi(m.totalMiles)} of {m.capMiles} mi this visit</span>
            <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{mileageMoney(m.cents)}</span>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: 'var(--border-color)', overflow: 'hidden', marginTop: 6 }}>
            <div style={{ width: `${pct}%`, height: 8, background: m.extraMiles > 0 ? 'var(--accent-color-dark)' : 'var(--role-color)' }} />
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 6 }}>
            {m.extraMiles > 0
              ? `${mileageMi(m.extraMiles)} past the cap will wait for the care team leader's OK.`
              : `Miles past ${m.capMiles} need the care team leader's OK before they're paid.`}
          </div>
        </div>
      )}
      {m.canLog && (
        <button onClick={() => setOpen(true)} style={{ ...mileageBtn(false, false), width: '100%', marginTop: 10, border: '2px solid var(--role-color)', color: 'var(--role-color)' }}>+ Log a trip</button>
      )}
      {open && <LogTripSheet sessionId={sessionId} recipientId={recipientId} recipientName={recipientName} rateCents={m.rateCents}
        nextFrom={m.nextFrom} homeLabel={m.homeLabel}
        onClose={() => setOpen(false)} onSaved={(next) => (next ? setM({ ...m, ...next }) : load())} />}
    </div>
  );
};

// ─── MileageCheckoutSummary (caregiver, the check-out sheet) ───
const MileageCheckoutSummary = window.MileageCheckoutSummary = ({ sessionId }) => {
  const [m] = useVisitMileage(sessionId);
  if (!m || !m.trips || m.trips.length === 0) return null;
  return (
    <div data-testid="mileage-checkout" style={{ background: 'var(--bg-elevated)', borderRadius: 12, padding: 14, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>Mileage</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {mileageMi(m.paidMiles)} {'×'} {mileageRate(m.rateCents)} {'·'} {m.trips.length} {m.trips.length === 1 ? 'trip' : 'trips'}
          </div>
        </div>
        <div style={{ fontWeight: 700, fontSize: 17, color: 'var(--text-primary)' }}>{mileageMoney(m.cents)}</div>
      </div>
      {m.extraMiles > 0 && (
        <div style={{ marginTop: 10, background: 'var(--color-warning-bg)', borderRadius: 10, padding: 12, fontSize: 14, lineHeight: 1.4, color: 'var(--text-primary)' }}>
          <b>{mileageMi(m.extraMiles)} ({mileageMoney(m.extraCents)}) will wait for the care team leader.</b> {'It’s'} past the {m.capMiles}-mile cap for this visit. If approved, {'it’s'} paid to you too.
        </div>
      )}
      <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 8 }}>
        Mileage is added to this visit{'\u2019'}s payment as its own line, and paid to you in full. InPlace takes no fee on it.
      </div>
    </div>
  );
};

// ─── VisitMileageReport (family, visit details) ───
const MILEAGE_STATUS_LINE = {
  owed: 'Will be charged once the visit is paid.',
  charged: 'Charged with the visit and paid to the caregiver.',
  failed: "The mileage charge didn't go through. InPlace has been told and will sort it out.",
  waived: 'Not charged (test visit).',
  below_minimum: 'Too small to charge on its own, so it wasn’t charged.',
  none: '',
};
const VisitMileageReport = window.VisitMileageReport = ({ sessionId }) => {
  const { showToast } = useToast();
  const [m, setM] = useVisitMileage(sessionId);
  const [busy, setBusy] = useState(false);
  if (!m || !m.trips || m.trips.length === 0) return null;
  const decide = async (approve) => {
    setBusy(true);
    try {
      const r = await apiFetch(`/api/mileage/sessions/${sessionId}/extra`, { method: 'POST', body: JSON.stringify({ approve }) });
      const d = await r?.json().catch(() => ({}));
      if (r?.ok) { setM({ ...m, ...d.mileage, canDecideExtra: false }); showToast(approve ? 'Approved. The extra miles are being paid.' : "Got it. The extra miles won't be paid.", 'success'); }
      else showToast(d?.error || "Couldn't save that", 'error');
    } catch { showToast("Couldn't save that. Check your connection.", 'error'); }
    setBusy(false);
  };
  const mapLink = (s) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([s.label, s.address].filter(Boolean).join(', '))}`;
  return (
    <div data-testid="visit-mileage-report" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 10, padding: 14, marginBottom: 14 }}>
      {m.extraStatus === 'pending' && (
        <div style={{ background: 'var(--color-warning-bg)', borderRadius: 10, padding: 12, marginBottom: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>{mileageMi(m.extraMiles)} past your {m.capMiles}-mile cap</div>
          <div style={{ fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.45, marginTop: 4 }}>
            {m.canDecideExtra
              ? <>Approving pays the caregiver <b>{mileageMoney(m.extraCents)}</b> more, charged to the card that paid this visit (plus the card fee).</>
              : <>Waiting for the care team leader to approve or decline {mileageMoney(m.extraCents)}.</>}
          </div>
          {m.canDecideExtra && (
            <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
              <button disabled={busy} onClick={() => decide(true)} style={{ ...mileageBtn(true, busy), flex: 1 }}>Approve {mileageMoney(m.extraCents)}</button>
              <button disabled={busy} onClick={() => decide(false)} style={{ ...mileageBtn(false, busy), flex: 1 }}>{'Don’t pay'}</button>
            </div>
          )}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--role-color)' }}>Mileage</div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{mileageMi(m.totalMiles)} {'·'} {mileageRate(m.rateCents)}/mi</div>
      </div>
      {m.trips.map((t) => (
        <div key={t.id} style={{ padding: '10px 0', borderTop: '1px solid var(--border-light)', display: 'flex', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>
              {t.startLabel ? <span>{t.startLabel} {'→'} </span> : null}
              {(t.stops || []).map((s, i) => (
                <span key={i}>{i ? ' → ' : ''}{s.home
                  ? s.label
                  : <a href={mapLink(s)} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--role-color)' }}>{s.label}</a>}</span>
              ))}
              {t.roundTrip ? <span> {'→'} {t.startLabel || 'back'}</span> : null}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              {t.roundTrip ? 'Round trip' : 'One way'} from {t.startKind === 'here' ? "the caregiver's location" : 'home'}{t.source === 'estimate' ? ' · estimated' : ''}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{'“'}{t.note}{'”'}</div>
          </div>
          <div style={{ textAlign: 'right', flex: 'none' }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>{mileageMi(t.miles)}</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{mileageMoney(t.cents)}</div>
          </div>
        </div>
      ))}
      <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 10, marginTop: 2, fontSize: 14, color: 'var(--text-primary)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Mileage{m.extraMiles > 0 ? `, first ${m.capMiles} mi` : ''}</span><b>{mileageMoney(m.cents)}</b>
        </div>
        {m.feeCents ? <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)', fontSize: 13 }}><span>Card processing on mileage</span><span>{mileageMoney(m.feeCents)}</span></div> : null}
        {m.extraStatus === 'charged' && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Approved extra</span><b>{mileageMoney(m.extraCents)}</b></div>}
        {m.extraStatus === 'charged' && m.extraFeeCents ? <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)', fontSize: 13 }}><span>Card processing on extra</span><span>{mileageMoney(m.extraFeeCents)}</span></div> : null}
        {m.extraStatus === 'declined' && <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Extra {mileageMi(m.extraMiles)} not paid (declined).</div>}
        {m.status && MILEAGE_STATUS_LINE[m.status] && <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>{MILEAGE_STATUS_LINE[m.status]}</div>}
        {!m.locked && <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>The visit is still going. Trips lock at check-out.</div>}
      </div>
    </div>
  );
};

// ─── MileageSettingsCard (care team leader) ───
const MileageSettingsCard = window.MileageSettingsCard = ({ recipientId, recipientName }) => {
  const { showToast } = useToast();
  const [s, setS] = useState(null);
  const [draft, setDraft] = useState(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!recipientId) return;
    (async () => {
      try {
        const r = await apiFetch(`/api/mileage/settings/${recipientId}`);
        if (r?.ok) { const d = await r.json(); setS(d.settings); setDraft(d.settings); }
      } catch { /* the card simply doesn't show */ }
    })();
  }, [recipientId]);
  // v1.126.5 — `s` and `draft` are set by two setState calls; under the app's legacy render root
  // they are NOT batched inside an async callback, so one render sees `s` without `draft`.
  // That crashed the whole Care Team page (Sentry INPLACE-1R, 10/28). Wait for both.
  if (!s || !draft) return null;
  const who = recipientName || 'your loved one';
  const dirty = draft && (draft.enabled !== s.enabled || draft.rateCents !== s.rateCents || Number(draft.capMiles) !== s.capMiles);
  const save = async () => {
    setSaving(true);
    try {
      const r = await apiFetch(`/api/mileage/settings/${recipientId}`, { method: 'PUT', body: JSON.stringify({ enabled: draft.enabled, rateCents: draft.rateCents, capMiles: Number(draft.capMiles) }) });
      const d = await r?.json().catch(() => ({}));
      if (r?.ok) { setS(d.settings); setDraft(d.settings); showToast(d.settings.enabled ? 'Mileage is on' : 'Mileage is off', 'success'); }
      else showToast(d?.error || "Couldn't save", 'error');
    } catch { showToast("Couldn't save. Check your connection.", 'error'); }
    setSaving(false);
  };
  const capCents = Math.round((Number(draft.capMiles) || 0) * draft.rateCents);
  return (
    <div className="card" data-testid="mileage-settings" style={{ marginTop: 16 }}>
      <div className="card-header" role="button" tabIndex={0} aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(!open); } }}
        style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <span>Mileage {s.enabled ? <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>{'·'} on, {mileageRate(s.rateCents)}/mi</span> : <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>{'·'} off</span>}</span>
        <span aria-hidden="true" style={{ fontSize: 16, color: 'var(--text-muted)', transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'rotate(0)' }}>{'▼'}</span>
      </div>
      {open && (
        <div style={{ padding: '14px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
            Cover the gas when a caregiver drives {who} to appointments or runs errands. Only those trips count, not the drive to and from the home. The app works out the miles from where they went.
          </div>
          <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, cursor: s.canEdit ? 'pointer' : 'default' }}>
            <span>
              <span style={{ display: 'block', fontWeight: 600, color: 'var(--text-primary)' }}>Pay mileage on visits</span>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Caregivers can log errand trips</span>
            </span>
            <input type="checkbox" checked={!!draft.enabled} disabled={!s.canEdit}
              onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
              style={{ width: 24, height: 24, accentColor: 'var(--role-color)' }} />
          </label>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <label htmlFor="mileage-rate" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Rate per mile</label>
              <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--role-color-dark)' }}>{mileageRate(draft.rateCents)}</span>
            </div>
            <input id="mileage-rate" type="range" min={s.minRateCents} max={s.irsRateCents} step={1} value={draft.rateCents} disabled={!s.canEdit}
              onChange={(e) => setDraft({ ...draft, rateCents: Number(e.target.value) })}
              style={{ width: '100%', accentColor: 'var(--role-color)' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-secondary)' }}>
              <span>{mileageRate(s.minRateCents)}</span><span>{mileageRate(s.irsRateCents)} (IRS rate)</span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>50{'¢'} covers gas and wear for most cars. The most you can set is the IRS rate.</div>
          </div>
          <div>
            <label htmlFor="mileage-cap" style={{ display: 'block', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>Most miles per visit</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input id="mileage-cap" inputMode="decimal" value={draft.capMiles} disabled={!s.canEdit}
                onChange={(e) => setDraft({ ...draft, capMiles: e.target.value.replace(/[^0-9.]/g, '') })}
                style={{ width: 90, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border-color)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: 16, fontFamily: 'inherit' }} />
              <span style={{ color: 'var(--text-secondary)' }}>miles</span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
              Anything over this waits for the care team leader to approve. Up to {draft.capMiles || 0} miles is {mileageMoney(capCents)} at {mileageRate(draft.rateCents)}.
            </div>
          </div>
          <div style={{ background: 'var(--bg-highlight)', borderRadius: 10, padding: 12, fontSize: 14, lineHeight: 1.45, color: 'var(--text-primary)' }}>
            <b>Where the money goes:</b> mileage is added to the visit{'\u2019'}s charge as its own line and paid to the caregiver in full. InPlace keeps none of it. You pay only the card processing on it. The card hold before each visit includes room for your cap; anything unused is released.
          </div>
          {s.canEdit
            ? <button onClick={save} disabled={!dirty || saving} style={mileageBtn(true, !dirty || saving)}>{saving ? 'Saving…' : 'Save'}</button>
            : <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Only the care team leader can change this.</div>}
        </div>
      )}
    </div>
  );
};
