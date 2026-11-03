import { naturalCompare } from '../lib/numbers';
import { Fragment, useEffect, useRef } from 'react';
import type { AufmassRow } from '../lib/aufmass';
import { sumArea } from '../lib/aufmass';
import { countKind, deductionText, grossArea, hasArea, hasVolume, isWall, kindOf, measureLabel, netLength, sumLengths, sumVolumes } from '../lib/measure';
import { formatArea, formatMeasure } from '../lib/numbers';
import { damageNo } from '../lib/numbering';
import type { Component } from '../lib/types';
import { Icon } from './Icon';

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

/** Aufmaß-Tabelle: Plannummer, Nummer, Länge, Breite, Tiefe, Fläche, Art (Symbol) und Bauteil. */
export function AufmassTable({ rows: rawRows, showPlan, selectedId, onSelect, onEdit, onDelete, duplicates, components, positionLabel, positionTitle, positionOrder }: Props) {
  const selRef = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    selRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);
  // nach LV-Position gruppieren (Positionsnummer aufsteigend), Messungen ohne Position gesammelt am Ende
  const grouped = !!positionTitle && rawRows.some((r) => r.damage.positionRef);
  const groupKey = (r: AufmassRow) => (r.damage.positionRef && positionTitle?.(r.damage.positionRef) ? r.damage.positionRef : '');
  const rows = grouped
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
  const damages = rows.map((r) => r.damage);
  const total = sumArea(damages);
  const lines = countKind(damages, 'line');
  const actions = !!(onEdit || onDelete);
  // Spalte „Bemerkung“ nur, wenn eine Messung eine Notiz hat (am Handy als Zeile darunter)
  const notes = damages.some((d) => d.note?.trim());
  const before = showPlan ? 5 : 4; // Spalten vor „Fläche“
  const after = 1 + (notes ? 1 : 0) + (actions ? 1 : 0); // Spalten nach „Fläche“
  return (
    <div className="table-wrap">
      <table className="aufmass-table" data-testid="aufmass-table">
        <thead>
          <tr>
            {showPlan && <th>Plannr.</th>}
            <th className="num">Nr.</th>
            <th className="num">
              Länge <span className="unit-h">(m)</span>
            </th>
            <th className="num">
              Breite <span className="unit-h">(m)</span>
            </th>
            <th className="num">
              Tiefe <span className="unit-h">(m)</span>
            </th>
            <th className="num">
              Fläche <span className="unit-h">(m²)</span>
            </th>
            <th title="Messart und Bauteil">Art</th>
            {notes && <th className="note-col">Bemerkung</th>}
            {actions && <th className="actions-col"><span className="sr-only">Aktionen</span></th>}
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
                  <td colSpan={before + 1 + after}>
                    <span className="position-group-title">{gk ? positionTitle!(gk) : 'Ohne Leistungsposition'}</span>
                    <span className="position-group-sum">
                      {groupRows.some((d) => hasArea(kindOf(d))) ? `${formatArea(sumArea(groupRows))} m²` : ''}
                      {countKind(groupRows, 'line') > 0 ? `${groupRows.some((d) => hasArea(kindOf(d))) ? ' · ' : ''}${formatMeasure(sumLengths(groupRows))} m` : ''}
                    </span>
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
              >
                {showPlan && <td>{r.plan.planNumber}</td>}
                <td className="num">
                  <span className="color-dot" style={{ background: r.damage.color }} /> {damageNo(r.damage)}
                </td>
                <td className="num" title={r.damage.areaFromShape && hasArea(kind) && !isWall(r.damage) ? 'Umfang – Fläche aus dem Plan berechnet' : undefined}>
                  {r.damage.areaFromShape && hasArea(kind) && !isWall(r.damage) ? `U ${formatMeasure(r.damage.length)}` : formatMeasure(r.damage.length)}
                </td>
                <td className="num">{formatMeasure(r.damage.width)}</td>
                <td className="num">{formatMeasure(r.damage.depth)}</td>
                <td className="num" data-testid="row-area">
                  {formatArea(r.damage.area)}
                </td>
                <td className="kind-cell" data-testid="row-kind" title={comp ? `${measureLabel(r.damage)} · Bauteil ${comp.letter}${comp.name ? ` – ${comp.name}` : ''}` : measureLabel(r.damage)}>
                  <Icon name={isWall(r.damage) ? 'wall' : KIND_ICONS[kind]} size={16} />
                  <span className="sr-only">{measureLabel(r.damage)}</span>
                  {comp && !comp.deletedAt && (
                    <span className="component-tag">
                      {comp.letter}
                    </span>
                  )}
                  {r.damage.positionRef && positionLabel?.(r.damage.positionRef) && (
                    <span className="pos-tag" data-testid="row-position">
                      {positionLabel(r.damage.positionRef)}
                    </span>
                  )}
                </td>
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
                  <td colSpan={before + 1 + after}>{r.damage.note}</td>
                </tr>
              )}
              {deds && (
                <tr className={`deduction-subrow${sel ? ' selected' : ''}`} onClick={() => onSelect?.(r)} data-testid="row-deductions">
                  <td colSpan={before + 1 + after}>
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
              <td colSpan={before + 1 + after} className="muted empty-cell">
                Noch keine Messungen erfasst.
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={before}>
              Summe Fläche
            </td>
            <td className="num" data-testid="sum-area">
              {formatArea(total)}
            </td>
            <td colSpan={after} />
          </tr>
          {lines > 0 && (
            <tr className="sum-lines">
              <td colSpan={before} title="Linienlängen werden getrennt summiert und nicht zur Fläche gezählt">
                Summe Linien
              </td>
              <td className="num" data-testid="sum-length">
                {formatMeasure(sumLengths(damages))} m
              </td>
              <td colSpan={after} />
            </tr>
          )}
          {hasVolume(damages) && (
            <tr className="sum-lines">
              <td colSpan={before} title="Summe aus Fläche × Tiefe aller Messungen mit Tiefe">
                Summe Volumen
              </td>
              <td className="num" data-testid="sum-volume">
                {formatArea(sumVolumes(damages))} m³
              </td>
              <td colSpan={after} />
            </tr>
          )}
        </tfoot>
      </table>
    </div>
  );
}
