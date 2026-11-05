import { invoiceLabel, invoicesOf } from '../lib/invoices';
import { useId, useState } from 'react';
import { isDrawingPlan, PAPER, PAPER_FORMATS, PRINT_HEADER_MM, PRINT_MARGIN_MM, printFit, SCALES, sheetFields, sheetMeters } from '../lib/drawing';
import { formatMeasure } from '../lib/numbers';
import { elementsOf } from '../lib/aufmass';
import { planNumberStart } from '../lib/numbering';
import { sameNumberScope } from '../lib/invoices';
import { alive, newMeta, putRecord, type ProjectState } from '../lib/store';
import { exportPaper, planHeading } from '../lib/sheet-layout';
import type { PaperFormat, Plan } from '../lib/types';
import { Modal } from './Modal';

export interface PlanFieldValues {
  planNumber: string;
  planName: string;
  floor: string;
  area: string;
  description: string;
  /** Titel im PDF-Kopf neben der Plannummer (leer = „Aufmaßplan“) */
  title?: string;
  /** Bemerkung im PDF anzeigen */
  showNote?: boolean;
  /** Planbezeichnung bzw. Ebene in der Überschrift anzeigen */
  showName?: boolean;
  showFloor?: boolean;
}

/** Kontrollkästchen „Im Plan anzeigen“: steuert nur die Ausgabe im PDF, die Angabe bleibt gespeichert */
export function ShowInPlan({ checked, onChange, testId }: { checked: boolean; onChange: (v: boolean) => void; testId: string }) {
  return (
    <label className="check-row small show-in-plan">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />
      <span>Im Plan anzeigen</span>
    </label>
  );
}

/**
 * Planangaben. Im PDF-Kopf stehen nur Plannummer und Titel („Plannummer 067 | Aufmaßplan“);
 * die Bemerkung nur, wenn „Im Plan anzeigen“ gewählt ist. `simple`: nur diese Angaben.
 */
export function PlanFields({
  value,
  onChange,
  error,
  simple = false,
}: {
  value: PlanFieldValues;
  onChange: (v: Partial<PlanFieldValues>) => void;
  error?: string | null;
  simple?: boolean;
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
        <span>Titel</span>
        <input
          value={value.title ?? ''}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="z. B. Aufmaßplan"
          data-field="title"
          autoComplete="off"
          enterKeyHint="next"
          maxLength={120}
        />
      </label>
      <p className="muted small span-2 heading-preview" data-testid="heading-preview">
        Überschrift im PDF: {planHeading({ planNumber: value.planNumber, title: value.title, planName: value.planName, floor: value.floor, showName: value.showName, showFloor: value.showFloor })}
      </p>
      {!simple && (
      <>
      <div className="field">
        <span className="field-head">
          <label htmlFor={`${id}-name`}>Planbezeichnung</label>
          <ShowInPlan checked={value.showName !== false} onChange={(showName) => onChange({ showName })} testId="show-name" />
        </span>
        <input id={`${id}-name`} value={value.planName} onChange={(e) => onChange({ planName: e.target.value })} placeholder="z. B. BA. 4" data-field="planName" autoComplete="off" enterKeyHint="next" />
      </div>
      <div className="field">
        <span className="field-head">
          <label htmlFor={`${id}-floor`}>Ebene / Geschoss</label>
          <ShowInPlan checked={value.showFloor !== false} onChange={(showFloor) => onChange({ showFloor })} testId="show-floor" />
        </span>
        <input id={`${id}-floor`} value={value.floor} onChange={(e) => onChange({ floor: e.target.value })} placeholder="z. B. UG2, EG, 1. OG" data-field="floor" autoComplete="off" enterKeyHint="next" />
      </div>
      <label className="field">
        <span>Planbereich</span>
        <input value={value.area} onChange={(e) => onChange({ area: e.target.value })} placeholder="z. B. Decke, Wand Nord" data-field="area" autoComplete="off" enterKeyHint="next" />
      </label>
      </>
      )}
      <div className="field span-2">
        <span className="field-head">
          <label htmlFor={`${id}-note`}>Bemerkung</label>
          <ShowInPlan checked={!!value.showNote} onChange={(showNote) => onChange({ showNote })} testId="show-note" />
        </span>
        <textarea id={`${id}-note`} value={value.description} onChange={(e) => onChange({ description: e.target.value })} rows={2} data-field="description" placeholder="z. B. Bereich Tiefgarage Nord" />
      </div>
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
    title: plan.title ?? '',
    showNote: !!plan.showNote,
    showName: plan.showName !== false,
    showFloor: plan.showFloor !== false,
  });
  const [showPaper, setShowPaper] = useState(!!plan.showPaper);
  const [showScale, setShowScale] = useState(!!plan.showScale);
  /** Importierte Pläne: Papierformat für den PDF-Export */
  const [exportFmt, setExportFmt] = useState<PaperFormat>(() => exportPaper(plan));
  const [start, setStart] = useState(String(planNumberStart(plan)));
  const [paper, setPaper] = useState<PaperFormat | ''>(plan.drawing?.paper ?? '');
  const [scale, setScale] = useState(plan.drawing?.scale ?? 100);
  const [show, setShow] = useState(false);
  /** Anzeige im Plan (Titel, Bezeichnung, Ebene, Bemerkung, Format, Maßstab) auf alle Pläne des Projekts übertragen */
  const [applyAll, setApplyAll] = useState(false);
  /** aufgeteilt nach Rechnungen: Plan in eine andere Rechnung verschieben */
  const invoices = data.project.splitByInvoice ? invoicesOf(data.project) : [];
  const [invoiceId, setInvoiceId] = useState(plan.invoiceId ?? invoices[0]?.id ?? '');
  const error = planNumberError(data, v.planNumber, plan.id, invoices.length ? invoiceId : plan.invoiceId);
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
                title: v.title?.trim() ?? '',
                showNote: !!v.showNote,
                showName: v.showName !== false,
                showFloor: v.showFloor !== false,
                showPaper,
                showScale: isDrawingPlan(plan) ? showScale : false,
                ...(isDrawingPlan(plan) ? (paper ? sheetFields(paper, scale) : {}) : { paper: exportFmt }),
                ...(invoices.length && invoiceId ? { invoiceId } : {}),
              });
              if (applyAll)
                for (const other of alive(data.plans)) {
                  if (other.id === plan.id || other.projectId !== plan.projectId) continue;
                  putRecord('plans', {
                    ...other,
                    title: v.title?.trim() ?? '',
                    showNote: !!v.showNote,
                    showName: v.showName !== false,
                    showFloor: v.showFloor !== false,
                    showPaper,
                    showScale: isDrawingPlan(other) ? showScale : false,
                  });
                }
              onClose();
            }}
          >
            Speichern
          </button>
        </>
      }
    >
      <PlanFields value={v} onChange={(p) => setV({ ...v, ...p })} error={show ? error : null} />
      {invoices.length > 1 && (
        <label className="field">
          <span>Rechnung</span>
          <select value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} data-testid="plan-invoice">
            {invoices.map((i) => (
              <option key={i.id} value={i.id}>
                {invoiceLabel(i)}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="check-row small apply-all-plans">
        <input type="checkbox" checked={applyAll} onChange={(e) => setApplyAll(e.target.checked)} data-testid="apply-all-plans" />
        <span>Titel und „Im Plan anzeigen“ für alle Pläne dieses Projekts übernehmen ({alive(data.plans).filter((x) => x.projectId === plan.projectId).length} Pläne)</span>
      </label>
      <label className="field">
        <span>Startnummer für neue Schadstellen</span>
        <input value={start} onChange={(e) => setStart(e.target.value)} inputMode="numeric" pattern="[0-9]*" />
        <small className="muted">Standard: 1. Bestehende Nummern werden dadurch nicht verändert.</small>
        {show && !startOk && <small className="error">Bitte eine ganze Zahl ab 1 eingeben.</small>}
      </label>
      {isDrawingPlan(plan) ? (
        <>
          <SheetFields
            paper={paper}
            scale={scale}
            onChange={(p, s) => (setPaper(p), setScale(s))}
            allowNone={!plan.drawing?.paper}
            showPaper={showPaper}
            showScale={showScale}
            onShow={(o) => (o.showPaper !== undefined && setShowPaper(o.showPaper), o.showScale !== undefined && setShowScale(o.showScale))}
          />
          {paper && <OutsideHint plan={plan} data={data} paper={paper} scale={scale} />}
          <p className="muted small">Selbst gezeichneter Plan (Maße in Metern).</p>
        </>
      ) : (
        <>
        <ExportPaperField value={exportFmt} onChange={setExportFmt} show={showPaper} onShow={setShowPaper} />
        <p className="muted small">
          Originaldatei: {data.files[plan.fileId]?.name ?? '–'}
          {(data.files[plan.fileId]?.pageCount ?? 1) > 1 && `, Seite ${plan.pageIndex + 1}`}
          {plan.crop && ', Planbereich'}
        </p>
        </>
      )}
    </Modal>
  );
}

/** Plannummer prüfen: Pflichtfeld und im Projekt (aufgeteilt: in der Rechnung) eindeutig */
export function planNumberError(data: ProjectState, value: string, exceptId?: string, invoiceId?: string | null): string | null {
  const n = value.trim().toLowerCase();
  if (!n) return 'Bitte eine Plannummer eingeben.';
  const scope = sameNumberScope(data.project, invoiceId);
  if (alive(data.plans).some((p) => p.id !== exceptId && scope(p) && p.planNumber.trim().toLowerCase() === n)) return planNumberTaken(data);
  return null;
}

/** Meldung „bereits vergeben“ (im Projekt bzw. in der Rechnung) */
export const planNumberTaken = (data: ProjectState) => `Diese Plannummer ist ${data.project.splitByInvoice ? 'in dieser Rechnung' : 'im Projekt'} bereits vergeben.`;

/**
 * Neuen Plan selbst zeichnen: Planangaben erfassen und eine leere, maßhaltige Zeichenfläche
 * anlegen. Die Zeichenfläche wächst automatisch mit dem Inhalt.
 */
export function NewDrawingDialog({
  data,
  costCenterId,
  invoiceId = null,
  onClose,
  onCreated,
}: {
  data: ProjectState;
  costCenterId: string;
  /** aufgeteiltes Projekt: Rechnung des neuen Plans */
  invoiceId?: string | null;
  onClose: () => void;
  onCreated: (planId: string) => void;
}) {
  const [v, setV] = useState<PlanFieldValues>({ planNumber: '', planName: '', floor: '', area: '', description: '', title: '', showNote: false });
  const [show, setShow] = useState(false);
  // Format und Maßstab erscheinen standardmäßig nicht auf dem Plan
  const [showPaper, setShowPaper] = useState(false);
  const [showScale, setShowScale] = useState(false);
  const [paper, setPaper] = useState<PaperFormat>(() => (localStorage.getItem('paper') as PaperFormat) || 'A3-quer');
  const [scale, setScale] = useState(() => Number(localStorage.getItem('paperScale')) || 100);
  const error = planNumberError(data, v.planNumber, undefined, invoiceId);
  const submit = () => {
    setShow(true);
    if (error) return;
    const siblings = alive(data.plans).filter((p) => p.costCenterId === costCenterId);
    const plan: Plan = {
      ...newMeta(),
      projectId: data.project.id,
      costCenterId,
      ...(invoiceId ? { invoiceId } : {}),
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
      title: v.title?.trim() ?? '',
      showNote: !!v.showNote,
      showName: v.showName !== false,
      showFloor: v.showFloor !== false,
      showPaper,
      showScale,
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
        <PlanFields value={v} onChange={(p) => setV({ ...v, ...p })} error={show ? error : null} simple />
        <SheetFields
          paper={paper}
          scale={scale}
          onChange={(p, s) => (setPaper((p || 'A3-quer') as PaperFormat), setScale(s))}
          showPaper={showPaper}
          showScale={showScale}
          onShow={(o) => (o.showPaper !== undefined && setShowPaper(o.showPaper), o.showScale !== undefined && setShowScale(o.showScale))}
        />
        <p className="muted small">
          Sie zeichnen maßstäblich in Metern: z. B. Rechteck wählen, 5,00 × 3,65 m eingeben, einfügen. Danach geht es mit „Weiter“ zum
          Aufmaß.
        </p>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

/**
 * Papierformat für den PDF-Export importierter Pläne. Der Plan bzw. Ausschnitt wird darin
 * proportional und zentriert eingepasst; das Format ändert sich dabei nie von selbst.
 */
export function ExportPaperField({
  value,
  onChange,
  show,
  onShow,
}: {
  value: PaperFormat;
  onChange: (p: PaperFormat) => void;
  show?: boolean;
  onShow?: (v: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="field">
      <span className="field-head">
        <label htmlFor={id}>Format (PDF)</label>
        {onShow && <ShowInPlan checked={!!show} onChange={onShow} testId="show-paper" />}
      </span>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as PaperFormat)} data-testid="export-paper">
        {PAPER_FORMATS.map((f) => (
          <option key={f} value={f}>
            {PAPER[f].label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Papierformat und Maßstab des Zeichenblatts mit der daraus folgenden realen Blattgröße. */
function SheetFields({
  paper,
  scale,
  onChange,
  allowNone,
  showPaper = false,
  showScale = false,
  onShow,
}: {
  paper: PaperFormat | '';
  scale: number;
  onChange: (paper: PaperFormat | '', scale: number) => void;
  allowNone?: boolean;
  /** Format bzw. Maßstab im PDF anzeigen (Standard: nein) */
  showPaper?: boolean;
  showScale?: boolean;
  onShow?: (o: { showPaper?: boolean; showScale?: boolean }) => void;
}) {
  const m = paper ? sheetMeters(paper, scale) : null;
  return (
    <div className="form-grid">
      <div className="field">
        <span className="field-head">
          <label htmlFor="sheet-paper">Format</label>
          {onShow && <ShowInPlan checked={showPaper} onChange={(v) => onShow({ showPaper: v })} testId="show-paper" />}
        </span>
        <select id="sheet-paper" value={paper} onChange={(e) => onChange(e.target.value as PaperFormat | '', scale)} data-testid="sheet-paper">
          {allowNone && <option value="">Ohne Format (Zeichenfläche wächst mit)</option>}
          {PAPER_FORMATS.map((p) => (
            <option key={p} value={p}>
              {PAPER[p].label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <span className="field-head">
          <label htmlFor="sheet-scale">Maßstab</label>
          {onShow && <ShowInPlan checked={showScale} onChange={(v) => onShow({ showScale: v })} testId="show-scale" />}
        </span>
        <select id="sheet-scale" value={scale} onChange={(e) => onChange(paper, Number(e.target.value))} disabled={!paper} data-testid="sheet-scale">
          {SCALES.map((n) => (
            <option key={n} value={n}>
              1:{n}
            </option>
          ))}
        </select>
      </div>
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
  const p = PAPER[paper];
  const fit = printFit({ ...plan, ...f }, elementsOf(data, plan.id), [], { w: p.w - 2 * PRINT_MARGIN_MM, h: p.h - 2 * PRINT_MARGIN_MM - PRINT_HEADER_MM });
  return fit.fitted ? (
    <p className="small muted" data-testid="sheet-outside">
      Die Zeichnung ist größer als das Blatt bei 1:{scale}. Im PDF wird sie automatisch auf 1:{fit.scale} verkleinert, damit alles auf {p.label} passt.
    </p>
  ) : null;
}
