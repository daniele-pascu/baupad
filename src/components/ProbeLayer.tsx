import { toScreen, type Point, type View } from '../lib/geometry';
import { formatProbe, PROBE_KINDS, probeResult, type ProbeKind, type ProbeResult } from '../lib/probe';
import { Icon } from './Icon';

/** Laufende bzw. fertige Kontrollmessung (wird nicht gespeichert) */
export interface ProbeState {
  kind: ProbeKind;
  points: Point[];
  /** fertig: Ergebnis steht, der nächste Punkt beginnt eine neue Messung */
  done: boolean;
  /** Bezugslinie für den senkrechten Abstand (ausgewählte Linie) */
  ref?: [Point, Point] | null;
  /** aus einem bestehenden Objekt gemessen (Fläche/Länge/Radius) */
  fromObject?: string | null;
}

/** Ergebnis mit der Vorschau zur Maus (solange die Messung läuft) */
export function liveProbe(probe: ProbeState, k: number | null, hover: Point | null): ProbeResult | null {
  if (probe.kind !== 'angle' && !k) return null;
  const pts = !probe.done && hover && probe.kind !== 'area' ? [...probe.points, hover] : probe.points;
  const areaPts = !probe.done && hover && probe.kind === 'area' ? [...probe.points, hover] : pts;
  return probeResult(probe.kind, probe.kind === 'area' ? areaPts : pts, k ?? 1, probe.ref);
}

/** Darstellung im Plan: Strecken, Punkte (bestätigt grün), Winkelbogen, Kreis, waagrecht/senkrecht, Ergebnis-Schild */
export function ProbeOverlay({ view, probe, hover, k }: { view: View; probe: ProbeState; hover: Point | null; k: number | null }) {
  const S = (p: Point) => toScreen(view, p);
  const live = !probe.done && hover ? hover : null;
  const pts = live ? [...probe.points, live] : probe.points;
  const sp = pts.map(S);
  const r = liveProbe(probe, k, hover);
  const text = r ? formatProbe(r).main : null;
  let anchor: Point | null = sp.length ? sp[sp.length - 1] : null;
  const parts: React.ReactNode[] = [];
  if (probe.kind === 'length' || probe.kind === 'area' || probe.kind === 'distance') {
    if (probe.kind === 'distance' && probe.ref && r?.kind === 'distance' && r.foot && sp.length) {
      const a = S(probe.ref[0]);
      const b = S(probe.ref[1]);
      const f = S(r.foot);
      parts.push(<line key="ref" x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="probe-ref" />);
      parts.push(<line key="perp" x1={sp[0].x} y1={sp[0].y} x2={f.x} y2={f.y} className="probe-line" />);
      anchor = { x: (sp[0].x + f.x) / 2, y: (sp[0].y + f.y) / 2 };
    } else if (sp.length >= 2) {
      const closed = probe.kind === 'area';
      parts.push(
        closed ? (
          <polygon key="poly" points={sp.map((q) => `${q.x},${q.y}`).join(' ')} className="probe-area" />
        ) : (
          <polyline key="poly" points={sp.map((q) => `${q.x},${q.y}`).join(' ')} className="probe-line" />
        ),
      );
      if (probe.kind === 'distance' && sp.length === 2) {
        // waagrechter und senkrechter Anteil gestrichelt
        parts.push(<polyline key="xy" points={`${sp[0].x},${sp[0].y} ${sp[1].x},${sp[0].y} ${sp[1].x},${sp[1].y}`} className="probe-legs" />);
      }
      anchor = probe.kind === 'area' ? { x: sp.reduce((s, q) => s + q.x, 0) / sp.length, y: sp.reduce((s, q) => s + q.y, 0) / sp.length } : { x: (sp[sp.length - 2].x + sp[sp.length - 1].x) / 2, y: (sp[sp.length - 2].y + sp[sp.length - 1].y) / 2 };
    }
  }
  if (probe.kind === 'angle' && sp.length >= 2) {
    parts.push(<polyline key="legs" points={sp.map((q) => `${q.x},${q.y}`).join(' ')} className="probe-line" />);
    if (sp.length === 3) {
      // Bogen am Scheitel zeigt den gemessenen Winkelbereich
      const [a, b, c] = sp;
      const rad = Math.min(36, Math.hypot(a.x - b.x, a.y - b.y) / 2, Math.hypot(c.x - b.x, c.y - b.y) / 2);
      const a1 = Math.atan2(a.y - b.y, a.x - b.x);
      const a2 = Math.atan2(c.y - b.y, c.x - b.x);
      let d = a2 - a1;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      const p1 = { x: b.x + rad * Math.cos(a1), y: b.y + rad * Math.sin(a1) };
      const p2 = { x: b.x + rad * Math.cos(a1 + d), y: b.y + rad * Math.sin(a1 + d) };
      parts.push(<path key="arc" d={`M${b.x} ${b.y}L${p1.x} ${p1.y}A${rad} ${rad} 0 0 ${d > 0 ? 1 : 0} ${p2.x} ${p2.y}Z`} className="probe-angle" data-testid="probe-angle-arc" />);
      const mid = a1 + d / 2;
      anchor = { x: b.x + (rad + 26) * Math.cos(mid), y: b.y + (rad + 18) * Math.sin(mid) };
    }
  }
  if (probe.kind === 'radius' && sp.length >= 2) {
    const [c, q] = sp;
    const rr = Math.hypot(q.x - c.x, q.y - c.y);
    parts.push(<circle key="circle" cx={c.x} cy={c.y} r={rr} className="probe-circle" />);
    parts.push(<line key="r" x1={c.x} y1={c.y} x2={q.x} y2={q.y} className="probe-line" />);
    anchor = { x: (c.x + q.x) / 2, y: (c.y + q.y) / 2 };
  }
  const tw = text ? text.length * 7.4 + 16 : 0;
  return (
    <g className="probe" data-testid="probe-overlay" pointerEvents="none">
      {parts}
      {probe.points.map((p, i) => {
        const q = S(p);
        // gesetzte (bestätigte) Punkte grün
        return <circle key={i} cx={q.x} cy={q.y} r={i === 0 && probe.kind === 'area' && !probe.done ? 7 : 5} className="probe-point" />;
      })}
      {live && (() => {
        const q = S(live);
        return <circle cx={q.x} cy={q.y} r={4} className="probe-next" />;
      })()}
      {text && anchor && (
        <g transform={`translate(${anchor.x + 10} ${anchor.y - 26})`} data-testid="probe-label">
          <rect width={tw} height={20} rx={10} className="probe-tag" />
          <text x={tw / 2} y={14} textAnchor="middle">
            {text}
          </text>
        </g>
      )}
    </g>
  );
}

/** Leiste der Messung: Messart, Hinweis bzw. Ergebnis, Fertig/Neu, ins Aufmaß übernehmen, beenden */
export function ProbeBar({
  probe,
  k,
  onKind,
  onFinish,
  onUndo,
  onReset,
  onAdopt,
  onClose,
}: {
  probe: ProbeState;
  k: number | null;
  onKind(kind: ProbeKind): void;
  onFinish(): void;
  onUndo(): void;
  onReset(): void;
  /** nur Länge und Fläche: als normale Messung ins Aufmaß übernehmen */
  onAdopt(): void;
  onClose(): void;
}) {
  const r = liveProbe(probe, k, null);
  const info = PROBE_KINDS.find((x) => x.id === probe.kind)!;
  const f = r ? formatProbe(r) : null;
  const needsScale = probe.kind !== 'angle' && !k;
  const canFinish = !probe.done && ((probe.kind === 'length' && probe.points.length >= 2) || (probe.kind === 'area' && probe.points.length >= 3));
  return (
    <div className="draw-bar probe-bar" data-testid="probe-bar">
      <div className="segmented probe-kinds" role="radiogroup" aria-label="Messart">
        {PROBE_KINDS.map((x) => (
          <button key={x.id} type="button" role="radio" aria-checked={probe.kind === x.id} aria-selected={probe.kind === x.id} onClick={() => onKind(x.id)} data-testid={`probe-kind-${x.id}`}>
            {x.label}
          </button>
        ))}
      </div>
      {needsScale ? (
        <span className="small error" data-testid="probe-needs-scale">
          Plan ist nicht kalibriert – zuerst „Kalibrieren“, dann {info.label.toLowerCase()} messen.
        </span>
      ) : f && (probe.done || probe.points.length >= (probe.kind === 'distance' && probe.ref ? 1 : 2)) ? (
        <span className="probe-result" data-testid="probe-result">
          <strong>{f.main}</strong>
          {f.extra && <span className="muted small"> · {f.extra}</span>}
          {!probe.done && <span className="muted small"> (läuft)</span>}
        </span>
      ) : (
        <span className="muted small" data-testid="probe-hint">
          {probe.kind === 'distance' && probe.ref ? 'Punkt auf der zweiten Linie antippen – senkrechter Abstand zur ausgewählten Linie.' : info.hint}
        </span>
      )}
      <div className="row gap">
        {canFinish && (
          <button type="button" className="btn btn-sm btn-primary" onClick={onFinish} data-testid="probe-finish">
            <Icon name="check" size={18} /> Fertig
          </button>
        )}
        {!probe.done && probe.points.length > 0 && (
          <button type="button" className="btn btn-sm" onClick={onUndo} title="Letzten Punkt entfernen (Rücktaste)" data-testid="probe-undo">
            <Icon name="undo" size={18} /> Punkt
          </button>
        )}
        {probe.done && (probe.kind === 'length' || probe.kind === 'area') && !probe.fromObject && r && (
          <button type="button" className="btn btn-sm" onClick={onAdopt} title="Als Messung ins Aufmaß übernehmen" data-testid="probe-adopt">
            <Icon name="table" size={18} /> Ins Aufmaß
          </button>
        )}
        {(probe.done || probe.points.length > 0) && (
          <button type="button" className="btn btn-sm" onClick={onReset} data-testid="probe-reset">
            Neu
          </button>
        )}
        <button type="button" className="icon-btn icon-btn-sm" onClick={onClose} aria-label="Messung beenden" data-testid="probe-close">
          <Icon name="close" size={18} />
        </button>
      </div>
    </div>
  );
}
