/**
 * iPAi Care Intelligence Card
 * Shows deep AI-generated care insights on the Care Profile page.
 * Combines visit observations with medical knowledge to provide
 * actionable guidance for families and caregivers.
 */
const IPAiInsightsCard = window.IPAiInsightsCard = ({ recipientId, recipientName, existingSummary }) => {
  const [intelligence, setIntelligence] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(!!existingSummary);
  const [showGuidance, setShowGuidance] = useState(false);
  const [editingFamilyNote, setEditingFamilyNote] = useState(false);
  const [familyNoteText, setFamilyNoteText] = useState('');

  // Load family AI notes on mount
  useEffect(() => {
    if (!recipientId) return;
    apiFetch(`/api/care-recipients/${recipientId}`).then(r => r?.ok ? r.json() : null).then(data => {
      if (data?.family_ai_notes) setFamilyNoteText(data.family_ai_notes);
    }).catch(() => {});
  }, [recipientId]);

  const generate = async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/care-intelligence/${recipientId}${force ? '?force=true' : ''}`);
      if (res?.ok) {
        const data = await res.json();
        if (data.error && !data.intelligence && !data.analysis) {
          setError(data.error + (data.detail ? ': ' + data.detail : ''));
        } else {
          // May have error but also partial data (analysis without AI)
          setIntelligence(data);
          setExpanded(true);
          if (data.error) setError(data.error);
        }
      } else {
        const err = await res?.json().catch(() => ({}));
        setError(err?.error || 'Failed to generate insights');
      }
    } catch (err) {
      setError('Failed to connect to AI service');
    }
    setLoading(false);
  };

  const badge = React.createElement(window.IPAiBadge || 'span', { size: 'md' });

  const priorityColor = { high: 'var(--color-error)', medium: 'var(--color-warning)', low: 'var(--role-color)' };
  const priorityBorder = { high: '#ef5350', medium: 'var(--color-warning)', low: 'var(--color-success)' };

  return (
    <div className="card" style={{
      border: intelligence ? '2px solid #1b6b5a' : '1px solid #e0e0e0',
      background: intelligence ? '#f8fffe' : 'var(--bg-card)',
    }}>
      <div className="card-header" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        {badge}
        <span>Care Intelligence</span>
      </div>

      {!intelligence && !loading && (
        <div style={{ padding: '12px 0' }}>
          {existingSummary && (
            <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text-primary)', padding: '10px 12px', background: 'var(--bg-primary)', borderRadius: 8, marginBottom: 12, whiteSpace: 'pre-wrap' }}>
              {existingSummary}
            </div>
          )}
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 12px', lineHeight: 1.5 }}>
            {`iPAi learns about ${recipientName} from every visit — tracking patterns, moods, and what works best. The more your family shares, the smarter the guidance becomes for everyone on ${recipientName}'s care team.`}
          </p>
          <button onClick={async () => {
            // Regenerate profile summary AND generate intelligence in one click
            try { await apiFetch(`/api/care-recipients/${recipientId}/generate-summary`, { method: 'POST' }); } catch {}
            generate();
          }} disabled={loading} style={{
            padding: '10px 20px', borderRadius: 10, border: 'none',
            background: 'var(--role-color)', color: 'var(--text-on-primary)', fontWeight: 600, fontSize: 14,
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
          }}>
            {React.createElement(window.IPAiBadge || 'span', { size: 'sm', style: { background: 'rgba(255,255,255,0.2)', color: 'var(--text-on-primary)' } })}
            {existingSummary ? `Update ${recipientName}'s Care Profile` : `Generate ${recipientName}'s Care Profile`}
          </button>
          {error && <div style={{ color: 'var(--color-error)', fontSize: 13, marginTop: 8 }}>{error}</div>}
        </div>
      )}

      {loading && (
        <div style={{ padding: '20px 0', textAlign: 'center' }}>
          <div style={{ fontSize: 14, color: 'var(--role-color)', fontWeight: 600, marginBottom: 8 }}>
            Analyzing {recipientName}'s care history...
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
            Connecting behavioral observations with care knowledge
          </div>
        </div>
      )}

      {intelligence?.intelligence && (() => {
        const intel = intelligence.intelligence;
        return (
          <div style={{ padding: '4px 0' }}>
            {/* Headline */}
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.5, marginBottom: 12, padding: '8px 12px', background: '#e6f5f0', borderRadius: 8 }}>
              {intel.headline}
            </div>

            {/* Insights */}
            {(intel.insights || []).map((insight, i) => (
              <div key={i} style={{
                padding: '10px 12px', marginBottom: 8, borderRadius: 8,
                background: 'var(--bg-surface)', border: '1px solid #e5e7eb',
                borderLeft: `4px solid ${priorityBorder[insight.priority] || 'var(--role-color)'}`,
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {insight.title}
                  <span style={{
                    fontSize: 9, padding: '1px 6px', borderRadius: 4, fontWeight: 600,
                    background: insight.priority === 'high' ? 'var(--color-error-bg)' : insight.priority === 'medium' ? 'var(--color-warning-bg)' : 'var(--color-success-bg)',
                    color: priorityColor[insight.priority] || 'var(--role-color)',
                  }}>{insight.priority}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 4 }}>
                  <strong style={{ color: 'var(--text-tertiary)' }}>Observed:</strong> {insight.observation}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.5, marginBottom: 4 }}>
                  <strong style={{ color: 'var(--text-tertiary)' }}>Why:</strong> {insight.explanation}
                </div>
                <div style={{ fontSize: 12, color: 'var(--role-color)', lineHeight: 1.5, fontWeight: 500 }}>
                  <strong>Recommendation:</strong> {insight.recommendation}
                </div>
              </div>
            ))}

            {/* Scheduling Advice */}
            {intel.schedulingAdvice && (
              <div style={{ padding: '10px 12px', marginBottom: 8, background: 'var(--color-info-bg)', borderRadius: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-info)', marginBottom: 4 }}>Scheduling</div>
                <div style={{ fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.5 }}>{intel.schedulingAdvice}</div>
              </div>
            )}

            {/* Watch List */}
            {intel.watchList?.length > 0 && (
              <div style={{ padding: '10px 12px', marginBottom: 8, background: 'var(--color-warning-bg)', borderRadius: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-warning)', marginBottom: 4 }}>Watch List</div>
                {intel.watchList.map((item, i) => (
                  <div key={i} style={{ fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.5, paddingLeft: 12, borderLeft: '2px solid #ff9800', marginBottom: 4 }}>
                    {item}
                  </div>
                ))}
              </div>
            )}

            {/* Caregiver Guidance (expandable) */}
            {intel.caregiverGuidance && (
              <div style={{ marginTop: 8 }}>
                <button onClick={() => setShowGuidance(!showGuidance)} style={{
                  padding: '8px 14px', borderRadius: 8, border: '1px solid #1b6b5a',
                  background: 'var(--bg-surface)', color: 'var(--role-color)', fontWeight: 600, fontSize: 12,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  {React.createElement(window.IPAiBadge || 'span', { size: 'sm' })}
                  {showGuidance ? 'Hide' : 'Show'} Caregiver Guidance
                </button>
                {showGuidance && (
                  <div style={{ marginTop: 8, padding: '12px', background: 'var(--color-success-bg)', borderRadius: 8, border: '1px solid #bbf7d0' }}>
                    <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                      {intel.caregiverGuidance}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Family Additions — editable notes that iPAi incorporates on next regeneration */}
            <div style={{ marginTop: 12, padding: '10px 12px', background: '#f0f4ff', borderRadius: 8, border: '1px solid #c5cae9' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#3949ab', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                {'\u{1F4D6}'} Your Family's Notes
                <span style={{ fontWeight: 400, color: '#7986cb' }}> — everything you share helps iPAi give better care guidance</span>
              </div>
              {editingFamilyNote ? (
                <div>
                  <textarea value={familyNoteText} onChange={e => setFamilyNoteText(e.target.value)}
                    placeholder={`Share anything that helps ${recipientName}'s caregivers...\n\nThings like:\n• "She takes her pills better with applesauce"\n• "She gets upset if you mention her late husband"\n• "Frank Sinatra during meal prep always makes her smile"\n• "She's a morning person — best before noon"\n\nThe more you share, the better iPAi can guide ${recipientName}'s care team.`}
                    style={{ width: '100%', minHeight: 80, padding: 10, border: '1px solid #c5cae9', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', color: '#1a237e', resize: 'vertical', boxSizing: 'border-box' }}
                    autoFocus />
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button onClick={async () => {
                      try {
                        await apiFetch(`/api/care-recipients/${recipientId}`, {
                          method: 'PUT',
                          body: JSON.stringify({ family_ai_notes: familyNoteText.trim() }),
                        });
                        setEditingFamilyNote(false);
                        if (typeof showToast === 'function') showToast('Notes saved — iPAi will incorporate these on next regeneration', 'success');
                      } catch { if (typeof showToast === 'function') showToast('Failed to save notes', 'error'); }
                    }} style={{ padding: '6px 14px', background: '#3949ab', color: 'var(--text-on-primary)', border: 'none', borderRadius: 6, fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                      Save Notes
                    </button>
                    <button onClick={() => setEditingFamilyNote(false)} style={{ padding: '6px 14px', background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid #ddd', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  {familyNoteText ? (
                    <div style={{ fontSize: 13, color: '#1a237e', lineHeight: 1.5, whiteSpace: 'pre-wrap', marginBottom: 6 }}>
                      {familyNoteText}
                    </div>
                  ) : null}
                  <button onClick={() => setEditingFamilyNote(true)} style={{
                    padding: '4px 10px', background: 'var(--bg-surface)', color: '#3949ab', border: '1px solid #c5cae9', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  }}>{familyNoteText ? 'Edit Notes' : `+ Add notes about ${recipientName}`}</button>
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 8, borderTop: '1px solid #e5e7eb' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                Generated {intelligence.generatedAt && !isNaN(new Date(intelligence.generatedAt)) ? new Date(intelligence.generatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'recently'}
                {intelligence.analysis?.stats?.totalVisits > 0 && ` from ${intelligence.analysis.stats.totalVisits} visits`}
              </div>
              <button onClick={() => generate(true)} disabled={loading} style={{
                padding: '6px 12px', borderRadius: 6, border: '1px solid #ccc',
                background: 'var(--bg-surface)', color: 'var(--text-secondary)', fontWeight: 600, fontSize: 11, cursor: 'pointer',
              }}>Regenerate</button>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
