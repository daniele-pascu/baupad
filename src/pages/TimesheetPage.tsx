import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { SiteNav } from '../components/SiteNav';
import { confirmDialog, offerFile, showError, toast } from '../components/ui';
import { isoDate, parseDate, workerName } from '../lib/crew';
import { useDataChanged } from '../lib/data-events';
import { deleteTimeDay, deleteTimeMonth } from '../lib/db';
import { usePageTitle } from '../lib/page-title';
import { navigate, paths } from '../lib/router';
import { timesScope } from '../lib/times-access';
import { dayHours, defaultTimes, fmtH, holidayOn, hoursOf, monthDays, monthId, monthLabel, parseHours, plannedHours, shiftMonth, summarize, thisMonth, validTime, weekdayIdx, WEEKDAYS, type TimeDay, type TimeLine } from '../lib/times';
import { approveMonth, loadTimes, saveDay, storedMonthFile, suggestionFor, workerYearFile, type TimesData } from '../lib/times-data';
import { useSession } from '../lib/use-session';
import { SiteSelect, TimeInputs, timeValues, TIMES_ACCENT } from './TimesPage';

/**
 * Monatszettel eines Arbeiters: eine Zeile je Tag mit Baustelle und Stunden (zweite Baustelle = zweite Zeile),
 * Wegzeit optional. Vorschläge aus der Einteilung grau – „übernehmen“ je Tag oder alle offenen Tage bis heute.
 * Summen (Stunden, Wegzeit, Soll, je Baustelle), Freigabe durch das Büro, Excel.
 */
export function TimesheetPage({ workerId, month: m }: { workerId: string; month: string | null }) {
  const session = useSession();
  const month = m ?? thisMonth();
  const [data, setData] = useState<TimesData | null>(null);
  const today = isoDate(new Date());
  const scope = useMemo(() => timesScope(session), [session]);
  const office = scope.level === 'office';
  const by = session?.name || 'Unbekannt';
  const reload = () =>
    void loadTimes(month, scope)
      .then(setData)
      .catch((e) => showError(e, 'Monatszettel konnte nicht geladen werden'));
  useEffect(reload, [month, JSON.stringify(scope)]); // eslint-disable-line react-hooks/exhaustive-deps
  useDataChanged(reload);
  const worker = data?.workers.find((w) => w.id === workerId) ?? null;
  usePageTitle(worker ? `${workerName(worker)} – ${monthLabel(month)} – BauPad` : 'Monatszettel – BauPad');

  const days = useMemo(() => new Map((data?.days ?? []).filter((d) => d.workerId === workerId).map((d) => [d.date, d] as const)), [data, workerId]);
  const approval = data?.approvals.find((a) => a.id === monthId(workerId, month)) ?? null;
  // Arbeiter: nur ansehen; Polier: Monatszettel macht das Büro
  const locked = scope.level === 'own' || (!!approval && !office);
  if (scope.level === 'site')
    return (
      <>
        <SiteNav />
        <div className="page">
          <p className="muted" data-testid="timesheet-office-only">
            Monatszettel, Freigabe und Excel macht das Büro. <a href={paths.times()}>Zurück zur Zeitaufzeichnung</a>
          </p>
        </div>
      </>
    );
  if (!data) return <SiteNav />;
  if (!worker)
    return (
      <>
        <SiteNav />
        <div className="page">
          <p>Arbeiter nicht gefunden.</p>
          <a className="btn" href={paths.times({ month })}>
            Zur Zeitaufzeichnung
          </a>
        </div>
      </>
    );

  const s = summarize(month, days, data.times, data.absences, workerId, today);
  const open = s.open.filter((d) => suggestionFor(data, workerId, d).lines.length > 0);
  const run = (fn: () => Promise<unknown>) => void fn().then(reload, (e) => showError(e, 'Speichern fehlgeschlagen'));
  const takeOpen = () =>
    run(async () => {
      for (const d of open) await saveDay(workerId, d, suggestionFor(data, workerId, d).lines, by);
      toast(`${open.length} ${open.length === 1 ? 'Tag' : 'Tage'} übernommen.`, 'success');
    });
  const approve = () =>
    run(async () => {
      if (s.open.length && !(await confirmDialog({ title: 'Trotzdem freigeben?', message: <p>{s.open.length} Werktage sind noch nicht erfasst. Diese Tage zählen dann ohne Stunden.</p>, confirmLabel: 'Freigeben' }))) return;
      await approveMonth(data, workerId, month, by);
      toast(`Monat freigegeben – Datei „${monthLabel(month)}“ gespeichert. Änderungen nur noch durch das Büro.`, 'success', 5000);
    });
  const unapprove = () => run(() => deleteTimeMonth(monthId(workerId, month)));
  /** Excel in der Firmenvorlage: Jahresdatei mit allen Monaten bis jetzt */
  const excel = () => void workerYearFile(data, workerId, Number(month.slice(0, 4))).then(offerFile).catch((e) => showError(e, 'Excel konnte nicht erstellt werden'));
  /** beim Freigeben gespeicherter Monatsstand */
  const stored = () =>
    void (approval ? storedMonthFile(data, approval) : Promise.resolve(null))
      .then((f) => (f ? offerFile(f) : toast('Für diesen Monat ist keine Datei gespeichert.', 'info')))
      .catch((e) => showError(e, 'Datei konnte nicht geladen werden'));

  return (
    <>
      <SiteNav />
      <div className="page times-page" style={TIMES_ACCENT}>
        <header className="page-head page-head-row">
          <div className="page-head-title">
            <a href={paths.times({ month })} className="icon-link" aria-label="Zur Zeitaufzeichnung" title="Zur Zeitaufzeichnung" data-testid="to-times">
              <Icon name="back" />
            </a>
            <div>
              <h1 data-testid="timesheet-title">{workerName(worker)}</h1>
              <span className="muted small">{[worker.staffNo && `Nr. ${worker.staffNo}`, worker.role].filter(Boolean).join(' · ') || 'Monatszettel'}</span>
            </div>
          </div>
          <div className="row gap">
            <button type="button" className="btn btn-sm btn-primary" onClick={excel} title="Zeitaufzeichnung in der Firmenvorlage (alle Monate, Formeln, Feiertage)" data-testid="timesheet-excel">
              <Icon name="excel" size={16} /> Zeitaufzeichnung {month.slice(0, 4)}
            </button>
            {approval?.fileId && (
              <button type="button" className="btn btn-sm" onClick={stored} title="Beim Freigeben gespeicherte Datei dieses Monats" data-testid="timesheet-stored">
                <Icon name="download" size={16} /> Gespeichert {monthLabel(month).split(' ')[0]}
              </button>
            )}
            {office &&
              (approval ? (
                <button type="button" className="btn btn-sm" onClick={unapprove} data-testid="timesheet-unapprove">
                  Freigabe aufheben
                </button>
              ) : (
                <button type="button" className="btn btn-sm btn-primary" onClick={approve} data-testid="timesheet-approve">
                  <Icon name="check" size={16} /> Monat freigeben
                </button>
              ))}
          </div>
        </header>

        <div className="times-month-switch big">
          <button type="button" className="icon-link" onClick={() => navigate(paths.timesheet(workerId, shiftMonth(month, -1)), true)} aria-label="Voriger Monat" data-testid="timesheet-prev">
            <Icon name="back" size={18} />
          </button>
          <strong data-testid="timesheet-month">{monthLabel(month)}</strong>
          <button type="button" className="icon-link" onClick={() => navigate(paths.timesheet(workerId, shiftMonth(month, 1)), true)} aria-label="Nächster Monat" data-testid="timesheet-next">
            <Icon name="next" size={18} />
          </button>
        </div>

        {approval && (
          <div className="banner banner-info" role="status" data-testid="timesheet-approved">
            <p>
              Freigegeben am {new Date(approval.approvedAt).toLocaleDateString('de-DE')} von {approval.approvedBy}.{locked ? ' Änderungen nur durch das Büro.' : ' Änderungen werden mit Name und Zeitpunkt vermerkt.'}
            </p>
          </div>
        )}

        <section className="times-summary" data-testid="timesheet-summary">
          <div>
            <span className="muted small">Stunden</span>
            <strong data-testid="timesheet-hours">{fmtH(s.hours)} h</strong>
          </div>
          <div>
            <span className="muted small">Wegzeit</span>
            <strong data-testid="timesheet-travel">{fmtH(s.travel)} h</strong>
          </div>
          <div>
            <span className="muted small">Soll</span>
            <strong>{fmtH(s.target)} h</strong>
          </div>
          <div>
            <span className="muted small">Urlaub / Krank</span>
            <strong>
              {s.vacation} / {s.sick} Tage
            </strong>
          </div>
          {s.bySite.length > 0 && <p className="small muted times-by-site">{s.bySite.map((x) => `${x.name} ${fmtH(x.hours)} h`).join(' · ')}</p>}
        </section>

        {open.length > 0 && !locked && (
          <div className="banner banner-warn times-open" role="status">
            <p>
              <strong>{open.length} {open.length === 1 ? 'Tag' : 'Tage'} offen</strong> bis heute – Vorschläge aus der Einteilung prüfen und übernehmen.
            </p>
            <button type="button" className="btn btn-sm btn-primary" onClick={takeOpen} data-testid="timesheet-take-open">
              <Icon name="check" size={16} /> Alle offenen übernehmen
            </button>
          </div>
        )}

        <ol className="times-sheet" data-testid="timesheet-days">
          {monthDays(month).map((date) => (
            <SheetDay key={`${date}-${days.get(date)?.updatedAt ?? 0}`} date={date} rec={days.get(date) ?? null} data={data} workerId={workerId} by={by} locked={locked} approved={!!approval} today={today} onSaved={reload} />
          ))}
        </ol>
      </div>
    </>
  );
}

type LineDraft = { projectId: string | null; siteName: string; from: string; to: string; pause: number; pauseFrom: string; pauseTo: string; hours: number; travel: string };
const draftOf = (l: TimeLine): LineDraft => ({ projectId: l.projectId, siteName: l.siteName, ...timeValues(l), hours: l.hours, travel: l.travel ? fmtH(l.travel) : '' });
/** vollständig: Baustelle und von/bis – oder ältere Zeile nur mit Stunden */
const complete = (l: LineDraft) => !!l.siteName && ((validTime(l.from) && validTime(l.to)) || (!l.from && !l.to && l.hours > 0));

/** ein Tag im Monatszettel: je Baustelle eine Zeile mit von, bis, Pause → Stunden, Wegzeit */
function SheetDay({ date, rec, data, workerId, by, locked, approved, today, onSaved }: { date: string; rec: TimeDay | null; data: TimesData; workerId: string; by: string; locked: boolean; approved: boolean; today: string; onSaved(): void }) {
  const sugg = suggestionFor(data, workerId, date);
  const fallback = defaultTimes(data.times, date, data.defaults[workerId]);
  const [lines, setLines] = useState<LineDraft[]>(() => (rec?.lines ?? []).map(draftOf));
  const [editing, setEditing] = useState(false);
  const wd = weekdayIdx(date);
  const free = !plannedHours(data.times, date);
  const holiday = holidayOn(date);
  const absent = sugg.absence === 'urlaub' ? 'Urlaub' : sugg.absence === 'krank' ? 'Krank' : null;
  const persist = (next: LineDraft[]) => {
    // solange eine Zeile unvollständig ist (Baustelle oder Zeiten fehlen), noch nicht speichern
    if (next.some((l) => !complete(l))) return;
    const out: TimeLine[] = next.map((l) => {
      const t = parseHours(l.travel);
      return { projectId: l.projectId, siteName: l.siteName, hours: l.hours, ...(l.from ? { from: l.from, to: l.to, pause: l.pause, ...(l.pauseFrom && l.pauseTo ? { pauseFrom: l.pauseFrom, pauseTo: l.pauseTo } : {}) } : {}), ...(t ? { travel: t } : {}) };
    });
    // Korrekturen im Monatszettel sind Ausnahmen – gemerkt werden die Zeiten aus „Tag erfassen“
    void saveDay(workerId, date, out, by, { prev: rec ?? undefined, approved }).then(onSaved, (e) => showError(e, 'Speichern fehlgeschlagen'));
  };
  const setLine = (i: number, patch: Partial<LineDraft>, commit = false) => {
    const next = lines.map((l, j) => (j === i ? { ...l, ...patch } : l));
    setLines(next);
    if (commit) persist(next);
  };
  const addLine = () => {
    const last = lines[lines.length - 1];
    setLines((l) => [...l, { projectId: null, siteName: '', from: last?.to ?? fallback?.from ?? '', to: fallback?.to ?? '', pause: 0, pauseFrom: '', pauseTo: '', hours: 0, travel: '' }]);
  };
  const removeLine = (i: number) => {
    const next = lines.filter((_, j) => j !== i);
    setLines(next);
    persist(next);
  };
  const take = () => void saveDay(workerId, date, sugg.lines, by).then(onSaved, (e) => showError(e, 'Speichern fehlgeschlagen'));
  const reset = () => void deleteTimeDay(rec!.id).then(onSaved, (e) => showError(e, 'Zurücksetzen fehlgeschlagen'));
  const isOpen = !rec && !free && !absent && date <= today && sugg.lines.length > 0;
  const lineHours = (l: LineDraft) => (validTime(l.from) && validTime(l.to) ? hoursOf(l.from, l.to, l.pause) : l.hours);

  return (
    <li className={`times-sheet-day${free ? ' free' : ''}${rec ? ' done' : ''}${isOpen ? ' open' : ''}`} data-testid="timesheet-day" data-date={date} data-state={rec ? 'done' : isOpen ? 'open' : 'none'}>
      <span className="times-sheet-date">
        <strong>
          {WEEKDAYS[wd]} {parseDate(date).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}
        </strong>
        {holiday && <span className="muted small">{holiday}</span>}
        {absent && <span className="times-badge">{absent}</span>}
      </span>
      <div className="times-sheet-lines">
        {rec || editing ? (
          <>
            {lines.map((l, i) => (
              <div key={i} className="times-line" data-testid="timesheet-line">
                <SiteSelect value={l.siteName ? { projectId: l.projectId, siteName: l.siteName } : null} sites={data.sites} disabled={locked} testId="timesheet-site" onChange={(v) => setLine(i, { projectId: v.projectId, siteName: v.siteName }, true)} />
                <TimeInputs from={l.from} to={l.to} pause={l.pause} pauseFrom={l.pauseFrom} pauseTo={l.pauseTo} disabled={locked} testPrefix="timesheet" onChange={(v) => setLine(i, v, true)} />
                <span className="times-hours" data-testid="timesheet-line-hours">
                  {fmtH(lineHours(l))} h
                </span>
                <label className="times-num travel">
                  <input inputMode="decimal" value={l.travel} disabled={locked} onChange={(e) => setLine(i, { travel: e.target.value })} onBlur={() => persist(lines)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} placeholder="Weg" aria-label="Wegzeit" data-testid="timesheet-travel" />
                </label>
                {!locked && (rec || lines.length > 1) && (
                  <button type="button" className="icon-link times-line-remove" onClick={() => removeLine(i)} aria-label="Zeile entfernen" data-testid="timesheet-line-remove">
                    <Icon name="close" size={16} />
                  </button>
                )}
              </div>
            ))}
            {!lines.length && <span className="muted small">keine Stunden</span>}
            {!locked && (
              <div className="row gap times-line-actions">
                <button type="button" className="link-btn small" onClick={addLine} data-testid="timesheet-add-line">
                  + Baustelle
                </button>
                {rec && (
                  <button type="button" className="link-btn small muted" onClick={reset} title="Erfassung löschen, wieder Vorschlag aus der Einteilung" data-testid="timesheet-reset">
                    zurücksetzen
                  </button>
                )}
              </div>
            )}
          </>
        ) : sugg.lines.length ? (
          <div className="times-suggest">
            <span className="muted small" data-testid="timesheet-suggestion">
              {sugg.lines.map((l) => `${l.siteName} ${l.from}–${l.to}, ${fmtH(l.hours)} h`).join(' · ')}
            </span>
            {!locked && (
              <button type="button" className="btn btn-sm times-take" onClick={take} data-testid="timesheet-take">
                <Icon name="check" size={16} /> übernehmen
              </button>
            )}
            {!locked && (
              <button
                type="button"
                className="link-btn small"
                onClick={() => {
                  setLines(sugg.lines.map(draftOf));
                  void saveDay(workerId, date, sugg.lines, by).then(onSaved);
                }}
                data-testid="timesheet-edit"
              >
                ändern
              </button>
            )}
          </div>
        ) : (
          !locked && (
            <button
              type="button"
              className="link-btn small times-add-day"
              onClick={() => {
                setLines([{ projectId: null, siteName: '', ...timeValues(fallback ?? { from: '07:00', to: '16:00', pause: 0.5 }), hours: 0, travel: '' }]);
                setEditing(true);
              }}
              data-testid="timesheet-add-day"
            >
              + Stunden eintragen
            </button>
          )
        )}
      </div>
      <span className="times-sheet-sum" data-testid="timesheet-day-sum">
        {rec && dayHours(rec) ? `${fmtH(dayHours(rec))} h` : ''}
      </span>
    </li>
  );
}
