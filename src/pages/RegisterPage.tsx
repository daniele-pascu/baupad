import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { ProjectEditDialog } from '../components/ProjectEditDialog';
import { ProjectForm } from '../components/ProjectForm';
import { ProjectHeading } from '../components/ProjectHeading';
import { SiteNav } from '../components/SiteNav';
import { showError, toast } from '../components/ui';
import { useAccess } from '../lib/access';
import { TOOLS, type ToolId } from '../lib/auth';
import { adoptProject, costCenterByProject, projectTools } from '../lib/crew-link';
import { useDataChanged } from '../lib/data-events';
import { listProjects } from '../lib/db';
import { labelFromProject } from '../lib/project-label';
import { usePageTitle } from '../lib/page-title';
import { navigate, paths } from '../lib/router';
import { canEditSites, createRegisterProject, type SiteFields } from '../lib/sites';
import { useSession } from '../lib/use-session';
import type { Project } from '../lib/types';

/** Werkzeug-Namen wie in den Tools-Kacheln */
const TOOL_LABEL: Record<ToolId, string> = { projects: 'Aufmaß & Abrechnung', workers: 'Arbeitereinteilung', reports: 'Berichte & Formulare', photos: 'Fotodokumentation', defects: 'Mängelplan' };
/** Projekt im Werkzeug öffnen */
const toolPath = (tool: ToolId, id: string) =>
  tool === 'projects' ? paths.project(id) : tool === 'reports' ? paths.reportSite(`p:${id}`) : tool === 'photos' ? paths.photoSite(`p:${id}`) : tool === 'defects' ? paths.defectSite(`p:${id}`) : paths.workers();

/**
 * Projektregister: alle Projekte der Firma mit ihren Angaben (nur Infos). Je Projekt sieht man, in welchen
 * Werkzeugen es verwendet wird, öffnet es dort oder übernimmt es in weitere Werkzeuge. „Neues Projekt“ legt ein
 * Projekt an und fragt, in welche Werkzeuge es kommt.
 */
export function RegisterPage() {
  usePageTitle('Projektregister – BauPad');
  const session = useSession();
  const access = useAccess();
  const mayCreate = canEditSites(session);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [ccs, setCcs] = useState<Map<string, string>>(() => new Map());
  const [q, setQ] = useState('');
  const [adopt, setAdopt] = useState<Project | null>(null);
  const [editing, setEditing] = useState<Project | null>(null);
  const [creating, setCreating] = useState(false);
  /** neues Projekt: Angaben erfasst, Werkzeuge werden noch gewählt */
  const [fresh, setFresh] = useState<SiteFields | null>(null);

  const reload = () =>
    void Promise.all([listProjects(), costCenterByProject()])
      .then(([p, c]) => {
        setProjects(p.filter((x) => !x.deletedAt));
        setCcs(c);
      })
      .catch((e) => showError(e, 'Projekte konnten nicht geladen werden'));
  useEffect(reload, []);
  useDataChanged(reload);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (projects ?? [])
      .filter((p) => access.canSite(`p:${p.id}`))
      .filter((p) => !needle || [p.name, p.site, p.number ?? '', ccs.get(p.id) ?? '', p.address, p.client, p.notes].join(' ').toLowerCase().includes(needle))
      .sort((a, b) => (a.site || a.name).localeCompare(b.site || b.name, 'de'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, ccs, q, access.session]);
  const usable = (t: ToolId) => access.canTool(t);

  return (
    <>
      <SiteNav />
      <div className="page register-page">
        <header className="page-head page-head-row">
          <div className="page-head-title">
            <a href={paths.tools()} className="icon-link" aria-label="Zu den Tools" title="Zu den Tools" data-testid="to-tools">
              <Icon name="back" />
            </a>
            <div>
              <h1 data-testid="register-title">Projektregister</h1>
              <span className="muted small">Alle Projekte der Firma – von hier in jedes Tool übernehmen</span>
            </div>
          </div>
          {mayCreate && (
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)} data-testid="register-new">
              <Icon name="plus" size={16} /> Neues Projekt
            </button>
          )}
        </header>

        {projects && projects.length > 0 && (
          <label className="crew-search register-search">
            <Icon name="select" size={18} />
            <span className="sr-only">Suchen</span>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, Nummer, Kostenstelle, Adresse, Auftraggeber …" data-testid="register-search" />
          </label>
        )}
        {projects && projects.length === 0 && <p className="muted">Noch kein Projekt. {mayCreate ? '„Neues Projekt“ antippen.' : 'Projekte legen Admin oder Büro an.'}</p>}
        {projects && projects.length > 0 && list.length === 0 && <p className="muted">Kein Projekt gefunden.</p>}

        <ul className="register-list">
          {list.map((p) => {
            const used = projectTools(p).filter((t): t is ToolId => TOOLS.some((x) => x.id === t));
            const missing = TOOLS.map((t) => t.id).filter((t) => !used.includes(t) && usable(t));
            return (
              <li key={p.id} className="register-card" data-testid="register-row" data-name={p.site || p.name}>
                <div className="register-main">
                  <ProjectHeading info={labelFromProject(p, ccs.get(p.id) ?? '')} />
                  <dl className="register-facts">
                    {p.client && (
                      <>
                        <dt>Auftraggeber</dt>
                        <dd>{p.client}</dd>
                      </>
                    )}
                    {p.date && (
                      <>
                        <dt>Baubeginn</dt>
                        <dd>{new Date(`${p.date}T12:00:00`).toLocaleDateString('de-DE')}</dd>
                      </>
                    )}
                    {p.notes && (
                      <>
                        <dt>Bemerkung</dt>
                        <dd>{p.notes}</dd>
                      </>
                    )}
                  </dl>
                  <div className="register-tools" data-testid="register-tools">
                    {used.length === 0 && <span className="muted small">In keinem Tool</span>}
                    {used.map((t) =>
                      usable(t) ? (
                        <a key={t} href={toolPath(t, p.id)} className="register-tool" title={`In ${TOOL_LABEL[t]} öffnen`} data-testid="register-tool" data-tool={t}>
                          {TOOL_LABEL[t]} <span aria-hidden="true">→</span>
                        </a>
                      ) : (
                        <span key={t} className="register-tool off" data-tool={t}>
                          {TOOL_LABEL[t]}
                        </span>
                      ),
                    )}
                  </div>
                </div>
                <div className="register-actions">
                  {missing.length > 0 && (
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => setAdopt(p)} data-testid="register-adopt">
                      <Icon name="plus" size={16} /> In Tool übernehmen
                    </button>
                  )}
                  {mayCreate && (
                    <button type="button" className="btn btn-sm" onClick={() => setEditing(p)} data-testid="register-edit">
                      <Icon name="edit" size={16} /> Bearbeiten
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {adopt && (
        <AdoptDialog
          project={adopt}
          usable={usable}
          onClose={() => setAdopt(null)}
          onDone={(names) => {
            setAdopt(null);
            toast(`„${adopt.site || adopt.name}“ übernommen in ${names.join(', ')}.`, 'success');
            reload();
          }}
        />
      )}
      {editing && (
        <ProjectEditDialog
          site={{ projectId: editing.id, name: editing.site || editing.name, number: editing.number ?? '', address: editing.address }}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            toast('Projekt gespeichert – in allen Tools übernommen.', 'success');
            reload();
          }}
        />
      )}
      {creating && (
        <ProjectForm
          title="Neues Projekt"
          submitLabel="Weiter"
          onClose={() => setCreating(false)}
          onSubmit={(f, cc) => {
            // Angaben merken; angelegt wird nach der Wahl der Werkzeuge
            setFresh({ name: f.name, number: f.number ?? '', address: f.address, client: f.client, date: f.date, notes: f.notes, costCenter: cc[0] ? [cc[0].number, cc[0].name].filter(Boolean).join(' – ') : '' });
            setCreating(false);
          }}
        />
      )}
      {fresh && (
        <AdoptDialog
          project={null}
          usable={usable}
          title={`„${fresh.name}“ – in welche Tools?`}
          onClose={() => setFresh(null)}
          onCreate={async (tools) => {
            let p = await createRegisterProject(fresh, tools[0]);
            for (const t of tools.slice(1)) p = await adoptProject(p, t);
            return p;
          }}
          onDone={(names, created) => {
            setFresh(null);
            toast(`Projekt angelegt${names.length ? ` – in ${names.join(', ')}` : ''}.`, 'success');
            reload();
            if (created && names.length === 1) navigate(toolPath(projectTools(created)[0] as ToolId, created.id));
          }}
        />
      )}
    </>
  );
}

/** Werkzeuge wählen: bestehendes Projekt übernehmen oder neues Projekt anlegen */
function AdoptDialog({
  project,
  usable,
  title,
  onClose,
  onDone,
  onCreate,
}: {
  project: Project | null;
  usable(t: ToolId): boolean;
  title?: string;
  onClose(): void;
  onDone(names: string[], created?: Project): void;
  onCreate?(tools: ToolId[]): Promise<Project>;
}) {
  const used = project ? projectTools(project) : [];
  const [sel, setSel] = useState<Set<ToolId>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const tools = TOOLS.map((t) => t.id).filter((t) => sel.has(t));
      if (onCreate) {
        const p = await onCreate(tools);
        onDone(tools.map((t) => TOOL_LABEL[t]), p);
        return;
      }
      let p = project!;
      for (const t of tools) p = await adoptProject(p, t);
      onDone(tools.map((t) => TOOL_LABEL[t]));
    } catch (e) {
      showError(e, 'Projekt konnte nicht übernommen werden');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={title ?? `„${project!.site || project!.name}“ in Tool übernehmen`}
      onClose={onClose}
      testId="register-adopt-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy || sel.size === 0} data-testid="register-adopt-save">
            {onCreate ? 'Projekt anlegen' : 'Übernehmen'}
          </button>
        </>
      }
    >
      <p className="muted small">Das Projekt erscheint danach in jedem gewählten Tool – mit denselben Angaben.</p>
      <ul className="register-adopt-list">
        {TOOLS.filter((t) => usable(t.id)).map((t) => {
          const already = used.includes(t.id);
          return (
            <li key={t.id}>
              <label className={`check-row${already ? ' muted' : ''}`} data-testid="register-adopt-tool" data-tool={t.id}>
                <input
                  type="checkbox"
                  disabled={already}
                  checked={already || sel.has(t.id)}
                  onChange={(e) => {
                    const next = new Set(sel);
                    if (e.target.checked) next.add(t.id);
                    else next.delete(t.id);
                    setSel(next);
                  }}
                />
                <span>
                  {TOOL_LABEL[t.id]}
                  {already && <span className="muted small"> · schon drin</span>}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
