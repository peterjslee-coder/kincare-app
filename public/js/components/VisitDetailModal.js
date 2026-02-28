const VisitDetailModal = window.VisitDetailModal = ({ sessionId, role, onClose, onRefresh }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [showPhotos, setShowPhotos] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    const fetchDetail = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await apiFetch(`/api/sessions/${sessionId}`);
        if (res?.ok) {
          setData(await res.json());
        } else {
          setError('Could not load session details.');
        }
      } catch (err) {
        setError('Network error loading session.');
      }
      setLoading(false);
    };
    fetchDetail();
  }, [sessionId]);

  const formatTime12 = (t) => {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const dh = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return `${dh}:${String(m).padStart(2, '0')} ${ampm}`;
  };

  const formatDateNice = (dateStr) => {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${days[dt.getDay()]}, ${months[dt.getMonth()]} ${d}, ${y}`;
  };

  const formatDateTime = (dt) => {
    if (!dt) return '';
    const d = new Date(dt);
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  };

  const statusColors = {
    completed: { bg: '#e8f5e9', color: '#2e7d32', label: 'Completed' },
    in_progress: { bg: '#e3f2fd', color: '#1565c0', label: 'In Progress' },
    confirmed: { bg: '#e8f5e9', color: '#1b6b5a', label: 'Confirmed' },
    open: { bg: '#fff8e1', color: '#e8724a', label: 'Open' },
    requested: { bg: '#fff8e1', color: '#f57f17', label: 'Requested' },
    cancelled: { bg: '#fce4ec', color: '#c62828', label: 'Cancelled' },
  };

  if (!sessionId) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560, maxHeight: '90vh', overflow: 'auto' }}>
        <button className="modal-close" onClick={onClose}>✕</button>

        {loading && (
          <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>Loading session details...</div>
        )}

        {error && (
          <div style={{ padding: 20, textAlign: 'center', color: '#c62828' }}>{error}</div>
        )}

        {data && (() => {
          const s = data.session;
          const v = data.visitLog;
          const photos = data.photos || [];
          const cost = data.costBreakdown;
          const st = statusColors[s.status] || { bg: '#f5f5f5', color: '#666', label: s.status };

          // Parse condition tags
          let conditionTags = [];
          try { conditionTags = v?.condition_tags ? JSON.parse(v.condition_tags) : []; } catch(e) {}

          // Parse tasks completed
          let tasksCompleted = [];
          try { tasksCompleted = v?.tasks_completed ? JSON.parse(v.tasks_completed) : []; } catch(e) {}

          const svcLabel = formatServiceType(s.service_type);

          return (
            <>
              {/* Header */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: '#1a1a2e' }}>{svcLabel}</div>
                    <div style={{ fontSize: 14, color: '#666', marginTop: 2 }}>
                      for <strong>{s.recipient_name || 'Care Recipient'}</strong>
                    </div>
                  </div>
                  <span style={{ background: st.bg, color: st.color, padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>{st.label}</span>
                </div>
              </div>

              {/* Session Info */}
              <div style={{ background: '#f8f9fa', padding: 14, borderRadius: 10, marginBottom: 14 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: '6px 12px', fontSize: 14 }}>
                  <span style={{ color: '#888' }}>Date</span>
                  <span style={{ fontWeight: 500 }}>{formatDateNice(s.scheduled_date)}</span>
                  <span style={{ color: '#888' }}>Time</span>
                  <span style={{ fontWeight: 500 }}>{formatTime12(s.scheduled_time)} ({s.duration_hours || 2}h)</span>
                  <span style={{ color: '#888' }}>Service</span>
                  <span style={{ fontWeight: 500 }}>{svcLabel}</span>
                  {s.caregiver_name && (
                    <>
                      <span style={{ color: '#888' }}>Caregiver</span>
                      <span style={{ fontWeight: 500 }}>{s.caregiver_name}</span>
                    </>
                  )}
                  {!s.caregiver_name && ['open', 'requested'].includes(s.status) && (
                    <>
                      <span style={{ color: '#888' }}>Caregiver</span>
                      <span style={{ fontWeight: 500, color: '#e8724a' }}>Awaiting assignment</span>
                    </>
                  )}
                  {s.booked_by_name && (
                    <>
                      <span style={{ color: '#888' }}>Booked by</span>
                      <span>{s.booked_by_name}</span>
                    </>
                  )}
                  {(s.location_address || s.location_city) && (
                    <>
                      <span style={{ color: '#888' }}>Location</span>
                      <span style={{ fontSize: 13 }}>{[s.location_address, s.location_city, s.location_state].filter(Boolean).join(', ')}</span>
                    </>
                  )}
                  {s.special_instructions && (
                    <>
                      <span style={{ color: '#888' }}>Instructions</span>
                      <span style={{ fontSize: 13 }}>{s.special_instructions}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Visit Log — check-in/out, moods, notes */}
              {v && (
                <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 10, padding: 14, marginBottom: 14 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#1b6b5a', marginBottom: 10 }}>Visit Details</div>

                  {/* Check-in/out times */}
                  <div style={{ display: 'flex', gap: 16, marginBottom: 10, flexWrap: 'wrap' }}>
                    {v.check_in_time && (
                      <div style={{ fontSize: 13 }}>
                        <span style={{ color: '#888' }}>Check-in: </span>
                        <span style={{ fontWeight: 500 }}>{formatDateTime(v.check_in_time)}</span>
                      </div>
                    )}
                    {v.check_out_time && (
                      <div style={{ fontSize: 13 }}>
                        <span style={{ color: '#888' }}>Check-out: </span>
                        <span style={{ fontWeight: 500 }}>{formatDateTime(v.check_out_time)}</span>
                      </div>
                    )}
                  </div>

                  {/* Moods */}
                  {(v.arrival_mood || v.departure_mood) && (
                    <div style={{ display: 'flex', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
                      {v.arrival_mood && (
                        <div style={{ background: '#e8f5e9', padding: '4px 10px', borderRadius: 16, fontSize: 13 }}>
                          Arrival: <strong>{v.arrival_mood}</strong>
                        </div>
                      )}
                      {v.departure_mood && (
                        <div style={{ background: '#e3f2fd', padding: '4px 10px', borderRadius: 16, fontSize: 13 }}>
                          Departure: <strong>{v.departure_mood}</strong>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Condition tags */}
                  {conditionTags.length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>Condition Tags</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {conditionTags.map((tag, i) => (
                          <span key={i} style={{ background: '#f3e5f5', color: '#7b1fa2', padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 500 }}>{tag}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Summary / notes */}
                  {v.summary && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 12, color: '#888', marginBottom: 2 }}>Caregiver Notes</div>
                      <div style={{ fontSize: 14, color: '#333', lineHeight: 1.5, background: '#fafafa', padding: 10, borderRadius: 8 }}>{v.summary}</div>
                    </div>
                  )}
                  {v.care_feedback && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 12, color: '#888', marginBottom: 2 }}>Care Feedback</div>
                      <div style={{ fontSize: 13, color: '#555' }}>{v.care_feedback}</div>
                    </div>
                  )}

                  {/* Tasks completed */}
                  {tasksCompleted.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>Tasks Completed</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {tasksCompleted.map((task, i) => (
                          <span key={i} style={{ background: '#e8f5e9', color: '#2e7d32', padding: '3px 10px', borderRadius: 12, fontSize: 12 }}>✓ {task}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Location */}
                  {v.check_in_latitude && v.check_in_longitude && (
                    <div style={{ fontSize: 12, color: '#888', marginTop: 6 }}>
                      📍 Check-in location recorded ({parseFloat(v.check_in_latitude).toFixed(4)}, {parseFloat(v.check_in_longitude).toFixed(4)})
                    </div>
                  )}
                </div>
              )}

              {/* No visit log for non-completed sessions */}
              {!v && s.status !== 'completed' && s.status !== 'in_progress' && (
                <div style={{ background: '#f8f9fa', padding: 14, borderRadius: 10, marginBottom: 14, fontSize: 13, color: '#888', textAlign: 'center' }}>
                  Visit details will appear here after the caregiver checks in and out.
                </div>
              )}

              {/* Photos */}
              {photos.length > 0 && (
                <div style={{ border: '1px solid #e0e0e0', borderRadius: 10, padding: 14, marginBottom: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#1b6b5a' }}>Visit Photos ({photos.length})</div>
                    <button type="button" onClick={() => setShowPhotos(!showPhotos)}
                      style={{ background: 'none', border: 'none', color: '#1b6b5a', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                      {showPhotos ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  {showPhotos && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
                      {photos.map((p, i) => (
                        <div key={i} style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid #eee' }}>
                          <img src={p.photo_url} alt={p.caption || 'Visit photo'} style={{ width: '100%', height: 100, objectFit: 'cover' }} />
                          {p.caption && <div style={{ fontSize: 11, color: '#666', padding: '4px 6px' }}>{p.caption}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Cost Breakdown — role-aware */}
              {cost && role === 'caregiver' && (
                <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 10, padding: 14, marginBottom: 14 }}>
                  <div style={{ textAlign: 'center', marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid #f0f0f0' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>You Earn</div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: '#1b6b5a', marginTop: 2 }}>${(cost.caregiverPayout || cost.total).toFixed(2)}</div>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#555', marginBottom: 6 }}>Breakdown</div>
                  {cost.tierBreakdown?.map((t, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#555', marginBottom: 3 }}>
                      <span>{t.hours}h {t.tier} @ ${t.rate}/hr</span>
                      <span>${t.amount.toFixed(2)}</span>
                    </div>
                  ))}
                  {cost.caregiverSurchargeShare > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#e8724a', fontWeight: 600, marginBottom: 3 }}>
                      <span>Short-notice bonus (75%)</span>
                      <span>+${cost.caregiverSurchargeShare.toFixed(2)}</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: '#1b6b5a', fontWeight: 700, borderTop: '1px solid #f0f0f0', paddingTop: 4, marginTop: 4 }}>
                    <span>Your total</span>
                    <span>${(cost.caregiverPayout || cost.total).toFixed(2)}</span>
                  </div>
                </div>
              )}
              {cost && role !== 'caregiver' && (
                <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 10, padding: 14, marginBottom: 14 }}>
                  <div style={{ textAlign: 'center', marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid #f0f0f0' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Your Cost</div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: '#1b6b5a', marginTop: 2 }}>${(cost.familyTotal || cost.total).toFixed(2)}</div>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#555', marginBottom: 6 }}>Breakdown</div>
                  {cost.tierBreakdown?.map((t, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#555', marginBottom: 3 }}>
                      <span>{t.hours}h {t.tier} @ ${t.rate}/hr</span>
                      <span>${t.amount.toFixed(2)}</span>
                    </div>
                  ))}
                  {cost.surcharge > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#e8724a', fontWeight: 600, marginBottom: 3 }}>
                      <span>Short-notice fee</span>
                      <span>+${cost.surcharge.toFixed(2)}</span>
                    </div>
                  )}
                  {cost.platformFee > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#555', marginBottom: 3 }}>
                      <span>InPlace fee ({cost.platformFeePercent || 20}%)</span>
                      <span>+${cost.platformFee.toFixed(2)}</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 16, fontWeight: 800, color: '#1b6b5a', borderTop: '1px solid #f0f0f0', paddingTop: 6, marginTop: 4 }}>
                    <span>Total</span>
                    <span>${(cost.familyTotal || cost.total).toFixed(2)}</span>
                  </div>
                </div>
              )}
            </>
          );
        })()}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
          {role === 'caregiver' && data && ['confirmed', 'pending'].includes(data.status) && (
            <button disabled={cancelling} onClick={async () => {
              const recipName = data.recipient_name || 'this client';
              if (!confirm(`Cancel your session with ${recipName}? The job will go back to the open pool.`)) return;
              setCancelling(true);
              try {
                const res = await apiFetch(`/api/sessions/${sessionId}/cancel`, {
                  method: 'PUT',
                  body: JSON.stringify({ reason: 'Caregiver cancelled from session detail' }),
                });
                if (res?.ok) {
                  if (onRefresh) onRefresh();
                  onClose();
                } else {
                  const err = await res.json().catch(() => ({}));
                  alert(err.error || 'Failed to cancel');
                }
              } catch (err) {
                alert('Network error');
              }
              setCancelling(false);
            }} style={{
              padding: '8px 16px', background: 'transparent', color: '#dc2626', border: '1px solid #fca5a5',
              borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: cancelling ? 'not-allowed' : 'pointer',
            }}>{cancelling ? 'Cancelling...' : 'Cancel Session'}</button>
          )}
          {!(role === 'caregiver' && data && ['confirmed', 'pending'].includes(data.status)) && <div />}
          <button className="btn btn-outline" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};
