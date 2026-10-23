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
  resizeShape,
  shapeBounds,
  shapePath,
  toPage,
  toScreen,
  zoomAt,
  type Point,
  type View,
} from '../lib/geometry';
import { clampRenderScale, getImageBitmap, getPdfDocument, renderPdfRegion, type RenderJob } from '../lib/pdf';
import { getView, putView } from '../lib/db';
import type { Damage, Plan, Rect, Shape, ShapeType, SourceFile } from '../lib/types';

export type Tool = 'select' | ShapeType;

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
}

type Gesture =
  | { kind: 'none' }
  | { kind: 'pan'; start: Point; view: View; moved: boolean; tapTarget: string | null }
  | { kind: 'pinch'; dist: number; mid: Point; view: View }
  | { kind: 'draw'; tool: ShapeType; start: Point; current: Point; points: Point[] }
  | { kind: 'move'; id: string; start: Point; orig: Shape; moved: boolean }
  | { kind: 'resize'; id: string; handle: string; orig: Shape }
  | { kind: 'label'; id: string; start: Point; orig: Rect; moved: boolean }
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
  const { plan, file, damages, selectedId, tool, color, pending } = props;
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
      const b = shapeBounds(d.shape);
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
        bounds: shapeBounds(d.shape),
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

  const hitLabel = (p: Point): string | null => {
    for (const [id, r] of labels) if (rectContains(r, p, isCoarse() ? 6 : 2)) return id;
    return null;
  };

  const hitHandle = (p: Point): string | null => {
    const sel = propsRef.current.damages.find((d) => d.id === propsRef.current.selectedId);
    if (!sel) return null;
    const tol = isCoarse() ? 22 : 10;
    for (const { h, p: hp } of screenHandles(sel.shape, viewRef.current!)) {
      if (Math.abs(hp.x - p.x) <= tol && Math.abs(hp.y - p.y) <= tol) return h;
    }
    return null;
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
    if (currentTool === 'select') {
      const handle = hitHandle(p);
      if (handle) {
        const sel = propsRef.current.damages.find((d) => d.id === propsRef.current.selectedId)!;
        gesture.current = { kind: 'resize', id: sel.id, handle, orig: sel.shape };
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
      case 'pan': {
        const dx = p.x - g.start.x;
        const dy = p.y - g.start.y;
        if (!g.moved && Math.hypot(dx, dy) < 6) return;
        g.moved = true;
        setView({ ...g.view, tx: g.view.tx + dx, ty: g.view.ty + dy });
        return;
      }
      case 'draw': {
        const pp = toPage(v, p);
        g.current = pp;
        if (g.tool === 'freehand') {
          const last = g.points[g.points.length - 1];
          if (Math.hypot(pp.x - last.x, pp.y - last.y) * v.scale >= 2) g.points.push(pp);
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
        propsRef.current.onShapeChange(g.id, resizeShape(g.orig, g.handle, pp, 6 / v.scale), false);
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
      case 'resize': {
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
    return (
      <path
        key={opts.key}
        d={d}
        fill={col}
        fillOpacity={opts.selected ? 0.2 : 0.12}
        stroke={col}
        strokeWidth={opts.selected ? strokeW + 1.5 : strokeW}
        strokeDasharray={opts.dashed ? '6 4' : undefined}
        strokeLinejoin="round"
        data-damage={opts.id}
      />
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
                <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={3} fill="#fff" fillOpacity={0.95} stroke={d.color} strokeWidth={sel ? 2.4 : 1.4} />
                <text x={r.x + r.w / 2} y={r.y + r.h / 2} fontSize={labelFont} textAnchor="middle" dominantBaseline="central">
                  {d.number}
                </text>
              </g>
            );
          })}
          {selected && tool === 'select' && (
            <g className="handles">
              {(() => {
                const b = shapeBounds(selected.shape);
                const p1 = toScreen(view, b);
                return <rect x={p1.x} y={p1.y} width={b.w * view.scale} height={b.h * view.scale} className="sel-box" />;
              })()}
              {screenHandles(selected.shape, view).map(({ h, p }) => {
                const s = isCoarse() ? 14 : 10;
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
 * Anfasser in Bildschirmkoordinaten. Bei kleinen Markierungen nur die vier Ecken, leicht
 * nach außen versetzt, damit die Form selbst sichtbar und verschiebbar bleibt.
 */
function screenHandles(shape: Shape, v: View): { h: string; p: Point }[] {
  const b = shapeBounds(shape);
  const small = Math.min(b.w, b.h) * v.scale < 64;
  const list = small ? HANDLES.filter((h) => h.length === 2) : HANDLES;
  const off = small ? 8 : 0;
  return list.map((h) => {
    const p = toScreen(v, handlePosition(b, h));
    return {
      h,
      p: {
        x: p.x + (h.includes('w') ? -off : h.includes('e') ? off : 0),
        y: p.y + (h.includes('n') ? -off : h.includes('s') ? off : 0),
      },
    };
  });
}

/** Berechnet die gespeicherte Beschriftungsverschiebung (Seiteneinheiten) aus einer Bildschirmposition. */
function labelOffsetFor(d: Damage, r: Rect, v: View) {
  const b = shapeBounds(d.shape);
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
      return { type: 'freehand', x, y, w, h, points: pts.map((p) => [(p.x - x) / w, (p.y - y) / h]) };
    }
    return freehandShape(g.points, 1.5 / v.scale) ?? { type: 'ellipse', ...r };
  }
  return { type: g.tool, ...r };
}
