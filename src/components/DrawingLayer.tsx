import type { ReactNode } from 'react';
import { annotationsOf, dimGeometry, gridStep, majorStep, shapeToMeters } from '../lib/drawing';
import { shapeCenter, shapePath, toPage, toScreen, type Point, type View } from '../lib/geometry';
import { DEFAULT_TRANSPARENCY, fillOf, PX_PER_PT, strokeGeometry } from '../lib/style';
import type { DrawElement, DrawElementType, Rect, Shape } from '../lib/types';
import { FillPaths, visibleStroke } from './PlanViewer';

/**
 * Darstellung selbst gezeichneter Pläne in Bildschirmkoordinaten: Zeichenfläche mit Raster,
 * Zeichnungsobjekte und Maßangaben. Alle Maße kommen aus den gespeicherten Metern; der Zoom
 * bestimmt nur die Darstellung.
 */

const DIM_COLOR = '#1f5fbf';

/** Zeichenfläche (weiß) mit Raster; Rasterweite passt sich dem Zoom an. */
export function renderSheet(view: View, size: { w: number; h: number }, region: Rect, k: number, grid: boolean): ReactNode {
  const tl = toScreen(view, { x: region.x, y: region.y });
  const sheet = (
    <rect
      key="sheet"
      className="drawing-sheet"
      data-testid="drawing-sheet"
      x={tl.x}
      y={tl.y}
      width={region.w * view.scale}
      height={region.h * view.scale}
      fill="#fff"
      stroke="rgba(0,0,0,0.12)"
    />
  );
  if (!grid) return sheet;
  const pxPerM = view.scale * k;
  const step = gridStep(pxPerM, 14);
  const major = majorStep(step);
  // nur den sichtbaren Teil der Zeichenfläche
  const a = toPage(view, { x: 0, y: 0 });
  const b = toPage(view, { x: size.w, y: size.h });
  const x1 = Math.max(region.x, a.x) / k;
  const y1 = Math.max(region.y, a.y) / k;
  const x2 = Math.min(region.x + region.w, b.x) / k;
  const y2 = Math.min(region.y + region.h, b.y) / k;
  if (x2 <= x1 || y2 <= y1) return sheet;
  const minor: string[] = [];
  const majorL: string[] = [];
  const isMajor = (v: number) => Math.abs(v / major - Math.round(v / major)) < 1e-6;
  for (let x = Math.ceil(x1 / step) * step; x <= x2 + 1e-9; x += step) {
    const sx = toScreen(view, { x: x * k, y: 0 }).x;
    (isMajor(x) ? majorL : minor).push(`M${sx.toFixed(1)} ${Math.max(tl.y, 0).toFixed(1)}V${Math.min(tl.y + region.h * view.scale, size.h).toFixed(1)}`);
  }
  for (let y = Math.ceil(y1 / step) * step; y <= y2 + 1e-9; y += step) {
    const sy = toScreen(view, { x: 0, y: y * k }).y;
    (isMajor(y) ? majorL : minor).push(`M${Math.max(tl.x, 0).toFixed(1)} ${sy.toFixed(1)}H${Math.min(tl.x + region.w * view.scale, size.w).toFixed(1)}`);
  }
  return (
    <g key="sheet-grid" className="drawing-grid" data-grid-step={step}>
      {sheet}
      <path d={minor.join('')} stroke="#e9edf2" strokeWidth={1} fill="none" />
      <path d={majorL.join('')} stroke="#d3dae3" strokeWidth={1} fill="none" />
    </g>
  );
}

/** Zeichnungsobjekt in Bildschirmkoordinaten (shape in Seitenkoordinaten). */
export function renderElement(e: Pick<DrawElement, 'id' | 'type' | 'color' | 'text' | 'style'>, pageShape: Shape, view: View, selected: boolean, faded = false): ReactNode {
  const stroke = visibleStroke(e.color);
  const w = e.style?.lineWidth && e.type !== 'dimension' ? Math.max(1, e.style.lineWidth * PX_PER_PT) : selected ? 3 : 2;
  if (e.type === 'text') {
    const fs = pageShape.h * view.scale;
    const c = toScreen(view, shapeCenter(pageShape));
    const p = toScreen(view, { x: pageShape.x, y: pageShape.y + pageShape.h * 0.82 });
    const rot = pageShape.rotation ?? 0;
    return (
      <g data-element="text" data-element-id={e.id} opacity={faded ? 0.55 : 1} transform={rot ? `rotate(${rot} ${c.x} ${c.y})` : undefined}>
        {selected && (
          <rect
            x={toScreen(view, pageShape).x - 2}
            y={toScreen(view, pageShape).y - 2}
            width={pageShape.w * view.scale + 4}
            height={pageShape.h * view.scale + 4}
            fill="none"
            stroke="#1f5fbf"
            strokeDasharray="4 3"
          />
        )}
        <text x={p.x} y={p.y} fontSize={fs} fill={stroke} className="drawing-text">
          {e.text}
        </text>
      </g>
    );
  }
  if (e.type === 'dimension') {
    // Maßlinie: Linie mit Endstrichen; die Maßzahl zeichnet renderDims
    const [a, b] = endsOnScreen(pageShape, view);
    const t = ticks(a, b, 6);
    return (
      <g data-element="dimension" data-element-id={e.id} opacity={faded ? 0.55 : 1}>
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={stroke} strokeWidth={selected ? 2.4 : 1.4} />
        <path d={t} stroke={stroke} strokeWidth={selected ? 2.4 : 1.6} />
        {/* breitere unsichtbare Fläche zum Antippen */}
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={14} />
      </g>
    );
  }
  const toS = (p: Point) => toScreen(view, p);
  // Füllung (unveränderte Form) und Umrandung (Linientyp) getrennt
  const line = strokeGeometry(pageShape, toS, e.style?.lineType, w);
  const fill = fillOf(pageShape, e.color, e.style, DEFAULT_TRANSPARENCY.element);
  return (
    <g data-element={e.type} data-element-id={e.id} opacity={faded ? 0.55 : 1}>
      {fill && <FillPaths shape={pageShape} map={toS} fill={fill} />}
      {selected && <path d={line.d} fill="none" stroke="#9cc0f5" strokeWidth={w + 5} strokeLinejoin="round" strokeLinecap="round" />}
      <path
        d={line.d}
        fill="none"
        stroke={stroke}
        strokeWidth={w}
        strokeDasharray={line.dash?.join(' ')}
        strokeLinejoin="round"
        strokeLinecap="round"
        data-line-type={e.style?.lineType ?? 'solid'}
      />
    </g>
  );
}

function endsOnScreen(pageShape: Shape, view: View): [Point, Point] {
  const cmds = shapePath(pageShape);
  const pts = cmds.filter((c) => c.c !== 'Z').map((c) => toScreen(view, (c as { p: Point }).p));
  return [pts[0], pts[pts.length - 1]];
}

/** Schräge Endstriche einer Maßlinie */
function ticks(a: Point, b: Point, len: number): string {
  const ang = Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 4;
  const dx = (Math.cos(ang) * len) / 2;
  const dy = (Math.sin(ang) * len) / 2;
  return `M${a.x - dx} ${a.y - dy}L${a.x + dx} ${a.y + dy}M${b.x - dx} ${b.y - dy}L${b.x + dx} ${b.y + dy}`;
}

/** Maßangaben (Maßketten und Beschriftungen) für Objekte, alle Werte aus Metern. */
export function renderDims(
  view: View,
  items: { id: string; type: DrawElementType; shape: Shape; showDims?: boolean }[],
  k: number,
  opts: { color?: string; testId?: string } = {},
): ReactNode {
  const color = opts.color ?? DIM_COLOR;
  const toS = (p: Point) => toScreen(view, { x: p.x * k, y: p.y * k });
  const out: ReactNode[] = [];
  for (const it of items) {
    const { dims, labels } = annotationsOf({ type: it.type, shape: it.shape, showDims: it.showDims });
    dims.forEach((dm, i) => {
      const a = toS(dm.a);
      const b = toS(dm.b);
      if (Math.hypot(b.x - a.x, b.y - a.y) < 18) return; // zu klein für eine lesbare Maßkette
      const off = dm.inline ? 0 : 16;
      const g = dimGeometry(a, b, dm.side, off);
      const textOff = dm.inline ? 9 : 7;
      const tp = { x: g.mid.x + g.nx * textOff, y: g.mid.y + g.ny * textOff };
      out.push(
        <g key={`${it.id}-d${i}`} className="dim" data-dim={dm.text}>
          {!dm.inline && (
            <>
              <path d={`M${a.x + g.nx * 3} ${a.y + g.ny * 3}L${g.a2.x + g.nx * 4} ${g.a2.y + g.ny * 4}M${b.x + g.nx * 3} ${b.y + g.ny * 3}L${g.b2.x + g.nx * 4} ${g.b2.y + g.ny * 4}`} stroke={color} strokeWidth={0.8} />
              <line x1={g.a2.x} y1={g.a2.y} x2={g.b2.x} y2={g.b2.y} stroke={color} strokeWidth={1} />
              <path d={ticks(g.a2, g.b2, 7)} stroke={color} strokeWidth={1.4} />
            </>
          )}
          <text
            x={tp.x}
            y={tp.y}
            transform={`rotate(${g.angle} ${tp.x} ${tp.y})`}
            textAnchor="middle"
            dominantBaseline="central"
            className="dim-text"
            fill={color}
            data-testid={opts.testId}
          >
            {dm.text}
          </text>
        </g>,
      );
    });
    labels.forEach((l, i) => {
      const p = toS(l.at);
      out.push(
        <text key={`${it.id}-l${i}`} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="central" className="dim-text" fill={color} data-dim={l.text} data-testid={opts.testId}>
          {l.text}
        </text>,
      );
    });
  }
  return <g className="dims">{out}</g>;
}

/** Live-Maße der gerade gezeichneten Form (Vorschau in Seitenkoordinaten). */
export function renderPreviewDims(view: View, preview: Shape | null, type: DrawElementType | null, k: number): ReactNode {
  if (!preview || !type || type === 'text') return null;
  const shape = shapeToMeters(preview, k);
  return renderDims(view, [{ id: 'preview', type: type === 'freehand' ? 'freehand' : type, shape }], k, { color: '#c2410c', testId: 'live-dim' });
}

