import type { CSSProperties } from 'react';
import { Icon } from '../../components/Icon';
import { InstallButton } from '../../components/InstallApp';
import { ToolIcon } from '../../components/ToolIcon';
import { paths } from '../../lib/router';
import { useLang } from '../i18n';
import { TOOL_ENTRIES, toolPath } from '../products';
import { siteAlternates, softwareJsonLd } from '../seo';
import { Reveal } from '../components/Reveal';
import { Badge, Grid, Lines, Section, SectionHead, Statement } from '../components/Section';
import { Backdrop } from '../components/Shapes';
import { Panel, Stage } from '../components/Stage';
import { SiteLayout } from '../components/SiteShell';

/** Produktseite BauPad: Problem → Lösung → Nutzen, Funktionsübersicht, Anwendungsfälle, große Software-Präsentation */
export function BauPadPage() {
  const { lang, t } = useLang();
  const b = t.baupad;
  return (
    <SiteLayout meta={{ title: b.title, description: b.description, lang, alternates: siteAlternates('baupad'), jsonLd: [softwareJsonLd(lang, b.description)] }} className="ps-baupad">
      {/* 1. Hero */}
      <section className="ps-hero tone-midnight" aria-labelledby="ps-bp-title">
        <Backdrop variant="hero" />
        <div className="ps-wrap ps-hero-inner">
          <p className="ps-eyebrow ps-eyebrow-light">{b.hero.eyebrow}</p>
          <h1 id="ps-bp-title" className="ps-display" data-testid="product-title">
            <Lines lines={b.hero.title} />
          </h1>
          <p className="ps-lead ps-lead-light ps-hero-lead" data-reveal="" data-immediate="">
            {b.hero.lead}
          </p>
          <div className="ps-actions" data-reveal="" data-immediate="">
            <a href={paths.contact(lang)} className="ps-btn ps-btn-light" data-testid="cta-contact">
              {b.hero.primary} <Icon name="next" size={16} />
            </a>
            <a href={paths.tools()} className="ps-btn ps-btn-outline" data-testid="cta-tools">
              {b.hero.secondary}
            </a>
          </div>
          <p className="ps-hero-status" data-reveal="" data-immediate="">
            <Badge kind="neutral">{b.hero.status}</Badge>
          </p>
        </div>
        <div className="ps-hero-stage" aria-hidden="true">
          <Stage main="tools" floats={['defects', 'week']} placeholderLabel={t.common.placeholder} floatLabel={t.common.placeholderShort} immediate labels={[t.home.baupad.stageTitle, t.tools.defects.title, t.tools.workers.title]} />
        </div>
      </section>

      {/* 2. Produktvorstellung */}
      <Section tone="white">
        <div className="ps-split ps-split-text">
          <SectionHead eyebrow={b.intro.eyebrow} title={b.intro.title} text={b.intro.text} />
          <Reveal>
            <ul className="ps-facts ps-facts-stack">
              {b.intro.facts.map((f) => (
                <li key={f}>
                  <Icon name="check" size={16} />
                  {f}
                </li>
              ))}
            </ul>
            <div className="ps-install">
              <InstallButton variant="link" />
            </div>
          </Reveal>
        </div>
      </Section>

      {/* 3. Probleme */}
      <Section tone="mist">
        <SectionHead eyebrow={b.problems.eyebrow} title={b.problems.title} />
        <Grid cols={2}>
          {b.problems.items.map((p, i) => (
            <Statement key={p.title} no={`0${i + 1}`} title={p.title} text={p.text} />
          ))}
        </Grid>
      </Section>

      {/* 4. Herausforderungen */}
      <Section tone="navy">
        <Backdrop variant="dark" />
        <SectionHead eyebrow={b.challenges.eyebrow} title={b.challenges.title} />
        <Grid cols={4}>
          {b.challenges.items.map((p, i) => (
            <Statement key={p.title} no={`0${i + 1}`} title={p.title} text={p.text} />
          ))}
        </Grid>
      </Section>

      {/* 5. Lösung */}
      <Section tone="white">
        <SectionHead eyebrow={b.solution.eyebrow} title={b.solution.title} />
        <Grid cols={2}>
          {b.solution.items.map((p) => (
            <Statement key={p.title} icon={<Icon name="check" size={18} />} title={p.title} text={p.text} />
          ))}
        </Grid>
      </Section>

      {/* 6. Funktionsübersicht */}
      <Section tone="mist" id="werkzeuge">
        <SectionHead eyebrow={b.features.eyebrow} title={b.features.title} />
        <div className="ps-feature-list" data-testid="product-grid">
          {TOOL_ENTRIES.map((x, i) => (
            <Reveal key={x.id} delay={i * 60} as="article" className="ps-feature">
              <a href={toolPath(x.id, lang)} className="ps-feature-link" style={{ '--c': x.color } as CSSProperties} data-testid="product-card">
                <span className="ps-feature-icon">
                  <ToolIcon name={x.icon} size={26} />
                </span>
                <span className="ps-feature-body">
                  <strong>{t.tools[x.id].title}</strong>
                  <span>{t.tools[x.id].short}</span>
                  <ul>
                    {t.tools[x.id].points.map((pt) => (
                      <li key={pt}>
                        <Icon name="check" size={14} />
                        {pt}
                      </li>
                    ))}
                  </ul>
                  <em className="ps-link">
                    {b.features.more} <Icon name="next" size={14} />
                  </em>
                </span>
              </a>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* 7. Vorteile */}
      <Section tone="white">
        <SectionHead eyebrow={b.benefits.eyebrow} title={b.benefits.title} />
        <Grid cols={4}>
          {b.benefits.items.map((p, i) => (
            <Statement key={p.title} no={`0${i + 1}`} title={p.title} text={p.text} />
          ))}
        </Grid>
      </Section>

      {/* 8. Anwendungsfälle */}
      <Section tone="mist">
        <SectionHead eyebrow={b.useCases.eyebrow} title={b.useCases.title} />
        <Grid cols={2}>
          {b.useCases.items.map((p) => (
            <Statement key={p.title} icon={<Icon name="hand" size={18} />} title={p.title} text={p.text} />
          ))}
        </Grid>
      </Section>

      {/* 9. Große Software-Präsentation */}
      <Section tone="midnight" id="software" className="ps-showcase">
        <Backdrop variant="dark" />
        <SectionHead eyebrow={b.stage.eyebrow} title={b.stage.title} text={b.stage.text} align="center" />
        <div className="ps-showcase-grid" data-testid="product-shots">
          {(['tools', 'plan', 'week', 'photos'] as const).map((k, i) => (
            <Reveal key={k} delay={i * 90}>
              <Panel kind={k} label={b.stage.panels[i]} placeholderLabel={t.common.placeholder} />
            </Reveal>
          ))}
        </div>
      </Section>

      {/* 10. CTA */}
      <Section tone="white" className="ps-final-cta">
        <SectionHead eyebrow={b.cta.eyebrow} title={b.cta.title} text={b.cta.text} align="center" />
        <Reveal className="ps-actions ps-actions-center">
          <a href={paths.contact(lang)} className="ps-btn ps-btn-navy ps-btn-lg" data-testid="cta-contact-2">
            {b.cta.primary} <Icon name="next" size={16} />
          </a>
          <a href={paths.register()} className="ps-btn ps-btn-outline-dark ps-btn-lg" data-testid="cta-register">
            {b.cta.secondary}
          </a>
        </Reveal>
      </Section>
    </SiteLayout>
  );
}
