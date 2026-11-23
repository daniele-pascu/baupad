import { WORDMARK_PATH, WORDMARK_VIEWBOX as V } from '../lib/wordmark';

/** Schriftzug „BauPad“ in der festen Markenschrift (Farbe = Textfarbe, Höhe über `height` bzw. CSS) */
export function BauPadWordmark({ height, className, label = 'BauPad' }: { height?: number; className?: string; label?: string | null }) {
  return (
    <svg
      viewBox={`${V.x} ${V.y} ${V.w} ${V.h}`}
      height={height}
      width={height ? Math.round((height * V.w) / V.h) : undefined}
      className={className ? `baupad-wordmark ${className}` : 'baupad-wordmark'}
      role={label ? 'img' : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <path d={WORDMARK_PATH} fill="currentColor" />
    </svg>
  );
}
