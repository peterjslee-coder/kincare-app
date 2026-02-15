const SplashPage = window.SplashPage = ({ onNavigate }) => {
  return (
    <div className="splash-page">
      <nav className="splash-nav">
        <div className="splash-nav-logo">
          <KinCareIcon width={40} height={40} />
          KinCare
        </div>
        <div className="splash-nav-links">
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
            53 Million Americans Are Caring for an Aging Parent.<br/>
            <span style={{ color: '#e8724a' }}>Most of Them Are Doing It Alone.</span>
          </h1>
          <p className="hero-subtitle" style={{ fontSize: '20px', maxWidth: '700px', margin: '0 auto 40px', opacity: 0.92 }}>
            KinCare is on-demand home care that matches families with vetted caregivers in hours, not weeks. Think of it as the missing infrastructure for aging in place.
          </p>
          <div className="hero-cta">
            <button onClick={() => onNavigate('login')}>View Live Demo</button>
            <button onClick={() => onNavigate('register')}>Get Started</button>
          </div>
          <div style={{ marginTop: '24px', fontSize: '13px', opacity: 0.7 }}>
            Demo login: pete@kincare.app / kincare123
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '32px' }}>
            <div style={{ padding: '32px', background: '#fef3f0', borderRadius: '12px' }}>
              <div style={{ fontSize: '42px', fontWeight: 700, color: '#e8724a' }}>$5-10K</div>
              <div style={{ fontSize: '14px', color: '#666', marginTop: '8px' }}>Monthly cost of traditional home care agencies</div>
            </div>
            <div style={{ padding: '32px', background: '#fef3f0', borderRadius: '12px' }}>
              <div style={{ fontSize: '42px', fontWeight: 700, color: '#e8724a' }}>3-6 wks</div>
              <div style={{ fontSize: '14px', color: '#666', marginTop: '8px' }}>Average wait time to place a caregiver through an agency</div>
            </div>
            <div style={{ padding: '32px', background: '#fef3f0', borderRadius: '12px' }}>
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
            KinCare is an on-demand platform that matches families with vetted, background-checked caregivers — by the hour, by the visit, on your schedule. Families set the terms. Caregivers get fair pay and flexible work. Everyone gets transparency.
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
          <h2 style={{ fontSize: '36px', marginBottom: '16px', color: 'white' }}>A $470 Billion Market — and Growing</h2>
          <p style={{ fontSize: '18px', opacity: 0.85, marginBottom: '56px', maxWidth: '700px', margin: '0 auto 56px' }}>
            Every single day, 10,000 Americans turn 65. The home care market is massive, fragmented, and ripe for a platform that puts families first.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '32px' }}>
            <div style={{ padding: '32px', background: 'rgba(255,255,255,0.1)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.15)' }}>
              <div style={{ fontSize: '48px', fontWeight: 700, color: '#e8724a' }}>$470B</div>
              <div style={{ fontSize: '14px', opacity: 0.85, marginTop: '8px' }}>U.S. home care market size</div>
            </div>
            <div style={{ padding: '32px', background: 'rgba(255,255,255,0.1)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.15)' }}>
              <div style={{ fontSize: '48px', fontWeight: 700, color: '#e8724a' }}>53M</div>
              <div style={{ fontSize: '14px', opacity: 0.85, marginTop: '8px' }}>Americans caring for aging parents</div>
            </div>
            <div style={{ padding: '32px', background: 'rgba(255,255,255,0.1)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.15)' }}>
              <div style={{ fontSize: '48px', fontWeight: 700, color: '#e8724a' }}>10K</div>
              <div style={{ fontSize: '14px', opacity: 0.85, marginTop: '8px' }}>Boomers turning 65 every day</div>
            </div>
            <div style={{ padding: '32px', background: 'rgba(255,255,255,0.1)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.15)' }}>
              <div style={{ fontSize: '48px', fontWeight: 700, color: '#e8724a' }}>70%</div>
              <div style={{ fontSize: '14px', opacity: 0.85, marginTop: '8px' }}>Of seniors prefer to age at home</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── The Business Model ── */}
      <section style={{ padding: '80px 32px', background: '#fff' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
          <h2 style={{ fontSize: '36px', color: '#1b6b5a', textAlign: 'center', marginBottom: '48px' }}>How KinCare Makes Money</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '40px' }}>
            <div style={{ padding: '40px', background: '#f0faf8', borderRadius: '12px', border: '1px solid #d0e8e3' }}>
              <div style={{ fontSize: '16px', fontWeight: 600, color: '#1b6b5a', marginBottom: '12px' }}>Pay-Per-Use, Not Subscription</div>
              <p style={{ fontSize: '15px', color: '#555', lineHeight: 1.6 }}>
                Families pay per session — $45 to $85 depending on service type and duration. No monthly minimums, no long-term contracts. Just care when you need it.
              </p>
            </div>
            <div style={{ padding: '40px', background: '#f0faf8', borderRadius: '12px', border: '1px solid #d0e8e3' }}>
              <div style={{ fontSize: '16px', fontWeight: 600, color: '#1b6b5a', marginBottom: '12px' }}>Platform Commission</div>
              <p style={{ fontSize: '15px', color: '#555', lineHeight: 1.6 }}>
                KinCare takes a 20% commission on each transaction. Caregivers keep 80% and get paid within 48 hours. Both sides get a better deal than traditional agencies.
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
              KinCare was not born on a whiteboard. It was born from the exhaustion of coordinating care for an aging parent — the late-night calls, the agency runaround, the impossible juggle of work and caregiving.
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
            Today, KinCare matches families with caregivers. Tomorrow, it becomes the coordination layer for everything an aging parent needs — care scheduling, medication tracking, doctor coordination, family communication, and AI-powered health insights. One platform. One family. Complete peace of mind.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '24px', marginTop: '40px' }}>
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
                border: '1px solid rgba(255,255,255,0.15)', fontSize: '14px'
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
            KinCare is live today with three working logins — family, caregiver, and care recipient. Real scheduling, real messaging, real caregiver matching. See it for yourself.
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
            <strong>Demo Credentials:</strong> pete@kincare.app / kincare123
          </div>
        </div>
      </section>

      <footer className="splash-footer">
        <p>&copy; 2025 KinCare. All rights reserved. | Privacy Policy | Terms of Service</p>
      </footer>
    </div>
  );
};
