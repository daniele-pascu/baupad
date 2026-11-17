import { useEffect, useRef, type CSSProperties, type RefObject } from 'react';
import { ToolIcon, type ToolIconName } from './ToolIcon';

export interface OrbitTool {
  id: ToolIconName;
  title: string;
  text: string;
  color: string;
  href?: string;
}

/** Bewegung reduzieren (Systemeinstellung)? */
const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
/** kräftiges ease-out (wie --ease) */
const easeOut = (t: number) => 1 - Math.pow(1 - t, 4);

/** Sekunden je Platz im Kreis (eine Karte rückt so lange nach vorn) */
const SECONDS_PER_SLOT = 3.4;
/** Intro: Karten fächern aus der Mitte auf, der Kreis dreht sich dabei an seinen Platz */
const INTRO_MS = 1300;
const INTRO_STEP_MS = 70;

/**
 * Werkzeuge als 3D-Karussell: vorne die große Karte, links und rechts schräg dahinter die nächsten, dahinter
 * ausgeblendet. Dreht sich ständig im Kreis; beim Betreten der Seite fächern die Karten aus der Mitte auf (Intro).
 * Hält an, solange die Maus darüber ist oder man es berührt; mit dem Finger bzw. der Maus seitlich ziehen dreht es
 * von Hand. Nur die vordere Karte ist antippbar (öffnet das Werkzeug). Für Bildschirmleser ausgeblendet – dieselben
 * Werkzeuge stehen darunter als Kacheln. Bewegung reduzieren: steht still, ohne Intro.
 */
export function ToolOrbit({ tools }: { tools: OrbitTool[] }) {
  const stage = useRef<HTMLDivElement>(null);
  const cards = useRef<(HTMLAnchorElement | null)[]>([]);
  const dots = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    const n = tools.length;
    const el = stage.current;
    if (!n || !el) return;
    const reduce = reducedMotion();
    const step = 360 / n;
    let angle = 0;
    let last = performance.now();
    const start = last;
    const intro = !reduce;
    let hover = false;
    let holdUntil = 0;
    let drag: { x: number; angle: number; moved: boolean } | null = null;
    let front = -1;
    let raf = 0;

    const size = () => {
      const w = el.clientWidth;
      return { r: clamp(w * 0.34, 120, 420), depth: clamp(w * 0.3, 110, 360) };
    };
    let dims = size();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => (dims = size())) : null;
    ro?.observe(el);

    const render = (t: number) => {
      // Intro: Drehung läuft von −1,5 Plätzen auf ihren Platz, die Karten fächern nacheinander auf (vorne zuerst)
      const ip = intro ? clamp((t - start) / INTRO_MS, 0, 1) : 1;
      const spin = intro ? (1 - easeOut(ip)) * -step * 1.5 : 0;
      let best = -2;
      let bestIdx = 0;
      for (let i = 0; i < n; i++) {
        const card = cards.current[i];
        if (!card) continue;
        let theta = (i * step - angle - spin) % 360;
        if (theta > 180) theta -= 360;
        if (theta < -180) theta += 360;
        const rad = (theta * Math.PI) / 180;
        const s = Math.sin(rad);
        const c = Math.cos(rad);
        // Abstand zur vorderen Position bestimmt die Reihenfolge im Intro
        const slot = Math.round(Math.abs(theta) / step);
        const p = intro ? easeOut(clamp((t - start - slot * INTRO_STEP_MS) / (INTRO_MS - 3 * INTRO_STEP_MS), 0, 1)) : 1;
        const x = s * dims.r * p;
        const z = (c - 1) * dims.depth * p - (1 - p) * 220;
        const rot = -s * 34 * p;
        const scale = (0.72 + 0.28 * Math.max(c, 0)) * (0.82 + 0.18 * p);
        const fade = clamp((c + 0.2) / 0.55, 0, 1) * (0.5 + 0.5 * Math.max(c, 0));
        card.style.transform = `translate3d(${x.toFixed(1)}px, 0, ${z.toFixed(1)}px) rotateY(${rot.toFixed(2)}deg) scale(${scale.toFixed(3)})`;
        card.style.opacity = String((fade * p).toFixed(3));
        card.style.zIndex = String(Math.round((c + 1) * 100));
        if (c > best) {
          best = c;
          bestIdx = i;
        }
      }
      if (bestIdx !== front) {
        front = bestIdx;
        cards.current.forEach((card, i) => card?.toggleAttribute('data-front', i === front));
        dots.current.forEach((d, i) => d?.toggleAttribute('data-on', i === front));
      }
    };

    const frame = (t: number) => {
      const dt = Math.min(64, t - last);
      last = t;
      const moving = !reduce && !hover && !drag && t > holdUntil && !document.hidden;
      if (moving) angle = (angle + (step / SECONDS_PER_SLOT) * (dt / 1000)) % 360;
      render(t);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    // Maus darüber: anhalten (nur echte Maus – Touch löst sonst „hover“ beim Tippen aus)
    const fine = window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;
    const enter = () => {
      if (fine) hover = true;
    };
    const leave = () => {
      hover = false;
    };
    // Ziehen: dreht von Hand; danach kurz stehen lassen
    const down = (e: PointerEvent) => {
      drag = { x: e.clientX, angle, moved: false };
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      if (Math.abs(dx) > 6) drag.moved = true;
      if (drag.moved) angle = (((drag.angle - dx * (step / Math.max(120, dims.r))) % 360) + 360) % 360;
    };
    const up = () => {
      if (!drag) return;
      // auf die nächste Karte einrasten lassen, dann nach einer Pause weiterdrehen
      if (drag.moved) angle = Math.round(angle / step) * step;
      holdUntil = performance.now() + 2500;
      const moved = drag.moved;
      drag = null;
      if (moved) {
        // der Klick nach dem Ziehen öffnet nichts
        const stop = (ev: Event) => {
          ev.preventDefault();
          ev.stopPropagation();
        };
        el.addEventListener('click', stop, { capture: true, once: true });
        setTimeout(() => el.removeEventListener('click', stop, { capture: true }), 0);
      }
    };
    el.addEventListener('pointerenter', enter);
    el.addEventListener('pointerleave', leave);
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      el.removeEventListener('pointerenter', enter);
      el.removeEventListener('pointerleave', leave);
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [tools]);

  if (!tools.length) return null;
  return (
    <section className="tool-orbit" aria-hidden="true" data-testid="tool-orbit">
      <div className="orbit-stage" ref={stage}>
        {tools.map((t, i) => (
          <a
            key={t.id}
            ref={(e) => {
              cards.current[i] = e;
            }}
            href={t.href}
            className="orbit-card"
            style={{ '--tool': t.color } as CSSProperties}
            tabIndex={-1}
            draggable={false}
            data-testid="orbit-card"
            data-tool={t.id}
          >
            <ToolIcon name={t.id} weight="thin" size={190} className="orbit-mark" />
            <span className="orbit-icon">
              <ToolIcon name={t.id} size={30} />
            </span>
            <span className="orbit-text">
              <strong>{t.title}</strong>
              <span>{t.text}</span>
            </span>
            <span className="orbit-go">Öffnen →</span>
          </a>
        ))}
      </div>
      <div className="orbit-dots">
        {tools.map((t, i) => (
          <span
            key={t.id}
            ref={(e) => {
              dots.current[i] = e;
            }}
          />
        ))}
      </div>
    </section>
  );
}

/**
 * Kacheln drehen sich immer wieder einmal um sich selbst: zuerst gruppenweise (Pläne, Personal, Dokumentation,
 * Material), dann als Welle von links oben nach rechts unten, danach im Wechsel. Kacheln unter der Maus bzw. im
 * Fokus bleiben ruhig (Runde wird übersprungen). Bewegung reduzieren: keine Drehung.
 */
const GROUP_OF: Record<string, number> = { projects: 0, defects: 0, workers: 1, times: 1, photos: 2, reports: 2, materials: 3 };
const FIRST_SPIN_MS = 1500;
const SPIN_EVERY_MS = 6500;

export function useTileSpins(grid: RefObject<HTMLElement | null>, count: number) {
  useEffect(() => {
    const el = grid.current;
    if (!el || !count || reducedMotion()) return;
    let round = 0;
    let timer = 0;
    const spin = () => {
      const tiles = [...el.querySelectorAll<HTMLElement>('.tool-tile')];
      const busy = !!el.querySelector('.tool-tile:hover, .tool-tile:focus-visible') || document.hidden;
      if (!busy && tiles.length) {
        const wave = round % 2 === 1;
        // Lage im Raster: Zeile und Spalte aus der Position (passt sich jeder Bildschirmbreite an)
        const tops = [...new Set(tiles.map((t) => Math.round(t.offsetTop)))].sort((a, b) => a - b);
        const lefts = [...new Set(tiles.map((t) => Math.round(t.offsetLeft)))].sort((a, b) => a - b);
        for (const t of tiles) {
          const row = tops.indexOf(Math.round(t.offsetTop));
          const col = lefts.indexOf(Math.round(t.offsetLeft));
          const delay = wave ? (row + col) * 110 : (GROUP_OF[t.dataset.tool ?? ''] ?? 0) * 320;
          t.style.setProperty('--spin-delay', `${delay}ms`);
          t.classList.remove('spin');
        }
        void el.offsetWidth; // Animation neu starten
        for (const t of tiles) t.classList.add('spin');
        round++;
      }
      timer = window.setTimeout(spin, SPIN_EVERY_MS);
    };
    timer = window.setTimeout(spin, FIRST_SPIN_MS);
    return () => window.clearTimeout(timer);
  }, [grid, count]);
}
