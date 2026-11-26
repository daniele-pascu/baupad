import { Fragment, useId, useState } from 'react';
import { DEFAULT_HATCH, HATCH_PATTERNS, HATCH_SPACING_MAX, HATCH_SPACING_MIN, hatchDotsSvg, hatchFillSvg, hatchGeometry, hatchName, hatchSvg, isLegacyHatch, NEW_HATCH } from '../lib/style';
import { DIN_GROUPS } from '../lib/hatch-din';
import { DRAW_COLORS, type HatchPattern, type ShapeStyle } from '../lib/types';
import { useCustomColors } from '../lib/custom-colors';
import { Modal } from './Modal';
import { customDialog } from './ui';
import { MoreColors } from './ColorPicker';

/**
 * Schraffur wählen: Katalog nach DIN ISO 128-50 (schwarz-weiß) als Kacheln mit Vorschau, dazu Winkel (dreht das Muster),
 * Abstand, Schraffurfarbe und Flächenfarbe dahinter. Verwendet vom Werkzeug „Schraffur“ (danach in eine Fläche tippen)
 * und in den Eigenschaften.
 */
export interface HatchSetting {
  hatch: { pattern: HatchPattern; angle: number; spacing: number };
  color: string;
  /** Flächenfarbe hinter der Schraffur; fehlt = keine */
  bg?: string;
  /** Schraffur entfernen (keine Füllung) */
  none?: boolean;
  /** Vollfläche statt Schraffur */
  solid?: boolean;
}

const BLACK = '#1c1c1e';
export const DEFAULT_HATCH_SETTING: HatchSetting = { hatch: { ...NEW_HATCH }, color: BLACK };

/** Stil-Änderung für ein Objekt aus der Auswahl */
export function hatchStyle(s: HatchSetting): Partial<ShapeStyle> {
  if (s.none) return { noFill: true };
  if (s.solid) return { noFill: false, fillType: 'solid', fillColor: s.color, fillTransparency: 0, hatchBg: undefined };
  return { noFill: false, fillType: 'hatch', hatch: { ...s.hatch }, fillColor: s.color, fillTransparency: 0, hatchBg: s.bg };
}

/** Auswahl aus einem bestehenden Stil (zum Bearbeiten) */
export function settingFromStyle(style: ShapeStyle | undefined, color: string): HatchSetting {
  if (style && !style.noFill && style.fillType !== 'hatch' && style.fillColor) return { hatch: { ...(style.hatch ?? DEFAULT_HATCH) }, color: style.fillColor, solid: true };
  return { hatch: { ...(style?.hatch ?? DEFAULT_HATCH) }, color: style?.fillColor ?? color, ...(style?.hatchBg ? { bg: style.hatchBg } : {}) };
}

/** Bezeichnung der Schraffur (Kurzzeichen und Name der Norm) */
export function hatchLabel(s: HatchSetting): string {
  if (s.none) return 'Keine';
  if (s.solid) return 'Vollfläche';
  return hatchName(s.hatch.pattern);
}

/** kleine Vorschau einer Schraffur (SVG) */
export function HatchPreview({ s, w = 64, h = 40 }: { s: HatchSetting; w?: number; h?: number }) {
  const clipId = useId();
  const poly = [
    { x: 1, y: 1 },
    { x: w - 1, y: 1 },
    { x: w - 1, y: h - 1 },
    { x: 1, y: h - 1 },
  ];
  const din = !isLegacyHatch(s.hatch.pattern);
  const geo = s.none || s.solid ? { segments: [], dots: [], fills: [] } : hatchGeometry(poly, s.hatch.pattern, s.hatch.angle, Math.max(1.6, s.hatch.spacing) * 1.1);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className="hatch-preview">
      <clipPath id={clipId}>
        <rect x={1} y={1} width={w - 2} height={h - 2} />
      </clipPath>
      <rect x={1} y={1} width={w - 2} height={h - 2} fill={s.solid ? s.color : (s.bg ?? '#ffffff')} stroke="#868e96" strokeWidth={1} />
      {geo.fills.length > 0 && <path d={hatchFillSvg(geo)} fill={s.color} stroke="none" clipPath={`url(#${clipId})`} />}
      <path d={hatchSvg({ segments: geo.segments, dots: din ? [] : geo.dots })} fill="none" stroke={s.color} strokeWidth={s.hatch.pattern === 'dots' ? 1.6 : 0.9} strokeLinecap="round" />
      {din && geo.dots.length > 0 && <path d={hatchDotsSvg(geo)} fill="none" stroke={s.color} strokeWidth={1.7} strokeLinecap="round" />}
      {s.none && <path d={`M4 ${h - 4}L${w - 4} 4`} stroke="#e03131" strokeWidth={1.5} />}
    </svg>
  );
}

function HatchPickerView({ init, title, allowNone, close }: { init: HatchSetting; title: string; allowNone: boolean; close(v: HatchSetting | null): void }) {
  const [s, setS] = useState<HatchSetting>({ ...init, none: false });
  const custom = useCustomColors();
  /** Schraffur aus dem Katalog wählen; von einem früheren Muster kommend gelten die Vorgaben der Norm (Winkel 0) */
  const pick = (pattern: HatchPattern) => setS({ ...s, none: false, solid: false, hatch: isLegacyHatch(s.hatch.pattern) ? { ...NEW_HATCH, pattern } : { ...s.hatch, pattern } });
  const tileSet = (pattern: HatchPattern): HatchSetting => ({ ...s, none: false, solid: false, hatch: { pattern, angle: isLegacyHatch(s.hatch.pattern) ? 0 : s.hatch.angle, spacing: isLegacyHatch(s.hatch.pattern) ? NEW_HATCH.spacing : s.hatch.spacing } });
  const current = s.solid ? null : s.hatch.pattern;
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
      {!s.solid && isLegacyHatch(s.hatch.pattern) && (
        <p className="small muted" data-testid="hatch-legacy">
          Diese Fläche hat noch ein bisheriges Muster – es bleibt, bis hier eine Schraffur aus dem Katalog gewählt wird.
        </p>
      )}
      <div className="hatch-grid" data-testid="hatch-grid">
        {DIN_GROUPS.map((g) => (
          <Fragment key={g.id}>
            <span className="hatch-group small" role="heading" aria-level={3}>
              {g.label}
            </span>
            {HATCH_PATTERNS.filter((p) => p.group === g.id).map((p) => (
              <button key={p.id} type="button" className={`hatch-tile${current === p.id ? ' active' : ''}`} aria-pressed={current === p.id} onClick={() => pick(p.id)} title={p.label} data-testid={`hatch-tile-${p.id}`}>
                <HatchPreview s={tileSet(p.id)} />
                <span className="small">{p.label}</span>
              </button>
            ))}
          </Fragment>
        ))}
      </div>
      <div className="hatch-opts">
        <label className="field">
          <span>Winkel (dreht das Muster)</span>
          <select value={s.hatch.angle} onChange={(e) => setS({ ...s, hatch: { ...s.hatch, angle: Number(e.target.value) } })} data-testid="hatch-angle">
            {[...new Set([0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, s.hatch.angle])]
              .sort((a, b) => a - b)
              .map((a) => (
                <option key={a} value={a}>
                  {a}°
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          <span>Abstand ({String(s.hatch.spacing).replace('.', ',')} pt)</span>
          <input type="range" min={HATCH_SPACING_MIN} max={HATCH_SPACING_MAX} step={0.5} value={s.hatch.spacing} onChange={(e) => setS({ ...s, hatch: { ...s.hatch, spacing: Number(e.target.value) } })} data-testid="hatch-spacing" />
        </label>
      </div>
      <div className="field">
        <span>Schraffurfarbe</span>
        <span className="hatch-colors" role="group" aria-label="Schraffurfarbe">
          {[...DRAW_COLORS, ...custom.map((c) => ({ value: c, name: `Eigene Farbe ${c}` }))].map((c) => (
            <button key={c.value} type="button" className={`swatch${s.color.toLowerCase() === c.value ? ' active' : ''}`} style={{ background: c.value }} onClick={() => setS({ ...s, color: c.value })} aria-label={`Schraffurfarbe ${c.name}`} aria-pressed={s.color.toLowerCase() === c.value} data-testid={`hatch-color-${c.value}`} />
          ))}
          <MoreColors value={s.color} onChange={(c) => setS({ ...s, color: c })} label="Schraffurfarbe frei wählen" testId="hatch-color-free" remember />
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
          <MoreColors value={s.bg ?? '#ffffff'} onChange={(c) => setS({ ...s, bg: c })} label="Flächenfarbe frei wählen" testId="hatch-bg-free" remember />
        </span>
      </div>
    </Modal>
  );
}

export function hatchPicker(init: HatchSetting, opts: { title?: string; allowNone?: boolean } = {}): Promise<HatchSetting | null> {
  return customDialog<HatchSetting>((close) => <HatchPickerView init={init} title={opts.title ?? 'Schraffur wählen'} allowNone={!!opts.allowNone} close={close} />);
}
