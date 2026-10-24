import { useRef, useState } from 'react';
import { hasArea, KIND_LABELS, KINDS } from '../lib/measure';
import { checkMeasure, computeArea, formatArea, parseDecimal, toInputValue } from '../lib/numbers';
import { findByNumber, parseDamageNumber } from '../lib/numbering';
import { COLORS, SHAPE_LABELS, type Component, type Damage, type MeasureKind, type ShapeType } from '../lib/types';
import { Modal } from './Modal';

export interface DamageValues {
  number: number;
  kind: MeasureKind;
  length: number;
  /** null bei Linienmessungen */
  width: number | null;
  /** null = nicht gemessen */
  depth: number | null;
  color: string;
  shapeType: ShapeType;
  componentId: string | null;
  resetLabel: boolean;
}

export type Renumber = 'none' | 'swap' | 'shift';

interface Props {
  mode: 'new' | 'edit';
  damage: Pick<Damage, 'id' | 'number' | 'color' | 'labelOffset'> &
    Partial<Pick<Damage, 'length' | 'width' | 'depth' | 'componentId'>> & { shapeType: ShapeType; kind: MeasureKind };
  others: Pick<Damage, 'id' | 'number' | 'area'>[];
  /** Bauteilkennzeichnungen des Plans für die optionale Zuordnung */
  components: Pick<Component, 'id' | 'letter' | 'name'>[];
  onSave: (v: DamageValues, renumber: Renumber) => void;
  onCancel: () => void;
  onDelete?: () => void;
}

type Field = 'number' | 'length' | 'width' | 'depth';

/**
 * Eingabe einer Messung bzw. Schadstelle. Öffnet sich automatisch nach dem Einzeichnen.
 * Enter/Weiter springt zum nächsten Feld; im letzten Feld wird gespeichert.
 */
export function DamageDialog({ mode, damage, others, components, onSave, onCancel, onDelete }: Props) {
  const [v, setV] = useState({
    number: String(damage.number),
    length: toInputValue(damage.length),
    width: toInputValue(damage.width),
    depth: toInputValue(damage.depth),
  });
  const [kind, setKind] = useState<MeasureKind>(damage.kind);
  const [color, setColor] = useState(damage.color);
  const [shapeType, setShapeType] = useState<ShapeType>(damage.shapeType);
  const [componentId, setComponentId] = useState<string | null>(damage.componentId ?? null);
  const [resetLabel, setResetLabel] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const refs = useRef<Record<string, HTMLInputElement | null>>({});

  const withArea = hasArea(kind);
  const fields: Field[] = withArea ? ['number', 'length', 'width', 'depth'] : ['number', 'length'];

  // Eine unveränderte bestehende Nummer (auch eine ältere 0) bleibt gültig; neue Nummern ab 1
  const num = v.number.trim() === String(damage.number) ? damage.number : parseDamageNumber(v.number);
  const L = checkMeasure(v.length, 'Länge');
  const B = withArea ? checkMeasure(v.width, 'Breite') : null;
  // Tiefe ist optional: leer bleibt leer (null), eine Eingabe muss aber gültig sein
  const T = withArea && v.depth.trim() ? checkMeasure(v.depth, 'Tiefe') : null;
  const area = withArea && L.ok && B?.ok ? computeArea(L.value, B.value) : null;
  const conflict = num !== null ? findByNumber(others, num, damage.id) : undefined;
  const errors: Record<Field, string | null> = {
    number: num === null ? 'Bitte eine ganze Zahl ab 1 eingeben.' : null,
    length: L.ok ? null : L.error,
    width: B && !B.ok ? B.error : null,
    depth: T && !T.ok ? T.error : null,
  };
  const valid = fields.every((f) => !errors[f]);

  const submit = (renumber: Renumber = 'none') => {
    setShowErrors(true);
    if (!valid || num === null || !L.ok) {
      const first = fields.find((f) => errors[f]);
      if (first) refs.current[first]?.focus();
      return;
    }
    if (conflict && renumber === 'none') return; // Hinweis wird angezeigt
    onSave(
      {
        number: num,
        kind,
        length: L.value,
        width: B?.ok ? B.value : null,
        depth: T?.ok ? T.value : null,
        color,
        shapeType,
        componentId,
        resetLabel,
      },
      renumber,
    );
  };

  const onKeyDown = (field: Field) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const idx = fields.indexOf(field);
    if (idx < fields.length - 1) {
      const next = refs.current[fields[idx + 1]];
      next?.focus();
      next?.select();
    } else submit();
  };

  const field = (name: Field, label: string, unit: string) => (
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
          enterKeyHint={fields[fields.length - 1] === name ? 'done' : 'next'}
          autoComplete="off"
          placeholder={name === 'depth' ? 'optional' : undefined}
          aria-invalid={showErrors && !!errors[name]}
          data-autofocus={mode === 'new' && name === 'length' ? '' : undefined}
          data-testid={`input-${name}`}
        />
        <span className="unit">{unit}</span>
      </div>
      {showErrors && errors[name] && <small className="error">{errors[name]}</small>}
    </label>
  );

  const lengthValue = parseDecimal(v.length);

  return (
    <Modal
      title={mode === 'new' ? `Neue ${KIND_LABELS[kind]}` : `${KIND_LABELS[kind]} ${damage.number} bearbeiten`}
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
        <div className="segmented kind-switch" role="radiogroup" aria-label="Messart">
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              aria-selected={kind === k}
              onClick={() => setKind(k)}
              data-testid={`kind-${k}`}
            >
              {KIND_LABELS[k]}
            </button>
          ))}
        </div>
        <div className="measure-grid">
          {field('number', 'Nummer', 'Nr.')}
          {field('length', 'Länge', 'm')}
          {withArea && field('width', 'Breite', 'm')}
          {withArea && field('depth', 'Tiefe (optional)', 'm')}
        </div>
        <div className="area-result" data-testid="area-result">
          {withArea ? (
            <>
              <span>Fläche (Länge × Breite)</span>
              <strong>{area !== null ? `${formatArea(area)} m²` : '–'}</strong>
            </>
          ) : (
            <>
              <span>Linienmessung (keine Fläche)</span>
              <strong>{lengthValue && lengthValue > 0 ? `${formatArea(lengthValue)} m` : '–'}</strong>
            </>
          )}
        </div>
        {conflict && num !== null && (
          <div className="banner banner-warn" data-testid="number-conflict">
            <p>
              Die Nummer <strong>{num}</strong> ist in diesem Plan bereits vergeben
              {conflict.area ? ` (Messung mit ${formatArea(conflict.area)} m²)` : ''}.
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
        {components.length > 0 && (
          <label className="field">
            <span>Bauteil (optional)</span>
            <select value={componentId ?? ''} onChange={(e) => setComponentId(e.target.value || null)} data-testid="input-component">
              <option value="">– kein Bauteil –</option>
              {components.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name ? `${c.letter} – ${c.name}` : c.letter}
                </option>
              ))}
            </select>
          </label>
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
