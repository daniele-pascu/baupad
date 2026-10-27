const PATHS: Record<string, string> = {
  plus: 'M12 5v14M5 12h14',
  /** Tools: Grundriss (Projekte und Pläne) */
  blueprint: 'M4 4h16v16H4zM4 11h6v9M10 4v3M14 11h6M14 11v4M14 19v1',
  /** Tools: Arbeitereinteilung (Bauhelm) */
  helmet: 'M2 18.5h20v1.5H2zM4 18.5V16a8 8 0 0116 0v2.5M10 8.3V13M14 8.3V13M10 8.3a8 8 0 014 0',
  /** Tools: noch in Planung */
  soon: 'M12 3a9 9 0 110 18 9 9 0 010-18zM12 7v5l3 2',
  minus: 'M5 12h14',
  back: 'M15 18l-6-6 6-6',
  next: 'M9 18l6-6-6-6',
  close: 'M6 6l12 12M18 6L6 18',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
  folder: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z',
  file: 'M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5zM14 3v5h5',
  upload: 'M12 16V4M7 9l5-5 5 5M5 20h14',
  download: 'M12 4v12M7 11l5 5 5-5M5 20h14',
  excel: 'M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5zM9 12l4 5M13 12l-4 5',
  pdf: 'M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5zM8.5 16v-4h1.5a1 1 0 010 2H8.5M13 12v4h1a2 2 0 000-4h-1',
  select: 'M5 3l14 8-6 2-2 6-6-16z',
  hand: 'M8 13V5.5a1.5 1.5 0 013 0V12M11 11.5v-7a1.5 1.5 0 013 0V12M14 11.5V6.5a1.5 1.5 0 013 0V15a6 6 0 01-6 6h-1a6 6 0 01-5-2.7L3.3 15a1.5 1.5 0 012.4-1.8L8 15.5',
  ellipse: 'M12 5c5 0 9 3.1 9 7s-4 7-9 7-9-3.1-9-7 4-7 9-7z',
  rect: 'M4 6h16v12H4z',
  freehand: 'M4 15c2-6 4-9 6-6s0 8 3 8 4-9 7-9',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  undoView: 'M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3',
  table: 'M3 5h18v14H3zM3 10h18M3 15h18M9 5v14',
  map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14',
  check: 'M5 12l5 5L20 7',
  more: 'M12 6h.01M12 12h.01M12 18h.01',
  save: 'M5 3h11l3 3v13a2 2 0 01-2 2H7a2 2 0 01-2-2V3zM8 3v5h7V3M8 21v-7h8v7',
  layers: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5',
  crop: 'M6 2v14h14M2 6h14v14',
  info: 'M12 8h.01M11 12h1v5h1M12 21a9 9 0 100-18 9 9 0 000 18z',
  share: 'M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 002 2h10a2 2 0 002-2v-6',
  wifiOff: 'M2 2l20 20M8.5 16.5a5 5 0 017 0M5 12.5a10 10 0 015.2-2.8M19 12.5a10 10 0 00-2.1-1.6M2 8.8a15 15 0 014.2-2.6M22 8.8A15 15 0 0011.5 5M12 20h.01',
  hash: 'M5 9h14M5 15h14M10 3L8 21M16 3l-2 18',
  line: 'M5 19L19 5',
  triangle: 'M12 4l9 16H3z',
  component: 'M12 21a9 9 0 100-18 9 9 0 000 18zM8.6 16.2L12 7.5l3.4 8.7M9.9 13.2h4.2',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-4',
  redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 000 10h4',
  dimension: 'M4 7v10M20 7v10M4 12h16M7.5 9.5L4 12l3.5 2.5M16.5 9.5L20 12l-3.5 2.5',
  text: 'M5 7V5h14v2M12 5v14M9 19h6',
  grid: 'M4 4h16v16H4zM4 9.33h16M4 14.67h16M9.33 4v16M14.67 4v16',
  ortho: 'M5 3v16h16M5 13h6v6',
  orthoAuto: 'M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3',
  orthoH: 'M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4',
  orthoV: 'M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4',
  snap: 'M12 2v5M12 17v5M2 12h5M17 12h5M12 15a3 3 0 100-6 3 3 0 000 6z',
  calibrate: 'M3 17L17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2',
  zoomSel: 'M10 17a7 7 0 100-14 7 7 0 000 14zM21 21l-5.2-5.2M7.5 7.5h5v5h-5z',
  arc: 'M4 18a8 8 0 0116 0M4 18h.01M12 10h.01M20 18h.01',
  move: 'M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3',
  copy: 'M8 8h11v11H8zM5 16V5h11',
  stretch: 'M4 4h7v7H4zM14 14l6 6M20 14v6h-6',
  trim: 'M6 6a2 2 0 100 4 2 2 0 000-4zM6 14a2 2 0 100 4 2 2 0 000-4zM8 9l12 8M8 15l12-8',
  extend: 'M3 12h12M15 12l-3-3M15 12l-3 3M20 4v16',
  rotate: 'M20 12a8 8 0 11-2.3-5.7M20 4v4h-4',
  scale: 'M4 14v6h6M4 20l7-7M14 4h6v6M20 4l-7 7',
  polyline: 'M3 18l5-9 6 5 7-10M3 18h.01M8 9h.01M14 14h.01M21 4h.01',
  polygon: 'M5 18L4 8l8-5 8 6-3 10z',
  wall: 'M3 6h18v12H3zM3 12h18M9 6v6M15 12v6',
  ruler: 'M3 17L17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2',
  angle: 'M4 19h16M4 19L15 5M10 19a6.5 6.5 0 00-2.4-5',
  radius: 'M4 12a8 8 0 1016 0 8 8 0 10-16 0M12 12h8M12 12h.01',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  drawPlan: 'M3 21l3.5-1 11-11-2.5-2.5-11 11L3 21zM14 6.5l2.5 2.5M3 3h7M3 3v7',
};

export function Icon({ name, size = 22, className }: { name: keyof typeof PATHS | string; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name] ?? ''} />
    </svg>
  );
}
