import { useRef, useState } from 'react';
import { checkMeasure, computeArea, formatArea, toInputValue } from '../lib/numbers';
import { findByNumber, parseDamageNumber } from '../lib/numbering';
import { COLORS, SHAPE_LABELS, type Damage, type ShapeType } from '../lib/types';
import { Modal } from './Modal';

export interface DamageValues {
  number: number;
  length: number;
  width: number;
  depth: number;
  color: string;
  shapeType: ShapeType;
  resetLabel: boolean;
}

export type Renumber = 'none' | 'swap' | 'shift';

interface Props {
  mode: 'new' | 'edit';
  damage: Pick<Damage, 'id' | 'number' | 'color' | 'labelOffset'> & Partial<Pick<Damage, 'length' | 'width' | 'depth'>> & { shapeType: ShapeType };
  others: Pick<Damage, 'id' | 'number' | 'area'>[];
  onSave: (v: DamageValues, renumber: Renumber) => void;
  onCancel: () => void;
  onDelete?: () => void;
}

const FIELDS = ['number', 'length', 'width', 'depth'] as const;

/**
 * Eingabe der Schadstellenmaße. Öffnet sich automatisch nach dem Einzeichnen.
 * Enter/Weiter springt zum nächsten Feld; im letzten Feld wird gespeichert.
 */
export function DamageDialog({ mode, damage, others, onSave, onCancel, onDelete }: Props) {
  const [v, setV] = useState({
    number: String(damage.number),
    length: toInputValue(damage.length),
    width: toInputValue(damage.width),
    depth: toInputValue(damage.depth),
  });
  const [color, setColor] = useState(damage.color);
  const [shapeType, setShapeType] = useState<ShapeType>(damage.shapeType);
  const [resetLabel, setResetLabel] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const refs = useRef<Record<string, HTMLInputElement | null>>({});

  const num = parseDamageNumber(v.number);
  const L = checkMeasure(v.length, 'Länge');
  const B = checkMeasure(v.width, 'Breite');
  const T = checkMeasure(v.depth, 'Tiefe');
  const area = L.ok && B.ok ? computeArea(L.value, B.value) : null;
  const conflict = num !== null ? findByNumber(others, num, damage.id) : undefined;
  const errors = {
    number: num === null ? 'Bitte eine ganze Zahl ≥ 0 eingeben.' : null,
    length: L.ok ? null : L.error,
    width: B.ok ? null : B.error,
    depth: T.ok ? null : T.error,
  };
  const valid = !errors.number && L.ok && B.ok && T.ok;

  const submit = (renumber: Renumber = 'none') => {
    setShowErrors(true);
    if (!valid || num === null || !L.ok || !B.ok || !T.ok) {
      const first = FIELDS.find((f) => errors[f]);
      if (first) refs.current[first]?.focus();
      return;
    }
    if (conflict && renumber === 'none') return; // Hinweis wird angezeigt
    onSave({ number: num, length: L.value, width: B.value, depth: T.value, color, shapeType, resetLabel }, renumber);
  };

  const onKeyDown = (field: (typeof FIELDS)[number]) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const idx = FIELDS.indexOf(field);
    if (idx < FIELDS.length - 1) {
      const next = refs.current[FIELDS[idx + 1]];
      next?.focus();
      next?.select();
    } else submit();
  };

  const field = (name: (typeof FIELDS)[number], label: string, unit: string, last = false) => (
    <label className="field measure-field">
      <span>{label}</span>
      <div className="input-unit">
        <input
          ref={(el) => {
            refs.current[name] = el;
          }}
          name={name}
          value={v[name]}
          onChange={(e) => setV({ ...v, [name]: e.target.value })}
          onKeyDown={onKeyDown(name)}
          onFocus={(e) => e.target.select()}
          inputMode={name === 'number' ? 'numeric' : 'decimal'}
          enterKeyHint={last ? 'done' : 'next'}
          autoComplete="off"
          aria-invalid={showErrors && !!errors[name]}
          data-autofocus={mode === 'new' && name === 'length' ? '' : undefined}
          data-testid={`input-${name}`}
        />
        <span className="unit">{unit}</span>
      </div>
      {showErrors && errors[name] && <small className="error">{errors[name]}</small>}
    </label>
  );

  return (
    <Modal
      title={mode === 'new' ? 'Neue Schadstelle' : `Schadstelle ${damage.number} bearbeiten`}
      onClose={onCancel}
      persistent
      testId="damage-dialog"
      footer={
        <>
          {onDelete && (
            <button type="button" className="btn btn-danger-text mr-auto" onClick={onDelete} data-testid="damage-delete">
              Löschen
            </button>
          )}
          <button type="button" className="btn" onClick={onCancel} data-testid="damage-cancel">
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" onClick={() => submit()} data-testid="damage-save">
            Speichern
          </button>
        </>
      }
    >
      <form
        className="damage-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="measure-grid">
          {field('number', 'Schadstellennummer', 'Nr.')}
          {field('length', 'Länge', 'm')}
          {field('width', 'Breite', 'm')}
          {field('depth', 'Tiefe', 'm', true)}
        </div>
        <div className="area-result" data-testid="area-result">
          <span>Fläche (Länge × Breite)</span>
          <strong>{area !== null ? `${formatArea(area)} m²` : '–'}</strong>
        </div>
        {conflict && num !== null && (
          <div className="banner banner-warn" data-testid="number-conflict">
            <p>
              Die Nummer <strong>{num}</strong> ist in diesem Plan bereits vergeben
              {conflict.area ? ` (Schadstelle mit ${formatArea(conflict.area)} m²)` : ''}.
            </p>
            <div className="row gap wrap">
              <button type="button" className="btn btn-sm" onClick={() => submit('swap')} data-testid="renumber-swap">
                Nummern tauschen
              </button>
              <button type="button" className="btn btn-sm" onClick={() => submit('shift')} data-testid="renumber-shift">
                Ab {num} alle um 1 erhöhen
              </button>
            </div>
          </div>
        )}
        <fieldset className="option-row">
          <legend>Farbe</legend>
          {COLORS.map((c) => (
            <button
              key={c.value}
              type="button"
              className={`swatch${color === c.value ? ' active' : ''}`}
              style={{ background: c.value }}
              onClick={() => setColor(c.value)}
              aria-label={c.name}
              aria-pressed={color === c.value}
              title={c.name}
            />
          ))}
        </fieldset>
        <fieldset className="option-row">
          <legend>Form</legend>
          {(Object.keys(SHAPE_LABELS) as ShapeType[])
            .filter((t) => t !== 'freehand' || damage.shapeType === 'freehand')
            .map((t) => (
              <button key={t} type="button" className={`chip${shapeType === t ? ' active' : ''}`} onClick={() => setShapeType(t)} aria-pressed={shapeType === t}>
                {SHAPE_LABELS[t]}
              </button>
            ))}
        </fieldset>
        {mode === 'edit' && damage.labelOffset && (
          <label className="check-row">
            <input type="checkbox" checked={resetLabel} onChange={(e) => setResetLabel(e.target.checked)} />
            <span>Beschriftung wieder automatisch platzieren</span>
          </label>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
