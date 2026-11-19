import { restoreTrash, TRASH_DAYS, trashEntries } from '../lib/trash';
import type { ProjectState } from '../lib/store';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { toast } from './ui';

/** Papierkorb des Aufmaß-Projekts: gelöschte Pläne, Kostenstellen, LV/MFK und Originalpläne – 15 Tage wiederherstellbar */
export function TrashDialog({ data, onClose }: { data: ProjectState; onClose: () => void }) {
  const entries = trashEntries(data);
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
      <p className="muted small">Gelöschte Pläne (mit ihren Messungen), Kostenstellen, LV/MFK und Originalpläne lassen sich {TRASH_DAYS} Tage lang wiederherstellen.</p>
      {!entries.length && (
        <p className="muted" data-testid="trash-empty">
          Der Papierkorb ist leer.
        </p>
      )}
      <ul className="trash-list" data-testid="trash-list">
        {entries.map((e) => (
          <li key={e.at} className="trash-row" data-testid="trash-entry">
            <Icon name="trash" size={18} />
            <span className="trash-text">
              <strong>{e.title}</strong>
              <span className="muted small">
                {e.detail} · gelöscht am {new Date(e.at).toLocaleDateString('de-DE')} · noch {e.daysLeft} {e.daysLeft === 1 ? 'Tag' : 'Tage'}
              </span>
            </span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                restoreTrash(data, e.at);
                toast(`${e.title} wiederhergestellt.`, 'success');
              }}
              data-testid="trash-restore"
            >
              Wiederherstellen
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
