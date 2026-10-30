// Nach „vite build“: Website-Seiten vorrendern (je Adresse eine index.html mit Titel, Beschreibung,
// canonical, hreflang, Open Graph und JSON-LD), dazu sitemap.xml, robots.txt und 404.html.
// Die App (Werkzeuge) bleibt eine Einzelseiten-Anwendung: unbekannte Adressen liefert GitHub Pages über 404.html.
// Aufruf: node --experimental-strip-types scripts/prerender-site.mjs   (läuft im Build-Skript)
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { de } from '../src/site/i18n/de.ts';
import { en } from '../src/site/i18n/en.ts';
import { PRODUCT_SLUG_OF, SITE_SLUGS, sitePath } from '../src/lib/router.ts';
import { contactData } from '../src/site/contact-data.ts';

const ORIGIN = 'https://pad-software.at';
const dist = join(fileURLToPath(new URL('..', import.meta.url)), 'dist');
const LANGS = ['de', 'en'];
const DICT = { de, en };

/** @returns {{path:string, lang:string, title:string, description:string, alternates:Record<string,string>, jsonLd:object[], noindex?:boolean}[]} */
function routes() {
  const out = [];
  const org = { '@context': 'https://schema.org', '@type': 'Organization', name: 'PAD Software', url: ORIGIN, email: contactData.email, logo: `${ORIGIN}/icons/icon-512.png`, areaServed: 'AT' };
  const sw = (lang, description) => ({ '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: 'BauPad', applicationCategory: 'BusinessApplication', operatingSystem: 'Web, iOS, Android, Windows, macOS', url: `${ORIGIN}${lang === 'en' ? '/en' : ''}/baupad`, description, publisher: { '@type': 'Organization', name: 'PAD Software', url: ORIGIN }, inLanguage: lang });
  const meta = (lang, t) => ({
    landing: [t.home.title, t.home.description, [org, sw(lang, t.baupad.description)]],
    products: [t.products.title, t.products.description, []],
    baupad: [t.baupad.title, t.baupad.description, [sw(lang, t.baupad.description)]],
    company: [t.companyPage.title, t.companyPage.description, [org]],
    contact: [t.contactPage.title, t.contactPage.description, [org]],
    thanks: [t.contactPage.thanks.title, t.contactPage.thanks.text, [], true],
    future: [t.futurePage.title, t.futurePage.description, []],
    imprint: [t.legal.imprint.title, t.legal.imprint.description, []],
    privacy: [t.legal.privacy.title, t.legal.privacy.description, []],
    deleteAccountInfo: [t.legal.deleteAccount.title, t.legal.deleteAccount.description, []],
  });
  for (const lang of LANGS) {
    const t = DICT[lang];
    const m = meta(lang, t);
    for (const name of Object.keys(SITE_SLUGS[lang])) {
      const [title, description, jsonLd, noindex] = m[name];
      out.push({ path: sitePath(name, lang), lang, title, description, jsonLd, noindex, alternates: Object.fromEntries(LANGS.map((l) => [l, sitePath(name, l)])) });
    }
    for (const [id, slug] of Object.entries(PRODUCT_SLUG_OF)) {
      const tool = t.tools[id];
      const p = (l) => `${l === 'en' ? '/en' : ''}/baupad/${slug}`;
      out.push({ path: p(lang), lang, title: `${tool.title}${t.tool.titleSuffix}`, description: tool.tagline, jsonLd: [], alternates: Object.fromEntries(LANGS.map((l) => [l, p(l)])) });
    }
  }
  return out;
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function render(base, r) {
  const own = ORIGIN + r.path;
  const head = [
    `<title>${esc(r.title)}</title>`,
    `<meta name="description" content="${esc(r.description)}" />`,
    r.noindex ? '<meta name="robots" content="noindex" />' : '',
    `<link rel="canonical" href="${own}" />`,
    ...LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${ORIGIN + r.alternates[l]}" />`),
    `<link rel="alternate" hreflang="x-default" href="${ORIGIN + r.alternates.de}" />`,
    `<meta property="og:title" content="${esc(r.title)}" />`,
    `<meta property="og:description" content="${esc(r.description)}" />`,
    `<meta property="og:url" content="${own}" />`,
    '<meta property="og:type" content="website" />',
    '<meta property="og:site_name" content="PAD Software" />',
    `<meta property="og:locale" content="${r.lang === 'de' ? 'de_AT' : 'en_GB'}" />`,
    `<meta property="og:image" content="${ORIGIN}/og-image.png" />`,
    '<meta name="twitter:card" content="summary_large_image" />',
    ...r.jsonLd.map((o) => `<script type="application/ld+json" data-jsonld="1">${JSON.stringify(o)}</script>`),
  ]
    .filter(Boolean)
    .join('\n    ');
  let html = base.replace(/<html lang="[^"]*"/, `<html lang="${r.lang}"`);
  html = html.replace(/<title>[^<]*<\/title>/, '').replace(/<meta name="description"[^>]*>\n?/, '');
  html = html.replace('</head>', `    ${head}\n  </head>`);
  return html;
}

async function main() {
  const base = await readFile(join(dist, 'index.html'), 'utf8');
  const rs = routes();
  for (const r of rs) {
    const dir = join(dist, r.path.replace(/^\//, ''));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'index.html'), render(base, r));
  }
  // Fallback für alle anderen Adressen (App-Routen): GitHub Pages liefert 404.html mit der App
  await copyFile(join(dist, 'index.html'), join(dist, '404.html'));
  // Sitemap mit Sprachalternativen (ohne Danke-Seite)
  const urls = rs
    .filter((r) => !r.noindex)
    .map(
      (r) =>
        `  <url>\n    <loc>${ORIGIN + r.path}</loc>\n` +
        LANGS.map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${ORIGIN + r.alternates[l]}" />`).join('\n') +
        `\n    <xhtml:link rel="alternate" hreflang="x-default" href="${ORIGIN + r.alternates.de}" />\n  </url>`,
    )
    .join('\n');
  await writeFile(join(dist, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls}\n</urlset>\n`);
  await writeFile(
    join(dist, 'robots.txt'),
    ['User-agent: *', 'Allow: /', '# Werkzeuge der App (nur mit Anmeldung)', ...['/tools', '/projekte', '/arbeitereinteilung', '/berichte', '/fotos', '/maengel', '/konto', '/anmelden', '/registrieren', '/passwort-neu', '/p/'].map((p) => `Disallow: ${p}`), '', `Sitemap: ${ORIGIN}/sitemap.xml`, ''].join('\n'),
  );
  console.log(`prerender: ${rs.length} Seiten, sitemap.xml, robots.txt, 404.html`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
