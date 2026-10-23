import { useSyncExternalStore } from 'react';

/** Einfacher Hash-Router – funktioniert auf jedem statischen Webspace und offline. */

export type Route =
  | { name: 'home' }
  | { name: 'project'; projectId: string }
  | { name: 'costCenter'; projectId: string; costCenterId: string }
  | { name: 'plan'; projectId: string; planId: string; damageId: string | null }
  | { name: 'notFound' };

export function parseRoute(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#/, '').split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const params = new URLSearchParams(query);
  if (parts.length === 0) return { name: 'home' };
  if (parts[0] === 'p' && parts.length === 2) return { name: 'project', projectId: parts[1] };
  if (parts[0] === 'p' && parts[2] === 'k' && parts.length === 4)
    return { name: 'costCenter', projectId: parts[1], costCenterId: parts[3] };
  if (parts[0] === 'p' && parts[2] === 'plan' && parts.length === 4)
    return { name: 'plan', projectId: parts[1], planId: parts[3], damageId: params.get('d') };
  return { name: 'notFound' };
}

export const paths = {
  home: () => '#/',
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
