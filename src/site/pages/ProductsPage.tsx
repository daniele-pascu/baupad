import type { CSSProperties } from 'react';
import { Icon } from '../../components/Icon';
import { ToolIcon } from '../../components/ToolIcon';
import { paths } from '../../lib/router';
import { useLang } from '../i18n';
import { PRODUCTS, toolPath } from '../products';
import { siteAlternates } from '../seo';
import { Reveal } from '../components/Reveal';
import { Badge, Lines, Section, SectionHead } from '../components/Section';
import { Backdrop } from '../components/Shapes';
import { SiteLayout } from '../components/SiteShell';

/** Produktübersicht: verfügbare Produkte mit Werkzeugen, geplante Produkte gekennzeichnet */
export function ProductsPage() {
  const { lang, t } = useLang();
  const p = t.products;
  return (
    <SiteLayout meta={{ title: p.title, description: p.description, lang, alternates: siteAlternates('products') }}>
      <section className="ps-hero ps-hero-sm tone-midnight" aria-labelledby="ps-products-title">
        <Backdrop variant="dark" />
        <div className="ps-wrap">
          <p className="ps-eyebrow ps-eyebrow-light">{p.eyebrow}</p>
          <h1 id="ps-products-title" className="ps-display ps-display-sm">
            <Lines lines={[p.heading]} />
          </h1>
          <p className="ps-lead ps-lead-light" data-reveal="">
            {p.lead}
          </p>
        </div>
      </section>

      <Section tone="white">
        <SectionHead eyebrow={p.availableTitle} title={t.product} level={2} />
        {PRODUCTS.map((prod) => (
          <div key={prod.id} className="ps-product-detail">
            <Reveal className="ps-product-detail-copy">
              <Badge kind="ok">{t.common.available}</Badge>
              <p className="ps-lead">{t.baupad.description}</p>
              <ul className="ps-tool-list ps-tool-list-dark">
                {prod.tools.map((x) => (
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
              <div className="ps-actions">
                <a href={prod.path(lang)} className="ps-btn ps-btn-navy" data-testid="product-open-baupad">
                  {t.common.learnMore} <Icon name="next" size={16} />
                </a>
                <a href={paths.contact(lang)} className="ps-btn ps-btn-outline-dark">
                  {t.common.contact}
                </a>
              </div>
            </Reveal>
          </div>
        ))}
      </Section>
    </SiteLayout>
  );
}
