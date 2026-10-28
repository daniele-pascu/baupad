import { useState } from 'react';
import { addFreePhotoSite } from '../lib/photo-sites';
import type { PhotoSite } from '../lib/types';
import { Modal } from './Modal';
import { showError } from './ui';

export const siteValue = (s: PhotoSite | null) => (s ? `${s.projectId ?? ''}|${s.name}` : '');

/** Dialog: neue Baustelle unter „Fotos“ anlegen (Name Pflicht, Nummer und Adresse optional) */
export function PhotoSiteDialog({ onClose, onSaved }: { onClose(): void; onSaved(site: PhotoSite): void }) {
  const [name, setName] = useState('');
  const [number, setNumber] = useState('');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      onSaved(await addFreePhotoSite({ name, number, address }));
    } catch (e) {
      showError(e, 'Baustelle konnte nicht angelegt werden');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Neue Baustelle"
      onClose={onClose}
      testId="photo-site-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy || !name.trim()} data-testid="photo-site-save">
            Anlegen
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
          <span>Baustelle *</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Garage Jagdschlossgasse" data-autofocus data-testid="photo-site-name" />
        </label>
        <label className="field">
          <span>Nummer / Code</span>
          <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="z. B. 91574" data-testid="photo-site-number" />
        </label>
        <label className="field">
          <span>Adresse</span>
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Straße, PLZ Ort" autoComplete="street-address" data-testid="photo-site-address" />
        </label>
        <p className="muted small">Baustellen aus Aufmaß &amp; Abrechnung und der Arbeitereinteilung stehen automatisch zur Auswahl.</p>
      </form>
    </Modal>
  );
}

/** Auswahl der Baustelle mit Eintrag „Neue Baustelle …“ */
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
        <option value="">– Baustelle wählen –</option>
        {sites.map((s) => (
          <option key={siteValue(s)} value={siteValue(s)}>
            {[s.number, s.name].filter(Boolean).join(' · ')}
          </option>
        ))}
        <option value="__new">+ Neue Baustelle …</option>
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
