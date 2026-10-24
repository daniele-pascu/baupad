import { useState } from 'react';
import { todayIso } from '../lib/numbers';
import type { Project } from '../lib/types';
import { Modal } from './Modal';

export type ProjectFields = Pick<Project, 'name' | 'site' | 'address' | 'client' | 'editor' | 'date' | 'notes'>;

/** Kostenstelle im Formular; `id` ist bei bereits gespeicherten Kostenstellen gesetzt. */
export interface CostCenterInput {
  id?: string;
  number: string;
  name: string;
}

interface Props {
  title: string;
  initial?: Partial<ProjectFields>;
  /** Kostenstellen, die zusammen mit den Projektangaben bearbeitet werden */
  costCenters?: CostCenterInput[];
  submitLabel: string;
  onSubmit: (fields: ProjectFields, costCenters: CostCenterInput[]) => void | Promise<void>;
  onClose: () => void;
}

const ccKey = (c: CostCenterInput) => `${c.number.trim()}|${c.name.trim()}`.toLowerCase();

/** Projektangaben einschließlich Kostenstelle(n) – beim Anlegen und beim Bearbeiten. */
export function ProjectForm({ title, initial, costCenters, submitLabel, onSubmit, onClose }: Props) {
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
  const [ccs, setCcs] = useState<CostCenterInput[]>(costCenters?.length ? costCenters : [{ number: '', name: '' }]);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof ProjectFields) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const nameMissing = !f.name.trim();

  // Leere neue Zeilen werden ignoriert; bestehende Kostenstellen brauchen Nummer oder Bezeichnung
  const filled = ccs.filter((c) => c.id || c.number.trim() || c.name.trim());
  const ccError = !filled.length
    ? 'Bitte eine Kostenstelle eingeben (Nummer und/oder Bezeichnung).'
    : filled.some((c) => !c.number.trim() && !c.name.trim())
      ? 'Eine Kostenstelle braucht eine Nummer oder eine Bezeichnung.'
      : new Set(filled.map(ccKey)).size !== filled.length
        ? 'Jede Kostenstelle darf nur einmal vorkommen.'
        : null;
  const setCc = (i: number, patch: Partial<CostCenterInput>) => setCcs(ccs.map((c, j) => (j === i ? { ...c, ...patch } : c)));

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
            await onSubmit(
              { ...f, name: f.name.trim(), site: f.site.trim() },
              filled.map((c) => ({ ...c, number: c.number.trim(), name: c.name.trim() })),
            );
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

        <div className="field span-2 cc-fields">
          <span>Kostenstelle *</span>
          {ccs.map((c, i) => (
            <div key={c.id ?? `new-${i}`} className="cc-row">
              <input
                className="cc-number"
                value={c.number}
                onChange={(e) => setCc(i, { number: e.target.value })}
                name={`costCenterNumber${i}`}
                data-testid="cost-center-number"
                placeholder="Nr."
                autoComplete="off"
                enterKeyHint="next"
                aria-label={`Kostenstellennummer ${i + 1}`}
                aria-invalid={touched && !!ccError}
              />
              <input
                className="cc-name"
                value={c.name}
                onChange={(e) => setCc(i, { name: e.target.value })}
                name={`costCenter${i}`}
                data-testid="cost-center-input"
                placeholder={i === 0 ? 'Bezeichnung, z. B. Tiefgarage' : 'Bezeichnung'}
                autoComplete="off"
                enterKeyHint="next"
                aria-label={`Kostenstelle ${i + 1} Bezeichnung`}
                aria-invalid={touched && !!ccError}
              />
              {!c.id && ccs.length > 1 && (
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
          <button type="button" className="btn btn-sm cc-add" onClick={() => setCcs([...ccs, { number: '', name: '' }])}>
            + Weitere Kostenstelle
          </button>
          {touched && ccError && <small className="error">{ccError}</small>}
        </div>

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
