import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Icon } from '../components/Icon';
import { SiteNav } from '../components/SiteNav';
import { ToolIcon } from '../components/ToolIcon';
import { offerFile, promptDialog, showError, toast } from '../components/ui';
import { isoDate, parseDate, workerName } from '../lib/crew';
import { useDataChanged } from '../lib/data-events';
import { usePageTitle } from '../lib/page-title';
import { navigate, paths } from '../lib/router';
import { canEditSites } from '../lib/sites';
import { defaultTimes, fmtH, fmtPause, hoursOf, monthId, monthLabel, monthOf, parseHours, PAUSES, shiftMonth, summarize, timesXlsx, validTime, weekdayIdx, WEEKDAYS, type TimeDay } from '../lib/times';
import { loadTimes, saveDay, suggestionFor, type TimesData } from '../lib/times-data';
import { useSession } from '../lib/use-session';
import type { Worker } from '../lib/types';

export const TIMES_ACCENT = { '--tool': '#0f9d76' } as CSSProperties;

/**
 * Zeitaufzeichnung – Übersicht: „Tag erfassen“ (alle Arbeiter des Tages mit Baustelle und Stunden aus der
 * Einteilung vorgeschlagen; ändern oder übernehmen) und die Monatsliste je Arbeiter (Stunden, Soll, offene
 * Tage, Freigabe) mit Excel für die Lohnverrechnung.
 */
export function TimesPage({ month: m, date: d }: { month: string | null; date: string | null }) {
  usePageTitle('Zeitaufzeichnung – BauPad');
  const session = useSession();
  const today = isoDate(new Date());
  const [date, setDate] = useState(d ?? today);
  const month = m ?? monthOf(date);
  const [data, setData] = useState<TimesData | null>(null);
  const [dayData, setDayData] = useState<TimesData | null>(null);
  const [extra, setExtra] = useState<string[]>([]);
  const by = session?.name || 'Unbekannt';

  const reload = () => {
    void loadTimes(month)
      .then(setData)
      .catch((e) => showError(e, 'Zeitaufzeichnung konnte nicht geladen werden'));
    void loadTimes(monthOf(date))
      .then(setDayData)
      .catch(() => setDayData(null));
  };
  useEffect(reload, [month, date]);
  useDataChanged(reload);
  useEffect(() => setExtra([]), [date]);

  const setMonth = (next: string) => navigate(paths.times({ month: next }), true);
  const excel = () => {
    if (!data) return;
    void offerFile(timesXlsx(month, data.workers, data.days, data.absences, data.times, data.company)).catch((e) => showError(e, 'Excel konnte nicht erstellt werden'));
  };

  const rows = useMemo(() => {
    if (!data) return [];
    return [...data.workers]
      .filter((w) => w.active || data.days.some((x) => x.workerId === w.id))
      .sort((a, b) => workerName(a).localeCompare(workerName(b), 'de'))
      .map((w) => {
        const days = new Map(data.days.filter((x) => x.workerId === w.id).map((x) => [x.date, x]));
        return { w, s: summarize(month, days, data.times, data.absences, w.id, today), approved: data.approvals.some((a) => a.id === monthId(w.id, month)) };
      });
  }, [data, month, today]);

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
        </header>

        <section className="times-card" data-testid="times-day">
          <header className="times-card-head">
            <h2>Tag erfassen</h2>
            <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} data-testid="times-date" />
            <span className="muted small">
              {WEEKDAYS[weekdayIdx(date)]}, {parseDate(date).toLocaleDateString('de-DE')}
            </span>
          </header>
          {dayData ? <DayList data={dayData} date={date} by={by} office={canEditSites(session)} extra={extra} onExtra={(id) => setExtra((l) => [...l, id])} onSaved={reload} /> : <p className="muted small">Wird geladen …</p>}
        </section>

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
            <button type="button" className="btn btn-sm btn-primary times-excel" onClick={excel} disabled={!data} data-testid="times-excel">
              <Icon name="excel" size={16} /> Excel
            </button>
          </header>
          {data && rows.length === 0 && (
            <div className="crew-setup">
              <span className="tile-icon">
                <ToolIcon name="times" size={22} />
              </span>
              <div>
                <strong>Noch keine Arbeiter</strong>
                <p className="muted small">Arbeiter werden in der Arbeitereinteilung unter „Personal“ angelegt.</p>
              </div>
              <a href={paths.staff()} className="btn btn-primary">
                Personal
              </a>
            </div>
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
      </div>
    </>
  );
}

/** Arbeiter eines Tages: eingeteilte, bereits erfasste und dazugeholte */
function DayList({ data, date, by, office, extra, onExtra, onSaved }: { data: TimesData; date: string; by: string; office: boolean; extra: string[]; onExtra(id: string): void; onSaved(): void }) {
  const items = data.workers
    .map((w) => ({ w, rec: data.days.find((x) => x.workerId === w.id && x.date === date) ?? null, sugg: suggestionFor(data, w.id, date), locked: data.approvals.some((a) => a.id === monthId(w.id, data.month)) && !office }))
    .filter((x) => x.rec || x.sugg.lines.length || x.sugg.absence || extra.includes(x.w.id))
    .sort((a, b) => (a.rec?.lines[0]?.siteName ?? a.sugg.lines[0]?.siteName ?? 'zzz').localeCompare(b.rec?.lines[0]?.siteName ?? b.sugg.lines[0]?.siteName ?? 'zzz', 'de') || workerName(a.w).localeCompare(workerName(b.w), 'de'));
  const pending = items.filter((x) => !x.rec && x.sugg.lines.length && !x.locked);
  const others = data.workers.filter((w) => w.active && !items.some((x) => x.w.id === w.id));
  const confirmAll = () =>
    void Promise.all(pending.map((x) => saveDay(x.w.id, date, x.sugg.lines, by)))
      .then(() => {
        toast(`${pending.length} ${pending.length === 1 ? 'Arbeiter' : 'Arbeiter'} übernommen.`, 'success');
        onSaved();
      })
      .catch((e) => showError(e, 'Speichern fehlgeschlagen'));
  const holiday = items[0]?.sugg.holiday ?? null;
  return (
    <>
      {holiday && <p className="small times-holiday">Feiertag: {holiday}</p>}
      {items.length === 0 && <p className="muted small">An diesem Tag ist niemand eingeteilt. Arbeiter unten dazuholen.</p>}
      <ul className="times-day-list">
        {items.map((x) => (
          <DayRow key={`${x.w.id}-${date}-${x.rec?.updatedAt ?? 0}`} w={x.w} date={date} rec={x.rec} sugg={x.sugg} data={data} by={by} locked={x.locked} onSaved={onSaved} />
        ))}
      </ul>
      <div className="row gap wrap times-day-actions">
        {pending.length > 0 && (
          <button type="button" className="btn btn-primary" onClick={confirmAll} data-testid="times-confirm-all">
            <Icon name="check" size={16} /> Alle Vorschläge übernehmen ({pending.length})
          </button>
        )}
        {others.length > 0 && (
          <select className="btn" value="" onChange={(e) => e.target.value && onExtra(e.target.value)} aria-label="Arbeiter dazuholen" data-testid="times-add-worker">
            <option value="">+ Arbeiter dazuholen</option>
            {others.map((w) => (
              <option key={w.id} value={w.id}>
                {workerName(w)}
              </option>
            ))}
          </select>
        )}
      </div>
    </>
  );
}

/** Baustellen-Auswahl mit „Andere Baustelle …“ */
export function SiteSelect({ value, sites, onChange, disabled, testId }: { value: { projectId: string | null; siteName: string } | null; sites: TimesData['sites']; onChange(v: { projectId: string | null; siteName: string }): void; disabled?: boolean; testId?: string }) {
  const key = (p: string | null, n: string) => (p ? `p:${p}` : `n:${n}`);
  const list = value && !sites.some((s) => key(s.projectId, s.name) === key(value.projectId, value.siteName)) ? [...sites, { projectId: value.projectId, name: value.siteName }] : sites;
  return (
    <select
      value={value ? key(value.projectId, value.siteName) : ''}
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

/** von / bis / Pause – gemeinsamer Baustein für „Tag erfassen“ und den Monatszettel */
export function TimeInputs({ from, to, pause, disabled, onChange, testPrefix }: { from: string; to: string; pause: number; disabled?: boolean; onChange(v: { from: string; to: string; pause: number }): void; testPrefix: string }) {
  return (
    <>
      <label className="times-time">
        <span>von</span>
        <input type="time" step={900} value={from} disabled={disabled} onChange={(e) => onChange({ from: e.target.value, to, pause })} data-testid={`${testPrefix}-from`} />
      </label>
      <label className="times-time">
        <span>bis</span>
        <input type="time" step={900} value={to} disabled={disabled} onChange={(e) => onChange({ from, to: e.target.value, pause })} data-testid={`${testPrefix}-to`} />
      </label>
      <label className="times-time">
        <span>Pause</span>
        <select value={String(pause)} disabled={disabled} onChange={(e) => onChange({ from, to, pause: Number(e.target.value) })} data-testid={`${testPrefix}-pause`}>
          {[...new Set([...PAUSES, pause])].sort((a, b) => a - b).map((p) => (
            <option key={p} value={String(p)}>
              {fmtPause(p)}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

/** eine Zeile in „Tag erfassen“: Baustelle, von, bis, Pause → Stunden, Wegzeit; Vorschlag grau bis bestätigt */
function DayRow({ w, date, rec, sugg, data, by, locked, onSaved }: { w: Worker; date: string; rec: TimeDay | null; sugg: ReturnType<typeof suggestionFor>; data: TimesData; by: string; locked: boolean; onSaved(): void }) {
  const base = rec ? rec.lines : sugg.lines;
  const multi = base.length > 1;
  const first = base[0] ?? null;
  const fallback = defaultTimes(data.times, date, data.defaults[w.id]);
  const [site, setSite] = useState<{ projectId: string | null; siteName: string } | null>(first ? { projectId: first.projectId, siteName: first.siteName } : null);
  const [t, setT] = useState({ from: first?.from ?? fallback?.from ?? '', to: first?.to ?? fallback?.to ?? '', pause: first?.from ? (first.pause ?? 0) : (fallback?.pause ?? 0) });
  const [travel, setTravel] = useState(first?.travel ? fmtH(first.travel) : '');
  const approved = data.approvals.some((a) => a.id === monthId(w.id, data.month));
  const hours = validTime(t.from) && validTime(t.to) ? hoursOf(t.from, t.to, t.pause) : (first?.hours ?? 0);
  const save = (next: { site?: typeof site; t?: typeof t; travel?: string } = {}) => {
    const s = next.site !== undefined ? next.site : site;
    const tt = next.t ?? t;
    const tr = parseHours(next.travel ?? travel);
    if (!s || !validTime(tt.from) || !validTime(tt.to)) return;
    void saveDay(w.id, date, [{ projectId: s.projectId, siteName: s.siteName, from: tt.from, to: tt.to, pause: tt.pause, hours: 0, ...(tr ? { travel: tr } : {}) }], by, { prev: rec ?? undefined, approved, remember: true })
      .then(onSaved)
      .catch((e) => showError(e, 'Speichern fehlgeschlagen'));
  };
  const absent = sugg.absence ? (sugg.absence === 'urlaub' ? 'Urlaub' : 'Krank') : null;
  return (
    <li className={`times-day-row${rec ? ' done' : ' suggested'}${multi ? ' multi' : ''}`} data-testid="times-day-row" data-name={workerName(w)} data-state={rec ? 'done' : 'suggested'}>
      <span className="times-day-name">
        <strong>{workerName(w)}</strong>
        {absent && !rec && <span className="times-badge">{absent}</span>}
        {rec ? <span className="times-badge ok">erfasst</span> : first ? <span className="times-badge">Vorschlag</span> : null}
      </span>
      {multi ? (
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
          <span className="times-hours" data-testid="times-hours">
            {fmtH(hours)} h
          </span>
          <label className="times-num travel">
            <input inputMode="decimal" value={travel} disabled={locked} onChange={(e) => setTravel(e.target.value)} onBlur={() => travel !== (first?.travel ? fmtH(first.travel) : '') && save()} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} placeholder="Weg" aria-label={`Wegzeit ${workerName(w)}`} data-testid="times-travel" />
          </label>
        </>
      )}
      {!rec && !locked && first && (
        <button type="button" className="btn btn-sm times-take" onClick={() => void saveDay(w.id, date, sugg.lines, by).then(onSaved)} data-testid="times-take" title="Vorschlag übernehmen">
          <Icon name="check" size={16} />
        </button>
      )}
    </li>
  );
}
