import { useEffect, useState } from 'react';
import { notifyDataChanged, useDataChanged } from '../lib/data-events';
import { onPhotosChanged } from '../lib/photo-storage';
import { loadTrash, type TrashItem, type TrashScope } from '../lib/trash-items';
import { TRASH_DAYS } from '../lib/trash-purge';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { showError, toast } from './ui';

/** Hinweis oben im Papierkorb – überall gleich */
export const TRASH_INFO = `Gelöschtes bleibt ${TRASH_DAYS} Tage im Papierkorb und wird danach endgültig gelöscht.`;

/**
 * Papierkorb-Taste oben im Seitenkopf: Tool-Übersicht alles, im Tool alles dieses Tools, in Projekt bzw. Baustelle
 * nur deren Daten. Die Zahl zeigt, wie viele Einträge drin sind.
 */
export function TrashButton({ scope }: { scope: TrashScope }) {
  const [items, setItems] = useState<TrashItem[]>([]);
  const [open, setOpen] = useState(false);
  const key = JSON.stringify(scope);
  const load = () => void loadTrash(scope).then(setItems, () => setItems([]));
  useEffect(load, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useDataChanged(load);
  useEffect(() => onPhotosChanged(load), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <button type="button" className="btn btn-sm trash-btn" onClick={() => setOpen(true)} title={TRASH_INFO} aria-label={`Papierkorb${items.length ? ` (${items.length})` : ''}`} data-testid="trash-open" data-count={items.length}>
        <Icon name="trash" size={16} />
        <span className="lbl">Papierkorb</span>
        {items.length > 0 && <span className="trash-count">{items.length}</span>}
      </button>
      {open && <TrashModal items={items} onRestored={load} onClose={() => setOpen(false)} />}
    </>
  );
}

function TrashModal({ items, onRestored, onClose }: { items: TrashItem[]; onRestored(): void; onClose(): void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const restore = async (e: TrashItem) => {
    setBusy(e.key);
    try {
      await e.restore();
      toast(`${e.title} wiederhergestellt.`, 'success');
      onRestored();
      notifyDataChanged(); // Listen der Seite neu laden
    } catch (err) {
      showError(err, 'Wiederherstellen fehlgeschlagen');
    }
    setBusy(null);
  };
  return (
    <Modal
      title="Papierkorb"
      onClose={onClose}
      testId="trash-dialog"
      footer={
        <button type="button" className="btn" onClick={onClose}>
          Schließen
        </button>
      }
    >
      <p className="muted small" data-testid="trash-info">
        {TRASH_INFO}
      </p>
      {!items.length && (
        <p className="muted" data-testid="trash-empty">
          Der Papierkorb ist leer.
        </p>
      )}
      <ul className="trash-list" data-testid="trash-list">
        {items.map((e) => (
          <li key={e.key} className="trash-row" data-testid="trash-entry" data-kind={e.kind}>
            <Icon name="trash" size={18} />
            <span className="trash-text">
              <strong>{e.title}</strong>
              <span className="muted small">
                {e.detail} · gelöscht am {new Date(e.at).toLocaleDateString('de-DE')} · noch {e.daysLeft} {e.daysLeft === 1 ? 'Tag' : 'Tage'}
              </span>
            </span>
            <button type="button" className="btn btn-sm" disabled={busy !== null} onClick={() => void restore(e)} data-testid="trash-restore">
              Wiederherstellen
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
