import { useEffect, useRef, useState } from 'react';
import { apexOf, isRegularTriangle, measuresOf, pathLength, shapeInfo, type Apex, type Measures } from '../lib/drawing';
import { arcRadius } from '../lib/cad';
import { shapeVertices } from '../lib/geometry';
import { checkMeasure, formatArea, formatMeasure, parseDecimal } from '../lib/numbers';
import type { DrawElement, DrawElementType, ShapeStyle, TextFont } from '../lib/types';
import { FontControls } from './TextDialog';
import { StylePanel } from './StylePanel';
import { symbolDef } from '../lib/symbols';
import { Icon } from './Icon';

/** Bezeichnungen der Zeichnungsobjekte */
export const ELEMENT_LABELS: Record<DrawElementType, string> = {
  line: 'Linie',
  rect: 'Rechteck',
  ellipse: 'Kreis',
  triangle: 'Dreieck',
  freehand: 'Freie Form',
  arc: 'Bogen',
  dimension: 'Maßlinie',
  text: 'Text',
  symbol: 'Bauteil',
  wall: 'Wand',
};

/** Bezeichnung eines Objekts (geschlossene Form = „Fläche“, offene = „Freie Form“) */
export const elementLabel = (e: Pick<DrawElement, 'type' | 'shape'> & { symbol?: DrawElement['symbol'] }) =>
  e.type === 'symbol' ? (symbolDef(e.symbol?.id)?.label ?? 'Bauteil') : e.type === 'freehand' && e.shape.closed !== false ? 'Fläche' : ELEMENT_LABELS[e.type];

type Field = keyof Measures;
const FIELDS: Record<Field, { label: string; unit: string; degrees?: boolean }> = {
  length: { label: 'Länge', unit: 'm' },
  width: { label: 'Breite', unit: 'm' },
  diameter: { label: 'Durchmesser', unit: 'm' },
  base: { label: 'Grundseite', unit: 'm' },
  height: { label: 'Höhe', unit: 'm' },
  angle: { label: 'Richtung', unit: '°', degrees: true },
  rotation: { label: 'Drehung', unit: '°', degrees: true },
  textHeight: { label: 'Schrifthöhe', unit: 'm' },
};

function check(field: Field, input: string): { ok: true; value: number } | { ok: false; error: string } {
  if (FIELDS[field].degrees) {
    const n = parseDecimal(input.replace(/°$/, ''));
    if (n === null) return { ok: false, error: `${FIELDS[field].label}: bitte eine Zahl in Grad eingeben.` };
    return { ok: true, value: ((n % 360) + 360) % 360 };
  }
  return checkMeasure(input, FIELDS[field].label);
}

/** Meter für ein Eingabefeld: mindestens 2, höchstens 4 Nachkommastellen, ohne Tausenderpunkt */
const meterInput = (n: number) => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 4, useGrouping: false });

/** Richtungstasten für Linien (Grad: 0 = rechts, 90 = unten) */
const DIRECTIONS: { angle: number; label: string; icon: string }[] = [
  { angle: 0, label: 'nach rechts', icon: '→' },
  { angle: 90, label: 'nach unten', icon: '↓' },
  { angle: 180, label: 'nach links', icon: '←' },
  { angle: 270, label: 'nach oben', icon: '↑' },
];

const APEX_LABELS: Record<Apex, string> = { left: 'links', center: 'mittig', right: 'rechts' };

/** Eingabefelder für ein neues Objekt nach Werkzeug */
const INSERT_FIELDS: Partial<Record<DrawElementType, Field[]>> = {
  line: ['length', 'angle'],
  rect: ['length', 'width'],
  ellipse: ['diameter'],
  triangle: ['base', 'height'],
};

const HINTS: Partial<Record<DrawElementType, string>> = {
  dimension: 'Maßlinie: Punkt A, Punkt B, dann den Abstand anklicken – die Länge wird automatisch angezeigt.',
  text: 'Text: Stelle im Plan antippen.',
};

/**
 * Maßeingabe vor dem Einfügen: z. B. Rechteck 5,00 × 3,65 m eintippen und einfügen.
 * Alternativ kann im Plan gezogen werden; die Maße lassen sich danach exakt eingeben.
 */
export function InsertBar({
  tool,
  onInsert,
  continues,
}: {
  tool: DrawElementType;
  onInsert(m: Measures, apex: Apex): void;
  /** Linie schließt an das Ende der vorherigen an */
  continues: boolean;
}) {
  const fields = INSERT_FIELDS[tool] ?? [];
  const [values, setValues] = useState<Record<string, string>>({ angle: '0' });
  const [apex, setApex] = useState<Apex>('center');
  const [errors, setErrors] = useState<string[]>([]);
  useEffect(() => setErrors([]), [tool]);

  if (!fields.length) {
    return (
      <div className="draw-bar" data-testid="insert-bar">
        <span className="muted small">{HINTS[tool] ?? ''}</span>
      </div>
    );
  }
  const submit = () => {
    const m: Measures = {};
    const errs: string[] = [];
    for (const f of fields) {
      const r = check(f, values[f] ?? '');
      if (r.ok) m[f] = r.value;
      else errs.push(r.error);
    }
    setErrors(errs);
    if (!errs.length) onInsert(m, apex);
  };
  return (
    <form
      className="draw-bar"
      data-testid="insert-bar"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <strong className="draw-bar-title">{ELEMENT_LABELS[tool]} mit Maßen</strong>
      {fields.map((f) => (
        <label key={f} className="draw-field">
          <span>{FIELDS[f].label}</span>
          <span className="input-unit">
            <input
              value={values[f] ?? ''}
              onChange={(e) => setValues({ ...values, [f]: e.target.value })}
              inputMode="decimal"
              enterKeyHint="done"
              autoComplete="off"
              data-testid={`insert-${f}`}
            />
            <span className="unit">{FIELDS[f].unit}</span>
          </span>
        </label>
      ))}
      {tool === 'line' && (
        <span className="dir-btns" role="group" aria-label="Richtung">
          {DIRECTIONS.map((d) => (
            <button
              key={d.angle}
              type="button"
              className={`chip${parseDecimal(values.angle ?? '') === d.angle ? ' active' : ''}`}
              onClick={() => setValues({ ...values, angle: String(d.angle) })}
              aria-label={`Richtung ${d.label}`}
              title={d.label}
            >
              {d.icon}
            </button>
          ))}
        </span>
      )}
      {tool === 'triangle' && (
        <span className="dir-btns" role="group" aria-label="Spitze">
          {(['left', 'center', 'right'] as Apex[]).map((a) => (
            <button key={a} type="button" className={`chip${apex === a ? ' active' : ''}`} onClick={() => setApex(a)} aria-pressed={apex === a}>
              Spitze {APEX_LABELS[a]}
            </button>
          ))}
        </span>
      )}
      <button type="submit" className="btn btn-sm btn-primary" data-testid="insert-submit">
        <Icon name="plus" size={18} /> Einfügen
      </button>
      {tool === 'line' && continues && <span className="muted small">schließt an die letzte Linie an</span>}
      {errors.length > 0 && <small className="error span-all">{errors.join(' ')}</small>}
    </form>
  );
}

/** Eigenschaften des ausgewählten Zeichnungsobjekts: Maße exakt ändern, Text, Löschen. */
export function ElementBar({
  element,
  overlapping,
  onApply,
  onText,
  onShowDims,
  onDelete,
  onClose,
  vertex = null,
  canRemoveVertex = false,
  onRemoveVertex,
  onSetClosed,
  onStyle,
  onColor,
  styleOpen = false,
  onToggleStyle,
  onExtGap,
  onFont,
  onFlip,
  onWall,
  onSegment,
}: {
  element: DrawElement;
  /** Darstellungsfeld geöffnet (bleibt beim Wechsel der Auswahl offen) */
  styleOpen?: boolean;
  onToggleStyle?(): void;
  /** Darstellung ändern (Linientyp, -stärke, Füllung) bzw. Linienfarbe */
  onStyle?(patch: Partial<ShapeStyle>): void;
  onColor?(color: string): void;
  /** ausgewählter Eckpunkt (Index) */
  vertex?: number | null;
  canRemoveVertex?: boolean;
  onRemoveVertex?(): void;
  /** Polylinie öffnen (nur Länge) bzw. schließen (Fläche) */
  onSetClosed?(closed: boolean): void;
  /** Maßlinie: Abstand der Hilfslinien zum Objekt (mm) ändern */
  onExtGap?(mm: number): void;
  /** Text: Schriftart, fett, kursiv */
  onFont?(f: TextFont | undefined): void;
  /** Bauteil: Anschlag (x) bzw. Öffnungsrichtung (y) umschalten */
  onFlip?(axis: 'x' | 'y'): void;
  /** Wand: Stärke bzw. Höhe ändern */
  onWall?(patch: { thickness?: number; height?: number }): void;
  /** Polylinie, Fläche, Wand: Länge eines Abschnitts (Knick zu Knick) ändern */
  onSegment?(index: number, length: number): void;
  /** Anzahl Messungen, die auf dem Objekt liegen (nur Hinweis) */
  overlapping: number;
  onApply(m: Measures): void;
  onText(text: string): void;
  onShowDims(show: boolean): void;
  onDelete(): void;
  onClose(): void;
}) {
  const current = measuresOf(element);
  const info = shapeInfo(element);
  const fields = element.type === 'wall' ? [] : (Object.keys(current) as Field[]).filter((f) => element.type !== 'freehand' || f === 'rotation');
  const fmt = (f: Field, n: number | undefined) =>
    n === undefined ? '' : FIELDS[f].degrees ? String(Math.round(n * 100) / 100).replace('.', ',') : meterInput(n);
  const [values, setValues] = useState<Record<string, string>>({});
  const [text, setText] = useState(element.text ?? '');
  const [gap, setGap] = useState(String(element.extGap ?? 1).replace('.', ','));
  const [error, setError] = useState<string | null>(null);
  const [segOpen, setSegOpen] = useState(false);
  const styled = element.type !== 'text' && element.type !== 'dimension' && !!onStyle && !!onColor && !!onToggleStyle;
  // Werte neu übernehmen, wenn sich das Objekt ändert (Ziehen, Rückgängig …)
  const key = `${element.id}:${element.rev}`;
  useEffect(() => {
    setValues(Object.fromEntries((Object.keys(current) as Field[]).map((f) => [f, fmt(f, current[f])])));
    setText(element.text ?? '');
    setGap(String(element.extGap ?? 1).replace('.', ','));
    setError(null);
  }, [key]);

  // Geänderte, noch nicht übernommene Felder: werden spätestens beim Antippen außerhalb der Leiste übernommen
  // (ein Tipp auf den Plan nimmt dem Feld nicht immer den Fokus bzw. wählt die Form ab, bevor „blur“ käme)
  const dirty = useRef(new Set<Field>());
  const textDirty = useRef(false);
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    dirty.current.clear();
    textDirty.current = false;
  }, [key]);

  const commit = (f: Field) => {
    // schon übernommen (z. B. beim Antippen außerhalb) – nicht doppelt
    if (!dirty.current.has(f)) return;
    dirty.current.delete(f);
    const input = values[f] ?? '';
    const r = check(f, input);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setError(null);
    if (Math.abs((current[f] ?? NaN) - r.value) > 1e-9) onApply({ [f]: r.value });
  };
  /** alle offenen Eingaben auf einmal übernehmen */
  const commitAll = () => {
    if (textDirty.current) {
      textDirty.current = false;
      if (text.trim() && text !== element.text) onText(text.trim());
    }
    if (!dirty.current.size) return;
    const patch: Record<string, number> = {};
    for (const f of dirty.current) {
      const r = check(f, values[f] ?? '');
      if (!r.ok) {
        setError(r.error);
        continue;
      }
      if (Math.abs((current[f] ?? NaN) - r.value) > 1e-9) patch[f] = r.value;
    }
    dirty.current.clear();
    if (Object.keys(patch).length) onApply(patch as Measures);
  };
  const commitAllRef = useRef(commitAll);
  commitAllRef.current = commitAll;
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) commitAllRef.current();
    };
    // Erfassungsphase: vor dem Plan, der die Auswahl aufhebt
    document.addEventListener('pointerdown', outside, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      // Leiste verschwindet (Form abgewählt, anderes Werkzeug): offene Eingaben noch übernehmen
      commitAllRef.current();
    };
  }, []);

  return (
    <div className="draw-bar element-bar" data-testid="element-bar" ref={barRef}>
      <strong className="draw-bar-title">{elementLabel(element)}</strong>
      {element.type === 'text' && (
        <label className="draw-field draw-field-wide">
          <span>Text</span>
          <input
            value={text}
            onChange={(e) => {
              textDirty.current = true;
              setText(e.target.value);
            }}
            onBlur={() => {
              textDirty.current = false;
              if (text.trim() && text !== element.text) onText(text.trim());
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
            data-testid="element-text"
          />
        </label>
      )}
      {element.type === 'wall' && element.wall && onWall && <WallFields element={element} onWall={onWall} />}
      {(element.type === 'freehand' || element.type === 'wall') && onSegment && shapeVertices(element.shape).length >= 2 && (
        <button type="button" className={`btn btn-sm${segOpen ? ' active' : ''}`} aria-expanded={segOpen} onClick={() => setSegOpen(!segOpen)} title="Länge jedes Abschnitts (von Knick zu Knick) ansehen und ändern" data-testid="segments-toggle">
          Abschnitte
        </button>
      )}
      {element.type === 'symbol' && onFlip && symbolDef(element.symbol?.id)?.flippable && (
        <span className="row gap">
          <button type="button" className="btn btn-sm" onClick={() => onFlip('x')} title="Anschlag links/rechts wechseln" data-testid="symbol-flip-x">
            ⇄ {symbolDef(element.symbol?.id)?.group === 'door' ? 'Anschlag' : 'Seite'}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => onFlip('y')} title="Öffnungsrichtung bzw. Wandseite wechseln" data-testid="symbol-flip-y">
            ⇅ {symbolDef(element.symbol?.id)?.group === 'door' ? 'Öffnung' : 'Richtung'}
          </button>
        </span>
      )}
      {element.type === 'text' && onFont && onColor && <FontControls font={element.font} color={element.color} onFont={onFont} onColor={onColor} compact />}
      {fields.map((f) => (
        <label key={f} className="draw-field">
          <span>{FIELDS[f].label}</span>
          <span className="input-unit">
            <input
              value={values[f] ?? ''}
              onChange={(e) => {
                dirty.current.add(f);
                setValues({ ...values, [f]: e.target.value });
              }}
              onBlur={() => commit(f)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commit(f);
                }
              }}
              inputMode="decimal"
              enterKeyHint="done"
              autoComplete="off"
              data-testid={`element-${f}`}
            />
            <span className="unit">{FIELDS[f].unit}</span>
          </span>
        </label>
      ))}
      {element.type === 'dimension' && !!element.offset && onExtGap && (
        <label className="draw-field">
          <span>Abstand zum Objekt</span>
          <span className="input-unit">
            <input
              value={gap}
              onChange={(e) => setGap(e.target.value)}
              onBlur={() => {
                const n = Number(gap.replace(',', '.'));
                if (Number.isFinite(n) && n >= 0 && n <= 50) {
                  setError(null);
                  if (Math.abs(n - (element.extGap ?? 1)) > 1e-9) onExtGap(n);
                } else setError('Abstand bitte zwischen 0 und 50 mm.');
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
              inputMode="decimal"
              title="Lücke zwischen Objekt und Hilfslinie (wie im Plan bzw. PDF, unabhängig vom Zoom)"
              data-testid="element-extgap"
            />
            <span className="unit">mm</span>
          </span>
        </label>
      )}
      {element.type !== 'text' && element.type !== 'dimension' && (
        <label className="check-row small">
          <input type="checkbox" checked={element.showDims !== false} onChange={(e) => onShowDims(e.target.checked)} data-testid="element-showdims" />
          <span>Maße anzeigen</span>
        </label>
      )}
      {element.type === 'triangle' && isRegularTriangle(element.shape) && <span className="muted small">Spitze {APEX_LABELS[apexOf(element.shape)]}</span>}
      {element.type === 'arc' && (
        <span className="sr-only" data-testid="element-info">
          Bogenlänge {formatMeasure(pathLength(element.shape))} m · Radius {formatMeasure(arcRadius(element.shape) ?? 0)} m
        </span>
      )}
      {element.type === 'freehand' && element.shape.closed === false && (
        <span className="sr-only" data-testid="element-info">
          Länge gesamt {formatMeasure(pathLength(element.shape))} m · {shapeVertices(element.shape).length} Punkte · keine Fläche
        </span>
      )}
      {element.type === 'freehand' && onSetClosed && (
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => onSetClosed(element.shape.closed === false)}
          disabled={element.shape.closed === false && shapeVertices(element.shape).length < 3}
          data-testid="element-toggle-closed"
        >
          {element.shape.closed === false ? 'Schließen (Fläche)' : 'Öffnen (nur Linie)'}
        </button>
      )}
      {vertex !== null && onRemoveVertex && (
        <button
          type="button"
          className="btn btn-sm"
          onClick={onRemoveVertex}
          disabled={!canRemoveVertex}
          title={canRemoveVertex ? 'Ausgewählten Eckpunkt entfernen (Entf)' : 'Zu wenige Eckpunkte zum Entfernen'}
          data-testid="vertex-remove"
        >
          <Icon name="trash" size={16} /> Eckpunkt {vertex + 1}
        </button>
      )}
      {/* Umfang/Fläche bzw. Bogenlänge: nicht mehr sichtbar (aufgeräumte Leiste), nur für Screenreader */}
      {info && (element.type === 'triangle' || element.type === 'freehand' || element.type === 'rect') && (
        <span className="sr-only" data-testid="element-info">
          {info.sides.length > 0 && element.type !== 'rect' && <>Seiten {info.sides.map((x) => formatMeasure(x)).join(' · ')} m · </>}
          Umfang {formatMeasure(info.perimeter)} m{info.area !== null && <> · Fläche {formatArea(info.area)} m²</>}
        </span>
      )}
      <span className="row gap">
        {styled && (
          <button type="button" className={`btn btn-sm${styleOpen ? ' active' : ''}`} onClick={onToggleStyle} aria-expanded={styleOpen} data-testid="style-toggle">
            Darstellung
          </button>
        )}
        <button type="button" className="btn btn-sm btn-danger-text" onClick={onDelete} data-testid="element-delete">
          <Icon name="trash" size={18} />
          <span className="sr-only">Objekt löschen</span>
        </button>
        <button type="button" className="icon-btn icon-btn-sm" onClick={onClose} aria-label="Auswahl aufheben">
          <Icon name="close" size={18} />
        </button>
      </span>
      {segOpen && onSegment && (element.type === 'freehand' || element.type === 'wall') && <SegmentFields key={key} element={element} onSegment={onSegment} />}
      {styled && styleOpen && (
        <div className="span-all">
          <StylePanel
            compact
            color={element.color}
            style={element.style}
            open={element.type === 'line' || element.type === 'arc' || (element.type === 'freehand' && element.shape.closed === false)}
            defaultWidth={1.1}
            kind="element"
            onColor={onColor!}
            onStyle={onStyle!}
          />
        </div>
      )}
      {overlapping > 0 && (
        <small className="muted span-all" data-testid="element-overlap">
          Auf diesem Objekt liegen {overlapping} Messung(en). Sie bleiben beim Ändern unverändert.
        </small>
      )}
      {error && <small className="error span-all">{error}</small>}
    </div>
  );
}

/**
 * Abschnitte einer Polylinie, Fläche bzw. Wand: je Knick die Länge (Übernahme bei Enter bzw. Verlassen des Felds).
 * Der Endpunkt wandert in Richtung des Abschnitts, die folgenden Punkte gehen mit.
 */
function SegmentFields({ element, onSegment }: { element: DrawElement; onSegment(i: number, len: number): void }) {
  const pts = shapeVertices(element.shape);
  const closed = element.shape.type !== 'line' && element.shape.closed !== false;
  const lens = pts.slice(0, closed ? pts.length : pts.length - 1).map((p, i) => {
    const q = pts[(i + 1) % pts.length];
    return Math.hypot(q.x - p.x, q.y - p.y);
  });
  const [vals, setVals] = useState(() => lens.map((l) => meterInput(l)));
  const [err, setErr] = useState<string | null>(null);
  const commit = (i: number) => {
    const r = checkMeasure(vals[i] ?? '', `Abschnitt ${i + 1}`);
    if (!r.ok) return setErr(r.error);
    setErr(null);
    if (Math.abs(r.value - lens[i]) > 1e-6) onSegment(i, r.value);
  };
  return (
    <div className="segment-fields span-all" data-testid="segment-fields">
      {lens.map((_, i) => (
        <label key={i} className="segment-field">
          <span className="small muted">{i + 1}</span>
          <input
            value={vals[i] ?? ''}
            onChange={(e) => setVals(vals.map((v, j) => (j === i ? e.target.value : v)))}
            onBlur={() => commit(i)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), commit(i))}
            inputMode="decimal"
            enterKeyHint="done"
            aria-label={`Länge Abschnitt ${i + 1} in m`}
            data-testid={`segment-${i}`}
          />
          <span className="small muted">m</span>
        </label>
      ))}
      {err && <small className="error">{err}</small>}
    </div>
  );
}

/** Wand: Stärke und Höhe (Übernahme beim Verlassen des Felds), Länge und Wandfläche zur Kontrolle */
function WallFields({ element, onWall }: { element: DrawElement; onWall(p: { thickness?: number; height?: number }): void }) {
  const w = element.wall!;
  const [t, setT] = useState(String(w.thickness).replace('.', ','));
  const [h, setH] = useState(w.height ? String(w.height).replace('.', ',') : '');
  useEffect(() => {
    setT(String(w.thickness).replace('.', ','));
    setH(w.height ? String(w.height).replace('.', ',') : '');
  }, [w.thickness, w.height]);
  const len = pathLength(element.shape) + (element.shape.closed ? 0 : 0);
  const commitT = () => {
    const v = parseDecimal(t);
    if (v !== null && v > 0 && Math.abs(v - w.thickness) > 1e-9) onWall({ thickness: v });
  };
  const commitH = () => {
    const v = h.trim() ? parseDecimal(h) : 0;
    if (v !== null && v >= 0 && Math.abs(v - (w.height ?? 0)) > 1e-9) onWall({ height: v || undefined });
  };
  return (
    <>
      <label className="draw-field">
        <span>Stärke</span>
        <span className="input-unit">
          <input value={t} onChange={(e) => setT(e.target.value)} onBlur={commitT} onKeyDown={(e) => e.key === 'Enter' && commitT()} inputMode="decimal" data-testid="wall-thickness" />
          <span className="unit">m</span>
        </span>
      </label>
      <label className="draw-field">
        <span>Höhe</span>
        <span className="input-unit">
          <input value={h} onChange={(e) => setH(e.target.value)} onBlur={commitH} onKeyDown={(e) => e.key === 'Enter' && commitH()} inputMode="decimal" placeholder="–" data-testid="wall-height" />
          <span className="unit">m</span>
        </span>
      </label>
      <span className="muted small" data-testid="wall-info">
        Länge {formatMeasure(len)} m{w.height ? ` · Fläche ${formatArea(len * w.height)} m²` : ''}
      </span>
    </>
  );
}
