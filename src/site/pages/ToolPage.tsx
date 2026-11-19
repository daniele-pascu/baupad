import type { CSSProperties } from 'react';
import { ToolIcon } from '../../components/ToolIcon';
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

/**
 * Werkzeug-Seite unter BauPad: oben ein Kopf in der Farbe des Werkzeugs (wie seine Karte auf der BauPad-Seite – die
 * Karte wächst beim Antippen zu dieser Seite), darunter Einleitung, Funktionen in Gruppen und die weiteren Werkzeuge.
 */
export function ToolPage({ id }: { id: ProductId }) {
  const { lang, t } = useLang();
  const tool = t.tools[id];
  const entry = TOOL_ENTRIES.find((x) => x.id === id)!;
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
      <section className="tp-hero" style={{ '--tool': entry.color } as CSSProperties} aria-labelledby="tp-title">
        <a href={paths.baupad(lang)} className="tp-back">
          ← {t.tool.back}
        </a>
        <span className="bp-tool-icon tp-icon" aria-hidden="true">
          <ToolIcon name={entry.icon} size={30} />
        </span>
        <p className="tp-eyebrow">{t.tool.eyebrow}</p>
        <h1 id="tp-title" data-testid="product-title">
          {tool.title}
        </h1>
        <p className="tp-tagline">{tool.tagline}</p>
        <p className="tp-btns">
          <a href={OPEN[id]} className="tp-b1" data-testid="product-open">
            {tool.title} {t.tool.open}
          </a>
          <a href={paths.contact(lang)} className="tp-b2">
            {t.common.contact}
          </a>
        </p>
      </section>

      <p className="tp-intro">{tool.intro}</p>

      <section className="tp-functions" aria-labelledby="tp-functions">
        <p className="ps-eyebrow">{t.tool.functions}</p>
        <h2 id="tp-functions">{fill(t.tool.functionsTitle, { tool: tool.title })}</h2>
        <div className="tp-groups">
          {tool.groups.map((g) => (
            <div key={g.title} className="tp-group">
              <h3>{g.title}</h3>
              <ul>
                {g.items.map((it) => (
                  <li key={it}>{it}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="tp-more" aria-labelledby="tp-others">
        <p className="ps-eyebrow">{t.tool.others}</p>
        <h2 id="tp-others">{t.baupad.tools.title}</h2>
        <ul className="tp-others">
          {others.map((x) => (
            <li key={x.id}>
              <a href={toolPath(x.id, lang)} style={{ '--tool': x.color } as CSSProperties}>
                <span className="ph-tool-icon" aria-hidden="true">
                  <ToolIcon name={x.icon} size={20} />
                </span>
                <span>
                  <strong>{t.tools[x.id].title}</strong>
                  <span>{t.tools[x.id].short}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </SiteLayout>
  );
}
