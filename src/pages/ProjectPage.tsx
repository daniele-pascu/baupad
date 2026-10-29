import { useEffect, useRef, useState } from 'react';
import { ActionMenu } from '../components/ActionMenu';
import { AreaEditor } from '../components/AreaEditor';
import { AufmassTable } from '../components/AufmassTable';
import { Icon } from '../components/Icon';
import { ImportWizard } from '../components/ImportWizard';
import { InvoiceBar } from '../components/InvoiceBar';
import { invoiceLabel, invoiceOfPlan, invoiceShort, invoicesOf } from '../lib/invoices';
import { LvPanel } from '../components/LvPanel';
import { PdfExportDialog } from '../components/PdfExportDialog';
import { NewDrawingDialog, PlanDetailsDialog } from '../components/PlanFields';
import { PlanLibrary, ReusePlanDialog, type PlanSource } from '../components/PlanLibrary';
import { PlanList } from '../components/PlanList';
import { RotatePlanDialog } from '../components/RotatePlanDialog';
import { ExcelExportDialog } from '../components/ExcelExportDialog';
import { ProjectForm, type CostCenterInput } from '../components/ProjectForm';
import { SaveErrorBanner, SaveStatus } from '../components/SaveStatus';
import { confirmDialog, offerFile, promptDialog, showError, toast } from '../components/ui';
import { aufmassNameOf, aufmassRows, componentsOf, findPosition, costCenterLabel, costCenterName, costCentersOf, damagesOf, elementsOf, planTitle, plansOf, sumArea } from '../lib/aufmass';
import type { BlattScope } from '../lib/aufmassblatt';
import { BACKUP_REMIND_DAYS, backupStatus, exportProjectBackup, type BackupStatus } from '../lib/backup';
import { isDrawingPlan } from '../lib/drawing';
import { exportPaper } from '../lib/sheet-layout';
import { formatArea, formatDate, formatDateTime } from '../lib/numbers';
import { navigate, paths } from '../lib/router';
import { flush, newMeta, putRecord, putRecords, softDelete, updateProject, useAppState, type ProjectState } from '../lib/store';
import { propagateProject } from '../lib/sites';
import { renderSource } from '../lib/thumbs';
import type { CostCenter, Plan } from '../lib/types';

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
  const [pdfOpen, setPdfOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [details, setDetails] = useState<Plan | null>(null);
  const [cropping, setCropping] = useState<{ plan: Plan; image: HTMLCanvasElement } | null>(null);
  const [drawingNew, setDrawingNew] = useState(false);
  const [library, setLibrary] = useState(false);
  /** aufgeklappte Aufmaße (Liste je Plan) */
  const [openAufmass, setOpenAufmass] = useState<Set<string>>(() => new Set());
  const [reuse, setReuse] = useState<PlanSource | null>(null);
  const [rotating, setRotating] = useState<Plan | null>(null);
  const [excelScope, setExcelScope] = useState<BlattScope | null>(null);
  const [backupInfo, setBackupInfo] = useState<BackupStatus | null>(null);
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
  const plans = active ? plansOf(data, active.id, invoiceFilter) : [];
  const rows = aufmassRows(data, plans);
  /** Aufmaß der Rechnung: alle Messungen ihrer Pläne über alle Kostenstellen */
  const shownRows = split ? aufmassRows(data, invoice ? ccs.flatMap((c) => plansOf(data, c.id, invoice.id)) : []) : rows;
  const projectHasPlans = Object.values(data.plans).some((p) => !p.deletedAt);

  // ---------------------------------------------------------------------------
  // Projekt und Kostenstellen

  const saveProject = (fields: Parameters<typeof updateProject>[0], inputs: CostCenterInput[]) => {
    updateProject(fields);
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

  const renamePlan = async (plan: Plan) => {
    const name = await promptDialog({ title: 'Plan umbenennen', label: 'Planbezeichnung', value: plan.planName });
    if (name === null || name === plan.planName) return;
    // Nur die Bezeichnung ändert sich – Messungen, Farben und Bemerkungen bleiben unberührt
    putRecord('plans', { ...data.plans[plan.id], planName: name });
  };

  const renameAufmass = async (plan: Plan) => {
    const name = await promptDialog({ title: 'Aufmaß umbenennen', label: 'Name des Aufmaßes (leer = durchnummeriert)', value: aufmassNameOf(data, plan) });
    if (name === null) return;
    putRecord('plans', { ...data.plans[plan.id], aufmassName: name.trim() });
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
    <div className="page">
      <header className="topbar">
        <a className="icon-btn" href={paths.projects()} aria-label="Zu Aufmaß & Abrechnung">
          <Icon name="back" />
        </a>
        <div className="topbar-title">
          <small>Projekt</small>
          <h1 data-testid="project-title">{project.name}</h1>
        </div>
        <SaveStatus />
      </header>
      <SaveErrorBanner />
      {backupInfo?.due && !reminderHidden && (
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
        <button type="button" className="btn btn-sm" onClick={() => setEditing(true)} data-testid="edit-project">
          <Icon name="edit" size={18} /> Projektangaben bearbeiten
        </button>
      </section>

      {/* vor den Plänen: Option „Nach Rechnungen aufteilen“ bzw. die Rechnungen */}
      <InvoiceBar
        project={project}
        invoices={invoices}
        selected={invoice}
        planCount={(id) => Object.values(data.plans).filter((p) => !p.deletedAt && p.invoiceId === id).length}
        canSplit={!projectHasPlans}
        onSelect={setInvoiceSel}
        onSave={(inv, turnOn) => {
          const list = project.invoices ?? [];
          const exists = list.some((i) => i.id === inv.id);
          updateProject({ ...(turnOn ? { splitByInvoice: true } : {}), invoices: exists ? list.map((i) => (i.id === inv.id ? inv : i)) : [...list, inv] });
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
        <section>
          <div className="section-head">
            <h2 className="section-title plans-title">
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
              <button type="button" className="btn btn-primary" onClick={() => fileRef.current?.click()} data-testid="import-plan">
                <Icon name="upload" /> Plan importieren
              </button>
              <button type="button" className="btn" onClick={() => setDrawingNew(true)} data-testid="draw-plan">
                <Icon name="drawPlan" /> Plan zeichnen
              </button>
              {Object.values(data.files).some((f) => !f.deletedAt) && (
                <button type="button" className="btn" onClick={() => setLibrary(true)} data-testid="open-plan-library">
                  <Icon name="folder" /> Planbibliothek
                </button>
              )}
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

          {plans.length ? (
              <PlanList
                data={data}
                plans={plans}
                onEdit={setDetails}
                onRename={(p) => void renamePlan(p)}
                onCrop={(p) => void openCrop(p)}
                onReuse={(p) => setReuse({ file: data.files[p.fileId], pageIndex: p.pageIndex, base: p })}
                onRotate={setRotating}
                onDelete={(p) => void deletePlan(p)}
              />
            ) : (
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
        <section data-testid="aufmass-section">
          <div className="section-head">
            <h2 className="section-title">
              Aufmaß
              {invoice && (
                <>
                  <span className="muted"> · </span>
                  <span data-testid="aufmass-invoice">{invoiceLabel(invoice)}</span>
                </>
              )}{' '}
              <span className="muted">({shownRows.length})</span>
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
                </>
              )}
            </div>
          </div>
          {split ? (
            // je Rechnung ein Aufmaß: alle Messungen ihrer Pläne (alle Kostenstellen)
            shownRows.length ? (
              <AufmassTable rows={shownRows} showPlan components={data.components} positionLabel={(ref) => findPosition(data, ref)?.pos.number ?? null} onSelect={(r) => navigate(paths.plan(project.id, r.plan.id, r.damage.id))} />
            ) : (
              <p className="muted" data-testid="aufmass-empty">
                Noch keine Messungen{invoice ? ` in der ${invoiceLabel(invoice)}` : ''} – sie erscheinen hier, sobald im Plan gemessen wird.
              </p>
            )
          ) : plans.length ? (
            // Liste: je Plan ein eigenes Aufmaß (durchnummeriert bzw. umbenannt); Messungen erst nach Antippen
            <div className="aufmass-blocks" data-testid="aufmass-list">
              {plans.map((pl) => {
                const own = rows.filter((r) => r.plan.id === pl.id);
                const name = aufmassNameOf(data, pl);
                const open = openAufmass.has(pl.id);
                return (
                  <div key={pl.id} className={`aufmass-block${open ? ' open' : ''}`} data-testid="aufmass-block">
                    <div className="aufmass-block-head">
                      <button
                        type="button"
                        className="aufmass-toggle"
                        aria-expanded={open}
                        onClick={() => setOpenAufmass((prev) => {
                          const next = new Set(prev);
                          if (!next.delete(pl.id)) next.add(pl.id);
                          return next;
                        })}
                        data-testid="aufmass-toggle"
                      >
                        <Icon name="next" size={18} />
                        <span className="aufmass-toggle-text">
                          <strong data-testid="aufmass-name">{name}</strong>
                          <span className="muted small">
                            Plan {planTitle(pl)} · {own.length} {own.length === 1 ? 'Messung' : 'Messungen'}
                            {own.length > 0 && ` · ${formatArea(sumArea(own.map((r) => r.damage)))} m²`}
                          </span>
                        </span>
                      </button>
                      <ActionMenu
                        label={`Aktionen für ${name}`}
                        testId="aufmass-actions"
                        actions={[
                          { label: 'Umbenennen', icon: 'edit', onSelect: () => void renameAufmass(pl), testId: 'aufmass-rename' },
                          ...(pl.aufmassName ? [{ label: 'Wieder durchnummerieren', icon: 'undo', onSelect: () => putRecord('plans', { ...data.plans[pl.id], aufmassName: '' }), testId: 'aufmass-renumber' }] : []),
                          { label: 'Excel – Aufmaßblatt', icon: 'excel', onSelect: () => setExcelScope({ kind: 'plan', planId: pl.id }), testId: 'aufmass-excel' },
                          { label: 'Plan öffnen', icon: 'next', onSelect: () => navigate(paths.plan(project.id, pl.id)), testId: 'aufmass-open' },
                        ]}
                      />
                    </div>
                    {open &&
                      (own.length ? (
                        <AufmassTable rows={own} components={data.components} positionLabel={(ref) => findPosition(data, ref)?.pos.number ?? null} onSelect={(r) => navigate(paths.plan(project.id, r.plan.id, r.damage.id))} />
                      ) : (
                        <p className="muted small aufmass-block-empty">Noch keine Messungen in diesem Plan.</p>
                      ))}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="muted" data-testid="aufmass-empty">
              Noch keine Messungen{ccs.length > 1 ? ' in dieser Kostenstelle' : ''} – sie erscheinen hier, sobald im Plan gemessen wird.
            </p>
          )}
        </section>
      )}

      {/* LV und MFK des Projekts: LV zuerst, darunter die MFKs */}
      <section data-testid="lv-section">
        <h2 className="section-title">LV / MFK</h2>
        <LvPanel data={data} />
      </section>

      <section>
        <h2 className="section-title">Export und Sicherung</h2>
        <div className="button-row">
          <button type="button" className="btn" onClick={() => setPdfOpen(true)} disabled={!plans.length}>
            <Icon name="pdf" /> PDF – Pläne auswählen
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
          initial={project}
          costCenters={ccs.map((c) => ({ id: c.id, number: c.number ?? '', name: c.name }))}
          onClose={() => setEditing(false)}
          onSubmit={saveProject}
        />
      )}
      {excelScope && <ExcelExportDialog data={data} scope={excelScope} onClose={() => setExcelScope(null)} />}
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
            toast('Planausschnitt geändert. Die Schadstellen behalten ihre Position auf der Seite.');
          }}
        />
      )}
      {pdfOpen && <PdfExportDialog data={data} costCenterId={active?.id} initial={plans.map((p) => p.id)} onClose={() => setPdfOpen(false)} />}
    </div>
  );
}
