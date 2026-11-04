import { useState } from 'react';
import { createSiteProject, useCanCreateProjects } from '../lib/sites';
import { useAccess } from '../lib/access';
import type { PhotoSite } from '../lib/types';
import { ProjectForm } from './ProjectForm';
import { showError } from './ui';

export const siteValue = (s: PhotoSite | null) => (s ? `${s.projectId ?? ''}|${s.name}` : '');

/**
 * Dialog: neue Baustelle unter „Fotos“ anlegen (Name Pflicht, Nummer und Adresse optional) –
 * oder mit `initial` und `onSave` eine bestehende Baustelle bearbeiten
 */
export function PhotoSiteDialog({ onClose, onSaved }: { onClose(): void; onSaved(site: PhotoSite): void }) {
  const { tool } = useAccess();
  // Neues Projekt: in allen Werkzeugen derselbe Dialog (Projektname, Bauvorhaben, Nummer, Kostenstelle, Auftraggeber, Baubeginn, Bemerkung);
  // Bearbeiten läuft überall über ProjectEditDialog
  return (
    <ProjectForm
      title="Neues Projekt"
      submitLabel="Projekt anlegen"
      ids={{ dialog: 'photo-site-dialog', name: 'photo-site-name', number: 'photo-site-number', address: 'photo-site-address', save: 'photo-site-save' }}
      onClose={onClose}
      onSubmit={async (f, ccs) => {
        try {
          const cc = ccs[0] ? [ccs[0].number, ccs[0].name].filter(Boolean).join(' – ') : '';
          onSaved(await createSiteProject({ name: f.name, number: f.number ?? '', address: f.address, costCenter: cc, client: f.client, date: f.date, notes: f.notes, siteManager: f.siteManager ?? null }, tool ?? 'photos'));
        } catch (e) {
          showError(e, 'Projekt konnte nicht angelegt werden');
        }
      }}
    />
  );
}

/** Auswahl der Baustelle mit Eintrag „Neues Projekt …“ (in allen Werkzeugen gleich benannt) */
export function PhotoSitePicker({
  sites,
  value,
  onChange,
  onCreated,
  testId = 'photo-site',
}: {
  sites: PhotoSite[];
  value: PhotoSite | null;
  onChange(site: PhotoSite | null): void;
  /** neue Baustelle wurde angelegt (Aufrufer nimmt sie in seine Liste auf) */
  onCreated(site: PhotoSite): void;
  testId?: string;
}) {
  const [creating, setCreating] = useState(false);
  const mayCreate = useCanCreateProjects();
  return (
    <>
      <select
        value={siteValue(value)}
        onChange={(e) => {
          if (e.target.value === '__new') setCreating(true);
          else onChange(sites.find((s) => siteValue(s) === e.target.value) ?? null);
        }}
        data-testid={testId}
      >
        <option value="">– Projekt wählen –</option>
        {sites.map((s) => (
          <option key={siteValue(s)} value={siteValue(s)}>
            {[s.number, s.name].filter(Boolean).join(' · ')}
          </option>
        ))}
        {mayCreate && <option value="__new">+ Neues Projekt …</option>}
      </select>
      {creating && (
        <PhotoSiteDialog
          onClose={() => setCreating(false)}
          onSaved={(s) => {
            setCreating(false);
            onCreated(s);
            onChange(s);
          }}
        />
      )}
    </>
  );
}
