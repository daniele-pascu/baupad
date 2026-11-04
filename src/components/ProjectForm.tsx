import { useEffect, useState } from 'react';
import type { Project, SiteManager, Worker } from '../lib/types';
import { listWorkers } from '../lib/db';
import { gradeLabel, sortByGrade, workerName } from '../lib/crew';
import { Modal } from './Modal';

export type ProjectFields = Pick<Project, 'name' | 'number' | 'site' | 'address' | 'client' | 'editor' | 'date' | 'notes' | 'siteManager'>;

/** Bauleitung: zuerst Projektleiter, Techniker, Bautechniker – dann alle anderen */
const LEAD_GRADES = new Set(['projektleiter', 'techniker', 'bautechniker']);

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
  /** Test-IDs (Standard project-form / project-*); die anderen Werkzeuge nutzen photo-site-*) */
  ids?: Partial<Record<'dialog' | 'name' | 'number' | 'address' | 'save', string>>;
}

const ccKey = (c: CostCenterInput) => `${c.number.trim()}|${c.name.trim()}`.toLowerCase();

/** Projektangaben – beim Anlegen (ein Kostenstellen-Feld, in allen Werkzeugen gleich) und beim Bearbeiten (mehrere Kostenstellen). */
export function ProjectForm({ title, initial, costCenters, submitLabel, onSubmit, onClose, ids = {} }: Props) {
  const id = { dialog: 'project-form', name: 'project-name', number: 'project-number', address: 'project-address', save: 'project-save', ...ids };
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
  // Bauleitung: aus dem Personal oder frei mit Handynummer
  const [workers, setWorkers] = useState<Worker[]>([]);
  useEffect(() => {
    void listWorkers().then((l) => setWorkers(sortByGrade(l.filter((w) => w.active || w.id === f.siteManager?.workerId))), () => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const sm = f.siteManager ?? null;
  const smMode = !sm ? '' : sm.workerId ? sm.workerId : 'other';
  const setSm = (next: SiteManager | null) => setF((p) => ({ ...p, siteManager: next }));
  const leads = workers.filter((w) => LEAD_GRADES.has(w.grade ?? ''));
  const rest = workers.filter((w) => !LEAD_GRADES.has(w.grade ?? ''));
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
      testId={id.dialog}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="submit" form="project-form" className="btn btn-primary" disabled={busy} data-testid={id.save}>
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
              { ...f, name: f.name.trim(), number: (f.number ?? '').trim(), site: f.site.trim(), siteManager: sm && sm.name.trim() ? { workerId: sm.workerId ?? null, name: sm.name.trim(), phone: sm.phone.trim() } : null },
              filled.map((c) => ({ ...c, number: c.number.trim(), name: c.name.trim() })),
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field span-2">
          <span>Projektname *</span>
          <input value={f.name} onChange={set('name')} name="name" autoComplete="off" enterKeyHint="next" aria-invalid={touched && nameMissing} data-autofocus data-testid={id.name} />
          {touched && nameMissing && <small className="error">Bitte einen Projektnamen eingeben.</small>}
        </label>
        <label className="field span-2">
          <span>Bauvorhaben</span>
          <input value={f.address} onChange={set('address')} name="address" placeholder="Adresse" autoComplete="street-address" enterKeyHint="next" data-testid={id.address} />
        </label>
        <label className="field">
          <span>Projektnummer</span>
          <input value={f.number ?? ''} onChange={set('number')} name="number" autoComplete="off" enterKeyHint="next" data-testid={id.number} />
        </label>
        {!costCenters && (
          <label className="field">
            <span>Kostenstelle</span>
            <input
              value={ccs[0]?.name ?? ''}
              onChange={(e) => setCc(0, { name: e.target.value, number: '' })}
              name="costCenter0"
              placeholder="z. B. 91092 oder 91092 – Tiefgarage"
              autoComplete="off"
              enterKeyHint="next"
              data-testid="cost-center-input"
            />
          </label>
        )}
        {costCenters && (
        <div className="field cc-fields">
          <span>Kostenstelle(n)</span>
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
                placeholder="Bezeichnung"
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
        )}
        <div className="field span-2 site-manager" data-testid="site-manager">
          <span>Bauleitung</span>
          <select
            value={smMode}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return setSm(null);
              if (v === 'other') return setSm({ workerId: null, name: sm?.workerId ? '' : (sm?.name ?? ''), phone: sm?.workerId ? '' : (sm?.phone ?? '') });
              const w = workers.find((x) => x.id === v);
              if (w) setSm({ workerId: w.id, name: workerName(w), phone: w.phone ?? '' });
            }}
            data-testid="site-manager-select"
          >
            <option value="">– keine –</option>
            {leads.length > 0 && (
              <optgroup label="Projektleitung / Technik">
                {leads.map((w) => (
                  <option key={w.id} value={w.id}>
                    {workerName(w)} ({gradeLabel(w.grade)})
                  </option>
                ))}
              </optgroup>
            )}
            {rest.length > 0 && (
              <optgroup label="Personal">
                {rest.map((w) => (
                  <option key={w.id} value={w.id}>
                    {workerName(w)}
                    {w.grade ? ` (${gradeLabel(w.grade)})` : ''}
                  </option>
                ))}
              </optgroup>
            )}
            <option value="other">Andere Person …</option>
          </select>
          {sm && (
            <span className="site-manager-fields">
              {smMode === 'other' && <input value={sm.name} onChange={(e) => setSm({ ...sm, name: e.target.value })} placeholder="Name" aria-label="Name der Bauleitung" autoComplete="off" data-testid="site-manager-name" />}
              <input value={sm.phone} onChange={(e) => setSm({ ...sm, phone: e.target.value })} placeholder="Handynummer" aria-label="Handynummer der Bauleitung" type="tel" inputMode="tel" autoComplete="off" data-testid="site-manager-phone" />
            </span>
          )}
        </div>
        <label className="field">
          <span>Auftraggeber</span>
          <input value={f.client} onChange={set('client')} name="client" autoComplete="organization" enterKeyHint="next" data-testid="project-client" />
        </label>
        <label className="field">
          <span>Baubeginn</span>
          <input type="date" value={f.date} onChange={set('date')} name="date" data-testid="project-start" />
        </label>
        <label className="field span-2">
          <span>Bemerkung</span>
          <textarea value={f.notes} onChange={set('notes')} name="notes" rows={2} data-testid="project-notes" />
        </label>
      </form>
    </Modal>
  );
}
