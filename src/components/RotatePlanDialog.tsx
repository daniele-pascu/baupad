import { useState } from 'react';
import { componentsOf, damagesOf, elementsOf, planTitle } from '../lib/aufmass';
import { rotatePlan } from '../lib/plan-rotate';
import { putRecord, type ProjectState } from '../lib/store';
import type { Plan } from '../lib/types';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { SourceThumb } from './PlanLibrary';
import { toast } from './ui';

/**
 * Planunterlage drehen (90°-Schritte). Ausschnitt und Kalibrierung drehen mit, die
 * Originaldatei bleibt unverändert. Nur solange der Plan noch keine Messungen, Markierungen
 * oder Zeichnungen hat – deren Lage würde sonst nicht mehr stimmen.
 */
export function RotatePlanDialog({ data, plan, onClose, onReuse }: { data: ProjectState; plan: Plan; onClose: () => void; onReuse: (plan: Plan) => void }) {
  const [turn, setTurn] = useState<0 | 90 | 180 | 270>(0);
  const file = data.files[plan.fileId];
  const used = damagesOf(data, plan.id).length + componentsOf(data, plan.id).length + elementsOf(data, plan.id).length;
  const preview = turn ? rotatePlan(plan, turn) : plan;
  const add = (d: 90 | 270) => setTurn((((turn + d) % 360) as 0 | 90 | 180 | 270));
  const save = () => {
    if (turn) putRecord('plans', rotatePlan(data.plans[plan.id], turn));
    toast(turn ? 'Plan gedreht.' : 'Keine Änderung.', turn ? 'success' : 'info');
    onClose();
  };

  if (used)
    return (
      <Modal
        title="Plan drehen"
        onClose={onClose}
        testId="rotate-plan"
        footer={
          <>
            <button type="button" className="btn" onClick={onClose}>
              Schließen
            </button>
            {file && (
              <button type="button" className="btn btn-primary" onClick={() => onReuse(plan)} data-testid="rotate-reuse">
                <Icon name="copy" /> Neues Aufmaß mit diesem Plan
              </button>
            )}
          </>
        }
      >
        <p className="banner banner-info small" data-testid="rotate-blocked">
          „{planTitle(plan)}“ enthält bereits {used} Messung(en), Markierung(en) bzw. Zeichnungsobjekt(e). Damit deren Lage stimmt, lässt sich der Plan
          nicht mehr drehen.
        </p>
        <p className="muted small">Tipp: Ein neues, leeres Aufmaß mit demselben Plan anlegen und dieses drehen – das bestehende Aufmaß bleibt unverändert.</p>
      </Modal>
    );

  return (
    <Modal
      title="Plan drehen"
      onClose={onClose}
      testId="rotate-plan"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" onClick={save} data-testid="rotate-save">
            Übernehmen
          </button>
        </>
      }
    >
      <div className="rotate-preview">{file && <SourceThumb key={turn} file={file} pageIndex={plan.pageIndex} crop={preview.crop} rotation={preview.rotation} />}</div>
      <div className="row gap wrap center">
        <button type="button" className="btn" onClick={() => add(270)} data-testid="rotate-left">
          <Icon name="rotate" className="flip-x" /> Links drehen
        </button>
        <button type="button" className="btn" onClick={() => add(90)} data-testid="rotate-right">
          <Icon name="rotate" /> Rechts drehen
        </button>
      </div>
      <p className="muted small center-text" data-testid="rotate-state">
        {preview.rotation ? `Gedreht um ${preview.rotation}° gegenüber der Originaldatei` : 'Wie in der Originaldatei'} · Ausschnitt und Kalibrierung drehen mit.
      </p>
    </Modal>
  );
}
