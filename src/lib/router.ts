import { useSyncExternalStore } from 'react';

/** Einfacher Hash-Router – funktioniert auf jedem statischen Webspace und offline. */

export type Route =
  | { name: 'landing' }
  | { name: 'about' }
  | { name: 'contact' }
  | { name: 'projects' }
  | { name: 'tools' }
  | { name: 'workers' }
  | { name: 'login' }
  | { name: 'account' }
  | { name: 'project'; projectId: string }
  | { name: 'costCenter'; projectId: string; costCenterId: string }
  | { name: 'plan'; projectId: string; planId: string; damageId: string | null }
  | { name: 'notFound' };

export function parseRoute(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#/, '').split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const params = new URLSearchParams(query);
  if (parts.length === 0) return { name: 'landing' };
  if (parts[0] === 'ueber' && parts.length === 1) return { name: 'about' };
  if (parts[0] === 'kontakt' && parts.length === 1) return { name: 'contact' };
  if (parts[0] === 'projekte' && parts.length === 1) return { name: 'projects' };
  if (parts[0] === 'tools' && parts.length === 1) return { name: 'tools' };
  if (parts[0] === 'arbeitereinteilung' && parts.length === 1) return { name: 'workers' };
  if (parts[0] === 'anmelden' && parts.length === 1) return { name: 'login' };
  if (parts[0] === 'konto' && parts.length === 1) return { name: 'account' };
  if (parts[0] === 'p' && parts.length === 2) return { name: 'project', projectId: parts[1] };
  if (parts[0] === 'p' && parts[2] === 'k' && parts.length === 4)
    return { name: 'costCenter', projectId: parts[1], costCenterId: parts[3] };
  if (parts[0] === 'p' && parts[2] === 'plan' && parts.length === 4)
    return { name: 'plan', projectId: parts[1], planId: parts[3], damageId: params.get('d') };
  return { name: 'notFound' };
}

export const paths = {
  landing: () => '#/',
  about: () => '#/ueber',
  contact: () => '#/kontakt',
  /** Projektverwaltung */
  projects: () => '#/projekte',
  /** Start nach der Anmeldung: Übersicht aller Werkzeuge (Kacheln) */
  tools: () => '#/tools',
  /** Arbeitereinteilung (Wochenplanung nach Baustellen) */
  workers: () => '#/arbeitereinteilung',
  /** Anmeldeseite (Benutzerkonten noch nicht eingerichtet) */
  login: () => '#/anmelden',
  /** Konto und Einstellungen (Vorschau der geplanten Bereiche) */
  account: () => '#/konto',
  project: (pid: string) => `#/p/${pid}`,
  costCenter: (pid: string, cid: string) => `#/p/${pid}/k/${cid}`,
  plan: (pid: string, planId: string, damageId?: string) => `#/p/${pid}/plan/${planId}${damageId ? `?d=${damageId}` : ''}`,
};

export function navigate(hash: string, replace = false) {
  if (replace) history.replaceState(null, '', hash);
  else location.hash = hash;
  if (replace) window.dispatchEvent(new HashChangeEvent('hashchange'));
}

const subscribe = (l: () => void) => {
  window.addEventListener('hashchange', l);
  return () => window.removeEventListener('hashchange', l);
};

export function useHash(): string {
  return useSyncExternalStore(subscribe, () => location.hash);
}
