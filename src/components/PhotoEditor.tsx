import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { deviceUserName } from './PhotoCapture';
import { showError } from './ui';
import { COLORS } from '../lib/types';

/**
 * Foto bearbeiten (Fotodokumentation): Freihand, Polylinie (offen/geschlossen), Rechteck, Kreis; Darstellung
 * wie beim Plan (Linienfarbe, -stärke, -art, Füllung, Deckkraft). Rückgängig/Wiederholen. Die zuletzt
 * gewählte Darstellung wird je Benutzer gemerkt. Gespeichert wird immer eine Kopie – das Original bleibt.
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

const DEFAULT_STYLE: Style = { color: '#e03131', width: 2, dash: 'solid', fill: false, opacity: 30 };
const TOOLS: { id: Tool; label: string; icon: string }[] = [
  { id: 'select', label: 'Auswahl', icon: 'select' },
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

export function PhotoEditor({ src, width, height, title, onClose, onSave }: { src: string; width: number; height: number; title: string; onClose(): void; onSave(file: Blob): Promise<void> }) {
  const svg = useRef<SVGSVGElement>(null);
  const [tool, setTool] = useState<Tool>('free');
  const [style, setStyle] = useState<Style>(DEFAULT_STYLE);
  const [user, setUser] = useState<string | null>(null);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [past, setPast] = useState<Mark[][]>([]);
  const [future, setFuture] = useState<Mark[][]>([]);
  const [draft, setDraft] = useState<Mark | null>(null);
  const [hover, setHover] = useState<Pt | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const drag = useRef<{ start: Pt; orig: Mark } | null>(null);
  const base = Math.max(width, height) / 400;
  const sw = (s: Style) => base * (s.width === 1 ? 1.5 : s.width === 2 ? 3 : 6);
  const dashOf = (s: Style) => (s.dash === 'dashed' ? `${sw(s) * 4} ${sw(s) * 2.5}` : s.dash === 'dotted' ? `0.1 ${sw(s) * 2.2}` : undefined);

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
    setSelected(null);
  };
  const redo = () => {
    if (!future.length) return;
    setPast((p) => [...p, marks]);
    setMarks(future[0]);
    setFuture((f) => f.slice(1));
  };
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
        else setSelected(null);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) removeSelected();
      else if (e.key === 'Enter' && draft?.type === 'poly') finishPoly(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const sel = marks.find((m) => m.id === selected) ?? null;
  /** Darstellung ändern: gilt für neue Markierungen und die ausgewählte */
  const changeStyle = (patch: Partial<Style>) => {
    const s = { ...style, ...patch };
    setStyle(s);
    remember(s);
    if (sel) commit(marks.map((m) => (m.id === sel.id ? { ...m, style: { ...m.style, ...patch } } : m)));
  };

  const toPt = (e: { clientX: number; clientY: number }): Pt => {
    const el = svg.current!;
    const m = el.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: Math.max(0, Math.min(width, p.x)), y: Math.max(0, Math.min(height, p.y)) };
  };

  const finishPoly = (closed: boolean) => {
    if (!draft || draft.type !== 'poly') return;
    const pts = draft.points;
    if (pts.length >= 2) {
      const m = { ...draft, closed: closed && pts.length >= 3 };
      commit([...marks, m]);
      setSelected(m.id);
    }
    setDraft(null);
    setHover(null);
  };

  const onDown = (e: RPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const p = toPt(e);
    if (tool === 'select') {
      const hit = (e.target as Element).closest('[data-mark]')?.getAttribute('data-mark');
      setSelected(hit ?? null);
      const m = marks.find((x) => x.id === hit);
      if (m) {
        drag.current = { start: p, orig: m };
        svg.current!.setPointerCapture(e.pointerId);
      }
      return;
    }
    if (tool === 'poly') {
      if (!draft) setDraft({ id: newId(), type: 'poly', points: [p], style });
      else {
        // auf den Startpunkt tippen schließt die Polylinie
        const first = draft.points[0];
        if (draft.points.length >= 3 && Math.hypot(first.x - p.x, first.y - p.y) < base * 12) return finishPoly(true);
        setDraft({ ...draft, points: [...draft.points, p] });
      }
      return;
    }
    svg.current!.setPointerCapture(e.pointerId);
    setDraft({ id: newId(), type: tool, points: tool === 'free' ? [p] : [p, p], style });
    setSelected(null);
  };
  const onMove = (e: RPointerEvent<SVGSVGElement>) => {
    const p = toPt(e);
    if (tool === 'select' && drag.current) {
      const { start, orig } = drag.current;
      const dx = p.x - start.x;
      const dy = p.y - start.y;
      setMarks((l) => l.map((m) => (m.id === orig.id ? { ...orig, points: orig.points.map((q) => ({ x: q.x + dx, y: q.y + dy })) } : m)));
      return;
    }
    if (!draft) return;
    if (draft.type === 'poly') return setHover(p);
    if (draft.type === 'free') {
      const last = draft.points[draft.points.length - 1];
      if (Math.hypot(last.x - p.x, last.y - p.y) >= base * 1.5) setDraft({ ...draft, points: [...draft.points, p] });
    } else setDraft({ ...draft, points: [draft.points[0], p] });
  };
  const onUp = () => {
    if (tool === 'select' && drag.current) {
      const { orig } = drag.current;
      drag.current = null;
      const moved = marks.find((m) => m.id === orig.id);
      if (moved && moved.points[0] !== orig.points[0]) {
        setPast((p) => [...p, marks.map((m) => (m.id === orig.id ? orig : m))]);
        setFuture([]);
      }
      return;
    }
    if (!draft || draft.type === 'poly') return;
    const [a, b] = [draft.points[0], draft.points[draft.points.length - 1]];
    const big = Math.hypot(a.x - b.x, a.y - b.y) > base * 3 || draft.points.length > 3;
    if (big) {
      commit([...marks, draft]);
      setSelected(draft.id);
    }
    setDraft(null);
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
    const isSel = m.id === selected;
    return (
      <g key={m.id} {...hitProps} className={isSel ? 'pe-sel' : undefined}>
        {/* breiter unsichtbarer Rand zum Antippen */}
        {!preview &&
          (m.type === 'ellipse' ? (
            <ellipse {...ellipseOf(m)} stroke="transparent" strokeWidth={Math.max(sw(s), base * 14)} fill={fillable(m) && s.fill ? 'transparent' : 'none'} pointerEvents={tool === 'select' ? 'all' : 'none'} />
          ) : (
            <path d={pathOf(m)} stroke="transparent" strokeWidth={Math.max(sw(s), base * 14)} fill={fillable(m) && s.fill ? 'transparent' : 'none'} pointerEvents={tool === 'select' ? 'all' : 'none'} />
          ))}
        {m.type === 'ellipse' ? <ellipse {...ellipseOf(m)} {...common} pointerEvents="none" /> : <path d={pathOf(m)} {...common} pointerEvents="none" />}
        {isSel && <path d={m.type === 'ellipse' ? (() => { const e = ellipseOf(m); return `M${e.cx - e.rx} ${e.cy - e.ry}H${e.cx + e.rx}V${e.cy + e.ry}H${e.cx - e.rx}Z`; })() : pathOf({ ...m, closed: m.closed })} fill="none" stroke="#1c7ed6" strokeWidth={base * 1.2} strokeDasharray={`${base * 4} ${base * 3}`} pointerEvents="none" />}
      </g>
    );
  };

  const polyPreview = draft?.type === 'poly' ? { ...draft, points: hover ? [...draft.points, hover] : draft.points } : draft;

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
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="xMidYMid meet"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onDoubleClick={() => draft?.type === 'poly' && finishPoly(false)}
          data-testid="pe-canvas"
          data-tool={tool}
          data-marks={marks.length}
        >
          <image href={src} x={0} y={0} width={width} height={height} />
          {marks.map((m) => render(m))}
          {polyPreview && render(polyPreview, true)}
        </svg>
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
                setTool(t.id);
                if (t.id !== 'select') setSelected(null);
              }}
              aria-pressed={tool === t.id}
              data-testid={`pe-tool-${t.id}`}
            >
              <Icon name={t.icon} size={20} />
              <span>{t.label}</span>
            </button>
          ))}
          {sel && (
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
        <div className="pe-style" data-testid="pe-style">
          <div className="pe-colors" role="radiogroup" aria-label="Farbe">
            {COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                className={`swatch${(sel?.style.color ?? style.color) === c.value ? ' active' : ''}`}
                style={{ background: c.value }}
                onClick={() => changeStyle({ color: c.value })}
                aria-label={c.name}
                aria-pressed={(sel?.style.color ?? style.color) === c.value}
                data-testid="pe-color"
                data-color={c.value}
              />
            ))}
          </div>
          <div className="pe-style-row">
            <label>
              <span>Stärke</span>
              <select value={(sel?.style ?? style).width} onChange={(e) => changeStyle({ width: Number(e.target.value) as Style['width'] })} data-testid="pe-width">
                <option value={1}>Dünn</option>
                <option value={2}>Mittel</option>
                <option value={3}>Dick</option>
              </select>
            </label>
            <label>
              <span>Linienart</span>
              <select value={(sel?.style ?? style).dash} onChange={(e) => changeStyle({ dash: e.target.value as Dash })} data-testid="pe-dash">
                <option value="solid">Durchgehend</option>
                <option value="dashed">Gestrichelt</option>
                <option value="dotted">Gepunktet</option>
              </select>
            </label>
            <label>
              <span>Füllung</span>
              <select value={(sel?.style ?? style).fill ? '1' : '0'} onChange={(e) => changeStyle({ fill: e.target.value === '1' })} data-testid="pe-fill">
                <option value="0">Nicht ausgefüllt</option>
                <option value="1">Ausgefüllt</option>
              </select>
            </label>
            <label className={(sel?.style ?? style).fill ? '' : 'pe-dim'}>
              <span>Deckkraft {(sel?.style ?? style).opacity} %</span>
              <input type="range" min={10} max={100} step={10} value={(sel?.style ?? style).opacity} onChange={(e) => changeStyle({ opacity: Number(e.target.value) })} disabled={!(sel?.style ?? style).fill} data-testid="pe-opacity" />
            </label>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
