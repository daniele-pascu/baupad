import { useEffect, useRef } from 'react';
import type { AufmassRow } from '../lib/aufmass';
import { sumArea } from '../lib/aufmass';
import { formatArea, formatMeasure } from '../lib/numbers';
import { Icon } from './Icon';

interface Props {
  rows: AufmassRow[];
  showPlan?: boolean;
  selectedId?: string | null;
  onSelect?: (row: AufmassRow) => void;
  onEdit?: (row: AufmassRow) => void;
  onDelete?: (row: AufmassRow) => void;
  duplicates?: Set<string>;
}

/** Aufmaß-Tabelle: Plannummer, Schadstellennummer, Länge, Breite, Tiefe, Fläche. */
export function AufmassTable({ rows, showPlan, selectedId, onSelect, onEdit, onDelete, duplicates }: Props) {
  const selRef = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    selRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);
  const total = sumArea(rows.map((r) => r.damage));
  return (
    <div className="table-wrap">
      <table className="aufmass-table" data-testid="aufmass-table">
        <thead>
          <tr>
            {showPlan && <th>Plannr.</th>}
            <th className="num">Nr.</th>
            <th className="num">Länge (m)</th>
            <th className="num">Breite (m)</th>
            <th className="num">Tiefe (m)</th>
            <th className="num">Fläche (m²)</th>
            {(onEdit || onDelete) && <th className="actions-col"><span className="sr-only">Aktionen</span></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const sel = r.damage.id === selectedId;
            return (
              <tr
                key={r.damage.id}
                ref={sel ? selRef : undefined}
                className={`${sel ? 'selected' : ''}${duplicates?.has(r.damage.id) ? ' duplicate' : ''}`}
                onClick={() => onSelect?.(r)}
                data-testid="aufmass-row"
                data-number={r.damage.number}
              >
                {showPlan && <td>{r.plan.planNumber}</td>}
                <td className="num">
                  <span className="color-dot" style={{ background: r.damage.color }} /> {r.damage.number}
                </td>
                <td className="num">{formatMeasure(r.damage.length)}</td>
                <td className="num">{formatMeasure(r.damage.width)}</td>
                <td className="num">{formatMeasure(r.damage.depth)}</td>
                <td className="num" data-testid="row-area">
                  {formatArea(r.damage.area)}
                </td>
                {(onEdit || onDelete) && (
                  <td className="actions-col">
                    {onEdit && (
                      <button
                        type="button"
                        className="icon-btn icon-btn-sm"
                        aria-label={`Schadstelle ${r.damage.number} bearbeiten`}
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
                        aria-label={`Schadstelle ${r.damage.number} löschen`}
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
              <td colSpan={showPlan ? 7 : 6} className="muted empty-cell">
                Noch keine Schadstellen erfasst.
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={showPlan ? 5 : 4}>
              Summe ({rows.length} Schadstelle{rows.length === 1 ? '' : 'n'})
            </td>
            <td className="num" data-testid="sum-area">
              {formatArea(total)}
            </td>
            {(onEdit || onDelete) && <td />}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
