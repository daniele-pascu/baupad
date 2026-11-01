import type { CSSProperties } from 'react';
import { Icon } from '../../components/Icon';
import { InstallButton } from '../../components/InstallApp';
import { ToolIcon } from '../../components/ToolIcon';
import { paths } from '../../lib/router';
import { useLang } from '../i18n';
import { TOOL_ENTRIES, toolPath } from '../products';
import { siteAlternates, softwareJsonLd } from '../seo';
import { Reveal } from '../components/Reveal';
import { Badge, Lines, Section, SectionHead } from '../components/Section';
import { Backdrop } from '../components/Shapes';
import { SiteLayout } from '../components/SiteShell';

/** Produktseite BauPad: Problem → Lösung, ein Projekt für alle Werkzeuge, Rollen, die fünf Werkzeuge als Stichpunkte – ohne Bilder */
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
      </section>

      {/* 2. Problem → Lösung */}
      <Section tone="white">
        <SectionHead eyebrow={b.problems.eyebrow} title={b.problems.title} />
        <div className="ps-pairs" data-testid="problem-pairs">
          {b.problems.items.map((p, i) => (
            <Reveal key={p.problem} delay={i * 80} as="article" className="ps-pair">
              <div className="ps-pair-problem">
                <span className="ps-pair-label">{b.problems.problemLabel}</span>
                <h3>{p.problem}</h3>
                <p>{p.detail}</p>
              </div>
              <div className="ps-pair-solution">
                <span className="ps-pair-label">{b.problems.solutionLabel}</span>
                <h3>{p.solution}</h3>
                <ul className="ps-points">
                  {p.points.map((pt) => (
                    <li key={pt}>
                      <Icon name="check" size={15} />
                      {pt}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* 3. Ein Projekt, alle Werkzeuge + Rollen */}
      <Section tone="navy">
        <Backdrop variant="dark" />
        <div className="ps-split ps-split-text">
          <SectionHead eyebrow={b.one.eyebrow} title={b.one.title} text={b.one.text} />
          <Reveal>
            <ul className="ps-points ps-points-light">
              {b.one.points.map((pt) => (
                <li key={pt}>
                  <Icon name="check" size={15} />
                  {pt}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
        <div className="ps-roles">
          <SectionHead eyebrow={b.roles.eyebrow} title={b.roles.title} text={b.roles.text} level={3} />
          <ul className="ps-role-list" data-testid="roles">
            {b.roles.items.map((r) => (
              <li key={r.title}>
                <Icon name="hand" size={18} />
                {r.title}
              </li>
            ))}
          </ul>
        </div>
      </Section>

      {/* 4. Die fünf Werkzeuge */}
      <Section tone="mist" id="werkzeuge">
        <SectionHead eyebrow={b.tools.eyebrow} title={b.tools.title} text={b.tools.text} />
        <div className="ps-toolcards" data-testid="product-grid">
          {TOOL_ENTRIES.map((x, i) => {
            const tool = b.tools.items[x.id];
            return (
              <Reveal key={x.id} delay={i * 60} as="article" className="ps-toolcard" style={{ '--c': x.color } as CSSProperties}>
                <div className="ps-toolcard-head">
                  <span className="ps-feature-icon">
                    <ToolIcon name={x.icon} size={26} />
                  </span>
                  <div>
                    <h3>
                      <a href={toolPath(x.id, lang)} className="ps-toolcard-title" data-testid="product-card">
                        {t.tools[x.id].title}
                      </a>
                    </h3>
                    <p className="ps-toolcard-hook">{tool.hook}</p>
                  </div>
                </div>
                <ul className="ps-points">
                  {tool.points.map((pt) => (
                    <li key={pt}>
                      <Icon name="check" size={15} />
                      {pt}
                    </li>
                  ))}
                </ul>
                <a href={toolPath(x.id, lang)} className="ps-link">
                  {b.tools.more} <Icon name="next" size={14} />
                </a>
              </Reveal>
            );
          })}
        </div>
      </Section>

      {/* 5. Technik kurz */}
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

      {/* 6. CTA */}
      <Section tone="mist" className="ps-final-cta">
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
