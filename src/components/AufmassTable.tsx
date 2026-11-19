import { SelectBox, type Selection } from './Selection';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import type { AufmassRow } from '../lib/aufmass';
import { linesByType } from '../lib/aufmass';
import { deductionText, grossArea, hasArea, isWall, kindOf, measureLabel, netLength } from '../lib/measure';
import { formatArea, formatDepth, formatMeasure, naturalCompare } from '../lib/numbers';
import { countOf, MEASURE_TYPES, normUnit, quantityOfMeasure, totalsByUnit, typeInfo, typeOf } from '../lib/measure-types';
import { damageNo } from '../lib/numbering';
import type { Component, Damage, MeasureType } from '../lib/types';
import { Icon } from './Icon';

type IconName = Parameters<typeof Icon>[0]['name'];

interface Props {
  rows: AufmassRow[];
  /** Plannummer vor der Messung (Aufmaß über mehrere Pläne) */
  showPlan?: boolean;
  selectedId?: string | null;
  /** Antippen: Messung auswählen (im Plan zeigen) bzw. – ohne onEdit – öffnen */
  onSelect?: (row: AufmassRow) => void;
  /** Ausgewählte Messung noch einmal antippen: Messung öffnen */
  onEdit?: (row: AufmassRow) => void;
  duplicates?: Set<string>;
  /** Bauteilkennzeichnungen (id → Bauteil) */
  components?: Record<string, Pick<Component, 'letter' | 'name' | 'deletedAt'>>;
  /** Positionsnummer zu einem Leistungsverweis */
  positionLabel?: (ref: string) => string | null;
  /** Überschrift einer Positionsgruppe (z. B. „01.02 Spachteln (m²)“); mit Positionen wird nach LV-Position gruppiert */
  positionTitle?: (ref: string) => string | null;
  /** Reihenfolge der Positionen (z. B. LV-Reihenfolge); fehlt = nach Positionsnummer */
  positionOrder?: (ref: string) => number;
  /**
   * Positionen, bei denen eine Messung zählt – die erste ist die Hauptposition (Gruppe). Fehlt = nur die von Hand
   * zugeordnete. Schadstellen zählen über die Regeln des LV oft bei mehreren Positionen (Klasse, Zulage, Folgeleistung).
   */
  positionsOf?: (d: Damage) => string[];
  /** LV trennt nach Boden, Wand und Decke – Schadstellen ohne Fläche bekommen den Hinweis „Fläche wählen“ */
  surfaceNeeded?: boolean;
  /** Mehrfachauswahl: Zeile antippen wählt aus (statt zu öffnen), Kästchen vor der Nummer */
  sel?: Selection;
}

/** Zahl einer Menge in ihrer (normierten) Einheit: Stück ganz, sonst zwei Nachkommastellen */
function formatQty(value: number | null, unit: string): string {
  if (value === null) return '–';
  if (unit === 'Stk') return String(Math.round(value));
  return unit === 'm' ? formatMeasure(value) : formatArea(value);
}

/** Länge einer Messung: „Anzahl × Länge“ bzw. „U …“ (Umfang) bei aus dem Plan berechneten Flächen */
function lengthText(d: Damage): string {
  if (d.areaFromShape && hasArea(kindOf(d)) && !isWall(d)) return `U ${formatMeasure(d.length)}`;
  return `${(d.count ?? 1) > 1 ? `${d.count} × ` : ''}${formatMeasure(d.length)}`;
}

/**
 * Maße einer Messung für die Zeile – nur was zum Ergebnis führt: Fläche/Wand/Schadstelle Länge × Breite (× Tiefe),
 * Volumen Länge × Breite × Tiefe, Länge nur bei Anzahl > 1, Frei die eigene Rechnung, Stück nichts.
 */
function dimsOf(d: Damage): string[] {
  const t = typeOf(d);
  if (t === 'stueck') return [];
  if (t === 'frei') {
    const f = d.formula?.trim();
    return f && d.qty !== null && d.qty !== undefined && f.replace(',', '.') !== String(d.qty) ? [f] : [];
  }
  if (t === 'laenge') return countOf(d) > 1 ? [lengthText(d)] : [];
  const depth = d.depth !== null && d.depth !== undefined ? [formatDepth(d.depth)] : [];
  if (d.areaFromShape && !isWall(d)) return [`${formatArea(t === 'volumen' ? d.area : grossArea(d))} m² aus Plan`, ...depth];
  return [lengthText(d), formatMeasure(d.width), ...depth];
}

/** Testkennung des Ergebnisses (je Messart wie bisher die Spalte) */
const RESULT_ID: Record<MeasureType, string> = { flaeche: 'row-area', wand: 'row-area', schadstelle: 'row-area', laenge: 'row-total', volumen: 'row-volume', stueck: 'row-value', frei: 'row-value' };

/** Summen je Einheit, wie abgerechnet: m², m, m³, Stk, eigene Einheiten (Frei) – Volumen nur aus Volumen-Messungen */
const UNIT_ORDER = ['m²', 'm', 'm³', 'Stk'];
export function aufmassTotals(damages: Damage[]): { unit: string; value: number }[] {
  return totalsByUnit(damages).sort((a, b) => (UNIT_ORDER.indexOf(a.unit) + 1 || 99) - (UNIT_ORDER.indexOf(b.unit) + 1 || 99));
}
const qtyText = (value: number, unit: string) => `${formatQty(value, unit)}${unit === 'ohne Einheit' ? '' : ` ${unit}`}`;

/** Gesamt je Einheit (Kopf der Messleiste): „95,70 m² · 4,18 m³ · 6,40 lfm Bewehrung“ */
export function AufmassTotals({ damages }: { damages: Damage[] }) {
  const rebar = Math.round(damages.reduce((a, d) => a + (d.rebar ?? 0), 0) * 100) / 100;
  const parts: ReactNode[] = aufmassTotals(damages).map((t) =>
    t.unit === 'm²' ? (
      <Fragment key={t.unit}>
        <span data-testid="sum-area">{formatArea(t.value)}</span> m²
      </Fragment>
    ) : (
      <span key={t.unit} data-testid={t.unit === 'm' ? 'sum-length' : t.unit === 'm³' ? 'sum-volume' : t.unit === 'Stk' ? 'sum-count' : 'sum-free'}>
        {qtyText(t.value, t.unit)}
      </span>
    ),
  );
  if (rebar > 0)
    parts.push(
      <Fragment key="rebar">
        <span data-testid="sum-rebar">{formatMeasure(rebar)}</span> lfm Bewehrung
      </Fragment>,
    );
  if (!parts.length) return null;
  return (
    <span className="aufmass-totals" data-testid="aufmass-total">
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && ' · '}
          {p}
        </Fragment>
      ))}
    </span>
  );
}

/** Summe einer Gruppe je Einheit (eine Position zählt meist in einer Einheit) */
const sumText = (list: Damage[]) =>
  aufmassTotals(list)
    .map((t) => qtyText(t.value, t.unit))
    .join(' · ') || '–';

const COLLAPSED_KEY = 'aufmassCollapsed';

interface Group {
  key: string;
  title: string;
  /** Messart-Gruppe: Symbol und Kennung der Messart; null = Positionsgruppe */
  type: MeasureType | null;
  rows: AufmassRow[];
}

/**
 * Aufmaß als einfache Liste: eine Gruppen-Ebene – nach Leistungsposition, Messungen ohne Position nach Messart
 * (ohne LV nur nach Messart). Je Messung eine Zeile „Nr · Maße · Ergebnis“, darunter nur bei Bedarf eine kleine
 * Zeile (Abzüge, Bewehrung, weitere Positionen, Fotos, Notiz). Summe im Gruppen-Balken. Antippen wählt die Messung
 * aus (im Plan), noch einmal antippen öffnet sie; gelöscht wird im Messfenster oder über „Auswählen“.
 */
export function AufmassTable({ rows: rawRows, showPlan, selectedId, onSelect, onEdit, duplicates, components, positionLabel, positionTitle, positionOrder, positionsOf, surfaceNeeded, sel: pick }: Props) {
  const picking = !!pick?.active;
  const choose = (r: AufmassRow) => {
    if (picking) return pick!.toggle(r.damage.id);
    if (onEdit && r.damage.id === selectedId) return onEdit(r);
    onSelect?.(r);
  };
  // Gruppen auf- und zuklappen – auf dem Gerät gemerkt
  const [closed, setClosed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]') as string[]);
    } catch {
      return new Set();
    }
  });
  const toggleGroup = (k: string) =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next].slice(-200)));
      } catch {
        /* egal */
      }
      return next;
    });
  const refsOf = (d: Damage): string[] => (positionsOf ? positionsOf(d) : d.positionRef ? [d.positionRef] : []);
  const titledRef = (d: Damage): string | null => {
    const ref = refsOf(d)[0];
    return ref && positionTitle?.(ref) ? ref : null;
  };
  const selRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    selRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  // Gruppen: Positionen (LV-Reihenfolge), danach Messungen ohne Position je Messart (Längen je Linienart getrennt)
  const groups: Group[] = [];
  const byPosition = !!positionTitle && rawRows.some((r) => titledRef(r.damage));
  if (byPosition) {
    const refs = [...new Set(rawRows.map((r) => titledRef(r.damage)).filter((x): x is string => !!x))].sort(
      (a, b) => (positionOrder?.(a) ?? 0) - (positionOrder?.(b) ?? 0) || naturalCompare(positionLabel?.(a) ?? a, positionLabel?.(b) ?? b),
    );
    for (const ref of refs) groups.push({ key: `pos:${ref}`, title: positionTitle!(ref)!, type: null, rows: rawRows.filter((r) => titledRef(r.damage) === ref) });
  }
  const rest = byPosition ? rawRows.filter((r) => !titledRef(r.damage)) : rawRows;
  for (const info of MEASURE_TYPES) {
    const rows = rest.filter((r) => typeOf(r.damage) === info.id);
    if (!rows.length) continue;
    const parts = info.id === 'laenge' ? linesByType(rows.map((row) => ({ d: row.damage, row }))) : [];
    const sets = !parts.length || parts[0].only ? [{ label: info.label, rows }] : parts.map((p) => ({ label: `${info.label} – ${p.label}`, rows: p.items.map((x) => x.row) }));
    for (const s of sets) groups.push({ key: `type:${s.label}`, title: byPosition ? `${s.label} · ohne Position` : s.label, type: info.id, rows: s.rows });
  }

  const renderRow = (r: AufmassRow, inPosition: boolean) => {
    const d = r.damage;
    const t = typeOf(d);
    const kind = kindOf(d);
    const isSel = d.id === selectedId;
    const comp = d.componentId ? components?.[d.componentId] : undefined;
    const q = quantityOfMeasure(d);
    const dims = dimsOf(d);
    const deds = (hasArea(kind) ? d.area !== null : true) && d.deductions?.length ? d.deductions : null;
    // Positionen: in der Positionsgruppe nur die weiteren („auch bei …“), sonst die Position selbst
    const refs = refsOf(d).filter((ref) => positionLabel?.(ref));
    const sub: ReactNode[] = [];
    if (deds)
      sub.push(
        <span key="deds" data-testid="row-deductions">
          {hasArea(kind) ? (
            <>
              brutto {formatArea(grossArea(d))} m² {deductionText(deds)} = <strong>netto {formatArea(d.area)} m²</strong>
            </>
          ) : (
            <>
              gemessen {formatMeasure(d.length)} m {deductionText(deds, true)} = <strong>netto {formatMeasure(netLength(d))} m</strong>
            </>
          )}
        </span>,
      );
    if (d.rebar)
      sub.push(
        <span key="rebar">
          Bewehrung <span data-testid="row-rebar">{formatMeasure(d.rebar)}</span> lfm
        </span>,
      );
    if (comp && !comp.deletedAt)
      sub.push(
        <span key="comp" className="component-tag">
          Bauteil {comp.letter}
          {comp.name ? ` – ${comp.name}` : ''}
        </span>,
      );
    if (!inPosition && refs.length)
      sub.push(
        <span key="pos">
          Pos. <span data-testid="row-position">{positionLabel!(refs[0])}</span>
        </span>,
      );
    const more = refs.slice(1);
    if (more.length)
      sub.push(
        <span key="more" data-testid="row-position-more">
          auch bei {more.map((ref) => positionLabel!(ref)).join(', ')}
        </span>,
      );
    if (surfaceNeeded && t === 'schadstelle' && !d.surface)
      sub.push(
        <span key="surface" className="row-warn" title="Boden, Wand oder Decke wählen – sonst zählt die Schadstelle bei den danach getrennten Positionen nicht" data-testid="row-surface-missing">
          Fläche wählen
        </span>,
      );
    if (d.photoIds?.length)
      sub.push(
        <span key="photos" className="row-photos" title={`${d.photoIds.length} ${d.photoIds.length === 1 ? 'Foto' : 'Fotos'}`}>
          <Icon name="camera" size={14} />
          <span data-testid="row-photos">{d.photoIds.length}</span>
        </span>,
      );
    if (d.note?.trim())
      sub.push(
        <span key="note" className="row-note" data-testid="row-note">
          {d.note}
        </span>,
      );
    const label = `${measureLabel(d)} ${damageNo(d)}`;
    return (
      <div
        key={d.id}
        ref={isSel ? selRef : undefined}
        role="button"
        tabIndex={0}
        aria-label={isSel && onEdit && !picking ? `${label} öffnen` : label}
        className={`aufmass-row${isSel ? ' selected' : ''}${duplicates?.has(d.id) ? ' duplicate' : ''}`}
        onClick={(e) => {
          if (picking && (e.target as Element).closest('input')) return;
          choose(r);
        }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
          e.preventDefault();
          choose(r);
        }}
        data-selected={picking ? pick!.has(d.id) : undefined}
        data-testid="aufmass-row"
        data-number={damageNo(d)}
        data-kind={kind}
        data-type={t}
      >
        <span className="aufmass-row-main">
          {picking && <SelectBox sel={pick!} id={d.id} label={label} testId="aufmass-row-select" />}
          {showPlan && <span className="row-plan">{r.plan.planNumber}</span>}
          <span className="color-dot" style={{ background: d.color }} />
          <span className="row-nr">{damageNo(d)}</span>
          <span className="row-dims">
            {dims.map((x, i) => (
              <Fragment key={i}>
                {i > 0 && <span className="row-x"> × </span>}
                <span className="row-dim">{x}</span>
              </Fragment>
            ))}
          </span>
          <strong className="row-result" data-testid={t === 'stueck' || t === 'frei' ? 'row-qty' : undefined}>
            <span className="row-value" data-testid={RESULT_ID[t]}>
              {formatQty(q.value, normUnit(q.unit))}
            </span>
            {q.unit.trim() && ` ${q.unit.trim()}`}
          </strong>
          <span className="sr-only" data-testid="row-kind" title={comp ? `${measureLabel(d)} · Bauteil ${comp.letter}${comp.name ? ` – ${comp.name}` : ''}` : measureLabel(d)}>
            {measureLabel(d)}
          </span>
        </span>
        {sub.length > 0 && <span className="aufmass-row-sub">{sub}</span>}
      </div>
    );
  };

  return (
    <div className="table-wrap aufmass-list" data-testid="aufmass-table">
      {groups.map((g) => {
        const isClosed = closed.has(g.key);
        const list = g.rows.map((r) => r.damage);
        const isPos = g.type === null;
        const types = isPos ? [...new Set(list.map((d) => typeInfo(typeOf(d)).label))] : [];
        return (
          <section key={g.key} className={`aufmass-group${isClosed ? ' is-closed' : ''}`} data-testid={isPos ? 'position-group' : 'aufmass-type'} data-type={g.type ?? undefined}>
            <h3 className="aufmass-group-head">
              <button type="button" className="group-toggle" onClick={() => toggleGroup(g.key)} aria-expanded={!isClosed} data-testid={isPos ? 'position-group-toggle' : 'aufmass-type-toggle'}>
                <Icon name="next" size={16} className="group-chevron" />
                {g.type && <Icon name={typeInfo(g.type).icon as IconName} size={16} />}
                <span className="aufmass-group-title">
                  <span className="aufmass-group-label">{g.title}</span>
                  <span className="aufmass-group-meta">
                    {g.rows.length} {g.rows.length === 1 ? 'Messung' : 'Messungen'}
                    {types.length ? ` · ${types.join(', ')}` : ''}
                  </span>
                </span>
                <strong className="aufmass-group-sum" data-testid="type-sum-value">
                  {sumText(list)}
                </strong>
              </button>
            </h3>
            {!isClosed && <div className="aufmass-rows">{g.rows.map((r) => renderRow(r, isPos))}</div>}
          </section>
        );
      })}
      {!groups.length && <p className="muted aufmass-empty">Noch keine Messungen erfasst.</p>}
    </div>
  );
}
