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
  // v1.133.0 — the + in the bottom bar and its four choices
  quickAdd: () => (
    <div style={{ padding: '12px 10px 10px', borderRadius: 12, border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 4, marginBottom: 10 }}>
        {[['Log visit', '🏡'], ['Add event', '📅'], ['Message Mom', 'M'], ['Request care', '🤝']].map(([t, ic]) => (
          <div key={t} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 34, height: 34, borderRadius: 17, background: ic === 'M' ? 'var(--role-color-light)' : 'var(--bg-surface)', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: ic === 'M' ? 14 : 16, fontWeight: 700, color: 'var(--role-color)' }}>{ic}</span>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-primary)', textAlign: 'center' }}>{t}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'flex-end', borderTop: '1px solid var(--border-color)', paddingTop: 6, fontSize: 10, color: 'var(--text-secondary)' }}>
        <span>Home</span><span>Loved One</span>
        <span style={{ width: 30, height: 30, borderRadius: 15, background: 'var(--role-color)', color: 'var(--text-on-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700, marginTop: -12 }}>+</span>
        <span>Messages</span><span>Account</span>
      </div>
    </div>
  ),
  // v1.133.0 — Got it on Mom's screen, "Mom saw it" in the group
  messageGotIt: () => (
    <div style={{ padding: '12px 12px 10px', borderRadius: 12, border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}>
      <div style={{ ...wnCard, border: '2px solid var(--role-color)' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>Message from Sam</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>Dentist is Friday at 9, Mom</div>
        <div style={{ ...wnPill('var(--role-color)', 'var(--text-on-primary)'), display: 'block', textAlign: 'center', padding: '6px 0' }}>Got it</div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
        <div style={{ textAlign: 'right' }}>
          <span style={{ ...wnPill('var(--role-color)', 'var(--text-on-primary)'), display: 'inline-block', padding: '6px 10px', fontSize: 12 }}>Dentist is Friday at 9, Mom</span>
          <div style={{ fontSize: 10.5, color: 'var(--text-secondary)', marginTop: 3 }}>{'✓'} Mom saw it</div>
        </div>
      </div>
    </div>
  ),
  // v1.135.0 — the 24-hour calendar
  calendar24: () => {
    const row = (day, blocks) => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
        <span style={{ width: 34, fontSize: 10.5, fontWeight: 700, color: 'var(--text-primary)' }}>{day}</span>
        <span style={{ position: 'relative', flex: 1, height: 14, borderRadius: 4, background: 'var(--bg-surface)', boxShadow: 'inset 0 0 0 1px var(--border-color)' }}>
          {blocks.map(([s, e, req, name], i) => (
            <span key={i} style={{ position: 'absolute', left: (s / 24 * 100) + '%', width: ((e - s) / 24 * 100) + '%', top: 0, height: 14, borderRadius: 4,
              background: req ? 'repeating-linear-gradient(135deg, #d9711c 0 4px, #f6c99d 4px 7px)' : 'var(--role-color)',
              color: req ? '#5c2a05' : 'var(--text-on-primary)', fontSize: 9, fontWeight: 600, lineHeight: '14px', paddingLeft: 3, overflow: 'hidden', whiteSpace: 'nowrap' }}>{name}</span>
          ))}
        </span>
      </div>
    );
    return (
      <div style={{ padding: '12px 12px 8px', borderRadius: 12, border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}>
        {row('Mon', [[8, 16, false, 'Sam']])}
        {row('Tue', [[8, 16, false, 'Sam'], [16, 20, true, 'Open']])}
        {row('Wed', [[22, 24, false, 'Jane']])}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-muted)', marginLeft: 40 }}><span>12a</span><span>12p</span><span>12a</span></div>
      </div>
    );
  },
  // v1.134.0 — the caregiver home's optional sections close
  // v1.139.0 — change the series (made-up names)
  changeSeries: () => (
    <div style={{ padding: 12, borderRadius: 12, border: '1px solid var(--border-color)', background: 'var(--bg-card)', fontSize: 12.5 }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 6 }}>Change the series</div>
      <div style={{ ...wnCard, color: 'var(--text-primary)' }}>Starts 10 AM instead of 9 AM {'\u00b7'} $28/hr instead of $25/hr</div>
      <div style={{ ...wnCard, color: 'var(--text-secondary)' }}><b style={{ color: 'var(--text-primary)' }}>Sam{'\u2019'}s 6 visits:</b> Sam will be asked. If Sam says no, they stay the same.</div>
    </div>
  ),
  // v1.138.0 — the thin meds line (made-up names)
  medsLine: () => (
    <div style={{ padding: 12, borderRadius: 12, border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 10px', borderRadius: 10, border: '1px solid var(--border-color)', borderLeft: '3px solid var(--role-color)', fontSize: 12.5, color: 'var(--text-secondary)' }}>
        <span>{'\u{1F48A}'}</span><span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Meds today</span>
        <span>12 PM Sam{'\u2019'}s {'\u00b7'} <span style={{ color: 'var(--color-warning)', fontWeight: 600 }}>9 PM no caregiver on shift</span></span>
      </div>
    </div>
  ),
  // v1.137.0 — Save to care photos (made-up names)
  carePhotoSave: () => (
    <div style={{ padding: '12px 12px 10px', borderRadius: 12, border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>Save to Mom's care photos</div>
      <div style={{ ...wnCard, fontSize: 12.5, color: 'var(--text-primary)', border: '2px solid var(--role-color)' }}>
        <span style={{ fontWeight: 700 }}>The visit with Sam</span> {'·'} Tue, Mar 3
      </div>
      <div style={{ ...wnCard, fontSize: 12.5, color: 'var(--text-secondary)' }}>Just Care photos</div>
    </div>
  ),
  // v1.137.0 — the smaller loved-one card (made-up names)
  smallerLovedOneCard: () => (
    <div style={{ padding: 12, borderRadius: 12, background: 'var(--bg-hero)', color: 'var(--text-on-primary)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 26 }}>{'\u{1F337}'}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>Jane Doe</div>
          <div style={{ fontSize: 11.5, opacity: 0.85 }}>Springfield</div>
        </div>
        <span style={{ opacity: 0.6 }}>{'\u203A'}</span>
      </div>
      <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.15)', fontSize: 12, fontWeight: 600 }}>Jane's Care Team {'·'} 3 members</div>
    </div>
  ),
  // v1.136.0 — the 30-day all-in spend (made-up numbers)
  spend30: () => (
    <div style={{ padding: '12px 12px 10px', borderRadius: 12, border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>Last 30 days, all in</span>
        <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--role-color)' }}>$1,284.00</span>
      </div>
      {[['Caregiver wages', '$1,040.00'], ['InPlace & card fees', '$208.00'], ['Tips', '$36.00']].map(([l, v]) => (
        <div key={l} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-secondary)' }}><span>{l}</span><span>{v}</span></div>
      ))}
    </div>
  ),
  caregiverHomeTidy: () => (
    <div style={{ padding: '12px 12px 10px', borderRadius: 12, border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}>
      <div style={{ ...wnCard, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Keep your account safe</div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Face ID or fingerprint {'·'} about 1 minute</div>
        </div>
        <span style={{ ...wnPill('var(--role-color)', 'var(--text-on-primary)'), padding: '2px 8px' }}>{'\u2715'}</span>
      </div>
      <div style={{ ...wnCard, fontSize: 12.5, color: 'var(--text-primary)' }}>
        <span style={{ fontWeight: 700 }}>Find Work</span> {'·'} Just for you: Tuesday 10 AM
      </div>
    </div>
  ),
  // v1.131.0 — the background check by email
  checkrEmail: () => (
    <div style={{ padding: '12px 12px 10px', borderRadius: 12, border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>Ready for your background check?</div>
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 8 }}>InPlace pays for it. There{'’'}s nothing to pay.</div>
      <div style={{ ...wnCard }}>
        <div style={{ fontSize: 11.5, color: 'var(--color-success)', fontWeight: 600 }}>{'✓'} Approved by InPlace {'·'} Nov 18</div>
      </div>
      <span style={{ ...wnPill('var(--role-color)', 'var(--text-on-primary)'), display: 'inline-block' }}>Continue to Checkr{'’'}s form</span>
    </div>
  ),
  // v1.129.2 — Edit request
  // v1.130.2 — weekly events
  weeklyEvents: () => (
    <div style={{ padding: '12px 12px 10px', borderRadius: 12, border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>Church pickup {'·'} 9:30 AM</div>
      <div style={{ display: 'flex', gap: 5, marginBottom: 8 }}>
        <span style={{ ...wnPill('var(--bg-surface)', 'var(--text-secondary)'), border: '1px solid var(--border-color)' }}>Just once</span>
        <span style={wnPill('var(--role-color)', 'var(--text-on-primary)')}>🔁 Every week on Sunday</span>
      </div>
      {['Sun, Nov 22', 'Sun, Nov 29', 'Sun, Dec 6'].map((d) => (
        <div key={d} style={{ ...wnCard, fontSize: 12, color: 'var(--text-primary)' }}>{d} {'·'} 9:30 AM</div>
      ))}
    </div>
  ),
  // v1.130.1 — what's on the simple screen, I read it, Tell the family
  simpleChoices: () => (
    <div style={{ padding: '12px 12px 10px', borderRadius: 12, border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>What Mom can see</div>
      {[['Notes from the family', true], ['Text button', true], ['Call buttons', false], ['Tell the family', false], ['Coming up', true]].map(([t, on]) => (
        <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-primary)', marginBottom: 3 }}>
          <span style={{ width: 14, height: 14, borderRadius: 3, border: '1.5px solid var(--role-color)', background: on ? 'var(--role-color)' : 'transparent', color: 'var(--text-on-primary)', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{on ? '✓' : ''}</span>{t}
        </div>
      ))}
      <div style={{ fontSize: 11, color: 'var(--color-success)', fontWeight: 600, marginTop: 6 }}>{'✓'} Read today 8:13 PM (8 min)</div>
    </div>
  ),
  // v1.130.0 — the simple phone screen
  simpleScreen: () => (
    <div style={{ padding: '12px 12px 10px', borderRadius: 12, border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 6 }}>Hi Mom!</div>
      <div style={{ ...wnCard, border: '2px solid var(--role-color)' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>From Sam</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>I'll be there at 10. Stay in the house.</div>
      </div>
      <div style={{ ...wnPill('var(--color-success, #1b7a3d)', '#fff'), display: 'block', textAlign: 'center', fontSize: 14, padding: '8px 0', margin: '4px 0 6px' }}>{'📞'} Call Sam</div>
      <div style={{ ...wnCard, fontSize: 12, color: 'var(--text-primary)' }}>Jane comes Thursday at 10:00 AM</div>
    </div>
  ),
  // v1.129.4 — the leader sets up a care recipient's own sign-in
  ownLogin: () => (
    <div style={{ padding: '12px 12px 10px', borderRadius: 12, border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--role-color)', marginBottom: 6 }}>Mom's own sign-in</div>
      <div style={{ ...wnCard, fontSize: 12, color: 'var(--text-secondary)' }}>mom.phone@example.com</div>
      <div style={{ ...wnCard, fontSize: 12, color: 'var(--text-secondary)' }}>{'•••••••••'}</div>
      <div style={{ ...wnPill('var(--role-color)', 'var(--text-on-primary)'), display: 'inline-block', marginTop: 4 }}>Create sign-in</div>
    </div>
  ),
  editRequest: () => (
    <div style={{ padding: '12px 12px 10px', borderRadius: 12, border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>Edit request</div>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
        {[['Companionship', false], ['Personal care', true], ['Meal prep', false]].map(([t, on]) => (
          <span key={t} style={on ? wnPill('var(--role-color)', 'var(--text-on-primary)') : { ...wnPill('var(--bg-surface)', 'var(--text-secondary)'), border: '1px solid var(--border-color)' }}>{t}</span>
        ))}
      </div>
      <div style={{ ...wnCard, fontSize: 12, color: 'var(--text-primary)' }}>Tue 9:00 AM {'\u00B7'} 3h {'\u00B7'} every week {'\u00B7'} Jane only</div>
      <div style={{ ...wnPill('var(--role-color)', 'var(--text-on-primary)'), display: 'inline-block', marginTop: 4 }}>Save changes</div>
    </div>
  ),
  // v1.129.0 — the caregiver Get Ready card
  getReady: () => (
    <div style={{ padding: '12px 12px 10px', borderRadius: 12, border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--accent-color)' }}>Up next</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', margin: '2px 0 8px' }}>2 steps until you can work for the Ellis family</div>
      {[['1', 'What care you\u2019re happy to do', 'Start', true], ['2', 'Where your pay lands', 'Connect bank', false]].map(([n, t, cta, on]) => (
        <div key={n} style={{ ...wnCard, display: 'flex', alignItems: 'center', gap: 8, border: on ? '1px solid var(--role-color)' : wnCard.border }}>
          <span style={{ width: 20, height: 20, borderRadius: 10, background: on ? 'var(--role-color)' : 'var(--border-color)', color: on ? 'var(--text-on-primary)' : 'var(--text-primary)', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{n}</span>
          <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{t}</span>
          <span style={on ? wnPill('var(--role-color)', 'var(--text-on-primary)') : { ...wnPill('var(--bg-surface)', 'var(--text-primary)'), border: '1px solid var(--border-color)' }}>{cta}</span>
        </div>
      ))}
      <div style={{ fontSize: 11, color: 'var(--color-success)', fontWeight: 600, marginTop: 4 }}>{'\u2713'} Account {'\u00B7'} {'\u2713'} ID approved {'\u00B7'} {'\u2713'} Documents</div>
    </div>
  ),
  // v1.128.1 — certain days, for one week only
  daysThisWeek: () => (
    <div style={{ padding: '12px 12px 10px', borderRadius: 12, border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}>
      <div style={{ ...wnHead, margin: '0 0 6px' }}><span>Repeat</span></div>
      <div style={{ display: 'flex', gap: 5, marginBottom: 8 }}>
        {[['One-time', false], ['Weekly', false], ['Certain days', true]].map(([t, on]) => (
          <span key={t} style={on ? wnPill('var(--role-color)', 'var(--text-on-primary)') : { ...wnPill('var(--bg-surface)', 'var(--text-secondary)'), border: '1px solid var(--border-color)' }}>{t}</span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {[['M', true], ['T', true], ['W', true], ['Th', false], ['F', false], ['Sa', false], ['Su', false]].map(([d, on]) => (
          <span key={d} style={{ ...(on ? wnPill('var(--role-color)', 'var(--text-on-primary)') : { ...wnPill('var(--bg-surface)', 'var(--text-tertiary)'), border: '1px solid var(--border-color)' }), minWidth: 22, textAlign: 'center', padding: '4px 4px' }}>{d}</span>
        ))}
      </div>
      <div style={{ ...wnCard, marginBottom: 4, fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)' }}>This week only {'▾'}</div>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Mon, Tue, Wed at 9:00 AM for Mom {'·'} nothing repeats</div>
    </div>
  ),
  // v1.128.0 — a late check-in asks the family instead of cancelling
  checkinChoice: () => (
    <div style={{ padding: '12px 12px 10px', borderRadius: 12, border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Jane hasn{'’'}t checked in</div>
      <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', margin: '2px 0 8px' }}>Mom{'’'}s visit at 9:00 AM {'·'} flexible ({'±'}30 min)</div>
      <div style={{ ...wnHead, margin: '0 0 6px' }}><span>Give Jane more time</span></div>
      <div style={{ display: 'flex', gap: 6 }}>
        {['+15 min', '+30 min', '+60 min'].map((t) => (
          <span key={t} style={{ ...wnPill('var(--accent-color-dark)', 'var(--text-on-primary)'), flex: 1, textAlign: 'center' }}>{t}</span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <span style={{ ...wnPill('var(--bg-surface)', 'var(--text-primary)'), flex: 1, textAlign: 'center', border: '1px solid var(--border-color)' }}>Message Jane</span>
        <span style={{ ...wnPill('var(--bg-surface)', 'var(--color-error)'), flex: 1, textAlign: 'center', border: '1px solid var(--border-color)' }}>Cancel the visit</span>
      </div>
    </div>
  ),
  // v1.127.1 — anyone who can schedule can leave the caregiver instructions
  iphoneUploads: () => (
    <div style={{ padding: '12px', borderRadius: 12, border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>Driver's License (front)</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 8, borderRadius: 8, background: 'var(--bg-primary)' }}>
        <div style={{ width: 64, height: 40, borderRadius: 6, background: 'var(--border-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--text-tertiary)' }}>ID</div>
        <span style={{ flex: 1, fontSize: 12, color: 'var(--text-secondary)' }}>IMG_2041.jpg</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--role-color)' }}>{'\u2713'} Uploaded</span>
      </div>
    </div>
  ),
  teamInstructions: () => (
    <div style={{ padding: '12px 12px 10px', borderRadius: 12, border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--role-color)' }}>Caregiver Instructions</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--role-color)' }}>Edit</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>Lunch at noon, please. The mail key is on the hook by the door.</div>
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 6 }}>Left by Sam {'·'} Read by the caregiver at 9:02</div>
    </div>
  ),
  comingUpSpine: () => {
    const row = (dot, time, title, sub, visit) => (
      <div style={{ display: 'flex', alignItems: 'stretch' }}>
        <div style={{ width: 22, position: 'relative' }}>
          <span style={{ position: 'absolute', left: 9, top: 0, bottom: 0, width: 3, background: 'var(--role-color)' }} />
          <span style={{ position: 'absolute', left: 4, top: 11, width: 13, height: 13, borderRadius: 7, background: dot, boxShadow: '0 0 0 3px var(--bg-card)' }} />
        </div>
        <div style={{ flex: 1, margin: '0 0 6px 4px', padding: '6px 9px', borderRadius: 8, border: visit ? '1px solid var(--role-color)' : '1px solid var(--border-color)', background: visit ? 'var(--bg-highlight)' : 'var(--bg-card)' }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: visit ? 'var(--role-color)' : 'var(--accent-color)' }}>{time}</div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>{title}</div>
          <div style={{ fontSize: 10.5, color: 'var(--text-secondary)' }}>{sub}</div>
        </div>
      </div>
    );
    return (
      <div style={{ padding: '10px 10px 6px', borderRadius: 12, border: '2px solid var(--role-color)', background: 'var(--bg-card)' }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--accent-color)' }}>Coming up</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Tomorrow {'·'} Thu, Nov 5</div>
        <div style={{ fontSize: 10.5, color: 'var(--text-secondary)', marginBottom: 8 }}>3 things for Mom {'·'} all during Jane's visit</div>
        {row('var(--role-color)', '9:00 AM – 5:00 PM', 'Jane', 'with Mom · Companionship · 8 hr', true)}
        {row('var(--accent-color)', '9:30 AM', 'Haircut', 'for Mom')}
        {row('var(--accent-color)', '11:30 AM', 'Lunch at church', 'for Mom')}
      </div>
    );
  },
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
  // v1.126.4 — Google place search in every address box
  placeSearch: () => (
    <div style={{ padding: '12px 12px 10px', borderRadius: 12, border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, color: 'var(--text-tertiary)', marginBottom: 6 }}>LOCATION</div>
      <div style={{ padding: '7px 10px', borderRadius: 8, border: '2px solid var(--role-color)', fontSize: 12.5, color: 'var(--text-primary)', marginBottom: 6 }}>first baptist</div>
      {[['First Baptist Church', '100 Main St, Springfield'], ['First Baptist Church Annex', '12 Elm St, Springfield']].map(([n, a], i) => (
        <div key={n} style={{ padding: '6px 8px', borderTop: i ? '1px solid var(--border-light)' : 'none', background: i ? 'transparent' : 'var(--bg-highlight)', borderRadius: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{n}</div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{a}</div>
        </div>
      ))}
      <div style={{ fontSize: 10, color: 'var(--text-tertiary)', textAlign: 'right', marginTop: 4 }}>Powered by Google</div>
    </div>
  ),
  // v1.127.0 — legs chain from where the last trip ended (Pete, 10/30)
  mileageLegs: () => (
    <div style={{ padding: '12px 12px 10px', borderRadius: 12, border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>Mileage today</div>
      {[['Home → Diner', 'Lunch out', '2.1 mi'], ['Diner → Clinic', 'Shoulder appointment', '3.0 mi'], ['Clinic → Home', 'Back home', '2.6 mi']].map(([r, n, mi]) => (
        <div key={r} style={{ display: 'flex', gap: 8, padding: '6px 0', borderTop: '1px solid var(--border-light)' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{r}</div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{'“'}{n}{'”'}</div>
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{mi}</div>
        </div>
      ))}
      <div style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--text-muted)', margin: '6px 0 4px' }}>FROM</div>
      <div style={{ display: 'flex', gap: 6 }}>
        <span style={{ ...wnPill('var(--role-color-light)', 'var(--role-color-dark)'), flex: 1, textAlign: 'center', border: '2px solid var(--role-color)' }}>Clinic</span>
        <span style={{ ...wnPill('var(--bg-neutral)', 'var(--text-secondary)'), flex: 1, textAlign: 'center' }}>Use my location</span>
      </div>
      <span style={{ display: 'block', textAlign: 'center', marginTop: 6, padding: '6px 10px', borderRadius: 16, border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: 12 }}>{'↩'} Back to Mom{'’'}s home</span>
    </div>
  ),
  // v1.127.0 — appointment recording: pause, honest clock, screen kept on
  recordPause: () => (
    <div style={{ padding: '12px 12px 10px', borderRadius: 12, border: '1px solid var(--color-error)', background: 'var(--bg-card)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--color-error)' }} />
        <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>Recording 14:32</span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', margin: '4px 0 8px' }}>The screen will stay on while recording.</div>
      <div style={{ display: 'flex', gap: 6 }}>
        <span style={{ ...wnPill('var(--bg-neutral)', 'var(--text-primary)'), flex: 1, textAlign: 'center' }}>{'❚❚'} Pause</span>
        <span style={{ ...wnPill('var(--color-error)', 'var(--text-on-primary)'), flex: 1, textAlign: 'center' }}>Stop &amp; file it</span>
      </div>
    </div>
  ),
  // v1.126.1 — visit mileage (Pete, 10/28: "make sure cost/gas is covered")
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
