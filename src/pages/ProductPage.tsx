import type { CSSProperties } from 'react';
import { Icon } from '../components/Icon';
import { SiteFooter, SiteNav } from '../components/SiteNav';
import { ToolIcon } from '../components/ToolIcon';
import { site } from '../content/site';
import { paths } from '../lib/router';
import { usePageTitle } from './SitePages';

type ProductId = keyof typeof site.products;
const OPEN: Record<ProductId, string> = { projects: paths.projects(), workers: paths.workers(), reports: paths.reports(), photos: paths.photos(), defects: paths.defects() };

/** Produktseite eines Werkzeugs: Beschreibung, Bilder aus der App, Funktionen, Beispiel-Exporte */
export function ProductPage({ id }: { id: ProductId }) {
  const tool = site.home.tools.find((t) => t.id === id)!;
  const p = site.products[id];
  usePageTitle(`${tool.title} – BauPad`);
  const others = site.home.tools.filter((t) => t.id !== id);
  return (
    <div className="site product-page" style={{ '--tool': tool.color } as CSSProperties}>
      <SiteNav />
      <main className="site-main">
        <section className="product-hero">
          <a href={paths.landing()} className="site-back">
            <Icon name="back" size={16} /> Alle Werkzeuge
          </a>
          <span className="product-icon big" aria-hidden="true">
            <ToolIcon name={id} size={34} />
          </span>
          <p className="lp-eyebrow">BauPad</p>
          <h1 className="site-title" data-testid="product-title">
            {tool.title}
          </h1>
          <p className="product-tagline">{p.tagline}</p>
          <p className="product-intro">{p.intro}</p>
          <div className="hero-actions">
            <a href={OPEN[id]} className="site-cta" data-testid="product-open">
              {tool.title} öffnen <span aria-hidden="true">→</span>
            </a>
          </div>
        </section>

        <section className="features" aria-label="Funktionen">
          <p className="lp-eyebrow">Funktionen</p>
          <h2 className="lp-h2">Was {tool.title} kann.</h2>
          <div className="feature-groups">
            {p.groups.map((g) => (
              <div key={g.title} className="feature-group">
                <h2>{g.title}</h2>
                <ul>
                  {g.items.map((it) => (
                    <li key={it}>
                      <Icon name="check" size={14} />
                      {it}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section className="others" aria-label="Weitere Werkzeuge">
          <p className="lp-eyebrow">Weitere Werkzeuge</p>
          <div className="others-grid">
            {others.map((t) => (
              <a key={t.id} href={paths.product(site.products[t.id].slug)} className="other-card" style={{ '--tool': t.color } as CSSProperties}>
                <span className="product-icon" aria-hidden="true">
                  <ToolIcon name={t.id} size={22} />
                </span>
                <strong>{t.title}</strong>
                <span>{t.text}</span>
              </a>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
