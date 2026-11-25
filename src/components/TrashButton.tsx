import { useEffect, useState } from 'react';
import { notifyDataChanged, useDataChanged } from '../lib/data-events';
import { onPhotosChanged } from '../lib/photo-storage';
import { loadTrash, type TrashItem, type TrashScope } from '../lib/trash-items';
import { TRASH_DAYS } from '../lib/trash-purge';
import { Icon } from './Icon';
import { TrashCount } from './Motion';
import { Modal } from './Modal';
import { SelectBox, SelectionBar, SelectToggle, useSelection } from './Selection';
import { confirmDialog, showError, toast } from './ui';

/** Hinweis oben im Papierkorb – überall gleich */
export const TRASH_INFO = `Gelöschtes bleibt ${TRASH_DAYS} Tage im Papierkorb und wird danach endgültig gelöscht.`;

/**
 * Papierkorb-Taste oben im Seitenkopf der Tools: im Tool alles dieses Tools, in Projekt bzw. Baustelle
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
        <TrashCount n={items.length} />
      </button>
      {open && <TrashModal items={items} onRestored={load} onClose={() => setOpen(false)} />}
    </>
  );
}

function TrashModal({ items, onRestored, onClose }: { items: TrashItem[]; onRestored(): void; onClose(): void }) {
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
      <TrashList items={items} onChanged={onRestored} />
    </Modal>
  );
}

/**
 * Inhalt jedes Papierkorbs: Hinweis, Einträge mit „Wiederherstellen“, dazu „Auswählen“ – einzelne oder alle
 * markieren, dann wiederherstellen oder endgültig löschen (mit Rückfrage).
 */
export function TrashList({ items, onChanged }: { items: TrashItem[]; onChanged(): void }) {
  const [busy, setBusy] = useState(false);
  const sel = useSelection(items.map((e) => e.key));
  const run = async (list: TrashItem[], what: 'restore' | 'purge') => {
    setBusy(true);
    let done = 0;
    try {
      for (const e of list) {
        await (what === 'restore' ? e.restore() : e.purge());
        done++;
      }
      const n = list.length === 1 ? `${list[0].title}` : `${list.length} Einträge`;
      toast(what === 'restore' ? `${n} wiederhergestellt.` : `${n} endgültig gelöscht.`, 'success');
    } catch (err) {
      showError(err, what === 'restore' ? 'Wiederherstellen fehlgeschlagen' : 'Löschen fehlgeschlagen');
    }
    setBusy(false);
    if (done) {
      sel.stop();
      onChanged();
      notifyDataChanged(); // Listen der Seite neu laden
    }
  };
  const chosen = () => items.filter((e) => sel.has(e.key));
  const purge = async () => {
    const list = chosen();
    const ok = await confirmDialog({
      title: list.length === 1 ? 'Endgültig löschen?' : `${list.length} Einträge endgültig löschen?`,
      message: <p>{list.length === 1 ? `„${list[0].title}“ wird` : `${list.length} Einträge werden`} sofort endgültig gelöscht – auf allen Geräten. Das lässt sich nicht rückgängig machen.</p>,
      confirmLabel: 'Endgültig löschen',
      danger: true,
    });
    if (ok) await run(list, 'purge');
  };
  return (
    <>
      <div className="trash-head">
        <p className="muted small" data-testid="trash-info">
          {TRASH_INFO}
        </p>
        {items.length > 0 && <SelectToggle sel={sel} testId="trash-select" />}
      </div>
      {!items.length && (
        <p className="muted" data-testid="trash-empty">
          Der Papierkorb ist leer.
        </p>
      )}
      <SelectionBar
        sel={sel}
        inline
        noun={['Eintrag', 'Einträge']}
        testId="trash-selection-bar"
        actions={[
          { label: 'Wiederherstellen', icon: 'undo', primary: true, disabled: busy, onSelect: () => void run(chosen(), 'restore'), testId: 'trash-restore-selected' },
          { label: 'Endgültig löschen', icon: 'trash', primary: true, danger: true, disabled: busy, onSelect: () => void purge(), testId: 'trash-purge-selected' },
        ]}
      />
      <ul className="trash-list" data-testid="trash-list">
        {items.map((e) => (
          <li key={e.key} className={`trash-row${sel.active && sel.has(e.key) ? ' picked' : ''}`} data-testid="trash-entry" data-kind={e.kind}>
            {sel.active ? <SelectBox sel={sel} id={e.key} label={e.title} testId="trash-pick" /> : <Icon name="trash" size={18} />}
            <span className="trash-text">
              <strong>{e.title}</strong>
              <span className="muted small">
                {e.detail} · gelöscht am {new Date(e.at).toLocaleDateString('de-DE')} · noch {e.daysLeft} {e.daysLeft === 1 ? 'Tag' : 'Tage'}
              </span>
            </span>
            {!sel.active && (
              <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void run([e], 'restore')} data-testid="trash-restore">
                Wiederherstellen
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
