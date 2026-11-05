import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Icon } from './Icon';
import { DEFAULT_FORM_COLOR, FORM_COLORS, FORM_FONTS, type FormFont } from '../lib/forms';

/**
 * Gemeinsame Bausteine der Formular-Editoren (eigene Felder und Vorlagen für BauPad-Berichte):
 * PDF-Ansicht mit eigenem Zoom, Schrift-Einstellungen je Feld, Zahleneingabe zum freien Tippen.
 */

export interface TextStyle {
  fontSize?: number;
  font?: FormFont;
  bold?: boolean;
  color?: string;
  align?: 'left' | 'center' | 'right';
}

/** Schrift wie im ausgefüllten PDF (CSS) */
export const inkCss = (s: TextStyle) => ({ color: s.color || DEFAULT_FORM_COLOR, fontFamily: FORM_FONTS.find((x) => x.id === (s.font ?? 'helvetica'))!.css, fontWeight: s.bold ? 700 : 400 });
export const justifyCss = (a: TextStyle['align'] | undefined) => ({ left: 'flex-start', center: 'center', right: 'flex-end' })[a ?? 'left'];

/** zuletzt gewählte Schrift – gilt für das nächste neue Feld (auf dem Gerät gemerkt, für beide Editoren) */
export function readLastStyle(): TextStyle {
  try {
    return JSON.parse(localStorage.getItem('formFieldStyle') ?? '{}') as TextStyle;
  } catch {
    return {};
  }
}
export function rememberStyle(p: Partial<TextStyle>) {
  const st: Record<string, unknown> = {};
  for (const k of ['color', 'font', 'bold', 'fontSize'] as const) if (k in p) st[k] = p[k];
  if (!Object.keys(st).length) return;
  try {
    localStorage.setItem('formFieldStyle', JSON.stringify({ ...readLastStyle(), ...st }));
  } catch {
    /* egal */
  }
}

/** Zahleneingabe, in die man frei tippen kann (leer, „1“ auf dem Weg zu „12“ …) – übernommen wird jeder gültige Wert */
export function NumInput({ value, min, max, step, onCommit, testId, label, placeholder }: { value: number | ''; min: number; max?: number; step?: number; onCommit(v: number | undefined): void; testId: string; label?: string; placeholder?: string }) {
  const [text, setText] = useState(String(value));
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    if (!focus) setText(String(value));
  }, [value, focus]);
  const ok = (v: number) => Number.isFinite(v) && v >= min && (max === undefined || v <= max);
  return (
    <input
      type="number"
      inputMode="decimal"
      min={min}
      max={max}
      step={step}
      value={text}
      placeholder={placeholder}
      aria-label={label}
      onFocus={() => setFocus(true)}
      onBlur={() => {
        setFocus(false);
        setText(String(value));
      }}
      onChange={(e) => {
        setText(e.target.value);
        const v = Number(e.target.value.replace(',', '.'));
        if (!e.target.value.trim()) onCommit(undefined);
        else if (ok(v)) onCommit(v);
      }}
      data-testid={testId}
    />
  );
}

/** Schrift einstellen: Größe, Art, fett, Ausrichtung, Farbe */
export function StylePanel({ value, onChange, sizePlaceholder, testPrefix = 'form-field' }: { value: TextStyle; onChange(p: Partial<TextStyle>): void; sizePlaceholder?: number; testPrefix?: string }) {
  const align = value.align ?? 'left';
  const color = value.color || DEFAULT_FORM_COLOR;
  return (
    <div className="form-ink" data-testid={`${testPrefix}-ink`}>
      <div className="rp-grid">
        <label className="field">
          <span>Schriftgröße (pt)</span>
          <NumInput min={5.5} max={14} step={0.5} value={value.fontSize ?? ''} placeholder={sizePlaceholder?.toFixed(1)} onCommit={(v) => onChange({ fontSize: v })} testId={`${testPrefix}-font`} />
        </label>
        <label className="field">
          <span>Schriftart</span>
          <select value={value.font ?? 'helvetica'} onChange={(e) => onChange({ font: e.target.value as FormFont })} data-testid={`${testPrefix}-fontface`}>
            {FORM_FONTS.map((x) => (
              <option key={x.id} value={x.id} style={{ fontFamily: x.css }}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="check-row form-bold">
        <input type="checkbox" checked={!!value.bold} onChange={(e) => onChange({ bold: e.target.checked })} data-testid={`${testPrefix}-bold`} />
        <span>Fett</span>
      </label>
      <div className="field">
        <span>Ausrichtung</span>
        <div className="segmented form-align" role="radiogroup" aria-label="Ausrichtung">
          {(
            [
              ['left', 'Links'],
              ['center', 'Mittig'],
              ['right', 'Rechts'],
            ] as const
          ).map(([a, label]) => (
            <button key={a} type="button" role="radio" aria-checked={align === a} aria-selected={align === a} onClick={() => onChange({ align: a })} data-testid={`${testPrefix}-align-${a}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span>Schriftfarbe</span>
        <div className="form-colors" role="radiogroup" aria-label="Schriftfarbe">
          {FORM_COLORS.map((c) => (
            <button key={c.value} type="button" role="radio" aria-checked={color === c.value} aria-label={c.label} title={c.label} className={`form-color${color === c.value ? ' on' : ''}`} style={{ background: c.value }} onClick={() => onChange({ color: c.value })} data-testid={`${testPrefix}-color`} data-color={c.value} />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * PDF-Ansicht mit eigenem Zoom (unabhängig von Seite und Seitenleiste): PC Tasten und Strg+Mausrad,
 * Handy/Tablet zwei Finger. `startPan`/`movePan` für das Verschieben mit einem Finger auf freier Fläche.
 */
export function usePdfZoom() {
  const vp = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const anchor = useRef<{ fx: number; fy: number; cx: number; cy: number } | null>(null);
  const ZMIN = 1;
  const ZMAX = 6;
  const zoomAt = (next: number, clientX?: number, clientY?: number) => {
    const v = vp.current;
    const st = stage.current;
    if (!v || !st) return;
    const vr = v.getBoundingClientRect();
    const sr = st.getBoundingClientRect();
    const cx = (clientX ?? vr.left + vr.width / 2) - vr.left;
    const cy = (clientY ?? vr.top + vr.height / 2) - vr.top;
    anchor.current = { fx: (cx + v.scrollLeft) / sr.width, fy: (cy + v.scrollTop) / sr.height, cx, cy };
    setZoom(Math.max(ZMIN, Math.min(ZMAX, next)));
  };
  useLayoutEffect(() => {
    const v = vp.current;
    const st = stage.current;
    const a = anchor.current;
    if (!v || !st || !a) return;
    anchor.current = null;
    const sr = st.getBoundingClientRect();
    v.scrollLeft = a.fx * sr.width - a.cx;
    v.scrollTop = a.fy * sr.height - a.cy;
  }, [zoom]);
  useEffect(() => {
    const v = vp.current;
    if (!v) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomAt(zoomRef.current * Math.exp(-e.deltaY * 0.002), e.clientX, e.clientY);
    };
    v.addEventListener('wheel', onWheel, { passive: false });
    return () => v.removeEventListener('wheel', onWheel);
  });
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; z: number; mx: number; my: number } | null>(null);
  const pan = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);
  /** zweiter Finger: Aufrufer bricht laufendes Ziehen ab */
  const onPinchStart = useRef<() => void>(() => {});
  const vpProps = {
    onPointerDownCapture: (e: ReactPointerEvent) => {
      if (e.pointerType !== 'touch') return;
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.current.size === 2) {
        onPinchStart.current();
        pan.current = null;
        const [a, b] = [...touches.current.values()];
        pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), z: zoomRef.current, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      }
    },
    onPointerMoveCapture: (e: ReactPointerEvent) => {
      if (e.pointerType !== 'touch' || !touches.current.has(e.pointerId)) return;
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const p = pinch.current;
      const v = vp.current;
      if (!p || touches.current.size < 2 || !v) return;
      const [a, b] = [...touches.current.values()];
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      v.scrollLeft -= mx - p.mx;
      v.scrollTop -= my - p.my;
      p.mx = mx;
      p.my = my;
      zoomAt((p.z * Math.hypot(a.x - b.x, a.y - b.y)) / Math.max(1, p.d), mx, my);
    },
    onPointerUpCapture: (e: ReactPointerEvent) => {
      touches.current.delete(e.pointerId);
      if (touches.current.size < 2) pinch.current = null;
    },
    onPointerCancelCapture: (e: ReactPointerEvent) => {
      touches.current.delete(e.pointerId);
      if (touches.current.size < 2) pinch.current = null;
    },
  };
  const startPan = (e: ReactPointerEvent) => {
    if (e.pointerType !== 'touch' || !vp.current) return false;
    pan.current = { x: e.clientX, y: e.clientY, sl: vp.current.scrollLeft, st: vp.current.scrollTop };
    return true;
  };
  /** true = Ereignis war Verschieben bzw. Zoomen (Aufrufer tut nichts weiter) */
  const movePan = (e: ReactPointerEvent) => {
    if (pinch.current) return true;
    const p = pan.current;
    if (!p || !vp.current) return false;
    vp.current.scrollLeft = p.sl - (e.clientX - p.x);
    vp.current.scrollTop = p.st - (e.clientY - p.y);
    return true;
  };
  const endPan = () => {
    const was = !!pan.current;
    pan.current = null;
    return was;
  };
  const bar: ReactNode = (
    <div className="form-zoom-bar" role="group" aria-label="PDF vergrößern">
      <button type="button" className="icon-btn" onClick={() => zoomAt(zoom / 1.25)} disabled={zoom <= ZMIN} aria-label="Verkleinern" title="Verkleinern" data-testid="form-zoom-out">
        <Icon name="minus" />
      </button>
      <span className="form-zoom-level" data-testid="form-zoom-level">
        {Math.round(zoom * 100)} %
      </span>
      <button type="button" className="icon-btn" onClick={() => zoomAt(zoom * 1.25)} disabled={zoom >= ZMAX} aria-label="Vergrößern" title="Vergrößern" data-testid="form-zoom-in">
        <Icon name="plus" />
      </button>
      <button type="button" className="btn btn-sm" onClick={() => zoomAt(1)} disabled={zoom === 1} data-testid="form-zoom-fit">
        Ganze Breite
      </button>
      <span className="muted small hide-mobile">Strg + Mausrad · am Handy mit zwei Fingern</span>
    </div>
  );
  return { vp, stage, zoom, zoomAt, vpProps, startPan, movePan, endPan, pinching: () => !!pinch.current, onPinchStart, bar };
}
