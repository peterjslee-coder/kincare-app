const SplashPage = window.SplashPage = ({ onNavigate, inviteInfo }) => {
  const [showInstallTip, setShowInstallTip] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState('families');
  const [showStory, setShowStory] = React.useState(false);
  const [storyScroll, setStoryScroll] = React.useState(0);
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isNativeApp = window.Capacitor?.isNativePlatform?.() || false;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  const showInstallBtn = !isStandalone && !isNativeApp;

  const switchTab = (tab) => setActiveTab(tab);

  return (
    <div className="splash-page">
      {/* ── Care Team Invite Banner ── */}
      {inviteInfo && (
        <div style={{
          background: 'linear-gradient(135deg, #e8f5e9 0%, #f0faf8 100%)',
          borderBottom: '2px solid #1b6b5a',
          padding: '16px 20px',
          textAlign: 'center',
          position: 'sticky', top: 0, zIndex: 100,
        }}>
          <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--role-color)', marginBottom: '4px' }}>
            {'\u{1F44B}'} {inviteInfo.inviterName} invited you to join {inviteInfo.recipientName}'s Care Team
          </div>
          <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
            Sign in or create an account to start coordinating care together.
          </div>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => onNavigate('login')} style={{
              padding: '10px 24px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none',
              borderRadius: '8px', fontSize: '15px', fontWeight: 600, cursor: 'pointer',
            }}>Sign In</button>
            <button onClick={() => onNavigate('register')} style={{
              padding: '10px 24px', background: 'var(--bg-surface)', color: 'var(--role-color)', border: '2px solid #1b6b5a',
              borderRadius: '8px', fontSize: '15px', fontWeight: 600, cursor: 'pointer',
            }}>Create Account</button>
          </div>
        </div>
      )}

      {/* ── Nav ── */}
      <nav className="splash-nav-bar" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(0,0,0,0.06)', position: 'sticky', top: inviteInfo ? undefined : 0, zIndex: 99,
      }}>
        <div className="splash-nav-logo" style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '22px', fontWeight: 700 }}>
          <InPlaceIcon width={32} height={32} />
          <span><span className="logo-in">in</span><span className="logo-place">Place</span></span>
        </div>
        <div className="splash-nav-actions" style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          {showInstallBtn && (
            <button onClick={() => {
              if (isIOS) {
                setShowInstallTip(!showInstallTip);
              } else if (window.__pwaInstallPrompt) {
                window.__pwaInstallPrompt.prompt();
              } else {
                setShowInstallTip(!showInstallTip);
              }
            }} style={{
              background: 'transparent', color: 'var(--role-color)', border: '1.5px solid #1b6b5a',
              borderRadius: '8px', padding: '8px 14px', fontSize: '13px', fontWeight: 600,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px',
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Install
            </button>
          )}
          <button className="splash-hide-mobile" onClick={() => setShowStory(true)} style={{
            background: 'none', color: 'var(--role-color)', border: 'none', padding: '8px 16px',
            fontSize: '14px', fontWeight: 500, cursor: 'pointer',
          }}>Our Story</button>
          <button className="splash-hide-mobile" onClick={() => onNavigate('login')} style={{
            background: 'none', color: 'var(--role-color)', border: 'none', padding: '8px 16px',
            fontSize: '14px', fontWeight: 600, cursor: 'pointer',
          }}>Sign In</button>
          <button onClick={() => onNavigate('demo')} style={{
            background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: '8px',
            padding: '10px 22px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
          }}>Try the Demo</button>
        </div>
      </nav>

      {/* ── Hero: Split layout with fade ── */}
      <section className="splash-hero" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', minHeight: '560px', position: 'relative', overflow: 'hidden' }}>
        <div className="splash-hero-text" style={{ padding: '72px 48px 72px 64px', display: 'flex', flexDirection: 'column', justifyContent: 'center', background: 'var(--bg-surface)', position: 'relative', zIndex: 2 }}>
          <h1 className="splash-hero-h1" style={{ fontSize: '44px', lineHeight: 1.18, color: 'var(--text-primary)', marginBottom: '12px' }}>
            On-demand care for your loved one. <span style={{ color: 'var(--accent-color)' }}>Finally.</span>
          </h1>
          <div className="splash-hero-subtitle" style={{ fontSize: '22px', color: 'var(--role-color)', fontWeight: 600, marginBottom: '20px', lineHeight: 1.4 }}>
            Fair wages for caregivers. Real-time peace of mind for families.
          </div>
          <p className="splash-hero-body" style={{ fontSize: '16px', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '16px', maxWidth: '480px' }}>
            inPlace matches families with vetted caregivers in hours — by the visit, no contracts, no agency markup. Caregivers keep 80%. Families see everything in real time.
          </p>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: 'var(--bg-highlight)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '8px 14px', fontSize: '13px', color: 'var(--role-color)', fontWeight: 500, marginBottom: '20px' }}>
            <span style={{ fontSize: '15px' }}>{'\u{1F4CD}'}</span> Launching Spring 2026 in Virginia
          </div>
          <div className="splash-hero-buttons" style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
            <button onClick={() => onNavigate('register')} style={{
              padding: '14px 32px', fontSize: '16px', fontWeight: 600,
              background: 'var(--accent-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: '8px', cursor: 'pointer',
            }}>Sign Up Free</button>
            <button className="splash-show-mobile-only" onClick={() => setShowStory(true)} style={{
              padding: '14px 24px', fontSize: '16px', fontWeight: 600,
              background: '#2563eb', color: 'var(--text-on-primary)', border: 'none', borderRadius: '8px', cursor: 'pointer',
            }}>Our Story</button>
            <button onClick={() => onNavigate('demo')} style={{
              padding: '14px 32px', fontSize: '16px', fontWeight: 600,
              background: 'none', color: 'var(--role-color)', border: '1.5px solid #1b6b5a', borderRadius: '8px', cursor: 'pointer',
            }}>View Live Demo</button>
          </div>
          <div style={{ fontSize: '14px', color: 'var(--text-tertiary)' }}>
            Already have an account?{' '}
            <a onClick={() => onNavigate('login')} style={{ color: 'var(--role-color)', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>Sign in here</a>
          </div>
        </div>
        <div className="splash-hero-image" style={{ position: 'relative' }}>
          {/* Warm gradient fallback — always visible behind the photo */}
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(135deg, #f0faf8 0%, #d4ede8 30%, #e8ddd0 60%, #f5e6d8 100%)',
          }}></div>
          {/* Care-themed decorative elements over the gradient */}
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, zIndex: 0 }}>
            <div style={{ fontSize: 72, opacity: 0.15 }}>{'\u{1F3E0}'}</div>
            <div style={{ display: 'flex', gap: 24, opacity: 0.12 }}>
              <span style={{ fontSize: 36 }}>{'\u{1F9D1}\u{200D}\u{2695}\u{FE0F}'}</span>
              <span style={{ fontSize: 36 }}>{'\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}'}</span>
              <span style={{ fontSize: 36 }}>{'\u2764\uFE0F'}</span>
            </div>
          </div>
          {/* Photo layer — tries local first, then Unsplash CDN */}
          <div style={{
            position: 'absolute', inset: 0, zIndex: 1,
            backgroundImage: 'url(/images/hero-home.jpg)',
            backgroundSize: 'cover', backgroundPosition: 'center 50%',
          }}></div>
          {/* Left fade overlay — gentle blend so text side stays clean */}
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(to right, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0.25) 25%, rgba(255,255,255,0) 45%)',
            zIndex: 2,
          }}></div>
        </div>
      </section>

      {/* ── Value Strip ── */}
      <div className="splash-value-strip" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', background: 'var(--bg-highlight)', borderTop: '1px solid #d0e8e3', borderBottom: '1px solid #d0e8e3' }}>
        {[
          { icon: '\u26A1', title: 'Matched in Hours', desc: 'Not weeks of agency waiting' },
          { icon: '\uD83D\uDCB0', title: 'Caregivers Keep 80%', desc: 'Fair pay, fast payouts' },
          { icon: '\uD83D\uDEE1\uFE0F', title: 'Vetted & Checked', desc: 'Background-verified caregivers' },
          { icon: '\uD83D\uDCF1', title: 'Real-Time Updates', desc: 'Know how your loved one is doing' },
        ].map((item, i) => (
          <div key={i} className="splash-value-item" style={{ padding: '28px 20px', textAlign: 'center', borderRight: i < 3 ? '1px solid #d0e8e3' : 'none' }}>
            <div style={{ fontSize: '28px', marginBottom: '8px' }}>{item.icon}</div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--role-color)', marginBottom: '4px' }}>{item.title}</div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>{item.desc}</div>
          </div>
        ))}
      </div>

      {/* ── Why inPlace ── */}
      <section style={{ padding: '56px 24px', background: 'var(--bg-surface)' }}>
        <div style={{ maxWidth: '780px', margin: '0 auto' }}>
          <h2 style={{ fontSize: '28px', color: 'var(--role-color)', textAlign: 'center', marginBottom: '12px' }}>Why Start Now?</h2>
          <p style={{ fontSize: '16px', color: 'var(--text-secondary)', textAlign: 'center', lineHeight: 1.7, maxWidth: '640px', margin: '0 auto 36px' }}>
            Most families wait until a crisis to look for help. By then, you're making rushed decisions under stress. inPlace is built around a different idea.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px' }}>
            {[
              {
                step: '1',
                title: 'Start Small',
                desc: 'A few hours of companionship a week. A ride to an appointment. Enough to build a real relationship with a caregiver your family trusts.',
                color: 'var(--bg-teal-light)',
              },
              {
                step: '2',
                title: 'Build the Relationship',
                desc: 'Your caregiver learns the routine, the preferences, the little things that matter. Your loved one gets comfortable with someone who genuinely knows them.',
                color: 'var(--color-info-bg)',
              },
              {
                step: '3',
                title: 'Scale When You Need To',
                desc: 'When care needs grow, the support system is already there. No scrambling, no strangers. Just more hours with people who already feel like family.',
                color: 'var(--color-warning-bg)',
              },
            ].map((item, i) => (
              <div key={i} style={{
                padding: '28px 24px', borderRadius: '14px', background: item.color,
                border: '1px solid rgba(0,0,0,0.06)',
              }}>
                <div style={{
                  width: 36, height: 36, borderRadius: '50%', background: 'var(--role-color)', color: 'var(--text-on-primary)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '16px', fontWeight: 700, marginBottom: '14px',
                }}>{item.step}</div>
                <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>{item.title}</div>
                <div style={{ fontSize: '14px', color: 'var(--text-secondary)', lineHeight: 1.65 }}>{item.desc}</div>
              </div>
            ))}
          </div>
          <p style={{ fontSize: '15px', color: 'var(--text-secondary)', textAlign: 'center', lineHeight: 1.7, marginTop: '32px', maxWidth: '580px', margin: '32px auto 0', fontStyle: 'italic' }}>
            The best time to find a caregiver isn't when you're desperate for one. It's before that.
          </p>
        </div>
      </section>

      {/* ── Get Started CTA ── */}
      <section id="splash-signup" style={{ padding: '48px 32px', background: 'var(--bg-surface)', textAlign: 'center' }}>
        <div style={{ maxWidth: '520px', margin: '0 auto' }}>
          <h2 style={{ fontSize: '26px', color: 'var(--role-color)', marginBottom: '8px' }}>Get Started</h2>
          <p style={{ fontSize: '15px', color: 'var(--text-secondary)', marginBottom: '24px' }}>
            In a few minutes, you can be on your way to finding work or a helping hand.
          </p>
          <button onClick={() => onNavigate('register')} style={{
            padding: '16px 48px', fontSize: '17px', fontWeight: 600,
            background: 'var(--accent-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: '10px',
            cursor: 'pointer', transition: 'all 0.2s', marginBottom: '16px',
          }}>Create Your Free Account</button>
          <div style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>
            Already have an account?{' '}
            <a onClick={() => onNavigate('login')} style={{ color: 'var(--role-color)', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>Sign in</a>
          </div>
        </div>
      </section>

      {/* ── Tabbed Audience Sections ── */}
      <section style={{ maxWidth: '960px', margin: '0 auto', padding: '64px 24px' }}>
        <h2 style={{ textAlign: 'center', fontSize: '32px', color: 'var(--role-color)', marginBottom: '8px' }}>Built for Everyone in the Care Circle</h2>
        <p style={{ textAlign: 'center', fontSize: '16px', color: 'var(--text-secondary)', marginBottom: '32px' }}>
          Whether you're a family member, a care recipient, or a caregiver — inPlace was designed for you.
        </p>

        {/* Tab bar */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginBottom: '32px', flexWrap: 'wrap' }}>
          {[
            { id: 'families', label: 'For Families' },
            { id: 'recipients', label: 'For Care Recipients' },
            { id: 'caregivers', label: 'For Caregivers' },
            { id: 'students', label: 'For Nursing Students' },
          ].map(tab => (
            <button key={tab.id} onClick={() => switchTab(tab.id)} style={{
              padding: '12px 28px', borderRadius: '24px', fontSize: '14px', fontWeight: 600,
              cursor: 'pointer', transition: 'all 0.2s',
              border: activeTab === tab.id ? '2px solid #1b6b5a' : '2px solid #e0e0e0',
              background: activeTab === tab.id ? 'var(--role-color)' : 'var(--bg-card)',
              color: activeTab === tab.id ? 'var(--text-on-primary)' : 'var(--text-secondary)',
            }}>{tab.label}</button>
          ))}
        </div>

        {/* ── Families Tab ── */}
        {activeTab === 'families' && (
          <div>
            <div style={{ textAlign: 'center', marginBottom: '32px' }}>
              <h3 style={{ fontSize: '24px', color: 'var(--text-primary)', marginBottom: '8px' }}>You Shouldn't Have to Do This Alone</h3>
              <p style={{ fontSize: '15px', color: 'var(--text-secondary)', maxWidth: '600px', margin: '0 auto', lineHeight: 1.6 }}>
                inPlace takes the hardest part off your plate: finding reliable, trustworthy help when you need it most.
              </p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '16px' }}>
              {[
                { icon: '\uD83D\uDD0D', title: 'Find Help in Hours', desc: 'Browse vetted caregivers, read reviews, book someone who fits — today.' },
                { icon: '\uD83D\uDC65', title: 'Coordinate Together', desc: "Share your care profile with everyone involved. One schedule, one dashboard." },
                { icon: '\uD83D\uDCCA', title: 'Track Everything', desc: 'Care hours, spending, caregiver performance — all in one place.' },
                { icon: '\uD83D\uDCB0', title: 'Pay Only What You Need', desc: 'Sessions from $45. No monthly minimums. No long-term contracts.' },
                { icon: '\uD83D\uDEE1\uFE0F', title: 'Background-Checked', desc: "Every caregiver is vetted, verified, and reviewed by other families." },
                { icon: '\uD83D\uDCF1', title: 'Real-Time Updates', desc: 'Get notified when visits start, see summaries, message caregivers directly.' },
              ].map((c, i) => (
                <div key={i} style={{ padding: '24px', background: 'var(--bg-surface)', borderRadius: '12px', border: '1px solid var(--border-color)', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
                  <div style={{ fontSize: '24px', marginBottom: '10px' }}>{c.icon}</div>
                  <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--role-color)', marginBottom: '6px' }}>{c.title}</div>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>{c.desc}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Recipients Tab ── */}
        {activeTab === 'recipients' && (
          <div>
            <div style={{ textAlign: 'center', marginBottom: '32px' }}>
              <h3 style={{ fontSize: '24px', color: 'var(--text-primary)', marginBottom: '8px' }}>Stay Independent. Stay Home. Stay You.</h3>
              <p style={{ fontSize: '15px', color: 'var(--text-secondary)', maxWidth: '600px', margin: '0 auto', lineHeight: 1.6 }}>
                Get the support you need without giving up your independence.
              </p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '16px' }}>
              {[
                { icon: '\uD83C\uDFE0', title: 'Stay at Home', desc: 'Stay in the home you love with help that comes to you.' },
                { icon: '\uD83E\uDD1D', title: 'People You Trust', desc: 'Build a relationship with caregivers you look forward to seeing.' },
                { icon: '\uD83D\uDDD3\uFE0F', title: 'Your Schedule', desc: "See who's coming, when, and what they'll help with — no surprises." },
                { icon: '\u270D\uFE0F', title: 'Your Voice Matters', desc: 'Share preferences and tell caregivers what works for you.' },
                { icon: '\uD83D\uDCAC', title: 'Stay Connected', desc: 'Your family can see updates so they worry less.' },
                { icon: '\uD83C\uDFAF', title: 'Choose Your Services', desc: 'Companionship, meals, rides, housekeeping — you choose.' },
              ].map((c, i) => (
                <div key={i} style={{ padding: '24px', background: 'var(--bg-surface)', borderRadius: '12px', border: '1px solid var(--border-color)', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
                  <div style={{ fontSize: '24px', marginBottom: '10px' }}>{c.icon}</div>
                  <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--role-color)', marginBottom: '6px' }}>{c.title}</div>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>{c.desc}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Caregivers Tab ── */}
        {activeTab === 'caregivers' && (
          <div>
            <div style={{ textAlign: 'center', marginBottom: '32px' }}>
              <h3 style={{ fontSize: '24px', color: 'var(--text-primary)', marginBottom: '8px' }}>Fair Pay. Flexible Hours. Your Career.</h3>
              <p style={{ fontSize: '15px', color: 'var(--text-secondary)', maxWidth: '600px', margin: '0 auto', lineHeight: 1.6 }}>
                Traditional agencies take up to 40%. On inPlace, you keep 80% and set your own schedule.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap', marginBottom: '24px' }}>
              {[
                { num: '80%', label: 'You keep' },
                { num: '$25-35/hr', label: 'Typical earnings' },
                { num: '48hr', label: 'Payout speed' },
              ].map((s, i) => (
                <div key={i} style={{ flex: '1 1 140px', maxWidth: '180px', padding: '20px', background: 'var(--bg-highlight)', borderRadius: '10px', textAlign: 'center', border: '1px solid #d0e8e3' }}>
                  <div style={{ fontSize: '28px', fontWeight: 700, color: 'var(--role-color)' }}>{s.num}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{s.label}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '16px' }}>
              {[
                { icon: '\uD83D\uDCB0', title: 'Transparent Pay', desc: 'See exactly what families pay and what you earn. No hidden fees.' },
                { icon: '\uD83D\uDCC5', title: 'Flexible Scheduling', desc: 'Work when you want. Accept visits that fit your life.' },
                { icon: '\u2B50', title: 'Build Reputation', desc: 'Every visit builds your profile with ratings and reviews.' },
              ].map((c, i) => (
                <div key={i} style={{ padding: '24px', background: 'var(--bg-surface)', borderRadius: '12px', border: '1px solid var(--border-color)', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
                  <div style={{ fontSize: '24px', marginBottom: '10px' }}>{c.icon}</div>
                  <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--role-color)', marginBottom: '6px' }}>{c.title}</div>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>{c.desc}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Students Tab ── */}
        {activeTab === 'students' && (
          <div>
            <div style={{ textAlign: 'center', marginBottom: '32px' }}>
              <h3 style={{ fontSize: '24px', color: 'var(--text-primary)', marginBottom: '8px' }}>Earn Clinical Hours While Making a Difference</h3>
              <p style={{ fontSize: '15px', color: 'var(--text-secondary)', maxWidth: '600px', margin: '0 auto', lineHeight: 1.6 }}>
                Nursing students gain supervised, hands-on experience with real families — and get paid for it.
              </p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '16px' }}>
              {[
                { icon: '\uD83E\uDE7A', title: 'Real Patient Experience', desc: 'Work with patients in their homes — vitals, mobility, daily care.' },
                { icon: '\uD83D\uDCCB', title: 'Tracked Hours', desc: 'Every visit logged and verified for your nursing program.' },
                { icon: '\uD83D\uDCB0', title: 'Get Paid to Learn', desc: 'Unlike unpaid rotations, earn competitive pay while building skills.' },
                { icon: '\uD83D\uDCC5', title: 'Flex Around Classes', desc: 'Pick visits that work around your schedule.' },
              ].map((c, i) => (
                <div key={i} style={{ padding: '24px', background: 'var(--bg-surface)', borderRadius: '12px', border: '1px solid var(--border-color)', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
                  <div style={{ fontSize: '24px', marginBottom: '10px' }}>{c.icon}</div>
                  <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--role-color)', marginBottom: '6px' }}>{c.title}</div>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>{c.desc}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── Interactive Walkthrough ── */}
      <CareStoryWalkthrough onNavigate={onNavigate} />

      {/* ── AI-Powered Care ── */}
      <section style={{ padding: '64px 32px', background: 'var(--bg-surface)' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '40px' }}>
            <div style={{ display: 'inline-block', padding: '6px 16px', background: 'var(--bg-highlight)', border: '1px solid var(--border-color)', borderRadius: '20px', fontSize: '12px', fontWeight: 600, color: 'var(--role-color)', letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: '12px' }}>AI-Powered</div>
            <h2 style={{ fontSize: '28px', color: 'var(--role-color)', marginBottom: '10px' }}>Smarter Care, Not Just More Care</h2>
            <p style={{ fontSize: '15px', color: 'var(--text-secondary)', maxWidth: '580px', margin: '0 auto', lineHeight: 1.6 }}>
              AI works behind the scenes at every step — matching the right caregiver, tracking care patterns over time, and giving families insights that matter.
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '20px' }}>
            {[
              { icon: '\uD83E\uDDE0', title: 'Intelligent Matching', desc: 'AI considers skills, personality, schedule fit, location, and past family preferences to suggest the best caregiver — not just the nearest one.' },
              { icon: '\uD83D\uDCCA', title: 'Care History & Patterns', desc: 'Every visit builds a living care record. AI spots trends in mood, mobility, and routine — so subtle changes don\'t go unnoticed.' },
              { icon: '\uD83E\uDE7A', title: 'Medical Team Insights', desc: 'Share AI-generated care summaries with your loved one\'s doctors. Weeks of daily observations distilled into what clinicians actually need.' },
              { icon: '\uD83D\uDD14', title: 'Proactive Alerts', desc: 'AI flags things families might miss: skipped medications, mood changes, declining mobility — before they become emergencies.' },
              { icon: '\uD83D\uDCAC', title: 'Visit Summaries', desc: 'After every visit, caregivers log notes and AI helps structure them into clear, readable updates for the whole family.' },
              { icon: '\uD83D\uDD12', title: 'Private & Secure', desc: 'Your family\'s health data is encrypted and never shared with third parties. AI runs for your benefit, not for ads or data mining.' },
            ].map((c, i) => (
              <div key={i} style={{
                padding: '28px 24px', background: 'var(--bg-highlight)', borderRadius: '14px',
                border: '1px solid var(--border-color)', boxShadow: '0 2px 8px rgba(74,95,168,0.04)',
                transition: 'transform 0.2s, box-shadow 0.2s',
              }}>
                <div style={{ fontSize: '28px', marginBottom: '12px' }}>{c.icon}</div>
                <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>{c.title}</div>
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>{c.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Business Model ── */}
      <section style={{ padding: '64px 32px', background: 'var(--bg-surface)' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
          <h2 style={{ fontSize: '28px', color: 'var(--role-color)', textAlign: 'center', marginBottom: '40px' }}>How inPlace Works for Everyone</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '32px', justifyContent: 'center' }}>
            <div style={{ padding: '36px', background: 'var(--bg-highlight)', borderRadius: '12px', border: '1px solid #d0e8e3', flex: '1 1 280px', maxWidth: '420px' }}>
              <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--role-color)', marginBottom: '12px' }}>Pay-Per-Use, Not Subscription</div>
              <p style={{ fontSize: '15px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                Families pay per session — $45 to $85 depending on service type and duration. No monthly minimums, no long-term contracts. Just care when you need it.
              </p>
            </div>
            <div style={{ padding: '36px', background: 'var(--bg-highlight)', borderRadius: '12px', border: '1px solid #d0e8e3', flex: '1 1 280px', maxWidth: '420px' }}>
              <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--role-color)', marginBottom: '12px' }}>Caregivers Keep 80%</div>
              <p style={{ fontSize: '15px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                inPlace takes a 20% commission on each transaction. Caregivers keep 80% and get paid within 48 hours. Both sides get a better deal than traditional agencies.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Vision ── */}
      <section className="splash-vision" style={{ background: 'linear-gradient(135deg, #1b6b5a, #0f4238)', padding: '64px 32px', color: 'var(--text-on-primary)', textAlign: 'center' }}>
        <h2 style={{ fontSize: '30px', marginBottom: '12px', color: 'var(--text-on-primary)' }}>The AI-Powered Operating System for Care at Home</h2>
        <p style={{ fontSize: '16px', opacity: 0.9, maxWidth: '640px', margin: '0 auto 16px', lineHeight: 1.6 }}>
          Today: AI-matched caregivers, intelligent visit summaries, and care pattern tracking.
        </p>
        <p style={{ fontSize: '16px', opacity: 0.9, maxWidth: '640px', margin: '0 auto 36px', lineHeight: 1.6 }}>
          Tomorrow: the complete AI coordination layer — medication adherence, doctor-ready health reports, predictive wellness alerts, and a care record that gets smarter every visit.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px', maxWidth: '820px', margin: '0 auto' }}>
          {[
            { icon: '\uD83E\uDDE0', label: 'AI Caregiver Matching', active: true },
            { icon: '\uD83D\uDCCA', label: 'Care Pattern Analysis', active: true },
            { icon: '\uD83D\uDCAC', label: 'AI Visit Summaries', active: true },
            { icon: '\uD83E\uDE7A', label: 'Doctor-Ready Reports', active: true },
            { icon: '\uD83D\uDC8A', label: 'Medication Intelligence', active: false },
            { icon: '\uD83D\uDD14', label: 'Predictive Health Alerts', active: false },
            { icon: '\uD83D\uDCB3', label: 'Integrated Payments', active: true },
            { icon: '\uD83D\uDC65', label: 'Family Coordination', active: true },
          ].map((item, i) => (
            <div key={i} style={{
              padding: '14px 16px', borderRadius: '10px', fontSize: '13px', fontWeight: 500,
              background: item.active ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)',
              border: item.active ? '1px solid rgba(255,255,255,0.25)' : '1px solid rgba(255,255,255,0.08)',
              opacity: item.active ? 1 : 0.65,
              display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center',
            }}>
              <span style={{ fontSize: '18px' }}>{item.icon}</span>
              <span>{item.label}</span>
              {item.active && <span style={{ fontSize: '9px', background: 'rgba(255,255,255,0.2)', padding: '2px 6px', borderRadius: '4px', fontWeight: 600, letterSpacing: '0.5px' }}>LIVE</span>}
              {!item.active && <span style={{ fontSize: '9px', background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '4px', fontWeight: 600, letterSpacing: '0.5px' }}>SOON</span>}
            </div>
          ))}
        </div>
      </section>

      {/* ── Our Story teaser ── */}
      <section style={{ padding: '40px 32px', background: 'var(--bg-surface)', textAlign: 'center', borderTop: '1px solid #f0f0f0' }}>
        <button onClick={() => setShowStory(true)} style={{
          background: 'none', border: 'none', cursor: 'pointer', padding: '12px 24px',
          display: 'inline-flex', alignItems: 'center', gap: '10px',
        }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'var(--bg-highlight)', border: '2px solid #d0e8e3', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', flexShrink: 0 }}>
            {'\u{1F468}\u200D\u{1F469}\u200D\u{1F466}'}
          </div>
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--role-color)' }}>Why I Built inPlace</div>
            <div style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>A personal story from our founder</div>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--role-color)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: '4px' }}><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </section>

      {/* ── Bottom CTA ── */}
      <section style={{ padding: '56px 32px', textAlign: 'center', background: 'var(--bg-surface)' }}>
        <h2 style={{ fontSize: '28px', color: 'var(--role-color)', marginBottom: '10px' }}>Ready to Get Started?</h2>
        <p style={{ fontSize: '16px', color: 'var(--text-secondary)', marginBottom: '24px' }}>
          Whether you need care for a loved one or want to provide care, we'd love to have you.
        </p>
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => onNavigate('register')} style={{
            padding: '14px 36px', fontSize: '16px', fontWeight: 600,
            background: 'var(--accent-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: '8px', cursor: 'pointer',
          }}>Sign Up Now</button>
          <button onClick={() => onNavigate('demo')} style={{
            padding: '14px 36px', fontSize: '16px', fontWeight: 600,
            background: 'none', color: 'var(--role-color)', border: '1.5px solid #1b6b5a', borderRadius: '8px', cursor: 'pointer',
          }}>View Live Demo</button>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="splash-footer">
        <p>&copy; 2026 inPlace. All rights reserved. | <a href="/legal/privacy.html" style={{ color: 'var(--role-color)', textDecoration: 'none' }}>Privacy Policy</a> | <a href="/legal/terms.html" style={{ color: 'var(--role-color)', textDecoration: 'none' }}>Terms of Service</a></p>
        <p style={{ marginTop: '8px', fontSize: '14px', opacity: 0.8 }}>
          <a href="mailto:peter@yourinplace.com" style={{ color: 'var(--role-color)', textDecoration: 'none' }}>peter@yourinplace.com</a>
        </p>
        <p style={{ marginTop: '6px', fontSize: '11px', opacity: 0.4 }}>v{window.APP_VERSION || '?'}</p>
      </footer>

      {/* ── Our Story Modal ── */}
      {showStory && (
        <div onClick={() => setShowStory(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 10000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '24px', backdropFilter: 'blur(4px)',
          animation: 'fadeIn 0.25s ease',
        }}>
          <div onClick={(e) => e.stopPropagation()} onScroll={(e) => setStoryScroll(e.target.scrollTop)} className="story-modal-content" style={{
            background: 'var(--bg-surface)', borderRadius: '16px', maxWidth: '680px', width: '100%',
            maxHeight: '85vh', overflow: 'auto', position: 'relative',
            boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          }}>
            {/* Header */}
            <div style={{ position: 'relative', padding: '32px 40px 0', borderRadius: '16px 16px 0 0' }}>
              <button onClick={() => setShowStory(false)} style={{
                position: 'absolute', top: '12px', right: '12px',
                background: 'var(--badge-muted-bg)', border: 'none', borderRadius: '50%',
                width: '36px', height: '36px', fontSize: '18px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)',
              }}>{'\u2715'}</button>
              <h2 style={{ fontSize: '24px', color: 'var(--text-primary)', marginBottom: '2px', fontWeight: 700 }}>Why I Built inPlace</h2>
              <div style={{ fontSize: '14px', color: 'var(--text-tertiary)', marginBottom: '24px' }}>Pete Lee, Founder</div>
            </div>

            {/* Photo — fades/washes out as user scrolls into the story */}
            {(() => {
              const fadeStart = 30;   // px of scroll before fade begins
              const fadeEnd = 220;    // px of scroll where photo is fully gone
              const progress = Math.min(1, Math.max(0, (storyScroll - fadeStart) / (fadeEnd - fadeStart)));
              const photoOpacity = 1 - progress;
              const photoScale = 1 - (progress * 0.04);
              return (
                <div style={{
                  padding: '0 40px 24px', textAlign: 'center',
                  opacity: photoOpacity,
                  transform: `scale(${photoScale})`,
                  transition: 'opacity 0.05s ease-out, transform 0.05s ease-out',
                  pointerEvents: photoOpacity < 0.1 ? 'none' : 'auto',
                }}>
                  <img src="/images/mom-and-pete.jpg" alt="Pete and his mom" style={{
                    width: '100%', maxWidth: '480px', borderRadius: '12px',
                    boxShadow: `0 4px 16px rgba(0,0,0,${0.1 * photoOpacity})`,
                  }} />
                  <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '8px', fontStyle: 'italic' }}>Pete and his mom</div>
                </div>
              );
            })()}

            {/* Story content */}
            <div style={{ padding: '0 40px 48px', fontSize: '15px', color: 'var(--text-primary)', lineHeight: 1.8 }}>
              <p style={{ marginBottom: '20px', fontSize: '16px', color: 'var(--text-primary)', fontWeight: 500, lineHeight: 1.7 }}>
                I built inPlace because it's what my family needs to keep Mom at home — and because my community deserves a better way to give and receive care.
              </p>
              <p style={{ marginBottom: '16px' }}>
                I spent 25 years in the military. It was the kind of career I loved, but there was a cost I didn't fully reckon with until later. While I was deployed or stationed around the world, my mom was getting older. My siblings picked up a huge share of the load, and I'm grateful — but they have their own lives too. We're all stretched.
              </p>
              <p style={{ marginBottom: '16px' }}>
                What Mom wants is simple: to stay in her own home. Her flower beds, her kitchen, her neighborhood. She doesn't need 24-hour care or a facility. She just needs someone checking in regularly — helping with meals, making sure she takes her medications, driving her to appointments, keeping her company. That kind of help shouldn't be this hard to find.
              </p>
              <p style={{ marginBottom: '16px' }}>
                And it's not just about aging parents. People recovering from injuries, managing chronic conditions, or living with disabilities need that same kind of regular, dependable support. Not institutionalized care — just a steady hand nearby.
              </p>
              <p style={{ marginBottom: '16px' }}>
                There's another side of this too. Nursing students, retirees, and people who genuinely care about others would be incredible caregivers if someone just connected them with families who need help. Agencies take huge cuts and treat caregivers like replaceable parts. The people doing this work deserve to be paid fairly.
              </p>
              <p style={{ marginBottom: '0' }}>
                What's missing isn't willingness — it's the connection. Families don't know who to trust. Caregivers don't know where to find work that values them. inPlace is the bridge. I hope it helps you keep your loved ones where they want to be.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Install Instructions Modal (rendered at root to escape nav stacking context) ── */}
      {showInstallTip && (
        <div onClick={() => setShowInstallTip(false)} style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.4)', zIndex: 10000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '20px', boxSizing: 'border-box',
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: 'var(--bg-surface)', borderRadius: '16px', padding: '28px 24px',
            boxShadow: '0 8px 40px rgba(0,0,0,0.2)', width: '100%', maxWidth: '340px',
            fontSize: '14px', color: 'var(--text-primary)', lineHeight: 1.6, textAlign: 'center',
          }}>
            <div style={{ fontSize: '18px', fontWeight: 700, marginBottom: '4px', color: 'var(--role-color)' }}>
              Install InPlace
            </div>
            <p style={{ margin: '0 0 16px', fontSize: '13px', color: 'var(--text-tertiary)' }}>
              Add to your home screen for the best experience
            </p>

            {isIOS && (
              <div style={{ textAlign: 'left', marginBottom: '16px' }}>
                <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text-primary)', marginBottom: '10px', paddingBottom: '6px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '18px' }}>{'\uD83C\uDF10'}</span> Safari
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', fontSize: '13px', color: 'var(--text-primary)' }}>
                    <span style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--role-color)', color: 'var(--text-on-primary)', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>1</span>
                    <span>Tap the <strong>Share</strong> button <span style={{ fontSize: 16 }}>{'\u2B06\uFE0E'}</span> at the bottom of your screen</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', fontSize: '13px', color: 'var(--text-primary)' }}>
                    <span style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--role-color)', color: 'var(--text-on-primary)', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>2</span>
                    <span>Scroll down and tap <strong>"Add to Home Screen"</strong></span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', fontSize: '13px', color: 'var(--text-primary)' }}>
                    <span style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--role-color)', color: 'var(--text-on-primary)', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>3</span>
                    <span>Tap <strong>"Add"</strong> in the top right</span>
                  </div>
                </div>
              </div>
            )}

            {!isIOS && (
              <div style={{ textAlign: 'left', marginBottom: '16px' }}>
                <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text-primary)', marginBottom: '10px', paddingBottom: '6px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '18px' }}>{'\uD83C\uDF10'}</span> Chrome
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', fontSize: '13px', color: 'var(--text-primary)' }}>
                    <span style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--role-color)', color: 'var(--text-on-primary)', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>1</span>
                    <span>Tap the <strong>three dots</strong> <strong>{'\u22EE'}</strong> menu in the top right</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', fontSize: '13px', color: 'var(--text-primary)' }}>
                    <span style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--role-color)', color: 'var(--text-on-primary)', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>2</span>
                    <span>Tap <strong>"Add to Home screen"</strong> or <strong>"Install app"</strong></span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', fontSize: '13px', color: 'var(--text-primary)' }}>
                    <span style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--role-color)', color: 'var(--text-on-primary)', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>3</span>
                    <span>Tap <strong>"Install"</strong> to confirm</span>
                  </div>
                </div>
              </div>
            )}

            <button onClick={(e) => { e.stopPropagation(); setShowInstallTip(false); }} style={{
              marginTop: '8px', padding: '10px 32px', background: 'var(--role-color)', border: 'none',
              borderRadius: '8px', fontSize: '14px', fontWeight: 700, cursor: 'pointer', color: 'var(--text-on-primary)',
            }}>Got it</button>
          </div>
        </div>
      )}
    </div>
  );
};
