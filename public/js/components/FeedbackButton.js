// ─── Floating Feedback Button ───
// Persistent FAB on every screen, opens feedback submission modal.
const FeedbackButton = window.FeedbackButton = ({ currentPage, userRole }) => {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState('general');
  const [description, setDescription] = useState('');
  const [mood, setMood] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(null);

  const resetForm = () => {
    setCategory('general');
    setDescription('');
    setMood(null);
    setError(null);
    setSubmitted(false);
  };

  const handleOpen = () => { resetForm(); setOpen(true); };
  const handleClose = () => { setOpen(false); };

  const handleSubmit = async () => {
    if (description.trim().length < 10) return;
    setSubmitting(true);
    setError(null);
    try {
      const pageContext = {
        page: currentPage || 'unknown',
        role: userRole || 'unknown',
        version: window.APP_VERSION || 'unknown',
        device: window.innerWidth <= 768 ? 'mobile' : 'desktop',
        timestamp: new Date().toISOString(),
      };
      const res = await apiFetch('/api/feedback', {
        method: 'POST',
        body: JSON.stringify({ category, description: description.trim(), mood, pageContext }),
      });
      if (res?.ok) {
        setSubmitted(true);
        setTimeout(() => { setOpen(false); resetForm(); }, 1500);
      } else {
        const data = await res?.json();
        setError(data?.error || 'Failed to submit feedback');
      }
    } catch (err) {
      setError('Something went wrong. Please try again.');
    }
    setSubmitting(false);
  };

  const moods = [
    { emoji: '😊', value: 'great', label: 'Great' },
    { emoji: '🙂', value: 'good', label: 'Good' },
    { emoji: '😐', value: 'okay', label: 'Okay' },
    { emoji: '😟', value: 'bad', label: 'Bad' },
    { emoji: '😡', value: 'terrible', label: 'Terrible' },
  ];

  const categories = [
    { value: 'bug', label: 'Bug Report' },
    { value: 'feature', label: 'Feature Request' },
    { value: 'general', label: 'General Feedback' },
    { value: 'complaint', label: 'Complaint' },
    { value: 'praise', label: 'Praise' },
  ];

  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;

  return (
    <React.Fragment>
      {/* FAB */}
      <button
        onClick={handleOpen}
        aria-label="Send feedback"
        style={{
          position: 'fixed',
          bottom: isMobile ? 80 : 24,
          right: 20,
          width: 48,
          height: 48,
          borderRadius: '50%',
          background: '#1b6b5a',
          border: 'none',
          cursor: 'pointer',
          boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 999,
          transition: 'transform 0.2s, box-shadow 0.2s',
        }}
        onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.1)'; e.currentTarget.style.boxShadow = '0 6px 16px rgba(0,0,0,0.3)'; }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.25)'; }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </button>

      {/* Modal */}
      {open && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1100, padding: 16,
        }} onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}>
          <div style={{
            background: '#fff', borderRadius: 16, width: '100%', maxWidth: 420,
            maxHeight: '85vh', overflow: 'auto', padding: 24,
            boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          }}>
            {submitted ? (
              <div style={{ textAlign: 'center', padding: '32px 0' }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>🎉</div>
                <div style={{ fontSize: 18, fontWeight: 600, color: '#1b6b5a' }}>Thank you!</div>
                <div style={{ fontSize: 13, color: '#888', marginTop: 4 }}>Your feedback has been submitted.</div>
              </div>
            ) : (
              <React.Fragment>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                  <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#333' }}>Share Feedback</h3>
                  <button onClick={handleClose} style={{
                    background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: '#999',
                    width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%',
                  }}>&times;</button>
                </div>

                {/* Category */}
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#555', marginBottom: 6 }}>Category</label>
                  <select
                    value={category}
                    onChange={e => setCategory(e.target.value)}
                    style={{
                      width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #ddd',
                      fontSize: 14, color: '#333', background: '#fff', appearance: 'auto',
                    }}
                  >
                    {categories.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>

                {/* Description */}
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#555', marginBottom: 6 }}>
                    Description <span style={{ color: '#999', fontWeight: 400 }}>(required)</span>
                  </label>
                  <textarea
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    placeholder="Tell us what's on your mind..."
                    rows={4}
                    style={{
                      width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #ddd',
                      fontSize: 14, color: '#333', resize: 'vertical', fontFamily: 'inherit',
                      boxSizing: 'border-box',
                    }}
                  />
                  {description.length > 0 && description.trim().length < 10 && (
                    <div style={{ fontSize: 11, color: '#e8724a', marginTop: 4 }}>Please write at least 10 characters</div>
                  )}
                </div>

                {/* Mood */}
                <div style={{ marginBottom: 20 }}>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#555', marginBottom: 8 }}>
                    How are you feeling? <span style={{ color: '#999', fontWeight: 400 }}>(optional)</span>
                  </label>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                    {moods.map(m => (
                      <button
                        key={m.value}
                        onClick={() => setMood(mood === m.value ? null : m.value)}
                        title={m.label}
                        style={{
                          width: 44, height: 44, borderRadius: '50%', border: 'none', cursor: 'pointer',
                          fontSize: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: mood === m.value ? '#e0f2e9' : '#f5f5f5',
                          outline: mood === m.value ? '2px solid #1b6b5a' : 'none',
                          transition: 'all 0.15s',
                        }}
                      >
                        {m.emoji}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Error */}
                {error && (
                  <div style={{ padding: '8px 12px', background: '#fce4ec', color: '#c62828', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>
                    {error}
                  </div>
                )}

                {/* Submit */}
                <button
                  onClick={handleSubmit}
                  disabled={description.trim().length < 10 || submitting}
                  style={{
                    width: '100%', padding: '12px', borderRadius: 8, border: 'none',
                    background: description.trim().length >= 10 && !submitting ? '#1b6b5a' : '#ccc',
                    color: '#fff', fontSize: 14, fontWeight: 600, cursor: description.trim().length >= 10 && !submitting ? 'pointer' : 'not-allowed',
                    transition: 'background 0.2s',
                  }}
                >
                  {submitting ? 'Submitting...' : 'Submit Feedback'}
                </button>
              </React.Fragment>
            )}
          </div>
        </div>
      )}
    </React.Fragment>
  );
};
