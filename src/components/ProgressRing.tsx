import { useEffect, useState } from 'react';

/**
 * Nächster angezeigter Wert: nie hinter dem echten Fortschritt; dazwischen rückt die Anzeige langsam weiter (höchstens
 * bis 90 %), damit auch ein einzelner langer Schritt sichtbar läuft und der Ring nie stehen bleibt.
 */
export const creep = (shown: number, real: number) => Math.max(real, shown + Math.max(0, 0.9 - shown) * 0.05);

/**
 * Fortschrittsring mit Prozentzahl – statt eines Knopfs, solange etwas erstellt wird (z. B. PDF). `value` 0–1 ist der
 * echte Fortschritt. Farben, Größe und Strichstärke stehen in styles.css unter `.progress-ring`.
 */
export function ProgressRing({ value, label, testId }: { value: number; label: string; testId?: string }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setShown((s) => creep(s, value)), 150);
    return () => window.clearInterval(t);
  }, [value]);
  const pct = Math.min(100, Math.round(Math.max(shown, value) * 100));
  const r = 18;
  const len = 2 * Math.PI * r;
  return (
    <span className="progress-ring" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} title={label} data-testid={testId}>
      <svg viewBox="0 0 44 44" aria-hidden="true">
        <circle className="pr-track" cx="22" cy="22" r={r} />
        <circle className="pr-bar" cx="22" cy="22" r={r} strokeDasharray={len} strokeDashoffset={len * (1 - pct / 100)} />
      </svg>
      <span className="pr-num">{pct}</span>
    </span>
  );
}
