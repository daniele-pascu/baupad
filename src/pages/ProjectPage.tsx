import { useRef, useState } from 'react';
import { ActionMenu } from '../components/ActionMenu';
import { AreaEditor } from '../components/AreaEditor';
import { AufmassTable } from '../components/AufmassTable';
import { Icon } from '../components/Icon';
import { ImportWizard } from '../components/ImportWizard';
import { LvPanel } from '../components/LvPanel';
import { PdfExportDialog } from '../components/PdfExportDialog';
import { NewDrawingDialog, PlanDetailsDialog } from '../components/PlanFields';
import { PlanList } from '../components/PlanList';
import { ProjectForm, type CostCenterInput } from '../components/ProjectForm';
import { SaveErrorBanner, SaveStatus } from '../components/SaveStatus';
import { confirmDialog, offerFile, promptDialog, showError, toast } from '../components/ui';
import { aufmassRows, componentsOf, findPosition, costCenterLabel, costCentersOf, damagesOf, elementsOf, exportXlsx, planTitle, plansOf } from '../lib/aufmass';
import { exportProjectBackup } from '../lib/backup';
import { isDrawingPlan } from '../lib/drawing';
import { formatDate } from '../lib/numbers';
import { navigate, paths } from '../lib/router';
import { flush, newMeta, putRecord, putRecords, softDelete, updateProject, useAppState, type ProjectState } from '../lib/store';
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
  const fileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [details, setDetails] = useState<Plan | null>(null);
  const [cropping, setCropping] = useState<{ plan: Plan; image: HTMLCanvasElement } | null>(null);
  const [tab, setTab] = useState<'plans' | 'table' | 'lv'>('plans');
  const [drawingNew, setDrawingNew] = useState(false);

  const plans = active ? plansOf(data, active.id) : [];
  const rows = aufmassRows(data, plans);

  // ---------------------------------------------------------------------------
  // Projekt und Kostenstellen

  const saveProject = (fields: Parameters<typeof updateProject>[0], inputs: CostCenterInput[]) => {
    updateProject(fields);
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
            Die Kostenstelle <strong>„{costCenterLabel(cc)}“</strong> wird gelöscht.
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
              : `Die Originaldatei „${file?.name ?? ''}“ wird ebenfalls entfernt.`}{' '}
            Tipp: Vorher über „Projekt sichern“ eine Sicherung anlegen.
          </p>
        </>
      ),
      confirmLabel: 'Plan löschen',
      danger: true,
    });
    if (!ok) return;
    softDelete({ plans: [plan], damages, elements, components, ...(others.length || !file ? {} : { files: [file] }) });
    toast('Plan gelöscht.');
  };

  const renamePlan = async (plan: Plan) => {
    const name = await promptDialog({ title: 'Plan umbenennen', label: 'Planbezeichnung', value: plan.planName });
    if (name === null || name === plan.planName) return;
    // Nur die Bezeichnung ändert sich – Messungen, Farben und Bemerkungen bleiben unberührt
    putRecord('plans', { ...data.plans[plan.id], planName: name });
  };

  const openCrop = async (plan: Plan) => {
    try {
      const image = await renderSource(data.files[plan.fileId], plan.pageIndex, 1800);
      setCropping({ plan, image });
    } catch (e) {
      showError(e);
    }
  };

  // ---------------------------------------------------------------------------
  // Export

  const xlsx = (scope: 'cc' | 'project') => {
    try {
      void offerFile(exportXlsx(data, scope === 'cc' && active ? { kind: 'costCenter', costCenterId: active.id } : { kind: 'project' }));
    } catch (e) {
      showError(e, 'Excel-Export fehlgeschlagen');
    }
  };

  const backup = async () => {
    try {
      await flush();
      await offerFile(await exportProjectBackup(project.id));
    } catch (e) {
      showError(e, 'Sicherung fehlgeschlagen');
    }
  };

  return (
    <div className="page">
      <header className="topbar">
        <a className="icon-btn" href={paths.projects()} aria-label="Zur Projektverwaltung">
          <Icon name="back" />
        </a>
        <div className="topbar-title">
          <small>Projekt</small>
          <h1 data-testid="project-title">{project.name}</h1>
        </div>
        <SaveStatus />
      </header>
      <SaveErrorBanner />

      <section className="project-info card" data-testid="project-info">
        <dl className="info-grid">
          <div>
            <dt>{ccs.length > 1 ? 'Kostenstellen' : 'Kostenstelle'}</dt>
            <dd data-testid="project-cost-centers">{ccs.length ? ccs.map((c) => costCenterLabel(c)).join(', ') : '–'}</dd>
          </div>
          <div>
            <dt>Baustelle</dt>
            <dd>{project.site || '–'}</dd>
          </div>
          <div>
            <dt>Adresse / Standort</dt>
            <dd>{project.address || '–'}</dd>
          </div>
          <div>
            <dt>Auftraggeber</dt>
            <dd>{project.client || '–'}</dd>
          </div>
          <div>
            <dt>Bearbeiter</dt>
            <dd>{project.editor || '–'}</dd>
          </div>
          <div>
            <dt>Datum</dt>
            <dd>{formatDate(project.date)}</dd>
          </div>
          {project.notes && (
            <div className="span-all">
              <dt>Bemerkungen</dt>
              <dd className="pre">{project.notes}</dd>
            </div>
          )}
        </dl>
        <button type="button" className="btn btn-sm" onClick={() => setEditing(true)} data-testid="edit-project">
          <Icon name="edit" size={18} /> Projektangaben bearbeiten
        </button>
      </section>

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
                {costCenterLabel(c)} ({plansOf(data, c.id).length})
              </option>
            ))}
          </select>
          {active && (
            <ActionMenu
              label={`Aktionen für Kostenstelle ${costCenterLabel(active)}`}
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
                  <span data-testid="cost-center-title">{costCenterLabel(active)}</span>
                </>
              ) : (
                <span className="sr-only" data-testid="cost-center-title">
                  {costCenterLabel(active)}
                </span>
              )}
            </h2>
            <div className="row gap wrap">
              <div className="segmented" role="tablist">
                <button type="button" role="tab" aria-selected={tab === 'plans'} onClick={() => setTab('plans')}>
                  <Icon name="map" size={18} /> Liste ({plans.length})
                </button>
                <button type="button" role="tab" aria-selected={tab === 'table'} onClick={() => setTab('table')} data-testid="tab-table">
                  <Icon name="table" size={18} /> Aufmaß ({rows.length})
                </button>
                <button type="button" role="tab" aria-selected={tab === 'lv'} onClick={() => setTab('lv')} data-testid="tab-lv">
                  <Icon name="file" size={18} /> LV / MFK
                </button>
              </div>
              <button type="button" className="btn btn-primary" onClick={() => fileRef.current?.click()} data-testid="import-plan">
                <Icon name="upload" /> Plan importieren
              </button>
              <button type="button" className="btn" onClick={() => setDrawingNew(true)} data-testid="draw-plan">
                <Icon name="drawPlan" /> Plan zeichnen
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

          {tab === 'plans' &&
            (plans.length ? (
              <PlanList
                data={data}
                plans={plans}
                onEdit={setDetails}
                onRename={(p) => void renamePlan(p)}
                onCrop={(p) => void openCrop(p)}
                onDelete={(p) => void deletePlan(p)}
              />
            ) : (
              <div className="empty">
                <p>Noch keine Pläne{ccs.length > 1 ? ' in dieser Kostenstelle' : ''}.</p>
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
            ))}

          {tab === 'lv' && <LvPanel data={data} />}
          {tab === 'table' && <AufmassTable rows={rows} showPlan components={data.components} positionLabel={(ref) => findPosition(data, ref)?.pos.number ?? null} onSelect={(r) => navigate(paths.plan(project.id, r.plan.id, r.damage.id))} />}
        </section>
      )}

      <section>
        <h2 className="section-title">Export und Sicherung</h2>
        <div className="button-row">
          {active && (
            <button type="button" className="btn" onClick={() => xlsx('cc')} data-testid="export-xlsx-cc">
              <Icon name="excel" /> {ccs.length > 1 ? 'Excel – Kostenstelle' : 'Excel – Aufmaß'}
            </button>
          )}
          {ccs.length > 1 && (
            <button type="button" className="btn" onClick={() => xlsx('project')} data-testid="export-xlsx-project">
              <Icon name="excel" /> Excel – gesamtes Projekt
            </button>
          )}
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
      {importFile && active && (
        <ImportWizard
          file={importFile}
          data={data}
          costCenterId={active.id}
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
            putRecord('plans', { ...plan, crop: areas[0] ?? null });
            setCropping(null);
            toast('Planausschnitt geändert. Die Schadstellen behalten ihre Position auf der Seite.');
          }}
        />
      )}
      {pdfOpen && <PdfExportDialog data={data} costCenterId={active?.id} initial={plans.map((p) => p.id)} onClose={() => setPdfOpen(false)} />}
    </div>
  );
}
