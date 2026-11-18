import type { CSSProperties } from 'react';
import { InstallButton } from '../../components/InstallApp';
import { ToolIcon } from '../../components/ToolIcon';
import { paths } from '../../lib/router';
import { useLang } from '../i18n';
import { TOOL_ENTRIES, toolPath } from '../products';
import { siteAlternates, softwareJsonLd } from '../seo';
import { SiteLayout } from '../components/SiteShell';

/**
 * Produktseite BauPad (hell): oben groß das App-Symbol und „BauPad“, darunter jedes Werkzeug als eigenes Fenster
 * in seiner Farbe – Symbol, Name und nur eine kurze Aufzählung (ohne Beschreibung). Jedes Fenster führt zur Werkzeug-Seite.
 * Die weiteren Inhalte (Probleme und Antworten, Rollen, Einführung) kommen später Werkzeug für Werkzeug dazu.
 */
export function BauPadPage() {
  const { lang, t } = useLang();
  const b = t.baupad;
  return (
    <SiteLayout
      meta={{
        title: b.title,
        description: b.description,
        lang,
        alternates: siteAlternates('baupad'),
        jsonLd: [softwareJsonLd(lang, b.description)],
      }}
      className="ps-baupad"
    >
      <section className="bp-hero" aria-labelledby="ps-bp-title">
        <span className="ps-app-icon bp-icon" aria-hidden="true">
          <span>BauPad</span>
        </span>
        <h1 id="ps-bp-title" data-testid="product-title">
          {t.product}
        </h1>
        <p className="bp-tagline">{t.home.product.tagline}</p>
        <p className="bp-status">{b.hero.status}</p>
        <p className="bp-btns">
          <a href={paths.tools()} className="bp-b1" data-testid="cta-tools">
            {b.hero.secondary}
          </a>
          <a href={paths.contact(lang)} className="bp-b2" data-testid="cta-contact">
            {b.hero.primary}
          </a>
        </p>
        <p className="bp-install">
          <InstallButton variant="link" />
        </p>
      </section>

      <ul id="werkzeuge" className="bp-tools" data-testid="product-grid" aria-label={t.home.product.wall.aria}>
        {TOOL_ENTRIES.map((x) => (
          <li key={x.id}>
            <a href={toolPath(x.id, lang)} className="bp-tool" style={{ '--tool': x.color } as CSSProperties} data-testid="product-card">
              <span className="bp-tool-icon" aria-hidden="true">
                <ToolIcon name={x.icon} size={26} />
              </span>
              <strong>{t.tools[x.id].title}</strong>
              <span className="bp-points">
                {t.tools[x.id].points.map((pt) => (
                  <span key={pt}>{pt}</span>
                ))}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </SiteLayout>
  );
}
