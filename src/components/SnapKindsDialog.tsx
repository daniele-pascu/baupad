import { useState } from 'react';
import { OBJECT_SNAP_INFO, OBJECT_SNAPS, type SnapKind } from '../lib/snap';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { customDialog } from './ui';

/**
 * Objektfang-Arten: ein-/ausschalten und Vorrang festlegen (oben = gewinnt, wenn mehrere Fangpunkte im
 * Fangradius liegen). Die Einstellung gilt je Gerät.
 */
type Cfg = { order: SnapKind[]; enabled: SnapKind[] };

function SnapKindsView({ init, close }: { init: Cfg; close(v: Cfg | null): void }) {
  const [order, setOrder] = useState(init.order);
  const [enabled, setEnabled] = useState(init.enabled);
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    const o = [...order];
    [o[i], o[j]] = [o[j], o[i]];
    setOrder(o);
  };
  return (
    <Modal
      title="Fangarten"
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
          <button type="button" className="btn btn-primary" onClick={() => close({ order, enabled })} data-testid="snap-kinds-save">
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
    </Modal>
  );
}

export function snapKindsDialog(init: Cfg): Promise<Cfg | null> {
  return customDialog<Cfg>((close) => <SnapKindsView init={init} close={close} />);
}
