import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  full?: boolean;
  /** Schließen per Klick auf den Hintergrund verhindern (Schutz vor Datenverlust) */
  persistent?: boolean;
  testId?: string;
  className?: string;
}

export function Modal({ title, onClose, children, footer, wide, full, persistent, testId, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    // Erstes Eingabefeld fokussieren (nicht auf Touch-Geräten, um die Tastatur nicht ungefragt zu öffnen)
    const first = el?.querySelector<HTMLElement>('[data-autofocus], input, select, textarea');
    if (first && (first.dataset.autofocus !== undefined || !matchMedia('(pointer: coarse)').matches)) first.focus();
    else el?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // nur das oberste Fenster schließen (Fenster können geschachtelt sein, z. B. Benutzer in den Einstellungen)
        const all = document.querySelectorAll('.modal-backdrop');
        if (all[all.length - 1] !== el?.parentElement) return;
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, []);

  return (
    <div
      className="modal-backdrop"
      onPointerDown={(e) => {
        if (!persistent && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`modal${wide ? ' modal-wide' : ''}${full ? ' modal-full' : ''}${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        data-testid={testId}
      >
        <header className="modal-header">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Schließen">
            <Icon name="close" />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>
  );
}
