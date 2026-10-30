import { Icon } from '../../components/Icon';
import { paths } from '../../lib/router';
import { useLang } from '../i18n';
import { siteAlternates } from '../seo';
import { Reveal } from '../components/Reveal';
import { Badge, Lines, Section, SectionHead } from '../components/Section';
import { Backdrop } from '../components/Shapes';
import { Panel } from '../components/Stage';
import { SiteLayout } from '../components/SiteShell';

/** Zukunft: Vorhaben als Vorschau, eindeutig als Planung gekennzeichnet, ohne Namen und Termine */
export function FuturePage() {
  const { lang, t } = useLang();
  const f = t.futurePage;
  return (
    <SiteLayout meta={{ title: f.title, description: f.description, lang, alternates: siteAlternates('future') }}>
      <section className="ps-hero ps-hero-sm tone-midnight" aria-labelledby="ps-future-title">
        <Backdrop variant="hero" />
        <div className="ps-wrap">
          <p className="ps-eyebrow ps-eyebrow-light">{f.hero.eyebrow}</p>
          <h1 id="ps-future-title" className="ps-display ps-display-sm">
            <Lines lines={f.hero.title} />
          </h1>
          <p className="ps-lead ps-lead-light" data-reveal="">
            {f.hero.lead}
          </p>
        </div>
      </section>

      <Section tone="white">
        <div className="ps-future-list" data-testid="future-list">
          {f.items.map((it, i) => (
            <Reveal key={it.title} delay={i * 80} as="article" className="ps-future-item">
              <div className="ps-future-copy">
                <Badge kind="plan">{f.badge}</Badge>
                <h2>{it.title}</h2>
                <p>{it.text}</p>
              </div>
              <div className="ps-future-visual" aria-hidden="true">
                <Panel kind={(['photos', 'tools', 'report'] as const)[i % 3]} placeholderLabel={t.common.placeholder} />
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal>
          <p className="ps-note">{f.note}</p>
        </Reveal>
      </Section>

      <Section tone="navy" className="ps-contact-cta">
        <Backdrop variant="contact" />
        <SectionHead title={f.cta.title} text={f.cta.text} align="center" />
        <Reveal className="ps-actions ps-actions-center">
          <a href={paths.contact(lang)} className="ps-btn ps-btn-light ps-btn-lg">
            {f.cta.button} <Icon name="next" size={16} />
          </a>
        </Reveal>
      </Section>
    </SiteLayout>
  );
}
