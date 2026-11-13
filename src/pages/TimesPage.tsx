import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Icon } from '../components/Icon';
import { TimeField } from '../components/TimeField';
import { SiteNav } from '../components/SiteNav';
import { ToolIcon } from '../components/ToolIcon';
import { offerFile, promptDialog, showError, toast } from '../components/ui';
import { addDays, gradeLabel, isoDate, knownGrade, sortByGrade, workerName } from '../lib/crew';
import { useDataChanged } from '../lib/data-events';
import { usePageTitle } from '../lib/page-title';
import { navigate, paths } from '../lib/router';
import { lineAllowed, timesScope, type TimesScope } from '../lib/times-access';
import { companyPause, defaultTimes, fmtH, fmtPause, hoursOf, monthId, monthLabel, monthOf, parseHours, pauseOf, pauseTimes, shiftMonth, summarize, timesXlsx, validTime, weekdayIdx, type TimeDay } from '../lib/times';
import { loadTimes, saveDay, setDayAbsence, suggestionFor, workerYearFile, type TimesData } from '../lib/times-data';
import { useSession } from '../lib/use-session';
import type { Worker, WorkTimes } from '../lib/types';
import { Modal } from '../components/Modal';
import { saveWorker, setMeta } from '../lib/db';
import { uuid } from '../lib/ids';
import { pcStyle, useProjectColors } from '../lib/project-colors';

export const TIMES_ACCENT = { '--tool': '#0f9d76' } as CSSProperties;
const WEEKDAY_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

/**
 * Zeitaufzeichnung – Übersicht: „Tag erfassen“ für die eigenen Arbeiter (oben als Leiste; „+ Arbeiter“ übernimmt
 * aus der Personalliste oder legt mit Vor- und Nachname einen neuen an) bzw. – ohne eigene Auswahl – für die heute
 * Eingeteilten mit Baustelle und Stunden als Vorschlag; darunter der Monat: nur Arbeiter mit Stunden in diesem Monat
 * und die eigenen (Stunden, Soll, offene Tage, Freigabe) mit Excel für die Lohnverrechnung.
 */
export function TimesPage({ month: m, date: d }: { month: string | null; date: string | null }) {
  usePageTitle('Zeitaufzeichnung – BauPad');
  const session = useSession();
  const today = isoDate(new Date());
  const [date, setDate] = useState(d ?? today);
  const month = m ?? monthOf(date);
  const [data, setData] = useState<TimesData | null>(null);
  const [dayData, setDayData] = useState<TimesData | null>(null);
  const by = session?.name || 'Unbekannt';
  /** Rechte: Büro alles, Polier nur seine Projekte, Arbeiter nur eigene Stunden (lesen) */
  const scope = useMemo(() => timesScope(session), [session]);
  const scopeKey = JSON.stringify(scope);
  const office = scope.level === 'office';
  /** Arbeitszeiten der Firma: einmalig fragen (gilt für alle im Unternehmen), später über die Taste ändern */
  const [setup, setSetup] = useState<'auto' | 'open' | 'skipped' | null>(null);
  useEffect(() => {
    if (data && !data.timesSet && setup === null && office) setSetup('auto');
  }, [data, setup, office]);

  const reload = () => {
    void loadTimes(month, scope)
      .then(setData)
      .catch((e) => showError(e, 'Zeitaufzeichnung konnte nicht geladen werden'));
    void loadTimes(monthOf(date), scope)
      .then(setDayData)
      .catch(() => setDayData(null));
  };
  useEffect(reload, [month, date, scopeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useDataChanged(reload);
  /** „Meine Arbeiter“: Polier/Arbeiter wählt aus, wen er erfasst (gemerkt je Benutzer auf diesem Gerät); leer = alle */
  const mineKey = `timesMine:${by}`;
  const readMine = () => {
    try {
      return JSON.parse(localStorage.getItem(mineKey) ?? '[]') as string[];
    } catch {
      return [];
    }
  };
  const [mine, setMine] = useState<string[]>(readMine);
  // Anmeldung kommt evtl. erst nach dem ersten Zeichnen – dann die Auswahl dieses Benutzers laden
  useEffect(() => setMine(readMine()), [mineKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const [picking, setPicking] = useState(false);
  const saveMine = (ids: string[]) => {
    setMine(ids);
    try {
      localStorage.setItem(mineKey, JSON.stringify(ids));
    } catch {
      /* egal */
    }
  };

  const setMonth = (next: string) => navigate(paths.times({ month: next }), true);
  const excel = () => {
    if (!data) return;
    void offerFile(timesXlsx(month, data.workers, data.days, data.absences, data.times, data.company)).catch((e) => showError(e, 'Excel konnte nicht erstellt werden'));
  };
  /** je Arbeiter die Jahresdatei in der Firmenvorlage, zusammen als ZIP */
  const yearFiles = () => {
    if (!data) return;
    void (async () => {
      const { zipSync } = await import('fflate');
      const files: Record<string, Uint8Array> = {};
      for (const w of data.workers.filter((x) => x.active || data.days.some((d) => d.workerId === x.id))) {
        const f = await workerYearFile(data, w.id, Number(month.slice(0, 4)));
        files[f.name] = f.data;
      }
      await offerFile({ name: `Zeitaufzeichnung_${month.slice(0, 4)}_alle_Arbeiter.zip`, data: zipSync(files, { level: 0 }), mimeType: 'application/zip' });
    })().catch((e) => showError(e, 'Dateien konnten nicht erstellt werden'));
  };

  const rows = useMemo(() => {
    if (!data) return [];
    return [...data.workers]
      .filter((w) => scope.level === 'own' || mine.includes(w.id) || data.days.some((x) => x.workerId === w.id))
      .sort((a, b) => workerName(a).localeCompare(workerName(b), 'de'))
      .map((w) => {
        const days = new Map(data.days.filter((x) => x.workerId === w.id).map((x) => [x.date, x]));
        return { w, s: summarize(month, days, data.times, data.absences, w.id, today), approved: data.approvals.some((a) => a.id === monthId(w.id, month)) };
      });
  }, [data, month, today, mine, scope.level]);

  return (
    <>
      <SiteNav />
      <div className="page times-page" style={TIMES_ACCENT}>
        <header className="page-head page-head-row">
          <div className="page-head-title">
            <a href={paths.tools()} className="icon-link" aria-label="Zu den Tools" title="Zu den Tools" data-testid="to-tools">
              <Icon name="back" />
            </a>
            <h1 data-testid="times-title">Zeitaufzeichnung</h1>
          </div>
          {office && (
            <button type="button" className="btn btn-sm" onClick={() => setSetup('open')} title="Arbeitszeiten des Unternehmens (Vorschlag beim Erfassen)" data-testid="times-worktimes">
              <Icon name="settings" size={16} /> <span className="lbl">Arbeitszeiten</span>
            </button>
          )}
        </header>
        {data && office && (setup === 'auto' || setup === 'open') && (
          <WorkTimesDialog
            times={data.times}
            first={setup === 'auto'}
            onClose={() => setSetup('skipped')}
            onSave={(t) => {
              void setMeta('workTimes', t)
                .then(() => {
                  setSetup('skipped');
                  toast('Arbeitszeiten gespeichert – sie werden beim Erfassen vorgeschlagen.', 'success');
                  reload();
                })
                .catch((e) => showError(e, 'Speichern fehlgeschlagen'));
            }}
          />
        )}

        <section className="times-card" data-testid="times-day">
          <header className="times-card-head times-day-head">
            <h2>{scope.level === 'own' ? 'Meine Stunden' : 'Tag erfassen'}</h2>
            <div className="times-day-nav">
              <button type="button" className="icon-link" onClick={() => setDate(addDays(date, -1))} aria-label="Vortag" title="Vortag" data-testid="times-day-prev">
                <Icon name="back" size={18} />
              </button>
              <strong className="times-weekday" data-testid="times-weekday">
                {WEEKDAY_LONG[weekdayIdx(date)]}
              </strong>
              <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Datum" data-testid="times-date" />
              <button type="button" className="icon-link" onClick={() => setDate(addDays(date, 1))} aria-label="Nächster Tag" title="Nächster Tag" data-testid="times-day-next">
                <Icon name="next" size={18} />
              </button>
            </div>
            {date !== today && (
              <button type="button" className="btn btn-sm" onClick={() => setDate(today)} data-testid="times-today">
                Heute
              </button>
            )}
          </header>
          {scope.level === 'site' && scope.sites.length > 0 && (
            <p className="muted small" data-testid="times-scope-site">
              Du siehst und erfasst nur Stunden auf deinen freigegebenen Projekten.
            </p>
          )}
          {scope.level === 'own' && (
            <p className="muted small" data-testid="times-scope-own">
              {data && !data.workers.length ? 'Dein Konto ist noch keinem Arbeiter zugeordnet – das Büro trägt deine E-Mail in der Personalliste ein.' : 'Deine eigenen Stunden – eintragen und ändern macht der Polier bzw. das Büro.'}
            </p>
          )}
          {scope.level !== 'own' && (
          <div className="times-team" data-testid="times-team">
            {mine
              .map((id) => dayData?.workers.find((w) => w.id === id))
              .filter((w): w is Worker => !!w)
              .sort((a, b) => workerName(a).localeCompare(workerName(b), 'de'))
              .map((w) => (
                <span key={w.id} className="times-chip" data-testid="times-mine-chip" data-name={workerName(w)}>
                  {workerName(w)}
                  <button type="button" onClick={() => saveMine(mine.filter((x) => x !== w.id))} aria-label={`${workerName(w)} aus meiner Liste nehmen`} title="Aus meiner Liste nehmen" data-testid="times-mine-remove">
                    <Icon name="close" size={14} />
                  </button>
                </span>
              ))}
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setPicking(true)} data-testid="times-pick">
              <Icon name="plus" size={16} /> Arbeiter
            </button>
            {!mine.length && <span className="muted small">Ohne eigene Auswahl siehst du die heute Eingeteilten. Mit „+ Arbeiter“ legst du fest, wen du erfasst.</span>}
          </div>
          )}
          {picking && dayData && <PickWorkers workers={dayData.workers} selected={mine} onCreated={reload} onClose={() => setPicking(false)} onSave={(ids) => (saveMine(ids), setPicking(false))} />}
          {dayData ? <DayList data={dayData} date={date} by={by} office={office} scope={scope} mine={mine} onSaved={reload} /> : <p className="muted small">Wird geladen …</p>}
        </section>

        {scope.level === 'site' ? (
          <p className="muted small times-card" data-testid="times-month-office">
            Monatszettel, Freigabe und Excel macht das Büro.
          </p>
        ) : (
        <section className="times-card" data-testid="times-month">
          <header className="times-card-head">
            <h2>Monatszettel</h2>
            <div className="times-month-switch">
              <button type="button" className="icon-link" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Voriger Monat" data-testid="times-prev">
                <Icon name="back" size={18} />
              </button>
              <strong data-testid="times-month-label">{monthLabel(month)}</strong>
              <button type="button" className="icon-link" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Nächster Monat" data-testid="times-next">
                <Icon name="next" size={18} />
              </button>
            </div>
            {office && (
            <button type="button" className="btn btn-sm btn-primary times-excel" onClick={yearFiles} disabled={!data} title="Je Arbeiter die Zeitaufzeichnung in der Firmenvorlage (alle Monate, Formeln, Feiertage) – als ZIP" data-testid="times-year-files">
              <Icon name="excel" size={16} /> Zeitaufzeichnung {month.slice(0, 4)} (alle)
            </button>
            )}
            {office && (
            <button type="button" className="btn btn-sm" onClick={excel} disabled={!data} title="Zusätzliche Kurzliste des Monats (nicht die Firmenvorlage)" data-testid="times-excel">
              <Icon name="excel" size={16} /> Kurzliste Monat
            </button>
            )}
          </header>
          {data && rows.length === 0 && office && (
            <div className="crew-setup">
              <span className="tile-icon">
                <ToolIcon name="times" size={22} />
              </span>
              <div>
                <strong>Noch keine Arbeiter</strong>
                <p className="muted small">Oben mit „+ Arbeiter“ einfach einen Namen eingeben – oder die Personalliste der Arbeitereinteilung pflegen.</p>
              </div>
              <a href={paths.staff()} className="btn btn-primary">
                Personal
              </a>
            </div>
          )}
          {data && rows.length === 0 && (data.workers.length > 0 || !office) && (
            <p className="muted small" data-testid="times-month-empty">
              Noch keine Stunden in diesem Monat. Hier erscheinen deine Arbeiter und alle, für die im Monat Stunden erfasst sind.
            </p>
          )}
          <ul className="times-people">
            {rows.map(({ w, s, approved }) => (
              <li key={w.id}>
                <a href={paths.timesheet(w.id, month)} className="times-person" data-testid="times-person" data-name={workerName(w)}>
                  <span className="times-person-name">
                    <strong>{workerName(w)}</strong>
                    <span className="muted small">{[w.staffNo && `Nr. ${w.staffNo}`, w.role].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="times-person-sum" data-testid="times-person-sum">
                    <strong>{fmtH(s.hours)} h</strong>
                    <span className="muted small">Soll {fmtH(s.target)} h</span>
                  </span>
                  <span className="times-person-state">
                    {approved ? (
                      <span className="times-badge ok">Freigegeben</span>
                    ) : s.open.length ? (
                      <span className="times-badge warn">
                        {s.open.length} {s.open.length === 1 ? 'Tag' : 'Tage'} offen
                      </span>
                    ) : (
                      <span className="times-badge">vollständig</span>
                    )}
                  </span>
                  <Icon name="next" size={18} />
                </a>
              </li>
            ))}
          </ul>
        </section>
        )}
      </div>
    </>
  );
}

/** Arbeiter eines Tages: eingeteilte, bereits erfasste und dazugeholte */
function DayList({ data, date, by, office, scope, mine, onSaved }: { data: TimesData; date: string; by: string; office: boolean; scope: TimesScope; mine: string[]; onSaved(): void }) {
  const readOnly = scope.level === 'own';
  const items = data.workers
    .filter((w) => !mine.length || mine.includes(w.id))
    .map((w) => ({ w, rec: data.days.find((x) => x.workerId === w.id && x.date === date) ?? null, sugg: suggestionFor(data, w.id, date), locked: readOnly || (data.approvals.some((a) => a.id === monthId(w.id, data.month)) && !office) }))
    // eigene Auswahl: alle gewählten zeigen (auch ohne Einteilung); sonst wie bisher die Arbeiter des Tages
    .filter((x) => (mine.length && x.w.active) || x.rec || x.sugg.lines.length || x.sugg.absence)
    .sort((a, b) => (a.rec?.lines[0]?.siteName ?? a.sugg.lines[0]?.siteName ?? 'zzz').localeCompare(b.rec?.lines[0]?.siteName ?? b.sugg.lines[0]?.siteName ?? 'zzz', 'de') || workerName(a.w).localeCompare(workerName(b.w), 'de'));
  // Urlaub: nicht oben in der Liste, sondern eingeklappt darunter (dort lässt sich „anwesend“ wieder einstellen)
  // (Urlaub legt einen leeren Tageseintrag an – entscheidend ist, dass keine Stunden erfasst sind)
  const onLeave = (x: (typeof items)[number]) => x.sugg.absence === 'urlaub' && !x.rec?.lines.length;
  const away = items.filter(onLeave);
  const here = items.filter((x) => !onLeave(x));
  const pending = here.filter((x) => !x.rec && x.sugg.lines.length && !x.locked);
  const confirmAll = () =>
    void Promise.all(pending.map((x) => saveDay(x.w.id, date, x.sugg.lines, by, { scope })))
      .then(() => {
        toast(`${pending.length} ${pending.length === 1 ? 'Arbeiter' : 'Arbeiter'} übernommen.`, 'success');
        onSaved();
      })
      .catch((e) => showError(e, 'Speichern fehlgeschlagen'));
  const holiday = items[0]?.sugg.holiday ?? null;
  return (
    <>
      {holiday && <p className="small times-holiday">Feiertag: {holiday}</p>}
      {here.length === 0 && <p className="muted small" data-testid="times-day-empty">{readOnly ? 'Für diesen Tag sind keine Stunden erfasst.' : 'An diesem Tag ist niemand eingeteilt. Oben mit „+ Arbeiter“ hinzufügen.'}</p>}
      <ul className="times-day-list">
        {here.map((x) => (
          <DayRow key={`${x.w.id}-${date}`} w={x.w} date={date} rec={x.rec} sugg={x.sugg} data={data} by={by} scope={scope} locked={x.locked} onSaved={onSaved} />
        ))}
      </ul>
      {away.length > 0 && (
        <details className="times-away" data-testid="times-away">
          <summary>
            Im Urlaub ({away.length}): {away.map((x) => workerName(x.w)).join(', ')}
          </summary>
          <ul className="times-day-list">
            {away.map((x) => (
              <DayRow key={`${x.w.id}-${date}`} w={x.w} date={date} rec={x.rec} sugg={x.sugg} data={data} by={by} scope={scope} locked={x.locked} onSaved={onSaved} />
            ))}
          </ul>
        </details>
      )}
      <div className="row gap wrap times-day-actions">
        {pending.length > 0 && (
          <button type="button" className="btn btn-primary" onClick={confirmAll} data-testid="times-confirm-all">
            <Icon name="check" size={16} /> Alle Vorschläge übernehmen ({pending.length})
          </button>
        )}
      </div>
    </>
  );
}

/** „Meine Arbeiter“ auswählen: Suche oder scrollen, ankreuzen (wie beim Einteilen) */
function PickWorkers({ workers, selected, onSave, onClose, onCreated }: { workers: Worker[]; selected: string[]; onSave(ids: string[]): void; onClose(): void; onCreated(): void }) {
  const [sel, setSel] = useState<Set<string>>(() => new Set(selected));
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [busy, setBusy] = useState(false);
  /** gerade angelegte Arbeiter – sofort in der Liste, bis die Seite neu geladen hat */
  const [created, setCreated] = useState<Worker[]>([]);
  const full = workerName({ firstName: first.trim(), lastName: last.trim() }).toLowerCase();
  const exists = full ? [...workers, ...created].find((w) => workerName(w).trim().toLowerCase() === full) : undefined;
  const create = async () => {
    if (!first.trim() && !last.trim()) return;
    if (exists) {
      setSel(new Set(sel).add(exists.id));
      setFirst('');
      setLast('');
      return;
    }
    setBusy(true);
    try {
      const now = Date.now();
      const w: Worker = { id: uuid(), firstName: first.trim(), lastName: last.trim(), active: true, createdAt: now, updatedAt: now };
      await saveWorker(w);
      setCreated((c) => [...c, w]);
      setSel(new Set(sel).add(w.id));
      setFirst('');
      setLast('');
      onCreated();
    } catch (e) {
      showError(e, 'Arbeiter konnte nicht angelegt werden');
    }
    setBusy(false);
  };
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const list = sortByGrade([...workers, ...created.filter((c) => !workers.some((w) => w.id === c.id))].filter((w) => w.active));
  const shown = needle ? list.filter((w) => [workerName(w), w.role ?? '', w.staffNo ?? '', gradeLabel(knownGrade(w) ?? undefined)].join(' ').toLowerCase().includes(needle)) : list;
  return (
    <Modal
      title="Arbeiter hinzufügen"
      onClose={onClose}
      testId="times-pick-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={() => setSel(new Set())} data-testid="times-pick-none">
            Keine
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onSave(list.filter((w) => sel.has(w.id)).map((w) => w.id))} data-testid="times-pick-save">
            {sel.size ? `Fertig (${sel.size})` : 'Fertig'}
          </button>
        </>
      }
    >
      <div className="times-new" data-testid="times-new">
        <strong>Neuer Arbeiter</strong>
        <div className="times-new-row">
          <input value={first} onChange={(e) => setFirst(e.target.value)} placeholder="Vorname" aria-label="Vorname" autoComplete="off" data-testid="times-new-first" />
          <input value={last} onChange={(e) => setLast(e.target.value)} placeholder="Nachname" aria-label="Nachname" autoComplete="off" onKeyDown={(e) => e.key === 'Enter' && void create()} data-testid="times-new-last" />
          <button type="button" className="btn btn-primary" onClick={() => void create()} disabled={busy || (!first.trim() && !last.trim())} data-testid="times-new-add">
            <Icon name="plus" size={16} /> {exists ? 'Übernehmen' : 'Anlegen'}
          </button>
        </div>
        {exists && <span className="muted small">{workerName(exists)} gibt es schon – wird übernommen, nicht doppelt angelegt.</span>}
      </div>
      <p className="muted small times-pick-hint">{list.length ? 'Oder aus der Personalliste antippen. Deine Arbeiter stehen jeden Tag in „Tag erfassen“ – ohne Auswahl siehst du die heute Eingeteilten.' : 'Noch keine Personalliste – einfach Namen eingeben und anlegen.'}</p>
      <label className="crew-search crew-pick-search">
        <Icon name="select" size={18} />
        <span className="sr-only">Arbeiter suchen</span>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Arbeiter suchen: Name, Qualifikation, Nr." data-testid="times-pick-search" />
      </label>
      {needle && shown.length === 0 && <p className="muted small">Kein Arbeiter gefunden.</p>}
      <ul className="crew-pick">
        {shown.map((w) => (
          <li key={w.id}>
            <label className="check-row" data-testid="times-pick-worker" data-worker={workerName(w)}>
              <input
                type="checkbox"
                checked={sel.has(w.id)}
                onChange={(e) => {
                  const next = new Set(sel);
                  if (e.target.checked) next.add(w.id);
                  else next.delete(w.id);
                  setSel(next);
                }}
              />
              <span className="crew-pick-name">
                {workerName(w)}
                {knownGrade(w) && <span className="muted small"> · {gradeLabel(knownGrade(w)!)}</span>}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

/** Baustellen-Auswahl mit „Andere Baustelle …“ */
export function SiteSelect({ value, sites, onChange, disabled, testId }: { value: { projectId: string | null; siteName: string } | null; sites: TimesData['sites']; onChange(v: { projectId: string | null; siteName: string }): void; disabled?: boolean; testId?: string }) {
  const key = (p: string | null, n: string) => (p ? `p:${p}` : `n:${n}`);
  const list = value && !sites.some((s) => key(s.projectId, s.name) === key(value.projectId, value.siteName)) ? [...sites, { projectId: value.projectId, name: value.siteName }] : sites;
  const colorOf = useProjectColors();
  return (
    <select
      value={value ? key(value.projectId, value.siteName) : ''}
      className={value ? 'pc-select' : undefined}
      style={value ? pcStyle(colorOf(value.projectId ? `p:${value.projectId}` : `n:${value.siteName.trim().toLowerCase()}`)) : undefined}
      disabled={disabled}
      data-testid={testId}
      onChange={(e) => {
        const v = e.target.value;
        if (v === '__other')
          void promptDialog({ title: 'Andere Baustelle', label: 'Name der Baustelle' }).then((n) => {
            if (n?.trim()) onChange({ projectId: null, siteName: n.trim() });
          });
        else {
          const s = list.find((x) => key(x.projectId, x.name) === v);
          if (s) onChange({ projectId: s.projectId, siteName: s.name });
        }
      }}
    >
      <option value="">– Baustelle –</option>
      {list.map((s) => (
        <option key={key(s.projectId, s.name)} value={key(s.projectId, s.name)}>
          {s.name}
        </option>
      ))}
      <option value="__other">Andere Baustelle …</option>
    </select>
  );
}

export interface TimeValues {
  from: string;
  to: string;
  pause: number;
  pauseFrom: string;
  pauseTo: string;
}

/** Werte für die Eingabe: ältere Einträge nur mit Pausendauer bekommen passende Pausenzeiten vorgeschlagen */
export function timeValues(l: { from?: string; to?: string; pause?: number; pauseFrom?: string; pauseTo?: string } | null | undefined): TimeValues {
  const from = l?.from ?? '';
  const to = l?.to ?? '';
  const pause = l?.pause ?? 0;
  const pt = validTime(l?.pauseFrom) && validTime(l?.pauseTo) ? { pauseFrom: l!.pauseFrom!, pauseTo: l!.pauseTo! } : (pauseTimes(from, to, pause) ?? { pauseFrom: '', pauseTo: '' });
  return { from, to, pause, ...pt };
}

/**
 * Arbeitsbeginn, Arbeitsende, Pause von–bis – gemeinsamer Baustein für „Tag erfassen“ und den Monatszettel.
 * Die Pausendauer wird aus den Pausenzeiten automatisch berechnet und angezeigt.
 */
export function TimeInputs({ from, to, pauseFrom, pauseTo, pause, disabled, onChange, testPrefix }: TimeValues & { disabled?: boolean; onChange(v: TimeValues): void; testPrefix: string }) {
  const emit = (patch: Partial<TimeValues>) => {
    const v = { from, to, pause, pauseFrom, pauseTo, ...patch };
    // Dauer aus von–bis; beide leer = keine Pause; nur eine Zeit = Dauer bleibt bis zur zweiten
    const p = validTime(v.pauseFrom) && validTime(v.pauseTo) ? pauseOf(v.pauseFrom, v.pauseTo) : !v.pauseFrom && !v.pauseTo ? 0 : v.pause;
    onChange({ ...v, pause: p });
  };
  const bad = validTime(pauseFrom) && validTime(pauseTo) && (pauseTo <= pauseFrom || (validTime(from) && pauseFrom < from) || (validTime(to) && pauseTo > to));
  return (
    <>
      <label className="times-time tf">
        <span>Beginn</span>
        <TimeField value={from} disabled={disabled} onChange={(v) => emit({ from: v })} testId={`${testPrefix}-from`} />
      </label>
      <label className="times-time tt">
        <span>Ende</span>
        <TimeField value={to} disabled={disabled} onChange={(v) => emit({ to: v })} testId={`${testPrefix}-to`} />
      </label>
      <label className="times-time pause pf">
        <span>Pause von</span>
        <TimeField value={pauseFrom} disabled={disabled} onChange={(v) => emit({ pauseFrom: v })} testId={`${testPrefix}-pause-from`} />
      </label>
      <label className="times-time pause pt">
        <span>Pause bis</span>
        <TimeField value={pauseTo} disabled={disabled} onChange={(v) => emit({ pauseTo: v })} testId={`${testPrefix}-pause-to`} />
      </label>
      <span className={`times-pause-sum${bad ? ' warn' : ''}`} title={bad ? 'Pause liegt nicht innerhalb der Arbeitszeit' : 'Pausendauer (automatisch)'} data-testid={`${testPrefix}-pause`}>
        <span className="muted small">Pause</span> {fmtPause(pause)}
      </span>
    </>
  );
}

/** eine Zeile in „Tag erfassen“: Baustelle, von, bis, Pause → Stunden, Wegzeit; Vorschlag grau bis bestätigt */
function DayRow({ w, date, rec, sugg: rawSugg, data, by, scope, locked, onSaved }: { w: Worker; date: string; rec: TimeDay | null; sugg: ReturnType<typeof suggestionFor>; data: TimesData; by: string; scope: TimesScope; locked: boolean; onSaved(): void }) {
  // Polier: Vorschläge aus der Einteilung nur für seine Projekte
  const sugg = scope.level === 'site' ? { ...rawSugg, lines: rawSugg.lines.filter((l) => lineAllowed(l, scope)) } : rawSugg;
  const base = rec ? rec.lines : sugg.lines;
  const multi = base.length > 1;
  const first = base[0] ?? null;
  const fallback = defaultTimes(data.times, date, data.defaults[w.id]);
  const [site, setSite] = useState<{ projectId: string | null; siteName: string } | null>(first ? { projectId: first.projectId, siteName: first.siteName } : null);
  const [t, setT] = useState<TimeValues>(() => timeValues(first?.from ? first : fallback));
  const [travel, setTravel] = useState(first?.travel ? fmtH(first.travel) : '');
  /** Handy: Pause und Weg aufgeklappt */
  const [more, setMore] = useState(false);
  // Änderung von außen (anderes Gerät, Vorschlag übernommen): Werte nachziehen – nicht während hier getippt wird
  const rowRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (rowRef.current?.contains(document.activeElement)) return;
    setSite(first ? { projectId: first.projectId, siteName: first.siteName } : null);
    setT(timeValues(first?.from ? first : fallback));
    setTravel(first?.travel ? fmtH(first.travel) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec?.updatedAt]);
  const approved = data.approvals.some((a) => a.id === monthId(w.id, data.month));
  const hours = validTime(t.from) && validTime(t.to) ? hoursOf(t.from, t.to, t.pause) : (first?.hours ?? 0);
  const save = (next: { site?: typeof site; t?: typeof t; travel?: string } = {}) => {
    const s = next.site !== undefined ? next.site : site;
    const tt = next.t ?? t;
    const tr = parseHours(next.travel ?? travel);
    if (!s || !validTime(tt.from) || !validTime(tt.to)) return;
    void saveDay(w.id, date, [{ projectId: s.projectId, siteName: s.siteName, from: tt.from, to: tt.to, pause: tt.pause, ...(tt.pauseFrom && tt.pauseTo ? { pauseFrom: tt.pauseFrom, pauseTo: tt.pauseTo } : {}), hours: 0, ...(tr ? { travel: tr } : {}) }], by, { prev: rec ?? undefined, approved, remember: true, scope })
      .then(onSaved)
      .catch((e) => showError(e, 'Speichern fehlgeschlagen'));
  };
  const absence = sugg.absence;
  const setAbsence = (kind: 'urlaub' | 'krank' | null) => void setDayAbsence(w.id, date, kind, by, scope).then(onSaved, (e) => showError(e, 'Speichern fehlgeschlagen'));
  return (
    <li ref={rowRef} className={`times-day-row${rec ? ' done' : ' suggested'}${multi ? ' multi' : ''}${absence ? ' absent' : ''}${more ? ' more' : ''}`} data-testid="times-day-row" data-name={workerName(w)} data-state={rec ? 'done' : 'suggested'}>
      <span className="times-day-name">
        <strong>{workerName(w)}</strong>
        {rec && !absence ? <span className="times-badge ok">erfasst</span> : first && !absence ? <span className="times-badge">Vorschlag</span> : null}
        <select className={`times-absence${absence ? ` on ${absence}` : ''}`} value={absence ?? ''} disabled={locked} onChange={(e) => setAbsence((e.target.value || null) as 'urlaub' | 'krank' | null)} aria-label={`Anwesenheit ${workerName(w)}`} data-testid="times-absence">
          <option value="">anwesend</option>
          <option value="urlaub">Urlaub</option>
          <option value="krank">Krank</option>
        </select>
      </span>
      {absence ? (
        <span className="small muted times-day-multi">{absence === 'urlaub' ? 'Urlaub – keine Stunden' : 'Krank – keine Stunden'}</span>
      ) : multi ? (
        <span className="small times-day-multi">
          {base.map((l) => `${l.siteName} ${l.from ? `${l.from}–${l.to} ` : ''}${fmtH(l.hours)} h`).join(' · ')} –{' '}
          <a href={paths.timesheet(w.id, data.month)} data-testid="times-open-sheet">
            im Monatszettel ändern
          </a>
        </span>
      ) : (
        <>
          <SiteSelect
            value={site}
            sites={data.sites}
            disabled={locked}
            testId="times-site"
            onChange={(v) => {
              setSite(v);
              save({ site: v });
            }}
          />
          <TimeInputs
            {...t}
            disabled={locked}
            testPrefix="times"
            onChange={(v) => {
              setT(v);
              save({ t: v });
            }}
          />
          {/* nur am Handy: Pause und Weg sind eingeklappt, die Taste zeigt die Pause und klappt beides auf */}
          <button type="button" className="times-more" aria-expanded={more} onClick={() => setMore(!more)} data-testid="times-more">
            <span>
              Pause {fmtPause(t.pause)}
              {travel ? ` · Weg ${travel} h` : ''}
            </span>
            <Icon name={more ? 'up' : 'down'} size={16} />
          </button>
          <span className="times-hours" data-testid="times-hours">
            {fmtH(hours)} h
          </span>
          <label className="times-num travel">
            <input inputMode="decimal" value={travel} disabled={locked} onChange={(e) => setTravel(e.target.value)} onBlur={() => travel !== (first?.travel ? fmtH(first.travel) : '') && save()} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} placeholder="Weg" aria-label={`Wegzeit ${workerName(w)}`} data-testid="times-travel" />
          </label>
        </>
      )}
      {!rec && !locked && first && !absence && (
        <button type="button" className="btn btn-sm times-take" onClick={() => void saveDay(w.id, date, sugg.lines, by, { scope }).then(onSaved)} data-testid="times-take" title="Vorschlag übernehmen">
          <Icon name="check" size={16} />
        </button>
      )}
    </li>
  );
}

const DAY_LABELS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

/**
 * Arbeitszeiten des Unternehmens je Wochentag (Beginn, Ende, Pause von–bis) – einmalig beim ersten Öffnen gefragt,
 * gilt für alle im Unternehmen und als Vorschlag beim Erfassen; wer länger oder kürzer gearbeitet hat, bessert den Tag aus.
 */
function WorkTimesDialog({ times, first, onClose, onSave }: { times: WorkTimes; first: boolean; onClose(): void; onSave(t: WorkTimes): void }) {
  const [t, setT] = useState<WorkTimes>(() =>
    times.map((x) => (x ? { ...x, ...(x.pauseFrom ? {} : (pauseTimes(x.from, x.to, companyPause(x)) ?? {})) } : null)),
  );
  const set = (d: number, patch: Partial<NonNullable<WorkTimes[number]>> | null) => setT(t.map((y, i) => (i !== d ? y : patch === null ? null : { ...(y ?? { from: '07:00', to: '16:00' }), ...patch })));
  return (
    <Modal
      title={first ? 'Arbeitszeiten eures Unternehmens' : 'Arbeitszeiten'}
      onClose={onClose}
      testId="worktimes-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} data-testid="worktimes-later">
            {first ? 'Später' : 'Abbrechen'}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onSave(t.map((x) => (x ? { from: x.from, to: x.to, ...(x.pauseFrom && x.pauseTo ? { pauseFrom: x.pauseFrom, pauseTo: x.pauseTo } : {}) } : null)))} data-testid="worktimes-save">
            Speichern
          </button>
        </>
      }
    >
      <p className="muted small">
        {first ? 'Einmalig: Von wann bis wann wird bei euch gearbeitet? ' : ''}Diese Zeiten werden beim Erfassen vorgeschlagen. Wer an einem Tag länger oder kürzer gearbeitet hat, bessert einfach Beginn, Ende oder Pause an diesem Tag aus.
      </p>
      <div className="worktimes-list">
        {DAY_LABELS.map((name, d) => {
          const x = t[d];
          const pause = x ? (validTime(x.pauseFrom) && validTime(x.pauseTo) ? pauseOf(x.pauseFrom, x.pauseTo) : 0) : 0;
          return (
            <div key={d} className={`worktimes-row${x ? '' : ' off'}`} data-testid="worktimes-row" data-day={d}>
              <label className="check-row">
                <input type="checkbox" checked={!!x} onChange={(e) => set(d, e.target.checked ? { from: '07:00', to: d === 4 ? '12:00' : '16:00', ...(d === 4 ? {} : { pauseFrom: '12:00', pauseTo: '12:30' }) } : null)} data-testid="worktimes-day" />
                <strong>{name}</strong>
              </label>
              {x ? (
                <>
                  <label className="times-time">
                    <span>Beginn</span>
                    <TimeField value={x.from} onChange={(v) => set(d, { from: v })} testId="worktimes-from" />
                  </label>
                  <label className="times-time">
                    <span>Ende</span>
                    <TimeField value={x.to} onChange={(v) => set(d, { to: v })} testId="worktimes-to" />
                  </label>
                  <label className="times-time">
                    <span>Pause von</span>
                    <TimeField value={x.pauseFrom ?? ''} onChange={(v) => set(d, { pauseFrom: v })} testId="worktimes-pause-from" />
                  </label>
                  <label className="times-time">
                    <span>Pause bis</span>
                    <TimeField value={x.pauseTo ?? ''} onChange={(v) => set(d, { pauseTo: v })} testId="worktimes-pause-to" />
                  </label>
                  <span className="times-pause-sum" data-testid="worktimes-hours">
                    <span className="muted small">Stunden</span> {fmtH(Math.max(0, hoursOf(x.from, x.to, pause)))}
                  </span>
                </>
              ) : (
                <span className="muted small">frei</span>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
