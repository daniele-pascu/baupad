import { useEffect, useRef, useState } from 'react';
import { naturalCompare } from './numbers';
import { useSession } from './use-session';

/**
 * Sortierung von Listen (Projekte in allen Werkzeugen): Art + Richtung, je angemeldeter Person und Liste gemerkt.
 * Gespeichert im Browser unter der Kennung der Person – jede Person auf demselben Gerät hat ihre eigene Sortierung.
 */
export type SortDir = 'asc' | 'desc';
export interface ListSort<K extends string> {
  key: K;
  dir: SortDir;
}

const storeKey = (user: string, list: string) => `sort:${user}:${list}`;

function read<K extends string>(user: string, list: string, labels: Record<K, string>): ListSort<K> | null {
  try {
    const v = JSON.parse(localStorage.getItem(storeKey(user, list)) ?? 'null') as Partial<ListSort<K>> | null;
    return v && typeof v.key === 'string' && v.key in labels && (v.dir === 'asc' || v.dir === 'desc') ? { key: v.key, dir: v.dir } : null;
  } catch {
    return null;
  }
}

/**
 * Sortierung einer Liste: [aktuelle Sortierung, ändern]. `legacy` liest eine frühere, gerätweite Einstellung
 * (wird für die Person übernommen, solange sie noch keine eigene gewählt hat).
 */
export function useListSort<K extends string>(list: string, labels: Record<K, string>, def: ListSort<K>, legacy?: () => ListSort<K> | null): [ListSort<K>, (s: ListSort<K>) => void] {
  const session = useSession();
  const user = session?.userId ?? 'local';
  const load = (u: string) => read(u, list, labels) ?? legacy?.() ?? def;
  const [state, setState] = useState<ListSort<K>>(() => load(user));
  /** schon gewählt, bevor die Anmeldung geladen war – diese Wahl gilt dann auch für die Person */
  const touched = useRef(false);
  const save = (u: string, s: ListSort<K>) => {
    try {
      localStorage.setItem(storeKey(u, list), JSON.stringify(s));
    } catch {
      /* privater Modus: nur für diese Sitzung */
    }
  };
  // andere Person angemeldet (bzw. Sitzung erst jetzt geladen): deren eigene Sortierung; hat sie noch keine,
  // bleibt die gerade gezeigte stehen und wird für sie gemerkt (kein Zurückspringen nach dem Laden)
  useEffect(() => {
    if (session === undefined) return;
    const own = read(user, list, labels);
    if (own && !touched.current) setState(own);
    else setState((cur) => (save(user, cur), cur));
    touched.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, list, session === undefined]);
  const change = (s: ListSort<K>) => {
    if (session === undefined) touched.current = true;
    setState(s);
    save(user, s);
  };
  return [state, change];
}

type Val = string | number | null | undefined;
const empty = (v: Val) => v === null || v === undefined || v === '' || (typeof v === 'number' && !Number.isFinite(v));

/**
 * Liste sortieren: Texte natürlich (2 vor 10), Zahlen/Datum numerisch; leere Werte stehen in beiden Richtungen am Ende.
 * `tie` entscheidet bei Gleichstand (Standard: unverändert).
 */
export function sortList<T, K extends string>(items: T[], s: ListSort<K>, get: Record<K, (x: T) => Val>, tie?: (a: T, b: T) => number): T[] {
  const f = get[s.key];
  const sign = s.dir === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    const va = f(a);
    const vb = f(b);
    if (empty(va) || empty(vb)) return empty(va) && empty(vb) ? (tie?.(a, b) ?? 0) : empty(va) ? 1 : -1;
    const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : naturalCompare(String(va), String(vb));
    return sign * c || (tie?.(a, b) ?? 0);
  });
}
