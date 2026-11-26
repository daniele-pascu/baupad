import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActionMenu, type MenuAction } from './ActionMenu';
import { Icon } from './Icon';
import { Swap } from './Motion';

/**
 * Mehrfachauswahl für Listen (Pläne, LV, Mitarbeiter, Aufmaße …): „Auswählen“ schaltet Kästchen je Zeile ein,
 * unten erscheint eine feste Leiste mit Anzahl, „Alle“/„Keine“, den wichtigsten Aktionen als Tasten und den
 * übrigen im Menü „Mehr“. Einträge, die es nicht mehr gibt (gelöscht, gefiltert), fallen aus der Auswahl.
 */
export interface Selection {
  active: boolean;
  start(): void;
  stop(): void;
  has(id: string): boolean;
  toggle(id: string): void;
  /** alle sichtbaren Einträge bzw. keinen */
  toggleAll(): void;
  /** ausgewählte Kennungen in der Reihenfolge der Liste */
  ids: string[];
  count: number;
  allSelected: boolean;
}

export function useSelection(ids: string[]): Selection {
  const [active, setActive] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const key = ids.join('|');
  const chosen = useMemo(() => ids.filter((id) => picked.has(id)), [key, picked]); // eslint-disable-line react-hooks/exhaustive-deps
  const stop = useCallback(() => {
    setActive(false);
    setPicked(new Set());
  }, []);
  // Esc beendet die Auswahl (nicht, wenn gerade ein Fenster offen ist – das schließt sich selbst)
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      // offenes Fenster oder Menü „Mehr“: Esc schließt nur dieses
      if (e.key === 'Escape' && !document.querySelector('.modal, .action-menu')) stop();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, stop]);
  return {
    active,
    start: () => setActive(true),
    stop,
    has: (id) => picked.has(id),
    toggle: (id) =>
      setPicked((prev) => {
        const next = new Set(prev);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    toggleAll: () => setPicked(chosen.length === ids.length ? new Set() : new Set(ids)),
    ids: chosen,
    count: chosen.length,
    allSelected: ids.length > 0 && chosen.length === ids.length,
  };
}

/** Taste „Auswählen“ bzw. „Fertig“ über einer Liste */
export function SelectToggle({ sel, testId, label = 'Auswählen', onStart }: { sel: Selection; testId: string; label?: string; onStart?: () => void }) {
  return (
    <button
      type="button"
      className={`btn btn-sm select-toggle${sel.active ? ' on' : ''}`}
      onClick={() => {
        if (sel.active) sel.stop();
        else {
          onStart?.();
          sel.start();
        }
      }}
      aria-pressed={sel.active}
      data-testid={testId}
    >
      <Swap k={sel.active ? 'on' : 'off'}>
        <Icon name={sel.active ? 'close' : 'check'} size={16} /> <span className="swap-text">{sel.active ? 'Fertig' : label}</span>
      </Swap>
    </button>
  );
}

/** Kästchen je Zeile (nur im Auswahlmodus anzeigen) */
export function SelectBox({ sel, id, label, testId }: { sel: Selection; id: string; label: string; testId: string }) {
  return (
    <input
      type="checkbox"
      className="select-box"
      checked={sel.has(id)}
      onChange={() => sel.toggle(id)}
      onClick={(e) => e.stopPropagation()}
      aria-label={`${label} auswählen`}
      data-testid={testId}
    />
  );
}

export interface SelectionAction extends MenuAction {
  /** als eigene Taste in der Leiste (sonst im Menü „Mehr“) */
  primary?: boolean;
}

/**
 * Feste Leiste unten: „3 Pläne ausgewählt“, Alle/Keine, Aktionen, Schließen. Aktionen sind ohne Auswahl gesperrt.
 * `noun` = [Einzahl, Mehrzahl], z. B. ['Plan', 'Pläne'].
 */
export function SelectionBar({ sel, noun, actions, testId, inline, top }: { sel: Selection; noun: [string, string]; actions: SelectionAction[]; testId: string; inline?: boolean; /** in der Liste oben statt unten (bleibt beim Scrollen oben stehen) */ top?: boolean }) {
  if (!sel.active) return null;
  const none = sel.count === 0;
  const primary = actions.filter((a) => a.primary);
  const more = actions.filter((a) => !a.primary).map((a) => ({ ...a, disabled: a.disabled || none }));
  return (
    <>
      {/* Platz unter der Liste, damit die letzte Zeile nicht unter der Leiste verschwindet */}
      {!inline && <div className="select-bar-space" aria-hidden="true" />}
      <div className={`select-bar${inline ? ' inline' : ''}${top ? ' top' : ''}`} role="toolbar" aria-label="Auswahl" data-testid={testId}>
        <span className="select-count" data-testid="select-count">
          {sel.count} {sel.count === 1 ? noun[0] : noun[1]}
        </span>
        <button type="button" className="btn btn-sm" onClick={sel.toggleAll} data-testid="select-all">
          {sel.allSelected ? 'Keine' : 'Alle'}
        </button>
        <span className="select-actions">
          {primary.map((a) => (
            <button key={a.label} type="button" className={`btn btn-sm${a.danger ? ' btn-danger-text' : ''}`} onClick={a.onSelect} disabled={none || a.disabled} data-testid={a.testId}>
              <Icon name={a.icon} size={16} /> {a.label}
            </button>
          ))}
          {more.length > 0 && <ActionMenu label="Weitere Aktionen für die Auswahl" actions={more} testId="select-more" />}
          <button type="button" className="icon-btn select-close" onClick={sel.stop} aria-label="Auswahl beenden" title="Auswahl beenden" data-testid="select-close">
            <Icon name="close" size={18} />
          </button>
        </span>
      </div>
    </>
  );
}
