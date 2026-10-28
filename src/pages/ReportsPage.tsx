import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ActionMenu } from '../components/ActionMenu';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { PdfPreview } from '../components/PdfPreview';
import { SiteNav } from '../components/SiteNav';
import { ToolIcon } from '../components/ToolIcon';
import { confirmDialog, offerFile, showError, toast } from '../components/ui';
import { exportReportsBackup, importReportsBackup } from '../lib/report-backup';
import type { ExportFile } from '../lib/aufmass';
import { deleteReport, listProjects, listReports, listWeeks, loadProjectData, saveReport } from '../lib/db';
import { navigate, paths } from '../lib/router';
import { copyReport, emptyHead, headFromProject, newReport, periodLabel, REPORT_TYPES, siteKey, siteLabel, today, typeInfo } from '../lib/reports';
import { reportPdfFile } from './ReportEditorPage';
import type { Project, Report, ReportType } from '../lib/types';
import { usePageTitle } from './SitePages';

const ACCENT = { '--tool': '#a259ff' } as CSSProperties;
const TYPE_ORDER: Record<ReportType, number> = { regie: 0, tag: 1, woche: 2 };

/** Baustelle für einen neuen Bericht: Projekt aus Aufmaß & Abrechnung oder frei (Name) */
type SiteChoice = { projectId: string; name: string } | { projectId: null; name: string };

/**
 * Berichte & Formulare – Übersicht: gruppiert nach Baustelle (wichtigste Gruppierung), darin nach Datum
 * (neueste zuerst) und Typ; Filter nach Typ, Suche, neuer Bericht direkt für eine Baustelle.
 */
export function ReportsPage() {
  usePageTitle('Berichte & Formulare – BauPad');
  const [reports, setReports] = useState<Report[] | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [freeSites, setFreeSites] = useState<string[]>([]);
  const [filter, setFilter] = useState<ReportType | 'all'>('all');
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState<{ site?: SiteChoice } | null>(null);
  const [preview, setPreview] = useState<ExportFile | null>(null);
  const restoreRef = useRef<HTMLInputElement>(null);

  const reload = () =>
    Promise.all([listReports(), listProjects(), listWeeks()])
      .then(([r, p, weeks]) => {
        setReports(r);
        setProjects(p);
        // Baustellen ohne Projekt aus der Arbeitereinteilung und aus bisherigen Berichten
        const names = new Map<string, string>();
        for (const w of weeks) for (const s of w.sites) if (!s.projectId && s.name.trim()) names.set(s.name.trim().toLowerCase(), s.name.trim());
        for (const x of r) if (!x.projectId && siteLabel(x)) names.set(siteLabel(x).toLowerCase(), siteLabel(x));
        setFreeSites([...names.values()].sort((a, b) => a.localeCompare(b, 'de')));
      })
      .catch((e) => showError(e, 'Berichte konnten nicht geladen werden'));
  useEffect(() => {
    void reload();
  }, []);

  const q = query.trim().toLowerCase();
  const groups = useMemo(() => {
    const list = (reports ?? [])
      .filter((r) => filter === 'all' || r.type === filter)
      .filter((r) => !q || [typeInfo(r.type).label, r.no, siteLabel(r), r.head.project, r.head.number, r.head.client, periodLabel(r)].some((t) => t?.toLowerCase().includes(q)));
    const map = new Map<string, Report[]>();
    for (const r of list) map.set(siteKey(r), [...(map.get(siteKey(r)) ?? []), r]);
    return [...map.values()]
      .map((items) => items.sort((a, b) => b.date.localeCompare(a.date) || TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || (parseInt(b.no) || 0) - (parseInt(a.no) || 0)))
      .sort((a, b) => Math.max(...b.map((x) => x.updatedAt)) - Math.max(...a.map((x) => x.updatedAt)));
  }, [reports, filter, q]);

  const run = (fn: () => Promise<void>) => fn().catch((e) => showError(e, 'Das hat nicht geklappt'));
  const copy = (r: Report) =>
    run(async () => {
      const c = copyReport(r, r.type === 'woche' ? r.date : today(), reports ?? []);
      await saveReport(c);
      toast(`Kopie angelegt: ${typeInfo(c.type).label} Nr. ${c.no}.`, 'success');
      navigate(paths.report(c.id));
    });
  const remove = (r: Report) =>
    void confirmDialog({
      title: 'Bericht löschen?',
      message: (
        <p>
          {typeInfo(r.type).label} Nr. {r.no} vom {periodLabel(r)} wird endgültig gelöscht.
        </p>
      ),
      confirmLabel: 'Löschen',
      danger: true,
    }).then((ok) => {
      if (ok)
        void run(async () => {
          await deleteReport(r.id);
          await reload();
          toast('Bericht gelöscht.', 'success');
        });
    });

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

        <div className="reports-tools">
          <div className="segmented reports-filter" role="radiogroup" aria-label="Berichtstyp">
            {[{ type: 'all' as const, plural: 'Alle' }, ...REPORT_TYPES].map((t) => (
              <button key={t.type} type="button" role="radio" aria-checked={filter === t.type} aria-selected={filter === t.type} onClick={() => setFilter(t.type)} data-testid={`report-filter-${t.type}`}>
                {t.plural}
              </button>
            ))}
          </div>
          <label className="crew-search reports-search">
            <Icon name="select" size={18} />
            <span className="sr-only">Suchen</span>
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Baustelle, Nummer oder Datum suchen" data-testid="report-search" />
          </label>
        </div>

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
        {reports && reports.length > 0 && groups.length === 0 && <p className="muted">Keine Berichte gefunden.</p>}

        {groups.map((items) => {
          const first = items[0];
          const site: SiteChoice = first.projectId ? { projectId: first.projectId, name: siteLabel(first) } : { projectId: null, name: siteLabel(first) };
          return (
            <section key={siteKey(first)} className="report-group" data-testid="report-group" data-site={siteLabel(first)}>
              <header className="report-group-head">
                <div>
                  <h2>{siteLabel(first)}</h2>
                  <span className="muted small">{[first.head.number, first.head.address, first.head.client].filter(Boolean).join(' · ')}</span>
                </div>
                <button type="button" className="btn btn-sm" onClick={() => setCreating({ site })} data-testid="report-group-new">
                  <Icon name="plus" size={16} /> Neu
                </button>
              </header>
              <ul className="report-list">
                {items.map((r) => (
                  <li key={r.id} className="report-item" data-testid="report-item" data-type={r.type}>
                    <a href={paths.report(r.id)} className="report-link">
                      <span className={`report-type t-${r.type}`}>{typeInfo(r.type).short}</span>
                      <span className="report-main">
                        <strong>
                          {typeInfo(r.type).label} Nr. {r.no}
                        </strong>
                        <span className="muted small">{periodLabel(r)}</span>
                      </span>
                      <span className={`report-status ${r.status}`} data-testid="report-status">
                        {r.status === 'done' ? 'Fertig' : 'Entwurf'}
                      </span>
                    </a>
                    <ActionMenu
                      label={`Aktionen für ${typeInfo(r.type).label} Nr. ${r.no}`}
                      testId="report-actions"
                      actions={[
                        { label: 'Öffnen', icon: 'edit', onSelect: () => navigate(paths.report(r.id)), testId: 'report-open' },
                        { label: 'Kopieren als neuer Bericht', icon: 'copy', onSelect: () => copy(r), testId: 'report-copy' },
                        { label: 'PDF', icon: 'pdf', onSelect: () => run(async () => setPreview(await reportPdfFile(r))), testId: 'report-pdf' },
                        { label: 'Löschen', icon: 'trash', danger: true, onSelect: () => remove(r), testId: 'report-delete' },
                      ]}
                    />
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      {creating && (
        <NewReportDialog
          projects={projects}
          freeSites={freeSites}
          site={creating.site}
          onClose={() => setCreating(null)}
          onCreate={(type, site, date) =>
            run(async () => {
              let head = { ...emptyHead(), site: site.name, project: site.name };
              if (site.projectId) {
                const d = await loadProjectData(site.projectId);
                if (d) head = headFromProject(d.project, d.costCenters.filter((c) => !c.deletedAt).sort((a, b) => a.sortIndex - b.sortIndex));
              }
              const r = newReport(type, { projectId: site.projectId, head, date, all: reports ?? [] });
              await saveReport(r);
              navigate(paths.report(r.id));
            })
          }
        />
      )}
      {preview && <PdfPreview file={preview} onBack={() => setPreview(null)} onClose={() => setPreview(null)} />}
    </>
  );
}

/** Neuer Bericht: Typ, Baustelle (Projekt oder frei) und Datum */
function NewReportDialog({
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
