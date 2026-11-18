import { paths } from '../../lib/router';
import { contactData } from '../contact-data';
import { useLang } from '../i18n';
import { organizationJsonLd, siteAlternates } from '../seo';
import { SiteLayout } from '../components/SiteShell';

/** Über uns – schlicht: wer PAD Software ist, wofür wir stehen, Technik, Kontakt */
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
      className="ps-company"
    >
      <p className="ps-eyebrow">{t.nav.company}</p>
      <h1 id="ps-company-title">{c.hero.title.join(' ')}</h1>
      <p>{c.hero.lead}</p>

      <section id="werte" aria-labelledby="ab-values">
        <h2 id="ab-values">{a.title}</h2>
        <ul data-testid="values">
          {a.values.map((v) => (
            <li key={v.title}>
              <h3>{v.title}</h3>
              <p>{v.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section id="technologie" aria-labelledby="ab-tech">
        <h2 id="ab-tech">{x.title}</h2>
        <ul data-testid="tech">
          {x.items.map((it) => (
            <li key={it.title}>
              <h3>{it.title}</h3>
              <p>{it.text}</p>
            </li>
          ))}
        </ul>
        <p>{x.note}</p>
      </section>

      <section id="kontakt" aria-labelledby="ab-contact">
        <h2 id="ab-contact">{k.title}</h2>
        <p>{k.text}</p>
        <p className="ps-links">
          <a href={paths.contact(lang)} data-testid="cta-contact-2">
            {k.primary}
          </a>
          <a href={paths.products(lang)} data-testid="cta-products">
            {k.secondary}
          </a>
        </p>
      </section>
    </SiteLayout>
  );
}
