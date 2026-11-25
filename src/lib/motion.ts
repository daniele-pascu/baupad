import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** Kurven und Zeiten der Tasten-Animationen (wie in styles.css) */
const EASE_MOVE = 'cubic-bezier(0.77, 0, 0.175, 1)';
const EASE_OUT = 'cubic-bezier(0.32, 0.72, 0, 1)';
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Fehler beim Speichern: das Feld wackelt einmal (360 ms) */
export function shake(el: Element | null | undefined) {
  if (!el || reduced() || !('animate' in el)) return;
  el.animate({ transform: ['translateX(0)', 'translateX(-10px)', 'translateX(10px)', 'translateX(-6px)', 'translateX(6px)', 'translateX(-3px)', 'translateX(0)'] }, { duration: 360, easing: EASE_OUT });
}

/**
 * Umschalter (`.segmented`): die Markierung gleitet von der alten zur neuen Taste (250 ms). Ein Mitläufer mit dem
 * Aussehen der gewählten Taste wandert hinter den Tasten; danach übernimmt wieder die Taste selbst.
 */
export function installSegmentGlide() {
  const SEL = ':scope > button[aria-selected="true"], :scope > button[aria-checked="true"]';
  document.addEventListener(
    'click',
    (e) => {
      if (reduced()) return;
      const btn = (e.target as Element | null)?.closest?.('.segmented > button');
      const seg = btn?.parentElement;
      const prev = seg?.querySelector<HTMLElement>(SEL);
      if (!seg || !prev || prev === btn) return;
      const from = prev.getBoundingClientRect();
      // nach dem Umschalten (React rendert Klicks sofort)
      requestAnimationFrame(() => {
        const now = seg.querySelector<HTMLElement>(SEL);
        if (!now || now === prev) return;
        const to = now.getBoundingClientRect();
        const box = seg.getBoundingClientRect();
        const cs = getComputedStyle(now);
        const ghost = document.createElement('span');
        ghost.className = 'seg-ghost';
        Object.assign(ghost.style, {
          left: `${to.left - box.left - seg.clientLeft}px`,
          top: `${to.top - box.top - seg.clientTop}px`,
          width: `${to.width}px`,
          height: `${to.height}px`,
          background: cs.backgroundColor,
          boxShadow: cs.boxShadow,
          borderRadius: cs.borderRadius,
        });
        seg.classList.add('seg-gliding');
        seg.appendChild(ghost);
        const done = () => {
          ghost.remove();
          if (!seg.querySelector('.seg-ghost')) seg.classList.remove('seg-gliding');
        };
        ghost
          .animate(
            [
              { transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)`, width: `${from.width}px` },
              { transform: 'none', width: `${to.width}px` },
            ],
            { duration: 250, easing: EASE_MOVE },
          )
          .finished.then(done, done);
      });
    },
    true,
  );
}

/**
 * Liste: kommt eine Zeile weg (oder dazu), rutschen die anderen weich an ihren neuen Platz (250 ms).
 * Zeilen tragen `data-flip="<id>"`; `key` ändert sich, wenn sich die Liste ändert.
 */
export function useListGlide(ref: RefObject<HTMLElement | null>, key: string) {
  const last = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const now = new Map<string, number>();
    const rows = [...el.querySelectorAll<HTMLElement>('[data-flip]')];
    const top0 = el.getBoundingClientRect().top - el.scrollTop;
    for (const row of rows) now.set(row.dataset.flip!, row.getBoundingClientRect().top - top0);
    if (!reduced()) {
      for (const row of rows) {
        const before = last.current.get(row.dataset.flip!);
        const top = now.get(row.dataset.flip!)!;
        if (before !== undefined && before !== top) row.animate({ transform: [`translateY(${before - top}px)`, 'none'] }, { duration: 250, easing: EASE_MOVE });
      }
    }
    last.current = now;
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** true, sobald sich `value` einmal geändert hat – damit eine Wechsel-Animation nicht schon beim Öffnen läuft */
export function useChanged<T>(value: T): boolean {
  const [prev, setPrev] = useState(value);
  const [changed, setChanged] = useState(false);
  if (prev !== value) {
    setPrev(value);
    setChanged(true);
  }
  return changed;
}

/** Zähler springt einmal kurz an, wenn er größer wird (300 ms) */
export function useBump(count: number): string | undefined {
  const [prev, setPrev] = useState(count);
  const [n, setN] = useState(0);
  if (prev !== count) {
    setPrev(count);
    if (count > prev) setN(n + 1);
  }
  return n ? `bump-${n % 2}` : undefined;
}
