import { useEffect, useMemo, useState } from 'react';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { ProjectForm } from './ProjectForm';
import { ProjectHeading } from './ProjectHeading';
import { showError } from './ui';
import { TOOLS } from '../lib/auth';
import { adoptProject, costCenterByProject, projectTools, usedIn } from '../lib/crew-link';
import { listProjects } from '../lib/db';
import { labelFromProject } from '../lib/project-label';
import { createRegisterProject, useCanCreateProjects } from '../lib/sites';
import type { Project } from '../lib/types';

/**
 * Ein Fenster „Projekt“ für alle Werkzeuge: oben „Neues Projekt anlegen“ (gleicher Dialog überall), darunter alle
 * Projekte aus dem Register zum Übernehmen (mit Suche). Antippen übernimmt das Projekt sofort in dieses Werkzeug.
 * `mode` 'unused': nur Projekte, die hier noch nicht benutzt werden (Standard); 'all': alle außer `exclude`.
 */
export function ProjectPicker({
  tool,
  mode = 'unused',
  exclude = [],
  onClose,
  onPick,
}: {
  tool: string;
  mode?: 'unused' | 'all';
  exclude?: string[];
  onClose(): void;
  /** gewähltes bzw. neu angelegtes Projekt (bereits in dieses Werkzeug übernommen) */
  onPick(p: Project): void | Promise<void>;
}) {
  const mayCreate = useCanCreateProjects();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [ccs, setCcs] = useState<Map<string, string>>(() => new Map());
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void Promise.all([listProjects(), costCenterByProject()])
      .then(([p, c]) => {
        setProjects(p.filter((x) => !x.deletedAt));
        setCcs(c);
      })
      .catch((e) => showError(e, 'Projekte konnten nicht geladen werden'));
  }, []);
  const list = useMemo(() => {
    const all = (projects ?? []).filter((p) => !exclude.includes(p.id) && (mode === 'all' || !usedIn(p, tool)));
    const needle = q.trim().toLowerCase();
    const hit = needle
      ? all.filter((p) => [p.name, p.site, p.number ?? '', ccs.get(p.id) ?? '', p.address, p.client, p.notes].join(' ').toLowerCase().includes(needle))
      : all;
    return hit.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  }, [projects, exclude, mode, tool, q, ccs]);
  const SHORT: Record<string, string> = { projects: 'Aufmaß', workers: 'Einteilung', reports: 'Berichte', photos: 'Fotos', defects: 'Mängelplan' };
  const toolLabel = (id: string) => SHORT[id] ?? TOOLS.find((t) => t.id === id)?.label ?? id;
  const pick = async (p: Project) => {
    setBusy(true);
    try {
      const adopted = await adoptProject(p, tool);
      await onPick(adopted);
    } catch (e) {
      showError(e, 'Projekt konnte nicht übernommen werden');
    } finally {
      setBusy(false);
    }
  };
  if (creating)
    return (
      <ProjectForm
        title="Neues Projekt"
        submitLabel="Projekt anlegen"
        onClose={() => setCreating(false)}
        onSubmit={async (f, cc) => {
          try {
            const p = await createRegisterProject({ name: f.name, number: f.number ?? '', address: f.address, costCenter: cc[0]?.name ?? '', client: f.client, date: f.date, notes: f.notes }, tool);
            await onPick(p);
          } catch (e) {
            showError(e, 'Projekt konnte nicht angelegt werden');
          }
        }}
      />
    );
  return (
    <Modal title="Projekt" onClose={onClose} testId="project-picker">
      <div className="picker">
        {mayCreate && (
          <button type="button" className="picker-new" onClick={() => setCreating(true)} disabled={busy} data-testid="picker-new">
            <span className="picker-plus">
              <Icon name="plus" size={18} />
            </span>
            Neues Projekt anlegen
          </button>
        )}
        <p className="picker-label">Aus dem Register übernehmen</p>
        <label className="crew-search picker-search">
          <Icon name="select" size={18} />
          <span className="sr-only">Suchen</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, Nummer, Kostenstelle, Auftraggeber …" data-testid="picker-search" />
        </label>
        {projects && list.length === 0 && (
          <p className="muted small" data-testid="picker-empty">
            {q ? 'Kein Projekt gefunden.' : mode === 'all' ? 'Keine weiteren Projekte im Register.' : 'Alle Projekte des Registers sind hier schon drin.'}
          </p>
        )}
        <ul className="picker-list">
          {list.map((p) => {
            const where = projectTools(p).filter((t) => t !== tool);
            return (
              <li key={p.id}>
                <button type="button" className="picker-item" onClick={() => void pick(p)} disabled={busy} data-testid="picker-item" data-project={p.name}>
                  <ProjectHeading
                    info={labelFromProject(p, ccs.get(p.id) ?? '')}
                    extra={
                      where.length ? (
                        <span className="picker-tags">
                          {where.map((t) => (
                            <span key={t} className="picker-tag">
                              {toolLabel(t)}
                            </span>
                          ))}
                        </span>
                      ) : undefined
                    }
                  />
                  <Icon name="next" size={18} />
                </button>
              </li>
            );
          })}
        </ul>
        <p className="muted small">Antippen = Projekt ist sofort hier drin. Die Marken zeigen, wo es schon benutzt wird.</p>
      </div>
    </Modal>
  );
}
