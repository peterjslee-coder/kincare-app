const CaretakerHub = window.CaretakerHub = () => {
  const [notifications, setNotifications] = useState(true);

  return (
    <div>
      <h1 className="greeting">🩺 Caretaker Hub</h1>
      <div className="card">
        <label className="toggle-label" style={{ marginBottom: '16px' }}>
          <input type="checkbox" className="toggle-input" checked={notifications} onChange={(e) => setNotifications(e.target.checked)} />
          <span><strong>Available for New Shifts</strong></span>
        </label>
        <p className="text-muted">Turn on to receive new care requests matching your preferences</p>
      </div>
      <div className="upcoming-commitments">
        <h3>📅 Upcoming Commitments</h3>
        <div className="commitment-item">
          <div className="commitment-title">Dorothy Chen - Afternoon Companion Care</div>
          <div className="commitment-detail">Today at 2:00 PM - 4:00 PM | $50</div>
        </div>
      </div>
      <div className="earnings-grid">
        <div className="earning-card">
          <div className="earning-amount">$340</div>
          <div className="earning-label">This Month</div>
        </div>
        <div className="earning-card">
          <div className="earning-amount">$125</div>
          <div className="earning-label">Pending Payment</div>
        </div>
      </div>
      <div className="card">
        <div className="card-header">📜 Qualifications</div>
        <div style={{ display: 'grid', gap: '12px' }}>
          <div style={{ padding: '12px', background: '#f8f9fa', borderRadius: '6px' }}>
            <strong>CNA (Certified Nursing Assistant)</strong>
            <p className="text-muted" style={{ fontSize: '13px', marginTop: '4px' }}>License #12345 • Expires 12/2025</p>
          </div>
          <div style={{ padding: '12px', background: '#f8f9fa', borderRadius: '6px' }}>
            <strong>CPR/First Aid Certification</strong>
            <p className="text-muted" style={{ fontSize: '13px', marginTop: '4px' }}>American Red Cross • Expires 03/2026</p>
          </div>
        </div>
      </div>
      <div className="card">
        <div className="card-header">⭐ Reviews (4.8 avg)</div>
        <div className="review-item">
          <div className="review-header">
            <div className="review-name">Betty Lee</div>
            <div className="review-rating">⭐⭐⭐⭐⭐</div>
          </div>
          <div className="review-text">"Maria was wonderful with my mother. She has such a kind and patient demeanor."</div>
        </div>
        <div className="review-item">
          <div className="review-header">
            <div className="review-name">Margaret T.</div>
            <div className="review-rating">⭐⭐⭐⭐</div>
          </div>
          <div className="review-text">"Great caregiver! Always professional and arrives on time."</div>
        </div>
      </div>
    </div>
  );
};
