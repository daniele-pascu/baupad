import type { FlashMode } from '../lib/flash';

/** Blitz-Symbol je Einstellung: Aus = durchgestrichen, Auto = Blitz mit „A“, An = Blitz */
export function FlashIcon({ mode, size = 22 }: { mode: FlashMode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-flash-icon={mode}>
      <path d={mode === 'auto' ? 'M10 2L3 13h5l-1 8 7-11H9l1-8z' : 'M13 2L5 14h6l-1 8 8-12h-6l1-8z'} />
      {mode === 'off' && <path d="M3 3l18 18" />}
      {mode === 'auto' && (
        <text x="19" y="11" textAnchor="middle" fontSize="10" fontWeight="700" fill="currentColor" stroke="none" fontFamily="system-ui, sans-serif">
          A
        </text>
      )}
    </svg>
  );
}
