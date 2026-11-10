import { useState } from 'react';
import { Modal } from './Modal';
import { colorName, type LegendEntry } from '../lib/legend';
import type { LegendPos } from '../lib/types';

const POS: { id: LegendPos; label: string }[] = [
  { id: 'tl', label: 'Oben links' },
  { id: 'tr', label: 'Oben rechts' },
  { id: 'bl', label: 'Unten links' },
  { id: 'br', label: 'Unten rechts' },
];

/** Farblegende des Plans: je erkannter Farbe eine eigene Bezeichnung; im Plan und im PDF anzeigen */
export function LegendDialog({
  entries,
  show,
  labels,
  pos: initialPos,
  planCount = 1,
  onClose,
  onSave,
}: {
  entries: LegendEntry[];
  show: boolean;
  labels: Record<string, string>;
  pos: LegendPos;
  /** Pläne im Projekt – ab 2 Auswahl „in allen Plänen“ */
  planCount?: number;
  onClose(): void;
  onSave(show: boolean, labels: Record<string, string>, pos: LegendPos, allPlans: boolean): void;
}) {
  const [all, setAll] = useState(true);
  const [pos, setPos] = useState<LegendPos>(initialPos);
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
              onSave(on, next, pos, planCount > 1 && all);
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
      {planCount > 1 && (
        <label className="check-row">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} data-testid="legend-all" />
          <span>Anzeigen und Lage für alle {planCount} Pläne des Projekts (jeder Plan mit seinen eigenen Farben)</span>
        </label>
      )}
      <div className="field">
        <span>Lage im Plan und im PDF</span>
        <div className="legend-pos" role="radiogroup" aria-label="Lage der Legende">
          {POS.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={pos === p.id} className={`chip${pos === p.id ? ' active' : ''}`} onClick={() => setPos(p.id)} data-testid={`legend-pos-${p.id}`}>
              {p.label}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

/** Legende unten links über dem Plan (Antippen öffnet die Bearbeitung) */
export function LegendBox({ entries, pos = 'bl', onOpen }: { entries: LegendEntry[]; pos?: LegendPos; onOpen(): void }) {
  if (!entries.length) return null;
  return (
    <button type="button" className={`plan-legend pos-${pos}`} data-pos={pos} onClick={onOpen} title="Legende bearbeiten" data-testid="plan-legend">
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
