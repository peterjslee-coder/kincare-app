// InPlace brand icon — "iP" monogram in rounded square
const InPlaceIcon = window.InPlaceIcon = ({ width = 50, height = 50 }) => (
  <svg width={width} height={height} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <rect x="2" y="2" width="96" height="96" rx="22" fill="var(--role-color)"/>
    <text x="50" y="66" textAnchor="middle" fontFamily="'DM Sans', sans-serif" fontWeight="800" fontSize="52" letterSpacing="-3" fill="var(--text-on-primary)">iP</text>
  </svg>
);
