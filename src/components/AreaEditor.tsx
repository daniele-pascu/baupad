import { useEffect, useRef, useState } from 'react';
import { HANDLES, handlePosition, normalizeRect, rectContains, type Point } from '../lib/geometry';
import { contentBounds, detectLayoutRegions } from '../lib/layout-detect';
import type { Rect } from '../lib/types';
import { Icon } from './Icon';
import { Modal } from './Modal';

export interface AreaItem extends Rect {
  /** 'proposed' = automatisch erkannt, noch nicht bestätigt */
  state: 'accepted' | 'proposed';
}

interface Props {
  title: string;
  /** Gerenderte Seite */
  image: HTMLCanvasElement;
  pageWidth: number;
  pageHeight: number;
  initial: Rect[];
  /** nur ein Bereich erlaubt (Ausschnitt eines bestehenden Plans ändern) */
  single?: boolean;
  onDone: (areas: Rect[]) => void;
  onClose: () => void;
}

type Drag =
  | { kind: 'new'; start: Point; current: Point }
  | { kind: 'move'; index: number; start: Point; orig: Rect }
  | { kind: 'resize'; index: number; handle: string; orig: Rect };

/**
 * Planbereiche (Layoutbereiche) einer Seite festlegen.
 * Automatisch erkannte Bereiche sind nur Vorschläge und müssen bestätigt werden.
 */
export function AreaEditor({ title, image, pageWidth, pageHeight, initial, single, onDone, onClose }: Props) {
  const [areas, setAreas] = useState<AreaItem[]>(initial.map((r) => ({ ...r, state: 'accepted' })));
  const [selected, setSelected] = useState<number | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: 400 });

  useEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => {
      const avW = el.clientWidth;
      const avH = el.clientHeight;
      const s = Math.min(avW / pageWidth, avH / pageHeight);
      setSize({ w: pageWidth * s, h: pageHeight * s });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [pageWidth, pageHeight]);

  useEffect(() => {
    const host = canvasHost.current!;
    image.className = 'area-image';
    host.appendChild(image);
    return () => {
      if (image.parentElement === host) host.removeChild(image);
    };
  }, [image]);

  const scale = size.w / pageWidth;
  const toPage = (e: { clientX: number; clientY: number }): Point => {
    const r = canvasHost.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(pageWidth, (e.clientX - r.left) / scale)),
      y: Math.max(0, Math.min(pageHeight, (e.clientY - r.top) / scale)),
    };
  };

  const detect = () => {
    const ctx = image.getContext('2d', { willReadFrequently: true })!;
    const img = ctx.getImageData(0, 0, image.width, image.height);
    const found = detectLayoutRegions(img, pageWidth, pageHeight);
    if (!found.length) {
      setMessage('Es wurden keine eindeutigen Planbereiche erkannt. Sie können die ganze Seite verwenden oder Bereiche selbst aufziehen.');
      return;
    }
    setMessage(
      `${found.length} mögliche Bereiche erkannt. Bitte prüfen: Tippen Sie einen Vorschlag an und bestätigen Sie ihn, oder passen Sie ihn an.`,
    );
    setAreas([...areas.filter((a) => a.state === 'accepted'), ...found.map((r) => ({ ...r, state: 'proposed' as const }))]);
    setSelected(null);
  };

  /** Weiße Ränder abschneiden: ein Bereich um den gesamten Inhalt */
  const trim = () => {
    const ctx = image.getContext('2d', { willReadFrequently: true })!;
    const r = contentBounds(ctx.getImageData(0, 0, image.width, image.height), pageWidth, pageHeight);
    if (!r) {
      setMessage('Kein nennenswerter weißer Rand gefunden.');
      return;
    }
    setAreas([{ ...r, state: 'accepted' }]);
    setSelected(0);
    setMessage('Weißer Rand entfernt. Der Rahmen lässt sich an den Ecken anpassen.');
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const p = toPage(e);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const target = e.target as Element;
    const handle = target.getAttribute('data-handle');
    if (handle && selected !== null) {
      setDrag({ kind: 'resize', index: selected, handle, orig: areas[selected] });
      return;
    }
    // oberster Bereich unter dem Finger
    const idx = [...areas.keys()].reverse().find((i) => rectContains(areas[i], p));
    if (idx !== undefined) {
      setSelected(idx);
      setDrag({ kind: 'move', index: idx, start: p, orig: areas[idx] });
      return;
    }
    setSelected(null);
    if (single && areas.length) return;
    setDrag({ kind: 'new', start: p, current: p });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = toPage(e);
    if (drag.kind === 'new') setDrag({ ...drag, current: p });
    else if (drag.kind === 'move') {
      const dx = p.x - drag.start.x;
      const dy = p.y - drag.start.y;
      const o = drag.orig;
      const x = Math.max(0, Math.min(pageWidth - o.w, o.x + dx));
      const y = Math.max(0, Math.min(pageHeight - o.h, o.y + dy));
      setAreas(areas.map((a, i) => (i === drag.index ? { ...a, x, y } : a)));
    } else {
      const o = drag.orig;
      let x1 = o.x;
      let y1 = o.y;
      let x2 = o.x + o.w;
      let y2 = o.y + o.h;
      const min = 10 / scale;
      if (drag.handle.includes('w')) x1 = Math.min(p.x, x2 - min);
      if (drag.handle.includes('e')) x2 = Math.max(p.x, x1 + min);
      if (drag.handle.includes('n')) y1 = Math.min(p.y, y2 - min);
      if (drag.handle.includes('s')) y2 = Math.max(p.y, y1 + min);
      setAreas(areas.map((a, i) => (i === drag.index ? { ...a, x: x1, y: y1, w: x2 - x1, h: y2 - y1 } : a)));
    }
  };

  const onPointerUp = () => {
    if (drag?.kind === 'new') {
      const r = normalizeRect(drag.start, drag.current);
      if (r.w * scale > 12 && r.h * scale > 12) {
        setAreas([...areas, { ...r, state: 'accepted' }]);
        setSelected(areas.length);
      }
    }
    setDrag(null);
  };

  const accepted = areas.filter((a) => a.state === 'accepted');
  const proposed = areas.filter((a) => a.state === 'proposed').length;
  const sel = selected !== null ? areas[selected] : null;
  const preview = drag?.kind === 'new' ? normalizeRect(drag.start, drag.current) : null;

  return (
    <Modal
      title={title}
      onClose={onClose}
      full
      persistent
      testId="area-editor"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onDone(accepted.map(({ x, y, w, h }) => ({ x, y, w, h })))}
            data-testid="areas-done"
          >
            {accepted.length ? `${accepted.length} Bereich(e) übernehmen` : 'Ganze Seite verwenden'}
          </button>
        </>
      }
    >
      <div className="area-toolbar">
        <button type="button" className="btn btn-sm" onClick={trim} data-testid="trim-margins">
          <Icon name="fit" size={18} /> Ränder abschneiden
        </button>
        {!single && (
          <button type="button" className="btn btn-sm" onClick={detect} data-testid="detect-areas">
            <Icon name="layers" size={18} /> Bereiche automatisch erkennen
          </button>
        )}
        {proposed > 0 && (
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setAreas(areas.map((a) => ({ ...a, state: 'accepted' })))}
            data-testid="accept-all-areas"
          >
            <Icon name="check" size={18} /> Alle {proposed} Vorschläge übernehmen
          </button>
        )}
        {sel?.state === 'proposed' && (
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => setAreas(areas.map((a, i) => (i === selected ? { ...a, state: 'accepted' } : a)))}
          >
            <Icon name="check" size={18} /> Vorschlag bestätigen
          </button>
        )}
        {sel && (
          <button
            type="button"
            className="btn btn-sm btn-danger-text"
            onClick={() => {
              setAreas(areas.filter((_, i) => i !== selected));
              setSelected(null);
            }}
          >
            <Icon name="trash" size={18} /> Bereich entfernen
          </button>
        )}
        {areas.length > 0 && (
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              setAreas([]);
              setSelected(null);
              setMessage(null);
            }}
          >
            Ganze Seite verwenden
          </button>
        )}
      </div>
      <p className="muted small area-hint">
        {message ??
          (single
            ? 'Ziehen Sie einen Rahmen um den gewünschten Planausschnitt. Ohne Rahmen wird die ganze Seite verwendet.'
            : 'Ziehen Sie mit dem Finger oder der Maus Rahmen um einzelne Planbereiche. Ohne Bereich wird die ganze Seite verwendet.')}
      </p>
      <div className="area-wrap" ref={wrapRef}>
        <div className="area-stage" style={{ width: size.w, height: size.h }}>
          <div ref={canvasHost} className="area-canvas-host" />
          <svg
            className="area-overlay"
            width={size.w}
            height={size.h}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => setDrag(null)}
            data-testid="area-overlay"
          >
            {areas.map((a, i) => (
              <g key={i}>
                <rect
                  x={a.x * scale}
                  y={a.y * scale}
                  width={a.w * scale}
                  height={a.h * scale}
                  className={`area-rect area-${a.state}${i === selected ? ' area-selected' : ''}`}
                />
                <text x={a.x * scale + 6} y={a.y * scale + 18} className="area-label">
                  {a.state === 'proposed' ? `Vorschlag ${i + 1}` : `Bereich ${accepted.indexOf(a) + 1}`}
                </text>
              </g>
            ))}
            {sel &&
              HANDLES.map((h) => {
                const p = handlePosition(sel, h);
                return <rect key={h} data-handle={h} className="area-handle" x={p.x * scale - 9} y={p.y * scale - 9} width={18} height={18} />;
              })}
            {preview && (
              <rect x={preview.x * scale} y={preview.y * scale} width={preview.w * scale} height={preview.h * scale} className="area-rect area-accepted" />
            )}
          </svg>
        </div>
      </div>
    </Modal>
  );
}
