import { useEffect, useState } from 'react';
import { initials, loadCrewToday, type CrewToday } from '../lib/crew-today';
import { workerName } from '../lib/crew';
import { useDataChanged } from '../lib/data-events';
import { fmtH } from '../lib/times';
import type { Worker } from '../lib/types';

/** Namen kurz: „Huber, Maier und 2 weitere“ */
function names(list: Worker[], max = 2): string {
  const n = list.map(workerName);
  return n.length <= max + 1 ? n.join(', ') : `${n.slice(0, max).join(', ')} und ${n.length - max} weitere`;
}

/** Stand von heute aus der Ablage (Tools-Seite); lädt bei jedem Abgleich neu */
export function useCrewToday(enabled = true): CrewToday | null {
  const [data, setData] = useState<CrewToday | null>(null);
  const load = () => {
    if (enabled) void loadCrewToday().then(setData).catch(() => setData(null));
  };
  useEffect(load, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  useDataChanged(load);
  return data;
}

/**
 * Karte „Heute auf der Baustelle“: Köpfe der Eingeteilten, Anzahl und geplante Stunden; darunter, wer krank,
 * im Urlaub oder noch frei ist. Als Verweis (Tools-Seite → Team) oder als reine Anzeige (im Team).
 */
export function CrewTodayCard({ data, href, testId = 'crew-today' }: { data: CrewToday; href?: string; testId?: string }) {
  const faces = data.present.slice(0, 3);
  const more = data.present.length - faces.length;
  const title = !data.workday ? (data.holiday ? `Feiertag: ${data.holiday}` : 'Heute kein Arbeitstag') : data.present.length === 1 ? '1 Mitarbeiter eingeteilt' : `${data.present.length} Mitarbeiter eingeteilt`;
  const sub = !data.workday ? 'Keine Einteilung für heute' : data.present.length ? `${fmtH(data.hours)} Std. geplant · ${data.time}` : `Noch niemand eingeteilt · ${data.time}`;
  const tags: { kind: string; label: string; who: Worker[] }[] = [
    { kind: 'sick', label: 'krank', who: data.sick },
    { kind: 'away', label: 'Urlaub', who: data.vacation },
    { kind: 'open', label: 'noch frei', who: data.open },
  ].filter((t) => t.who.length);
  const body = (
    <>
      <span className="crew-today-main">
        {faces.length > 0 && (
          <span className="crew-today-faces" aria-hidden="true">
            {faces.map((w) => (
              <span key={w.id} className="crew-face">
                {initials(w)}
              </span>
            ))}
            {more > 0 && <span className="crew-face more">+{more}</span>}
          </span>
        )}
        <span className="crew-today-text">
          <strong data-testid={`${testId}-count`}>{title}</strong>
          <span>{sub}</span>
        </span>
      </span>
      {tags.length > 0 && (
        <span className="crew-today-tags">
          {tags.map((t) => (
            <span key={t.kind} className={`crew-today-tag ${t.kind}`} data-testid={`${testId}-${t.kind}`}>
              <b>
                {t.who.length} {t.label}
              </b>
              <span>{names(t.who)}</span>
            </span>
          ))}
        </span>
      )}
    </>
  );
  return href ? (
    <a href={href} className="crew-today" data-testid={testId} title="Zur Einteilung im Team">
      {body}
    </a>
  ) : (
    <div className="crew-today" data-testid={testId}>
      {body}
    </div>
  );
}

