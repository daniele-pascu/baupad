import { useEffect, useRef } from 'react';
import { MEASURE_TYPES, typeInfo } from '../lib/measure-types';
import type { MeasureType } from '../lib/types';
import { Icon } from './Icon';

/**
 * Gewählte Messart im Aufmaß: eine der sieben Messarten; 'auto' = noch keine gewählt (dann gibt es noch keine
 * Zeichenwerkzeuge – erst die Messart wählen, danach erscheinen die passenden Werkzeuge). „Automatisch“ gibt es nicht mehr.
 */
export type MeasureChoice = MeasureType | 'auto';
export const MEASURE_CHOICES: MeasureChoice[] = ['auto', ...MEASURE_TYPES.map((t) => t.id)];
/** im Menü wählbar: nur die Messarten */
const MENU_CHOICES: MeasureType[] = MEASURE_TYPES.map((t) => t.id);
export const choiceLabel = (c: MeasureChoice) => (c === 'auto' ? 'wählen' : typeInfo(c).label);
export const choiceIcon = (c: MeasureChoice) => (c === 'auto' ? 'mtype' : typeInfo(c).icon);

/**
 * Messart wählen (Aufmaß): zuerst festlegen, was gemessen wird – danach liefert jedes Werkzeug (Linie, Rechteck,
 * Kreis, Fläche, Freie Form, Freihand) eine Messung dieser Art. Menü über der Werkzeugleiste.
 */
export function MeasureTypeMenu({ value, onPick, onClose }: { value: MeasureChoice; onPick(c: MeasureChoice): void; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (ref.current?.contains(t) || t?.closest?.('[data-mtype-toggle]')) return;
      close.current();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, []);
  return (
    <div ref={ref} className="probe-menu mtype-menu" role="menu" aria-label="Messart" data-testid="mtype-menu">
      {MENU_CHOICES.map((c) => (
        <button key={c} type="button" role="menuitemradio" aria-checked={value === c} className={value === c ? 'active' : undefined} onClick={() => onPick(c)} data-testid={`mtype-${c}`}>
          <span className="probe-menu-icon mtype-menu-icon">
            <Icon name={choiceIcon(c)} size={22} />
          </span>
          <span className="probe-menu-text">
            <strong>
              {choiceLabel(c)}
              {typeInfo(c).unit ? ` · ${typeInfo(c).unit}` : ''}
            </strong>
            <span className="muted small">{typeInfo(c).hint}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
