import { useEffect, useRef } from 'react';
import { useLang } from '../i18n';
import { TOOL_ENTRIES } from '../products';

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
  helmet: '<path d="M4 16a8 8 0 0116 0"/><path d="M2.500 16h19v2.500h-19zM10 8.300V5h4v3.300"/>',
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
  workers: ['users', 'cal', 'usercheck', 'sun', 'list', 'helmet'],
  reports: ['filetext', 'clip', 'pen', 'printer', 'check', 'folder'],
  photos: ['camera', 'image', 'grid', 'pin', 'cloud', 'week'],
  defects: ['alert', 'flag', 'shape', 'pin', 'camera', 'check'],
  times: ['clock', 'timer', 'coffee', 'route', 'sheet', 'cal'],
  materials: ['cart', 'box', 'truck', 'mail', 'listcheck', 'drill'],
};
const svg = (k: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;

// Zeitplan in Sekunden: Vorlauf, Dauer je Werkzeug, Schlussbild
const T0 = 0.5;
const STEP = 2.2;
const FIN = T0 + 7 * STEP;
const END = FIN + 1.4;
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const ease = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
/** fester Zufall – die Wand sieht bei jedem Besuch gleich aus */
const seeded = (s: number) => () => {
  s = (s * 1664525 + 1013904223) % 4294967296;
  return s / 4294967296;
};

/**
 * Kachelwand der sieben Werkzeuge: Alle Kacheln liegen mit der Rückseite (Logo) nach oben. Kommt die Wand ins Bild,
 * erscheint Werkzeug für Werkzeug sein Name, und seine Kacheln drehen sich von der Mitte nach außen um (kurz in der
 * Akzentfarbe). Am Ende steht die volle Wand; „Nochmal ansehen“ startet den Ablauf neu. Der ganze Zustand hängt nur
 * von der Zeit ab (render(t)). Ohne Bewegung (System-Einstellung) steht sofort das Schlussbild.
 */
export function ToolWall() {
  const { t } = useLang();
  const w = t.home.product.wall;
  const wall = useRef<HTMLDivElement>(null);
  const plane = useRef<HTMLDivElement>(null);
  const again = useRef<HTMLButtonElement>(null);
  const restart = useRef<() => void>(() => undefined);

  useEffect(() => {
    const el = wall.current;
    const pl = plane.current;
    if (!el || !pl) return;
    const slides = Array.from(el.querySelectorAll<HTMLElement>('.tw-slide'));
    const ticks = Array.from(el.querySelectorAll<HTMLElement>('.tw-ticks b'));
    let tiles: { el: HTMLElement; k: number; d: number }[] = [];
    const build = () => {
      pl.textContent = '';
      tiles = [];
      const W = el.clientWidth;
      const H = el.clientHeight;
      const s = Math.max(64, Math.min(128, W / 11));
      const stp = s * 1.2;
      const cols = Math.ceil((W * 1.5) / stp) | 1;
      const rows = Math.ceil((H * 2.3) / stp) | 1;
      const r = seeded(7);
      const n = cols * rows;
      const order: number[] = [];
      for (let i = 0; i < n; i++) order.push(i % 7);
      for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < cols; x++) {
          const k = order[y * cols + x];
          const tool = TOOL_ENTRIES[k];
          const px = (x - (cols - 1) / 2) * stp;
          const py = (y - (rows - 1) / 2) * stp;
          const d = document.createElement('div');
          d.className = 'tw-tile';
          d.style.cssText = `--s:${s}px;--c:${tool.color};left:${px}px;top:${py}px`;
          d.innerHTML = `<div class="tw-front">${svg(SETS[tool.id][Math.floor(r() * 6)])}</div><div class="tw-back"><img src="/icons/pad-mark.png" alt=""></div>`;
          pl.appendChild(d);
          tiles.push({ el: d, k, d: Math.hypot(px, py) / Math.hypot(W, H) });
        }
    };
    const render = (time: number) => {
      for (const q of tiles) {
        const on = T0 + q.k * STEP + 0.2 + q.d * 1.2;
        const a = ease(clamp((time - on) / 0.8));
        const hi = clamp((time - on) / 0.3) * (1 - clamp((time - (T0 + (q.k + 1) * STEP - 0.1)) / 0.6));
        q.el.style.transform = `translateZ(${(Math.sin(Math.PI * clamp((time - on) / 0.8)) * 56).toFixed(1)}px) rotateY(${(180 - 180 * a).toFixed(2)}deg)`;
        q.el.style.setProperty('--hi', hi.toFixed(3));
      }
      slides.forEach((sl, k) => {
        const from = k < 7 ? T0 + k * STEP : FIN;
        const to = k < 7 ? from + STEP : Infinity;
        const p = clamp((time - from) / 0.45) * (1 - clamp((time - (to - 0.3)) / 0.3));
        sl.style.opacity = p.toFixed(3);
        sl.style.transform = `translateY(calc(-50% + ${((1 - clamp((time - from) / 0.45)) * 22).toFixed(1)}px))`;
      });
      ticks.forEach((b, k) => (b.style.width = `${(clamp((time - (T0 + k * STEP)) / STEP) * 100).toFixed(1)}%`));
      again.current?.classList.toggle('on', time >= END);
      el.dataset.state = time >= END ? 'done' : time > 0 ? 'running' : 'idle';
    };
    build();
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window);
    if (still) {
      render(END);
      restart.current = () => render(END);
      return;
    }
    let t0 = 0;
    let raf = 0;
    const tick = (now: number) => {
      const time = (now - t0) / 1000;
      render(time);
      if (time < END + 0.2) raf = requestAnimationFrame(tick);
    };
    const start = () => {
      cancelAnimationFrame(raf);
      t0 = performance.now();
      raf = requestAnimationFrame(tick);
    };
    restart.current = start;
    render(0);
    const io = new IntersectionObserver(
      (es) => {
        if (es[0].isIntersecting) {
          start();
          io.disconnect();
        }
      },
      { threshold: 0.45 },
    );
    io.observe(el);
    let rt = 0;
    const onResize = () => {
      window.clearTimeout(rt);
      rt = window.setTimeout(() => {
        cancelAnimationFrame(raf);
        build();
        render(END);
      }, 200);
    };
    window.addEventListener('resize', onResize);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
      window.clearTimeout(rt);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return (
    <div className="tw" ref={wall} role="group" aria-label={w.aria} data-testid="tool-wall">
      <div className="tw-scene" aria-hidden="true">
        <div className="tw-plane" ref={plane} />
      </div>
      <div className="tw-veil" aria-hidden="true" />
      <div className="tw-text">
        {TOOL_ENTRIES.map((x, k) => (
          <div key={x.id} className="tw-slide" data-testid="tool-wall-slide">
            <span className="ph-mono">
              {w.tool} {String(k + 1).padStart(2, '0')} / 07
            </span>
            <h3>{t.tools[x.id].title}.</h3>
            <p>{t.baupad.tools.items[x.id].hook}</p>
          </div>
        ))}
        <div className="tw-slide" data-testid="tool-wall-final">
          <span className="ph-mono">{w.brand}</span>
          <h3>
            {w.final[0]}
            <em>{w.final[1]}</em>
          </h3>
          <p>{w.finalText}</p>
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
  );
}
