import { useState } from 'react';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { toast } from './ui';
import { costCenterName } from '../lib/aufmass';
import { invoiceLabel } from '../lib/invoices';
import { putRecords } from '../lib/store';
import type { CostCenter, Invoice, Plan } from '../lib/types';

type Field = 'floor' | 'area' | 'description' | 'title';
const FIELDS: { k: Field; label: string; placeholder: string }[] = [
  { k: 'floor', label: 'Ebene / Geschoss', placeholder: 'z. B. UG2' },
  { k: 'area', label: 'Planbereich', placeholder: 'z. B. Achse A–F' },
  { k: 'title', label: 'Titel im PDF', placeholder: 'Aufmaßplan' },
  { k: 'description', label: 'Bemerkung', placeholder: '' },
];

/**
 * Angaben mehrerer Pläne gemeinsam ändern: nur geänderte Felder werden übernommen. Stimmt ein Feld bei allen Plänen
 * überein, steht der Wert schon drin (leeren = bei allen leeren); sonst „verschieden“ – leer lassen = unverändert.
 * Dazu Kostenstelle bzw. Rechnung wechseln (verschiebt die Pläne samt Messungen).
 */
export function BulkPlanDialog({ plans, costCenters, invoices, onClose }: { plans: Plan[]; costCenters: CostCenter[]; invoices: Invoice[]; onClose(): void }) {
  const common = (k: Field) => {
    const vals = new Set(plans.map((p) => (p[k] ?? '').trim()));
    return vals.size === 1 ? [...vals][0] : null;
  };
  const [v, setV] = useState<Record<Field, string>>(() => ({ floor: common('floor') ?? '', area: common('area') ?? '', title: common('title') ?? '', description: common('description') ?? '' }));
  const [touched, setTouched] = useState<Set<Field>>(() => new Set());
  const ccCommon = new Set(plans.map((p) => p.costCenterId)).size === 1 ? plans[0].costCenterId : '';
  const invCommon = new Set(plans.map((p) => p.invoiceId ?? '')).size === 1 ? (plans[0].invoiceId ?? '') : '';
  const [cc, setCc] = useState(ccCommon);
  const [inv, setInv] = useState(invCommon);

  const save = () => {
    const changed = plans
      .map((p) => {
        const next: Plan = { ...p };
        for (const k of touched) next[k] = v[k].trim();
        if (cc && cc !== p.costCenterId) next.costCenterId = cc;
        if (inv && inv !== (p.invoiceId ?? '')) next.invoiceId = inv;
        return next;
      })
      .filter((n, i) => JSON.stringify(n) !== JSON.stringify(plans[i]));
    if (changed.length) {
      putRecords({ plans: changed });
      toast(`${changed.length} ${changed.length === 1 ? 'Plan' : 'Pläne'} geändert.`, 'success');
    } else toast('Nichts geändert.', 'info', 1500);
    onClose();
  };

  return (
    <Modal
      title={`${plans.length} Pläne gemeinsam ändern`}
      onClose={onClose}
      testId="bulk-plan-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" onClick={save} data-testid="bulk-plan-save">
            <Icon name="check" size={18} /> Übernehmen
          </button>
        </>
      }
    >
      <form
        className="stack-fields"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <p className="muted small">Nur Felder, die du änderst, werden bei allen gewählten Plänen übernommen. Plannummer und Bezeichnung bleiben je Plan.</p>
        {FIELDS.map((f) => {
          const same = common(f.k);
          return (
            <label key={f.k} className="field">
              <span>{f.label}</span>
              <input
                value={v[f.k]}
                onChange={(e) => {
                  setV({ ...v, [f.k]: e.target.value });
                  setTouched(new Set(touched).add(f.k));
                }}
                placeholder={same === null ? 'verschieden – leer lassen = unverändert' : f.placeholder}
                autoComplete="off"
                data-testid={`bulk-plan-${f.k}`}
              />
            </label>
          );
        })}
        {costCenters.length > 1 && (
          <label className="field">
            <span>Kostenstelle</span>
            <select value={cc} onChange={(e) => setCc(e.target.value)} data-testid="bulk-plan-cc">
              {!ccCommon && <option value="">– verschieden, unverändert –</option>}
              {costCenters.map((c) => (
                <option key={c.id} value={c.id}>
                  {costCenterName(c)}
                </option>
              ))}
            </select>
          </label>
        )}
        {invoices.length > 0 && (
          <label className="field">
            <span>Rechnung</span>
            <select value={inv} onChange={(e) => setInv(e.target.value)} data-testid="bulk-plan-invoice">
              {!invCommon && <option value="">– verschieden, unverändert –</option>}
              {invoices.map((i) => (
                <option key={i.id} value={i.id}>
                  {invoiceLabel(i)}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
