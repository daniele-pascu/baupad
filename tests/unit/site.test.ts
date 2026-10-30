import { describe, expect, it } from 'vitest';
import { de } from '../../src/site/i18n/de';
import { en } from '../../src/site/i18n/en';
import { langOf, parseRoute, PRODUCT_SLUG_OF, SITE_SLUGS, sitePath } from '../../src/lib/router';
import { sendContact } from '../../src/site/contact-api';
import { switchLangPath } from '../../src/site/components/SiteShell';

/** Beide Sprachen müssen dieselben Schlüssel haben (keine unvollständige englische Fassung) */
function keys(o: unknown, prefix = ''): string[] {
  if (Array.isArray(o)) return [prefix + '[]'];
  if (o && typeof o === 'object') return Object.entries(o).flatMap(([k, v]) => keys(v, `${prefix}${k}.`));
  return [prefix.slice(0, -1)];
}

describe('Website: Sprachen und Adressen', () => {
  it('Deutsch und Englisch haben denselben Aufbau', () => {
    expect(keys(en).sort()).toEqual(keys(de).sort());
    for (const id of Object.keys(PRODUCT_SLUG_OF) as (keyof typeof de.tools)[]) {
      expect(en.tools[id].groups.length).toBe(de.tools[id].groups.length);
      expect(en.tools[id].points.length).toBe(de.tools[id].points.length);
    }
    expect(en.legal.privacy.sections.length).toBe(de.legal.privacy.sections.length);
  });

  it('Adressen je Sprache werden erkannt und sind umkehrbar', () => {
    for (const lang of ['de', 'en'] as const)
      for (const name of Object.keys(SITE_SLUGS[lang]) as (keyof (typeof SITE_SLUGS)['de'])[]) {
        const p = sitePath(name, lang);
        expect(parseRoute(p)).toEqual({ name });
        expect(langOf(p)).toBe(lang);
      }
    expect(parseRoute('/baupad/fotos')).toEqual({ name: 'product', product: 'photos' });
    expect(parseRoute('/en/baupad/maengelplan')).toEqual({ name: 'product', product: 'defects' });
    expect(parseRoute('#/ueber')).toEqual({ name: 'company' }); // alte Adresse
    expect(parseRoute('#/berichte/b/p%3A1')).toEqual({ name: 'reportSite', siteKey: 'p:1' }); // App bleibt
    expect(parseRoute('/en/tools')).toEqual({ name: 'notFound' }); // App nur deutsch
  });

  it('Sprachumschalter führt zur gleichen Seite', () => {
    expect(switchLangPath('/kontakt', 'en')).toBe('/en/contact');
    expect(switchLangPath('/en/contact/thank-you', 'de')).toBe('/kontakt/danke');
    expect(switchLangPath('/baupad/aufmass', 'en')).toBe('/en/baupad/aufmass');
    expect(switchLangPath('/en', 'de')).toBe('/');
    expect(switchLangPath('/tools', 'en')).toBe('/en');
  });
});

describe('Kontaktformular: Versand', () => {
  const payload = { name: 'A', company: '', email: 'a@b.cd', subject: 'S', message: 'Eine Nachricht.', lang: 'de' as const, website: '', startedAt: 0 };
  const fetchWith = (status: number) => (async () => new Response('{}', { status })) as unknown as typeof fetch;

  it('meldet Erfolg nur bei Antwort 2xx', async () => {
    expect(await sendContact(payload, fetchWith(200))).toEqual({ ok: true });
    expect(await sendContact(payload, fetchWith(501))).toEqual({ ok: false, reason: 'not-configured' });
    expect(await sendContact(payload, fetchWith(422))).toEqual({ ok: false, reason: 'rejected' });
    expect(await sendContact(payload, fetchWith(500))).toEqual({ ok: false, reason: 'failed' });
  });

  it('Netzfehler werden als Fehlschlag gemeldet, nie als Erfolg', async () => {
    const failing = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await sendContact(payload, failing)).toEqual({ ok: false, reason: 'failed' });
  });
});
