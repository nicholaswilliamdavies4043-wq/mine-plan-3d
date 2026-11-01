/** Small outlined icon set (24px grid, 1.6 stroke), drawn for this app. */
const P: Record<string, string> = {
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  cube: 'M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3zM12 12l8-4.5M12 12v9M12 12L4 7.5',
  help: 'M12 21a9 9 0 100-18 9 9 0 000 18zM9.5 9.5a2.5 2.5 0 114 2c-.9.6-1.5 1.1-1.5 2.2M12 17h.01',
  info: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v6M12 7.5h.01',
  sun: 'M12 16a4 4 0 100-8 4 4 0 000 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4',
  cursor: 'M5 3l13 7-6 1.5L9 18 5 3z',
  hand: 'M8 13V5.5a1.5 1.5 0 013 0V12M11 11V4.5a1.5 1.5 0 013 0V12M14 11.5V6a1.5 1.5 0 013 0v7c0 4-2.5 7-6.5 7S5 17.5 4 15l-1-2.5a1.5 1.5 0 012.6-1.4L8 14',
  region: 'M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3M10 4h4M10 20h4M4 10v4M20 10v4',
  exclude: 'M5 4h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5a1 1 0 011-1zM5 19L19 5',
  pen: 'M4 20l4-1 10.5-10.5a2.1 2.1 0 00-3-3L5 16l-1 4zM14 7l3 3',
  stope: 'M12 3l7.5 4.5v9L12 21l-7.5-4.5v-9L12 3zM8 10h8v5H8z',
  target: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 2v5M12 17v5M2 12h5M17 12h5M12 13a1 1 0 100-2 1 1 0 000 2z',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3',
  redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  play: 'M7 4l13 8-13 8V4z',
  upload: 'M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3',
  download: 'M12 4v12M7 11l5 5 5-5M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3',
  plus: 'M12 5v14M5 12h14',
  zoomIn: 'M10.5 18a7.5 7.5 0 100-15 7.5 7.5 0 000 15zM21 21l-5.2-5.2M10.5 7.5v6M7.5 10.5h6',
  zoomOut: 'M10.5 18a7.5 7.5 0 100-15 7.5 7.5 0 000 15zM21 21l-5.2-5.2M7.5 10.5h6',
  minus: 'M5 12h14',
  panel: 'M4 4h16a1 1 0 011 1v14a1 1 0 01-1 1H4a1 1 0 01-1-1V5a1 1 0 011-1zM15 4v16',
  expand: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5M4 4l6 6M20 4l-6 6M20 20l-6-6M4 20l6-6',
  shrink: 'M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5M4 4l5 5M20 4l-5 5M20 20l-5-5M4 20l5-5',
  chevron: 'M9 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  magnet: 'M5 4h4v8a3 3 0 006 0V4h4v8a7 7 0 01-14 0V4zM5 8h4M15 8h4',
  loupe: 'M10 17a7 7 0 100-14 7 7 0 000 14zM21 21l-6-6M10 7v6M7 10h6',
  x: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
  layers: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5',
  walk: 'M13 4a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM9 22l3-7 3 3v4M7 11l3-4 4 1 3 4M12 15l-1-6',
  orbit: 'M12 15a3 3 0 100-6 3 3 0 000 6zM3 12c0-2.5 4-4.5 9-4.5s9 2 9 4.5-4 4.5-9 4.5-9-2-9-4.5z',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  wand: 'M15 4V2M15 10V8M11 6H9M21 6h-2M18 3l-1.4 1.4M18 9l-1.4-1.4M12 9L3 18l3 3 9-9-3-3z',
  ruler: 'M3 17L17 3l4 4L7 21l-4-4zM7 13l2 2M10 10l2 2M13 7l2 2',
  sparkle: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6z',
  folder: 'M3 7a1 1 0 011-1h5l2 2h9a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V7z',
  arrowUp: 'M12 19V5M6 11l6-6 6 6',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 18, className, style }: { name: IconName; size?: number; className?: string; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}
      strokeLinecap="round" strokeLinejoin="round" className={className} style={style} aria-hidden="true">
      <path d={P[name]} />
    </svg>
  );
}
