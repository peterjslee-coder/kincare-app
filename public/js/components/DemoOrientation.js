// ─── Demo Orientation (v1.105.98) ───
//
// Pete: "It's laborious to click and drag through three separate pages of disclosure for a
// demo. No one is reading it. What would be useful is a quick, no-more-than-one-screen summary
// with an acknowledgement at the bottom of the highlights."
//
// He is right on both counts. Three scroll-to-the-bottom contracts in front of a demo is a
// consent ritual performed on someone who is not a client, cannot become one by clicking, and
// has nothing at stake — so it teaches them nothing and costs us the visitor. Worse, the old
// flow wrote the result into user_legal_acceptances, an audit trail whose whole value is that
// it records real people agreeing to real versions.
//
// So demo accounts no longer have pending legal documents at all (auth.js, legal.js). This
// screen replaces them: one screen, no scroll gate, one button. It is a SUMMARY and says so,
// and it links to the full documents for anyone who wants them.
//
// Every claim below is drawn from the signed documents rather than written fresh:
//   - what InPlace is / is not       -> Terms of Use, section 2 ("What InPlace Care Is / Is Not")
//   - caregivers set their own hours -> Caregiver Agreement, Art. II section 1(c),(d)
//   - non-medical, no medications    -> Client Services Agreement, sections 2 and 3
//   - emergencies are 911            -> Client Services Agreement, Emergencies
//   - we never sell your data        -> Privacy Policy, Plain English summary
//   - Virginia law                   -> Terms of Use, Plain English summary (Governing Law)
// Anything that cannot be traced to a document does not belong on this screen.

const DemoOrientation = window.DemoOrientation = ({ onAcknowledge }) => {
  const points = [
    {
      icon: '📅',
      title: 'InPlace is the hub, not the care',
      body: 'Scheduling, payments, messaging and visit logs in one place, so a family spread across three states can still see the same picture.',
    },
    {
      icon: '🤝',
      title: 'Caregivers are independent, and stay that way',
      body: 'They are not our employees. They set their own hours and their own rates, and accept or decline any request. Caregivers keep 80% of what a family pays.',
    },
    {
      icon: '🩺',
      title: 'We do not provide or coordinate medical care',
      body: 'InPlace is not a home health agency and gives no medical advice. Caregivers help with everyday life — meals, companionship, personal care, getting around. They can remind someone about medication; they never administer it or make medical decisions. In an emergency, everyone calls 911.',
    },
    {
      icon: '🔍',
      title: 'Caregivers are vetted — and you still choose',
      body: 'Background checks and ID verification, plus reviews from other families. We do not guarantee the outcome of anyone’s care, and who comes into the house is always the family’s decision.',
    },
    {
      icon: '🔒',
      title: 'We never sell your data',
      body: 'Care information goes to the people on the care team who need it, and to the services that keep the platform running. Nowhere else, and never to advertisers.',
    },
    {
      icon: '📍',
      title: 'Live in Virginia, in limited early access',
      body: 'InPlace operates in Virginia today, starting in the New River Valley, and is expanding from there. Agreements are governed by Virginia law.',
    },
  ];

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10050,
      background: 'var(--bg-primary)', overflowY: 'auto',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '24px 16px',
    }}>
      <div style={{ width: '100%', maxWidth: 620 }}>

        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <div style={{
            display: 'inline-block', padding: '4px 12px', borderRadius: 20,
            background: 'var(--color-info-bg)', color: 'var(--color-info)',
            fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
            marginBottom: 10,
          }}>Demo</div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: 'var(--text-primary)' }}>
            The short version, before you look around
          </h1>
          <p style={{ margin: '8px auto 0', maxWidth: 470, fontSize: 14, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
            You{'’'}re about to explore a demo account {'—'} made-up people, made-up money.
            Nothing here is an agreement and nothing you click signs anything. This is simply what
            InPlace is, in plain language.
          </p>
        </div>

        <div style={{ display: 'grid', gap: 10, marginBottom: 18 }}>
          {points.map((p, i) => (
            <div key={i} style={{
              display: 'flex', gap: 12, alignItems: 'flex-start',
              padding: '13px 15px', borderRadius: 11,
              background: 'var(--bg-card)', border: '1px solid var(--border-color)',
            }}>
              <span style={{ fontSize: 18, lineHeight: 1.3, flexShrink: 0 }}>{p.icon}</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>
                  {p.title}
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--text-secondary)' }}>
                  {p.body}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div style={{
          padding: '12px 15px', borderRadius: 11, marginBottom: 16,
          background: 'var(--bg-neutral)', border: '1px solid var(--border-color)',
          fontSize: 12.5, lineHeight: 1.6, color: 'var(--text-tertiary)',
        }}>
          This is a summary written for the demo, not the agreements themselves. Creating a real
          account asks you to read and accept the full{' '}
          <a href="/legal/terms.html" target="_blank" rel="noopener noreferrer"
            style={{ color: 'var(--role-color)', fontWeight: 600 }}>Terms of Use</a>{' and '}
          <a href="/legal/privacy.html" target="_blank" rel="noopener noreferrer"
            style={{ color: 'var(--role-color)', fontWeight: 600 }}>Privacy Policy</a>, plus the
          services agreement for your role. They{'’'}re linked here in case you{'’'}d
          rather read them now.
        </div>

        <button onClick={onAcknowledge} style={{
          width: '100%', padding: '15px 24px', borderRadius: 10, border: 'none',
          background: 'var(--accent-color)', color: 'var(--text-on-primary)',
          fontSize: 16, fontWeight: 700, cursor: 'pointer',
        }}>
          Got it {'—'} start exploring
        </button>

        <div style={{ textAlign: 'center', marginTop: 12, marginBottom: 8, fontSize: 12, color: 'var(--text-muted)' }}>
          Cedar Rock Holdings, LLC, doing business as InPlace Care {'·'} Fairlawn, Virginia
        </div>
      </div>
    </div>
  );
};
