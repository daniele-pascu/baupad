import { useState } from 'react';
import { typeInfo } from '../lib/measure-types';
import type { MeasureType } from '../lib/types';
import { Icon } from './Icon';
import { Modal } from './Modal';

export interface NewMeasureOption {
  ref: string;
  /** LV/MFK, zu dem die Position gehört */
  doc: string;
  number: string;
  shortText: string;
  unit: string;
  /** passende Messart (aus der Einheit bzw. Betoninstandsetzungs-Regel) */
  type: MeasureType;
}

/**
 * Neue Messung: zuerst den Bereich wählen – eine Position aus dem LV (die Messart stellt sich passend ein, alle neuen
 * Messungen zählen dort) oder frei ohne Position (Messart danach selbst wählen). Das Messfenster bleibt wie gewohnt.
 */
export function NewMeasureDialog({ options, current, onPick, onClose }: { options: NewMeasureOption[]; current: string; onPick(ref: string, type: MeasureType | null): void; onClose(): void }) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const shown = needle ? options.filter((o) => `${o.number} ${o.shortText} ${o.doc}`.toLowerCase().includes(needle)) : options;
  return (
    <Modal
      title="Neue Messung"
      onClose={onClose}
      testId="new-measure-dialog"
      footer={
        <button type="button" className="btn" onClick={onClose}>
          Abbrechen
        </button>
      }
    >
      <p className="muted small">Position wählen: alle neuen Messungen zählen dort, die Messart stellt sich passend ein. Ohne Position frei messen.</p>
      <button type="button" className={`nm-row nm-free${current === '' ? ' active' : ''}`} onClick={() => onPick('', null)} data-testid="new-measure-free">
        <span className="nm-icon">
          <Icon name="edit" size={18} />
        </span>
        <span className="nm-text">
          <strong>Frei – ohne Position</strong>
          <span className="muted small">Messart danach selbst wählen</span>
        </span>
      </button>
      {options.length > 6 && (
        <label className="crew-search nm-search">
          <Icon name="search" size={18} />
          <span className="sr-only">Position suchen</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nummer oder Text suchen" data-testid="new-measure-search" />
        </label>
      )}
      <ul className="nm-list" data-testid="new-measure-list">
        {shown.map((o) => {
          const t = typeInfo(o.type);
          return (
            <li key={o.ref}>
              <button type="button" className={`nm-row${current === o.ref ? ' active' : ''}`} onClick={() => onPick(o.ref, o.type)} data-testid="new-measure-pos" data-ref={o.ref}>
                <span className="nm-no">{o.number}</span>
                <span className="nm-text">
                  <span className="nm-short">{o.shortText}</span>
                  <span className="muted small">
                    {o.doc} · {o.unit || '–'}
                  </span>
                </span>
                <span className="nm-type" data-testid="new-measure-type">
                  <Icon name={t.icon} size={16} /> {t.label}
                </span>
              </button>
            </li>
          );
        })}
        {needle && !shown.length && <li className="muted small">Keine Position gefunden.</li>}
      </ul>
    </Modal>
  );
}
