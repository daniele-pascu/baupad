import { paths, PRODUCT_SLUG_OF, type ProductId } from '../../lib/router';
import { fill, useLang } from '../i18n';
import { TOOL_ENTRIES, toolPath } from '../products';
import { SiteLayout } from '../components/SiteShell';

const OPEN: Record<ProductId, string> = {
  projects: paths.projects(),
  workers: paths.workers(),
  reports: paths.reports(),
  photos: paths.photos(),
  defects: paths.defects(),
  times: paths.times(),
  materials: paths.materials(),
};

/** Werkzeug-Seite unter BauPad – schlicht: Beschreibung, Funktionen in Gruppen, weitere Werkzeuge */
export function ToolPage({ id }: { id: ProductId }) {
  const { lang, t } = useLang();
  const tool = t.tools[id];
  const others = TOOL_ENTRIES.filter((x) => x.id !== id);
  const slug = PRODUCT_SLUG_OF[id];
  return (
    <SiteLayout
      meta={{
        title: `${tool.title}${t.tool.titleSuffix}`,
        description: tool.tagline,
        lang,
        alternates: {
          de: paths.product(slug, 'de'),
          en: paths.product(slug, 'en'),
        },
      }}
      className="ps-tool-page"
    >
      <p>
        <a href={paths.baupad(lang)}>← {t.tool.back}</a>
      </p>
      <p className="ps-eyebrow">{t.tool.eyebrow}</p>
      <h1 data-testid="product-title">{tool.title}</h1>
      <p>
        <strong>{tool.tagline}</strong>
      </p>
      <p>{tool.intro}</p>
      <p className="ps-links">
        <a href={OPEN[id]} data-testid="product-open">
          {tool.title} {t.tool.open}
        </a>
        <a href={paths.contact(lang)}>{t.common.contact}</a>
      </p>

      <section aria-labelledby="tp-functions">
        <p className="ps-eyebrow">{t.tool.functions}</p>
        <h2 id="tp-functions">{fill(t.tool.functionsTitle, { tool: tool.title })}</h2>
        {tool.groups.map((g) => (
          <div key={g.title}>
            <h3>{g.title}</h3>
            <ul>
              {g.items.map((it) => (
                <li key={it}>{it}</li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section aria-labelledby="tp-others">
        <p className="ps-eyebrow">{t.tool.others}</p>
        <h2 id="tp-others">{t.baupad.tools.title}</h2>
        <ul>
          {others.map((x) => (
            <li key={x.id}>
              <a href={toolPath(x.id, lang)}>{t.tools[x.id].title}</a> – {t.tools[x.id].short}
            </li>
          ))}
        </ul>
      </section>
    </SiteLayout>
  );
}
