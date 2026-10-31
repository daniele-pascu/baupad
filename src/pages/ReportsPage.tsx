import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ActionMenu } from '../components/ActionMenu';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { ToolIcon } from '../components/ToolIcon';
import { offerFile, showError, toast } from '../components/ui';
import { exportReportsBackup, importReportsBackup } from '../lib/report-backup';
import { listPhotos, listReports, loadProjectData, saveReport } from '../lib/db';
import { navigate, paths } from '../lib/router';
import { emptyHead, fmtDate, headFromProject, newReport, REPORT_TYPES, siteKey, siteLabel, today, typeInfo } from '../lib/reports';
import type { PhotoSite, Report, ReportType } from '../lib/types';
import { PhotoSitePicker, siteValue } from '../components/PhotoSitePicker';
import { loadPhotoSites } from './PhotosPage';
import { usePageTitle } from '../lib/page-title';
import { useAccess } from '../lib/access';
import { usedIn } from '../lib/crew-link';
import { useProjectIn } from '../lib/sites';
import { listFormTemplates } from '../lib/db';
import type { FormTemplate } from '../lib/form-template';

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
  last: string;
  lastAt: number;
  open: number;
}

/**
 * Berichte & Formulare – Übersicht je Baustelle: Anzahl Regielisten, Tagesberichte und Wochenberichte,
 * letzter Bericht; Tippen öffnet die Berichte der Baustelle (getrennte Listen je Typ).
 */
export function ReportsPage() {
  const access = useAccess();
  usePageTitle('Berichte & Formulare – BauPad');
  const [reports, setReports] = useState<Report[] | null>(null);
  const [allSites, setAllSites] = useState<PhotoSite[]>([]);
  const sites = useMemo(() => access.filterSites(allSites, (s) => (s.projectId ? `p:${s.projectId}` : `n:${s.name.trim().toLowerCase()}`)), [allSites, access.session]);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState<{ site?: SiteChoice } | null>(null);
  const restoreRef = useRef<HTMLInputElement>(null);

  const reload = () =>
    listReports()
      .then(async (r) => {
        setReports(r);
        setAllSites(await loadReportSites());
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
    return [...map.values()]
      .filter((c) => access.canSite(c.key))
      .filter((c) => !q || [c.site.name, c.head.project, c.head.number, c.head.client, c.head.address].some((t) => t?.toLowerCase().includes(q)))
      .sort((a, b) => b.lastAt - a.lastAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reports, q, access.session]);
  /** in Berichten angelegte oder übernommene Projekte, die noch keinen Bericht haben */
  const emptySites = useMemo(() => {
    const have = new Set(cards.map((c) => c.key));
    return reports
      ? sites.filter((f) => (!f.projectId || usedIn(f, 'reports')) && !have.has(f.projectId ? `p:${f.projectId}` : `n:${f.name.trim().toLowerCase()}`) && (!q || [f.name, f.number, f.address].join(' ').toLowerCase().includes(q)))
      : [];
  }, [sites, cards, query, reports]);

  const run = (fn: () => Promise<void>) => fn().catch((e) => showError(e, 'Das hat nicht geklappt'));
  /** hinterlegte Firmenformulare (Konto → Firmeninformationen) – PDFs der Berichte werden damit ausgegeben */
  const [templates, setTemplates] = useState<FormTemplate[] | null>(null);
  useEffect(() => {
    void listFormTemplates().then(setTemplates).catch(() => setTemplates([]));
  }, []);

  return (
    <>
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

        {templates && (
          <p className="muted small reports-forms-hint" data-testid="reports-forms-hint">
            {templates.length ? (
              <>
                Firmenformulare: {templates.map((t) => `${t.name} (${typeInfo(t.type).label})`).join(', ')} – die PDFs dieser Berichte werden damit ausgegeben.{' '}
              </>
            ) : (
              <>Eigene Regieliste und Bautagesbericht der Firma als PDF hinterlegen – die Berichte werden dann direkt in das Firmenformular geschrieben. </>
            )}
            <a href={paths.account()}>Konto → Firmeninformationen</a>
          </p>
        )}

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
        {reports && reports.length > 0 && cards.length === 0 && emptySites.length === 0 && <p className="muted">Keine Baustelle gefunden.</p>}

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
          {emptySites.map((f) => (
            <button
              key={`empty:${f.projectId ?? f.name}`}
              type="button"
              className="report-site report-site-empty"
              onClick={() => setCreating({ site: { projectId: f.projectId, name: f.name, address: f.address } })}
              data-testid="report-site-empty"
              data-site={f.name}
            >
              <div className="report-site-main">
                <strong>{f.name}</strong>
                <span className="muted small">{[f.number, f.address].filter(Boolean).join(' · ')}</span>
                <span className="small muted">Noch kein Bericht – antippen zum Anlegen</span>
              </div>
              <Icon name="plus" size={18} />
            </button>
          ))}
        </div>
      </div>
      {creating && (
        <NewReportDialog
          sites={sites}
          site={creating.site}
          onClose={() => setCreating(null)}
          onCreate={(type, site, date) => run(() => createReport(type, site, date, reports ?? []))}
        />
      )}
    </>
  );
}

/** Neuer Bericht: Typ, Projekt (Auswahl wie in allen Werkzeugen, „+ Neues Projekt …“) und Datum */
export function NewReportDialog({
  sites,
  site,
  onCreate,
  onClose,
}: {
  sites: PhotoSite[];
  site?: SiteChoice;
  onCreate(type: ReportType, site: SiteChoice, date: string): void;
  onClose(): void;
}) {
  const [type, setType] = useState<ReportType>('regie');
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
    onCreate(type, { projectId: chosen.projectId, name: chosen.name, address: chosen.address }, date);
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
            <span className="muted small">{t.type === 'regie' ? 'Regiearbeiten mit Stunden je Arbeiter' : t.type === 'tag' ? 'Tägliche Dokumentation des Projekts' : 'Zusammenfassung einer Woche (Mo–So)'}</span>
          </button>
        ))}
      </div>
      <label className="field">
        <span>Projekt auswählen</span>
        <PhotoSitePicker sites={list} value={chosen} onChange={setChosen} onCreated={(s) => setList((l) => (l.some((x) => siteValue(x) === siteValue(s)) ? l : [...l, s]))} testId="report-site" />
      </label>
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
