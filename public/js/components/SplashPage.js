const SplashPage = window.SplashPage = ({ onNavigate }) => {
  const [waitlistEmail, setWaitlistEmail] = React.useState('');
  const [waitlistName, setWaitlistName] = React.useState('');
  const [waitlistStatus, setWaitlistStatus] = React.useState(null); // 'success' | 'exists' | 'error'
  const [waitlistMsg, setWaitlistMsg] = React.useState('');
  const [waitlistSubmitting, setWaitlistSubmitting] = React.useState(false);

  const handleWaitlistSubmit = async (e) => {
    e.preventDefault();
    if (!waitlistEmail) return;
    setWaitlistSubmitting(true);
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: waitlistEmail, name: waitlistName }),
      });
      const data = await res.json();
      if (res.ok) {
        setWaitlistStatus(data.alreadyExists ? 'exists' : 'success');
        setWaitlistMsg(data.message);
        if (!data.alreadyExists) { setWaitlistEmail(''); setWaitlistName(''); }
      } else {
        setWaitlistStatus('error');
        setWaitlistMsg(data.error || 'Something went wrong.');
      }
    } catch {
      setWaitlistStatus('error');
      setWaitlistMsg('Network error. Please try again.');
    }
    setWaitlistSubmitting(false);
  };

  return (
    <div className="splash-page">
      <nav className="splash-nav">
        <div className="splash-nav-logo">
          <InPlaceIcon width={36} height={36} />
          <span><span className="logo-in">in</span><span className="logo-place">Place</span></span>
        </div>
        <div className="splash-nav-links">
          <button onClick={() => document.getElementById('caregivers-join').scrollIntoView({ behavior: 'smooth' })} style={{ background: 'transparent', color: '#e8724a', border: '2px solid #e8724a' }}>For Caregivers</button>
          <button onClick={() => onNavigate('login')}>Sign In</button>
          <button onClick={() => onNavigate('register')}>Get Started</button>
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
          <div className="hero-cta">
            <button onClick={() => onNavigate('login')}>View Live Demo</button>
            <button onClick={() => onNavigate('register')}>Get Started</button>
          </div>
          <div style={{ marginTop: '24px', fontSize: '13px', opacity: 0.7 }}>
            Demo login: pete@inplace.care / inplace123
          </div>
        </div>
      </section>

      {/* ── The Problem ── */}
      <section style={{ padding: '80px 32px', background: '#fff' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{ fontSize: '36px', color: '#1b6b5a', marginBottom: '20px' }}>The Problem</h2>
          <p style={{ fontSize: '20px', color: '#333', lineHeight: 1.7, marginBottom: '48px' }}>
            There is no Uber for elder care. Families needing help with an aging parent face two options: expensive agencies charging $5,000 to $10,000 per month, or the impossible task of doing it all themselves. The middle ground — affordable, flexible, on-demand care — simply does not exist.
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
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0', height: '300px', overflow: 'hidden' }}>
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
        <div style={{ maxWidth: '800px', margin: '0 auto', display: 'grid', gridTemplateColumns: '200px 1fr', gap: '48px', alignItems: 'center' }}>
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

      {/* ── Working Product CTA ── */}
      <section style={{ padding: '80px 32px', background: '#fff', textAlign: 'center' }}>
        <div style={{ maxWidth: '700px', margin: '0 auto' }}>
          <h2 style={{ fontSize: '36px', color: '#1b6b5a', marginBottom: '16px' }}>This Is Not a Deck. It Is a Working App.</h2>
          <p style={{ fontSize: '18px', color: '#555', lineHeight: 1.7, marginBottom: '40px' }}>
            inPlace is live today with three working logins — family, caregiver, and care recipient. Real scheduling, real messaging, real caregiver matching. See it for yourself.
          </p>
          <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap', marginBottom: '24px' }}>
            <button onClick={() => onNavigate('login')} style={{
              padding: '16px 40px', fontSize: '18px', fontWeight: 600,
              background: '#1b6b5a', color: 'white', border: 'none', borderRadius: '8px',
              cursor: 'pointer', transition: 'all 0.3s',
            }}>View Live Demo</button>
            <button onClick={() => onNavigate('register')} style={{
              padding: '16px 40px', fontSize: '18px', fontWeight: 600,
              background: '#e8724a', color: 'white', border: 'none', borderRadius: '8px',
              cursor: 'pointer', transition: 'all 0.3s',
            }}>Create an Account</button>
          </div>
          <div className="demo-credentials">
            <strong>Demo Credentials:</strong> pete@inplace.care / inplace123
          </div>
        </div>
      </section>

      {/* ── Caregiver Recruitment ── */}
      <section id="caregivers-join" style={{ padding: '80px 32px', background: '#f8f9fa' }}>
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '56px' }}>
            <div style={{ fontSize: '14px', textTransform: 'uppercase', letterSpacing: '3px', marginBottom: '16px', color: '#e8724a', fontWeight: 600 }}>
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

          {/* Two-Column: Benefits + Photo */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '48px', alignItems: 'center', marginBottom: '56px' }}>
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
              borderRadius: '16px', overflow: 'hidden', height: '500px',
              backgroundImage: 'url(https://images.unsplash.com/photo-1576765608535-5f04d1e3f289?w=600&q=80)',
              backgroundSize: 'cover', backgroundPosition: 'center',
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
            <button onClick={() => onNavigate('register')} style={{
              padding: '16px 48px', fontSize: '18px', fontWeight: 600,
              background: '#e8724a', color: 'white', border: 'none', borderRadius: '8px',
              cursor: 'pointer', transition: 'all 0.3s',
            }}>Apply to Be a Caregiver</button>
            <div style={{ marginTop: '16px', fontSize: '13px', opacity: 0.7 }}>
              No fees to join. Start earning within days of approval.
            </div>
          </div>
        </div>
      </section>

      {/* ── Email Capture / Waitlist ── */}
      <section style={{ padding: '64px 32px', background: 'linear-gradient(135deg, #1b6b5a 0%, #0f4238 100%)', color: 'white', textAlign: 'center' }}>
        <div style={{ maxWidth: '600px', margin: '0 auto' }}>
          <h2 style={{ fontSize: '30px', marginBottom: '12px', color: 'white' }}>Get Early Access</h2>
          <p style={{ fontSize: '16px', opacity: 0.9, marginBottom: '32px' }}>
            We're opening beta to families in select metro areas. Drop your email and we'll let you know when it's your turn.
          </p>
          {waitlistStatus === 'success' || waitlistStatus === 'exists' ? (
            <div style={{
              background: 'rgba(255,255,255,0.15)', borderRadius: '10px', padding: '24px',
              border: '1px solid rgba(255,255,255,0.25)', fontSize: '16px',
            }}>
              {waitlistMsg}
            </div>
          ) : (
            <form onSubmit={handleWaitlistSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: '12px', width: '100%', flexWrap: 'wrap', justifyContent: 'center' }}>
                <input
                  type="text" placeholder="Your name (optional)" value={waitlistName}
                  onChange={(e) => setWaitlistName(e.target.value)}
                  style={{
                    flex: '1 1 180px', maxWidth: '220px', padding: '14px 16px', borderRadius: '8px', border: 'none',
                    fontSize: '15px', outline: 'none', color: '#333',
                  }}
                />
                <input
                  type="email" placeholder="Your email" value={waitlistEmail} required
                  onChange={(e) => setWaitlistEmail(e.target.value)}
                  style={{
                    flex: '1 1 220px', maxWidth: '280px', padding: '14px 16px', borderRadius: '8px', border: 'none',
                    fontSize: '15px', outline: 'none', color: '#333',
                  }}
                />
                <button type="submit" disabled={waitlistSubmitting} style={{
                  padding: '14px 28px', background: '#e8724a', color: 'white', border: 'none',
                  borderRadius: '8px', fontSize: '15px', fontWeight: 600, cursor: 'pointer',
                  opacity: waitlistSubmitting ? 0.7 : 1, transition: 'all 0.3s',
                }}>
                  {waitlistSubmitting ? 'Joining...' : 'Join Waitlist'}
                </button>
              </div>
              {waitlistStatus === 'error' && (
                <div style={{ color: '#ffb4a0', fontSize: '14px', marginTop: '4px' }}>{waitlistMsg}</div>
              )}
              <div style={{ fontSize: '12px', opacity: 0.6, marginTop: '4px' }}>No spam. Just an update when beta opens in your area.</div>
            </form>
          )}
        </div>
      </section>

      <footer className="splash-footer">
        <p>&copy; 2026 inPlace. All rights reserved. | Privacy Policy | Terms of Service</p>
      </footer>
    </div>
  );
};
