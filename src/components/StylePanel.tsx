import { useEffect, useState } from 'react';
import { DASH_SCALES, dashArray, DEFAULT_HATCH, DEFAULT_TRANSPARENCY, HATCH_PATTERNS, LINE_TYPES, LINE_WIDTH_MAX, LINE_WIDTH_MIN, MATERIALS } from '../lib/style';
import { DRAW_COLORS, type HatchPattern, type LineType, type ShapeStyle } from '../lib/types';
import { rememberCustomColorSoon, useCustomColors } from '../lib/custom-colors';
import { HatchPreview, hatchLabel, hatchPicker, hatchStyle, settingFromStyle } from './HatchPicker';

/** Muster-Auswahl: allgemeine Muster und Baustoffe nach ÖNORM A 6240 (übernimmt Muster, Farbe, Winkel, Abstand) */
function PatternOptions() {
  return (
    <>
      <optgroup label="Muster">
        {HATCH_PATTERNS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </optgroup>
      <optgroup label="Baustoffe (ÖNORM A 6240)">
        {MATERIALS.map((m) => (
          <option key={m.id} value={`mat:${m.id}`}>
            {m.label}
          </option>
        ))}
      </optgroup>
    </>
  );
}
/** Auswahl eines Musters bzw. Baustoffs als Änderung */
function patternPatch(value: string, hatch: { pattern: HatchPattern; angle: number; spacing: number }): Partial<ShapeStyle> {
  if (value.startsWith('mat:')) {
    const m = MATERIALS.find((x) => `mat:${x.id}` === value);
    if (m) return { fillType: 'hatch', noFill: false, fillColor: m.color, fillTransparency: 0, hatch: { pattern: m.pattern, angle: m.angle, spacing: m.spacing } };
  }
  return { hatch: { ...hatch, pattern: value as HatchPattern } };
}
/** angezeigter Wert: Baustoff, wenn Muster/Winkel/Abstand/Farbe genau einem Baustoff entsprechen */
function patternValue(style: ShapeStyle, hatch: { pattern: HatchPattern; angle: number; spacing: number }): string {
  const m = MATERIALS.find((x) => x.pattern === hatch.pattern && x.angle === hatch.angle && x.spacing === hatch.spacing && x.color === (style.fillColor ?? '').toLowerCase());
  return m ? `mat:${m.id}` : hatch.pattern;
}

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
  compact = false,
  openHint = false,
  onColor,
  onStyle,
}: {
  /** offene Polylinie: Hinweis, dass sie für Füllung/Schraffur erst geschlossen werden muss */
  openHint?: boolean;
  /**
   * Kompakte Leiste (Zeichnen): alle Einstellungen in einer Zeile mit kleiner Beschriftung,
   * Füllung als Auswahl „Keine / Vollton / Schraffur“
   */
  compact?: boolean;
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
  const hatchOn = style.fillType === 'hatch';
  const hatch = { ...DEFAULT_HATCH, ...style.hatch };
  // Schraffur ohne eigene Angabe: deckende Linien
  const transparency = style.fillTransparency ?? (hatchOn ? 0 : DEFAULT_TRANSPARENCY[kind]);
  // Schieberegler: Wert sofort anzeigen, beim Loslassen speichern (ein Rückgängig-Schritt)
  const [w, setW] = useState(width);
  const [t, setT] = useState(transparency);
  useEffect(() => setW(width), [width]);
  useEffect(() => setT(transparency), [transparency]);
  const commitW = () => w !== width && onStyle({ lineWidth: w });
  const commitT = () => t !== transparency && onStyle({ fillTransparency: t });
  const [sp, setSp] = useState(hatch.spacing);
  useEffect(() => setSp(hatch.spacing), [hatch.spacing]);
  const commitSp = () => sp !== hatch.spacing && onStyle({ hatch: { ...hatch, spacing: sp } });

  if (compact) {
    const fillMode = style.noFill ? 'none' : hatchOn ? 'hatch' : 'solid';
    return (
      <div className="style-panel style-compact" data-testid="style-panel">
        <div className="sc-group" role="group" aria-label={open ? 'Linie' : 'Umrandung'}>
          <label className="sc-field">
            <span>Linientyp</span>
            <select value={style.lineType ?? 'solid'} onChange={(e) => onStyle({ lineType: e.target.value as LineType })} data-testid="style-line-type">
              {LINE_TYPES.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          <label className="sc-field">
            <span>Stärke</span>
            <span className="sc-range">
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
            </span>
          </label>
          {dashArray(style.lineType, 1) && (
            <label className="sc-field">
              <span>Musterlänge</span>
              <select value={style.dashScale ?? 1} onChange={(e) => onStyle({ dashScale: Number(e.target.value) })} data-testid="style-dash-scale">
                {DASH_SCALES.map((f) => (
                  <option key={f} value={f}>
                    {String(f).replace('.', ',')}×
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="sc-field">
            <span>Deckkraft</span>
            <select value={style.lineTransparency ?? 0} onChange={(e) => onStyle({ lineTransparency: Number(e.target.value) })} data-testid="style-line-transparency">
              {[0, 25, 50, 75].map((v) => (
                <option key={v} value={v}>
                  {100 - v} %
                </option>
              ))}
            </select>
          </label>
          {!hideColor && <MiniColors label={open ? 'Farbe' : 'Linienfarbe'} name="Farbe" value={color} onChange={onColor} testId="style-line-color" />}
          {openHint && (
            <span className="sc-hint small" data-testid="style-open-hint">
              Offene Kontur – für Füllung oder Schraffur zuerst „Verbinden“ bzw. „Schließen (Fläche)“.
            </span>
          )}
        </div>
        {!open && (
          <div className="sc-group" role="group" aria-label="Füllung">
            <label className="sc-field">
              <span>Füllung</span>
              <select
                value={fillMode}
                onChange={(e) => {
                  const m = e.target.value;
                  onStyle(m === 'none' ? { noFill: true } : { noFill: false, fillType: m as 'solid' | 'hatch' });
                }}
                data-testid="style-fill-type"
              >
                <option value="none">Keine Füllung</option>
                <option value="solid">Vollton</option>
                <option value="hatch">Schraffur</option>
              </select>
            </label>
            {hatchOn && !style.noFill && (
              // Schraffur: Auswahl im eigenen Fenster (Kacheln mit Vorschau) – die Leiste bleibt schmal (iPad)
              <span className="sc-field">
                <span>Muster</span>
                <button
                  type="button"
                  className="btn btn-sm hatch-open"
                  onClick={async () => {
                    const r = await hatchPicker(settingFromStyle(style, color), { title: 'Schraffur' });
                    if (r) onStyle(hatchStyle(r));
                  }}
                  title="Muster, Baustoff, Winkel, Abstand und Farben wählen"
                  data-testid="style-hatch-open"
                >
                  <HatchPreview s={settingFromStyle(style, color)} w={34} h={20} />
                  <span>{hatchLabel(settingFromStyle(style, color))}</span>
                </button>
              </span>
            )}
            {!style.noFill && !hatchOn && (
              <>
                <MiniColors label="Füllfarbe" name="Füllfarbe" value={style.fillColor ?? color} onChange={(c) => onStyle({ fillColor: c })} testId="style-fill-color" />
                <label className="sc-field">
                  <span>Transparenz</span>
                  <span className="sc-range">
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
                  </span>
                </label>
              </>
            )}
          </div>
        )}
      </div>
    );
  }

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
              <label className="style-row">
                <span>Füllart</span>
                <select value={hatchOn ? 'hatch' : 'solid'} onChange={(e) => onStyle({ fillType: e.target.value as 'solid' | 'hatch' })} data-testid="style-fill-type">
                  <option value="solid">Vollton</option>
                  <option value="hatch">Schraffur</option>
                </select>
              </label>
              {hatchOn && (
                <>
                  <label className="style-row">
                    <span>Muster</span>
                    <select value={patternValue(style, hatch)} onChange={(e) => onStyle(patternPatch(e.target.value, hatch))} data-testid="style-hatch-pattern">
                      <PatternOptions />
                    </select>
                  </label>
                  <label className="style-row">
                    <span>Winkel</span>
                    <select value={hatch.angle} onChange={(e) => onStyle({ hatch: { ...hatch, angle: Number(e.target.value) } })} data-testid="style-hatch-angle">
                      {[0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165].map((a) => (
                        <option key={a} value={a}>
                          {a}°
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="style-row">
                    <span>Abstand</span>
                    <input
                      type="range"
                      min={2}
                      max={20}
                      step={1}
                      value={sp}
                      onChange={(e) => setSp(Number(e.target.value))}
                      onPointerUp={commitSp}
                      onKeyUp={commitSp}
                      onBlur={commitSp}
                      data-testid="style-hatch-spacing"
                    />
                    <output className="style-value">{sp} pt</output>
                  </label>
                </>
              )}
              <ColorRow label={hatchOn ? 'Schraffurfarbe' : 'Füllfarbe'} value={style.fillColor ?? color} onChange={(c) => onStyle({ fillColor: c })} testId="style-fill-color" />
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
  const custom = useCustomColors();
  return (
    <div className="style-row">
      <span>{label}</span>
      <span className="style-colors" role="group" aria-label={label}>
        {[...DRAW_COLORS, ...custom.map((c) => ({ value: c, name: `Eigene Farbe ${c}` }))].map((c) => (
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
        <input type="color" value={value} onChange={(e) => (onChange(e.target.value), rememberCustomColorSoon(e.target.value, DRAW_COLORS.map((c) => c.value)))} aria-label={`${label} frei wählen`} title="Farbe frei wählen – wird als eigene Farbe gemerkt" data-testid={testId} />
      </span>
    </div>
  );
}

/** Kompakte Farbwahl: kleine Farbfelder in zwei Reihen plus freie Farbe */
function MiniColors({ label, name, value, onChange, testId }: { label: string; name: string; value: string; onChange(c: string): void; testId: string }) {
  const custom = useCustomColors();
  return (
    <div className="sc-field">
      <span>{label}</span>
      <span className="sc-colors" role="group" aria-label={label}>
        {[...DRAW_COLORS, ...custom.map((c) => ({ value: c, name: `Eigene Farbe ${c}` }))].map((c) => (
          <button
            key={c.value}
            type="button"
            className={`swatch swatch-xs${value.toLowerCase() === c.value ? ' active' : ''}`}
            style={{ background: c.value }}
            onClick={() => onChange(c.value)}
            aria-label={`${name} ${c.name}`}
            aria-pressed={value.toLowerCase() === c.value}
            title={`${name} ${c.name}`}
          />
        ))}
        <input type="color" value={value} onChange={(e) => (onChange(e.target.value), rememberCustomColorSoon(e.target.value, DRAW_COLORS.map((c) => c.value)))} aria-label={`${name} frei wählen`} title="Farbe frei wählen – wird als eigene Farbe gemerkt" data-testid={testId} />
      </span>
    </div>
  );
}
