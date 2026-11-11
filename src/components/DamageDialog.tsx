import { useEffect, useRef, useState } from 'react';
import { PhotoAttach } from './PhotoAttach';
import type { PhotoSite } from '../lib/types';
import { uuid } from '../lib/ids';
import { rebarLine, rebarTotal } from '../lib/rebar';
import { deductionArea, deductionLength, hasArea, netArea } from '../lib/measure';
import { DAMAGE_TYPES, DEFAULT_WORK_AREAS, evalFormula, FREE_UNITS, MEASURE_TYPES, typeInfo } from '../lib/measure-types';
import { round2, checkMeasure, computeArea, formatArea, formatMeasure, parseDecimal, toInputValue } from '../lib/numbers';

/** Maße im Eingabefeld: kaufmännisch auf 2 Stellen gerundet (ältere Werte mit 3 Stellen) */
const up2 = (n: number | null | undefined) => (n === null || n === undefined ? n : round2(n));
import { damageNo, findByNumber, parseDamageNumber } from '../lib/numbering';
import { COLORS, SHAPE_LABELS, type Component, type Damage, type Deduction, type MeasureKind, type MeasureType, type RebarItem, type Shape, type ShapeType } from '../lib/types';
import { Icon } from './Icon';
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
  /** Abzüge/Zuschläge der Fläche (Tür, Öffnung …) */
  deductions: Deduction[];
  /** freie Bemerkung / Notiz; null = keine */
  note: string | null;
  /** Bewehrung in lfm; null = keine Angabe */
  rebar: number | null;
  /** Bewehrungszeilen (Stück × Länge); leer = keine */
  rebarItems: RebarItem[];
  /** Fotos (Fotodokumentation) zur Messung */
  photoIds: string[];
  /** Messart (Fläche, Wand, Länge, Volumen, Stück, Schadstelle, Frei) */
  measureType: MeasureType;
  /** Anzahl gleicher Teile (Faktor), mindestens 1 */
  count: number;
  /** Arbeitsbereich (Beton, Mauerwerk …) */
  workArea: string | null;
  /** Schadstelle: Schadensart */
  damageType: string | null;
  /** Frei: Rechnung, Einheit und Ergebnis */
  formula: string | null;
  unit: string | null;
  qty: number | null;
}

/** Eingabezeile eines Abzugs (Texte, damit Kommas und leere Felder möglich sind) */
interface DeductionRow {
  id: string;
  label: string;
  count: string;
  length: string;
  width: string;
  add: boolean;
  /** im Plan gezeichnet */
  shape?: Shape;
  labelAt?: { x: number; y: number };
  color?: string;
  /** eigene Nummer im Plan (leer = automatisch) */
  no?: string;
}

/** Bezeichnungen zur Auswahl (frei überschreibbar) */
export const DEDUCTION_NAMES = [
  'Abzug', 'Aufzug', 'Aussparung', 'Balkon', 'Durchbruch', 'Fenster', 'Fensterbank', 'Kamin', 'Leibung', 'Lichtschacht', 'Nische', 'Öffnung',
  'Pfeiler', 'Podest', 'Rampe', 'Säule', 'Schacht', 'Sockel', 'Stiege', 'Stütze', 'Tor', 'Treppe', 'Tür', 'Unterzug', 'Vorsprung', 'Wand', 'Zuschlag',
].sort((a, b) => a.localeCompare(b, 'de'));
export const DEDUCTION_COLOR = '#e03131';

/** im Plan gezeichneter Abzug: erkannte Maße (Rechteck: Breite × Höhe, sonst Fläche × 1) */
export interface DrawnDeduction {
  seq: number;
  length: number;
  width: number;
  shape: Shape;
}

export type Renumber = 'none' | 'swap' | 'shift';

interface Props {
  mode: 'new' | 'edit';
  damage: Pick<Damage, 'id' | 'number' | 'color' | 'labelOffset'> &
    Partial<Pick<Damage, 'length' | 'width' | 'depth' | 'componentId' | 'positionRef' | 'label' | 'areaFromShape' | 'deductions' | 'note' | 'rebar' | 'rebarItems' | 'photoIds' | 'measureType' | 'count' | 'workArea' | 'damageType' | 'formula' | 'unit' | 'qty'>> & { shapeType: ShapeType; kind: MeasureKind };
  others: Pick<Damage, 'id' | 'number' | 'area' | 'label'>[];
  /** Bauteilkennzeichnungen des Plans für die optionale Zuordnung */
  components: Pick<Component, 'id' | 'letter' | 'name'>[];
  /** Leistungspositionen (LV/MFK) für die optionale Zuordnung */
  positions?: { ref: string; label: string; doc: string; number?: string; shortText?: string; unit?: string }[];
  /** Gezeichnete Pläne: Maße aus der Markierung (Maßstab bekannt) als Vorschlag */
  suggestion?: { length: number; width: number | null } | null;
  /** Kalibrierter bzw. gezeichneter Plan, geschlossene Form: Fläche und Umfang aus der Geometrie */
  geometry?: { area: number; perimeter: number; formula: string } | null;
  /** Wand: offener Verlauf, Länge aus allen Abschnitten, dazu Wandhöhe → Wandfläche */
  wall?: boolean;
  /** Form ist offen (Linie, offene Polylinie): Länge aus dem Verlauf */
  openShape?: boolean;
  /** Arbeitsbereiche zur Auswahl (Vorgaben und im Projekt benutzte) */
  workAreas?: string[];
  onSave: (v: DamageValues, renumber: Renumber) => void;
  /** Baustelle der Fotodokumentation (Projekt): Fotos zur Messung aufnehmen bzw. wählen */
  photoSite?: PhotoSite | null;
  /** Vermerk-Anfang für neue Fotos, z. B. „Aufmaß A-1“ */
  photoPrefix?: string;
  onCancel: () => void;
  onDelete?: () => void;
  /** Abzug im Plan zeichnen (nur Flächen mit Maßstab): Fenster blendet sich aus, bis gezeichnet ist */
  onDrawDeduction?: () => void;
  /** zuletzt im Plan gezeichneter Abzug – wird als nummerierte Zeile übernommen */
  drawnDeduction?: DrawnDeduction | null;
  /** während im Plan gezeichnet wird: Fenster ausgeblendet (bleibt mit allen Eingaben erhalten) */
  hidden?: boolean;
  /** Maßstab bekannt: Maße eines gezeichneten Abzugs aus dem Plan (Rechteck: Breite × Höhe, sonst Fläche × 1) */
  dedFromPlan?: (shape: Shape) => { length: number; width: number } | null;
}

type Field = 'number' | 'length' | 'width' | 'depth' | 'count';

/**
 * Eingabe einer Messung bzw. Schadstelle. Öffnet sich automatisch nach dem Einzeichnen.
 * Enter/Weiter springt zum nächsten Feld; im letzten Feld wird gespeichert.
 */
export function DamageDialog({ mode, damage, others, components, positions = [], suggestion, geometry, wall: wallProp = false, openShape = wallProp, workAreas = DEFAULT_WORK_AREAS, onSave, onCancel, onDelete, onDrawDeduction, drawnDeduction, hidden, dedFromPlan, photoSite, photoPrefix }: Props) {
  // Messart: im Aufmaß vorgewählt (bzw. aus der Form), hier jederzeit umstellbar
  const [type, setTypeState] = useState<MeasureType>(
    damage.measureType ?? (damage.kind === 'damage' ? 'schadstelle' : damage.kind === 'line' ? 'laenge' : wallProp ? 'wand' : 'flaeche'),
  );
  const kind: MeasureKind = typeInfo(type).kind;
  const counted = type === 'stueck';
  const free = type === 'frei';
  /** Länge aus dem Plan je Messart: Verlauf (offene Form) bzw. Umfang (geschlossene Form) */
  const lineSuggestFor = (t: MeasureType) => {
    if (t === 'stueck' || t === 'frei') return null;
    const k = typeInfo(t).kind;
    const wm = t === 'wand' || (hasArea(k) && openShape);
    if (hasArea(k) && !wm) return null;
    return openShape ? (suggestion?.length ?? null) : (geometry?.perimeter ?? null);
  };
  // Länge × Höhe/Breite entlang des Verlaufs: Wand (auch rundum: Umfang × Höhe) bzw. Fläche entlang einer Linie
  const wall = type === 'wand' || (hasArea(kind) && openShape);
  /** Fläche und Umfang aus dem Plan übernehmen (nur bei Flächen-Messarten) */
  // Linie: Länge aus dem Plan (kalibriert) – bei neuen Linien vorgewählt, wird bei Formänderung nachgeführt
  const lineSuggest = lineSuggestFor(type);
  const [fromShape, setFromShape] = useState(
    damage.areaFromShape ? !!geometry || lineSuggest !== null : mode === 'new' && lineSuggest !== null && lineSuggest > 0,
  );
  const [v, setV] = useState({
    number: damage.label ?? String(damage.number),
    length: toInputValue(up2(damage.length)),
    width: toInputValue(up2(damage.width)),
    depth: toInputValue(up2(damage.depth)),
    count: String(damage.count && damage.count > 0 ? damage.count : 1),
  });
  const [workArea, setWorkArea] = useState(damage.workArea ?? '');
  const [damageType, setDamageType] = useState(damage.damageType ?? '');
  const [formula, setFormula] = useState(damage.formula ?? (damage.qty !== null && damage.qty !== undefined ? toInputValue(damage.qty) : ''));
  const [unit, setUnit] = useState(damage.unit ?? '');
  /** Messart wechseln: bei neuen Messungen die Länge aus dem Plan gleich vorwählen */
  const setType = (t: MeasureType) => {
    setTypeState(t);
    if (mode !== 'new') return;
    const ls = lineSuggestFor(t);
    const k = typeInfo(t).kind;
    setFromShape(ls !== null && ls > 0 ? true : hasArea(k) && !(t === 'wand' || openShape) ? !!damage.areaFromShape && !!geometry : false);
  };
  const [color, setColor] = useState(damage.color);
  const [shapeType, setShapeType] = useState<ShapeType>(damage.shapeType);
  const [componentId, setComponentId] = useState<string | null>(damage.componentId ?? null);
  const [positionRef, setPositionRef] = useState<string | null>(damage.positionRef ?? null);
  const [pickPos, setPickPos] = useState(false);
  /** Suche direkt im Dialog: Positionsnummer oder Kurztext */
  const [posQ, setPosQ] = useState('');
  const [note, setNote] = useState(damage.note ?? '');
  // Bewehrung: Zeilen „Stück × Länge“ (Texte, damit Kommas und leere Felder möglich sind)
  const [rebarRows, setRebarRows] = useState<{ id: string; count: string; length: string }[]>(() =>
    (damage.rebarItems?.length ? damage.rebarItems : damage.rebar ? [{ id: uuid(), count: 1, length: damage.rebar }] : []).map((x) => ({ id: 'id' in x ? x.id : uuid(), count: String(x.count), length: toInputValue(x.length) })),
  );
  const rebarParsed = rebarRows
    .filter((r) => r.count.trim() || r.length.trim())
    .map((r) => {
      const count = parseDecimal(r.count || '1');
      const length = parseDecimal(r.length);
      const ok = count !== null && Number.isInteger(count) && count >= 1 && length !== null && length > 0;
      return { id: r.id, count: count ?? 0, length: length ?? 0, ok };
    });
  const rebarError = rebarParsed.some((x) => !x.ok) ? 'Bewehrung: Stück als ganze Zahl ab 1 und Länge in m (z. B. 1,20) eingeben.' : null;
  const rebarSum = rebarTotal(rebarParsed.filter((x) => x.ok));
  const setRebarRow = (id: string, patch: Partial<{ count: string; length: string }>) => setRebarRows((list) => list.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const [photoIds, setPhotoIds] = useState<string[]>(damage.photoIds ?? []);
  // erst LV bzw. MFK wählen, dann deren Positionen (Verweis „Dokument:Position“)
  const docOf = (ref: string) => ref.slice(0, ref.indexOf(':'));
  const docs = [...new Map(positions.map((p) => [docOf(p.ref), p.doc])).entries()].map(([id, label]) => ({ id, label }));
  const [docId, setDocId] = useState<string>(() => (damage.positionRef && positions.some((p) => p.ref === damage.positionRef) ? docOf(damage.positionRef) : (docs[0]?.id ?? '')));
  const [resetLabel, setResetLabel] = useState(false);
  const [deds, setDeds] = useState<DeductionRow[]>(() =>
    (damage.deductions ?? []).map((x) => ({ id: x.id, label: x.label, count: String(x.count), length: toInputValue(up2(x.length)), width: toInputValue(up2(x.width)), add: !!x.add, ...(x.shape ? { shape: x.shape } : {}), ...(x.labelAt ? { labelAt: x.labelAt } : {}), ...(x.color ? { color: x.color } : {}), ...(x.no ? { no: x.no } : {}) })),
  );
  // im Plan gezeichneten Abzug übernehmen: fortlaufend nummeriert („Abzug 1“, „Abzug 2“ …)
  const lastDrawn = useRef(drawnDeduction?.seq ?? 0);
  /** gezeichnete Form als Zuschlag (true) oder Abzug (false) übernehmen */
  const drawAdd = useRef(false);
  useEffect(() => {
    if (!drawnDeduction || drawnDeduction.seq === lastDrawn.current) return;
    lastDrawn.current = drawnDeduction.seq;
    setDeds((list) => [
      ...list,
      {
        id: uuid(),
        label: `${drawAdd.current ? 'Zuschlag' : 'Abzug'} ${list.filter((x) => x.shape && !!x.add === drawAdd.current).length + 1}`,
        count: '1',
        length: toInputValue(round2(drawnDeduction.length)),
        width: toInputValue(round2(drawnDeduction.width)),
        add: drawAdd.current,
        shape: drawnDeduction.shape,
        color: DEDUCTION_COLOR,
      },
    ]);
  }, [drawnDeduction]);
  const [showErrors, setShowErrors] = useState(false);
  const refs = useRef<Record<string, HTMLInputElement | null>>({});
  // Wand mit Länge aus dem Plan: gleich nach der Wandhöhe fragen (nach dem Fokus des Dialogs)
  useEffect(() => {
    if (mode === 'new' && wall && refs.current.width && !refs.current.length) refs.current.width.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const withArea = hasArea(kind);
  // Aus der Geometrie: Fläche und Umfang kommen aus der Form, nur Nummer und Tiefe sind einzugeben
  const geo = withArea && !wall && !counted && !free && fromShape && geometry ? geometry : null;
  // Linie: Länge, dazu optional Höhe und Tiefe (getrennt, keine Fläche)
  const lineGeo = (!withArea || wall) && fromShape && lineSuggest !== null && lineSuggest > 0 ? lineSuggest : null;
  const fields: Field[] = counted ? ['number', 'count'] : free ? ['number'] : geo ? ['number', 'depth'] : lineGeo !== null ? ['number', 'width', 'depth'] : ['number', 'length', 'width', 'depth'];
  // Anzahl (Faktor): ganze Zahl ab 1
  const nRaw = v.count.trim();
  const nVal = nRaw ? parseDecimal(nRaw) : 1;
  const countErr = nVal === null || !Number.isInteger(nVal) || nVal < 1 || nVal > 99999 ? 'Anzahl: ganze Zahl ab 1.' : null;
  const n = countErr || free ? 1 : nVal!;
  // Frei: eigene Rechnung, z. B. 2*3,5+1,2
  const qty = free ? evalFormula(formula) : null;
  const freeErr = free && qty === null ? (formula.trim() ? 'Rechnung ungültig – erlaubt sind Zahlen, + − × / und Klammern.' : 'Bitte die Menge bzw. Rechnung eingeben, z. B. 2*3,5+1,2.') : null;

  // Reine Zahl = Nummer; sonst Kennzeichnung aus Buchstaben (z. B. „A“, „Wand B“, „1A“).
  // Eine unveränderte bestehende Nummer (auch eine ältere 0) bleibt gültig; neue Nummern ab 1
  const raw = v.number.trim();
  const isNumeric = /^\d+$/.test(raw);
  const num = isNumeric ? (!damage.label && raw === String(damage.number) ? damage.number : parseDamageNumber(raw)) : null;
  const label = !isNumeric && raw ? raw : null;
  const labelTaken = label ? others.find((o) => o.id !== damage.id && damageNo(o).toLowerCase() === label.toLowerCase()) : undefined;
  const L = counted || free ? ({ ok: true, value: 0 } as const) : geo ? ({ ok: true, value: geo.perimeter } as const) : lineGeo !== null ? ({ ok: true, value: lineGeo } as const) : checkMeasure(v.length, 'Länge');
  // Nur die Länge ist Pflicht. Breite/Höhe und Tiefe sind optional: leer bleibt leer (null,
  // nicht 0), eine Eingabe muss aber gültig sein
  const B = !geo && !counted && !free && v.width.trim() ? checkMeasure(v.width, withArea && !wall ? 'Breite/Höhe' : type === 'wand' ? 'Wandhöhe' : wall ? 'Breite' : 'Höhe') : null;
  // Volumen: Höhe bzw. Tiefe ist Pflicht
  const T = counted || free ? null : v.depth.trim() ? checkMeasure(v.depth, type === 'volumen' ? 'Höhe/Tiefe' : 'Tiefe') : type === 'volumen' ? ({ ok: false, error: 'Für das Volumen die Höhe bzw. Tiefe eingeben.' } as const) : null;
  const gross1 = geo ? geo.area : withArea && L.ok && B?.ok ? computeArea(L.value, B.value) : null;
  // Anzahl: Fläche je Stück × Anzahl (Abzüge/Zuschläge gelten für alle zusammen)
  const gross = gross1 === null || n === 1 ? gross1 : Math.round(gross1 * n * 1e9) / 1e9;
  // Abzüge/Zuschläge: Flächen mit Breite × Höhe, Linien nur mit Länge; nur vollständige Zeilen zählen
  const lineDeds = !withArea;
  const dedErrors = deds.map((r) => {
    const l = parseDecimal(r.length);
    const w = parseDecimal(r.width);
    const c = r.count.trim() ? Number(r.count.trim()) : 1;
    if (lineDeds) {
      if (!r.length.trim()) return 'Länge fehlt.';
      if (l === null || l <= 0) return 'Länge muss größer als 0 sein.';
    } else {
      if (!r.length.trim() && !r.width.trim()) return 'Breite und Höhe fehlen.';
      if (l === null || l <= 0 || w === null || w <= 0) return 'Breite und Höhe müssen größer als 0 sein.';
    }
    if (!Number.isInteger(c) || c < 1 || c > 999) return 'Anzahl: ganze Zahl ab 1.';
    return null;
  });
  const deductions: Deduction[] = deds
    .filter((_, i) => !dedErrors[i])
    .map((r) => ({
      id: r.id,
      label: r.label.trim(),
      count: r.count.trim() ? Number(r.count.trim()) : 1,
      length: parseDecimal(r.length)!,
      ...(lineDeds ? {} : { width: parseDecimal(r.width)! }),
      ...(r.add ? { add: true } : {}),
      ...(r.shape ? { shape: r.shape } : {}),
      ...(r.labelAt ? { labelAt: r.labelAt } : {}),
      ...(r.shape ? { color: r.color ?? DEDUCTION_COLOR } : {}),
      ...(r.no?.trim() ? { no: r.no.trim() } : {}),
    }));
  const area = netArea(gross, deductions);
  const dedValue = (x: Deduction) => (lineDeds ? deductionLength(x) : deductionArea(x));
  // Linie: gemessene Länge (von Hand oder aus dem Plan) und Nettolänge mit Abzügen
  const lineGross = lineDeds && L.ok ? Math.round(L.value * n * 1e9) / 1e9 : null;
  const lineNet = lineGross === null ? null : Math.round(deductions.reduce((s, x) => s + deductionLength(x), lineGross) * 1e9) / 1e9;
  const setDed = (id: string, patch: Partial<DeductionRow>) => setDeds((list) => list.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  /** automatische Nummer eines im Plan gezeichneten Abzugs („3-A1“) */
  const autoDedNo = (i: number) => `${damageNo(damage)}-${deds[i].add ? 'Z' : 'A'}${deds.slice(0, i + 1).filter((x) => !!x.add === !!deds[i].add).length}`;
  const newDed = (add: boolean) => setDeds((list) => [...list, { id: uuid(), label: '', count: '1', length: '', width: '', add }]);
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
    count: free ? null : countErr,
  };
  const valid = fields.every((f) => !errors[f]) && (free || !countErr) && !freeErr && (counted || free || dedErrors.every((e) => !e)) && !rebarError;

  const submit = (renumber: Renumber = 'none') => {
    setShowErrors(true);
    if (!valid || (num === null && !label) || !L.ok) {
      const first = fields.find((f) => errors[f]) ?? (errors.count ? 'count' : undefined);
      if (first) refs.current[first]?.focus();
      return;
    }
    if (conflict && renumber === 'none') return; // Hinweis wird angezeigt
    onSave(
      {
        number: num ?? (damage.label ? damage.number : 0),
        label,
        kind,
        measureType: type,
        count: n,
        workArea: workArea.trim() || null,
        damageType: type === 'schadstelle' ? damageType.trim() || null : null,
        formula: free ? formula.trim() || null : null,
        unit: free ? unit.trim() || null : null,
        qty: free ? qty : null,
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
        deductions: counted || free ? [] : deductions,
        note: note.trim() || null,
        rebar: rebarParsed.length && !rebarError ? rebarSum : null,
        rebarItems: rebarError ? [] : rebarParsed.map(({ id, count, length }) => ({ id, count, length })),
        photoIds,
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
          placeholder={undefined}
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
      title={mode === 'new' ? `Neue Messung: ${typeInfo(type).label}` : `${typeInfo(type).label} ${damageNo(damage)} bearbeiten`}
      onClose={onCancel}
      persistent
      testId="damage-dialog"
      className={hidden ? 'modal-hidden' : undefined}
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
        <label className="field mtype-field">
          <span>Messart</span>
          <select value={type} onChange={(e) => setType(e.target.value as MeasureType)} data-testid="measure-type-select">
            {MEASURE_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label} {t.unit ? `(${t.unit})` : '(eigene Einheit)'}
              </option>
            ))}
          </select>
          <small className="muted">{typeInfo(type).hint}</small>
        </label>
        <div className="measure-grid">
          {field('number', 'Nr. / Kennz.', 'Nr.')}
          {counted ? (
            field('count', 'Anzahl *', 'Stk')
          ) : free ? (
            <>
              <label className="field measure-field measure-field-wide">
                <span>Menge / Rechnung *</span>
                <input
                  value={formula}
                  onChange={(e) => setFormula(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      submit();
                    }
                  }}
                  inputMode="text"
                  autoComplete="off"
                  placeholder="z. B. 2*3,5+1,2"
                  aria-invalid={showErrors && !!freeErr}
                  data-autofocus={mode === 'new' ? '' : undefined}
                  data-testid="input-formula"
                />
                {showErrors && freeErr && <small className="error">{freeErr}</small>}
              </label>
              <label className="field measure-field">
                <span>Einheit</span>
                <input value={unit} onChange={(e) => setUnit(e.target.value)} list="free-units" autoComplete="off" placeholder="z. B. kg" data-testid="input-unit" />
                <datalist id="free-units">
                  {FREE_UNITS.map((u) => (
                    <option key={u} value={u} />
                  ))}
                </datalist>
              </label>
            </>
          ) : geo ? (
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
          {!counted && !free && !geo && field('width', type === 'wand' ? 'Wandhöhe' : wall ? 'Breite' : withArea ? 'Breite / Höhe' : 'Höhe', 'm')}
          {!counted && !free && field('depth', type === 'volumen' ? 'Höhe / Tiefe *' : 'Tiefe', 'm')}
        </div>
        <div className="measure-extra">
          {!counted && !free && (
            <label className="field measure-field measure-count">
              <span>Anzahl</span>
              <div className="input-unit">
                <input
                  ref={(el) => {
                    refs.current.count = el;
                  }}
                  value={v.count}
                  onChange={(e) => setV({ ...v, count: e.target.value })}
                  onFocus={(e) => e.target.select()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      submit();
                    }
                  }}
                  inputMode="numeric"
                  autoComplete="off"
                  aria-invalid={showErrors && !!countErr}
                  data-testid="input-count"
                />
                <span className="unit">×</span>
              </div>
              {showErrors && countErr && <small className="error">{countErr}</small>}
            </label>
          )}
          <label className="field measure-field">
            <span>Arbeitsbereich</span>
            <input value={workArea} onChange={(e) => setWorkArea(e.target.value)} list="work-areas" autoComplete="off" placeholder="z. B. Beton" data-testid="input-work-area" />
            <datalist id="work-areas">
              {[...new Set([...workAreas, ...DEFAULT_WORK_AREAS])].map((w) => (
                <option key={w} value={w} />
              ))}
            </datalist>
          </label>
          {type === 'schadstelle' && (
            <label className="field measure-field">
              <span>Schadensart</span>
              <input value={damageType} onChange={(e) => setDamageType(e.target.value)} list="damage-types" autoComplete="off" placeholder="z. B. Abplatzung" data-testid="input-damage-type" />
              <datalist id="damage-types">
                {DAMAGE_TYPES.map((d) => (
                  <option key={d} value={d} />
                ))}
              </datalist>
            </label>
          )}
        </div>
        {withArea && !wall && geometry && (
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
        {lineSuggest !== null && lineSuggest > 0 && (
          <button
            type="button"
            className={`btn btn-sm suggest-btn${lineGeo !== null ? ' active' : ''}`}
            onClick={() => setFromShape(lineGeo === null)}
            aria-pressed={lineGeo !== null}
            data-testid="use-geometry"
          >
            {lineGeo !== null ? 'Länge wieder von Hand eingeben' : `Länge aus Plan übernehmen: ${formatArea(lineSuggest)} m (${openShape ? 'alle Abschnitte' : 'Umfang'})`}
          </button>
        )}
        {suggestion && !geo && withArea && !wall && !counted && !free && (
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
          {counted ? (
            <>
              <span>Stückzahl</span>
              <strong data-testid="count-result">{countErr ? '–' : `${n} Stk`}</strong>
            </>
          ) : free ? (
            <>
              <span>Menge (eigene Rechnung)</span>
              <strong data-testid="free-result">{qty === null ? '–' : `${formatArea(qty)}${unit.trim() ? ` ${unit.trim()}` : ''}`}</strong>
            </>
          ) : geo ? (
            <>
              <span>Fläche aus Plan ({geo.formula}){deductions.length ? ', netto mit Abzügen' : ''} – wird bei Formänderung nachgeführt</span>
              <strong>{formatArea(area)} m²</strong>
            </>
          ) : wall ? (
            <>
              <span>{area !== null ? (deductions.length ? 'Wandfläche netto (Länge × Höhe, mit Abzügen)' : 'Wandfläche (Länge × Höhe)') : 'Wandfläche erst mit Wandhöhe – Höhe kann später ergänzt werden'}</span>
              <strong data-testid="wall-area">{area !== null ? `${formatArea(area)} m²` : L.ok ? `L ${formatArea(L.value)} m` : '–'}</strong>
            </>
          ) : withArea ? (
            <>
              <span>{area !== null || !lengthValue ? (deductions.length && area !== null ? 'Fläche netto (mit Abzügen)' : 'Fläche (Länge × Breite/Höhe)') : 'Nur Länge – Fläche erst mit Breite/Höhe'}</span>
              <strong>{area !== null ? `${formatArea(area)} m²` : lengthValue && lengthValue > 0 && !v.width.trim() ? `${formatArea(lengthValue)} m` : '–'}</strong>
            </>
          ) : (
            <>
              <span>
                {lineGeo !== null ? `Länge aus Plan (${openShape ? 'alle Abschnitte' : 'Umfang'}) – wird bei Formänderung nachgeführt` : 'Längenmessung (keine Fläche)'}
                {n > 1 ? ` · ${n} ×` : ''}
                {deductions.length > 0 && lineNet !== null ? ' · netto mit Abzügen' : ''}
              </span>
              <strong data-testid="line-result">{lineNet !== null && L.ok && L.value > 0 ? `${formatArea(lineNet)} m` : '–'}</strong>
            </>
          )}
        </div>
        {type === 'volumen' && (
          <div className="area-result" data-testid="volume-result">
            <span>Volumen (Fläche × Höhe/Tiefe)</span>
            <strong>{area !== null && T?.ok ? `${formatArea(round2(area * T.value))} m³` : '–'}</strong>
          </div>
        )}
        {pickPos && (
          <PositionPicker
            positions={positions.filter((p) => !docId || docOf(p.ref) === docId)}
            selected={positionRef}
            onClose={() => setPickPos(false)}
            onPick={(ref) => {
              setPositionRef(ref);
              if (ref) setDocId(docOf(ref));
              setPickPos(false);
            }}
          />
        )}
        <datalist id="deduction-names">
          {DEDUCTION_NAMES.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        {!counted && !free && (
        <div className="deductions" data-testid="deductions">
          <div className="deductions-head">
            <strong>Abzüge / Zuschläge</strong>
            <span className="muted small">{lineDeds ? 'Länge, z. B. Türöffnung, Durchgang' : 'z. B. Tür, Fenster, Öffnung'}</span>
          </div>
          {deds.map((r, i) => {
            const a = dedErrors[i] ? null : dedValue(deductions.find((x) => x.id === r.id)!);
            return (
              <div key={r.id} className="deduction-row" data-testid="deduction-row">
                <button
                  type="button"
                  className={`deduction-sign${r.add ? ' add' : ''}`}
                  onClick={() => setDed(r.id, { add: !r.add })}
                  aria-label={r.add ? 'Wird hinzugerechnet – antippen zum Abziehen' : 'Wird abgezogen – antippen zum Hinzurechnen'}
                  title={r.add ? 'Zuschlag (hinzurechnen)' : 'Abzug (abziehen)'}
                  data-testid="deduction-sign"
                >
                  {r.add ? '+' : '−'}
                </button>
                <input
                  className="deduction-label"
                  value={r.label}
                  onChange={(e) => setDed(r.id, { label: e.target.value })}
                  placeholder={r.add ? 'Bezeichnung (z. B. Nische)' : 'Bezeichnung (z. B. Tür)'}
                  aria-label="Bezeichnung"
                  list="deduction-names"
                  autoComplete="off"
                  data-testid="deduction-label"
                />
                <select
                  className="deduction-name-pick"
                  value=""
                  onChange={(e) => e.target.value && setDed(r.id, { label: e.target.value })}
                  aria-label="Bezeichnung wählen"
                  title="Bezeichnung wählen"
                  data-testid="deduction-name-pick"
                >
                  <option value="">▾</option>
                  {DEDUCTION_NAMES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                {(
                  <input
                    className="deduction-no"
                    value={r.no ?? ''}
                    onChange={(e) => setDed(r.id, { no: e.target.value })}
                    placeholder={`Nr. ${autoDedNo(i)}`}
                    aria-label="Nummer im Plan"
                    title="Nummer im Plan – leer = automatisch"
                    autoComplete="off"
                    maxLength={12}
                    data-testid="deduction-no"
                  />
                )}
                {r.shape && dedFromPlan && (
                  <button
                    type="button"
                    className="btn btn-sm deduction-from-plan"
                    onClick={() => {
                      const m = dedFromPlan(r.shape!);
                      if (m) setDed(r.id, { length: toInputValue(m.length), width: toInputValue(m.width) });
                    }}
                    title="Fläche aus dem Plan erkennen (Plan hat einen Maßstab)"
                    data-testid="deduction-from-plan"
                  >
                    Fläche aus Plan
                  </button>
                )}
                {r.shape && (
                  <span className="deduction-colors" role="radiogroup" aria-label="Farbe im Plan" data-testid="deduction-colors">
                    {COLORS.map((c) => (
                      <button
                        key={c.value}
                        type="button"
                        role="radio"
                        aria-checked={(r.color ?? DEDUCTION_COLOR) === c.value}
                        className={`swatch swatch-sm${(r.color ?? DEDUCTION_COLOR) === c.value ? ' active' : ''}`}
                        style={{ background: c.value }}
                        title={c.name}
                        onClick={() => setDed(r.id, { color: c.value })}
                        data-testid="deduction-color"
                      />
                    ))}
                  </span>
                )}
                <button type="button" className="icon-btn icon-btn-sm" onClick={() => setDeds((list) => list.filter((x) => x.id !== r.id))} aria-label="Zeile entfernen" data-testid="deduction-remove">
                  <Icon name="trash" size={16} />
                </button>
                <span className="deduction-nums">
                  <input value={r.count} onChange={(e) => setDed(r.id, { count: e.target.value })} inputMode="numeric" placeholder="1" aria-label="Anzahl" className="deduction-count" data-testid="deduction-count" />
                  <span aria-hidden="true">×</span>
                  <input
                    value={r.length}
                    onChange={(e) => setDed(r.id, { length: e.target.value })}
                    inputMode="decimal"
                    placeholder={lineDeds ? 'Länge' : 'Breite'}
                    aria-label={lineDeds ? 'Länge in m' : 'Breite in m'}
                    data-testid="deduction-length"
                  />
                  {!lineDeds && (
                    <>
                      <span aria-hidden="true">×</span>
                      <input value={r.width} onChange={(e) => setDed(r.id, { width: e.target.value })} inputMode="decimal" placeholder="Höhe" aria-label="Höhe in m" data-testid="deduction-width" />
                    </>
                  )}
                  <span className="muted small">m =</span>
                  <span className="deduction-area" data-testid="deduction-area">
                    {a === null ? '' : `${a < 0 ? '−' : '+'}${formatArea(Math.abs(a))} ${lineDeds ? 'm' : 'm²'}`}
                  </span>
                </span>
                {showErrors && dedErrors[i] && <small className="error">{dedErrors[i]}</small>}
              </div>
            );
          })}
          {deductions.length > 0 && (
            <p className="deduction-sum small" data-testid="deduction-sum">
              {lineDeds ? (
                lineGross === null ? (
                  'Abzüge wirken, sobald eine Länge eingegeben ist.'
                ) : (
                  <>
                    Gemessen {formatArea(lineGross)} m {deductions.map((x) => `${dedValue(x) < 0 ? '−' : '+'} ${formatArea(Math.abs(dedValue(x)))}`).join(' ')} = <strong>netto {formatArea(lineNet)} m</strong>
                  </>
                )
              ) : gross === null ? (
                'Abzüge wirken erst, wenn eine Fläche berechnet ist (Länge × Breite/Höhe).'
              ) : (
                <>
                  Brutto {formatArea(gross)} m² {deductions.map((x) => `${dedValue(x) < 0 ? '−' : '+'} ${formatArea(Math.abs(dedValue(x)))}`).join(' ')} = <strong>netto {formatArea(area)} m²</strong>
                </>
              )}
            </p>
          )}
          <div className="row gap wrap ded-actions">
            <button type="button" className="btn btn-sm" onClick={() => newDed(false)} data-testid="deduction-add">
              − Abzug hinzufügen
            </button>
            <button type="button" className="btn btn-sm" onClick={() => newDed(true)} data-testid="deduction-add-plus">
              + Zuschlag hinzufügen
            </button>
          </div>
          {onDrawDeduction && !lineDeds && (
            <div className="row gap wrap ded-actions ded-actions-2">
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    drawAdd.current = false;
                    onDrawDeduction();
                  }}
                  title="Abzug im Plan zeichnen"
                  data-testid="deduction-draw"
                >
                  <Icon name="edit" size={16} /> − Im Plan zeichnen
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    drawAdd.current = true;
                    onDrawDeduction();
                  }}
                  title="Zuschlag im Plan zeichnen"
                  data-testid="deduction-draw-plus"
                >
                  <Icon name="edit" size={16} /> + Im Plan zeichnen
                </button>
            </div>
          )}
        </div>
        )}
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
            <span>Bauteil</span>
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
          <div className="field">
            <span>Leistungsposition</span>
            {/* Antippen öffnet das Suchfenster (Position, Kurztext, EH) */}
            <div className="position-row">
              <button
                type="button"
                className="position-field"
                onClick={() => setPickPos(true)}
                title="Alle Positionen anzeigen"
                data-value={positionRef ?? ''}
                data-testid="input-position"
              >
                <span className={positionRef ? '' : 'muted'}>{positions.find((p) => p.ref === positionRef)?.label ?? '– keine Leistungszuordnung –'}</span>
                <Icon name="search" size={18} />
              </button>
              {positionRef && (
                <button type="button" className="icon-btn position-clear" onClick={() => setPositionRef(null)} aria-label="Leistungsposition entfernen" title="Leistungsposition entfernen" data-testid="input-position-clear">
                  ✕
                </button>
              )}
            </div>
            {(() => {
              const needle = posQ.trim().toLowerCase();
              const hits = needle
                ? positions
                    .filter((p) => !docId || docOf(p.ref) === docId)
                    .filter((p) => [p.number ?? '', p.shortText ?? p.label].some((t) => t.toLowerCase().includes(needle)))
                    .slice(0, 6)
                : [];
              return (
                <div className="position-inline">
                  <input
                    type="search"
                    value={posQ}
                    onChange={(e) => setPosQ(e.target.value)}
                    placeholder="Position suchen: Nummer oder Kurztext"
                    aria-label="Leistungsposition suchen"
                    data-testid="input-position-search"
                  />
                  {needle && (
                    <div className="position-hits" data-testid="position-hits">
                      {hits.map((p) => (
                        <button
                          key={p.ref}
                          type="button"
                          className={`position-hit${p.ref === positionRef ? ' sel' : ''}`}
                          onClick={() => {
                            setPositionRef(p.ref);
                            setDocId(docOf(p.ref));
                            setPosQ('');
                          }}
                          data-testid="position-suggestion"
                        >
                          <strong>{p.number ?? ''}</strong> <span>{p.shortText ?? p.label}</span>
                          {p.unit && <span className="muted"> ({p.unit})</span>}
                        </button>
                      ))}
                      {!hits.length && <span className="muted small">Keine Position gefunden.</span>}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}
        <div className="field rebar-field" data-testid="rebar">
          <span>Bewehrung (optional)</span>
          {rebarRows.map((r, i) => {
            const p = rebarParsed.find((x) => x.id === r.id);
            return (
              <div key={r.id} className="rebar-row" data-testid="rebar-row">
                <input
                  type="text"
                  inputMode="numeric"
                  value={r.count}
                  onChange={(e) => setRebarRow(r.id, { count: e.target.value })}
                  placeholder="1"
                  aria-label={`Bewehrung ${i + 1}: Stück`}
                  aria-invalid={showErrors && !!p && !p.ok}
                  data-testid="rebar-count"
                />
                <span className="muted">Stk ×</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={r.length}
                  onChange={(e) => setRebarRow(r.id, { length: e.target.value })}
                  placeholder="Länge"
                  aria-label={`Bewehrung ${i + 1}: Länge in m`}
                  aria-invalid={showErrors && !!p && !p.ok}
                  data-testid="rebar-length"
                />
                <span className="muted">m</span>
                <span className="rebar-line" data-testid="rebar-line">
                  {p?.ok ? `= ${formatMeasure(rebarLine(p))} lfm` : ''}
                </span>
                <button type="button" className="icon-btn icon-btn-sm" onClick={() => setRebarRows((list) => list.filter((x) => x.id !== r.id))} aria-label={`Bewehrung ${i + 1} entfernen`} data-testid="rebar-remove">
                  ✕
                </button>
              </div>
            );
          })}
          <div className="row gap wrap rebar-foot">
            <button type="button" className="btn btn-sm" onClick={() => setRebarRows((list) => [...list, { id: uuid(), count: '1', length: '' }])} data-testid="rebar-add">
              + Bewehrung
            </button>
            {rebarParsed.some((x) => x.ok) && (
              <strong data-testid="rebar-sum">Summe {formatMeasure(rebarSum)} lfm</strong>
            )}
          </div>
          {showErrors && rebarError && <small className="error">{rebarError}</small>}
        </div>
        <label className="field">
          <span>Bemerkung / Notiz</span>
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional, z. B. Hinweis zur Messung" data-testid="input-note" />
        </label>
        {photoSite && (
          <PhotoAttach
            site={photoSite}
            ids={photoIds}
            onChange={setPhotoIds}
            description={`${photoPrefix ?? 'Aufmaß'} Nr. ${v.number.trim() || damage.label || damage.number}`}
            hint="„Fotos aufnehmen“: Foto machen, beliebig viele, dann Haken – alle Fotos gehören zu dieser Nummer und landen auch in der Fotodokumentation."
          />
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

/** Leistungsposition suchen: breites Fenster mit Suche, Spalten Position, Kurztext, Einheit (und LV/MFK) */
export function PositionPicker({
  positions,
  selected,
  onClose,
  onPick,
}: {
  positions: { ref: string; label: string; doc: string; number?: string; shortText?: string; unit?: string }[];
  selected: string | null;
  onClose: () => void;
  onPick: (ref: string | null) => void;
}) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const multi = new Set(positions.map((p) => p.doc)).size > 1;
  const shown = positions.filter((p) => !needle || [p.number ?? '', p.shortText ?? p.label, p.doc].some((t) => t.toLowerCase().includes(needle)));
  return (
    <Modal title="Leistungsposition wählen" onClose={onClose} wide testId="position-picker" className="position-picker-modal">
      <input type="search" className="position-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suchen: Positionsnummer oder Kurztext" autoFocus data-testid="position-search" />
      <div className="position-table-wrap">
        <table className="position-table">
          <colgroup>
            <col className="col-pos" />
            <col />
            <col className="col-eh" />
            {multi && <col className="col-doc" />}
          </colgroup>
          <thead>
            <tr>
              <th>Position</th>
              <th>Kurztext</th>
              <th>EH</th>
              {multi && <th>LV / MFK</th>}
            </tr>
          </thead>
          <tbody>
            <tr className={!selected ? 'sel' : ''} onClick={() => onPick(null)} data-testid="position-option-none">
              <td colSpan={multi ? 4 : 3} className="muted">– keine Leistungszuordnung –</td>
            </tr>
            {shown.map((p) => (
              <tr key={p.ref} className={selected === p.ref ? 'sel' : ''} onClick={() => onPick(p.ref)} data-testid="position-option">
                <td className="pos-no">{p.number ?? ''}</td>
                <td>{p.shortText ?? p.label}</td>
                <td>{p.unit || '–'}</td>
                {multi && <td className="muted small">{p.doc}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length && <p className="muted">Keine Position gefunden.</p>}
      </div>
    </Modal>
  );
}
