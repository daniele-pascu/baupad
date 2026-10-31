import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ActionMenu, type MenuAction } from '../components/ActionMenu';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { SiteNav } from '../components/SiteNav';
import { ToolIcon } from '../components/ToolIcon';
import { useChipDrag, type DropTarget } from '../components/useChipDrag';
import { PdfPreview } from '../components/PdfPreview';
import { confirmDialog, offerFile, showError, toast } from '../components/ui';
import {
  addDays,
  addSite,
  assign,
  carryOver,
  DAY_NAMES,
  DAY_SHORT,
  dayDate,
  dayList,
  DEFAULT_WORK_TIMES,
  emptyWeek,
  isoWeekNo,
  carryPlacement,
  pauseSite,
  placeWorker,
  workerSites,
  removeSite,
  sameSite,
  isoDate,
  siteFromProject,
  sitesOf,
  sortByGrade,
  timeLabel,
  unassign,
  unassigned,
  updateSite,
  vacationSummary,
  visibleDays,
  weekOf,
  weekRange,
  workerName,
  WORKER_GRADES,
  gradeLabel,
  gradeRank,
} from '../lib/crew';
import { getMeta, getWeek, listProjects, listWeeks, listWorkers, previousWeek, saveWeek, setMeta } from '../lib/db';
import type { ExportFile } from '../lib/aufmass';
import { getCompanyLogo } from '../lib/company';
import { absenceOn, absenceRange, absenceSummary } from '../lib/crew-absence';
import { exportCrewBackup, importCrewBackup } from '../lib/crew-backup';
import { linkSitesToProject, projectFromSite } from '../lib/crew-link';
import { useCanCreateProjects, useProjectIn } from '../lib/sites';
import { crewDayPdf, crewWeekPdf } from '../lib/crew-pdf';
import { uuid } from '../lib/ids';
import { navigate, paths } from '../lib/router';
import type { Absence, Project, WeekPlan, WeekSite, Worker, WorkTimes } from '../lib/types';
import { usePageTitle } from '../lib/page-title';

const WEEKDAYS = [0, 1, 2, 3, 4];
const ACCENT = { '--tool': '#2f80ed' } as CSSProperties;

/**
 * Arbeitereinteilung: Wochenplanung nach Baustellen (Baustelle → Tag → Arbeiter). Jede Woche ist ein
 * eigener Datensatz; eine neue Woche läuft mit den Baustellen und Arbeitern der Vorwoche weiter.
 */
export function WorkersPage() {
  usePageTitle('Arbeitereinteilung – BauPad');
  const [workers, setWorkers] = useState<Worker[] | null>(null);
  const [times, setTimes] = useState<WorkTimes | null | undefined>(undefined);
  const [projects, setProjects] = useState<Project[]>([]);
  const [weekId, setWeekId] = useState(() => weekOf(new Date()));
  const [plan, setPlan] = useState<WeekPlan | null>(null);
  /** nicht gespeicherte Woche: aus dieser Woche weitergeführt (bzw. leer) */
  const [draftFrom, setDraftFrom] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  /** „Noch nicht eingeteilt“: klein (nur Zusammenfassung), antippen zeigt die Namen je Tag */
  const [showOpen, setShowOpen] = useState(false);
  const [company, setCompany] = useState('');
  /** Uhrzeiten im PDF anzeigen (manchmal nicht nötig) */
  const [pdfTimes, setPdfTimes] = useState(true);
  /** Urlaub / Krank von–bis (über Wochen hinweg) */
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState<ExportFile | null>(null);
  const restoreRef = useRef<HTMLInputElement>(null);
  const [reloadKey, setReloadKey] = useState(0);
  /** Namen ziehen: ab dem Ziel-Tag auf die Ziel-Baustelle (von der bisherigen automatisch entfernt) */
  const dropRef = useRef<(workerId: string, fromSiteId: string | null, fromDay: number, to: DropTarget) => void>(() => {});
  const { drag, start: startDrag, suppressClick } = useChipDrag((...a) => dropRef.current(...a));
  const [dialog, setDialog] = useState<
    | { kind: 'times' }
    | { kind: 'site'; site?: WeekSite }
    | { kind: 'assign'; siteId: string; days: number[] }
    | { kind: 'chip'; siteId: string; day: number; workerId: string }
    | { kind: 'open'; day: number; workerId: string }
    | { kind: 'dayList'; siteId: string }
    | { kind: 'absence'; workerId?: string; day?: number }
    | null
  >(null);

  useEffect(() => {
    void Promise.all([listWorkers(), getMeta<WorkTimes>('workTimes'), listProjects(), getMeta<string>('companyName'), getMeta<boolean>('pdfShowTimes')])
      .then(([w, t, p, c, pt]) => {
        setPdfTimes(pt !== false);
        setWorkers(w);
        setTimes(t ?? null);
        setProjects(p);
        setCompany(c ?? '');
      })
      .catch((e) => showError(e, 'Arbeitereinteilung konnte nicht geladen werden'));
  }, []);

  useEffect(() => {
    let off = false;
    setPlan(null);
    void (async () => {
      const [saved, abs] = await Promise.all([getWeek(weekId), getMeta<Absence[]>('absences')]);
      if (off) return;
      setAbsences(abs ?? []);
      if (saved) {
        setPlan(saved);
        setDraftFrom(null);
        return;
      }
      const prev = await previousWeek(weekId);
      if (off) return;
      setPlan(prev ? carryOver(prev, weekId) : emptyWeek(weekId));
      setDraftFrom(prev ? prev.id : '');
    })().catch((e) => showError(e, 'Woche konnte nicht geladen werden'));
    return () => {
      off = true;
    };
  }, [weekId, reloadKey]);

  const byId = useMemo(() => new Map((workers ?? []).map((w) => [w.id, w])), [workers]);
  const active = useMemo(() => sortByGrade((workers ?? []).filter((w) => w.active)), [workers]);
  const workTimes = times ?? DEFAULT_WORK_TIMES;
  const nameOf = (id: string) => (byId.get(id) ? workerName(byId.get(id)!) : 'Unbekannt');

  /** Woche speichern (jede Änderung sofort, nur diese Woche) */
  const save = (next: WeekPlan) => {
    setPlan(next);
    setDraftFrom(null);
    saveWeek(next).catch((e) => showError(e, 'Speichern fehlgeschlagen'));
  };


  /**
   * Arbeiter an den Tagen `ds` auf eine Baustelle setzen – von anderen Baustellen werden sie an diesen Tagen
   * automatisch entfernt. Bereits geplante Folgewochen auf Wunsch ebenfalls („für die Zukunft“).
   */
  const place = async (ids: string[], siteId: string, ds: number[], overrideVacation: boolean, keep = false) => {
    let next = plan!;
    const moved: string[] = [];
    if (keep) {
      // doppelt einteilen: zusätzlich hier, auf der bisherigen Baustelle bleiben (nur diese Woche)
      next = assign(next, siteId, ds, ids);
      save(next);
      const target = next.sites.find((x) => x.id === siteId)!;
      const twice = ids.filter((id) => ds.some((d) => sitesOf(next, id, d, siteId).length));
      if (twice.length) toast(`Doppelt eingeteilt auf ${target.name}: ${twice.map(nameOf).join(', ')} – bleibt auch auf der bisherigen Baustelle.`, 'success', 4500);
      return;
    }
    for (const id of ids) {
      const r = placeWorker(next, id, siteId, ds, overrideVacation);
      next = r.week;
      if (r.from.length) moved.push(`${nameOf(id)} (von ${r.from.join(', ')})`);
    }
    save(next);
    const target = next.sites.find((x) => x.id === siteId)!;
    if (moved.length) toast(`Umgesetzt auf ${target.name}: ${moved.join(', ')}.`, 'success', 4500);
    // bereits gespeicherte Folgewochen: dort ebenfalls umsetzen, bis der Arbeiter wieder anders eingeteilt ist
    const later = (await listWeeks()).filter((w) => w.id > weekId).sort((a, b) => a.id.localeCompare(b.id));
    const all = WEEKDAYS;
    const changed = new Map<string, WeekPlan>();
    for (const id of ids) {
      const prev = workerSites(plan!, id, ds);
      const weeks = later.map((w) => changed.get(w.id) ?? w);
      for (const w of carryPlacement(weeks, id, prev, target, all)) changed.set(w.id, w);
    }
    for (const w of changed.values()) await saveWeek(w);
    if (changed.size) toast(`Auch übernommen in ${[...changed.keys()].sort().map((k) => `KW ${isoWeekNo(k)}`).join(', ')}.`, 'success');
  };

  /** Urlaub/Krank von–bis speichern (die Wochen selbst bleiben unverändert) */
  const saveAbsences = async (list: Absence[]) => {
    await setMeta('absences', list);
    setAbsences(list);
  };
  const addAbsence = async (a: Absence) => {
    await saveAbsences([...absences, a]);
    toast(`${a.kind === 'urlaub' ? 'Urlaub' : 'Krank'} eingetragen: ${nameOf(a.workerId)}, ${absenceRange(a)}`, 'success');
  };
  const deleteAbsence = async (a: Absence) => {
    await saveAbsences(absences.filter((x) => x.id !== a.id));
    toast(`${a.kind === 'urlaub' ? 'Urlaub' : 'Krankmeldung'} gelöscht.`, 'success');
  };

  /** Baustelle pausieren (Standby): Arbeiter werden frei; gilt auch für bereits geplante Folgewochen */
  const pause = async (site: WeekSite) => {
    const later = (await listWeeks()).filter((w) => w.id > weekId && sameSite(w, site) && !sameSite(w, site)!.paused);
    const freed = [...new Set(site.days.flat())];
    const ok = await confirmDialog({
      title: 'Baustelle pausieren?',
      message: (
        <>
          <p>„{site.name}“ ruht ab dieser Woche (Standby) und läuft ohne Arbeiter weiter, bis du sie fortsetzt.</p>
          {freed.length > 0 && <p>Frei werden: {freed.map(nameOf).join(', ')} – sie erscheinen unter „Nicht eingeteilt“.</p>}
          {later.length > 0 && <p>Gilt auch für die bereits geplanten Wochen {later.map((w) => `KW ${isoWeekNo(w.id)}`).join(', ')}.</p>}
        </>
      ),
      confirmLabel: 'Pausieren',
    });
    if (!ok) return;
    save(pauseSite(plan!, site.id).week);
    for (const w of later) await saveWeek(pauseSite(w, sameSite(w, site)!.id).week);
    toast(`„${site.name}“ pausiert.`, 'success');
  };
  /** pausierte Baustelle wieder aufnehmen (auch in bereits geplanten Folgewochen) */
  const resume = async (site: WeekSite) => {
    save(updateSite(plan!, site.id, { paused: false }));
    for (const w of await listWeeks()) {
      const t = w.id > weekId ? sameSite(w, site) : undefined;
      if (t?.paused) await saveWeek(updateSite(w, t.id, { paused: false }));
    }
    setCollapsed((prev) => new Set([...prev].filter((id) => id !== site.id)));
    toast(`„${site.name}“ läuft wieder – jetzt Arbeiter einteilen.`, 'success');
  };

  /**
   * „ab diesem Tag“: unter der Woche bis Freitag – plus Sa/So, an denen die Arbeiter schon eingeteilt sind
   * (die werden mit umgesetzt); ab Samstag bis Sonntag.
   */
  const restOfWeek = (day: number, ids: string[] = []) =>
    [0, 1, 2, 3, 4, 5, 6].filter((d) => d >= day && (d < 5 || day >= 5 || ids.some((id) => plan!.sites.some((s) => s.days[d].includes(id)))));

  dropRef.current = (workerId, fromSiteId, fromDay, to) => {
    if (fromSiteId === to.siteId && fromDay === to.day) return;
    const ds = restOfWeek(to.day, [workerId]);
    void run(() => place([workerId], to.siteId, ds, false));
  };

  /** PDF-Optionen: Firmenname und Firmenlogo (Konto → Einstellungen) */
  const pdfOpts = async () => ({ company, logo: await getCompanyLogo(), absent: (id: string, d: number) => absenceOn(absences, id, weekId, d), showTimes: pdfTimes });
  const run = (fn: () => Promise<void>) => fn().catch((e) => showError(e, 'Das hat nicht geklappt'));

  const exportWeekPdf = () =>
    run(async () => {
      setPreview(await crewWeekPdf(plan!, workers!, workTimes, await pdfOpts()));
    });
  /** Drucken: PDF in einem neuen Tab öffnen (Fenster sofort öffnen, sonst blockiert der Browser) */
  const printWeek = () => {
    const win = window.open('', '_blank');
    run(async () => {
      const f = await crewWeekPdf(plan!, workers!, workTimes, await pdfOpts());
      const url = URL.createObjectURL(new Blob([f.data as BlobPart], { type: 'application/pdf' }));
      if (win) win.location.href = url;
      else setPreview(f);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    });
  };
  const carryAgain = () =>
    run(async () => {
      const prev = await previousWeek(weekId);
      if (!prev) {
        toast('Keine frühere Woche gespeichert.', 'info');
        return;
      }
      const has = plan!.sites.some((s) => s.days.some((d) => d.length));
      if (
        has &&
        !(await confirmDialog({
          title: `Einteilung aus KW ${isoWeekNo(prev.id)} übernehmen?`,
          message: <p>Diese Woche hat schon eine Einteilung. Sie wird durch die Baustellen und Arbeiter aus KW {isoWeekNo(prev.id)} ersetzt. Andere Wochen bleiben unverändert.</p>,
          confirmLabel: 'Ersetzen',
          danger: true,
        }))
      )
        return;
      save({ ...carryOver(prev, weekId), createdAt: plan!.createdAt });
      toast(`Einteilung aus KW ${isoWeekNo(prev.id)} übernommen.`, 'success');
    });
  const backup = () => run(async () => offerFile(await exportCrewBackup()));
  /** Baustelle ohne Projekt als Projekt anlegen und in allen Wochen verknüpfen */
  const siteToProject = (s: WeekSite) =>
    run(async () => {
      const p = await projectFromSite(s, 'workers');
      await linkSitesToProject(s.name, p.id);
      setProjects((list) => [p, ...list]);
      // aktuelle Woche ebenfalls verknüpfen (auch wenn sie noch nicht gespeichert war)
      save({ ...plan!, sites: plan!.sites.map((x) => (!x.projectId && x.name.trim().toLowerCase() === s.name.trim().toLowerCase() ? { ...x, projectId: p.id } : x)), updatedAt: Date.now() });
      toast(`Projekt „${p.name}“ in Aufmaß & Abrechnung angelegt.`, 'success');
    });
  const restore = (f: File) =>
    run(async () => {
      const r = await importCrewBackup(f);
      setWorkers(await listWorkers());
      setTimes((await getMeta<WorkTimes>('workTimes')) ?? null);
      setCompany((await getMeta<string>('companyName')) ?? '');
      setReloadKey((k) => k + 1);
      toast(`Sicherung eingelesen: ${r.workers} Arbeiter, ${r.weeks} Wochen übernommen.`, 'success', 5000);
    });

  if (!workers || times === undefined || !plan)
    return (
      <>
        <SiteNav />
        <div className="page loading">Arbeitereinteilung wird geladen …</div>
      </>
    );

  const days = visibleDays();
  /** Werktage Mo–Fr: Vorschlag für „ganze Woche“ und Prüfung „noch nicht eingeteilt“ (Sa/So jederzeit möglich) */
  const workDays = WEEKDAYS;
  // Urlaub/Krank (von–bis) gilt nicht als „noch nicht eingeteilt“
  const open = workDays
    .map((d) => ({ d, list: unassigned(plan, sortByGrade(workers), d).filter((w) => !absenceOn(absences, w.id, weekId, d)) }))
    .filter((x) => x.list.length);
  const vacations = vacationSummary(plan, days);
  // Urlaub: Tage aus der Woche selbst und aus den Zeiträumen (von–bis)
  const vacRanges = absenceSummary(absences, weekId, days, 'urlaub');
  for (const r of vacRanges) {
    const v = vacations.find((x) => x.workerId === r.workerId);
    if (v) v.days = [...new Set([...v.days, ...r.days])].sort();
    else vacations.push(r);
  }
  const sickWeek = absenceSummary(absences, weekId, days, 'krank');
  const q = query.trim().toLowerCase();
  const hit = (id: string) => !!q && nameOf(id).toLowerCase().includes(q);
  const shown = q
    ? plan.sites.filter((s) => [s.name, s.number, s.address].some((t) => t?.toLowerCase().includes(q)) || s.days.some((d) => d.some(hit)))
    : plan.sites;
  const pausedShown = shown.filter((s) => s.paused);
  /** Menü einer Baustelle (laufend oder pausiert) */
  const siteActions = (s: WeekSite): MenuAction[] => [
      ...(s.paused ? [] : [{ label: 'Arbeiter einteilen (ganze Woche)', icon: 'plus', onSelect: () => setDialog({ kind: 'assign', siteId: s.id, days: workDays }), testId: 'site-assign' }]),
      { label: 'Baustelle bearbeiten / Bemerkung', icon: 'edit', onSelect: () => setDialog({ kind: 'site', site: s }), testId: 'site-edit' },
      ...(s.paused ? [] : [{ label: 'Tagesliste (PDF)', icon: 'pdf', onSelect: () => setDialog({ kind: 'dayList', siteId: s.id }), testId: 'site-daylist' }]),
      ...(s.projectId && projects.some((p) => p.id === s.projectId)
        ? [{ label: 'Projekt öffnen', icon: 'folder', onSelect: () => navigate(paths.project(s.projectId!)), testId: 'site-open-project' }]
        : [{ label: 'Als Projekt in Aufmaß & Abrechnung anlegen', icon: 'folder', onSelect: () => void siteToProject(s), testId: 'site-to-project' }]),
      s.paused
        ? { label: 'Fortsetzen', icon: 'play', onSelect: () => void run(() => resume(s)), testId: 'site-resume-menu' }
        : { label: 'Pausieren (Standby)', icon: 'pause', onSelect: () => void run(() => pause(s)), testId: 'site-pause' },
      {
        label: s.finished ? 'Wieder öffnen (läuft weiter)' : 'Abschließen (ab nächster Woche weg)',
        icon: 'check',
        onSelect: () => save(updateSite(plan, s.id, { finished: !s.finished, paused: false })),
        testId: 'site-finish',
      },
      {
        label: 'Aus dieser Woche entfernen',
        icon: 'trash',
        danger: true,
        onSelect: () =>
          void confirmDialog({
            title: 'Baustelle entfernen?',
            message: <p>„{s.name}“ und ihre Einteilung werden aus dieser Woche entfernt. Andere Wochen bleiben unverändert.</p>,
            confirmLabel: 'Entfernen',
            danger: true,
          }).then((ok) => ok && save(removeSite(plan, s.id))),
        testId: 'site-remove',
      },
  ];
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <>
      <SiteNav />
      <div className="page crew-page">
        <header className="page-head page-head-row">
          <div className="page-head-title">
            <a href={paths.tools()} className="icon-link" aria-label="Zu den Tools" title="Zu den Tools" data-testid="to-tools">
              <Icon name="back" />
            </a>
            <h1 data-testid="workers-title">Arbeitereinteilung</h1>
          </div>
        </header>

        <div className="crew-actions">
          <a href={paths.staff()} className="btn" data-testid="crew-workers">
            <ToolIcon name="workers" size={18} /> Personal ({active.length})
          </a>
          <button type="button" className="btn" onClick={() => setDialog({ kind: 'times' })} data-testid="crew-times">
            <Icon name="calendar" size={18} /> Arbeitszeit
          </button>
          <button type="button" className="btn" onClick={exportWeekPdf} disabled={!plan.sites.length} data-testid="crew-pdf">
            <Icon name="pdf" size={18} /> PDF
          </button>
          <ActionMenu
            label="Weitere Aktionen"
            testId="crew-more"
            actions={[
              { label: 'Drucken', icon: 'pdf', onSelect: printWeek, disabled: !plan.sites.length, testId: 'crew-print' },
              { label: 'Urlaub / Krank eintragen', icon: 'calendar', onSelect: () => setDialog({ kind: 'absence' }), testId: 'crew-absence' },
              { label: 'Einteilung aus Vorwoche übernehmen', icon: 'copy', onSelect: () => void carryAgain(), testId: 'crew-carry' },
              { label: 'Sicherung speichern (Arbeiter und Wochen)', icon: 'download', onSelect: () => void backup(), testId: 'crew-backup' },
              { label: 'Sicherung öffnen …', icon: 'upload', onSelect: () => restoreRef.current?.click(), testId: 'crew-restore' },
            ]}
          />
          <input
            ref={restoreRef}
            type="file"
            accept=".json,application/json"
            hidden
            data-testid="crew-restore-input"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void restore(f);
            }}
          />
        </div>

        {active.length === 0 && (
          <div className="crew-setup" style={ACCENT} data-testid="crew-setup-workers">
            <span className="tile-icon">
              <ToolIcon name="workers" size={22} />
            </span>
            <div>
              <strong>Personal anlegen</strong>
              <p className="muted small">Die Personalliste wird einmal angelegt und jede Woche wiederverwendet.</p>
            </div>
            <a href={paths.staff()} className="btn btn-primary">
              Anlegen
            </a>
          </div>
        )}

        <div className="crew-week" data-testid="crew-week">
          <button type="button" className="icon-btn" onClick={() => setWeekId(addDays(weekId, -7))} aria-label="Vorige Woche" data-testid="week-prev">
            <Icon name="back" />
          </button>
          <div className="crew-week-label">
            <strong data-testid="week-label">KW {isoWeekNo(weekId)}</strong>
            <span className="muted">{weekRange(weekId, 6)}</span>
          </div>
          <button type="button" className="icon-btn" onClick={() => setWeekId(addDays(weekId, 7))} aria-label="Nächste Woche" data-testid="week-next">
            <Icon name="next" />
          </button>
          <label className="crew-date" title="Datum wählen">
            <span className="sr-only">Datum wählen</span>
            <input type="date" value={weekId} onChange={(e) => e.target.value && setWeekId(weekOf(e.target.value))} data-testid="week-date" />
          </label>
          {weekId !== weekOf(new Date()) && (
            <button type="button" className="btn btn-sm" onClick={() => setWeekId(weekOf(new Date()))} data-testid="week-today">
              Diese Woche
            </button>
          )}
        </div>

        {draftFrom !== null && plan.sites.length > 0 && (
          <div className="banner banner-info" role="status" data-testid="draft-banner">
            <p>
              Weitergeführt aus <strong>KW {isoWeekNo(draftFrom)}</strong>: gleiche Baustellen und Arbeiter. Änderungen gelten nur für diese Woche – die Vorwoche bleibt
              unverändert.
            </p>
            <button type="button" className="btn btn-sm" onClick={() => save({ ...plan, updatedAt: Date.now() })} data-testid="draft-save">
              So übernehmen
            </button>
          </div>
        )}

        {open.length > 0 ? (
          <section className={`crew-open${showOpen ? ' expanded' : ''}`} data-testid="crew-open">
            <button type="button" className="crew-open-toggle" onClick={() => setShowOpen(!showOpen)} aria-expanded={showOpen} data-testid="crew-open-toggle">
              <Icon name="info" size={16} />
              <span>
                Noch nicht eingeteilt: <strong>{new Set(open.flatMap((o) => o.list.map((w) => w.id))).size}</strong> ({open.map((o) => DAY_SHORT[o.d]).join(', ')})
              </span>
              <Icon name="next" size={16} className={`crew-open-chevron${showOpen ? ' open' : ''}`} />
            </button>
            {showOpen && open.map(({ d, list }) => (
              <div key={d} className="crew-open-row" data-day={d}>
                <span className="crew-open-day">{DAY_SHORT[d]}</span>
                <span className="crew-chips">
                  {list.map((w) => (
                    <button
                      key={w.id}
                      type="button"
                      className={`crew-chip open${drag?.workerId === w.id ? ' dragging' : ''}`}
                      onPointerDown={(e) => startDrag(e, w.id, workerName(w), null, d)}
                      onContextMenu={(e) => e.preventDefault()}
                      onClick={() => !suppressClick.current && setDialog({ kind: 'open', day: d, workerId: w.id })}
                      data-testid="open-chip"
                    >
                      {workerName(w)}
                    </button>
                  ))}
                </span>
              </div>
            ))}
          </section>
        ) : (
          plan.sites.length > 0 &&
          active.length > 0 && (
            <p className="crew-all-set" data-testid="crew-all-set">
              <Icon name="check" size={18} /> Alle Arbeiter sind eingeteilt.
            </p>
          )
        )}
        {vacations.length > 0 && (
          <p className="crew-vacations" data-testid="crew-vacations">
            <strong>Urlaub:</strong>
            {vacations.map((v) => (
              <button key={v.workerId} type="button" className="crew-chip vacation" onClick={() => setDialog({ kind: 'absence', workerId: v.workerId })} data-testid="vacation-chip">
                {nameOf(v.workerId)} · {dayList(v.days)}
              </button>
            ))}
          </p>
        )}
        {sickWeek.length > 0 && (
          <p className="crew-vacations" data-testid="crew-sick">
            <strong>Krank:</strong>
            {sickWeek.map((v) => (
              <button key={v.workerId} type="button" className="crew-chip sick" onClick={() => setDialog({ kind: 'absence', workerId: v.workerId })} data-testid="sick-chip">
                {nameOf(v.workerId)} · {dayList(v.days)}
              </button>
            ))}
          </p>
        )}

        {plan.sites.length > 0 && active.length > 0 && (
          <p className="muted small crew-drag-hint" data-testid="crew-drag-hint">
            Tipp: Namen auf eine andere Baustelle ziehen (am Handy kurz gedrückt halten) – ab diesem Tag dort, auf der bisherigen automatisch entfernt.
          </p>
        )}
        {drag && (
          <div className="crew-ghost" style={{ left: drag.x - drag.dx, top: drag.y - drag.dy - (drag.touch ? 48 : 0) }} aria-hidden="true" data-testid="crew-ghost">
            {drag.label}
            {drag.over && <small> → {plan.sites.find((x) => x.id === drag.over!.siteId)?.name} ab {DAY_SHORT[drag.over.day]}</small>}
          </div>
        )}
        <section className="crew-sites">
          {plan.sites.length > 1 && (
            <label className="crew-search">
              <Icon name="select" size={18} />
              <span className="sr-only">Suchen</span>
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Baustelle oder Arbeiter suchen" data-testid="crew-search" />
              {q && (
                <span className="muted small" data-testid="crew-search-count">
                  {shown.length} von {plan.sites.length}
                </span>
              )}
            </label>
          )}
          {shown.filter((s) => !s.paused).map((s) => {
            const isOpen = !collapsed.has(s.id);
            const count = new Set(s.days.flat()).size;
            return (
              <article key={s.id} className={`crew-site${s.finished ? ' finished' : ''}`} data-testid="site-card" data-site={s.name}>
                <header className="crew-site-head">
                  <button type="button" className="crew-site-toggle" aria-expanded={isOpen} onClick={() => toggle(s.id)} data-testid="site-toggle">
                    <Icon name="next" size={18} />
                    <span className="crew-site-title">
                      <strong data-testid="site-name">{s.name}</strong>
                      <span className="muted small">
                        {[s.number, s.address].filter(Boolean).join(' · ')}
                        {s.finished && <span className="crew-finished"> · abgeschlossen</span>}
                      </span>
                    </span>
                    <span className="crew-count" title="Arbeiter in dieser Woche">
                      {count}
                    </span>
                  </button>
                  <ActionMenu
                    label={`Aktionen für ${s.name}`}
                    testId="site-actions"
                    actions={siteActions(s)}
                  />
                </header>
                {isOpen && s.note && (
                  <p className="crew-note" data-testid="site-note">
                    {s.note}
                  </p>
                )}
                {isOpen && (
                  <div className="crew-days">
                    {days.map((d) => (
                      <div
                        key={d}
                        className={`crew-day${d >= 5 ? ' weekend' : ''}${drag?.over?.siteId === s.id && drag.over.day === d ? ' drop-over' : ''}`}
                        data-testid="day-row"
                        data-day={d}
                        data-drop-site={s.id}
                        data-drop-day={d}
                      >
                        <span className="crew-day-label">
                          <strong>
                            {DAY_SHORT[d]} {dayDate(weekId, d)}
                          </strong>
                          <span className="muted small">{timeLabel(workTimes[d])}</span>
                        </span>
                        <span className="crew-chips">
                          {s.days[d].map((id) => (
                            <button
                              key={id}
                              type="button"
                              className={`crew-chip${byId.get(id)?.active === false ? ' inactive' : ''}${sitesOf(plan, id, d, s.id).length ? ' conflict' : ''}${hit(id) ? ' hit' : ''}${drag?.workerId === id ? ' dragging' : ''}${absenceOn(absences, id, weekId, d) === 'krank' ? ' sick' : absenceOn(absences, id, weekId, d) ? ' away' : ''}`}
                              onPointerDown={(e) => startDrag(e, id, nameOf(id), s.id, d)}
                              onContextMenu={(e) => e.preventDefault()}
                              onClick={() => !suppressClick.current && setDialog({ kind: 'chip', siteId: s.id, day: d, workerId: id })}
                              data-testid="crew-chip"
                              data-worker={nameOf(id)}
                              title={sitesOf(plan, id, d, s.id).length ? `Auch eingeteilt auf: ${sitesOf(plan, id, d, s.id).map((x) => x.name).join(', ')}` : undefined}
                            >
                              {nameOf(id)}
                              {sitesOf(plan, id, d, s.id).length > 0 && (
                                <small className="crew-chip-also" data-testid="chip-also">
                                  + {sitesOf(plan, id, d, s.id).map((x) => x.name).join(', ')}
                                </small>
                              )}
                            </button>
                          ))}
                          <button type="button" className="crew-add" onClick={() => setDialog({ kind: 'assign', siteId: s.id, days: restOfWeek(d) })} aria-label={`Arbeiter für ${DAY_NAMES[d]} einteilen`} data-testid="day-add">
                            <Icon name="plus" size={16} />
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
          {pausedShown.length > 0 && (
            <div className="crew-paused" data-testid="crew-paused">
              <h2 className="crew-paused-title">
                Pausiert <span className="muted small">· Standby, ohne Arbeiter, läuft weiter bis „Fortsetzen“</span>
              </h2>
              {pausedShown.map((s) => (
                <article key={s.id} className="crew-site paused" data-testid="site-card" data-site={s.name}>
                  <header className="crew-site-head">
                    <span className="crew-site-toggle">
                      <Icon name="pause" size={18} />
                      <span className="crew-site-title">
                        <strong data-testid="site-name">{s.name}</strong>
                        <span className="muted small">{[s.number, s.address].filter(Boolean).join(' · ')}</span>
                      </span>
                    </span>
                    <button type="button" className="btn btn-sm" onClick={() => void run(() => resume(s))} data-testid="site-resume">
                      Fortsetzen
                    </button>
                    <ActionMenu label={`Aktionen für ${s.name}`} testId="site-actions" actions={siteActions(s)} />
                  </header>
                  {s.note && (
                    <p className="crew-note" data-testid="site-note">
                      {s.note}
                    </p>
                  )}
                </article>
              ))}
            </div>
          )}
          {plan.sites.length === 0 && (
            <div className="empty" data-testid="crew-empty">
              <p>Noch keine Baustelle in dieser Woche.</p>
              <p className="muted">Baustelle aus Aufmaß & Abrechnung wählen oder manuell anlegen, dann die Arbeiter je Tag einteilen.</p>
            </div>
          )}
          <button type="button" className="btn btn-primary crew-add-site" onClick={() => setDialog({ kind: 'site' })} data-testid="add-site">
            <Icon name="plus" /> Neues Projekt
          </button>
        </section>
      </div>

      {dialog?.kind === 'times' && (
        <TimesDialog
          times={workTimes}
          company={company}
          pdfTimes={pdfTimes}
          onClose={() => setDialog(null)}
          onSave={(t, c, pt) => {
            setTimes(t);
            setCompany(c);
            setPdfTimes(pt);
            setDialog(null);
            setMeta('workTimes', t).catch((e) => showError(e));
            setMeta('companyName', c).catch((e) => showError(e));
            setMeta('pdfShowTimes', pt).catch((e) => showError(e));
            toast('Arbeitszeit gespeichert.', 'success');
          }}
        />
      )}
      {dialog?.kind === 'site' && (
        <SiteDialog
          site={dialog.site}
          projects={projects}
          taken={plan.sites.map((s) => s.projectId).filter(Boolean) as string[]}
          onClose={() => setDialog(null)}
          onSave={(fields, alsoProject) =>
            void run(async () => {
              let f = fields;
              if (alsoProject) {
                const p = await projectFromSite(fields, 'workers');
                setProjects((list) => [p, ...list]);
                f = { ...fields, projectId: p.id };
                toast(`Projekt „${p.name}“ in Aufmaß & Abrechnung angelegt.`, 'success');
              }
              await useProjectIn(f.projectId, 'workers');
              if (dialog.site) save(updateSite(plan, dialog.site.id, f));
              else {
                save(addSite(plan, f).week);
                toast(`Baustelle „${f.name}“ angelegt.`, 'success');
              }
              setDialog(null);
            })
          }
        />
      )}
      {dialog?.kind === 'assign' && (
        <AssignDialog
          plan={plan}
          site={plan.sites.find((s) => s.id === dialog.siteId)!}
          days={days}
          initialDays={dialog.days}
          workers={active}
          onClose={() => setDialog(null)}
          onSave={(ids, ds, keep) => {
            setDialog(null);
            void run(() => place(ids, dialog.siteId, ds, true, keep));
          }}
        />
      )}
      {dialog?.kind === 'chip' && (
        <ChipDialog
          plan={plan}
          name={nameOf(dialog.workerId)}
          workerId={dialog.workerId}
          siteId={dialog.siteId}
          day={dialog.day}
          onClose={() => setDialog(null)}
          onRemove={() => {
            save(unassign(plan, dialog.siteId, dialog.day, dialog.workerId));
            setDialog(null);
          }}
          onMove={(to) => {
            setDialog(null);
            void run(() => place([dialog.workerId], to, restOfWeek(dialog.day, [dialog.workerId]), false));
          }}
          onAbsence={() => setDialog({ kind: 'absence', workerId: dialog.workerId, day: dialog.day })}
        />
      )}
      {dialog?.kind === 'dayList' && (
        <DayListDialog
          days={days}
          site={plan.sites.find((s) => s.id === dialog.siteId)!}
          weekId={weekId}
          onClose={() => setDialog(null)}
          onPick={(d) =>
            void run(async () => {
              const f = await crewDayPdf(plan, dialog.siteId, d, workers, workTimes, await pdfOpts());
              setDialog(null);
              setPreview(f);
            })
          }
        />
      )}
      {dialog?.kind === 'absence' && (
        <AbsenceDialog
          workers={active}
          absences={absences}
          nameOf={nameOf}
          workerId={dialog.workerId}
          from={addDays(weekId, dialog.day ?? 0)}
          to={addDays(weekId, (dialog.day ?? 0) >= 5 ? 6 : 4)}
          onAdd={(a) => void run(() => addAbsence(a))}
          onDelete={(a) => void run(() => deleteAbsence(a))}
          onClose={() => setDialog(null)}
        />
      )}
      {preview && <PdfPreview file={preview} onBack={() => setPreview(null)} onClose={() => setPreview(null)} />}
      {dialog?.kind === 'open' && (
        <OpenDialog
          plan={plan}
          worker={byId.get(dialog.workerId)!}
          day={dialog.day}
          onClose={() => setDialog(null)}
          onAssign={(siteId, rest) => {
            setDialog(null);
            void run(() => place([dialog.workerId], siteId, rest ? restOfWeek(dialog.day, [dialog.workerId]) : [dialog.day], false));
          }}
          onAbsence={() => setDialog({ kind: 'absence', workerId: dialog.workerId, day: dialog.day })}
        />
      )}
    </>
  );
}

/** Arbeiterliste: anlegen, bearbeiten, aktiv/inaktiv */
function TimesDialog({
  times,
  company,
  pdfTimes,
  onSave,
  onClose,
}: {
  times: WorkTimes;
  company: string;
  pdfTimes: boolean;
  onSave(t: WorkTimes, company: string, pdfTimes: boolean): void;
  onClose(): void;
}) {
  const [t, setT] = useState<WorkTimes>(() => times.map((x) => (x ? { ...x } : null)));
  const [c, setC] = useState(company);
  const [pt, setPt] = useState(pdfTimes);
  const set = (d: number, x: WorkTimes[number]) => setT(t.map((y, i) => (i === d ? x : y)));
  return (
    <Modal
      title="Arbeitszeit der Firma"
      onClose={onClose}
      testId="times-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onSave(t, c.trim(), pt)} data-testid="times-save">
            Speichern
          </button>
        </>
      }
    >
      <p className="muted small">Nur zur Info der Firma: erscheint in der Einteilung und – wenn angehakt – im PDF. Eingeteilt werden kann an allen 7 Tagen, auch Sa/So.</p>
      <div className="crew-times">
        {DAY_NAMES.map((name, d) => (
          <div key={d} className="crew-time-row">
            <label className="check-row">
              <input type="checkbox" checked={!!t[d]} onChange={(e) => set(d, e.target.checked ? { from: '07:00', to: d === 4 ? '12:00' : '16:00' } : null)} data-testid={`time-day-${d}`} />
              {name}
            </label>
            {t[d] ? (
              <span className="crew-time-inputs">
                <input type="time" value={t[d]!.from} onChange={(e) => set(d, { ...t[d]!, from: e.target.value })} aria-label={`${name} von`} data-testid={`time-from-${d}`} />
                <span>–</span>
                <input type="time" value={t[d]!.to} onChange={(e) => set(d, { ...t[d]!, to: e.target.value })} aria-label={`${name} bis`} data-testid={`time-to-${d}`} />
              </span>
            ) : (
              <span className="muted small">frei</span>
            )}
          </div>
        ))}
      </div>
      <label className="check-row crew-pdf-times">
        <input type="checkbox" checked={pt} onChange={(e) => setPt(e.target.checked)} data-testid="times-pdf" />
        Uhrzeiten im PDF anzeigen
      </label>
      <label className="field crew-company">
        <span>Firmenname im PDF (oben links, falls kein Firmenlogo hinterlegt ist)</span>
        <input value={c} onChange={(e) => setC(e.target.value)} placeholder="z. B. Muster Bau GmbH" autoComplete="organization" data-testid="company-name" />
      </label>
    </Modal>
  );
}

/** Baustelle hinzufügen (aus Aufmaß & Abrechnung oder manuell) bzw. bearbeiten */
function SiteDialog({
  site,
  projects,
  taken,
  onSave,
  onClose,
}: {
  site?: WeekSite;
  projects: Project[];
  taken: string[];
  onSave(f: Pick<WeekSite, 'projectId' | 'name' | 'number' | 'address' | 'note'>, alsoProject: boolean): void;
  onClose(): void;
}) {
  const [projectId, setProjectId] = useState<string>(site?.projectId ?? '');
  const mayCreate = useCanCreateProjects();
  /** Quelle: Projekt aus dem Register wählen oder neues Projekt anlegen (erscheint dann in allen Werkzeugen) */
  const [source, setSource] = useState<'project' | 'new'>(() => (site ? (site.projectId ? 'project' : 'new') : projects.some((p) => !taken.includes(p.id)) ? 'project' : 'new'));
  const [name, setName] = useState(site?.name ?? '');
  const [number, setNumber] = useState(site?.number ?? '');
  const [address, setAddress] = useState(site?.address ?? '');
  const [note, setNote] = useState(site?.note ?? '');
  const [show, setShow] = useState(false);
  const pick = (id: string) => {
    setProjectId(id);
    const p = projects.find((x) => x.id === id);
    if (p) {
      const f = siteFromProject(p);
      setName(f.name);
      setNumber(f.number);
      setAddress(f.address);
    }
  };
  const submit = () => {
    setShow(true);
    if (!name.trim()) return;
    if (source === 'project' && !projectId) return;
    onSave({ projectId: source === 'project' ? projectId || null : null, name: name.trim(), number: number.trim(), address: address.trim(), note: note.trim() }, source === 'new');
  };
  return (
    <Modal
      title={site ? 'Projekt bearbeiten' : 'Neues Projekt'}
      onClose={onClose}
      testId="site-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} data-testid="site-save">
            {site ? 'Speichern' : 'Hinzufügen'}
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="segmented crew-source" role="radiogroup" aria-label="Baustelle">
          <button type="button" role="radio" aria-checked={source === 'project'} aria-selected={source === 'project'} onClick={() => setSource('project')} disabled={!projects.length} data-testid="site-source-project">
            <ToolIcon name="projects" size={16} /> Aus Aufmaß & Abrechnung
          </button>
          {mayCreate && (
          <button
            type="button"
            role="radio"
            aria-checked={source === 'new'}
            aria-selected={source === 'new'}
            onClick={() => {
              setSource('new');
              setProjectId('');
            }}
            data-testid="site-source-new"
          >
            <Icon name="plus" size={16} /> Neues Projekt (manuell)
          </button>
          )}
        </div>
        {!projects.length && <p className="muted small">{mayCreate ? 'Noch keine Projekte im Register.' : 'Noch keine Projekte – Projekte legt Admin oder Büro an.'}</p>}
        {source === 'project' && (
        <label className="field">
          <span>Projekt wählen *</span>
          <select value={projectId} onChange={(e) => pick(e.target.value)} aria-invalid={show && !projectId ? true : undefined} data-testid="site-project">
            <option value="">– Projekt wählen –</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id} disabled={taken.includes(p.id) && p.id !== site?.projectId}>
                {[p.number, p.name].filter(Boolean).join(' · ')}
                {taken.includes(p.id) && p.id !== site?.projectId ? ' (schon in dieser Woche)' : ''}
              </option>
            ))}
          </select>
        </label>
        )}
        <div className="form-grid crew-site-fields">
          <label className="field span-2">
            <span>Bezeichnung *</span>
            <input value={name} onChange={(e) => setName(e.target.value)} aria-invalid={show && !name.trim() ? true : undefined} placeholder="z. B. Neubau Musterstraße" data-testid="site-name-input" />
          </label>
          <label className="field">
            <span>Projektnummer</span>
            <input value={number} onChange={(e) => setNumber(e.target.value)} data-testid="site-number" />
          </label>
          <label className="field">
            <span>Adresse</span>
            <input value={address} onChange={(e) => setAddress(e.target.value)} data-testid="site-address" />
          </label>
          <label className="field span-2">
            <span>Bemerkung für diese Woche (optional, erscheint im PDF)</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="z. B. Kran ab Mittwoch, Schlüssel bei Polier" data-testid="site-note-input" />
          </label>
        </div>
        {source === 'new' && !site?.projectId && <p className="muted small">Das Projekt wird im Projektregister angelegt und ist damit auch in Aufmaß & Abrechnung, Fotos, Berichten und Mängelplan verfügbar.</p>}
        {show && source === 'project' && !projectId && <p className="error small">Bitte ein Projekt wählen.</p>}
        {show && !name.trim() && <p className="error small">Bitte eine Bezeichnung eingeben.</p>}
        <p className="muted small">Die Bezeichnung wird in dieser Woche gespeichert – spätere Umbenennungen des Projekts ändern alte Wochen nicht.</p>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

/** Arbeiter einer Baustelle an gewählten Tagen einteilen (Auswahl aus der Arbeiterliste) */
function AssignDialog({
  plan,
  site,
  days,
  initialDays,
  workers,
  onSave,
  onClose,
}: {
  plan: WeekPlan;
  site: WeekSite;
  days: number[];
  initialDays: number[];
  workers: Worker[];
  onSave(ids: string[], days: number[], keep: boolean): void;
  onClose(): void;
}) {
  const [sel, setSel] = useState<Set<string>>(() => new Set());
  const [ds, setDs] = useState<number[]>(initialDays);
  /** doppelt einteilen: zusätzlich hier, auf der bisherigen Baustelle bleiben */
  const [keep, setKeep] = useState(false);
  const status = (w: Worker) => {
    if (ds.length && ds.every((d) => site.days[d].includes(w.id))) return { text: 'schon hier', here: true };
    const other = [...new Set(ds.flatMap((d) => sitesOf(plan, w.id, d, site.id).map((s) => s.name)))];
    if (other.length) return { text: keep ? `auch auf ${other.join(', ')} (doppelt)` : `auf ${other.join(', ')} → wird umgesetzt`, warn: true };
    if (ds.some((d) => plan.vacation[d].includes(w.id))) return { text: 'Urlaub', warn: true };
    return { text: 'frei' };
  };
  return (
    <Modal
      title={`Einteilen: ${site.name}`}
      onClose={onClose}
      testId="assign-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" disabled={!sel.size || !ds.length} onClick={() => onSave([...sel], ds, keep)} data-testid="assign-save">
            {sel.size ? `${sel.size} einteilen` : 'Einteilen'}
          </button>
        </>
      }
    >
      <div className="crew-day-toggles" role="group" aria-label="Tage">
        {days.map((d) => (
          <button
            key={d}
            type="button"
            className={`chip${ds.includes(d) ? ' active' : ''}`}
            aria-pressed={ds.includes(d)}
            onClick={() => setDs(ds.includes(d) ? ds.filter((x) => x !== d) : [...ds, d].sort())}
            data-testid={`assign-day-${d}`}
          >
            {DAY_SHORT[d]}
          </button>
        ))}
      </div>
      {workers.length === 0 && <p className="muted">Noch keine aktiven Arbeiter – bitte zuerst unter „Personal“ anlegen.</p>}
      {plan.sites.some((x) => x.id !== site.id && !x.paused) && (
        <label className="check crew-keep">
          <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} data-testid="assign-keep" /> Doppelt einteilen: wer schon auf einer anderen Baustelle ist,
          bleibt dort und kommt zusätzlich hierher
        </label>
      )}
      <ul className="crew-pick">
        {workers.map((w) => {
          const st = status(w);
          return (
            <li key={w.id}>
              <label className={`check-row${st.here ? ' muted' : ''}`} data-testid="assign-worker" data-worker={workerName(w)}>
                <input
                  type="checkbox"
                  disabled={!!st.here}
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
                  <span className="muted small"> · {gradeLabel(w.grade) || WORKER_GRADES[gradeRank(w)].label}</span>
                </span>
                <span className={`crew-pick-status${st.warn ? ' warn' : ''}`}>{st.text}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}

/** Eingeteilter Arbeiter: an diesem Tag entfernen, ab diesem Tag verschieben, Urlaub */
function ChipDialog({
  plan,
  name,
  workerId,
  siteId,
  day,
  onRemove,
  onMove,
  onAbsence,
  onClose,
}: {
  plan: WeekPlan;
  name: string;
  workerId: string;
  siteId: string;
  day: number;
  onRemove(): void;
  onMove(to: string): void;
  onAbsence(): void;
  onClose(): void;
}) {
  const others = plan.sites.filter((s) => s.id !== siteId && !s.paused);
  const [to, setTo] = useState(others[0]?.id ?? '');
  const also = sitesOf(plan, workerId, day, siteId);
  return (
    <Modal title={`${name} · ${DAY_NAMES[day]}`} onClose={onClose} testId="chip-dialog">
      <div className="crew-chip-actions">
        {also.length > 0 && (
          <p className="banner banner-warn small" role="status" data-testid="chip-also-hint">
            Doppelt eingeteilt: {name} ist am {DAY_NAMES[day]} auch auf {also.map((x) => x.name).join(', ')}. „Nur am {DAY_SHORT[day]} entfernen“ nimmt ihn nur von dieser
            Baustelle.
          </p>
        )}
        {others.length > 0 && (
          <div className="crew-move">
            <label className="field">
              <span>Ab {DAY_NAMES[day]} auf andere Baustelle</span>
              <select value={to} onChange={(e) => setTo(e.target.value)} data-testid="chip-move-to">
                {others.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn btn-primary" onClick={() => onMove(to)} data-testid="chip-move">
              Verschieben
            </button>
          </div>
        )}
        <button type="button" className="btn" onClick={onRemove} data-testid="chip-remove">
          <Icon name="close" size={18} /> Nur am {DAY_NAMES[day]} entfernen
        </button>
        <button type="button" className="btn" onClick={onAbsence} data-testid="chip-absence">
          <Icon name="calendar" size={18} /> Urlaub / Krank (von – bis)
        </button>
      </div>
    </Modal>
  );
}

/** Noch nicht eingeteilter Arbeiter: auf eine Baustelle einteilen oder Urlaub eintragen */
function OpenDialog({
  plan,
  worker,
  day,
  onAssign,
  onAbsence,
  onClose,
}: {
  plan: WeekPlan;
  worker: Worker;
  day: number;
  onAssign(siteId: string, rest: boolean): void;
  onAbsence(): void;
  onClose(): void;
}) {
  const [rest, setRest] = useState(true);
  return (
    <Modal title={`${workerName(worker)} · ${DAY_NAMES[day]}`} onClose={onClose} testId="open-dialog">
      <label className="check-row">
        <input type="checkbox" checked={rest} onChange={(e) => setRest(e.target.checked)} data-testid="open-rest" />
        Ab {DAY_NAMES[day]} für die restliche Woche
      </label>
      <div className="crew-chip-actions">
        {plan.sites.filter((s) => !s.paused).map((s) => (
          <button key={s.id} type="button" className="btn" onClick={() => onAssign(s.id, rest)} data-testid="open-site" data-site={s.name}>
            <Icon name="plus" size={18} /> {s.name}
          </button>
        ))}
        {!plan.sites.length && <p className="muted">Noch keine Baustelle in dieser Woche.</p>}
        <button type="button" className="btn" onClick={onAbsence} data-testid="open-absence">
          <Icon name="calendar" size={18} /> Urlaub / Krank (von – bis)
        </button>
      </div>
    </Modal>
  );
}

/** Tagesliste: Tag wählen */
function DayListDialog({ site, days, weekId, onPick, onClose }: { site: WeekSite; days: number[]; weekId: string; onPick(day: number): void; onClose(): void }) {
  return (
    <Modal title={`Tagesliste: ${site.name}`} onClose={onClose} testId="daylist-dialog">
      <p className="muted small">Liste der Arbeiter dieses Tages mit Tätigkeit und Telefon – zum Ausdrucken für die Baustelle.</p>
      <div className="crew-chip-actions">
        {days.map((d) => (
          <button key={d} type="button" className="btn" onClick={() => onPick(d)} data-testid={`daylist-${d}`}>
            {DAY_NAMES[d]}, {dayDate(weekId, d)} <span className="muted small">· {site.days[d].length} Arbeiter</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

/** Urlaub oder Krankmeldung von–bis eintragen (auch über mehrere Wochen) und vorhandene Einträge löschen */
export function AbsenceDialog({
  workers,
  absences,
  nameOf,
  workerId: initialWorker,
  kind: initialKind,
  from: initialFrom,
  to: initialTo,
  onAdd,
  onDelete,
  onClose,
}: {
  workers: Worker[];
  absences: Absence[];
  nameOf(id: string): string;
  workerId?: string;
  kind?: Absence['kind'];
  from: string;
  to: string;
  onAdd(a: Absence): void;
  onDelete(a: Absence): void;
  onClose(): void;
}) {
  const [workerId, setWorkerId] = useState(initialWorker ?? '');
  const [kind, setKind] = useState<Absence['kind']>(initialKind ?? 'urlaub');
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [error, setError] = useState('');
  // laufende und künftige Einträge (bzw. die des gewählten Arbeiters)
  const today = isoDate(new Date());
  const list = absences
    .filter((a) => (workerId ? a.workerId === workerId : a.to >= today))
    .sort((a, b) => a.from.localeCompare(b.from));
  const submit = () => {
    if (!workerId) return setError('Bitte einen Arbeiter wählen.');
    if (!from || !to) return setError('Bitte „von“ und „bis“ eingeben.');
    if (to < from) return setError('„bis“ liegt vor „von“.');
    setError('');
    onAdd({ id: uuid(), workerId, kind, from, to, createdAt: Date.now() });
  };
  return (
    <Modal
      title="Urlaub / Krank"
      onClose={onClose}
      testId="absence-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Schließen
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} data-testid="absence-save">
            Eintragen
          </button>
        </>
      }
    >
      <form
        className="crew-absence-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="segmented" role="radiogroup" aria-label="Art">
          <button type="button" role="radio" aria-checked={kind === 'urlaub'} aria-selected={kind === 'urlaub'} onClick={() => setKind('urlaub')} data-testid="absence-urlaub">
            Urlaub
          </button>
          <button type="button" role="radio" aria-checked={kind === 'krank'} aria-selected={kind === 'krank'} onClick={() => setKind('krank')} data-testid="absence-krank">
            Krank
          </button>
        </div>
        <p className="muted small">
          {kind === 'urlaub'
            ? 'Im Urlaub wird der Arbeiter an diesen Tagen von der Baustelle genommen.'
            : 'Krank: bleibt auf seiner Baustelle eingeteilt und wird dort als krank markiert.'}
        </p>
        <label className="field">
          <span>Arbeiter</span>
          <select value={workerId} onChange={(e) => setWorkerId(e.target.value)} data-testid="absence-worker">
            <option value="">– wählen –</option>
            {workers.map((w) => (
              <option key={w.id} value={w.id}>
                {workerName(w)}
              </option>
            ))}
          </select>
        </label>
        <div className="crew-absence-dates">
          <label className="field">
            <span>von</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="absence-from" />
          </label>
          <label className="field">
            <span>bis</span>
            <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} data-testid="absence-to" />
          </label>
        </div>
        {error && (
          <p className="error small" role="alert" data-testid="absence-error">
            {error}
          </p>
        )}
      </form>
      {list.length > 0 && (
        <div className="crew-absence-list">
          <h3>{workerId ? 'Einträge' : 'Aktuell und geplant'}</h3>
          {list.map((a) => (
            <div key={a.id} className="crew-absence-row" data-testid="absence-row">
              <span className={`crew-chip ${a.kind === 'urlaub' ? 'vacation' : 'sick'}`}>{a.kind === 'urlaub' ? 'Urlaub' : 'Krank'}</span>
              <span className="crew-absence-text">
                <strong>{nameOf(a.workerId)}</strong> <span className="muted">{absenceRange(a)}</span>
              </span>
              <button type="button" className="icon-btn" onClick={() => onDelete(a)} aria-label="Eintrag löschen" data-testid="absence-delete">
                <Icon name="trash" size={18} />
              </button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
