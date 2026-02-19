/**
 * AvailabilityTab — Caregiver availability rules management
 * Displays a weekly grid view and allows CRUD operations on availability rules
 */
const AvailabilityTab = window.AvailabilityTab = ({
  rules, loading, fetchAvailability,
  showAddRule, setShowAddRule,
  editingRule, setEditingRule,
  ruleForm, setRuleForm,
  handleSaveRule, handleDeleteRule, startEditRule,
  dayNames, dayAbbr,
}) => {

  useEffect(() => {
    fetchAvailability();
  }, []);

  // Build weekly grid data: for each day, collect available and blocked time ranges
  const weeklyGrid = dayAbbr.map((abbr, dayIdx) => {
    const dayRules = rules.filter(r => r.isRecurring && r.dayOfWeek === dayIdx);
    const available = dayRules.filter(r => r.type === 'available');
    const blocked = dayRules.filter(r => r.type === 'blocked');
    return { dayIdx, abbr, fullName: dayNames[dayIdx], available, blocked };
  });

  // One-off rules (non-recurring, specific dates)
  const oneOffRules = rules.filter(r => !r.isRecurring && r.specificDate);

  const hours = [];
  for (let h = 6; h <= 20; h++) {
    hours.push(h);
  }

  const timeToHour = (t) => {
    const [h] = t.split(':').map(Number);
    return h;
  };

  const formatTime = (t) => {
    const [h, m] = t.split(':');
    const hr = parseInt(h);
    const ampm = hr >= 12 ? 'PM' : 'AM';
    const hr12 = hr === 0 ? 12 : hr > 12 ? hr - 12 : hr;
    return `${hr12}:${m} ${ampm}`;
  };

  return (
    <div>
      {/* Header with Add Rule button */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <h3 style={{ margin: 0, color: '#333' }}>My Availability</h3>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#666' }}>Set your working hours and blocked times</p>
        </div>
        <button onClick={() => {
          setEditingRule(null);
          setRuleForm({ type: 'available', dayOfWeek: 1, startTime: '08:00', endTime: '17:00', isRecurring: true, specificDate: '', note: '' });
          setShowAddRule(true);
        }} style={{
          padding: '8px 16px', background: '#1b6b5a', color: '#fff', border: 'none',
          borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
        }}>+ Add Rule</button>
      </div>

      {loading ? (
        <div style={{ padding: '40px', textAlign: 'center', color: '#999' }}>Loading availability...</div>
      ) : (
        <React.Fragment>
          {/* Weekly Grid */}
          <div className="card" style={{ marginBottom: '16px' }}>
            <div className="card-header"><span className="card-icon">📅</span>Weekly Schedule</div>
            <div style={{ overflowX: 'auto' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '80px repeat(15, 1fr)', gap: '0', minWidth: '600px' }}>
                {/* Hour headers */}
                <div style={{ padding: '4px', fontSize: '11px', color: '#999', fontWeight: 600 }}></div>
                {hours.map(h => (
                  <div key={h} style={{ padding: '4px 2px', fontSize: '10px', color: '#999', textAlign: 'center' }}>
                    {h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h-12}p`}
                  </div>
                ))}

                {/* Day rows */}
                {weeklyGrid.map(({ dayIdx, abbr, available, blocked }) => (
                  <React.Fragment key={dayIdx}>
                    <div style={{
                      padding: '8px 6px', fontSize: '12px', fontWeight: 600, color: '#333',
                      display: 'flex', alignItems: 'center',
                    }}>{abbr}</div>
                    {hours.map(h => {
                      const isAvail = available.some(r => {
                        const s = timeToHour(r.startTime);
                        const e = timeToHour(r.endTime);
                        return h >= s && h < e;
                      });
                      const isBlocked = blocked.some(r => {
                        const s = timeToHour(r.startTime);
                        const e = timeToHour(r.endTime);
                        return h >= s && h < e;
                      });

                      let bg = '#f5f5f5';
                      let title = 'Not scheduled';
                      if (isAvail && !isBlocked) { bg = '#c8e6c9'; title = 'Available'; }
                      else if (isAvail && isBlocked) { bg = '#ffcdd2'; title = 'Blocked'; }
                      else if (isBlocked) { bg = '#ffcdd2'; title = 'Blocked'; }

                      return (
                        <div key={h} title={`${abbr} ${h}:00 — ${title}`} style={{
                          height: '28px', background: bg, border: '1px solid #fff',
                          borderRadius: '2px', cursor: 'default',
                        }}></div>
                      );
                    })}
                  </React.Fragment>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '16px', marginTop: '12px', fontSize: '11px', color: '#666' }}>
              <span><span style={{ display: 'inline-block', width: '12px', height: '12px', background: '#c8e6c9', borderRadius: '2px', verticalAlign: 'middle', marginRight: '4px' }}></span> Available</span>
              <span><span style={{ display: 'inline-block', width: '12px', height: '12px', background: '#ffcdd2', borderRadius: '2px', verticalAlign: 'middle', marginRight: '4px' }}></span> Blocked</span>
              <span><span style={{ display: 'inline-block', width: '12px', height: '12px', background: '#f5f5f5', borderRadius: '2px', verticalAlign: 'middle', marginRight: '4px' }}></span> Not Scheduled</span>
            </div>
          </div>

          {/* Recurring Rules List */}
          <div className="card" style={{ marginBottom: '16px' }}>
            <div className="card-header"><span className="card-icon">🔄</span>Recurring Rules</div>
            {rules.filter(r => r.isRecurring).length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', color: '#999' }}>No recurring rules set. Click "Add Rule" to get started.</div>
            ) : (
              <div style={{ display: 'grid', gap: '8px' }}>
                {rules.filter(r => r.isRecurring).map(rule => (
                  <div key={rule.id} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '10px 14px', background: rule.type === 'available' ? '#f0faf5' : '#fef2f2',
                    borderRadius: '8px', borderLeft: `4px solid ${rule.type === 'available' ? '#1b6b5a' : '#dc2626'}`,
                  }}>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#333' }}>
                        {dayNames[rule.dayOfWeek]} &bull; {formatTime(rule.startTime)} – {formatTime(rule.endTime)}
                      </div>
                      <div style={{ fontSize: '11px', color: '#666', marginTop: '2px' }}>
                        {rule.type === 'available' ? 'Available' : 'Blocked'}
                        {rule.note && ` — ${rule.note}`}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button onClick={() => startEditRule(rule)} style={{
                        padding: '4px 10px', background: '#fff', border: '1px solid #ddd', borderRadius: '6px',
                        cursor: 'pointer', fontSize: '11px',
                      }}>Edit</button>
                      <button onClick={() => handleDeleteRule(rule.id)} style={{
                        padding: '4px 10px', background: '#fff', border: '1px solid #fca5a5', borderRadius: '6px',
                        cursor: 'pointer', fontSize: '11px', color: '#dc2626',
                      }}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* One-off Date Blocks */}
          <div className="card">
            <div className="card-header"><span className="card-icon">📌</span>Date-Specific Overrides</div>
            {oneOffRules.length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', color: '#999' }}>No date-specific overrides. Use "Add Rule" with a specific date to block off time.</div>
            ) : (
              <div style={{ display: 'grid', gap: '8px' }}>
                {oneOffRules.map(rule => (
                  <div key={rule.id} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '10px 14px', background: rule.type === 'available' ? '#f0faf5' : '#fef2f2',
                    borderRadius: '8px', borderLeft: `4px solid ${rule.type === 'available' ? '#1b6b5a' : '#dc2626'}`,
                  }}>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#333' }}>
                        {rule.specificDate} &bull; {formatTime(rule.startTime)} – {formatTime(rule.endTime)}
                      </div>
                      <div style={{ fontSize: '11px', color: '#666', marginTop: '2px' }}>
                        {rule.type === 'available' ? 'Available (override)' : 'Blocked'}
                        {rule.note && ` — ${rule.note}`}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button onClick={() => startEditRule(rule)} style={{
                        padding: '4px 10px', background: '#fff', border: '1px solid #ddd', borderRadius: '6px',
                        cursor: 'pointer', fontSize: '11px',
                      }}>Edit</button>
                      <button onClick={() => handleDeleteRule(rule.id)} style={{
                        padding: '4px 10px', background: '#fff', border: '1px solid #fca5a5', borderRadius: '6px',
                        cursor: 'pointer', fontSize: '11px', color: '#dc2626',
                      }}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </React.Fragment>
      )}

      {/* Add/Edit Rule Modal */}
      {showAddRule && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{
            background: '#fff', borderRadius: '12px', padding: '24px', width: '420px', maxWidth: '90vw',
          }}>
            <h3 style={{ marginTop: 0 }}>{editingRule ? 'Edit Rule' : 'Add Availability Rule'}</h3>

            {/* Rule Type */}
            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>Type</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                {['available', 'blocked'].map(t => (
                  <button key={t} onClick={() => setRuleForm(f => ({ ...f, type: t }))} style={{
                    flex: 1, padding: '8px', border: ruleForm.type === t ? '2px solid #1b6b5a' : '2px solid #ddd',
                    borderRadius: '8px', background: ruleForm.type === t ? (t === 'available' ? '#f0faf5' : '#fef2f2') : '#fff',
                    cursor: 'pointer', fontSize: '13px', fontWeight: ruleForm.type === t ? 600 : 400,
                    textTransform: 'capitalize',
                  }}>{t === 'available' ? '✅ Available' : '🚫 Blocked'}</button>
                ))}
              </div>
            </div>

            {/* Recurring vs One-off */}
            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>Frequency</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                {[true, false].map(rec => (
                  <button key={String(rec)} onClick={() => setRuleForm(f => ({ ...f, isRecurring: rec }))} style={{
                    flex: 1, padding: '8px', border: ruleForm.isRecurring === rec ? '2px solid #1b6b5a' : '2px solid #ddd',
                    borderRadius: '8px', background: ruleForm.isRecurring === rec ? '#f0faf5' : '#fff',
                    cursor: 'pointer', fontSize: '13px', fontWeight: ruleForm.isRecurring === rec ? 600 : 400,
                  }}>{rec ? '🔄 Every Week' : '📌 Specific Date'}</button>
                ))}
              </div>
            </div>

            {/* Day of Week (recurring) or Date (one-off) */}
            {ruleForm.isRecurring ? (
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>Day of Week</label>
                <select value={ruleForm.dayOfWeek} onChange={e => setRuleForm(f => ({ ...f, dayOfWeek: e.target.value }))} style={{
                  width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '13px',
                }}>
                  {dayNames.map((name, idx) => (
                    <option key={idx} value={idx}>{name}</option>
                  ))}
                </select>
              </div>
            ) : (
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>Date</label>
                <input type="date" value={ruleForm.specificDate}
                  onChange={e => {
                    const d = new Date(e.target.value + 'T12:00:00');
                    setRuleForm(f => ({ ...f, specificDate: e.target.value, dayOfWeek: d.getDay() }));
                  }}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '13px' }}
                />
              </div>
            )}

            {/* Time Range */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>Start Time</label>
                <input type="time" value={ruleForm.startTime}
                  onChange={e => setRuleForm(f => ({ ...f, startTime: e.target.value }))}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '13px' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>End Time</label>
                <input type="time" value={ruleForm.endTime}
                  onChange={e => setRuleForm(f => ({ ...f, endTime: e.target.value }))}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '13px' }}
                />
              </div>
            </div>

            {/* Note */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>Note (optional)</label>
              <input type="text" value={ruleForm.note} placeholder="e.g., Doctor appointment, personal time"
                onChange={e => setRuleForm(f => ({ ...f, note: e.target.value }))}
                style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '13px' }}
              />
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button onClick={() => { setShowAddRule(false); setEditingRule(null); }} style={{
                padding: '10px 20px', border: '1px solid #ddd', background: '#fff', borderRadius: '8px',
                cursor: 'pointer', fontSize: '13px',
              }}>Cancel</button>
              <button onClick={handleSaveRule} style={{
                padding: '10px 20px', background: '#1b6b5a', color: '#fff', border: 'none',
                borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
              }}>{editingRule ? 'Update Rule' : 'Add Rule'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
