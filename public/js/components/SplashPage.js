const SplashPage = window.SplashPage = ({ onNavigate, inviteInfo }) => {
  const [signupEmail, setSignupEmail] = React.useState('');
  const [signupRole, setSignupRole] = React.useState('family');
  const [signupStatus, setSignupStatus] = React.useState(null); // null, 'success', 'error'
  const [signupMsg, setSignupMsg] = React.useState('');
  const [signupSubmitting, setSignupSubmitting] = React.useState(false);
  const [showInstallTip, setShowInstallTip] = React.useState(false);

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  const showInstallBtn = !isStandalone;

  const handleSignupSubmit = async (e) => {
    e.preventDefault();
    if (!signupEmail) return;
    setSignupSubmitting(true);
    setSignupStatus(null);
    try {
      const res = await fetch('/api/auth/signup-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: signupEmail, role: signupRole }),
      });
      const data = await res.json();
      if (res.ok) {
        setSignupStatus('success');
        setSignupMsg(data.message);
      } else {
        setSignupStatus('error');
        setSignupMsg(data.error || 'Something went wrong.');
      }
    } catch {
      setSignupStatus('error');
      setSignupMsg('Network error. Please try again.');
    }
    setSignupSubmitting(false);
  };

  const scrollTo = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

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
          <div style={{ fontSize: '18px', fontWeight: 700, color: '#1b6b5a', marginBottom: '4px' }}>
            👋 {inviteInfo.inviterName} invited you to join {inviteInfo.recipientName}'s Care Team
          </div>
          <div style={{ fontSize: '14px', color: '#555', marginBottom: '12px' }}>
            Sign in or create an account to start coordinating care together.
          </div>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => onNavigate('login')} style={{
              padding: '10px 24px', background: '#1b6b5a', color: '#fff', border: 'none',
              borderRadius: '8px', fontSize: '15px', fontWeight: 600, cursor: 'pointer',
            }}>Sign In</button>
            <button onClick={() => onNavigate('register')} style={{
              padding: '10px 24px', background: '#fff', color: '#1b6b5a', border: '2px solid #1b6b5a',
              borderRadius: '8px', fontSize: '15px', fontWeight: 600, cursor: 'pointer',
            }}>Create Account</button>
          </div>
        </div>
      )}
      {/* ── Clean Header: Logo Only ── */}
      <nav className="splash-nav">
        <div className="splash-nav-logo">
          <InPlaceIcon width={36} height={36} />
          <span><span className="logo-in">in</span><span className="logo-place">Place</span></span>
        </div>
        <div className="splash-nav-links">
          {showInstallBtn && (
            <div style={{ position: 'relative' }}>
              <button onClick={() => {
                if (isIOS) {
                  setShowInstallTip(!showInstallTip);
                } else if (window.__pwaInstallPrompt) {
                  window.__pwaInstallPrompt.prompt();
                } else {
                  setShowInstallTip(!showInstallTip);
                }
              }} style={{ background: 'transparent', color: '#1b6b5a', border: '2px solid #1b6b5a', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Install App
              </button>
              {showInstallTip && (
                <div style={{
                  position: 'absolute', top: '100%', right: 0, marginTop: '8px',
                  background: 'white', borderRadius: '12px', padding: '16px 20px',
                  boxShadow: '0 4px 24px rgba(0,0,0,0.15)', width: '280px', zIndex: 1000,
                  fontSize: '14px', color: '#333', lineHeight: 1.6,
                }}>
                  <div style={{ fontWeight: 600, marginBottom: '8px', color: '#1b6b5a' }}>
                    {isIOS ? 'Install on iPhone/iPad' : 'Install InPlace'}
                  </div>
                  {isIOS ? (
                    <div>
                      <p style={{ margin: '0 0 8px' }}>1. Tap the <strong>Share</strong> button <span style={{ fontSize: '16px' }}>⬆</span> at the bottom of Safari</p>
                      <p style={{ margin: '0 0 8px' }}>2. Scroll down and tap <strong>"Add to Home Screen"</strong></p>
                      <p style={{ margin: 0 }}>3. Tap <strong>"Add"</strong> in the top right</p>
                    </div>
                  ) : (
                    <p style={{ margin: 0 }}>Tap the menu (three dots) in your browser and select <strong>"Install app"</strong> or <strong>"Add to Home Screen"</strong>.</p>
                  )}
                  <button onClick={() => setShowInstallTip(false)} style={{
                    marginTop: '12px', padding: '6px 16px', background: '#f0f0f0', border: 'none',
                    borderRadius: '6px', fontSize: '13px', cursor: 'pointer', color: '#666',
                  }}>Got it</button>
                </div>
              )}
            </div>
          )}
        </div>
      </nav>

      {/* ── Hero: The Hook ── */}
      <section className="hero-section" style={{ position: 'relative', overflow: 'hidden', minHeight: '600px' }}>
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          backgroundImage: 'url(https://images.unsplash.com/photo-1556911220-bff31c812dba?w=1600&q=80)',
          backgroundSize: 'cover', backgroundPosition: 'center 40%',
          filter: 'brightness(0.35)',
        }}></div>
        <div className="hero-content" style={{ position: 'relative', zIndex: 1, maxWidth: '900px' }}>
          <div style={{ fontSize: '14px', textTransform: 'uppercase', letterSpacing: '3px', marginBottom: '20px', color: '#e8724a', fontWeight: 600 }}>
            The Future of Home Care
          </div>
          <h1 className="hero-title" style={{ fontSize: '52px', lineHeight: 1.15 }}>
            63 Million Americans Are Caring for an Aging Parent.<br/>
            <span style={{ color: '#e8724a' }}>Most of Them Are Doing It Alone.</span>
          </h1>
          <p className="hero-subtitle" style={{ fontSize: '20px', maxWidth: '700px', margin: '0 auto 40px', opacity: 0.92 }}>
            inPlace is on-demand home care that matches families with vetted caregivers in hours, not weeks. Think of it as the missing infrastructure for aging in place.
          </p>

          {/* Primary CTA Row */}
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap', marginBottom: '12px' }}>
            <button onClick={() => onNavigate('demo')} style={{
              padding: '16px 48px', fontSize: '18px', fontWeight: 600,
              background: '#1b6b5a', color: 'white', border: 'none', borderRadius: '8px',
              cursor: 'pointer', transition: 'all 0.3s',
            }}>View Live Demo</button>
          </div>

        </div>
      </section>

      {/* ── Signup Form — Email-First ── */}
      <section style={{ padding: '48px 32px', background: '#fff', textAlign: 'center' }}>
        <div style={{ maxWidth: '520px', margin: '0 auto' }}>
          <h2 style={{ fontSize: '26px', color: '#1b6b5a', marginBottom: '8px' }}>Get Started</h2>
          <p style={{ fontSize: '15px', color: '#666', marginBottom: '24px' }}>
            Enter your email and we'll send you a link to create your account.
          </p>

          {signupStatus === 'success' ? (
            <div style={{
              background: '#f0faf8', borderRadius: '12px', padding: '28px',
              border: '1px solid #d0e8e3', fontSize: '16px', color: '#1b6b5a',
            }}>
              <div style={{ fontSize: '32px', marginBottom: '8px' }}>&#9993;</div>
              <div style={{ fontWeight: 600, marginBottom: '4px' }}>Check your email!</div>
              <div style={{ fontSize: '14px', color: '#555' }}>{signupMsg}</div>
            </div>
          ) : (
            <form onSubmit={handleSignupSubmit}>
              {/* Role pills */}
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginBottom: '16px' }}>
                <button type="button" onClick={() => setSignupRole('family')} style={{
                  padding: '10px 20px', borderRadius: '24px', fontSize: '14px', fontWeight: 600,
                  border: signupRole === 'family' ? '2px solid #1b6b5a' : '2px solid #ddd',
                  background: signupRole === 'family' ? '#f0faf8' : '#fff',
                  color: signupRole === 'family' ? '#1b6b5a' : '#666',
                  cursor: 'pointer', transition: 'all 0.2s',
                }}>I need care for a loved one</button>
                <button type="button" onClick={() => setSignupRole('caregiver')} style={{
                  padding: '10px 20px', borderRadius: '24px', fontSize: '14px', fontWeight: 600,
                  border: signupRole === 'caregiver' ? '2px solid #1b6b5a' : '2px solid #ddd',
                  background: signupRole === 'caregiver' ? '#f0faf8' : '#fff',
                  color: signupRole === 'caregiver' ? '#1b6b5a' : '#666',
                  cursor: 'pointer', transition: 'all 0.2s',
                }}>I want to provide care</button>
              </div>

              {/* Email + Submit */}
              <div style={{ display: 'flex', gap: '10px', maxWidth: '440px', margin: '0 auto' }}>
                <input
                  type="email" placeholder="Your email address" value={signupEmail} required
                  onChange={(e) => setSignupEmail(e.target.value)}
                  style={{
                    flex: 1, padding: '14px 16px', borderRadius: '8px', border: '1.5px solid #ddd',
                    fontSize: '15px', outline: 'none', color: '#333',
                  }}
                />
                <button type="submit" disabled={signupSubmitting} style={{
                  padding: '14px 24px', background: '#e8724a', color: 'white', border: 'none',
                  borderRadius: '8px', fontSize: '15px', fontWeight: 600, cursor: 'pointer',
                  opacity: signupSubmitting ? 0.7 : 1, transition: 'all 0.3s', whiteSpace: 'nowrap',
                }}>
                  {signupSubmitting ? 'Sending...' : 'Sign Up'}
                </button>
              </div>

              {signupStatus === 'error' && (
                <div style={{ color: '#c0392b', fontSize: '14px', marginTop: '8px' }}>{signupMsg}</div>
              )}

              <div style={{ marginTop: '16px', fontSize: '13px', color: '#888' }}>
                Already have an account?{' '}
                <a onClick={() => onNavigate('login')} style={{ color: '#1b6b5a', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>Sign in</a>
              </div>
            </form>
          )}
        </div>
      </section>

      {/* ── The Problem ── */}
      <section style={{ padding: '80px 32px', background: '#fff' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{ fontSize: '36px', color: '#1b6b5a', marginBottom: '20px' }}>The Problem</h2>
          <p style={{ fontSize: '20px', color: '#333', lineHeight: 1.7, marginBottom: '48px' }}>
            Elder care is broken. Families needing help with an aging parent face two options: expensive agencies charging $5,000 to $10,000 per month, or the impossible task of doing it all themselves. The middle ground — affordable, flexible, on-demand care — simply does not exist.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '32px', justifyContent: 'center' }}>
            <div style={{ padding: '32px', background: '#fef3f0', borderRadius: '12px', flex: '1 1 220px', maxWidth: '320px', textAlign: 'center' }}>
              <div style={{ fontSize: '42px', fontWeight: 700, color: '#e8724a' }}>$5-10K</div>
              <div style={{ fontSize: '14px', color: '#666', marginTop: '8px' }}>Monthly cost of traditional home care agencies</div>
            </div>
            <div style={{ padding: '32px', background: '#fef3f0', borderRadius: '12px', flex: '1 1 220px', maxWidth: '320px', textAlign: 'center' }}>
              <div style={{ fontSize: '42px', fontWeight: 700, color: '#e8724a' }}>3-6 wks</div>
              <div style={{ fontSize: '14px', color: '#666', marginTop: '8px' }}>Average wait time to place a caregiver through an agency</div>
            </div>
            <div style={{ padding: '32px', background: '#fef3f0', borderRadius: '12px', flex: '1 1 220px', maxWidth: '320px', textAlign: 'center' }}>
              <div style={{ fontSize: '42px', fontWeight: 700, color: '#e8724a' }}>60%</div>
              <div style={{ fontSize: '14px', color: '#666', marginTop: '8px' }}>Of family caregivers also hold down a full-time job</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Photo Strip ── */}
      <section className="photo-strip">
        <div style={{
          backgroundImage: 'url(https://images.unsplash.com/photo-1577368211130-4bbd0181ddf0?w=600&q=80)',
          backgroundSize: 'cover', backgroundPosition: 'center',
        }}></div>
        <div style={{
          backgroundImage: 'url(https://images.unsplash.com/photo-1484480974693-6ca0a78fb36b?w=600&q=80)',
          backgroundSize: 'cover', backgroundPosition: 'center 30%',
        }}></div>
        <div style={{
          backgroundImage: 'url(https://images.unsplash.com/photo-1559234938-b60fff04894d?w=600&q=80)',
          backgroundSize: 'cover', backgroundPosition: 'center 20%',
        }}></div>
      </section>

      {/* ── The Solution ── */}
      <section style={{ padding: '80px 32px', background: '#f8f9fa' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{ fontSize: '36px', color: '#1b6b5a', marginBottom: '20px' }}>The Solution</h2>
          <p style={{ fontSize: '20px', color: '#333', lineHeight: 1.7, marginBottom: '48px' }}>
            inPlace is an on-demand platform that matches families with vetted, background-checked caregivers — by the hour, by the visit, on your schedule. Families set the terms. Caregivers get fair pay and flexible work. Everyone gets transparency.
          </p>
          <div className="step-grid" style={{ maxWidth: '900px' }}>
            <div className="step-card">
              <div className="step-number">1</div>
              <h3 className="step-title">Post Your Need</h3>
              <p className="step-description">Tell us what your parent needs — meals, rides, companionship, or full-day care. Set the date, time, and any special instructions.</p>
            </div>
            <div className="step-card">
              <div className="step-number">2</div>
              <h3 className="step-title">Get Matched Fast</h3>
              <p className="step-description">Our system matches you with available, vetted caregivers ranked by experience, proximity, and ratings. No weeks of waiting.</p>
            </div>
            <div className="step-card">
              <div className="step-number">3</div>
              <h3 className="step-title">Care with Confidence</h3>
              <p className="step-description">Get real-time updates, post-visit summaries, photos, and caregiver ratings. Know exactly how your parent is doing.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── The Market ── */}
      <section style={{ padding: '80px 32px', background: '#0f4238', color: 'white' }}>
        <div style={{ maxWidth: '1000px', margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{ fontSize: '36px', marginBottom: '16px', color: 'white' }}>A $200 Billion Market — and Growing</h2>
          <p style={{ fontSize: '18px', opacity: 0.85, marginBottom: '56px', maxWidth: '700px', margin: '0 auto 56px' }}>
            Every single day, 11,200 Americans turn 65. The home care market is massive, fragmented, and ripe for a platform that puts families first.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '32px', justifyContent: 'center' }}>
            <div style={{ padding: '32px', background: 'rgba(255,255,255,0.1)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.15)', flex: '1 1 200px', maxWidth: '240px', textAlign: 'center' }}>
              <div style={{ fontSize: '48px', fontWeight: 700, color: '#e8724a' }}>$200B</div>
              <div style={{ fontSize: '14px', opacity: 0.85, marginTop: '8px' }}>U.S. home care market size</div>
            </div>
            <div style={{ padding: '32px', background: 'rgba(255,255,255,0.1)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.15)', flex: '1 1 200px', maxWidth: '240px', textAlign: 'center' }}>
              <div style={{ fontSize: '48px', fontWeight: 700, color: '#e8724a' }}>63M</div>
              <div style={{ fontSize: '14px', opacity: 0.85, marginTop: '8px' }}>Americans caring for an aging parent</div>
            </div>
            <div style={{ padding: '32px', background: 'rgba(255,255,255,0.1)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.15)', flex: '1 1 200px', maxWidth: '240px', textAlign: 'center' }}>
              <div style={{ fontSize: '48px', fontWeight: 700, color: '#e8724a' }}>11.2K</div>
              <div style={{ fontSize: '14px', opacity: 0.85, marginTop: '8px' }}>Boomers turning 65 every day</div>
            </div>
            <div style={{ padding: '32px', background: 'rgba(255,255,255,0.1)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.15)', flex: '1 1 200px', maxWidth: '240px', textAlign: 'center' }}>
              <div style={{ fontSize: '48px', fontWeight: 700, color: '#e8724a' }}>70%</div>
              <div style={{ fontSize: '14px', opacity: 0.85, marginTop: '8px' }}>Of seniors prefer to age at home</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── The Business Model ── */}
      <section style={{ padding: '80px 32px', background: '#fff' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
          <h2 style={{ fontSize: '36px', color: '#1b6b5a', textAlign: 'center', marginBottom: '48px' }}>How inPlace Makes Money</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '40px', justifyContent: 'center' }}>
            <div style={{ padding: '40px', background: '#f0faf8', borderRadius: '12px', border: '1px solid #d0e8e3', flex: '1 1 280px', maxWidth: '420px' }}>
              <div style={{ fontSize: '16px', fontWeight: 600, color: '#1b6b5a', marginBottom: '12px' }}>Pay-Per-Use, Not Subscription</div>
              <p style={{ fontSize: '15px', color: '#555', lineHeight: 1.6 }}>
                Families pay per session — $45 to $85 depending on service type and duration. No monthly minimums, no long-term contracts. Just care when you need it.
              </p>
            </div>
            <div style={{ padding: '40px', background: '#f0faf8', borderRadius: '12px', border: '1px solid #d0e8e3', flex: '1 1 280px', maxWidth: '420px' }}>
              <div style={{ fontSize: '16px', fontWeight: 600, color: '#1b6b5a', marginBottom: '12px' }}>Platform Commission</div>
              <p style={{ fontSize: '15px', color: '#555', lineHeight: 1.6 }}>
                inPlace takes a 20% commission on each transaction. Caregivers keep 80% and get paid within 48 hours. Both sides get a better deal than traditional agencies.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Personal Story ── */}
      <section style={{ padding: '80px 32px', background: '#f8f9fa' }}>
        <div className="personal-story-grid" style={{ maxWidth: '800px', margin: '0 auto' }}>
          <div style={{
            width: '200px', height: '200px', borderRadius: '50%', overflow: 'hidden',
            backgroundImage: 'url(https://images.unsplash.com/photo-1543269865-cbf427effbad?w=400&q=80)',
            backgroundSize: 'cover', backgroundPosition: 'center',
            border: '4px solid #1b6b5a',
          }}></div>
          <div>
            <h2 style={{ fontSize: '28px', color: '#1b6b5a', marginBottom: '16px' }}>Built from Lived Experience</h2>
            <p style={{ fontSize: '16px', color: '#555', lineHeight: 1.8, marginBottom: '16px' }}>
              inPlace was not born on a whiteboard. It was born from the exhaustion of coordinating care for an aging parent — the late-night calls, the agency runaround, the impossible juggle of work and caregiving.
            </p>
            <p style={{ fontSize: '16px', color: '#555', lineHeight: 1.8 }}>
              This is not a hypothetical problem. It is a deeply personal one. And the solution has to be just as personal — practical, affordable, and built by someone who has been in the trenches.
            </p>
          </div>
        </div>
      </section>

      {/* ── The Bigger Vision ── */}
      <section style={{ padding: '80px 32px', background: 'linear-gradient(135deg, #1b6b5a 0%, #0f4238 100%)', color: 'white' }}>
        <div style={{ maxWidth: '800px', margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{ fontSize: '36px', marginBottom: '24px', color: 'white' }}>The Operating System for Aging in Place</h2>
          <p style={{ fontSize: '18px', opacity: 0.92, lineHeight: 1.7, marginBottom: '40px' }}>
            Today, inPlace matches families with caregivers. Tomorrow, it becomes the coordination layer for everything an aging parent needs — care scheduling, medication tracking, doctor coordination, family communication, and AI-powered health insights. One platform. One family. Complete peace of mind.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px', marginTop: '40px', justifyContent: 'center' }}>
            {[
              { icon: '👩‍⚕️', label: 'Caregiver Matching' },
              { icon: '💊', label: 'Medication Tracking' },
              { icon: '🩺', label: 'Doctor Coordination' },
              { icon: '💬', label: 'Family Messaging' },
              { icon: '🤖', label: 'AI Health Insights' },
              { icon: '💳', label: 'Integrated Payments' },
            ].map((item, i) => (
              <div key={i} style={{
                padding: '20px', background: 'rgba(255,255,255,0.1)', borderRadius: '10px',
                border: '1px solid rgba(255,255,255,0.15)', fontSize: '14px', flex: '1 1 150px', maxWidth: '180px', textAlign: 'center'
              }}>
                <div style={{ fontSize: '28px', marginBottom: '8px' }}>{item.icon}</div>
                {item.label}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Nursing Student Clinical Hours ── */}
      <section style={{ padding: '80px 32px', background: '#fff' }}>
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '56px' }}>
            <div style={{ fontSize: '14px', textTransform: 'uppercase', letterSpacing: '3px', marginBottom: '16px', color: '#1b6b5a', fontWeight: 600 }}>
              For Nursing Students
            </div>
            <h2 style={{ fontSize: '36px', color: '#1b6b5a', marginBottom: '16px' }}>
              Earn Clinical Hours While Making a Real Difference
            </h2>
            <p style={{ fontSize: '18px', color: '#555', maxWidth: '700px', margin: '0 auto', lineHeight: 1.7 }}>
              Nursing and allied health students can earn supervised clinical hours through inPlace — gaining hands-on patient experience with real families while getting paid. It is the practicum that prepares you for the real world, not just the textbook.
            </p>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px', justifyContent: 'center', marginBottom: '56px' }}>
            {[
              { icon: '🩺', title: 'Real Patient Experience', desc: 'Work directly with elderly patients in their homes — medication reminders, mobility assistance, vital sign monitoring, and daily care coordination.' },
              { icon: '📋', title: 'Tracked Clinical Hours', desc: 'Every visit is logged and verified. Export your hours for your nursing program, practicum coordinator, or accreditation requirements.' },
              { icon: '💰', title: 'Get Paid to Learn', desc: 'Unlike unpaid clinical rotations, inPlace students earn competitive pay while building the skills that will define their careers.' },
              { icon: '🎓', title: 'School Partnerships', desc: 'We partner with local nursing programs so your hours count. Your practicum coordinator gets visibility into your placements and progress.' },
              { icon: '📅', title: 'Flexible Around Your Schedule', desc: 'Pick visits that work around your class schedule. Mornings, evenings, weekends — you choose when and where you work.' },
              { icon: '⭐', title: 'Build Your Career Early', desc: 'Graduate with real reviews, verified experience, and a network of families who already trust you. Stand out in a competitive job market.' },
            ].map((item, i) => (
              <div key={i} style={{
                flex: '1 1 280px', maxWidth: '460px', padding: '28px',
                background: '#f0faf8', borderRadius: '12px', border: '1px solid #d0e8e3',
              }}>
                <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                  <div style={{ fontSize: '28px', flexShrink: 0 }}>{item.icon}</div>
                  <div>
                    <div style={{ fontSize: '16px', fontWeight: 600, color: '#1b6b5a', marginBottom: '6px' }}>{item.title}</div>
                    <div style={{ fontSize: '14px', color: '#555', lineHeight: 1.6 }}>{item.desc}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div style={{
            background: 'linear-gradient(135deg, #1b6b5a 0%, #0f4238 100%)',
            borderRadius: '16px', padding: '48px 32px', textAlign: 'center', color: 'white',
          }}>
            <h3 style={{ fontSize: '28px', marginBottom: '12px', color: 'white' }}>The Care Workforce of Tomorrow</h3>
            <p style={{ fontSize: '16px', opacity: 0.9, maxWidth: '600px', margin: '0 auto 20px' }}>
              There are over 250,000 nursing students enrolled in U.S. programs every year — many of them looking for meaningful clinical experience. inPlace connects them with families who need help, creating a pipeline of trained, compassionate caregivers who already know the work before they graduate.
            </p>
            <p style={{ fontSize: '14px', opacity: 0.7 }}>
              Nursing program partnerships launching soon. Join the waitlist to bring inPlace to your school.
            </p>
          </div>
        </div>
      </section>

      {/* ── Working Product CTA ── */}
      <section style={{ padding: '80px 32px', background: '#f8f9fa', textAlign: 'center' }}>
        <div style={{ maxWidth: '700px', margin: '0 auto' }}>
          <h2 style={{ fontSize: '36px', color: '#1b6b5a', marginBottom: '16px' }}>This Is Not a Deck. It Is a Working App.</h2>
          <p style={{ fontSize: '18px', color: '#555', lineHeight: 1.7, marginBottom: '40px' }}>
            inPlace is live today with three working logins — family, caregiver, and care recipient. Real scheduling, real messaging, real caregiver matching. See it for yourself.
          </p>
          <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap', marginBottom: '24px' }}>
            <button onClick={() => onNavigate('demo')} style={{
              padding: '16px 40px', fontSize: '18px', fontWeight: 600,
              background: '#1b6b5a', color: 'white', border: 'none', borderRadius: '8px',
              cursor: 'pointer', transition: 'all 0.3s',
            }}>View Live Demo</button>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════ */}
      {/* ── FOR FAMILY & FRIENDS ── */}
      {/* ══════════════════════════════════════════════════════ */}
      <section id="for-family" style={{ padding: '80px 32px', background: '#f8f9fa' }}>
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '56px' }}>
            <div style={{ fontSize: '14px', textTransform: 'uppercase', letterSpacing: '3px', marginBottom: '16px', color: '#1b6b5a', fontWeight: 600 }}>
              For Family & Friends
            </div>
            <h2 style={{ fontSize: '36px', color: '#1b6b5a', marginBottom: '16px' }}>
              You Shouldn't Have to Choose Between Your Job and Your Parent
            </h2>
            <p style={{ fontSize: '18px', color: '#555', maxWidth: '700px', margin: '0 auto', lineHeight: 1.7 }}>
              You're already doing so much — coordinating doctors, managing medications, worrying at 2 AM. inPlace takes the hardest part off your plate: finding reliable, trustworthy help when you need it most.
            </p>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px', justifyContent: 'center', marginBottom: '56px' }}>
            {[
              { icon: '🔍', title: 'Find Help in Hours, Not Weeks', desc: 'No more calling agencies and waiting. Browse vetted caregivers, read real reviews, and book someone who fits your family\'s needs — today.' },
              { icon: '👨‍👩‍👧‍👦', title: 'Coordinate with Siblings', desc: 'Share your parent\'s care profile with brothers, sisters, and anyone involved. Everyone sees the same schedule, the same notes, the same updates.' },
              { icon: '📊', title: 'See Everything in One Place', desc: 'Care hours, spending, caregiver performance, visit summaries — all tracked automatically. No more spreadsheets or group texts.' },
              { icon: '💰', title: 'Pay Only for What You Need', desc: 'Sessions start at $45. No monthly minimums, no long-term contracts. Need help twice a week? Once a month? It\'s up to you.' },
              { icon: '🛡️', title: 'Background-Checked Caregivers', desc: 'Every caregiver on inPlace is vetted, verified, and reviewed by other families. You\'ll never wonder who\'s walking through your parent\'s door.' },
              { icon: '📱', title: 'Updates That Give You Peace of Mind', desc: 'Get notified when a visit starts, see what happened during care, and message your caregiver directly. Stay connected without hovering.' },
            ].map((item, i) => (
              <div key={i} style={{
                flex: '1 1 280px', maxWidth: '460px', padding: '28px',
                background: 'white', borderRadius: '12px', border: '1px solid #e8e8e8',
                boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
              }}>
                <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                  <div style={{ fontSize: '28px', flexShrink: 0 }}>{item.icon}</div>
                  <div>
                    <div style={{ fontSize: '16px', fontWeight: 600, color: '#1b6b5a', marginBottom: '6px' }}>{item.title}</div>
                    <div style={{ fontSize: '14px', color: '#555', lineHeight: 1.6 }}>{item.desc}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div style={{
            background: 'white', borderRadius: '16px', padding: '40px 32px', textAlign: 'center',
            border: '1px solid #e8e8e8', boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
          }}>
            <p style={{ fontSize: '20px', color: '#1b6b5a', fontWeight: 600, marginBottom: '12px' }}>
              "I built inPlace because I was the family member Googling 'how to find a caregiver' at midnight."
            </p>
            <p style={{ fontSize: '15px', color: '#888' }}>— Pete Lee, Founder</p>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════ */}
      {/* ── FOR CARE RECIPIENTS ── */}
      {/* ══════════════════════════════════════════════════════ */}
      <section id="for-recipients" style={{ padding: '80px 32px', background: '#fff' }}>
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '56px' }}>
            <div style={{ fontSize: '14px', textTransform: 'uppercase', letterSpacing: '3px', marginBottom: '16px', color: '#1b6b5a', fontWeight: 600 }}>
              For Care Recipients
            </div>
            <h2 style={{ fontSize: '36px', color: '#1b6b5a', marginBottom: '16px' }}>
              Stay Independent. Stay Home. Stay You.
            </h2>
            <p style={{ fontSize: '18px', color: '#555', maxWidth: '700px', margin: '0 auto', lineHeight: 1.7 }}>
              You've earned the right to live on your own terms. inPlace helps you get the support you need — without giving up your independence or moving somewhere you don't want to be.
            </p>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '32px', justifyContent: 'center', marginBottom: '56px' }}>
            {[
              { icon: '🏠', title: 'Age in Place', desc: 'Stay in the home you love with help that comes to you. Whether it\'s a few hours a week or daily visits, care is on your terms.' },
              { icon: '🤝', title: 'People You Trust', desc: 'Get matched with caregivers who understand your needs. Build a relationship with someone you actually look forward to seeing.' },
              { icon: '🗓️', title: 'Your Schedule, Your Way', desc: 'See your upcoming visits on a simple calendar. Know who\'s coming, when, and what they\'ll help with — no surprises.' },
              { icon: '✍️', title: 'Your Voice Matters', desc: 'Write personal notes, share preferences, and tell caregivers exactly what works best for you. This is your care.' },
              { icon: '💬', title: 'Stay Connected to Family', desc: 'Your family can see your schedule and updates, so they worry less and you get more of what you actually want — quality time together.' },
              { icon: '🎯', title: 'Help with What You Need', desc: 'Companionship, meal prep, rides to appointments, light housekeeping, medication reminders — pick the services that make your day better.' },
            ].map((item, i) => (
              <div key={i} style={{
                flex: '1 1 280px', maxWidth: '460px', padding: '28px',
                background: '#f0faf8', borderRadius: '12px', border: '1px solid #d0e8e3',
              }}>
                <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                  <div style={{ fontSize: '28px', flexShrink: 0 }}>{item.icon}</div>
                  <div>
                    <div style={{ fontSize: '16px', fontWeight: 600, color: '#1b6b5a', marginBottom: '6px' }}>{item.title}</div>
                    <div style={{ fontSize: '14px', color: '#555', lineHeight: 1.6 }}>{item.desc}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div style={{
            background: '#f0faf8', borderRadius: '16px', padding: '40px 32px', textAlign: 'center',
            border: '1px solid #d0e8e3',
          }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>👵</div>
            <p style={{ fontSize: '20px', color: '#1b6b5a', fontWeight: 600, marginBottom: '8px' }}>
              70% of seniors say they want to age at home.
            </p>
            <p style={{ fontSize: '16px', color: '#555', maxWidth: '500px', margin: '0 auto' }}>
              inPlace was designed to make that possible — with the right help, at the right time, from people who genuinely care.
            </p>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════ */}
      {/* ── FOR CAREGIVERS ── */}
      {/* ══════════════════════════════════════════════════════ */}
      <section id="for-caregivers" style={{ padding: '80px 32px', background: '#f8f9fa' }}>
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '56px' }}>
            <div style={{ fontSize: '14px', textTransform: 'uppercase', letterSpacing: '3px', marginBottom: '16px', color: '#1b6b5a', fontWeight: 600 }}>
              For Caregivers
            </div>
            <h2 style={{ fontSize: '36px', color: '#1b6b5a', marginBottom: '16px' }}>
              A Better Place to Work
            </h2>
            <p style={{ fontSize: '18px', color: '#555', maxWidth: '700px', margin: '0 auto', lineHeight: 1.7 }}>
              Traditional agencies take up to 40% of what families pay. You deserve more. inPlace caregivers keep 80% of every dollar, set their own schedules, and build a reputation that follows them.
            </p>
          </div>

          {/* Stats Row */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px', justifyContent: 'center', marginBottom: '56px' }}>
            {[
              { stat: '80%', desc: 'You keep 80 cents of every dollar families pay' },
              { stat: '$25-35/hr', desc: 'Typical caregiver earnings on inPlace' },
              { stat: 'You Choose', desc: 'Pick your own hours, clients, and services' },
              { stat: '48 hrs', desc: 'Get paid within 48 hours of each visit' },
            ].map((item, i) => (
              <div key={i} style={{
                flex: '1 1 200px', maxWidth: '240px', padding: '28px 20px',
                background: 'white', borderRadius: '12px', textAlign: 'center',
                boxShadow: '0 2px 12px rgba(0,0,0,0.08)', border: '1px solid #e8e8e8',
              }}>
                <div style={{ fontSize: '32px', fontWeight: 700, color: '#1b6b5a', marginBottom: '8px' }}>{item.stat}</div>
                <div style={{ fontSize: '13px', color: '#666', lineHeight: 1.5 }}>{item.desc}</div>
              </div>
            ))}
          </div>

          {/* Benefits + Photo */}
          <div className="caregiver-benefits-grid" style={{ marginBottom: '56px' }}>
            <div>
              <h3 style={{ fontSize: '24px', color: '#1b6b5a', marginBottom: '24px' }}>Why Caregivers Choose inPlace</h3>
              {[
                { icon: '💰', title: 'Higher Pay, Transparent Pricing', desc: 'See exactly what families pay and what you earn. No hidden fees, no surprise deductions.' },
                { icon: '📅', title: 'Flexible Scheduling', desc: 'Work when you want. Accept visits that fit your life — mornings, evenings, weekends, or full days.' },
                { icon: '⭐', title: 'Build Your Reputation', desc: 'Every visit builds your profile with ratings, reviews, and verified experience that attract more clients.' },
                { icon: '🛡️', title: 'Background-Checked & Trusted', desc: 'Our vetting process protects you and the families you serve. Be part of a trusted network.' },
                { icon: '📱', title: 'Easy-to-Use App', desc: 'Manage your schedule, communicate with families, log visits, and track earnings — all in one place.' },
              ].map((benefit, i) => (
                <div key={i} style={{ display: 'flex', gap: '16px', marginBottom: '20px' }}>
                  <div style={{ fontSize: '28px', flexShrink: 0, marginTop: '2px' }}>{benefit.icon}</div>
                  <div>
                    <div style={{ fontSize: '15px', fontWeight: 600, color: '#333', marginBottom: '4px' }}>{benefit.title}</div>
                    <div style={{ fontSize: '14px', color: '#666', lineHeight: 1.6 }}>{benefit.desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{
              borderRadius: '16px', overflow: 'hidden', minHeight: '360px',
              backgroundImage: 'url(https://images.unsplash.com/photo-1516733725897-1aa73b87c8e8?w=800&q=80)',
              backgroundSize: 'cover', backgroundPosition: 'center 30%',
              boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
            }}></div>
          </div>

          {/* How It Works for Caregivers */}
          <div style={{ marginBottom: '48px' }}>
            <h3 style={{ fontSize: '24px', color: '#1b6b5a', textAlign: 'center', marginBottom: '32px' }}>Getting Started Is Simple</h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px', justifyContent: 'center' }}>
              {[
                { step: '1', title: 'Apply Online', desc: 'Fill out a quick application with your experience, availability, and the services you offer.' },
                { step: '2', title: 'Get Verified', desc: 'Complete a background check and identity verification. We handle the process and cover the cost.' },
                { step: '3', title: 'Start Earning', desc: 'Browse available care requests in your area, accept visits that work for you, and get paid fast.' },
              ].map((item, i) => (
                <div key={i} style={{
                  flex: '1 1 260px', maxWidth: '300px', padding: '32px 24px',
                  background: 'white', borderRadius: '12px', textAlign: 'center',
                  boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
                }}>
                  <div style={{
                    width: '48px', height: '48px', borderRadius: '50%', background: '#1b6b5a',
                    color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '20px', fontWeight: 700, margin: '0 auto 16px',
                  }}>{item.step}</div>
                  <div style={{ fontSize: '16px', fontWeight: 600, color: '#333', marginBottom: '8px' }}>{item.title}</div>
                  <div style={{ fontSize: '14px', color: '#666', lineHeight: 1.6 }}>{item.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* CTA */}
          <div style={{
            background: 'linear-gradient(135deg, #1b6b5a 0%, #0f4238 100%)',
            borderRadius: '16px', padding: '48px 32px', textAlign: 'center', color: 'white',
          }}>
            <h3 style={{ fontSize: '28px', marginBottom: '12px', color: 'white' }}>Ready to Make a Difference?</h3>
            <p style={{ fontSize: '16px', opacity: 0.9, marginBottom: '28px', maxWidth: '500px', margin: '0 auto 28px' }}>
              Join a growing network of caregivers who earn more, work flexibly, and build meaningful relationships with the families they serve.
            </p>
            <p style={{ fontSize: '14px', opacity: 0.7 }}>
              Caregiver applications opening soon. Join the waitlist below to be first in line.
            </p>
          </div>
        </div>
      </section>

      {/* ── Bottom CTA ── */}
      <section style={{ padding: '64px 32px', background: 'linear-gradient(135deg, #1b6b5a 0%, #0f4238 100%)', color: 'white', textAlign: 'center' }}>
        <div style={{ maxWidth: '600px', margin: '0 auto' }}>
          <h2 style={{ fontSize: '30px', marginBottom: '12px', color: 'white' }}>Ready to Get Started?</h2>
          <p style={{ fontSize: '16px', opacity: 0.9, marginBottom: '28px' }}>
            Whether you need care for a loved one or want to provide care, we'd love to have you.
          </p>
          <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} style={{
              padding: '14px 32px', background: '#e8724a', color: 'white', border: 'none',
              borderRadius: '8px', fontSize: '16px', fontWeight: 600, cursor: 'pointer',
            }}>Sign Up Now</button>
            <button onClick={() => onNavigate('demo')} style={{
              padding: '14px 32px', background: 'transparent', color: 'white', border: '2px solid rgba(255,255,255,0.5)',
              borderRadius: '8px', fontSize: '16px', fontWeight: 600, cursor: 'pointer',
            }}>View Live Demo</button>
          </div>
        </div>
      </section>

      <footer className="splash-footer">
        <p>&copy; 2026 inPlace. All rights reserved. | Privacy Policy | Terms of Service</p>
        <p style={{ marginTop: '8px', fontSize: '14px', opacity: 0.8 }}>
          <a href="mailto:peter@yourinplace.com" style={{ color: '#1b6b5a', textDecoration: 'none' }}>peter@yourinplace.com</a>
        </p>
        <p style={{ marginTop: '6px', fontSize: '11px', opacity: 0.4 }}>v{window.APP_VERSION || '?'}</p>
      </footer>
    </div>
  );
};
