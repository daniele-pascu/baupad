import { useEffect, useState } from 'react';
import { ProjectForm, type CostCenterInput } from './ProjectForm';
import { showError } from './ui';
import { getDB } from '../lib/db';
import { saveProjectEverywhere, updateSiteEverywhere } from '../lib/sites';
import type { PhotoSite, Project } from '../lib/types';

/**
 * „Projektangaben bearbeiten“ – in allen Werkzeugen derselbe Dialog wie in Aufmaß & Abrechnung
 * (Projektname, Bauvorhaben, Projektnummer, Kostenstellen, Auftraggeber, Baubeginn, Bemerkung).
 * Änderungen gelten überall: Projekt, Fotos, Berichte, Einteilung und Mängelplan.
 */
export function ProjectEditDialog({ site, onClose, onSaved }: { site: PhotoSite; onClose(): void; onSaved(next: PhotoSite): void }) {
  const [loaded, setLoaded] = useState<{ project: Project | null; ccs: CostCenterInput[] } | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!site.projectId) return { project: null, ccs: [] };
      const db = await getDB();
      const project = (await db.get('projects', site.projectId)) ?? null;
      const ccs = (await db.getAll('costCenters'))
        .filter((c) => c.projectId === site.projectId && !c.deletedAt)
        .sort((a, b) => a.sortIndex - b.sortIndex)
        .map((c) => ({ id: c.id, number: c.number ?? '', name: c.name }));
      return { project, ccs };
    })()
      .then((r) => alive && setLoaded(r))
      .catch((e) => showError(e, 'Projekt konnte nicht geladen werden'));
    return () => {
      alive = false;
    };
  }, [site.projectId]);
  if (!loaded) return null;
  const p = loaded.project;
  return (
    <ProjectForm
      title="Projektangaben bearbeiten"
      submitLabel="Speichern"
      ids={{ dialog: 'photo-site-dialog', name: 'photo-site-name', number: 'photo-site-number', address: 'photo-site-address', save: 'photo-site-save' }}
      initial={{ name: site.name, number: p?.number ?? site.number, address: p?.address ?? site.address, client: p?.client ?? '', date: p?.date ?? '', notes: p?.notes ?? '' }}
      costCenters={loaded.ccs}
      onClose={onClose}
      onSubmit={async (f, ccs) => {
        try {
          const fields = { name: f.name, number: f.number ?? '', address: f.address, client: f.client, date: f.date, notes: f.notes };
          onSaved(p && site.projectId ? await saveProjectEverywhere(site.projectId, fields, ccs) : await updateSiteEverywhere(site, fields));
        } catch (e) {
          showError(e, 'Projekt konnte nicht gespeichert werden');
        }
      }}
    />
  );
}
