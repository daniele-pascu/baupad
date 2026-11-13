import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Icon } from '../../components/Icon';
import { ToolIcon } from '../../components/ToolIcon';
import { paths } from '../../lib/router';
import { useLang } from '../i18n';
import { TOOL_ENTRIES, toolPath } from '../products';
import { motionOk } from './Reveal';
import { Badge } from './Section';

/**
 * Produktbühne der Startseite: ein Gebäude, das beim Scrollen Stockwerk für Stockwerk aufgebaut wird –
 * je Stockwerk ein Werkzeug von BauPad. Der Kran senkt jede Decke ab, die Fenster gehen an, die Maßkette wächst mit.
 * Ohne Bewegung (System-Einstellung) steht das Gebäude fertig da. Rein gezeichnet (SVG), keine Bilder der Software.
 */

// Isometrie: Grundriss S × S, Geschoßhöhe H, N Geschoße; D = Höhe, aus der eine Decke abgesenkt wird
const CX = 250;
const CY = 510;
const S = 190;
const H = 46;
const N = TOOL_ENTRIES.length;
const D = 110;
const KX = 0.866;
const P = (x: number, y: number, z: number): [number, number] => [CX + (x - y) * KX, CY + (x + y) * 0.5 - z];
const pts = (...a: [number, number][]) => a.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

// Kran: Mast rechts hinter dem Gebäude, Ausleger über die Gebäudemitte; Laufkatze T genau über der Mitte
const MX = CX + 251;
const MAST_TOP = 140;
const MAST_BASE = 595;
const T: [number, number] = [CX, 150];
const TIP: [number, number] = [MX - 356, 154];
const BACK: [number, number] = [MX + 75, 137];
const PEAK: [number, number] = [MX, 96];
const HOOK_REST = 196;
const GROUND_MID = CY + S / 2; // Bildhöhe der Gebäudemitte am Boden
const DIM_X = CX - S * KX - 30;

/** Leuchtfarbe je Werkzeug auf dunkler Fassade (dunkle Töne aufgehellt) */
const LIT: Record<string, string> = { projects: '#ff7a2b', workers: '#4d95f5', reports: '#b47bff', photos: '#8fb4e6', defects: '#f0484f', times: '#1fc296', materials: '#e0a21a' };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Zickzack-Fachwerk zwischen zwei Linien (Mast, Ausleger) */
function lattice(a0: [number, number], a1: [number, number], b0: [number, number], b1: [number, number], n: number): string {
  let d = '';
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const [p0, p1] = i % 2 ? [b0, b1] : [a0, a1];
    d += `${i ? 'L' : 'M'}${(p0[0] + (p1[0] - p0[0]) * t).toFixed(1)} ${(p0[1] + (p1[1] - p0[1]) * t).toFixed(1)}`;
  }
  return d;
}

export function BuildScene() {
  const { lang, t } = useLang();
  const b = t.home.build;
  const root = useRef<HTMLElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [done, setDone] = useState(N);
  const [hot, setHot] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = root.current;
    const g = svg.current;
    if (!el || !g || !motionOk()) return;
    const pin = el.querySelector<HTMLElement>('.ps-build-pin')!;
    const stage = el.querySelector<HTMLElement>('.ps-build-stage')!;
    const floors = Array.from(g.querySelectorAll<SVGGElement>('.bf'));
    const cable = g.querySelector<SVGLineElement>('.bc-cable')!;
    const hook = g.querySelector<SVGGElement>('.bc-hook')!;
    const slings = Array.from(g.querySelectorAll<SVGLineElement>('.bc-sling'));
    const shadow = g.querySelector<SVGPolygonElement>('.b-shadow')!;
    const dimLine = g.querySelector<SVGLineElement>('.bd-line')!;
    const dimTop = g.querySelector<SVGGElement>('.bd-top')!;
    el.classList.add('is-live');

    let cur = -1; // geglätteter Fortschritt 0..1
    let target = 0;
    let sx = 0; // Pendeln der Last (px)
    let sv = 0;
    let lastVel = 0;
    let dimH = 0;
    let landed = -1;
    let raf = 0;

    const measure = () => {
      const vh = window.innerHeight;
      const head = 68;
      const r = el.getBoundingClientRect();
      const pinned = getComputedStyle(pin).position === 'sticky' && r.height > vh * 1.4;
      if (pinned) {
        // beginnt, sobald der Abschnitt ins Bild kommt, und endet kurz vor dem Lösen der Bühne
        const start = vh * 0.6;
        target = clamp01((start - r.top) / (r.height - (vh - head) + start - head - vh * 0.12));
      } else {
        const s = stage.getBoundingClientRect();
        target = clamp01((vh * 0.9 - s.top) / (s.height * 0.75 + vh * 0.15));
      }
    };

    const draw = () => {
      const seg = cur * (N + 0.35);
      const k = Math.min(N - 1, Math.floor(seg));
      let count = 0;
      for (let i = 0; i < N; i++) {
        const tt = clamp01(seg - i);
        const f = floors[i];
        if (tt <= 0) {
          f.style.opacity = '0';
          continue;
        }
        const e = tt < 0.2 ? 0 : ease((tt - 0.2) / 0.8);
        const z = D * (1 - e);
        f.style.opacity = String(Math.min(1, tt / 0.2));
        f.setAttribute('transform', `translate(${(sx * (1 - e)).toFixed(2)} ${(-z).toFixed(2)})`);
        if (tt >= 1) count++;
      }
      // Haken: fährt leer zur nächsten Decke hoch, senkt sie ab; am Ende zurück in die Ruhelage
      const tk = clamp01(seg - k);
      const topOf = (i: number, z: number) => GROUND_MID - (i + 1) * H - z;
      let hy: number;
      let hx = 0;
      let carrying = false;
      let ek = 0;
      if (seg >= N) {
        hy = topOf(N - 1, 0) - 30 + (HOOK_REST - (topOf(N - 1, 0) - 30)) * ease(clamp01((seg - N) / 0.35));
      } else if (tk < 0.2) {
        const from = k === 0 ? HOOK_REST : topOf(k - 1, 0) - 30;
        hy = from + (topOf(k, D) - 30 - from) * ease(tk / 0.2);
        carrying = tk > 0.12;
      } else {
        ek = ease((tk - 0.2) / 0.8);
        hy = topOf(k, D * (1 - ek)) - 30;
        hx = sx * (1 - ek);
        carrying = tk < 0.985;
      }
      cable.setAttribute('x2', (CX + hx).toFixed(2));
      cable.setAttribute('y2', (hy - 12).toFixed(2));
      hook.setAttribute('transform', `translate(${hx.toFixed(2)} ${hy.toFixed(2)})`);
      const zNow = seg >= N ? 0 : tk < 0.2 ? D : D * (1 - ek);
      const corners: [number, number][] = [P(0, 0, (k + 1) * H + zNow), P(S, 0, (k + 1) * H + zNow), P(S, S, (k + 1) * H + zNow), P(0, S, (k + 1) * H + zNow)];
      slings.forEach((s, i) => {
        s.style.opacity = carrying ? '1' : '0';
        s.setAttribute('x1', (CX + hx).toFixed(2));
        s.setAttribute('y1', hy.toFixed(2));
        s.setAttribute('x2', (corners[i][0] + hx).toFixed(2));
        s.setAttribute('y2', corners[i][1].toFixed(2));
      });
      // Schatten der schwebenden Decke auf dem Geschoß darunter
      shadow.setAttribute('transform', `translate(0 ${(-k * H).toFixed(1)})`);
      shadow.style.opacity = seg < N && tk > 0.2 && tk < 1 ? (0.55 * ek).toFixed(3) : '0';
      // Maßkette wächst mit den fertigen Geschoßen
      dimLine.setAttribute('y2', (GROUND_MID - dimH).toFixed(2));
      dimTop.setAttribute('transform', `translate(0 ${(-dimH).toFixed(2)})`);
      if (count !== landed) {
        landed = count;
        setDone(count);
      }
    };

    const tick = () => {
      raf = 0;
      measure();
      if (cur < 0) cur = target;
      const vel = target - cur;
      cur += vel * 0.14;
      // Pendel: Beschleunigung des Scrollens stößt die Last an, Feder und Dämpfung bringen sie zur Ruhe
      sv += -0.05 * sx - 0.09 * sv + (vel - lastVel) * 520;
      sx = Math.max(-9, Math.min(9, sx + sv));
      lastVel = vel;
      dimH += (Math.max(0, landed) * H - dimH) * 0.16;
      draw();
      if (Math.abs(target - cur) > 0.0004 || Math.abs(sx) > 0.05 || Math.abs(sv) > 0.05 || Math.abs(Math.max(0, landed) * H - dimH) > 0.3) raf = requestAnimationFrame(tick);
      else cur = target;
    };
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };
    measure();
    cur = target;
    draw();
    dimH = Math.max(0, landed) * H;
    draw();
    window.addEventListener('scroll', kick, { passive: true });
    window.addEventListener('resize', kick);
    return () => {
      window.removeEventListener('scroll', kick);
      window.removeEventListener('resize', kick);
      if (raf) cancelAnimationFrame(raf);
      el.classList.remove('is-live');
    };
  }, []);

  const shown = hot ?? Math.max(0, Math.min(N, done) - 1);
  return (
    <section className="ps-build" id="baupad" ref={root} aria-labelledby="ps-build-title" data-testid="build-scene">
      <div className="ps-build-pin">
        <div className="ps-wrap ps-build-grid">
          <div className="ps-build-head">
            <p className="ps-eyebrow ps-eyebrow-light">{b.eyebrow}</p>
            <h2 id="ps-build-title" className="ps-h2">
              <img className="ps-build-logo" src="/icons/baupad-icon.png" alt="" width={59} height={56} />
              {b.title}
            </h2>
            <p className="ps-lead ps-lead-light">
              {b.text} <Badge kind="plan">{t.common.available}</Badge>
            </p>
          </div>
          <div className="ps-build-tools">
            <ol className="ps-build-list" data-testid="build-list">
              {TOOL_ENTRIES.map((x, i) => (
                <li key={x.id} className={`${i < done ? 'is-on' : ''}${hot === i ? ' is-hot' : ''}`}>
                  <a href={toolPath(x.id, lang)} style={{ '--c': x.color } as CSSProperties} onPointerEnter={() => setHot(i)} onPointerLeave={() => setHot(null)} onFocus={() => setHot(i)} onBlur={() => setHot(null)}>
                    <span className="ps-build-ico">
                      <ToolIcon name={x.icon} size={16} />
                    </span>
                    <strong>{t.tools[x.id].title}</strong>
                    <small>{t.tools[x.id].short}</small>
                    <em aria-hidden="true">{String(i + 1).padStart(2, '0')}</em>
                  </a>
                </li>
              ))}
            </ol>
            <p className="ps-build-cap" aria-hidden="true">
              {t.tools[TOOL_ENTRIES[shown].id].short}
            </p>
            <div className="ps-actions">
              <a href={paths.baupad(lang)} className="ps-btn ps-btn-light" data-testid="cta-baupad-2">
                {b.cta} <Icon name="next" size={16} />
              </a>
            </div>
          </div>
          <div className="ps-build-stage" role="img" aria-label={b.stageLabel}>
            <svg ref={svg} viewBox="0 80 610 690" aria-hidden="true" focusable="false">
              <defs>
                <radialGradient id="b-ground" cx="50%" cy="50%" r="50%">
                  <stop offset="0" stopColor="#fff" stopOpacity="0.1" />
                  <stop offset="1" stopColor="#fff" stopOpacity="0" />
                </radialGradient>
              </defs>
              {/* Bauplatz: Bodenplatte mit Raster */}
              <ellipse cx={CX} cy={GROUND_MID + 18} rx={300} ry={150} fill="url(#b-ground)" />
              <polygon className="b-pad" points={pts(P(-46, -46, 0), P(S + 46, -46, 0), P(S + 46, S + 46, 0), P(-46, S + 46, 0))} />
              <g className="b-grid">
                {[0, 1, 2, 3, 4, 5, 6].map((i) => {
                  const v = -46 + (i * (S + 92)) / 6;
                  const a = P(v, -46, 0);
                  const c = P(v, S + 46, 0);
                  const d = P(-46, v, 0);
                  const e = P(S + 46, v, 0);
                  return (
                    <g key={i}>
                      <line x1={a[0]} y1={a[1]} x2={c[0]} y2={c[1]} />
                      <line x1={d[0]} y1={d[1]} x2={e[0]} y2={e[1]} />
                    </g>
                  );
                })}
              </g>
              {/* Kran: Mast und Fuß (hinter dem Gebäude) */}
              <g className="b-crane">
                <polygon points={pts([MX - 22, MAST_BASE + 6], [MX + 22, MAST_BASE + 6], [MX + 12, MAST_BASE - 8], [MX - 12, MAST_BASE - 8])} className="bc-base" />
                <line x1={MX - 7} y1={MAST_BASE - 8} x2={MX - 7} y2={MAST_TOP} />
                <line x1={MX + 7} y1={MAST_BASE - 8} x2={MX + 7} y2={MAST_TOP} />
                <path className="bc-thin" d={lattice([MX - 7, MAST_BASE - 8], [MX - 7, MAST_TOP], [MX + 7, MAST_BASE - 8], [MX + 7, MAST_TOP], 30)} />
              </g>
              {/* Schatten der schwebenden Decke */}
              <polygon className="b-shadow" points={pts(P(0, 0, 0), P(S, 0, 0), P(S, S, 0), P(0, S, 0))} style={{ opacity: 0 }} />
              {/* Geschoße */}
              {TOOL_ENTRIES.map((x, i) => {
                const z0 = i * H;
                const z1 = z0 + H;
                const title = t.tools[x.id].title;
                const fs = Math.min(13.5, 146 / (title.length * 0.58));
                const o = P(0, S, z1);
                return (
                  <g key={x.id} className={`bf${i < done ? ' is-on' : ''}${hot === i ? ' is-hot' : ''}`} style={{ '--c': LIT[x.id] ?? x.color } as CSSProperties}>
                    <polygon className="bf-top" points={pts(P(0, 0, z1), P(S, 0, z1), P(S, S, z1), P(0, S, z1))} />
                    <polygon className="bf-left" points={pts(P(0, S, z0), P(S, S, z0), P(S, S, z1), P(0, S, z1))} />
                    <polygon className="bf-right" points={pts(P(S, S, z0), P(S, 0, z0), P(S, 0, z1), P(S, S, z1))} />
                    <polygon className="bf-band-l" points={pts(P(0, S, z1 - 7), P(S, S, z1 - 7), P(S, S, z1), P(0, S, z1))} />
                    <polygon className="bf-band-r" points={pts(P(S, S, z1 - 7), P(S, 0, z1 - 7), P(S, 0, z1), P(S, S, z1))} />
                    {[0, 1, 2, 3, 4].map((j) => {
                      const ya = S - 14 - j * 34;
                      const yb = ya - 22;
                      return <polygon key={j} className="bf-win" style={{ '--j': j } as CSSProperties} points={pts(P(S, ya, z0 + 9), P(S, yb, z0 + 9), P(S, yb, z1 - 15), P(S, ya, z1 - 15))} />;
                    })}
                    {/* Beschriftung liegt in der Fassadenebene */}
                    <g className="bf-sign" transform={`matrix(${KX} 0.5 0 1 ${o[0].toFixed(1)} ${o[1].toFixed(1)})`}>
                      <g transform="translate(13 17)">
                        <ToolIcon name={x.icon} size={18} />
                      </g>
                      <text x={39} y={31} fontSize={fs.toFixed(1)}>
                        {title}
                      </text>
                    </g>
                    {i === N - 1 && (
                      <g transform={`matrix(${KX} 0.5 ${-KX} 0.5 ${P(0, 0, z1)[0].toFixed(1)} ${P(0, 0, z1)[1].toFixed(1)})`}>
                        <image href="/icons/baupad-icon.png" x={S / 2 - 46} y={S / 2 - 44} width={92} height={88} />
                      </g>
                    )}
                  </g>
                );
              })}
              {/* Kran: Ausleger, Spitze, Gegengewicht, Laufkatze, Seil und Haken (vor dem Gebäude) */}
              <g className="b-crane">
                <line x1={TIP[0]} y1={TIP[1]} x2={BACK[0]} y2={BACK[1]} />
                <line x1={TIP[0] + 14} y1={TIP[1] - 11} x2={MX} y2={MAST_TOP - 11} />
                <path className="bc-thin" d={lattice([TIP[0] + 14, TIP[1]], [MX, MAST_TOP], [TIP[0] + 14, TIP[1] - 11], [MX, MAST_TOP - 11], 26)} />
                <line x1={TIP[0]} y1={TIP[1]} x2={TIP[0] + 14} y2={TIP[1] - 11} />
                <line x1={MX - 7} y1={MAST_TOP} x2={PEAK[0]} y2={PEAK[1]} />
                <line x1={MX + 7} y1={MAST_TOP} x2={PEAK[0]} y2={PEAK[1]} />
                <line className="bc-thin" x1={PEAK[0]} y1={PEAK[1]} x2={TIP[0] + 110} y2={TIP[1] - 15} />
                <line className="bc-thin" x1={PEAK[0]} y1={PEAK[1]} x2={BACK[0]} y2={BACK[1]} />
                <rect className="bc-weight" x={BACK[0] - 30} y={BACK[1]} width={30} height={22} />
                <rect className="bc-cab" x={MX + 7} y={MAST_TOP + 4} width={16} height={20} rx={2} />
                <rect className="bc-trolley" x={T[0] - 9} y={T[1] - 4} width={18} height={7} rx={1.5} />
                <line className="bc-cable" x1={T[0]} y1={T[1] + 3} x2={CX} y2={HOOK_REST - 12} />
                {[0, 1, 2, 3].map((i) => (
                  <line key={i} className="bc-sling" x1={CX} y1={HOOK_REST} x2={CX} y2={HOOK_REST} style={{ opacity: 0 }} />
                ))}
                <g className="bc-hook" transform={`translate(0 ${HOOK_REST})`}>
                  <rect x={CX - 6} y={-12} width={12} height={10} rx={2} />
                  <path d={`M${CX} -2v5a4 4 0 1 1-4 4`} />
                </g>
              </g>
              {/* Maßkette links: wächst mit den fertigen Geschoßen */}
              <g className="b-dim">
                <line className="bd-ext" x1={CX - S * KX - 6} y1={GROUND_MID} x2={DIM_X - 8} y2={GROUND_MID} />
                <line x1={DIM_X - 7} y1={GROUND_MID + 7} x2={DIM_X + 7} y2={GROUND_MID - 7} />
                <line className="bd-line" x1={DIM_X} y1={GROUND_MID} x2={DIM_X} y2={GROUND_MID - N * H} />
                <g className="bd-top" transform={`translate(0 ${-N * H})`}>
                  <line className="bd-ext" x1={CX - S * KX - 6} y1={GROUND_MID} x2={DIM_X - 8} y2={GROUND_MID} />
                  <line x1={DIM_X - 7} y1={GROUND_MID + 7} x2={DIM_X + 7} y2={GROUND_MID - 7} />
                  <text x={DIM_X - 12} y={GROUND_MID + 22} textAnchor="end" data-testid="build-count">
                    {Math.min(N, done)}/{N}
                  </text>
                </g>
              </g>
            </svg>
          </div>
        </div>
      </div>
    </section>
  );
}
