import { useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { ProjectForm, type CostCenterInput, type ProjectFields } from '../components/ProjectForm';
import { SiteNav } from '../components/SiteNav';
import { confirmDialog, offerFile, promptDialog, showError, toast } from '../components/ui';
import { exportProjectBackup, findExistingProject, importProjectBackup, readProjectBackup } from '../lib/backup';
import { deleteProjectCompletely, getMeta, listProjects, projectStats, setMeta, writeRecords } from '../lib/db';
import { isIOS } from '../lib/download';
import { getDeviceId } from '../lib/ids';
import { formatDate, formatDateTime } from '../lib/numbers';
import { navigate, paths } from '../lib/router';
import { closeProject, createProjectWithCostCenters } from '../lib/store';
import type { Project } from '../lib/types';

interface Row {
  project: Project;
  lastEdit: number;
  stats: { costCenters: number; plans: number; damages: number };
}

export function HomePage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [storage, setStorage] = useState<{ usage: number; quota: number; persisted: boolean } | null>(null);
  const [upgraded, setUpgraded] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      const projects = await listProjects();
      const result = await Promise.all(
        projects.map(async (project) => ({
          project,
          lastEdit: Math.max(project.updatedAt, (await getMeta<number>(`lastEdit:${project.id}`)) ?? 0),
          stats: await projectStats(project.id),
        })),
      );
      setRows(result.sort((a, b) => b.lastEdit - a.lastEdit));
    } catch (e) {
      showError(e, 'Projekte konnten nicht geladen werden');
      setRows([]);
    }
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      const persisted = (await navigator.storage.persisted?.()) ?? false;
      setStorage({ usage: est.usage ?? 0, quota: est.quota ?? 0, persisted });
    }
  };

  useEffect(() => {
    void closeProject();
    void load();
    getMeta<number>('upgradedFrom')
      .then((v) => setUpgraded(!!v))
      .catch(() => {});
  }, []);

  const create = async (fields: ProjectFields, costCenters: CostCenterInput[]) => {
    // Dauerhafte Speicherung anfordern, damit der Browser die Daten nicht automatisch löscht
    try {
      await navigator.storage?.persist?.();
    } catch {
      /* optional */
    }
    const { project } = await createProjectWithCostCenters(fields, costCenters);
    // Projektseite mit Projektinfos, Kostenstelle und Planliste – dort wird der erste Plan importiert
    navigate(paths.project(project.id));
  };

  const rename = async (p: Project) => {
    const name = await promptDialog({ title: 'Projekt umbenennen', label: 'Projektname', value: p.name });
    if (!name || name === p.name) return;
    try {
      await writeRecords([
        { store: 'projects', record: { ...p, name, rev: p.rev + 1, updatedAt: Date.now(), deviceId: getDeviceId() }, baseRev: p.rev },
      ]);
      toast('Projekt umbenannt.', 'success');
    } catch (e) {
      showError(e);
    }
    void load();
  };

  const remove = async (r: Row) => {
    const ok = await confirmDialog({
      title: 'Projekt löschen?',
      message: (
        <>
          <p>
            Das Projekt <strong>„{r.project.name}“</strong> mit {r.stats.costCenters} Kostenstelle(n), {r.stats.plans} Plan/Plänen und{' '}
            {r.stats.damages} Schadstelle(n) wird <strong>endgültig</strong> von diesem Gerät gelöscht.
          </p>
          <p>Tipp: Sichern Sie das Projekt vorher über „Sichern“ als Datei.</p>
        </>
      ),
      confirmLabel: 'Endgültig löschen',
      danger: true,
    });
    if (!ok) return;
    await deleteProjectCompletely(r.project.id);
    toast('Projekt gelöscht.');
    void load();
  };

  const backup = async (p: Project) => {
    try {
      await offerFile(await exportProjectBackup(p.id));
    } catch (e) {
      showError(e, 'Sicherung fehlgeschlagen');
    }
  };

  const importBackup = async (file: File) => {
    try {
      const content = await readProjectBackup(file);
      const existing = await findExistingProject(content.project.id);
      let mode: 'replace' | 'copy' = 'replace';
      if (existing) {
        const newer = content.project.updatedAt >= existing.updatedAt;
        const replace = await confirmDialog({
          title: 'Projekt bereits vorhanden',
          message: (
            <>
              <p>
                Das Projekt <strong>„{existing.name}“</strong> ist auf diesem Gerät bereits vorhanden.
              </p>
              <ul>
                <li>Stand auf diesem Gerät: {formatDateTime(existing.updatedAt)}</li>
                <li>
                  Stand der Sicherung: {formatDateTime(content.project.updatedAt)} {newer ? '(neuer)' : '(älter)'}
                </li>
              </ul>
              <p>
                „Ersetzen“ überschreibt den Stand auf diesem Gerät vollständig. Mit „Abbrechen“ können Sie anschließend
                wählen, die Sicherung als Kopie zu importieren.
              </p>
            </>
          ),
          confirmLabel: 'Ersetzen',
          danger: true,
        });
        if (!replace) {
          const copy = await confirmDialog({
            title: 'Als Kopie importieren?',
            message: 'Die Sicherung wird als neues, unabhängiges Projekt „… (Kopie)“ importiert. Der Stand auf diesem Gerät bleibt unverändert.',
            confirmLabel: 'Als Kopie importieren',
          });
          if (!copy) return;
          mode = 'copy';
        }
      }
      const id = await importProjectBackup(content, mode);
      toast('Projekt importiert.', 'success');
      navigate(paths.project(id));
    } catch (e) {
      showError(e, 'Import fehlgeschlagen');
    }
  };

  return (
    <>
    <SiteNav />
    <div className="page home">
      <header className="page-head">
        <h1 data-testid="projects-title">Projektverwaltung</h1>
      </header>

      <div className="home-actions">
        <button type="button" className="btn btn-primary btn-lg" onClick={() => setCreating(true)} data-testid="new-project">
          <Icon name="plus" /> Neues Projekt
        </button>
        <button type="button" className="btn btn-lg" onClick={() => importRef.current?.click()}>
          <Icon name="upload" /> Projektsicherung öffnen (.zip)
        </button>
        <input
          ref={importRef}
          type="file"
          accept=".zip,application/zip"
          hidden
          data-testid="import-project-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void importBackup(f);
          }}
        />
      </div>

      {upgraded && (
        <div className="banner banner-info" role="status" data-testid="upgrade-banner">
          <p>
            <strong>BauPad wurde erweitert</strong> (Messarten, Bauteilbuchstaben, Rückgängig, selbst gezeichnete Pläne). Ihre Projekte wurden dabei
            nicht verändert. Tipp: Sichern Sie wichtige Projekte regelmäßig über „Sichern“ als Datei.
          </p>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              setUpgraded(false);
              void setMeta('upgradedFrom', null);
            }}
          >
            Verstanden
          </button>
        </div>
      )}

      <p className="muted small home-hint">
        Pläne (PDF, Fotos) importieren Sie im Projekt: Projekt öffnen → „Plan importieren“.
      </p>

      <section>
        <h2 className="section-title">Projekte</h2>
        {rows === null && <p className="muted">Wird geladen …</p>}
        {rows?.length === 0 && (
          <div className="empty">
            <p>Noch keine Projekte vorhanden.</p>
            <p className="muted">Legen Sie ein neues Projekt an oder importieren Sie eine Projektsicherung.</p>
          </div>
        )}
        <ul className="card-list" data-testid="project-list">
          {rows?.map((r) => (
            <li key={r.project.id} className="card">
              <a className="card-main" href={paths.project(r.project.id)} data-testid="project-card">
                <div className="card-title">{r.project.name}</div>
                <div className="card-sub">
                  {[r.project.site, r.project.address].filter(Boolean).join(' · ') || 'Keine Baustelle angegeben'}
                </div>
                <div className="card-meta">
                  <span>{formatDate(r.project.date)}</span>
                  <span>
                    {r.stats.costCenters} Kostenst. · {r.stats.plans} Pläne · {r.stats.damages} Schadst.
                  </span>
                  <span>Zuletzt bearbeitet: {formatDateTime(r.lastEdit)}</span>
                </div>
              </a>
              <div className="card-actions">
                <button type="button" className="btn btn-sm" onClick={() => void rename(r.project)}>
                  <Icon name="edit" size={18} /> Umbenennen
                </button>
                <button type="button" className="btn btn-sm" onClick={() => void backup(r.project)}>
                  <Icon name="download" size={18} /> Sichern
                </button>
                <button type="button" className="btn btn-sm btn-danger-text" onClick={() => void remove(r)}>
                  <Icon name="trash" size={18} /> Löschen
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="info-box">
        <h2 className="section-title">Hinweise</h2>
        <ul>
          <li>Alle Daten werden automatisch und ausschließlich auf diesem Gerät gespeichert. Es ist keine Anmeldung nötig.</li>
          <li>Nach dem ersten Laden funktioniert die App auch ohne Internetverbindung.</li>
          {isIOS() && (
            <li>
              <strong>iPhone/iPad:</strong> Fügen Sie die App über „Teilen → Zum Home-Bildschirm“ hinzu. Safari kann Daten von
              Websites, die länger nicht genutzt wurden, sonst automatisch löschen.
            </li>
          )}
          <li>Sichern Sie Projekte regelmäßig als Datei („Sichern“), um sie zu archivieren oder auf ein anderes Gerät zu übertragen.</li>
        </ul>
        <p className="muted small" data-testid="app-version">
          BauPad Version {__APP_VERSION__}
        </p>
        {storage && (
          <p className="muted small">
            Belegter Speicher: {(storage.usage / 1024 / 1024).toFixed(1)} MB
            {storage.quota ? ` von ca. ${(storage.quota / 1024 / 1024 / 1024).toFixed(1)} GB` : ''} ·{' '}
            {storage.persisted ? 'Dauerhafte Speicherung aktiv' : 'Dauerhafte Speicherung nicht bestätigt'}
          </p>
        )}
      </section>

      {creating && (
        <ProjectForm
          title="Neues Projekt"
          submitLabel="Projekt anlegen"
          onClose={() => setCreating(false)}
          onSubmit={async (fields, costCenters) => {
            try {
              await create(fields, costCenters);
            } catch (e) {
              showError(e, 'Projekt konnte nicht angelegt werden');
            }
          }}
        />
      )}
    </div>
    </>
  );
}
