import { useId, useState } from 'react';
import { alive, putRecord, type ProjectState } from '../lib/store';
import type { Plan } from '../lib/types';
import { Modal } from './Modal';

export interface PlanFieldValues {
  planNumber: string;
  planName: string;
  floor: string;
  area: string;
  description: string;
}

export function PlanFields({
  value,
  onChange,
  error,
}: {
  value: PlanFieldValues;
  onChange: (v: Partial<PlanFieldValues>) => void;
  error?: string | null;
}) {
  const id = useId();
  return (
    <div className="form-grid">
      <label className="field">
        <span>Plannummer *</span>
        <input
          value={value.planNumber}
          onChange={(e) => onChange({ planNumber: e.target.value })}
          placeholder="z. B. A-101"
          name={`${id}-number`}
          data-field="planNumber"
          autoComplete="off"
          enterKeyHint="next"
          aria-invalid={!!error}
        />
        {error && <small className="error">{error}</small>}
      </label>
      <label className="field">
        <span>Planname</span>
        <input value={value.planName} onChange={(e) => onChange({ planName: e.target.value })} placeholder="z. B. Untergeschoss" data-field="planName" autoComplete="off" enterKeyHint="next" />
      </label>
      <label className="field">
        <span>Geschoss / Stockwerk</span>
        <input value={value.floor} onChange={(e) => onChange({ floor: e.target.value })} placeholder="z. B. UG, EG, 1. OG" data-field="floor" autoComplete="off" enterKeyHint="next" />
      </label>
      <label className="field">
        <span>Planbereich</span>
        <input value={value.area} onChange={(e) => onChange({ area: e.target.value })} placeholder="z. B. Decke, Wand Nord" data-field="area" autoComplete="off" enterKeyHint="next" />
      </label>
      <label className="field span-2">
        <span>Planbeschreibung (optional)</span>
        <textarea value={value.description} onChange={(e) => onChange({ description: e.target.value })} rows={2} data-field="description" />
      </label>
    </div>
  );
}

/** Planangaben nachträglich bearbeiten. */
export function PlanDetailsDialog({ plan, data, onClose }: { plan: Plan; data: ProjectState; onClose: () => void }) {
  const [v, setV] = useState<PlanFieldValues>({
    planNumber: plan.planNumber,
    planName: plan.planName,
    floor: plan.floor,
    area: plan.area,
    description: plan.description,
  });
  const [start, setStart] = useState(String(plan.numberStart));
  const [show, setShow] = useState(false);
  const n = v.planNumber.trim().toLowerCase();
  const error = !n
    ? 'Bitte eine Plannummer eingeben.'
    : alive(data.plans).some((p) => p.id !== plan.id && p.planNumber.trim().toLowerCase() === n)
      ? 'Diese Plannummer ist im Projekt bereits vergeben.'
      : null;
  const startOk = /^\d{1,6}$/.test(start.trim());

  return (
    <Modal
      title="Planangaben bearbeiten"
      onClose={onClose}
      persistent
      testId="plan-details"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setShow(true);
              if (error || !startOk) return;
              putRecord('plans', {
                ...plan,
                planNumber: v.planNumber.trim(),
                planName: v.planName.trim(),
                floor: v.floor.trim(),
                area: v.area.trim(),
                description: v.description.trim(),
                numberStart: Number(start.trim()),
              });
              onClose();
            }}
          >
            Speichern
          </button>
        </>
      }
    >
      <PlanFields value={v} onChange={(p) => setV({ ...v, ...p })} error={show ? error : null} />
      <label className="field">
        <span>Startnummer für neue Schadstellen</span>
        <input value={start} onChange={(e) => setStart(e.target.value)} inputMode="numeric" pattern="[0-9]*" />
        <small className="muted">Standard: 0. Bestehende Nummern werden dadurch nicht verändert.</small>
        {show && !startOk && <small className="error">Bitte eine ganze Zahl ≥ 0 eingeben.</small>}
      </label>
      <p className="muted small">
        Originaldatei: {data.files[plan.fileId]?.name ?? '–'}
        {(data.files[plan.fileId]?.pageCount ?? 1) > 1 && `, Seite ${plan.pageIndex + 1}`}
        {plan.crop && ', Planbereich'}
      </p>
    </Modal>
  );
}
