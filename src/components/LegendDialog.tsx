import { useId, useState } from 'react';
import { Modal } from './Modal';
import { colorName, legendSampleShape, legendLineWidth, type LegendEntry } from '../lib/legend';
import { DEFAULT_TRANSPARENCY, fillOf, fillPaths, strokeGeometry } from '../lib/style';
import type { Point } from '../lib/geometry';
import type { LegendPos } from '../lib/types';

/** Muster eines Legenden-Eintrags wie im Plan: Linie (Stärke, Strichart), Fläche (Rand, Füllung, Schraffur) bzw. Punkte */
export function LegendSwatch({ entry, w = 30, h = 18 }: { entry: Pick<LegendEntry, 'color' | 'sample' | 'style'>; w?: number; h?: number }) {
  const clip = useId();
  const k = 1.4; // Bildschirm-Pixel je Punkt im Muster
  const map = (p: Point) => ({ x: p.x * k, y: p.y * k });
  const shape = legendSampleShape(entry.sample, w / k, h / k);
  if (entry.sample === 'points')
    return (
      <svg className="legend-sample" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
        {[0.25, 0.5, 0.75].map((f) => (
          <circle key={f} cx={w * f} cy={h / 2} r={3} fill={entry.color} stroke="#fff" strokeWidth={1} />
        ))}
      </svg>
    );
  const width = legendLineWidth(entry) * k;
  const fill = fillOf(shape, entry.color, entry.style, DEFAULT_TRANSPARENCY.damage);
  const f = fill && fill.opacity > 0 ? fillPaths(shape, map, fill, k) : null;
  const line = strokeGeometry(shape, map, entry.style?.lineType, width, width, entry.style?.dashScale);
  const lineOpacity = 1 - Math.min(100, Math.max(0, entry.style?.lineTransparency ?? 0)) / 100;
  return (
    <svg className="legend-sample" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      {f?.clip && (
        <clipPath id={clip}>
          <path d={f.clip} />
        </clipPath>
      )}
      {f?.bg && fill?.bg && <path d={f.bg} fill={fill.bg} />}
      {f?.solid && <path d={f.solid} fill={fill!.color} fillOpacity={fill!.opacity} />}
      {f?.hatchFill && <path d={f.hatchFill} fill={fill!.color} fillOpacity={fill!.opacity} clipPath={`url(#${clip})`} />}
      {f?.hatch && <path d={f.hatch} fill="none" stroke={fill!.color} strokeWidth={f.hatchWidth} strokeOpacity={fill!.opacity} strokeLinecap="round" />}
      {f?.hatchDots && <path d={f.hatchDots} fill="none" stroke={fill!.color} strokeWidth={f.dotWidth} strokeOpacity={fill!.opacity} strokeLinecap="round" />}
      <path d={line.d} fill="none" stroke={entry.color} strokeWidth={width} strokeOpacity={lineOpacity} strokeDasharray={line.dash?.join(' ')} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const POS: { id: LegendPos; label: string }[] = [
  { id: 'tl', label: 'Oben links' },
  { id: 'tr', label: 'Oben rechts' },
  { id: 'bl', label: 'Unten links' },
  { id: 'br', label: 'Unten rechts' },
];

/** Farblegende des Plans: je erkannter Farbe eine eigene Bezeichnung; im PDF anzeigen – nur für diesen Plan */
export function LegendDialog({
  entries,
  show,
  labels,
  pos: initialPos,
  onClose,
  onSave,
}: {
  entries: LegendEntry[];
  show: boolean;
  labels: Record<string, string>;
  pos: LegendPos;
  onClose(): void;
  onSave(show: boolean, labels: Record<string, string>, pos: LegendPos): void;
}) {
  const [pos, setPos] = useState<LegendPos>(initialPos);
  // zeigt genau, was im PDF gilt (Schließen ohne Speichern ändert nichts)
  const [on, setOn] = useState(show);
  const [txt, setTxt] = useState<Record<string, string>>(() => Object.fromEntries(entries.map((e) => [e.key, labels[e.key] ?? labels[e.color] ?? ''])));
  return (
    <Modal
      title="Farblegende"
      onClose={onClose}
      testId="legend-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              // bestehende Bezeichnungen anderer Farben bleiben erhalten
              const next = { ...labels };
              for (const [key, t] of Object.entries(txt)) {
                if (t.trim()) next[key] = t.trim();
                else delete next[key];
              }
              onSave(on, next, pos);
            }}
            data-testid="legend-save"
          >
            Speichern
          </button>
        </>
      }
    >
      {entries.length === 0 ? (
        <p className="muted">Noch keine Messungen im Plan – die Farben werden erkannt, sobald gemessen wurde.</p>
      ) : (
        <div className="legend-rows">
          {entries.map((e) => (
            <label key={e.key} className="legend-row" data-testid="legend-row" data-color={e.color} data-sample={e.sample}>
              <LegendSwatch entry={e} />
              <input value={txt[e.key] ?? ''} onChange={(ev) => setTxt((p) => ({ ...p, [e.key]: ev.target.value }))} placeholder={colorName(e.color)} aria-label={`Bezeichnung für ${colorName(e.color)}`} data-testid="legend-input" />
              <span className="muted small">{e.count}×</span>
            </label>
          ))}
        </div>
      )}
      <label className="check-row">
        <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} data-testid="legend-show" />
        <span>Legende im PDF dieses Plans anzeigen</span>
      </label>
      <p className="muted small">Gilt nur für diesen Plan – andere Pläne haben ihre eigene Legende.</p>
      <div className="field">
        <span>Lage im PDF</span>
        <div className="legend-pos" role="radiogroup" aria-label="Lage der Legende">
          {POS.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={pos === p.id} className={`chip${pos === p.id ? ' active' : ''}`} onClick={() => setPos(p.id)} data-testid={`legend-pos-${p.id}`}>
              {p.label}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

/** Legende unten links über dem Plan (Antippen öffnet die Bearbeitung) */
export function LegendBox({ entries, pos = 'bl', onOpen }: { entries: LegendEntry[]; pos?: LegendPos; onOpen(): void }) {
  if (!entries.length) return null;
  return (
    <button type="button" className={`plan-legend pos-${pos}`} data-pos={pos} onClick={onOpen} title="Legende bearbeiten" data-testid="plan-legend">
      <strong>Legende</strong>
      {entries.map((e) => (
        <span key={e.key} className="plan-legend-row">
          <LegendSwatch entry={e} w={22} h={13} />
          <span>{e.label}</span>
        </span>
      ))}
    </button>
  );
}
