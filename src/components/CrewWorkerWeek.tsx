import type { CSSProperties } from 'react';
import { absenceOn } from '../lib/crew-absence';
import { addDays, DAY_NAMES, DAY_SHORT, dayDate, isoDate, knownGrade, sortByGrade, sortWorkers, workerName } from '../lib/crew';
import type { Absence, WeekPlan, WeekSite, Worker, WorkTimes } from '../lib/types';

/** Reihenfolge der Arbeiter: nach Qualifikation (Polier zuerst) oder alphabetisch */
export type WorkerOrder = 'grade' | 'name';

/** Was an einem Tag für einen Arbeiter gilt */
export type WorkerDay =
  | { kind: 'site'; site: WeekSite; more: number; sick: boolean }
  | { kind: 'urlaub' }
  | { kind: 'krank' }
  | { kind: 'holiday' }
  | { kind: 'off' }
  | { kind: 'open' };

/** Kürzel einer Baustelle aus ihrem Namen: zwei Buchstaben („Gesundheitszentrum Nord“ → GN, „Parkring“ → PA) */
export function siteCode(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/[\s-]+/)
    .filter((w) => w && !/^\d+$/.test(w));
  if (!words.length) return (name.trim().slice(0, 2) || '?').toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** Lage eines Arbeiters an einem Tag – Urlaub vor Baustelle; krank bleibt eingeteilt und wird markiert */
export function workerDay(plan: WeekPlan, absences: Absence[], weekId: string, workerId: string, day: number, workday: boolean, holiday: boolean): WorkerDay {
  const abs = absenceOn(absences, workerId, weekId, day);
  if (abs === 'urlaub' || plan.vacation[day]?.includes(workerId)) return { kind: 'urlaub' };
  const sites = plan.sites.filter((s) => !s.paused && s.days[day]?.includes(workerId));
  if (sites.length) return { kind: 'site', site: sites[0], more: sites.length - 1, sick: abs === 'krank' };
  if (abs === 'krank') return { kind: 'krank' };
  if (holiday) return { kind: 'holiday' };
  if (!workday) return { kind: 'off' };
  return { kind: 'open' };
}

/**
 * Team, Ansicht „Arbeiter“: je Arbeiter eine Zeile mit der Woche – an jedem Tag das Kürzel der Baustelle in ihrer
 * Farbe, U = Urlaub, K = krank, gelb gestrichelt = noch nicht eingeteilt. Antippen öffnet das passende Fenster.
 */
export function CrewWorkerWeek({
  plan,
  workers,
  absences,
  weekId,
  workTimes,
  holidayOf,
  siteStyle,
  siteName,
  order,
  onOrder,
  onPick,
}: {
  plan: WeekPlan;
  /** einteilbare Arbeiter (aktiv, ohne Projektleiter) */
  workers: Worker[];
  absences: Absence[];
  weekId: string;
  workTimes: WorkTimes;
  holidayOf(day: number): unknown;
  /** Farbe der Baustelle (wie in der Baustellen-Ansicht) */
  siteStyle(site: WeekSite): CSSProperties;
  /** Bezeichnung der Baustelle (Legende, Tooltip) */
  siteName(site: WeekSite): string;
  order: WorkerOrder;
  onOrder(o: WorkerOrder): void;
  onPick(workerId: string, day: number, state: WorkerDay): void;
}) {
  const list = order === 'name' ? sortWorkers(workers) : sortByGrade(workers);
  // Mo–Fr immer; Sa/So nur, wenn dort jemand eingeteilt ist oder sie Arbeitstage der Firma sind
  const days = [0, 1, 2, 3, 4, 5, 6].filter((d) => d < 5 || workTimes[d] || plan.sites.some((s) => s.days[d]?.length));
  const today = isoDate(new Date());
  const shown = plan.sites.filter((s) => !s.paused && days.some((d) => s.days[d]?.some((id) => workers.some((w) => w.id === id))));
  // eindeutige Kürzel: bei gleichen Kürzeln eine Ziffer anhängen
  const codes = new Map<string, string>();
  const used = new Map<string, number>();
  for (const s of plan.sites) {
    const c = siteCode(s.name);
    const n = (used.get(c) ?? 0) + 1;
    used.set(c, n);
    codes.set(s.id, n > 1 ? `${c.slice(0, 1)}${n}` : c);
  }
  const cols = { ['--ww-days' as string]: days.length } as CSSProperties;
  return (
    <section className="crew-ww" data-testid="crew-worker-week" data-order={order}>
      <div className="crew-ww-bar">
        <strong>
          {list.length} {list.length === 1 ? 'Arbeiter' : 'Arbeiter'}
        </strong>
        <div className="seg-toggle" role="radiogroup" aria-label="Reihenfolge der Arbeiter">
          <button type="button" role="radio" aria-checked={order === 'grade'} className={order === 'grade' ? 'on' : ''} onClick={() => onOrder('grade')} data-testid="crew-ww-order-grade">
            Nach Qualifikation
          </button>
          <button type="button" role="radio" aria-checked={order === 'name'} className={order === 'name' ? 'on' : ''} onClick={() => onOrder('name')} data-testid="crew-ww-order-name">
            A–Z
          </button>
        </div>
      </div>
      {!list.length ? (
        <p className="muted">Noch keine Arbeiter in der Personalliste.</p>
      ) : (
        // mit Sa/So am Handy automatisch kompakter (schmälere Felder), damit die ganze Woche in die Breite passt
        <div className={`crew-ww-grid${days.length > 5 ? ' dense' : ''}`} style={cols} role="table" aria-label="Woche je Arbeiter" data-days={days.length}>
          <div className="crew-ww-head" role="row">
            <span role="columnheader">Arbeiter</span>
            {days.map((d) => (
              <span key={d} role="columnheader" className={addDays(weekId, d) === today ? 'today' : ''} title={`${DAY_NAMES[d]} ${dayDate(weekId, d)}`}>
                {DAY_SHORT[d]}
                <small>{dayDate(weekId, d).replace(/\.$/, '').split('.').slice(0, 1).join('')}.</small>
              </span>
            ))}
          </div>
          {list.map((w) => {
            const g = knownGrade(w);
            return (
              <div key={w.id} className="crew-ww-row" role="row" data-testid="crew-ww-row" data-worker={workerName(w)}>
                <span className="crew-ww-name" role="rowheader">
                  <i className={`crew-ww-dot${g ? ` grade-${g}` : ''}`} aria-hidden="true" />
                  {/* am Handy steht der Name in einer eigenen Zeile über der Woche – immer ganz lesbar */}
                  <span className="crew-ww-full">{workerName(w)}</span>
                </span>
                {days.map((d) => {
                  const st = workerDay(plan, absences, weekId, w.id, d, !!workTimes[d], !!holidayOf(d));
                  const label =
                    st.kind === 'site'
                      ? `${siteName(st.site)}${st.more ? ` und ${st.more} weitere` : ''}${st.sick ? ' (krank)' : ''}`
                      : st.kind === 'urlaub'
                        ? 'Urlaub'
                        : st.kind === 'krank'
                          ? 'Krank'
                          : st.kind === 'holiday'
                            ? 'Feiertag'
                            : st.kind === 'off'
                              ? 'kein Arbeitstag'
                              : 'noch nicht eingeteilt';
                  return (
                    <button
                      key={d}
                      type="button"
                      role="cell"
                      className={`crew-ww-cell ww-${st.kind}${st.kind === 'site' && st.sick ? ' ww-sick' : ''}`}
                      style={st.kind === 'site' ? siteStyle(st.site) : undefined}
                      onClick={() => onPick(w.id, d, st)}
                      disabled={st.kind === 'off' || st.kind === 'holiday'}
                      aria-label={`${workerName(w)}, ${DAY_NAMES[d]}: ${label}`}
                      title={label}
                      data-testid="crew-ww-cell"
                      data-kind={st.kind}
                      data-day={d}
                      data-site={st.kind === 'site' ? st.site.name : undefined}
                    >
                      {st.kind === 'site' ? (
                        <>
                          <b>{codes.get(st.site.id)}</b>
                          <span className="crew-ww-long">{siteName(st.site)}</span>
                          {st.more > 0 && <sup>+{st.more}</sup>}
                        </>
                      ) : st.kind === 'urlaub' ? (
                        'U'
                      ) : st.kind === 'krank' ? (
                        'K'
                      ) : st.kind === 'open' ? (
                        '?'
                      ) : (
                        '–'
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
      {shown.length > 0 && (
        <p className="crew-ww-legend muted small" data-testid="crew-ww-legend">
          {shown.map((s) => (
            <span key={s.id} style={siteStyle(s)}>
              <b>{codes.get(s.id)}</b> {siteName(s)}
            </span>
          ))}
          <span>
            <b className="u">U</b> Urlaub
          </span>
          <span>
            <b className="k">K</b> Krank
          </span>
          <span>
            <b className="o">?</b> nicht eingeteilt
          </span>
        </p>
      )}
    </section>
  );
}
