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
  rectFromMeasures,
  roundM,
  shapeToMeters,
  shapeToPage,
  snapAngle,
  snapToGrid,
  textShape,
  textWidth,
  triangleFromMeasures,
  unitsPerMeter,
  type Apex,
  type Measures,
} from '../lib/drawing';
import { type OrthoDir, extendLine, ORTHO_DIRS, orthoPoint, rotateShapeBy, scaleShape, stretchShape, translateShape, trimLine } from '../lib/cad';
import { findSnap, type SnapKind } from '../lib/snap';
import { dimsVisible, visibleDamages, visibleElements } from '../lib/layers';
import { distToSegment, pathToSvg, rectsOverlap, removeVertex, setPolylineClosed, shapeAABB, shapePath, toScreen, type Point, type View } from '../lib/geometry';
import { newMeta, putRecord, putRecords, softDelete, type ProjectState } from '../lib/store';
import type { Damage, DrawElement, DrawElementType, Plan, Rect, Shape, ShapeStyle } from '../lib/types';

/** Werkzeuge der Planbearbeitung (selbst gezeichnete Pläne) */
/** Gruppen der Werkzeugleiste (wie in CAD-Programmen) */
export type ToolGroup = 'select' | 'draw' | 'annotate' | 'modify';

/** Werkzeuge des Zeichenmodus: Zeichnen sowie Ändern (Kopieren, Verschieben, Strecken …) */
export type DrawTool = Tool | 'copy' | 'move' | 'stretch';

/** Befehle, die ein ausgewähltes Objekt brauchen */
export const NEEDS_SELECTION = new Set<DrawTool>(['copy', 'move']);

export const DRAW_TOOLS: { id: DrawTool; label: string; short?: string; icon: string; key: string; group: ToolGroup }[] = [
  { id: 'select', label: 'Auswahl: Objekte verschieben, Eckpunkte bearbeiten', short: 'Auswahl', icon: 'select', key: 'v', group: 'select' },
  { id: 'line', label: 'Linie (z. B. Wand)', short: 'Linie', icon: 'line', key: 'l', group: 'draw' },
  { id: 'polyline', label: 'Freie Form: Punkte nacheinander setzen – offen (Länge) oder geschlossen (Fläche)', short: 'Freie Form', icon: 'polyline', key: 'f', group: 'draw' },
  { id: 'rect', label: 'Rechteck (z. B. Raum)', short: 'Rechteck', icon: 'rect', key: 'r', group: 'draw' },
  { id: 'ellipse', label: 'Kreis', short: 'Kreis', icon: 'ellipse', key: 'k', group: 'draw' },
  { id: 'arc', label: 'Bogen: Anfangspunkt, Punkt auf dem Bogen, Endpunkt', short: 'Bogen', icon: 'arc', key: 'b', group: 'draw' },
  { id: 'triangle', label: 'Dreieck', short: 'Dreieck', icon: 'triangle', key: 'd', group: 'draw' },
  { id: 'polygon', label: 'Fläche: Eckpunkte nacheinander setzen, Startpunkt antippen schließt', short: 'Fläche', icon: 'polygon', key: 'p', group: 'draw' },
  { id: 'dimension', label: 'Maßlinie', short: 'Maß', icon: 'dimension', key: 'm', group: 'annotate' },
  { id: 'text', label: 'Text / Beschriftung', short: 'Text', icon: 'text', key: 't', group: 'annotate' },
  { id: 'move', label: 'Verschieben: Basispunkt zum Zielpunkt ziehen (mit Fang)', short: 'Verschieben', icon: 'move', key: 'g', group: 'modify' },
  { id: 'copy', label: 'Kopieren: Basispunkt zum Zielpunkt ziehen (mit Fang)', short: 'Kopieren', icon: 'copy', key: 'c', group: 'modify' },
  { id: 'stretch', label: 'Strecken: Fenster über Eckpunkte ziehen, dann Verschiebung ziehen', short: 'Strecken', icon: 'stretch', key: 's', group: 'modify' },
  { id: 'trim', label: 'Trimmen: Linienabschnitt bis zur nächsten Kante entfernen', short: 'Trimmen', icon: 'trim', key: 'z', group: 'modify' },
  { id: 'extend', label: 'Verlängern: Linie bis zur nächsten Kante verlängern', short: 'Verlängern', icon: 'extend', key: 'e', group: 'modify' },
];

export const DRAW_DEFAULT_COLOR = '#1c1c1e';

const isCoarse = () => matchMedia('(pointer: coarse)').matches;

/** Werkzeuge, deren Vorschau Maße zeigt (Form wird gezogen) */
const DRAW_SHAPE_TOOLS = new Set<DrawTool>(['line', 'rect', 'ellipse', 'triangle', 'dimension']);

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

/** Gespeicherte Darstellung für neue Objekte lesen */
export function readStyle(key: string): ShapeStyle {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '{}');
    return v && typeof v === 'object' ? (v as ShapeStyle) : {};
  } catch {
    return {};
  }
}

export const ORTHO_DIR_LABELS: Record<OrthoDir, string> = { auto: 'Richtung automatisch', h: 'Nur waagrecht', v: 'Nur senkrecht' };
/** Werkzeuge mit Ausgangspunkt, für die der 90°-Modus gilt (auch Endpunkte ziehen und Vektoren) */
const ORTHO_TOOLS = new Set<string>(['line', 'dimension', 'polyline', 'polygon', 'vector']);

/**
 * Darstellung eines neu gezeichneten Objekts: nur Linientyp und -stärke aus der Voreinstellung,
 * immer „Keine Füllung“ (eigene Einstellung). Gefüllt wird nur nachträglich über „Darstellung“.
 */
export function newElementStyle(d: ShapeStyle): ShapeStyle {
  return { ...(d.lineType ? { lineType: d.lineType } : {}), ...(d.lineWidth ? { lineWidth: d.lineWidth } : {}), noFill: true };
}

/** Geometrie gerundet auf 0,1 mm speichern (keine Gleitkommareste aus der Bildschirmumrechnung) */
const roundShape = (s: Shape): Shape => ({ ...s, x: roundM(s.x), y: roundM(s.y), w: roundM(s.w), h: roundM(s.h) });

/**
 * Zustand und Bedienlogik der Planbearbeitung für selbst gezeichnete Pläne.
 * Die Zeichnungsobjekte sind eigene Datensätze in Metern; Messungen bleiben davon unberührt.
 */
export function useDrawing(opts: {
  plan: Plan | undefined;
  data: ProjectState;
  damages: Damage[];
  viewer: React.RefObject<PlanViewerHandle | null>;
  /** Objekt fertig gezeichnet bzw. eingefügt (z. B. Werkzeugleiste zuklappen) */
  onCreated?: () => void;
}) {
  const { plan, data, damages, viewer, onCreated } = opts;
  const k = plan ? unitsPerMeter(plan) : 100;
  const [tool, setToolState] = useState<DrawTool>(() => {
    const t = pref('drawTool', 'rect') as DrawTool;
    return DRAW_TOOLS.some((x) => x.id === t) && !NEEDS_SELECTION.has(t) && t !== 'stretch' ? t : 'rect';
  });
  /** Strecken: zuerst Fenster (Meter), dann Verschiebung */
  const [stretchWin, setStretchWin] = useState<Rect | null>(null);
  const [color, setColorState] = useState(() => pref('drawColor', DRAW_DEFAULT_COLOR));
  /**
   * Darstellung für neue Objekte (Linientyp, -stärke, Füllung) – vor dem Zeichnen einstellbar.
   * Neue Formen sind ohne Füllung, solange die Füllung hier nicht ausdrücklich gewählt wurde
   * (eigene Einstellung „Keine Füllung“; eine früher gewählte Füllfarbe füllt nicht ungefragt).
   */
  const [defaultStyle, setDefaultStyleState] = useState<ShapeStyle>(() => {
    // einmalige Übernahme der bisherigen Voreinstellung, dabei „Keine Füllung“ setzen
    return pref('drawStyle2', '') ? readStyle('drawStyle2') : { ...readStyle('drawStyle'), noFill: true };
  });
  const [selectedId, setSelectedIdState] = useState<string | null>(null);
  /** Ausgewählter Eckpunkt des ausgewählten Objekts (zum Entfernen) */
  const [vertex, setVertex] = useState<number | null>(null);
  const setSelectedId = (id: string | null) => {
    setSelectedIdState(id);
    if (id !== selectedId) setVertex(null);
  };
  const [overrides, setOverrides] = useState<Record<string, Shape>>({});
  const [snapOn, setSnapOnState] = useState(() => pref('snap', '1') !== '0');
  /** Raster-Einrasten (Standard: aus – Formen folgen genau der Bewegung, Maße frei wählbar) */
  const [gridOn, setGridOnState] = useState(() => pref('gridSnap', '0') === '1');
  /** 90° / Orthogonal (F8): Linien, Polylinien, Maßlinien und Vektoren nur waagrecht/senkrecht */
  const [orthoOn, setOrthoOnState] = useState(() => pref('ortho', '0') === '1');
  /** Richtung im Orthogonalmodus: automatisch (nach der Mausbewegung), waagrecht oder senkrecht */
  const [orthoDir, setOrthoDirState] = useState<OrthoDir>(() => {
    const d = pref('orthoDir', 'auto') as OrthoDir;
    return ORTHO_DIRS.includes(d) ? d : 'auto';
  });
  /** Ende der zuletzt eingefügten Linie – die nächste Linie schließt dort an (Wände) */
  const [lastLineEnd, setLastLineEnd] = useState<Point | null>(null);

  const setTool = (t: DrawTool) => {
    setToolState(t);
    setStretchWin(null);
    storePref('drawTool', t);
  };
  /** Werkzeug der Planansicht: Befehle nutzen Vektor (Basis → Ziel) bzw. Fenster */
  const viewerTool: Tool = tool === 'copy' || tool === 'move' ? 'vector' : tool === 'stretch' ? (stretchWin ? 'vector' : 'window') : tool;
  const setColor = (c: string) => {
    setColorState(c);
    storePref('drawColor', c);
  };
  const setDefaultStyle = (patch: Partial<ShapeStyle>) => {
    const next = { ...defaultStyle, ...patch };
    setDefaultStyleState(next);
    storePref('drawStyle2', JSON.stringify(next));
  };
  const setSnapOn = (on: boolean) => {
    setSnapOnState(on);
    storePref('snap', on ? '1' : '0');
  };
  const setGridOn = (on: boolean) => {
    setGridOnState(on);
    storePref('gridSnap', on ? '1' : '0');
  };
  const setOrthoOn = (on: boolean) => {
    setOrthoOnState(on);
    storePref('ortho', on ? '1' : '0');
  };
  const setOrthoDir = (d: OrthoDir) => {
    setOrthoDirState(d);
    storePref('orthoDir', d);
  };

  const allStored = useMemo(() => (plan ? elementsOf(data, plan.id) : []), [data, plan]);
  // Ausgeblendete Ebenen: nicht sichtbar, nicht fang-, auswähl- oder veränderbar
  const stored = useMemo(() => visibleElements(plan, allStored), [plan, allStored]);
  const showDims = dimsVisible(plan);
  const shownDamages = visibleDamages(plan, damages);
  const elements = useMemo(() => stored.map((e) => (overrides[e.id] ? { ...e, shape: overrides[e.id] } : e)), [stored, overrides]);
  const byId = useMemo(() => new Map(elements.map((e) => [e.id, e])), [elements]);
  const items: ViewerItem[] = useMemo(
    () => elements.map((e) => ({ id: e.id, number: 0, shape: shapeToPage(e.shape, k), color: e.color, labelOffset: null, noVertexEdit: e.type === 'arc' })),
    [elements, k],
  );
  const selected = selectedId ? (byId.get(selectedId) ?? null) : null;

  // -------------------------------------------------------------------------
  // Einrasten: Fangpunkte anderer Objekte und 15°-Richtungen (abschaltbar); Raster nur, wenn
  // ausdrücklich eingeschaltet – sonst folgen Formen genau der Bewegung (keine erzwungene Rundung)

  const snap: SnapFn = (p, ctx) => {
    if (!snapOn && !gridOn && !orthoOn) return p;
    const pm = { x: p.x / k, y: p.y / k };
    const pxPerM = ctx.scale * k;
    const tol = (isCoarse() ? 16 : 9) / pxPerM;
    // Fangpunkte: End-/Eckpunkte, Schnittpunkte, Mittelpunkte, nächster Punkt auf Linien
    const others = stored.filter((e) => e.id !== ctx.movingId && e.type !== 'text').map((e) => e.shape);
    const hit = snapOn ? findSnap(pm, others, tol) : null;
    let q: Point = pm;
    let kind: SnapKind | undefined;
    if (orthoOn && ctx.from && ctx.tool && ORTHO_TOOLS.has(ctx.tool)) {
      // 90°: vom letzten Punkt nur waagrecht oder senkrecht; ein Fangpunkt bestimmt nur die
      // Länge (Projektion auf die Achse) – der rechte Winkel bleibt immer exakt
      const from = { x: ctx.from.x / k, y: ctx.from.y / k };
      const target = hit ? hit.point : pm;
      const o = orthoPoint(from, target, orthoDir);
      if (!hit && gridOn) {
        const step = gridStep(pxPerM, 14);
        const len = o.x === from.x ? o.y - from.y : o.x - from.x;
        const L = Math.round(len / step) * step;
        q = o.x === from.x ? { x: from.x, y: from.y + L } : { x: from.x + L, y: from.y };
      } else q = o;
      if (hit && Math.hypot(q.x - hit.point.x, q.y - hit.point.y) < 1e-9) kind = hit.kind;
      return { x: q.x * k, y: q.y * k, kind };
    }
    if (!snapOn && !gridOn) return p;
    if (hit) {
      q = hit.point;
      kind = hit.kind;
    } else {
      const step = gridStep(pxPerM, 14);
      if (ctx.from && (ctx.tool === 'line' || ctx.tool === 'dimension')) {
        const from = { x: ctx.from.x / k, y: ctx.from.y / k };
        const dir = snapOn ? snapAngle(from, pm) : pm;
        const len = Math.hypot(dir.x - from.x, dir.y - from.y);
        const L = gridOn ? Math.round(len / step) * step : len;
        q = len > 1e-9 ? { x: from.x + ((dir.x - from.x) / len) * L, y: from.y + ((dir.y - from.y) / len) * L } : dir;
      } else if (gridOn) {
        q = snapToGrid(pm, step);
        kind = 'grid';
      }
    }
    return { x: q.x * k, y: q.y * k, kind };
  };

  // -------------------------------------------------------------------------
  // Anlegen und Ändern

  /**
   * Objekt speichern und auswählen. Danach gilt wieder „Auswahl“ (das Objekt ist sofort
   * bearbeitbar) – außer bei Linien aus der Maßeingabe: Die nächste Linie schließt an (Wände).
   */
  const create = (type: DrawElementType, shape: Shape, extra: Partial<DrawElement> = {}, keepTool = false) => {
    if (!plan) return;
    // Formen: Linientyp/-stärke der Voreinstellung, immer ohne Füllung (Füllung nur nachträglich)
    const styled = type !== 'text' && type !== 'dimension';
    const rec: DrawElement = {
      ...newMeta(),
      projectId: plan.projectId,
      planId: plan.id,
      type,
      shape: roundShape(shape),
      color,
      ...(styled ? { style: newElementStyle(defaultStyle) } : {}),
      ...extra,
    };
    putRecord('elements', rec);
    setSelectedId(rec.id);
    setLastLineEnd(type === 'line' ? lineEnds(rec.shape)[1] : null);
    if (!keepTool) setTool('select');
    onCreated?.();
  };

  /** Im Plan gezogene Form übernehmen (Seitenkoordinaten → Meter) bzw. Befehl ausführen */
  const onCreate = (pageShape: Shape) => {
    const shape = shapeToMeters(pageShape, k);
    if (tool === 'copy' || tool === 'move' || tool === 'stretch') {
      if (tool === 'stretch' && !stretchWin) {
        setStretchWin({ x: shape.x, y: shape.y, w: shape.w, h: shape.h });
        return;
      }
      const [a, b] = lineEnds(shape);
      runVector(b.x - a.x, b.y - a.y);
      return;
    }
    const type: DrawElementType = tool === 'dimension' ? 'dimension' : tool === 'arc' ? 'arc' : pageShape.type;
    create(type, shape);
  };

  /** Kopieren, Verschieben bzw. Strecken um den gezogenen Vektor (in m) */
  const runVector = (dx: number, dy: number) => {
    if (tool === 'stretch' && stretchWin) {
      const changed: DrawElement[] = [];
      for (const e of stored) {
        const next = stretchShape(e.shape, stretchWin, dx, dy);
        if (!next) continue;
        const type = e.type !== 'dimension' && e.type !== 'arc' && next.type === 'freehand' ? 'freehand' : e.type;
        changed.push({ ...e, type, shape: roundShape(next) });
      }
      setStretchWin(null);
      if (!changed.length) {
        toast('Im Fenster liegen keine Eckpunkte.', 'info');
        return;
      }
      putRecords({ elements: changed }); // ein Rückgängig-Schritt
      toast(`${changed.length} Objekt(e) gestreckt.`, 'success', 2000);
      return;
    }
    const e = selected ? data.elements[selected.id] : undefined;
    if (!e) {
      toast('Bitte zuerst ein Objekt auswählen.', 'info');
      return;
    }
    const shape = roundShape(translateShape(e.shape, dx, dy));
    if (tool === 'copy') {
      const rec: DrawElement = { ...e, ...newMeta(), shape };
      putRecord('elements', rec);
      setSelectedId(rec.id);
      toast(`${elementLabel(e)} kopiert.`, 'success', 2000);
    } else {
      putRecord('elements', { ...e, shape });
    }
  };

  /** Drehen bzw. Skalieren des ausgewählten Objekts um seinen Mittelpunkt */
  const transformSelected = (kind: 'rotate' | 'scale', value: number) => {
    const e = selected ? data.elements[selected.id] : undefined;
    if (!e) return;
    let shape = kind === 'rotate' ? rotateShapeBy(e.shape, value) : scaleShape(e.shape, value);
    // Text: Breite folgt der Schrifthöhe
    if (e.type === 'text' && kind === 'scale') shape = { ...shape, w: textWidth(e.text ?? '', shape.h) };
    putRecord('elements', { ...e, shape: roundShape(shape) });
  };

  /** Trimmen/Verlängern: angeklickte Linie gegen alle anderen Objekte */
  const trimOrExtend = (p: Point) => {
    const pm = { x: p.x / k, y: p.y / k };
    const pxPerM = (viewer.current?.scale() ?? 1) * k;
    const tol = (isCoarse() ? 18 : 10) / pxPerM;
    let best: { e: DrawElement; d: number } | null = null;
    for (const e of stored) {
      if (e.type !== 'line') continue;
      const [a, b] = lineEnds(e.shape);
      const d = distToSegment(pm, a, b);
      if (d <= tol && (!best || d < best.d)) best = { e, d };
    }
    if (!best) {
      toast(tool === 'trim' ? 'Bitte eine Linie anklicken (Trimmen gilt für Linien).' : 'Bitte eine Linie nahe dem zu verlängernden Ende anklicken.', 'info');
      return;
    }
    const line = best.e;
    const others = stored.filter((x) => x.id !== line.id && x.type !== 'text').map((x) => x.shape);
    if (tool === 'extend') {
      const next = extendLine(line.shape, pm, others);
      if (!next) toast('In dieser Richtung gibt es keine Kante zum Verlängern.', 'info');
      else putRecord('elements', { ...line, shape: roundShape(next) });
      return;
    }
    const parts = trimLine(line.shape, pm, others);
    if (!parts) {
      toast('Die Linie schneidet keine andere Kante.', 'info');
      return;
    }
    if (!parts.length) softDelete({ elements: [line] });
    else putRecords({ elements: [{ ...line, shape: roundShape(parts[0]) }, ...parts.slice(1).map((sh) => ({ ...line, ...newMeta(), shape: roundShape(sh) }))] });
  };

  const onShapeChange = (id: string, pageShape: Shape, commit: boolean) => {
    const shape = roundShape(shapeToMeters(pageShape, k));
    if (!commit) {
      setOverrides((o) => ({ ...o, [id]: shape }));
      return;
    }
    setOverrides(({ [id]: _, ...rest }) => rest);
    const e = data.elements[id];
    // Rechteck/Dreieck mit verschobener, eingefügter oder entfernter Ecke ist danach eine Polylinie
    // (geschlossen = Fläche); eine Linie mit eingefügtem Punkt eine offene Polylinie
    const type = e && e.type !== 'dimension' && e.type !== 'arc' && shape.type === 'freehand' ? 'freehand' : e?.type;
    if (e && type && JSON.stringify(e.shape) !== JSON.stringify(shape)) putRecord('elements', { ...e, type, shape });
  };

  const textHeightNow = () => {
    const pxPerM = (viewer.current?.scale() ?? 1) * k;
    return Math.max(0.05, Math.round(22 / pxPerM / 0.05) * 0.05);
  };

  /** Werkzeug „Text“: Stelle angetippt */
  const onPlace = async (p: Point) => {
    if (tool === 'trim' || tool === 'extend') {
      trimOrExtend(p);
      return;
    }
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
    if (tool === 'line' && m.length) create('line', lineFromMeasures(lastLineEnd ?? grid(center), m.length, m.angle ?? 0), {}, true);
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

  /** Ausgewählten Eckpunkt entfernen bzw. Polylinie öffnen/schließen */
  const changeVertices = (id: string, change: (s: Shape) => Shape | null) => {
    const e = data.elements[id];
    const next = e ? change(e.shape) : null;
    if (!e || !next) return false;
    putRecord('elements', { ...e, type: 'freehand', shape: roundShape(next) });
    return true;
  };
  const removeSelectedVertex = () => {
    if (!selectedId || vertex === null) return false;
    const ok = changeVertices(selectedId, (s) => removeVertex(s, vertex));
    if (ok) setVertex(null);
    return ok;
  };
  const setClosed = (id: string, closed: boolean) => changeVertices(id, (s) => setPolylineClosed(s, closed));

  const setShowDims = (id: string, show: boolean) => {
    const e = data.elements[id];
    if (e) putRecord('elements', { ...e, showDims: show });
  };

  const recolor = (id: string, c: string) => {
    const e = data.elements[id];
    if (e) putRecord('elements', { ...e, color: c });
  };

  /** Darstellung nur dieses Objekts ändern – Geometrie und Maße bleiben unverändert */
  const restyle = (id: string, patch: Partial<ShapeStyle>) => {
    const e = data.elements[id];
    if (e) putRecord('elements', { ...e, style: { ...e.style, ...patch } });
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
      {shownDamages.map((d) => (
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
      {showDims && renderDims(view, elements, k, { color: '#5b6b80' })}
    </>
  );

  const drawOverlay = (view: View, preview: Shape | null) => {
    const previewType: DrawElementType | null = DRAW_SHAPE_TOOLS.has(tool) ? (tool as DrawElementType) : null;
    // Kopieren/Verschieben/Strecken: Vorschau des Ergebnisses (gestrichelt)
    let ghost: ReactNode = null;
    if (preview && (tool === 'copy' || tool === 'move' || (tool === 'stretch' && stretchWin))) {
      const [a, b] = lineEnds(shapeToMeters(preview, k));
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const targets = tool === 'stretch' ? stored.map((e) => stretchShape(e.shape, stretchWin!, dx, dy)).filter((x): x is Shape => !!x) : selected ? [translateShape(selected.shape, dx, dy)] : [];
      ghost = (
        <g className="cad-ghost" data-testid="cad-ghost">
          {targets.map((t, i) => (
            <path key={i} d={pathToSvg(shapePath(shapeToPage(t, k)), (p) => toScreen(view, p))} />
          ))}
        </g>
      );
    }
    return (
      <>
        {showDims && renderDims(view, elements, k)}
        {renderPreviewDims(view, preview, previewType, k)}
        {stretchWin && (
          <path
            className="cad-window"
            data-testid="stretch-window"
            d={pathToSvg(shapePath(shapeToPage({ type: 'rect', ...stretchWin }, k)), (p) => toScreen(view, p))}
          />
        )}
        {ghost}
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
    orthoOn,
    setOrthoOn,
    orthoDir,
    setOrthoDir,
    elements,
    allElements: allStored,
    items,
    selected,
    selectedId,
    setSelectedId,
    viewerTool,
    stretchWin,
    transformSelected,
    vertex,
    setVertex,
    removeSelectedVertex,
    canRemoveVertex: !!selected && vertex !== null && removeVertex(selected.shape, vertex) !== null,
    setClosed,
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
    restyle,
    defaultStyle,
    setDefaultStyle,
    overlapping,
    remove,
    renderItem,
    drawUnderlay,
    measureUnderlay,
    drawOverlay,
    resetOverrides,
  };
}
