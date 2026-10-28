import type { CSSProperties } from 'react';

/**
 * Animierte Illustrationen der Startseite (nur CSS/SVG, keine Fremddateien):
 * Geräte-Bühne mit Handy, PC und zweitem Handy in 3D-Perspektive, Messgerät mit Laserstrahl und
 * Plan, der sich selbst zeichnet, sowie eine Wochenplanung, in die Namen einfliegen.
 */

/** Handy-Rahmen mit Bild */
export function Phone({ src, alt, className, style }: { src: string; alt: string; className?: string; style?: CSSProperties }) {
  return (
    <div className={`mock-phone${className ? ` ${className}` : ''}`} style={style}>
      <span className="mock-notch" aria-hidden="true" />
      <img src={src} alt={alt} loading="lazy" />
    </div>
  );
}

/** Laptop-Rahmen mit Bild */
export function Laptop({ src, alt, className, style }: { src: string; alt: string; className?: string; style?: CSSProperties }) {
  return (
    <div className={`mock-laptop${className ? ` ${className}` : ''}`} style={style}>
      <div className="mock-screen">
        <img src={src} alt={alt} loading="lazy" />
      </div>
      <div className="mock-base" aria-hidden="true" />
    </div>
  );
}

/** Geräte-Bühne: PC hinten, zwei Handys davor; neigt sich leicht mit der Maus */
export function DeviceStage() {
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    e.currentTarget.style.setProperty('--tilt-y', `${x * 14}deg`);
    e.currentTarget.style.setProperty('--tilt-x', `${-y * 10}deg`);
  };
  const onLeave = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.style.setProperty('--tilt-y', '0deg');
    e.currentTarget.style.setProperty('--tilt-x', '0deg');
  };
  return (
    <div className="stage" onPointerMove={onMove} onPointerLeave={onLeave} data-testid="device-stage">
      <div className="stage-inner">
        <Laptop src="./site/aufmass-editor.jpg" alt="BauPad am PC: Aufmaß im Plan" className="stage-laptop" />
        <Phone src="./site/kamera-iphone.jpg" alt="BauPad am Handy: Kamera-Modus" className="stage-phone-a" />
        <Phone src="./site/berichte-regie-iphone.jpg" alt="BauPad am Handy: Regieliste" className="stage-phone-b" />
        <span className="stage-chip chip-1">4,20 m</span>
        <span className="stage-chip chip-2">KW 44</span>
        <span className="stage-chip chip-3">PDF</span>
      </div>
    </div>
  );
}

/** Messen: Laser-Distanzmesser, Strahl zur Wand, Fläche zeichnet sich im Plan */
export function MeasureArt() {
  return (
    <svg className="art art-measure" viewBox="0 0 520 320" role="img" aria-label="Messen mit Laser und Plan">
      {/* Plan */}
      <g className="art-plan">
        <rect x="30" y="30" width="300" height="220" rx="8" fill="#fff" stroke="#d2d2d7" />
        {[70, 110, 150, 190, 230, 270].map((x) => (
          <line key={x} x1={x} y1="30" x2={x} y2="250" stroke="#ececf0" />
        ))}
        {[70, 110, 150, 190, 230].map((y) => (
          <line key={y} x1="30" y1={y} x2="330" y2={y} stroke="#ececf0" />
        ))}
        <rect className="art-area" x="90" y="90" width="120" height="70" fill="rgba(255, 106, 19, 0.18)" stroke="#ff6a13" strokeWidth="2.5" />
        <g className="art-badge">
          <rect x="202" y="76" width="26" height="22" rx="6" fill="#fff" stroke="#ff6a13" strokeWidth="2" />
          <text x="215" y="92" textAnchor="middle" fontSize="13" fontWeight="700" fill="#ff6a13">
            1
          </text>
        </g>
        <text className="art-dim" x="150" y="182" textAnchor="middle" fontSize="13" fill="#1d1d1f" fontWeight="600">
          4,20 × 2,45 m · 10,29 m²
        </text>
      </g>
      {/* Wand + Laser */}
      <line x1="486" y1="40" x2="486" y2="300" stroke="#1d1d1f" strokeWidth="4" />
      <g className="art-laser">
        <rect x="360" y="200" width="54" height="92" rx="10" fill="#1d1d1f" />
        <rect x="370" y="212" width="34" height="22" rx="4" fill="#9ec5ff" />
        <circle cx="387" cy="262" r="8" fill="#ff3b30" />
        <circle cx="387" cy="262" r="3" fill="#fff" />
      </g>
      <line className="art-beam" x1="414" y1="223" x2="484" y2="223" stroke="#ff3b30" strokeWidth="2.5" strokeDasharray="6 6" />
      <circle className="art-dot" cx="484" cy="223" r="5" fill="#ff3b30" />
      <text className="art-value" x="449" y="212" textAnchor="middle" fontSize="12" fontWeight="700" fill="#1d1d1f">
        4,20 m
      </text>
    </svg>
  );
}

/** Verwalten: Wochenplanung, Namen fliegen ein, danach PDF */
export function ManageArt() {
  const days = ['Mo', 'Di', 'Mi', 'Do', 'Fr'];
  const rows = [
    ['Max', 'Peter'],
    ['Max', 'Peter'],
    ['Max', 'Ali'],
    ['Thomas', 'Ali'],
    ['Thomas', 'Ali'],
  ];
  return (
    <svg className="art art-manage" viewBox="0 0 520 320" role="img" aria-label="Wochenplanung mit Namen und PDF">
      <rect x="30" y="30" width="360" height="260" rx="14" fill="#fff" stroke="#d2d2d7" />
      <rect x="30" y="30" width="360" height="44" rx="14" fill="#1d1d1f" />
      <text x="50" y="58" fontSize="15" fontWeight="700" fill="#fff">
        KW 44 · Tiefgarage Parkdeck Nord
      </text>
      {days.map((d, i) => (
        <g key={d} transform={`translate(0 ${92 + i * 40})`}>
          <text x="50" y="16" fontSize="13" fontWeight="600" fill="#1d1d1f">
            {d}
          </text>
          <line x1="30" y1="30" x2="390" y2="30" stroke="#ececf0" />
          {rows[i].map((n, k) => (
            <g key={n} className="art-chip" style={{ animationDelay: `${0.4 + i * 0.25 + k * 0.12}s` } as CSSProperties}>
              <rect x={90 + k * 82} y="-2" width="72" height="26" rx="13" fill="#e8f0fe" stroke="#2f80ed" />
              <text x={126 + k * 82} y="15" textAnchor="middle" fontSize="12" fontWeight="600" fill="#1a4f9c">
                {n}
              </text>
            </g>
          ))}
        </g>
      ))}
      <g className="art-pdf">
        <rect x="412" y="150" width="78" height="100" rx="10" fill="#fff" stroke="#a259ff" strokeWidth="2" />
        <rect x="424" y="170" width="54" height="6" rx="3" fill="#d9c7ff" />
        <rect x="424" y="186" width="54" height="6" rx="3" fill="#d9c7ff" />
        <rect x="424" y="202" width="36" height="6" rx="3" fill="#d9c7ff" />
        <text x="451" y="238" textAnchor="middle" fontSize="12" fontWeight="700" fill="#a259ff">
          PDF
        </text>
      </g>
    </svg>
  );
}
