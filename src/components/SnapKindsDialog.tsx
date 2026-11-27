import { useState } from 'react';
import { CAD_UNITS, type CadUnit } from '../lib/cad-input';
import { OBJECT_SNAP_INFO, OBJECT_SNAPS, type SnapKind } from '../lib/snap';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { customDialog } from './ui';

/**
 * Objektfang-Arten: ein-/ausschalten und Vorrang festlegen (oben = gewinnt, wenn mehrere Fangpunkte im
 * Fangradius liegen). Die Einstellung gilt je Gerät.
 */
type Cfg = { order: SnapKind[]; enabled: SnapKind[]; dwell: number; unit: CadUnit };
const UNIT_TEXT: Record<CadUnit, string> = { m: 'Meter (z. B. 0,25)', cm: 'Zentimeter (z. B. 25)', mm: 'Millimeter (z. B. 250)' };

function SnapKindsView({ init, close }: { init: Cfg; close(v: Cfg | null): void }) {
  const [order, setOrder] = useState(init.order);
  const [enabled, setEnabled] = useState(init.enabled);
  const [dwell, setDwell] = useState(String(init.dwell));
  const [unit, setUnit] = useState(init.unit);
  const dwellMs = () => {
    const n = Math.round(Number(dwell.replace(',', '.')));
    return Number.isFinite(n) ? Math.min(2000, Math.max(0, n)) : init.dwell;
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    const o = [...order];
    [o[i], o[j]] = [o[j], o[i]];
    setOrder(o);
  };
  return (
    <Modal
      title="Fangarten und Eingabe"
      onClose={() => close(null)}
      testId="snap-kinds-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={() => (setOrder(OBJECT_SNAPS), setEnabled(OBJECT_SNAPS))} data-testid="snap-kinds-reset">
            Standard
          </button>
          <button type="button" className="btn" onClick={() => close(null)}>
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" onClick={() => close({ order, enabled, dwell: dwellMs(), unit })} data-testid="snap-kinds-save">
            Übernehmen
          </button>
        </>
      }
    >
      <p className="small muted">Oben stehende Fangarten haben Vorrang, wenn mehrere Fangpunkte nah beieinander liegen.</p>
      <ol className="snap-kinds" data-testid="snap-kinds">
        {order.map((k, i) => (
          <li key={k} className="snap-kind-row" data-kind={k}>
            <label className="check-row">
              <input type="checkbox" checked={enabled.includes(k)} onChange={(e) => setEnabled(e.target.checked ? [...enabled, k] : enabled.filter((x) => x !== k))} data-testid={`snap-kind-${k}`} />
              <span>{OBJECT_SNAP_INFO[k]}</span>
            </label>
            <span className="snap-kind-move">
              <button type="button" className="icon-btn icon-btn-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Vorrang erhöhen" data-testid={`snap-kind-up-${k}`}>
                <Icon name="up" size={18} />
              </button>
              <button type="button" className="icon-btn icon-btn-sm" disabled={i === order.length - 1} onClick={() => move(i, 1)} aria-label="Vorrang senken" data-testid={`snap-kind-down-${k}`}>
                <Icon name="down" size={18} />
              </button>
            </span>
          </li>
        ))}
      </ol>
      <div className="snap-extra">
        <label className="field">
          <span>Spurpunkt merken nach (ms)</span>
          <input type="number" inputMode="numeric" min={0} max={2000} step={50} value={dwell} onChange={(e) => setDwell(e.target.value)} data-testid="snap-dwell" />
          <small className="muted">So lange muss der Zeiger auf einem Punkt stehen, bis die Spurlinie daran hängt (0 = sofort).</small>
        </label>
        <label className="field">
          <span>Maße eintippen in</span>
          <select value={unit} onChange={(e) => setUnit(e.target.value as CadUnit)} data-testid="snap-unit">
            {CAD_UNITS.map((u) => (
              <option key={u} value={u}>
                {UNIT_TEXT[u]}
              </option>
            ))}
          </select>
        </label>
      </div>
    </Modal>
  );
}

export function snapKindsDialog(init: Cfg): Promise<Cfg | null> {
  return customDialog<Cfg>((close) => <SnapKindsView init={init} close={close} />);
}
