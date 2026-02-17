const Caregivers = window.Caregivers = () => {
  const [caregivers, setCaregivers] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [recipients, setRecipients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [schedulingCaregiver, setSchedulingCaregiver] = useState(null);
  const [activeTab, setActiveTab] = useState('assigned');
  const { showToast } = useToast();

  const fetchData = async () => {
    try {
      const [cgRes, assignRes, dashRes] = await Promise.all([
        apiFetch('/api/caregivers'),
        apiFetch('/api/assignments'),
        apiFetch('/api/dashboard'),
      ]);
      if (cgRes?.ok) {
        const d = await cgRes.json();
        setCaregivers(d.caregivers || []);
      }
      if (assignRes?.ok) {
        const d = await assignRes.json();
        setAssignments(d.assignments || []);
      }
      if (dashRes?.ok) {
        const d = await dashRes.json();
        setRecipients(d.careRecipients || []);
      }
    } catch (err) {
      console.error('Fetch caregivers error:', err);
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const handleAssign = async (caregiverProfileId, recipientId) => {
    try {
      const res = await apiFetch('/api/assignments', {
        method: 'POST',
        body: JSON.stringify({ caregiverProfileId, careRecipientId: recipientId }),
      });
      if (res?.ok) { await fetchData(); showToast('Caregiver assigned', 'success'); }
      else showToast('Failed to assign caregiver', 'error');
    } catch (err) {
      console.error('Assign error:', err);
      showToast('Failed to assign caregiver', 'error');
    }
  };

  const handleUnassign = async (assignmentId) => {
    try {
      const res = await apiFetch(`/api/assignments/${assignmentId}`, { method: 'DELETE' });
      if (res?.ok) { await fetchData(); showToast('Caregiver removed', 'success'); }
    } catch (err) {
      console.error('Unassign error:', err);
      showToast('Failed to remove caregiver', 'error');
    }
  };

  const handleToggleFavorite = async (assignmentId) => {
    try {
      const res = await apiFetch(`/api/assignments/${assignmentId}/favorite`, { method: 'PUT' });
      if (res?.ok) { await fetchData(); showToast('Favorite updated', 'success'); }
    } catch (err) {
      console.error('Favorite toggle error:', err);
    }
  };

  // Build a lookup: which caregiver profiles are assigned to which recipients
  const assignedMap = {};
  assignments.forEach(a => {
    const key = `${a.caregiver_profile_id}_${a.care_recipient_id}`;
    assignedMap[key] = a;
  });

  const assignedCaregiverIds = [...new Set(assignments.map(a => a.caregiver_profile_id))];

  if (loading) return <LoadingSpinner text="Loading caregivers..." />;

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Caregivers</h1>
        <p className="page-subtitle">Manage your care team</p>
      </div>

      <div style={{ display: 'flex', gap: '4px', marginBottom: '20px', borderBottom: '2px solid #e0e0e0' }}>
        {[
          { id: 'assigned', label: `Assigned (${assignments.length})`, icon: '⭐' },
          { id: 'browse', label: 'Browse All', icon: '🔍' },
        ].map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
            padding: '10px 16px', border: 'none', background: 'none', cursor: 'pointer',
            fontSize: '13px', fontWeight: activeTab === tab.id ? 700 : 400,
            color: activeTab === tab.id ? '#1b6b5a' : '#888',
            borderBottom: activeTab === tab.id ? '3px solid #1b6b5a' : '3px solid transparent',
            marginBottom: '-2px',
          }}>
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'assigned' && (
        <div>
          {assignments.length > 0 ? assignments.map((a, idx) => {
            const cg = caregivers.find(c => c.id === a.caregiver_profile_id);
            return (
              <div key={idx} className="card" style={{ marginBottom: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <span style={{ fontSize: '15px', fontWeight: 600, color: '#333' }}>
                        {cg?.name || 'Caregiver'}
                      </span>
                      <button onClick={() => handleToggleFavorite(a.id)} style={{
                        background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', padding: 0,
                      }} title={a.is_favorite ? 'Remove favorite' : 'Mark as favorite'}>
                        {a.is_favorite ? '⭐' : '☆'}
                      </button>
                    </div>
                    <div style={{ fontSize: '13px', color: '#666' }}>
                      Assigned to: <strong>{a.recipient_first_name || ''} {a.recipient_last_name || ''}</strong>
                    </div>
                    {cg && (
                      <div style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>
                        ⭐ {cg.rating || '—'} &bull; ${cg.hourly_rate || '—'}/hr &bull; {cg.specialties || 'General care'}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {cg && (
                      <button onClick={() => setSchedulingCaregiver(cg)} style={{
                        padding: '6px 14px', background: '#1b6b5a', color: '#fff', border: 'none',
                        borderRadius: '6px', fontSize: '12px', cursor: 'pointer', fontWeight: 600,
                      }}>Schedule</button>
                    )}
                    <button onClick={() => handleUnassign(a.id)} style={{
                      padding: '6px 14px', background: '#fff', color: '#c00', border: '1px solid #fcc',
                      borderRadius: '6px', fontSize: '12px', cursor: 'pointer',
                    }}>Remove</button>
                  </div>
                </div>
              </div>
            );
          }) : (
            <div className="card" style={{ textAlign: 'center', padding: '40px', color: '#999' }}>
              No caregivers assigned yet. Browse available caregivers to get started.
            </div>
          )}
        </div>
      )}

      {activeTab === 'browse' && (
        <div className="card">
          {caregivers.length > 0 ? (
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {caregivers.map((cg, idx) => {
                const avail = CAREGIVER_AVAILABILITY[cg.name];
                const isAssigned = assignedCaregiverIds.includes(cg.id);
                return (
                  <li key={idx} className="caregiver-item">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span className="caregiver-name">{cg.name}</span>
                          {isAssigned && (
                            <span style={{
                              padding: '2px 8px', background: '#e8f5e9', color: '#2e7d32',
                              borderRadius: '10px', fontSize: '10px', fontWeight: 600,
                            }}>Assigned</span>
                          )}
                        </div>
                        <div className="caregiver-details">
                          <div className="caregiver-detail">⭐ {cg.rating || '4.9'} &bull; {cg.reviews || 0} reviews</div>
                          <div className="caregiver-detail">👨‍⚕️ {avail ? avail.skills.join(', ') : cg.specialties || 'Companionship'}</div>
                          <div className="caregiver-detail">✓ Background checked</div>
                        </div>
                        <div className="caregiver-badges">
                          <span className="caregiver-badge">{avail ? avail.rate : `$${cg.hourly_rate || 30}/hr`}</span>
                          <span className="caregiver-badge">{cg.location_city || 'Local'}</span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginLeft: '12px' }}>
                        <button onClick={() => setSchedulingCaregiver(cg)} style={{
                          padding: '8px 14px', background: '#1b6b5a', color: '#fff', border: 'none',
                          borderRadius: 8, fontWeight: 600, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap',
                        }}>Schedule</button>
                        {!isAssigned && recipients.length > 0 && (
                          <select onChange={(e) => {
                            if (e.target.value) handleAssign(cg.id, e.target.value);
                            e.target.value = '';
                          }} style={{
                            padding: '6px 8px', border: '1px solid #1b6b5a', borderRadius: '6px',
                            fontSize: '11px', color: '#1b6b5a', cursor: 'pointer', background: '#fff',
                          }}>
                            <option value="">+ Assign to...</option>
                            {recipients.map(r => (
                              <option key={r.id} value={r.id}>{r.first_name} {r.last_name}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : <p style={{ color: '#999' }}>Loading caregivers...</p>}
        </div>
      )}

      {schedulingCaregiver && (
        <CaregiverScheduleModal
          caregiver={schedulingCaregiver}
          onClose={() => setSchedulingCaregiver(null)}
          onBooked={() => setSchedulingCaregiver(null)}
        />
      )}
    </>
  );
};
