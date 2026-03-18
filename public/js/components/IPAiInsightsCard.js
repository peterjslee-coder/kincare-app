/**
 * iPAi Care Intelligence Card
 * Shows deep AI-generated care insights on the Care Profile page.
 * Combines visit observations with medical knowledge to provide
 * actionable guidance for families and caregivers.
 */
const IPAiInsightsCard = window.IPAiInsightsCard = ({ recipientId, recipientName }) => {
  const [intelligence, setIntelligence] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [showGuidance, setShowGuidance] = useState(false);

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/care-intelligence/${recipientId}`);
      if (res?.ok) {
        const data = await res.json();
        if (data.error) {
          setError(data.error);
        } else {
          setIntelligence(data);
          setExpanded(true);
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

  const priorityColor = { high: '#c62828', medium: '#e65100', low: '#1b6b5a' };
  const priorityBorder = { high: '#ef5350', medium: '#ff9800', low: '#4caf50' };

  return (
    <div className="card" style={{
      border: intelligence ? '2px solid #1b6b5a' : '1px solid #e0e0e0',
      background: intelligence ? '#f8fffe' : '#fff',
    }}>
      <div className="card-header" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        {badge}
        <span>Care Intelligence</span>
      </div>

      {!intelligence && !loading && (
        <div style={{ padding: '12px 0' }}>
          <p style={{ fontSize: 13, color: '#666', margin: '0 0 12px', lineHeight: 1.5 }}>
            Analyze {recipientName}'s visit history, behavioral patterns, and health conditions to generate
            deep care insights powered by AI. Connects observations with medical knowledge to suggest
            optimal care strategies.
          </p>
          <button onClick={generate} disabled={loading} style={{
            padding: '10px 20px', borderRadius: 10, border: 'none',
            background: '#1b6b5a', color: '#fff', fontWeight: 600, fontSize: 14,
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
          }}>
            {React.createElement(window.IPAiBadge || 'span', { size: 'sm', style: { background: 'rgba(255,255,255,0.2)', color: '#fff' } })}
            Generate Care Intelligence
          </button>
          {error && <div style={{ color: '#c62828', fontSize: 13, marginTop: 8 }}>{error}</div>}
        </div>
      )}

      {loading && (
        <div style={{ padding: '20px 0', textAlign: 'center' }}>
          <div style={{ fontSize: 14, color: '#1b6b5a', fontWeight: 600, marginBottom: 8 }}>
            Analyzing {recipientName}'s care history...
          </div>
          <div style={{ fontSize: 12, color: '#888' }}>
            Connecting behavioral observations with care knowledge
          </div>
        </div>
      )}

      {intelligence?.intelligence && (() => {
        const intel = intelligence.intelligence;
        return (
          <div style={{ padding: '4px 0' }}>
            {/* Headline */}
            <div style={{ fontSize: 15, fontWeight: 600, color: '#333', lineHeight: 1.5, marginBottom: 12, padding: '8px 12px', background: '#e6f5f0', borderRadius: 8 }}>
              {intel.headline}
            </div>

            {/* Insights */}
            {(intel.insights || []).map((insight, i) => (
              <div key={i} style={{
                padding: '10px 12px', marginBottom: 8, borderRadius: 8,
                background: '#fff', border: '1px solid #e5e7eb',
                borderLeft: `4px solid ${priorityBorder[insight.priority] || '#1b6b5a'}`,
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#333', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {insight.title}
                  <span style={{
                    fontSize: 9, padding: '1px 6px', borderRadius: 4, fontWeight: 600,
                    background: insight.priority === 'high' ? '#ffebee' : insight.priority === 'medium' ? '#fff3e0' : '#e8f5e9',
                    color: priorityColor[insight.priority] || '#1b6b5a',
                  }}>{insight.priority}</span>
                </div>
                <div style={{ fontSize: 12, color: '#555', lineHeight: 1.5, marginBottom: 4 }}>
                  <strong style={{ color: '#888' }}>Observed:</strong> {insight.observation}
                </div>
                <div style={{ fontSize: 12, color: '#444', lineHeight: 1.5, marginBottom: 4 }}>
                  <strong style={{ color: '#888' }}>Why:</strong> {insight.explanation}
                </div>
                <div style={{ fontSize: 12, color: '#1b6b5a', lineHeight: 1.5, fontWeight: 500 }}>
                  <strong>Recommendation:</strong> {insight.recommendation}
                </div>
              </div>
            ))}

            {/* Scheduling Advice */}
            {intel.schedulingAdvice && (
              <div style={{ padding: '10px 12px', marginBottom: 8, background: '#e3f2fd', borderRadius: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#1565c0', marginBottom: 4 }}>Scheduling</div>
                <div style={{ fontSize: 12, color: '#333', lineHeight: 1.5 }}>{intel.schedulingAdvice}</div>
              </div>
            )}

            {/* Watch List */}
            {intel.watchList?.length > 0 && (
              <div style={{ padding: '10px 12px', marginBottom: 8, background: '#fff3e0', borderRadius: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#e65100', marginBottom: 4 }}>Watch List</div>
                {intel.watchList.map((item, i) => (
                  <div key={i} style={{ fontSize: 12, color: '#333', lineHeight: 1.5, paddingLeft: 12, borderLeft: '2px solid #ff9800', marginBottom: 4 }}>
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
                  background: '#fff', color: '#1b6b5a', fontWeight: 600, fontSize: 12,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  {React.createElement(window.IPAiBadge || 'span', { size: 'sm' })}
                  {showGuidance ? 'Hide' : 'Show'} Caregiver Guidance
                </button>
                {showGuidance && (
                  <div style={{ marginTop: 8, padding: '12px', background: '#f0fdf4', borderRadius: 8, border: '1px solid #bbf7d0' }}>
                    <div style={{ fontSize: 13, color: '#333', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                      {intel.caregiverGuidance}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Footer */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 8, borderTop: '1px solid #e5e7eb' }}>
              <div style={{ fontSize: 10, color: '#aaa' }}>
                Generated {new Date(intelligence.generatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                {intelligence.analysis?.stats?.totalVisits > 0 && ` from ${intelligence.analysis.stats.totalVisits} visits`}
              </div>
              <button onClick={generate} disabled={loading} style={{
                padding: '6px 12px', borderRadius: 6, border: '1px solid #ccc',
                background: '#fff', color: '#666', fontWeight: 600, fontSize: 11, cursor: 'pointer',
              }}>Regenerate</button>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
