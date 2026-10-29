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
  calendarWhole: () => (
    <div>
      <div style={{ ...wnHead, margin: '0 0 6px' }}><span>{'📅'} November</span></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3, marginBottom: 8 }}>
        {Array.from({ length: 21 }, (_, i) => i + 1).map((d) => (
          <div key={d} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 6, padding: '3px 0 4px', textAlign: 'center' }}>
            <div style={{ fontSize: 10.5, color: 'var(--text-secondary)' }}>{d}</div>
            <div style={{ height: 6, display: 'flex', justifyContent: 'center' }}>
              {[2, 3, 4, 7, 9, 10, 11, 14, 16, 17, 18, 21].includes(d) && (
                <span style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--role-color)' }} />
              )}
            </div>
          </div>
        ))}
      </div>
      <div style={{ ...wnCard, borderLeft: '4px solid var(--color-warning)' }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>Already booked</div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>You already have a visit with Ruth on Sat, Nov 7 at 9:00 AM that overlaps this one.</div>
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
  cardDeclined: () => (
    <div style={{ padding: '12px 12px 10px', borderRadius: 12, border: '2px solid var(--accent-color)', background: 'var(--bg-attention-card)' }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, color: 'var(--text-tertiary)', marginBottom: 4 }}>{'💳'} CARD DECLINED {'·'} FOR MOM</div>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>Card declined {'—'} Jane{'’'}s visit isn{'’'}t paid for yet</div>
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', margin: '4px 0 10px' }}>Visa ending 4242 was declined {'—'} there wasn{'’'}t enough money on it. The visit can{'’'}t start until it goes through.</div>
      <div style={{ display: 'flex', gap: 6 }}>
        <span style={{ ...wnPill('var(--accent-color-dark)', 'var(--text-on-primary)'), flex: 1, textAlign: 'center', padding: '8px 10px' }}>Try the card again</span>
        <span style={{ ...wnPill('var(--bg-card)', 'var(--accent-color)'), border: '1.5px solid var(--accent-color)', padding: '8px 10px' }}>Open {'›'}</span>
      </div>
    </div>
  ),
  // v1.120.1 — the payer is reminded until a reimbursement is paid
  // v1.121.0 — the loved one's page: the guide bar, and To do grouped by when (a747e1cb)
  lovedOnePage: () => (
    <div style={{ padding: '10px 10px 8px', borderRadius: 12, border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}>
      <div style={{ display: 'flex', gap: 5, overflow: 'hidden', marginBottom: 10 }}>
        {['Mom', 'To do', 'Notes', 'Calendar', 'Money'].map((c, i) => (
          <span key={c} style={{ ...wnPill(i === 1 ? 'var(--role-color)' : 'var(--bg-elevated)', i === 1 ? 'var(--text-on-primary)' : 'var(--text-secondary)'), borderRadius: 999, whiteSpace: 'nowrap' }}>{c}</span>
        ))}
      </div>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, color: 'var(--text-tertiary)', marginBottom: 4 }}>NOW</div>
      {[['💊', 'Morning pills', '9:00 AM', true], ['🍽️', 'Lunch', '12:30 PM', false]].map(([ic, t, at, due]) => (
        <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', marginBottom: 4, borderRadius: 8,
          border: `1.5px solid ${due ? 'var(--color-warning)' : 'var(--border-color)'}`, fontSize: 12 }}>
          <span style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid var(--border-color)', flexShrink: 0 }} />
          <span style={{ flex: 1, color: 'var(--text-primary)', fontWeight: 600 }}>{ic} {t}</span>
          <span style={{ color: 'var(--text-muted)' }}>{at}</span>
        </div>
      ))}
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, color: 'var(--text-tertiary)', margin: '8px 0 2px' }}>NEXT VISIT</div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{'☐'} Water the kitchen plant</div>
    </div>
  ),
  toPay: () => (
    <div style={{ padding: '12px 12px 10px', borderRadius: 12, border: '2px solid var(--accent-color)', background: 'var(--bg-attention-card)' }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, color: 'var(--text-tertiary)', marginBottom: 4 }}>{'💵'} TO PAY {'·'} FOR MOM</div>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>Pay $95.00 to Sam</div>
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', margin: '4px 0 10px' }}>Internet {'·'} approved, but no money has moved yet.</div>
      <span style={{ ...wnPill('var(--accent-color-dark)', 'var(--text-on-primary)'), display: 'block', textAlign: 'center', padding: '8px 10px' }}>Pay {'›'}</span>
    </div>
  ),
  // v1.124.0 — move a visit to another day (Pete, 10/19)
  // v1.125.2 — cancelling a visit in a series asks which (Pete, 10/28: "is this Nov 3 or the entire series?")
  cancelOneOrSeries: () => (
    <div style={{ padding: '12px 12px 10px', borderRadius: 12, border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>Cancel visit</div>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>This visit is part of a series. Cancel:</div>
      {[['Just Mon Nov 3', 'The other 5 visits stay as booked.', true], ['Mon Nov 3 and the 5 after it', 'Every visit through Mon Dec 8.', false]].map(([l, sub, on]) => (
        <div key={l} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '7px 9px', marginBottom: 5, borderRadius: 8,
          border: on ? '2px solid var(--role-color)' : '1px solid var(--border-color)' }}>
          <span style={{ width: 12, height: 12, marginTop: 2, borderRadius: 6, flexShrink: 0, border: '2px solid var(--role-color)', background: on ? 'var(--role-color)' : 'transparent' }} />
          <span>
            <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{l}</span>
            <span style={{ display: 'block', fontSize: 10.5, color: 'var(--text-secondary)' }}>{sub}</span>
          </span>
        </div>
      ))}
      <div style={{ marginTop: 6, padding: '6px 8px', borderRadius: 8, border: '2px dashed var(--accent-color)', fontSize: 10.5, fontWeight: 600, color: 'var(--text-secondary)' }}>
        Jane cancelled this day only {'—'} the rest of the series is still with Jane.
      </div>
    </div>
  ),
  // v1.126.0 — visit mileage (Pete, 10/28: "make sure cost/gas is covered")
  mileageCaregiver: () => (
    <div style={{ padding: '12px 12px 10px', borderRadius: 12, border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
        <span>Mileage today</span><span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-tertiary)' }}>50{'¢'} a mile</span>
      </div>
      {[['Home → CVS Pharmacy → Home', 'Picked up a prescription', '4.8 mi', '$2.40'], ['Home → Library → Home', 'Book drop', '3.2 mi', '$1.60']].map(([r, n, mi, c]) => (
        <div key={r} style={{ display: 'flex', gap: 8, padding: '6px 0', borderTop: '1px solid var(--border-light)' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{r}</div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{'“'}{n}{'”'}</div>
          </div>
          <div style={{ textAlign: 'right', fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{mi}<div style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-tertiary)' }}>{c}</div></div>
        </div>
      ))}
      <div style={{ height: 6, borderRadius: 3, background: 'var(--border-color)', margin: '6px 0 8px', overflow: 'hidden' }}><div style={{ width: '40%', height: 6, background: 'var(--role-color)' }} /></div>
      <span style={{ display: 'block', textAlign: 'center', padding: '7px 10px', borderRadius: 16, border: '2px solid var(--role-color)', color: 'var(--role-color)', fontSize: 12, fontWeight: 700 }}>+ Log a trip</span>
    </div>
  ),
  mileageFamily: () => (
    <div style={{ padding: '12px 12px 10px', borderRadius: 12, border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}>
      <div style={{ padding: '8px 10px', borderRadius: 10, background: 'var(--color-warning-bg)', marginBottom: 8 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>3.4 mi past your 20-mile cap</div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', margin: '2px 0 6px' }}>Library book drop {'·'} {'“'}Mom asked to return the library books{'”'}</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <span style={{ ...wnPill('var(--role-color)', 'var(--text-on-primary)'), flex: 1, textAlign: 'center' }}>Approve $1.70</span>
          <span style={{ ...wnPill('var(--bg-neutral)', 'var(--text-secondary)'), flex: 1, textAlign: 'center' }}>{'Don’t pay'}</span>
        </div>
      </div>
      {[['CVS Pharmacy', '4.8 mi', '$2.40'], ['Dr. Patel → Kroger', '11.2 mi', '$5.60']].map(([n, mi, c]) => (
        <div key={n} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 2px', borderTop: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>
          <span>{n}</span><span>{mi} {'·'} {c}</span>
        </div>
      ))}
    </div>
  ),
  changeVisitDay: () => (
    <div style={{ padding: '12px 12px 10px', borderRadius: 12, border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--color-purple)', marginBottom: 8 }}>{'⏰'} Change this visit</div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        {[['Day', 'Sat, Nov 14'], ['Start', '9:00 AM'], ['How long', '8 hrs']].map(([l, v]) => (
          <div key={l} style={{ flex: 1 }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 2 }}>{l}</div>
            <div style={{ fontSize: 11.5, padding: '5px 6px', borderRadius: 6, border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}>{v}</div>
          </div>
        ))}
      </div>
      <div style={{ padding: '6px 8px', borderRadius: 8, background: 'var(--color-purple-bg)', fontSize: 12, fontWeight: 700, color: 'var(--color-purple)', marginBottom: 8 }}>Move to Sat, Nov 14 instead of Sat, Nov 7</div>
      <span style={{ ...wnPill('var(--color-purple)', 'var(--text-on-primary)'), display: 'block', textAlign: 'center', padding: '8px 10px' }}>Send to Jane</span>
    </div>
  ),
  // v1.123.0 — a time change says what moves (Pete, 10/19: "9am to 9am makes no sense")
  timeChangeWords: () => (
    <div style={{ padding: '12px 12px 10px', borderRadius: 12, border: '2px solid var(--accent-color)', background: 'var(--bg-attention-card)' }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, color: 'var(--text-tertiary)', marginBottom: 4 }}>{'🕑'} SCHEDULE {'·'} FOR MOM</div>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>Jane asked to end a visit early</div>
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', margin: '4px 0 8px' }}>Thu, Nov 5 {'·'} End at 3:30 PM instead of 5:00 PM {'·'} 6½ hr instead of 8 hr</div>
      {[['Was', '9:00 AM', '5:00 PM', '8 hr', false], ['New', '9:00 AM', '3:30 PM', '6½ hr', true]].map(([l, a, b, h, isNew]) => (
        <div key={l} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '5px 8px', marginBottom: 3, borderRadius: 8, fontSize: 12,
          background: isNew ? 'var(--color-purple-bg)' : 'var(--bg-neutral)', border: isNew ? '1.5px solid var(--color-purple)' : '1.5px solid transparent' }}>
          <span style={{ width: 28, fontSize: 9.5, fontWeight: 800, color: isNew ? 'var(--color-purple)' : 'var(--text-muted)', textTransform: 'uppercase' }}>{l}</span>
          <span style={{ flex: 1, color: 'var(--text-secondary)' }}>{a} {'–'} <span style={isNew ? { color: 'var(--color-purple)', fontWeight: 800 } : {}}>{b}</span></span>
          <span style={{ color: isNew ? 'var(--color-purple)' : 'var(--text-muted)', fontWeight: isNew ? 800 : 400 }}>{h}</span>
        </div>
      ))}
    </div>
  ),
  // v1.120.0 — "Did the check arrive?" (feedback bfbb79bd)
  checkArrived: () => (
    <div style={{ padding: '12px 12px 10px', borderRadius: 12, border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, color: 'var(--text-tertiary)', marginBottom: 4 }}>{'💵'} DID IT ARRIVE?</div>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>Did Sam{'’'}s check for $42.00 arrive?</div>
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', margin: '4px 0 10px' }}>Groceries for Mom {'·'} approved, but nothing has marked it paid.</div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span style={{ ...wnPill('var(--bg-card)', 'var(--role-color)'), border: '1.5px solid var(--role-color)', padding: '8px 14px' }}>Got it</span>
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)', textDecoration: 'underline' }}>Not yet</span>
      </div>
    </div>
  ),
  // v1.120.0 — quiet hours says what it held (feedback 0783ec12)
  whileAway: () => (
    <div style={{ padding: '12px 12px 10px', borderRadius: 12, border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>{'🌙'} While you were away</div>
      {[['6:41 AM', 'Jane checked in'], ['6:55 AM', 'New note about Mom']].map(([t, x]) => (
        <div key={t} style={{ display: 'flex', gap: 8, padding: '5px 8px', marginBottom: 3, borderRadius: 8, background: 'var(--bg-elevated)', fontSize: 12 }}>
          <span style={{ color: 'var(--text-muted)', minWidth: 52 }}>{t}</span>
          <span style={{ flex: 1, color: 'var(--text-primary)' }}>{x}</span>
          <span style={{ color: 'var(--role-color)', fontWeight: 600 }}>Open</span>
        </div>
      ))}
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
            <button onClick={() => { onClose(); if (e.action.focus) window.__pendingFocus = e.action.focus; onNavigate(e.action.page); }}
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
