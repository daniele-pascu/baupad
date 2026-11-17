import { useState } from 'react';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { lvDocLabel, lvDocsOf, positionRef } from '../lib/aufmass';
import type { ProjectState } from '../lib/store';
import { COLORS, type Damage } from '../lib/types';

export interface DamagePatch {
  /** undefined = unverändert, null = keine Leistungsposition */
  positionRef?: string | null;
  color?: string;
}

/**
 * Mehrere Messungen gemeinsam ändern: Leistungsposition (LV/MFK) zuordnen bzw. entfernen und Farbe. Nur gewählte
 * Angaben werden übernommen; Maße, Nummern und Fotos bleiben.
 */
export function BulkDamageDialog({ data, damages, onClose, onSave }: { data: ProjectState; damages: Damage[]; onClose(): void; onSave(p: DamagePatch): void }) {
  const docs = lvDocsOf(data);
  const [pos, setPos] = useState('=');
  const [color, setColor] = useState<string | null>(null);
  const save = () => onSave({ ...(pos !== '=' ? { positionRef: pos || null } : {}), ...(color ? { color } : {}) });
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
          <button type="button" className="btn btn-primary" onClick={save} disabled={pos === '=' && !color} data-testid="bulk-damage-save">
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
            {COLORS.map((c) => (
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
      </div>
    </Modal>
  );
}
