import { useEffect, useId, useRef, useState } from 'react';
import { DRAW_COLORS, type LeaderEnd, type TextFont } from '../lib/types';
import { useCustomColors } from '../lib/custom-colors';
import { cleanFont, FONT_FAMILIES, fontProps, nextSize, roundPt, TEXT_SIZES } from '../lib/text-font';
import { visibleStroke } from './PlanViewer';
import { Modal } from './Modal';
import { customDialog } from './ui';
import { MoreColors } from './ColorPicker';

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
        <MoreColors className="color-more font-color-free" value={color} onChange={onColor} label="Textfarbe frei wählen" testId="text-color-free" remember />
      </span>
    </div>
  );
}

/** Bezugslinie im Text-Fenster: keine, mit Pfeilspitze, mit Punkt oder nur die Linie */
export type LeaderChoice = 'off' | LeaderEnd;
const LEADER_CHOICES: { id: LeaderChoice; label: string }[] = [
  { id: 'off', label: 'Ohne' },
  { id: 'arrow', label: 'Pfeil' },
  { id: 'dot', label: 'Punkt' },
  { id: 'none', label: 'Nur Linie' },
];

export interface TextResult {
  text: string;
  color: string;
  font: TextFont | undefined;
  /** Größe ändern (Faktor, 1 = unverändert) */
  scale: number;
  /** Bezugslinie zum Text: keine, Pfeil, Punkt oder nur Linie */
  leader: LeaderChoice;
  /** Text löschen (nur beim Bearbeiten) */
  remove?: boolean;
}

/** Schriftgrößen wie in der Textverarbeitung (pt auf dem Papier) */
const fmtPt = (n: number) => String(roundPt(n)).replace('.', ',');
/** Zeile einer Bezugslinie als kleines Bild (Vorschau der Auswahl) */
export function LeaderIcon({ end }: { end: LeaderChoice }) {
  return (
    <svg width="34" height="16" viewBox="0 0 34 16" aria-hidden="true">
      {end === 'off' ? (
        <path d="M8 3l18 10M26 3L8 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.45" />
      ) : (
        <>
          <path d={`M${end === 'arrow' ? 9 : 4} 8H31`} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          {end === 'arrow' && <path d="M2 8l9-4.2v8.4z" fill="currentColor" />}
          {end === 'dot' && <circle cx="5" cy="8" r="3.4" fill="currentColor" />}
        </>
      )}
    </svg>
  );
}

/**
 * Formatleiste wie die Gruppe „Schriftart“ der Textverarbeitung: oben Schriftart, Schriftgrad (eintippen oder aus der
 * Liste) und Schriftgrad vergrößern/verkleinern; darunter Fett, Kursiv, Unterstrichen, Schriftfarbe (A mit
 * Farbbalken, Palette klappt auf) und die Ausrichtung. Im Text-Fenster und in der Leiste eines ausgewählten Textes.
 */
export function TextFormatBar({ font, color, pt, onFont, onColor, onPt, compact = false, live = true }: { font: TextFont | undefined; color: string; /** Schriftgrad jetzt (pt auf dem Blatt) */ pt: number; onFont(f: TextFont | undefined): void; onColor(c: string): void; onPt(pt: number): void; /** in der Leiste: eine Zeile */ compact?: boolean; /** getippter Schriftgrad gilt sofort (Fenster) bzw. erst mit Enter/Verlassen des Felds (Leiste) */ live?: boolean }) {
  const f = font ?? {};
  const custom = useCustomColors();
  const listId = useId();
  /** Palette der Schriftfarbe aufgeklappt */
  const [palette, setPalette] = useState(false);
  // Eingabefeld des Schriftgrads: frei tippen (z. B. 13,5), Vorschläge wie in der Textverarbeitung
  const [ptText, setPtText] = useState(fmtPt(pt));
  const shown = useRef(pt);
  useEffect(() => {
    // Größe von außen geändert (z. B. Ecke im Plan gezogen): Feld nachführen
    if (Math.abs(shown.current - pt) > 1e-6) {
      shown.current = pt;
      setPtText(fmtPt(pt));
    }
  }, [pt]);
  const setPt = (n: number) => {
    const v = roundPt(Math.min(400, Math.max(2, n)));
    shown.current = v;
    setPtText(fmtPt(v));
    onPt(v);
  };
  const typePt = (v: string) => {
    setPtText(v);
    const n = Number(v.replace(',', '.'));
    // getippt: ab 10 pt ganze Punkte (ohne Kommastellen), darunter halbe
    if (live && Number.isFinite(n) && n >= 2 && n <= 400) {
      shown.current = roundPt(n);
      onPt(roundPt(n));
    }
  };
  /** Feld verlassen: getippten Wert übernehmen (Leiste) bzw. die Anzeige glätten */
  const leavePt = () => {
    const n = Number(ptText.replace(',', '.'));
    // nur wenn wirklich etwas anderes getippt wurde (die Anzeige ist gerundet – bloßes Verlassen ändert nichts)
    if (!live && ptText.trim() !== fmtPt(shown.current) && Number.isFinite(n) && n >= 2 && n <= 400) setPt(n);
    else setPtText(fmtPt(shown.current));
  };
  return (
    <div className={`wtb${compact ? ' wtb-compact' : ''}`} role="toolbar" aria-label="Schriftart" data-testid="text-format-bar">
      <div className="wtb-row">
        <select className="wtb-font" value={f.family ?? 'sans'} onChange={(e) => onFont(cleanFont({ ...f, family: e.target.value as TextFont['family'] }))} aria-label="Schriftart" title="Schriftart" data-testid="font-family">
          {FONT_FAMILIES.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}
            </option>
          ))}
        </select>
        <input
          className="wtb-size"
          value={ptText}
          onChange={(e) => typePt(e.target.value)}
          onBlur={leavePt}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
          onFocus={(e) => e.currentTarget.select() /* gleich überschreibbar: einfach die neue Größe tippen */}
          inputMode="decimal"
          list={listId}
          autoComplete="off"
          aria-label="Schriftgrad in Punkt"
          title="Schriftgrad (pt) – Zahl eintippen (Enter übernimmt) oder aus der Liste wählen"
          data-testid="text-size"
        />
        <datalist id={listId}>
          {TEXT_SIZES.map((n) => (
            <option key={n} value={String(n)} />
          ))}
        </datalist>
        <button type="button" className="wtb-btn" onClick={() => setPt(nextSize(pt, 1))} title="Schriftgrad vergrößern" aria-label="Schriftgrad vergrößern" data-testid="text-bigger">
          <svg width="22" height="20" viewBox="0 0 22 20" aria-hidden="true">
            <text x="1" y="17" fontSize="17" fontFamily="Arial, Helvetica, sans-serif" fill="currentColor">A</text>
            <path d="M14.5 6.5L17.5 3l3 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button type="button" className="wtb-btn" onClick={() => setPt(nextSize(pt, -1))} title="Schriftgrad verkleinern" aria-label="Schriftgrad verkleinern" data-testid="text-smaller">
          <svg width="22" height="20" viewBox="0 0 22 20" aria-hidden="true">
            <text x="3" y="17" fontSize="13" fontFamily="Arial, Helvetica, sans-serif" fill="currentColor">A</text>
            <path d="M14.5 3.5L17.5 7l3-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <div className="wtb-row">
        <button type="button" className={`wtb-btn wtb-bold${f.bold ? ' active' : ''}`} aria-pressed={!!f.bold} onClick={() => onFont(cleanFont({ ...f, bold: !f.bold }))} title="Fett" aria-label="Fett" data-testid="font-bold">
          F
        </button>
        <button type="button" className={`wtb-btn wtb-italic${f.italic ? ' active' : ''}`} aria-pressed={!!f.italic} onClick={() => onFont(cleanFont({ ...f, italic: !f.italic }))} title="Kursiv" aria-label="Kursiv" data-testid="font-italic">
          K
        </button>
        <button type="button" className={`wtb-btn wtb-underline${f.underline ? ' active' : ''}`} aria-pressed={!!f.underline} onClick={() => onFont(cleanFont({ ...f, underline: !f.underline }))} title="Unterstrichen" aria-label="Unterstrichen" data-testid="font-underline">
          U
        </button>
        <span className="wtb-sep" aria-hidden="true" />
        <button type="button" className={`wtb-btn wtb-color${palette ? ' active' : ''}`} aria-expanded={palette} onClick={() => setPalette(!palette)} title="Schriftfarbe" aria-label="Schriftfarbe" data-testid="text-color-open">
          <span className="wtb-color-a" aria-hidden="true">
            A
          </span>
          <span className="wtb-color-bar" style={{ background: visibleStroke(color) }} aria-hidden="true" />
          <svg className="wtb-caret" width="8" height="5" viewBox="0 0 8 5" aria-hidden="true">
            <path d="M1 1l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className="wtb-sep" aria-hidden="true" />
        {(['left', 'center', 'right'] as const).map((al) => {
          const on = (f.align ?? 'left') === al;
          return (
            <button
              key={al}
              type="button"
              className={`wtb-btn${on ? ' active' : ''}`}
              aria-pressed={on}
              onClick={() => onFont(cleanFont({ ...f, align: al === 'left' ? undefined : al }))}
              title={al === 'left' ? 'Linksbündig' : al === 'center' ? 'Zentriert' : 'Rechtsbündig'}
              aria-label={al === 'left' ? 'Linksbündig' : al === 'center' ? 'Zentriert' : 'Rechtsbündig'}
              data-testid={`text-align-${al}`}
            >
              <svg width="18" height="16" viewBox="0 0 18 16" aria-hidden="true">
                {[2, 6, 10, 14].map((y, i) => {
                  const w = i % 2 ? 10 : 16;
                  const x = al === 'left' ? 1 : al === 'center' ? (18 - w) / 2 : 17 - w;
                  return <path key={y} d={`M${x} ${y}h${w}`} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />;
                })}
              </svg>
            </button>
          );
        })}
      </div>
      {palette && (
        <div className="wtb-row wtb-palette" role="radiogroup" aria-label="Schriftfarbe" data-testid="text-palette">
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
          <MoreColors className="color-more font-color-free" value={color} onChange={onColor} label="Schriftfarbe frei wählen" testId="text-color-free" remember />
        </div>
      )}
    </div>
  );
}

function TextDialogView({ title, confirmLabel, init, canDelete, sizePt, close }: { title: string; confirmLabel: string; init: { text: string; color: string; font?: TextFont; leader: LeaderChoice }; canDelete: boolean; sizePt?: number; close(v: TextResult | null): void }) {
  const [text, setText] = useState(init.text);
  const [color, setColor] = useState(init.color);
  const [font, setFont] = useState<TextFont | undefined>(init.font);
  const [scale, setScaleState] = useState(1);
  const [leader, setLeader] = useState<LeaderChoice>(init.leader);
  const f = font ?? {};
  const ok = text.trim().length > 0;
  /** Schriftgröße in pt (bisherige Größe mal Faktor); ohne bekannte Größe zählt nur der Faktor */
  const base = sizePt ?? 12;
  const pt = base * scale;
  const setScale = (f: number) => setScaleState(Math.min(Math.max(f, 2 / base), 400 / base));
  const result = (): TextResult => ({ text: text.trim(), color, font, scale, leader });
  return (
    <Modal
      title={title}
      onClose={() => close(null)}
      testId="text-dialog"
      footer={
        <>
          {canDelete && (
            <button type="button" className="btn btn-danger-text" onClick={() => close({ ...result(), remove: true })} data-testid="text-delete">
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
          if (ok) close(result());
        }}
      >
        <TextFormatBar font={font} color={color} pt={pt} onFont={setFont} onColor={setColor} onPt={(n) => setScale(n / base)} />
        <label className="field">
          <span className="sr-only">Text</span>
          <textarea
            className="text-area"
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // Strg+Enter übernimmt; Enter allein beginnt einen neuen Absatz
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && ok) {
                e.preventDefault();
                close(result());
              }
            }}
            placeholder="Text – Enter beginnt einen neuen Absatz"
            // Schriftart und Ausrichtung wie gewählt; die Farbe zeigt die Vorschau darunter (im Dunkelmodus wäre z. B.
            // schwarze Schrift im Eingabefeld nicht lesbar)
            style={{ ...fontProps(font), textAlign: f.align ?? 'left' }}
            data-autofocus
            data-testid="text-input"
          />
        </label>
        <div className="field">
          <span>Linie zum Plan</span>
          <span className="wtb leader-choices" role="radiogroup" aria-label="Linie zum Plan">
            {LEADER_CHOICES.map((c) => (
              <button key={c.id} type="button" role="radio" aria-checked={leader === c.id} className={`wtb-btn leader-choice${leader === c.id ? ' active' : ''}`} onClick={() => setLeader(c.id)} data-testid={`text-leader-${c.id}`}>
                <LeaderIcon end={c.id} />
                <span>{c.label}</span>
              </button>
            ))}
          </span>
          <small className="muted">Im Plan: Text ziehen verschiebt ihn (das Linienende bleibt stehen), Ecke ziehen ändert die Größe, Seite ziehen die Breite.</small>
        </div>
        <div className="text-preview" aria-hidden="true">
          <span style={{ ...fontProps(font), color: visibleStroke(color), fontSize: `${Math.round(Math.max(12, Math.min(40, pt * 1.333)))}px`, whiteSpace: 'pre-wrap', lineHeight: 1.35, textAlign: f.align ?? 'left', width: '100%' }} data-testid="text-preview">
            {text.trim() || 'Vorschau'}
          </span>
        </div>
      </form>
    </Modal>
  );
}

/** Text einfügen bzw. bearbeiten; null = abgebrochen */
export function textDialog(opts: { title: string; confirmLabel?: string; text?: string; color: string; font?: TextFont; canDelete?: boolean; canResize?: boolean; /** Schriftgröße jetzt (pt auf dem Papier) */ sizePt?: number; /** Bezugslinie jetzt */ leader?: LeaderChoice }): Promise<TextResult | null> {
  return customDialog<TextResult>((close) => (
    <TextDialogView
      title={opts.title}
      confirmLabel={opts.confirmLabel ?? 'Übernehmen'}
      init={{ text: opts.text ?? '', color: opts.color, font: opts.font, leader: opts.leader ?? 'off' }}
      canDelete={!!opts.canDelete}
      sizePt={opts.sizePt && opts.sizePt > 0 ? opts.sizePt : undefined}
      close={close}
    />
  ));
}
