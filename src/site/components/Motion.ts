import { useEffect } from 'react';
import { motionOk } from './Reveal';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Bewegung beim Scrollen (nur wenn das System Bewegung erlaubt):
 *  - data-progress="through|fill": setzt --p (0..1) – „through“ über den ganzen Weg durchs Bild,
 *    „fill“ bis das Element vollständig im Bild steht (z. B. Linie, die sich mit dem Scrollen zeichnet)
 *  - data-hero: setzt --hp (0..1), wie weit der Kopfbereich schon weggescrollt ist
 *  - data-count: Zahl zählt hoch (bzw. bei 0 herunter), sobald sie sichtbar wird
 *  - data-tilt: Karte neigt sich mit dem Mauszeiger (nur mit Maus)
 * Ohne Bewegung bleiben die Standardwerte aus dem CSS (alles fertig sichtbar).
 */
export function useScrollMotion(deps: unknown[] = []) {
  useEffect(() => {
    if (!motionOk()) return;
    const prog = Array.from(document.querySelectorAll<HTMLElement>('[data-progress]'));
    const hero = document.querySelector<HTMLElement>('[data-hero]');
    let raf = 0;
    const update = () => {
      raf = 0;
      const vh = window.innerHeight;
      for (const el of prog) {
        const r = el.getBoundingClientRect();
        const p = el.dataset.progress === 'fill' ? (vh * 0.85 - r.top) / (r.height + vh * 0.2) : (vh - r.top) / (vh + r.height);
        el.style.setProperty('--p', clamp01(p).toFixed(4));
      }
      if (hero) hero.style.setProperty('--hp', clamp01(window.scrollY / Math.max(1, hero.offsetHeight)).toFixed(4));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);

    // Zahlen zählen
    const counts = Array.from(document.querySelectorAll<HTMLElement>('[data-count]'));
    const timers: number[] = [];
    let io: IntersectionObserver | null = null;
    if (counts.length && 'IntersectionObserver' in window) {
      const run = (el: HTMLElement, i: number) => {
        const end = Number(el.dataset.count);
        const from = end === 0 ? 9 : 0;
        const t0 = performance.now() + i * 120;
        const dur = 1100;
        const step = (now: number) => {
          const k = clamp01((now - t0) / dur);
          const e = 1 - Math.pow(1 - k, 3);
          el.textContent = String(Math.round(from + (end - from) * e));
          if (k < 1) timers.push(requestAnimationFrame(step));
        };
        timers.push(requestAnimationFrame(step));
      };
      counts.forEach((el) => (el.textContent = Number(el.dataset.count) === 0 ? '9' : '0'));
      io = new IntersectionObserver(
        (entries) => {
          for (const en of entries) {
            if (!en.isIntersecting) continue;
            io!.unobserve(en.target);
            run(en.target as HTMLElement, counts.indexOf(en.target as HTMLElement));
          }
        },
        { threshold: 0.6 },
      );
      counts.forEach((el) => io!.observe(el));
    }

    // Karten neigen (nur mit Maus)
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const tilts = fine ? Array.from(document.querySelectorAll<HTMLElement>('[data-tilt]')) : [];
    const move = (ev: PointerEvent) => {
      const el = ev.currentTarget as HTMLElement;
      const r = el.getBoundingClientRect();
      const x = (ev.clientX - r.left) / r.width;
      const y = (ev.clientY - r.top) / r.height;
      el.style.setProperty('--ry', `${((x - 0.5) * 9).toFixed(2)}deg`);
      el.style.setProperty('--rx', `${((0.5 - y) * 7).toFixed(2)}deg`);
      el.style.setProperty('--gx', `${(x * 100).toFixed(1)}%`);
      el.style.setProperty('--gy', `${(y * 100).toFixed(1)}%`);
    };
    const leave = (ev: PointerEvent) => {
      const el = ev.currentTarget as HTMLElement;
      el.style.setProperty('--rx', '0deg');
      el.style.setProperty('--ry', '0deg');
    };
    tilts.forEach((el) => {
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerleave', leave);
    });

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
      timers.forEach((id) => cancelAnimationFrame(id));
      io?.disconnect();
      counts.forEach((el) => (el.textContent = el.dataset.count ?? ''));
      tilts.forEach((el) => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerleave', leave);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
