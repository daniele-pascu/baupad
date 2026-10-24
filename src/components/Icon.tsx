const PATHS: Record<string, string> = {
  plus: 'M12 5v14M5 12h14',
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
