import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ActionMenu } from '../components/ActionMenu';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { SiteNav } from '../components/SiteNav';
import { ToolIcon } from '../components/ToolIcon';
import { offerFile, showError, toast } from '../components/ui';
import { exportReportsBackup, importReportsBackup } from '../lib/report-backup';
import { listProjects, listReports, listWeeks, loadProjectData, saveReport } from '../lib/db';
import { navigate, paths } from '../lib/router';
import { emptyHead, fmtDate, headFromProject, newReport, REPORT_TYPES, siteKey, siteLabel, today, typeInfo } from '../lib/reports';
import type { Project, Report, ReportType } from '../lib/types';
import { usePageTitle } from './SitePages';

export const ACCENT = { '--tool': '#a259ff' } as CSSProperties;

/** Baustelle für einen neuen Bericht: Projekt aus Aufmaß & Abrechnung oder frei (Name) */
export type SiteChoice = { projectId: string; name: string } | { projectId: null; name: string };

/** Projekte und freie Baustellen (Arbeitereinteilung, bisherige Berichte) für den Dialog „Neuer Bericht“ */
export async function loadReportSites(reports: Report[]): Promise<{ projects: Project[]; freeSites: string[] }> {
  const [projects, weeks] = await Promise.all([listProjects(), listWeeks()]);
  const names = new Map<string, string>();
  for (const w of weeks) for (const s of w.sites) if (!s.projectId && s.name.trim()) names.set(s.name.trim().toLowerCase(), s.name.trim());
  for (const x of reports) if (!x.projectId && siteLabel(x)) names.set(siteLabel(x).toLowerCase(), siteLabel(x));
  return { projects, freeSites: [...names.values()].sort((a, b) => a.localeCompare(b, 'de')) };
}

/** Neuen Bericht anlegen (Kopf aus dem Projekt) und zur Bearbeitung wechseln */
export async function createReport(type: ReportType, site: SiteChoice, date: string, all: Report[]): Promise<void> {
  let head = { ...emptyHead(), site: site.name, project: site.name };
  if (site.projectId) {
    const d = await loadProjectData(site.projectId);
    if (d) head = headFromProject(d.project, d.costCenters.filter((c) => !c.deletedAt).sort((a, b) => a.sortIndex - b.sortIndex));
  }
  const r = newReport(type, { projectId: site.projectId, head, date, all });
  await saveReport(r);
  navigate(paths.report(r.id));
}

interface SiteCard {
  key: string;
  site: SiteChoice;
  head: Report['head'];
  counts: Record<ReportType, number>;
  last: string;
  lastAt: number;
  open: number;
}

/**
 * Berichte & Formulare – Übersicht je Baustelle: Anzahl Regielisten, Tagesberichte und Wochenberichte,
 * letzter Bericht; Tippen öffnet die Berichte der Baustelle (getrennte Listen je Typ).
 */
export function ReportsPage() {
  usePageTitle('Berichte & Formulare – BauPad');
  const [reports, setReports] = useState<Report[] | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [freeSites, setFreeSites] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState<{ site?: SiteChoice } | null>(null);
  const restoreRef = useRef<HTMLInputElement>(null);

  const reload = () =>
    listReports()
      .then(async (r) => {
        setReports(r);
        const s = await loadReportSites(r);
        setProjects(s.projects);
        setFreeSites(s.freeSites);
      })
      .catch((e) => showError(e, 'Berichte konnten nicht geladen werden'));
  useEffect(() => {
    void reload();
  }, []);

  const q = query.trim().toLowerCase();
  const cards = useMemo(() => {
    const map = new Map<string, SiteCard>();
    for (const r of reports ?? []) {
      const key = siteKey(r);
      let c = map.get(key);
      if (!c) {
        c = { key, site: r.projectId ? { projectId: r.projectId, name: siteLabel(r) } : { projectId: null, name: siteLabel(r) }, head: r.head, counts: { regie: 0, tag: 0, woche: 0 }, last: r.date, lastAt: 0, open: 0 };
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
    return [...map.values()].filter((c) => !q || [c.site.name, c.head.project, c.head.number, c.head.client, c.head.address].some((t) => t?.toLowerCase().includes(q))).sort((a, b) => b.lastAt - a.lastAt);
  }, [reports, q]);

  const run = (fn: () => Promise<void>) => fn().catch((e) => showError(e, 'Das hat nicht geklappt'));

  return (
    <>
      <SiteNav />
      <div className="page reports-page">
        <header className="page-head page-head-row">
          <div className="page-head-title">
            <a href={paths.tools()} className="icon-link" aria-label="Zu den Tools" title="Zu den Tools" data-testid="to-tools">
              <Icon name="back" />
            </a>
            <h1 data-testid="reports-title">Berichte &amp; Formulare</h1>
          </div>
          <div className="report-actions">
            <button type="button" className="btn btn-primary" onClick={() => setCreating({})} data-testid="report-new">
              <Icon name="plus" /> Neuer Bericht
            </button>
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

        {reports && reports.length > 0 && (
          <div className="reports-tools">
            <label className="crew-search reports-search">
              <Icon name="select" size={18} />
              <span className="sr-only">Suchen</span>
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Baustelle, Nummer oder Auftraggeber suchen" data-testid="report-search" />
            </label>
          </div>
        )}

        {reports && reports.length === 0 && (
          <div className="crew-setup" style={ACCENT} data-testid="reports-empty">
            <span className="tile-icon">
              <ToolIcon name="reports" size={22} />
            </span>
            <div>
              <strong>Noch keine Berichte</strong>
              <p className="muted small">Regieliste, Bautagesbericht oder Bauwochenbericht anlegen – Baustelle, Adresse und Mannschaft werden übernommen.</p>
            </div>
            <button type="button" className="btn btn-primary" onClick={() => setCreating({})}>
              Anlegen
            </button>
          </div>
        )}
        {reports && reports.length > 0 && cards.length === 0 && <p className="muted">Keine Baustelle gefunden.</p>}

        <div className="report-sites">
          {cards.map((c) => {
            const total = c.counts.regie + c.counts.tag + c.counts.woche;
            return (
              <a key={c.key} href={paths.reportSite(c.key)} className="report-site" data-testid="report-site" data-site={c.site.name}>
                <div className="report-site-main">
                  <strong>{c.site.name}</strong>
                  <span className="muted small">{[c.head.number, c.head.address, c.head.client].filter(Boolean).join(' · ')}</span>
                  <span className="small">
                    {total} {total === 1 ? 'Bericht' : 'Berichte'} · zuletzt {fmtDate(c.last, false)}
                    {c.open > 0 && <span className="rp-badge"> {c.open} offen</span>}
                  </span>
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
        </div>
      </div>
      {creating && (
        <NewReportDialog
          projects={projects}
          freeSites={freeSites}
          site={creating.site}
          onClose={() => setCreating(null)}
          onCreate={(type, site, date) => run(() => createReport(type, site, date, reports ?? []))}
        />
      )}
    </>
  );
}

/** Neuer Bericht: Typ, Baustelle (Projekt oder frei) und Datum */
export function NewReportDialog({
  projects,
  freeSites,
  site,
  onCreate,
  onClose,
}: {
  projects: Project[];
  freeSites: string[];
  site?: SiteChoice;
  onCreate(type: ReportType, site: SiteChoice, date: string): void;
  onClose(): void;
}) {
  const [type, setType] = useState<ReportType>('regie');
  // Auswahl: „p:<id>“, „n:<Name>“ oder „neu“ (frei eingeben)
  const [choice, setChoice] = useState(site ? (site.projectId ? `p:${site.projectId}` : `n:${site.name}`) : projects[0] ? `p:${projects[0].id}` : freeSites[0] ? `n:${freeSites[0]}` : 'neu');
  const [name, setName] = useState('');
  const [date, setDate] = useState(today());
  const [error, setError] = useState('');
  const submit = () => {
    let s: SiteChoice;
    if (choice.startsWith('p:')) {
      const p = projects.find((x) => x.id === choice.slice(2));
      if (!p) return setError('Bitte eine Baustelle wählen.');
      s = { projectId: p.id, name: p.site || p.name };
    } else if (choice.startsWith('n:')) s = { projectId: null, name: choice.slice(2) };
    else {
      if (!name.trim()) return setError('Bitte die Baustelle eingeben.');
      s = { projectId: null, name: name.trim() };
    }
    if (!date) return setError('Bitte ein Datum wählen.');
    onCreate(type, s, date);
  };
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
        {REPORT_TYPES.map((t) => (
          <button key={t.type} type="button" role="radio" aria-checked={type === t.type} className={`report-type-card${type === t.type ? ' active' : ''}`} onClick={() => setType(t.type)} data-testid={`report-type-${t.type}`}>
            <span className={`report-type t-${t.type}`}>{t.short}</span>
            <strong>{t.label}</strong>
            <span className="muted small">{t.type === 'regie' ? 'Regiearbeiten mit Stunden je Arbeiter' : t.type === 'tag' ? 'Tägliche Dokumentation der Baustelle' : 'Zusammenfassung einer Woche (Mo–So)'}</span>
          </button>
        ))}
      </div>
      <label className="field">
        <span>Baustelle</span>
        <select value={choice} onChange={(e) => setChoice(e.target.value)} data-testid="report-site">
          {projects.length > 0 && (
            <optgroup label="Aus Aufmaß & Abrechnung">
              {projects.map((p) => (
                <option key={p.id} value={`p:${p.id}`}>
                  {[p.number, p.site || p.name].filter(Boolean).join(' · ')}
                </option>
              ))}
            </optgroup>
          )}
          {freeSites.length > 0 && (
            <optgroup label="Weitere Baustellen">
              {freeSites.map((n) => (
                <option key={n} value={`n:${n}`}>
                  {n}
                </option>
              ))}
            </optgroup>
          )}
          <option value="neu">Andere Baustelle eingeben …</option>
        </select>
      </label>
      {choice === 'neu' && (
        <label className="field">
          <span>Baustelle *</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Neubau Musterstraße" data-testid="report-site-name" />
        </label>
      )}
      <label className="field">
        <span>{typeInfo(type).period === 'week' ? 'Woche (beliebiger Tag der Woche)' : 'Datum'}</span>
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
