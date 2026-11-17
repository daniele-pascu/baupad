import { useEffect, useRef, type CSSProperties } from 'react';
import { ToolIcon } from '../../components/ToolIcon';
import { useLang } from '../i18n';
import { TOOL_ENTRIES, toolPath } from '../products';

/** Strichsymbole der Kacheln (24er Raster) – Platzhalter, bis die endgültigen Symbole feststehen */
const ICON: Record<string, string> = {
  alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/>',
  area: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M10 4v16"/>',
  box: '<path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  cal: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M8 3v4M16 3v4"/>',
  calc: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.500"/>',
  cart: '<path d="M3 4h2.500l2 10h10l2-7H6.500"/><circle cx="9.500" cy="19" r="1.500"/><circle cx="16.500" cy="19" r="1.500"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.500l3 3 5-6"/>',
  clip: '<rect x="6" y="5" width="12" height="16" rx="2"/><path d="M9 5a3 3 0 016 0M9 11h6M9 15h4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.500 2"/>',
  cloud: '<path d="M7 18a4 4 0 010-8 5.500 5.500 0 0110.500 1.500A3.300 3.300 0 0117 18z"/>',
  coffee: '<path d="M5 9h11v5a5 5 0 01-5 5h-1a5 5 0 01-5-5z"/><path d="M16 10h2a2.500 2.500 0 010 5h-2M8 3v2M12 3v2"/>',
  drill: '<path d="M3 8h10v5H3zM13 9.500h5l3 1-3 1h-5"/><path d="M6 13v6h4v-3"/>',
  filetext: '<path d="M7 3h7l4 4v14H7z"/><path d="M10 12h5M10 16h5M10 8h2"/>',
  flag: '<path d="M5 21V4M5 5h12l-2 4 2 4H5"/>',
  folder: '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.500"/><rect x="13" y="4" width="7" height="7" rx="1.500"/><rect x="4" y="13" width="7" height="7" rx="1.500"/><rect x="13" y="13" width="7" height="7" rx="1.500"/>',
  badge: '<rect x="4" y="6" width="16" height="14" rx="2"/><circle cx="9" cy="11.500" r="1.800"/><path d="M6.300 16.500c.6-1.700 4.800-1.700 5.400 0M14.500 11h3M14.500 14.500h3M10 6V4h4v2"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.800"/><path d="M4 18l5-5 4 4 3-3 4 4"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
  listcheck: '<path d="M11 6h9M11 12h9M11 18h9"/><path d="M3 6l1.500 1.500L7 5M3 12l1.500 1.500L7 11M3 18l1.500 1.500L7 17"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M4 7l8 6 8-6"/>',
  pdf: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 13h6M9 17h6"/>',
  pen: '<path d="M4 20l1-4L16 5l3 3L8 19z"/><path d="M14 7l3 3"/>',
  pin: '<path d="M12 21s-6-5.600-6-10a6 6 0 0112 0c0 4.400-6 10-6 10z"/><circle cx="12" cy="11" r="2"/>',
  plan: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>',
  printer: '<path d="M7 8V4h10v4"/><rect x="4" y="8" width="16" height="8" rx="2"/><path d="M7 14h10v6H7z"/>',
  route: '<circle cx="6" cy="18" r="2.200"/><circle cx="18" cy="6" r="2.200"/><path d="M8 18h6a3 3 0 000-6h-4a3 3 0 010-6h6"/>',
  ruler: '<path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>',
  shape: '<path d="M5 15l4-9 7 2 3 8-8 3z"/>',
  sheet: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 15h6M9 18h6M12 12v6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.600 5.600l1.400 1.400M17 17l1.400 1.400M5.600 18.400L7 17M17 7l1.400-1.400"/>',
  table: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M3 14.5h18M9 5v14"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4M9 2h6M12 2v3"/>',
  truck: '<path d="M2 6h12v10H2zM14 9h4l3 3v4h-7"/><circle cx="6.500" cy="17.500" r="2"/><circle cx="17" cy="17.500" r="2"/>',
  usercheck: '<circle cx="10" cy="8" r="3.5"/><path d="M3 20c0-3.6 3.1-6.5 7-6.5 1.4 0 2.700.4 3.800 1"/><path d="M15 18l2 2 4-4"/>',
  users: '<circle cx="9" cy="9" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="8" r="2.4"/><path d="M16 14c2.8 0 5 2.2 5 5"/>',
  week: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M8 14h2M12 14h2M16 14h.01M8 17h2"/>',
};
/** je Werkzeug sechs Symbole */
const SETS: Record<string, string[]> = {
  projects: ['plan', 'ruler', 'area', 'calc', 'pdf', 'table'],
  workers: ['users', 'cal', 'usercheck', 'sun', 'list', 'badge'],
  reports: ['filetext', 'clip', 'pen', 'printer', 'check', 'folder'],
  photos: ['camera', 'image', 'grid', 'pin', 'cloud', 'week'],
  defects: ['alert', 'flag', 'shape', 'pin', 'camera', 'check'],
  times: ['clock', 'timer', 'coffee', 'route', 'sheet', 'cal'],
  materials: ['cart', 'box', 'truck', 'mail', 'listcheck', 'drill'],
};
const svg = (k: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;

/** Farbe des Symbols auf dunklem Grund (dunkle Werkzeugfarben aufgehellt, Fotodokumentation hellgrau) */
export const LIT: Record<string, string> = { projects: '#ff7a2b', workers: '#4d95f5', reports: '#b47bff', photos: '#d0d0d6', defects: '#ff5b62', times: '#2fd6a7', materials: '#f2b632' };

// Zeitplan in Sekunden
// Kacheln: Wellen von links oben nach rechts unten – jede Welle dreht die Kacheln einmal halb um
// (erste Welle: Rückseite → Vorderseite, nächste: Vorderseite → Rückseite, und so weiter)
const WAVE_START = 0.5;
const WAVE_SPAN = 2.6;
const WAVE_EVERY = 6.5;
const FLIP = 0.85;
// Werkzeuge: eine Karte nach der anderen – sie steht kurz vorne, wandert nach links, die nächste kommt
const PRES_START = 0.6;
const HOLD = 1.25;
const MOVE = 0.7;
const SLOT = HOLD + MOVE;
const N_TOOLS = TOOL_ENTRIES.length;
/** Kreis einmal geschlossen (wieder die erste Karte vorne) – danach „Eine App.“ und „Nochmal ansehen“ */
const END = PRES_START + N_TOOLS * SLOT;
const CARD_IN = 0.55;
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const ease = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
/** fester Zufall – die Wand sieht bei jedem Besuch gleich aus */
const seeded = (s: number) => () => {
  s = (s * 1664525 + 1013904223) % 4294967296;
  return s / 4294967296;
};

/**
 * Kachelwand der sieben Werkzeuge: verschieden große Kacheln, jedes Symbol in der Farbe seines Werkzeugs; alle liegen
 * zuerst mit der Rückseite (Logo) nach oben. Kommt die Wand ins Bild:
 *  - Kacheln: Wellen von links oben nach rechts unten, jede Welle dreht sie einmal halb (auf die Vorderseite, dann
 *    wieder auf die Rückseite …)
 *  - Mitte: „7 Tools“ und die Karten der Werkzeuge – eine steht vorne, wandert nach links, die nächste kommt, bis der
 *    Kreis geschlossen ist; dann „Eine App.“; der Kreis läuft im selben Takt weiter
 * Der Zustand hängt nur von der Zeit ab (render(t)); gerechnet wird nur, solange die Wand zu sehen ist.
 * „Nochmal ansehen“ startet von vorn. Ohne Bewegung (System-Einstellung) steht sofort das Schlussbild.
 */
export function ToolWall() {
  const { t, lang } = useLang();
  const w = t.home.product.wall;
  const slot = useRef<HTMLDivElement>(null);
  const wall = useRef<HTMLDivElement>(null);
  const plane = useRef<HTMLDivElement>(null);
  const again = useRef<HTMLButtonElement>(null);
  const orbit = useRef<HTMLDivElement>(null);
  const restart = useRef<() => void>(() => undefined);

  useEffect(() => {
    const el = wall.current;
    const sl = slot.current;
    const pl = plane.current;
    if (!el || !pl) return;
    const head = el.querySelector<HTMLElement>('.tw-head');
    const one = el.querySelector<HTMLElement>('.tw-one');
    const ticks = Array.from(el.querySelectorAll<HTMLElement>('.tw-ticks b'));
    const cards = Array.from(orbit.current?.querySelectorAll<HTMLElement>('.tw-card') ?? []);
    let tiles: { el: HTMLElement; w: number; st: string }[] = [];
    let front = -1;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const build = () => {
      pl.textContent = '';
      tiles = [];
      const W = el.clientWidth;
      const H = el.clientHeight;
      const s = Math.max(56, Math.min(104, W / 13));
      const gap = s * 0.2;
      const stp = s + gap;
      const cols = Math.ceil((W * 1.5) / stp) | 1;
      const rows = Math.ceil((H * 2.3) / stp) | 1;
      const r = seeded(7);
      // Raster belegen: zuerst einige große Kacheln (3×3 und 2×2), der Rest bleibt einfach
      const used = new Uint8Array(cols * rows);
      const spots: { x: number; y: number; n: number }[] = [];
      const place = (n: number, share: number) => {
        const want = Math.round((cols * rows * share) / (n * n));
        for (let tries = 0, done = 0; done < want && tries < want * 30; tries++) {
          const x = Math.floor(r() * (cols - n + 1));
          const y = Math.floor(r() * (rows - n + 1));
          let free = true;
          for (let dy = 0; dy < n && free; dy++) for (let dx = 0; dx < n; dx++) if (used[(y + dy) * cols + x + dx]) free = false;
          if (!free) continue;
          for (let dy = 0; dy < n; dy++) for (let dx = 0; dx < n; dx++) used[(y + dy) * cols + x + dx] = 1;
          spots.push({ x, y, n });
          done++;
        }
      };
      place(3, 0.14);
      place(2, 0.3);
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (!used[y * cols + x]) spots.push({ x, y, n: 1 });
      // jedes Werkzeug bekommt gleich viele Kacheln, gut gemischt
      const order = spots.map((_, i) => i % 7);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      // Lage für die Welle: 0 = links oben … 1 = rechts unten
      const xs = spots.map((sp) => sp.x + sp.n / 2);
      const ys = spots.map((sp) => sp.y + sp.n / 2);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      spots.forEach((sp, i) => {
        const tool = TOOL_ENTRIES[order[i]];
        const size = sp.n * s + (sp.n - 1) * gap;
        const px = (sp.x + sp.n / 2 - cols / 2) * stp;
        const py = (sp.y + sp.n / 2 - rows / 2) * stp;
        const d = document.createElement('div');
        d.className = 'tw-tile';
        d.style.cssText = `--s:${size.toFixed(1)}px;--c:${tool.color};--ci:${LIT[tool.id] ?? tool.color};left:${px.toFixed(1)}px;top:${py.toFixed(1)}px`;
        d.innerHTML = `<div class="tw-front">${svg(SETS[tool.id][Math.floor(r() * 6)])}</div><div class="tw-back"><img src="/icons/pad-mark.png" alt=""></div>`;
        pl.appendChild(d);
        tiles.push({ el: d, w: ((xs[i] - x0) / Math.max(1, x1 - x0) + (ys[i] - y0) / Math.max(1, y1 - y0)) / 2, st: '' });
      });
    };

    const setTile = (q: (typeof tiles)[number], z: number, rot: number, hi: number) => {
      const st = `${z.toFixed(1)}|${rot.toFixed(2)}|${hi.toFixed(3)}`;
      if (st === q.st) return; // unverändert – nichts schreiben (viele Kacheln, jede Bildschirmaktualisierung)
      q.st = st;
      q.el.style.transform = `translateZ(${z.toFixed(1)}px) rotateY(${rot.toFixed(2)}deg)`;
      q.el.style.setProperty('--hi', hi.toFixed(3));
    };

    /** Karten: Platz im Kreis (Grad) – steht HOLD Sekunden, dreht dann in MOVE Sekunden eine Karte weiter */
    const angleAt = (time: number) => {
      const s = Math.max(0, time - PRES_START);
      const k = Math.floor(s / SLOT);
      const local = s - k * SLOT;
      return ((k + (local < HOLD ? 0 : ease((local - HOLD) / MOVE))) * 360) / N_TOOLS;
    };
    const renderCards = (time: number, angle: number) => {
      const ow = orbit.current?.clientWidth ?? 0;
      if (!cards.length || !ow) return;
      const stepDeg = 360 / cards.length;
      const r = Math.max(110, Math.min(ow * 0.3, 380));
      const depth = Math.max(100, Math.min(ow * 0.26, 320));
      // Einblenden: zuerst die erste Karte vorne, die übrigen kommen erst beim Weiterdrehen ins Bild
      const shown = clamp((time - PRES_START) / CARD_IN);
      let best = -2;
      let bestIdx = 0;
      cards.forEach((card, i) => {
        let theta = (i * stepDeg - angle) % 360;
        if (theta > 180) theta -= 360;
        if (theta < -180) theta += 360;
        const rad = (theta * Math.PI) / 180;
        const sn = Math.sin(rad);
        const c = Math.cos(rad);
        // die vordere Karte groß und klar, die Nachbarn nur angedeutet
        const vis = Math.pow(clamp((c - 0.3) / 0.7), 2);
        const scale = (0.72 + 0.28 * Math.max(c, 0)) * (0.9 + 0.1 * ease(shown));
        card.style.transform = `translate3d(${(sn * r).toFixed(1)}px, 0, ${((c - 1) * depth).toFixed(1)}px) rotateY(${(-sn * 34).toFixed(2)}deg) scale(${scale.toFixed(3)})`;
        card.style.opacity = (vis * ease(shown)).toFixed(3);
        card.style.zIndex = String(Math.round((c + 1) * 100));
        if (c > best) {
          best = c;
          bestIdx = i;
        }
      });
      if (bestIdx !== front) {
        front = bestIdx;
        cards.forEach((card, i) => card.toggleAttribute('data-front', i === front));
      }
    };

    const render = (time: number) => {
      if (still) {
        // Schlussbild: Vorderseiten, erste Karte vorne
        for (const q of tiles) setTile(q, 0, 0, 0);
      } else {
        for (const q of tiles) {
          const lt = time - WAVE_START - q.w * WAVE_SPAN;
          let flips = 0;
          let lift = 0;
          if (lt > 0) {
            const i = Math.floor(lt / WAVE_EVERY);
            const p = clamp((lt - i * WAVE_EVERY) / FLIP);
            flips = i + ease(p);
            lift = Math.sin(Math.PI * p);
          }
          // 180° = Rückseite (Logo), 360° = Vorderseite; jede Welle eine halbe Drehung weiter
          setTile(q, lift * 48, (180 + 180 * flips) % 720, lift * 0.55);
        }
      }
      if (head) head.style.opacity = (still ? 1 : clamp(time / 0.35)).toFixed(3);
      renderCards(still ? END : time, still ? 0 : angleAt(time));
      const fin = still ? 1 : clamp((time - END) / 0.4);
      if (one) {
        one.style.opacity = fin.toFixed(3);
        one.style.transform = `translateY(${((1 - fin) * 12).toFixed(1)}px)`;
      }
      ticks.forEach((b, k) => (b.style.width = `${((still ? 1 : clamp((time - (PRES_START + k * SLOT)) / SLOT)) * 100).toFixed(1)}%`));
      again.current?.classList.toggle('on', still || time >= END);
      el.dataset.state = still || time >= END ? 'done' : time > 0 ? 'running' : 'idle';
    };
    build();
    let t0 = 0;
    let raf = 0;
    let started = still;
    let near = false;
    const tick = (now: number) => {
      render((now - t0) / 1000);
      // nur rechnen, solange die Wand zu sehen ist
      raf = near ? requestAnimationFrame(tick) : 0;
    };
    const start = () => {
      cancelAnimationFrame(raf);
      t0 = performance.now();
      raf = requestAnimationFrame(tick);
    };
    const resume = () => {
      if (still || !started || raf) return;
      raf = requestAnimationFrame(tick);
    };
    restart.current = still ? () => render(END) : start;
    render(still ? END : 0);
    /**
     * Die Wand steht fest hinter der Seite; ihr Platz im Seitenfluss ist ein durchsichtiges Fenster. Beim Scrollen
     * schiebt sich der Bereich darüber weg und gibt die Wand frei, später schiebt sich der Bereich darunter darüber.
     * - „near“: das Fenster ist im Bild → Wand sichtbar (sonst ausgeblendet, damit sie nichts kostet und nichts verdeckt)
     * - „full“: die Wand ist ganz frei → „Nochmal ansehen“ und die vordere Karte sind bedienbar
     * - Start, sobald gut die Hälfte der Wand frei ist
     */
    let sf = 0;
    const update = () => {
      sf = 0;
      if (!sl) return;
      const r = sl.getBoundingClientRect();
      const wr = el.getBoundingClientRect();
      near = r.bottom > wr.top && r.top < wr.bottom;
      el.classList.toggle('near', near);
      el.classList.toggle('full', r.top <= wr.top + 1 && r.bottom >= wr.bottom - 1);
      if (near) resume();
      if (!started && near && (Math.min(r.bottom, wr.bottom) - Math.max(r.top, wr.top)) / wr.height >= 0.55) {
        started = true;
        start();
      }
    };
    const onScroll = () => {
      if (!sf) sf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    let rt = 0;
    let lastW = el.clientWidth;
    const onResize = () => {
      onScroll();
      // nur bei geänderter Breite neu aufbauen (am Handy ändert die ein-/ausfahrende Adressleiste nur die Höhe)
      if (el.clientWidth === lastW) return;
      window.clearTimeout(rt);
      rt = window.setTimeout(() => {
        lastW = el.clientWidth;
        build();
        if (!started || still) render(still ? END : 0);
        else resume();
      }, 200);
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(sf);
      window.clearTimeout(rt);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return (
    <div className="tw-slot" ref={slot} data-testid="tool-wall-slot">
      <div className="tw" ref={wall} role="group" aria-label={w.aria} data-testid="tool-wall">
        <div className="tw-scene" aria-hidden="true">
          <div className="tw-plane" ref={plane} />
        </div>
        <div className="tw-veil" aria-hidden="true" />
        {/* immer mittig: oben „7 Tools“, darunter die Karten der Werkzeuge, am Ende „Eine App.“ */}
        <div className="tw-text">
          <div className="tw-stack">
            <p className="tw-head">{w.head}</p>
            {/* Karten der sieben Werkzeuge: eine nach der anderen nach vorn; die vordere führt zur Werkzeug-Seite */}
            <div className="tw-orbit" ref={orbit} aria-hidden="true" data-testid="tool-wall-orbit">
              {TOOL_ENTRIES.map((x) => (
                <a
                  key={x.id}
                  href={toolPath(x.id, lang)}
                  className="tw-card"
                  style={{ '--c': x.color, '--ci': LIT[x.id] } as CSSProperties}
                  tabIndex={-1}
                  draggable={false}
                  data-testid="tool-wall-card"
                  data-tool={x.id}
                >
                  <ToolIcon name={x.icon} weight="thin" size={170} className="tw-card-mark" />
                  <b className="tw-card-ico">
                    <ToolIcon name={x.icon} size={28} />
                  </b>
                  <strong>{t.tools[x.id].title}</strong>
                </a>
              ))}
            </div>
            <h3 className="tw-one" data-testid="tool-wall-final">
              {w.one}
            </h3>
            {/* für Bildschirmleser: die sieben Werkzeuge als Liste */}
            <ul className="tw-all sr-only" data-testid="tool-wall-all">
              {TOOL_ENTRIES.map((x) => (
                <li key={x.id}>{t.tools[x.id].title}</li>
              ))}
            </ul>
          </div>
        </div>
        <div className="tw-ticks" aria-hidden="true">
          {TOOL_ENTRIES.map((x) => (
            <i key={x.id}>
              <b />
            </i>
          ))}
        </div>
        <button type="button" className="ph-mono tw-again" ref={again} onClick={() => restart.current()} data-testid="tool-wall-again">
          {w.again}
        </button>
      </div>
    </div>
  );
}

/** Größe der Kacheln im stehenden Hintergrund: fest gemischt (1 = einfach, 2 = doppelt, 3 = dreifach) */
const TILE_SIZES = (() => {
  const r = seeded(11);
  return Array.from({ length: 170 }, () => {
    const v = r();
    return { n: v < 0.07 ? 3 : v < 0.27 ? 2 : 1, tool: Math.floor(r() * 7), icon: Math.floor(r() * 6) };
  });
})();

/**
 * Stehender Kachel-Hintergrund (nicht animiert): verschieden große Kacheln, jedes Symbol in der Farbe seines Werkzeugs.
 * Füllt den ganzen Bereich hinter dem Inhalt; rein dekorativ.
 */
export function ToolTiles() {
  return (
    <div className="tt" aria-hidden="true" data-testid="tool-tiles">
      <div className="tt-grid">
        {TILE_SIZES.map((x, i) => {
          const tool = TOOL_ENTRIES[x.tool];
          return <span key={i} className={`tt-tile tt-n${x.n}`} style={{ color: LIT[tool.id] }} dangerouslySetInnerHTML={{ __html: svg(SETS[tool.id][x.icon]) }} />;
        })}
      </div>
    </div>
  );
}
