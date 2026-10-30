import { useEffect } from 'react';
import { LANGS, sitePath, type Lang, type SiteRouteName } from '../lib/router';

export const SITE_ORIGIN = 'https://pad-software.at';

export interface PageMeta {
  title: string;
  description: string;
  /** Adresse dieser Seite je Sprache (für canonical und hreflang); fehlt eine Sprache, gibt es keine Alternative */
  alternates: Partial<Record<Lang, string>>;
  lang: Lang;
  /** strukturierte Daten (JSON-LD), nur sachlich belegte Angaben */
  jsonLd?: object[];
}

/** Alternativen einer Website-Seite in allen Sprachen */
export function siteAlternates(name: SiteRouteName): Record<Lang, string> {
  return Object.fromEntries(LANGS.map((l) => [l, sitePath(name, l)])) as Record<Lang, string>;
}

function setMeta(selector: string, attrs: Record<string, string>) {
  let el = document.head.querySelector<HTMLElement>(selector);
  if (!el) {
    el = document.createElement(selector.startsWith('link') ? 'link' : 'meta');
    document.head.appendChild(el);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return;
  }
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
}

/** Titel, Beschreibung, canonical, hreflang, Open Graph und JSON-LD der aktuellen Seite setzen (zur Laufzeit) */
export function applyMeta(m: PageMeta) {
  document.title = m.title;
  document.documentElement.lang = m.lang;
  setMeta('meta[name="description"]', { name: 'description', content: m.description });
  const own = m.alternates[m.lang] ?? location.pathname;
  setMeta('link[rel="canonical"]', { rel: 'canonical', href: SITE_ORIGIN + own });
  // hreflang
  document.head.querySelectorAll('link[rel="alternate"][hreflang]').forEach((e) => e.remove());
  for (const l of LANGS) {
    const p = m.alternates[l];
    if (!p) continue;
    const link = document.createElement('link');
    link.rel = 'alternate';
    link.hreflang = l;
    link.href = SITE_ORIGIN + p;
    document.head.appendChild(link);
  }
  if (m.alternates.de) {
    const link = document.createElement('link');
    link.rel = 'alternate';
    link.hreflang = 'x-default';
    link.href = SITE_ORIGIN + m.alternates.de;
    document.head.appendChild(link);
  }
  setMeta('meta[property="og:title"]', { property: 'og:title', content: m.title });
  setMeta('meta[property="og:description"]', { property: 'og:description', content: m.description });
  setMeta('meta[property="og:url"]', { property: 'og:url', content: SITE_ORIGIN + own });
  setMeta('meta[property="og:type"]', { property: 'og:type', content: 'website' });
  setMeta('meta[property="og:site_name"]', { property: 'og:site_name', content: 'PAD Software' });
  setMeta('meta[property="og:locale"]', { property: 'og:locale', content: m.lang === 'de' ? 'de_AT' : 'en_GB' });
  setMeta('meta[property="og:image"]', { property: 'og:image', content: `${SITE_ORIGIN}/og-image.png` });
  setMeta('meta[name="twitter:card"]', { name: 'twitter:card', content: 'summary_large_image' });
  document.head.querySelectorAll('script[data-jsonld]').forEach((e) => e.remove());
  for (const obj of m.jsonLd ?? []) {
    const s = document.createElement('script');
    s.type = 'application/ld+json';
    s.dataset.jsonld = '1';
    s.textContent = JSON.stringify(obj);
    document.head.appendChild(s);
  }
}

/** Meta-Angaben beim Anzeigen einer Seite setzen; beim Verlassen Standardtitel */
export function usePageMeta(m: PageMeta) {
  useEffect(() => {
    applyMeta(m);
    return () => {
      document.title = 'BauPad';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.title, m.description, m.lang, m.alternates.de, m.alternates.en]);
}

/** Organisation (nur belegte Angaben) */
export function organizationJsonLd(email: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'PAD Software',
    url: SITE_ORIGIN,
    email,
    logo: `${SITE_ORIGIN}/icons/icon-512.png`,
    areaServed: 'AT',
  };
}

export function softwareJsonLd(lang: Lang, description: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'BauPad',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web, iOS, Android, Windows, macOS',
    url: `${SITE_ORIGIN}${lang === 'en' ? '/en' : ''}/baupad`,
    description,
    publisher: { '@type': 'Organization', name: 'PAD Software', url: SITE_ORIGIN },
    inLanguage: lang,
  };
}
