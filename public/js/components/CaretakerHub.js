const CaretakerHub = window.CaretakerHub = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('schedule');
  const [visitLogSession, setVisitLogSession] = useState(null);
  const [logSummary, setLogSummary] = useState('');
  const [logMood, setLogMood] = useState('good');
  const [logNotes, setLogNotes] = useState('');
  const [logPhotos, setLogPhotos] = useState([]);
  const [photoPreviewUrls, setPhotoPreviewUrls] = useState([]);
  const [submittingLog, setSubmittingLog] = useState(false);
  const photoInputRef = useRef(null);

  // Availability state
  const [availRules, setAvailRules] = useState([]);
  const [availLoading, setAvailLoading] = useState(false);
  const [showAddRule, setShowAddRule] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [ruleForm, setRuleForm] = useState({
    type: 'available', dayOfWeek: 1, startTime: '08:00', endTime: '17:00',
    isRecurring: true, specificDate: '', note: '',
  });

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayAbbr = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const fetchAvailability = async () => {
    setAvailLoading(true);
    try {
      const res = await apiFetch('/api/availability');
      if (res?.ok) {
        const d = await res.json();
        setAvailRules(d.rules || []);
      }
    } catch (err) { console.error('Availability fetch error:', err); }
    setAvailLoading(false);
  };

  const handleSaveRule = async () => {
    try {
      const body = {
        dayOfWeek: parseInt(ruleForm.dayOfWeek),
        startTime: ruleForm.startTime,
        endTime: ruleForm.endTime,
        isRecurring: ruleForm.isRecurring,
        specificDate: ruleForm.isRecurring ? null : ruleForm.specificDate || null,
        type: ruleForm.type,
        note: ruleForm.note || null,
      };

      if (editingRule) {
        await apiFetch(`/api/availability/${editingRule.id}`, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        await apiFetch('/api/availability', { method: 'POST', body: JSON.stringify(body) });
      }
      setShowAddRule(false);
      setEditingRule(null);
      setRuleForm({ type: 'available', dayOfWeek: 1, startTime: '08:00', endTime: '17:00', isRecurring: true, specificDate: '', note: '' });
      fetchAvailability();
    } catch (err) { console.error('Save rule error:', err); }
  };

  const handleDeleteRule = async (id) => {
    try {
      await apiFetch(`/api/availability/${id}`, { method: 'DELETE' });
      fetchAvailability();
    } catch (err) { console.error('Delete rule error:', err); }
  };

  const startEditRule = (rule) => {
    setEditingRule(rule);
    setRuleForm({
      type: rule.type, dayOfWeek: rule.dayOfWeek, startTime: rule.startTime, endTime: rule.endTime,
      isRecurring: rule.isRecurring, specificDate: rule.specificDate || '', note: rule.note || '',
    });
    setShowAddRule(true);
  };

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

  const handlePhotoSelect = (e) => {
    const files = Array.from(e.target.files || []).slice(0, 5);
    setLogPhotos(prev => [...prev, ...files].slice(0, 5));
    // Generate preview URLs
    const newUrls = files.map(f => URL.createObjectURL(f));
    setPhotoPreviewUrls(prev => [...prev, ...newUrls].slice(0, 5));
  };

  const removePhoto = (idx) => {
    setLogPhotos(prev => prev.filter((_, i) => i !== idx));
    setPhotoPreviewUrls(prev => {
      URL.revokeObjectURL(prev[idx]);
      return prev.filter((_, i) => i !== idx);
    });
  };

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
        const logData = await res.json();
        // Upload photos if any
        if (logPhotos.length > 0 && logData.visitLog?.id) {
          const formData = new FormData();
          logPhotos.forEach(f => formData.append('photos', f));
          const token = localStorage.getItem('auth_token');
          await fetch(`${API_BASE}/api/photos/visit/${logData.visitLog.id}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData,
          });
        }
        setVisitLogSession(null);
        setLogSummary('');
        setLogMood('good');
        setLogNotes('');
        setLogPhotos([]);
        setPhotoPreviewUrls([]);
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
    { id: 'availability', label: 'Availability', icon: '🕐' },
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
        <CaregiverCalendar
          caregiverId={profile.id}
          sessions={sessions}
          availRules={availRules}
          fetchAvailability={fetchAvailability}
          onLogVisit={setVisitLogSession}
        />
      )}

      {activeTab === 'availability' && (
        <AvailabilityTab
          rules={availRules}
          loading={availLoading}
          fetchAvailability={fetchAvailability}
          showAddRule={showAddRule}
          setShowAddRule={setShowAddRule}
          editingRule={editingRule}
          setEditingRule={setEditingRule}
          ruleForm={ruleForm}
          setRuleForm={setRuleForm}
          handleSaveRule={handleSaveRule}
          handleDeleteRule={handleDeleteRule}
          startEditRule={startEditRule}
          dayNames={dayNames}
          dayAbbr={dayAbbr}
        />
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
        <AreaMap />
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

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>📸 Visit Photos (up to 5)</label>
              <input type="file" ref={photoInputRef} accept="image/*" multiple onChange={handlePhotoSelect}
                style={{ display: 'none' }} />
              <button onClick={() => photoInputRef.current?.click()} style={{
                padding: '8px 16px', background: '#f0f0f0', border: '1px dashed #ccc', borderRadius: '8px',
                cursor: 'pointer', fontSize: '13px', color: '#666', width: '100%',
              }}>
                {logPhotos.length > 0 ? `${logPhotos.length} photo${logPhotos.length > 1 ? 's' : ''} selected — add more` : 'Tap to add photos'}
              </button>
              {photoPreviewUrls.length > 0 && (
                <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
                  {photoPreviewUrls.map((url, idx) => (
                    <div key={idx} style={{ position: 'relative', width: '72px', height: '72px' }}>
                      <img src={url} alt={`Photo ${idx + 1}`} style={{
                        width: '72px', height: '72px', objectFit: 'cover', borderRadius: '8px', border: '1px solid #ddd',
                      }} />
                      <button onClick={() => removePhoto(idx)} style={{
                        position: 'absolute', top: '-6px', right: '-6px', width: '20px', height: '20px',
                        background: '#c62828', color: '#fff', border: 'none', borderRadius: '50%',
                        fontSize: '12px', cursor: 'pointer', lineHeight: '20px', padding: 0,
                      }}>×</button>
                    </div>
                  ))}
                </div>
              )}
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
