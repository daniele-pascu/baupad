import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Modal } from './Modal';
import { customDialog } from './ui';
import { rememberCustomColorSoon } from '../lib/custom-colors';
import { DRAW_COLORS } from '../lib/types';

/**
 * Farbwahl wie in Office: Reiter „Farbfelder“ (Raster mit vielen Farben, ein Tipp übernimmt) und
 * „Selbst wählen“ (Farbfeld, Farbton, Hex und RGB, Vorschau Neu/Aktuell, OK).
 */

const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
const hex2 = (n: number) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');
export const rgbToHex = (r: number, g: number, b: number) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** HSV (h 0–360, s/v 0–1) → Hex */
export function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return rgbToHex(f(5) * 255, f(3) * 255, f(1) * 255);
}

/** Hex → HSV (h 0–360, s/v 0–1) */
export function hexToHsv(hex: string): [number, number, number] {
  const [r, g, b] = (hexToRgb(hex) ?? [0, 0, 0]).map((x) => x / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, max ? d / max : 0, max];
}

/** Raster: 12 Farbtöne in 7 Helligkeiten (dunkel → hell), darunter Graustufen von Schwarz bis Weiß */
const HUES = [0, 25, 45, 60, 90, 130, 170, 195, 215, 245, 280, 320];
const LEVELS: [number, number][] = [
  [0.85, 0.35],
  [0.9, 0.55],
  [0.85, 0.75],
  [0.8, 0.95],
  [0.55, 1],
  [0.35, 1],
  [0.18, 1],
];
export const GRID_COLORS: string[] = [
  ...LEVELS.flatMap(([s, v]) => HUES.map((h) => hsvToHex(h, s, v))),
  ...Array.from({ length: 12 }, (_, i) => rgbToHex((i * 255) / 11, (i * 255) / 11, (i * 255) / 11)),
];

function ColorPickerView({ initial, title, close }: { initial: string; title: string; close(v: string | null): void }) {
  const start = hexToRgb(initial) ? initial.toLowerCase() : '#000000';
  const [tab, setTab] = useState<'grid' | 'custom'>('grid');
  const [hsv, setHsv] = useState(() => hexToHsv(start));
  const [hexText, setHexText] = useState(start);
  const field = useRef<HTMLDivElement>(null);
  const color = hsvToHex(...hsv);
  const rgb = hexToRgb(color)!;
  const setColor = (hex: string) => {
    if (!hexToRgb(hex)) return;
    const [h, s, v] = hexToHsv(hex);
    // Grau hat keinen Farbton: den bisherigen behalten, damit das Feld nicht springt
    setHsv([s ? h : hsv[0], s, v]);
    setHexText(hex.toLowerCase().startsWith('#') ? hex.toLowerCase() : `#${hex.toLowerCase()}`);
  };
  const pick = (e: React.PointerEvent) => {
    const r = field.current!.getBoundingClientRect();
    const s = clamp((e.clientX - r.left) / r.width, 0, 1);
    const v = 1 - clamp((e.clientY - r.top) / r.height, 0, 1);
    setHsv([hsv[0], s, v]);
    setHexText(hsvToHex(hsv[0], s, v));
  };
  return (
    <Modal
      title={title}
      onClose={() => close(null)}
      testId="color-picker"
      className="color-picker"
      footer={
        <>
          <button type="button" className="btn" onClick={() => close(null)}>
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" onClick={() => close(color)} data-testid="color-ok">
            OK
          </button>
        </>
      }
    >
      <div className="cp-tabs" role="tablist" aria-label="Art der Farbwahl">
        <button type="button" role="tab" aria-selected={tab === 'grid'} className={`chip${tab === 'grid' ? ' active' : ''}`} onClick={() => setTab('grid')} data-testid="color-tab-grid">
          Farbfelder
        </button>
        <button type="button" role="tab" aria-selected={tab === 'custom'} className={`chip${tab === 'custom' ? ' active' : ''}`} onClick={() => setTab('custom')} data-testid="color-tab-custom">
          Selbst wählen
        </button>
      </div>
      {tab === 'grid' ? (
        <div className="cp-grid" role="group" aria-label="Farbfelder">
          {GRID_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`cp-cell${c === color ? ' active' : ''}`}
              style={{ background: c }}
              onClick={() => close(c)}
              aria-label={`Farbe ${c}`}
              title={c}
              data-testid="color-grid"
              data-color={c}
            />
          ))}
        </div>
      ) : (
        <div className="cp-custom">
          <div
            ref={field}
            className="cp-field"
            style={{ '--hue': `hsl(${hsv[0]} 100% 50%)` } as CSSProperties}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              pick(e);
            }}
            onPointerMove={(e) => e.buttons && pick(e)}
            role="presentation"
            data-testid="color-field"
          >
            <span className="cp-dot" style={{ left: `${hsv[1] * 100}%`, top: `${(1 - hsv[2]) * 100}%`, background: color }} />
          </div>
          <input
            type="range"
            className="cp-hue"
            min={0}
            max={359}
            value={Math.round(hsv[0])}
            onChange={(e) => {
              const h = Number(e.target.value);
              setHsv([h, hsv[1], hsv[2]]);
              setHexText(hsvToHex(h, hsv[1], hsv[2]));
            }}
            aria-label="Farbton"
            data-testid="color-hue"
          />
          <div className="cp-values">
            <label>
              <span>Hex</span>
              <input value={hexText} onChange={(e) => (setHexText(e.target.value), setColor(e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`))} spellCheck={false} maxLength={7} data-testid="color-hex" />
            </label>
            {(['Rot', 'Grün', 'Blau'] as const).map((name, i) => (
              <label key={name}>
                <span>{name}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={255}
                  value={rgb[i]}
                  onChange={(e) => {
                    const next = [...rgb] as [number, number, number];
                    next[i] = clamp(Number(e.target.value) || 0, 0, 255);
                    setColor(rgbToHex(...next));
                  }}
                  data-testid={`color-${['r', 'g', 'b'][i]}`}
                />
              </label>
            ))}
          </div>
          <div className="cp-compare" aria-label="Vorschau">
            <span>Neu</span>
            <i style={{ background: color }} data-testid="color-new" />
            <i style={{ background: start }} />
            <span>Aktuell</span>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Farbwahl öffnen; liefert die gewählte Farbe (#rrggbb) bzw. null bei Abbrechen */
export function pickColor(initial: string, title = 'Farbe wählen'): Promise<string | null> {
  return customDialog<string>((close) => <ColorPickerView initial={initial} title={title} close={close} />);
}

/**
 * Taste „weitere Farben“ neben den Farbfeldern: öffnet die Farbwahl (Raster und selbst wählen).
 * `remember`: gewählte Farbe als eigene Farbe merken (erscheint danach neben den Standardfarben).
 */
export function MoreColors({
  value,
  onChange,
  label,
  testId,
  remember,
  className = 'color-more',
  children,
}: {
  value: string;
  onChange(c: string): void;
  label: string;
  testId: string;
  remember?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      className={className}
      style={{ '--c': value } as CSSProperties}
      onClick={async () => {
        const c = await pickColor(value, label);
        if (!c) return;
        onChange(c);
        if (remember) rememberCustomColorSoon(c, DRAW_COLORS.map((x) => x.value));
      }}
      aria-label={label}
      title="Weitere Farben: Farbfelder oder selbst wählen"
      data-testid={testId}
      data-value={value}
    >
      {children}
    </button>
  );
}
