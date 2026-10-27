import { useEffect, useRef, useState } from 'react';
import { hasArea, KIND_LABELS } from '../lib/measure';
import { checkMeasure, computeArea, formatArea, parseDecimal, toInputValue } from '../lib/numbers';
import { damageNo, findByNumber, parseDamageNumber } from '../lib/numbering';
import { COLORS, SHAPE_LABELS, type Component, type Damage, type MeasureKind, type ShapeType } from '../lib/types';
import { Modal } from './Modal';

export interface DamageValues {
  /** Nummer (bei einer Kennzeichnung aus Buchstaben: bisherige Nummer bzw. 0 = neu vergeben) */
  number: number;
  /** Kennzeichnung, z. B. „A“, „Wand B“ – null, wenn eine reine Zahl eingegeben wurde */
  label: string | null;
  kind: MeasureKind;
  length: number;
  /** null bei Linienmessungen */
  width: number | null;
  /** null = nicht gemessen */
  depth: number | null;
  color: string;
  shapeType: ShapeType;
  componentId: string | null;
  positionRef: string | null;
  resetLabel: boolean;
  /** Fläche/Umfang aus der Plangeometrie: `area` = Fläche der Form, `length` = Umfang */
  areaFromShape: boolean;
  /** Fläche aus der Geometrie (nur mit areaFromShape) */
  area: number | null;
}

export type Renumber = 'none' | 'swap' | 'shift';

interface Props {
  mode: 'new' | 'edit';
  damage: Pick<Damage, 'id' | 'number' | 'color' | 'labelOffset'> &
    Partial<Pick<Damage, 'length' | 'width' | 'depth' | 'componentId' | 'positionRef' | 'label' | 'areaFromShape'>> & { shapeType: ShapeType; kind: MeasureKind };
  others: Pick<Damage, 'id' | 'number' | 'area' | 'label'>[];
  /** Bauteilkennzeichnungen des Plans für die optionale Zuordnung */
  components: Pick<Component, 'id' | 'letter' | 'name'>[];
  /** Leistungspositionen (LV/MFK) für die optionale Zuordnung */
  positions?: { ref: string; label: string; doc: string }[];
  /** Gezeichnete Pläne: Maße aus der Markierung (Maßstab bekannt) als Vorschlag */
  suggestion?: { length: number; width: number | null } | null;
  /** Kalibrierter bzw. gezeichneter Plan, geschlossene Form: Fläche und Umfang aus der Geometrie */
  geometry?: { area: number; perimeter: number; formula: string } | null;
  /** Wand: offener Verlauf, Länge aus allen Abschnitten, dazu Wandhöhe → Wandfläche */
  wall?: boolean;
  onSave: (v: DamageValues, renumber: Renumber) => void;
  onCancel: () => void;
  onDelete?: () => void;
}

type Field = 'number' | 'length' | 'width' | 'depth';

/**
 * Eingabe einer Messung bzw. Schadstelle. Öffnet sich automatisch nach dem Einzeichnen.
 * Enter/Weiter springt zum nächsten Feld; im letzten Feld wird gespeichert.
 */
export function DamageDialog({ mode, damage, others, components, positions = [], suggestion, geometry, wall = false, onSave, onCancel, onDelete }: Props) {
  /** Fläche und Umfang aus dem Plan übernehmen (nur bei Flächen-Messarten) */
  // Linie: Länge aus dem Plan (kalibriert) – bei neuen Linien vorgewählt, wird bei Formänderung nachgeführt
  const lineSuggest = (!hasArea(damage.kind) || wall) && suggestion ? suggestion.length : null;
  const [fromShape, setFromShape] = useState(
    damage.areaFromShape ? !!geometry || lineSuggest !== null : mode === 'new' && lineSuggest !== null && lineSuggest > 0,
  );
  const [v, setV] = useState({
    number: damage.label ?? String(damage.number),
    length: toInputValue(damage.length),
    width: toInputValue(damage.width),
    depth: toInputValue(damage.depth),
  });
  // Messart ergibt sich aus der Form (keine Auswahl beim Einfügen); bestehende bleibt erhalten
  const kind: MeasureKind = damage.kind;
  const [color, setColor] = useState(damage.color);
  const [shapeType, setShapeType] = useState<ShapeType>(damage.shapeType);
  const [componentId, setComponentId] = useState<string | null>(damage.componentId ?? null);
  const [positionRef, setPositionRef] = useState<string | null>(damage.positionRef ?? null);
  // erst LV bzw. MFK wählen, dann deren Positionen (Verweis „Dokument:Position“)
  const docOf = (ref: string) => ref.slice(0, ref.indexOf(':'));
  const docs = [...new Map(positions.map((p) => [docOf(p.ref), p.doc])).entries()].map(([id, label]) => ({ id, label }));
  const [docId, setDocId] = useState<string>(() => (damage.positionRef && positions.some((p) => p.ref === damage.positionRef) ? docOf(damage.positionRef) : (docs[0]?.id ?? '')));
  const [resetLabel, setResetLabel] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const refs = useRef<Record<string, HTMLInputElement | null>>({});
  // Wand mit Länge aus dem Plan: gleich nach der Wandhöhe fragen (nach dem Fokus des Dialogs)
  useEffect(() => {
    if (mode === 'new' && wall && refs.current.width && !refs.current.length) refs.current.width.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const withArea = hasArea(kind);
  // Aus der Geometrie: Fläche und Umfang kommen aus der Form, nur Nummer und Tiefe sind einzugeben
  const geo = withArea && fromShape && geometry ? geometry : null;
  // Linie: Länge, dazu optional Höhe und Tiefe (getrennt, keine Fläche)
  const lineGeo = (!withArea || wall) && fromShape && lineSuggest !== null && lineSuggest > 0 ? lineSuggest : null;
  const fields: Field[] = geo ? ['number', 'depth'] : lineGeo !== null ? ['number', 'width', 'depth'] : ['number', 'length', 'width', 'depth'];

  // Reine Zahl = Nummer; sonst Kennzeichnung aus Buchstaben (z. B. „A“, „Wand B“, „1A“).
  // Eine unveränderte bestehende Nummer (auch eine ältere 0) bleibt gültig; neue Nummern ab 1
  const raw = v.number.trim();
  const isNumeric = /^\d+$/.test(raw);
  const num = isNumeric ? (!damage.label && raw === String(damage.number) ? damage.number : parseDamageNumber(raw)) : null;
  const label = !isNumeric && raw ? raw : null;
  const labelTaken = label ? others.find((o) => o.id !== damage.id && damageNo(o).toLowerCase() === label.toLowerCase()) : undefined;
  const L = geo ? ({ ok: true, value: geo.perimeter } as const) : lineGeo !== null ? ({ ok: true, value: lineGeo } as const) : checkMeasure(v.length, 'Länge');
  // Nur die Länge ist Pflicht. Breite/Höhe und Tiefe sind optional: leer bleibt leer (null,
  // nicht 0), eine Eingabe muss aber gültig sein
  const B = !geo && v.width.trim() ? checkMeasure(v.width, withArea && !wall ? 'Breite/Höhe' : 'Höhe') : null;
  const T = v.depth.trim() ? checkMeasure(v.depth, 'Tiefe') : null;
  const area = geo ? geo.area : withArea && L.ok && B?.ok ? computeArea(L.value, B.value) : null;
  // Nummernkonflikte nur unter reinen Nummern (Kennzeichnungen haben eine eigene Prüfung)
  const conflict = num !== null ? findByNumber(others.filter((o) => !o.label), num, damage.id) : undefined;
  const errors: Record<Field, string | null> = {
    number: !raw
      ? 'Bitte eine Nummer oder Kennzeichnung eingeben (z. B. 1, A, Wand A).'
      : isNumeric && num === null
        ? 'Bitte eine ganze Zahl ab 1 eingeben.'
        : label && label.length > 12
          ? 'Kennzeichnung: höchstens 12 Zeichen.'
          : labelTaken
            ? `„${label}“ ist in diesem Plan bereits vergeben.`
            : null,
    length: L.ok ? null : L.error,
    width: B && !B.ok ? B.error : null,
    depth: T && !T.ok ? T.error : null,
  };
  const valid = fields.every((f) => !errors[f]);

  const submit = (renumber: Renumber = 'none') => {
    setShowErrors(true);
    if (!valid || (num === null && !label) || !L.ok) {
      const first = fields.find((f) => errors[f]);
      if (first) refs.current[first]?.focus();
      return;
    }
    if (conflict && renumber === 'none') return; // Hinweis wird angezeigt
    onSave(
      {
        number: num ?? (damage.label ? damage.number : 0),
        label,
        kind,
        length: L.value,
        width: B?.ok ? B.value : null,
        depth: T?.ok ? T.value : null,
        color,
        shapeType,
        componentId,
        positionRef,
        resetLabel,
        areaFromShape: !!geo || lineGeo !== null,
        area: geo ? geo.area : null,
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
          inputMode={name === 'number' ? 'text' : 'decimal'}
          autoCapitalize={name === 'number' ? 'characters' : undefined}
          enterKeyHint={fields[fields.length - 1] === name ? 'done' : 'next'}
          autoComplete="off"
          placeholder={name === 'depth' || name === 'width' ? 'optional' : undefined}
          aria-invalid={showErrors && !!errors[name]}
          // Länge aus dem Plan: gleich die Höhe eingeben (bei der Wand die Wandhöhe)
          data-autofocus={mode === 'new' && name === (lineGeo !== null ? 'width' : 'length') ? '' : undefined}
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
      title={mode === 'new' ? `Neue ${wall ? 'Wand' : KIND_LABELS[kind]}` : `${wall ? 'Wand' : KIND_LABELS[kind]} ${damageNo(damage)} bearbeiten`}
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
          {field('number', 'Nr. / Kennz.', 'Nr.')}
          {geo ? (
            <label className="field measure-field">
              <span>Umfang (aus Plan)</span>
              <div className="input-unit">
                <input value={formatArea(geo.perimeter)} readOnly tabIndex={-1} data-testid="geometry-perimeter" />
                <span className="unit">m</span>
              </div>
            </label>
          ) : lineGeo !== null ? (
            <label className="field measure-field">
              <span>Länge (aus Plan)</span>
              <div className="input-unit">
                <input value={formatArea(lineGeo)} readOnly tabIndex={-1} data-testid="geometry-length" />
                <span className="unit">m</span>
              </div>
            </label>
          ) : (
            field('length', 'Länge *', 'm')
          )}
          {!geo && field('width', wall ? 'Wandhöhe' : withArea ? 'Breite / Höhe (optional)' : 'Höhe (optional)', 'm')}
          {field('depth', 'Tiefe (optional)', 'm')}
        </div>
        {withArea && geometry && (
          <button
            type="button"
            className={`btn btn-sm suggest-btn${geo ? ' active' : ''}`}
            onClick={() => setFromShape(!geo)}
            aria-pressed={!!geo}
            data-testid="use-geometry"
          >
            {geo ? 'Maße wieder von Hand eingeben' : `Fläche aus Plan übernehmen: ${formatArea(geometry.area)} m²`}
          </button>
        )}
        {(!withArea || wall) && lineSuggest !== null && lineSuggest > 0 && (
          <button
            type="button"
            className={`btn btn-sm suggest-btn${lineGeo !== null ? ' active' : ''}`}
            onClick={() => setFromShape(lineGeo === null)}
            aria-pressed={lineGeo !== null}
            data-testid="use-geometry"
          >
            {lineGeo !== null ? 'Länge wieder von Hand eingeben' : `Länge aus Plan übernehmen: ${formatArea(lineSuggest)} m (alle Abschnitte)`}
          </button>
        )}
        {suggestion && !geo && withArea && !wall && (
          <button
            type="button"
            className="btn btn-sm suggest-btn"
            onClick={() =>
              setV({
                ...v,
                length: toInputValue(suggestion.length),
                width: withArea && suggestion.width !== null ? toInputValue(suggestion.width) : v.width,
              })
            }
            data-testid="use-suggestion"
          >
            Maße aus Plan übernehmen:{' '}
            {withArea && suggestion.width !== null
              ? `${formatArea(suggestion.length)} × ${formatArea(suggestion.width)} m`
              : `${formatArea(suggestion.length)} m`}
          </button>
        )}
        <div className="area-result" data-testid="area-result">
          {geo ? (
            <>
              <span>Fläche aus Plan ({geo.formula}) – wird bei Formänderung nachgeführt</span>
              <strong>{formatArea(geo.area)} m²</strong>
            </>
          ) : wall ? (
            <>
              <span>{area !== null ? 'Wandfläche (Länge × Höhe)' : 'Wandfläche erst mit Wandhöhe – Höhe kann später ergänzt werden'}</span>
              <strong data-testid="wall-area">{area !== null ? `${formatArea(area)} m²` : L.ok ? `L ${formatArea(L.value)} m` : '–'}</strong>
            </>
          ) : withArea ? (
            <>
              <span>{area !== null || !lengthValue ? 'Fläche (Länge × Breite/Höhe)' : 'Nur Länge – Fläche erst mit Breite/Höhe'}</span>
              <strong>{area !== null ? `${formatArea(area)} m²` : lengthValue && lengthValue > 0 && !v.width.trim() ? `${formatArea(lengthValue)} m` : '–'}</strong>
            </>
          ) : (
            <>
              <span>{lineGeo !== null ? 'Länge aus Plan (alle Abschnitte) – wird bei Formänderung nachgeführt' : 'Linienmessung (keine Fläche)'}</span>
              <strong>{lineGeo !== null ? `${formatArea(lineGeo)} m` : lengthValue && lengthValue > 0 ? `${formatArea(lengthValue)} m` : '–'}</strong>
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
        {positions.length > 0 && docs.length > 1 && (
          <label className="field">
            <span>LV / MFK</span>
            <select
              value={docId}
              onChange={(e) => {
                setDocId(e.target.value);
                // Position eines anderen Dokuments passt nicht mehr
                if (positionRef && docOf(positionRef) !== e.target.value) setPositionRef(null);
              }}
              data-testid="input-position-doc"
            >
              {docs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {positions.length > 0 && (
          <label className="field">
            <span>Leistungsposition (optional)</span>
            <select value={positionRef ?? ''} onChange={(e) => setPositionRef(e.target.value || null)} data-testid="input-position">
              <option value="">– keine Leistungszuordnung –</option>
              {positions
                .filter((p) => docOf(p.ref) === docId)
                .map((p) => (
                  <option key={p.ref} value={p.ref}>
                    {p.label}
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
