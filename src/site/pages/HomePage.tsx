import type { CSSProperties } from 'react';
import { ToolIcon } from '../../components/ToolIcon';
import { paths } from '../../lib/router';
import { contactData } from '../contact-data';
import { useLang } from '../i18n';
import { TOOL_ENTRIES, toolPath } from '../products';
import { organizationJsonLd, siteAlternates, softwareJsonLd } from '../seo';
import { PadMarkGlass } from '../components/PadMarkGlass';
import { SiteLayout } from '../components/SiteShell';

/**
 * Startseite PAD Software: oben ein schwarzer Kopf mit der Firma (Licht in Violett und Petrol, kaum sichtbar das PAD-Zeichen),
 * darunter heller Grund mit zarten Farblichtern; alles Weitere liegt in Fenstern aus hellem Liquid Glass:
 * BauPad mit allen Werkzeugen (wie in der App); Arbeitsweise (als Linie) und Kontakt stehen frei, ohne Fenster.
 */
export function HomePage() {
  const { lang, t } = useLang();
  const h = t.home;
  const w = h.product.wall;
  return (
    <SiteLayout
      meta={{
        title: h.title,
        description: h.description,
        lang,
        alternates: siteAlternates('landing'),
        jsonLd: [organizationJsonLd(contactData.email), softwareJsonLd(lang, t.baupad.description)],
      }}
      className="ps-home"
      top={
        <div className="ph-top" data-dark-top="">
          <section className="ph-hero" aria-labelledby="ph-title">
            {/* großes, ganz zartes PAD-Zeichen; mittig darauf das Zeichen aus weißem Liquid Glass (wächst beim Öffnen) */}
            <div className="ph-mark" aria-hidden="true">
              <img src="/site/pad-mark-bg.svg" alt="" width={859} height={830} />
              <PadMarkGlass />
            </div>
            <p className="ps-eyebrow">{h.hero.eyebrow}</p>
            <h1 id="ph-title">
              PAD <span>Software</span>
            </h1>
            <p className="ps-motto" data-testid="home-motto">
              {/* in Großbuchstaben mit Mittelpunkt dazwischen – ohne die Punkte am Wortende */}
              {h.hero.motto.map((m) => (
                <span key={m}>{m.replace(/\.$/, '')}</span>
              ))}
            </p>
            <p className="ph-lead">{h.hero.lead}</p>
            <p className="ph-btns">
              <a href="#loesungen" className="ph-b1" data-testid="cta-solutions">
                {h.hero.primary}
              </a>
              <a href={paths.company(lang)} className="ph-b2" data-testid="cta-company">
                {h.hero.secondary}
              </a>
            </p>
          </section>
        </div>
      }
    >
      <section id="loesungen" className="ph-win ph-prod" aria-labelledby="ph-bp-title">
        <div>
          <p className="ps-eyebrow">{h.product.eyebrow}</p>
          <span className="ps-app-icon ph-app-icon" aria-hidden="true">
            <span>BauPad</span>
          </span>
          <h2 id="ph-bp-title">
            {h.product.name} <span className="ph-tag">{h.product.status}</span>
          </h2>
          <p className="ph-tagline">{h.product.tagline}</p>
          {/* alle Werkzeuge wie in der App: Symbol im farbigen Feld, daneben der Name – jedes führt zur Werkzeug-Seite */}
          <ul className="ph-tools" data-testid="home-tool-list" aria-label={w.aria}>
            {TOOL_ENTRIES.map((x) => (
              <li key={x.id}>
                <a href={toolPath(x.id, lang)} style={{ '--tool': x.color } as CSSProperties}>
                  <span className="ph-tool-icon" aria-hidden="true">
                    <ToolIcon name={x.icon} size={22} />
                  </span>
                  {t.tools[x.id].title}
                </a>
              </li>
            ))}
          </ul>
          <p className="ph-btns">
            <a href={paths.baupad(lang)} className="ph-b1" data-testid="home-product">
              {h.product.cta}
            </a>
            <a href={paths.tools()} className="ph-b2" data-testid="home-open">
              {h.product.open}
            </a>
          </p>
        </div>
        <div className="ph-phone">
          <img src="/site/fotos-baustelle-iphone.jpg" alt={h.product.alts[2]} width={600} height={1298} loading="lazy" decoding="async" />
        </div>
      </section>

      <section id="entwicklung" className="ph-sec" aria-labelledby="ph-process-title">
        <p className="ps-eyebrow">{h.process.label}</p>
        <h2 id="ph-process-title">{h.process.title}</h2>
        <ol className="ph-steps" data-testid="home-steps">
          {h.process.steps.map((s) => (
            <li key={s.title}>{s.title}</li>
          ))}
        </ol>
      </section>

      <section id="kontakt" className="ph-sec" aria-labelledby="ph-contact-title">
        <p className="ps-eyebrow">{h.contact.label}</p>
        <h2 id="ph-contact-title">{h.contact.title}</h2>
        <p>{h.contact.text}</p>
        <p>
          <a href={`mailto:${contactData.email}`} className="ph-mail">
            {contactData.email}
          </a>
        </p>
        <p className="ph-btns">
          <a href={paths.contact(lang)} className="ph-b1" data-testid="cta-contact-2">
            {h.contact.primary}
          </a>
          <a href={paths.products(lang)} className="ph-b2" data-testid="cta-products">
            {h.contact.secondary}
          </a>
        </p>
      </section>
    </SiteLayout>
  );
}
