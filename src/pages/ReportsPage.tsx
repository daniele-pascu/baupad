import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ActionMenu } from '../components/ActionMenu';
import { projectPrefix } from '../lib/project-label';
import { SortControl } from '../components/SortControl';
import { sortList, useListSort } from '../lib/list-sort';
import { ProjectHeading } from '../components/ProjectHeading';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { SiteNav } from '../components/SiteNav';
import { ToolIcon, ToolMark } from '../components/ToolIcon';
import { offerFile, showError, toast } from '../components/ui';
import { exportReportsBackup, importReportsBackup } from '../lib/report-backup';
import { listFormEntries, listPhotos, listReports, loadProjectData, saveReport } from '../lib/db';
import { navigate, paths } from '../lib/router';
import { emptyHead, fmtDate, headFromProject, newReport, REPORT_TYPES, siteKey, siteLabel, today, typeInfo } from '../lib/reports';
import type { PhotoSite, Report, ReportType } from '../lib/types';
import { PhotoSitePicker, siteValue } from '../components/PhotoSitePicker';
import { loadPhotoSites } from './PhotosPage';
import { usePageTitle } from '../lib/page-title';
import { useAccess } from '../lib/access';
import { usedIn } from '../lib/crew-link';
import { useCanCreateProjects, useProjectIn } from '../lib/sites';
import { ProjectPicker } from '../components/ProjectPicker';
import { listFormTemplates } from '../lib/db';
import { isCustomTemplate, type FormTemplate } from '../lib/form-template';
import { entrySiteKey, type FormEntry } from '../lib/forms';
import { useDataChanged } from '../lib/data-events';
import { pcStyle, useProjectColors } from '../lib/project-colors';

export const ACCENT = { '--tool': '#a259ff' } as CSSProperties;

/** Projekt für einen neuen Bericht: aus Aufmaß & Abrechnung (projectId) oder frei angelegt (Name, Adresse) */
export type SiteChoice = { projectId: string | null; name: string; address?: string };

/** Alle Projekte für den Dialog „Neuer Bericht“ – dieselbe Liste wie in Fotos und Mängelplan (alle Werkzeuge) */
export async function loadReportSites(): Promise<PhotoSite[]> {
  return loadPhotoSites(await listPhotos());
}

/** Neuen Bericht anlegen (Kopf aus dem Projekt) und zur Bearbeitung wechseln */
export async function createReport(type: ReportType, site: SiteChoice, date: string, all: Report[]): Promise<void> {
  let head = { ...emptyHead(), site: site.name, project: site.name, address: site.address ?? '' };
  if (site.projectId) {
    const d = await loadProjectData(site.projectId);
    if (d) head = headFromProject(d.project, d.costCenters.filter((c) => !c.deletedAt).sort((a, b) => a.sortIndex - b.sortIndex));
  }
  const r = newReport(type, { projectId: site.projectId, head, date, all });
  await saveReport(r);
  await useProjectIn(site.projectId, 'reports');
  navigate(paths.report(r.id));
}

interface SiteCard {
  key: string;
  site: SiteChoice;
  head: Report['head'];
  counts: Record<ReportType, number>;
  /** ausgefüllte Firmenformulare je Vorlage */
  forms: Map<string, { name: string; count: number }>;
  last: string;
  lastAt: number;
  open: number;
}

/**
 * Berichte & Formulare – Übersicht je Baustelle: Anzahl Regielisten, Tagesberichte und Wochenberichte,
 * letzter Bericht; Tippen öffnet die Berichte der Baustelle (getrennte Listen je Typ).
 */
type ReportSort = 'changed' | 'number' | 'name';
const REPORT_SORT_LABELS: Record<ReportSort, string> = { changed: 'Zuletzt bearbeitet', number: 'Kostenstelle / Projektnr.', name: 'Name' };

export function ReportsPage() {
  // Sortierung je Person gemerkt (Art + Richtung)
  const [sort, setSort] = useListSort<ReportSort>('reports-sites', REPORT_SORT_LABELS, { key: 'changed', dir: 'desc' });
  const access = useAccess();
  usePageTitle('Berichte & Formulare – BauPad');
  const colorOf = useProjectColors();
  const [reports, setReports] = useState<Report[] | null>(null);
  const [entries, setEntries] = useState<FormEntry[]>([]);
  const [allSites, setAllSites] = useState<PhotoSite[]>([]);
  const sites = useMemo(() => access.filterSites(allSites, (s) => (s.projectId ? `p:${s.projectId}` : `n:${s.name.trim().toLowerCase()}`)), [allSites, access.session]);
  const [query, setQuery] = useState('');
  const restoreRef = useRef<HTMLInputElement>(null);

  const reload = () =>
    Promise.all([listReports(), listFormEntries()])
      .then(async ([r, e]) => {
        setEntries(e);
        setReports(r);
        setAllSites(await loadReportSites());
      })
      .catch((e) => showError(e, 'Berichte konnten nicht geladen werden'));
  useEffect(() => {
    void reload();
  }, []);
  useDataChanged(() => void reload());

  const q = query.trim().toLowerCase();
  const cards = useMemo(() => {
    const map = new Map<string, SiteCard>();
    for (const r of reports ?? []) {
      const key = siteKey(r);
      let c = map.get(key);
      if (!c) {
        c = { key, site: r.projectId ? { projectId: r.projectId, name: siteLabel(r) } : { projectId: null, name: siteLabel(r) }, head: r.head, counts: { regie: 0, tag: 0, woche: 0 }, forms: new Map(), last: r.date, lastAt: 0, open: 0 };
        map.set(key, c);
      }
      c.counts[r.type]++;
      if (r.date > c.last) c.last = r.date;
      if (r.updatedAt > c.lastAt) {
        c.lastAt = r.updatedAt;
        c.head = r.head;
      }
      if (r.status !== 'done') c.open++;
    }
    for (const e of entries) {
      const key = entrySiteKey(e);
      let c = map.get(key);
      if (!c) {
        c = { key, site: { projectId: e.projectId, name: e.siteName }, head: { ...emptyHead(), site: e.siteName, project: e.siteName }, counts: { regie: 0, tag: 0, woche: 0 }, forms: new Map(), last: e.date, lastAt: 0, open: 0 };
        map.set(key, c);
      }
      const f = c.forms.get(e.templateId) ?? { name: e.templateName, count: 0 };
      f.count++;
      c.forms.set(e.templateId, f);
      if (e.date > c.last) c.last = e.date;
      if (e.updatedAt > c.lastAt) c.lastAt = e.updatedAt;
      if (e.status !== 'done') c.open++;
    }
    const list = [...map.values()]
      .filter((c) => access.canSite(c.key))
      .filter((c) => !q || [c.site.name, c.head.project, c.head.number, c.head.client, c.head.address].some((t) => t?.toLowerCase().includes(q)));
    return sortList(list, sort, { changed: (c) => c.lastAt, number: (c) => projectPrefix({ name: c.site.name, number: c.head.number, costCenter: c.head.costCenter }), name: (c) => c.site.name }, (a, b) => b.lastAt - a.lastAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reports, entries, q, sort, access.session]);
  /** in Berichten angelegte oder übernommene Projekte, die noch keinen Bericht haben */
  const emptySites = useMemo(() => {
    const have = new Set(cards.map((c) => c.key));
    return reports
      ? sites.filter((f) => (!f.projectId || usedIn(f, 'reports')) && !have.has(f.projectId ? `p:${f.projectId}` : `n:${f.name.trim().toLowerCase()}`) && (!q || [f.name, f.number, f.address].join(' ').toLowerCase().includes(q)))
      : [];
  }, [sites, cards, query, reports]);

  const run = (fn: () => Promise<void>) => fn().catch((e) => showError(e, 'Das hat nicht geklappt'));
  const mayCreate = useCanCreateProjects();
  /** Fenster „Projekt“: aus dem Register übernehmen oder neu anlegen (wie in allen Werkzeugen) */
  const [picking, setPicking] = useState(false);
  /** hinterlegte Firmenformulare (Konto → Firmeninformationen) – PDFs der Berichte werden damit ausgegeben */
  const [templates, setTemplates] = useState<FormTemplate[] | null>(null);
  useEffect(() => {
    void listFormTemplates().then(setTemplates).catch(() => setTemplates([]));
  }, []);
  const customTemplates = (templates ?? []).filter((t) => isCustomTemplate(t) && (t.fields?.length ?? 0) > 0);
  const reportTemplates = (templates ?? []).filter((t) => !isCustomTemplate(t));
  const anyData = (reports?.length ?? 0) + entries.length > 0;

  return (
    <>
      <SiteNav />
      <div className="page reports-page">
        <header className="page-head page-head-row">
          <div className="page-head-title">
            <a href={paths.tools()} className="icon-link" aria-label="Zu den Tools" title="Zu den Tools" data-testid="to-tools">
              <Icon name="back" />
            </a>
            <ToolMark name="reports" />
            <h1 data-testid="reports-title">Berichte &amp; Formulare</h1>
          </div>
          <div className="report-actions">
            <button type="button" className="btn btn-primary" onClick={() => setPicking(true)} title="Projekt aus dem Register übernehmen oder neu anlegen" data-testid="report-new-site">
              <Icon name="plus" size={16} /> <span className="hide-sm">{mayCreate ? 'Neues Projekt' : 'Projekt übernehmen'}</span>
            </button>
            <a href={paths.formTemplates()} className="btn" title="Formularvorlagen der Firma: PDF hochladen, Felder einrichten" data-testid="reports-templates">
              <Icon name="file" size={16} /> <span className="hide-sm">Vorlagen</span>
            </a>
            <ActionMenu
              label="Sicherung"
              testId="reports-more"
              actions={[
                { label: 'Sicherung speichern (alle Berichte)', icon: 'download', onSelect: () => run(async () => offerFile(await exportReportsBackup())), testId: 'reports-backup' },
                { label: 'Sicherung öffnen …', icon: 'upload', onSelect: () => restoreRef.current?.click(), testId: 'reports-restore' },
              ]}
            />
            <input
              ref={restoreRef}
              type="file"
              accept=".json,application/json"
              hidden
              data-testid="reports-restore-input"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f)
                  void run(async () => {
                    const n = await importReportsBackup(f);
                    await reload();
                    toast(n ? `${n} Bericht(e) übernommen.` : 'Alle Berichte waren schon aktuell.', 'success');
                  });
              }}
            />
          </div>
        </header>

        {picking && (
          <ProjectPicker
            tool="reports"
            onClose={() => setPicking(false)}
            onPick={(p) => {
              setPicking(false);
              // direkt ins Projekt – dort wird der Bericht angelegt
              void reload().then(() => navigate(paths.reportSite(`p:${p.id}`)));
            }}
          />
        )}
        {templates && (
          <p className="muted small reports-forms-hint" data-testid="reports-forms-hint">
            {customTemplates.length > 0 && <>Firmenformulare zum Ausfüllen: {customTemplates.map((t) => t.name).join(', ')}. </>}
            {reportTemplates.length > 0 && <>Für BauPad-Berichte: {reportTemplates.map((t) => `${t.name} (${typeInfo(t.type).label})`).join(', ')} – die PDFs dieser Berichte werden damit ausgegeben. </>}
            {templates.length === 0 && <>Eigene Formulare der Firma (Regieliste, Stundenzettel, Materialliste …) als PDF hinterlegen, Felder einrichten und im Projekt digital ausfüllen. </>}
            <a href={paths.formTemplates()}>Vorlagen verwalten</a>
          </p>
        )}

        {reports && anyData && (
          <div className="reports-tools">
            <label className="crew-search reports-search">
              <Icon name="select" size={18} />
              <span className="sr-only">Suchen</span>
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Baustelle, Nummer oder Auftraggeber suchen" data-testid="report-search" />
            </label>
            <SortControl value={sort} labels={REPORT_SORT_LABELS} onChange={setSort} newestFirst={['changed']} testId="report-sort" />
          </div>
        )}

        {reports && !anyData && emptySites.length === 0 && (
          <div className="crew-setup" style={ACCENT} data-testid="reports-empty">
            <span className="tile-icon">
              <ToolIcon name="reports" size={22} />
            </span>
            <div>
              <strong>Noch kein Projekt</strong>
              <p className="muted small">Projekt anlegen oder aus dem Register übernehmen – im Projekt dann Regieliste, Bautagesbericht oder Bauwochenbericht anlegen. Baustelle, Adresse und Mannschaft werden übernommen.</p>
            </div>
            <button type="button" className="btn btn-primary" onClick={() => setPicking(true)}>
              {mayCreate ? 'Neues Projekt' : 'Projekt übernehmen'}
            </button>
          </div>
        )}
        {reports && anyData && cards.length === 0 && emptySites.length === 0 && <p className="muted">Keine Baustelle gefunden.</p>}

        <div className="report-sites">
          {cards.map((c) => {
            const total = c.counts.regie + c.counts.tag + c.counts.woche;
            const forms = [...c.forms.values()];
            const formsTotal = forms.reduce((n, f) => n + f.count, 0);
            return (
              <a key={c.key} href={paths.reportSite(c.key)} className="report-site pc-stripe" style={pcStyle(colorOf(c.key))} data-testid="report-site" data-site={c.site.name}>
                <div className="report-site-main">
                  <ProjectHeading info={{ name: c.site.name, number: c.head.number, costCenter: c.head.costCenter, address: c.head.address, client: c.head.client }} />
                  <span className="small">
                    {[total ? `${total} ${total === 1 ? 'Bericht' : 'Berichte'}` : '', formsTotal ? `${formsTotal} ${formsTotal === 1 ? 'Formular' : 'Formulare'}` : ''].filter(Boolean).join(' · ')} · zuletzt {fmtDate(c.last, false)}
                    {c.open > 0 && <span className="rp-badge"> {c.open} offen</span>}
                  </span>
                  {forms.length > 0 && (
                    <span className="small muted" data-testid="report-site-forms">
                      {forms.map((f) => `${f.count} × ${f.name}`).join(' · ')}
                    </span>
                  )}
                </div>
                <div className="report-site-counts">
                  {REPORT_TYPES.map((t) => (
                    <span key={t.type} className={`report-count${c.counts[t.type] ? '' : ' empty'}`} title={t.plural}>
                      <span className={`report-type t-${t.type}`}>{t.short}</span>
                      <span>{c.counts[t.type]}</span>
                    </span>
                  ))}
                </div>
                <Icon name="next" size={18} />
              </a>
            );
          })}
          {emptySites.map((f) => (
            <a
              key={`empty:${f.projectId ?? f.name}`}
              href={paths.reportSite(f.projectId ? `p:${f.projectId}` : `n:${f.name.trim().toLowerCase()}`)}
              className="report-site report-site-empty pc-stripe"
              style={pcStyle(colorOf(f.projectId ? `p:${f.projectId}` : `n:${f.name.trim().toLowerCase()}`))}
              data-testid="report-site-empty"
              data-site={f.name}
            >
              <div className="report-site-main">
                <ProjectHeading info={f} />
                <span className="small muted">Noch kein Bericht</span>
              </div>
              <Icon name="next" size={18} />
            </a>
          ))}
        </div>
      </div>
    </>
  );
}

/** Neuer Bericht: Typ, Projekt (Auswahl wie in allen Werkzeugen, „+ Neues Projekt …“) und Datum */
export function NewReportDialog({
  sites,
  site,
  onCreate,
  onClose,
  templates: allTemplates = [],
  reportTemplates,
  onCreateForm,
}: {
  sites: PhotoSite[];
  site?: SiteChoice;
  onCreate(type: ReportType, site: SiteChoice, date: string): void;
  onClose(): void;
  /** freie Firmenformulare (Vorlagen) – erscheinen als weitere Karten */
  templates?: FormTemplate[];
  onCreateForm?(t: FormTemplate, site: SiteChoice, date: string): void;
  /** hinterlegte Firmenformulare für BauPad-Berichte – dann erscheinen nur diese Berichtsarten */
  reportTemplates?: FormTemplate[];
}) {
  // nur verfügbare Firmenformulare: eingerichtet (mindestens ein Feld)
  const templates = allTemplates.filter((t) => (t.fields?.length ?? 0) > 0);
  // nur angelegte Formulare: BauPad-Berichte mit hinterlegtem Firmenformular + eingerichtete eigene Formulare;
  // ist noch gar nichts angelegt, die BauPad-Berichte, damit man überhaupt etwas anlegen kann
  const rt = reportTemplates ?? [];
  const withForm = REPORT_TYPES.filter((t) => rt.some((x) => x.type === t.type));
  const types = reportTemplates === undefined || (!withForm.length && !templates.length) ? REPORT_TYPES : withForm;
  const [type, setType] = useState<string>(() => types[0]?.type ?? (templates[0] ? `tpl:${templates[0].id}` : 'regie'));
  const [list, setList] = useState(sites);
  useEffect(() => setList(sites), [sites]);
  const [chosen, setChosen] = useState<PhotoSite | null>(() => {
    if (site) return sites.find((s) => (site.projectId ? s.projectId === site.projectId : !s.projectId && s.name.toLowerCase() === site.name.toLowerCase())) ?? { projectId: site.projectId, name: site.name, number: '', address: site.address ?? '' };
    return sites[0] ?? null;
  });
  const [date, setDate] = useState(today());
  const [error, setError] = useState('');
  const submit = () => {
    if (!chosen) return setError('Bitte ein Projekt wählen.');
    if (!date) return setError('Bitte ein Datum wählen.');
    const s = { projectId: chosen.projectId, name: chosen.name, address: chosen.address };
    const tpl = templates.find((t) => `tpl:${t.id}` === type);
    if (tpl) return onCreateForm?.(tpl, s, date);
    onCreate(type as ReportType, s, date);
  };
  const isReport = !type.startsWith('tpl:');
  return (
    <Modal
      title="Neuer Bericht"
      onClose={onClose}
      testId="report-new-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} data-testid="report-create">
            Anlegen
          </button>
        </>
      }
    >
      <div className="report-type-choice" role="radiogroup" aria-label="Berichtstyp">
        {types.map((t) => {
          const form = rt.find((x) => x.type === t.type);
          return (
            <button key={t.type} type="button" role="radio" aria-checked={type === t.type} className={`report-type-card${type === t.type ? ' active' : ''}`} onClick={() => setType(t.type)} data-testid={`report-type-${t.type}`}>
              <span className={`report-type t-${t.type}`}>{t.short}</span>
              <strong>{t.label}</strong>
              <span className="muted small">{form ? `Firmenformular: ${form.name}` : t.type === 'regie' ? 'Regiearbeiten mit Stunden je Arbeiter' : t.type === 'tag' ? 'Tägliche Dokumentation des Projekts' : 'Zusammenfassung einer Woche (Mo–So)'}</span>
            </button>
          );
        })}
        {templates.map((t) => {
          const n = (t.fields ?? []).length;
          return (
            <button key={t.id} type="button" role="radio" aria-checked={type === `tpl:${t.id}`} className={`report-type-card t-form${type === `tpl:${t.id}` ? ' active' : ''}`} onClick={() => setType(`tpl:${t.id}`)} data-testid="report-type-form" data-name={t.name}>
              <span className="report-type t-form">F</span>
              <strong>{t.name}</strong>
              <span className="muted small">
                Firmenformular · {n} {n === 1 ? 'Feld' : 'Felder'}
                {(t.fields ?? []).some((f) => f.required) ? `, ${(t.fields ?? []).filter((f) => f.required).length} Pflicht` : ''}
              </span>
            </button>
          );
        })}
      </div>
      <label className="field">
        <span>Projekt auswählen</span>
        <PhotoSitePicker sites={list} value={chosen} onChange={setChosen} onCreated={(s) => setList((l) => (l.some((x) => siteValue(x) === siteValue(s)) ? l : [...l, s]))} testId="report-site" />
      </label>
      <label className="field">
        <span>{isReport && typeInfo(type as ReportType).period === 'week' ? 'Woche (beliebiger Tag der Woche)' : 'Datum'}</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="report-date" />
      </label>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
