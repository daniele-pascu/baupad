import { useEffect, useRef } from 'react';

/**
 * PAD-Zeichen als weißes Liquid Glass, mit der abgestimmten Intro-Animation (docs/logo/pad-logo-animation.html):
 * das Zeichen wächst gleichzeitig von seinen zwei Anfangskanten – oben ab der schrägen linken Kante nach rechts,
 * um die Rundung und unten zurück; Schrägbalken und Dreieck ab der oberen Kante nach unten. Alle Teile beginnen und
 * enden zusammen, 0,75 s, oben gleichmäßiges Tempo, nur ganz kurz weich an- und auslaufend.
 * Die Linien bilden eine Maske; sichtbar ist darunter das Glas: milchige Fläche, heller Lichtsaum an der Kante.
 * „Bewegung reduzieren“ → sofort fertig.
 */
const D_PATH =
  'M242.85 0.63 L546.82 0.63 C710.14 0.63 854.78 131.35 854.78 311.97 C854.78 494.7 711.66 656.02 541.2 656.02 L306.77 656.02 L383.14 484.84 L562.68 484.84 C610.05 484.84 690.17 410.8 690.17 327.06 C690.17 212.94 600.07 165.81 527.98 165.81 L151.52 165.81 Z';
const L_PATH = 'M253.11 245.14 L480.25 245.14 L379.32 422.68 L185.01 829.9 L-3.54 829.9 Z';
const T_PATH = 'M480.25 245.14 L608.34 468.42 C592.2 478.87 576.12 484.84 562.68 484.84 L412.68 484.84 L379.32 422.68 Z';

const DUR = 750; // ganze Animation in ms
const R = 0.14; // weicher Anlauf und Auslauf (Anteil), dazwischen gleichmäßig
const TOT = 1344.2; // Weglänge der Linie oben (Balken, Rundung, Balken)
const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const VMAX = 1 / (1 - R);
const ease = (t: number) => (t < R ? (VMAX * t * t) / (2 * R) : t > 1 - R ? 1 - (VMAX * (1 - t) * (1 - t)) / (2 * R) : VMAX * (t - R / 2));

export function PadMarkGlass({ delay = 350 }: { delay?: number }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const get = (id: string) => svg.querySelector<SVGPathElement>(`[data-s="${id}"]`)!;
    const A = get('a'), B = get('b'), C = get('c'), L = get('l'), T = get('t');
    const set = (p: number) => {
      const s = p * TOT;
      A.style.strokeDashoffset = String(1 - clamp(s / 392.2));
      B.style.strokeDashoffset = String(1 - clamp((s - 337.2) / 762));
      C.style.strokeDashoffset = String(1 - clamp((s - 1087.2) / 257));
      // Schrägbalken und Dreieck kommen gleichzeitig mit der Linie oben an
      L.style.strokeDashoffset = T.style.strokeDashoffset = String(1 - p);
    };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      set(1);
      return;
    }
    set(0);
    let raf = 0;
    let t0: number | undefined;
    const frame = (now: number) => {
      if (t0 === undefined) t0 = now;
      const t = clamp((now - t0) / DUR);
      set(ease(t));
      if (t < 1) raf = requestAnimationFrame(frame);
    };
    const timer = setTimeout(() => (raf = requestAnimationFrame(frame)), delay);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [delay]);

  const line = { fill: 'none', stroke: '#fff', strokeLinecap: 'butt', strokeDasharray: '1 1', strokeDashoffset: 1 } as const;
  return (
    <svg ref={ref} className="ps-mark-glass" viewBox="-4 0 859 830" aria-hidden="true" focusable="false" data-testid="pad-mark-glass">
      <defs>
        <clipPath id="pmg-cD">
          <path d={D_PATH} />
        </clipPath>
        <clipPath id="pmg-cL">
          <path d={L_PATH} />
        </clipPath>
        <clipPath id="pmg-cT">
          <path d={T_PATH} />
        </clipPath>
        {/* Glas: oben links heller, zur Mitte fast klar, unten rechts ein Hauch */}
        <linearGradient id="pmg-fill" x1="0" y1="0" x2="855" y2="830" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity=".55" />
          <stop offset=".42" stopColor="#fff" stopOpacity=".24" />
          <stop offset=".72" stopColor="#fff" stopOpacity=".16" />
          <stop offset="1" stopColor="#fff" stopOpacity=".3" />
        </linearGradient>
        {/* Dreieck (Falz): von oben hell nach unten fast klar – gibt die Tiefe */}
        <linearGradient id="pmg-fold" x1="0" y1="245" x2="0" y2="485" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity=".42" />
          <stop offset="1" stopColor="#fff" stopOpacity=".06" />
        </linearGradient>
        {/* Lichtsaum an der Kante: oben links kräftig, läuft aus, unten rechts ein Rest */}
        <linearGradient id="pmg-edge" x1="0" y1="0" x2="855" y2="830" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity="1" />
          <stop offset=".35" stopColor="#fff" stopOpacity=".55" />
          <stop offset=".62" stopColor="#fff" stopOpacity=".25" />
          <stop offset="1" stopColor="#fff" stopOpacity=".65" />
        </linearGradient>
        <mask id="pmg-reveal" maskUnits="userSpaceOnUse" x="-10" y="-10" width="880" height="850">
          <g clipPath="url(#pmg-cD)">
            <g transform="translate(0 82) skewX(-29.94) translate(0 -82)">
              <path data-s="a" pathLength={1} strokeWidth={190} d="M197.8 82 L590 82" style={line} />
            </g>
            <path data-s="b" pathLength={1} strokeWidth={190} d="M535 82 A240 245 0 0 1 535 572" style={line} />
            <path data-s="c" pathLength={1} strokeWidth={190} d="M547 572 L290 572" style={line} />
          </g>
          <path data-s="l" clipPath="url(#pmg-cL)" pathLength={1} strokeWidth={700} d="M300 244 L300 832" style={line} />
          <path data-s="t" clipPath="url(#pmg-cT)" pathLength={1} strokeWidth={300} d="M492 244 L492 486" style={line} />
        </mask>
      </defs>
      <g mask="url(#pmg-reveal)">
        <path d={D_PATH} fill="url(#pmg-fill)" />
        <path d={L_PATH} fill="url(#pmg-fill)" />
        <path d={T_PATH} fill="url(#pmg-fold)" />
        {/* Kante nur nach innen sichtbar (Strich an der Form beschnitten) */}
        <path d={D_PATH} fill="none" stroke="url(#pmg-edge)" strokeWidth={6} clipPath="url(#pmg-cD)" />
        <path d={L_PATH} fill="none" stroke="url(#pmg-edge)" strokeWidth={6} clipPath="url(#pmg-cL)" />
        <path d={T_PATH} fill="none" stroke="url(#pmg-edge)" strokeWidth={4} clipPath="url(#pmg-cT)" />
      </g>
    </svg>
  );
}
