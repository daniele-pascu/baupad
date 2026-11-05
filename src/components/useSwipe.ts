import { useEffect, type RefObject } from 'react';

/**
 * Waagrechtes Wischen mit dem Finger (z. B. Woche vor/zurück). Löst nur bei einer deutlich waagrechten, zügigen
 * Bewegung aus; nicht in Eingabefeldern, Fenstern oder waagrecht scrollbaren Bereichen – senkrechtes Scrollen bleibt normal.
 */
export function useSwipe(ref: RefObject<HTMLElement | null>, onSwipe: (dir: 'left' | 'right') => void, enabled = true) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let start: { x: number; y: number; t: number } | null = null;
    const blocked = (t: EventTarget | null) => {
      for (let n = t as HTMLElement | null; n && n !== el; n = n.parentElement) {
        if (n.matches('input, select, textarea, [role="dialog"], .modal, .no-swipe')) return true;
        const ox = getComputedStyle(n).overflowX;
        if ((ox === 'auto' || ox === 'scroll') && n.scrollWidth > n.clientWidth + 2) return true;
      }
      return false;
    };
    const down = (e: TouchEvent) => {
      start = e.touches.length === 1 && !blocked(e.target) ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() } : null;
    };
    const up = (e: TouchEvent) => {
      if (!start) return;
      const p = e.changedTouches[0];
      const dx = p.clientX - start.x;
      const dy = p.clientY - start.y;
      const dt = Date.now() - start.t;
      start = null;
      if (Math.abs(dx) >= 70 && Math.abs(dy) < Math.abs(dx) * 0.5 && dt < 700) onSwipe(dx < 0 ? 'left' : 'right');
    };
    // eindeutig waagrecht: Browser-Geste (z. B. „Zurück“ beim Wischen nach rechts) unterdrücken
    const move = (e: TouchEvent) => {
      if (!start || e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - start.x;
      const dy = e.touches[0].clientY - start.y;
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5 && e.cancelable) e.preventDefault();
    };
    const cancel = () => (start = null);
    el.addEventListener('touchstart', down, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', up, { passive: true });
    el.addEventListener('touchcancel', cancel, { passive: true });
    return () => {
      el.removeEventListener('touchstart', down);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', up);
      el.removeEventListener('touchcancel', cancel);
    };
  }, [ref, onSwipe, enabled]);
}
