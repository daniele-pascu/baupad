/**
 * Website: Glaslinse unter den Links der Leiste (Home · Produkte · Über uns · Kontakt).
 * Sie liegt unter der aktuellen Seite, gleitet mit der Maus bzw. dem Fokus zum Link darunter (Feder, ohne Nachschwingen)
 * und zeigt die Schrift vergrößert und am Rand gebrochen – auch während sie gleitet. Am Handy (Menü) ist sie aus.
 */
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const filters = new Map<string, string>();

/** Verschiebungskarte einer Pillen-Linse: am Rand wird der Inhalt nach innen gezogen (Rot = x, Grün = y, 128 = keine) */
function lensMap(w: number, h: number): string {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  const img = ctx.createImageData(w, h);
  const r = h / 2;
  const bezel = Math.min(10, r * 0.7);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - w / 2;
      const py = y + 0.5 - h / 2;
      const qx = Math.abs(px) - (w / 2 - r);
      const qy = Math.abs(py) - (h / 2 - r);
      const sd = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
      let nx = 0;
      let ny = 0;
      if (qx > 0 && qy > 0) {
        const l = Math.hypot(qx, qy) || 1;
        nx = (qx / l) * Math.sign(px);
        ny = (qy / l) * Math.sign(py);
      } else if (qx > qy) nx = Math.sign(px);
      else ny = Math.sign(py);
      const t = Math.max(0, 1 - -sd / bezel);
      const m = -sd >= bezel ? 0 : Math.pow(t, 2.6);
      const i = (y * w + x) * 4;
      img.data[i] = 128 - nx * m * 127;
      img.data[i + 1] = 128 - ny * m * 127;
      img.data[i + 2] = 128;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL();
}

/** SVG-Filter je Linsengröße: Randbrechung mit leichtem Farbsaum (Rot, Grün, Blau verschieden stark) */
function glassFilter(w: number, h: number): string | null {
  w = Math.round(w);
  h = Math.round(h);
  const key = `${w}x${h}`;
  const known = filters.get(key);
  if (known) return known;
  const map = lensMap(w, h);
  if (!map) return null;
  let defs: Element | null = document.getElementById('ps-glass-defs');
  if (!defs) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.position = 'absolute';
    const d = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    d.id = 'ps-glass-defs';
    svg.appendChild(d);
    document.body.appendChild(svg);
    defs = d;
  }
  const id = `ps-glass-${key}`;
  const channel = (scale: number, keep: string, name: string) =>
    `<feDisplacementMap in="SourceGraphic" in2="map" scale="${scale}" xChannelSelector="R" yChannelSelector="G" result="d${name}"/>` +
    `<feColorMatrix in="d${name}" type="matrix" values="${keep} 0 0 0 1 0" result="${name}"/>`;
  defs.insertAdjacentHTML(
    'beforeend',
    `<filter id="${id}" x="0" y="0" width="${w}" height="${h}" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">` +
      `<feImage href="${map}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="map"/>` +
      channel(9, '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0 ', 'r') +
      channel(11, '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0 ', 'g') +
      channel(13, '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0 ', 'b') +
      `<feBlend in="r" in2="g" mode="screen" result="rg"/><feBlend in="rg" in2="b" mode="screen"/></filter>`,
  );
  filters.set(key, id);
  return id;
}

/** Linse an die Leiste hängen; liefert die Aufräum-Funktion */
export function attachNavLens(nav: HTMLElement, lens: HTMLElement): () => void {
  const clip = lens.querySelector<HTMLElement>('.ps-lens-clip')!;
  const copy = lens.querySelector<HTMLElement>('.ps-lens-copy')!;
  const items = () => [...nav.children].filter((el) => el !== lens) as HTMLElement[];
  const target = (el: HTMLElement) => (el.matches('a, button') ? el : el.querySelector<HTMLElement>('a, button')) ?? el;
  // Kopie der Links für die Linse: nicht bedienbar, nicht vorgelesen, ohne Test-Kennungen
  const fill = () => {
    copy.innerHTML = items().map((el) => el.outerHTML).join('');
    copy.querySelectorAll('.ps-products-panel').forEach((p) => p.remove());
    copy.querySelectorAll<HTMLElement>('[id], [data-testid], a, button').forEach((el) => {
      el.removeAttribute('id');
      el.removeAttribute('data-testid');
      el.removeAttribute('aria-controls');
      if (el.matches('a, button')) el.tabIndex = -1;
    });
  };
  fill();

  let hover: HTMLElement | null = null;
  let x = 0;
  let v = 0;
  let w = 0;
  let vw = 0;
  let lift = 1;
  let shown = false;
  let raf = 0;
  let last = 0;
  let size = { w: 0, h: 0 };

  const goal = () => {
    const el = hover ?? items().map(target).find((t) => t.getAttribute('aria-current') === 'page') ?? null;
    if (!el || el.offsetParent === null) return null;
    const nr = nav.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { x: r.left - nr.left + r.width / 2, y: r.top - nr.top + r.height / 2, w: r.width, h: r.height };
  };

  const render = (g: { y: number; h: number }) => {
    const lw = size.w;
    const lh = size.h;
    const left = x - lw / 2;
    const top = g.y - lh / 2;
    // beim Gleiten leicht gestreckt und angehoben; Breite folgt dem Ziel-Link
    const stretch = reduced() ? 0 : Math.min(Math.abs(v) / 2400, 0.18);
    lens.style.transform = `translate(${left}px, ${top}px) scale(${(w / lw) * (1 + stretch) * lift}, ${(1 - stretch * 0.4) * lift})`;
    const m = 1.1;
    copy.style.left = `${-left}px`;
    copy.style.top = `${-top}px`;
    copy.style.transformOrigin = `${x}px ${g.y}px`;
    copy.style.transform = `scale(${m})`;
  };

  const step = (t: number) => {
    const g = goal();
    if (!g) {
      shown = false;
      lens.classList.remove('on');
      raf = 0;
      return;
    }
    const lw = Math.round(g.w + 6);
    const lh = Math.round(g.h + 6);
    if (lw !== size.w || lh !== size.h) {
      size = { w: lw, h: lh };
      lens.style.width = `${lw}px`;
      lens.style.height = `${lh}px`;
      const id = glassFilter(lw, lh);
      clip.style.filter = id ? `url(#${id})` : '';
    }
    if (!shown || reduced()) {
      x = g.x;
      w = lw;
      v = 0;
      vw = 0;
      lift = 1;
      shown = true;
      lens.classList.add('on');
      render(g);
      raf = 0;
      return;
    }
    const dt = Math.min(0.032, (t - last) / 1000 || 1 / 60);
    last = t;
    // Feder: schnell und weich, ohne sichtbares Nachschwingen (ca. 280 ms)
    const k = 560;
    const c = 2 * Math.sqrt(k) * 0.9;
    v += (-k * (x - g.x) - c * v) * dt;
    x += v * dt;
    vw += (-k * (w - lw) - c * vw) * dt;
    w += vw * dt;
    lift += ((Math.abs(v) > 40 ? 1.08 : 1) - lift) * Math.min(1, dt * 16);
    render(g);
    if (Math.abs(x - g.x) < 0.3 && Math.abs(v) < 4 && Math.abs(w - lw) < 0.3 && Math.abs(lift - 1) < 0.002) {
      x = g.x;
      w = lw;
      v = 0;
      lift = 1;
      render(g);
      raf = 0;
      return;
    }
    raf = requestAnimationFrame(step);
  };
  const kick = () => {
    if (raf) return;
    last = performance.now();
    raf = requestAnimationFrame(step);
  };

  const over = (e: Event) => {
    const el = (e.target as Element | null)?.closest?.('a, button');
    if (!el || !nav.contains(el) || lens.contains(el) || el.closest('.ps-products-panel')) return;
    hover = el as HTMLElement;
    kick();
  };
  const leave = () => {
    hover = null;
    kick();
  };
  const focusOut = (e: FocusEvent) => {
    if (!nav.contains(e.relatedTarget as Node | null)) leave();
  };
  const resize = () => {
    size = { w: 0, h: 0 };
    shown = false;
    kick();
  };
  nav.addEventListener('pointerover', over);
  nav.addEventListener('focusin', over);
  nav.addEventListener('pointerleave', leave);
  nav.addEventListener('focusout', focusOut);
  addEventListener('resize', resize);
  // Schrift geladen bzw. Inhalt geändert (Sprache, Produkte-Fenster): Kopie und Maße neu
  const mo = new MutationObserver((list) => {
    if (list.every((m) => lens.contains(m.target))) return;
    fill();
    size = { w: 0, h: 0 };
    kick();
  });
  mo.observe(nav, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-current'] });
  void document.fonts?.ready.then(resize);
  kick();
  return () => {
    cancelAnimationFrame(raf);
    mo.disconnect();
    nav.removeEventListener('pointerover', over);
    nav.removeEventListener('focusin', over);
    nav.removeEventListener('pointerleave', leave);
    nav.removeEventListener('focusout', focusOut);
    removeEventListener('resize', resize);
  };
}
