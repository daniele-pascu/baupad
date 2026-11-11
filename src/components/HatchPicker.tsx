import { useState } from 'react';
import { DEFAULT_HATCH, HATCH_PATTERNS, hatchGeometry, hatchSvg, MATERIALS } from '../lib/style';
import { DRAW_COLORS, type HatchPattern, type ShapeStyle } from '../lib/types';
import { rememberCustomColorSoon, useCustomColors } from '../lib/custom-colors';
import { Modal } from './Modal';
import { customDialog } from './ui';

/**
 * Schraffur wählen: Muster bzw. Baustoff (ÖNORM A 6240) als Kacheln mit Vorschau, Winkel, Abstand, Schraffurfarbe und
 * Flächenfarbe dahinter. Verwendet vom Werkzeug „Schraffur“ (danach in eine Fläche tippen) und in den Eigenschaften.
 */
export interface HatchSetting {
  hatch: { pattern: HatchPattern; angle: number; spacing: number };
  color: string;
  /** Flächenfarbe hinter der Schraffur; fehlt = keine */
  bg?: string;
  /** Schraffur entfernen (keine Füllung) */
  none?: boolean;
}

export const DEFAULT_HATCH_SETTING: HatchSetting = { hatch: { ...DEFAULT_HATCH }, color: '#1c1c1e' };

/** Stil-Änderung für ein Objekt aus der Auswahl */
export function hatchStyle(s: HatchSetting): Partial<ShapeStyle> {
  if (s.none) return { noFill: true };
  return { noFill: false, fillType: 'hatch', hatch: { ...s.hatch }, fillColor: s.color, fillTransparency: 0, hatchBg: s.bg };
}

/** Auswahl aus einem bestehenden Stil (zum Bearbeiten) */
export function settingFromStyle(style: ShapeStyle | undefined, color: string): HatchSetting {
  return { hatch: { ...(style?.hatch ?? DEFAULT_HATCH) }, color: style?.fillColor ?? color, ...(style?.hatchBg ? { bg: style.hatchBg } : {}) };
}

/** Bezeichnung: Baustoff, wenn Muster/Winkel/Abstand/Farbe genau passen, sonst das Muster */
export function hatchLabel(s: HatchSetting): string {
  if (s.none) return 'Keine';
  const m = materialOf(s);
  return m?.label ?? HATCH_PATTERNS.find((p) => p.id === s.hatch.pattern)?.label ?? s.hatch.pattern;
}
const materialOf = (s: HatchSetting) => MATERIALS.find((x) => x.pattern === s.hatch.pattern && x.angle === s.hatch.angle && x.spacing === s.hatch.spacing && x.color === s.color.toLowerCase());

/** kleine Vorschau einer Schraffur (SVG) */
export function HatchPreview({ s, w = 64, h = 40 }: { s: HatchSetting; w?: number; h?: number }) {
  const poly = [
    { x: 1, y: 1 },
    { x: w - 1, y: 1 },
    { x: w - 1, y: h - 1 },
    { x: 1, y: h - 1 },
  ];
  const geo = s.none ? { segments: [], dots: [] } : hatchGeometry(poly, s.hatch.pattern, s.hatch.angle, Math.max(2, s.hatch.spacing) * 1.1);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className="hatch-preview">
      <rect x={1} y={1} width={w - 2} height={h - 2} fill={s.bg ?? '#ffffff'} stroke="#868e96" strokeWidth={1} />
      <path d={hatchSvg(geo)} fill="none" stroke={s.color} strokeWidth={s.hatch.pattern === 'dots' ? 1.6 : 0.9} strokeLinecap="round" />
      {s.none && <path d={`M4 ${h - 4}L${w - 4} 4`} stroke="#e03131" strokeWidth={1.5} />}
    </svg>
  );
}

function HatchPickerView({ init, title, allowNone, close }: { init: HatchSetting; title: string; allowNone: boolean; close(v: HatchSetting | null): void }) {
  const [s, setS] = useState<HatchSetting>({ ...init, none: false });
  const [tab, setTab] = useState<'pattern' | 'material'>(() => (materialOf(init) ? 'material' : 'pattern'));
  const custom = useCustomColors();
  const tiles: { key: string; label: string; set: HatchSetting }[] = [
    ...HATCH_PATTERNS.map((p) => ({ key: p.id, label: p.label, set: { ...s, none: false, hatch: { ...s.hatch, pattern: p.id } } })),
  ];
  const mats = MATERIALS.map((m) => ({ key: `mat:${m.id}`, label: m.label, set: { ...s, none: false, color: m.color, hatch: { pattern: m.pattern, angle: m.angle, spacing: m.spacing } } }));
  const current = materialOf(s) ? `mat:${materialOf(s)!.id}` : s.hatch.pattern;
  const tile = (t: { key: string; label: string; set: HatchSetting }) => (
    <button key={t.key} type="button" className={`hatch-tile${current === t.key ? ' active' : ''}`} aria-pressed={current === t.key} onClick={() => setS(t.set)} title={t.label} data-testid={`hatch-tile-${t.key}`}>
      <HatchPreview s={t.set} />
      <span className="small">{t.label}</span>
    </button>
  );
  return (
    <Modal
      title={title}
      onClose={() => close(null)}
      testId="hatch-picker"
      footer={
        <>
          {allowNone && (
            <button type="button" className="btn btn-danger-text mr-auto" onClick={() => close({ ...s, none: true })} data-testid="hatch-none">
              Schraffur entfernen
            </button>
          )}
          <button type="button" className="btn" onClick={() => close(null)}>
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" onClick={() => close(s)} data-testid="hatch-ok">
            Übernehmen
          </button>
        </>
      }
    >
      <div className="hatch-current" data-testid="hatch-current">
        <HatchPreview s={s} w={96} h={56} />
        <strong>{hatchLabel(s)}</strong>
      </div>
      <div className="segmented hatch-tabs" role="tablist" aria-label="Auswahl">
        <button type="button" role="tab" aria-selected={tab === 'pattern'} onClick={() => setTab('pattern')} data-testid="hatch-tab-pattern">
          Muster
        </button>
        <button type="button" role="tab" aria-selected={tab === 'material'} onClick={() => setTab('material')} data-testid="hatch-tab-material">
          Baustoffe (ÖNORM)
        </button>
      </div>
      <div className="hatch-grid" data-testid="hatch-grid">{(tab === 'pattern' ? tiles : mats).map(tile)}</div>
      <div className="hatch-opts">
        <label className="field">
          <span>Winkel</span>
          <select value={s.hatch.angle} onChange={(e) => setS({ ...s, hatch: { ...s.hatch, angle: Number(e.target.value) } })} data-testid="hatch-angle">
            {[0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165].map((a) => (
              <option key={a} value={a}>
                {a}°
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Abstand ({s.hatch.spacing} pt)</span>
          <input type="range" min={2} max={20} step={1} value={s.hatch.spacing} onChange={(e) => setS({ ...s, hatch: { ...s.hatch, spacing: Number(e.target.value) } })} data-testid="hatch-spacing" />
        </label>
      </div>
      <div className="field">
        <span>Schraffurfarbe</span>
        <span className="hatch-colors" role="group" aria-label="Schraffurfarbe">
          {[...DRAW_COLORS, ...custom.map((c) => ({ value: c, name: `Eigene Farbe ${c}` }))].map((c) => (
            <button key={c.value} type="button" className={`swatch${s.color.toLowerCase() === c.value ? ' active' : ''}`} style={{ background: c.value }} onClick={() => setS({ ...s, color: c.value })} aria-label={`Schraffurfarbe ${c.name}`} aria-pressed={s.color.toLowerCase() === c.value} data-testid={`hatch-color-${c.value}`} />
          ))}
          <input type="color" value={s.color} onChange={(e) => (setS({ ...s, color: e.target.value }), rememberCustomColorSoon(e.target.value, DRAW_COLORS.map((c) => c.value)))} aria-label="Schraffurfarbe frei wählen" data-testid="hatch-color-free" />
        </span>
      </div>
      <div className="field">
        <span>Fläche dahinter</span>
        <span className="hatch-colors" role="group" aria-label="Flächenfarbe">
          <button type="button" className={`btn btn-sm${!s.bg ? ' active' : ''}`} aria-pressed={!s.bg} onClick={() => setS({ ...s, bg: undefined })} data-testid="hatch-bg-off">
            Keine
          </button>
          {[...DRAW_COLORS, ...custom.map((c) => ({ value: c, name: `Eigene Farbe ${c}` }))].map((c) => (
            <button key={c.value} type="button" className={`swatch${s.bg?.toLowerCase() === c.value ? ' active' : ''}`} style={{ background: c.value }} onClick={() => setS({ ...s, bg: c.value })} aria-label={`Flächenfarbe ${c.name}`} aria-pressed={s.bg?.toLowerCase() === c.value} data-testid={`hatch-bg-${c.value}`} />
          ))}
        </span>
      </div>
    </Modal>
  );
}

export function hatchPicker(init: HatchSetting, opts: { title?: string; allowNone?: boolean } = {}): Promise<HatchSetting | null> {
  return customDialog<HatchSetting>((close) => <HatchPickerView init={init} title={opts.title ?? 'Schraffur wählen'} allowNone={!!opts.allowNone} close={close} />);
}
