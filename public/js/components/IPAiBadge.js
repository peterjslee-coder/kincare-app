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
  const tealColor = '#1b6b5a';

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
