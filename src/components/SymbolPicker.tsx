import { useState } from 'react';
import { SYMBOL_GROUPS, SYMBOLS, symbolGeometry, type SymbolGroup } from '../lib/symbols';
import { Modal } from './Modal';
import { customDialog } from './ui';

/** kleine Vorschau eines Symbols (SVG) */
export function SymbolPreview({ id, size = 44 }: { id: string; size?: number }) {
  const def = SYMBOLS.find((s) => s.id === id)!;
  const k = (size - 8) / Math.max(def.w, def.h);
  const w = def.w * k;
  const h = def.h * k;
  const geo = symbolGeometry({ id }, { type: 'rect', x: (size - w) / 2, y: (size - h) / 2, w, h });
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      {geo.lines.map((l, i) => (
        <path key={i} d={l.pts.map((p, j) => `${j ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('') + (l.closed ? 'Z' : '')} fill={l.fill ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={l.dashed ? 0.8 : 1.4} strokeDasharray={l.dashed ? '2 2' : undefined} />
      ))}
      {geo.texts.map((t, i) => (
        <text key={i} x={t.at.x} y={t.at.y} fontSize={Math.max(7, t.size)} textAnchor="middle" dominantBaseline="central" fill="currentColor" style={{ fontWeight: 700 }}>
          {t.text}
        </text>
      ))}
    </svg>
  );
}

function PickerView({ group, close }: { group: SymbolGroup; close(v: string | null): void }) {
  const [g, setG] = useState<SymbolGroup>(group);
  return (
    <Modal title="Bauteil einsetzen" onClose={() => close(null)} testId="symbol-picker" wide>
      <div className="segmented symbol-groups" role="tablist" aria-label="Gruppe">
        {SYMBOL_GROUPS.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={g === x.id} onClick={() => setG(x.id)} data-testid={`symbol-group-${x.id}`}>
            {x.label}
          </button>
        ))}
      </div>
      <div className="symbol-grid">
        {SYMBOLS.filter((s) => s.group === g).map((s) => (
          <button key={s.id} type="button" className="symbol-tile" onClick={() => close(s.id)} data-testid={`symbol-${s.id}`}>
            <SymbolPreview id={s.id} />
            <span>{s.label}</span>
          </button>
        ))}
      </div>
      <p className="muted small">Danach die Stelle im Plan antippen – auf einer Linie bzw. Wand richten sich Türen und Fenster daran aus. Breite (z. B. 0,9) bzw. Breite;Tiefe eintippen ändert die Größe.</p>
    </Modal>
  );
}

export const symbolPicker = (group: SymbolGroup) => customDialog<string>((close) => <PickerView group={group} close={close} />);
