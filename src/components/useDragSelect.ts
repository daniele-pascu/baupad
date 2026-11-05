import { useEffect, useRef } from 'react';

/**
 * Auswahl wie mit der Maus – auch am Handy/iPad: Foto lange drücken → Auswahlmodus, das Foto ist markiert;
 * Finger liegen lassen und ziehen markiert alle Fotos zwischen dem ersten und dem aktuellen (in Anzeigereihenfolge).
 * Am oberen/unteren Rand scrollt die Seite mit. Mit der Maus: gedrückt halten und ziehen genauso.
 * Kurzes Tippen bleibt, wie es ist (öffnen bzw. im Auswahlmodus an/abwählen).
 *
 * Die Kacheln brauchen `data-photo` (ID); `order` ist die Reihenfolge der angezeigten Fotos.
 */
export function useDragSelect(opts: {
  /** Element mit den Kacheln (per Callback-Ref, damit es auch nach spätem Einblenden greift) */
  container: HTMLElement | null;
  order: string[];
  selected: Set<string>;
  /** Auswahlmodus einschalten (lange gedrückt) */
  start(): void;
  setSelected(next: Set<string>): void;
}) {
  const latest = useRef(opts);
  latest.current = opts;
  /** nach einem Langdruck den folgenden „Klick“ schlucken */
  const swallowClick = useRef(false);

  useEffect(() => {
    const root = opts.container;
    if (!root) return;
    let timer = 0;
    let down: { x: number; y: number; id: string; pointerId: number } | null = null;
    let drag: { anchor: number; base: Set<string>; remove: boolean; last: number; x: number; y: number } | null = null;
    let raf = 0;

    const idAt = (x: number, y: number): string | null => {
      const el = document.elementFromPoint(x, y)?.closest?.('[data-photo]') as HTMLElement | null;
      return el && root.contains(el) ? el.dataset.photo ?? null : null;
    };
    const apply = (to: number) => {
      if (!drag || to < 0) return;
      drag.last = to;
      const { order } = latest.current;
      const [a, b] = drag.anchor <= to ? [drag.anchor, to] : [to, drag.anchor];
      const next = new Set(drag.base);
      for (let i = a; i <= b; i++) drag.remove ? next.delete(order[i]) : next.add(order[i]);
      latest.current.setSelected(next);
    };
    const moveTo = (x: number, y: number) => {
      if (!drag) return;
      drag.x = x;
      drag.y = y;
      const id = idAt(x, y);
      if (id) apply(latest.current.order.indexOf(id));
    };
    // am Rand mitscrollen, solange gezogen wird
    const tick = () => {
      if (!drag) return;
      const edge = 70;
      const h = window.innerHeight;
      const dy = drag.y < edge ? -Math.ceil((edge - drag.y) / 4) : drag.y > h - edge ? Math.ceil((drag.y - (h - edge)) / 4) : 0;
      if (dy) {
        window.scrollBy(0, dy);
        moveTo(drag.x, drag.y);
      }
      raf = requestAnimationFrame(tick);
    };
    const begin = () => {
      if (!down) return;
      const { order, selected } = latest.current;
      const anchor = order.indexOf(down.id);
      if (anchor < 0) return;
      // Auswahlleiste blendet sich ein → Inhalt rutscht; so nachscrollen, dass das Foto unter dem Finger bleibt
      const pressed = root.querySelector(`[data-photo="${CSS.escape(down.id)}"]`);
      const before = pressed?.getBoundingClientRect().top ?? 0;
      latest.current.start();
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const after = pressed?.isConnected ? pressed.getBoundingClientRect().top : before;
          if (Math.abs(after - before) > 1) window.scrollBy(0, after - before);
        }),
      );
      const wasOn = selected.has(down.id);
      drag = { anchor, base: new Set(selected), remove: wasOn && selected.size > 0, last: anchor, x: down.x, y: down.y };
      swallowClick.current = true;
      navigator.vibrate?.(15);
      apply(anchor);
      raf = requestAnimationFrame(tick);
    };
    const end = () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(raf);
      down = null;
      drag = null;
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const id = (e.target as HTMLElement).closest?.('[data-photo]') as HTMLElement | null;
      if (!id || !root.contains(id)) return;
      swallowClick.current = false; // neuer Druck: ein evtl. noch offener „Klick schlucken“ gilt nicht mehr
      down = { x: e.clientX, y: e.clientY, id: id.dataset.photo!, pointerId: e.pointerId };
      window.clearTimeout(timer);
      timer = window.setTimeout(begin, 450);
    };
    const onMove = (e: PointerEvent) => {
      if (drag) {
        if (e.pointerType === 'mouse' || e.pointerType === 'pen') moveTo(e.clientX, e.clientY);
        return;
      }
      // vor dem Langdruck bewegt → normales Scrollen, kein Auswählen
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) {
        window.clearTimeout(timer);
        down = null;
      }
    };
    // Finger: Seite darf während des Ziehens nicht scrollen (sonst bricht der Browser die Geste ab)
    const onTouchMove = (e: TouchEvent) => {
      if (!drag) return;
      e.preventDefault();
      const t = e.touches[0];
      if (t) moveTo(t.clientX, t.clientY);
    };
    const onClick = (e: MouseEvent) => {
      if (!swallowClick.current) return;
      swallowClick.current = false;
      e.preventDefault();
      e.stopPropagation();
    };
    const onContext = (e: Event) => {
      if ((e.target as HTMLElement).closest?.('[data-photo]')) e.preventDefault();
    };
    root.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', () => !drag && end());
    window.addEventListener('touchend', end);
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    root.addEventListener('click', onClick, true);
    root.addEventListener('contextmenu', onContext);
    return () => {
      end();
      root.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('touchend', end);
      document.removeEventListener('touchmove', onTouchMove);
      root.removeEventListener('click', onClick, true);
      root.removeEventListener('contextmenu', onContext);
    };
  }, [opts.container]);
}
