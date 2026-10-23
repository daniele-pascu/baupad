import { useState } from 'react';
import { Icon } from '../components/Icon';
import { PdfExportDialog } from '../components/PdfExportDialog';
import { ProjectForm } from '../components/ProjectForm';
import { SaveErrorBanner, SaveStatus } from '../components/SaveStatus';
import { confirmDialog, offerFile, promptDialog, showError, toast } from '../components/ui';
import { costCentersOf, damagesOf, exportXlsx, plansOf, sumArea } from '../lib/aufmass';
import { exportProjectBackup } from '../lib/backup';
import { formatArea, formatDate } from '../lib/numbers';
import { paths } from '../lib/router';
import { flush, newMeta, putRecord, softDelete, updateProject, useAppState, type ProjectState } from '../lib/store';
import type { CostCenter } from '../lib/types';

export function ProjectPage() {
  const data = useAppState((s) => s.data) as ProjectState;
  const project = data.project;
  const [editing, setEditing] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const ccs = costCentersOf(data);

  const addCostCenter = async () => {
    const name = await promptDialog({ title: 'Neue Kostenstelle', label: 'Bezeichnung (z. B. Tiefgarage, Stiege 1)', confirmLabel: 'Anlegen' });
    if (!name) return;
    if (ccs.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      toast(`Die Kostenstelle „${name}“ gibt es bereits.`, 'error');
      return;
    }
    const cc: CostCenter = {
      ...newMeta(),
      projectId: project.id,
      name,
      sortIndex: ccs.length ? Math.max(...ccs.map((c) => c.sortIndex)) + 1 : 0,
    };
    putRecord('costCenters', cc);
  };

  const renameCostCenter = async (cc: CostCenter) => {
    const name = await promptDialog({ title: 'Kostenstelle umbenennen', label: 'Bezeichnung', value: cc.name });
    if (!name || name === cc.name) return;
    if (ccs.some((c) => c.id !== cc.id && c.name.toLowerCase() === name.toLowerCase())) {
      toast(`Die Kostenstelle „${name}“ gibt es bereits.`, 'error');
      return;
    }
    putRecord('costCenters', { ...cc, name });
  };

  const deleteCostCenter = async (cc: CostCenter) => {
    const plans = plansOf(data, cc.id);
    const damages = plans.flatMap((p) => damagesOf(data, p.id));
    const ok = await confirmDialog({
      title: 'Kostenstelle löschen?',
      message: (
        <p>
          Die Kostenstelle <strong>„{cc.name}“</strong> mit {plans.length} Plan/Plänen und {damages.length} Schadstelle(n) wird gelöscht.
        </p>
      ),
      confirmLabel: 'Löschen',
      danger: true,
    });
    if (!ok) return;
    softDelete({ costCenters: [cc], plans, damages });
    toast('Kostenstelle gelöscht.');
  };

  const xlsx = async () => {
    try {
      await offerFile(exportXlsx(data, { kind: 'project' }));
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
        <a className="icon-btn" href={paths.home()} aria-label="Zur Startseite">
          <Icon name="back" />
        </a>
        <div className="topbar-title">
          <small>Projekt</small>
          <h1 data-testid="project-title">{project.name}</h1>
        </div>
        <SaveStatus />
      </header>
      <SaveErrorBanner />

      <section className="project-info card">
        <dl className="info-grid">
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
        <button type="button" className="btn btn-sm" onClick={() => setEditing(true)}>
          <Icon name="edit" size={18} /> Projektdaten bearbeiten
        </button>
      </section>

      <section>
        <div className="section-head">
          <h2 className="section-title">Kostenstellen</h2>
          <button type="button" className="btn btn-primary" onClick={() => void addCostCenter()} data-testid="new-cost-center">
            <Icon name="plus" /> Neue Kostenstelle
          </button>
        </div>
        {!ccs.length && (
          <div className="empty">
            <p>Noch keine Kostenstellen angelegt.</p>
            <p className="muted">Beispiele: Tiefgarage, Stiege 1, Parkdeck, Fassade Nord.</p>
          </div>
        )}
        <ul className="card-list">
          {ccs.map((cc) => {
            const plans = plansOf(data, cc.id);
            const damages = plans.flatMap((p) => damagesOf(data, p.id));
            return (
              <li key={cc.id} className="card">
                <a className="card-main" href={paths.costCenter(project.id, cc.id)} data-testid="cost-center-card">
                  <div className="card-title">{cc.name}</div>
                  <div className="card-meta">
                    <span>{plans.length} Plan/Pläne</span>
                    <span>{damages.length} Schadstellen</span>
                    <span>{formatArea(sumArea(damages))} m²</span>
                  </div>
                </a>
                <div className="card-actions">
                  <button type="button" className="btn btn-sm" onClick={() => void renameCostCenter(cc)}>
                    <Icon name="edit" size={18} /> Umbenennen
                  </button>
                  <button type="button" className="btn btn-sm btn-danger-text" onClick={() => void deleteCostCenter(cc)}>
                    <Icon name="trash" size={18} /> Löschen
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h2 className="section-title">Export und Sicherung</h2>
        <div className="button-row">
          <button type="button" className="btn" onClick={() => void xlsx()} data-testid="export-xlsx-project">
            <Icon name="excel" /> Excel – gesamtes Projekt
          </button>
          <button type="button" className="btn" onClick={() => setPdfOpen(true)}>
            <Icon name="pdf" /> PDF – Pläne auswählen
          </button>
          <button type="button" className="btn" onClick={() => void backup()} data-testid="backup-project">
            <Icon name="download" /> Projekt sichern (Datei)
          </button>
        </div>
      </section>

      {editing && (
        <ProjectForm
          title="Projektdaten bearbeiten"
          submitLabel="Speichern"
          initial={project}
          onClose={() => setEditing(false)}
          onSubmit={(fields) => {
            updateProject(fields);
            setEditing(false);
          }}
        />
      )}
      {pdfOpen && (
        <PdfExportDialog data={data} initial={Object.values(data.plans).filter((p) => !p.deletedAt).map((p) => p.id)} onClose={() => setPdfOpen(false)} />
      )}
    </div>
  );
}
