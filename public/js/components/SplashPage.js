const SplashPage = window.SplashPage = ({ onNavigate }) => {
  const testimonials = [
    { text: "KinCare gave me peace of mind knowing my mother is receiving compassionate, professional care. The real-time updates and caregiver matching are fantastic.", author: "Margaret T.", role: "Age 72, Boston MA", avatar: "https://picsum.photos/80/80?random=1" },
    { text: "Managing care for both of our aging parents was overwhelming. KinCare's coordinated scheduling and vetted caregivers made everything so much easier.", author: "David & Lisa R.", role: "Adult Children, Portland OR", avatar: "https://picsum.photos/80/80?random=2" },
    { text: "As a caregiver on KinCare, I love the flexibility and the ability to provide quality care to people who truly need it. The platform values both caregivers and families.", author: "Sarah M., RN", role: "Professional Caregiver, Seattle WA", avatar: "https://picsum.photos/80/80?random=3" }
  ];

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
      <section className="hero-section">
        <div className="hero-content">
          <h1 className="hero-title">On-Demand Care for Your Loved Ones</h1>
          <p className="hero-subtitle">Connect with vetted, AI-matched caregivers for personalized home care services.</p>
          <div className="hero-cta">
            <button onClick={() => onNavigate('register')}>Start Free Trial</button>
            <button onClick={() => onNavigate('login')}>View Demo</button>
          </div>
        </div>
      </section>
      <section className="features-section">
        <h2>Why Choose KinCare?</h2>
        <div className="features-grid">
          <div className="feature-card">
            <div className="feature-icon">🤖</div>
            <h3 className="feature-title">AI-Matched Caregivers</h3>
            <p className="feature-description">Our intelligent matching system finds caregivers perfectly suited to your loved one's unique needs and personality.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">📱</div>
            <h3 className="feature-title">Real-Time Updates</h3>
            <p className="feature-description">Stay connected with live messaging, photos, and detailed activity logs from each care session.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">✓</div>
            <h3 className="feature-title">Background Verified</h3>
            <p className="feature-description">All caregivers undergo comprehensive background checks and reference verification for peace of mind.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">📅</div>
            <h3 className="feature-title">Flexible Scheduling</h3>
            <p className="feature-description">Schedule care on your terms—hourly, daily, weekly, or as-needed. Full control over when and how often.</p>
          </div>
        </div>
      </section>
      <section className="how-it-works">
        <h2>How It Works</h2>
        <div className="step-grid">
          <div className="step-card">
            <div className="step-number">1</div>
            <h3 className="step-title">Create Profile</h3>
            <p className="step-description">Tell us about your loved one's needs, health conditions, and preferences.</p>
          </div>
          <div className="step-card">
            <div className="step-number">2</div>
            <h3 className="step-title">Match with Caregivers</h3>
            <p className="step-description">Our AI connects you with pre-vetted caregivers who are the perfect fit.</p>
          </div>
          <div className="step-card">
            <div className="step-number">3</div>
            <h3 className="step-title">Get Quality Care</h3>
            <p className="step-description">Enjoy peace of mind with professional, compassionate care and real-time updates.</p>
          </div>
        </div>
      </section>
      <section className="testimonials-section">
        <h2>Stories from Our Community</h2>
        <div className="testimonials-grid">
          {testimonials.map((t, i) => (
            <div key={i} className="testimonial-card">
              <p className="testimonial-text">"{t.text}"</p>
              <div className="testimonial-author">
                <img src={t.avatar} alt={t.author} className="testimonial-avatar" />
                <div>
                  <div style={{ fontWeight: 600, color: '#333' }}>{t.author}</div>
                  <div className="testimonial-role">{t.role}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="become-caregiver-section">
        <h2>Join Our Caregiver Network</h2>
        <p>Help families while earning flexible income. Become a trusted caregiver today.</p>
        <button onClick={() => onNavigate('register')}>Become a Caregiver</button>
      </section>
      <section className="pricing-section">
        <h2>Simple, Transparent Pricing</h2>
        <div className="pricing-grid">
          <div className="pricing-card">
            <h3>KinCare Beta</h3>
            <div className="pricing-price">Free</div>
            <p style={{ color: '#6c757d', marginBottom: '24px' }}>Limited time offer</p>
            <ul className="pricing-features">
              <li>Up to 10 hours/month care</li>
              <li>1 care recipient</li>
              <li>Email support</li>
              <li>Basic activity tracking</li>
            </ul>
            <button className="btn btn-primary" style={{ width: '100%', marginTop: '24px' }}>Get Started</button>
          </div>
          <div className="pricing-card featured">
            <h3>Standard</h3>
            <div className="pricing-price">$49<span>/mo</span></div>
            <p style={{ color: '#6c757d', marginBottom: '24px' }}>Coming soon</p>
            <ul className="pricing-features">
              <li>Unlimited hours</li>
              <li>Up to 3 care recipients</li>
              <li>Priority support</li>
              <li>Advanced messaging</li>
              <li>Health tracking</li>
            </ul>
            <button className="btn btn-primary" style={{ width: '100%', marginTop: '24px', opacity: 0.6, cursor: 'not-allowed' }}>Coming Soon</button>
          </div>
          <div className="pricing-card">
            <h3>Premium</h3>
            <div className="pricing-price">$99<span>/mo</span></div>
            <p style={{ color: '#6c757d', marginBottom: '24px' }}>Coming soon</p>
            <ul className="pricing-features">
              <li>Everything in Standard</li>
              <li>Unlimited care recipients</li>
              <li>24/7 phone support</li>
              <li>AI health insights</li>
              <li>Dedicated care coordinator</li>
            </ul>
            <button className="btn btn-primary" style={{ width: '100%', marginTop: '24px', opacity: 0.6, cursor: 'not-allowed' }}>Coming Soon</button>
          </div>
        </div>
        <div className="demo-credentials">
          <strong>Demo Credentials:</strong> pete@kincare.app / kincare123
        </div>
      </section>
      <footer className="splash-footer">
        <p>&copy; 2025 KinCare. All rights reserved. | Privacy Policy | Terms of Service</p>
      </footer>
    </div>
  );
};
