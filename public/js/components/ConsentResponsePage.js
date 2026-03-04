/**
 * ConsentResponsePage — Standalone page for care recipients to respond to consent outreach.
 * No authentication required. Care recipients click a link from their email
 * and land here to confirm, ask questions, or report unauthorized activity.
 */
const ConsentResponsePage = window.ConsentResponsePage = ({ token }) => {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submittedMessage, setSubmittedMessage] = useState('');
  const [selectedResponse, setSelectedResponse] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!token) {
      setError('No verification token found. Please use the link from your email.');
      setLoading(false);
      return;
    }
    loadOutreach();
  }, [token]);

  const loadOutreach = async () => {
    try {
      const res = await fetch(`/api/consent/respond/${token}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'This verification link is not valid.');
      } else if (json.expired) {
        setError(json.message || 'This verification link has expired.');
      } else if (json.alreadyResponded) {
        setSubmitted(true);
        setSubmittedMessage("You've already responded to this verification. Thank you!");
        setData({ recipientName: json.recipientName });
      } else {
        setData(json);
      }
    } catch (err) {
      console.error('Consent response load error:', err);
      setError('Something went wrong. Please try again later.');
    }
    setLoading(false);
  };

  const handleSubmit = async () => {
    if (!selectedResponse) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch(`/api/consent/respond/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: selectedResponse, notes: notes.trim() || undefined }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setSubmitted(true);
        setSubmittedMessage(json.message);
      } else {
        setError(json.error || 'Something went wrong. Please try again.');
      }
    } catch (err) {
      console.error('Consent response submit error:', err);
      setError('Something went wrong. Please try again.');
    }
    setSubmitting(false);
  };

  const containerStyle = {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #f0f7f5 0%, #fff 50%, #f8f4ff 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  };

  const cardStyle = {
    background: '#fff',
    borderRadius: '16px',
    boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
    maxWidth: '520px',
    width: '100%',
    padding: '32px',
  };

  const headerStyle = {
    background: '#1b6b5a',
    margin: '-32px -32px 24px -32px',
    padding: '28px 32px',
    borderRadius: '16px 16px 0 0',
    textAlign: 'center',
  };

  // Loading state
  if (loading) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <div style={{ fontSize: '32px', marginBottom: '16px' }}>{'\u23F3'}</div>
            <div style={{ color: '#666', fontSize: '15px' }}>Loading...</div>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error && !data) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <div style={headerStyle}>
            <h1 style={{ color: '#fff', margin: 0, fontSize: '22px', fontWeight: 600 }}>InPlace</h1>
          </div>
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>{'\u26A0\uFE0F'}</div>
            <div style={{ color: '#c62828', fontSize: '15px', lineHeight: '1.6' }}>{error}</div>
            <p style={{ color: '#999', fontSize: '13px', marginTop: '20px' }}>
              If you have questions, please contact us at <a href="mailto:support@yourinplace.com" style={{ color: '#1b6b5a' }}>support@yourinplace.com</a>
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Submitted state
  if (submitted) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <div style={headerStyle}>
            <h1 style={{ color: '#fff', margin: 0, fontSize: '22px', fontWeight: 600 }}>InPlace</h1>
          </div>
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>{'\u2705'}</div>
            <h2 style={{ color: '#1b6b5a', margin: '0 0 12px', fontSize: '20px' }}>Thank You{data?.recipientName ? `, ${data.recipientName}` : ''}!</h2>
            <p style={{ color: '#555', fontSize: '15px', lineHeight: '1.6' }}>{submittedMessage}</p>
            <p style={{ color: '#999', fontSize: '13px', marginTop: '24px' }}>
              Questions? Contact us at <a href="mailto:support@yourinplace.com" style={{ color: '#1b6b5a' }}>support@yourinplace.com</a>
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Response options
  const responseOptions = [
    {
      id: 'yes_aware',
      icon: '\u2705',
      title: "Yes, I'm aware",
      description: "I know about this care arrangement and I'm comfortable with it.",
      color: '#e8f5e9',
      borderColor: '#c8e6c9',
      activeColor: '#1b6b5a',
    },
    {
      id: 'have_questions',
      icon: '\u2753',
      title: 'I have questions',
      description: "I'd like to learn more before deciding. Someone from InPlace will reach out to you.",
      color: '#FFF8E1',
      borderColor: '#FFE082',
      activeColor: '#e8724a',
    },
    {
      id: 'did_not_authorize',
      icon: '\u{1F6A8}',
      title: 'I did not authorize this',
      description: "I did not agree to this care arrangement. No caregiver will visit.",
      color: '#fce4ec',
      borderColor: '#ef9a9a',
      activeColor: '#c62828',
    },
  ];

  // Main response form
  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <div style={headerStyle}>
          <h1 style={{ color: '#fff', margin: 0, fontSize: '22px', fontWeight: 600 }}>InPlace</h1>
          <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: '13px', marginTop: '4px' }}>Care Arrangement Verification</div>
        </div>

        <h2 style={{ color: '#333', margin: '0 0 8px', fontSize: '19px' }}>
          Hi{data.recipientName ? ` ${data.recipientName}` : ''},
        </h2>

        <p style={{ color: '#555', fontSize: '14px', lineHeight: '1.6', margin: '0 0 20px' }}>
          Your {data.relationship || 'family member'}, <strong>{data.familyMemberName}</strong>, has arranged non-medical companion care for you through InPlace.
        </p>

        <div style={{ background: '#f0f7f5', borderRadius: '10px', padding: '16px', marginBottom: '24px' }}>
          <div style={{ fontWeight: 600, color: '#1b6b5a', fontSize: '14px', marginBottom: '8px' }}>What is InPlace?</div>
          <p style={{ color: '#555', fontSize: '13px', lineHeight: '1.6', margin: 0 }}>
            InPlace connects families with trusted, local caregivers who provide companionship, help around the house,
            and other non-medical assistance. This is <em>not</em> medical care — it's friendly, professional help with daily living.
          </p>
        </div>

        {error && <div style={{ background: '#fce4ec', color: '#c62828', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', marginBottom: '16px' }}>{error}</div>}

        <div style={{ fontWeight: 600, color: '#333', fontSize: '15px', marginBottom: '12px' }}>
          How would you like to respond?
        </div>

        {responseOptions.map(opt => {
          const isSelected = selectedResponse === opt.id;
          return (
            <button key={opt.id} onClick={() => setSelectedResponse(opt.id)}
              style={{
                display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
                background: isSelected ? opt.color : '#fff',
                border: `2px solid ${isSelected ? opt.activeColor : '#e0e0e0'}`,
                borderRadius: '10px', padding: '14px 16px', marginBottom: '10px',
                transition: 'all 0.2s',
              }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '20px' }}>{opt.icon}</span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '14px', color: isSelected ? opt.activeColor : '#333' }}>{opt.title}</div>
                  <div style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>{opt.description}</div>
                </div>
              </div>
            </button>
          );
        })}

        {/* Optional notes */}
        {selectedResponse && (
          <div style={{ marginTop: '16px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#333', marginBottom: '6px' }}>
              Anything you'd like to add? <span style={{ fontWeight: 400, color: '#999' }}>(optional)</span>
            </label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Any questions, concerns, or additional information..."
              style={{
                width: '100%', minHeight: '80px', padding: '10px 12px', borderRadius: '8px',
                border: '1px solid #ddd', fontSize: '14px', resize: 'vertical', boxSizing: 'border-box',
                fontFamily: 'inherit',
              }} />
          </div>
        )}

        <button onClick={handleSubmit} disabled={submitting || !selectedResponse}
          style={{
            width: '100%', padding: '14px', borderRadius: '10px', border: 'none',
            fontWeight: 600, fontSize: '15px', cursor: selectedResponse ? 'pointer' : 'not-allowed',
            background: selectedResponse ? '#1b6b5a' : '#ccc', color: '#fff',
            marginTop: '20px', transition: 'background 0.2s',
          }}>
          {submitting ? 'Submitting...' : 'Submit Response'}
        </button>

        <p style={{ color: '#999', fontSize: '12px', textAlign: 'center', marginTop: '20px', marginBottom: 0 }}>
          You can also ignore this page — no caregiver will visit without proper verification.
          <br />Questions? <a href="mailto:support@yourinplace.com" style={{ color: '#1b6b5a' }}>support@yourinplace.com</a>
        </p>
      </div>
    </div>
  );
};
