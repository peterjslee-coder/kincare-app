const InPlaceIcon = window.InPlaceIcon = ({ width = 50, height = 50 }) => (
  <svg width={width} height={height} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <circle cx="50" cy="50" r="48" fill="#1b6b5a"/>
    <circle cx="50" cy="35" r="12" fill="white"/>
    <path d="M 50 50 Q 35 60 30 75 L 70 75 Q 65 60 50 50" fill="white"/>
  </svg>
);
