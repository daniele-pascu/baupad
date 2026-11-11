import { useState } from 'react';
import { DRAW_COLORS, type TextFont } from '../lib/types';
import { rememberCustomColorSoon, useCustomColors } from '../lib/custom-colors';
import { cleanFont, FONT_FAMILIES, fontProps } from '../lib/text-font';
import { visibleStroke } from './PlanViewer';
import { Modal } from './Modal';
import { customDialog } from './ui';

/**
 * Textfeld im Plan (Plan zeichnen und Aufmaß): Text, Farbe, Schriftart, fett, kursiv.
 * FontControls wird auch in der Leiste eines ausgewählten Textes verwendet.
 */

export function FontControls({ font, color, onFont, onColor, compact = false }: { font: TextFont | undefined; color: string; onFont(f: TextFont | undefined): void; onColor(c: string): void; compact?: boolean }) {
  const f = font ?? {};
  const custom = useCustomColors();
  return (
    <div className={`font-controls${compact ? ' compact' : ''}`} data-testid="font-controls">
      <select value={f.family ?? 'sans'} onChange={(e) => onFont(cleanFont({ ...f, family: e.target.value as TextFont['family'] }))} aria-label="Schriftart" data-testid="font-family">
        {FONT_FAMILIES.map((x) => (
          <option key={x.id} value={x.id}>
            {x.label}
          </option>
        ))}
      </select>
      <span className="font-toggles">
        <button type="button" className={`btn btn-sm font-toggle${f.bold ? ' active' : ''}`} aria-pressed={!!f.bold} onClick={() => onFont(cleanFont({ ...f, bold: !f.bold }))} title="Fett" data-testid="font-bold">
          <b>F</b>
          <span className="sr-only">Fett</span>
        </button>
        <button type="button" className={`btn btn-sm font-toggle${f.italic ? ' active' : ''}`} aria-pressed={!!f.italic} onClick={() => onFont(cleanFont({ ...f, italic: !f.italic }))} title="Kursiv" data-testid="font-italic">
          <i style={{ fontFamily: 'Georgia, serif' }}>K</i>
          <span className="sr-only">Kursiv</span>
        </button>
      </span>
      <span className="font-colors" role="radiogroup" aria-label="Textfarbe">
        {[...DRAW_COLORS, ...custom.map((c) => ({ value: c, name: `Eigene Farbe ${c}` }))].map((c) => (
          <button
            key={c.value}
            type="button"
            role="radio"
            aria-checked={color === c.value}
            className={`swatch swatch-sm${color === c.value ? ' active' : ''}`}
            style={{ background: c.value }}
            onClick={() => onColor(c.value)}
            title={c.name}
            aria-label={c.name}
            data-testid={`text-color-${c.name}`}
          />
        ))}
        <input type="color" className="font-color-free" value={color} onChange={(e) => (onColor(e.target.value), rememberCustomColorSoon(e.target.value, DRAW_COLORS.map((c) => c.value)))} aria-label="Textfarbe frei wählen" title="Farbe frei wählen – wird als eigene Farbe gemerkt" data-testid="text-color-free" />
      </span>
    </div>
  );
}

export interface TextResult {
  text: string;
  color: string;
  font: TextFont | undefined;
  /** Größe ändern (Faktor, 1 = unverändert) */
  scale: number;
  /** Text löschen (nur beim Bearbeiten) */
  remove?: boolean;
}

function TextDialogView({ title, confirmLabel, init, canDelete, canResize, close }: { title: string; confirmLabel: string; init: { text: string; color: string; font?: TextFont }; canDelete: boolean; canResize: boolean; close(v: TextResult | null): void }) {
  const [text, setText] = useState(init.text);
  const [color, setColor] = useState(init.color);
  const [font, setFont] = useState<TextFont | undefined>(init.font);
  const [scale, setScale] = useState(1);
  const ok = text.trim().length > 0;
  return (
    <Modal
      title={title}
      onClose={() => close(null)}
      testId="text-dialog"
      footer={
        <>
          {canDelete && (
            <button type="button" className="btn btn-danger-text" onClick={() => close({ text, color, font, scale, remove: true })} data-testid="text-delete">
              Löschen
            </button>
          )}
          <button type="button" className="btn" onClick={() => close(null)}>
            Abbrechen
          </button>
          <button type="submit" form="text-form" className="btn btn-primary" disabled={!ok} data-testid="text-save">
            {confirmLabel}
          </button>
        </>
      }
    >
      <form
        id="text-form"
        className="text-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) close({ text: text.trim(), color, font, scale });
        }}
      >
        <label className="field">
          <span>Text</span>
          <input value={text} onChange={(e) => setText(e.target.value)} data-autofocus enterKeyHint="done" data-testid="text-input" />
        </label>
        <div className="field">
          <span>Schrift und Farbe</span>
          <FontControls font={font} color={color} onFont={setFont} onColor={setColor} />
        </div>
        {canResize && (
          <div className="field">
            <span>Größe</span>
            <span className="row gap">
              <button type="button" className="btn btn-sm" onClick={() => setScale(scale / 1.25)} data-testid="text-smaller">
                A− kleiner
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setScale(scale * 1.25)} data-testid="text-bigger">
                A+ größer
              </button>
            </span>
          </div>
        )}
        <div className="text-preview" aria-hidden="true">
          <span style={{ ...fontProps(font), color: visibleStroke(color), fontSize: `${Math.round(Math.min(40, 20 * scale))}px` }} data-testid="text-preview">
            {text.trim() || 'Vorschau'}
          </span>
        </div>
      </form>
    </Modal>
  );
}

/** Text einfügen bzw. bearbeiten; null = abgebrochen */
export function textDialog(opts: { title: string; confirmLabel?: string; text?: string; color: string; font?: TextFont; canDelete?: boolean; canResize?: boolean }): Promise<TextResult | null> {
  return customDialog<TextResult>((close) => (
    <TextDialogView
      title={opts.title}
      confirmLabel={opts.confirmLabel ?? 'Übernehmen'}
      init={{ text: opts.text ?? '', color: opts.color, font: opts.font }}
      canDelete={!!opts.canDelete}
      canResize={!!opts.canResize}
      close={close}
    />
  ));
}
