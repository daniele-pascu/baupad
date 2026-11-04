import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { deviceUserName } from './PhotoCapture';
import { showError } from './ui';

/**
 * Foto bearbeiten (Fotodokumentation): Freihand, Polylinie (offen/geschlossen), Rechteck, Kreis; Darstellung
 * wie beim Plan (Linienfarbe, -stärke, -art, Füllung, Deckkraft). Das Foto ist der Untergrund wie ein Plan:
 * zwei Finger bzw. Mausrad zoomen, ein Finger/Maus auf freier Fläche verschiebt. Nach jedem Werkzeug ist wieder
 * die Auswahl aktiv; ausgewählte Formen haben Griffe (Eckpunkte ziehen, Punkte einfügen/entfernen), zwei Finger
 * auf der ausgewählten Form skalieren sie. Rückgängig/Wiederholen. Darstellung je Benutzer gemerkt.
 * Gespeichert wird immer eine Kopie – das Original bleibt.
 */

type Tool = 'select' | 'free' | 'poly' | 'rect' | 'ellipse';
type Dash = 'solid' | 'dashed' | 'dotted';
interface Style {
  color: string;
  width: 1 | 2 | 3;
  dash: Dash;
  fill: boolean;
  /** Deckkraft der Füllung in Prozent */
  opacity: number;
}
interface Pt {
  x: number;
  y: number;
}
interface Mark {
  id: string;
  type: 'free' | 'poly' | 'rect' | 'ellipse';
  points: Pt[];
  closed?: boolean;
  style: Style;
}
interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}

const DEFAULT_STYLE: Style = { color: '#e03131', width: 2, dash: 'solid', fill: false, opacity: 30 };
/** Farben zur Auswahl (dazu eine eigene über den Farbwähler) */
export const EDIT_COLORS: { value: string; name: string }[] = [
  { value: '#1c1c1e', name: 'Schwarz' },
  { value: '#ffffff', name: 'Weiß' },
  { value: '#868e96', name: 'Grau' },
  { value: '#e03131', name: 'Rot' },
  { value: '#a61e4d', name: 'Weinrot' },
  { value: '#e64980', name: 'Pink' },
  { value: '#f76707', name: 'Orange' },
  { value: '#f5b800', name: 'Gelb' },
  { value: '#82c91e', name: 'Hellgrün' },
  { value: '#2f9e44', name: 'Grün' },
  { value: '#0ca678', name: 'Türkis' },
  { value: '#15aabf', name: 'Cyan' },
  { value: '#1c7ed6', name: 'Blau' },
  { value: '#364fc7', name: 'Dunkelblau' },
  { value: '#9c36b5', name: 'Violett' },
  { value: '#8b5a2b', name: 'Braun' },
];
const TOOLS: { id: Exclude<Tool, 'select'>; label: string; icon: string }[] = [
  { id: 'free', label: 'Freihand', icon: 'freehand' },
  { id: 'poly', label: 'Polylinie', icon: 'polyline' },
  { id: 'rect', label: 'Rechteck', icon: 'rect' },
  { id: 'ellipse', label: 'Kreis', icon: 'ellipse' },
];
const styleKey = (user: string) => `photoEditStyle:${user || 'gerät'}`;
let seq = 0;
const newId = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Pfad (SVG-Syntax) einer Markierung; Kreis/Ellipse separat */
function pathOf(m: Mark): string {
  const p = m.points;
  if (m.type === 'rect') {
    const [a, b] = p;
    return `M${a.x} ${a.y}H${b.x}V${b.y}H${a.x}Z`;
  }
  return p.map((q, i) => `${i ? 'L' : 'M'}${q.x} ${q.y}`).join('') + (m.closed ? 'Z' : '');
}
const ellipseOf = (m: Mark) => {
  const [a, b] = m.points;
  return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, rx: Math.abs(b.x - a.x) / 2, ry: Math.abs(b.y - a.y) / 2 };
};
const fillable = (m: Mark) => m.type === 'rect' || m.type === 'ellipse' || (m.type === 'poly' && !!m.closed) || (m.type === 'free' && !!m.closed);
/** Ecken eines Rechtecks bzw. des Rahmens einer Ellipse (im Uhrzeigersinn) */
const cornersOf = (m: Mark): Pt[] => {
  const [a, b] = m.points;
  return [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
};
const bboxOf = (pts: Pt[]) => {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
};

/** Griff eines ausgewählten Objekts: Eckpunkt (v), Ecke (c) oder Mitte einer Kante zum Einfügen (m) */
type Handle = { kind: 'v' | 'c' | 'm'; i: number; at: Pt };
function handlesOf(m: Mark): Handle[] {
  if (m.type === 'rect' || m.type === 'ellipse') return cornersOf(m).map((at, i) => ({ kind: 'c', i, at }));
  if (m.type !== 'poly') return [];
  const pts = m.points;
  const hs: Handle[] = pts.map((at, i) => ({ kind: 'v', i, at }));
  const segs = m.closed ? pts.length : pts.length - 1;
  for (let i = 0; i < segs; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    hs.push({ kind: 'm', i, at: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } });
  }
  return hs;
}

type Drag =
  | { kind: 'move'; start: Pt; orig: Mark; moved: boolean }
  | { kind: 'handle'; h: Handle; orig: Mark; id: string; moved: boolean }
  | { kind: 'pan'; sx: number; sy: number; v0: View; moved: boolean };

export function PhotoEditor({ src, width, height, title, onClose, onSave }: { src: string; width: number; height: number; title: string; onClose(): void; onSave(file: Blob): Promise<void> }) {
  const svg = useRef<SVGSVGElement>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [style, setStyle] = useState<Style>(DEFAULT_STYLE);
  const [user, setUser] = useState<string | null>(null);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [past, setPast] = useState<Mark[][]>([]);
  const [future, setFuture] = useState<Mark[][]>([]);
  const [draft, setDraft] = useState<Mark | null>(null);
  const [hover, setHover] = useState<Pt | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const full: View = { x: 0, y: 0, w: width, h: height };
  const [view, setView] = useState<View>(full);
  const viewRef = useRef(view);
  viewRef.current = view;
  const drag = useRef<Drag | null>(null);
  /** aktive Finger (für zwei Finger: Zoom bzw. Form skalieren) */
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d0: number; mid: { x: number; y: number }; v0: View; anchor: Pt; scale?: { orig: Mark; c: Pt } } | null>(null);
  const lastPolyAdd = useRef(0);
  /** letztes Antippen eines Eckpunkts (Doppeltippen entfernt ihn) */
  const lastHandleTap = useRef<{ key: string; t: number } | null>(null);
  const base = Math.max(width, height) / 400;
  const sw = (s: Style) => base * (s.width === 1 ? 1.5 : s.width === 2 ? 3 : 6);
  const dashOf = (s: Style) => (s.dash === 'dashed' ? `${sw(s) * 4} ${sw(s) * 2.5}` : s.dash === 'dotted' ? `0.1 ${sw(s) * 2.2}` : undefined);
  /** Bildeinheiten je Bildschirmpixel (für gleich große Griffe bei jedem Zoom) */
  const [unit, setUnit] = useState(1);
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width && r.height) setUnit(Math.max(view.w / r.width, view.h / r.height));
  }, [view]);

  // zuletzt benutzte Darstellung je Benutzer
  useEffect(() => {
    void deviceUserName().then((u) => {
      setUser(u);
      try {
        const raw = localStorage.getItem(styleKey(u));
        if (raw) setStyle({ ...DEFAULT_STYLE, ...(JSON.parse(raw) as Partial<Style>) });
      } catch {
        /* egal */
      }
    });
  }, []);
  const remember = (s: Style) => {
    if (user === null) return;
    try {
      localStorage.setItem(styleKey(user), JSON.stringify(s));
    } catch {
      /* egal */
    }
  };

  const commit = (next: Mark[]) => {
    setPast((p) => [...p, marks]);
    setFuture([]);
    setMarks(next);
  };
  const undo = () => {
    if (draft) return setDraft(null);
    if (!past.length) return;
    setFuture((f) => [marks, ...f]);
    setMarks(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
  };
  const redo = () => {
    if (!future.length) return;
    setPast((p) => [...p, marks]);
    setMarks(future[0]);
    setFuture((f) => f.slice(1));
  };

  /* ───── Ansicht: Zoom und Verschieben ───── */
  const clampView = (v: View): View => {
    const w = Math.min(width, Math.max(width / 25, v.w));
    const h = (w * height) / width;
    return { w, h, x: Math.min(width - w, Math.max(0, v.x)), y: Math.min(height - h, Math.max(0, v.y)) };
  };
  /** Bildschirm → Bildkoordinaten für eine bestimmte Ansicht (Bild wird eingepasst und mittig gezeigt) */
  const screenToImage = (sx: number, sy: number, v: View): Pt => {
    const r = svg.current!.getBoundingClientRect();
    const s = Math.min(r.width / v.w, r.height / v.h);
    const ox = (r.width - v.w * s) / 2;
    const oy = (r.height - v.h * s) / 2;
    return { x: v.x + (sx - r.left - ox) / s, y: v.y + (sy - r.top - oy) / s };
  };
  /** Ansicht so, dass der Bildpunkt `anchor` unter dem Bildschirmpunkt (sx, sy) liegt */
  const viewAt = (anchor: Pt, sx: number, sy: number, w: number): View => {
    const h = (w * height) / width;
    const r = svg.current!.getBoundingClientRect();
    const s = Math.min(r.width / w, r.height / h);
    const ox = (r.width - w * s) / 2;
    const oy = (r.height - h * s) / 2;
    return clampView({ w, h, x: anchor.x - (sx - r.left - ox) / s, y: anchor.y - (sy - r.top - oy) / s });
  };
  const zoomBy = (f: number, sx?: number, sy?: number) => {
    const v = viewRef.current;
    const r = svg.current!.getBoundingClientRect();
    const cx = sx ?? r.left + r.width / 2;
    const cy = sy ?? r.top + r.height / 2;
    setView(viewAt(screenToImage(cx, cy, v), cx, cy, v.w / f));
  };
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0022)), e.clientX, e.clientY);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (e.key === 'Escape') {
        if (draft?.type === 'poly') finishPoly(false);
        else if (tool !== 'select') setTool('select');
        else setSelected(null);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) removeSelected();
      else if (e.key === 'Enter' && draft?.type === 'poly') finishPoly(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const sel = marks.find((m) => m.id === selected) ?? null;
  const shown = sel?.style ?? style;
  /** Darstellung ändern: gilt für neue Markierungen und die ausgewählte */
  const changeStyle = (patch: Partial<Style>) => {
    const s = { ...style, ...patch };
    setStyle(s);
    remember(s);
    if (sel) commit(marks.map((m) => (m.id === sel.id ? { ...m, style: { ...m.style, ...patch } } : m)));
  };

  const toPt = (e: { clientX: number; clientY: number }): Pt => {
    const p = screenToImage(e.clientX, e.clientY, viewRef.current);
    return { x: Math.max(0, Math.min(width, p.x)), y: Math.max(0, Math.min(height, p.y)) };
  };

  /** nach jedem Werkzeug wieder Auswahl, die neue Form ausgewählt */
  const done = (m: Mark | null) => {
    if (m) setSelected(m.id);
    setTool('select');
  };
  const finishPoly = (closed: boolean) => {
    if (!draft || draft.type !== 'poly') return;
    const pts = draft.points;
    let m: Mark | null = null;
    if (pts.length >= 2) {
      m = { ...draft, closed: closed && pts.length >= 3 };
      commit([...marks, m]);
    }
    setDraft(null);
    setHover(null);
    done(m);
  };

  const startPinch = () => {
    const [a, b] = [...touches.current.values()];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const anchor = screenToImage(mid.x, mid.y, viewRef.current);
    // zwei Finger auf der ausgewählten Form: Form vergrößern/verkleinern, sonst Ansicht zoomen
    let scale: { orig: Mark; c: Pt } | undefined;
    if (sel && tool === 'select') {
      const bb = bboxOf(sel.points);
      const pad = unit * 30;
      const pa = screenToImage(a.x, a.y, viewRef.current);
      const pb = screenToImage(b.x, b.y, viewRef.current);
      const inside = (p: Pt) => p.x >= bb.x0 - pad && p.x <= bb.x1 + pad && p.y >= bb.y0 - pad && p.y <= bb.y1 + pad;
      if (inside(pa) && inside(pb)) scale = { orig: sel, c: { x: (bb.x0 + bb.x1) / 2, y: (bb.y0 + bb.y1) / 2 } };
    }
    pinch.current = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid, v0: viewRef.current, anchor, scale };
    // angefangenes Zeichnen mit dem ersten Finger verwerfen
    drag.current = null;
    if (draft && draft.type !== 'poly') setDraft(null);
    if (draft?.type === 'poly' && Date.now() - lastPolyAdd.current < 400) setDraft(draft.points.length > 1 ? { ...draft, points: draft.points.slice(0, -1) } : null);
  };

  const onDown = (e: RPointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.current.size === 2) return startPinch();
      if (touches.current.size > 2) return;
    }
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const p = toPt(e);
    if (tool === 'select') {
      const target = e.target as Element;
      const hEl = target.closest('[data-handle]');
      if (hEl && sel) {
        const [kind, i] = (hEl.getAttribute('data-handle') ?? '').split(':');
        const h = handlesOf(sel).find((x) => x.kind === kind && x.i === Number(i));
        if (h) {
          // Doppeltippen auf einen Eckpunkt: entfernen (mind. 2 bzw. 3 Punkte bleiben)
          const key = `${sel.id}:${h.kind}:${h.i}`;
          const now = Date.now();
          if (h.kind === 'v' && lastHandleTap.current?.key === key && now - lastHandleTap.current.t < 400) {
            lastHandleTap.current = null;
            if (sel.points.length > (sel.closed ? 3 : 2)) commit(marks.map((x) => (x.id === sel.id ? { ...x, points: x.points.filter((_, j) => j !== h.i) } : x)));
            return;
          }
          lastHandleTap.current = { key, t: now };
          let m = sel;
          let hh = h;
          // Mitte einer Kante: neuen Eckpunkt einfügen und gleich ziehen
          if (h.kind === 'm') {
            const pts = [...sel.points];
            pts.splice(h.i + 1, 0, h.at);
            m = { ...sel, points: pts };
            setMarks((l) => l.map((x) => (x.id === sel.id ? m : x)));
            hh = { kind: 'v', i: h.i + 1, at: h.at };
          }
          drag.current = { kind: 'handle', h: hh, orig: sel, id: sel.id, moved: h.kind === 'm' };
          svg.current!.setPointerCapture(e.pointerId);
          return;
        }
      }
      const hit = target.closest('[data-mark]')?.getAttribute('data-mark') ?? null;
      const m = marks.find((x) => x.id === hit);
      if (m) {
        setSelected(m.id);
        drag.current = { kind: 'move', start: p, orig: m, moved: false };
      } else drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, v0: viewRef.current, moved: false };
      svg.current!.setPointerCapture(e.pointerId);
      return;
    }
    if (tool === 'poly') {
      lastPolyAdd.current = Date.now();
      if (!draft) setDraft({ id: newId(), type: 'poly', points: [p], style });
      else {
        // auf den Startpunkt tippen schließt die Polylinie
        const first = draft.points[0];
        if (draft.points.length >= 3 && Math.hypot(first.x - p.x, first.y - p.y) < unit * 22) return finishPoly(true);
        setDraft({ ...draft, points: [...draft.points, p] });
      }
      return;
    }
    svg.current!.setPointerCapture(e.pointerId);
    setDraft({ id: newId(), type: tool, points: tool === 'free' ? [p] : [p, p], style });
    setSelected(null);
  };

  const onMove = (e: RPointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const pc = pinch.current;
      if (pc && touches.current.size >= 2) {
        const [a, b] = [...touches.current.values()];
        const f = Math.hypot(a.x - b.x, a.y - b.y) / pc.d0;
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (pc.scale) {
          const { orig, c } = pc.scale;
          const pts = orig.points.map((q) => ({ x: c.x + (q.x - c.x) * f, y: c.y + (q.y - c.y) * f }));
          setMarks((l) => l.map((m) => (m.id === orig.id ? { ...orig, points: pts } : m)));
        } else setView(viewAt(pc.anchor, mid.x, mid.y, pc.v0.w / f));
        return;
      }
    }
    const p = toPt(e);
    const d = drag.current;
    if (d?.kind === 'pan') {
      const dx = e.clientX - d.sx;
      const dy = e.clientY - d.sy;
      if (Math.hypot(dx, dy) > 4) d.moved = true;
      if (d.moved) {
        const r = svg.current!.getBoundingClientRect();
        const s = Math.min(r.width / d.v0.w, r.height / d.v0.h);
        setView(clampView({ ...d.v0, x: d.v0.x - dx / s, y: d.v0.y - dy / s }));
      }
      return;
    }
    if (d?.kind === 'move') {
      const dx = p.x - d.start.x;
      const dy = p.y - d.start.y;
      if (Math.hypot(dx, dy) > unit * 3) d.moved = true;
      if (d.moved) setMarks((l) => l.map((m) => (m.id === d.orig.id ? { ...d.orig, points: d.orig.points.map((q) => ({ x: q.x + dx, y: q.y + dy })) } : m)));
      return;
    }
    if (d?.kind === 'handle') {
      d.moved = true;
      setMarks((l) =>
        l.map((m) => {
          if (m.id !== d.id) return m;
          if (d.h.kind === 'c') {
            // Ecke ziehen: gegenüberliegende Ecke bleibt
            const opp = cornersOf(d.orig)[(d.h.i + 2) % 4];
            return { ...m, points: [opp, p] };
          }
          const pts = [...m.points];
          pts[d.h.i] = p;
          return { ...m, points: pts };
        }),
      );
      return;
    }
    if (!draft) return;
    if (draft.type === 'poly') return setHover(p);
    if (draft.type === 'free') {
      const last = draft.points[draft.points.length - 1];
      if (Math.hypot(last.x - p.x, last.y - p.y) >= unit * 2) setDraft({ ...draft, points: [...draft.points, p] });
    } else setDraft({ ...draft, points: [draft.points[0], p] });
  };

  const onUp = (e: RPointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'touch') {
      touches.current.delete(e.pointerId);
      if (pinch.current) {
        if (touches.current.size < 2) {
          const sc = pinch.current.scale;
          if (sc) {
            setPast((p) => [...p, marks.map((m) => (m.id === sc.orig.id ? sc.orig : m))]);
            setFuture([]);
          }
          pinch.current = null;
        }
        return;
      }
    }
    const d = drag.current;
    if (d) {
      drag.current = null;
      if (d.kind === 'pan') {
        // Antippen der freien Fläche hebt die Auswahl auf
        if (!d.moved) setSelected(null);
        return;
      }
      const changed = d.moved;
      if (changed) {
        setPast((p) => [...p, marks.map((m) => (m.id === d.orig.id ? d.orig : m))]);
        setFuture([]);
      }
      return;
    }
    if (!draft || draft.type === 'poly') return;
    const [a, b] = [draft.points[0], draft.points[draft.points.length - 1]];
    const big = Math.hypot(a.x - b.x, a.y - b.y) > unit * 6 || draft.points.length > 3;
    setDraft(null);
    if (big) {
      commit([...marks, draft]);
      done(draft);
    } else done(null);
  };

  /** Doppelklick beendet eine Polylinie (offen) */
  const onDouble = () => {
    if (draft?.type === 'poly') finishPoly(false);
  };

  const removeSelected = () => {
    if (!sel) return;
    commit(marks.filter((m) => m.id !== sel.id));
    setSelected(null);
  };
  const toggleClosed = () => {
    if (!sel || (sel.type !== 'poly' && sel.type !== 'free')) return;
    commit(marks.map((m) => (m.id === sel.id ? { ...m, closed: !m.closed } : m)));
  };

  const save = async () => {
    setBusy(true);
    try {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = width;
      c.height = height;
      const g = c.getContext('2d')!;
      g.drawImage(img, 0, 0, width, height);
      for (const m of marks) {
        const s = m.style;
        g.lineWidth = sw(s);
        g.lineCap = 'round';
        g.lineJoin = 'round';
        g.strokeStyle = s.color;
        const d = dashOf(s);
        g.setLineDash(d ? d.split(' ').map(Number) : []);
        const path = new Path2D();
        if (m.type === 'ellipse') {
          const el = ellipseOf(m);
          path.ellipse(el.cx, el.cy, Math.max(el.rx, 0.5), Math.max(el.ry, 0.5), 0, 0, Math.PI * 2);
        } else path.addPath(new Path2D(pathOf(m)));
        if (s.fill && fillable(m)) {
          g.globalAlpha = s.opacity / 100;
          g.fillStyle = s.color;
          g.fill(path);
          g.globalAlpha = 1;
        }
        g.stroke(path);
      }
      const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', 0.92));
      if (!blob) throw new Error('Bild konnte nicht erstellt werden.');
      await onSave(blob);
    } catch (e) {
      showError(e, 'Bearbeitetes Foto konnte nicht gespeichert werden');
    } finally {
      setBusy(false);
    }
  };

  const render = (m: Mark, preview = false) => {
    const s = m.style;
    const common = {
      stroke: s.color,
      strokeWidth: sw(s),
      strokeDasharray: dashOf(s),
      strokeLinecap: 'round' as const,
      strokeLinejoin: 'round' as const,
      fill: s.fill && fillable(m) ? s.color : 'none',
      fillOpacity: s.opacity / 100,
    };
    const hitProps = preview ? {} : { 'data-mark': m.id };
    const hitW = Math.max(sw(s), unit * 24);
    const active = tool === 'select' && !preview;
    return (
      <g key={m.id} {...hitProps}>
        {/* breiter unsichtbarer Rand zum Antippen */}
        {!preview &&
          (m.type === 'ellipse' ? (
            <ellipse {...ellipseOf(m)} stroke="transparent" strokeWidth={hitW} fill={fillable(m) && s.fill ? 'transparent' : 'none'} pointerEvents={active ? 'all' : 'none'} />
          ) : (
            <path d={pathOf(m)} stroke="transparent" strokeWidth={hitW} fill={fillable(m) && s.fill ? 'transparent' : 'none'} pointerEvents={active ? 'all' : 'none'} />
          ))}
        {m.type === 'ellipse' ? <ellipse {...ellipseOf(m)} {...common} pointerEvents="none" /> : <path d={pathOf(m)} {...common} pointerEvents="none" />}
      </g>
    );
  };

  const selOutline = (m: Mark) => {
    const pts = m.type === 'ellipse' || m.type === 'rect' ? cornersOf(m) : m.points;
    const bb = bboxOf(pts);
    const pad = unit * 6;
    return <rect x={bb.x0 - pad} y={bb.y0 - pad} width={bb.x1 - bb.x0 + 2 * pad} height={bb.y1 - bb.y0 + 2 * pad} fill="none" stroke="#1c7ed6" strokeWidth={unit * 1.5} strokeDasharray={`${unit * 6} ${unit * 4}`} pointerEvents="none" />;
  };

  const polyPreview = draft?.type === 'poly' ? { ...draft, points: hover ? [...draft.points, hover] : draft.points } : draft;
  const zoomed = view.w < width - 0.5;

  return createPortal(
    <div className="photo-editor" data-testid="photo-editor">
      <header className="pe-top">
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Abbrechen" data-testid="pe-cancel">
          <Icon name="close" />
        </button>
        <strong className="pe-title">{title}</strong>
        <button type="button" className="icon-btn" onClick={undo} disabled={!past.length && !draft} aria-label="Rückgängig" title="Rückgängig (Strg+Z)" data-testid="pe-undo">
          <Icon name="undo" />
        </button>
        <button type="button" className="icon-btn" onClick={redo} disabled={!future.length} aria-label="Wiederholen" title="Wiederholen (Strg+Y)" data-testid="pe-redo">
          <Icon name="redo" />
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void save()} disabled={busy || !marks.length} title="Als Kopie speichern – das Original bleibt unverändert" data-testid="pe-save">
          <Icon name="save" size={16} /> {busy ? 'Speichert …' : 'Als Kopie speichern'}
        </button>
      </header>
      <div className="pe-stage">
        <svg
          ref={svg}
          viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
          preserveAspectRatio="xMidYMid meet"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onDoubleClick={onDouble}
          data-testid="pe-canvas"
          data-tool={tool}
          data-marks={marks.length}
          data-zoom={(width / view.w).toFixed(2)}
        >
          <image href={src} x={0} y={0} width={width} height={height} />
          {marks.map((m) => render(m))}
          {polyPreview && render(polyPreview, true)}
          {sel && tool === 'select' && (
            <g data-testid="pe-handles">
              {selOutline(sel)}
              {handlesOf(sel).map((h) => (
                <circle
                  key={`${h.kind}${h.i}`}
                  cx={h.at.x}
                  cy={h.at.y}
                  r={unit * (h.kind === 'm' ? 6 : 9)}
                  fill={h.kind === 'm' ? 'rgba(255,255,255,0.75)' : '#fff'}
                  stroke="#1c7ed6"
                  strokeWidth={unit * 2}
                  data-handle={`${h.kind}:${h.i}`}
                  data-testid={h.kind === 'm' ? 'pe-handle-mid' : 'pe-handle'}
                  style={{ cursor: h.kind === 'm' ? 'copy' : 'grab' }}
                />
              ))}
            </g>
          )}
        </svg>
        <div className="pe-zoom" role="group" aria-label="Ansicht">
          <button type="button" className="icon-btn" onClick={() => zoomBy(1 / 1.5)} disabled={!zoomed} aria-label="Verkleinern" data-testid="pe-zoom-out">
            <Icon name="minus" />
          </button>
          <button type="button" className="icon-btn" onClick={() => setView(full)} disabled={!zoomed} aria-label="Ganzes Foto" title="Ganzes Foto" data-testid="pe-zoom-fit">
            <Icon name="fit" />
          </button>
          <button type="button" className="icon-btn" onClick={() => zoomBy(1.5)} aria-label="Vergrößern" data-testid="pe-zoom-in">
            <Icon name="plus" />
          </button>
        </div>
        {draft?.type === 'poly' && (
          <div className="pe-polybar" data-testid="pe-polybar">
            <span>{draft.points.length} Punkte</span>
            <button type="button" className="btn btn-sm" onClick={() => finishPoly(false)} data-testid="pe-poly-open">
              Fertig (offen)
            </button>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => finishPoly(true)} disabled={draft.points.length < 3} data-testid="pe-poly-close">
              Schließen
            </button>
          </div>
        )}
      </div>
      <div className="pe-panel">
        <div className="pe-tools" role="toolbar" aria-label="Werkzeuge">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`pe-tool${tool === t.id ? ' active' : ''}`}
              onClick={() => {
                if (draft?.type === 'poly') finishPoly(false);
                // nochmal antippen: zurück zur Auswahl
                setTool(tool === t.id ? 'select' : t.id);
                setSelected(null);
              }}
              aria-pressed={tool === t.id}
              data-testid={`pe-tool-${t.id}`}
            >
              <Icon name={t.icon} size={20} />
              <span>{t.label}</span>
            </button>
          ))}
          {sel && tool === 'select' && (
            <>
              {(sel.type === 'poly' || sel.type === 'free') && (
                <button type="button" className={`pe-tool${sel.closed ? ' active' : ''}`} onClick={toggleClosed} data-testid="pe-toggle-closed" title="Polylinie offen oder geschlossen">
                  <Icon name="polygon" size={20} />
                  <span>{sel.closed ? 'Geschlossen' : 'Offen'}</span>
                </button>
              )}
              <button type="button" className="pe-tool danger" onClick={removeSelected} data-testid="pe-delete">
                <Icon name="trash" size={20} />
                <span>Löschen</span>
              </button>
            </>
          )}
        </div>
        {sel?.type === 'poly' && tool === 'select' && <p className="pe-hint">Eckpunkte ziehen · kleine Punkte in der Mitte: neuer Eckpunkt · Doppeltippen auf einen Eckpunkt: entfernen · zwei Finger auf der Form: größer/kleiner</p>}
        <div className="pe-style" data-testid="pe-style">
          <div className="pe-colors" role="radiogroup" aria-label="Farbe">
            {EDIT_COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                className={`swatch${shown.color === c.value ? ' active' : ''}`}
                style={{ background: c.value }}
                onClick={() => changeStyle({ color: c.value })}
                aria-label={c.name}
                title={c.name}
                aria-pressed={shown.color === c.value}
                data-testid="pe-color"
                data-color={c.value}
              />
            ))}
            <label className={`swatch pe-custom${EDIT_COLORS.some((c) => c.value === shown.color) ? '' : ' active'}`} title="Eigene Farbe" style={EDIT_COLORS.some((c) => c.value === shown.color) ? undefined : { background: shown.color }}>
              <input type="color" value={shown.color} onChange={(e) => changeStyle({ color: e.target.value })} aria-label="Eigene Farbe" data-testid="pe-color-custom" />
              <span aria-hidden="true">+</span>
            </label>
          </div>
          <div className="pe-style-row">
            <label>
              <span>Stärke</span>
              <select value={shown.width} onChange={(e) => changeStyle({ width: Number(e.target.value) as Style['width'] })} data-testid="pe-width">
                <option value={1}>Dünn</option>
                <option value={2}>Mittel</option>
                <option value={3}>Dick</option>
              </select>
            </label>
            <label>
              <span>Linienart</span>
              <select value={shown.dash} onChange={(e) => changeStyle({ dash: e.target.value as Dash })} data-testid="pe-dash">
                <option value="solid">Durchgehend</option>
                <option value="dashed">Gestrichelt</option>
                <option value="dotted">Gepunktet</option>
              </select>
            </label>
            <label>
              <span>Füllung</span>
              <select value={shown.fill ? '1' : '0'} onChange={(e) => changeStyle({ fill: e.target.value === '1' })} data-testid="pe-fill">
                <option value="0">Nicht ausgefüllt</option>
                <option value="1">Ausgefüllt</option>
              </select>
            </label>
            <label className={shown.fill ? '' : 'pe-dim'}>
              <span>Deckkraft {shown.opacity} %</span>
              <input type="range" min={10} max={100} step={10} value={shown.opacity} onChange={(e) => changeStyle({ opacity: Number(e.target.value) })} disabled={!shown.fill} data-testid="pe-opacity" />
            </label>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
