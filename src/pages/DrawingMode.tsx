import { useMemo, useState, type ReactNode } from 'react';
import { elementLabel } from '../components/DrawPanel';
import { renderDims, renderElement, renderPreviewDims, renderSheet } from '../components/DrawingLayer';
import type { PlanViewerHandle, SnapFn, Tool, ViewerItem } from '../components/PlanViewer';
import { confirmDialog, promptDialog, toast } from '../components/ui';
import { elementsOf } from '../lib/aufmass';
import { damageNo } from '../lib/numbering';
import {
  applyMeasures,
  circleFromMeasures,
  gridStep,
  lineEnds,
  lineFromMeasures,
  nearestSnap,
  rectFromMeasures,
  roundM,
  shapeToMeters,
  shapeToPage,
  snapAngle,
  snapPoints,
  snapToGrid,
  textShape,
  textWidth,
  triangleFromMeasures,
  unitsPerMeter,
  type Apex,
  type Measures,
} from '../lib/drawing';
import { pathToSvg, rectsOverlap, shapeAABB, shapePath, toScreen, type Point, type View } from '../lib/geometry';
import { newMeta, putRecord, softDelete, type ProjectState } from '../lib/store';
import type { Damage, DrawElement, DrawElementType, Plan, Rect, Shape } from '../lib/types';

/** Werkzeuge der Planbearbeitung (selbst gezeichnete Pläne) */
export const DRAW_TOOLS: { id: Tool; label: string; short?: string; icon: string; key: string }[] = [
  { id: 'select', label: 'Auswählen / Verschieben', short: 'Auswahl', icon: 'select', key: 'v' },
  { id: 'line', label: 'Linie (z. B. Wand)', short: 'Linie', icon: 'line', key: 'l' },
  { id: 'rect', label: 'Rechteck (z. B. Raum)', short: 'Rechteck', icon: 'rect', key: 'r' },
  { id: 'ellipse', label: 'Kreis', short: 'Kreis', icon: 'ellipse', key: 'k' },
  { id: 'triangle', label: 'Dreieck', short: 'Dreieck', icon: 'triangle', key: 'd' },
  { id: 'polygon', label: 'Fläche: Eckpunkte nacheinander setzen', short: 'Fläche', icon: 'polygon', key: 'p' },
  { id: 'freehand', label: 'Freihand', short: 'Freihand', icon: 'freehand', key: 'f' },
  { id: 'dimension', label: 'Maßlinie', short: 'Maß', icon: 'dimension', key: 'm' },
  { id: 'text', label: 'Text / Beschriftung', short: 'Text', icon: 'text', key: 't' },
];

export const DRAW_DEFAULT_COLOR = '#1c1c1e';

const isCoarse = () => matchMedia('(pointer: coarse)').matches;

function pref(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function storePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* optional */
  }
}

/** Geometrie gerundet auf 0,1 mm speichern (keine Gleitkommareste aus der Bildschirmumrechnung) */
const roundShape = (s: Shape): Shape => ({ ...s, x: roundM(s.x), y: roundM(s.y), w: roundM(s.w), h: roundM(s.h) });

/**
 * Zustand und Bedienlogik der Planbearbeitung für selbst gezeichnete Pläne.
 * Die Zeichnungsobjekte sind eigene Datensätze in Metern; Messungen bleiben davon unberührt.
 */
export function useDrawing(opts: { plan: Plan | undefined; data: ProjectState; damages: Damage[]; viewer: React.RefObject<PlanViewerHandle | null> }) {
  const { plan, data, damages, viewer } = opts;
  const k = plan ? unitsPerMeter(plan) : 100;
  const [tool, setToolState] = useState<Tool>(() => {
    const t = pref('drawTool', 'rect') as Tool;
    return DRAW_TOOLS.some((x) => x.id === t) ? t : 'rect';
  });
  const [color, setColorState] = useState(() => pref('drawColor', DRAW_DEFAULT_COLOR));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, Shape>>({});
  const [snapOn, setSnapOnState] = useState(() => pref('snap', '1') !== '0');
  /** Raster-Einrasten (Standard: aus – Formen folgen genau der Bewegung, Maße frei wählbar) */
  const [gridOn, setGridOnState] = useState(() => pref('gridSnap', '0') === '1');
  /** Ende der zuletzt eingefügten Linie – die nächste Linie schließt dort an (Wände) */
  const [lastLineEnd, setLastLineEnd] = useState<Point | null>(null);

  const setTool = (t: Tool) => {
    setToolState(t);
    storePref('drawTool', t);
  };
  const setColor = (c: string) => {
    setColorState(c);
    storePref('drawColor', c);
  };
  const setSnapOn = (on: boolean) => {
    setSnapOnState(on);
    storePref('snap', on ? '1' : '0');
  };
  const setGridOn = (on: boolean) => {
    setGridOnState(on);
    storePref('gridSnap', on ? '1' : '0');
  };

  const stored = useMemo(() => (plan ? elementsOf(data, plan.id) : []), [data, plan]);
  const elements = useMemo(() => stored.map((e) => (overrides[e.id] ? { ...e, shape: overrides[e.id] } : e)), [stored, overrides]);
  const byId = useMemo(() => new Map(elements.map((e) => [e.id, e])), [elements]);
  const items: ViewerItem[] = useMemo(
    () => elements.map((e) => ({ id: e.id, number: 0, shape: shapeToPage(e.shape, k), color: e.color, labelOffset: null })),
    [elements, k],
  );
  const selected = selectedId ? (byId.get(selectedId) ?? null) : null;

  // -------------------------------------------------------------------------
  // Einrasten: Fangpunkte anderer Objekte und 15°-Richtungen (abschaltbar); Raster nur, wenn
  // ausdrücklich eingeschaltet – sonst folgen Formen genau der Bewegung (keine erzwungene Rundung)

  const snap: SnapFn = (p, ctx) => {
    if (!snapOn && !gridOn) return p;
    const pm = { x: p.x / k, y: p.y / k };
    const pxPerM = ctx.scale * k;
    const tol = (isCoarse() ? 16 : 9) / pxPerM;
    const hit = snapOn ? nearestSnap(pm, snapPoints(stored, ctx.movingId), tol) : null;
    let q: Point = pm;
    if (hit) q = hit;
    else {
      const step = gridStep(pxPerM, 14);
      if (ctx.from && (ctx.tool === 'line' || ctx.tool === 'dimension')) {
        const from = { x: ctx.from.x / k, y: ctx.from.y / k };
        const dir = snapOn ? snapAngle(from, pm) : pm;
        const len = Math.hypot(dir.x - from.x, dir.y - from.y);
        const L = gridOn ? Math.round(len / step) * step : len;
        q = len > 1e-9 ? { x: from.x + ((dir.x - from.x) / len) * L, y: from.y + ((dir.y - from.y) / len) * L } : dir;
      } else if (gridOn) q = snapToGrid(pm, step);
    }
    return { x: q.x * k, y: q.y * k };
  };

  // -------------------------------------------------------------------------
  // Anlegen und Ändern

  const create = (type: DrawElementType, shape: Shape, extra: Partial<DrawElement> = {}) => {
    if (!plan) return;
    const rec: DrawElement = { ...newMeta(), projectId: plan.projectId, planId: plan.id, type, shape: roundShape(shape), color, ...extra };
    putRecord('elements', rec);
    setSelectedId(rec.id);
    setLastLineEnd(type === 'line' ? lineEnds(rec.shape)[1] : null);
  };

  /** Im Plan gezogene Form übernehmen (Seitenkoordinaten → Meter) */
  const onCreate = (pageShape: Shape) => {
    const type: DrawElementType = tool === 'dimension' ? 'dimension' : pageShape.type;
    create(type, shapeToMeters(pageShape, k));
  };

  const onShapeChange = (id: string, pageShape: Shape, commit: boolean) => {
    const shape = roundShape(shapeToMeters(pageShape, k));
    if (!commit) {
      setOverrides((o) => ({ ...o, [id]: shape }));
      return;
    }
    setOverrides(({ [id]: _, ...rest }) => rest);
    const e = data.elements[id];
    // Rechteck, dessen Ecke einzeln verschoben wurde, ist danach eine (Vieleck-)Fläche
    const type = e?.type === 'rect' && shape.type === 'freehand' ? 'freehand' : e?.type;
    if (e && type && JSON.stringify(e.shape) !== JSON.stringify(shape)) putRecord('elements', { ...e, type, shape });
  };

  const textHeightNow = () => {
    const pxPerM = (viewer.current?.scale() ?? 1) * k;
    return Math.max(0.05, Math.round(22 / pxPerM / 0.05) * 0.05);
  };

  /** Werkzeug „Text“: Stelle angetippt */
  const onPlace = async (p: Point) => {
    if (tool !== 'text') return;
    const text = await promptDialog({ title: 'Text einfügen', label: 'Text', confirmLabel: 'Einfügen' });
    if (!text?.trim()) return;
    create('text', textShape({ x: p.x / k, y: p.y / k }, text.trim(), textHeightNow()), { text: text.trim() });
  };

  /** Einfügen über die Maßeingabe (Position: Mitte der Ansicht bzw. Ende der letzten Linie) */
  const insert = (m: Measures, apex: Apex) => {
    const c = viewer.current?.center();
    const center = c ? { x: c.x / k, y: c.y / k } : { x: 1, y: 1 };
    const grid = (p: Point) => snapToGrid(p, 0.05);
    if (tool === 'line' && m.length) create('line', lineFromMeasures(lastLineEnd ?? grid(center), m.length, m.angle ?? 0));
    else if (tool === 'rect' && m.length && m.width) create('rect', rectFromMeasures(grid({ x: center.x - m.length / 2, y: center.y - m.width / 2 }), m.length, m.width));
    else if (tool === 'ellipse' && m.diameter) create('ellipse', circleFromMeasures(grid(center), m.diameter));
    else if (tool === 'triangle' && m.base && m.height)
      create('triangle', triangleFromMeasures(grid({ x: center.x - m.base / 2, y: center.y - m.height / 2 }), m.base, m.height, apex));
  };

  const apply = (id: string, m: Measures) => {
    const e = data.elements[id];
    if (!e) return;
    putRecord('elements', { ...e, shape: applyMeasures(e, m) });
  };

  const setText = (id: string, text: string) => {
    const e = data.elements[id];
    if (!e) return;
    putRecord('elements', { ...e, text, shape: { ...e.shape, w: textWidth(text, e.shape.h) } });
  };

  const setShowDims = (id: string, show: boolean) => {
    const e = data.elements[id];
    if (e) putRecord('elements', { ...e, showDims: show });
  };

  const recolor = (id: string, c: string) => {
    const e = data.elements[id];
    if (e) putRecord('elements', { ...e, color: c });
  };

  /** Messungen, deren Markierung das Objekt überlappt */
  const overlapping = (e: DrawElement) => {
    const r = shapeAABB(shapeToPage(e.shape, k));
    const grown: Rect = { x: r.x - 1, y: r.y - 1, w: r.w + 2, h: r.h + 2 };
    return damages.filter((d) => rectsOverlap(grown, shapeAABB(d.shape)));
  };

  const remove = async (e: DrawElement) => {
    const over = overlapping(e);
    if (over.length) {
      const ok = await confirmDialog({
        title: `${elementLabel(e)} löschen?`,
        message: (
          <p>
            Auf diesem Objekt liegen <strong>{over.length} Messung(en)</strong> (Nr. {over.map((d) => damageNo(d)).join(', ')}). Die Messungen und
            ihre Maße bleiben erhalten – nur das Zeichnungsobjekt wird entfernt. Mit „Rückgängig“ lässt es sich wiederherstellen.
          </p>
        ),
        confirmLabel: 'Objekt löschen',
        danger: true,
      });
      if (!ok) return;
    }
    softDelete({ elements: [data.elements[e.id]] });
    if (selectedId === e.id) setSelectedId(null);
    toast(`${elementLabel(e)} gelöscht.`, 'info', 2000);
  };

  // -------------------------------------------------------------------------
  // Darstellung

  const renderItem = (item: ViewerItem, view: View, sel: boolean): ReactNode => {
    const e = byId.get(item.id);
    return e ? renderElement(e, item.shape, view, sel) : null;
  };

  const markerPaths = (view: View) => (
    <g className="faded-markers" opacity={0.35} key="faded">
      {damages.map((d) => (
        <path key={d.id} d={pathToSvg(shapePath(d.shape), (p) => toScreen(view, p))} fill="none" stroke={d.color} strokeWidth={2} strokeDasharray="5 4" />
      ))}
    </g>
  );

  /** Planbearbeitung: Zeichenfläche mit Raster, Messungen nur blass zur Orientierung */
  const drawUnderlay = (region: Rect) => (view: View, size: { w: number; h: number }) => (
    <>
      {renderSheet(view, size, region, k, true)}
      {markerPaths(view)}
    </>
  );

  /** Aufmaß: Zeichnung als ruhender Hintergrund mit Maßen */
  const measureUnderlay = (region: Rect) => (view: View, size: { w: number; h: number }) => (
    <>
      {renderSheet(view, size, region, k, false)}
      {elements.map((e) => (
        <g key={e.id}>{renderElement(e, shapeToPage(e.shape, k), view, false)}</g>
      ))}
      {renderDims(view, elements, k, { color: '#5b6b80' })}
    </>
  );

  const drawOverlay = (view: View, preview: Shape | null) => {
    const previewType: DrawElementType | null =
      tool === 'select' || tool === 'component' || tool === 'text' || tool === 'polygon' ? null : tool === 'dimension' ? 'dimension' : (tool as DrawElementType);
    return (
      <>
        {renderDims(view, elements, k)}
        {renderPreviewDims(view, preview, previewType, k)}
      </>
    );
  };

  const resetOverrides = () => setOverrides({});

  return {
    k,
    tool,
    setTool,
    color,
    setColor,
    snapOn,
    setSnapOn,
    gridOn,
    setGridOn,
    elements,
    items,
    selected,
    selectedId,
    setSelectedId,
    lastLineEnd,
    snap,
    onCreate,
    onShapeChange,
    onPlace: (p: Point) => void onPlace(p),
    insert,
    apply,
    setText,
    setShowDims,
    recolor,
    overlapping,
    remove,
    renderItem,
    drawUnderlay,
    measureUnderlay,
    drawOverlay,
    resetOverrides,
  };
}
