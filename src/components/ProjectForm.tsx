import { useState } from 'react';
import type { Project } from '../lib/types';
import { Modal } from './Modal';

export type ProjectFields = Pick<Project, 'name' | 'number' | 'site' | 'address' | 'client' | 'editor' | 'date' | 'notes'>;

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
  /** Neues Projekt: Projekte aus dem Register anderer Werkzeuge (Fotos, Berichte, Einteilung, Mängelplan) zum Übernehmen */
  fromRegister?: Project[];
  /** adoptId: gewähltes Register-Projekt (wird übernommen statt neu angelegt) */
  onSubmit: (fields: ProjectFields, costCenters: CostCenterInput[], adoptId?: string | null) => void | Promise<void>;
  onClose: () => void;
}

const ccKey = (c: CostCenterInput) => `${c.number.trim()}|${c.name.trim()}`.toLowerCase();

/** Projektangaben einschließlich Kostenstelle(n) – beim Anlegen und beim Bearbeiten. */
export function ProjectForm({ title, initial, costCenters, submitLabel, fromRegister, onSubmit, onClose }: Props) {
  const [adoptId, setAdoptId] = useState<string | null>(null);
  const [f, setF] = useState<ProjectFields>({
    name: '',
    number: '',
    site: '',
    address: '',
    client: '',
    editor: '',
    // Baubeginn: nur wenn eingetragen (kein automatisches Datum)
    date: '',
    notes: '',
    ...initial,
  });
  const [ccs, setCcs] = useState<CostCenterInput[]>(costCenters?.length ? costCenters : [{ number: '', name: '' }]);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof ProjectFields) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const nameMissing = !f.name.trim();

  // Kostenstellen sind optional: leere neue Zeilen werden ignoriert, bestehende bleiben erhalten
  // (auch leer – dort liegen die Pläne eines Projekts ohne Kostenstelle)
  const filled = ccs.filter((c) => c.id || c.number.trim() || c.name.trim());
  const named = filled.filter((c) => c.number.trim() || c.name.trim());
  const ccError = new Set(named.map(ccKey)).size !== named.length ? 'Jede Kostenstelle darf nur einmal vorkommen.' : null;
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
            await onSubmit(
              { ...f, name: f.name.trim(), number: (f.number ?? '').trim(), site: f.site.trim() },
              filled.map((c) => ({ ...c, number: c.number.trim(), name: c.name.trim() })),
              adoptId,
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {!!fromRegister?.length && (
          <label className="field span-2">
            <span>Aus dem Projektregister übernehmen (optional – Projekte aus Fotos, Berichten, Einteilung, Mängelplan)</span>
            <select
              value={adoptId ?? ''}
              onChange={(e) => {
                const p = fromRegister.find((x) => x.id === e.target.value) ?? null;
                setAdoptId(p ? p.id : null);
                if (p) setF({ ...f, name: p.name, number: p.number ?? '', site: p.site, address: p.address, client: p.client, editor: p.editor, date: p.date, notes: p.notes });
              }}
              data-testid="project-from-register"
            >
              <option value="">– Projekt wählen –</option>
              {fromRegister.map((p) => (
                <option key={p.id} value={p.id}>
                  {[p.number, p.site || p.name].filter(Boolean).join(' · ')}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field span-2">
          <span>Projektname *</span>
          <input value={f.name} onChange={set('name')} name="name" autoComplete="off" enterKeyHint="next" aria-invalid={touched && nameMissing} />
          {touched && nameMissing && <small className="error">Bitte einen Projektnamen eingeben.</small>}
        </label>
        <div className="field span-2 cc-fields">
          <span>Kostenstelle(n) (optional)</span>
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
                placeholder={i === 0 ? 'Hauptkostenstelle, z. B. Tiefgarage' : 'Bezeichnung'}
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
          <span>Projektnummer (optional)</span>
          <input value={f.number ?? ''} onChange={set('number')} name="number" autoComplete="off" enterKeyHint="next" />
        </label>
        <label className="field span-2">
          <span>Adresse (optional)</span>
          <input value={f.address} onChange={set('address')} name="address" autoComplete="street-address" enterKeyHint="next" />
        </label>
        <label className="field">
          <span>Auftraggeber (optional)</span>
          <input value={f.client} onChange={set('client')} name="client" autoComplete="organization" enterKeyHint="next" />
        </label>
        <label className="field">
          <span>Baubeginn (optional)</span>
          <input type="date" value={f.date} onChange={set('date')} name="date" data-testid="project-start" />
        </label>
        <label className="field span-2">
          <span>Bemerkung (optional)</span>
          <textarea value={f.notes} onChange={set('notes')} name="notes" rows={3} />
        </label>
      </form>
    </Modal>
  );
}
