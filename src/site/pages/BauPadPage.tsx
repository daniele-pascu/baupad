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
        <p className="bp-safe" data-testid="bp-safe">
          {b.hero.safe.map((l) => (
            <span key={l}>{l}</span>
          ))}
        </p>
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

      {/* Speichern: mit Empfang sofort online, ohne Empfang am Gerät, bei der ersten Verbindung automatisch online */}
      <section className="bp-sec" aria-labelledby="bp-saving">
        <p className="ps-eyebrow">{b.saving.eyebrow}</p>
        <h2 id="bp-saving">{b.saving.title}</h2>
        <ol className="bp-saving" data-testid="bp-saving">
          {b.saving.items.map((x, i) => (
            <li key={x.title}>
              <span className="bp-saving-icon" aria-hidden="true">
                {SAVING_ICONS[i]}
              </span>
              <strong>{x.title}</strong>
              <span>{x.text}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* Rollen: je Nutzerlizenz eine von vier Rollen */}
      <section className="bp-sec" aria-labelledby="bp-access">
        <p className="ps-eyebrow">{b.access.eyebrow}</p>
        <h2 id="bp-access">{b.access.title}</h2>
        <p className="bp-sec-text">{b.access.text}</p>
        <ul className="bp-roles" data-testid="bp-roles">
          {b.access.items.map((r) => (
            <li key={r.role} className={r.full ? 'is-full' : 'is-limited'}>
              <strong>{r.role}</strong>
              <span className="bp-role-badge">{r.full ? b.access.full : b.access.limited}</span>
              <ul>
                {r.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>
    </SiteLayout>
  );
}

/** Symbole für „Speichern“: Wolke mit Haken, Handy, Pfeile im Kreis */
const SAVING_ICONS = [
  <svg key="a" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.5 19H7a5 5 0 1 1 .9-9.92A6 6 0 0 1 19.5 11 4 4 0 0 1 17.5 19Z" />
    <path d="m9 13.5 2 2 4-4" />
  </svg>,
  <svg key="b" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
    <path d="M11 18.5h2" />
  </svg>,
  <svg key="c" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 11a8 8 0 0 0-14.3-4.9L4 8" />
    <path d="M4 3.5V8h4.5" />
    <path d="M4 13a8 8 0 0 0 14.3 4.9L20 16" />
    <path d="M20 20.5V16h-4.5" />
  </svg>,
];
