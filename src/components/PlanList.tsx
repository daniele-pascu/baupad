import { isDrawingPlan } from '../lib/drawing';
import { damagesOf, positionsOfPlan, sumArea } from '../lib/aufmass';
import { formatArea } from '../lib/numbers';
import { navigate, paths } from '../lib/router';
import type { ProjectState } from '../lib/store';
import type { Plan } from '../lib/types';
import { ActionMenu } from './ActionMenu';
import { SelectBox, type Selection } from './Selection';

interface Props {
  data: ProjectState;
  plans: Plan[];
  onEdit: (plan: Plan) => void;
  onRename: (plan: Plan) => void;
  onCrop: (plan: Plan) => void;
  /** Neues, leeres Aufmaß mit derselben Planunterlage */
  onReuse: (plan: Plan) => void;
  /** Aufmaßplan samt Messungen kopieren */
  onDuplicate: (plan: Plan) => void;
  /** Planunterlage drehen */
  onRotate: (plan: Plan) => void;
  onDelete: (plan: Plan) => void;
  /** Plan als PDF herunterladen (Auswahl-Dialog mit diesem Plan) */
  onPdf?: (plan: Plan) => void;
  /** Mehrfachauswahl: im Auswahlmodus wählt die Zeile aus (statt zu öffnen), Kästchen statt Menü */
  sel?: Selection;
}

/**
 * Kompakte Planliste: eine Zeile je Plan mit Plannummer, Bezeichnung/Ebene, Bemerkung,
 * Leistungszuordnung und Flächensumme (ohne Anzahl der Messungen). Auf dem Smartphone werden
 * die Angaben zweizeilig unter der Plannummer angeordnet.
 */
export function PlanList({ data, plans, onEdit, onRename, onCrop, onReuse, onDuplicate, onRotate, onDelete, onPdf, sel }: Props) {
  const selecting = !!sel?.active;
  return (
    <div className={`plan-list${selecting ? ' selecting' : ''}`} role="table" aria-label="Pläne" data-testid="plan-list">
      <div className="plan-row plan-head" role="row">
        <span role="columnheader">Plannr.</span>
        <span role="columnheader">Bezeichnung / Ebene</span>
        <span role="columnheader">Bemerkung</span>
        <span role="columnheader">Leistungen</span>
        <span role="columnheader" className="num">
          Fläche
        </span>
        <span role="columnheader">
          <span className="sr-only">{selecting ? 'Auswahl' : 'Aktionen'}</span>
        </span>
      </div>
      {plans.map((plan) => {
        const damages = damagesOf(data, plan.id);
        const services = positionsOfPlan(data, plan.id);
        const href = paths.plan(data.project.id, plan.id);
        const title = plan.planNumber || plan.planName || 'Ohne Nummer';
        return (
          <div
            key={plan.id}
            className="plan-row"
            role="row"
            data-testid="plan-row"
            data-plan={plan.planNumber}
            data-selected={selecting ? sel!.has(plan.id) : undefined}
            onClick={(e) => {
              // Auswahlmodus: Zeile antippen wählt aus
              if (selecting) {
                if (!(e.target as Element).closest('input')) sel!.toggle(plan.id);
                return;
              }
              // Klick auf die Zeile öffnet den Plan (außer auf Schaltflächen/Links)
              if ((e.target as Element).closest('a, button')) return;
              navigate(href);
            }}
          >
            <span role="cell" className="pl-number">
              {selecting ? (
                <strong>{title}</strong>
              ) : (
                <a href={href} data-testid="plan-open">
                  {title}
                </a>
              )}
            </span>
            <span role="cell" className="pl-name">
              {plan.planName || <span className="muted">–</span>}
              {plan.floor && <span className="pl-floor">{plan.floor}</span>}
            </span>
            <span role="cell" className="pl-note" data-testid="plan-note">
              {plan.description || <span className="muted pl-empty">–</span>}
            </span>
            <span role="cell" className={`pl-services${services.length ? '' : ' muted'}`} data-testid="plan-services">
              {services.length
                ? services.map(({ pos }) => (
                    <span key={pos.id} className="pl-service" title={pos.shortText}>
                      {pos.number} {pos.shortText}
                    </span>
                  ))
                : 'Keine Leistungszuordnung'}
            </span>
            <span role="cell" className="pl-area num" data-testid="plan-area">
              {damages.length ? `${formatArea(sumArea(damages))} m²` : <span className="muted">–</span>}
            </span>
            <span role="cell" className="pl-actions">
              {selecting ? (
                <SelectBox sel={sel!} id={plan.id} label={`Plan ${title}`} testId="plan-select" />
              ) : (
              <ActionMenu
                label={`Aktionen für Plan ${title}`}
                testId="plan-actions"
                actions={[
                  { label: 'Öffnen', icon: 'map', onSelect: () => navigate(href), testId: 'action-open' },
                  ...(onPdf ? [{ label: 'Als PDF herunterladen', icon: 'pdf' as const, onSelect: () => onPdf(plan), testId: 'action-pdf' }] : []),
                  { label: 'Angaben bearbeiten', icon: 'edit', onSelect: () => onEdit(plan), testId: 'action-edit' },
                  { label: 'Umbenennen', icon: 'hash', onSelect: () => onRename(plan), testId: 'action-rename' },
                  { label: 'Duplizieren (mit Messungen)', icon: 'copy', onSelect: () => onDuplicate(plan), testId: 'action-duplicate' },
                  ...(isDrawingPlan(plan) || !data.files[plan.fileId]
                    ? []
                    : [
                        { label: 'Ausschnitt', icon: 'crop', onSelect: () => onCrop(plan), testId: 'action-crop' },
                        { label: 'Drehen', icon: 'rotate', onSelect: () => onRotate(plan), testId: 'action-rotate' },
                        { label: 'Neues Aufmaß mit diesem Plan', icon: 'copy', onSelect: () => onReuse(plan), testId: 'action-reuse' },
                      ]),
                  { label: 'Löschen', icon: 'trash', onSelect: () => onDelete(plan), danger: true, testId: 'action-delete' },
                ]}
              />
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
