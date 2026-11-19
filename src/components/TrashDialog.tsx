import { restoreTrash, trashEntries } from '../lib/trash';
import { purgeAufmass, type TrashItem } from '../lib/trash-items';
import type { ProjectState } from '../lib/store';
import { Modal } from './Modal';
import { TrashList } from './TrashButton';

/**
 * Papierkorb des offenen Aufmaß-Projekts: gelöschte Pläne, Kostenstellen, LV/MFK und Originalpläne – 15 Tage, danach
 * endgültig gelöscht. Wiederherstellen über den geöffneten Stand (sofort sichtbar), endgültig löschen in der Datenbank.
 */
export function TrashDialog({ data, onClose }: { data: ProjectState; onClose: () => void }) {
  const items: TrashItem[] = trashEntries(data).map((e) => ({
    key: `aufmass:${data.project.id}:${e.at}`,
    kind: 'aufmass',
    at: e.at,
    title: e.title,
    detail: e.detail,
    projectId: data.project.id,
    daysLeft: e.daysLeft,
    restore: async () => restoreTrash(data, e.at),
    purge: () => purgeAufmass(data.project.id, e.at),
  }));
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
      <TrashList items={items} onChanged={() => {}} />
    </Modal>
  );
}
