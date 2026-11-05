import { PDFDocument } from 'pdf-lib';
import { useEffect, useMemo, useState } from 'react';
import { ActionMenu } from '../components/ActionMenu';
import { Icon } from '../components/Icon';
import { PdfPreview } from '../components/PdfPreview';
import { SiteNav } from '../components/SiteNav';
import { confirmDialog, offerFile, promptDialog, showError, toast } from '../components/ui';
import { safeFileName, type ExportFile } from '../lib/aufmass';
import { deleteFormEntry, deleteReport, listFormEntries, listFormTemplates, listReports, saveReport } from '../lib/db';
import { isCustomTemplate, type FormTemplate } from '../lib/form-template';
import { duplicateNos, entrySiteKey, fmtFieldDate, isoWeekLabel, parseNoRange, type FormEntry } from '../lib/forms';
import { copyFormEntry, createFormEntry, formEntryPdf } from '../lib/forms-data';
import { navigate, paths } from '../lib/router';
import { copyReport, periodLabel, REPORT_TYPES, siteKey, siteLabel, today, typeInfo } from '../lib/reports';
import type { PhotoSite, Report, ReportType } from '../lib/types';
import { reportPdfFile } from './ReportEditorPage';
import { createReport, loadReportSites, NewReportDialog, type SiteChoice } from './ReportsPage';
import { usePageTitle } from '../lib/page-title';
import { ProjectEditDialog } from '../components/ProjectEditDialog';
import { canEditSites, siteKeyOfSite } from '../lib/sites';
import { useSession } from '../lib/use-session';
import { useDataChanged } from '../lib/data-events';

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
  const [sites, setSites] = useState<PhotoSite[]>([]);
  const [creating, setCreating] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [preview, setPreview] = useState<ExportFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [allEntries, setAllEntries] = useState<FormEntry[]>([]);
  const [templates, setTemplates] = useState<FormTemplate[]>([]);
  const session = useSession();
  const reports = useMemo(() => (all ?? []).filter((r) => siteKey(r) === key), [all, key]);
  const entries = useMemo(() => allEntries.filter((e) => entrySiteKey(e) === key), [allEntries, key]);
  /** ausgefüllte Firmenformulare je Vorlage (neueste zuerst) */
  const byTemplate = useMemo(() => {
    const m = new Map<string, { name: string; items: FormEntry[] }>();
    for (const e of entries) {
      const g = m.get(e.templateId) ?? { name: templates.find((t) => t.id === e.templateId)?.name ?? e.templateName, items: [] };
      g.items.push(e);
      m.set(e.templateId, g);
    }
    // Liste je Formular erst, wenn es dort ein ausgefülltes Formular gibt (neu über „Neu“)
    for (const g of m.values()) g.items.sort((a, b) => b.date.localeCompare(a.date) || (parseInt(b.no) || 0) - (parseInt(a.no) || 0));
    return [...m.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name, 'de'));
  }, [entries, templates]);
  const dupNos = useMemo(() => duplicateNos(entries), [entries]);
  const first = reports[0];
  /** Projekt ohne Bericht: Angaben aus dem Register (gleiche Liste wie in allen Werkzeugen) */
  const info = useMemo(() => sites.find((x) => (x.projectId ? `p:${x.projectId}` : `n:${x.name.trim().toLowerCase()}`) === key) ?? null, [sites, key]);
  const name = first ? siteLabel(first) : info ? info.name : key.startsWith('n:') ? key.slice(2) : '…';
  usePageTitle(`${name} – Berichte – BauPad`);
  const site: SiteChoice | null = first
    ? first.projectId
      ? { projectId: first.projectId, name }
      : { projectId: null, name }
    : info
      ? { projectId: info.projectId, name, address: info.address }
      : key.startsWith('n:')
        ? { projectId: null, name }
        : null;

  const reload = () =>
    Promise.all([listReports(), loadReportSites(), listFormEntries(), listFormTemplates()])
      .then(([r, s, e, t]) => {
        setSites(s);
        setAllEntries(e);
        setTemplates(t.filter(isCustomTemplate));
        setAll(r);
      })
      .catch((e) => showError(e, 'Berichte konnten nicht geladen werden'));
  useEffect(() => {
    void reload();
  }, [key]);
  useDataChanged(() => void reload());

  const byType = useMemo(() => {
    const m: Record<ReportType, Report[]> = { regie: [], tag: [], woche: [] };
    for (const r of reports) m[r.type].push(r);
    for (const t of TYPE_ORDER) m[t].sort((a, b) => b.date.localeCompare(a.date) || (parseInt(b.no) || 0) - (parseInt(a.no) || 0));
    return m;
  }, [reports]);
  const chosen = useMemo(() => TYPE_ORDER.flatMap((t) => [...byType[t]].reverse()).filter((r) => selected.has(r.id)), [byType, selected]);

  const run = (fn: () => Promise<void>) => fn().catch((e) => showError(e, 'Das hat nicht geklappt'));
  const copyEntry = (e: FormEntry) =>
    run(async () => {
      const c = await copyFormEntry(e, allEntries, session?.name ?? '');
      toast(`Kopie angelegt: ${c.templateName} Nr. ${c.no}.`, 'success');
      navigate(paths.formEntry(c.id));
    });
  const removeEntry = (e: FormEntry) =>
    void confirmDialog({ title: 'Formular löschen?', message: <p>{e.templateName} Nr. {e.no} vom {fmtFieldDate(e.date)} wird endgültig gelöscht.</p>, confirmLabel: 'Löschen', danger: true }).then((ok) => {
      if (ok)
        void run(async () => {
          await deleteFormEntry(e.id);
          await reload();
          toast('Formular gelöscht.', 'success');
        });
    });
  /** „+“ neben einer Liste: sofort anlegen (heutiges Datum, Datum im Formular änderbar) */
  const quickAdd = (type: ReportType) => {
    if (site) void run(() => createReport(type, site, today(), all ?? []));
  };
  /** Formulare einer Vorlage nach Nummern drucken, z. B. „3-20“ – ein PDF mit allen gewählten Formularen */
  const printForms = (name: string, items: FormEntry[]) => {
    const nos = items.map((x) => parseInt(x.no, 10)).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
    const def = nos.length ? (nos[0] === nos[nos.length - 1] ? String(nos[0]) : `${nos[0]}-${nos[nos.length - 1]}`) : '';
    void promptDialog({ title: `${name} drucken`, label: 'Nummern (z. B. 3-20 oder 3, 5, 8-10)', value: def, confirmLabel: 'PDF erstellen' }).then((text) => {
      if (text === null) return;
      const range = parseNoRange(text);
      if (!range) return toast('Bitte Nummern wie „3-20“ oder „3, 5, 8-10“ eingeben.', 'error');
      const chosen = items.filter((x) => range.has(parseInt(x.no, 10))).sort((a, b) => (parseInt(a.no, 10) || 0) - (parseInt(b.no, 10) || 0));
      if (!chosen.length) return toast(`Keine Formulare mit den Nummern ${text} in diesem Projekt.`, 'error');
      setBusy(true);
      void run(async () => {
        const out = await PDFDocument.create();
        for (const x of chosen) {
          const f = await formEntryPdf(x);
          const doc = await PDFDocument.load(f.data);
          for (const pg of await out.copyPages(doc, doc.getPageIndices())) out.addPage(pg);
        }
        const nums = chosen.map((x) => x.no);
        setPreview({ name: `${safeFileName(name, chosen[0].siteName, `Nr${nums[0]}-${nums[nums.length - 1]}`)}.pdf`, data: await out.save(), mimeType: 'application/pdf' });
        toast(`${chosen.length} ${chosen.length === 1 ? 'Formular' : 'Formulare'} im PDF.`, 'success');
      }).finally(() => setBusy(false));
    });
  };
  const quickAddForm = (templateId: string) => {
    const t = templates.find((x) => x.id === templateId);
    if (t && site) void createForm(t, site, today());
  };
  const createForm = (t: FormTemplate, s: SiteChoice, date: string) =>
    run(async () => {
      const e = await createFormEntry(t, { projectId: s.projectId, name: s.name }, date, allEntries, session?.name ?? '');
      setCreating(false);
      navigate(paths.formEntry(e.id));
    });
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
  /** Teilen ohne Umweg: ein Bericht oder alle Berichte der Baustelle als PDF an Mail, WhatsApp, „Dateien“ … */
  const share = (list: Report[]) => {
    setBusy(true);
    void run(async () => offerFile(list.length === 1 ? await reportPdfFile(list[0]) : await mergedPdf(list, name))).finally(() => setBusy(false));
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
              <span className="muted small">{first ? [first.head.number, first.head.address, first.head.client].filter(Boolean).join(' · ') : info ? [info.number, info.address].filter(Boolean).join(' · ') : ''}</span>
            </div>
          </div>
          <div className="row gap">
            {canEditSites(session) && site && (
              <button type="button" className="btn btn-sm" onClick={() => setEditing(true)} title="Baustelle bearbeiten – gilt in allen Werkzeugen" aria-label="Baustelle bearbeiten" data-testid="report-site-edit">
                <Icon name="edit" size={16} /> <span className="lbl">Bearbeiten</span>
              </button>
            )}
            <button type="button" className={`btn btn-sm${selecting ? ' btn-primary' : ''}`} onClick={() => (selecting ? stop() : setSelecting(true))} disabled={!reports.length} data-testid="report-select">
              <Icon name="check" size={16} /> {selecting ? 'Fertig' : 'Auswählen'}
            </button>
            <button type="button" className="btn btn-sm" onClick={() => share(TYPE_ORDER.flatMap((t) => [...byType[t]].reverse()))} disabled={!reports.length || busy} data-testid="report-share-all">
              <Icon name="share" size={16} /> <span className="lbl">Alle teilen</span>
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

        {all && reports.length === 0 && entries.length === 0 && templates.length === 0 && <p className="muted">Noch keine Berichte in diesem Projekt – oben „Neu“ antippen: Regieliste, Bautagesbericht, Bauwochenbericht{templates.length ? ' oder ein Firmenformular' : ''}.</p>}

        {REPORT_TYPES.filter((t) => byType[t.type].length > 0).map((t) => {
          const items = byType[t.type];
          const ids = items.map((r) => r.id);
          const allOn = ids.length > 0 && ids.every((id) => selected.has(id));
          return (
            <section key={t.type} className={`report-section t-${t.type}`} data-testid="report-section" data-type={t.type}>
              <header className="report-section-head">
                <span className={`report-type t-${t.type}`}>{t.short}</span>
                <h2>{t.plural}</h2>
                <span className="muted small">{items.length}</span>
                {!selecting && site && (
                  <button type="button" className="btn btn-sm report-section-add" onClick={() => quickAdd(t.type)} title={`${t.label} für heute anlegen`} aria-label={`${t.label} anlegen`} data-testid="report-section-add" data-type={t.type}>
                    <Icon name="plus" size={16} />
                  </button>
                )}
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
                              { label: 'Teilen', icon: 'share', onSelect: () => share([r]), testId: 'report-share' },
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

        {byTemplate.map(([templateId, g]) => (
          <section key={templateId} className="report-section t-form" data-testid="form-section" data-name={g.name}>
            <header className="report-section-head">
              <span className="report-type t-form">F</span>
              <h2>{g.name}</h2>
              <span className="muted small">{g.items.length}</span>
              {g.items.length > 0 && (
                <button type="button" className="btn btn-sm" onClick={() => printForms(g.name, g.items)} disabled={busy} title={`${g.name} nach Nummern drucken (z. B. 3-20)`} data-testid="form-section-print" data-name={g.name}>
                  <Icon name="pdf" size={16} /> Drucken
                </button>
              )}
              {site && templates.some((t) => t.id === templateId) && (
                <button type="button" className="btn btn-sm report-section-add" onClick={() => quickAddForm(templateId)} title={`${g.name} für heute anlegen`} aria-label={`${g.name} anlegen`} data-testid="form-section-add" data-name={g.name}>
                  <Icon name="plus" size={16} />
                </button>
              )}
            </header>
            {g.items.length === 0 && <p className="muted small report-section-empty">Noch kein Formular – mit „+“ anlegen.</p>}
            <ul className="report-list report-scroll">
              {g.items.map((e) => (
                <li key={e.id} className="report-item" data-testid="form-item" data-no={e.no}>
                  <a href={paths.formEntry(e.id)} className="report-link">
                    <span className="report-main">
                      <strong>
                        {g.name} Nr. {e.no}
                        {dupNos.has(e.id) && (
                          <span className="rp-badge warn" title="Diese Nummer gibt es in diesem Projekt zweimal – bitte eine davon ändern">
                            {' '}
                            Nummer doppelt
                          </span>
                        )}
                      </strong>
                      <span className="muted small">
                        {fmtFieldDate(e.date)} · {isoWeekLabel(e.date)}
                        {e.createdBy ? ` · ${e.createdBy}` : ''}
                      </span>
                    </span>
                    <span className={`report-status ${e.status}`} data-testid="form-status">
                      {e.status === 'done' ? 'Fertig' : 'Entwurf'}
                    </span>
                  </a>
                  <ActionMenu
                    label={`Aktionen für ${g.name} Nr. ${e.no}`}
                    testId="form-actions"
                    actions={[
                      { label: 'Bearbeiten', icon: 'edit', onSelect: () => navigate(paths.formEntry(e.id)), testId: 'form-open' },
                      { label: 'Kopieren als neues Formular', icon: 'copy', onSelect: () => copyEntry(e), testId: 'form-copy' },
                      { label: 'PDF', icon: 'pdf', onSelect: () => run(async () => setPreview(await formEntryPdf(e))), testId: 'form-pdf' },
                      { label: 'Teilen', icon: 'share', onSelect: () => run(async () => offerFile(await formEntryPdf(e))), testId: 'form-share' },
                      { label: 'Löschen', icon: 'trash', danger: true, onSelect: () => removeEntry(e), testId: 'form-delete' },
                    ]}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {creating && site && (
        <NewReportDialog sites={sites} site={site} templates={templates} onCreateForm={createForm} onClose={() => setCreating(false)} onCreate={(type, s, date) => run(() => createReport(type, s, date, all ?? []))} />
      )}
      {editing && site && (
        <ProjectEditDialog
          site={{ projectId: site.projectId, name: site.name, number: first?.head.number ?? info?.number ?? '', address: first?.head.address ?? info?.address ?? '' }}
          onClose={() => setEditing(false)}
          onSaved={(next) => {
            setEditing(false);
            toast('Baustelle gespeichert – in allen Werkzeugen übernommen.', 'success');
            const nk = siteKeyOfSite(next);
            if (nk !== key) navigate(paths.reportSite(nk), true);
            else void reload();
          }}
        />
      )}
      {preview && <PdfPreview file={preview} onBack={() => setPreview(null)} onClose={() => setPreview(null)} />}
    </>
  );
}
