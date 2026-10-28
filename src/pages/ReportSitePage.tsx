import { PDFDocument } from 'pdf-lib';
import { useEffect, useMemo, useState } from 'react';
import { ActionMenu } from '../components/ActionMenu';
import { Icon } from '../components/Icon';
import { PdfPreview } from '../components/PdfPreview';
import { SiteNav } from '../components/SiteNav';
import { confirmDialog, showError, toast } from '../components/ui';
import { safeFileName, type ExportFile } from '../lib/aufmass';
import { deleteReport, listReports, saveReport } from '../lib/db';
import { navigate, paths } from '../lib/router';
import { copyReport, periodLabel, REPORT_TYPES, siteKey, siteLabel, today, typeInfo } from '../lib/reports';
import type { Project, Report, ReportType } from '../lib/types';
import { reportPdfFile } from './ReportEditorPage';
import { createReport, loadReportSites, NewReportDialog, type SiteChoice } from './ReportsPage';
import { usePageTitle } from './SitePages';

const TYPE_ORDER: ReportType[] = ['regie', 'tag', 'woche'];

/** mehrere Berichte in einem PDF (Seiten hintereinander, Reihenfolge Regielisten → Tagesberichte → Wochenberichte, je Typ nach Datum) */
async function mergedPdf(list: Report[], site: string): Promise<ExportFile> {
  const out = await PDFDocument.create();
  for (const r of list) {
    const f = await reportPdfFile(r);
    const doc = await PDFDocument.load(f.data);
    for (const p of await out.copyPages(doc, doc.getPageIndices())) out.addPage(p);
  }
  return { name: `${safeFileName('Berichte', site, new Date().toISOString().slice(0, 10))}.pdf`, data: await out.save(), mimeType: 'application/pdf' };
}

/**
 * Berichte einer Baustelle: getrennte Listen für Regielisten, Bautagesberichte und Bauwochenberichte
 * (neueste zuerst, jede Liste scrollt für sich). Tippen öffnet die Bearbeitung; „Auswählen“ markiert
 * beliebige Berichte und gibt sie zusammen als PDF aus.
 */
export function ReportSitePage({ siteKey: key }: { siteKey: string }) {
  const [all, setAll] = useState<Report[] | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [freeSites, setFreeSites] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [preview, setPreview] = useState<ExportFile | null>(null);
  const [busy, setBusy] = useState(false);
  const reports = useMemo(() => (all ?? []).filter((r) => siteKey(r) === key), [all, key]);
  const first = reports[0];
  const name = first ? siteLabel(first) : key.startsWith('n:') ? key.slice(2) : '…';
  usePageTitle(`${name} – Berichte – BauPad`);
  const site: SiteChoice | null = first ? (first.projectId ? { projectId: first.projectId, name } : { projectId: null, name }) : key.startsWith('n:') ? { projectId: null, name } : null;

  const reload = () =>
    listReports()
      .then(async (r) => {
        setAll(r);
        const s = await loadReportSites(r);
        setProjects(s.projects);
        setFreeSites(s.freeSites);
      })
      .catch((e) => showError(e, 'Berichte konnten nicht geladen werden'));
  useEffect(() => {
    void reload();
  }, [key]);

  const byType = useMemo(() => {
    const m: Record<ReportType, Report[]> = { regie: [], tag: [], woche: [] };
    for (const r of reports) m[r.type].push(r);
    for (const t of TYPE_ORDER) m[t].sort((a, b) => b.date.localeCompare(a.date) || (parseInt(b.no) || 0) - (parseInt(a.no) || 0));
    return m;
  }, [reports]);
  const chosen = useMemo(() => TYPE_ORDER.flatMap((t) => [...byType[t]].reverse()).filter((r) => selected.has(r.id)), [byType, selected]);

  const run = (fn: () => Promise<void>) => fn().catch((e) => showError(e, 'Das hat nicht geklappt'));
  const copy = (r: Report) =>
    run(async () => {
      const c = copyReport(r, r.type === 'woche' ? r.date : today(), all ?? []);
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
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const setMany = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) on ? next.add(id) : next.delete(id);
      return next;
    });
  const stop = () => {
    setSelecting(false);
    setSelected(new Set());
  };
  const exportPdf = () => {
    setBusy(true);
    void run(async () => setPreview(chosen.length === 1 ? await reportPdfFile(chosen[0]) : await mergedPdf(chosen, name))).finally(() => setBusy(false));
  };

  if (all && !site)
    return (
      <>
        <SiteNav />
        <div className="page">
          <p>Baustelle nicht gefunden.</p>
          <a className="btn" href={paths.reports()}>
            Zur Übersicht
          </a>
        </div>
      </>
    );

  return (
    <>
      <SiteNav />
      <div className="page reports-page" data-testid="report-site-page" data-site={name}>
        <header className="page-head page-head-row">
          <div className="page-head-title">
            <a href={paths.reports()} className="icon-link" aria-label="Zur Übersicht" title="Zur Übersicht" data-testid="to-reports-overview">
              <Icon name="back" />
            </a>
            <div>
              <h1 data-testid="report-site-title">{name}</h1>
              <span className="muted small">{first ? [first.head.number, first.head.address, first.head.client].filter(Boolean).join(' · ') : ''}</span>
            </div>
          </div>
          <div className="row gap">
            <button type="button" className={`btn btn-sm${selecting ? ' btn-primary' : ''}`} onClick={() => (selecting ? stop() : setSelecting(true))} disabled={!reports.length} data-testid="report-select">
              <Icon name="check" size={16} /> {selecting ? 'Fertig' : 'Auswählen'}
            </button>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setCreating(true)} data-testid="report-group-new">
              <Icon name="plus" size={16} /> Neu
            </button>
          </div>
        </header>

        {selecting && (
          <div className="photo-selection-bar report-selection-bar" role="toolbar" aria-label="Auswahl" data-testid="report-selection-bar">
            <strong>{chosen.length} ausgewählt</strong>
            {chosen.length === 0 && <span className="photo-selection-hint">Berichte antippen, dann „Als PDF“</span>}
            <button type="button" className="btn btn-sm" onClick={() => setMany(reports.map((r) => r.id), true)}>
              Alle ({reports.length})
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setSelected(new Set())} disabled={!chosen.length}>
              Keine
            </button>
            <span className="spacer" />
            <button type="button" className={`btn btn-sm${chosen.length ? ' btn-primary' : ''}`} onClick={exportPdf} disabled={!chosen.length || busy} data-testid="report-selected-pdf">
              <Icon name="pdf" size={16} /> {busy ? 'Wird erstellt …' : 'Als PDF'}
            </button>
            <button type="button" className="btn btn-sm" onClick={stop} aria-label="Auswahl beenden">
              <Icon name="close" size={16} />
            </button>
          </div>
        )}

        {all && reports.length === 0 && <p className="muted">Noch keine Berichte auf dieser Baustelle.</p>}

        {REPORT_TYPES.map((t) => {
          const items = byType[t.type];
          const ids = items.map((r) => r.id);
          const allOn = ids.length > 0 && ids.every((id) => selected.has(id));
          return (
            <section key={t.type} className={`report-section t-${t.type}`} data-testid="report-section" data-type={t.type}>
              <header className="report-section-head">
                <span className={`report-type t-${t.type}`}>{t.short}</span>
                <h2>{t.plural}</h2>
                <span className="muted small">{items.length}</span>
                {selecting && items.length > 0 && (
                  <label className="photo-group-all">
                    <input type="checkbox" checked={allOn} onChange={(e) => setMany(ids, e.target.checked)} data-testid="report-section-all" />
                    Alle
                  </label>
                )}
              </header>
              {items.length === 0 ? (
                <p className="muted small report-section-empty">
                  Noch {t.type === 'regie' ? 'keine Regieliste' : t.type === 'tag' ? 'kein Bautagesbericht' : 'kein Wochenbericht'}.
                </p>
              ) : (
                <ul className="report-list report-scroll">
                  {items.map((r) => {
                    const on = selected.has(r.id);
                    return (
                      <li key={r.id} className={`report-item${on ? ' selected' : ''}`} data-testid="report-item" data-type={r.type} data-selected={on || undefined}>
                        {selecting ? (
                          <button type="button" className="report-link" onClick={() => toggle(r.id)} aria-pressed={on}>
                            <span className={`photo-check static${on ? ' on' : ''}`} aria-hidden="true">
                              {on && <Icon name="check" size={14} />}
                            </span>
                            <span className="report-main">
                              <strong>
                                {typeInfo(r.type).label} Nr. {r.no}
                              </strong>
                              <span className="muted small">{periodLabel(r)}</span>
                            </span>
                          </button>
                        ) : (
                          <a href={paths.report(r.id)} className="report-link">
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
                        )}
                        {!selecting && (
                          <ActionMenu
                            label={`Aktionen für ${typeInfo(r.type).label} Nr. ${r.no}`}
                            testId="report-actions"
                            actions={[
                              { label: 'Bearbeiten', icon: 'edit', onSelect: () => navigate(paths.report(r.id)), testId: 'report-open' },
                              { label: 'Kopieren als neuer Bericht', icon: 'copy', onSelect: () => copy(r), testId: 'report-copy' },
                              { label: 'PDF', icon: 'pdf', onSelect: () => run(async () => setPreview(await reportPdfFile(r))), testId: 'report-pdf' },
                              { label: 'Löschen', icon: 'trash', danger: true, onSelect: () => remove(r), testId: 'report-delete' },
                            ]}
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      {creating && site && (
        <NewReportDialog projects={projects} freeSites={freeSites} site={site} onClose={() => setCreating(false)} onCreate={(type, s, date) => run(() => createReport(type, s, date, all ?? []))} />
      )}
      {preview && <PdfPreview file={preview} onBack={() => setPreview(null)} onClose={() => setPreview(null)} />}
    </>
  );
}
