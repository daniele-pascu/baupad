import { useSyncExternalStore } from 'react';

/**
 * Router mit sauberen Adressen (History API): „/baupad“, „/kontakt“, „/en/contact“, „/tools“ …
 * – Website-Seiten gibt es auf Deutsch (ohne Präfix) und Englisch („/en/…“), die App bleibt deutsch.
 * – Alte „#/…“-Adressen (Lesezeichen, installierte App, E-Mail-Links) werden beim Laden still umgeschrieben.
 * – Auf GitHub Pages liefert 404.html die App für jede Adresse; Website-Seiten werden zusätzlich vorgerendert.
 */

export type Lang = 'de' | 'en';
export const LANGS: Lang[] = ['de', 'en'];

export type SiteRouteName = 'landing' | 'products' | 'baupad' | 'company' | 'contact' | 'thanks' | 'future' | 'imprint' | 'privacy' | 'deleteAccountInfo';

export type Route =
  | { name: 'landing' }
  | { name: 'products' }
  | { name: 'baupad' }
  | { name: 'company' }
  | { name: 'contact' }
  | { name: 'thanks' }
  | { name: 'future' }
  | { name: 'imprint' }
  | { name: 'privacy' }
  | { name: 'deleteAccountInfo' }
  | { name: 'product'; product: 'projects' | 'workers' | 'reports' | 'photos' | 'defects' }
  | { name: 'projects' }
  | { name: 'tools' }
  | { name: 'workers' }
  | { name: 'reports' }
  | { name: 'report'; reportId: string }
  | { name: 'reportSite'; siteKey: string }
  | { name: 'camera'; siteKey: string | null }
  | { name: 'photos' }
  | { name: 'photoSite'; siteKey: string; week: string | null; photoId: string | null }
  | { name: 'defects' }
  | { name: 'defectSite'; siteKey: string }
  | { name: 'defectPlan'; planId: string; markId: string | null }
  | { name: 'login'; register?: boolean }
  | { name: 'account' }
  | { name: 'accountSection'; section: string }
  | { name: 'newPassword' }
  | { name: 'project'; projectId: string }
  | { name: 'costCenter'; projectId: string; costCenterId: string }
  | { name: 'plan'; projectId: string; planId: string; damageId: string | null }
  | { name: 'notFound' };

/** Adressen der Website je Sprache (ohne führenden Schrägstrich; Englisch bekommt das Präfix „en/“) */
export const SITE_SLUGS: Record<Lang, Record<SiteRouteName, string>> = {
  de: { landing: '', products: 'produkte', baupad: 'baupad', company: 'unternehmen', contact: 'kontakt', thanks: 'kontakt/danke', future: 'zukunft', imprint: 'impressum', privacy: 'datenschutz', deleteAccountInfo: 'konto-loeschen' },
  en: { landing: '', products: 'products', baupad: 'baupad', company: 'company', contact: 'contact', thanks: 'contact/thank-you', future: 'future', imprint: 'imprint', privacy: 'privacy', deleteAccountInfo: 'delete-account' },
};

/** Werkzeug-Seiten unter /baupad/… (in beiden Sprachen gleich) */
export const PRODUCT_SLUGS = { aufmass: 'projects', arbeitereinteilung: 'workers', berichte: 'reports', fotos: 'photos', maengelplan: 'defects' } as const;
export type ProductId = (typeof PRODUCT_SLUGS)[keyof typeof PRODUCT_SLUGS];
export const PRODUCT_SLUG_OF: Record<ProductId, string> = { projects: 'aufmass', workers: 'arbeitereinteilung', reports: 'berichte', photos: 'fotos', defects: 'maengelplan' };

/** Sprache aus der Adresse: „/en/…“ → en, sonst de */
export function langOf(url: string): Lang {
  const path = url.replace(/^#/, '').split('?')[0];
  return /^\/?en(\/|$)/.test(path) ? 'en' : 'de';
}

export function parseRoute(url: string): Route {
  const [rawPath, query = ''] = url.replace(/^#/, '').split('?');
  let parts = rawPath.split('/').filter(Boolean).map(decodeURIComponent);
  const params = new URLSearchParams(query);
  const lang: Lang = parts[0] === 'en' ? 'en' : 'de';
  if (lang === 'en') parts = parts.slice(1);
  const slug = parts.join('/');
  // Website (je Sprache)
  const slugs = SITE_SLUGS[lang];
  for (const name of Object.keys(slugs) as SiteRouteName[]) if (slugs[name] === slug) return { name };
  // frühere Adresse „Über uns“
  if (slug === 'ueber' || slug === 'about') return { name: 'company' };
  if (parts[0] === 'baupad' && parts.length === 2) {
    const product = PRODUCT_SLUGS[parts[1] as keyof typeof PRODUCT_SLUGS];
    if (product) return { name: 'product', product };
  }
  if (lang === 'en') return { name: 'notFound' };
  // App (deutsch)
  if (parts[0] === 'projekte' && parts.length === 1) return { name: 'projects' };
  if (parts[0] === 'tools' && parts.length === 1) return { name: 'tools' };
  if (parts[0] === 'arbeitereinteilung' && parts.length === 1) return { name: 'workers' };
  if (parts[0] === 'berichte' && parts.length === 1) return { name: 'reports' };
  if (parts[0] === 'berichte' && parts[1] === 'b' && parts.length === 3) return { name: 'reportSite', siteKey: parts[2] };
  if (parts[0] === 'berichte' && parts.length === 2) return { name: 'report', reportId: parts[1] };
  if (parts[0] === 'fotos' && parts.length === 1) return { name: 'photos' };
  if (parts[0] === 'fotos' && parts[1] === 'kamera' && parts.length === 2) return { name: 'camera', siteKey: params.get('s') };
  if (parts[0] === 'fotos' && (parts[1] === 'p' || parts[1] === 'n') && parts.length === 3)
    return { name: 'photoSite', siteKey: `${parts[1]}:${parts[2]}`, week: params.get('w'), photoId: params.get('f') };
  if (parts[0] === 'maengel' && parts.length === 1) return { name: 'defects' };
  if (parts[0] === 'maengel' && parts[1] === 'b' && parts.length === 3) return { name: 'defectSite', siteKey: parts[2] };
  if (parts[0] === 'maengel' && parts[1] === 'plan' && parts.length === 3) return { name: 'defectPlan', planId: parts[2], markId: params.get('m') };
  if (parts[0] === 'anmelden' && parts.length === 1) return { name: 'login' };
  if (parts[0] === 'registrieren' && parts.length === 1) return { name: 'login', register: true };
  if (parts[0] === 'konto' && parts.length === 1) return { name: 'account' };
  if (parts[0] === 'konto' && parts.length === 2) return { name: 'accountSection', section: parts[1] };
  if (parts[0] === 'passwort-neu' && parts.length === 1) return { name: 'newPassword' };
  if (parts[0] === 'p' && parts.length === 2) return { name: 'project', projectId: parts[1] };
  if (parts[0] === 'p' && parts[2] === 'k' && parts.length === 4) return { name: 'costCenter', projectId: parts[1], costCenterId: parts[3] };
  if (parts[0] === 'p' && parts[2] === 'plan' && parts.length === 4) return { name: 'plan', projectId: parts[1], planId: parts[3], damageId: params.get('d') };
  return { name: 'notFound' };
}

/** Adresse einer Website-Seite in der gewünschten Sprache */
export function sitePath(name: SiteRouteName, lang: Lang = 'de'): string {
  const slug = SITE_SLUGS[lang][name];
  if (lang === 'en') return slug ? `/en/${slug}` : '/en';
  return `/${slug}`;
}

export const paths = {
  landing: (lang: Lang = 'de') => sitePath('landing', lang),
  products: (lang: Lang = 'de') => sitePath('products', lang),
  baupad: (lang: Lang = 'de') => sitePath('baupad', lang),
  company: (lang: Lang = 'de') => sitePath('company', lang),
  contact: (lang: Lang = 'de') => sitePath('contact', lang),
  thanks: (lang: Lang = 'de') => sitePath('thanks', lang),
  future: (lang: Lang = 'de') => sitePath('future', lang),
  imprint: (lang: Lang = 'de') => sitePath('imprint', lang),
  privacy: (lang: Lang = 'de') => sitePath('privacy', lang),
  deleteAccountInfo: (lang: Lang = 'de') => sitePath('deleteAccountInfo', lang),
  /** frühere Seite „Über uns“ → Unternehmen */
  about: (lang: Lang = 'de') => sitePath('company', lang),
  /** Werkzeug-Seite unter BauPad (Website) */
  product: (slug: string, lang: Lang = 'de') => `${lang === 'en' ? '/en' : ''}/baupad/${slug}`,
  /** Aufmaß & Abrechnung */
  projects: () => '/projekte',
  /** Start nach der Anmeldung: Übersicht aller Werkzeuge (Kacheln) */
  tools: () => '/tools',
  /** Arbeitereinteilung (Wochenplanung nach Baustellen) */
  workers: () => '/arbeitereinteilung',
  /** Berichte & Formulare (Regielisten, Bautages- und Bauwochenberichte) */
  reports: () => '/berichte',
  report: (id: string) => `/berichte/${id}`,
  /** Berichte einer Baustelle (Schlüssel „p:<Projekt-ID>“ bzw. „n:<name>“) */
  reportSite: (key: string) => `/berichte/b/${encodeURIComponent(key)}`,
  /** Fotodokumentation: Übersicht und Baustelle (Schlüssel „p:<Projekt>“ bzw. „n:<Name>“) */
  photos: () => '/fotos',
  defects: () => '/maengel',
  defectSite: (key: string) => `/maengel/b/${encodeURIComponent(key)}`,
  defectPlan: (planId: string, markId?: string | null) => `/maengel/plan/${planId}${markId ? `?m=${encodeURIComponent(markId)}` : ''}`,
  /** Kamera-Modus (Live-Bild, Auslöser) – wahlweise mit vorgewählter Baustelle */
  camera: (siteKey?: string | null) => `/fotos/kamera${siteKey ? `?s=${encodeURIComponent(siteKey)}` : ''}`,
  photoSite: (siteKey: string, opts: { week?: string | null; photoId?: string | null } = {}) => {
    const [kind, ...rest] = siteKey.split(':');
    const q = new URLSearchParams();
    if (opts.week) q.set('w', opts.week);
    if (opts.photoId) q.set('f', opts.photoId);
    const qs = q.toString();
    return `/fotos/${kind}/${encodeURIComponent(rest.join(':'))}${qs ? `?${qs}` : ''}`;
  },
  login: () => '/anmelden',
  register: () => '/registrieren',
  /** Konto und Einstellungen */
  account: () => '/konto',
  /** Bereich der Einstellungen als eigene Seite */
  accountSection: (id: string) => `/konto/${id}`,
  newPassword: () => '/passwort-neu',
  project: (pid: string) => `/p/${pid}`,
  costCenter: (pid: string, cid: string) => `/p/${pid}/k/${cid}`,
  plan: (pid: string, planId: string, damageId?: string) => `/p/${pid}/plan/${planId}${damageId ? `?d=${damageId}` : ''}`,
};

const EVENT = 'baupad:navigate';
const notify = () => window.dispatchEvent(new Event(EVENT));

/**
 * Aktuelle Adresse (Pfad + Abfrage), z. B. „/fotos/kamera?s=p:1“. Eine noch nicht umgeschriebene
 * „#/…“-Adresse zählt bereits als Ziel – so läuft keine Weiterleitung mit dem alten Pfad dazwischen.
 */
export function currentPath(): string {
  if (location.hash.startsWith('#/')) return location.hash.slice(1);
  return location.pathname + location.search;
}

/** Alte „#/…“-Adresse in die saubere Form umschreiben (Lesezeichen, installierte App, Tests) */
function migrateHash(): boolean {
  if (!location.hash.startsWith('#/')) return false;
  const target = location.hash.slice(1);
  history.replaceState(null, '', target);
  return true;
}

export function navigate(path: string, replace = false) {
  // Verträglichkeit: „#/…“ wird weiterhin verstanden
  if (path.startsWith('#')) path = path.slice(1);
  const same = path === currentPath();
  if (replace || same) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  if (!same && !replace) window.scrollTo(0, 0);
  notify();
}

/** Klicks auf interne Links (href „/…“) in der App halten, statt die Seite neu zu laden */
function onClick(e: MouseEvent) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
  if (!a || a.target === '_blank' || a.hasAttribute('download') || a.origin !== location.origin) return;
  const href = a.getAttribute('href') ?? '';
  if (!href.startsWith('/') && !href.startsWith('#/')) return;
  e.preventDefault();
  const path = href.startsWith('#') ? href.slice(1) : href;
  if (path !== currentPath()) navigate(path);
}

if (typeof window !== 'undefined') {
  migrateHash();
  window.addEventListener('hashchange', () => migrateHash() && notify());
  window.addEventListener('popstate', notify);
  document.addEventListener('click', onClick);
}

const subscribe = (l: () => void) => {
  window.addEventListener(EVENT, l);
  window.addEventListener('popstate', l);
  return () => {
    window.removeEventListener(EVENT, l);
    window.removeEventListener('popstate', l);
  };
};

/** aktuelle Adresse als Zustand (reagiert auf Navigation, Zurück/Vor und alte #-Links) */
export function usePath(): string {
  return useSyncExternalStore(subscribe, currentPath);
}

/** @deprecated Name aus der Hash-Zeit; liefert jetzt den Pfad */
export const useHash = usePath;
