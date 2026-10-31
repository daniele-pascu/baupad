import type { ReactNode } from 'react';
import { projectPrefix, projectSubline, type ProjectLabelInfo } from '../lib/project-label';

/**
 * Projekt in Listen – in allen Werkzeugen gleich: Kostenstelle bzw. Projektnummer vor dem Namen, fett und groß;
 * darunter dünn und klein die übrigen Angaben in einer Zeile. `extra` ergänzt die Zeile darunter (z. B. Anzahl).
 */
export function ProjectHeading({ info, extra, nameTestId }: { info: ProjectLabelInfo; extra?: ReactNode; nameTestId?: string }) {
  const prefix = projectPrefix(info);
  const sub = projectSubline(info);
  return (
    <span className="proj-head">
      <strong className="proj-title" data-testid={nameTestId}>
        {prefix && <span className="proj-prefix">{prefix}</span>}
        {info.name}
      </strong>
      {(sub || extra) && (
        <span className="proj-sub">
          {sub}
          {sub && extra ? ' · ' : ''}
          {extra}
        </span>
      )}
    </span>
  );
}
