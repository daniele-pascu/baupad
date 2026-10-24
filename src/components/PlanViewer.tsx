import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  pathToSvg,
  rectContains,
  isOpenShape,
  lineShape,
  triangleShape,
  normalizeRotation,
  resizeRotatedShape,
  rotatePoint,
  shapeAABB,
  shapeBounds,
  shapeCenter,
  shapePath,
  toPage,
  toScreen,
  zoomAt,
  type Point,
  type View,
} from '../lib/geometry';
import { clampRenderScale, getImageBitmap, getPdfDocument, renderPdfRegion, type RenderJob } from '../lib/pdf';
import { getView, putView } from '../lib/db';
import type { Component, Damage, Plan, Rect, Shape, ShapeType, SourceFile } from '../lib/types';

/** Werkzeuge: Auswahl, Formen und Bauteilbuchstabe setzen */
export type Tool = 'select' | ShapeType | 'component';

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
}

interface Props {
  plan: Plan;
  file: SourceFile;
  damages: Damage[];
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
  /** Werkzeug „Bauteil“: Stelle im Plan angetippt */
  onPlaceComponent(p: Point): void;
}

type Gesture =
  | { kind: 'none' }
  | { kind: 'pan'; start: Point; view: View; moved: boolean; tapTarget: string | null }
  | { kind: 'pinch'; dist: number; mid: Point; view: View }
  | { kind: 'draw'; tool: ShapeType; start: Point; current: Point; points: Point[] }
  | { kind: 'move'; id: string; start: Point; orig: Shape; moved: boolean }
  | { kind: 'resize'; id: string; handle: string; orig: Shape }
  | { kind: 'rotate'; id: string; orig: Shape; startAngle: number }
  | { kind: 'label'; id: string; start: Point; orig: Rect; moved: boolean }
  | { kind: 'component'; id: string; start: Point; orig: Point; moved: boolean }
  | { kind: 'place'; start: Point; view: View; moved: boolean }
  | { kind: 'ignore' };

const isCoarse = () => matchMedia('(pointer: coarse)').matches;

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
  const region: Rect = useMemo(
    () => plan.crop ?? { x: 0, y: 0, w: plan.pageWidth, h: plan.pageHeight },
    [plan.crop, plan.pageWidth, plan.pageHeight],
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
  const lastTap = useRef<{ t: number; p: Point } | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

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
  useEffect(() => {
    let cancelled = false;
    let job: RenderJob | null = null;
    setStatus('loading');
    (async () => {
      const canvas = baseCanvasRef.current!;
      const maxSide = isCoarse() ? 3072 : 4096;
      const k = clampRenderScale(region.w, region.h, maxSide / Math.max(region.w, region.h));
      if (file.kind === 'pdf') {
        const doc = await getPdfDocument(file.id);
        const page = await doc.getPage(plan.pageIndex + 1);
        if (cancelled) return;
        source.current = { page };
        baseScale.current = k;
        job = renderPdfRegion(page, canvas, region, k);
        await job.promise;
      } else {
        const bitmap = await getImageBitmap(file.id, file.mimeType);
        if (cancelled) return;
        source.current = { bitmap };
        const s = Math.min(1, k);
        baseScale.current = s;
        canvas.width = Math.max(1, Math.round(region.w * s));
        canvas.height = Math.max(1, Math.round(region.h * s));
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bitmap, region.x, region.y, region.w, region.h, 0, 0, canvas.width, canvas.height);
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
  }, [file.id, file.kind, file.mimeType, plan.pageIndex, region]);

  // Detailebene nachrendern, wenn stark hineingezoomt ist
  useEffect(() => {
    if (status !== 'ready' || !view || !size) return;
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
        job = renderPdfRegion(src.page, canvas, r, s);
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
        canvas.getContext('2d')!.drawImage(src.bitmap, r.x, r.y, r.w, r.h, 0, 0, canvas.width, canvas.height);
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
  }, [view, size, status, region]);

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
        w: (String(d.number).length * labelFont * 0.62 + labelFont * 0.8) * k,
        h: labelFont * 1.5 * k,
        offset: d.labelOffset,
      })),
      3 / qScale,
      { area: region },
    );
  }, [damages, qScale, labelFont, region]);
  const labels = useMemo(() => {
    const out = new Map<string, Rect>();
    if (!view) return out;
    const h = labelFont * 1.5;
    for (const d of damages) {
      const r = labelLayout.get(d.id);
      if (!r) continue;
      const w = String(d.number).length * labelFont * 0.62 + labelFont * 0.8;
      const c = toScreen(view, { x: r.x + r.w / 2, y: r.y + r.h / 2 });
      out.set(d.id, { x: c.x - w / 2, y: c.y - h / 2, w, h });
    }
    return out;
  }, [labelLayout, damages, view, labelFont]);

  // ---------------------------------------------------------------------------
  // Zeigerereignisse

  const localPoint = (e: { clientX: number; clientY: number }): Point => {
    const r = containerRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const hitTol = () => (isCoarse() ? 14 : 7);

  const hitDamage = (p: Point): Damage | null => {
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
    for (const { h, p: hp } of screenHandles(sel.shape, viewRef.current!)) {
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
    if (currentTool === 'component') {
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
        gesture.current = { kind: 'move', id: hit.id, start: toPage(v, p), orig: hit.shape, moved: false };
        return;
      }
      gesture.current = { kind: 'pan', start: p, view: v, moved: false, tapTarget: hit?.id ?? null };
      return;
    }
    const pp = toPage(v, p);
    gesture.current = { kind: 'draw', tool: currentTool, start: pp, current: pp, points: [pp] };
    forceRender((n) => n + 1);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
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
      case 'place': {
        const dx = p.x - g.start.x;
        const dy = p.y - g.start.y;
        if (!g.moved && Math.hypot(dx, dy) < 6) return;
        g.moved = true;
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
        const pp = toPage(v, p);
        g.current = pp;
        if (g.tool === 'freehand') {
          // Alle Zwischenpunkte übernehmen, damit die Linie genau dem Finger folgt
          const native = e.nativeEvent as PointerEvent;
          const events = native.getCoalescedEvents?.() ?? [];
          const samples = events.length ? events.map((ev) => toPage(v, localPoint(ev))) : [pp];
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
        propsRef.current.onShapeChange(g.id, { ...g.orig, x: g.orig.x + dx, y: g.orig.y + dy }, false);
        return;
      }
      case 'resize': {
        const pp = toPage(v, p);
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
        if (!g.moved && !cancelled) propsRef.current.onPlaceComponent(toPage(v, p));
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
          lastTap.current = { t: Date.now(), p };
          return;
        }
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
  const renderShape = (shape: Shape, col: string, opts: { selected?: boolean; dashed?: boolean; key?: string; id?: string }) => {
    if (!view) return null;
    const d = pathToSvg(shapePath(shape), (p) => toScreen(view, p));
    const w = opts.selected ? strokeW + 1.5 : strokeW;
    return (
      <g key={opts.key}>
        {/* Kontur für gute Sichtbarkeit auf hellen und dunklen Planbereichen */}
        <path d={d} fill="none" stroke={haloColor(col)} strokeOpacity={0.75} strokeWidth={w + 2.5} strokeLinejoin="round" strokeLinecap="round" />
        <path
          d={d}
          fill={isOpenShape(shape) ? 'none' : col}
          fillOpacity={opts.selected ? 0.2 : 0.12}
          stroke={col}
          strokeWidth={w}
          strokeDasharray={opts.dashed ? '6 4' : undefined}
          strokeLinejoin="round"
          strokeLinecap="round"
          data-damage={opts.id}
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
        className="viewer-world"
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
          {damages.map((d) => renderShape(d.shape, d.color, { selected: d.id === selectedId, key: d.id, id: d.id }))}
          {pending && renderShape(pending.shape, pending.color, { dashed: true, key: 'pending' })}
          {drawPreview && renderShape(drawPreview, color, { dashed: true, key: 'draw' })}
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
              <g key={`l-${d.id}`} className={`damage-label${sel ? ' selected' : ''}`} data-label={d.number}>
                <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={3} fill="#fff" fillOpacity={0.95} stroke={visibleStroke(d.color)} strokeWidth={sel ? 2.4 : 1.4} />
                <text x={r.x + r.w / 2} y={r.y + r.h / 2} fontSize={labelFont} textAnchor="middle" dominantBaseline="central">
                  {d.number}
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
              {(() => {
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
              {screenHandles(selected.shape, view).map(({ h, p }) => {
                const s = isCoarse() ? 14 : 10;
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

/**
 * Anfasser in Bildschirmkoordinaten (mit Drehung der Form). Bei kleinen Markierungen nur
 * die vier Ecken, leicht nach außen versetzt, damit die Form selbst sichtbar und
 * verschiebbar bleibt. Dazu der Dreh-Anfasser „rot“ über der Oberkante.
 */
function screenHandles(shape: Shape, v: View): { h: string; p: Point }[] {
  const b = shapeBounds(shape);
  const c = shapeCenter(b);
  const rot = shape.rotation ?? 0;
  const small = Math.min(b.w, b.h) * v.scale < 64;
  const list = small ? HANDLES.filter((h) => h.length === 2) : HANDLES;
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
  return out;
}

/** Berechnet die gespeicherte Beschriftungsverschiebung (Seiteneinheiten) aus einer Bildschirmposition. */
function labelOffsetFor(d: Damage, r: Rect, v: View) {
  const b = shapeAABB(d.shape);
  const tr = toScreen(v, { x: b.x + b.w, y: b.y });
  return { dx: (r.x - tr.x) / v.scale, dy: (r.y + r.h - tr.y) / v.scale };
}

function shapeFromDraw(g: Extract<Gesture, { kind: 'draw' }>, v: View, preview = false): Shape | null {
  const r = normalizeRect(g.start, g.current);
  const tiny = Math.max(r.w, r.h) * v.scale < 8;
  if (tiny) {
    if (preview) return null;
    // Antippen: Markierung in Standardgröße anlegen
    const s = 36 / v.scale;
    const base = { x: g.start.x - s / 2, y: g.start.y - s / 2, w: s, h: s };
    if (g.tool === 'line') return lineShape({ x: g.start.x - s / 2, y: g.start.y }, { x: g.start.x + s / 2, y: g.start.y });
    if (g.tool === 'triangle') return triangleShape(base);
    if (g.tool === 'freehand') {
      const pts = Array.from({ length: 10 }, (_, i) => {
        const a = (i / 10) * Math.PI * 2;
        return [0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)] as [number, number];
      });
      return { type: 'freehand', ...base, points: pts };
    }
    return { type: g.tool, ...base };
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
  if (g.tool === 'line') return lineShape(g.start, g.current);
  if (g.tool === 'triangle') return triangleShape(r);
  return { type: g.tool, ...r };
}

/** Bildschirmradius der Bauteilkennzeichnung */
const badgeRadius = () => (isCoarse() ? 15 : 13);
