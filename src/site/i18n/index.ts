import { useMemo } from 'react';
import { langOf, usePath, type Lang } from '../../lib/router';
import { de, type Dict } from './de';
import { en } from './en';

export type { Dict, Lang };

export const DICTS: Record<Lang, Dict> = { de, en };

/** Sprache der aktuellen Adresse und die zugehörigen Texte */
export function useLang(): { lang: Lang; t: Dict } {
  const path = usePath();
  const lang = langOf(path);
  return useMemo(() => ({ lang, t: DICTS[lang] }), [lang]);
}

/** Platzhalter wie {email} ersetzen */
export function fill(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
}

