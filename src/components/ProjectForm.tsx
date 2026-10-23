import { useState } from 'react';
import { todayIso } from '../lib/numbers';
import type { Project } from '../lib/types';
import { Modal } from './Modal';

export type ProjectFields = Pick<Project, 'name' | 'site' | 'address' | 'client' | 'editor' | 'date' | 'notes'>;

interface Props {
  title: string;
  initial?: Partial<ProjectFields>;
  submitLabel: string;
  onSubmit: (fields: ProjectFields) => void | Promise<void>;
  onClose: () => void;
}

/** Eingabe der Projektdaten (neues Projekt oder Bearbeiten). */
export function ProjectForm({ title, initial, submitLabel, onSubmit, onClose }: Props) {
  const [f, setF] = useState<ProjectFields>({
    name: '',
    site: '',
    address: '',
    client: '',
    editor: localStorage.getItem('lastEditor') ?? '',
    date: todayIso(),
    notes: '',
    ...initial,
  });
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof ProjectFields) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const nameMissing = !f.name.trim();

  return (
    <Modal
      title={title}
      onClose={onClose}
      persistent
      testId="project-form"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="submit" form="project-form" className="btn btn-primary" disabled={busy}>
            {submitLabel}
          </button>
        </>
      }
    >
      <form
        id="project-form"
        className="form-grid"
        onSubmit={async (e) => {
          e.preventDefault();
          setTouched(true);
          if (nameMissing) return;
          setBusy(true);
          try {
            if (f.editor) localStorage.setItem('lastEditor', f.editor);
            await onSubmit({ ...f, name: f.name.trim(), site: f.site.trim() });
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field span-2">
          <span>Projektname *</span>
          <input value={f.name} onChange={set('name')} name="name" autoComplete="off" enterKeyHint="next" aria-invalid={touched && nameMissing} />
          {touched && nameMissing && <small className="error">Bitte einen Projektnamen eingeben.</small>}
        </label>
        <label className="field span-2">
          <span>Baustelle / Bauvorhaben</span>
          <input value={f.site} onChange={set('site')} name="site" autoComplete="off" enterKeyHint="next" />
        </label>
        <label className="field span-2">
          <span>Adresse oder Standort (optional)</span>
          <input value={f.address} onChange={set('address')} name="address" autoComplete="street-address" enterKeyHint="next" />
        </label>
        <label className="field">
          <span>Auftraggeber (optional)</span>
          <input value={f.client} onChange={set('client')} name="client" autoComplete="organization" enterKeyHint="next" />
        </label>
        <label className="field">
          <span>Bearbeiter (optional)</span>
          <input value={f.editor} onChange={set('editor')} name="editor" autoComplete="name" enterKeyHint="next" />
        </label>
        <label className="field">
          <span>Datum</span>
          <input type="date" value={f.date} onChange={set('date')} name="date" />
        </label>
        <label className="field span-2">
          <span>Bemerkungen (optional)</span>
          <textarea value={f.notes} onChange={set('notes')} name="notes" rows={3} />
        </label>
      </form>
    </Modal>
  );
}
