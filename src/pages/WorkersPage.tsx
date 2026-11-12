import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { SortControl } from '../components/SortControl';
import { useListSort } from '../lib/list-sort';
import { ActionMenu, type MenuAction } from '../components/ActionMenu';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { useSwipe } from '../components/useSwipe';
import { PhotoSiteDialog } from '../components/PhotoSitePicker';
import { ProjectPicker } from '../components/ProjectPicker';
import { SiteNav } from '../components/SiteNav';
import { ToolIcon } from '../components/ToolIcon';
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
  gradeRank,
  WORKER_GRADES,
  SITE_LABELS,
  siteTitle,
  type SiteLabel,
  unassign,
  updateSite,
  vacationSummary,
  visibleDays,
  weekOf,
  weekRange,
  workerName,
  gradeLabel,
  isProjectLead,
  knownGrade,
  siteManagerOf,
  siteManagerText,
  COLORED_GRADES,
  customGradeColors,
  DEFAULT_GRADE_COLORS,
  gradeColor,
  type GradeColors,
} from '../lib/crew';
import { getMeta, getWeek, listProjects, listWeeks, listWorkers, previousWeek, saveWeek, setMeta } from '../lib/db';
import { naturalCompare } from '../lib/numbers';
import { holidayOn } from '../lib/times';
import type { ExportFile } from '../lib/aufmass';
import { getCompanyLogo } from '../lib/company';
import { absenceDays, absenceOn, absenceRange, absenceSummary, cleanAbsences, clearAbsenceOn, withAbsence } from '../lib/crew-absence';
import { exportCrewBackup, importCrewBackup } from '../lib/crew-backup';
import { costCenterByProject, costCenterSearchByProject, linkSitesToProject, projectFromSite } from '../lib/crew-link';
import { ProjectHeading } from '../components/ProjectHeading';
import { labelFromProject, projectPrefix, projectSubline, type ProjectLabelInfo } from '../lib/project-label';
import { setProjectManager, useCanCreateProjects, useProjectIn } from '../lib/sites';
import { crewDayPdf, crewWeekPdf } from '../lib/crew-pdf';
import { uuid } from '../lib/ids';
import { navigate, paths } from '../lib/router';
import type { Absence, PhotoSite, Project, SiteManager, WeekPlan, WeekSite, Worker, WorkTimes } from '../lib/types';
import { usePageTitle } from '../lib/page-title';
import { useDataChanged } from '../lib/data-events';
import { useProjectColors } from '../lib/project-colors';
import { photoSiteKey } from '../lib/photos';

const WEEKDAYS = [0, 1, 2, 3, 4];
const ACCENT = { '--tool': '#2f80ed' } as CSSProperties;

/**
 * Arbeitereinteilung: Wochenplanung nach Baustellen (Baustelle → Tag → Arbeiter). Jede Woche ist ein
 * eigener Datensatz; eine neue Woche läuft mit den Baustellen und Arbeitern der Vorwoche weiter.
 */
type SiteSort = 'manual' | 'number' | 'cc' | 'name' | 'created';
const SITE_SORT_LABELS: Record<SiteSort, string> = {
  manual: 'wie angelegt',
  number: 'Projektnummer',
  cc: 'Kostenstelle',
  name: 'Name',
  created: 'Anlegedatum',
};

export function WorkersPage() {
  // Projekte anlegen nur Admin/Büro (Polier und Arbeiter übernehmen aus dem Register)
  const mayCreateProjects = useCanCreateProjects();
  usePageTitle('Arbeitereinteilung – BauPad');
  const colorOf = useProjectColors();
  const crewColor = (s: Pick<WeekSite, 'projectId' | 'name'>) => ({ '--crew': colorOf(photoSiteKey({ projectId: s.projectId ?? null, siteName: s.name })) }) as CSSProperties;
  const [workers, setWorkers] = useState<Worker[] | null>(null);
  const [times, setTimes] = useState<WorkTimes | null | undefined>(undefined);
  const [projects, setProjects] = useState<Project[]>([]);
  /** Baustellen sortieren (nur Anzeige, gemerkt): wonach und auf-/absteigend */
  // je Person gemerkt (früher gerätweit unter „crewSiteSort“ – wird übernommen)
  const [sortState, setSortState] = useListSort<SiteSort>('workers-sites', SITE_SORT_LABELS, { key: 'manual', dir: 'asc' }, () => {
    try {
      const v = JSON.parse(localStorage.getItem('crewSiteSort') ?? 'null') as { key?: string; desc?: boolean } | null;
      return v?.key && v.key in SITE_SORT_LABELS ? { key: v.key as SiteSort, dir: v.desc ? 'desc' : 'asc' } : null;
    } catch {
      return null;
    }
  });
  const siteSort = { key: sortState.key, desc: sortState.dir === 'desc' };
  const changeSiteSort = (next: { key: SiteSort; desc: boolean }) => setSortState({ key: next.key, dir: next.desc ? 'desc' : 'asc' });
  // zuletzt angezeigte Woche bleibt beim Wechsel zur Personalliste und zurück erhalten (je Browser-Tab)
  const [weekId, setWeekIdState] = useState(() => {
    try {
      const saved = sessionStorage.getItem('crewWeek');
      if (saved && /^\d{4}-\d{2}-\d{2}$/.test(saved)) return saved;
    } catch {
      /* egal */
    }
    return weekOf(new Date());
  });
  const setWeekId = (id: string) => {
    setWeekIdState(id);
    try {
      sessionStorage.setItem('crewWeek', id);
    } catch {
      /* egal */
    }
  };
  /** Wischen nach links = nächste Woche, nach rechts = vorige Woche (Handy/Tablet) */
  const pageRef = useRef<HTMLDivElement>(null);
  const weekRef = useRef(weekId);
  weekRef.current = weekId;
  const setWeekIdRef = useRef(setWeekId);
  setWeekIdRef.current = setWeekId;
  const onSwipe = useCallback((dir: 'left' | 'right') => {
    const next = addDays(weekRef.current, dir === 'left' ? 7 : -7);
    setWeekIdRef.current(next);
    toast(`KW ${isoWeekNo(next)}`, 'info', 1200);
  }, []);

  const [plan, setPlan] = useState<WeekPlan | null>(null);
  /** nicht gespeicherte Woche: aus dieser Woche weitergeführt (bzw. leer) */
  const [draftFrom, setDraftFrom] = useState<string | null>(null);
  /** aufgeklappte Projekte (Schlüssel: Projekt bzw. Name) – beim Öffnen der Einteilung ist alles zugeklappt */
  const [openKeys, setOpenKeys] = useState<Set<string>>(() => new Set());
  /** „Noch nicht eingeteilt“: klein (nur Zusammenfassung), antippen zeigt die Namen je Tag */
  const [showOpen, setShowOpen] = useState(false);
  const [company, setCompany] = useState('');
  /** Uhrzeiten im PDF anzeigen (manchmal nicht nötig) */
  const [pdfTimes, setPdfTimes] = useState(true);
  /** Einstellungen: Bezeichnung der Projekte, Funktion der Arbeiter im PDF */
  const [siteLabel, setSiteLabel] = useState<SiteLabel>('number-name');
  const [pdfGrades, setPdfGrades] = useState(false);
  /** Farben der Kästchen je Qualifikation (Einstellungen) */
  const [gradeColors, setGradeColors] = useState<GradeColors>({});
  // als CSS-Variablen an der Seite (auch für Fenster, die außerhalb der Seite liegen)
  useEffect(() => {
    const root = document.documentElement.style;
    for (const g of COLORED_GRADES) root.setProperty(`--grade-${g}`, gradeColor(gradeColors, g));
    return () => {
      for (const g of COLORED_GRADES) root.removeProperty(`--grade-${g}`);
    };
  }, [gradeColors]);
  /** Urlaub / Krank von–bis (über Wochen hinweg) */
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState<ExportFile | null>(null);
  const restoreRef = useRef<HTMLInputElement>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [dialog, setDialog] = useState<
    | { kind: 'times' }
    | { kind: 'site'; site?: WeekSite }
    | { kind: 'pick' }
    | { kind: 'assign'; siteId: string; days: number[] }
    | { kind: 'chip'; siteId: string; day: number; workerId: string }
    | { kind: 'open'; day: number; workerId: string }
    | { kind: 'dayList'; siteId: string }
    | { kind: 'absence'; workerId?: string; day?: number; absKind?: Absence['kind'] }
    | null
  >(null);

  const loadBase = () =>
    Promise.all([listWorkers(), getMeta<WorkTimes>('workTimes'), listProjects(), getMeta<string>('companyName'), getMeta<boolean>('pdfShowTimes'), getMeta<SiteLabel>('crewSiteLabel'), getMeta<boolean>('pdfShowGrades'), getMeta<GradeColors>('crewGradeColors')])
      .then(([w, t, p, c, pt, sl, pg, gc]) => {
        setGradeColors(gc && typeof gc === 'object' ? gc : {});
        setPdfTimes(pt !== false);
        setSiteLabel(sl && sl in SITE_LABELS ? sl : 'number-name');
        setPdfGrades(pg === true);
        setWorkers(w);
        setTimes(t ?? null);
        setProjects(p);
        setCompany(c ?? '');
      })
      .catch((e) => showError(e, 'Arbeitereinteilung konnte nicht geladen werden'));
  useEffect(() => {
    void loadBase();
  }, []);
  // Abgleich mit der Ablage: Arbeiter, Projekte und die angezeigte Woche neu laden (nicht während ein Fenster offen ist)
  useDataChanged(() => {
    if (dialog) return;
    void loadBase();
    setReloadKey((k) => k + 1);
  });

  useEffect(() => {
    let off = false;
    setPlan(null);
    void (async () => {
      const [saved, abs] = await Promise.all([getWeek(weekId), getMeta<Absence[]>('absences')]);
      if (off) return;
      setAbsences(cleanAbsences(abs ?? []));
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

  /** Kostenstelle je Projekt (für die Überschrift der Baustellenkarten) */
  const [ccMap, setCcMap] = useState<Map<string, string>>(() => new Map());
  /** alle Kostenstellen je Projekt als Suchtext */
  const [ccAllMap, setCcAllMap] = useState<Map<string, string>>(() => new Map());
  useEffect(() => {
    void costCenterByProject().then(setCcMap).catch(() => {});
    void costCenterSearchByProject().then(setCcAllMap).catch(() => {});
  }, [projects]);
  /** Angaben der Baustelle wie in allen Werkzeugen: aus dem Projekt des Registers, sonst aus der Woche */
  const siteInfo = (s: WeekSite): ProjectLabelInfo => {
    const p = s.projectId ? projects.find((x) => x.id === s.projectId) : undefined;
    const info: ProjectLabelInfo = p ? { ...labelFromProject(p, ccMap.get(p.id) ?? ''), name: s.name || p.site || p.name } : { name: s.name, number: s.number, address: s.address };
    // Bezeichnung laut Einstellung (Nummer vorne wie bisher, sonst im Namen bzw. weggelassen)
    return siteLabel === 'number-name' ? info : { ...info, name: siteTitle({ number: projectPrefix(info), name: info.name }, siteLabel), number: '', costCenter: '' };
  };
  const byId = useMemo(() => new Map((workers ?? []).map((w) => [w.id, w])), [workers]);
  const active = useMemo(() => sortByGrade((workers ?? []).filter((w) => w.active)), [workers]);
  /** einteilbar: aktive Arbeiter ohne Projektleiter (PL steht beim Projekt, nicht in der Wocheneinteilung) */
  const crew = useMemo(() => active.filter((w) => !isProjectLead(w)), [active]);
  const workTimes = times ?? DEFAULT_WORK_TIMES;
  const nameOf = (id: string) => (byId.get(id) ? workerName(byId.get(id)!) : 'Unbekannt');
  /** Farbe des Kästchens nach Funktion (Polier, Vorarbeiter …) */
  const gradeClass = (id: string) => {
    const w = byId.get(id);
    const g = w ? knownGrade(w) : null;
    return g ? ` grade-${g}` : '';
  };
  /** Arbeiter eines Tages: höhere Funktion zuerst, innerhalb der Funktion alphabetisch */
  const byGrade = (ids: string[]) =>
    [...ids].sort((a, b) => {
      const wa = byId.get(a);
      const wb = byId.get(b);
      return (wa ? gradeRank(wa) : 99) - (wb ? gradeRank(wb) : 99) || nameOf(a).localeCompare(nameOf(b), 'de');
    });
  /** Projekt-Schlüssel fürs Auf-/Zuklappen (bleibt beim Wochenwechsel gleich) */
  const siteKey = (s: Pick<WeekSite, 'projectId' | 'name'>) => s.projectId || s.name;
  /** angetippter Arbeiter: seine Tage werden in den Projekten markiert */
  const picked = dialog?.kind === 'chip' ? dialog.workerId : null;

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
    // wer krank/auf Urlaub und an dem Tag nirgends eingeteilt war und jetzt eingeteilt wird: Urlaub/Krank dort aufheben
    let abs = absences;
    const cleared: string[] = [];
    for (const id of ids) {
      const free = ds.filter((d) => absenceOn(abs, id, weekId, d) && !plan!.sites.some((s) => s.days[d].includes(id)));
      if (!free.length) continue;
      abs = clearAbsenceOn(abs, id, free.map((d) => addDays(weekId, d)));
      cleared.push(`${nameOf(id)} (${free.map((d) => DAY_SHORT[d]).join(', ')})`);
    }
    if (cleared.length) {
      await saveAbsences(abs);
      toast(`Urlaub/Krank aufgehoben: ${cleared.join(', ')}.`, 'success', 4500);
    }
    if (keep) {
      // doppelt einteilen: zusätzlich hier, auf der bisherigen Baustelle bleiben (nur diese Woche)
      next = assign(next, siteId, ds, ids);
      save(next);
      const target = next.sites.find((x) => x.id === siteId)!;
      const twice = ids.filter((id) => ds.some((d) => sitesOf(next, id, d, siteId).length));
      if (twice.length) toast(`Doppelt eingeteilt auf ${target.name}: ${twice.map(nameOf).join(', ')} – bleibt auch auf dem bisherigen Projekt.`, 'success', 4500);
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
    await saveAbsences(withAbsence(absences, a));
    toast(`${a.kind === 'urlaub' ? 'Urlaub' : 'Krank'} eingetragen: ${nameOf(a.workerId)}, ${absenceRange(a)}`, 'success');
  };
  const deleteAbsence = async (a: Absence) => {
    const rest = absences.filter((x) => x.id !== a.id);
    await saveAbsences(rest);
    toast(`${a.kind === 'urlaub' ? 'Urlaub' : 'Krankmeldung'} gelöscht.`, 'success');
    // wieder verfügbar: wenn er an diesen Tagen (diese Woche) nirgends eingeteilt ist, gleich auf ein Projekt einteilen
    const free = absenceDays(a, weekId).filter((d) => !absenceOn(rest, a.workerId, weekId, d) && !plan!.sites.some((s) => s.days[d].includes(a.workerId)));
    const w = byId.get(a.workerId);
    if (free.length && w?.active && !isProjectLead(w) && plan!.sites.some((s) => !s.paused)) setDialog({ kind: 'open', day: free[0], workerId: a.workerId });
  };

  /** Baustelle pausieren (Standby): Arbeiter werden frei; gilt auch für bereits geplante Folgewochen */
  const pause = async (site: WeekSite) => {
    const later = (await listWeeks()).filter((w) => w.id > weekId && sameSite(w, site) && !sameSite(w, site)!.paused);
    const freed = [...new Set(site.days.flat())];
    const ok = await confirmDialog({
      title: 'Projekt pausieren?',
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
    setOpenKeys((prev) => new Set(prev).add(siteKey(site)));
    toast(`„${site.name}“ läuft wieder – jetzt Arbeiter einteilen.`, 'success');
  };

  /**
   * „ab diesem Tag“: unter der Woche bis Freitag – plus Sa/So, an denen die Arbeiter schon eingeteilt sind
   * (die werden mit umgesetzt); ab Samstag bis Sonntag.
   */
  const restOfWeek = (day: number, ids: string[] = []) =>
    [0, 1, 2, 3, 4, 5, 6].filter((d) => d >= day && (d < 5 || day >= 5 || ids.some((id) => plan!.sites.some((s) => s.days[d].includes(id)))));


  /** fürs PDF: Projektnummer, Name und Adresse aktuell aus dem Projektregister (wie in der App angezeigt) */
  const pdfPlan = (w: WeekPlan): WeekPlan => ({
    ...w,
    sites: w.sites.map((s) => {
      const p = projOf(s);
      // gleiche Nummer wie in der App: Kostenstelle, sonst Projektnummer
      return p ? { ...s, number: ccMap.get(p.id) || p.number || s.number, name: s.name || p.site || p.name, address: p.address || s.address } : s;
    }),
  });
  /** PDF-Optionen: Firmenname und Firmenlogo (Konto → Einstellungen) */
  const pdfOpts = async () => ({
    company,
    logo: await getCompanyLogo(),
    absent: (id: string, d: number) => absenceOn(absences, id, weekId, d),
    showTimes: pdfTimes,
    siteLabel,
    showGrades: pdfGrades,
    manager: (siteId: string) => {
      const st = plan?.sites.find((x) => x.id === siteId);
      return st ? siteManagerText(siteManagerOf(st, st.projectId ? projects.find((p) => p.id === st.projectId) : null)) : '';
    },
  });
  const run = (fn: () => Promise<void>) => fn().catch((e) => showError(e, 'Das hat nicht geklappt'));

  const exportWeekPdf = () =>
    run(async () => {
      setPreview(await crewWeekPdf(pdfPlan(plan!), workers!, workTimes, await pdfOpts()));
    });
  /** Drucken: PDF in einem neuen Tab öffnen (Fenster sofort öffnen, sonst blockiert der Browser) */
  const printWeek = () => {
    const win = window.open('', '_blank');
    run(async () => {
      const f = await crewWeekPdf(pdfPlan(plan!), workers!, workTimes, await pdfOpts());
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
          message: <p>Diese Woche hat schon eine Einteilung. Sie wird durch die Projekte und Arbeiter aus KW {isoWeekNo(prev.id)} ersetzt. Andere Wochen bleiben unverändert.</p>,
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
      toast(`Projekt „${p.name}“ im Projektregister angelegt – in allen Werkzeugen verfügbar.`, 'success');
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

  useSwipe(pageRef, onSwipe, !!(workers && times !== undefined && plan));

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
  /** gesetzliche Feiertage in Österreich (jedes Jahr automatisch, auch Ostermontag, Pfingstmontag, Fronleichnam …) */
  const holidayOf = (d: number) => holidayOn(addDays(weekId, d));
  // Warnung nur für Arbeiter, die die ganze Woche nirgends eingeteilt sind (Urlaub/Krank an allen Arbeitstagen zählt nicht)
  const firmDays = workDays.filter((d) => workTimes[d] && !holidayOf(d));
  const openWeek = sortByGrade(workers ?? []).filter(
    (w) =>
      w.active &&
      !isProjectLead(w) &&
      !plan.sites.some((s) => s.days.some((d) => d.includes(w.id))) &&
      firmDays.some((d) => !plan.vacation[d]?.includes(w.id) && !absenceOn(absences, w.id, weekId, d)),
  );
  const firstOpenDay = (id: string) => firmDays.find((d) => !plan.vacation[d]?.includes(id) && !absenceOn(absences, id, weekId, d)) ?? 0;
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
  const filtered = q
    ? plan.sites.filter((s) => {
        const p = s.projectId ? projects.find((x) => x.id === s.projectId) : undefined;
        const texts = [s.name, s.number, s.address, p?.name, p?.site, p?.number, p ? ccMap.get(p.id) : '', p ? ccAllMap.get(p.id) : '', siteManagerOf(s, p)?.name];
        return texts.some((t) => t?.toLowerCase().includes(q)) || s.days.some((d) => d.some(hit));
      })
    : plan.sites;
  // Reihenfolge der Baustellen (nur Anzeige, gemerkt): wie angelegt, Projektnummer, Kostenstelle, Name, neu/alt
  const projOf = (s: WeekSite) => (s.projectId ? projects.find((x) => x.id === s.projectId) : undefined);
  const shown = siteSort.key === 'manual'
    ? siteSort.desc
      ? [...filtered].reverse()
      : filtered
    : [...filtered].sort((a, b) => {
        const pa = projOf(a);
        const pb = projOf(b);
        const byName = (a.name || '').localeCompare(b.name || '', 'de');
        const dir = siteSort.desc ? -1 : 1;
        // ohne Wert immer am Ende
        const keyed = (ka: string, kb: string) => (!ka || !kb ? (ka ? -1 : kb ? 1 : byName) : dir * naturalCompare(ka, kb) || byName);
        switch (siteSort.key) {
          case 'number':
            return keyed(pa?.number || a.number || '', pb?.number || b.number || '');
          case 'cc':
            return keyed(pa ? (ccMap.get(pa.id) ?? '') : '', pb ? (ccMap.get(pb.id) ?? '') : '');
          case 'created': {
            const ta = pa?.createdAt ?? 0;
            const tb = pb?.createdAt ?? 0;
            if (!ta || !tb) return ta ? -1 : tb ? 1 : byName;
            return dir * (ta - tb) || byName;
          }
          default:
            return dir * byName;
        }
      });
  const pausedShown = shown.filter((s) => s.paused);
  /** Menü einer Baustelle (laufend oder pausiert) */
  const siteActions = (s: WeekSite): MenuAction[] => [
      ...(s.paused ? [] : [{ label: 'Arbeiter einteilen (ganze Woche)', icon: 'plus', onSelect: () => setDialog({ kind: 'assign', siteId: s.id, days: workDays }), testId: 'site-assign' }]),
      { label: 'Projekt bearbeiten', icon: 'edit', onSelect: () => setDialog({ kind: 'site', site: s }), testId: 'site-edit' },
      ...(s.paused ? [] : [{ label: 'Tagesliste (PDF)', icon: 'pdf', onSelect: () => setDialog({ kind: 'dayList', siteId: s.id }), testId: 'site-daylist' }]),
      ...(s.projectId && projects.some((p) => p.id === s.projectId)
        ? [{ label: 'Projekt öffnen', icon: 'folder', onSelect: () => navigate(paths.project(s.projectId!)), testId: 'site-open-project' }]
        : mayCreateProjects
          ? [{ label: 'Ins Projektregister aufnehmen', icon: 'folder', onSelect: () => void siteToProject(s), testId: 'site-to-project' }]
          : []),
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
            title: 'Projekt entfernen?',
            message: <p>„{s.name}“ und ihre Einteilung werden aus dieser Woche entfernt. Andere Wochen bleiben unverändert.</p>,
            confirmLabel: 'Entfernen',
            danger: true,
          }).then((ok) => ok && save(removeSite(plan, s.id))),
        testId: 'site-remove',
      },
  ];
  const toggle = (key: string) =>
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  return (
    <>
      <SiteNav />
      <div className="page crew-page" ref={pageRef}>
        <header className="page-head page-head-row">
          <div className="page-head-title">
            <a href={paths.tools()} className="icon-link" aria-label="Zu den Tools" title="Zu den Tools" data-testid="to-tools">
              <Icon name="back" />
            </a>
            <h1 data-testid="workers-title">Arbeitereinteilung</h1>
          </div>
          {/* Projekte hinzufügen nur Admin/Büro – ohne dieses Recht keine Taste */}
          {mayCreateProjects && (
            <button type="button" className="btn btn-primary" onClick={() => setDialog({ kind: 'pick' })} title="Projekt aus dem Register übernehmen oder neu anlegen" aria-label="Neues Projekt" data-testid="add-site">
              <Icon name="plus" size={16} /> <span className="lbl">Neues Projekt</span>
            </button>
          )}
        </header>

        <div className="crew-actions">
          <a href={paths.staff()} className="btn" data-testid="crew-workers">
            <ToolIcon name="workers" size={18} /> Personal ({active.length})
          </a>
          <button type="button" className="btn" onClick={() => setDialog({ kind: 'times' })} data-testid="crew-times">
            <Icon name="settings" size={18} /> Einstellungen
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

        <div className="crew-sticky" data-testid="crew-sticky">
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
          <button type="button" className="btn btn-sm crew-carry-btn" onClick={() => void carryAgain()} title="Projekte und Arbeiter der Vorwoche in diese Woche übernehmen" data-testid="crew-carry">
            <Icon name="copy" size={16} /> Vorwoche übernehmen
          </button>
        </div>
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
        </div>

        {draftFrom !== null && plan.sites.length > 0 && (
          <div className="banner banner-info" role="status" data-testid="draft-banner">
            <p>
              Weitergeführt aus <strong>KW {isoWeekNo(draftFrom)}</strong>: gleiche Projekte und Arbeiter. Änderungen gelten nur für diese Woche – die Vorwoche bleibt
              unverändert.
            </p>
            <button type="button" className="btn btn-sm" onClick={() => save({ ...plan, updatedAt: Date.now() })} data-testid="draft-save">
              So übernehmen
            </button>
          </div>
        )}

        {openWeek.length > 0 ? (
          <section className={`crew-open${showOpen ? ' expanded' : ''}`} data-testid="crew-open">
            <button type="button" className="crew-open-toggle" onClick={() => setShowOpen(!showOpen)} aria-expanded={showOpen} data-testid="crew-open-toggle">
              <Icon name="info" size={16} />
              <span>
                Diese Woche nicht eingeteilt: <strong>{openWeek.length}</strong>
              </span>
              <Icon name="next" size={16} className={`crew-open-chevron${showOpen ? ' open' : ''}`} />
            </button>
            {showOpen && (
              <div className="crew-open-row" data-day={firstOpenDay(openWeek[0].id)}>
                <span className="crew-chips">
                  {openWeek.map((w) => (
                    <button
                      key={w.id}
                      type="button"
                      className={`crew-chip open${gradeClass(w.id)}`}
                      onClick={() => setDialog({ kind: 'open', day: firstOpenDay(w.id), workerId: w.id })}
                      data-testid="open-chip"
                    >
                      {workerName(w)}
                    </button>
                  ))}
                </span>
              </div>
            )}
          </section>
        ) : (
          plan.sites.length > 0 &&
          active.length > 0 && (
            <p className="crew-all-set" data-testid="crew-all-set">
              <Icon name="check" size={18} /> Alle Arbeiter sind eingeteilt.
            </p>
          )
        )}
        <section className="crew-sites">
          {plan.sites.length > 0 && (
            <div className="crew-sites-bar" data-testid="crew-sites-bar">
              <strong className="crew-sites-count" data-testid="crew-sites-count">
                {plan.sites.length} {plan.sites.length === 1 ? 'Projekt' : 'Projekte'}
              </strong>
              <span className="crew-grade-legend" data-testid="crew-grade-legend" aria-label="Farben nach Funktion">
                {WORKER_GRADES.filter((g) => g.id !== 'projektleiter').map((g) => (
                  <span key={g.id} className={`crew-grade-key grade-${g.id}`} title={g.label}>
                    {g.short}
                  </span>
                ))}
              </span>
              {plan.sites.length > 1 && (
                <SortControl value={sortState} labels={SITE_SORT_LABELS} onChange={setSortState} newestFirst={['created']} testId="crew-order" />
              )}
            </div>
          )}
          {plan.sites.length > 1 && (
            <label className="crew-search">
              <Icon name="select" size={18} />
              <span className="sr-only">Suchen</span>
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Projekt, Kostenstelle, Projektnummer oder Arbeiter suchen" data-testid="crew-search" />
              {q && (
                <span className="muted small" data-testid="crew-search-count">
                  {shown.length} von {plan.sites.length}
                </span>
              )}
            </label>
          )}
          {shown.filter((s) => !s.paused).map((s) => {
            // zugeklappt, außer selbst aufgeklappt oder Treffer bei der Suche
            const isOpen = openKeys.has(siteKey(s)) || !!q;
            const count = new Set(s.days.flat()).size;
            return (
              <article key={s.id} className={`crew-site${s.finished ? ' finished' : ''}`} style={crewColor(s)} data-testid="site-card" data-site={s.name}>
                <header className="crew-site-head">
                  <button type="button" className="crew-site-toggle" aria-expanded={isOpen} onClick={() => toggle(siteKey(s))} data-testid="site-toggle">
                    <Icon name="next" size={18} />
                    <span className="crew-site-title">
                      <ProjectHeading info={siteInfo(s)} nameTestId="site-name" extra={s.finished ? <span className="crew-finished">abgeschlossen</span> : undefined} />
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
                {(() => {
                  const m = siteManagerOf(s, projOf(s));
                  return m ? (
                    <p className={`crew-site-manager${m.deputy ? ' deputy' : ''}`} data-testid="site-manager-line">
                      <strong>PL:</strong> {m.name}
                      {m.phone && (
                        <>
                          {' · '}
                          <a href={`tel:${m.phone.replace(/[^\d+]/g, '')}`}>{m.phone}</a>
                        </>
                      )}
                      {m.deputy && <span className="crew-deputy"> Vertretung diese Woche</span>}
                    </p>
                  ) : null;
                })()}
                {isOpen && s.note && (
                  <p className="crew-note" data-testid="site-note">
                    {s.note}
                  </p>
                )}
                {isOpen && (
                  <div className="crew-days" style={{ ['--days' as string]: days.length } as React.CSSProperties} data-testid="crew-days">
                    {days.map((d) => (
                      <div
                        key={d}
                        className={`crew-day${d >= 5 ? ' weekend' : ''}${holidayOf(d) ? ' holiday' : ''}`}
                        data-testid="day-row"
                        data-day={d}
                      >
                        <span className="crew-day-label">
                          <strong>
                            {DAY_SHORT[d]} {dayDate(weekId, d)}
                          </strong>
                          {holidayOf(d) ? (
                            <span className="crew-holiday" data-testid="day-holiday">
                              {holidayOf(d)}
                            </span>
                          ) : null}
                          <button type="button" className="crew-add" onClick={() => setDialog({ kind: 'assign', siteId: s.id, days: restOfWeek(d) })} aria-label={`Arbeiter für ${DAY_NAMES[d]} einteilen`} data-testid="day-add">
                            <Icon name="plus" size={16} />
                          </button>
                        </span>
                        <span className="crew-chips">
                          {byGrade(s.days[d]).map((id) => (
                            <button
                              key={id}
                              type="button"
                              className={`crew-chip${gradeClass(id)}${byId.get(id)?.active === false ? ' inactive' : ''}${sitesOf(plan, id, d, s.id).length ? ' conflict' : ''}${hit(id) ? ' hit' : ''}${picked === id ? ' picked' : ''}${absenceOn(absences, id, weekId, d) === 'krank' ? ' sick' : absenceOn(absences, id, weekId, d) ? ' away' : ''}`}
                              onClick={() => setDialog({ kind: 'chip', siteId: s.id, day: d, workerId: id })}
                              data-testid="crew-chip"
                              data-worker={nameOf(id)}
                              title={sitesOf(plan, id, d, s.id).length ? `Auch eingeteilt auf: ${sitesOf(plan, id, d, s.id).map((x) => x.name).join(', ')}` : undefined}
                            >
                              {nameOf(id)}
                            </button>
                          ))}
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
                <article key={s.id} className="crew-site paused" style={crewColor(s)} data-testid="site-card" data-site={s.name}>
                  <header className="crew-site-head">
                    <span className="crew-site-toggle">
                      <Icon name="pause" size={18} />
                      <span className="crew-site-title">
                        <ProjectHeading info={siteInfo(s)} nameTestId="site-name" />
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
              <p>Noch kein Projekt in dieser Woche.</p>
              <p className="muted">Projekt auswählen oder neu anlegen, dann die Arbeiter je Tag einteilen.</p>
            </div>
          )}
        </section>
      </div>

      {dialog?.kind === 'times' && (
        <TimesDialog
          times={workTimes}
          company={company}
          pdfTimes={pdfTimes}
          siteLabel={siteLabel}
          pdfGrades={pdfGrades}
          gradeColors={gradeColors}
          siteSort={siteSort}
          onClose={() => setDialog(null)}
          onSave={(t, c, pt, x) => {
            setTimes(t);
            setCompany(c);
            setPdfTimes(pt);
            setSiteLabel(x.siteLabel);
            setPdfGrades(x.pdfGrades);
            const gc = customGradeColors(x.gradeColors);
            setGradeColors(gc);
            changeSiteSort(x.siteSort);
            setDialog(null);
            // erst nach dem Speichern melden (Seitenwechsel direkt danach verliert sonst nichts)
            void Promise.all([setMeta('workTimes', t), setMeta('companyName', c), setMeta('pdfShowTimes', pt), setMeta('crewSiteLabel', x.siteLabel), setMeta('pdfShowGrades', x.pdfGrades), setMeta('crewGradeColors', gc)])
              .then(() => toast('Einstellungen gespeichert.', 'success'))
              .catch((e) => showError(e, 'Speichern fehlgeschlagen'));
          }}
        />
      )}
      {dialog?.kind === 'pick' && (
        <ProjectPicker
          tool="workers"
          mode="all"
          exclude={plan.sites.map((s) => s.projectId).filter(Boolean) as string[]}
          onClose={() => setDialog(null)}
          onPick={(p) =>
            run(async () => {
              setProjects(await listProjects());
              const f = siteFromProject(p);
              const r = addSite(plan, { ...f, note: '' });
              save(r.week);
              setOpenKeys((prev) => new Set(prev).add(siteKey(r.site)));
              toast(`Projekt „${f.name}“ angelegt.`, 'success');
              setDialog(null);
            })
          }
        />
      )}
      {dialog?.kind === 'site' && (
        <SiteDialog
          site={dialog.site}
          workers={workers ?? []}
          projects={projects}
          taken={plan.sites.map((s) => s.projectId).filter(Boolean) as string[]}
          onClose={() => setDialog(null)}
          onProjectCreated={async () => setProjects(await listProjects())}
          onSave={(fields, alsoProject, manager) =>
            void run(async () => {
              let f = fields;
              if (manager !== undefined && fields.projectId) {
                await setProjectManager(fields.projectId, manager);
                setProjects(await listProjects());
              }
              if (alsoProject) {
                const p = await projectFromSite(fields, 'workers');
                setProjects((list) => [p, ...list]);
                f = { ...fields, projectId: p.id };
                toast(`Projekt „${p.name}“ im Projektregister angelegt – in allen Werkzeugen verfügbar.`, 'success');
              }
              await useProjectIn(f.projectId, 'workers');
              if (dialog.site) save(updateSite(plan, dialog.site.id, f));
              else {
                const r = addSite(plan, f);
                save(r.week);
                setOpenKeys((prev) => new Set(prev).add(siteKey(r.site)));
                toast(`Projekt „${f.name}“ angelegt.`, 'success');
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
          workers={crew}
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
          weekId={weekId}
          days={days}
          absences={absences}
          name={nameOf(dialog.workerId)}
          workerId={dialog.workerId}
          siteId={dialog.siteId}
          day={dialog.day}
          infoOf={siteInfo}
          styleOf={(s) => ({ '--pc': colorOf(photoSiteKey({ projectId: s.projectId ?? null, siteName: s.name })) }) as CSSProperties}
          onClose={() => setDialog(null)}
          onToggleDay={(d, on) => {
            if (on) void run(() => place([dialog.workerId], dialog.siteId, [d], true));
            else save(unassign(plan, dialog.siteId, d, dialog.workerId));
          }}
          onRemove={() => {
            save(unassign(plan, dialog.siteId, dialog.day, dialog.workerId));
            setDialog(null);
          }}
          onRemoveWeek={() => {
            let next = plan;
            for (const d of days) next = unassign(next, dialog.siteId, d, dialog.workerId);
            save(next);
            setDialog(null);
            toast(`${nameOf(dialog.workerId)} aus „${plan.sites.find((x) => x.id === dialog.siteId)?.name}“ entfernt (diese Woche).`, 'success');
          }}
          onMove={(to, keep) => {
            setDialog(null);
            void run(() => place([dialog.workerId], to, restOfWeek(dialog.day, [dialog.workerId]), false, keep));
          }}
          onAbsence={(k) => setDialog({ kind: 'absence', workerId: dialog.workerId, day: dialog.day, absKind: k })}
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
              const f = await crewDayPdf(pdfPlan(plan), dialog.siteId, d, workers, workTimes, await pdfOpts());
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
          kind={dialog.absKind}
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
          onAbsence={(k) => setDialog({ kind: 'absence', workerId: dialog.workerId, day: dialog.day, absKind: k })}
        />
      )}
    </>
  );
}

/** Arbeiterliste: anlegen, bearbeiten, aktiv/inaktiv */
/** Farbvorschläge je Qualifikation (direkt antippen); daneben bleibt die freie Farbwahl */
const GRADE_PALETTE = ['#6f9be8', '#5cb87a', '#e0a43a', '#a3a3ad', '#e5484d', '#9b6bdf', '#2bb3b3', '#e86fb5'];

type CrewSettings = { siteLabel: SiteLabel; pdfGrades: boolean; gradeColors: GradeColors; siteSort: { key: SiteSort; desc: boolean } };

/** Einstellungen der Arbeitereinteilung: Arbeitszeit, Projektbezeichnung, Reihenfolge, Farben je Qualifikation, PDF (Uhrzeiten, Funktion, Firmenname) */
function TimesDialog({
  times,
  company,
  pdfTimes,
  siteLabel,
  pdfGrades,
  gradeColors,
  siteSort,
  onSave,
  onClose,
}: {
  times: WorkTimes;
  company: string;
  pdfTimes: boolean;
  siteLabel: SiteLabel;
  pdfGrades: boolean;
  gradeColors: GradeColors;
  siteSort: { key: SiteSort; desc: boolean };
  onSave(t: WorkTimes, company: string, pdfTimes: boolean, x: CrewSettings): void;
  onClose(): void;
}) {
  const [t, setT] = useState<WorkTimes>(() => times.map((x) => (x ? { ...x } : null)));
  const [c, setC] = useState(company);
  const [pt, setPt] = useState(pdfTimes);
  const [x, setX] = useState<CrewSettings>({ siteLabel, pdfGrades, gradeColors, siteSort });
  const set = (d: number, x: WorkTimes[number]) => setT(t.map((y, i) => (i === d ? x : y)));
  return (
    <Modal
      title="Einstellungen Arbeitereinteilung"
      onClose={onClose}
      testId="times-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onSave(t, c.trim(), pt, x)} data-testid="times-save">
            Speichern
          </button>
        </>
      }
    >
      <h3 className="crew-set-title">Projekte</h3>
      <label className="field">
        <span>Bezeichnung der Projekte (Einteilung und PDF)</span>
        <select value={x.siteLabel} onChange={(e) => setX({ ...x, siteLabel: e.target.value as SiteLabel })} data-testid="set-site-label">
          {(Object.keys(SITE_LABELS) as SiteLabel[]).map((k) => (
            <option key={k} value={k}>
              {SITE_LABELS[k]}
            </option>
          ))}
        </select>
      </label>
      <div className="crew-set-row">
        <label className="field">
          <span>Reihenfolge der Projekte</span>
          <select value={x.siteSort.key} onChange={(e) => setX({ ...x, siteSort: { ...x.siteSort, key: e.target.value as SiteSort } })} data-testid="set-site-order">
            {(Object.keys(SITE_SORT_LABELS) as SiteSort[]).map((k) => (
              <option key={k} value={k}>
                {SITE_SORT_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Richtung</span>
          <select value={x.siteSort.desc ? 'desc' : 'asc'} onChange={(e) => setX({ ...x, siteSort: { ...x.siteSort, desc: e.target.value === 'desc' } })} data-testid="set-site-dir">
            <option value="asc">aufsteigend</option>
            <option value="desc">absteigend</option>
          </select>
        </label>
      </div>
      <h3 className="crew-set-title">Farben je Qualifikation</h3>
      <p className="muted small">Farbe der Namenskästchen in der Einteilung – nach Geschmack wählbar.</p>
      <div className="crew-grade-colors" data-testid="set-grade-colors">
        {COLORED_GRADES.map((g) => {
          const label = WORKER_GRADES.find((w) => w.id === g)!;
          const value = gradeColor(x.gradeColors, g);
          return (
            <div key={g} className="crew-grade-color" data-testid="set-grade-row" data-grade={g}>
              <label className="crew-grade-color-head">
                <input type="color" value={value} onChange={(e) => setX({ ...x, gradeColors: { ...x.gradeColors, [g]: e.target.value } })} aria-label={`Farbe ${label.label} frei wählen`} title="Eigene Farbe" data-testid={`set-grade-color-${g}`} />
                <span className={`crew-grade-key grade-${g}`} style={{ '--grade': value } as CSSProperties}>
                  {label.short}
                </span>
                <span className="small">{label.label}</span>
              </label>
              {/* ein paar Farben direkt zum Antippen */}
              <div className="color-swatches crew-grade-swatches" role="radiogroup" aria-label={`Farbe ${label.label}`}>
                {GRADE_PALETTE.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={value === c}
                    aria-label={`${label.label}: Farbe ${c}`}
                    className="color-swatch"
                    style={{ background: c }}
                    onClick={() => setX({ ...x, gradeColors: { ...x.gradeColors, [g]: c } })}
                    data-testid={`grade-swatch-${g}`}
                    data-color={c}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className="btn btn-sm"
        onClick={() => setX({ ...x, gradeColors: {} })}
        disabled={COLORED_GRADES.every((g) => gradeColor(x.gradeColors, g) === DEFAULT_GRADE_COLORS[g])}
        data-testid="set-grade-colors-reset"
      >
        Standardfarben
      </button>
      <h3 className="crew-set-title">PDF</h3>
      <label className="check-row">
        <input type="checkbox" checked={x.pdfGrades} onChange={(e) => setX({ ...x, pdfGrades: e.target.checked })} data-testid="set-pdf-grades" />
        Qualifikation der Arbeiter anzeigen (z. B. „Max Muster · PO“)
      </label>
      <h3 className="crew-set-title">Arbeitszeit der Firma</h3>
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

/** Baustelle hinzufügen: Projekt aus dem Register wählen oder „Neues Projekt …“ (gleicher Dialog wie in allen Werkzeugen) */
function SiteDialog({
  site,
  workers,
  projects,
  taken,
  onSave,
  onClose,
  onProjectCreated,
}: {
  site?: WeekSite;
  projects: Project[];
  taken: string[];
  onSave(f: Pick<WeekSite, 'projectId' | 'name' | 'number' | 'address' | 'note' | 'siteManager'>, alsoProject: boolean, manager?: SiteManager | null): void;
  /** Personal zur Auswahl des Projektleiters */
  workers: Worker[];
  onClose(): void;
  /** neues Projekt wurde im Register angelegt (Liste der Seite neu laden) */
  onProjectCreated(): Promise<void>;
}) {
  const [projectId, setProjectId] = useState<string>(site?.projectId ?? '');
  /** frisch angelegtes Projekt, bis die Liste der Seite nachgeladen ist */
  const [fresh, setFresh] = useState<PhotoSite | null>(null);
  const [creating, setCreating] = useState(false);
  const mayCreate = useCanCreateProjects();
  const [show, setShow] = useState(false);
  const chosen = projects.find((p) => p.id === projectId) ?? null;
  /** Projektleiter des Projekts (gilt jede Woche): aus dem Personal oder frei mit Handynummer */
  const [pl, setPl] = useState<SiteManager | null>(() => chosen?.siteManager ?? null);
  useEffect(() => setPl(chosen?.siteManager ?? null), [projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  const plMode = !pl ? '' : pl.workerId ? pl.workerId : 'other';
  /** nur Personal mit der Funktion Projektleiter; ein bisher gewählter anderer Eintrag bleibt sichtbar, damit er nicht verloren geht */
  const leads = sortByGrade(workers.filter((w) => (w.active && w.grade === 'projektleiter') || w.id === pl?.workerId));
  /** Vertretung des Projektleiters nur in dieser Woche */
  const [deputy, setDeputy] = useState<{ on: boolean; name: string; phone: string }>(() => ({ on: !!site?.siteManager?.name, name: site?.siteManager?.name ?? '', phone: site?.siteManager?.phone ?? '' }));
  const fields = chosen ? siteFromProject(chosen) : fresh && fresh.projectId === projectId ? { projectId, name: fresh.name, number: fresh.number, address: fresh.address } : site ? { projectId: site.projectId, name: site.name, number: site.number ?? '', address: site.address ?? '' } : null;
  const submit = () => {
    setShow(true);
    if (!fields || !fields.name.trim()) return;
    onSave(
      {
        projectId: projectId || null,
        name: fields.name.trim(),
        number: (fields.number ?? '').trim(),
        address: (fields.address ?? '').trim(),
        note: site?.note ?? '',
        siteManager: deputy.on && deputy.name.trim() ? { workerId: null, name: deputy.name.trim(), phone: deputy.phone.trim() } : null,
      },
      false,
      projectId ? (pl && pl.name.trim() ? { workerId: pl.workerId ?? null, name: pl.name.trim(), phone: pl.phone.trim() } : null) : undefined,
    );
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
        <label className="field">
          <span>Projekt *</span>
          <select
            value={projectId}
            onChange={(e) => {
              if (e.target.value === '__new') setCreating(true);
              else setProjectId(e.target.value);
            }}
            aria-invalid={show && !projectId ? true : undefined}
            data-testid="site-project"
          >
            <option value="">– Projekt wählen –</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id} disabled={taken.includes(p.id) && p.id !== site?.projectId}>
                {[p.number, p.site || p.name].filter(Boolean).join(' · ')}
                {taken.includes(p.id) && p.id !== site?.projectId ? ' (schon in dieser Woche)' : ''}
              </option>
            ))}
            {fresh && !projects.some((p) => p.id === fresh.projectId) && (
              <option value={fresh.projectId ?? ''}>{[fresh.number, fresh.name].filter(Boolean).join(' · ')}</option>
            )}
            {mayCreate && <option value="__new">+ Neues Projekt …</option>}
          </select>
        </label>
        {!projects.length && !mayCreate && <p className="muted small">Noch keine Projekte – Projekte legt Admin oder Büro an.</p>}
        {fields && (
          <p className="muted small" data-testid="site-preview">
            {[fields.number, fields.name].filter(Boolean).join(' · ')}
            {fields.address ? ` · ${fields.address}` : ''}
          </p>
        )}
        {show && !projectId && <p className="error small">Bitte ein Projekt wählen.</p>}
        {projectId && (
          <div className="field site-manager" data-testid="site-manager">
            <span>Projektleiter</span>
            <select
              value={plMode}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return setPl(null);
                if (v === 'other') return setPl({ workerId: null, name: pl?.workerId ? '' : (pl?.name ?? ''), phone: pl?.workerId ? '' : (pl?.phone ?? '') });
                const w = workers.find((x) => x.id === v);
                if (w) setPl({ workerId: w.id, name: workerName(w), phone: w.phone ?? '' });
              }}
              data-testid="site-manager-select"
            >
              <option value="">– keiner –</option>
              {leads.map((w) => (
                <option key={w.id} value={w.id}>
                  {workerName(w)}
                  {w.grade && w.grade !== 'projektleiter' ? ` (${gradeLabel(w.grade)})` : ''}
                </option>
              ))}
              {plMode === 'other' && <option value="other">{pl?.name || 'Andere Person'}</option>}
            </select>
            {pl && (
              <span className="site-manager-fields">
                {plMode === 'other' && <input value={pl.name} onChange={(e) => setPl({ ...pl, name: e.target.value })} placeholder="Name" aria-label="Name des Projektleiters" data-testid="site-manager-name" />}
                <input value={pl.phone} onChange={(e) => setPl({ ...pl, phone: e.target.value })} placeholder="Handynummer" type="tel" inputMode="tel" aria-label="Handynummer des Projektleiters" data-testid="site-manager-phone" />
              </span>
            )}
            {!leads.length && (
              <p className="muted small" data-testid="site-manager-none">
                Noch niemand mit der Qualifikation „Projektleiter“ – im Personal bei der Person die Qualifikation Projektleiter wählen.
              </p>
            )}
            <p className="muted small">Gilt für das Projekt in jeder Woche (auch im PDF und im Bautagesbericht).</p>
          </div>
        )}
        {site && (
          <div className="field site-manager" data-testid="site-deputy">
            <label className="check-row">
              <input type="checkbox" checked={deputy.on} onChange={(e) => setDeputy({ ...deputy, on: e.target.checked })} data-testid="site-deputy-on" />
              <span>Vertretung des Projektleiters nur in dieser Woche</span>
            </label>
            {deputy.on && (
              <span className="site-manager-fields">
                <input value={deputy.name} onChange={(e) => setDeputy({ ...deputy, name: e.target.value })} placeholder="Name" aria-label="Name der Vertretung" data-testid="site-deputy-name" />
                <input value={deputy.phone} onChange={(e) => setDeputy({ ...deputy, phone: e.target.value })} placeholder="Handynummer" type="tel" inputMode="tel" aria-label="Handynummer der Vertretung" data-testid="site-deputy-phone" />
              </span>
            )}
          </div>
        )}
        <p className="muted small">Alle Projekte des Registers stehen zur Auswahl – egal, in welchem Werkzeug sie angelegt wurden.</p>
        <button type="submit" hidden />
      </form>
      {creating && (
        <PhotoSiteDialog
          onClose={() => setCreating(false)}
          onSaved={(ps) => {
            setCreating(false);
            setFresh(ps);
            setProjectId(ps.projectId ?? '');
            void onProjectCreated();
          }}
        />
      )}
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
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const shown = needle ? workers.filter((w) => [workerName(w), w.role ?? '', w.staffNo ?? '', gradeLabel(knownGrade(w) ?? undefined)].join(' ').toLowerCase().includes(needle)) : workers;
  /** immer zusätzlich hier einteilen: wer schon auf einer anderen Baustelle ist, bleibt dort (wird gekennzeichnet) */
  const keep = true;
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
      {workers.length > 0 && (
        <label className="crew-search crew-pick-search">
          <Icon name="select" size={18} />
          <span className="sr-only">Arbeiter suchen</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Arbeiter suchen: Name, Qualifikation, Nr." data-testid="assign-search" />
        </label>
      )}
      {needle && shown.length === 0 && <p className="muted small">Kein Arbeiter gefunden.</p>}
      <ul className="crew-pick">
        {shown.map((w) => {
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
                  {knownGrade(w) && <span className="muted small"> · {gradeLabel(knownGrade(w)!)}</span>}
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
  weekId,
  days,
  absences,
  name,
  workerId,
  siteId,
  day,
  infoOf,
  styleOf,
  onToggleDay,
  onRemove,
  onRemoveWeek,
  onMove,
  onAbsence,
  onClose,
}: {
  plan: WeekPlan;
  weekId: string;
  days: number[];
  absences: Absence[];
  name: string;
  workerId: string;
  siteId: string;
  day: number;
  /** Angaben und Farbe eines Projekts wie in der Einteilung (Kostenstelle/Nummer, Name, Adresse) */
  infoOf(s: WeekSite): ProjectLabelInfo;
  styleOf(s: WeekSite): CSSProperties;
  onToggleDay(day: number, on: boolean): void;
  onRemove(): void;
  onRemoveWeek(): void;
  onMove(to: string, keep: boolean): void;
  onAbsence(kind: Absence['kind']): void;
  onClose(): void;
}) {
  const site = plan.sites.find((s) => s.id === siteId);
  const others = plan.sites.filter((s) => s.id !== siteId && !s.paused);
  /** Zielprojekt: über „Projekt auswählen“ (eigenes Fenster mit Suche) */
  const [to, setTo] = useState('');
  const [picking, setPicking] = useState(false);
  const targetSite = others.find((s) => s.id === to) ?? null;
  const target = targetSite?.id ?? '';
  const [keep, setKeep] = useState(false);
  const also = sitesOf(plan, workerId, day, siteId);
  return (
    <Modal title={name} onClose={onClose} testId="chip-dialog">
      <div className="crew-chip-actions">
        <div className="crew-chip-week" data-testid="chip-week">
          <span className="muted small">
            Tage auf <strong>{site?.name}</strong> – antippen zum Ein-/Austragen
          </span>
          <div className="crew-chip-days">
            {days.map((d) => {
              const on = !!site?.days[d].includes(workerId);
              const elsewhere = sitesOf(plan, workerId, d, siteId);
              const abs = absenceOn(absences, workerId, weekId, d);
              return (
                <button
                  key={d}
                  type="button"
                  className={`crew-chip-day${on ? ' on' : ''}${d === day ? ' today' : ''}${abs ? ` ${abs === 'krank' ? 'sick' : 'away'}` : ''}`}
                  aria-pressed={on}
                  onClick={() => onToggleDay(d, !on)}
                  data-testid="chip-day"
                  data-day={d}
                  title={elsewhere.length ? `Auf: ${elsewhere.map((x) => x.name).join(', ')}` : undefined}
                >
                  <strong>{DAY_SHORT[d]}</strong>
                  <small>{dayDate(weekId, d)}</small>
                  {abs ? <small>{abs === 'krank' ? 'krank' : 'Urlaub'}</small> : elsewhere.length ? <small className="crew-chip-day-other">{elsewhere[0].name}</small> : null}
                </button>
              );
            })}
          </div>
        </div>
        {also.length > 0 && (
          <p className="banner banner-warn small" role="status" data-testid="chip-also-hint">
            Doppelt eingeteilt: {name} ist am {DAY_NAMES[day]} auch auf {also.map((x) => x.name).join(', ')}.
          </p>
        )}
        <div className="crew-chip-row">
          <button type="button" className="btn" onClick={() => onAbsence('urlaub')} data-testid="chip-urlaub">
            <Icon name="calendar" size={18} /> Urlaub
          </button>
          <button type="button" className="btn" onClick={() => onAbsence('krank')} data-testid="chip-krank">
            <Icon name="calendar" size={18} /> Krank
          </button>
        </div>
        {others.length > 0 && (
          <div className="crew-move">
            <span className="crew-move-label">Ab {DAY_NAMES[day]} auf anderes Projekt</span>
            {targetSite ? (
              <button type="button" className="picker-item pc-stripe crew-move-chosen" style={styleOf(targetSite)} onClick={() => setPicking(true)} data-testid="chip-move-pick" data-site={targetSite.name}>
                <ProjectHeading info={infoOf(targetSite)} />
                <span className="crew-move-change">Ändern</span>
              </button>
            ) : (
              <button type="button" className="btn crew-move-pick" onClick={() => setPicking(true)} data-testid="chip-move-pick">
                <Icon name="select" size={18} /> Projekt auswählen
              </button>
            )}
            <label className="check-row small">
              <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} data-testid="chip-move-keep" />
              Zusätzlich (doppelt) – auf diesem Projekt bleiben
            </label>
            <button type="button" className="btn btn-primary" onClick={() => target && onMove(target, keep)} disabled={!target} data-testid="chip-move">
              {keep ? 'Zusätzlich einteilen' : 'Umsetzen'}
            </button>
          </div>
        )}
        <div className="crew-chip-row">
          <button type="button" className="btn" onClick={onRemove} data-testid="chip-remove">
            <Icon name="close" size={18} /> Nur am {DAY_SHORT[day]} entfernen
          </button>
          <button type="button" className="btn btn-danger-text" onClick={onRemoveWeek} data-testid="chip-remove-week">
            <Icon name="trash" size={18} /> Ganze Woche entfernen
          </button>
        </div>
      </div>
      {picking && (
        <MovePicker
          sites={others}
          infoOf={infoOf}
          styleOf={styleOf}
          onClose={() => setPicking(false)}
          onPick={(id) => {
            setTo(id);
            setPicking(false);
          }}
        />
      )}
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
  onAbsence(kind: Absence['kind']): void;
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
        {!plan.sites.length && <p className="muted">Noch kein Projekt in dieser Woche.</p>}
        <div className="crew-chip-row">
          <button type="button" className="btn" onClick={() => onAbsence('urlaub')} data-testid="open-absence">
            <Icon name="calendar" size={18} /> Urlaub
          </button>
          <button type="button" className="btn" onClick={() => onAbsence('krank')} data-testid="open-krank">
            <Icon name="calendar" size={18} /> Krank
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Tagesliste: Tag wählen */
function DayListDialog({ site, days, weekId, onPick, onClose }: { site: WeekSite; days: number[]; weekId: string; onPick(day: number): void; onClose(): void }) {
  return (
    <Modal title={`Tagesliste: ${site.name}`} onClose={onClose} testId="daylist-dialog">
      <p className="muted small">Liste der Arbeiter dieses Tages mit Tätigkeit und Telefon – zum Ausdrucken für das Projekt.</p>
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
            ? 'Im Urlaub wird der Arbeiter an diesen Tagen vom Projekt genommen.'
            : 'Krank: bleibt auf seinem Projekt eingeteilt und wird dort als krank markiert.'}
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

/** Zielprojekt zum Umsetzen wählen: Fenster wie „Projekt“ in allen Werkzeugen – Suche, je Projekt Kostenstelle/Nummer, Name, Adresse */
function MovePicker({ sites, infoOf, styleOf, onPick, onClose }: { sites: WeekSite[]; infoOf(s: WeekSite): ProjectLabelInfo; styleOf(s: WeekSite): CSSProperties; onPick(id: string): void; onClose(): void }) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const list = sites
    .map((s) => ({ s, info: infoOf(s) }))
    .filter(({ s, info }) => !needle || [projectPrefix(info), info.name, projectSubline(info), s.name, s.number ?? '', s.address ?? ''].join(' ').toLowerCase().includes(needle))
    .sort((a, b) => naturalCompare(projectPrefix(a.info) || '~', projectPrefix(b.info) || '~') || a.info.name.localeCompare(b.info.name, 'de'));
  return (
    <Modal title="Projekt auswählen" onClose={onClose} testId="move-picker">
      <div className="picker">
        <label className="crew-search picker-search">
          <Icon name="select" size={18} />
          <span className="sr-only">Suchen</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Kostenstelle, Projektnummer, Name, Adresse …" autoComplete="off" data-autofocus data-testid="move-picker-search" />
        </label>
        {list.length === 0 && (
          <p className="muted small" data-testid="move-picker-empty">
            Kein Projekt gefunden.
          </p>
        )}
        <ul className="picker-list">
          {list.map(({ s, info }) => (
            <li key={s.id}>
              <button type="button" className="picker-item pc-stripe" style={styleOf(s)} onClick={() => onPick(s.id)} data-testid="move-picker-item" data-site={s.name}>
                <ProjectHeading info={info} />
                <Icon name="next" size={18} />
              </button>
            </li>
          ))}
        </ul>
        <p className="muted small">Nur Projekte dieser Woche. Antippen wählt das Projekt – danach „Umsetzen“.</p>
      </div>
    </Modal>
  );
}
