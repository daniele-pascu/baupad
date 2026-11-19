import { paths } from '../../lib/router';
import { contactData } from '../contact-data';
import { useLang } from '../i18n';
import { organizationJsonLd, siteAlternates } from '../seo';
import { SiteLayout } from '../components/SiteShell';

/**
 * Über uns – im Stil der Startseite: schwarzer Kopf mit Titel und Tasten, darunter Fenster aus hellem Glas
 * (Wofür wir stehen, Technik) und Kontakt frei auf dem hellen Grund. Texte bleiben schlicht.
 */
export function CompanyPage() {
  const { lang, t } = useLang();
  const c = t.companyPage;
  const a = t.home.about;
  const x = t.home.tech;
  const k = t.home.contact;
  return (
    <SiteLayout
      meta={{
        title: c.title,
        description: c.description,
        lang,
        alternates: siteAlternates('company'),
        jsonLd: [organizationJsonLd(contactData.email)],
      }}
      className="ps-home ps-subpage ps-company"
      top={
        <div className="ph-top" data-dark-top="">
          <section className="ph-hero" aria-labelledby="ps-company-title">
            <p className="ps-eyebrow">{t.nav.company}</p>
            <h1 id="ps-company-title">
              {c.hero.title[0]} <span>{c.hero.title[1]}</span>
            </h1>
            <p className="ph-lead">{c.hero.lead}</p>
            <p className="ph-btns">
              <a href={paths.contact(lang)} className="ph-b1">
                {k.primary}
              </a>
              <a href={paths.products(lang)} className="ph-b2">
                {k.secondary}
              </a>
            </p>
          </section>
        </div>
      }
    >
      <section id="werte" className="ph-win" aria-labelledby="ab-values">
        <p className="ps-eyebrow">{a.label}</p>
        <h2 id="ab-values">{a.title}</h2>
        <ul className="ph-cards" data-testid="values">
          {a.values.map((v) => (
            <li key={v.title}>
              <h3>{v.title}</h3>
              <p>{v.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section id="technologie" className="ph-win" aria-labelledby="ab-tech">
        <p className="ps-eyebrow">{x.label}</p>
        <h2 id="ab-tech">{x.title}</h2>
        <ul className="ph-cards" data-testid="tech">
          {x.items.map((it) => (
            <li key={it.title}>
              <h3>{it.title}</h3>
              <p>{it.text}</p>
            </li>
          ))}
        </ul>
        <p className="ph-note">{x.note}</p>
      </section>

      <section id="kontakt" className="ph-sec" aria-labelledby="ab-contact">
        <p className="ps-eyebrow">{k.label}</p>
        <h2 id="ab-contact">{k.title}</h2>
        <p>{k.text}</p>
        <p className="ph-btns">
          <a href={paths.contact(lang)} className="ph-b1" data-testid="cta-contact-2">
            {k.primary}
          </a>
          <a href={paths.products(lang)} className="ph-b2" data-testid="cta-products">
            {k.secondary}
          </a>
        </p>
      </section>
    </SiteLayout>
  );
}
