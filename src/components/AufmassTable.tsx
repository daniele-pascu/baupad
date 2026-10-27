import { useEffect, useRef } from 'react';
import type { AufmassRow } from '../lib/aufmass';
import { sumArea } from '../lib/aufmass';
import { countKind, hasVolume, isWall, kindOf, measureLabel, sumLengths, sumVolumes } from '../lib/measure';
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
}

/** Aufmaß-Tabelle: Plannummer, Nummer, Länge, Breite, Tiefe, Fläche, Art (Symbol) und Bauteil. */
export function AufmassTable({ rows, showPlan, selectedId, onSelect, onEdit, onDelete, duplicates, components, positionLabel }: Props) {
  const selRef = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    selRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);
  const damages = rows.map((r) => r.damage);
  const total = sumArea(damages);
  const lines = countKind(damages, 'line');
  const actions = !!(onEdit || onDelete);
  const before = showPlan ? 5 : 4; // Spalten vor „Fläche“
  const after = 1 + (actions ? 1 : 0); // Spalten nach „Fläche“
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
            {actions && <th className="actions-col"><span className="sr-only">Aktionen</span></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const sel = r.damage.id === selectedId;
            const kind = kindOf(r.damage);
            const comp = r.damage.componentId ? components?.[r.damage.componentId] : undefined;
            const label = `${measureLabel(r.damage)} ${damageNo(r.damage)}`;
            return (
              <tr
                key={r.damage.id}
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
                <td className="num" title={r.damage.areaFromShape ? 'Umfang – Fläche aus dem Plan berechnet' : undefined}>
                  {r.damage.areaFromShape ? `U ${formatMeasure(r.damage.length)}` : formatMeasure(r.damage.length)}
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
