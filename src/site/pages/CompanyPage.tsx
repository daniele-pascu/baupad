import { Icon } from '../../components/Icon';
import { contactData } from '../contact-data';
import { useLang } from '../i18n';
import { organizationJsonLd, siteAlternates } from '../seo';
import { Reveal } from '../components/Reveal';
import { Grid, Lines, Section, SectionHead, Statement } from '../components/Section';
import { Backdrop } from '../components/Shapes';
import { SiteLayout } from '../components/SiteShell';

/** Unternehmen: was PAD Software macht, Philosophie, Anspruch, Nutzen, Verbindung zu den Produkten */
export function CompanyPage() {
  const { lang, t } = useLang();
  const c = t.companyPage;
  return (
    <SiteLayout meta={{ title: c.title, description: c.description, lang, alternates: siteAlternates('company'), jsonLd: [organizationJsonLd(contactData.email)] }}>
      <section className="ps-hero ps-hero-sm tone-midnight" aria-labelledby="ps-company-title">
        <Backdrop variant="hero" />
        <div className="ps-wrap">
          <p className="ps-eyebrow ps-eyebrow-light">{c.hero.eyebrow}</p>
          <h1 id="ps-company-title" className="ps-display ps-display-sm">
            <Lines lines={c.hero.title} />
          </h1>
          <p className="ps-lead ps-lead-light" data-reveal="">
            {c.hero.lead}
          </p>
        </div>
      </section>

      <Section tone="white">
        <div className="ps-split ps-split-text">
          <SectionHead eyebrow={c.what.eyebrow} title={c.what.title} />
          <Reveal>
            <p className="ps-lead ps-lead-dark">{c.what.text}</p>
          </Reveal>
        </div>
      </Section>

      <Section tone="mist">
        <SectionHead eyebrow={c.philosophy.eyebrow} title={c.philosophy.title} />
        <Grid cols={3}>
          {c.philosophy.items.map((p, i) => (
            <Statement key={p.title} no={`0${i + 1}`} title={p.title} text={p.text} />
          ))}
        </Grid>
      </Section>

      <Section tone="navy">
        <Backdrop variant="dark" />
        <SectionHead eyebrow={c.standards.eyebrow} title={c.standards.title} />
        <Grid cols={4}>
          {c.standards.items.map((p, i) => (
            <Statement key={p.title} no={`0${i + 1}`} title={p.title} text={p.text} />
          ))}
        </Grid>
      </Section>

      <Section tone="white">
        <div className="ps-split ps-split-text">
          <SectionHead eyebrow={c.value.eyebrow} title={c.value.title} />
          <Reveal>
            <ul className="ps-facts ps-facts-stack">
              {c.value.items.map((f) => (
                <li key={f}>
                  <Icon name="check" size={16} />
                  {f}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </Section>

    </SiteLayout>
  );
}
