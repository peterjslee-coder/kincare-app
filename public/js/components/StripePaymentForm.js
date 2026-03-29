// StripePaymentForm — Reusable Stripe Elements card payment form
// Usage: <StripePaymentForm amount={30} description="Background check fee" onSuccess={(intent) => ...} onError={(msg) => ...} />
const StripePaymentForm = window.StripePaymentForm = ({ amount, description, onSuccess, onError, buttonText }) => {
  const [stripe, setStripe] = useState(null);
  const [cardElement, setCardElement] = useState(null);
  const [clientSecret, setClientSecret] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [cardReady, setCardReady] = useState(false);
  const cardRef = useRef(null);
  const mountedRef = useRef(false);

  // Initialize Stripe and create PaymentIntent
  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      try {
        // Get publishable key
        const configRes = await fetch('/api/payments/config');
        const config = await configRes.json();
        if (!config.publishableKey) {
          setError('Payment system is not configured yet. Please check back later.');
          return;
        }

        if (cancelled) return;
        const stripeInstance = Stripe(config.publishableKey);
        setStripe(stripeInstance);

        // Mount card element
        if (cardRef.current && !mountedRef.current) {
          const elements = stripeInstance.elements();
          const card = elements.create('card', {
            style: {
              base: {
                fontSize: '16px',
                color: 'var(--text-primary)',
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                '::placeholder': { color: 'var(--text-muted)' },
              },
              invalid: { color: 'var(--accent-color)' },
            },
          });
          card.mount(cardRef.current);
          card.on('ready', () => setCardReady(true));
          card.on('change', (e) => {
            if (e.error) setError(e.error.message);
            else setError(null);
          });
          setCardElement(card);
          mountedRef.current = true;
        }
      } catch (err) {
        if (!cancelled) setError('Failed to initialize payment form');
      }
    };
    init();
    return () => { cancelled = true; };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!stripe || !cardElement || processing) return;

    setProcessing(true);
    setError(null);

    try {
      // Create PaymentIntent on backend
      const intentRes = await apiFetch('/api/payments/background-check', { method: 'POST' });
      if (!intentRes.ok) {
        const err = await intentRes.json();
        throw new Error(err.error || 'Failed to create payment');
      }
      const { clientSecret: secret, paymentId } = await intentRes.json();

      // Confirm card payment with Stripe
      const result = await stripe.confirmCardPayment(secret, {
        payment_method: { card: cardElement },
      });

      if (result.error) {
        setError(result.error.message);
        if (onError) onError(result.error.message);
      } else if (result.paymentIntent.status === 'succeeded') {
        // Confirm on backend
        const confirmRes = await apiFetch('/api/payments/background-check/confirm', {
          method: 'POST',
          body: JSON.stringify({ paymentIntentId: result.paymentIntent.id }),
        });
        if (confirmRes.ok) {
          if (onSuccess) onSuccess(result.paymentIntent);
        } else {
          const err = await confirmRes.json();
          setError(err.error || 'Payment succeeded but confirmation failed');
        }
      }
    } catch (err) {
      setError(err.message || 'Payment failed');
      if (onError) onError(err.message);
    }

    setProcessing(false);
  };

  return (
    <form onSubmit={handleSubmit} style={{ width: '100%' }}>
      {description && (
        <div style={{ marginBottom: '16px', color: 'var(--text-secondary)', fontSize: '14px' }}>
          {description}
        </div>
      )}

      <div style={{
        border: '1px solid #ddd', borderRadius: '8px', padding: '14px 12px',
        marginBottom: '16px', background: 'var(--bg-primary)', transition: 'border-color 0.2s',
      }}>
        <div ref={cardRef} />
      </div>

      {error && (
        <div style={{
          background: 'var(--bg-error-light)', color: 'var(--color-error)', padding: '10px 14px',
          borderRadius: '8px', marginBottom: '16px', fontSize: '13px',
          border: '1px solid #f5c6cb',
        }}>
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={processing || !cardReady}
        style={{
          width: '100%', padding: '14px', borderRadius: '8px',
          border: 'none', background: processing ? 'var(--text-muted)' : 'var(--role-color)',
          color: 'var(--text-on-primary)', fontSize: '16px', fontWeight: 600,
          cursor: processing ? 'wait' : 'pointer',
          transition: 'background 0.2s',
        }}
      >
        {processing ? '⏳ Processing...' : (buttonText || `Pay $${amount.toFixed(2)}`)}
      </button>

      <div style={{ marginTop: '12px', textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)' }}>
        🔒 Secured by Stripe. Your card details never touch our servers.
      </div>
    </form>
  );
};
