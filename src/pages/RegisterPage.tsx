import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { ProjectEditDialog } from '../components/ProjectEditDialog';
import { ProjectForm } from '../components/ProjectForm';
import { ProjectHeading } from '../components/ProjectHeading';
import { SiteNav } from '../components/SiteNav';
import { ToolIcon } from '../components/ToolIcon';
import { confirmDialog, showError, toast } from '../components/ui';
import { useAccess } from '../lib/access';
import { TOOLS, type ToolId } from '../lib/auth';
import { adoptProject, costCenterByProject, projectTools } from '../lib/crew-link';
import { naturalCompare } from '../lib/numbers';

type RegisterOrder = 'name' | 'cc-asc' | 'cc-desc' | 'new' | 'old';
const ORDER_LABELS: Record<RegisterOrder, string> = {
  name: 'Name A–Z',
  'cc-asc': 'Kostenstelle aufsteigend',
  'cc-desc': 'Kostenstelle absteigend',
  new: 'Neueste zuerst',
  old: 'Älteste zuerst',
};
import { useDataChanged } from '../lib/data-events';
import { listProjects, projectStats } from '../lib/db';
import { labelFromProject } from '../lib/project-label';
import { usePageTitle } from '../lib/page-title';
import { paths } from '../lib/router';
import { canEditSites, createRegisterProject, deleteProjectEverywhere, projectUsage } from '../lib/sites';
import { useSession } from '../lib/use-session';
import type { Project } from '../lib/types';
import { pcStyle, useProjectColors } from '../lib/project-colors';

/** Werkzeug-Namen wie in den Tools-Kacheln */
const TOOL_LABEL: Record<ToolId, string> = { projects: 'Aufmaß & Abrechnung', workers: 'Arbeitereinteilung', times: 'Zeitaufzeichnung', reports: 'Berichte & Formulare', photos: 'Fotodokumentation', defects: 'Mängelplan', materials: 'Materialverwaltung' };
/** Farben wie die Tools-Kacheln */
const TOOL_COLOR: Record<ToolId, string> = { projects: '#ff6a13', workers: '#2f80ed', times: '#0f9d76', reports: '#a259ff', photos: '#111111', defects: '#d6242b', materials: '#c2850c' };
const ACCENT = { '--tool': '#475467' } as CSSProperties;
const fmtDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('de-DE');
/** Projekt im Werkzeug öffnen */
const toolPath = (tool: ToolId, id: string) =>
  tool === 'projects' ? paths.project(id) : tool === 'reports' ? paths.reportSite(`p:${id}`) : tool === 'photos' ? paths.photoSite(`p:${id}`) : tool === 'defects' ? paths.defectSite(`p:${id}`) : tool === 'materials' ? paths.materials() : tool === 'times' ? paths.times() : paths.workers();

/**
 * Projektregister: alle Projekte der Firma mit ihren Angaben (nur Infos). Je Projekt sieht man, in welchen
 * Werkzeugen es verwendet wird, öffnet es dort oder übernimmt es in weitere Werkzeuge. „Neues Projekt“ legt ein
 * Projekt an und fragt, in welche Werkzeuge es kommt.
 */
export function RegisterPage() {
  usePageTitle('Projektregister – BauPad');
  const colorOf = useProjectColors();
  const session = useSession();
  const access = useAccess();
  const mayCreate = canEditSites(session);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [ccs, setCcs] = useState<Map<string, string>>(() => new Map());
  const [q, setQ] = useState('');
  /** Reihenfolge (gemerkt): Name, Kostenstelle auf-/absteigend, neueste/älteste zuerst */
  const [order, setOrder] = useState<RegisterOrder>(() => {
    try {
      const v = localStorage.getItem('registerOrder');
      return v && v in ORDER_LABELS ? (v as RegisterOrder) : 'name';
    } catch {
      return 'name';
    }
  });
  const changeOrder = (o: RegisterOrder) => {
    setOrder(o);
    try {
      localStorage.setItem('registerOrder', o);
    } catch {
      /* egal */
    }
  };
  const [adopt, setAdopt] = useState<Project | null>(null);
  const [editing, setEditing] = useState<Project | null>(null);
  const [creating, setCreating] = useState(false);

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
      .sort((a, b) => {
        const byName = (a.site || a.name).localeCompare(b.site || b.name, 'de');
        if (order === 'new') return b.createdAt - a.createdAt || byName;
        if (order === 'old') return a.createdAt - b.createdAt || byName;
        if (order === 'cc-asc' || order === 'cc-desc') {
          const ca = ccs.get(a.id) ?? '';
          const cb = ccs.get(b.id) ?? '';
          // ohne Kostenstelle immer am Ende
          if (!ca || !cb) return ca ? -1 : cb ? 1 : byName;
          const c = naturalCompare(ca, cb);
          return (order === 'cc-asc' ? c : -c) || byName;
        }
        return byName;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, ccs, q, order, access.session]);
  const usable = (t: ToolId) => access.canTool(t);

  /** Löschen: Projekt mit allem, was in den Tools daran hängt (Stunden der Zeitaufzeichnung bleiben) */
  const remove = async (p: Project) => {
    try {
      const name = p.site || p.name;
      const [usage, stats] = await Promise.all([projectUsage(p.id), projectStats(p.id)]);
      const lost = [
        ...(stats.plans + stats.damages > 0 ? [`Aufmaß & Abrechnung: ${stats.plans} Plan/Pläne, ${stats.damages} Schadstelle(n)`] : []),
        ...usage.filter((u) => !u.label.startsWith('Tage')).map((u) => `${u.count} ${u.label}`),
      ];
      const days = usage.find((u) => u.label.startsWith('Tage'));
      const ok = await confirmDialog({
        title: 'Projekt löschen?',
        message: (
          <>
            <p>
              <strong>„{name}“</strong> wird aus dem Projektregister und allen Tools <strong>endgültig</strong> gelöscht.
            </p>
            {lost.length > 0 && (
              <>
                <p>Dabei wird mitgelöscht:</p>
                <ul data-testid="register-delete-usage">
                  {lost.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </>
            )}
            {days && <p className="muted small">Erfasste Stunden ({days.count} Tage in der Zeitaufzeichnung) bleiben erhalten – die Baustelle steht dort dann nur noch als Name.</p>}
            {lost.length > 0 && <p className="muted small">Das lässt sich nicht rückgängig machen. Wichtiges vorher sichern (Fotos, PDFs, Aufmaß „Sichern“).</p>}
          </>
        ),
        confirmLabel: 'Endgültig löschen',
        danger: true,
      });
      if (!ok) return;
      await deleteProjectEverywhere(p.id);
      toast(`„${name}“ gelöscht.`, 'success');
      reload();
    } catch (e) {
      showError(e, 'Projekt konnte nicht gelöscht werden');
    }
  };

  // nur Admin und Büro; die anderen übernehmen Projekte in den Tools („Projekt übernehmen“)
  if (!mayCreate)
    return (
      <>
        <SiteNav />
        <div className="page register-page" style={ACCENT}>
          <header className="page-head page-head-row">
            <div className="page-head-title">
              <a href={paths.tools()} className="icon-link" aria-label="Zu den Tools" title="Zu den Tools" data-testid="to-tools">
                <Icon name="back" />
              </a>
              <h1 data-testid="register-title">Projektregister</h1>
            </div>
          </header>
          <div className="crew-setup" data-testid="register-no-access">
            <span className="tile-icon">
              <Icon name="folder" size={22} />
            </span>
            <div>
              <strong>Nur für Admin und Büro</strong>
              <p className="muted small">Projekte übernimmst du direkt im Tool: dort „Projekt übernehmen“ antippen und das Projekt wählen.</p>
            </div>
            <a href={paths.tools()} className="btn btn-primary">
              Zu den Tools
            </a>
          </div>
        </div>
      </>
    );

  return (
    <>
      <SiteNav />
      <div className="page register-page" style={ACCENT}>
        <header className="page-head page-head-row">
          <div className="page-head-title">
            <a href={paths.tools()} className="icon-link" aria-label="Zu den Tools" title="Zu den Tools" data-testid="to-tools">
              <Icon name="back" />
            </a>
            <h1 data-testid="register-title">Projektregister</h1>
          </div>
          {mayCreate && (
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)} title="Projekt mit seinen Angaben anlegen – in Tools übernimmt man es später" data-testid="register-new">
              <Icon name="plus" size={16} /> <span className="hide-sm">Neues Projekt</span>
            </button>
          )}
        </header>

        {projects && projects.length > 0 && (
          <div className="reports-tools">
            <label className="crew-search reports-search">
              <Icon name="select" size={18} />
              <span className="sr-only">Suchen</span>
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Baustelle, Nummer, Kostenstelle oder Auftraggeber suchen" data-testid="register-search" />
            </label>
            <label className="register-order">
              <span className="sr-only">Sortieren</span>
              <select value={order} onChange={(e) => changeOrder(e.target.value as RegisterOrder)} aria-label="Sortieren" data-testid="register-order">
                {(Object.keys(ORDER_LABELS) as RegisterOrder[]).map((o) => (
                  <option key={o} value={o}>
                    {ORDER_LABELS[o]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {projects && projects.length === 0 && (
          <div className="crew-setup" data-testid="register-empty">
            <span className="tile-icon">
              <Icon name="folder" size={22} />
            </span>
            <div>
              <strong>Noch kein Projekt</strong>
              <p className="muted small">Hier stehen alle Projekte der Firma mit ihren Angaben. Von hier übernimmt man ein Projekt in jedes Tool – Name, Nummer, Adresse und Auftraggeber sind überall gleich.</p>
            </div>
            {mayCreate && (
              <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
                Neues Projekt
              </button>
            )}
          </div>
        )}
        {projects && projects.length > 0 && list.length === 0 && <p className="muted">Kein Projekt gefunden.</p>}

        <ul className="register-list">
          {list.map((p) => {
            const used = projectTools(p).filter((t): t is ToolId => TOOLS.some((x) => x.id === t));
            const missing = TOOLS.map((t) => t.id).filter((t) => !used.includes(t) && usable(t));
            const facts = [p.client ? `Auftraggeber ${p.client}` : '', p.date ? `Baubeginn ${fmtDay(p.date)}` : ''].filter(Boolean);
            return (
              <li key={p.id} className="register-card pc-stripe" style={pcStyle(colorOf(p.id))} data-testid="register-row" data-name={p.site || p.name}>
                <div className="register-main">
                  <ProjectHeading info={labelFromProject(p, ccs.get(p.id) ?? '')} />
                  {facts.length > 0 && <span className="small">{facts.join(' · ')}</span>}
                  {p.notes && <span className="small muted register-notes">{p.notes}</span>}
                  <div className="register-tools" data-testid="register-tools">
                    {used.length === 0 && <span className="muted small">Noch in keinem Tool</span>}
                    {used.map((t) =>
                      usable(t) ? (
                        <a key={t} href={toolPath(t, p.id)} className="register-tool" style={{ '--tool': TOOL_COLOR[t] } as CSSProperties} title={`In ${TOOL_LABEL[t]} öffnen`} data-testid="register-tool" data-tool={t}>
                          <ToolIcon name={t} size={14} /> {TOOL_LABEL[t]}
                          <Icon name="next" size={12} />
                        </a>
                      ) : (
                        <span key={t} className="register-tool off" style={{ '--tool': TOOL_COLOR[t] } as CSSProperties} data-tool={t}>
                          <ToolIcon name={t} size={14} /> {TOOL_LABEL[t]}
                        </span>
                      ),
                    )}
                  </div>
                </div>
                <div className="register-actions">
                  {missing.length > 0 && (
                    <button type="button" className="btn btn-sm" onClick={() => setAdopt(p)} title="Projekt in weitere Tools übernehmen" data-testid="register-adopt">
                      <Icon name="plus" size={16} /> In Tool übernehmen
                    </button>
                  )}
                  {mayCreate && (
                    <span className="register-icons">
                      <button type="button" className="icon-link" onClick={() => setEditing(p)} aria-label="Projekt bearbeiten" title="Projekt bearbeiten" data-testid="register-edit">
                        <Icon name="edit" size={18} />
                      </button>
                      <button type="button" className="icon-link danger" onClick={() => void remove(p)} aria-label="Projekt löschen" title="Projekt löschen" data-testid="register-delete">
                        <Icon name="trash" size={18} />
                      </button>
                    </span>
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
          submitLabel="Projekt anlegen"
          onClose={() => setCreating(false)}
          onSubmit={async (f, cc) => {
            // nur Projektinfos – in Tools übernimmt man es später („In Tool übernehmen“ oder im Tool selbst)
            try {
              await createRegisterProject({ name: f.name, number: f.number ?? '', address: f.address, client: f.client, date: f.date, notes: f.notes, siteManager: f.siteManager ?? null, costCenter: cc[0] ? [cc[0].number, cc[0].name].filter(Boolean).join(' – ') : '' });
              setCreating(false);
              toast(`Projekt „${f.name.trim()}“ angelegt.`, 'success');
              reload();
            } catch (e) {
              showError(e, 'Projekt konnte nicht angelegt werden');
            }
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
}: {
  project: Project;
  usable(t: ToolId): boolean;
  title?: string;
  onClose(): void;
  onDone(names: string[]): void;
}) {
  const used = projectTools(project);
  const [sel, setSel] = useState<Set<ToolId>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const tools = TOOLS.map((t) => t.id).filter((t) => sel.has(t));
      let p = project;
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
      title={title ?? `„${project.site || project.name}“ in Tool übernehmen`}
      onClose={onClose}
      testId="register-adopt-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy || sel.size === 0} data-testid="register-adopt-save">
            Übernehmen
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
