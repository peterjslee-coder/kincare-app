const CaretakerHub = window.CaretakerHub = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('schedule');
  const [visitLogSession, setVisitLogSession] = useState(null);
  const [logSummary, setLogSummary] = useState('');
  const [logMood, setLogMood] = useState('good');
  const [logNotes, setLogNotes] = useState('');
  const [submittingLog, setSubmittingLog] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await apiFetch('/api/dashboard');
        if (res?.ok) {
          const d = await res.json();
          setData(d);
        }
      } catch (err) {
        console.error('CaretakerHub fetch error:', err);
      }
      setLoading(false);
    };
    fetchData();
  }, []);

  const handleSubmitVisitLog = async () => {
    if (!visitLogSession || !logSummary.trim()) return;
    setSubmittingLog(true);
    try {
      const res = await apiFetch('/api/activity/visit-log', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: visitLogSession.id,
          summary: logSummary,
          moodRating: logMood,
          notes: logNotes || null,
        }),
      });
      if (res?.ok) {
        setVisitLogSession(null);
        setLogSummary('');
        setLogMood('good');
        setLogNotes('');
        // Refresh data
        const refreshRes = await apiFetch('/api/dashboard');
        if (refreshRes?.ok) setData(await refreshRes.json());
      }
    } catch (err) {
      console.error('Visit log error:', err);
    }
    setSubmittingLog(false);
  };

  if (loading) return <LoadingSpinner text="Loading your dashboard..." />;
  if (!data) return <EmptyState icon="⚠️" title="Couldn't load dashboard" text="Please try refreshing the page." />;

  const profile = data.profile || {};
  const assignments = data.assignments || [];
  const sessions = data.upcomingSessions || [];
  const reviews = data.reviews || [];
  const stats = data.stats || {};

  const tabs = [
    { id: 'schedule', label: 'Schedule', icon: '📅' },
    { id: 'families', label: 'My Families', icon: '👪' },
    { id: 'map', label: 'Area Map', icon: '🗺️' },
    { id: 'earnings', label: 'Earnings', icon: '💰' },
    { id: 'reviews', label: 'Reviews', icon: '⭐' },
  ];

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h1 className="greeting" style={{ marginBottom: '4px' }}>Welcome, {profile.name || 'Caregiver'}!</h1>
          <div style={{ color: '#666', fontSize: '14px' }}>
            {profile.city}, {profile.state} &bull; {profile.specialties?.join(', ')}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            padding: '6px 14px',
            background: profile.isAvailable ? '#e8f5e9' : '#fce4ec',
            color: profile.isAvailable ? '#2e7d32' : '#c62828',
            borderRadius: '20px', fontSize: '13px', fontWeight: 600,
          }}>
            {profile.isAvailable ? 'Available' : 'Unavailable'}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '20px', fontWeight: 700, color: '#1b6b5a' }}>⭐ {profile.rating || '—'}</div>
            <div style={{ fontSize: '11px', color: '#999' }}>{profile.reviewCount || 0} reviews</div>
          </div>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="stats-grid">
        <div className="stat-card">
          <div style={{ fontSize: 24 }}>👪</div>
          <div className="stat-number">{stats.assignedFamilies || 0}</div>
          <div className="stat-label">Assigned Families</div>
        </div>
        <div className="stat-card">
          <div style={{ fontSize: 24 }}>✅</div>
          <div className="stat-number">{stats.completedThisMonth || 0}</div>
          <div className="stat-label">Completed This Month</div>
        </div>
        <div className="stat-card">
          <div style={{ fontSize: 24 }}>⏱️</div>
          <div className="stat-number">{stats.hoursThisMonth || 0}h</div>
          <div className="stat-label">Hours This Month</div>
        </div>
        <div className="stat-card">
          <div style={{ fontSize: 24 }}>💰</div>
          <div className="stat-number">${stats.monthlyEarnings || 0}</div>
          <div className="stat-label">Earned This Month</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '20px', borderBottom: '2px solid #e0e0e0', paddingBottom: '0' }}>
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
            padding: '10px 16px', border: 'none', background: 'none', cursor: 'pointer',
            fontSize: '13px', fontWeight: activeTab === tab.id ? 700 : 400,
            color: activeTab === tab.id ? '#1b6b5a' : '#888',
            borderBottom: activeTab === tab.id ? '3px solid #1b6b5a' : '3px solid transparent',
            marginBottom: '-2px', transition: 'all 0.15s',
          }}>
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'schedule' && (
        <div>
          <div className="card">
            <div className="card-header"><span className="card-icon">📅</span>Upcoming Sessions</div>
            {sessions.length > 0 ? (
              <ul className="sessions-list">
                {sessions.map((s, idx) => (
                  <li key={idx} className="session-item">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ flex: 1 }}>
                        <div className="session-time">{s.date} at {s.time}</div>
                        <div className="session-caregiver" style={{ fontWeight: 600 }}>{s.recipientName}</div>
                        <div style={{ fontSize: '12px', color: '#888' }}>{s.location}</div>
                        <span className="session-type">{s.serviceType}</span>
                        {s.specialInstructions && (
                          <div style={{ fontSize: '12px', color: '#666', marginTop: '4px', fontStyle: 'italic' }}>
                            Note: {s.specialInstructions}
                          </div>
                        )}
                      </div>
                      <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end' }}>
                        <span style={{
                          padding: '4px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 600,
                          background: s.status === 'confirmed' ? '#e8f5e9' : '#fff3e0',
                          color: s.status === 'confirmed' ? '#2e7d32' : '#e65100',
                          textTransform: 'capitalize',
                        }}>{s.status}</span>
                        <span style={{ fontSize: '12px', color: '#666' }}>{s.durationHours}h &bull; ${s.estimatedCost}</span>
                        {s.status === 'confirmed' && (
                          <button onClick={() => setVisitLogSession(s)} style={{
                            padding: '4px 10px', background: '#1b6b5a', color: '#fff', border: 'none',
                            borderRadius: '6px', fontSize: '11px', cursor: 'pointer', fontWeight: 600,
                          }}>Log Visit</button>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : <div style={{ padding: '20px', color: '#999', textAlign: 'center' }}>No upcoming sessions</div>}
          </div>
        </div>
      )}

      {activeTab === 'families' && (
        <div>
          {assignments.length > 0 ? assignments.map((a, idx) => (
            <div key={idx} className="card" style={{ marginBottom: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h3 style={{ margin: '0 0 4px', color: '#333' }}>
                    {a.recipient_first_name} {a.recipient_last_name}
                  </h3>
                  <div style={{ fontSize: '13px', color: '#666', marginBottom: '4px' }}>
                    Family: {a.family_first_name} {a.family_last_name}
                  </div>
                  <div style={{ fontSize: '13px', color: '#888' }}>
                    📍 {a.location_address ? `${a.location_address}, ` : ''}{a.location_city}, {a.location_state}
                  </div>
                  {a.health_conditions && a.health_conditions.length > 0 && (
                    <div style={{ marginTop: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {a.health_conditions.map((hc, i) => (
                        <span key={i} style={{
                          padding: '3px 8px', background: '#fff3e0', color: '#e65100',
                          borderRadius: '12px', fontSize: '11px',
                        }}>{hc}</span>
                      ))}
                    </div>
                  )}
                  {a.preferences && (
                    <div style={{ fontSize: '12px', color: '#666', marginTop: '6px', fontStyle: 'italic' }}>
                      Preferences: {a.preferences}
                    </div>
                  )}
                </div>
                {a.is_favorite === 1 && (
                  <span style={{ fontSize: '20px' }} title="Favorite assignment">⭐</span>
                )}
              </div>
            </div>
          )) : <div style={{ padding: '20px', color: '#999', textAlign: 'center' }}>No assigned families</div>}
        </div>
      )}

      {activeTab === 'map' && (
        <div className="card">
          <div className="card-header"><span className="card-icon">🗺️</span>Blacksburg, VA Area</div>
          <div style={{
            position: 'relative', height: '400px', background: '#e8f0e8', borderRadius: '8px',
            overflow: 'hidden', border: '1px solid #ccc',
          }}>
            {/* Notional map background */}
            <div style={{
              position: 'absolute', inset: 0,
              background: 'linear-gradient(135deg, #d4e8d4 0%, #c5dbc5 30%, #b8d0b8 50%, #c8dcc8 70%, #d0e0d0 100%)',
            }}></div>
            {/* Road grid */}
            <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
              <line x1="20%" y1="0" x2="20%" y2="100%" stroke="#bbb" strokeWidth="1.5" />
              <line x1="50%" y1="0" x2="50%" y2="100%" stroke="#aaa" strokeWidth="2" />
              <line x1="80%" y1="0" x2="80%" y2="100%" stroke="#bbb" strokeWidth="1.5" />
              <line x1="0" y1="30%" x2="100%" y2="30%" stroke="#bbb" strokeWidth="1.5" />
              <line x1="0" y1="55%" x2="100%" y2="55%" stroke="#aaa" strokeWidth="2" />
              <line x1="0" y1="80%" x2="100%" y2="80%" stroke="#bbb" strokeWidth="1.5" />
              <text x="50%" y="52%" textAnchor="middle" fill="#777" fontSize="11" fontFamily="sans-serif">Main St</text>
              <text x="18%" y="96%" fill="#777" fontSize="10" fontFamily="sans-serif">Prices Fork Rd</text>
              <text x="72%" y="12%" fill="#777" fontSize="10" fontFamily="sans-serif">S Main St</text>
            </svg>
            {/* Assignment pins */}
            {assignments.map((a, idx) => {
              // Spread pins across the map based on index
              const positions = [
                { left: '35%', top: '40%' },
                { left: '65%', top: '25%' },
                { left: '25%', top: '70%' },
                { left: '70%', top: '65%' },
              ];
              const pos = positions[idx % positions.length];
              return (
                <div key={idx} style={{
                  position: 'absolute', left: pos.left, top: pos.top, transform: 'translate(-50%, -100%)',
                  zIndex: 10,
                }}>
                  <div style={{
                    background: '#1b6b5a', color: '#fff', padding: '4px 8px', borderRadius: '8px 8px 8px 0',
                    fontSize: '11px', fontWeight: 600, whiteSpace: 'nowrap', boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
                  }}>
                    📍 {a.recipient_first_name} {a.recipient_last_name}
                    <div style={{ fontSize: '9px', fontWeight: 400, opacity: 0.8 }}>{a.location_city}</div>
                  </div>
                </div>
              );
            })}
            {/* Center label */}
            <div style={{
              position: 'absolute', bottom: '12px', left: '50%', transform: 'translateX(-50%)',
              background: 'rgba(255,255,255,0.9)', padding: '6px 16px', borderRadius: '20px',
              fontSize: '12px', color: '#555', boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
            }}>
              Blacksburg, VA &bull; New River Valley
            </div>
          </div>
          <div style={{ marginTop: '12px', fontSize: '12px', color: '#999', textAlign: 'center' }}>
            Notional map view — live mapping coming soon
          </div>
        </div>
      )}

      {activeTab === 'earnings' && (
        <div>
          <div className="earnings-grid">
            <div className="earning-card">
              <div className="earning-amount">${stats.monthlyEarnings || 0}</div>
              <div className="earning-label">Earned This Month</div>
            </div>
            <div className="earning-card">
              <div className="earning-amount">${stats.pendingEarnings || 0}</div>
              <div className="earning-label">Pending Payment</div>
            </div>
          </div>
          <div className="card">
            <div className="card-header"><span className="card-icon">📊</span>Monthly Summary</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div style={{ padding: '12px', background: '#f8f9fa', borderRadius: '6px' }}>
                <div style={{ fontSize: '11px', color: '#888', textTransform: 'uppercase' }}>Sessions Completed</div>
                <div style={{ fontSize: '24px', fontWeight: 700, color: '#333' }}>{stats.completedThisMonth || 0}</div>
              </div>
              <div style={{ padding: '12px', background: '#f8f9fa', borderRadius: '6px' }}>
                <div style={{ fontSize: '11px', color: '#888', textTransform: 'uppercase' }}>Hours Worked</div>
                <div style={{ fontSize: '24px', fontWeight: 700, color: '#333' }}>{stats.hoursThisMonth || 0}</div>
              </div>
              <div style={{ padding: '12px', background: '#f8f9fa', borderRadius: '6px' }}>
                <div style={{ fontSize: '11px', color: '#888', textTransform: 'uppercase' }}>Hourly Rate</div>
                <div style={{ fontSize: '24px', fontWeight: 700, color: '#333' }}>${profile.hourlyRate || '—'}/hr</div>
              </div>
              <div style={{ padding: '12px', background: '#f8f9fa', borderRadius: '6px' }}>
                <div style={{ fontSize: '11px', color: '#888', textTransform: 'uppercase' }}>Mileage</div>
                <div style={{ fontSize: '24px', fontWeight: 700, color: '#999' }}>—</div>
                <div style={{ fontSize: '10px', color: '#aaa' }}>Coming soon</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'reviews' && (
        <div>
          <div className="card">
            <div className="card-header"><span className="card-icon">⭐</span>Reviews ({profile.rating || '—'} avg, {profile.reviewCount || 0} total)</div>
            {reviews.length > 0 ? reviews.map((r, idx) => (
              <div key={idx} className="review-item">
                <div className="review-header">
                  <div className="review-name">{r.reviewerName}</div>
                  <div className="review-rating">{'⭐'.repeat(r.rating)}</div>
                </div>
                {r.comment && <div className="review-text">{r.comment}</div>}
                <div style={{ fontSize: '11px', color: '#999', marginTop: '4px' }}>{r.createdAt}</div>
              </div>
            )) : <div style={{ padding: '20px', color: '#999', textAlign: 'center' }}>No reviews yet</div>}
          </div>

          {/* Certifications */}
          <div className="card">
            <div className="card-header"><span className="card-icon">📜</span>Certifications</div>
            <div style={{ display: 'grid', gap: '12px' }}>
              {(profile.certifications || []).map((cert, idx) => (
                <div key={idx} style={{ padding: '12px', background: '#f8f9fa', borderRadius: '6px' }}>
                  <strong>{cert}</strong>
                </div>
              ))}
              {(!profile.certifications || profile.certifications.length === 0) && (
                <div style={{ color: '#999', padding: '12px' }}>No certifications listed</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Visit Log Modal */}
      {visitLogSession && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{
            background: '#fff', borderRadius: '12px', padding: '24px', width: '480px', maxWidth: '90vw',
            maxHeight: '90vh', overflow: 'auto',
          }}>
            <h3 style={{ marginTop: 0 }}>Log Visit — {visitLogSession.recipientName}</h3>
            <p style={{ fontSize: '13px', color: '#666' }}>
              {visitLogSession.date} at {visitLogSession.time} &bull; {visitLogSession.serviceType}
            </p>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>Visit Summary *</label>
              <textarea value={logSummary} onChange={e => setLogSummary(e.target.value)}
                placeholder="How did the visit go? What activities did you do together?"
                style={{ width: '100%', minHeight: '80px', padding: '10px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '13px', resize: 'vertical' }}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>Mood / Condition</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                {['great', 'good', 'fair', 'difficult'].map(m => (
                  <button key={m} onClick={() => setLogMood(m)} style={{
                    padding: '6px 14px', borderRadius: '16px', border: logMood === m ? '2px solid #1b6b5a' : '2px solid #ddd',
                    background: logMood === m ? '#e8f5f1' : '#fff', cursor: 'pointer', fontSize: '12px',
                    fontWeight: logMood === m ? 600 : 400, textTransform: 'capitalize',
                  }}>{m === 'great' ? '😊' : m === 'good' ? '🙂' : m === 'fair' ? '😐' : '😟'} {m}</button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>Additional Notes</label>
              <textarea value={logNotes} onChange={e => setLogNotes(e.target.value)}
                placeholder="Any concerns, observations, or things the family should know?"
                style={{ width: '100%', minHeight: '60px', padding: '10px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '13px', resize: 'vertical' }}
              />
            </div>

            <div style={{ marginBottom: '16px', padding: '10px', background: '#f8f9fa', borderRadius: '6px', fontSize: '12px', color: '#888' }}>
              📸 Photo uploads — coming soon
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button onClick={() => setVisitLogSession(null)} style={{
                padding: '10px 20px', border: '1px solid #ddd', background: '#fff', borderRadius: '8px',
                cursor: 'pointer', fontSize: '13px',
              }}>Cancel</button>
              <button onClick={handleSubmitVisitLog} disabled={!logSummary.trim() || submittingLog} style={{
                padding: '10px 20px', background: '#1b6b5a', color: '#fff', border: 'none',
                borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
                opacity: (!logSummary.trim() || submittingLog) ? 0.5 : 1,
              }}>{submittingLog ? 'Submitting...' : 'Submit Visit Log'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
