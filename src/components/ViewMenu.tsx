import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

/** Menü „Ansicht“ der Planunterlage (Aufmaß und Mängelplan gleich): farbig oder schwarz-weiß – Ansicht und PDF, je Plan gespeichert. */
export function ViewMenu({ gray, onGray, prefix, colorTestId }: { gray: boolean; onGray(gray: boolean): void; prefix: string; colorTestId: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
  return (
    <div className="view-menu" ref={ref}>
      <button type="button" className="btn btn-sm" onClick={() => setOpen(!open)} aria-expanded={open} title="Ansicht der Planunterlage: farbig oder schwarz-weiß" data-testid={`${prefix}-view`}>
        <Icon name="layers" size={18} /> <span className="hide-sm">Ansicht</span>
      </button>
      {open && (
        <div className="layer-pop view-pop" role="group" aria-label="Ansicht" data-testid={`${prefix}-view-pop`}>
          <div className="pop-title">Planunterlage</div>
          <div className="segmented" role="radiogroup" aria-label="Darstellung">
            <button type="button" role="radio" aria-checked={!gray} onClick={() => onGray(false)} data-testid={`${colorTestId}-color`}>
              Farbig
            </button>
            <button type="button" role="radio" aria-checked={gray} onClick={() => onGray(true)} data-testid={`${colorTestId}-gray`}>
              Schwarz-weiß
            </button>
          </div>
          <p className="small muted">Gilt für Ansicht und PDF; Markierungen bleiben farbig.</p>
        </div>
      )}
    </div>
  );
}
