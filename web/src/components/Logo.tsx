// Boukarou mark: a round Cameroonian hut (thatched cone roof, clay wall, Grassfields zigzag band).
export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size * 60 / 64} viewBox="0 0 64 60" role="img" aria-label="Boukarou">
      <ellipse cx="32" cy="57.2" rx="24" ry="2.6" fill="#7a4a2c" opacity=".22"/>
      <path d="M13.5 34 C13.2 41 13.4 48 14.2 53.2 C21 56.8 43 56.8 49.8 53.2 C50.6 48 50.8 41 50.5 34Z" fill="#b6532e"/>
      <path d="M39.5 37.5 H50.6 C50.8 43 50.6 48.5 49.8 53.2 C47 54.7 43.5 55.5 39.5 55.9Z" fill="#8d3b1c" opacity=".45"/>
      <polyline points="14,44 17,40.5 20,44 23,40.5 26,44 29,40.5 32,44 35,40.5 38,44 41,40.5 44,44 47,40.5 50,44" fill="none" stroke="#f4dcb4" strokeWidth="1.3" strokeLinejoin="round"/>
      <path d="M14 47 H50" stroke="#f4dcb4" strokeWidth=".9" opacity=".55"/>
      <path d="M27 55.6 V47 A5 5 0 0 1 37 47 V55.6 C33.7 55.9 30.3 55.9 27 55.6Z" fill="#3a2314"/>
      <path d="M29 48 A3 3 0 0 1 32 45.4" stroke="#6b4329" strokeWidth=".9" fill="none"/>
      <path d="M32 6 L58 35.5 C50 39.6 14 39.6 6 35.5Z" fill="#dba341"/>
      <path d="M32 6 L58 35.5 C53 37.9 44.5 39.2 36.5 39.5Z" fill="#b57d26" opacity=".55"/>
      <g stroke="#9c6619" strokeWidth=".75" opacity=".6" strokeLinecap="round"><path d="M32 6 L11 35.9"/><path d="M32 6 L16 36.8"/><path d="M32 6 L21 37.4"/><path d="M32 6 L26.5 37.8"/><path d="M32 6 L32 37.9"/><path d="M32 6 L37.5 37.8"/><path d="M32 6 L43 37.4"/><path d="M32 6 L48 36.8"/><path d="M32 6 L53 35.9"/></g>
      <path d="M6.0 35.5 L8.0 38.7 L10.0 36.4Z M10.0 36.4 L12.0 39.5 L14.0 37.1Z M14.0 37.1 L16.0 40.2 L18.0 37.6Z M18.0 37.6 L20.0 40.7 L22.0 38.1Z M22.0 38.1 L24.0 41.0 L26.0 38.3Z M26.0 38.3 L28.0 41.2 L30.0 38.5Z M30.0 38.5 L32.0 41.3 L34.0 38.5Z M34.0 38.5 L36.0 41.2 L38.0 38.3Z M38.0 38.3 L40.0 41.0 L42.0 38.1Z M42.0 38.1 L44.0 40.7 L46.0 37.6Z M46.0 37.6 L48.0 40.2 L50.0 37.1Z M50.0 37.1 L52.0 39.5 L54.0 36.4Z M54.0 36.4 L56.0 38.7 L58.0 35.5Z" fill="#c48d2f"/>
      <path d="M32 6.5 V2" stroke="#5a3a1c" strokeWidth="1.7" strokeLinecap="round"/>
      <circle cx="32" cy="2.4" r="1.3" fill="#5a3a1c"/>
    </svg>
  );
}
