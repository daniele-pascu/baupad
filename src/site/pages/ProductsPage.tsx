import { paths } from '../../lib/router';
import { useLang } from '../i18n';
import { siteAlternates } from '../seo';
import { SiteLayout } from '../components/SiteShell';

/**
 * Produktübersicht: schwarzer, bildschirmfüllender Bereich, in der Mitte das Produkt BauPad (Logo, Name, eine Zeile).
 * Die ganze Karte ist antippbar und führt zur Produktseite. Darunter der Platz für weitere Lösungen.
 */
export function ProductsPage() {
  const { lang, t } = useLang();
  const p = t.products;
  const h = t.home.product;
  return (
    <SiteLayout meta={{ title: p.title, description: p.description, lang, alternates: siteAlternates('products') }} className="ph pp">
      <section className="pp-hero" aria-labelledby="ps-products-title">
        <div className="ph-w pp-in">
          <p className="ph-mono ph-eye">{p.eyebrow}</p>
          <h1 id="ps-products-title" className="pp-h1">
            {p.heading}
          </h1>
          <a href={paths.baupad(lang)} className="pp-card" aria-label={h.aria} data-testid="product-open-baupad">
            <img src="/icons/baupad-icon.png" width={269} height={256} alt="" />
            <span className="pp-name">{t.product}</span>
            <span className="pp-line">{h.tagline}</span>
            <span className="ph-mono pp-tag" data-testid="product-status">
              <i aria-hidden="true" />
              {h.tag}
            </span>
            <span className="ph-btn ph-btn-lime pp-go">
              {p.open}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </span>
          </a>
          <div className="ph-slot pp-slot">
            <b>{h.more}</b>
            <span className="ph-mono">{h.moreTag}</span>
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}
