import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  HANDLES,
  fitView,
  freehandShape,
  handlePosition,
  hitShape,
  layoutLabels,
  leaderLine,
  normalizeRect,
  rectContains,
  lineShape,
  triangleShape,
  normalizeRotation,
  resizeRotatedShape,
  rotatePoint,
  shapeAABB,
  shapeBounds,
  shapeCenter,
  toPage,
  toScreen,
  zoomAt,
  clampDelta,
  clampPoint,
  hasEditableVertices,
  moveVertex,
  polygonShape,
  canEditVertexCount,
  insertVertex,
  nearestEdge,
  shapeVertices,
  type Point,
  type View,
} from '../lib/geometry';
import { clampRenderScale, drawImageRegion, getImageBitmap, getPdfDocument, renderPdfRegion, type RenderJob } from '../lib/pdf';
import { getView, putView } from '../lib/db';
import { arcShape } from '../lib/cad';
import { SNAP_LABELS, type SnapHit, type SnapKind } from '../lib/snap';
import { DEFAULT_TRANSPARENCY, fillOf, fillPaths, PX_PER_PT, strokeGeometry, type Fill } from '../lib/style';
import type { Component, Damage, Plan, Rect, Shape, ShapeStyle, ShapeType, SourceFile } from '../lib/types';

/** Werkzeuge: Auswahl, Formen, Bauteilbuchstabe setzen; bei gezeichneten Plänen zusätzlich Maßlinie und Text */
export type Tool =
  | 'select'
  | ShapeType
  | 'component'
  | 'dimension'
  | 'text'
  | 'polygon'
  | 'polyline'
  | 'calibrate'
  /** Bogen aus drei Punkten */
  | 'arc'
  /** Fenster aufziehen (z. B. Strecken) bzw. Vektor von Basis- zu Zielpunkt (Kopieren, Verschieben) */
  | 'window'
  | 'vector'
  /** Linie anklicken: Trimmen bzw. Verlängern */
  | 'trim'
  | 'extend';

/** Werkzeuge, die Punkt für Punkt gesetzt werden (Polygon = immer geschlossen, Polylinie = offen oder geschlossen) */
const isPointTool = (t: Tool) => t === 'polygon' || t === 'polyline' || t === 'arc';

/** Werkzeuge, die eine Stelle antippen statt eine Form zu zeichnen */
const PLACE_TOOLS = new Set<Tool>(['component', 'text', 'trim', 'extend']);

/** Bearbeitbares Objekt der Planansicht (Messung bzw. Zeichnungsobjekt in Seitenkoordinaten). */
export type ViewerItem = Pick<Damage, 'id' | 'number' | 'shape' | 'color' | 'labelOffset'> &
  Partial<Pick<Damage, 'label' | 'style'>> & {
    /** Eckpunkte nicht einzeln bearbeiten (z. B. Bogen) */
    noVertexEdit?: boolean;
  };
/** Angezeigte Nummer bzw. Kennzeichnung */
const noOf = (d: ViewerItem) => d.label?.trim() || String(d.number);

/** Einrasten: liefert den eingerasteten Punkt (Seitenkoordinaten). */
export type SnapFn = (p: Point, ctx: { from?: Point; tool?: Tool; scale: number; movingId?: string }) => Point & { kind?: SnapKind };

/** Gut sichtbare Strichfarbe (Weiß wäre auf weißem Plan unsichtbar). */
export const visibleStroke = (color: string) => (color.toLowerCase() === '#ffffff' ? '#8e8e93' : color);
/** Kontur unter jeder Markierung: hell unter dunklen Farben, dunkel unter hellen. */
function haloColor(color: string): string {
  const n = parseInt(color.replace('#', ''), 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 170 ? '#1c1c1e' : '#ffffff';
}

export interface PlanViewerHandle {
  zoomIn(): void;
  zoomOut(): void;
  fit(): void;
  back(): void;
  canGoBack(): boolean;
  focus(id: string): void;
  /** Mittelpunkt der Ansicht in Seitenkoordinaten */
  center(): Point | null;
  /**
   * Punktwerkzeuge: gesetzte Punkte übernehmen. closed = true schließt die Form (Fläche),
   * false lässt sie offen (Polylinie); ohne Angabe: Polygon geschlossen, Polylinie offen.
   */
  finishPolygon(closed?: boolean): void;
  cancelPolygon(): void;
  /** Zuletzt gesetzten Punkt entfernen */
  undoPolygonPoint(): void;
  /** Bildschirmpixel je Seiteneinheit */
  scale(): number;
  /** Ausgewähltes Objekt formatfüllend anzeigen („Zoom auf Auswahl“) */
  zoomTo(id: string): void;
  /**
   * Fang-Lupe (Taste X bei Punktwerkzeugen): Bereich um den Mauszeiger vergrößern und alle
   * Fangpunkte zeigen; nach dem nächsten Punkt kehrt die vorherige Ansicht zurück. Erneut
   * aufrufen schließt die Lupe ohne Punkt.
   */
  toggleLupe(): void;
  lupeActive(): boolean;
}

interface Props {
  plan: Plan;
  /** Originaldatei; null bei selbst gezeichneten Plänen (kein Hintergrundbild) */
  file: SourceFile | null;
  /** Darzustellender Bereich (Standard: Planausschnitt bzw. ganze Seite) */
  region?: Rect;
  damages: ViewerItem[];
  selectedId: string | null;
  tool: Tool;
  color: string;
  /** neu gezeichnete, noch nicht gespeicherte Form */
  pending: { shape: Shape; color: string } | null;
  onSelect(id: string | null): void;
  onCreate(shape: Shape): void;
  onShapeChange(id: string, shape: Shape, commit: boolean): void;
  onLabelChange(id: string, offset: { dx: number; dy: number }, commit: boolean): void;
  onHistoryChange?(): void;
  /** Bauteilkennzeichnungen (A, B, C …) dieses Plans */
  components: Component[];
  selectedComponentId: string | null;
  onSelectComponent(id: string | null): void;
  onComponentMove(id: string, x: number, y: number, commit: boolean): void;
  /** Werkzeug „Bauteil“ bzw. „Text“: Stelle im Plan angetippt */
  onPlace(p: Point): void;
  /** Nummernschilder der Objekte anzeigen (Standard: ja) */
  showLabels?: boolean;
  /** Eigene Darstellung eines Objekts (undefined = Standard-Markierung) */
  renderItem?(item: ViewerItem, view: View, selected: boolean): ReactNode | undefined;
  /** Zusätzliche Ebene unter bzw. über den Objekten (Bildschirmkoordinaten) */
  underlay?(view: View, size: { w: number; h: number }): ReactNode;
  overlay?(view: View, preview: Shape | null): ReactNode;
  /** Einrasten an Raster und Fangpunkten (nur gezeichnete Pläne) */
  snap?: SnapFn;
  /** Alle Fangpunkte in einem Bereich (Seitenkoordinaten) – Anzeige in der Fang-Lupe */
  snapPoints?: (area: Rect) => SnapHit[];
  /** Fang-Lupe geöffnet bzw. geschlossen */
  onLupeChange?: (active: boolean) => void;
  /** Gültiger Planbereich (Seitenkoordinaten): Neue Formen und Verschiebungen bleiben darin */
  bounds?: Rect;
  /** Eckpunkte einzeln bearbeiten (Rechteck → Vieleck, Dreieck, Vieleck) */
  vertexEdit?: boolean;
  /** Punktwerkzeuge: Anzahl gesetzter Punkte (0 = keine Form im Aufbau) */
  onPolygonChange?(points: number): void;
  /** Ausgewählter Eckpunkt (nur mit vertexEdit) – z. B. zum Entfernen */
  selectedVertex?: number | null;
  onVertexSelect?(index: number | null): void;
}

type Gesture =
  | { kind: 'none' }
  | { kind: 'pan'; start: Point; view: View; moved: boolean; tapTarget: string | null }
  | { kind: 'pinch'; dist: number; mid: Point; view: View }
  | { kind: 'draw'; tool: DrawGestureTool; start: Point; current: Point; points: Point[] }
  | { kind: 'move'; id: string; start: Point; orig: Shape; moved: boolean; ref: Point }
  | { kind: 'resize'; id: string; handle: string; orig: Shape }
  | { kind: 'vertex'; id: string; index: number; orig: Shape; start: Point; moved: boolean }
  | { kind: 'polytap'; start: Point; view: View; moved: boolean }
  | { kind: 'rotate'; id: string; orig: Shape; startAngle: number }
  | { kind: 'label'; id: string; start: Point; orig: Rect; moved: boolean }
  | { kind: 'component'; id: string; start: Point; orig: Point; moved: boolean }
  | { kind: 'place'; start: Point; view: View; moved: boolean }
  | { kind: 'ignore' };

const isCoarse = () => matchMedia('(pointer: coarse)').matches;

/** Werkzeuge, die durch Ziehen eine Form erzeugen */
type DrawGestureTool = ShapeType | 'dimension' | 'calibrate' | 'window' | 'vector';

/**
 * Planansicht mit Zoom (Schaltflächen, Mausrad, zwei Finger), Verschieben und Markierungen.
 *
 * Der Plan wird einmal als Grundbild gerendert und per CSS-Transformation skaliert.
 * Beim Hineinzoomen wird zusätzlich der sichtbare Ausschnitt in voller Auflösung
 * nachgerendert (Detailebene), damit Linien und Texte scharf bleiben.
 * Markierungen werden als SVG in Bildschirmkoordinaten gezeichnet, aber ausschließlich
 * in Seitenkoordinaten gespeichert.
 */
export const PlanViewer = forwardRef<PlanViewerHandle, Props>(function PlanViewer(props, ref) {
  const { plan, file, damages, selectedId, tool, color, pending, components, selectedComponentId } = props;
  const showLabels = props.showLabels !== false;
  const regionProp = props.region;
  const region: Rect = useMemo(
    () => regionProp ?? plan.crop ?? { x: 0, y: 0, w: plan.pageWidth, h: plan.pageHeight },
    [regionProp?.x, regionProp?.y, regionProp?.w, regionProp?.h, plan.crop, plan.pageWidth, plan.pageHeight],
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const baseCanvasRef = useRef<HTMLCanvasElement>(null);
  const detailCanvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [view, setViewState] = useState<View | null>(null);
  const viewRef = useRef<View | null>(null);
  const history = useRef<View[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [detailRect, setDetailRect] = useState<Rect | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture>({ kind: 'none' });
  const [, forceRender] = useState(0);
  const lastTap = useRef<{ t: number; p: Point; moveId?: string } | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  /** Werkzeug „Fläche (Punkte)“: bisher gesetzte Punkte und Mauszeigerposition für die Vorschau */
  const poly = useRef<Point[]>([]);
  const polyHover = useRef<Point | null>(null);
  const clampP = (p: Point) => (propsRef.current.bounds ? clampPoint(p, propsRef.current.bounds) : p);
  /** Zuletzt gefangener Punkt (Markierung mit Art des Fangpunkts) */
  const snapMark = useRef<{ p: Point; kind: SnapKind } | null>(null);
  /** Fang-Lupe: Ansicht vor dem Hineinzoomen; letzte Mausposition (Bildschirm) */
  const lupe = useRef<{ prev: View } | null>(null);
  const lastHover = useRef<Point | null>(null);
  const endLupe = () => {
    const l = lupe.current;
    if (!l) return;
    lupe.current = null;
    // Ansicht zurück – gesetzte Punkte liegen in Plankoordinaten und bleiben exakt
    setView(l.prev);
    propsRef.current.onLupeChange?.(false);
  };
  /** Fangpunkte im sichtbaren Bereich (je Ansicht einmal berechnet) */
  const lupeCache = useRef<{ key: string; pts: SnapHit[] } | null>(null);
  const lupePoints = (v: View): SnapHit[] => {
    const el = containerRef.current;
    const fn = propsRef.current.snapPoints;
    if (!el || !fn) return [];
    const key = `${v.scale}:${v.tx}:${v.ty}`;
    if (lupeCache.current?.key === key) return lupeCache.current.pts;
    const a = toPage(v, { x: 0, y: 0 });
    const b = toPage(v, { x: el.clientWidth, y: el.clientHeight });
    const pts = fn({ x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y });
    lupeCache.current = { key, pts };
    return pts;
  };
  // Werkzeugwechsel schließt die Fang-Lupe
  useEffect(() => {
    if (lupe.current) endLupe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.tool]);
  const snapAt: SnapFn = (raw, ctx) => {
    const r: Point & { kind?: SnapKind } = propsRef.current.snap ? propsRef.current.snap(raw, ctx) : raw;
    snapMark.current = r.kind ? { p: { x: r.x, y: r.y }, kind: r.kind } : null;
    return r;
  };

  const setView = useCallback((v: View) => {
    viewRef.current = v;
    setViewState(v);
  }, []);

  const fitScale = size ? fitView(region, size.w, size.h).scale : 1;
  const limits = useCallback(
    () => {
      const f = size ? fitView(region, size.w, size.h).scale : 1;
      return { min: f * 0.5, max: Math.max(f * 60, 12) };
    },
    [region, size],
  );

  // Werkzeugwechsel verwirft eine angefangene Fläche
  useEffect(() => {
    if (poly.current.length) {
      poly.current = [];
      polyHover.current = null;
      propsRef.current.onPolygonChange?.(0);
    }
  }, [tool]);

  // Containergröße beobachten
  useLayoutEffect(() => {
    const el = containerRef.current!;
    const update = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      setSize((old) => {
        if (old && viewRef.current && (old.w !== w || old.h !== h)) {
          // Mittelpunkt beibehalten
          const v = viewRef.current;
          setView({ ...v, tx: v.tx + (w - old.w) / 2, ty: v.ty + (h - old.h) / 2 });
        }
        return { w, h };
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [setView]);

  // Anfangsansicht: zuletzt verwendete Ansicht oder ganzer Plan
  const initialised = useRef(false);
  useEffect(() => {
    if (!size || initialised.current) return;
    initialised.current = true;
    const fit = fitView(region, size.w, size.h);
    setView(fit);
    getView(plan.id)
      .then((saved) => {
        if (!saved || !viewRef.current) return;
        const scale = saved.scale * fit.scale;
        setView({ scale, tx: size.w / 2 - saved.cx * scale, ty: size.h / 2 - saved.cy * scale });
      })
      .catch(() => {});
  }, [size, region, plan.id, setView]);

  // Ansicht speichern (nur lokal)
  useEffect(() => {
    if (!view || !size) return;
    const t = setTimeout(() => {
      const c = toPage(view, { x: size.w / 2, y: size.h / 2 });
      void putView({ id: plan.id, projectId: plan.projectId, scale: view.scale / fitScale, cx: c.x, cy: c.y }).catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [view, size, plan.id, plan.projectId, fitScale]);

  // Quelle laden (PDF-Seite oder Bild)
  const source = useRef<{ page?: PDFPageProxy; bitmap?: ImageBitmap } | null>(null);
  const baseScale = useRef(1);
  const fileId = file?.id ?? null;
  const fileKind = file?.kind;
  const fileMime = file?.mimeType ?? '';
  const rot = plan.rotation ?? 0;
  useEffect(() => {
    let cancelled = false;
    let job: RenderJob | null = null;
    if (!fileId) {
      // Selbst gezeichneter Plan: kein Hintergrund zu laden
      source.current = null;
      setStatus('ready');
      return;
    }
    setStatus('loading');
    (async () => {
      const canvas = baseCanvasRef.current!;
      const maxSide = isCoarse() ? 3072 : 4096;
      const k = clampRenderScale(region.w, region.h, maxSide / Math.max(region.w, region.h));
      if (fileKind === 'pdf') {
        const doc = await getPdfDocument(fileId);
        const page = await doc.getPage(plan.pageIndex + 1);
        if (cancelled) return;
        source.current = { page };
        baseScale.current = k;
        job = renderPdfRegion(page, canvas, region, k, rot);
        await job.promise;
      } else {
        const bitmap = await getImageBitmap(fileId, fileMime);
        if (cancelled) return;
        source.current = { bitmap };
        const s = Math.min(1, k);
        baseScale.current = s;
        canvas.width = Math.max(1, Math.round(region.w * s));
        canvas.height = Math.max(1, Math.round(region.h * s));
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        drawImageRegion(ctx, bitmap, region, canvas.width, canvas.height, rot);
      }
      if (!cancelled) setStatus('ready');
    })().catch((e) => {
      console.error(e);
      if (!cancelled) {
        setErrorMsg((e as Error).message);
        setStatus('error');
      }
    });
    return () => {
      cancelled = true;
      job?.cancel();
    };
  }, [fileId, fileKind, fileMime, plan.pageIndex, region, rot]);

  // Detailebene nachrendern, wenn stark hineingezoomt ist
  useEffect(() => {
    if (status !== 'ready' || !view || !size || !fileId) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const needed = view.scale * dpr;
    if (needed <= baseScale.current * 1.15) {
      setDetailRect(null);
      return;
    }
    let job: RenderJob | null = null;
    let cancelled = false;
    const t = setTimeout(() => {
      const a = toPage(view, { x: 0, y: 0 });
      const b = toPage(view, { x: size.w, y: size.h });
      const x1 = Math.max(region.x, a.x);
      const y1 = Math.max(region.y, a.y);
      const x2 = Math.min(region.x + region.w, b.x);
      const y2 = Math.min(region.y + region.h, b.y);
      if (x2 <= x1 || y2 <= y1) return;
      const r = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
      const s = clampRenderScale(r.w, r.h, needed);
      const canvas = document.createElement('canvas');
      const src = source.current;
      if (src?.page) {
        job = renderPdfRegion(src.page, canvas, r, s, rot);
        job.promise
          .then(() => {
            if (cancelled) return;
            swapDetail(canvas, r);
          })
          .catch((e) => console.warn(e));
      } else if (src?.bitmap) {
        const sc = Math.min(s, 1.5);
        canvas.width = Math.max(1, Math.round(r.w * sc));
        canvas.height = Math.max(1, Math.round(r.h * sc));
        drawImageRegion(canvas.getContext('2d')!, src.bitmap, r, canvas.width, canvas.height, rot);
        swapDetail(canvas, r);
      }
    }, 180);
    const swapDetail = (canvas: HTMLCanvasElement, r: Rect) => {
      const target = detailCanvasRef.current;
      if (!target) return;
      target.width = canvas.width;
      target.height = canvas.height;
      target.getContext('2d')!.drawImage(canvas, 0, 0);
      setDetailRect(r);
    };
    return () => {
      cancelled = true;
      clearTimeout(t);
      job?.cancel();
    };
  }, [view, size, status, region, fileId, rot]);

  // ---------------------------------------------------------------------------
  // Ansicht steuern

  const pushHistory = () => {
    if (viewRef.current) {
      history.current.push(viewRef.current);
      if (history.current.length > 30) history.current.shift();
      propsRef.current.onHistoryChange?.();
    }
  };

  const zoomBy = (factor: number) => {
    if (!viewRef.current || !size) return;
    const { min, max } = limits();
    setView(zoomAt(viewRef.current, { x: size.w / 2, y: size.h / 2 }, factor, min, max));
  };

  useImperativeHandle(ref, () => ({
    zoomIn: () => zoomBy(1.5),
    zoomOut: () => zoomBy(1 / 1.5),
    fit: () => {
      if (!size) return;
      pushHistory();
      setView(fitView(region, size.w, size.h));
    },
    back: () => {
      const v = history.current.pop();
      if (v) setView(v);
      propsRef.current.onHistoryChange?.();
    },
    canGoBack: () => history.current.length > 0,
    center: () => (viewRef.current && size ? toPage(viewRef.current, { x: size.w / 2, y: size.h / 2 }) : null),
    finishPolygon: (closed?: boolean) => finishPolygon(closed),
    undoPolygonPoint: () => {
      poly.current = poly.current.slice(0, -1);
      propsRef.current.onPolygonChange?.(poly.current.length);
      forceRender((n) => n + 1);
    },
    cancelPolygon: () => {
      endLupe();
      poly.current = [];
      propsRef.current.onPolygonChange?.(0);
      forceRender((n) => n + 1);
    },
    scale: () => viewRef.current?.scale ?? 1,
    toggleLupe: () => {
      if (lupe.current) return endLupe();
      const v = viewRef.current;
      if (!v || !size) return;
      // um den Mauszeiger (sonst Bildmitte) etwa 5-fach vergrößern, mindestens so, dass ca. 120 Planeinheiten die Breite füllen
      const at = lastHover.current ?? { x: size.w / 2, y: size.h / 2 };
      const { min, max } = limits();
      const target = Math.min(max, Math.max(min, v.scale * 5, Math.min(size.w, size.h) / 120));
      lupe.current = { prev: v };
      // Punkt unter dem Mauszeiger in die Bildmitte – so liegt die Umgebung frei (nicht unter Leisten am Rand)
      const c = toPage(v, at);
      setView({ scale: target, tx: size.w / 2 - c.x * target, ty: size.h / 2 - c.y * target });
      propsRef.current.onLupeChange?.(true);
    },
    lupeActive: () => !!lupe.current,
    zoomTo: (id: string) => {
      const d = propsRef.current.damages.find((x) => x.id === id);
      if (!d || !size || !viewRef.current) return;
      const b = shapeAABB(d.shape);
      pushHistory();
      const { min, max } = limits();
      const scale = Math.min(max, Math.max(min, Math.min((size.w * 0.6) / Math.max(b.w, 1e-3), (size.h * 0.6) / Math.max(b.h, 1e-3))));
      setView({ scale, tx: size.w / 2 - (b.x + b.w / 2) * scale, ty: size.h / 2 - (b.y + b.h / 2) * scale });
      propsRef.current.onHistoryChange?.();
    },
    focus: (id: string) => {
      const d = propsRef.current.damages.find((x) => x.id === id);
      if (!d || !size || !viewRef.current) return;
      const b = shapeAABB(d.shape);
      const cur = viewRef.current;
      const sb = { ...toScreen(cur, b), w: b.w * cur.scale, h: b.h * cur.scale };
      const visible = sb.x >= 40 && sb.y >= 40 && sb.x + sb.w <= size.w - 40 && sb.y + sb.h <= size.h - 40;
      const bigEnough = Math.max(sb.w, sb.h) >= 24;
      if (visible && bigEnough) return;
      pushHistory();
      const { min, max } = limits();
      let scale = cur.scale;
      if (!bigEnough || !visible) {
        const target = (Math.min(size.w, size.h) * 0.3) / Math.max(b.w, b.h, 1e-3);
        scale = Math.min(max, Math.max(min, Math.max(cur.scale, Math.min(target, fitScale * 8))));
      }
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      setView({ scale, tx: size.w / 2 - cx * scale, ty: size.h / 2 - cy * scale });
    },
  }));

  // ---------------------------------------------------------------------------
  // Beschriftungen (Bildschirmkoordinaten)

  // Die Anordnung wird in Seitenkoordinaten je Zoomstufe (ca. 12 %) berechnet – beim
  // Verschieben bleibt sie unverändert, beim Zoomen wird nicht bei jedem Bild neu gerechnet.
  const qScale = view ? Math.pow(2, Math.round(Math.log2(view.scale) * 6) / 6) : 1;
  const labelFont = Math.max(10, Math.min(14, 11 * Math.pow(qScale / fitScale, 0.2)));
  const labelLayout = useMemo(() => {
    const k = 1.08 / qScale; // Bildschirmpixel → Seiteneinheiten, mit Reserve für Zwischenstufen
    return layoutLabels(
      damages.map((d) => ({
        id: d.id,
        bounds: shapeAABB(d.shape),
        shape: d.shape,
        w: (noOf(d).length * labelFont * 0.62 + labelFont * 0.8) * k,
        h: labelFont * 1.5 * k,
        offset: d.labelOffset,
      })),
      3 / qScale,
      { area: region },
    );
  }, [damages, qScale, labelFont, region]);
  const labels = useMemo(() => {
    const out = new Map<string, Rect>();
    if (!view || !showLabels) return out;
    const h = labelFont * 1.5;
    for (const d of damages) {
      const r = labelLayout.get(d.id);
      if (!r) continue;
      const w = noOf(d).length * labelFont * 0.62 + labelFont * 0.8;
      const c = toScreen(view, { x: r.x + r.w / 2, y: r.y + r.h / 2 });
      out.set(d.id, { x: c.x - w / 2, y: c.y - h / 2, w, h });
    }
    return out;
  }, [labelLayout, damages, view, labelFont, showLabels]);

  // ---------------------------------------------------------------------------
  // Zeigerereignisse

  const localPoint = (e: { clientX: number; clientY: number }): Point => {
    const r = containerRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const hitTol = () => (isCoarse() ? 14 : 7);

  const hitDamage = (p: Point): ViewerItem | null => {
    const v = viewRef.current!;
    const pp = toPage(v, p);
    const tol = hitTol() / v.scale;
    const list = propsRef.current.damages;
    // ausgewählte Schadstelle hat Vorrang, sonst oberste (zuletzt gezeichnete)
    const sel = list.find((d) => d.id === propsRef.current.selectedId);
    if (sel && hitShape(sel.shape, pp, tol)) return sel;
    for (let i = list.length - 1; i >= 0; i--) if (hitShape(list[i].shape, pp, tol)) return list[i];
    return null;
  };

  /** Bauteilkennzeichnung unter dem Finger (Kreis mit festem Bildschirmradius) */
  const hitComponent = (p: Point): Component | null => {
    const v = viewRef.current!;
    const r = badgeRadius() + (isCoarse() ? 8 : 3);
    const list = propsRef.current.components;
    for (let i = list.length - 1; i >= 0; i--) {
      const c = toScreen(v, list[i]);
      if (Math.hypot(c.x - p.x, c.y - p.y) <= r) return list[i];
    }
    return null;
  };

  const hitLabel = (p: Point): string | null => {
    for (const [id, r] of labels) if (rectContains(r, p, isCoarse() ? 6 : 2)) return id;
    return null;
  };

  const hitHandle = (p: Point): string | null => {
    const sel = propsRef.current.damages.find((d) => d.id === propsRef.current.selectedId);
    if (!sel) return null;
    const tol = isCoarse() ? 22 : 10;
    // nächstgelegener Anfasser innerhalb der Toleranz
    let best: string | null = null;
    let bestD = Infinity;
    for (const { h, p: hp } of screenHandles(sel.shape, viewRef.current!, !!propsRef.current.vertexEdit && !sel.noVertexEdit, !!sel.noVertexEdit)) {
      const d = Math.max(Math.abs(hp.x - p.x), Math.abs(hp.y - p.y));
      if (d <= tol && d < bestD) {
        bestD = d;
        best = h;
      }
    }
    return best;
  };

  const startPinch = () => {
    const [a, b] = [...pointers.current.values()];
    gesture.current = {
      kind: 'pinch',
      dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      view: viewRef.current!,
    };
    forceRender((n) => n + 1);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!viewRef.current || status !== 'ready') return;
    const p = localPoint(e);
    pointers.current.set(e.pointerId, p);
    containerRef.current!.setPointerCapture(e.pointerId);
    if (pointers.current.size === 2) {
      // Zwei Finger: Zoomen/Verschieben, laufende Aktion verwerfen
      const g = gesture.current;
      if (g.kind === 'move' || g.kind === 'resize') propsRef.current.onShapeChange(g.id, g.orig, false);
      if (g.kind === 'label') {
        const d = propsRef.current.damages.find((x) => x.id === g.id);
        if (d) propsRef.current.onLabelChange(g.id, d.labelOffset ?? { dx: 0, dy: 0 }, false);
      }
      if (g.kind === 'component') propsRef.current.onComponentMove(g.id, g.orig.x, g.orig.y, false);
      startPinch();
      return;
    }
    if (pointers.current.size > 2) {
      gesture.current = { kind: 'ignore' };
      return;
    }
    const v = viewRef.current;
    if (e.pointerType === 'mouse' && e.button !== 0) {
      gesture.current = { kind: 'pan', start: p, view: v, moved: true, tapTarget: null };
      return;
    }
    const currentTool = propsRef.current.tool;
    if (isPointTool(currentTool)) {
      gesture.current = { kind: 'polytap', start: p, view: v, moved: false };
      return;
    }
    if (PLACE_TOOLS.has(currentTool)) {
      gesture.current = { kind: 'place', start: p, view: v, moved: false };
      return;
    }
    if (currentTool === 'select') {
      const comp = hitComponent(p);
      if (comp) {
        gesture.current = { kind: 'component', id: comp.id, start: toPage(v, p), orig: { x: comp.x, y: comp.y }, moved: false };
        return;
      }
      const handle = hitHandle(p);
      if (handle) {
        const sel = propsRef.current.damages.find((d) => d.id === propsRef.current.selectedId)!;
        if (handle.startsWith('v')) {
          gesture.current = { kind: 'vertex', id: sel.id, index: Number(handle.slice(1)), orig: sel.shape, start: p, moved: false };
          return;
        }
        if (handle === 'rot') {
          const c = shapeCenter(sel.shape);
          const pp = toPage(v, p);
          gesture.current = { kind: 'rotate', id: sel.id, orig: sel.shape, startAngle: (Math.atan2(pp.y - c.y, pp.x - c.x) * 180) / Math.PI };
        } else gesture.current = { kind: 'resize', id: sel.id, handle, orig: sel.shape };
        return;
      }
      const labelId = hitLabel(p);
      if (labelId) {
        propsRef.current.onSelect(labelId);
        gesture.current = { kind: 'label', id: labelId, start: p, orig: labels.get(labelId)!, moved: false };
        return;
      }
      const hit = hitDamage(p);
      if (hit && hit.id === propsRef.current.selectedId) {
        const b = shapeAABB(hit.shape);
        gesture.current = { kind: 'move', id: hit.id, start: toPage(v, p), orig: hit.shape, moved: false, ref: { x: b.x, y: b.y } };
        return;
      }
      gesture.current = { kind: 'pan', start: p, view: v, moved: false, tapTarget: hit?.id ?? null };
      return;
    }
    const raw = clampP(toPage(v, p));
    const snap = propsRef.current.snap;
    const pp = clampP(snap && currentTool !== 'freehand' ? snapAt(raw, { tool: currentTool, scale: v.scale }) : raw);
    gesture.current = { kind: 'draw', tool: currentTool as DrawGestureTool, start: pp, current: pp, points: [pp] };
    forceRender((n) => n + 1);
  };

  /** Mauszeiger im Auswahlmodus: Pfeil, nur über Anfassern bzw. verschiebbaren Objekten ein anderer Zeiger */
  const HANDLE_CURSOR: Record<string, string> = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', rot: 'grab' };
  const setCursor = (c: string) => {
    const el = containerRef.current;
    if (el && el.style.cursor !== c) el.style.cursor = c;
  };
  const hoverCursor = (p: Point) => {
    if (propsRef.current.tool !== 'select' || !viewRef.current) return setCursor('');
    const h = hitHandle(p);
    if (h) return setCursor(HANDLE_CURSOR[h.replace(/^v/, '')] ?? 'move');
    if (hitComponent(p) || hitLabel(p)) return setCursor('move');
    const hit = hitDamage(p);
    setCursor(hit && hit.id === propsRef.current.selectedId ? 'move' : hit ? 'pointer' : '');
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) {
      if (e.pointerType === 'mouse') {
        hoverCursor(localPoint(e));
        lastHover.current = localPoint(e);
      }
      // Fangpunkt schon vor dem Klicken anzeigen (Zeichenwerkzeuge)
      const t = propsRef.current.tool;
      if (e.pointerType === 'mouse' && propsRef.current.snap && t !== 'select' && viewRef.current) {
        const before = snapMark.current;
        const last = poly.current[poly.current.length - 1];
        snapAt(clampP(toPage(viewRef.current, localPoint(e))), { tool: t, scale: viewRef.current.scale, from: last });
        if (before?.kind !== snapMark.current?.kind || before?.p.x !== snapMark.current?.p.x || before?.p.y !== snapMark.current?.p.y) forceRender((n) => n + 1);
      }
      // Vorschau der nächsten Kante beim Setzen von Flächenpunkten (mit Fang bzw. 90°, wie der Klick)
      if (isPointTool(propsRef.current.tool) && poly.current.length && viewRef.current) {
        const hp = clampP(toPage(viewRef.current, localPoint(e)));
        const last = poly.current[poly.current.length - 1];
        polyHover.current = e.pointerType === 'mouse' && propsRef.current.snap ? clampP(snapAt(hp, { tool: t, scale: viewRef.current.scale, from: last })) : hp;
        forceRender((n) => n + 1);
      }
      return;
    }
    const p = localPoint(e);
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    const v = viewRef.current;
    if (!v) return;
    switch (g.kind) {
      case 'pinch': {
        if (pointers.current.size < 2) return;
        const [a, b] = [...pointers.current.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const { min, max } = limits();
        const scale = Math.min(max, Math.max(min, g.view.scale * (dist / g.dist)));
        const f = scale / g.view.scale;
        setView({ scale, tx: mid.x - (g.mid.x - g.view.tx) * f, ty: mid.y - (g.mid.y - g.view.ty) * f });
        return;
      }
      case 'pan':
      case 'polytap':
      case 'place': {
        const dx = p.x - g.start.x;
        const dy = p.y - g.start.y;
        if (!g.moved && Math.hypot(dx, dy) < 6) return;
        g.moved = true;
        setCursor('grabbing');
        setView({ ...g.view, tx: g.view.tx + dx, ty: g.view.ty + dy });
        return;
      }
      case 'component': {
        const pp = toPage(v, p);
        const dx = pp.x - g.start.x;
        const dy = pp.y - g.start.y;
        if (!g.moved && Math.hypot(dx, dy) * v.scale < 4) return;
        g.moved = true;
        propsRef.current.onComponentMove(g.id, g.orig.x + dx, g.orig.y + dy, false);
        return;
      }
      case 'draw': {
        const raw = clampP(toPage(v, p));
        const snap = propsRef.current.snap;
        const pp = clampP(snap && g.tool !== 'freehand' ? snapAt(raw, { from: g.start, tool: g.tool, scale: v.scale }) : raw);
        g.current = pp;
        if (g.tool === 'freehand') {
          // Alle Zwischenpunkte übernehmen, damit die Linie genau dem Finger folgt
          const native = e.nativeEvent as PointerEvent;
          const events = native.getCoalescedEvents?.() ?? [];
          const samples = events.length ? events.map((ev) => clampP(toPage(v, localPoint(ev)))) : [raw];
          for (const q of samples) {
            const last = g.points[g.points.length - 1];
            if (Math.hypot(q.x - last.x, q.y - last.y) * v.scale >= 1) g.points.push(q);
          }
        }
        forceRender((n) => n + 1);
        return;
      }
      case 'move': {
        const pp = toPage(v, p);
        const dx = pp.x - g.start.x;
        const dy = pp.y - g.start.y;
        if (!g.moved && Math.hypot(dx, dy) * v.scale < 4) return;
        g.moved = true;
        let mx = dx;
        let my = dy;
        const snap = propsRef.current.snap;
        if (snap) {
          // Bezugsecke einrasten, damit das Objekt am Raster bzw. an anderen Objekten anliegt
          const t = snapAt({ x: g.ref.x + dx, y: g.ref.y + dy }, { scale: v.scale, movingId: g.id });
          mx = t.x - g.ref.x;
          my = t.y - g.ref.y;
        }
        const bounds = propsRef.current.bounds;
        if (bounds) ({ dx: mx, dy: my } = clampDelta(shapeAABB(g.orig), mx, my, bounds));
        propsRef.current.onShapeChange(g.id, { ...g.orig, x: g.orig.x + mx, y: g.orig.y + my }, false);
        return;
      }
      case 'vertex': {
        const raw = clampP(toPage(v, p));
        if (!g.moved && Math.hypot(p.x - g.start.x, p.y - g.start.y) < 4) return;
        g.moved = true;
        const vs = shapeVertices(g.orig);
        const isLine = g.orig.type === 'line';
        const other = isLine ? vs[1 - g.index] : undefined;
        const snap = propsRef.current.snap;
        const pp = clampP(snap ? snapAt(raw, { scale: v.scale, movingId: g.id, from: other, tool: isLine ? 'line' : undefined }) : raw);
        propsRef.current.onShapeChange(g.id, moveVertex(g.orig, g.index, pp), false);
        return;
      }
      case 'resize': {
        const raw = clampP(toPage(v, p));
        const pp = propsRef.current.snap ? snapAt(raw, { scale: v.scale, movingId: g.id }) : raw;
        propsRef.current.onShapeChange(g.id, resizeRotatedShape(g.orig, g.handle, pp, 6 / v.scale), false);
        return;
      }
      case 'rotate': {
        const pp = toPage(v, p);
        const c = shapeCenter(g.orig);
        const angle = (Math.atan2(pp.y - c.y, pp.x - c.x) * 180) / Math.PI;
        const rotation = normalizeRotation((g.orig.rotation ?? 0) + angle - g.startAngle);
        propsRef.current.onShapeChange(g.id, { ...g.orig, rotation }, false);
        return;
      }
      case 'label': {
        const dx = p.x - g.start.x;
        const dy = p.y - g.start.y;
        if (!g.moved && Math.hypot(dx, dy) < 4) return;
        g.moved = true;
        const d = propsRef.current.damages.find((x) => x.id === g.id);
        if (!d) return;
        propsRef.current.onLabelChange(g.id, labelOffsetFor(d, { ...g.orig, x: g.orig.x + dx, y: g.orig.y + dy }, v), false);
        return;
      }
    }
  };

  const finish = (e: React.PointerEvent, cancelled: boolean) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    const v = viewRef.current;
    if (g.kind === 'pinch') {
      // Nach dem Pinch erst wieder reagieren, wenn alle Finger losgelassen sind
      gesture.current = pointers.current.size ? { kind: 'ignore' } : { kind: 'none' };
      return;
    }
    if (pointers.current.size) return;
    gesture.current = { kind: 'none' };
    setCursor('');
    if (e.pointerType !== 'mouse') snapMark.current = null;
    if (!v) return;
    const p = localPoint(e);
    switch (g.kind) {
      case 'pan':
        if (!g.moved && !cancelled) {
          const now = Date.now();
          const lt = lastTap.current;
          if (!g.tapTarget && lt && now - lt.t < 320 && Math.hypot(lt.p.x - p.x, lt.p.y - p.y) < 30) {
            // Doppeltipp: hineinzoomen
            const { min, max } = limits();
            setView(zoomAt(v, p, 2, min, max));
            lastTap.current = null;
          } else {
            lastTap.current = { t: now, p };
            propsRef.current.onSelect(g.tapTarget);
          }
        }
        return;
      case 'place':
        if (!g.moved && !cancelled) {
          const raw = clampP(toPage(v, p));
          const snap = propsRef.current.snap;
          propsRef.current.onPlace(clampP(snap ? snapAt(raw, { tool: propsRef.current.tool, scale: v.scale }) : raw));
        }
        return;
      case 'component': {
        if (!g.moved) {
          propsRef.current.onSelectComponent(g.id);
          return;
        }
        const c = propsRef.current.components.find((x) => x.id === g.id);
        if (c) {
          if (cancelled) propsRef.current.onComponentMove(g.id, g.orig.x, g.orig.y, true);
          else propsRef.current.onComponentMove(g.id, c.x, c.y, true);
        }
        return;
      }
      case 'draw': {
        forceRender((n) => n + 1);
        if (cancelled) return;
        const shape = shapeFromDraw(g, v);
        if (shape) propsRef.current.onCreate(shape);
        return;
      }
      case 'move': {
        if (!g.moved) {
          const now = Date.now();
          const lt = lastTap.current;
          // Doppelklick auf eine Kante des ausgewählten Objekts: Eckpunkt einfügen
          if (!cancelled && propsRef.current.vertexEdit && lt?.moveId === g.id && now - lt.t < 320 && Math.hypot(lt.p.x - p.x, lt.p.y - p.y) < 30) {
            lastTap.current = null;
            if (canEditVertexCount(g.orig) && !propsRef.current.damages.find((x) => x.id === g.id)?.noVertexEdit) {
              const near = nearestEdge(g.orig, toPage(v, p));
              if (near && near.dist * v.scale <= (isCoarse() ? 22 : 12)) {
                propsRef.current.onShapeChange(g.id, insertVertex(g.orig, near.edge, near.point), true);
                propsRef.current.onVertexSelect?.(near.edge + 1);
              }
            }
            return;
          }
          lastTap.current = { t: now, p, moveId: g.id };
          return;
        }
        const d = propsRef.current.damages.find((x) => x.id === g.id);
        if (d) propsRef.current.onShapeChange(g.id, cancelled ? g.orig : d.shape, true);
        return;
      }
      case 'polytap': {
        if (g.moved || cancelled) return;
        const raw = clampP(toPage(v, p));
        const snap = propsRef.current.snap;
        const pts = poly.current;
        const pp = clampP(snap ? snapAt(raw, { scale: v.scale, tool: propsRef.current.tool, from: pts[pts.length - 1] }) : raw);
        const first = pts[0];
        const now = Date.now();
        const lt = lastTap.current;
        const dbl = !lupe.current && lt && now - lt.t < 320 && Math.hypot(lt.p.x - p.x, lt.p.y - p.y) < 30;
        lastTap.current = lupe.current ? null : { t: now, p };
        // Fang-Lupe: Punkt übernommen → vorherige Ansicht (Zeichnen geht weiter)
        endLupe();
        // Tippen auf den ersten Punkt schließt die Form; Doppeltippen beendet sie
        // (Polygon: geschlossen, Polylinie: offen)
        // (auch im 90°-Modus: maßgeblich ist der angetippte Punkt)
        const nearFirst = (q: Point) => Math.hypot((first.x - q.x) * v.scale, (first.y - q.y) * v.scale) < (isCoarse() ? 22 : 12);
        const onFirst = pts.length >= 3 && (nearFirst(pp) || nearFirst(raw));
        if (onFirst) {
          finishPolygon(true);
          return;
        }
        if (dbl) {
          finishPolygon();
          return;
        }
        poly.current = [...pts, pp];
        if (propsRef.current.tool === 'arc' && poly.current.length === 3) {
          // Bogen: Anfangspunkt, Punkt auf dem Bogen, Endpunkt
          const [p1, p2, p3] = poly.current;
          poly.current = [];
          polyHover.current = null;
          propsRef.current.onPolygonChange?.(0);
          forceRender((n) => n + 1);
          const arc = arcShape(p1, p2, p3);
          if (arc) propsRef.current.onCreate(arc);
          return;
        }
        propsRef.current.onPolygonChange?.(poly.current.length);
        forceRender((n) => n + 1);
        return;
      }
      case 'vertex': {
        // Eckpunkt angetippt oder verschoben: ausgewählt (z. B. zum Entfernen)
        propsRef.current.onVertexSelect?.(cancelled && !g.moved ? null : g.index);
        if (!g.moved) return;
        const d = propsRef.current.damages.find((x) => x.id === g.id);
        if (d) propsRef.current.onShapeChange(g.id, cancelled ? g.orig : d.shape, true);
        return;
      }
      case 'resize':
      case 'rotate': {
        const d = propsRef.current.damages.find((x) => x.id === g.id);
        if (d) propsRef.current.onShapeChange(g.id, cancelled ? g.orig : d.shape, true);
        return;
      }
      case 'label': {
        const d = propsRef.current.damages.find((x) => x.id === g.id);
        if (g.moved && d?.labelOffset) propsRef.current.onLabelChange(g.id, d.labelOffset, true);
        return;
      }
    }
  };

  /**
   * Gesetzte Punkte übernehmen: geschlossen als Fläche (mindestens 3 Punkte) oder offen als
   * Polylinie (mindestens 2 Punkte). Zu wenige Punkte: weitersetzen.
   */
  function finishPolygon(closed?: boolean) {
    const pts = poly.current;
    const close = closed ?? propsRef.current.tool !== 'polyline';
    if (pts.length < (close ? 3 : 2)) return;
    poly.current = [];
    polyHover.current = null;
    propsRef.current.onPolygonChange?.(0);
    forceRender((n) => n + 1);
    propsRef.current.onCreate(polygonShape(pts, close));
  }

  // Mausrad / Trackpad
  useEffect(() => {
    const el = containerRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      if (!v) return;
      const r = el.getBoundingClientRect();
      const p = { x: e.clientX - r.left, y: e.clientY - r.top };
      const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
      const k = e.ctrlKey ? 0.01 : 0.0018;
      const factor = Math.exp(-e.deltaY * unit * k);
      const { min, max } = limits();
      setView(zoomAt(v, p, factor, min, max));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    // Safari: eigene Pinch-Gesten der Seite unterbinden
    const prevent = (e: Event) => e.preventDefault();
    el.addEventListener('gesturestart', prevent);
    el.addEventListener('gesturechange', prevent);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', prevent);
      el.removeEventListener('gesturechange', prevent);
    };
  }, [limits, setView]);

  // ---------------------------------------------------------------------------
  // Darstellung

  const g = gesture.current;
  const drawPreview = g.kind === 'draw' && view ? shapeFromDraw(g, view, true) : null;
  const selected = damages.find((d) => d.id === selectedId) ?? null;

  const strokeW = isCoarse() ? 2.5 : 2;
  const renderShape = (shape: Shape, col: string, opts: { selected?: boolean; dashed?: boolean; key?: string; id?: string; style?: ShapeStyle }) => {
    if (!view) return null;
    const st = opts.style;
    const toS = (p: Point) => toScreen(view, p);
    const base = st?.lineWidth ? Math.max(1, st.lineWidth * PX_PER_PT) : strokeW;
    const w = opts.selected ? base + 1.5 : base;
    // Umrandung (Linientyp) und Füllung getrennt; die Füllung folgt immer der eigentlichen Form
    const line = strokeGeometry(shape, toS, opts.dashed ? 'dashed' : st?.lineType, w);
    const fill = fillOf(shape, col, st, DEFAULT_TRANSPARENCY.damage);
    return (
      <g key={opts.key}>
        {fill && <FillPaths shape={shape} map={toS} fill={fill} boost={opts.selected && st?.fillTransparency === undefined && !fill.hatch} />}
        {/* Kontur für gute Sichtbarkeit auf hellen und dunklen Planbereichen */}
        <path
          d={line.d}
          fill="none"
          stroke={haloColor(col)}
          strokeOpacity={0.75}
          strokeWidth={w + 2.5}
          strokeDasharray={line.dash?.join(' ')}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <path
          d={line.d}
          fill="none"
          stroke={col}
          strokeWidth={w}
          strokeDasharray={line.dash?.join(' ')}
          strokeLinejoin="round"
          strokeLinecap="round"
          data-damage={opts.id}
          data-line-type={st?.lineType ?? 'solid'}
        />
      </g>
    );
  };

  return (
    <div
      ref={containerRef}
      className={`viewer tool-${tool}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => finish(e, false)}
      onPointerCancel={(e) => finish(e, true)}
      onContextMenu={(e) => e.preventDefault()}
      data-testid="plan-viewer"
      data-scale={view?.scale}
    >
      <div
        ref={worldRef}
        className={`viewer-world${fileId ? '' : ' no-file'}${props.plan.planColor ? '' : ' plan-gray'}`}
        style={view ? { transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})` } : { visibility: 'hidden' }}
      >
        <canvas
          ref={baseCanvasRef}
          className="viewer-canvas"
          style={{ left: region.x, top: region.y, width: region.w, height: region.h }}
        />
        <canvas
          ref={detailCanvasRef}
          className="viewer-canvas"
          style={
            detailRect
              ? { left: detailRect.x, top: detailRect.y, width: detailRect.w, height: detailRect.h }
              : { display: 'none' }
          }
        />
      </div>
      {view && size && (
        <svg className="viewer-overlay" width={size.w} height={size.h}>
          {props.underlay?.(view, size)}
          {damages.map((d) => {
            const custom = props.renderItem?.(d, view, d.id === selectedId);
            return custom !== undefined ? <g key={d.id}>{custom}</g> : renderShape(d.shape, d.color, { selected: d.id === selectedId, key: d.id, id: d.id, style: d.style });
          })}
          {pending && renderShape(pending.shape, pending.color, { dashed: true, key: 'pending' })}
          {drawPreview && renderShape(drawPreview, color, { dashed: true, key: 'draw' })}
          {tool === 'arc' && poly.current.length === 2 && polyHover.current && (() => {
            const a = arcShape(poly.current[0], poly.current[1], polyHover.current);
            return a ? renderShape(a, color, { dashed: true, key: 'arc-preview' }) : null;
          })()}
          {isPointTool(tool) && poly.current.length > 0 && (
            <g className="poly-preview" data-testid="polygon-preview">
              <polyline
                points={[...poly.current, ...(polyHover.current ? [polyHover.current] : [])].map((q) => { const s2 = toScreen(view, q); return `${s2.x},${s2.y}`; }).join(' ')}
                fill="none"
                stroke={visibleStroke(color)}
                strokeWidth={2}
                strokeDasharray="6 4"
              />
              {poly.current.map((q, i) => {
                const s2 = toScreen(view, q);
                return <circle key={i} cx={s2.x} cy={s2.y} r={i === 0 ? 7 : 4} className={i === 0 ? 'poly-first' : 'poly-point'} />;
              })}
            </g>
          )}
          {lupe.current && props.snapPoints && <LupePoints view={view} points={lupePoints(view)} active={snapMark.current?.p ?? null} />}
          {snapMark.current && props.snap && (tool !== 'select' || g.kind === 'vertex' || g.kind === 'move' || g.kind === 'resize') && <SnapMarker view={view} mark={snapMark.current} />}
          {props.overlay?.(view, drawPreview)}
          {/* Verbindungslinien zuerst, damit sie unter den Nummern liegen */}
          {damages.map((d) => {
            const r = labels.get(d.id);
            if (!r) return null;
            const screenShape = { ...d.shape, ...toScreen(view, d.shape), w: d.shape.w * view.scale, h: d.shape.h * view.scale };
            const line = leaderLine(screenShape, r, 5);
            return line ? (
              <line
                key={`ll-${d.id}`}
                className="leader"
                x1={line.from.x}
                y1={line.from.y}
                x2={line.to.x}
                y2={line.to.y}
                stroke={d.color}
                strokeWidth={1.4}
              />
            ) : null;
          })}
          {damages.map((d) => {
            const r = labels.get(d.id);
            if (!r) return null;
            const sel = d.id === selectedId;
            return (
              <g key={`l-${d.id}`} className={`damage-label${sel ? ' selected' : ''}`} data-label={noOf(d)}>
                <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={3} fill="#fff" fillOpacity={0.95} stroke={visibleStroke(d.color)} strokeWidth={sel ? 2.4 : 1.4} />
                <text x={r.x + r.w / 2} y={r.y + r.h / 2} fontSize={labelFont} textAnchor="middle" dominantBaseline="central">
                  {noOf(d)}
                </text>
              </g>
            );
          })}
          {components.map((c) => {
            const p = toScreen(view, c);
            const r = badgeRadius();
            const sel = c.id === selectedComponentId;
            return (
              <g key={`c-${c.id}`} className={`component-badge${sel ? ' selected' : ''}`} data-component={c.letter}>
                <title>{c.name ? `${c.letter} – ${c.name}` : c.letter}</title>
                {sel && <circle cx={p.x} cy={p.y} r={r + 5} className="component-ring" />}
                <circle cx={p.x} cy={p.y} r={r} fill={c.color.toLowerCase() === '#ffffff' ? '#1c1c1e' : '#fff'} stroke={visibleStroke(c.color)} strokeWidth={sel ? 3.5 : 2.5} />
                <text x={p.x} y={p.y} textAnchor="middle" dominantBaseline="central" fill={c.color.toLowerCase() === '#ffffff' ? '#fff' : visibleStroke(c.color)} fontSize={r * (c.letter.length > 1 ? 0.8 : 1.05)}>
                  {c.letter}
                </text>
              </g>
            );
          })}
          {selected && tool === 'select' && (
            <g className="handles">
              {selected.shape.type !== 'line' && (() => {
                const b = shapeBounds(selected.shape);
                const c = shapeCenter(b);
                const rot = selected.shape.rotation ?? 0;
                const corners = [
                  { x: b.x, y: b.y },
                  { x: b.x + b.w, y: b.y },
                  { x: b.x + b.w, y: b.y + b.h },
                  { x: b.x, y: b.y + b.h },
                ].map((q) => toScreen(view, rotatePoint(q, c, rot)));
                const hs = screenHandles(selected.shape, view);
                const rh = hs.find((x) => x.h === 'rot')!;
                const topMid = toScreen(view, rotatePoint({ x: c.x, y: b.y }, c, rot));
                return (
                  <>
                    <polygon points={corners.map((q) => `${q.x},${q.y}`).join(' ')} className="sel-box" />
                    <line x1={topMid.x} y1={topMid.y} x2={rh.p.x} y2={rh.p.y} className="rot-line" />
                  </>
                );
              })()}
              {screenHandles(selected.shape, view, !!props.vertexEdit && !selected.noVertexEdit, !!selected.noVertexEdit).map(({ h, p }) => {
                const s = isCoarse() ? 14 : 10;
                if (h.startsWith('v')) {
                  const active = props.selectedVertex === Number(h.slice(1));
                  return <circle key={h} cx={p.x} cy={p.y} r={s * (active ? 0.75 : 0.55)} className={`vertex-handle${active ? ' active' : ''}`} data-testid={`vertex-${h.slice(1)}`} />;
                }
                if (h === 'rot')
                  return (
                    <g key={h} className="rot-handle" data-testid="rotate-handle">
                      <circle cx={p.x} cy={p.y} r={s * 0.9} />
                      <path
                        d={`M${p.x - s * 0.4} ${p.y - s * 0.1} a ${s * 0.42} ${s * 0.42} 0 1 1 ${s * 0.15} ${s * 0.45}`}
                        fill="none"
                        strokeWidth={1.6}
                      />
                    </g>
                  );
                return <rect key={h} x={p.x - s / 2} y={p.y - s / 2} width={s} height={s} className="handle" />;
              })}
            </g>
          )}
        </svg>
      )}
      {status === 'loading' && <div className="viewer-msg">Plan wird geladen …</div>}
      {status === 'error' && <div className="viewer-msg error">Plan konnte nicht angezeigt werden: {errorMsg}</div>}
    </div>
  );
});

/** Füllung am Bildschirm: Vollton bzw. Schraffur (gleiche Berechnung wie im PDF) */
export function FillPaths({ shape, map, fill, boost = false }: { shape: Shape; map: (p: Point) => Point; fill: Fill; boost?: boolean }) {
  const f = fillPaths(shape, map, fill, PX_PER_PT);
  if (f.solid) return <path d={f.solid} fill={fill.color} fillOpacity={boost ? Math.min(1, fill.opacity + 0.08) : fill.opacity} stroke="none" data-fill="solid" />;
  return (
    <path d={f.hatch} fill="none" stroke={fill.color} strokeOpacity={fill.opacity} strokeWidth={f.hatchWidth} strokeLinecap="round" data-fill="hatch" />
  );
}

/**
 * Fangpunkte in der Fang-Lupe (Ampel): rot mit weißer Füllung = möglicher Punkt, grün = unter
 * dem Mauszeiger (wird beim Klick übernommen). Nur Anzeige – ändert keine Objektfarben.
 */
function LupePoints({ view, points, active }: { view: View; points: SnapHit[]; active: Point | null }) {
  return (
    <g className="lupe-points" data-testid="lupe-points" pointerEvents="none">
      {points.map((h, i) => {
        const c = toScreen(view, h.point);
        const on = !!active && Math.abs(active.x - h.point.x) < 1e-6 && Math.abs(active.y - h.point.y) < 1e-6;
        return <circle key={i} cx={c.x} cy={c.y} r={on ? 8 : 6} className={`lupe-pt${on ? ' active' : ''}`} data-kind={h.kind} data-testid={on ? 'lupe-pt-active' : 'lupe-pt'} />;
      })}
    </g>
  );
}

/** Fangpunkt: Form je Art (wie in CAD-Programmen) mit kurzer Beschriftung */
function SnapMarker({ view, mark }: { view: View; mark: { p: Point; kind: SnapKind } }) {
  const c = toScreen(view, mark.p);
  const r = 6;
  const shape =
    mark.kind === 'end' ? (
      <rect x={c.x - r} y={c.y - r} width={2 * r} height={2 * r} />
    ) : mark.kind === 'mid' ? (
      <path d={`M${c.x} ${c.y - r}L${c.x + r} ${c.y + r * 0.8}L${c.x - r} ${c.y + r * 0.8}Z`} />
    ) : mark.kind === 'intersection' ? (
      <path d={`M${c.x - r} ${c.y - r}L${c.x + r} ${c.y + r}M${c.x + r} ${c.y - r}L${c.x - r} ${c.y + r}`} />
    ) : mark.kind === 'center' ? (
      <circle cx={c.x} cy={c.y} r={r} />
    ) : mark.kind === 'nearest' ? (
      <path d={`M${c.x - r} ${c.y - r}H${c.x + r}L${c.x - r} ${c.y + r}H${c.x + r}Z`} />
    ) : (
      <path d={`M${c.x - r} ${c.y}H${c.x + r}M${c.x} ${c.y - r}V${c.y + r}`} />
    );
  return (
    <g className="snap-marker" data-testid="snap-marker" data-kind={mark.kind} pointerEvents="none">
      {shape}
      <text x={c.x + r + 4} y={c.y - r - 2}>
        {SNAP_LABELS[mark.kind]}
      </text>
    </g>
  );
}

/**
 * Anfasser in Bildschirmkoordinaten (mit Drehung der Form). Bei kleinen Markierungen nur
 * die vier Ecken, leicht nach außen versetzt, damit die Form selbst sichtbar und
 * verschiebbar bleibt. Dazu der Dreh-Anfasser „rot“ über der Oberkante.
 */
function screenHandles(shape: Shape, v: View, vertexEdit = false, fixedShape = false): { h: string; p: Point }[] {
  // Linie: nur die beiden Endpunkte (eigenständiges 2D-Objekt, kein schmales Rechteck)
  if (shape.type === 'line') return shapeVertices(shape).map((p, i) => ({ h: `v${i}`, p: toScreen(v, p) }));
  const verts = vertexEdit && hasEditableVertices(shape) ? shapeVertices(shape).map((p, i) => ({ h: `v${i}`, p: toScreen(v, p) })) : null;
  const b = shapeBounds(shape);
  const c = shapeCenter(b);
  const rot = shape.rotation ?? 0;
  const small = Math.min(b.w, b.h) * v.scale < 64;
  // Mit Eckpunkten: Ecken über die Punkte, Größe über die Seitenmitten (nicht bei Vielecken)
  // Form mit fester Geometrie (z. B. Bogen): nur Drehen, keine Größenänderung (würde sie verzerren)
  const list = fixedShape ? [] : verts ? (shape.type === 'freehand' ? [] : HANDLES.filter((h) => h.length === 1)) : small ? HANDLES.filter((h) => h.length === 2) : HANDLES;
  const off = (small ? 8 : 0) / v.scale;
  const out = list.map((h) => {
    const q = handlePosition(b, h);
    const local = {
      x: q.x + (h.includes('w') ? -off : h.includes('e') ? off : 0),
      y: q.y + (h.includes('n') ? -off : h.includes('s') ? off : 0),
    };
    return { h: h as string, p: toScreen(v, rotatePoint(local, c, rot)) };
  });
  const rotDist = (isCoarse() ? 40 : 30) / v.scale;
  out.push({ h: 'rot', p: toScreen(v, rotatePoint({ x: c.x, y: b.y - off - rotDist }, c, rot)) });
  return verts ? [...verts, ...out] : out;
}

/** Berechnet die gespeicherte Beschriftungsverschiebung (Seiteneinheiten) aus einer Bildschirmposition. */
function labelOffsetFor(d: ViewerItem, r: Rect, v: View) {
  const b = shapeAABB(d.shape);
  const tr = toScreen(v, { x: b.x + b.w, y: b.y });
  return { dx: (r.x - tr.x) / v.scale, dy: (r.y + r.h - tr.y) / v.scale };
}

function shapeFromDraw(g: Extract<Gesture, { kind: 'draw' }>, v: View, preview = false): Shape | null {
  const r = normalizeRect(g.start, g.current);
  const tiny = Math.max(r.w, r.h) * v.scale < 8;
  if (tiny) {
    // Kalibrieren, Fenster und Vektor brauchen eine echte Strecke
    if (preview || g.tool === 'calibrate' || g.tool === 'window' || g.tool === 'vector') return null;
    // Antippen: Markierung in Standardgröße anlegen
    const s = 36 / v.scale;
    const base = { x: g.start.x - s / 2, y: g.start.y - s / 2, w: s, h: s };
    if (g.tool === 'line' || g.tool === 'dimension') return lineShape({ x: g.start.x - s / 2, y: g.start.y }, { x: g.start.x + s / 2, y: g.start.y });
    if (g.tool === 'triangle') return triangleShape(base);
    if (g.tool === 'freehand') {
      const pts = Array.from({ length: 10 }, (_, i) => {
        const a = (i / 10) * Math.PI * 2;
        return [0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)] as [number, number];
      });
      return { type: 'freehand', ...base, points: pts };
    }
    return { type: g.tool as ShapeType, ...base };
  }
  if (g.tool === 'freehand') {
    if (preview) {
      const pts = g.points;
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      const w = Math.max(...xs) - x || 1e-6;
      const h = Math.max(...ys) - y || 1e-6;
      return { type: 'freehand', x, y, w, h, closed: false, points: pts.map((p) => [(p.x - x) / w, (p.y - y) / h]) };
    }
    // Genau wie gezeichnet; nahe am Startpunkt beendet → geschlossene Fläche
    const closeDist = Math.max(18 / v.scale, 0.08 * Math.hypot(r.w, r.h));
    return freehandShape(g.points, 0.5 / v.scale, closeDist) ?? { type: 'ellipse', ...r };
  }
  if (g.tool === 'line' || g.tool === 'dimension' || g.tool === 'calibrate' || g.tool === 'vector') return lineShape(g.start, g.current);
  if (g.tool === 'window') return { type: 'rect', ...r };
  if (g.tool === 'triangle') return triangleShape(r);
  return { type: g.tool, ...r };
}

/** Bildschirmradius der Bauteilkennzeichnung */
const badgeRadius = () => (isCoarse() ? 15 : 13);
