import { useEffect, useRef, useState } from 'react';

/**
 * Uhrzeit mit der Zahlentastatur statt dem Rad: „0630“, „630“, „6:30“ oder „6.30“ → 06:30, „7“ → 07:00.
 * Nach 4 Ziffern wird übernommen und ins nächste Zeitfeld gesprungen; sonst beim Verlassen des Felds.
 * Leer = keine Zeit.
 */
export function parseTime(s: string): string | null {
  const t = s.trim();
  if (!t) return '';
  let h: number;
  let m: number;
  const sep = /^(\d{1,2})\s*[:.,h ]\s*(\d{1,2})$/.exec(t);
  if (sep) {
    h = Number(sep[1]);
    m = Number(sep[2].length === 1 ? `${sep[2]}0` : sep[2]);
  } else {
    const d = t.replace(/\D/g, '');
    if (!d || d !== t.replace(/\s/g, '')) return null;
    if (d.length <= 2) [h, m] = [Number(d), 0];
    else if (d.length === 3) [h, m] = [Number(d[0]), Number(d.slice(1))];
    else if (d.length === 4) [h, m] = [Number(d.slice(0, 2)), Number(d.slice(2))];
    else return null;
  }
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
/** schon vollständig eingegeben (4 Ziffern oder H:MM) – dann sofort übernehmen */
const complete = (s: string) => /^\d{4}$/.test(s.trim()) || /^\d{1,2}[:.,h]\d{2}$/.test(s.trim());

export function TimeField({ value, onChange, disabled, testId, label }: { value: string; onChange(v: string): void; disabled?: boolean; testId?: string; label?: string }) {
  const [text, setText] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (document.activeElement !== ref.current) setText(value);
  }, [value]);
  const commit = (s: string, advance = false) => {
    const v = parseTime(s);
    if (v === null) {
      setText(value);
      return;
    }
    setText(v);
    if (v !== value) onChange(v);
    if (advance) {
      // ins nächste Zeitfeld springen (gleiche Zeile bzw. Dialog)
      const all = Array.from(document.querySelectorAll<HTMLInputElement>('input[data-time-field]:not(:disabled)'));
      const next = all[all.indexOf(ref.current!) + 1];
      if (next) {
        next.focus();
        next.select();
      } else ref.current?.blur();
    }
  };
  return (
    <input
      ref={ref}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      enterKeyHint="next"
      placeholder="hh:mm"
      maxLength={5}
      value={text}
      disabled={disabled}
      aria-label={label}
      data-time-field=""
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => {
        const s = e.target.value;
        setText(s);
        if (complete(s)) commit(s, /^\d{4}$/.test(s.trim()));
      }}
      onBlur={() => commit(text)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit(text, true);
        }
      }}
      data-testid={testId}
    />
  );
}
