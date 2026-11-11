import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Befehlsleiste (wie die Befehlszeile in CAD-Programmen): zeigt den aktuellen Schritt eines Befehls
 * („Basispunkt wählen …“) und nimmt exakte Werte entgegen – Abstand, ΔX;ΔY oder Länge<Winkel.
 * Tippt man am PC Ziffern, während die Maus auf dem Plan ist, landen sie direkt im Eingabefeld.
 */
export function CommandBar({
  title,
  prompt,
  onInput,
  placeholder = 'z. B. 1,25 · 2,5;0 · 3<45',
  children,
  testId = 'command-bar',
}: {
  title: string;
  prompt: ReactNode;
  /** Eingabe übernehmen; liefert eine Fehlermeldung oder null */
  onInput?: (text: string) => string | null;
  placeholder?: string;
  /** weitere Tasten (Weiter, Fertig, Abbrechen …) */
  children?: ReactNode;
  testId?: string;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Ziffern & Co. ohne vorheriges Antippen des Felds: direkt ins Feld (und nicht als Tastenkürzel, z. B. „-“ = Verkleinern)
  useEffect(() => {
    if (!onInput) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector('.modal')) return;
      if (el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable)) return;
      if (!/^[0-9@<,.;\-]$/.test(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      setValue((v) => v + e.key);
      setError(null);
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onInput]);

  return (
    <form
      className="draw-bar command-bar"
      data-testid={testId}
      onSubmit={(e) => {
        e.preventDefault();
        if (!onInput || !value.trim()) return;
        const err = onInput(value);
        setError(err);
        if (!err) {
          setValue('');
          inputRef.current?.blur();
        }
      }}
    >
      <strong className="draw-bar-title">{title}</strong>
      <span className="command-prompt small" data-testid="command-prompt">
        {prompt}
      </span>
      {onInput && (
        <span className="command-input-row">
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setValue('');
                (e.target as HTMLInputElement).blur();
              }
            }}
            placeholder={placeholder}
            aria-label="Wert eingeben"
            autoComplete="off"
            enterKeyHint="done"
            data-testid="command-input"
          />
          <button type="submit" className="btn btn-sm" disabled={!value.trim()} data-testid="command-ok">
            OK
          </button>
        </span>
      )}
      {children}
      {error && (
        <span className="command-error small" role="alert" data-testid="command-error">
          {error}
        </span>
      )}
    </form>
  );
}
