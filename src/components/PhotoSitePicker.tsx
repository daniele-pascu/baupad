import { useState } from 'react';
import { createSiteProject, useCanCreateProjects } from '../lib/sites';
import { useAccess } from '../lib/access';
import type { PhotoSite } from '../lib/types';
import { Modal } from './Modal';
import { ProjectForm } from './ProjectForm';
import { showError } from './ui';

export const siteValue = (s: PhotoSite | null) => (s ? `${s.projectId ?? ''}|${s.name}` : '');

/**
 * Dialog: neue Baustelle unter „Fotos“ anlegen (Name Pflicht, Nummer und Adresse optional) –
 * oder mit `initial` und `onSave` eine bestehende Baustelle bearbeiten
 */
export function PhotoSiteDialog({
  onClose,
  onSaved,
  initial,
  onSave,
  hint,
}: {
  onClose(): void;
  onSaved(site: PhotoSite): void;
  initial?: PhotoSite;
  /** eigene Speicherlogik (Bearbeiten); Standard: neues Projekt im Projektregister anlegen */
  onSave?(values: { name: string; number: string; address: string }): Promise<PhotoSite>;
  hint?: string;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [number, setNumber] = useState(initial?.number ?? '');
  const [address, setAddress] = useState(initial?.address ?? '');
  const [busy, setBusy] = useState(false);
  const { tool } = useAccess();
  // Neues Projekt: in allen Werkzeugen derselbe Dialog (Projektname, Bauvorhaben, Nummer, Kostenstelle, Auftraggeber, Baubeginn, Bemerkung)
  if (!initial)
    return (
      <ProjectForm
        title="Neues Projekt"
        submitLabel="Projekt anlegen"
        ids={{ dialog: 'photo-site-dialog', name: 'photo-site-name', number: 'photo-site-number', address: 'photo-site-address', save: 'photo-site-save' }}
        onClose={onClose}
        onSubmit={async (f, ccs) => {
          try {
            const cc = ccs[0] ? [ccs[0].number, ccs[0].name].filter(Boolean).join(' – ') : '';
            const v = { name: f.name, number: f.number ?? '', address: f.address, costCenter: cc, client: f.client, date: f.date, notes: f.notes };
            onSaved(onSave ? await onSave(v) : await createSiteProject(v, tool ?? 'photos'));
          } catch (e) {
            showError(e, 'Projekt konnte nicht angelegt werden');
          }
        }}
      />
    );
  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      onSaved(onSave ? await onSave({ name: name.trim(), number: number.trim(), address: address.trim() }) : await createSiteProject({ name: name.trim(), number: number.trim(), address: address.trim() }, tool ?? 'photos'));
    } catch (e) {
      showError(e, 'Projekt konnte nicht angelegt werden');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={initial ? 'Projekt bearbeiten' : 'Neues Projekt'}
      onClose={onClose}
      testId="photo-site-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy || !name.trim()} data-testid="photo-site-save">
            {initial ? 'Speichern' : 'Anlegen'}
          </button>
        </>
      }
    >
      <form
        className="stack-fields"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="field">
          <span>Projekt *</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Garage Jagdschlossgasse" data-autofocus data-testid="photo-site-name" />
        </label>
        <label className="field">
          <span>Kostenstelle / Projektnummer</span>
          <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="z. B. 91574" data-testid="photo-site-number" />
        </label>
        <label className="field">
          <span>Adresse</span>
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Straße, PLZ Ort" autoComplete="street-address" data-testid="photo-site-address" />
        </label>
        <p className="muted small">{hint ?? 'Alle Projekte des Projektregisters stehen zur Auswahl – egal, in welchem Werkzeug sie angelegt wurden.'}</p>
      </form>
    </Modal>
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
