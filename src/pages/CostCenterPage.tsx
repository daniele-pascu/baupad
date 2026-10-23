import { useRef, useState } from 'react';
import { AreaEditor } from '../components/AreaEditor';
import { AufmassTable } from '../components/AufmassTable';
import { Icon } from '../components/Icon';
import { ImportWizard } from '../components/ImportWizard';
import { PdfExportDialog } from '../components/PdfExportDialog';
import { PlanDetailsDialog } from '../components/PlanFields';
import { PlanThumb } from '../components/PlanThumb';
import { SaveErrorBanner, SaveStatus } from '../components/SaveStatus';
import { confirmDialog, offerFile, showError, toast } from '../components/ui';
import { aufmassRows, damagesOf, exportXlsx, planTitle, plansOf, sumArea } from '../lib/aufmass';
import { formatArea } from '../lib/numbers';
import { navigate, paths } from '../lib/router';
import { putRecord, softDelete, useAppState, type ProjectState } from '../lib/store';
import { renderSource } from '../lib/thumbs';
import type { Plan } from '../lib/types';

export function CostCenterPage({ costCenterId }: { costCenterId: string }) {
  const data = useAppState((s) => s.data) as ProjectState;
  const cc = data.costCenters[costCenterId];
  const fileRef = useRef<HTMLInputElement>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [details, setDetails] = useState<Plan | null>(null);
  const [cropping, setCropping] = useState<{ plan: Plan; image: HTMLCanvasElement } | null>(null);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [tab, setTab] = useState<'plans' | 'table'>('plans');

  if (!cc || cc.deletedAt) {
    return (
      <div className="page">
        <div className="banner banner-error">Kostenstelle nicht gefunden.</div>
        <a className="btn" href={paths.project(data.project.id)}>
          Zum Projekt
        </a>
      </div>
    );
  }

  const plans = plansOf(data, cc.id);
  const rows = aufmassRows(data, plans);

  const deletePlan = async (plan: Plan) => {
    const damages = damagesOf(data, plan.id);
    const ok = await confirmDialog({
      title: 'Plan löschen?',
      message: (
        <p>
          Der Plan <strong>„{planTitle(plan)}“</strong> mit {damages.length} Schadstelle(n) wird gelöscht. Die Originaldatei bleibt
          erhalten, solange sie von anderen Plänen verwendet wird.
        </p>
      ),
      confirmLabel: 'Löschen',
      danger: true,
    });
    if (!ok) return;
    const others = Object.values(data.plans).filter((p) => !p.deletedAt && p.fileId === plan.fileId && p.id !== plan.id);
    const file = data.files[plan.fileId];
    softDelete({ plans: [plan], damages, ...(others.length || !file ? {} : { files: [file] }) });
    toast('Plan gelöscht.');
  };

  const openCrop = async (plan: Plan) => {
    try {
      const image = await renderSource(data.files[plan.fileId], plan.pageIndex, 1800);
      setCropping({ plan, image });
    } catch (e) {
      showError(e);
    }
  };

  return (
    <div className="page">
      <header className="topbar">
        <a className="icon-btn" href={paths.project(data.project.id)} aria-label="Zum Projekt">
          <Icon name="back" />
        </a>
        <div className="topbar-title">
          <small>{data.project.name} · Kostenstelle</small>
          <h1 data-testid="cost-center-title">{cc.name}</h1>
        </div>
        <SaveStatus />
      </header>
      <SaveErrorBanner />

      <div className="section-head">
        <div className="segmented" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'plans'} onClick={() => setTab('plans')}>
            <Icon name="map" size={18} /> Pläne ({plans.length})
          </button>
          <button type="button" role="tab" aria-selected={tab === 'table'} onClick={() => setTab('table')} data-testid="tab-table">
            <Icon name="table" size={18} /> Aufmaß ({rows.length})
          </button>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => fileRef.current?.click()} data-testid="import-plan">
          <Icon name="upload" /> Plan importieren
        </button>
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

      {tab === 'plans' && (
        <>
          {!plans.length && (
            <div className="empty">
              <p>Noch keine Pläne in dieser Kostenstelle.</p>
              <p className="muted">Importieren Sie einen Plan als PDF, JPG oder PNG – auf iPhone/iPad aus „Dateien“ oder der Fotomediathek.</p>
              <button type="button" className="btn btn-primary btn-lg" onClick={() => fileRef.current?.click()}>
                <Icon name="upload" /> PDF oder Foto auswählen
              </button>
            </div>
          )}
          <ul className="plan-grid">
            {plans.map((plan) => {
              const damages = damagesOf(data, plan.id);
              return (
                <li key={plan.id} className="card plan-card">
                  <a href={paths.plan(data.project.id, plan.id)} className="plan-card-main" data-testid="plan-card">
                    <PlanThumb plan={plan} file={data.files[plan.fileId]} />
                    <div className="card-title">{planTitle(plan)}</div>
                    <div className="card-sub">{[plan.floor, plan.area].filter(Boolean).join(' · ') || ' '}</div>
                    <div className="card-meta">
                      <span>{damages.length} Schadstellen</span>
                      <span>{formatArea(sumArea(damages))} m²</span>
                    </div>
                  </a>
                  <div className="card-actions">
                    <button type="button" className="btn btn-sm" onClick={() => setDetails(plan)}>
                      <Icon name="edit" size={18} /> Angaben
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => void openCrop(plan)}>
                      <Icon name="crop" size={18} /> Ausschnitt
                    </button>
                    <button type="button" className="btn btn-sm btn-danger-text" onClick={() => void deletePlan(plan)}>
                      <Icon name="trash" size={18} /> Löschen
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {tab === 'table' && (
        <AufmassTable
          rows={rows}
          showPlan
          onSelect={(r) => navigate(paths.plan(data.project.id, r.plan.id, r.damage.id))}
        />
      )}

      <section>
        <h2 className="section-title">Export</h2>
        <div className="button-row">
          <button
            type="button"
            className="btn"
            onClick={() => {
              try {
                void offerFile(exportXlsx(data, { kind: 'costCenter', costCenterId: cc.id }));
              } catch (e) {
                showError(e, 'Excel-Export fehlgeschlagen');
              }
            }}
            data-testid="export-xlsx-cc"
          >
            <Icon name="excel" /> Excel – Kostenstelle
          </button>
          <button type="button" className="btn" onClick={() => setPdfOpen(true)} disabled={!plans.length}>
            <Icon name="pdf" /> PDF – Pläne auswählen
          </button>
        </div>
      </section>

      {importFile && (
        <ImportWizard
          file={importFile}
          data={data}
          costCenterId={cc.id}
          onClose={() => setImportFile(null)}
          onDone={(ids) => {
            setImportFile(null);
            if (ids.length === 1) navigate(paths.plan(data.project.id, ids[0]));
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
      {pdfOpen && <PdfExportDialog data={data} costCenterId={cc.id} initial={plans.map((p) => p.id)} onClose={() => setPdfOpen(false)} />}
    </div>
  );
}
