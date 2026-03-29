// ─── Offer Negotiation Panel ───
// Reusable component for offer/counter-offer flow on care sessions.
// Used in CaretakerHub, RequestCareModal, and CaregiverCalendar.

const OfferNegotiationPanel = window.OfferNegotiationPanel = ({ sessionId, currentUser, onAccepted, compact }) => {
  const [offers, setOffers] = useState([]);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showCounter, setShowCounter] = useState(false);
  const [counterRate, setCounterRate] = useState('');
  const [counterMessage, setCounterMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const fetchOffers = async () => {
    try {
      const res = await apiFetch(`/api/sessions/${sessionId}/offers`);
      if (res?.ok) {
        const data = await res.json();
        setOffers(data.offers || []);
        setSession(data.session || null);
      }
    } catch (err) {
      console.error('Failed to fetch offers:', err);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchOffers();
    // Listen for real-time offer updates
    const cleanup = typeof onSocketEvent === 'function'
      ? onSocketEvent('offer_update', (data) => {
          if (data.sessionId === sessionId) fetchOffers();
        })
      : null;
    return () => { if (cleanup) cleanup(); };
  }, [sessionId]);

  const handleSubmitOffer = async (parentOfferId) => {
    const rate = parseFloat(counterRate);
    if (!rate || rate <= 0 || rate > 500) {
      setError('Enter a valid rate ($0.01–$500)');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const body = { offeredRate: rate, message: counterMessage || undefined };
      if (parentOfferId) body.parentOfferId = parentOfferId;
      const res = await apiFetch(`/api/sessions/${sessionId}/offers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res?.ok) {
        setCounterRate('');
        setCounterMessage('');
        setShowCounter(false);
        fetchOffers();
      } else {
        const err = await res.json();
        setError(err.error || 'Failed to submit offer');
      }
    } catch (err) {
      setError('Network error');
    }
    setSubmitting(false);
  };

  const handleRespond = async (offerId, action) => {
    setSubmitting(true);
    setError('');
    try {
      const res = await apiFetch(`/api/sessions/${sessionId}/offers/${offerId}/respond`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (res?.ok) {
        fetchOffers();
        if (action === 'accept' && onAccepted) onAccepted();
      } else {
        const err = await res.json();
        setError(err.error || 'Failed to respond');
      }
    } catch (err) {
      setError('Network error');
    }
    setSubmitting(false);
  };

  if (loading) return <div style={{ padding: '8px', color: 'var(--text-muted)', fontSize: '13px' }}>Loading offers...</div>;

  const maxRounds = 3;
  const latestPending = offers.find(o => o.status === 'pending');
  const accepted = offers.find(o => o.status === 'accepted');
  const currentRound = offers.length > 0 ? Math.max(...offers.map(o => o.round_number)) : 0;
  const canCounter = latestPending && latestPending.to_user_id === currentUser?.id && currentRound < maxRounds;
  const canMakeFirstOffer = offers.length === 0 || (!latestPending && !accepted);

  // Accepted state
  if (accepted) {
    return (
      <div style={{ padding: '10px 14px', background: 'var(--color-success-bg)', borderRadius: '8px', border: '1px solid #a5d6a7' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, color: 'var(--color-success)', fontSize: '14px' }}>
          <span>✅</span> Rate agreed: ${accepted.offered_rate}/hr
        </div>
      </div>
    );
  }

  const panelStyle = compact
    ? { padding: '8px', background: 'var(--bg-primary)', borderRadius: '8px', border: '1px solid #e0e0e0' }
    : { padding: '14px', background: 'var(--bg-primary)', borderRadius: '10px', border: '1px solid #e0e0e0' };

  return (
    <div style={panelStyle}>
      {/* Offer chain */}
      {offers.length > 0 && (
        <div style={{ marginBottom: '10px' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '6px', fontWeight: 600 }}>
            Negotiation · Round {currentRound} of {maxRounds}
          </div>
          {offers.map((offer, idx) => {
            const isFromMe = offer.from_user_id === currentUser?.id;
            const statusColors = {
              pending: 'var(--color-warning)', accepted: 'var(--color-success)', rejected: 'var(--color-error)',
              expired: '#9e9e9e', countered: '#2196f3',
            };
            const timeAgo = formatTimeAgo(offer.created_at);
            return (
              <div key={offer.id} style={{
                display: 'flex', flexDirection: 'column',
                alignItems: isFromMe ? 'flex-end' : 'flex-start',
                marginBottom: '6px',
              }}>
                <div style={{
                  padding: '8px 12px', borderRadius: '10px', maxWidth: '85%',
                  background: isFromMe ? 'var(--color-info-bg)' : 'var(--text-on-primary)',
                  border: `1px solid ${isFromMe ? '#bbdefb' : 'var(--border-light)'}`,
                }}>
                  <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '2px' }}>
                    {isFromMe ? 'You' : `${offer.first_name || ''} ${offer.last_name || ''}`.trim()}
                    <span style={{ marginLeft: '6px', color: statusColors[offer.status] || 'var(--text-muted)', fontWeight: 600 }}>
                      {offer.status}
                    </span>
                  </div>
                  <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>
                    ${offer.offered_rate}/hr
                  </div>
                  {offer.message && (
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px', fontStyle: 'italic' }}>
                      "{offer.message}"
                    </div>
                  )}
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>{timeAgo}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Action buttons for pending offer TO current user */}
      {canCounter && !showCounter && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
          <button
            onClick={() => handleRespond(latestPending.id, 'accept')}
            disabled={submitting}
            style={{
              padding: '7px 16px', borderRadius: '6px', border: 'none', cursor: 'pointer',
              background: 'var(--role-color)', color: 'var(--text-on-primary)', fontWeight: 600, fontSize: '13px',
            }}>
            Accept ${latestPending.offered_rate}/hr
          </button>
          <button
            onClick={() => handleRespond(latestPending.id, 'reject')}
            disabled={submitting}
            style={{
              padding: '7px 16px', borderRadius: '6px', border: '1px solid #e0e0e0', cursor: 'pointer',
              background: 'var(--bg-surface)', color: 'var(--text-secondary)', fontWeight: 600, fontSize: '13px',
            }}>
            Decline
          </button>
          {currentRound < maxRounds && (
            <button
              onClick={() => { setShowCounter(true); setCounterRate(''); }}
              style={{
                padding: '7px 16px', borderRadius: '6px', border: '1px solid #e8724a', cursor: 'pointer',
                background: 'var(--bg-surface)', color: 'var(--accent-color)', fontWeight: 600, fontSize: '13px',
              }}>
              Counter
            </button>
          )}
        </div>
      )}

      {/* Counter / new offer form */}
      {(showCounter || (canMakeFirstOffer && offers.length === 0)) && null}
      {(showCounter || (!latestPending && !accepted && offers.filter(o => o.status === 'rejected').length < maxRounds)) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>$</span>
            <input
              type="number" step="0.50" min="1" max="500"
              value={counterRate}
              onChange={e => setCounterRate(e.target.value)}
              placeholder="Rate/hr"
              style={{
                width: '90px', padding: '6px 8px', borderRadius: '6px',
                border: '1px solid #ddd', fontSize: '14px',
              }}
            />
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>/hr</span>
            <input
              type="text" maxLength={100}
              value={counterMessage}
              onChange={e => setCounterMessage(e.target.value)}
              placeholder="Optional message..."
              style={{
                flex: 1, padding: '6px 8px', borderRadius: '6px',
                border: '1px solid #ddd', fontSize: '13px', minWidth: '120px',
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              onClick={() => handleSubmitOffer(latestPending?.id || null)}
              disabled={submitting || !counterRate}
              style={{
                padding: '7px 16px', borderRadius: '6px', border: 'none', cursor: 'pointer',
                background: 'var(--accent-color)', color: 'var(--text-on-primary)', fontWeight: 600, fontSize: '13px',
                opacity: submitting || !counterRate ? 0.5 : 1,
              }}>
              {submitting ? 'Sending...' : (latestPending ? 'Send Counter' : 'Make Offer')}
            </button>
            {showCounter && (
              <button
                onClick={() => setShowCounter(false)}
                style={{
                  padding: '7px 16px', borderRadius: '6px', border: '1px solid #ddd', cursor: 'pointer',
                  background: 'var(--bg-surface)', color: 'var(--text-secondary)', fontSize: '13px',
                }}>
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {error && <div style={{ color: 'var(--color-error)', fontSize: '12px', marginTop: '6px' }}>{error}</div>}

      {/* Expiry warning */}
      {latestPending && (
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
          Expires {formatTimeAgo(latestPending.expires_at, true)}
        </div>
      )}
    </div>
  );
};

// Helper for relative time display
function formatTimeAgo(dateStr, isFuture) {
  if (!dateStr) return '';
  const diff = new Date(dateStr).getTime() - Date.now();
  const absDiff = Math.abs(diff);
  const mins = Math.floor(absDiff / 60000);
  const hrs = Math.floor(mins / 60);
  if (isFuture) {
    if (mins < 60) return `in ${mins}m`;
    return `in ${hrs}h`;
  }
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
