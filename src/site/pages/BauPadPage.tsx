import type { CSSProperties } from 'react';
import { Icon } from '../../components/Icon';
import { InstallButton } from '../../components/InstallApp';
import { ToolIcon } from '../../components/ToolIcon';
import { paths } from '../../lib/router';
import { useLang } from '../i18n';
import { TOOL_ENTRIES, toolPath } from '../products';
import { siteAlternates, softwareJsonLd } from '../seo';
import { Reveal } from '../components/Reveal';
import { SiteLayout } from '../components/SiteShell';
import { LIT, ToolTiles } from '../components/ToolWall';

const Points = ({ items }: { items: string[] }) => (
  <ul className="bp-points">
    {items.map((pt) => (
      <li key={pt}>
        <i>
          <Icon name="check" size={14} />
        </i>
        {pt}
      </li>
    ))}
  </ul>
);

/**
 * Produktseite BauPad: erster Bildschirm mit stehendem Kachel-Hintergrund und allen sieben Werkzeugen in einer Reihe
 * (jedes anklickbar), dann Zahlen, Probleme → Antworten, ein Projekt + Rollen, Technik, Abschluss.
 */
export function BauPadPage() {
  const { lang, t } = useLang();
  const b = t.baupad;
  return (
    <SiteLayout meta={{ title: b.title, description: b.description, lang, alternates: siteAlternates('baupad'), jsonLd: [softwareJsonLd(lang, b.description)] }} className="ps-baupad">
      {/* 1. Kopf: Aussage, alle sieben Werkzeuge in einer Reihe, Tasten – dahinter die stehenden Kacheln */}
      <section className="bp-hero bp-hero-tiles" aria-labelledby="ps-bp-title">
        <ToolTiles />
        <div className="bp-wrap">
          <div className="bp-top">
            <p className="bp-pill">
              <img src="/icons/baupad-icon.png" width={28} height={28} alt="" />
              {b.hero.eyebrow}
            </p>
            <p className="bp-status">
              <i />
              {b.hero.status}
            </p>
          </div>
          <h1 id="ps-bp-title" className="bp-h1" data-testid="product-title">
            {b.hero.title.map((line, i) => (
              <span key={line} className={i === b.hero.title.length - 1 ? 'bp-accent' : undefined}>
                {line}
                {i < b.hero.title.length - 1 ? ' ' : ''}
              </span>
            ))}
          </h1>
          <p className="bp-lead">{b.hero.lead}</p>
          <ul className="bp-row7" id="werkzeuge" data-testid="product-grid">
            {TOOL_ENTRIES.map((x) => (
              <li key={x.id}>
                <a href={toolPath(x.id, lang)} className="bp-t7" style={{ '--c': LIT[x.id] } as CSSProperties} data-testid="product-card">
                  <span className="bp-t7-icon">
                    <ToolIcon name={x.icon} size={26} />
                  </span>
                  <span className="bp-t7-name">{t.tools[x.id].title}</span>
                  <span className="bp-t7-hook">{b.tools.items[x.id].hook}</span>
                  <span className="bp-t7-go">
                    <Icon name="next" size={16} />
                  </span>
                </a>
              </li>
            ))}
          </ul>
          <div className="bp-actions">
            <a href={paths.contact(lang)} className="bp-btn bp-btn-lime" data-testid="cta-contact">
              {b.hero.primary} <Icon name="next" size={16} />
            </a>
            <a href={paths.tools()} className="bp-btn bp-btn-ghost" data-testid="cta-tools">
              {b.hero.secondary}
            </a>
          </div>
        </div>
      </section>

      {/* 4. Zahlen */}
      <div className="bp-nums">
        <div className="bp-wrap">
          {b.numbers.map((n) => (
            <div key={n.label}>
              <b data-count={n.value}>{n.value}</b>
              <span>{n.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 5. Problem → Antwort */}
      <section className="bp-sec">
        <div className="bp-wrap">
          <Reveal>
            <span className="bp-eye">{b.problems.eyebrow}</span>
            <h2 className="bp-h2">{b.problems.title}</h2>
          </Reveal>
          <div className="bp-pairs" data-testid="problem-pairs">
            {b.problems.items.map((p, i) => (
              <Reveal key={p.problem} delay={i * 80} as="article" className="bp-pair">
                <div className="bp-pair-problem">
                  <span className="bp-pair-label">{b.problems.problemLabel}</span>
                  <h3>{p.problem}</h3>
                  <p>{p.detail}</p>
                </div>
                <div className="bp-pair-solution">
                  <span className="bp-pair-label">{b.problems.solutionLabel}</span>
                  <h3>{p.solution}</h3>
                  <Points items={p.points} />
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* 6. Ein Projekt, alle Werkzeuge + Rollen */}
      <section className="bp-dark">
        <div className="bp-wrap">
          <div className="bp-two">
            <Reveal>
              <span className="bp-eye">{b.one.eyebrow}</span>
              <h2 className="bp-h2">{b.one.title}</h2>
              <p className="bp-sub">{b.one.text}</p>
            </Reveal>
            <Reveal delay={80}>
              <Points items={b.one.points} />
            </Reveal>
          </div>
          <div className="bp-roles">
            <Reveal>
              <span className="bp-eye">{b.roles.eyebrow}</span>
              <h3 className="bp-h3">{b.roles.title}</h3>
              <p className="bp-sub">{b.roles.text}</p>
            </Reveal>
            <ul className="bp-role-list" data-testid="roles">
              {b.roles.items.map((r) => (
                <li key={r.title}>
                  <Icon name="hand" size={18} />
                  {r.title}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* 8. Technik kurz */}
      <section className="bp-sec bp-tint">
        <div className="bp-wrap bp-two">
          <Reveal>
            <span className="bp-eye">{b.intro.eyebrow}</span>
            <h2 className="bp-h2">{b.intro.title}</h2>
            <p className="bp-sub">{b.intro.text}</p>
          </Reveal>
          <Reveal delay={80}>
            <Points items={b.intro.facts} />
            <div className="bp-install">
              <InstallButton variant="link" />
            </div>
          </Reveal>
        </div>
      </section>

      {/* 9. Abschluss */}
      <section className="bp-cta">
        <div className="bp-wrap">
          <Reveal>
            <span className="bp-eye">{b.cta.eyebrow}</span>
            <h2 className="bp-h2">{b.cta.title}</h2>
            <p className="bp-sub">{b.cta.text}</p>
          </Reveal>
          <Reveal className="bp-actions">
            <a href={paths.contact(lang)} className="bp-btn bp-btn-dark" data-testid="cta-contact-2">
              {b.cta.primary} <Icon name="next" size={16} />
            </a>
            <a href={paths.register()} className="bp-btn bp-btn-line" data-testid="cta-register">
              {b.cta.secondary}
            </a>
          </Reveal>
        </div>
      </section>
    </SiteLayout>
  );
}
