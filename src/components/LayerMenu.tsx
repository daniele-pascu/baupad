import { useEffect, useRef, useState } from 'react';
import { LAYERS, type LayerId } from '../lib/layers';
import { Icon } from './Icon';

/**
 * Ebenen ein-/ausblenden (Knopf in der Zoomleiste mit Auswahlliste). Wirkt auf Ansicht, Fang
 * und PDF des Plans; die Daten bleiben unverändert.
 */
export function LayerMenu({
  hidden,
  onChange,
  layers = LAYERS.map((l) => l.id),
  planColor,
}: {
  hidden: LayerId[];
  onChange(hidden: LayerId[]): void;
  layers?: LayerId[];
  /** importierte Pläne: Planunterlage farbig statt schwarz-weiß */
  planColor?: { on: boolean; onChange(on: boolean): void };
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  const off = hidden.filter((h) => layers.includes(h)).length;
  return (
    <div className="layer-menu" ref={ref}>
      <button
        type="button"
        className={`icon-btn${off ? ' active-toggle' : ''}`}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label="Ebenen"
        title={off ? `Ebenen – ${off} ausgeblendet` : 'Ebenen ein-/ausblenden'}
        data-testid="layers-toggle"
      >
        <Icon name="layers" />
      </button>
      {open && (
        <div className="layer-pop" role="group" aria-label="Ebenen" data-testid="layers-pop">
          <div className="pop-title">Ebenen anzeigen</div>
          {LAYERS.filter((l) => layers.includes(l.id)).map((l) => (
            <label key={l.id} className="check-row" title={l.hint}>
              <input
                type="checkbox"
                checked={!hidden.includes(l.id)}
                onChange={(e) => onChange(e.target.checked ? hidden.filter((h) => h !== l.id) : [...hidden, l.id])}
                data-testid={`layer-${l.id}`}
              />
              <span>{l.label}</span>
            </label>
          ))}
          <p className="small muted">Ausgeblendete Ebenen erscheinen nicht im PDF und lassen sich nicht bearbeiten.</p>
          {planColor && (
            <>
              <div className="pop-title">Planunterlage</div>
              <label className="check-row" title="Standard: schwarz-weiß – farbige Markierungen sind besser zu sehen (Ansicht und PDF)">
                <input type="checkbox" checked={planColor.on} onChange={(e) => planColor.onChange(e.target.checked)} data-testid="plan-color" />
                <span>Plan farbig anzeigen</span>
              </label>
            </>
          )}
        </div>
      )}
    </div>
  );
}
