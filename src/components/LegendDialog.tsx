import { useState } from 'react';
import { Modal } from './Modal';
import { colorName, type LegendEntry } from '../lib/legend';

/** Farblegende des Plans: je erkannter Farbe eine eigene Bezeichnung; im Plan und im PDF anzeigen */
export function LegendDialog({
  entries,
  show,
  labels,
  onClose,
  onSave,
}: {
  entries: LegendEntry[];
  show: boolean;
  labels: Record<string, string>;
  onClose(): void;
  onSave(show: boolean, labels: Record<string, string>): void;
}) {
  const [on, setOn] = useState(show || !entries.length ? show : true);
  const [txt, setTxt] = useState<Record<string, string>>(() => Object.fromEntries(entries.map((e) => [e.color, labels[e.color] ?? ''])));
  return (
    <Modal
      title="Farblegende"
      onClose={onClose}
      testId="legend-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              // bestehende Bezeichnungen anderer Farben bleiben erhalten
              const next = { ...labels };
              for (const [c, t] of Object.entries(txt)) {
                if (t.trim()) next[c] = t.trim();
                else delete next[c];
              }
              onSave(on, next);
            }}
            data-testid="legend-save"
          >
            Speichern
          </button>
        </>
      }
    >
      {entries.length === 0 ? (
        <p className="muted">Noch keine Messungen im Plan – die Farben werden erkannt, sobald gemessen wurde.</p>
      ) : (
        <div className="legend-rows">
          {entries.map((e) => (
            <label key={e.color} className="legend-row" data-testid="legend-row" data-color={e.color}>
              <span className="legend-swatch" style={{ background: e.color }} />
              <input value={txt[e.color] ?? ''} onChange={(ev) => setTxt((p) => ({ ...p, [e.color]: ev.target.value }))} placeholder={colorName(e.color)} aria-label={`Bezeichnung für ${colorName(e.color)}`} data-testid="legend-input" />
              <span className="muted small">{e.count}×</span>
            </label>
          ))}
        </div>
      )}
      <label className="check-row">
        <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} data-testid="legend-show" />
        <span>Legende im Plan und im PDF anzeigen</span>
      </label>
    </Modal>
  );
}

/** Legende unten links über dem Plan (Antippen öffnet die Bearbeitung) */
export function LegendBox({ entries, onOpen }: { entries: LegendEntry[]; onOpen(): void }) {
  if (!entries.length) return null;
  return (
    <button type="button" className="plan-legend" onClick={onOpen} title="Legende bearbeiten" data-testid="plan-legend">
      <strong>Legende</strong>
      {entries.map((e) => (
        <span key={e.color} className="plan-legend-row">
          <span className="legend-swatch" style={{ background: e.color }} />
          <span>{e.label}</span>
        </span>
      ))}
    </button>
  );
}
