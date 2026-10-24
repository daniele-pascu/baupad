import { useEffect, useState } from 'react';
import { apexOf, measuresOf, type Apex, type Measures } from '../lib/drawing';
import { checkMeasure, parseDecimal } from '../lib/numbers';
import type { DrawElement, DrawElementType } from '../lib/types';
import { Icon } from './Icon';

/** Bezeichnungen der Zeichnungsobjekte */
export const ELEMENT_LABELS: Record<DrawElementType, string> = {
  line: 'Linie',
  rect: 'Rechteck',
  ellipse: 'Kreis',
  triangle: 'Dreieck',
  freehand: 'Freihand',
  dimension: 'Maßlinie',
  text: 'Text',
};

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
  dimension: 'Maßlinie: von Punkt zu Punkt ziehen – die Länge wird automatisch angezeigt.',
  text: 'Text: Stelle im Plan antippen.',
  freehand: 'Freihand: mit Finger oder Maus zeichnen.',
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
}: {
  element: DrawElement;
  /** Anzahl Messungen, die auf dem Objekt liegen (nur Hinweis) */
  overlapping: number;
  onApply(m: Measures): void;
  onText(text: string): void;
  onShowDims(show: boolean): void;
  onDelete(): void;
  onClose(): void;
}) {
  const current = measuresOf(element);
  const fields = (Object.keys(current) as Field[]).filter((f) => element.type !== 'freehand' || f === 'rotation');
  const fmt = (f: Field, n: number | undefined) =>
    n === undefined ? '' : FIELDS[f].degrees ? String(Math.round(n * 100) / 100).replace('.', ',') : meterInput(n);
  const [values, setValues] = useState<Record<string, string>>({});
  const [text, setText] = useState(element.text ?? '');
  const [error, setError] = useState<string | null>(null);
  // Werte neu übernehmen, wenn sich das Objekt ändert (Ziehen, Rückgängig …)
  const key = `${element.id}:${element.rev}`;
  useEffect(() => {
    setValues(Object.fromEntries((Object.keys(current) as Field[]).map((f) => [f, fmt(f, current[f])])));
    setText(element.text ?? '');
    setError(null);
  }, [key]);

  const commit = (f: Field) => {
    const input = values[f] ?? '';
    const r = check(f, input);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setError(null);
    if (Math.abs((current[f] ?? NaN) - r.value) > 1e-9) onApply({ [f]: r.value });
  };

  return (
    <div className="draw-bar element-bar" data-testid="element-bar">
      <strong className="draw-bar-title">{ELEMENT_LABELS[element.type]}</strong>
      {element.type === 'text' && (
        <label className="draw-field draw-field-wide">
          <span>Text</span>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => text.trim() && text !== element.text && onText(text.trim())}
            onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
            data-testid="element-text"
          />
        </label>
      )}
      {fields.map((f) => (
        <label key={f} className="draw-field">
          <span>{FIELDS[f].label}</span>
          <span className="input-unit">
            <input
              value={values[f] ?? ''}
              onChange={(e) => setValues({ ...values, [f]: e.target.value })}
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
      {element.type !== 'text' && element.type !== 'dimension' && element.type !== 'freehand' && (
        <label className="check-row small">
          <input type="checkbox" checked={element.showDims !== false} onChange={(e) => onShowDims(e.target.checked)} data-testid="element-showdims" />
          <span>Maße anzeigen</span>
        </label>
      )}
      {element.type === 'triangle' && <span className="muted small">Spitze {APEX_LABELS[apexOf(element.shape)]}</span>}
      <span className="row gap">
        <button type="button" className="btn btn-sm btn-danger-text" onClick={onDelete} data-testid="element-delete">
          <Icon name="trash" size={18} />
          <span className="sr-only">Objekt löschen</span>
        </button>
        <button type="button" className="icon-btn icon-btn-sm" onClick={onClose} aria-label="Auswahl aufheben">
          <Icon name="close" size={18} />
        </button>
      </span>
      {overlapping > 0 && (
        <small className="muted span-all" data-testid="element-overlap">
          Auf diesem Objekt liegen {overlapping} Messung(en). Sie bleiben beim Ändern unverändert.
        </small>
      )}
      {error && <small className="error span-all">{error}</small>}
    </div>
  );
}
