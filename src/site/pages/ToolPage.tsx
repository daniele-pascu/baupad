import type { CSSProperties } from 'react';
import { Icon } from '../../components/Icon';
import { ToolIcon } from '../../components/ToolIcon';
import { paths, PRODUCT_SLUG_OF, type ProductId } from '../../lib/router';
import { fill, useLang } from '../i18n';
import { TOOL_ENTRIES, toolPath } from '../products';
import { Reveal } from '../components/Reveal';
import { Section, SectionHead } from '../components/Section';
import { Backdrop } from '../components/Shapes';
import { Panel, type PanelKind } from '../components/Stage';
import { SiteLayout } from '../components/SiteShell';

const OPEN: Record<ProductId, string> = { projects: paths.projects(), workers: paths.workers(), reports: paths.reports(), photos: paths.photos(), defects: paths.defects() };
const PANEL: Record<ProductId, PanelKind> = { projects: 'plan', workers: 'week', reports: 'report', photos: 'photos', defects: 'defects' };

/** Werkzeug-Seite unter BauPad: Beschreibung, Funktionen in Gruppen, Platzhalter-Ansicht, weitere Werkzeuge */
export function ToolPage({ id }: { id: ProductId }) {
  const { lang, t } = useLang();
  const tool = t.tools[id];
  const entry = TOOL_ENTRIES.find((x) => x.id === id)!;
  const others = TOOL_ENTRIES.filter((x) => x.id !== id);
  const slug = PRODUCT_SLUG_OF[id];
  return (
    <SiteLayout meta={{ title: `${tool.title}${t.tool.titleSuffix}`, description: tool.tagline, lang, alternates: { de: paths.product(slug, 'de'), en: paths.product(slug, 'en') } }} className="ps-tool-page">
      <section className="ps-hero ps-hero-sm tone-navy" style={{ '--c': entry.color } as CSSProperties} aria-labelledby="ps-tool-title">
        <Backdrop variant="dark" />
        <div className="ps-wrap">
          <a href={paths.baupad(lang)} className="ps-back">
            <Icon name="back" size={16} /> {t.tool.back}
          </a>
          <div className="ps-tool-hero">
            <span className="ps-feature-icon big" aria-hidden="true">
              <ToolIcon name={entry.icon} size={34} />
            </span>
            <div>
              <p className="ps-eyebrow ps-eyebrow-light">{t.tool.eyebrow}</p>
              <h1 id="ps-tool-title" className="ps-display ps-display-sm" data-testid="product-title">
                {tool.title}
              </h1>
              <p className="ps-lead ps-lead-light" data-reveal="">
                {tool.tagline}
              </p>
            </div>
          </div>
        </div>
      </section>

      <Section tone="white">
        <div className="ps-split">
          <Reveal>
            <p className="ps-lead ps-lead-dark">{tool.intro}</p>
            <div className="ps-actions">
              <a href={OPEN[id]} className="ps-btn ps-btn-navy" data-testid="product-open">
                {tool.title} {t.tool.open} <Icon name="next" size={16} />
              </a>
              <a href={paths.contact(lang)} className="ps-btn ps-btn-outline-dark">
                {t.common.contact}
              </a>
            </div>
          </Reveal>
          <Reveal delay={120} className="ps-split-stage">
            <Panel kind={PANEL[id]} label={tool.title} placeholderLabel={t.common.placeholder} />
          </Reveal>
        </div>
      </Section>

      <Section tone="mist">
        <SectionHead eyebrow={t.tool.functions} title={fill(t.tool.functionsTitle, { tool: tool.title })} />
        <div className="ps-groups" style={{ '--c': entry.color } as CSSProperties}>
          {tool.groups.map((g, i) => (
            <Reveal key={g.title} delay={i * 60} className="ps-group">
              <h3>{g.title}</h3>
              <ul>
                {g.items.map((it) => (
                  <li key={it}>
                    <Icon name="check" size={14} />
                    {it}
                  </li>
                ))}
              </ul>
            </Reveal>
          ))}
        </div>
      </Section>

      <Section tone="white">
        <SectionHead eyebrow={t.tool.others} title={t.baupad.features.title} />
        <div className="ps-others">
          {others.map((x, i) => (
            <Reveal key={x.id} delay={i * 60}>
              <a href={toolPath(x.id, lang)} className="ps-other" style={{ '--c': x.color } as CSSProperties}>
                <span className="ps-feature-icon sm">
                  <ToolIcon name={x.icon} size={20} />
                </span>
                <strong>{t.tools[x.id].title}</strong>
                <span>{t.tools[x.id].short}</span>
              </a>
            </Reveal>
          ))}
        </div>
      </Section>
    </SiteLayout>
  );
}
