import React from 'react';

// A crisp synthetic macOS cursor (arrow, pointing hand, I-beam, closed hand). Hotspot at (0,0) of the box it is given.
// `s` is the size multiplier in px per cursor unit (the arrow is 16x23 units); `press` 1 = at rest, ~0.86 = pressed.
export const SpotCursor: React.FC<{kind: string; s: number; press: number; theme: 'mac' | 'light'; opacity: number}> = ({kind, s, press, theme, opacity}) => {
  const fill = theme === 'mac' ? '#0b0b0c' : '#ffffff';
  const stroke = theme === 'mac' ? '#ffffff' : '#0b0b0c';
  const base: React.CSSProperties = {position: 'absolute', left: 0, top: 0, overflow: 'visible', opacity, filter: `drop-shadow(0 ${1.6 * s}px ${2.6 * s}px rgba(0,0,0,0.38))`, pointerEvents: 'none'};
  if (kind === 'hand' || kind === 'grab') {
    const grab = kind === 'grab';
    return (
      <svg width={22 * s} height={24 * s} viewBox="0 0 22 24" style={{...base, left: -7.2 * s, top: -1 * s, transformOrigin: `${7.2 * s}px ${1 * s}px`, transform: `scale(${press})`}}>
        {grab ? (
          <path d="M5 9.5c0-1 .7-1.7 1.6-1.7.5 0 .9.2 1.2.5.1-.9.8-1.5 1.6-1.5.7 0 1.2.4 1.5.9.3-.4.8-.6 1.3-.6 1 0 1.7.8 1.7 1.8v5.2c0 2.4-1.9 4.3-4.3 4.3H9.5c-1.3 0-2.5-.7-3.2-1.7L4.3 14c-.5-.7-.4-1.6.2-2.1.6-.5 1.5-.5 2 .1L5 9.5z" fill="#fff" stroke="#0b0b0c" strokeWidth="1.2" strokeLinejoin="round" />
        ) : (
          <path d="M8.2 1.3c-1 0-1.7.8-1.7 1.8v8.1l-1.3-1.4c-.7-.7-1.8-.7-2.5 0-.6.6-.6 1.5-.1 2.2l4.6 5.9c.9 1.2 2.3 1.9 3.8 1.9h2.6c2.6 0 4.7-2.1 4.7-4.7V10c0-.9-.7-1.6-1.6-1.6s-1.6.7-1.6 1.6V9c0-.9-.7-1.6-1.6-1.6S11.9 8.1 11.9 9V8c0-.9-.7-1.6-1.6-1.6-.4 0-.7.1-.9.3V3.1c0-1-.2-1.8-1.2-1.8z" fill="#fff" stroke="#0b0b0c" strokeWidth="1.25" strokeLinejoin="round" />
        )}
      </svg>
    );
  }
  if (kind === 'text') {
    return (
      <svg width={10 * s} height={22 * s} viewBox="0 0 10 22" style={{...base, left: -5 * s, top: -11 * s, transform: `scale(${press})`}}>
        <path d="M2 1h6M2 21h6M5 1v20" stroke={stroke} strokeWidth="3.4" strokeLinecap="round" fill="none" />
        <path d="M2 1h6M2 21h6M5 1v20" stroke={fill} strokeWidth="1.5" strokeLinecap="round" fill="none" />
      </svg>
    );
  }
  return (
    <svg width={16 * s} height={23 * s} viewBox="0 0 16 23" style={{...base, transformOrigin: '0 0', transform: `scale(${press})`}}>
      <path d="M1 1 L1 18.2 L5.3 14.3 L8.2 21 L11 19.8 L8.1 13.3 L13.9 13.3 Z" fill={fill} stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
};
