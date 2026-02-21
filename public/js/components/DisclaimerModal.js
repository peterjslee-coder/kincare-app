const DisclaimerModal = window.DisclaimerModal = ({ onAccept }) => {
  const [scrolledToBottom, setScrolledToBottom] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const contentRef = useRef(null);

  const handleScroll = () => {
    const el = contentRef.current;
    if (!el) return;
    // More forgiving threshold (50px) for different browsers/zoom levels
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    if (atBottom) setScrolledToBottom(true);
  };

  useEffect(() => {
    const el = contentRef.current;
    // Check if content doesn't need scrolling (short enough to fit)
    if (el && el.scrollHeight <= el.clientHeight + 20) {
      setScrolledToBottom(true);
    }
    // Fallback: if scroll detection fails after 8 seconds, enable the button
    // so users aren't permanently stuck
    const fallback = setTimeout(() => setScrolledToBottom(true), 8000);
    return () => clearTimeout(fallback);
  }, []);

  const handleAccept = async () => {
    setAccepting(true);
    try {
      const res = await apiFetch('/api/auth/me/disclaimer', { method: 'PUT' });
      if (res?.ok) {
        onAccept();
      }
    } catch (err) {
      console.error('Disclaimer accept error:', err);
    }
    setAccepting(false);
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10000,
      background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '20px',
    }}>
      <div style={{
        background: 'white', borderRadius: '16px', maxWidth: '560px', width: '100%',
        maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
      }}>
        <div style={{ padding: '24px 24px 16px', borderBottom: '1px solid #e0e0e0' }}>
          <div style={{ fontSize: '22px', fontWeight: 700, color: '#333', marginBottom: '4px' }}>
            Important Notice
          </div>
          <div style={{ fontSize: '13px', color: '#999' }}>
            Please read and acknowledge before continuing
          </div>
        </div>

        <div ref={contentRef} onScroll={handleScroll} style={{
          flex: 1, overflowY: 'auto', padding: '24px',
          fontSize: '14px', lineHeight: '1.7', color: '#444',
        }}>
          <p style={{ margin: '0 0 16px' }}>
            Welcome to InPlace. Before you begin using our platform, please carefully read and acknowledge the following important disclosures.
          </p>

          <div style={{
            background: '#FFF3E0', border: '2px solid #E65100', borderRadius: '10px',
            padding: '16px 18px', marginBottom: '16px',
          }}>
            <p style={{ margin: 0, fontWeight: 700, fontSize: '15px', color: '#BF360C' }}>
              InPlace does not provide at-home medical care in accordance with Virginia state law.
            </p>
          </div>

          <div style={{
            background: '#FFEBEE', border: '2px solid #C62828', borderRadius: '10px',
            padding: '16px 18px', marginBottom: '16px',
          }}>
            <p style={{ margin: 0, fontWeight: 700, fontSize: '15px', color: '#B71C1C' }}>
              You are personally liable for any medical care you provide beyond calling professional medical attention when warranted.
            </p>
          </div>

          <p style={{ margin: '0 0 12px' }}>
            InPlace is a care coordination platform that connects families with professional caregivers for non-medical companion care, personal assistance, and daily living support. Our services include companionship, meal preparation, light housekeeping, transportation, medication reminders, and similar non-medical support.
          </p>

          <p style={{ margin: '0 0 12px' }}>
            InPlace caregivers are independent contractors, not medical professionals. They are not licensed, certified, or authorized to provide medical diagnosis, treatment, nursing care, physical therapy, or any form of medical intervention.
          </p>

          <p style={{ margin: '0 0 12px' }}>
            If a medical emergency occurs, caregivers and family members should immediately call 911 or the appropriate emergency services. Caregivers are expected to contact professional medical help whenever a situation exceeds the scope of non-medical companion care.
          </p>

          <p style={{ margin: '0 0 12px' }}>
            By using InPlace, you acknowledge that you understand these limitations and agree to use the platform solely for non-medical care coordination purposes.
          </p>

          <p style={{ margin: '0', fontSize: '12px', color: '#999', fontStyle: 'italic' }}>
            Disclaimer version 1.0 — Last updated February 2026
          </p>
        </div>

        <div style={{
          padding: '16px 24px', borderTop: '1px solid #e0e0e0',
          display: 'flex', flexDirection: 'column', gap: '8px',
        }}>
          {!scrolledToBottom && (
            <div style={{ textAlign: 'center', fontSize: '12px', color: '#999', fontStyle: 'italic' }}>
              Please scroll to read the full notice
            </div>
          )}
          <button onClick={handleAccept} disabled={!scrolledToBottom || accepting} style={{
            width: '100%', padding: '14px', background: scrolledToBottom ? '#1b6b5a' : '#ccc',
            color: 'white', border: 'none', borderRadius: '10px', fontSize: '15px',
            fontWeight: 600, cursor: scrolledToBottom ? 'pointer' : 'not-allowed',
            opacity: accepting ? 0.7 : 1,
            transition: 'background 0.2s',
          }}>
            {accepting ? 'Acknowledging...' : 'I Acknowledge and Agree'}
          </button>
        </div>
      </div>
    </div>
  );
};
