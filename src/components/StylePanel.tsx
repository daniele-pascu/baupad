import { useEffect, useState } from 'react';
import { DEFAULT_TRANSPARENCY, LINE_TYPES, LINE_WIDTH_MAX, LINE_WIDTH_MIN } from '../lib/style';
import { COLORS, type LineType, type ShapeStyle } from '../lib/types';

/**
 * Darstellung einer Linie bzw. Form: Linientyp, Linienstärke, Linienfarbe und – nur bei
 * geschlossenen Formen – Füllfarbe, Transparenz oder „Keine Füllung“. Reine Darstellung:
 * Geometrie und Messwerte bleiben unverändert.
 */
export function StylePanel({
  color,
  style = {},
  open,
  defaultWidth,
  kind,
  hideColor = false,
  onColor,
  onStyle,
}: {
  /** Linienfarbe nicht anzeigen (z. B. wenn die Farbfelder daneben stehen) */
  hideColor?: boolean;
  /** Linienfarbe */
  color: string;
  style?: ShapeStyle;
  /** offene Linie: keine Füllung */
  open: boolean;
  /** Linienstärke ohne eigene Einstellung (Anzeige) */
  defaultWidth: number;
  kind: keyof typeof DEFAULT_TRANSPARENCY;
  onColor(color: string): void;
  onStyle(patch: Partial<ShapeStyle>): void;
}) {
  const width = style.lineWidth ?? defaultWidth;
  const transparency = style.fillTransparency ?? DEFAULT_TRANSPARENCY[kind];
  // Schieberegler: Wert sofort anzeigen, beim Loslassen speichern (ein Rückgängig-Schritt)
  const [w, setW] = useState(width);
  const [t, setT] = useState(transparency);
  useEffect(() => setW(width), [width]);
  useEffect(() => setT(transparency), [transparency]);
  const commitW = () => w !== width && onStyle({ lineWidth: w });
  const commitT = () => t !== transparency && onStyle({ fillTransparency: t });

  return (
    <div className="style-panel" data-testid="style-panel">
      <fieldset className="style-group">
        <legend>{open ? 'Linie' : 'Umrandung'}</legend>
        <label className="style-row">
          <span>Linientyp</span>
          <select value={style.lineType ?? 'solid'} onChange={(e) => onStyle({ lineType: e.target.value as LineType })} data-testid="style-line-type">
            {LINE_TYPES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <label className="style-row">
          <span>Stärke</span>
          <input
            type="range"
            min={LINE_WIDTH_MIN}
            max={LINE_WIDTH_MAX}
            step={0.25}
            value={w}
            onChange={(e) => setW(Number(e.target.value))}
            onPointerUp={commitW}
            onKeyUp={commitW}
            onBlur={commitW}
            data-testid="style-line-width"
          />
          <output className="style-value">{w.toLocaleString('de-DE', { minimumFractionDigits: 2 })} pt</output>
        </label>
        {!hideColor && <ColorRow label="Farbe" value={color} onChange={onColor} testId="style-line-color" />}
      </fieldset>
      {!open && (
        <fieldset className="style-group">
          <legend>Füllung</legend>
          <label className="check-row small">
            <input type="checkbox" checked={!!style.noFill} onChange={(e) => onStyle({ noFill: e.target.checked })} data-testid="style-no-fill" />
            <span>Keine Füllung</span>
          </label>
          {!style.noFill && (
            <>
              <ColorRow label="Füllfarbe" value={style.fillColor ?? color} onChange={(c) => onStyle({ fillColor: c })} testId="style-fill-color" />
              <label className="style-row">
                <span>Transparenz</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={t}
                  onChange={(e) => setT(Number(e.target.value))}
                  onPointerUp={commitT}
                  onKeyUp={commitT}
                  onBlur={commitT}
                  data-testid="style-fill-transparency"
                />
                <output className="style-value">{t} %</output>
              </label>
            </>
          )}
        </fieldset>
      )}
    </div>
  );
}

/** Farbfelder plus freie Farbwahl */
function ColorRow({ label, value, onChange, testId }: { label: string; value: string; onChange(c: string): void; testId: string }) {
  return (
    <div className="style-row">
      <span>{label}</span>
      <span className="style-colors" role="group" aria-label={label}>
        {COLORS.map((c) => (
          <button
            key={c.value}
            type="button"
            className={`swatch swatch-sm${value.toLowerCase() === c.value ? ' active' : ''}`}
            style={{ background: c.value }}
            onClick={() => onChange(c.value)}
            aria-label={`${label} ${c.name}`}
            aria-pressed={value.toLowerCase() === c.value}
          />
        ))}
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={`${label} frei wählen`} title="Farbe frei wählen" data-testid={testId} />
      </span>
    </div>
  );
}
