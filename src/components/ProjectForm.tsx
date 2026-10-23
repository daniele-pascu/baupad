import { useState } from 'react';
import { todayIso } from '../lib/numbers';
import type { Project } from '../lib/types';
import { Modal } from './Modal';

export type ProjectFields = Pick<Project, 'name' | 'site' | 'address' | 'client' | 'editor' | 'date' | 'notes'>;

interface Props {
  title: string;
  initial?: Partial<ProjectFields>;
  submitLabel: string;
  /** Beim Anlegen: Kostenstellen gleich mit erfassen */
  withCostCenters?: boolean;
  onSubmit: (fields: ProjectFields, costCenters: string[]) => void | Promise<void>;
  onClose: () => void;
}

/** Eingabe der Projektdaten (neues Projekt oder Bearbeiten). */
export function ProjectForm({ title, initial, submitLabel, withCostCenters, onSubmit, onClose }: Props) {
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
  const [ccs, setCcs] = useState<string[]>(['']);
  const ccNames = ccs.map((c) => c.trim()).filter(Boolean);
  const ccError = !withCostCenters
    ? null
    : !ccNames.length
      ? 'Bitte mindestens eine Kostenstelle eingeben (z. B. Tiefgarage).'
      : new Set(ccNames.map((c) => c.toLowerCase())).size !== ccNames.length
        ? 'Jede Kostenstelle darf nur einmal vorkommen.'
        : null;

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
          if (nameMissing || ccError) return;
          setBusy(true);
          try {
            if (f.editor) localStorage.setItem('lastEditor', f.editor);
            await onSubmit({ ...f, name: f.name.trim(), site: f.site.trim() }, ccNames);
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
        {withCostCenters && (
          <div className="field span-2 cc-fields">
            <span>Kostenstelle *</span>
            {ccs.map((c, i) => (
              <div key={i} className="row gap">
                <input
                  value={c}
                  onChange={(e) => setCcs(ccs.map((x, j) => (j === i ? e.target.value : x)))}
                  name={`costCenter${i}`}
                  data-testid="cost-center-input"
                  placeholder={i === 0 ? 'z. B. Tiefgarage, Stiege 1, Parkdeck' : 'weitere Kostenstelle'}
                  autoComplete="off"
                  enterKeyHint="next"
                  aria-label={`Kostenstelle ${i + 1}`}
                  aria-invalid={touched && !!ccError}
                />
                {ccs.length > 1 && (
                  <button
                    type="button"
                    className="icon-btn icon-btn-sm"
                    onClick={() => setCcs(ccs.filter((_, j) => j !== i))}
                    aria-label={`Kostenstelle ${i + 1} entfernen`}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            <button type="button" className="btn btn-sm cc-add" onClick={() => setCcs([...ccs, ''])}>
              + Weitere Kostenstelle
            </button>
            {touched && ccError && <small className="error">{ccError}</small>}
          </div>
        )}
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
