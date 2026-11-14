import { paths } from '../../lib/router';
import { contactData } from '../contact-data';
import { useLang } from '../i18n';
import { organizationJsonLd, siteAlternates } from '../seo';
import { TechSection, ValuesSection } from '../components/CompanySections';
import { Reveal } from '../components/Reveal';
import { SiteLayout } from '../components/SiteShell';

/** Über uns: wer PAD Software ist (kurz), wofür wir stehen, Technik und Infrastruktur, Kontakt – im Stil der Startseite */
export function CompanyPage() {
  const { lang, t } = useLang();
  const c = t.companyPage;
  const k = t.home.contact;
  return (
    <SiteLayout meta={{ title: c.title, description: c.description, lang, alternates: siteAlternates('company'), jsonLd: [organizationJsonLd(contactData.email)] }} className="ph ab">
      <section className="ab-hero" aria-labelledby="ps-company-title">
        <div className="ph-w">
          <p className="ph-mono ph-eye">{t.nav.company}</p>
          <h1 id="ps-company-title" className="ab-h1">
            {c.hero.title[0]} <em>{c.hero.title[1]}</em>
          </h1>
          <p className="ab-lead">{c.hero.lead}</p>
        </div>
      </section>

      <ValuesSection />
      <TechSection />

      <section className="ph-cta" id="kontakt">
        <div className="ph-w">
          <Reveal>
            <h2 className="ph-h2">{k.title}</h2>
            <p>{k.text}</p>
          </Reveal>
          <div className="ph-btns">
            <a href={paths.contact(lang)} className="ph-btn ph-btn-black" data-testid="cta-contact-2">
              {k.primary}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </a>
            <a href={paths.products(lang)} className="ph-btn ph-btn-dark-line" data-testid="cta-products">
              {k.secondary}
            </a>
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}
