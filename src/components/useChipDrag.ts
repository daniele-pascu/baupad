import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/** Ziel beim Loslassen: Tageszeile einer Baustelle (Elemente mit data-drop-site / data-drop-day) */
export interface DropTarget {
  siteId: string;
  day: number;
}

export interface ChipDrag {
  workerId: string;
  label: string;
  x: number;
  y: number;
  /** Abstand zwischen Zeiger und linker oberer Ecke des Namens beim Anfassen – der Kasten bleibt so unter dem Zeiger */
  dx: number;
  dy: number;
  /** Finger: Kasten etwas über dem Finger zeigen, sonst ist er verdeckt */
  touch: boolean;
  over: DropTarget | null;
}

/** Wartezeit bis zum „Anheben“ bei Finger/Stift – vorher ist Wischen normales Scrollen */
const LONG_PRESS_MS = 350;

/**
 * Namen ziehen und auf einer anderen Baustelle bzw. einem anderen Tag loslassen.
 * Maus: ziehen ab 6 px. Finger: kurz gedrückt halten, dann ziehen (sonst wird gescrollt).
 * Am oberen/unteren Rand scrollt die Seite automatisch mit. Ohne Zusatzpaket (Pointer Events).
 */
export function useChipDrag(onDrop: (workerId: string, fromSiteId: string | null, fromDay: number, to: DropTarget) => void) {
  const [drag, setDrag] = useState<ChipDrag | null>(null);
  /** nach dem Ziehen keinen Klick auslösen (würde sonst das Menü des Namens öffnen) */
  const suppressClick = useRef(false);
  const dropRef = useRef(onDrop);
  dropRef.current = onDrop;

  const start = (e: ReactPointerEvent, workerId: string, label: string, fromSiteId: string | null, fromDay: number) => {
    if (e.button !== 0) return;
    const touch = e.pointerType !== 'mouse';
    const sx = e.clientX;
    const sy = e.clientY;
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const dx = sx - box.left;
    const dy = sy - box.top;
    let last = { x: sx, y: sy };
    let active = false;
    let over: DropTarget | null = null;
    let timer = 0;
    let raf = 0;

    const targetAt = (x: number, y: number): DropTarget | null => {
      const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop-site]');
      return el ? { siteId: el.dataset.dropSite!, day: Number(el.dataset.dropDay) } : null;
    };
    const update = () => {
      over = targetAt(last.x, last.y);
      setDrag({ workerId, label, x: last.x, y: last.y, dx, dy, touch, over });
    };
    // am Rand automatisch scrollen, damit auch weit entfernte Baustellen erreichbar sind
    const autoScroll = () => {
      raf = requestAnimationFrame(() => {
        const edge = 72;
        const y = last.y;
        const dy = y < edge ? -Math.ceil((edge - y) / 4) : y > window.innerHeight - edge ? Math.ceil((y - (window.innerHeight - edge)) / 4) : 0;
        if (dy) {
          window.scrollBy(0, dy);
          update();
        }
        autoScroll();
      });
    };
    const begin = () => {
      active = true;
      navigator.vibrate?.(12);
      update();
      autoScroll();
    };
    const move = (ev: PointerEvent) => {
      last = { x: ev.clientX, y: ev.clientY };
      if (!active) {
        const dist = Math.hypot(ev.clientX - sx, ev.clientY - sy);
        if (touch) {
          if (dist > 10) cleanup(); // vor dem Anheben bewegt → normales Scrollen
        } else if (dist > 6) begin();
        return;
      }
      update();
    };
    // während des Ziehens darf die Seite nicht unter dem Finger wegscrollen
    const touchMove = (ev: TouchEvent) => {
      if (active) ev.preventDefault();
    };
    const up = () => {
      if (active) {
        suppressClick.current = true;
        window.setTimeout(() => (suppressClick.current = false), 0);
        if (over) dropRef.current(workerId, fromSiteId, fromDay, over);
      }
      cleanup();
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(raf);
      active = false;
      setDrag(null);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cleanup);
      document.removeEventListener('touchmove', touchMove);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cleanup);
    document.addEventListener('touchmove', touchMove, { passive: false });
    if (touch) timer = window.setTimeout(begin, LONG_PRESS_MS);
  };

  return { drag, start, suppressClick };
}
