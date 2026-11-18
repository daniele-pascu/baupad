import { paths } from '../../lib/router';
import { contactData } from '../contact-data';
import { useLang } from '../i18n';
import { TOOL_ENTRIES, toolPath } from '../products';
import { organizationJsonLd, siteAlternates, softwareJsonLd } from '../seo';
import { SiteLayout } from '../components/SiteShell';

/**
 * Startseite PAD Software – schlicht, nur Inhalt: wer wir sind, BauPad, die sieben Werkzeuge, wie wir entwickeln, Kontakt.
 * Keine Bilder, keine Animationen (Gestaltung kommt Schritt für Schritt dazu).
 */
export function HomePage() {
  const { lang, t } = useLang();
  const h = t.home;
  const w = h.product.wall;
  return (
    <SiteLayout
      meta={{
        title: h.title,
        description: h.description,
        lang,
        alternates: siteAlternates('landing'),
        jsonLd: [organizationJsonLd(contactData.email), softwareJsonLd(lang, t.baupad.description)],
      }}
      className="ps-home"
    >
      <section aria-labelledby="ph-title">
        <p className="ps-eyebrow">{h.hero.eyebrow}</p>
        <h1 id="ph-title">{h.hero.name}</h1>
        <p className="ps-motto" data-testid="home-motto">
          {h.hero.motto.map((m) => (
            <span key={m}>{m}</span>
          ))}
        </p>
        <p>{h.hero.lead}</p>
        <p className="ps-links">
          <a href="#loesungen" data-testid="cta-solutions">
            {h.hero.primary}
          </a>
          <a href={paths.company(lang)} data-testid="cta-company">
            {h.hero.secondary}
          </a>
        </p>
      </section>

      <section id="loesungen" aria-labelledby="ph-bp-title">
        <p className="ps-eyebrow">{h.product.tag}</p>
        <h2 id="ph-bp-title">{h.product.name}</h2>
        <p>
          <strong>{h.product.tagline}</strong>
        </p>
        <p>{h.product.solves}</p>
        <ul data-testid="home-can">
          {h.product.can.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <p className="ps-links">
          <a href={paths.baupad(lang)} data-testid="home-product">
            {h.product.cta}
          </a>
          <a href={paths.tools()} data-testid="home-open">
            {h.product.open}
          </a>
        </p>
      </section>

      <section aria-labelledby="ph-tools-title" data-testid="home-tool-list">
        <h2 id="ph-tools-title">{w.final.join('')}</h2>
        <p>{w.finalText}</p>
        <ul>
          {TOOL_ENTRIES.map((x) => (
            <li key={x.id}>
              <a href={toolPath(x.id, lang)}>{t.tools[x.id].title}</a> – {t.tools[x.id].short}
            </li>
          ))}
        </ul>
        <p className="ps-links">
          <a href={paths.baupad(lang)} data-testid="home-tools">
            {h.product.all}
          </a>
        </p>
        <p>
          {h.product.more} ({h.product.moreTag})
        </p>
      </section>

      <section id="entwicklung" aria-labelledby="ph-process-title">
        <h2 id="ph-process-title">{h.process.title}</h2>
        <ol className="ps-steps" data-testid="home-steps">
          {h.process.steps.map((s) => (
            <li key={s.title}>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="kontakt" aria-labelledby="ph-contact-title">
        <h2 id="ph-contact-title">{h.contact.title}</h2>
        <p>{h.contact.text}</p>
        <p className="ps-links">
          <a href={paths.contact(lang)} data-testid="cta-contact-2">
            {h.contact.primary}
          </a>
          <a href={paths.products(lang)} data-testid="cta-products">
            {h.contact.secondary}
          </a>
        </p>
      </section>
    </SiteLayout>
  );
}
