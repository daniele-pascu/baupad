import { useState } from 'react';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { StylePanel } from './StylePanel';
import { lvDocLabel, lvDocsOf, positionRef } from '../lib/aufmass';
import { isOpenShape } from '../lib/geometry';
import { kindOf } from '../lib/measure';
import type { ProjectState } from '../lib/store';
import { COLORS, DRAW_COLORS, type Damage, type ShapeStyle } from '../lib/types';

/** Weiß ist auf dem Plan nicht zu sehen – hier steht stattdessen Grau */
const BULK_COLORS = COLORS.map((c) => (c.name === 'Weiß' ? DRAW_COLORS.find((d) => d.name === 'Grau')! : c));

export interface DamagePatch {
  /** undefined = unverändert, null = keine Leistungsposition */
  positionRef?: string | null;
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
  const [pos, setPos] = useState('=');
  const [color, setColor] = useState<string | null>(null);
  // Darstellung: null = unverändert; sonst die geänderten Angaben (gelten für alle gewählten)
  const [style, setStyle] = useState<Partial<ShapeStyle> | null>(null);
  // nur Linien gewählt: keine Füllung anbieten
  const allLines = damages.every((d) => kindOf(d) === 'line' || isOpenShape(d.shape));
  const base = damages[0];
  const save = () => onSave({ ...(pos !== '=' ? { positionRef: pos || null } : {}), ...(color ? { color } : {}), ...(style && Object.keys(style).length ? { style } : {}) });
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
          <button type="button" className="btn btn-primary" onClick={save} disabled={pos === '=' && !color && !(style && Object.keys(style).length)} data-testid="bulk-damage-save">
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
            <option value="=">– unverändert –</option>
            <option value="">ohne Leistungsposition</option>
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
        <div className="field">
          <span>Farbe</span>
          <div className="color-row bulk-colors" role="radiogroup" aria-label="Farbe">
            <button type="button" role="radio" aria-checked={color === null} className={`btn btn-sm${color === null ? ' on' : ''}`} onClick={() => setColor(null)} data-testid="bulk-damage-color-keep">
              unverändert
            </button>
            {BULK_COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                role="radio"
                aria-checked={color === c.value}
                aria-label={c.name}
                title={c.name}
                className={`color-swatch${color === c.value ? ' active' : ''}`}
                style={{ background: c.value }}
                onClick={() => setColor(c.value)}
                data-testid="bulk-damage-color"
              />
            ))}
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
