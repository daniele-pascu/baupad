import { useId, useState } from 'react';
import { drawingRegion, isDrawingPlan, PAPER, PAPER_FORMATS, SCALES, sheetFields, sheetMeters } from '../lib/drawing';
import { formatMeasure } from '../lib/numbers';
import { elementsOf } from '../lib/aufmass';
import { planNumberStart } from '../lib/numbering';
import { alive, newMeta, putRecord, type ProjectState } from '../lib/store';
import type { PaperFormat, Plan } from '../lib/types';
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
        <span>Planbezeichnung</span>
        <input value={value.planName} onChange={(e) => onChange({ planName: e.target.value })} placeholder="z. B. Untergeschoss" data-field="planName" autoComplete="off" enterKeyHint="next" />
      </label>
      <label className="field">
        <span>Ebene / Geschoss</span>
        <input value={value.floor} onChange={(e) => onChange({ floor: e.target.value })} placeholder="z. B. UG2, EG, 1. OG" data-field="floor" autoComplete="off" enterKeyHint="next" />
      </label>
      <label className="field">
        <span>Planbereich</span>
        <input value={value.area} onChange={(e) => onChange({ area: e.target.value })} placeholder="z. B. Decke, Wand Nord" data-field="area" autoComplete="off" enterKeyHint="next" />
      </label>
      <label className="field span-2">
        <span>Bemerkungen (optional)</span>
        <textarea value={value.description} onChange={(e) => onChange({ description: e.target.value })} rows={2} data-field="description" placeholder="z. B. Bereich Tiefgarage Nord" />
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
  const [start, setStart] = useState(String(planNumberStart(plan)));
  const [paper, setPaper] = useState<PaperFormat | ''>(plan.drawing?.paper ?? '');
  const [scale, setScale] = useState(plan.drawing?.scale ?? 100);
  const [show, setShow] = useState(false);
  const n = v.planNumber.trim().toLowerCase();
  const error = !n
    ? 'Bitte eine Plannummer eingeben.'
    : alive(data.plans).some((p) => p.id !== plan.id && p.planNumber.trim().toLowerCase() === n)
      ? 'Diese Plannummer ist im Projekt bereits vergeben.'
      : null;
  const startOk = /^\d{1,6}$/.test(start.trim()) && Number(start.trim()) >= 1;

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
                ...(isDrawingPlan(plan) && paper ? sheetFields(paper, scale) : {}),
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
        <small className="muted">Standard: 1. Bestehende Nummern werden dadurch nicht verändert.</small>
        {show && !startOk && <small className="error">Bitte eine ganze Zahl ab 1 eingeben.</small>}
      </label>
      {isDrawingPlan(plan) ? (
        <>
          <SheetFields paper={paper} scale={scale} onChange={(p, s) => (setPaper(p), setScale(s))} allowNone={!plan.drawing?.paper} />
          {paper && <OutsideHint plan={plan} data={data} paper={paper} scale={scale} />}
          <p className="muted small">Selbst gezeichneter Plan (Maße in Metern).</p>
        </>
      ) : (
        <p className="muted small">
          Originaldatei: {data.files[plan.fileId]?.name ?? '–'}
          {(data.files[plan.fileId]?.pageCount ?? 1) > 1 && `, Seite ${plan.pageIndex + 1}`}
          {plan.crop && ', Planbereich'}
        </p>
      )}
    </Modal>
  );
}

/** Plannummer prüfen: Pflichtfeld und im Projekt eindeutig */
function planNumberError(data: ProjectState, value: string, exceptId?: string): string | null {
  const n = value.trim().toLowerCase();
  if (!n) return 'Bitte eine Plannummer eingeben.';
  if (alive(data.plans).some((p) => p.id !== exceptId && p.planNumber.trim().toLowerCase() === n)) return 'Diese Plannummer ist im Projekt bereits vergeben.';
  return null;
}

/**
 * Neuen Plan selbst zeichnen: Planangaben erfassen und eine leere, maßhaltige Zeichenfläche
 * anlegen. Die Zeichenfläche wächst automatisch mit dem Inhalt.
 */
export function NewDrawingDialog({
  data,
  costCenterId,
  onClose,
  onCreated,
}: {
  data: ProjectState;
  costCenterId: string;
  onClose: () => void;
  onCreated: (planId: string) => void;
}) {
  const [v, setV] = useState<PlanFieldValues>({ planNumber: '', planName: '', floor: '', area: '', description: '' });
  const [show, setShow] = useState(false);
  const [paper, setPaper] = useState<PaperFormat>(() => (localStorage.getItem('paper') as PaperFormat) || 'A3-quer');
  const [scale, setScale] = useState(() => Number(localStorage.getItem('paperScale')) || 100);
  const error = planNumberError(data, v.planNumber);
  const submit = () => {
    setShow(true);
    if (error) return;
    const siblings = alive(data.plans).filter((p) => p.costCenterId === costCenterId);
    const plan: Plan = {
      ...newMeta(),
      projectId: data.project.id,
      costCenterId,
      source: 'drawing',
      ...sheetFields(PAPER[paper] ? paper : 'A3-quer', scale),
      fileId: '',
      pageIndex: 0,
      crop: null,
      planNumber: v.planNumber.trim(),
      planName: v.planName.trim(),
      floor: v.floor.trim(),
      area: v.area.trim(),
      description: v.description.trim(),
      numberStart: 1,
      sortIndex: siblings.length ? Math.max(...siblings.map((p) => p.sortIndex)) + 1 : 0,
    };
    putRecord('plans', plan);
    try {
      localStorage.setItem('paper', paper);
      localStorage.setItem('paperScale', String(scale));
    } catch {
      /* optional */
    }
    onCreated(plan.id);
  };
  return (
    <Modal
      title="Neuen Plan zeichnen"
      onClose={onClose}
      persistent
      testId="new-drawing"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} data-testid="new-drawing-save">
            Zeichenfläche öffnen
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <PlanFields value={v} onChange={(p) => setV({ ...v, ...p })} error={show ? error : null} />
        <SheetFields paper={paper} scale={scale} onChange={(p, s) => (setPaper((p || 'A3-quer') as PaperFormat), setScale(s))} />
        <p className="muted small">
          Sie zeichnen maßstäblich in Metern: z. B. Rechteck wählen, 5,00 × 3,65 m eingeben, einfügen. Danach geht es mit „Weiter“ zum
          Aufmaß.
        </p>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

/** Papierformat und Maßstab des Zeichenblatts mit der daraus folgenden realen Blattgröße. */
function SheetFields({
  paper,
  scale,
  onChange,
  allowNone,
}: {
  paper: PaperFormat | '';
  scale: number;
  onChange: (paper: PaperFormat | '', scale: number) => void;
  allowNone?: boolean;
}) {
  const m = paper ? sheetMeters(paper, scale) : null;
  return (
    <div className="form-grid">
      <label className="field">
        <span>Papierformat</span>
        <select value={paper} onChange={(e) => onChange(e.target.value as PaperFormat | '', scale)} data-testid="sheet-paper">
          {allowNone && <option value="">Ohne Format (Zeichenfläche wächst mit)</option>}
          {PAPER_FORMATS.map((p) => (
            <option key={p} value={p}>
              {PAPER[p].label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Maßstab</span>
        <select value={scale} onChange={(e) => onChange(paper, Number(e.target.value))} disabled={!paper} data-testid="sheet-scale">
          {SCALES.map((n) => (
            <option key={n} value={n}>
              1:{n}
            </option>
          ))}
        </select>
      </label>
      {m && (
        <p className="muted small span-2" data-testid="sheet-size">
          Zeichenblatt: {formatMeasure(m.w)} × {formatMeasure(m.h)} m (realer Bereich innerhalb der Druckränder)
        </p>
      )}
    </div>
  );
}

/** Hinweis, wenn vorhandene Objekte bei einem kleineren Blatt außerhalb liegen würden (nichts wird verändert). */
function OutsideHint({ plan, data, paper, scale }: { plan: Plan; data: ProjectState; paper: PaperFormat; scale: number }) {
  const f = sheetFields(paper, scale);
  const r = drawingRegion({ ...plan, ...f }, elementsOf(data, plan.id));
  const outside = r.x < 0 || r.y < 0 || r.w > f.pageWidth + 0.5 || r.h > f.pageHeight + 0.5;
  return outside ? (
    <p className="small warn-text" data-testid="sheet-outside">
      Teile der Zeichnung liegen außerhalb dieses Blatts. Sie bleiben erhalten, sind im PDF aber abgeschnitten – größeres Format oder Maßstab wählen.
    </p>
  ) : null;
}
