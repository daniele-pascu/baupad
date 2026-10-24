import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

export interface MenuAction {
  label: string;
  icon: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  testId?: string;
}

/**
 * Kompaktes Aktionsmenü („⋯“). Das Menü wird über dem Inhalt eingeblendet und klappt
 * nach oben auf, wenn unten kein Platz ist (z. B. letzte Zeile auf dem Smartphone).
 */
export function ActionMenu({ label, actions, testId }: { label: string; actions: MenuAction[]; testId?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const h = menu.current?.offsetHeight ?? actions.length * 46;
    const w = menu.current?.offsetWidth ?? 220;
    const up = r.bottom + h + 8 > window.innerHeight && r.top - h - 8 > 0;
    setPos({ top: up ? r.top - h - 4 : r.bottom + 4, left: Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)), up });
  }, [open, actions.length]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (menu.current?.contains(e.target as Node) || btn.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btn.current?.focus();
      }
    };
    const onScroll = () => setOpen(false);
    document.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onScroll);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [open, pos]);

  return (
    <>
      <button
        ref={btn}
        type="button"
        className="icon-btn menu-trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setPos(null);
          setOpen(!open);
        }}
        data-testid={testId}
      >
        <Icon name="more" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            className="action-menu"
            role="menu"
            aria-label={label}
            style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden', top: 0, left: 0 }}
          >
            {actions.map((a) => (
              <button
                key={a.label}
                type="button"
                role="menuitem"
                className={a.danger ? 'danger' : undefined}
                disabled={a.disabled}
                data-testid={a.testId}
                onClick={() => {
                  setOpen(false);
                  a.onSelect();
                }}
              >
                <Icon name={a.icon} size={18} /> {a.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
