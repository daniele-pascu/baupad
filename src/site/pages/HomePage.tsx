import type { CSSProperties } from 'react';
import { Icon } from '../../components/Icon';
import { ToolIcon } from '../../components/ToolIcon';
import { paths } from '../../lib/router';
import { contactData } from '../contact-data';
import { useLang } from '../i18n';
import { PLANNED_COUNT, PRODUCTS, TOOL_ENTRIES, toolPath } from '../products';
import { organizationJsonLd, siteAlternates, softwareJsonLd } from '../seo';
import { Reveal } from '../components/Reveal';
import { Badge, Grid, Lines, Section, SectionHead, Statement } from '../components/Section';
import { Backdrop } from '../components/Shapes';
import { Stage } from '../components/Stage';
import { SiteLayout } from '../components/SiteShell';

/** Startseite: PAD Software als Dachmarke, dann Unternehmen, Produktwelt, BauPad, Ausblick, Haltung, Kontakt */
export function HomePage() {
  const { lang, t } = useLang();
  const h = t.home;
  return (
    <SiteLayout meta={{ title: h.title, description: h.description, lang, alternates: siteAlternates('landing'), jsonLd: [organizationJsonLd(contactData.email), softwareJsonLd(lang, t.baupad.description)] }} className="ps-home">
      {/* 1. Hero */}
      <section className="ps-hero tone-midnight" aria-labelledby="ps-hero-title">
        <Backdrop variant="hero" />
        <div className="ps-wrap ps-hero-inner">
          <p className="ps-eyebrow ps-eyebrow-light ps-reveal is-in">{h.hero.eyebrow}</p>
          <h1 id="ps-hero-title" className="ps-display">
            <Lines lines={h.hero.title} />
          </h1>
          <p className="ps-lead ps-lead-light ps-hero-lead" data-reveal="" data-immediate="">
            {h.hero.lead}
          </p>
          <div className="ps-actions" data-reveal="" data-immediate="">
            <a href={paths.baupad(lang)} className="ps-btn ps-btn-light" data-testid="cta-baupad">
              {h.hero.primary} <Icon name="next" size={16} />
            </a>
            <a href={paths.contact(lang)} className="ps-btn ps-btn-outline" data-testid="cta-contact">
              {h.hero.secondary}
            </a>
          </div>
          <ul className="ps-facts ps-facts-light" data-reveal="" data-immediate="">
            {h.hero.facts.map((f) => (
              <li key={f}>
                <Icon name="check" size={15} />
                {f}
              </li>
            ))}
          </ul>
        </div>
        <div className="ps-hero-stage" aria-hidden="true">
          <Stage main="tools" floats={['plan', 'photos']} placeholderLabel={t.common.placeholder} floatLabel={t.common.placeholderShort} immediate labels={[h.baupad.stageTitle, t.tools.projects.title, t.tools.photos.title]} />
        </div>
      </section>

      {/* 2. Unternehmen */}
      <Section tone="white" id="unternehmen">
        <SectionHead eyebrow={h.intro.eyebrow} title={h.intro.title} text={h.intro.text} />
        <Grid cols={3}>
          {h.intro.points.map((p, i) => (
            <Statement key={p.title} no={`0${i + 1}`} title={p.title} text={p.text} />
          ))}
        </Grid>
        <Reveal className="ps-inline-cta">
          <a href={paths.company(lang)} className="ps-link">
            {t.nav.company} <Icon name="next" size={14} />
          </a>
        </Reveal>
      </Section>

      {/* 3. Produktwelt */}
      <Section tone="mist" id="produkte">
        <SectionHead eyebrow={h.products.eyebrow} title={h.products.title} text={h.products.text} />
        <div className="ps-product-row">
          {PRODUCTS.map((p) => (
            <Reveal key={p.id} className="ps-product-card is-available" as="article">
              <div className="ps-product-card-head">
                <span className="ps-product-mark">{t.product.slice(0, 1)}</span>
                <Badge kind="ok">{t.common.available}</Badge>
              </div>
              <h3>{t.product}</h3>
              <p>{t.baupad.description}</p>
              <div className="ps-tool-dots" aria-hidden="true">
                {p.tools.map((x) => (
                  <span key={x.id} style={{ '--c': x.color } as CSSProperties}>
                    <ToolIcon name={x.icon} size={14} />
                  </span>
                ))}
              </div>
              <a href={p.path(lang)} className="ps-link">
                {t.products.open} <Icon name="next" size={14} />
              </a>
            </Reveal>
          ))}
          {Array.from({ length: PLANNED_COUNT }).map((_, i) => (
            <Reveal key={i} delay={80 * (i + 1)} className="ps-product-card is-planned" as="article">
              <div className="ps-product-card-head">
                <span className="ps-product-mark ps-product-mark-plan">?</span>
                <Badge kind="plan">{t.common.comingSoon}</Badge>
              </div>
              <h3>{t.futurePage.items[i]?.title}</h3>
              <p>{t.futurePage.items[i]?.text}</p>
            </Reveal>
          ))}
        </div>
        <Reveal className="ps-inline-cta">
          <a href={paths.products(lang)} className="ps-btn ps-btn-navy">
            {h.products.cta}
          </a>
        </Reveal>
      </Section>

      {/* 4. BauPad */}
      <Section tone="navy" id="baupad" className="ps-baupad-teaser">
        <Backdrop variant="dark" />
        <div className="ps-split">
          <div>
            <SectionHead eyebrow={h.baupad.eyebrow} title={h.baupad.title} text={h.baupad.text} />
            <ul className="ps-tool-list" data-reveal="">
              {TOOL_ENTRIES.map((x) => (
                <li key={x.id}>
                  <a href={toolPath(x.id, lang)} style={{ '--c': x.color } as CSSProperties}>
                    <span className="ps-tool-icon">
                      <ToolIcon name={x.icon} size={18} />
                    </span>
                    <span>
                      <strong>{t.tools[x.id].title}</strong>
                      <small>{t.tools[x.id].short}</small>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
            <div className="ps-actions" data-reveal="">
              <a href={paths.baupad(lang)} className="ps-btn ps-btn-light" data-testid="cta-baupad-2">
                {h.baupad.cta} <Icon name="next" size={16} />
              </a>
            </div>
          </div>
          <div className="ps-split-stage">
            <Stage main="plan" floats={['week', 'report']} placeholderLabel={t.common.placeholder} floatLabel={t.common.placeholderShort} labels={[t.tools.projects.title, t.tools.workers.title, t.tools.reports.title]} />
          </div>
        </div>
      </Section>

      {/* 5. Ausblick */}
      <Section tone="white" id="zukunft">
        <div className="ps-split ps-split-text">
          <SectionHead eyebrow={h.future.eyebrow} title={h.future.title} text={h.future.text} />
          <Reveal className="ps-plan-list">
            {t.futurePage.items.map((it) => (
              <div key={it.title} className="ps-plan-item">
                <Badge kind="plan">{t.common.comingSoon}</Badge>
                <strong>{it.title}</strong>
              </div>
            ))}
            <a href={paths.future(lang)} className="ps-link">
              {h.future.cta} <Icon name="next" size={14} />
            </a>
          </Reveal>
        </div>
      </Section>

      {/* 6. Haltung */}
      <Section tone="mist" id="haltung">
        <SectionHead eyebrow={h.philosophy.eyebrow} title={h.philosophy.title} />
        <Grid cols={4}>
          {h.philosophy.items.map((p, i) => (
            <Statement key={p.title} no={`0${i + 1}`} title={p.title} text={p.text} />
          ))}
        </Grid>
      </Section>

      {/* 7. Kontakt */}
      <Section tone="midnight" id="kontakt" className="ps-contact-cta">
        <Backdrop variant="contact" />
        <SectionHead eyebrow={h.contact.eyebrow} title={h.contact.title} text={h.contact.text} align="center" />
        <Reveal className="ps-actions ps-actions-center">
          <a href={paths.contact(lang)} className="ps-btn ps-btn-light ps-btn-lg" data-testid="cta-contact-2">
            {h.contact.cta} <Icon name="next" size={16} />
          </a>
          <a href={`mailto:${contactData.email}`} className="ps-link ps-link-light">
            {contactData.email}
          </a>
        </Reveal>
      </Section>
    </SiteLayout>
  );
}
