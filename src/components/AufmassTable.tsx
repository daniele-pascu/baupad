import { naturalCompare } from '../lib/numbers';
import { Fragment, useEffect, useRef, type ReactNode } from 'react';
import type { AufmassRow } from '../lib/aufmass';
import { sumArea } from '../lib/aufmass';
import { deductionText, grossArea, hasArea, hasVolume, isWall, kindOf, measureLabel, netLength, sumLengths, sumVolumes } from '../lib/measure';
import { formatArea, formatDepth, formatMeasure } from '../lib/numbers';
import { calcPath, countOf, MEASURE_TYPES, totalsByUnit, typeOf } from '../lib/measure-types';
import { damageNo } from '../lib/numbering';
import type { Component, Damage, MeasureType } from '../lib/types';
import { Icon } from './Icon';

type IconName = Parameters<typeof Icon>[0]['name'];

const KIND_ICONS = { damage: 'ellipse', area: 'rect', line: 'line' } as const;

interface Props {
  rows: AufmassRow[];
  showPlan?: boolean;
  selectedId?: string | null;
  onSelect?: (row: AufmassRow) => void;
  onEdit?: (row: AufmassRow) => void;
  onDelete?: (row: AufmassRow) => void;
  duplicates?: Set<string>;
  /** Bauteilkennzeichnungen (id → Bauteil) für die Spalte „Art / Bauteil“ */
  components?: Record<string, Pick<Component, 'letter' | 'name' | 'deletedAt'>>;
  /** Positionsnummer zu einem Leistungsverweis (für die Spalte „Art“) */
  positionLabel?: (ref: string) => string | null;
  /** Überschrift einer Positionsgruppe (z. B. „01.02 Spachteln“); mit Positionen wird nach LV-Position gruppiert */
  positionTitle?: (ref: string) => string | null;
  /** Reihenfolge der Positionen (z. B. LV-Reihenfolge); fehlt = nach Positionsnummer */
  positionOrder?: (ref: string) => number;
}

/** Spaltenkopf mit Einheit, z. B. „Länge (m)“ */
const withUnit = (label: string, unit: string) => (
  <>
    {label} <span className="unit-h">({unit})</span>
  </>
);

/** Länge einer Messung: „U …“ bei aus dem Plan berechneten Flächen (Umfang), sonst „Anzahl × Länge“ */
function lengthText(d: Damage): string {
  if (d.areaFromShape && hasArea(kindOf(d)) && !isWall(d)) return `U ${formatMeasure(d.length)}`;
  return `${(d.count ?? 1) > 1 ? `${d.count} × ` : ''}${formatMeasure(d.length)}`;
}
const lengthTitle = (d: Damage) => (d.areaFromShape && hasArea(kindOf(d)) && !isWall(d) ? 'Umfang – Fläche aus dem Plan berechnet' : undefined);

/** Spalten einer Messart: Köpfe, Zellen je Zeile und die Summe unter der Ergebnis-Spalte */
interface TypeColumns {
  heads: ReactNode[];
  cells(d: Damage): ReactNode;
  /** Summe der Tabelle: Text und Position der Ergebnis-Spalte (0 = erste Spalte der Messart) */
  sum(list: Damage[]): { at: number; text: string };
}

/**
 * Je Messart die passenden Spalten: Fläche/Schadstelle Länge × Breite (× Tiefe), Wand Länge × Höhe,
 * Länge mit Gesamtlänge, Volumen mit m³, Stück nur die Anzahl, Frei die eigene Rechnung.
 */
function columnsOf(type: MeasureType, list: Damage[]): TypeColumns {
  const anyDepth = list.some((d) => d.depth !== null && d.depth !== undefined);
  const areaCell = (d: Damage) => (
    <td className="num" data-testid="row-area">
      {formatArea(d.area)}
    </td>
  );
  const lengthCell = (d: Damage) => (
    <td className="num" title={lengthTitle(d)}>
      {lengthText(d)}
    </td>
  );
  if (type === 'stueck' || type === 'frei') {
    return {
      heads: [type === 'stueck' ? 'Anzahl' : 'Menge'],
      cells: (d) => (
        <td className="num">
          <span data-testid="row-qty">{calcPath(d)}</span>
        </td>
      ),
      sum: (l) => ({
        at: 0,
        text:
          type === 'stueck'
            ? `${l.reduce((n, d) => n + countOf(d), 0)} Stk`
            : totalsByUnit(l)
                .map((t) => `${formatArea(t.value)} ${t.unit}`)
                .join(' · '),
      }),
    };
  }
  if (type === 'laenge') {
    return {
      heads: [withUnit('Länge', 'm'), withUnit('Gesamt', 'm')],
      cells: (d) => (
        <>
          {lengthCell(d)}
          <td className="num" data-testid="row-total">
            {formatMeasure(netLength(d))}
          </td>
        </>
      ),
      sum: (l) => ({ at: 1, text: `${formatMeasure(sumLengths(l))} m` }),
    };
  }
  if (type === 'volumen') {
    return {
      heads: [withUnit('Länge', 'm'), withUnit('Breite', 'm'), withUnit('Tiefe', 'm'), withUnit('Volumen', 'm³')],
      cells: (d) => (
        <>
          {d.areaFromShape ? (
            // Fläche aus dem Plan: statt Länge × Breite steht die Fläche
            <td className="num" colSpan={2} title="Fläche aus dem Plan berechnet" data-testid="row-area">
              {formatArea(d.area)} m²
            </td>
          ) : (
            <>
              {lengthCell(d)}
              <td className="num">{formatMeasure(d.width)}</td>
            </>
          )}
          <td className="num">{formatDepth(d.depth)}</td>
          <td className="num" data-testid="row-volume">
            {d.area !== null && d.depth !== null ? formatArea(Math.round(d.area * d.depth * 100) / 100) : ''}
          </td>
        </>
      ),
      sum: (l) => ({ at: 3, text: `${formatArea(sumVolumes(l))} m³` }),
    };
  }
  // Fläche, Wand, Schadstelle: Ergebnis in m²; Tiefe bzw. Wandstärke nur, wenn sie vorkommt (Schadstelle immer)
  const depth = type === 'schadstelle' || anyDepth;
  return {
    heads: [withUnit('Länge', 'm'), withUnit(type === 'wand' ? 'Höhe' : 'Breite', 'm'), ...(depth ? [withUnit(type === 'wand' ? 'Stärke' : 'Tiefe', 'm')] : []), withUnit('Fläche', 'm²')],
    cells: (d) => (
      <>
        {lengthCell(d)}
        <td className="num">{formatMeasure(d.width)}</td>
        {depth && <td className="num">{formatDepth(d.depth)}</td>}
        {areaCell(d)}
      </>
    ),
    sum: (l) => ({ at: depth ? 3 : 2, text: `${formatArea(sumArea(l))} m²` }),
  };
}

/**
 * Aufmaß-Tabellen: je Messart eine eigene Tabelle mit passenden Spalten und eigener Summe
 * (Fläche, Wand, Länge, Volumen, Stück, Schadstelle, Frei – nur die vorkommenden), darunter die Gesamtsummen.
 */
export function AufmassTable({ rows: rawRows, showPlan, selectedId, onSelect, onEdit, onDelete, duplicates, components, positionLabel, positionTitle, positionOrder }: Props) {
  const selRef = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    selRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);
  // nach LV-Position gruppieren (Positionsnummer aufsteigend), Messungen ohne Position gesammelt am Ende
  const grouped = !!positionTitle && rawRows.some((r) => r.damage.positionRef);
  const groupKey = (r: AufmassRow) => (r.damage.positionRef && positionTitle?.(r.damage.positionRef) ? r.damage.positionRef : '');
  const sorted = grouped
    ? [...rawRows].sort((a, b) => {
        const ka = groupKey(a);
        const kb = groupKey(b);
        if (ka === kb) return 0;
        if (!ka) return 1;
        if (!kb) return -1;
        const oa = positionOrder?.(ka) ?? 0;
        const ob = positionOrder?.(kb) ?? 0;
        return oa - ob || naturalCompare(positionLabel?.(ka) ?? ka, positionLabel?.(kb) ?? kb);
      })
    : rawRows;
  const damages = sorted.map((r) => r.damage);
  const total = sumArea(damages);
  const actions = !!(onEdit || onDelete);
  // je Messart eine Tabelle, in fester Reihenfolge; nur Messarten, die vorkommen
  const tables = MEASURE_TYPES.map((info) => ({ info, rows: sorted.filter((r) => typeOf(r.damage) === info.id) })).filter((t) => t.rows.length > 0);
  const lead = (showPlan ? 1 : 0) + 1; // Plannr., Nr.

  const renderTable = (type: MeasureType, rows: AufmassRow[], withSum: boolean) => {
    const list = rows.map((r) => r.damage);
    const cols = columnsOf(type, list);
    // Symbol der Messart (wie in der Überschrift der Tabelle)
    const typeIcon = MEASURE_TYPES.find((t) => t.id === type)?.icon as IconName | undefined;
    // Spalte „Bemerkung“ nur, wenn eine Messung eine Notiz hat (am Handy als Zeile darunter)
    const notes = list.some((d) => d.note?.trim());
    // Spalte „Bewehrung“ nur, wenn mindestens eine Messung eine Angabe hat
    const rebar = list.some((d) => (d.rebar ?? 0) > 0);
    const trail = 1 + (rebar ? 1 : 0) + (notes ? 1 : 0) + (actions ? 1 : 0); // Art, Bewehrung, Bemerkung, Aktionen
    const all = lead + cols.heads.length + trail;
    const sum = cols.sum(list);
    return (
      <table className="aufmass-table">
        <thead>
          <tr>
            {showPlan && <th>Plannr.</th>}
            <th className="num nr-col">Nr.</th>
            {cols.heads.map((h, i) => (
              <th key={i} className="num">
                {h}
              </th>
            ))}
            <th title="Messart und Bauteil">Art</th>
            {rebar && (
              <th className="num" title="Bewehrung in Laufmetern">
                Bew. (lfm)
              </th>
            )}
            {notes && <th className="note-col">Bemerkung</th>}
            {actions && (
              <th className="actions-col">
                <span className="sr-only">Aktionen</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => {
            const sel = r.damage.id === selectedId;
            const gk = grouped ? groupKey(r) : null;
            const newGroup = gk !== null && (ri === 0 || groupKey(rows[ri - 1]) !== gk);
            const groupRows = newGroup ? rows.filter((x) => groupKey(x) === gk).map((x) => x.damage) : [];
            const kind = kindOf(r.damage);
            const comp = r.damage.componentId ? components?.[r.damage.componentId] : undefined;
            const label = `${measureLabel(r.damage)} ${damageNo(r.damage)}`;
            const deds = (hasArea(kind) ? r.damage.area !== null : true) && r.damage.deductions?.length ? r.damage.deductions : null;
            return (
              <Fragment key={r.damage.id}>
                {newGroup && (
                  <tr className="position-group" data-testid="position-group">
                    <td colSpan={all}>
                      <span className="position-group-title">{gk ? positionTitle!(gk) : 'Ohne Leistungsposition'}</span>
                      <span className="position-group-sum">{cols.sum(groupRows).text}</span>
                    </td>
                  </tr>
                )}
                <tr
                  ref={sel ? selRef : undefined}
                  className={`${sel ? 'selected' : ''}${duplicates?.has(r.damage.id) ? ' duplicate' : ''}`}
                  onClick={() => onSelect?.(r)}
                  data-testid="aufmass-row"
                  data-number={damageNo(r.damage)}
                  data-kind={kind}
                  data-type={type}
                >
                  {showPlan && <td>{r.plan.planNumber}</td>}
                  <td className="num nr-col">
                    <span className="color-dot" style={{ background: r.damage.color }} /> {damageNo(r.damage)}
                  </td>
                  {cols.cells(r.damage)}
                  <td className="kind-cell" data-testid="row-kind" title={comp ? `${measureLabel(r.damage)} · Bauteil ${comp.letter}${comp.name ? ` – ${comp.name}` : ''}` : measureLabel(r.damage)}>
                    <Icon name={rows.length && typeIcon ? typeIcon : isWall(r.damage) ? 'wall' : KIND_ICONS[kind]} size={16} />
                    <span className="sr-only">{measureLabel(r.damage)}</span>
                    {comp && !comp.deletedAt && <span className="component-tag">{comp.letter}</span>}
                    {r.damage.positionRef && positionLabel?.(r.damage.positionRef) && (
                      <span className="pos-tag" data-testid="row-position">
                        {positionLabel(r.damage.positionRef)}
                      </span>
                    )}
                    {!!r.damage.photoIds?.length && (
                      <span className="photo-tag" title={`${r.damage.photoIds.length} ${r.damage.photoIds.length === 1 ? 'Foto' : 'Fotos'}`} data-testid="row-photos">
                        <Icon name="camera" size={14} />
                        {r.damage.photoIds.length}
                      </span>
                    )}
                  </td>
                  {rebar && (
                    <td className="num" data-testid="row-rebar">
                      {r.damage.rebar ? formatMeasure(r.damage.rebar) : ''}
                    </td>
                  )}
                  {notes && (
                    <td className="note-col" data-testid="row-note">
                      {r.damage.note}
                    </td>
                  )}
                  {actions && (
                    <td className="actions-col">
                      {onEdit && (
                        <button
                          type="button"
                          className="icon-btn icon-btn-sm"
                          aria-label={`${label} bearbeiten`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onEdit(r);
                          }}
                        >
                          <Icon name="edit" size={18} />
                        </button>
                      )}
                      {onDelete && (
                        <button
                          type="button"
                          className="icon-btn icon-btn-sm danger"
                          aria-label={`${label} löschen`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onDelete(r);
                          }}
                        >
                          <Icon name="trash" size={18} />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
                {notes && r.damage.note?.trim() && (
                  <tr className={`note-subrow${sel ? ' selected' : ''}`} onClick={() => onSelect?.(r)} data-testid="row-note-sm">
                    <td colSpan={all}>{r.damage.note}</td>
                  </tr>
                )}
                {deds && (
                  <tr className={`deduction-subrow${sel ? ' selected' : ''}`} onClick={() => onSelect?.(r)} data-testid="row-deductions">
                    <td colSpan={all}>
                      {hasArea(kind) ? (
                        <>
                          brutto {formatArea(grossArea(r.damage))} m² {deductionText(deds)} = <strong>netto {formatArea(r.damage.area)} m²</strong>
                        </>
                      ) : (
                        <>
                          gemessen {formatMeasure(r.damage.length)} m {deductionText(deds, true)} = <strong>netto {formatMeasure(netLength(r.damage))} m</strong>
                        </>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
          {!rows.length && (
            <tr>
              <td colSpan={all} className="muted empty-cell">
                Noch keine Messungen erfasst.
              </td>
            </tr>
          )}
        </tbody>
        {withSum && (
          <tfoot>
            <tr data-testid="type-sum">
              {/* Bezeichnung links, Wert rechts unter der Ergebnis-Spalte – in einer Zelle, damit „Summe“ die Nummernspalte nicht verbreitert */}
              <td colSpan={lead + sum.at + 1}>
                <span className="type-sum-line">
                  <span>Summe</span>
                  <span data-testid="type-sum-value">{sum.text}</span>
                </span>
              </td>
              <td colSpan={cols.heads.length - sum.at - 1 + trail} />
            </tr>
          </tfoot>
        )}
      </table>
    );
  };

  const lines = damages.filter((d) => typeOf(d) === 'laenge').length;
  const pieces = damages.filter((d) => typeOf(d) === 'stueck');
  const free = totalsByUnit(damages.filter((d) => typeOf(d) === 'frei'));
  const rebarAny = damages.some((d) => (d.rebar ?? 0) > 0);
  const rebarSum = Math.round(damages.reduce((a, d) => a + (d.rebar ?? 0), 0) * 100) / 100;
  // „Summe Fläche“ steht auch bei leerer Tabelle; ohne Flächenmessung (nur Längen, Stück …) entfällt sie
  const areaAny = !damages.length || damages.some((d) => hasArea(kindOf(d)));
  return (
    <div className="table-wrap aufmass-tables" data-testid="aufmass-table">
      {tables.map((t) => (
        <section key={t.info.id} className="aufmass-type" data-testid="aufmass-type" data-type={t.info.id}>
          <h3 className="aufmass-type-head">
            <Icon name={t.info.icon as IconName} size={16} />
            <span>{t.info.label}</span>
            <span className="aufmass-type-count">
              {t.rows.length} {t.rows.length === 1 ? 'Messung' : 'Messungen'}
            </span>
          </h3>
          {renderTable(t.info.id, t.rows, tables.length > 1)}
        </section>
      ))}
      {!tables.length && renderTable('schadstelle', [], false)}
      <table className="aufmass-table aufmass-total" data-testid="aufmass-total">
        <tfoot>
          {areaAny && (
            <tr>
              <td>Summe Fläche</td>
              <td className="num" data-testid="sum-area">
                {formatArea(total)}
              </td>
            </tr>
          )}
          {lines > 0 && (
            <tr className="sum-lines">
              <td title="Linienlängen werden getrennt summiert und nicht zur Fläche gezählt">Summe Linien</td>
              <td className="num" data-testid="sum-length">
                {formatMeasure(sumLengths(damages))} m
              </td>
            </tr>
          )}
          {hasVolume(damages) && (
            <tr className="sum-lines">
              <td title="Summe aus Fläche × Tiefe aller Messungen mit Tiefe">Summe Volumen</td>
              <td className="num" data-testid="sum-volume">
                {formatArea(sumVolumes(damages))} m³
              </td>
            </tr>
          )}
          {pieces.length > 0 && (
            <tr className="sum-lines">
              <td>Summe Stück</td>
              <td className="num" data-testid="sum-count">
                {pieces.reduce((n, d) => n + countOf(d), 0)} Stk
              </td>
            </tr>
          )}
          {free.map((f) => (
            <tr key={f.unit} className="sum-lines">
              <td>Summe Frei ({f.unit})</td>
              <td className="num" data-testid="sum-free">
                {formatArea(f.value)} {f.unit}
              </td>
            </tr>
          ))}
          {rebarAny && (
            <tr className="sum-lines">
              <td>Summe Bewehrung (lfm)</td>
              <td className="num" data-testid="sum-rebar">
                {formatMeasure(rebarSum)}
              </td>
            </tr>
          )}
        </tfoot>
      </table>
    </div>
  );
}
