const IPAiBadge = window.IPAiBadge = ({ size = 'sm', style: customStyle }) => {
  const specs = {
    sm: {
      fontSize: '9px',
      padding: '1px 5px 1px 3px',
      borderRadius: '6px',
      checkmarkSize: 9
    },
    md: {
      fontSize: '11px',
      padding: '2px 7px 2px 4px',
      borderRadius: '8px',
      checkmarkSize: 11
    }
  };

  const config = specs[size] || specs.sm;
  const tealColor = 'var(--role-color)';

  const badgeStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '2px',
    background: '#e6f5f0',
    color: tealColor,
    padding: config.padding,
    borderRadius: config.borderRadius,
    fontSize: config.fontSize,
    fontWeight: 700,
    letterSpacing: '0.3px',
    ...customStyle
  };

  return (
    <span style={badgeStyle}>
      <svg
        viewBox="0 0 16 16"
        width={config.checkmarkSize}
        height={config.checkmarkSize}
        style={{ flexShrink: 0 }}
      >
        <path
          d="M13.5 4.5L6.5 11.5L2.5 7.5"
          stroke={tealColor}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
      <span>iPAi</span>
    </span>
  );
};

// ─── The acknowledgment that has to sit with anything iPAi generates (v1.105.37) ───
//
// Pete's rule, stated while answering Apple's age-rating questionnaire:
//
//   "The app must NEVER generate medical or treatment information without the user
//    explicitly acknowledging that this is not medical care, and that it can only reflect
//    information provided to it."
//
// His reason: Claude can hallucinate, and in a product holding a dementia patient's
// medications and adherence history a fabricated line is not cosmetic.
//
// It also underwrites a store answer. Apple's questionnaire was answered *Medical or
// Treatment Information = Infrequent*, on the grounds that InPlace records and displays
// rather than advises. That answer holds only while this does — if the app starts
// generating unacknowledged medical guidance, the honest answer becomes *Frequent*, which
// pulls in the Regulated Medical Device declaration.
//
// Both halves must be present AT THE POINT OF GENERATION, not buried in the policy:
// (a) this is not medical care, (b) it only reflects what you gave it.
const IPAI_NOT_MEDICAL = window.IPAI_NOT_MEDICAL =
  'iPAi does not provide medical care. It can only reflect what your care team has recorded.';

const IPAiDisclaimer = window.IPAiDisclaimer = ({ style }) => (
  <div role="note" style={{
    fontSize: 11, lineHeight: 1.45, color: 'var(--text-muted)',
    padding: '6px 10px', borderRadius: 6, background: 'var(--bg-primary)',
    border: '1px solid var(--border-light)', ...(style || {}),
  }}>
    {IPAI_NOT_MEDICAL}
  </div>
);
