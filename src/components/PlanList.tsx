import { isDrawingPlan } from '../lib/drawing';
import { damagesOf, positionsOfPlan, sumArea } from '../lib/aufmass';
import { formatArea } from '../lib/numbers';
import { navigate, paths } from '../lib/router';
import type { ProjectState } from '../lib/store';
import type { Plan } from '../lib/types';
import { ActionMenu } from './ActionMenu';

interface Props {
  data: ProjectState;
  plans: Plan[];
  onEdit: (plan: Plan) => void;
  onRename: (plan: Plan) => void;
  onCrop: (plan: Plan) => void;
  /** Neues, leeres Aufmaß mit derselben Planunterlage */
  onReuse: (plan: Plan) => void;
  onDelete: (plan: Plan) => void;
}

/**
 * Kompakte Planliste: eine Zeile je Plan mit Plannummer, Bezeichnung/Ebene, Bemerkung,
 * Leistungszuordnung, Anzahl der Messungen und Flächensumme. Auf dem Smartphone werden
 * die Angaben zweizeilig unter der Plannummer angeordnet.
 */
export function PlanList({ data, plans, onEdit, onRename, onCrop, onReuse, onDelete }: Props) {
  return (
    <div className="plan-list" role="table" aria-label="Pläne" data-testid="plan-list">
      <div className="plan-row plan-head" role="row">
        <span role="columnheader">Plannr.</span>
        <span role="columnheader">Bezeichnung / Ebene</span>
        <span role="columnheader">Bemerkung</span>
        <span role="columnheader">Leistungen</span>
        <span role="columnheader" className="num">
          Messungen
        </span>
        <span role="columnheader" className="num">
          Fläche
        </span>
        <span role="columnheader">
          <span className="sr-only">Aktionen</span>
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
            onClick={(e) => {
              // Klick auf die Zeile öffnet den Plan (außer auf Schaltflächen/Links)
              if ((e.target as Element).closest('a, button')) return;
              navigate(href);
            }}
          >
            <span role="cell" className="pl-number">
              <a href={href} data-testid="plan-open">
                {title}
              </a>
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
            <span role="cell" className="pl-count num" data-testid="plan-count">
              {damages.length}
              <span className="pl-unit"> Messung{damages.length === 1 ? '' : 'en'}</span>
            </span>
            <span role="cell" className="pl-area num" data-testid="plan-area">
              {damages.length ? `${formatArea(sumArea(damages))} m²` : <span className="muted">–</span>}
            </span>
            <span role="cell" className="pl-actions">
              <ActionMenu
                label={`Aktionen für Plan ${title}`}
                testId="plan-actions"
                actions={[
                  { label: 'Öffnen', icon: 'map', onSelect: () => navigate(href), testId: 'action-open' },
                  { label: 'Angaben bearbeiten', icon: 'edit', onSelect: () => onEdit(plan), testId: 'action-edit' },
                  { label: 'Umbenennen', icon: 'hash', onSelect: () => onRename(plan), testId: 'action-rename' },
                  ...(isDrawingPlan(plan) || !data.files[plan.fileId]
                    ? []
                    : [
                        { label: 'Ausschnitt', icon: 'crop', onSelect: () => onCrop(plan), testId: 'action-crop' },
                        { label: 'Neues Aufmaß mit diesem Plan', icon: 'copy', onSelect: () => onReuse(plan), testId: 'action-reuse' },
                      ]),
                  { label: 'Löschen', icon: 'trash', onSelect: () => onDelete(plan), danger: true, testId: 'action-delete' },
                ]}
              />
            </span>
          </div>
        );
      })}
    </div>
  );
}
