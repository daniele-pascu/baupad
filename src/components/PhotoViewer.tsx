import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { usePhotoUrl } from './PhotoImg';

type Zoom = { s: number; x: number; y: number };
const NO_ZOOM: Zoom = { s: 1, x: 0, y: 0 };
const MAX_ZOOM = 8;

/**
 * Großansicht von Fotos (z. B. am Mangel): Blättern (Pfeiltasten, Wischen), Vergrößern (Mausrad, Doppelklick,
 * zwei Finger, +/−), Verschieben. Nutzt die Darstellung der Fotodokumentation (Lightbox).
 */
export function PhotoViewer({ ids, index, title, onIndex, onClose }: { ids: string[]; index: number; title?: string; onIndex(i: number): void; onClose(): void }) {
  const id = ids[index] ?? ids[0];
  const src = usePhotoUrl(id, 'data');
  const [z, setZ] = useState<Zoom>(NO_ZOOM);
  const zRef = useRef(z);
  zRef.current = z;
  const body = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const total = ids.length;
  const prev = () => onIndex((index - 1 + total) % total);
  const next = () => onIndex((index + 1) % total);
  useEffect(() => setZ(NO_ZOOM), [id]);
  const clamp = (st: Zoom): Zoom => {
    const b = body.current;
    const im = img.current;
    if (!b || !im || st.s <= 1) return st.s <= 1 ? NO_ZOOM : st;
    const mx = Math.max(0, (im.clientWidth * st.s - b.clientWidth) / 2);
    const my = Math.max(0, (im.clientHeight * st.s - b.clientHeight) / 2);
    return { s: st.s, x: Math.min(mx, Math.max(-mx, st.x)), y: Math.min(my, Math.max(-my, st.y)) };
  };
  const zoomAt = (factor: number, cx = 0, cy = 0, from: Zoom = zRef.current) => {
    const ns = Math.min(MAX_ZOOM, Math.max(1, from.s * factor));
    const k = ns / from.s;
    setZ(clamp({ s: ns, x: cx - (cx - from.x) * k, y: cy - (cy - from.y) * k }));
  };
  const center = (clientX: number, clientY: number) => {
    const r = body.current!.getBoundingClientRect();
    return [clientX - (r.left + r.width / 2), clientY - (r.top + r.height / 2)];
  };
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const [cx, cy] = center(e.clientX, e.clientY);
      zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0022)), cx, cy);
    };
    const onDbl = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('button')) return;
      const [cx, cy] = center(e.clientX, e.clientY);
      if (zRef.current.s > 1) setZ(NO_ZOOM);
      else zoomAt(2.5, cx, cy);
    };
    let drag: { x: number; y: number; zx: number; zy: number } | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || zRef.current.s <= 1 || e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, zx: zRef.current.x, zy: zRef.current.y };
      el.setPointerCapture(e.pointerId);
      e.preventDefault();
    };
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      setZ(clamp({ ...zRef.current, x: drag.zx + e.clientX - drag.x, y: drag.zy + e.clientY - drag.y }));
    };
    const onUp = () => (drag = null);
    let touch: { x: number; y: number; zx: number; zy: number; dist: number; start: Zoom; moved: boolean } | null = null;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onTS = (e: TouchEvent) => {
      const t = e.touches;
      if (t.length === 2) {
        touch = { x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2, zx: zRef.current.x, zy: zRef.current.y, dist: dist(t), start: zRef.current, moved: true };
        e.preventDefault();
      } else if (t.length === 1) touch = { x: t[0].clientX, y: t[0].clientY, zx: zRef.current.x, zy: zRef.current.y, dist: 0, start: zRef.current, moved: false };
    };
    const onTM = (e: TouchEvent) => {
      if (!touch) return;
      const t = e.touches;
      if (t.length === 2 && touch.dist) {
        e.preventDefault();
        const [cx, cy] = center((t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2);
        zoomAt(dist(t) / touch.dist, cx, cy, touch.start);
      } else if (t.length === 1 && zRef.current.s > 1) {
        e.preventDefault();
        touch.moved = true;
        setZ(clamp({ ...zRef.current, x: touch.zx + t[0].clientX - touch.x, y: touch.zy + t[0].clientY - touch.y }));
      }
    };
    const onTE = (e: TouchEvent) => {
      const t = touch;
      touch = null;
      if (!t || t.moved || zRef.current.s > 1 || !e.changedTouches.length || total < 2) return;
      const dx = e.changedTouches[0].clientX - t.x;
      const dy = e.changedTouches[0].clientY - t.y;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) (dx < 0 ? next : prev)();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('dblclick', onDbl);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('touchstart', onTS, { passive: false });
    el.addEventListener('touchmove', onTM, { passive: false });
    el.addEventListener('touchend', onTE);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('dblclick', onDbl);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('touchstart', onTS);
      el.removeEventListener('touchmove', onTM);
      el.removeEventListener('touchend', onTE);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, total]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        onClose();
      } else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === '+') zoomAt(1.5);
      else if (e.key === '-') zoomAt(1 / 1.5);
      else if (e.key === '0') setZ(NO_ZOOM);
    };
    // vor den Fenstern dahinter abfangen (Escape schließt sonst auch den Mängel-Dialog)
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, total, onClose]);
  return (
    <div className="lightbox photo-viewer" role="dialog" aria-modal="true" aria-label="Foto" data-testid="photo-viewer">
      <header className="lightbox-head">
        <div className="lightbox-title">
          <strong>{title ?? 'Foto'}</strong>
          {total > 1 && (
            <span>
              Foto {index + 1} von {total}
            </span>
          )}
        </div>
        <div className="lightbox-zoom" role="group" aria-label="Vergrößerung">
          <button type="button" className="icon-btn" onClick={() => zoomAt(1 / 1.5)} disabled={z.s <= 1} aria-label="Verkleinern" title="Verkleinern (−)" data-testid="viewer-zoom-out">
            <Icon name="minus" size={18} />
          </button>
          <button type="button" className="lightbox-zoom-value" onClick={() => setZ(NO_ZOOM)} disabled={z.s <= 1} title="Auf Fenstergröße (0)" data-testid="viewer-zoom">
            {Math.round(z.s * 100)} %
          </button>
          <button type="button" className="icon-btn" onClick={() => zoomAt(1.5)} disabled={z.s >= MAX_ZOOM} aria-label="Vergrößern" title="Vergrößern (+) – auch Mausrad, Doppelklick oder zwei Finger" data-testid="viewer-zoom-in">
            <Icon name="plus" size={18} />
          </button>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Schließen" data-testid="viewer-close">
          <Icon name="close" />
        </button>
      </header>
      <div ref={body} className={`lightbox-body${z.s > 1 ? ' zoomed' : ''}`} data-zoom={z.s.toFixed(2)}>
        {total > 1 && (
          <button type="button" className="lightbox-nav prev" onClick={prev} aria-label="Vorheriges Foto" data-testid="viewer-prev">
            <Icon name="back" />
          </button>
        )}
        {src ? (
          <img ref={img} src={src} alt="Foto" draggable={false} style={{ transform: `translate(${z.x}px, ${z.y}px) scale(${z.s})` }} data-testid="viewer-image" />
        ) : (
          <span className="muted">Wird geladen …</span>
        )}
        {total > 1 && (
          <button type="button" className="lightbox-nav next" onClick={next} aria-label="Nächstes Foto" data-testid="viewer-next">
            <Icon name="next" />
          </button>
        )}
      </div>
      <footer className="lightbox-foot photo-viewer-foot">
        <span className="muted small">Doppelt tippen oder zwei Finger zum Vergrößern · Wischen zum Blättern</span>
      </footer>
    </div>
  );
}
