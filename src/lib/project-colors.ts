import { useEffect, useState, type CSSProperties } from 'react';
import type { Project } from './types';

/**
 * Projektfarben: jedes Projekt hat eine Erkennungsfarbe, die in allen Tools gleich ist (Streifen an der
 * Baustellenkarte, Punkt vor dem Namen). Nur Akzent – Schrift bleibt schwarz, PDFs bleiben schwarz-weiß.
 * Kein Rot/Orange (stehen für Warnungen). Neue Projekte bekommen die am wenigsten benutzte Farbe;
 * ältere Projekte ohne gespeicherte Farbe eine feste Farbe aus ihrer ID. Im Projektregister änderbar.
 */
export const PROJECT_COLORS: { id: string; label: string }[] = [
  { id: '#2563eb', label: 'Blau' },
  { id: '#0d9488', label: 'Petrol' },
  { id: '#16a34a', label: 'Grün' },
  { id: '#7c3aed', label: 'Violett' },
  { id: '#0891b2', label: 'Türkis' },
  { id: '#d4b106', label: 'Gelb' },
  { id: '#c026d3', label: 'Magenta' },
  { id: '#4f46e5', label: 'Indigo' },
  { id: '#65a30d', label: 'Hellgrün' },
  { id: '#0284c7', label: 'Himmelblau' },
  { id: '#8b5e3c', label: 'Braun' },
  { id: '#64748b', label: 'Schiefergrau' },
];
const IDS = PROJECT_COLORS.map((c) => c.id);

/** Stil mit der Farbe als CSS-Variable --pc (Klassen pc-stripe, pc-dot) */
export const pcStyle = (c: string) => ({ '--pc': c }) as CSSProperties;

/** feste Farbe aus einem Schlüssel (Projekt-ID bzw. Name einer freien Baustelle) */
export function hashColor(key: string): string {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return IDS[(h >>> 0) % IDS.length];
}

export const projectColor = (p: Pick<Project, 'id' | 'color'>) => (p.color && IDS.includes(p.color) ? p.color : hashColor(p.id));

export const colorLabel = (c: string) => PROJECT_COLORS.find((x) => x.id === c)?.label ?? c;

/** Farbe für ein neues Projekt: die unter den vorhandenen am seltensten benutzte (bei Gleichstand die erste) */
export function nextProjectColor(existing: Pick<Project, 'id' | 'color' | 'deletedAt'>[]): string {
  const count = new Map(IDS.map((c) => [c, 0]));
  for (const p of existing) if (!p.deletedAt) count.set(projectColor(p), (count.get(projectColor(p)) ?? 0) + 1);
  return IDS.reduce((best, c) => ((count.get(c) ?? 0) < (count.get(best) ?? 0) ? c : best), IDS[0]);
}

/** Baustellen-Schlüssel „p:<Projekt-ID>“ / „n:<name>“ bzw. Projekt-ID → Farbe */
export function siteColor(key: string | null | undefined, colors: Map<string, string>): string {
  if (!key) return IDS[IDS.length - 1];
  const id = key.startsWith('p:') ? key.slice(2) : key.startsWith('n:') ? null : key;
  if (id) return colors.get(id) ?? hashColor(id);
  return hashColor(key);
}

/* ───────────── Hook: Farben aller Projekte (lädt bei Abgleich neu) ───────────── */

let cache: Map<string, string> | null = null;
const listeners = new Set<(m: Map<string, string>) => void>();

async function load(): Promise<Map<string, string>> {
  const { listProjects } = await import('./db');
  const m = new Map((await listProjects()).map((p) => [p.id, projectColor(p)]));
  cache = m;
  for (const l of listeners) l(m);
  return m;
}

/** nach dem Speichern einer Farbe sofort überall nachziehen */
export const refreshProjectColors = () => void load().catch(() => {});

if (typeof window !== 'undefined') window.addEventListener('baupad:data', refreshProjectColors);

/** Funktion Schlüssel/Projekt-ID → Farbe; freie Baustellen bekommen eine feste Farbe aus dem Namen */
export function useProjectColors(): (key: string | null | undefined) => string {
  const [m, setM] = useState<Map<string, string>>(() => cache ?? new Map());
  useEffect(() => {
    listeners.add(setM);
    // bei jedem Seitenaufruf frisch laden (neue Projekte, andere Geräte); bis dahin der letzte Stand
    void load().catch(() => {});
    return () => void listeners.delete(setM);
  }, []);
  return (key) => siteColor(key, m);
}
