const VisitDetailModal = window.VisitDetailModal = ({ sessionId, role, onClose, onRefresh, onTimeChange }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [showPhotos, setShowPhotos] = useState(true);
  const [lightboxIdx, setLightboxIdx] = useState(null);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);

  const handlePhotoUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length || !sessionId) return;
    setUploadingPhotos(true);
    try {
      const formData = new FormData();
      files.slice(0, 5).forEach(f => formData.append('photos', f));
      const csrf = typeof getCsrfToken === 'function' ? getCsrfToken() : (window.getCsrfToken ? window.getCsrfToken() : null);
      const headers = {};
      if (csrf) headers['X-CSRF-Token'] = csrf;
      const res = await fetch(`${window.API_BASE || ''}/api/photos/session/${sessionId}`, {
        method: 'POST', credentials: 'same-origin', headers, body: formData,
      });
      if (res.ok) {
        // Refresh session data to show new photos
        const refreshRes = await apiFetch(`/api/sessions/${sessionId}`);
        if (refreshRes?.ok) setData(await refreshRes.json());
        if (typeof showToast === 'function') showToast('Photos uploaded!', 'success');
      } else {
        if (typeof showToast === 'function') showToast('Photo upload failed', 'error');
      }
    } catch (err) {
      if (typeof showToast === 'function') showToast('Photo upload failed', 'error');
    }
    setUploadingPhotos(false);
    e.target.value = '';
  };

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
    completed: { bg: 'var(--color-success-bg)', color: 'var(--color-success)', label: 'Completed' },
    in_progress: { bg: 'var(--color-info-bg)', color: 'var(--color-info)', label: 'In Progress' },
    confirmed: { bg: 'var(--color-success-bg)', color: 'var(--role-color)', label: 'Confirmed' },
    open: { bg: 'var(--color-warning-bg)', color: 'var(--accent-color)', label: 'Open' },
    requested: { bg: 'var(--color-warning-bg)', color: 'var(--color-warning)', label: 'Requested' },
    cancelled: { bg: 'var(--color-error-bg)', color: 'var(--color-error)', label: 'Cancelled' },
  };

  if (!sessionId) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560, maxHeight: '90vh', overflow: 'auto' }}>
        <button className="modal-close" onClick={onClose}>✕</button>

        {loading && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading session details...</div>
        )}

        {error && (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--color-error)' }}>{error}</div>
        )}

        {data && (() => {
          const s = data.session;
          const v = data.visitLog;
          const photos = data.photos || [];
          const cost = data.costBreakdown;
          const st = statusColors[s.status] || { bg: 'var(--bg-primary)', color: 'var(--text-secondary)', label: s.status };

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
                    <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>{svcLabel}</div>
                    <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 2 }}>
                      for <strong>{s.recipient_name || 'Care Recipient'}</strong>
                    </div>
                  </div>
                  <span style={{ background: st.bg, color: st.color, padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>{st.label}</span>
                </div>
              </div>

              {/* Session Info */}
              <div style={{ background: 'var(--bg-primary)', padding: 14, borderRadius: 10, marginBottom: 14 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: '6px 12px', fontSize: 14 }}>
                  <span style={{ color: 'var(--text-tertiary)' }}>Date</span>
                  <span style={{ fontWeight: 500 }}>{formatDateNice(s.scheduled_date)}</span>
                  <span style={{ color: 'var(--text-tertiary)' }}>Time</span>
                  <span style={{ fontWeight: 500 }}>{formatTime12(s.scheduled_time)} ({s.duration_hours || 2}h)</span>
                  <span style={{ color: 'var(--text-tertiary)' }}>Service</span>
                  <span style={{ fontWeight: 500 }}>{svcLabel}</span>
                  {s.caregiver_name && (
                    <>
                      <span style={{ color: 'var(--text-tertiary)' }}>Caregiver</span>
                      <span style={{ fontWeight: 500 }}>{s.caregiver_name}</span>
                    </>
                  )}
                  {!s.caregiver_name && ['open', 'requested'].includes(s.status) && (
                    <>
                      <span style={{ color: 'var(--text-tertiary)' }}>Caregiver</span>
                      <span style={{ fontWeight: 500, color: 'var(--accent-color)' }}>Awaiting assignment</span>
                    </>
                  )}
                  {s.booked_by_name && (
                    <>
                      <span style={{ color: 'var(--text-tertiary)' }}>Booked by</span>
                      <span>{s.booked_by_name}</span>
                    </>
                  )}
                  {(s.location_address || s.location_city) && (
                    <>
                      <span style={{ color: 'var(--text-tertiary)' }}>Location</span>
                      <span style={{ fontSize: 13 }}>{[s.location_address, s.location_city, s.location_state].filter(Boolean).join(', ')}</span>
                    </>
                  )}
                  {s.special_instructions && (
                    <>
                      <span style={{ color: 'var(--text-tertiary)' }}>Instructions</span>
                      <span style={{ fontSize: 13 }}>{s.special_instructions}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Visit Log — check-in/out, moods, notes */}
              {v && (
                <div style={{ background: 'var(--bg-surface)', border: '1px solid #e0e0e0', borderRadius: 10, padding: 14, marginBottom: 14 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--role-color)', marginBottom: 10 }}>Visit Details</div>

                  {/* Check-in/out times */}
                  <div style={{ display: 'flex', gap: 16, marginBottom: 10, flexWrap: 'wrap' }}>
                    {v.check_in_time && (
                      <div style={{ fontSize: 13 }}>
                        <span style={{ color: 'var(--text-tertiary)' }}>Check-in: </span>
                        <span style={{ fontWeight: 500 }}>{formatDateTime(v.check_in_time)}</span>
                      </div>
                    )}
                    {v.check_out_time && (
                      <div style={{ fontSize: 13 }}>
                        <span style={{ color: 'var(--text-tertiary)' }}>Check-out: </span>
                        <span style={{ fontWeight: 500 }}>{formatDateTime(v.check_out_time)}</span>
                      </div>
                    )}
                  </div>

                  {/* Moods */}
                  {(v.arrival_mood || v.departure_mood) && (() => {
                    const parseMoods = (val) => {
                      if (!val) return [];
                      try { const p = JSON.parse(val); if (Array.isArray(p)) return p; } catch {}
                      return [val];
                    };
                    const arrMoods = parseMoods(v.arrival_mood);
                    const depMoods = parseMoods(v.departure_mood);
                    return (
                      <div style={{ display: 'flex', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
                        {arrMoods.length > 0 && (
                          <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 12, color: 'var(--text-tertiary)', marginRight: 2 }}>Arrival:</span>
                            {arrMoods.map((m, i) => (
                              <span key={i} style={{ background: 'var(--color-success-bg)', padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 500 }}>{m}</span>
                            ))}
                          </div>
                        )}
                        {depMoods.length > 0 && (
                          <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 12, color: 'var(--text-tertiary)', marginRight: 2 }}>Departure:</span>
                            {depMoods.map((m, i) => (
                              <span key={i} style={{ background: 'var(--color-info-bg)', padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 500 }}>{m}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Condition tags */}
                  {conditionTags.length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 4 }}>Condition Tags</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {conditionTags.map((tag, i) => (
                          <span key={i} style={{ background: 'var(--color-purple-bg)', color: 'var(--color-purple)', padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 500 }}>{tag}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Caregiver Notes (deduplicated — summary and care_feedback may contain the same text) */}
                  {(v.care_feedback || v.summary) && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 2 }}>Caregiver Notes</div>
                      <div style={{ fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.5, background: 'var(--bg-primary)', padding: 10, borderRadius: 8 }}>{v.care_feedback || v.summary}</div>
                    </div>
                  )}
                  {v.summary && v.care_feedback && v.summary !== v.care_feedback && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 2 }}>Additional Notes</div>
                      <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{v.summary}</div>
                    </div>
                  )}

                  {/* Tasks completed */}
                  {tasksCompleted.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 4 }}>Tasks Completed</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {tasksCompleted.map((task, i) => (
                          <span key={i} style={{ background: 'var(--color-success-bg)', color: 'var(--color-success)', padding: '3px 10px', borderRadius: 12, fontSize: 12 }}>✓ {task}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Location */}
                  {v.check_in_latitude && v.check_in_longitude && (
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 6 }}>
                      📍 Check-in location recorded ({parseFloat(v.check_in_latitude).toFixed(4)}, {parseFloat(v.check_in_longitude).toFixed(4)})
                    </div>
                  )}
                </div>
              )}

              {/* Upload photos prompt when none exist */}
              {photos.length === 0 && ['completed', 'in_progress'].includes(s.status) && (
                <div style={{ border: '1px dashed #ccc', borderRadius: 10, padding: 16, marginBottom: 14, textAlign: 'center' }}>
                  <div style={{ fontSize: 24, marginBottom: 6 }}>{'\uD83D\uDCF7'}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 10 }}>No visit photos yet</div>
                  <label style={{
                    display: 'inline-block', padding: '8px 16px', background: '#f0f7f5', color: 'var(--role-color)',
                    border: '1px solid #1b6b5a', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  }}>
                    {uploadingPhotos ? 'Uploading...' : 'Upload Photos'}
                    <input type="file" accept="image/*" multiple onChange={handlePhotoUpload} style={{ display: 'none' }} disabled={uploadingPhotos} />
                  </label>
                </div>
              )}

              {/* No visit log for non-completed sessions */}
              {!v && s.status !== 'completed' && s.status !== 'in_progress' && (
                <div style={{ background: 'var(--bg-primary)', padding: 14, borderRadius: 10, marginBottom: 14, fontSize: 13, color: 'var(--text-tertiary)', textAlign: 'center' }}>
                  Visit details will appear here after the caregiver checks in and out.
                </div>
              )}

              {/* Photos */}
              {photos.length > 0 && (
                <div style={{ border: '1px solid #e0e0e0', borderRadius: 10, padding: 14, marginBottom: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--role-color)' }}>{'\uD83D\uDCF7'} Visit Photos ({photos.length})</div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <label style={{ background: 'none', border: 'none', color: 'var(--role-color)', cursor: 'pointer', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span>+ Add</span>
                        <input type="file" accept="image/*" multiple onChange={handlePhotoUpload} style={{ display: 'none' }} disabled={uploadingPhotos} />
                      </label>
                      {photos.length > 6 && (
                        <button type="button" onClick={() => setShowPhotos(!showPhotos)}
                          style={{ background: 'none', border: 'none', color: 'var(--role-color)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                          {showPhotos ? 'Show less' : `Show all ${photos.length}`}
                        </button>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 8 }}>
                    {(showPhotos ? photos : photos.slice(0, 6)).map((p, i) => (
                      <div key={i} onClick={() => setLightboxIdx(i)} style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid #eee', cursor: 'pointer', position: 'relative' }}>
                        <img src={p.photo_url} alt={p.caption || 'Visit photo'} style={{ width: '100%', height: 90, objectFit: 'cover', display: 'block' }} />
                        {p.caption && (
                          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'linear-gradient(transparent, rgba(0,0,0,0.6))', padding: '12px 6px 4px', fontSize: 10, color: 'var(--text-on-primary)', lineHeight: 1.3 }}>{p.caption}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Photo Lightbox */}
              {lightboxIdx !== null && photos[lightboxIdx] && (
                <div onClick={() => setLightboxIdx(null)} style={{
                  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999,
                  background: 'rgba(0,0,0,0.9)', display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', padding: 20,
                }}>
                  <button onClick={(e) => { e.stopPropagation(); setLightboxIdx(null); }}
                    style={{ position: 'absolute', top: 16, right: 20, background: 'none', border: 'none', color: 'var(--text-on-primary)', fontSize: 28, cursor: 'pointer', zIndex: 10000 }}>{'\u2715'}</button>
                  {photos.length > 1 && lightboxIdx > 0 && (
                    <button onClick={(e) => { e.stopPropagation(); setLightboxIdx(lightboxIdx - 1); }}
                      style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.2)', border: 'none', color: 'var(--text-on-primary)', fontSize: 28, borderRadius: '50%', width: 44, height: 44, cursor: 'pointer' }}>{'\u2039'}</button>
                  )}
                  {photos.length > 1 && lightboxIdx < photos.length - 1 && (
                    <button onClick={(e) => { e.stopPropagation(); setLightboxIdx(lightboxIdx + 1); }}
                      style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.2)', border: 'none', color: 'var(--text-on-primary)', fontSize: 28, borderRadius: '50%', width: 44, height: 44, cursor: 'pointer' }}>{'\u203A'}</button>
                  )}
                  <img src={photos[lightboxIdx].photo_url} alt="" onClick={(e) => e.stopPropagation()}
                    style={{ maxWidth: '90%', maxHeight: '75vh', borderRadius: 10, objectFit: 'contain' }} />
                  {photos[lightboxIdx].caption && (
                    <div style={{ color: 'var(--text-on-primary)', fontSize: 14, marginTop: 12, textAlign: 'center', maxWidth: 500 }}>{photos[lightboxIdx].caption}</div>
                  )}
                  <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 6 }}>{lightboxIdx + 1} of {photos.length}</div>
                </div>
              )}

              {/* Cost Breakdown — role-aware */}
              {cost && role === 'caregiver' && (
                <div style={{ background: 'var(--bg-surface)', border: '1px solid #e0e0e0', borderRadius: 10, padding: 14, marginBottom: 14 }}>
                  <div style={{ textAlign: 'center', marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid #f0f0f0' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>You Earn</div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--role-color)', marginTop: 2 }}>${(cost.caregiverPayout || cost.total).toFixed(2)}</div>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Breakdown</div>
                  {cost.tierBreakdown?.map((t, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 3 }}>
                      <span>{t.hours}h {t.tier} @ ${t.rate}/hr</span>
                      <span>${t.amount.toFixed(2)}</span>
                    </div>
                  ))}
                  {cost.caregiverSurchargeShare > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--accent-color)', fontWeight: 600, marginBottom: 3 }}>
                      <span>Short notice bonus</span>
                      <span>+${cost.caregiverSurchargeShare.toFixed(2)}</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: 'var(--role-color)', fontWeight: 700, borderTop: '1px solid #f0f0f0', paddingTop: 4, marginTop: 4 }}>
                    <span>Your total</span>
                    <span>${(cost.caregiverPayout || cost.total).toFixed(2)}</span>
                  </div>
                </div>
              )}
              {cost && role !== 'caregiver' && (
                <div style={{ background: 'var(--bg-surface)', border: '1px solid #e0e0e0', borderRadius: 10, padding: 14, marginBottom: 14 }}>
                  <div style={{ textAlign: 'center', marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid #f0f0f0' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Your Cost</div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--role-color)', marginTop: 2 }}>${(cost.familyTotal || cost.total).toFixed(2)}</div>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Breakdown</div>
                  {cost.tierBreakdown?.map((t, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 3 }}>
                      <span>{t.hours}h {t.tier} @ ${t.rate}/hr</span>
                      <span>${t.amount.toFixed(2)}</span>
                    </div>
                  ))}
                  {cost.surcharge > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--accent-color)', fontWeight: 600, marginBottom: 3 }}>
                      <span>Short-notice fee</span>
                      <span>+${cost.surcharge.toFixed(2)}</span>
                    </div>
                  )}
                  {cost.platformFee > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 3 }}>
                      <span>InPlace fee ({cost.platformFeePercent || 20}%)</span>
                      <span>+${cost.platformFee.toFixed(2)}</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 16, fontWeight: 800, color: 'var(--role-color)', borderTop: '1px solid #f0f0f0', paddingTop: 6, marginTop: 4 }}>
                    <span>Total</span>
                    <span>${(cost.familyTotal || cost.total).toFixed(2)}</span>
                  </div>
                </div>
              )}
            </>
          );
        })()}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, flexWrap: 'wrap', gap: 6 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {data && data.session && data.session.status === 'confirmed' && data.session.caregiver_id && !data.session.pending_time_change_id && onTimeChange && (
            <button onClick={() => { onTimeChange(data.session); onClose(); }}
              style={{ padding: '8px 16px', background: 'var(--color-purple-bg)', color: 'var(--color-purple)', border: '1px solid var(--color-purple)', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Change Time
            </button>
          )}
          {data && data.session && data.session.pending_time_change_id && onTimeChange && (
            <button onClick={() => { onTimeChange(data.session, true); onClose(); }}
              style={{ padding: '8px 16px', background: 'var(--color-purple)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', animation: 'pulse 2s infinite' }}>
              ⏰ Review Change
            </button>
          )}
          {data && data.session && ['confirmed', 'pending', 'open', 'requested'].includes(data.session.status) && (
            <button disabled={cancelling} onClick={async () => {
              const ss = data.session;
              const otherParty = role === 'caregiver' ? (ss.recipient_name || 'this client') : (ss.caregiver_name || 'the caregiver');
              const confirmMsg = role === 'caregiver' ? `Cancel your session with ${otherParty}? The job will go back to the open pool.` : `Cancel this session with ${otherParty}?`;
              if (!confirm(confirmMsg)) return;
              setCancelling(true);
              try {
                const res = await apiFetch(`/api/sessions/${sessionId}/cancel`, {
                  method: 'PUT',
                  body: JSON.stringify({ reason: `${role === 'caregiver' ? 'Caregiver' : 'Family'} cancelled from session detail` }),
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
              padding: '8px 16px', background: 'transparent', color: 'var(--color-error)', border: '1px solid #fca5a5',
              borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: cancelling ? 'not-allowed' : 'pointer',
            }}>{cancelling ? 'Cancelling...' : 'Cancel Session'}</button>
          )}
          </div>
          {!(data && data.session && ['confirmed', 'pending', 'open', 'requested'].includes(data.session.status)) && !onTimeChange && <div />}
          <button className="btn btn-outline" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};
