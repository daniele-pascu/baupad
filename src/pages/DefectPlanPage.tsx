import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { PdfPreview } from '../components/PdfPreview';
import { PhotoCapture } from '../components/PhotoCapture';
import { PhotoImg } from '../components/PhotoImg';
import { PhotoViewer } from '../components/PhotoViewer';
import { confirmDialog, showError } from '../components/ui';
import { getCompanyLogo } from '../lib/company';
import { getDefectPlan, getMeta } from '../lib/db';
import { defectPdf } from '../lib/defect-pdf';
import { defectSiteKey, hitMark, KINDS, kindInfo, loadMarks, MARK_COLORS, markAnchor, markBox, newMark, nextMarkNo, openPlanPdf, planRaster, plansOfSite, putMark, removeMark, renumber, SHAPES, thinPoints } from '../lib/defects';
import { clampRenderScale, pageSize, renderPdfRegion, type RenderJob } from '../lib/pdf';
import type { PDFPageProxy } from 'pdfjs-dist';
import { getPhotoStorage } from '../lib/photo-storage';
import { photoSiteKey } from '../lib/photos';
import { navigate, paths } from '../lib/router';
import type { DefectKind, DefectMark, DefectPlan, MarkShape, Photo, PhotoSite } from '../lib/types';
import type { ExportFile } from '../lib/aufmass';
import { safeFileName } from '../lib/aufmass';
import { DEFECT_ACCENT } from './DefectsPage';
import { usePlanThumb } from './DefectSitePage';
import { usePageTitle } from '../lib/page-title';

type Tool = 'select' | MarkShape;
type Pt = { x: number; y: number };

const SHAPE_ICON: Record<MarkShape, string> = { pin: 'pin', rect: 'rect', ellipse: 'ellipse', line: 'line', freehand: 'freehand', text: 'text' };

/** Pin als SVG-Pfad in Bildkoordinaten (Spitze am Punkt), Größe in Bildpixeln */
function pinPath(x: number, y: number, s: number): string {
  // s = Höhe des Pins
  const r = s * 0.36;
  const cy = y - s + r;
  return `M${x} ${y} C${x - r * 0.9} ${y - s * 0.45} ${x - r} ${cy + r * 0.2} ${x - r} ${cy} A${r} ${r} 0 1 1 ${x + r} ${cy} C${x + r} ${cy + r * 0.2} ${x + r * 0.9} ${y - s * 0.45} ${x} ${y}Z`;
}

type View = { s: number; tx: number; ty: number };
const MAX_S = 8;

/**
 * Plan mit Markierungen: Bild + SVG-Ebene, mit Zoom und Verschieben wie in der Planansicht des Aufmaßes
 * (Mausrad, zwei Finger, Knöpfe; Ziehen auf leerer Fläche verschiebt). Werkzeug „auswählen“ trifft Markierungen
 * (und verschiebt sie), die Zeichenwerkzeuge legen Pins, Formen und Text an. Koordinaten sind relativ (0..1) zum Bild.
 */
function PlanCanvas({
  plan,
  url,
  pdfPage,
  marks,
  selectedId,
  tool,
  color,
  zoomCmd,
  cancelCmd,
  onZoom,
  onCreate,
  onSelect,
  onOpen,
  onMove,
}: {
  plan: DefectPlan;
  url: string | null;
  /** Original-PDF-Seite: beim Zoomen wird der sichtbare Ausschnitt scharf nachgerendert (wie in Aufmaß & Abrechnung) */
  pdfPage: PDFPageProxy | null;
  marks: DefectMark[];
  selectedId: string | null;
  tool: Tool;
  color: string;
  /** Befehl von außen: Faktor (>1 vergrößern, <1 verkleinern) oder 0 = einpassen; Zähler, damit gleiche Befehle erneut wirken */
  zoomCmd: { n: number; factor: number };
  /** Befehl von außen (Esc): angefangene Zeichnung verwerfen; Zähler */
  cancelCmd: number;
  onZoom(scale: number): void;
  onCreate(shape: MarkShape, points: Pt[]): void;
  onSelect(id: string | null): void;
  onOpen(id: string): void;
  onMove(id: string, points: Pt[]): void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  const [view, setViewState] = useState<View>({ s: 1, tx: 0, ty: 0 });
  const viewRef = useRef(view);
  const [draft, setDraft] = useState<{ shape: MarkShape; points: Pt[] } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<
    | { kind: 'draw'; start: Pt; moved: boolean }
    | { kind: 'move'; start: Pt; id: string; orig: Pt[]; moved: boolean }
    | { kind: 'resize'; id: string; handle: string; orig: Pt[]; box: { x: number; y: number; w: number; h: number } }
    | { kind: 'pan'; x: number; y: number; view: View; moved: boolean }
    | { kind: 'pinch'; dist: number; mid: { x: number; y: number }; view: View }
    | null
  >(null);
  const W = plan.width;
  const H = plan.height;
  const ar = W / H;
  /** eingepasste Größe (Zoom 1): ganzer Plan sichtbar, mit etwas Rand */
  const fit = Math.min((size.w - 24) / W, (size.h - 24) / H);
  const fitW = Math.max(50, W * fit);
  const fitH = Math.max(50, H * fit);

  const setView = (v: View) => {
    viewRef.current = v;
    setViewState(v);
    onZoom(v.s);
  };
  /** Bild im Rahmen halten: kleiner als der Rahmen → zentriert, sonst keine leeren Ränder */
  const clamp = (v: View): View => {
    const cw = fitW * v.s;
    const ch = fitH * v.s;
    const bw = size.w;
    const bh = size.h;
    const tx = cw <= bw ? (bw - cw) / 2 : Math.min(0, Math.max(bw - cw, v.tx));
    const ty = ch <= bh ? (bh - ch) / 2 : Math.min(0, Math.max(bh - ch, v.ty));
    return { s: v.s, tx, ty };
  };
  /** um den Faktor zoomen, der Rahmenpunkt (bx, by) bleibt an Ort und Stelle */
  const zoomAt = (factor: number, bx: number, by: number, from: View = viewRef.current) => {
    const s = Math.min(MAX_S, Math.max(1, from.s * factor));
    const k = s / from.s;
    setView(clamp({ s, tx: bx - (bx - from.tx) * k, ty: by - (by - from.ty) * k }));
  };

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize({ w: Math.max(100, el.clientWidth), h: Math.max(100, el.clientHeight) });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    setView(clamp({ s: 1, tx: 0, ty: 0 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h]);
  useEffect(() => {
    if (!cancelCmd) return;
    setDraft(null);
    gesture.current = null;
    pointers.current.clear();
  }, [cancelCmd]);
  useEffect(() => {
    if (!zoomCmd.n) return;
    if (zoomCmd.factor === 0) setView(clamp({ s: 1, tx: 0, ty: 0 }));
    else zoomAt(zoomCmd.factor, size.w / 2, size.h / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomCmd.n]);
  // Mausrad (mit Strg feiner), passiv aus, damit die Seite nicht scrollt
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0022)), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h]);

  /** Detailebene aus dem PDF: sichtbarer Ausschnitt in Bühnen-Einheiten (eingepasste Größe) */
  const detailRef = useRef<HTMLCanvasElement>(null);
  const [detail, setDetail] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  useEffect(() => {
    if (!pdfPage) {
      setDetail(null);
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const needed = view.s * dpr; // Bildschirmpixel je Bühnen-Einheit
    const base = W / fitW; // Pixel des Grundbilds je Bühnen-Einheit
    if (needed <= base * 1.15) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    let job: RenderJob | null = null;
    const t = setTimeout(() => {
      const x0 = Math.max(0, -view.tx / view.s);
      const y0 = Math.max(0, -view.ty / view.s);
      const x1 = Math.min(fitW, (size.w - view.tx) / view.s);
      const y1 = Math.min(fitH, (size.h - view.ty) / view.s);
      if (x1 <= x0 || y1 <= y0) return;
      const ps = pageSize(pdfPage);
      const f = ps.width / fitW; // Seiteneinheiten je Bühnen-Einheit
      const region = { x: x0 * f, y: y0 * f, w: (x1 - x0) * f, h: (y1 - y0) * f };
      const scale = clampRenderScale(region.w, region.h, needed / f);
      const canvas = document.createElement('canvas');
      job = renderPdfRegion(pdfPage, canvas, region, scale);
      job.promise
        .then(() => {
          if (cancelled || !detailRef.current) return;
          const target = detailRef.current;
          target.width = canvas.width;
          target.height = canvas.height;
          target.getContext('2d')!.drawImage(canvas, 0, 0);
          setDetail({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
        })
        .catch((e) => console.warn(e));
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(t);
      job?.cancel();
    };
  }, [pdfPage, view, size.w, size.h, fitW, fitH, W]);

  /** Strich- und Symbolgrößen in Bildpixeln, damit sie bei jeder Zoomstufe am Bildschirm gleich groß sind */
  const px = (n: number) => (n * W) / (fitW * view.s);
  const tol = px(14) / H;

  const boxPt = (e: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const rel = (e: { clientX: number; clientY: number }): Pt => {
    const r = stage.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const hitAt = (p: Pt) => [...marks].reverse().find((m) => hitMark(m, p, tol, ar)) ?? null;
  /**
   * Griffe der ausgewählten Markierung wie im Aufmaß: Linie → Endpunkte (○); Rechteck/Ellipse → Ecken (○) und
   * Seitenmitten (□); Pin, Text, Freihand → nur verschieben.
   */
  const handlesOf = (m: DefectMark): { h: string; p: Pt; round: boolean }[] => {
    if (m.shape === 'line') return m.points.map((q, i) => ({ h: `v${i}`, p: q, round: true }));
    if (m.shape !== 'rect' && m.shape !== 'ellipse') return [];
    const b = markBox(m);
    const small = Math.min(b.w * W, b.h * H) * ((fitW * view.s) / W) < 64; // auf dem Bildschirm sehr klein → nur Ecken
    const list: { h: string; p: Pt; round: boolean }[] = [
      { h: 'nw', p: { x: b.x, y: b.y }, round: true },
      { h: 'ne', p: { x: b.x + b.w, y: b.y }, round: true },
      { h: 'se', p: { x: b.x + b.w, y: b.y + b.h }, round: true },
      { h: 'sw', p: { x: b.x, y: b.y + b.h }, round: true },
    ];
    if (!small)
      list.push(
        { h: 'n', p: { x: b.x + b.w / 2, y: b.y }, round: false },
        { h: 'e', p: { x: b.x + b.w, y: b.y + b.h / 2 }, round: false },
        { h: 's', p: { x: b.x + b.w / 2, y: b.y + b.h }, round: false },
        { h: 'w', p: { x: b.x, y: b.y + b.h / 2 }, round: false },
      );
    return list;
  };
  const selectedMark = selectedId ? (marks.find((m) => m.id === selectedId) ?? null) : null;
  const hitHandle = (p: Pt): string | null => {
    if (!selectedMark || tool !== 'select') return null;
    const r = px(12) / W; // Toleranz relativ zur Bildbreite
    for (const h of handlesOf(selectedMark)) if (Math.hypot((p.x - h.p.x) * ar, p.y - h.p.y) <= r * ar) return h.h;
    return null;
  };
  /** Punkte nach dem Ziehen eines Griffs (relative Koordinaten) */
  const resized = (g: { handle: string; orig: Pt[]; box: { x: number; y: number; w: number; h: number } }, p: Pt): Pt[] => {
    if (g.handle.startsWith('v')) {
      const i = Number(g.handle.slice(1));
      return g.orig.map((q, k) => (k === i ? p : q));
    }
    let { x, y, w, h } = g.box;
    let x2 = x + w;
    let y2 = y + h;
    if (g.handle.includes('w')) x = p.x;
    if (g.handle.includes('e')) x2 = p.x;
    if (g.handle.includes('n')) y = p.y;
    if (g.handle.includes('s')) y2 = p.y;
    return [
      { x: Math.min(x, x2), y: Math.min(y, y2) },
      { x: Math.max(x, x2), y: Math.max(y, y2) },
    ];
  };
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

  const down = (e: RPointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, boxPt(e));
    if (pointers.current.size === 2) {
      // zweiter Finger: Zeichnen/Verschieben abbrechen, ab jetzt Zoom und Verschieben
      const [a, b] = [...pointers.current.values()];
      setDraft(null);
      gesture.current = { kind: 'pinch', dist: dist(a, b), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, view: viewRef.current };
      return;
    }
    if (pointers.current.size > 2) return;
    const p = rel(e);
    const bp = boxPt(e);
    if (tool === 'select' || e.button === 1) {
      const handle = e.button !== 1 ? hitHandle(p) : null;
      if (handle && selectedMark) {
        gesture.current = { kind: 'resize', id: selectedMark.id, handle, orig: selectedMark.points, box: markBox(selectedMark) };
        return;
      }
      const m = tool === 'select' && e.button !== 1 ? hitAt(p) : null;
      if (!m) {
        if (tool === 'select' && e.button !== 1) onSelect(null);
        gesture.current = { kind: 'pan', x: bp.x, y: bp.y, view: viewRef.current, moved: false };
        return;
      }
      gesture.current = { kind: 'move', start: p, id: m.id, orig: m.points, moved: false };
      onSelect(m.id);
      return;
    }
    gesture.current = { kind: 'draw', start: p, moved: false };
    if (tool === 'freehand') setDraft({ shape: 'freehand', points: [p] });
    else setDraft({ shape: tool, points: [p, p] });
  };
  const move = (e: RPointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, boxPt(e));
    const g = gesture.current;
    if (!g) return;
    if (g.kind === 'pinch') {
      if (pointers.current.size < 2) return;
      const [a, b] = [...pointers.current.values()];
      const d = dist(a, b);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const s = Math.min(MAX_S, Math.max(1, (g.view.s * d) / g.dist));
      const k = s / g.view.s;
      // Zoom um die Startmitte, dazu die Bewegung der Finger als Verschiebung
      setView(clamp({ s, tx: g.mid.x - (g.mid.x - g.view.tx) * k + (mid.x - g.mid.x), ty: g.mid.y - (g.mid.y - g.view.ty) * k + (mid.y - g.mid.y) }));
      return;
    }
    if (g.kind === 'pan') {
      const bp = boxPt(e);
      if (Math.hypot(bp.x - g.x, bp.y - g.y) > 3) g.moved = true;
      if (g.moved) setView(clamp({ s: g.view.s, tx: g.view.tx + bp.x - g.x, ty: g.view.ty + bp.y - g.y }));
      return;
    }
    const p = rel(e);
    if (g.kind === 'resize') {
      onMove(g.id, resized(g, p));
      return;
    }
    if (Math.hypot((p.x - g.start.x) * ar, p.y - g.start.y) > 0.004) g.moved = true;
    if (g.kind === 'move') {
      if (!g.moved) return;
      const dx = p.x - g.start.x;
      const dy = p.y - g.start.y;
      onMove(g.id, g.orig.map((q) => ({ x: Math.min(1, Math.max(0, q.x + dx)), y: Math.min(1, Math.max(0, q.y + dy)) })));
      return;
    }
    if (tool === 'freehand') setDraft((s) => (s ? { ...s, points: [...s.points, p] } : s));
    else if (tool !== 'pin' && tool !== 'text' && tool !== 'select') setDraft({ shape: tool, points: [g.start, p] });
  };
  const up = (e: RPointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (!g) return;
    if (g.kind === 'pinch') {
      gesture.current = null;
      return;
    }
    if (pointers.current.size) return;
    gesture.current = null;
    if (g.kind === 'pan' || g.kind === 'resize') return;
    const p = rel(e);
    if (g.kind === 'move') {
      if (!g.moved && g.id === selectedId) onOpen(g.id);
      return;
    }
    setDraft(null);
    if (tool === 'pin' || tool === 'text') {
      onCreate(tool, [p]);
      return;
    }
    if (tool === 'freehand') {
      const pts = thinPoints(draft?.points ?? [g.start, p]);
      if (pts.length >= 2) onCreate('freehand', pts);
      return;
    }
    if (!g.moved || tool === 'select') return; // zu klein
    onCreate(tool, [g.start, p]);
  };
  const cancel = (e: RPointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (!pointers.current.size) {
      gesture.current = null;
      setDraft(null);
    }
  };

  const sw = px(3);
  const renderShape = (m: { shape: MarkShape; points: Pt[]; color: string; text?: string }, key: string, selected: boolean, isDraft = false) => {
    const c = m.color;
    const common = { stroke: c, strokeWidth: selected ? sw * 1.6 : sw, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, opacity: isDraft ? 0.7 : 1 };
    const P = m.points.map((q) => ({ x: q.x * W, y: q.y * H }));
    switch (m.shape) {
      case 'pin': {
        const s = px(38);
        return (
          <g key={key}>
            <path d={pinPath(P[0].x, P[0].y, s)} fill={c} stroke="#fff" strokeWidth={px(1.5)} />
            <circle cx={P[0].x} cy={P[0].y - s * 0.64} r={px(5)} fill="#fff" />
          </g>
        );
      }
      case 'rect': {
        const b = markBox(m);
        return <rect key={key} x={b.x * W} y={b.y * H} width={b.w * W} height={b.h * H} rx={px(3)} {...common} fill={c} fillOpacity={0.12} />;
      }
      case 'ellipse': {
        const b = markBox(m);
        return <ellipse key={key} cx={(b.x + b.w / 2) * W} cy={(b.y + b.h / 2) * H} rx={(b.w / 2) * W} ry={(b.h / 2) * H} {...common} fill={c} fillOpacity={0.12} />;
      }
      case 'line':
        return <line key={key} x1={P[0].x} y1={P[0].y} x2={P[1].x} y2={P[1].y} {...common} />;
      case 'freehand':
        return <polyline key={key} points={P.map((q) => `${q.x},${q.y}`).join(' ')} {...common} />;
      case 'text': {
        const t = m.text || 'Text';
        const fs = px(14);
        const w = t.length * fs * 0.58 + px(12);
        return (
          <g key={key}>
            <rect x={P[0].x - px(6)} y={P[0].y - fs - px(4)} width={w} height={fs + px(10)} rx={px(3)} fill="#fff" stroke={c} strokeWidth={selected ? sw * 1.4 : sw * 0.7} />
            <text x={P[0].x} y={P[0].y} fontSize={fs} fontFamily="-apple-system, Segoe UI, Inter, sans-serif" fontWeight="600" fill={c}>
              {t}
            </text>
          </g>
        );
      }
    }
  };

  return (
    <div
      ref={box}
      className={`dp-canvas${tool === 'select' ? '' : ' drawing'}`}
      data-testid="dp-canvas"
      data-zoom={view.s.toFixed(2)}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={cancel}
    >
      <div ref={stage} className="dp-stage" style={{ width: fitW, height: fitH, transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.s})` }}>
        {url ? <img src={url} alt="" draggable={false} /> : <div className="dp-loading muted small">Plan wird geladen …</div>}
        <canvas
          ref={detailRef}
          className="dp-detail"
          data-testid="dp-detail"
          style={detail ? { left: detail.x, top: detail.y, width: detail.w, height: detail.h } : { display: 'none' }}
          aria-hidden="true"
        />
        <svg viewBox={`0 0 ${W} ${H}`} width={fitW} height={fitH} aria-hidden="true">
          {marks.map((m) => renderShape(m, m.id, m.id === selectedId))}
          {draft && renderShape({ ...draft, color }, 'draft', false, true)}
          {selectedMark && tool === 'select' && (
            <g className="handles" data-testid="dp-handles">
              {(selectedMark.shape === 'rect' || selectedMark.shape === 'ellipse') &&
                (() => {
                  const b = markBox(selectedMark);
                  return <rect x={b.x * W} y={b.y * H} width={b.w * W} height={b.h * H} className="sel-box" strokeWidth={px(1)} strokeDasharray={`${px(4)} ${px(3)}`} />;
                })()}
              {handlesOf(selectedMark).map(({ h, p, round }) => {
                const sz = px(matchMedia('(pointer: coarse)').matches ? 16 : 10);
                return round ? (
                  <circle key={h} cx={p.x * W} cy={p.y * H} r={sz * 0.55} className="vertex-handle" strokeWidth={px(2)} data-handle={h} data-testid={`dp-handle-${h}`} />
                ) : (
                  <rect key={h} x={p.x * W - sz / 2} y={p.y * H - sz / 2} width={sz} height={sz} className="handle" strokeWidth={px(1.5)} data-handle={h} data-testid={`dp-handle-${h}`} />
                );
              })}
            </g>
          )}
        </svg>
        {marks.map((m) => {
          const a = markAnchor(m);
          const dy = (m.shape === 'pin' ? -44 : m.shape === 'text' ? -22 : -14) / view.s;
          return (
            <button
              key={m.id}
              type="button"
              className={`dp-num${m.id === selectedId ? ' on' : ''}`}
              style={{ left: `${a.x * 100}%`, top: `calc(${a.y * 100}% + ${dy}px)`, borderColor: m.color, color: m.color, transform: `translate(-50%, -50%) scale(${(m.id === selectedId ? 1.25 : 1) / view.s})` }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => (m.id === selectedId ? onOpen(m.id) : onSelect(m.id))}
              aria-label={`Markierung ${m.no}`}
              data-testid="dp-num"
              data-no={m.no}
            >
              {m.no}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Fotos der Baustelle aus der Fotodokumentation auswählen */
function SitePhotosPicker({ photos, chosen, onClose, onDone }: { photos: Photo[]; chosen: string[]; onClose(): void; onDone(ids: string[]): void }) {
  const [sel, setSel] = useState<Set<string>>(new Set(chosen));
  const toggle = (id: string) => setSel((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  return (
    <Modal
      title="Fotos aus der Fotodokumentation"
      onClose={onClose}
      wide
      testId="dp-photo-picker"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onDone([...sel])} data-testid="dp-photo-picker-done">
            {sel.size} übernehmen
          </button>
        </>
      }
    >
      {photos.length === 0 ? (
        <p className="muted">Noch keine Fotos auf dieser Baustelle.</p>
      ) : (
        <div className="dp-photo-grid">
          {photos.map((p) => (
            <button key={p.id} type="button" className={`dp-photo-pick${sel.has(p.id) ? ' on' : ''}`} onClick={() => toggle(p.id)} aria-pressed={sel.has(p.id)} data-testid="dp-photo-pick">
              <PhotoImg id={p.id} />
              <span className="small">{new Date(p.takenAt).toLocaleDateString('de-DE')}</span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

/** Markierung bearbeiten: Art, Titel, Beschreibung, Farbe, Text, Fotos */
function MarkDialog({
  mark,
  site,
  photos,
  onClose,
  onSave,
  onDelete,
  onPhotosAdded,
  onView,
}: {
  mark: DefectMark;
  site: PhotoSite;
  photos: Photo[];
  onClose(): void;
  onSave(m: DefectMark): void;
  onDelete(m: DefectMark): void;
  onPhotosAdded(): void;
  /** Foto groß anzeigen (alle Fotos des Mangels, Startindex) */
  onView(ids: string[], index: number): void;
}) {
  const [m, setM] = useState(mark);
  const [picking, setPicking] = useState(false);
  const set = <K extends keyof DefectMark>(k: K, v: DefectMark[K]) => setM((p) => ({ ...p, [k]: v }));
  const setKind = (kind: DefectKind) => setM((p) => ({ ...p, kind, color: MARK_COLORS.includes(p.color) && p.color !== kindInfo(p.kind).color ? p.color : kindInfo(kind).color }));
  const hashes = useMemo(() => new Set(photos.map((p) => p.hash)), [photos]);
  const linked = photos.filter((p) => m.photoIds.includes(p.id));
  return (
    <Modal
      title={`Nr. ${m.no} · ${SHAPES.find((s) => s.id === m.shape)?.label ?? ''}`}
      onClose={onClose}
      testId="dp-mark-dialog"
      footer={
        <>
          <button type="button" className="btn btn-danger-text" onClick={() => onDelete(m)} data-testid="dp-mark-delete">
            <Icon name="trash" size={16} /> Löschen
          </button>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onSave(m)} data-testid="dp-mark-save">
            Speichern
          </button>
        </>
      }
    >
      <div className="form-grid">
        <div className="field dp-kinds-field">
          <span>Art</span>
          <div className="segmented dp-kinds" role="radiogroup" aria-label="Art">
            {KINDS.map((k) => (
              <button key={k.id} type="button" role="radio" aria-checked={m.kind === k.id} aria-selected={m.kind === k.id} onClick={() => setKind(k.id)} style={m.kind === k.id ? { background: k.color, color: '#fff', borderColor: k.color } : undefined} data-testid={`dp-kind-${k.id}`}>
                {k.label}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span>Titel</span>
          <input value={m.title} onChange={(e) => set('title', e.target.value)} placeholder="z. B. Abplatzung Decke, Achse B3" data-autofocus data-testid="dp-mark-title" />
        </label>
        {m.shape === 'text' && (
          <label className="field">
            <span>Text im Plan</span>
            <input value={m.text} onChange={(e) => set('text', e.target.value)} placeholder="kurzer Text, erscheint im Plan" data-testid="dp-mark-text" />
          </label>
        )}
        <label className="field">
          <span>Beschreibung</span>
          <textarea value={m.description} onChange={(e) => set('description', e.target.value)} rows={3} placeholder="Was ist zu tun, Menge, Material, Hinweise fürs Angebot" data-testid="dp-mark-desc" />
        </label>
        <div className="field">
          <span>Farbe im Plan</span>
          <div className="dp-colors">
            {MARK_COLORS.map((c) => (
              <button key={c} type="button" className={`dp-color${m.color === c ? ' on' : ''}`} style={{ background: c }} onClick={() => set('color', c)} aria-label={`Farbe ${c}`} aria-pressed={m.color === c} data-testid="dp-mark-color">
                {m.color === c && <Icon name="check" size={20} />}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>Fotos ({linked.length})</span>
          {linked.length > 0 && (
            <div className="dp-photo-row" data-testid="dp-mark-photos">
              {linked.map((p, i) => (
                <span key={p.id} className="dp-photo-chip">
                  <button type="button" className="dp-photo-open" onClick={() => onView(linked.map((x) => x.id), i)} aria-label="Foto groß anzeigen" data-testid="dp-mark-photo">
                    <PhotoImg id={p.id} />
                  </button>
                  <button type="button" className="dp-photo-x" onClick={() => set('photoIds', m.photoIds.filter((x) => x !== p.id))} aria-label="Foto entfernen">
                    <Icon name="close" size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          {linked.length > 0 && <p className="muted small">Foto antippen: groß ansehen und vergrößern.</p>}
          <div className="row gap wrap">
            <PhotoCapture
              sites={[site]}
              site={site}
              existingHashes={hashes}
              onSaved={(saved) => {
                set('photoIds', [...m.photoIds, ...saved.map((p) => p.id)]);
                onPhotosAdded();
              }}
              render={({ camera, library }) => (
                <>
                  <button type="button" className="btn btn-sm" onClick={camera} data-testid="dp-photo-camera">
                    <Icon name="camera" size={16} /> Foto aufnehmen
                  </button>
                  <button type="button" className="btn btn-sm" onClick={library} data-testid="dp-photo-library">
                    <Icon name="images" size={16} /> Aus Galerie
                  </button>
                </>
              )}
            />
            <button type="button" className="btn btn-sm" onClick={() => setPicking(true)} data-testid="dp-photo-from-doku">
              <Icon name="folder" size={16} /> Aus Fotodokumentation
            </button>
          </div>
          <p className="muted small">Neue Fotos landen auch in der Fotodokumentation dieser Baustelle, mit Vermerk „Mängelplan Nr. {m.no}“.</p>
        </div>
      </div>
      {picking && <SitePhotosPicker photos={photos} chosen={m.photoIds} onClose={() => setPicking(false)} onDone={(ids) => { set('photoIds', ids); setPicking(false); }} />}
    </Modal>
  );
}

/** Planseite des Mängelplans: Werkzeugleiste, Plan mit Markierungen, Liste, Bearbeiten, PDF */
export function DefectPlanPage({ planId, markId }: { planId: string; markId: string | null }) {
  const [plan, setPlan] = useState<DefectPlan | null | undefined>(undefined);
  const [marks, setMarks] = useState<DefectMark[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [tool, setTool] = useState<Tool>('select');
  const [cancelCmd, setCancelCmd] = useState(0);
  const [color, setColor] = useState(MARK_COLORS[0]);
  const [kind, setKind] = useState<DefectKind>('mangel');
  const [zoom, setZoom] = useState(1);
  const [zoomCmd, setZoomCmd] = useState({ n: 0, factor: 1 });
  const zoomBy = (factor: number) => setZoomCmd((c) => ({ n: c.n + 1, factor }));
  const [selected, setSelected] = useState<string | null>(markId);
  const [editing, setEditing] = useState<DefectMark | null>(null);
  const [filter, setFilter] = useState<DefectKind | 'all'>('all');
  const [toolsOpen, setToolsOpen] = useState(true);
  const [mobileTab, setMobileTab] = useState<'plan' | 'table'>('plan');
  const [siblings, setSiblings] = useState<DefectPlan[]>([]);
  const [preview, setPreview] = useState<ExportFile | null>(null);
  const [busy, setBusy] = useState(false);
  const url = usePlanThumb(planId, 'data');
  const selectedMark = selected ? (marks.find((m) => m.id === selected) ?? null) : null;
  /** Großansicht der Fotos eines Mangels */
  const [viewer, setViewer] = useState<{ ids: string[]; index: number; title: string } | null>(null);
  const viewPhotos = (ids: string[], index: number, title: string) => setViewer({ ids, index, title });
  /** Original-PDF-Seite (falls der Plan aus einem PDF stammt) für scharfes Zoomen */
  const [pdfPage, setPdfPage] = useState<PDFPageProxy | null>(null);
  useEffect(() => {
    let off = false;
    setPdfPage(null);
    void openPlanPdf(planId)
      .then(async (doc) => {
        if (!doc || off) return;
        const page = await doc.getPage(1);
        if (!off) setPdfPage(page);
      })
      .catch((e) => console.warn(e));
    return () => {
      off = true;
    };
  }, [planId]);
  usePageTitle(`${plan?.title ?? 'Plan'} – Mängelplan`);

  const site: PhotoSite | null = plan ? { projectId: plan.projectId, name: plan.siteName, number: plan.siteNumber, address: plan.siteAddress } : null;
  const sitePhotos = useMemo(() => (site ? photos.filter((p) => !p.deletedAt && photoSiteKey(p) === defectSiteKey(plan!)) : []), [photos, site, plan]);

  const reloadPhotos = () => getPhotoStorage().list().then(setPhotos).catch(() => {});
  useEffect(() => {
    void getDefectPlan(planId).then((p) => {
      setPlan(p ?? null);
      if (p) void plansOfSite(defectSiteKey(p)).then(setSiblings);
    });
    void loadMarks(planId).then(setMarks);
    void reloadPhotos();
  }, [planId]);
  useEffect(() => {
    if (markId) {
      const m = marks.find((x) => x.id === markId);
      if (m) setEditing(m);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markId, marks.length]);

  const create = async (shape: MarkShape, points: Pt[]) => {
    const m = newMark(planId, nextMarkNo(marks), shape, color, points, kind);
    await putMark(m);
    setMarks((l) => [...l, m]);
    setSelected(m.id);
    setEditing(m);
  };
  const moveMark = (id: string, points: Pt[]) => setMarks((l) => l.map((m) => (m.id === id ? { ...m, points } : m)));
  const commitMove = async (id: string) => {
    const m = marks.find((x) => x.id === id);
    if (m) await putMark(m);
  };
  const save = async (m: DefectMark) => {
    try {
      await putMark(m);
      setMarks((l) => l.map((x) => (x.id === m.id ? m : x)));
      // Vermerk in der Fotodokumentation, wenn das Foto noch keine Beschreibung hat
      const storage = getPhotoStorage();
      for (const p of photos.filter((p) => m.photoIds.includes(p.id) && !p.description.trim())) await storage.update({ ...p, description: `Mängelplan Nr. ${m.no}${m.title ? `: ${m.title}` : ''}` });
      void reloadPhotos();
      setEditing(null);
      if (markId) navigate(paths.defectPlan(planId), true);
    } catch (e) {
      showError(e, 'Markierung konnte nicht gespeichert werden');
    }
  };
  const del = async (m: DefectMark) => {
    const ok = await confirmDialog({ title: `Markierung Nr. ${m.no} löschen?`, message: <p>Die Fotos bleiben in der Fotodokumentation. Die Nummern der folgenden Markierungen rücken nach.</p>, confirmLabel: 'Löschen', danger: true });
    if (!ok) return;
    await removeMark(m.id);
    setMarks(await renumber(planId));
    setEditing(null);
    setSelected(null);
  };
  // Tastatur wie im Aufmaß: V = Auswahl, Entf = ausgewählte Markierung löschen, Esc = Auswahl aufheben
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (document.querySelector('.modal-backdrop, .lightbox')) return;
      if (e.key === 'v' || e.key === 'V') setTool('select');
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
        e.preventDefault();
        const m = marks.find((x) => x.id === selected);
        if (m) void del(m);
      } else if (e.key === 'Escape') {
        // wie im Aufmaß: Esc beendet alles – angefangene Zeichnung, Auswahl – und schaltet auf „Auswahl“
        e.preventDefault();
        setCancelCmd((n) => n + 1);
        setSelected(null);
        setTool('select');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, marks]);
  const exportPdf = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      const raster = await planRaster(plan.id);
      if (!raster) throw new Error('Planbild nicht gefunden.');
      const [company, lines, logo] = await Promise.all([getMeta<string>('companyName'), getMeta<string>('companyLines'), getCompanyLogo()]);
      const blobs = new Map<string, ArrayBuffer>();
      const storage = getPhotoStorage();
      for (const id of new Set(marks.flatMap((m) => m.photoIds))) {
        const b = await storage.blobs(id);
        if (b) blobs.set(id, b.data);
      }
      const data = await defectPdf(plan, marks, raster, blobs, { company: company ?? '', lines: lines ?? '', logo });
      setPreview({ name: `${safeFileName(`Maengelplan ${plan.siteName} ${plan.title}`)}.pdf`, data, mimeType: 'application/pdf' });
    } catch (e) {
      showError(e, 'PDF konnte nicht erstellt werden');
    } finally {
      setBusy(false);
    }
  };

  const shown = marks.filter((m) => filter === 'all' || m.kind === filter);
  const pickTool = (t: Tool) => setTool((cur) => (cur === t && t !== 'select' ? 'select' : t));
  const photoCount = marks.reduce((n, m) => n + m.photoIds.length, 0);
  const siblingIdx = siblings.findIndex((p) => p.id === planId);

  if (plan === null)
    return (
      <div className="page">
        <p>Plan nicht gefunden.</p>
        <a href={paths.defects()} className="btn">
          Zum Mängelplan
        </a>
      </div>
    );

  return (
    <>
      <div className="editor dp-editor" style={DEFECT_ACCENT}>
        <header className="topbar editor-topbar">
          <a className="icon-btn" href={plan ? paths.defectSite(defectSiteKey(plan)) : paths.defects()} aria-label="Zurück zur Baustelle" data-testid="to-defect-site">
            <Icon name="back" />
          </a>
          <div className="topbar-title">
            <small>{[plan?.siteName, plan?.siteNumber].filter(Boolean).join(' · ')} · Mängelplan</small>
            <div className="plan-switch">
              <button type="button" className="icon-btn icon-btn-sm" disabled={siblingIdx <= 0} onClick={() => navigate(paths.defectPlan(siblings[siblingIdx - 1].id))} aria-label="Vorheriger Plan">
                <Icon name="back" size={18} />
              </button>
              <select value={planId} onChange={(e) => navigate(paths.defectPlan(e.target.value))} aria-label="Plan wechseln" data-testid="dp-plan-select">
                {(siblings.length ? siblings : plan ? [plan] : []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
              <button type="button" className="icon-btn icon-btn-sm" disabled={siblingIdx < 0 || siblingIdx >= siblings.length - 1} onClick={() => navigate(paths.defectPlan(siblings[siblingIdx + 1].id))} aria-label="Nächster Plan">
                <Icon name="next" size={18} />
              </button>
            </div>
            <h1 className="sr-only" data-testid="dp-title">
              {plan?.title ?? '…'}
            </h1>
          </div>
          <div className="topbar-actions">
            <span className="status-pill ok dp-status" title="Alles gespeichert" data-testid="dp-status">
              <span className="hide-sm">{marks.length} Markierungen</span>
            </span>
            <button type="button" className="btn btn-sm" onClick={() => void exportPdf()} disabled={busy || !marks.length} title="Plan mit Markierungen und Liste als PDF" data-testid="dp-pdf">
              <Icon name="pdf" size={18} /> <span className="hide-sm">{busy ? 'Wird erstellt …' : 'PDF'}</span>
            </button>
          </div>
        </header>

        <div className="mobile-tabs segmented" role="tablist">
          <button type="button" role="tab" aria-selected={mobileTab === 'plan'} onClick={() => setMobileTab('plan')}>
            <Icon name="map" size={18} /> Plan
          </button>
          <button type="button" role="tab" aria-selected={mobileTab === 'table'} onClick={() => setMobileTab('table')} data-testid="dp-mobile-tab-table">
            <Icon name="table" size={18} /> Liste ({marks.length})
          </button>
        </div>

        <div className={`editor-main show-${mobileTab}`}>
          <div className="editor-plan">
            {plan && (
              <PlanCanvas
                plan={plan}
                url={url}
                pdfPage={pdfPage}
                marks={marks}
                selectedId={selected}
                tool={tool}
                color={color}
                zoomCmd={zoomCmd}
                cancelCmd={cancelCmd}
                onZoom={setZoom}
                onCreate={(s, p) => void create(s, p)}
                onSelect={setSelected}
                onOpen={(id) => setEditing(marks.find((m) => m.id === id) ?? null)}
                onMove={(id, p) => {
                  moveMark(id, p);
                  window.clearTimeout((window as unknown as { __dpMove?: number }).__dpMove);
                  (window as unknown as { __dpMove?: number }).__dpMove = window.setTimeout(() => void commitMove(id), 400);
                }}
              />
            )}
            {selectedMark && !editing && (
              <div className="selection-bar" data-testid="dp-selection-bar">
                <div className="selection-info">
                  <span className="color-dot" style={{ background: selectedMark.color }} />
                  <strong>
                    Nr. {selectedMark.no} · {SHAPES.find((x) => x.id === selectedMark.shape)?.label}
                  </strong>
                  <span>{selectedMark.title || kindInfo(selectedMark.kind).label}</span>
                  {selectedMark.photoIds.length > 0 && (
                    <span className="muted small">
                      {selectedMark.photoIds.length} {selectedMark.photoIds.length === 1 ? 'Foto' : 'Fotos'}
                    </span>
                  )}
                </div>
                {tool === 'select' ? (
                  <div className="selection-hint muted small">
                    {selectedMark.shape === 'line'
                      ? 'Ziehen = verschieben · Endpunkte (○) einzeln ziehen'
                      : selectedMark.shape === 'rect' || selectedMark.shape === 'ellipse'
                        ? 'Ziehen = verschieben · Eckpunkte (○) und Seitengriffe (□) ziehen = Größe'
                        : 'Ziehen = verschieben · noch einmal antippen = bearbeiten'}
                  </div>
                ) : null}
                <div className="row gap">
                  {tool !== 'select' && (
                    <button type="button" className="btn btn-sm" onClick={() => setTool('select')} data-testid="dp-adjust-selected">
                      <Icon name="select" size={18} /> Verschieben / Größe
                    </button>
                  )}
                  {selectedMark.photoIds.length > 0 && (
                    <button type="button" className="btn btn-sm" onClick={() => viewPhotos(selectedMark.photoIds, 0, `Nr. ${selectedMark.no} · ${kindInfo(selectedMark.kind).label}`)} data-testid="dp-selected-photos">
                      <Icon name="images" size={18} /> Fotos
                    </button>
                  )}
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => setEditing(selectedMark)} data-testid="dp-edit-selected">
                    <Icon name="edit" size={18} /> Bearbeiten
                  </button>
                  <button type="button" className="btn btn-sm btn-danger-text" onClick={() => void del(selectedMark)} data-testid="dp-delete-selected">
                    <Icon name="trash" size={18} />
                    <span className="sr-only">Löschen</span>
                  </button>
                </div>
              </div>
            )}
            <div className="zoom-controls">
              <button type="button" className="icon-btn" onClick={() => zoomBy(1.4)} aria-label="Vergrößern" title="Vergrößern (+) – auch Mausrad oder zwei Finger" data-testid="dp-zoom-in">
                <Icon name="plus" />
              </button>
              <button type="button" className="icon-btn" onClick={() => zoomBy(1 / 1.4)} aria-label="Verkleinern" title="Verkleinern (−)" disabled={zoom <= 1} data-testid="dp-zoom-out">
                <Icon name="minus" />
              </button>
              <button type="button" className="icon-btn" onClick={() => zoomBy(0)} aria-label="Gesamten Plan anzeigen" title="Gesamten Plan anzeigen (0)" disabled={zoom <= 1} data-testid="dp-zoom-fit">
                <Icon name="fit" />
              </button>
              <span className="dp-zoom-value muted" data-testid="dp-zoom-value">
                {Math.round(zoom * 100)} %
              </span>
            </div>

            <div className={`toolbar${toolsOpen ? '' : ' toolbar-collapsed'}`} role="toolbar" aria-label="Werkzeuge" data-testid="dp-toolbar">
              {!toolsOpen ? (
                <button type="button" className="tool-btn tools-open" onClick={() => setToolsOpen(true)} aria-expanded={false} title="Werkzeugleiste öffnen" data-testid="dp-tools-open">
                  <Icon name={tool === 'select' ? 'select' : (SHAPE_ICON[tool] as never)} />
                  <span>Werkzeuge</span>
                </button>
              ) : (
                <>
                  <div className="tool-group">
                    <button type="button" className={`tool-btn${tool === 'select' ? ' active' : ''}`} onClick={() => setTool('select')} aria-pressed={tool === 'select'} title="Auswählen / Verschieben (V)" data-testid="dp-tool-select">
                      <Icon name="select" />
                      <span>Auswahl</span>
                    </button>
                    {SHAPES.map((s) => (
                      <button key={s.id} type="button" className={`tool-btn${tool === s.id ? ' active' : ''}`} onClick={() => pickTool(s.id)} aria-pressed={tool === s.id} title={s.label} data-testid={`dp-tool-${s.id}`}>
                        <Icon name={SHAPE_ICON[s.id] as never} />
                        <span>{s.label}</span>
                      </button>
                    ))}
                  </div>
                  <div className="tool-group colors">
                    {MARK_COLORS.map((c) => (
                      <button key={c} type="button" className={`swatch${color === c ? ' active' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={`Farbe ${c}`} aria-pressed={color === c} data-testid="dp-color" data-color={c} />
                    ))}
                  </div>
                  <div className="tool-group color-pick">
                    <select
                      className="dp-kind-select"
                      value={kind}
                      onChange={(e) => {
                        const k = e.target.value as DefectKind;
                        setKind(k);
                        setColor(kindInfo(k).color);
                      }}
                      aria-label="Art neuer Markierungen"
                      title="Art neuer Markierungen"
                      data-testid="dp-kind"
                    >
                      {KINDS.map((k) => (
                        <option key={k.id} value={k.id}>
                          {k.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button type="button" className="icon-btn icon-btn-sm tools-close" onClick={() => setToolsOpen(false)} aria-label="Werkzeugleiste ausblenden" title="Werkzeugleiste ausblenden" data-testid="dp-tools-close">
                    <Icon name="close" size={18} />
                  </button>
                </>
              )}
            </div>
            {tool !== 'select' && (
              <p className="dp-hint" data-testid="dp-hint">
                {tool === 'pin' || tool === 'text' ? 'Im Plan antippen, wo die Markierung sitzen soll.' : tool === 'freehand' ? 'Mit dem Finger oder der Maus im Plan zeichnen.' : 'Im Plan aufziehen: Startpunkt drücken, ziehen, loslassen.'} Verschieben und Zoom mit zwei Fingern oder Mausrad.
              </p>
            )}
          </div>

          <aside className="editor-side" data-testid="dp-list">
            <div className="side-head">
              <h2>Markierungen – {plan?.title ?? '…'}</h2>
              <span className="muted small" data-testid="dp-summary">
                {marks.length} {marks.length === 1 ? 'Markierung' : 'Markierungen'} · {photoCount} {photoCount === 1 ? 'Foto' : 'Fotos'}
                {' · '}
                <select value={filter} onChange={(e) => setFilter(e.target.value as DefectKind | 'all')} aria-label="Filter" className="dp-filter" data-testid="dp-filter">
                  <option value="all">alle Arten</option>
                  {KINDS.map((k) => (
                    <option key={k.id} value={k.id}>
                      nur {k.label}
                    </option>
                  ))}
                </select>
              </span>
            </div>
            <div className="table-wrap">
              <table className="aufmass-table dp-table">
                <thead>
                  <tr>
                    <th>Nr.</th>
                    <th>Titel</th>
                    <th>Art</th>
                    <th className="num">Fotos</th>
                    <th className="actions-col">
                      <span className="sr-only">Aktionen</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((m) => {
                    const k = kindInfo(m.kind);
                    return (
                      <tr
                        key={m.id}
                        className={m.id === selected ? 'selected' : ''}
                        onClick={() => {
                          setSelected(m.id);
                          setMobileTab('plan');
                        }}
                        onDoubleClick={() => setEditing(m)}
                        data-testid="dp-item"
                        data-no={m.no}
                      >
                        <td>
                          <span className="color-dot" style={{ background: m.color }} /> {m.no}
                        </td>
                        <td className="dp-cell-title">
                          <strong>{m.title || (m.shape === 'text' && m.text) || `Markierung ${m.no}`}</strong>
                          {m.description && <span className="muted small">{m.description}</span>}
                        </td>
                        <td>
                          <span className="dp-tag" style={{ background: k.color }}>
                            {k.label}
                          </span>
                        </td>
                        <td className="num">
                          {m.photoIds[0] ? (
                            <button type="button" className="dp-item-photo" onClick={(e) => { e.stopPropagation(); viewPhotos(m.photoIds, 0, `Nr. ${m.no} · ${kindInfo(m.kind).label}`); }} aria-label={`Fotos von Nr. ${m.no} ansehen`} data-testid="dp-item-photo">
                              <PhotoImg id={m.photoIds[0]} />
                              {m.photoIds.length > 1 && <b>{m.photoIds.length}</b>}
                            </button>
                          ) : (
                            <span className="muted">–</span>
                          )}
                        </td>
                        <td className="actions-col">
                          <button type="button" className="icon-btn icon-btn-sm" onClick={(e) => { e.stopPropagation(); setEditing(m); }} aria-label={`Nr. ${m.no} bearbeiten`} data-testid="dp-item-edit">
                            <Icon name="edit" size={16} />
                          </button>
                          <button type="button" className="icon-btn icon-btn-sm danger" onClick={(e) => { e.stopPropagation(); void del(m); }} aria-label={`Nr. ${m.no} löschen`} data-testid="dp-item-delete">
                            <Icon name="trash" size={16} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {marks.length === 0 && (
                    <tr>
                      <td colSpan={5} className="muted small">
                        Noch keine Markierung. Unten „Werkzeuge“ öffnen, Pin oder Form wählen und im Plan antippen.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="side-foot">
              <button type="button" className="btn btn-sm" onClick={() => void renumber(planId).then(setMarks)} disabled={!marks.length} data-testid="dp-renumber">
                <Icon name="hash" size={18} /> Lückenlos neu nummerieren
              </button>
              <span className="muted small">Fotos liegen auch in der Fotodokumentation.</span>
            </div>
          </aside>
        </div>
      </div>
      {editing && site && (
        <MarkDialog
          mark={editing}
          site={site}
          photos={sitePhotos}
          onClose={() => {
            setEditing(null);
            if (markId) navigate(paths.defectPlan(planId), true);
          }}
          onSave={(m) => void save(m)}
          onDelete={(m) => void del(m)}
          onView={(ids, index) => viewPhotos(ids, index, `Nr. ${editing.no} · ${kindInfo(editing.kind).label}`)}
          onPhotosAdded={() => void reloadPhotos()}
        />
      )}
      {viewer && <PhotoViewer ids={viewer.ids} index={viewer.index} title={viewer.title} onIndex={(i) => setViewer({ ...viewer, index: i })} onClose={() => setViewer(null)} />}
      {preview && <PdfPreview file={preview} onBack={() => setPreview(null)} onClose={() => setPreview(null)} />}
    </>
  );
}
