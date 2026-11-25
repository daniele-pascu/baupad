import { useEffect, useRef, useState } from 'react';
import { ActionMenu } from '../components/ActionMenu';
import { SiteNav } from '../components/SiteNav';
import { AreaEditor } from '../components/AreaEditor';
import { AufmassTable } from '../components/AufmassTable';
import { Icon } from '../components/Icon';
import { TrashCount } from '../components/Motion';
import { ProjectAccessButton } from '../components/ProjectAccess';
import { ImportWizard } from '../components/ImportWizard';
import { InvoiceBar } from '../components/InvoiceBar';
import { invoiceLabel, invoiceOfPlan, invoiceShort, invoicesOf } from '../lib/invoices';
import { LvPanel } from '../components/LvPanel';
import { PdfExportDialog } from '../components/PdfExportDialog';
import { TrashDialog } from '../components/TrashDialog';
import { trashEntries } from '../lib/trash';
import { NewDrawingDialog, PlanDetailsDialog } from '../components/PlanFields';
import { PlanLibrary, ReusePlanDialog, suggestNumber, type PlanSource } from '../components/PlanLibrary';
import { PlanList } from '../components/PlanList';
import { RotatePlanDialog } from '../components/RotatePlanDialog';
import { ExcelExportDialog } from '../components/ExcelExportDialog';
import { ProjectForm, type CostCenterInput } from '../components/ProjectForm';
import { SaveErrorBanner } from '../components/SaveStatus';
import { confirmDialog, offerFile, promptDialog, showError, toast } from '../components/ui';
import { positionGrouping, aufmassRows, componentsOf, findPosition, costCenterLabel, costCenterName, costCentersOf, damagesOf, elementsOf, planTitle, plansOf } from '../lib/aufmass';
import { quantityLines } from '../lib/measure-types';
import type { BlattScope } from '../lib/aufmassblatt';
import { BACKUP_REMIND_DAYS, backupStatus, exportProjectBackup, type BackupStatus } from '../lib/backup';
import { isDrawingPlan } from '../lib/drawing';
import { uuid } from '../lib/ids';
import { exportPaper } from '../lib/sheet-layout';
import { formatDate, formatDateTime } from '../lib/numbers';
import { navigate, paths } from '../lib/router';
import { flush, newMeta, putRecord, putRecords, softDelete, updateProject, useAppState, type ProjectState } from '../lib/store';
import { propagateProject } from '../lib/sites';
import { useDataSyncState } from '../lib/data-sync';
import { renderSource } from '../lib/thumbs';
import type { AufmassSheet, CostCenter, Plan } from '../lib/types';
import type { AufmassRow } from '../lib/aufmass';
import { projectColor, refreshProjectColors } from '../lib/project-colors';
import { ToolMark } from '../components/ToolIcon';
import { SelectBox, SelectionBar, SelectToggle, useSelection } from '../components/Selection';
import { BulkPlanDialog } from '../components/BulkPlanDialog';
import { deepClone } from '../lib/compat';

/**
 * Projektseite: Projektinformationen (inklusive Kostenstelle) und direkt darunter die
 * Planliste. Hat ein Projekt mehrere Kostenstellen, erscheint eine Auswahl; es geht dabei
 * keine Kostenstelle und keine Zuordnung verloren.
 */
export function ProjectPage({ costCenterId }: { costCenterId?: string }) {
  const data = useAppState((s) => s.data) as ProjectState;
  const project = data.project;
  const ccs = costCentersOf(data);
  const active: CostCenter | null = ccs.find((c) => c.id === costCenterId) ?? ccs[0] ?? null;
  // Projekt ohne Kostenstelle: Die Pläne liegen in einer leeren Kostenstelle (ohne Nummer und
  // Bezeichnung); sie wird bei Bedarf angelegt und später einfach ausgefüllt.
  useEffect(() => {
    if (!ccs.length) putRecords({ costCenters: [{ ...newMeta(), projectId: project.id, number: '', name: '', sortIndex: 0 }] }, { history: false });
  }, [ccs.length, project.id]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  /** PDF-Dialog: vorausgewählte Pläne (null = zu) */
  const [pdfPlans, setPdfPlans] = useState<string[] | null>(null);
  // eigene Taste „Fotos exportieren“: derselbe Auswahldialog, aber für das Foto-PDF
  const [photoPlans, setPhotoPlans] = useState<string[] | null>(null);
  // Papierkorb: Gelöschtes 15 Tage wiederherstellbar
  const [trashOpen, setTrashOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [details, setDetails] = useState<Plan | null>(null);
  const [cropping, setCropping] = useState<{ plan: Plan; image: HTMLCanvasElement } | null>(null);
  const [drawingNew, setDrawingNew] = useState(false);
  const [library, setLibrary] = useState(false);
  /** aufgeklappte Aufmaße (Liste je Plan) */
  const [openAufmass, setOpenAufmass] = useState<Set<string>>(() => new Set());
  /** aufgeklappte Pläne innerhalb eines Aufmaßes (Schlüssel „Aufmaß:Plan“) */
  const [openPlans, setOpenPlans] = useState<Set<string>>(() => new Set());
  const [reuse, setReuse] = useState<PlanSource | null>(null);
  const [rotating, setRotating] = useState<Plan | null>(null);
  const [excelScope, setExcelScope] = useState<BlattScope | null>(null);
  /** Aufmaß, dessen Pläne der Excel-Dialog übernimmt (sonst legt er ein neues an) */
  const [excelSheet, setExcelSheet] = useState<string | undefined>(undefined);
  const [backupInfo, setBackupInfo] = useState<BackupStatus | null>(null);
  const sync = useDataSyncState();
  const [reminderHidden, setReminderHidden] = useState(() => {
    try {
      return sessionStorage.getItem(`backupLater:${data.project.id}`) === '1';
    } catch {
      return false;
    }
  });
  const refreshBackup = () => void backupStatus(project).then(setBackupInfo).catch(() => {});
  // Sicherungsstand beim Öffnen prüfen
  useEffect(refreshBackup, [project.id]);

  // Nach Rechnungen aufgeteilt: gewählte Rechnung (gemerkt je Projekt), nur deren Pläne und Aufmaß
  const split = !!project.splitByInvoice;
  const invoices = invoicesOf(project);
  const [invoiceSel, setInvoiceSelState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(`invoice:${project.id}`);
    } catch {
      return null;
    }
  });
  const setInvoiceSel = (id: string) => {
    setInvoiceSelState(id);
    try {
      localStorage.setItem(`invoice:${project.id}`, id);
    } catch {
      /* optional */
    }
  };
  const invoice = split ? (invoices.find((i) => i.id === invoiceSel) ?? invoices[invoices.length - 1] ?? null) : null;
  /** Filter für plansOf: aufgeteilt → nur die Pläne der gewählten Rechnung */
  const invoiceFilter = split ? (invoice?.id ?? '') : undefined;
  // Planliste nach Plannummer auf- oder absteigend (gemerkt auf dem Gerät)
  const [planDesc, setPlanDesc] = useState(() => {
    try {
      return localStorage.getItem('planSort') === 'desc';
    } catch {
      return false;
    }
  });
  const toggleSort = () => {
    const next = !planDesc;
    setPlanDesc(next);
    try {
      localStorage.setItem('planSort', next ? 'desc' : 'asc');
    } catch {
      /* optional */
    }
  };
  const plansAsc = active ? plansOf(data, active.id, invoiceFilter) : [];
  const plans = planDesc ? [...plansAsc].reverse() : plansAsc;
  const trashCount = trashEntries(data).length;
  /** Mehrfachauswahl in der Planliste */
  const planSel = useSelection(plans.map((p) => p.id));
  const [bulkPlans, setBulkPlans] = useState<Plan[] | null>(null);
  const selectedPlans = () => planSel.ids.map((id) => data.plans[id]).filter((p): p is Plan => !!p && !p.deletedAt);
  const rows = aufmassRows(data, plans);
  /** Aufmaß der Rechnung: alle Messungen ihrer Pläne über alle Kostenstellen */
  // angelegte Aufmaße (durchnummeriert über das Projekt), sichtbar in der Kostenstelle ihrer Pläne
  const sheets = (project.aufmassSheets ?? [])
    .map((sheet, i) => ({ sheet, name: sheet.name?.trim() || `Aufmaß ${i + 1}`, sheetPlans: sheet.planIds.map((id) => data.plans[id]).filter((p): p is Plan => !!p && !p.deletedAt) }))
    .filter((x) => x.sheetPlans.length && (!active || x.sheetPlans.some((p) => p.costCenterId === active.id)));
  /** Mehrfachauswahl der Aufmaße (Zusammenstellungen) */
  const sheetSel = useSelection(sheets.map((x) => x.sheet.id));
  const pickedSheets = () => sheets.filter((x) => sheetSel.ids.includes(x.sheet.id));
  const unionPlans = (list: typeof sheets) => [...new Set(list.flatMap((x) => x.sheetPlans.map((p) => p.id)))];
  const toggleOpen = (set: typeof setOpenAufmass, key: string) =>
    set((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  /** Messungen eines Aufmaßes je Plan, jeder Plan einzeln aufklappbar */
  const planGroups = (groupKey: string, plans: Plan[], rowsOfGroup: AufmassRow[]) => {
    const ordered = [...new Map(rowsOfGroup.map((r) => [r.plan.id, r.plan])).values()];
    for (const p of plans) if (!ordered.some((o) => o.id === p.id)) ordered.push(p);
    return (
      <div className="aufmass-plans" data-testid="aufmass-plan-groups">
        {ordered.map((plan) => {
          const key = `${groupKey}:${plan.id}`;
          const open = openPlans.has(key);
          const own = rowsOfGroup.filter((r) => r.plan.id === plan.id);
          return (
            <div key={plan.id} className={`aufmass-plan${open ? ' open' : ''}`} data-testid="aufmass-plan">
              <button type="button" className="aufmass-plan-toggle" aria-expanded={open} onClick={() => toggleOpen(setOpenPlans, key)} data-testid="aufmass-plan-toggle">
                <Icon name="next" size={16} />
                <span className="aufmass-toggle-text">
                  <strong data-testid="aufmass-plan-name">{planTitle(plan)}</strong>
                  <span className="muted small">
                    {own.length} {own.length === 1 ? 'Messung' : 'Messungen'}
                    {own.length > 0 && quantityLines(own.map((r) => r.damage)).map((q) => ` · ${q}`).join('')}
                  </span>
                </span>
              </button>
              {open &&
                (own.length ? (
                  <AufmassTable rows={own} components={data.components} positionLabel={(ref) => findPosition(data, ref)?.pos.number ?? null} {...positionGrouping(data)} onSelect={(r) => navigate(paths.plan(project.id, r.plan.id, r.damage.id))} />
                ) : (
                  <p className="muted small aufmass-block-empty">Noch keine Messungen in diesem Plan.</p>
                ))}
            </div>
          );
        })}
      </div>
    );
  };

  const shownRows = split ? aufmassRows(data, invoice ? ccs.flatMap((c) => plansOf(data, c.id, invoice.id)) : []) : rows;

  // ---------------------------------------------------------------------------
  // Projekt und Kostenstellen

  const saveProject = (fields: Parameters<typeof updateProject>[0], inputs: CostCenterInput[]) => {
    updateProject(fields);
    refreshProjectColors();
    // Baustellenangaben in den anderen Werkzeugen nachziehen (Fotos, Berichte, Einteilung, Mängelplan)
    void flush()
      .then(() => propagateProject({ ...project, ...fields }))
      .catch(() => {});
    const changed: CostCenter[] = [];
    let sortIndex = ccs.length ? Math.max(...ccs.map((c) => c.sortIndex)) + 1 : 0;
    let firstNew: string | null = null;
    for (const input of inputs) {
      const existing = input.id ? data.costCenters[input.id] : undefined;
      if (existing) {
        if ((existing.number ?? '') !== input.number || existing.name !== input.name)
          changed.push({ ...existing, number: input.number, name: input.name });
      } else {
        const cc: CostCenter = { ...newMeta(), projectId: project.id, number: input.number, name: input.name, sortIndex: sortIndex++ };
        firstNew ??= cc.id;
        changed.push(cc);
      }
    }
    if (changed.length) putRecords({ costCenters: changed });
    setEditing(false);
    // Neue Kostenstelle direkt anzeigen, wenn das Projekt bisher keine hatte
    if (firstNew && !active) navigate(paths.costCenter(project.id, firstNew), true);
  };

  const deleteCostCenter = async (cc: CostCenter) => {
    const ccPlans = plansOf(data, cc.id);
    const damages = ccPlans.flatMap((p) => damagesOf(data, p.id));
    const ok = await confirmDialog({
      title: 'Kostenstelle löschen?',
      message: (
        <>
          <p>
            Die Kostenstelle <strong>„{costCenterName(cc)}“</strong> wird gelöscht.
          </p>
          <ul>
            <li>{ccPlans.length} Plan/Pläne</li>
            <li>{damages.length} Messung(en) mit ihren Markierungen</li>
          </ul>
          <p>Die anderen Kostenstellen bleiben unverändert.</p>
        </>
      ),
      confirmLabel: 'Kostenstelle löschen',
      danger: true,
    });
    if (!ok) return;
    const elements = ccPlans.flatMap((p) => elementsOf(data, p.id));
    const components = ccPlans.flatMap((p) => componentsOf(data, p.id));
    softDelete({ costCenters: [cc], plans: ccPlans, damages, elements, components });
    toast('Kostenstelle gelöscht.');
    navigate(paths.project(project.id), true);
  };

  // ---------------------------------------------------------------------------
  // Pläne

  /** Aufmaßplan duplizieren: gleicher Plan mit allen Messungen, Bauteilen und Zeichnungsobjekten (neue Plannummer) */
  const duplicatePlan = (plan: Plan) => {
    const copy: Plan = {
      ...deepClone(plan),
      ...newMeta(),
      planNumber: suggestNumber(data, plan.planNumber || planTitle(plan), plan.invoiceId ?? null),
      sortIndex: Math.max(0, ...plansOf(data, plan.costCenterId).map((p) => p.sortIndex)) + 1,
    };
    const compIds = new Map<string, string>();
    const components = componentsOf(data, plan.id).map((c) => {
      const n = { ...deepClone(c), ...newMeta(), planId: copy.id };
      compIds.set(c.id, n.id);
      return n;
    });
    const damages = damagesOf(data, plan.id).map((d) => ({
      ...deepClone(d),
      ...newMeta(),
      planId: copy.id,
      ...(d.componentId ? { componentId: compIds.get(d.componentId) ?? null } : {}),
      ...(d.deductions ? { deductions: d.deductions.map((x) => ({ ...deepClone(x), id: uuid() })) } : {}),
    }));
    const elements = elementsOf(data, plan.id).map((e) => ({ ...deepClone(e), ...newMeta(), planId: copy.id }));
    putRecords({ plans: [copy], components, damages, elements });
    toast(`Aufmaßplan dupliziert: „${copy.planNumber || planTitle(copy)}“ mit ${damages.length} ${damages.length === 1 ? 'Messung' : 'Messungen'}.`, 'success', 4500);
  };

  const deletePlan = async (plan: Plan) => {
    const damages = damagesOf(data, plan.id);
    const elements = elementsOf(data, plan.id);
    const components = componentsOf(data, plan.id);
    const drawn = isDrawingPlan(plan);
    const others = drawn ? [] : Object.values(data.plans).filter((p) => !p.deletedAt && p.fileId === plan.fileId && p.id !== plan.id);
    const file = drawn ? undefined : data.files[plan.fileId];
    const ok = await confirmDialog({
      title: 'Plan löschen?',
      message: (
        <>
          <p>
            Der Plan <strong>„{planTitle(plan)}“</strong> wird gelöscht. Betroffen sind:
          </p>
          <ul data-testid="delete-summary">
            <li>{damages.length} Messung(en) bzw. Schadstelle(n) mit ihren Maßen</li>
            <li>{damages.length} Markierung(en) im Plan</li>
            {components.length > 0 && <li>{components.length} Bauteilkennzeichnung(en)</li>}
            {drawn && <li>{elements.length} Zeichnungsobjekt(e) des selbst gezeichneten Plans</li>}
            <li>Keine Leistungszuordnungen</li>
            {plan.description && <li>Die Bemerkung zum Plan</li>}
          </ul>
          <p className="muted">
            {drawn
              ? ''
              : others.length
              ? `Die Originaldatei „${file?.name ?? ''}“ bleibt erhalten, weil sie von ${others.length} weiteren Plan/Plänen verwendet wird.`
              : `Die Originaldatei „${file?.name ?? ''}“ bleibt in der Planbibliothek und kann dort für ein neues Aufmaß verwendet oder endgültig entfernt werden.`}{' '}
            Tipp: Vorher über „Projekt sichern“ eine Sicherung anlegen.
          </p>
          {invoiceOfPlan(project, plan)?.settled && (
            <p className="error" data-testid="settled-confirm">
              <strong>Achtung: {invoiceLabel(invoiceOfPlan(project, plan)!)} ist bereits abgerechnet.</strong>
            </p>
          )}
        </>
      ),
      confirmLabel: 'Plan löschen',
      danger: true,
    });
    if (!ok) return;
    // Originaldatei bleibt in der Planbibliothek (wird dort ausdrücklich entfernt)
    softDelete({ plans: [plan], damages, elements, components });
    toast('Plan gelöscht.');
  };

  /** mehrere Pläne auf einmal löschen – mit Übersicht, was mitgelöscht wird */
  const deletePlans = async (list: Plan[]) => {
    if (!list.length) return;
    if (list.length === 1) return deletePlan(list[0]);
    const damages = list.flatMap((p) => damagesOf(data, p.id));
    const elements = list.flatMap((p) => elementsOf(data, p.id));
    const components = list.flatMap((p) => componentsOf(data, p.id));
    const settled = [...new Set(list.map((p) => invoiceOfPlan(project, p)).filter((i) => i?.settled))];
    const ok = await confirmDialog({
      title: `${list.length} Pläne löschen?`,
      message: (
        <>
          <p>
            Gelöscht werden die Pläne <strong>{list.map((p) => p.planNumber || planTitle(p)).join(', ')}</strong>. Betroffen sind:
          </p>
          <ul data-testid="delete-summary">
            <li>{damages.length} Messung(en) bzw. Schadstelle(n) mit ihren Maßen</li>
            {components.length > 0 && <li>{components.length} Bauteilkennzeichnung(en)</li>}
            {elements.length > 0 && <li>{elements.length} Zeichnungsobjekt(e) selbst gezeichneter Pläne</li>}
          </ul>
          <p className="muted">Die Originaldateien bleiben in der Planbibliothek. Tipp: Vorher über „Projekt sichern“ eine Sicherung anlegen.</p>
          {settled.length > 0 && (
            <p className="error" data-testid="settled-confirm">
              <strong>Achtung: {settled.map((i) => invoiceLabel(i!)).join(', ')} ist bereits abgerechnet.</strong>
            </p>
          )}
        </>
      ),
      confirmLabel: `${list.length} Pläne löschen`,
      danger: true,
    });
    if (!ok) return;
    softDelete({ plans: list, damages, elements, components });
    planSel.stop();
    toast(`${list.length} Pläne gelöscht.`);
  };

  const renamePlan = async (plan: Plan) => {
    const name = await promptDialog({ title: 'Plan umbenennen', label: 'Planbezeichnung', value: plan.planName });
    if (name === null || name === plan.planName) return;
    // Nur die Bezeichnung ändert sich – Messungen, Farben und Bemerkungen bleiben unberührt
    putRecord('plans', { ...data.plans[plan.id], planName: name });
  };

  const patchSheet = (id: string, patch: Partial<AufmassSheet>) =>
    updateProject({ aufmassSheets: (data.project.aufmassSheets ?? []).map((x) => (x.id === id ? { ...x, ...patch } : x)) });
  const renameSheet = async (id: string, current: string) => {
    const name = await promptDialog({ title: 'Aufmaß umbenennen', label: 'Name des Aufmaßes (leer = durchnummeriert)', value: current });
    if (name === null) return;
    patchSheet(id, { name: name.trim() });
  };
  const deleteSheets = async (list: typeof sheets) => {
    if (!list.length) return;
    if (!(await confirmDialog({ title: `${list.length} ${list.length === 1 ? 'Aufmaß' : 'Aufmaße'} löschen?`, message: `${list.map((x) => x.name).join(', ')} – nur die Zusammenstellungen werden gelöscht, die Messungen bleiben im Plan.`, confirmLabel: 'Löschen', danger: true }))) return;
    const ids = new Set(list.map((x) => x.sheet.id));
    updateProject({ aufmassSheets: (data.project.aufmassSheets ?? []).filter((x) => !ids.has(x.id)) });
    sheetSel.stop();
    toast(`${list.length} ${list.length === 1 ? 'Aufmaß' : 'Aufmaße'} gelöscht.`);
  };
  /** mehrere Aufmaße zu einem zusammenführen (alle Pläne darin; die einzelnen entfallen) */
  const mergeSheets = (list: typeof sheets) => {
    if (list.length < 2) return;
    const ids = new Set(list.map((x) => x.sheet.id));
    const all = data.project.aufmassSheets ?? [];
    const at = all.findIndex((x) => ids.has(x.id));
    const merged: AufmassSheet = { id: uuid(), planIds: unionPlans(list), createdAt: Date.now() };
    const rest = all.filter((x) => !ids.has(x.id));
    updateProject({ aufmassSheets: [...rest.slice(0, at), merged, ...rest.slice(at)] });
    sheetSel.stop();
    toast(`${list.length} Aufmaße zu einem zusammengeführt.`, 'success');
  };
  const deleteSheet = async (id: string, name: string) => {
    if (!(await confirmDialog({ title: `${name} löschen?`, message: 'Nur die Zusammenstellung wird gelöscht – die Messungen bleiben im Plan.', confirmLabel: 'Löschen', danger: true }))) return;
    updateProject({ aufmassSheets: (data.project.aufmassSheets ?? []).filter((x) => x.id !== id) });
  };

  const openCrop = async (plan: Plan) => {
    try {
      const image = await renderSource(data.files[plan.fileId], plan.pageIndex, 1800, null, plan.rotation);
      setCropping({ plan, image });
    } catch (e) {
      showError(e);
    }
  };

  // ---------------------------------------------------------------------------
  // Export

  const backup = async () => {
    try {
      await flush();
      await offerFile(await exportProjectBackup(project.id));
      refreshBackup();
    } catch (e) {
      showError(e, 'Sicherung fehlgeschlagen');
    }
  };

  return (
    <>
    {/* obere Leiste (BauPad, Tools) wie in allen Werkzeugen */}
    <SiteNav />
    <div className="page page-under-nav">
      <header className="topbar">
        <a className="icon-btn" href={paths.projects()} aria-label="Zu Aufmaß">
          <Icon name="back" />
        </a>
        <ToolMark name="projects" />
        <div className="topbar-title">
          <small>Projekt</small>
          <h1 data-testid="project-title">{project.name}</h1>
        </div>
        {/* Papierkorb dieses Projekts (Pläne, Kostenstellen, LV/MFK, Originalpläne) – oben wie in allen Tools */}
        <button type="button" className="btn btn-sm trash-btn" onClick={() => setTrashOpen(true)} title="Papierkorb dieses Projekts" aria-label={`Papierkorb${trashCount ? ` (${trashCount})` : ''}`} data-testid="open-trash" data-count={trashCount}>
          <Icon name="trash" size={16} />
          <span className="lbl">Papierkorb</span>
          <TrashCount n={trashCount} />
        </button>
      </header>
      <SaveErrorBanner />
      {backupInfo?.due && !reminderHidden && sync.status === 'off' && (
        <div className="banner banner-warn backup-reminder" role="status" data-testid="backup-reminder">
          <p>
            <strong>Sicherung empfohlen:</strong> Das Projekt wurde seit der letzten Sicherung (
            {backupInfo.lastBackup ? formatDateTime(backupInfo.lastBackup) : 'noch nie'}) geändert. Der Speicher im Browser ist keine
            garantierte Datensicherung – bitte die Sicherungsdatei z. B. in „Dateien“ oder einer Cloud ablegen. Erinnerung nach{' '}
            {BACKUP_REMIND_DAYS} Tagen.
          </p>
          <div className="row gap wrap">
            <button type="button" className="btn btn-sm btn-primary" onClick={() => void backup()} data-testid="backup-now">
              <Icon name="download" size={18} /> Jetzt sichern
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                setReminderHidden(true);
                try {
                  sessionStorage.setItem(`backupLater:${project.id}`, '1');
                } catch {
                  /* optional */
                }
              }}
            >
              Später
            </button>
          </div>
        </div>
      )}

      <section className="project-info card" data-testid="project-info">
        <dl className="info-grid">
          <div>
            <dt>{ccs.filter((c) => costCenterLabel(c)).length > 1 ? 'Kostenstellen' : 'Kostenstelle'}</dt>
            <dd data-testid="project-cost-centers">{ccs.map((c) => costCenterLabel(c)).filter(Boolean).join(', ') || '–'}</dd>
          </div>
          {project.number && (
            <div>
              <dt>Projektnummer</dt>
              <dd data-testid="project-number">{project.number}</dd>
            </div>
          )}
          <div>
            <dt>Adresse</dt>
            <dd>{project.address || project.site || '–'}</dd>
          </div>
          <div>
            <dt>Auftraggeber</dt>
            <dd>{project.client || '–'}</dd>
          </div>
          <div>
            <dt>Baubeginn</dt>
            <dd data-testid="project-start">{project.date ? formatDate(project.date) : '–'}</dd>
          </div>
          {project.notes && (
            <div className="span-all">
              <dt>Bemerkung</dt>
              <dd className="pre">{project.notes}</dd>
            </div>
          )}
        </dl>
        <div className="row gap wrap">
          <button type="button" className="btn btn-sm" onClick={() => setEditing(true)} data-testid="edit-project">
            <Icon name="edit" size={18} /> Projektangaben bearbeiten
          </button>
          <button type="button" className="btn btn-sm" onClick={() => navigate(paths.photoSite(`p:${project.id}`))} data-testid="project-photos">
            <Icon name="camera" size={18} /> Fotos
          </button>
          <ProjectAccessButton projectId={project.id} name={project.name} />
        </div>
      </section>

      {/* vor den Plänen: Option „Nach Rechnungen aufteilen“ bzw. die Rechnungen */}
      <InvoiceBar
        project={project}
        invoices={invoices}
        selected={invoice}
        planCount={(id) => Object.values(data.plans).filter((p) => !p.deletedAt && p.invoiceId === id).length}
        canSplit
        onSelect={setInvoiceSel}
        onSave={(inv, turnOn) => {
          const list = project.invoices ?? [];
          const exists = list.some((i) => i.id === inv.id);
          updateProject({ ...(turnOn ? { splitByInvoice: true } : {}), invoices: exists ? list.map((i) => (i.id === inv.id ? inv : i)) : [...list, inv] });
          // bestehende Pläne kommen beim Aufteilen in die erste Rechnung (lassen sich später verschieben)
          if (turnOn) {
            const loose = Object.values(data.plans).filter((p) => !p.deletedAt && !p.invoiceId);
            if (loose.length) putRecords({ plans: loose.map((p) => ({ ...p, invoiceId: inv.id })) });
          }
          if (!exists) setInvoiceSel(inv.id);
          toast(`${invoiceLabel(inv)} ${exists ? 'gespeichert' : 'angelegt'}.`, 'success');
        }}
        onToggleSettled={(inv) => {
          updateProject({ invoices: (project.invoices ?? []).map((i) => (i.id === inv.id ? { ...i, settled: !i.settled } : i)) });
          toast(inv.settled ? `${invoiceLabel(inv)} wieder offen.` : `${invoiceLabel(inv)} als abgerechnet markiert – Änderungen nur noch mit Warnung.`, 'info');
        }}
        onDelete={(inv) => {
          const rest = (project.invoices ?? []).filter((i) => i.id !== inv.id);
          // letzte (leere) Rechnung gelöscht: Projekt wieder ungeteilt
          updateProject(rest.length ? { invoices: rest } : { invoices: [], splitByInvoice: false });
          toast(`${invoiceLabel(inv)} gelöscht.`, 'success');
        }}
      />

      {invoice?.settled && (
        <div className="banner banner-warn" role="status" data-testid="settled-warning">
          <p>
            <strong>{invoiceLabel(invoice)} ist abgerechnet.</strong> Neue Pläne, Änderungen und Löschungen ändern eine bereits abgerechnete Rechnung.
          </p>
        </div>
      )}

      {ccs.length > 1 && (
        <div className="cc-switch" data-testid="cost-center-switch">
          <label htmlFor="cc-select">Kostenstelle</label>
          <select
            id="cc-select"
            value={active?.id}
            onChange={(e) => navigate(paths.costCenter(project.id, e.target.value), true)}
            data-testid="cost-center-select"
          >
            {ccs.map((c) => (
              <option key={c.id} value={c.id}>
                {costCenterName(c)} ({plansOf(data, c.id, invoiceFilter).length})
              </option>
            ))}
          </select>
          {active && (
            <ActionMenu
              label={`Aktionen für Kostenstelle ${costCenterName(active)}`}
              testId="cost-center-actions"
              actions={[
                { label: 'Kostenstellen bearbeiten', icon: 'edit', onSelect: () => setEditing(true) },
                { label: 'Diese Kostenstelle löschen', icon: 'trash', danger: true, onSelect: () => void deleteCostCenter(active) },
              ]}
            />
          )}
        </div>
      )}

      {!active ? (
        <div className="empty">
          <p>Dieses Projekt hat noch keine Kostenstelle.</p>
          <button type="button" className="btn btn-primary btn-lg" onClick={() => setEditing(true)}>
            <Icon name="plus" /> Kostenstelle anlegen
          </button>
        </div>
      ) : (
        <section className="project-block block-plans" data-testid="plans-section">
          <div className="section-head">
            <h2 className="section-title plans-title">
              <span className="block-icon" aria-hidden="true">
                <Icon name="map" size={20} />
              </span>
              Pläne
              {ccs.length > 1 ? (
                <>
                  <span className="muted"> · </span>
                  <span data-testid="cost-center-title">{costCenterName(active)}</span>
                </>
              ) : (
                <span className="sr-only" data-testid="cost-center-title">
                  {costCenterLabel(active)}
                </span>
              )}
            </h2>
            <div className="row gap wrap">
              {/* alle drei schwarz, beim Antippen weiß */}
              <button type="button" className="btn btn-ink" onClick={() => fileRef.current?.click()} data-testid="import-plan">
                <Icon name="upload" /> Plan importieren
              </button>
              <button type="button" className="btn btn-ink" onClick={() => setDrawingNew(true)} data-testid="draw-plan">
                <Icon name="drawPlan" /> Plan zeichnen
              </button>
              <button type="button" className="btn btn-ink" onClick={() => setLibrary(true)} data-testid="open-plan-library">
                <Icon name="folder" /> Planbibliothek
              </button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,.pdf,image/jpeg,.jpg,.jpeg,image/png,.png"
              hidden
              data-testid="plan-file-input"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) setImportFile(f);
              }}
            />
          </div>

          {plans.length > 1 && (
            <div className="plan-sort-row">
              <SelectToggle sel={planSel} testId="plans-select" />
              <button type="button" className="btn btn-sm" onClick={toggleSort} title="Reihenfolge der Pläne umkehren" data-testid="plan-sort" data-order={planDesc ? 'desc' : 'asc'}>
                <Icon name={planDesc ? 'down' : 'up'} size={16} /> Plannr. {planDesc ? 'absteigend' : 'aufsteigend'}
              </button>
            </div>
          )}
          {plans.length ? (
              <PlanList
                data={data}
                plans={plans}
                onEdit={setDetails}
                onRename={(p) => void renamePlan(p)}
                onCrop={(p) => void openCrop(p)}
                onReuse={(p) => setReuse({ file: data.files[p.fileId], pageIndex: p.pageIndex, base: p })}
                onDuplicate={duplicatePlan}
                onRotate={setRotating}
                onDelete={(p) => void deletePlan(p)}
                onPdf={(p) => setPdfPlans([p.id])}
                sel={planSel}
              />
            ) : null}
          <SelectionBar
            sel={planSel}
            noun={['Plan', 'Pläne']}
            testId="plans-select-bar"
            actions={[
              { label: 'Löschen', icon: 'trash', primary: true, danger: true, onSelect: () => void deletePlans(selectedPlans()), testId: 'plans-bulk-delete' },
              { label: 'Ändern', icon: 'edit', primary: true, onSelect: () => setBulkPlans(selectedPlans()), testId: 'plans-bulk-edit' },
              { label: 'Als PDF herunterladen', icon: 'pdf', onSelect: () => setPdfPlans(planSel.ids), testId: 'plans-bulk-pdf' },
              {
                label: 'Neues Aufmaß aus diesen Plänen (Excel)',
                icon: 'excel',
                onSelect: () => {
                  setExcelSheet(undefined);
                  setExcelScope({ kind: 'plans', planIds: planSel.ids });
                },
                testId: 'plans-bulk-aufmass',
              },
              {
                label: 'Duplizieren (mit Messungen)',
                icon: 'copy',
                onSelect: () => {
                  for (const p of selectedPlans()) duplicatePlan(p);
                  planSel.stop();
                },
                testId: 'plans-bulk-duplicate',
              },
            ]}
          />
          {plans.length > 0 && (
            <div className="row gap wrap plan-list-foot">
              {plans.length > 0 && (
                <>
                  <button type="button" className="btn" onClick={() => setPdfPlans(plans.map((p) => p.id))} data-testid="plans-pdf">
                    <Icon name="pdf" /> Pläne als PDF herunterladen
                  </button>
                  <button type="button" className="btn" onClick={() => setPhotoPlans(plans.map((p) => p.id))} data-testid="plans-photos">
                    <Icon name="camera" /> Fotos exportieren
                  </button>
                </>
              )}
            </div>
          )}
          {plans.length ? null : (
              <div className="empty">
                <p data-testid="plans-empty">Noch keine Pläne{invoice ? ` in der ${invoiceLabel(invoice)}` : ''}{ccs.length > 1 ? ' in dieser Kostenstelle' : ''}.</p>
                <p className="muted">Importieren Sie einen Plan als PDF, JPG oder PNG – auf iPhone/iPad aus „Dateien“ oder der Fotomediathek.</p>
                <div className="row gap wrap center">
                  <button type="button" className="btn btn-primary btn-lg" onClick={() => fileRef.current?.click()}>
                    <Icon name="upload" /> PDF oder Foto auswählen
                  </button>
                  <button type="button" className="btn btn-lg" onClick={() => setDrawingNew(true)}>
                    <Icon name="drawPlan" /> Neuen Plan zeichnen
                  </button>
                </div>
              </div>
            )}
        </section>
      )}

      {/* Aufmaß: alle Messungen der Kostenstelle, darüber der Excel-Export (Aufmaßblatt) */}
      {active && (
        <section className="project-block block-aufmass" data-testid="aufmass-section">
          <div className="section-head">
            <h2 className="section-title">
              <span className="block-icon" aria-hidden="true">
                <Icon name="table" size={20} />
              </span>
              Aufmaß
              {invoice && (
                <>
                  <span className="muted"> · </span>
                  <span data-testid="aufmass-invoice">{invoiceLabel(invoice)}</span>
                </>
              )}
            </h2>
            <div className="row gap wrap">
              {split ? (
                invoice && (
                  <button type="button" className="btn" onClick={() => setExcelScope({ kind: 'invoice', invoiceId: invoice.id })} data-testid="export-xlsx-invoice">
                    <Icon name="excel" /> Excel – Aufmaßblatt {invoiceShort(invoice)}
                  </button>
                )
              ) : (
                <>
                  <button type="button" className="btn" onClick={() => setExcelScope({ kind: 'costCenter', costCenterId: active.id })} data-testid="export-xlsx-cc">
                    <Icon name="excel" /> {ccs.length > 1 ? 'Excel – Aufmaßblatt Kostenstelle' : 'Excel – Aufmaßblatt'}
                  </button>
                  {ccs.length > 1 && (
                    <button type="button" className="btn" onClick={() => setExcelScope({ kind: 'project' })} data-testid="export-xlsx-project">
                      <Icon name="excel" /> Excel – gesamtes Projekt
                    </button>
                  )}
                  {sheets.length > 1 && <SelectToggle sel={sheetSel} testId="aufmass-select" onStart={() => setOpenAufmass(new Set())} />}
                </>
              )}
            </div>
          </div>
          {split ? (
            // je Rechnung ein Aufmaß: alle Messungen ihrer Pläne (alle Kostenstellen)
            shownRows.length ? (
              planGroups(`inv-${invoice?.id ?? ''}`, [], shownRows)
            ) : (
              <p className="muted" data-testid="aufmass-empty">
                Noch keine Messungen{invoice ? ` in der ${invoiceLabel(invoice)}` : ''} – sie erscheinen hier, sobald im Plan gemessen wird.
              </p>
            )
          ) : sheets.length ? (
            // Aufmaße entstehen erst über „Aufmaßblatt“ mit gewählten Plänen; Messungen erst nach Antippen
            <div className="aufmass-blocks" data-testid="aufmass-list">
              {sheets.map(({ sheet, name, sheetPlans }) => {
                const own = aufmassRows(data, sheetPlans);
                const open = openAufmass.has(sheet.id);
                return (
                  <div key={sheet.id} className={`aufmass-block${open ? ' open' : ''}`} data-testid="aufmass-block" data-selected={sheetSel.active ? sheetSel.has(sheet.id) : undefined}>
                    <div className="aufmass-block-head">
                      {sheetSel.active && <SelectBox sel={sheetSel} id={sheet.id} label={name} testId="aufmass-check" />}
                      <button
                        type="button"
                        className="aufmass-toggle"
                        aria-expanded={sheetSel.active ? undefined : open}
                        onClick={() => (sheetSel.active ? sheetSel.toggle(sheet.id) : toggleOpen(setOpenAufmass, sheet.id))}
                        data-testid="aufmass-toggle"
                      >
                        <Icon name="next" size={18} />
                        <span className="aufmass-toggle-text">
                          <strong data-testid="aufmass-name">{name}</strong>
                          <span className="muted small" data-testid="aufmass-plans">
                            {sheetPlans.length === 1 ? 'Plan' : 'Pläne'} {sheetPlans.map((p) => p.planNumber || planTitle(p)).join(', ')} · {own.length} {own.length === 1 ? 'Messung' : 'Messungen'}
                            {own.length > 0 && quantityLines(own.map((r) => r.damage)).map((q) => ` · ${q}`).join('')}
                          </span>
                        </span>
                      </button>
                      {!sheetSel.active && (
                      <ActionMenu
                        label={`Aktionen für ${name}`}
                        testId="aufmass-actions"
                        actions={[
                          { label: 'Umbenennen', icon: 'edit', onSelect: () => void renameSheet(sheet.id, name), testId: 'aufmass-rename' },
                          ...(sheet.name ? [{ label: 'Wieder durchnummerieren', icon: 'undo', onSelect: () => patchSheet(sheet.id, { name: '' }), testId: 'aufmass-renumber' }] : []),
                          {
                            label: 'Excel – Aufmaßblatt / Pläne ändern',
                            icon: 'excel',
                            onSelect: () => {
                              setExcelSheet(sheet.id);
                              setExcelScope({ kind: 'plans', planIds: sheetPlans.map((p) => p.id) });
                            },
                            testId: 'aufmass-excel',
                          },
                          { label: 'Aufmaß löschen', icon: 'trash', onSelect: () => void deleteSheet(sheet.id, name), testId: 'aufmass-delete' },
                        ]}
                      />
                      )}
                    </div>
                    {open && !sheetSel.active && (
                      <>
                        {sheetPlans.length > 1 ? (
                          planGroups(sheet.id, sheetPlans, own)
                        ) : own.length ? (
                          <AufmassTable rows={own} components={data.components} positionLabel={(ref) => findPosition(data, ref)?.pos.number ?? null} {...positionGrouping(data)} onSelect={(r) => navigate(paths.plan(project.id, r.plan.id, r.damage.id))} />
                        ) : (
                          <p className="muted small aufmass-block-empty">Noch keine Messungen in {sheetPlans.length === 1 ? 'diesem Plan' : 'diesen Plänen'}.</p>
                        )}
                        <div className="row gap wrap aufmass-block-foot">
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => {
                              setExcelSheet(sheet.id);
                              setExcelScope({ kind: 'plans', planIds: sheetPlans.map((p) => p.id) });
                            }}
                            data-testid="aufmass-foot-excel"
                          >
                            <Icon name="excel" size={16} /> Excel – Aufmaßblatt
                          </button>
                          <button type="button" className="btn btn-sm btn-danger-text" onClick={() => void deleteSheet(sheet.id, name)} data-testid="aufmass-foot-delete">
                            <Icon name="trash" size={16} /> Aufmaß löschen
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="muted" data-testid="aufmass-empty">
              Noch kein Aufmaß. Die Messungen bleiben im Plan – ein Aufmaß entsteht, sobald du auf „Aufmaßblatt“ tippst und die Pläne auswählst.
            </p>
          )}
        </section>
      )}

      <SelectionBar
        sel={sheetSel}
        noun={['Aufmaß', 'Aufmaße']}
        testId="aufmass-select-bar"
        actions={[
          { label: 'Löschen', icon: 'trash', primary: true, danger: true, onSelect: () => void deleteSheets(pickedSheets()), testId: 'aufmass-bulk-delete' },
          { label: 'Zusammenführen', icon: 'layers', primary: true, disabled: sheetSel.count < 2, onSelect: () => mergeSheets(pickedSheets()), testId: 'aufmass-bulk-merge' },
          {
            label: 'Gemeinsam als Excel (neues Aufmaß)',
            icon: 'excel',
            onSelect: () => {
              setExcelSheet(undefined);
              setExcelScope({ kind: 'plans', planIds: unionPlans(pickedSheets()) });
              sheetSel.stop();
            },
            testId: 'aufmass-bulk-excel',
          },
        ]}
      />

      {/* LV und MFK des Projekts: LV zuerst, darunter die MFKs */}
      <section className="project-block block-lv" data-testid="lv-section">
        <h2 className="section-title">
          <span className="block-icon" aria-hidden="true">
            <Icon name="file" size={20} />
          </span>
          LV / MFK
        </h2>
        <LvPanel data={data} />
      </section>

      <section className="project-block block-export">
        <h2 className="section-title">
          <span className="block-icon" aria-hidden="true">
            <Icon name="download" size={20} />
          </span>
          Export und Sicherung
        </h2>
        <div className="button-row">
          <button type="button" className="btn" onClick={() => setPdfPlans(plans.map((p) => p.id))} disabled={!plans.length}>
            <Icon name="pdf" /> PDF – Pläne auswählen
          </button>
          <button type="button" className="btn" onClick={() => setPhotoPlans(plans.map((p) => p.id))} disabled={!plans.length} data-testid="project-photos-export">
            <Icon name="camera" /> Fotos exportieren
          </button>
          <button type="button" className="btn" onClick={() => void backup()} data-testid="backup-project">
            <Icon name="download" /> Projekt sichern (Datei)
          </button>
        </div>
      </section>

      {editing && (
        <ProjectForm
          title="Projektangaben bearbeiten"
          submitLabel="Speichern"
          projectId={project.id}
          initial={{ ...project, color: projectColor(project) }}
          costCenters={ccs.map((c) => ({ id: c.id, number: c.number ?? '', name: c.name }))}
          onClose={() => setEditing(false)}
          onSubmit={saveProject}
        />
      )}
      {bulkPlans && (
        <BulkPlanDialog
          plans={bulkPlans}
          costCenters={ccs}
          invoices={split ? invoices : []}
          onClose={() => {
            setBulkPlans(null);
            planSel.stop();
          }}
        />
      )}
      {excelScope && (
        <ExcelExportDialog
          data={data}
          scope={excelScope}
          sheetId={excelSheet}
          onClose={() => {
            setExcelScope(null);
            setExcelSheet(undefined);
          }}
        />
      )}
      {rotating && (
        <RotatePlanDialog
          data={data}
          plan={data.plans[rotating.id]}
          onClose={() => setRotating(null)}
          onReuse={(p) => {
            setRotating(null);
            setReuse({ file: data.files[p.fileId], pageIndex: p.pageIndex, base: p });
          }}
        />
      )}
      {library && (
        <PlanLibrary
          data={data}
          onClose={() => setLibrary(false)}
          onReuse={(s) => {
            setLibrary(false);
            setReuse(s);
          }}
        />
      )}
      {reuse && active && (
        <ReusePlanDialog
          data={data}
          source={reuse}
          costCenterId={active.id}
          invoiceId={invoice?.id ?? null}
          onClose={() => setReuse(null)}
          onCreated={(id) => {
            setReuse(null);
            navigate(paths.plan(project.id, id));
          }}
        />
      )}
      {importFile && active && (
        <ImportWizard
          file={importFile}
          data={data}
          costCenterId={active.id}
          invoiceId={invoice?.id ?? null}
          onClose={() => setImportFile(null)}
          onDone={(ids) => {
            setImportFile(null);
            if (ids.length === 1) navigate(paths.plan(project.id, ids[0]));
          }}
        />
      )}
      {drawingNew && active && (
        <NewDrawingDialog
          data={data}
          costCenterId={active.id}
          invoiceId={invoice?.id ?? null}
          onClose={() => setDrawingNew(false)}
          onCreated={(id) => {
            setDrawingNew(false);
            navigate(paths.plan(project.id, id));
          }}
        />
      )}
      {details && <PlanDetailsDialog plan={details} data={data} onClose={() => setDetails(null)} />}
      {cropping && (
        <AreaEditor
          title="Planausschnitt festlegen"
          image={cropping.image}
          pageWidth={cropping.plan.pageWidth}
          pageHeight={cropping.plan.pageHeight}
          initial={cropping.plan.crop ? [cropping.plan.crop] : []}
          single
          onClose={() => setCropping(null)}
          onDone={(areas) => {
            const plan = data.plans[cropping.plan.id];
            // Papierformat bleibt erhalten (ältere Pläne: bisheriges automatisches Format festhalten)
            putRecord('plans', { ...plan, paper: plan.paper ?? exportPaper(plan), crop: areas[0] ?? null });
            setCropping(null);
            toast('Planausschnitt geändert. Die Messungen behalten ihre Position auf der Seite.');
          }}
        />
      )}
      {pdfPlans && <PdfExportDialog data={data} costCenterId={active?.id} initial={pdfPlans} onClose={() => setPdfPlans(null)} />}
      {trashOpen && <TrashDialog data={data} onClose={() => setTrashOpen(false)} />}
      {photoPlans && <PdfExportDialog data={data} costCenterId={active?.id} initial={photoPlans} mode="photos" onClose={() => setPhotoPlans(null)} />}
    </div>
    </>
  );
}
