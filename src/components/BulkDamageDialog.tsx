import { useState } from 'react';
import { MoreColors } from './ColorPicker';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { StylePanel } from './StylePanel';
import { byGroup, lvDocLabel, lvDocsOf, positionRef } from '../lib/aufmass';
import { typeInfo, typeOf } from '../lib/measure-types';
import { damageNo } from '../lib/numbering';
import { isOpenShape } from '../lib/geometry';
import { kindOf } from '../lib/measure';
import type { ProjectState } from '../lib/store';
import { COLORS, DRAW_COLORS, type Damage, type ShapeStyle } from '../lib/types';

/** Weiß ist auf dem Plan nicht zu sehen – hier steht stattdessen Grau */
const BULK_COLORS = COLORS.map((c) => (c.name === 'Weiß' ? DRAW_COLORS.find((d) => d.name === 'Grau')! : c));

export interface DamagePatch {
  /** undefined = bleibt, null = ohne Leistungsposition */
  positionRef?: string | null;
  /** in eine andere Tabelle verschieben: Messgruppe mit ihrem Titel; null = Tabelle der Messart */
  group?: { id: string; title?: string } | null;
  color?: string;
  /** Darstellung: nur die geänderten Angaben (Linientyp, Stärke; bei Flächen Füllung bzw. Schraffur) */
  style?: Partial<ShapeStyle>;
}

/**
 * Mehrere Messungen gemeinsam ändern: Leistungsposition (LV/MFK) zuordnen bzw. entfernen und Farbe. Nur gewählte
 * Angaben werden übernommen; Maße, Nummern und Fotos bleiben.
 */
export function BulkDamageDialog({ data, damages, onClose, onSave }: { data: ProjectState; damages: Damage[]; onClose(): void; onSave(p: DamagePatch): void }) {
  const docs = lvDocsOf(data);
  // gemeinsamer Wert aller gewählten Messungen steht schon da; '=' nur, wenn sie verschieden sind
  const common = <T,>(of: (d: Damage) => T): T | '=' => (damages.every((d) => of(d) === of(damages[0])) ? of(damages[0]) : '=');
  const pos0 = common((d) => d.positionRef ?? '');
  const table0 = common((d) => d.group ?? '');
  const color0 = common((d) => d.color.toLowerCase());
  const [pos, setPos] = useState<string>(pos0);
  /** null = keine Farbe angetippt (die bisherige bleibt) */
  const [color, setColor] = useState<string | null>(null);
  // Tabellen (Messgruppen) dieses Plans; '' = ohne eigene Tabelle (Tabelle der Messart)
  const [table, setTable] = useState<string>(table0);
  const tables = byGroup(Object.values(data.damages).filter((d) => !d.deletedAt && d.planId === damages[0]?.planId && d.group).map((d) => ({ d })));
  const target = tables.find((t) => t.id === table);
  // Darstellung: null = unverändert; sonst die geänderten Angaben (gelten für alle gewählten)
  const [style, setStyle] = useState<Partial<ShapeStyle> | null>(null);
  // nur Linien gewählt: keine Füllung anbieten
  const allLines = damages.every((d) => kindOf(d) === 'line' || isOpenShape(d.shape));
  const base = damages[0];
  /** angezeigte Farbe: die angetippte, sonst die gemeinsame der Auswahl ('=' = verschieden: keine markiert) */
  const shown = color?.toLowerCase() ?? color0;
  const save = () =>
    onSave({
      ...(pos !== pos0 ? { positionRef: pos || null } : {}),
      ...(table !== table0 ? { group: target ? { id: target.id, title: target.title ?? undefined } : null } : {}),
      ...(color ? { color } : {}),
      ...(style && Object.keys(style).length ? { style } : {}),
    });
  return (
    <Modal
      title={`${damages.length} Messungen ändern`}
      onClose={onClose}
      testId="bulk-damage-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={pos === pos0 && table === table0 && !color && !(style && Object.keys(style).length)} data-testid="bulk-damage-save">
            <Icon name="check" size={18} /> Übernehmen
          </button>
        </>
      }
    >
      <div className="stack-fields">
        <p className="muted small">Maße, Nummern und Fotos bleiben – geändert wird nur, was du hier wählst.</p>
        <label className="field">
          <span>Leistungsposition</span>
          <select value={pos} onChange={(e) => setPos(e.target.value)} data-testid="bulk-damage-position">
            {pos0 === '=' && <option value="=">– verschieden –</option>}
            <option value="">ohne</option>
            {docs.map((doc) => (
              <optgroup key={doc.id} label={lvDocLabel(doc)}>
                {doc.positions.map((p) => (
                  <option key={p.id} value={positionRef(doc.id, p.id)}>
                    {p.number} {p.shortText}
                    {p.unit ? ` (${p.unit})` : ''}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        {!docs.length && <p className="muted small">Noch kein LV/MFK im Projekt – Positionen kommen aus „LV / MFK“ in der Projektseite.</p>}
        {tables.length > 0 && (
          <label className="field">
            <span>Tabelle</span>
            <select value={table} onChange={(e) => setTable(e.target.value)} data-testid="bulk-damage-table">
              {table0 === '=' && <option value="=">– verschieden –</option>}
              <option value="">ohne (Tabelle der Messart)</option>
              {tables.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title ?? typeInfo(typeOf(t.items[0].d)).label} · Nr. {t.items.map((x) => damageNo(x.d)).slice(0, 3).join(', ')}
                  {t.items.length > 3 ? ' …' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="field">
          <span>Farbe</span>
          <div className="color-row bulk-colors" role="radiogroup" aria-label="Farbe">
            {BULK_COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                role="radio"
                aria-checked={shown === c.value}
                aria-label={c.name}
                title={c.name}
                className={`color-swatch${shown === c.value ? ' active' : ''}`}
                style={{ background: c.value }}
                onClick={() => setColor(c.value)}
                data-testid="bulk-damage-color"
              />
            ))}
            {/* weitere Farben: Farbfelder oder selbst wählen */}
            <MoreColors value={shown === '=' ? '#e03131' : shown} onChange={setColor} label="Farbe frei wählen" testId="bulk-damage-color-more" />
          </div>
        </div>
        <div className="field">
          <span>Darstellung{allLines ? ' (Linie)' : ' (Linie und Füllung der Flächen)'}</span>
          {style === null ? (
            <button type="button" className="btn btn-sm" onClick={() => setStyle({})} data-testid="bulk-damage-style">
              <Icon name="layers" size={16} /> Linienart{allLines ? '' : ' und Füllung'} ändern
            </button>
          ) : (
            <div className="bulk-style" data-testid="bulk-damage-style-panel">
              <StylePanel
                color={color ?? base?.color ?? '#000000'}
                style={{ ...base?.style, ...style }}
                open={allLines}
                defaultWidth={1}
                kind="damage"
                hideColor
                onColor={setColor}
                onStyle={(patch) => setStyle((s) => ({ ...s, ...patch }))}
              />
              {!allLines && <p className="muted small">Füllung und Schraffur gelten nur für Flächen – Linien behalten nur die Linienart.</p>}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
