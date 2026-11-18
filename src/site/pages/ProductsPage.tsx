import { paths } from '../../lib/router';
import { useLang } from '../i18n';
import { siteAlternates } from '../seo';
import { SiteLayout } from '../components/SiteShell';

/** Produktübersicht – schlicht: BauPad mit einer Zeile, Status und Link; darunter der Hinweis auf weitere Lösungen */
export function ProductsPage() {
  const { lang, t } = useLang();
  const p = t.products;
  const h = t.home.product;
  return (
    <SiteLayout
      meta={{
        title: p.title,
        description: p.description,
        lang,
        alternates: siteAlternates('products'),
      }}
      className="ps-products"
    >
      <p className="ps-eyebrow">{p.eyebrow}</p>
      <h1>{p.heading}</h1>
      <section aria-labelledby="pp-baupad">
        <h2 id="pp-baupad">
          <a href={paths.baupad(lang)} data-testid="product-open-baupad">
            {t.product}
          </a>
        </h2>
        <p>{h.tagline}</p>
        <p data-testid="product-status">{h.tag}</p>
        <p className="ps-links">
          <a href={paths.baupad(lang)}>{p.open}</a>
        </p>
      </section>
      <p>
        {h.more} ({h.moreTag})
      </p>
    </SiteLayout>
  );
}
