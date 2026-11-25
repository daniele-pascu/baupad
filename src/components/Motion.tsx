import type { ReactNode } from 'react';
import { useBump, useChanged } from '../lib/motion';

/** Inhalt einer Taste, der wechselt (z. B. „Auswählen“ ↔ „Fertig“): Symbol und Text blenden über – erst ab dem ersten Wechsel */
export function Swap({ k, children }: { k: string; children: ReactNode }) {
  const changed = useChanged(k);
  return (
    <span key={k} className={`swap${changed ? ' swapped' : ''}`}>
      {children}
    </span>
  );
}

/** Zahl am Papierkorb: springt einmal kurz an, wenn etwas dazukommt */
export function TrashCount({ n }: { n: number }) {
  const bump = useBump(n);
  return n > 0 ? <span className={`trash-count${bump ? ` ${bump}` : ''}`}>{n}</span> : null;
}
