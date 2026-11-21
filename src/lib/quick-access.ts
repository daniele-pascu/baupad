import { useEffect, useState } from 'react';
import type { Route } from './router';
import { paths } from './router';
import { useSession } from './use-session';

/**
 * Schnellzugriff auf der Tools-Seite: zuletzt geöffnete Baustellen je Tool („AUFMASS · Rohbau Müller“) und
 * angeheftete Projekte (im Projektregister mit der Nadel). Je angemeldeter Person auf diesem Gerät gemerkt
 * (wie die Sortierung der Listen) – jede Person auf demselben Gerät hat ihren eigenen Schnellzugriff.
 */

/** Tools, die eine einzelne Baustelle öffnen (Team und Zeiten zeigen immer alle Baustellen) */
export type QuickTool = 'projects' | 'photos' | 'reports' | 'defects' | 'materials';
export const QUICK_TOOLS: QuickTool[] = ['projects', 'photos', 'reports', 'defects', 'materials'];
export const QUICK_TOOL_LABEL: Record<QuickTool, string> = { projects: 'Aufmaß', photos: 'Fotos', reports: 'Berichte', defects: 'Mängel', materials: 'Material' };

/** zuletzt geöffnet: Tool + Baustelle (Schlüssel „p:<Projekt-ID>“ bzw. „n:<Name>“) */
export interface RecentEntry {
  tool: QuickTool;
  key: string;
  at: number;
}

/** so viele zuletzt geöffnete Einträge werden gemerkt */
export const RECENT_MAX = 20;

const recentKey = (user: string) => `quick:recent:${user}`;
const pinKey = (user: string) => `quick:pins:${user}`;
const EVT = 'baupad:quick';

/** Tool und Baustelle einer Seite – nur Seiten, die eine Baustelle in einem Tool zeigen */
export function quickOfRoute(r: Route): { tool: QuickTool; key: string } | null {
  switch (r.name) {
    case 'project':
    case 'plan':
    case 'costCenter':
      return { tool: 'projects', key: `p:${r.projectId}` };
    case 'photoSite':
      return { tool: 'photos', key: r.siteKey };
    case 'reportSite':
      return { tool: 'reports', key: r.siteKey };
    case 'defectSite':
      return { tool: 'defects', key: r.siteKey };
    case 'materialSite':
      return { tool: 'materials', key: `p:${r.projectId}` };
    default:
      return null;
  }
}

/** Adresse eines Eintrags (Baustelle im Tool öffnen); null = Tool kennt solche Baustellen nicht */
export function quickPath(tool: QuickTool, key: string): string | null {
  const pid = key.startsWith('p:') ? key.slice(2) : null;
  switch (tool) {
    case 'projects':
      return pid ? paths.project(pid) : null;
    case 'materials':
      return pid ? paths.materialSite(pid) : null;
    case 'photos':
      return paths.photoSite(key);
    case 'reports':
      return paths.reportSite(key);
    case 'defects':
      return paths.defectSite(key);
  }
}

function readList<T>(k: string, ok: (x: unknown) => x is T): T[] {
  try {
    const v = JSON.parse(localStorage.getItem(k) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter(ok) : [];
  } catch {
    return [];
  }
}
function writeList(k: string, v: unknown[]) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* privater Modus: nur für diese Sitzung */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVT));
}
const isEntry = (x: unknown): x is RecentEntry => {
  const e = x as RecentEntry;
  return !!e && QUICK_TOOLS.includes(e.tool) && typeof e.key === 'string' && /^[pn]:./.test(e.key) && typeof e.at === 'number';
};
const isId = (x: unknown): x is string => typeof x === 'string' && x.length > 0;

/** zuletzt geöffnet (neueste zuerst) */
export const readRecent = (user: string) => readList(recentKey(user), isEntry).sort((a, b) => b.at - a.at);
/** angeheftete Projekte (Projekt-IDs, in der Reihenfolge des Anheftens) */
export const readPins = (user: string) => readList(pinKey(user), isId);

/** Baustelle in einem Tool geöffnet: nach vorn, doppelte Einträge fallen weg, höchstens RECENT_MAX */
export function withRecent(list: RecentEntry[], e: RecentEntry): RecentEntry[] {
  return [e, ...list.filter((x) => !(x.tool === e.tool && x.key === e.key))].slice(0, RECENT_MAX);
}
export function recordRecent(user: string, tool: QuickTool, key: string, at = Date.now()) {
  const list = readRecent(user);
  // gleiche Seite gleich wieder (z. B. Plan → zurück zum Projekt): nichts ändern
  if (list[0]?.tool === tool && list[0]?.key === key && at - list[0].at < 60_000) return;
  writeList(recentKey(user), withRecent(list, { tool, key, at }));
}

/** Projekt anheften bzw. lösen; liefert true, wenn es jetzt angeheftet ist */
export function togglePin(user: string, projectId: string): boolean {
  const pins = readPins(user);
  const on = !pins.includes(projectId);
  writeList(pinKey(user), on ? [...pins, projectId] : pins.filter((id) => id !== projectId));
  return on;
}

/** Kennung der angemeldeten Person für den Schnellzugriff (ohne Anmeldung: dieses Gerät) */
export function useQuickUser(): string {
  const session = useSession();
  return session?.userId ?? 'local';
}

/** App: geöffnete Baustelle eines Tools merken (einmal je Seitenwechsel) */
export function useRecordRecent(r: Route) {
  const session = useSession();
  const q = quickOfRoute(r);
  const id = q ? `${q.tool}|${q.key}` : '';
  useEffect(() => {
    if (q && session !== undefined) recordRecent(session?.userId ?? 'local', q.tool, q.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, session?.userId, session === undefined]);
}

/** zuletzt geöffnet + angeheftet der angemeldeten Person; aktualisiert sich bei jeder Änderung */
export function useQuickAccess(): { user: string; recent: RecentEntry[]; pins: string[] } {
  const user = useQuickUser();
  const load = () => ({ recent: readRecent(user), pins: readPins(user) });
  const [state, setState] = useState(load);
  useEffect(() => {
    setState(load());
    const on = () => setState(load());
    window.addEventListener(EVT, on);
    window.addEventListener('storage', on);
    return () => {
      window.removeEventListener(EVT, on);
      window.removeEventListener('storage', on);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);
  return { user, ...state };
}

/** ein Eintrag im Schnellzugriff */
export interface QuickItem {
  tool: QuickTool;
  key: string;
  name: string;
  href: string;
  pinned: boolean;
}

/**
 * Einträge des Schnellzugriffs: zuerst die angehefteten Projekte (im zuletzt dafür genutzten Tool, sonst im ersten
 * Tool, in dem das Projekt ist), danach die zuletzt geöffneten Baustellen. Nur, was die Person öffnen darf.
 */
export function quickItems(opts: {
  recent: RecentEntry[];
  pins: string[];
  /** Name einer Baustelle (null = gibt es nicht mehr bzw. nicht freigegeben) */
  nameOf(key: string): string | null;
  /** Tools des Projekts laut Register */
  toolsOf(projectId: string): string[];
  canTool(tool: QuickTool): boolean;
  max?: number;
}): QuickItem[] {
  const { recent, pins, nameOf, toolsOf, canTool, max = 10 } = opts;
  const out: QuickItem[] = [];
  const seen = new Set<string>();
  const add = (tool: QuickTool, key: string, pinned: boolean) => {
    const id = `${tool}|${key}`;
    if (seen.has(id) || !canTool(tool)) return;
    const name = nameOf(key);
    const href = quickPath(tool, key);
    if (!name || !href) return;
    seen.add(id);
    out.push({ tool, key, name, href, pinned });
  };
  for (const pid of pins) {
    const key = `p:${pid}`;
    const last = recent.find((e) => e.key === key && canTool(e.tool));
    const tool = last?.tool ?? QUICK_TOOLS.find((t) => toolsOf(pid).includes(t) && canTool(t));
    if (tool) add(tool, key, true);
  }
  for (const e of recent) add(e.tool, e.key, false);
  return out.slice(0, max);
}
