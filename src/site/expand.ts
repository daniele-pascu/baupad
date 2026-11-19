import type { MouseEvent } from 'react';
import { navigate } from '../lib/router';

/**
 * Übergang „Fenster wird zur Seite“: Eine Fläche wächst von einem Fenster (BauPad auf der Startseite, Tool-Karte auf der
 * BauPad-Seite) über den ganzen Bildschirm, dann öffnet sich die Seite und die Fläche blendet aus.
 * Neuer Tab, Tastenkürzel und „weniger Bewegung“: normaler Link ohne Übergang.
 */
export function expandTo(e: MouseEvent<HTMLAnchorElement>, win: HTMLElement | null, opts: { radius: number; className?: string; color?: string; testId?: string }) {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  if (!win || !document.body.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  e.preventDefault();
  const href = e.currentTarget.getAttribute('href')!;
  const r = win.getBoundingClientRect();
  const from = `inset(${r.top}px ${innerWidth - r.right}px ${innerHeight - r.bottom}px ${r.left}px round ${opts.radius}px)`;
  const o = document.createElement('div');
  o.className = `ph-expand${opts.className ? ` ${opts.className}` : ''}`;
  o.setAttribute('aria-hidden', 'true');
  if (opts.testId) o.dataset.testid = opts.testId;
  if (opts.color) o.style.setProperty('--tool', opts.color);
  document.body.appendChild(o);
  // die Leiste steht während des Übergangs ruhig und voll sichtbar vorne (nicht blass)
  document.documentElement.classList.add('ph-expanding');
  const grow = o.animate(
    [
      { clipPath: from, opacity: 0 },
      { clipPath: from, opacity: 1, offset: 0.14 },
      { clipPath: 'inset(0px 0px 0px 0px round 0px)', opacity: 1 },
    ],
    { duration: 560, easing: 'cubic-bezier(.32,.72,0,1)', fill: 'forwards' },
  );
  grow.finished
    .then(() => {
      navigate(href);
      return new Promise((done) => setTimeout(done, 140));
    })
    .then(() => o.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 320, easing: 'ease-out', fill: 'forwards' }).finished)
    .finally(() => {
      o.remove();
      document.documentElement.classList.remove('ph-expanding');
    });
}
