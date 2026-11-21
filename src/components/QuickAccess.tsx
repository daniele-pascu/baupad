import { useEffect, useMemo, useState } from 'react';
import { Icon } from './Icon';
import { canSite, canTool } from '../lib/access';
import { projectTools } from '../lib/crew-link';
import { useDataChanged } from '../lib/data-events';
import { listProjects } from '../lib/db';
import { QUICK_TOOL_LABEL, quickItems, useQuickAccess, type QuickTool } from '../lib/quick-access';
import { paths } from '../lib/router';
import { useSession } from '../lib/use-session';
import type { Project } from '../lib/types';

/** Name einer frei eingegebenen Baustelle aus ihrem Schlüssel („n:halle nord“ → „Halle Nord“) */
const freeName = (key: string) => key.slice(2).replace(/(^|\s)\S/g, (c) => c.toUpperCase());

/**
 * Schnellzugriff oben auf der Tools-Seite: je Eintrag das Tool klein darüber, das Projekt groß darunter
 * („AUFMASS / Rohbau Müller“). Angeheftete Projekte zuerst, dann die zuletzt geöffneten. Ohne Einträge unsichtbar.
 */
export function QuickAccess({ register }: { register: boolean }) {
  const session = useSession();
  const { recent, pins } = useQuickAccess();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const load = () =>
    void listProjects()
      .then((p) => setProjects(p.filter((x) => !x.deletedAt)))
      .catch(() => setProjects([]));
  useEffect(load, []);
  useDataChanged(load);

  const items = useMemo(() => {
    if (!projects) return [];
    const byId = new Map(projects.map((p) => [p.id, p]));
    return quickItems({
      recent,
      pins,
      nameOf: (key) => {
        if (key.startsWith('n:')) return freeName(key);
        const p = byId.get(key.slice(2));
        return p ? p.site || p.name : null;
      },
      toolsOf: (id) => (byId.get(id) ? projectTools(byId.get(id)!) : []),
      canTool: (t: QuickTool) => canTool(session, t),
    }).filter((x) => canSite(session, x.key, x.tool));
  }, [projects, recent, pins, session]);

  if (!items.length) return null;
  return (
    <section className="quick-access" aria-label="Schnellzugriff" data-testid="quick-access">
      <div className="quick-head">
        <h2>Schnellzugriff</h2>
        {register && (
          <a href={`${paths.projectRegister()}?t=angeheftet`} className="quick-edit" title="Projekte im Projektregister anheften" data-testid="quick-edit">
            <Icon name="pushpin" size={15} /> Anheften
          </a>
        )}
      </div>
      <div className="quick-row">
        {items.map((x) => (
          <a key={`${x.tool}|${x.key}`} href={x.href} className="quick-chip" data-testid="quick-item" data-tool={x.tool} data-pinned={x.pinned || undefined}>
            <span className="quick-tool">
              {QUICK_TOOL_LABEL[x.tool]}
              {x.pinned && (
                <span className="quick-pin" title="Angeheftet">
                  <Icon name="pushpin" size={11} />
                </span>
              )}
            </span>
            <strong>{x.name}</strong>
          </a>
        ))}
      </div>
    </section>
  );
}
