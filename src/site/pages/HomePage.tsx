import { paths } from '../../lib/router';
import { contactData } from '../contact-data';
import { useLang } from '../i18n';
import { TOOL_ENTRIES } from '../products';
import { organizationJsonLd, siteAlternates, softwareJsonLd } from '../seo';
import { Reveal } from '../components/Reveal';
import { SiteLayout } from '../components/SiteShell';
import { ToolWall } from '../components/ToolWall';

const Arrow = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);
const no = (i: number) => String(i).padStart(2, '0');

/**
 * Startseite PAD Software („Lime Contrast“: Anthrazit und Schwarz, Lime als Akzent, Weiß und helles Grau):
 * Aussage und Logo, vier Kurzangaben, dann nummeriert Über uns (fünf Grundsätze), Unsere Lösungen (Kachelwand der
 * sieben BauPad-Werkzeuge, BauPad als Produkt, Platz für weitere), Unsere Entwicklung (vier Schritte), Technologie
 * und Infrastruktur (sechs Themen), Kontakt. Keine Zertifikate, Garantien oder Zahlen, die nicht belegt sind.
 */
export function HomePage() {
  const { lang, t } = useLang();
  const h = t.home;
  return (
    <SiteLayout meta={{ title: h.title, description: h.description, lang, alternates: siteAlternates('landing'), jsonLd: [organizationJsonLd(contactData.email), softwareJsonLd(lang, t.baupad.description)] }} className="ps-home ph">
      {/* Erster Blick */}
      <section className="ph-hero" aria-labelledby="ph-title">
        <div className="ph-w ph-hero-grid">
          <div>
            <p className="ph-mono ph-eye">{h.hero.eyebrow}</p>
            <h1 id="ph-title" className="ph-h1">
              {h.hero.title[0]}
              <em>{h.hero.title[1]}</em>
              {h.hero.title[2]}
            </h1>
            <p className="ph-lead">{h.hero.lead}</p>
            <div className="ph-btns">
              <a href="#loesungen" className="ph-btn ph-btn-lime" data-testid="cta-solutions">
                {h.hero.primary} <Arrow />
              </a>
              <a href={paths.company(lang)} className="ph-btn ph-btn-line" data-testid="cta-company">
                {h.hero.secondary}
              </a>
            </div>
          </div>
          <div className="ph-frame" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <img src="/icons/pad-icon-512.png" width={512} height={512} alt="" />
            <span className="ph-mono">PAD Software</span>
            <span className="ph-mono">AT</span>
          </div>
        </div>
        <div className="ph-spec">
          <ul className="ph-w">
            {h.hero.specs.map((s) => (
              <li key={s.k}>
                <small className="ph-mono">{s.k}</small>
                <b>{s.v}</b>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 01 Über uns */}
      <section className="ph-sec ph-light" id="ueber-uns">
        <div className="ph-w">
          <div className="ph-head">
            <p className="ph-mono ph-label">
              <b>01</b> {h.about.label}
            </p>
            <Reveal>
              <h2 className="ph-h2">{h.about.title}</h2>
              <p className="ph-text">{h.about.text}</p>
              <a href={paths.company(lang)} className="ph-more">
                {h.about.more} <Arrow />
              </a>
            </Reveal>
          </div>
          <ul className="ph-vals">
            {h.about.values.map((v, i) => (
              <Reveal key={v.title} as="li" className="ph-val" delay={i * 50}>
                <span className="ph-mono">{no(i + 1)}</span>
                <h3>{v.title}</h3>
                <p>{v.text}</p>
              </Reveal>
            ))}
          </ul>
        </div>
      </section>

      {/* 02 Unsere Lösungen */}
      <section className="ph-sec ph-anth" id="loesungen">
        <div className="ph-w">
          <div className="ph-head">
            <p className="ph-mono ph-label">
              <b>02</b> {h.solutions.label}
            </p>
            <Reveal>
              <h2 className="ph-h2">{h.solutions.title}</h2>
              <p className="ph-text">{h.solutions.text}</p>
            </Reveal>
          </div>
        </div>
        <ToolWall />
        <div className="ph-w">
          <Reveal className="ph-prod">
            <div className="ph-prod-text">
              <p className="ph-mono ph-tag">
                <i aria-hidden="true" />
                {h.solutions.tag}
              </p>
              <h3>
                <img src="/icons/baupad-icon.png" width={58} height={58} alt="" />
                BauPad
              </h3>
              <p>{h.solutions.productText}</p>
              <ul className="ph-chips" data-testid="home-tools">
                {TOOL_ENTRIES.map((x) => (
                  <li key={x.id}>{t.tools[x.id].title}</li>
                ))}
              </ul>
              <a href={paths.baupad(lang)} className="ph-btn ph-btn-lime" aria-label={h.solutions.label2} data-testid="home-product">
                {h.solutions.cta} <Arrow />
              </a>
            </div>
            <div className="ph-prod-shot" aria-hidden="true">
              <img src="/site/baupad/pc-aufmass.jpg" width={1200} height={750} alt="" loading="lazy" decoding="async" />
            </div>
          </Reveal>
          <Reveal className="ph-slot">
            <b>{h.solutions.more}</b>
            <span className="ph-mono">{h.solutions.moreTag}</span>
          </Reveal>
        </div>
      </section>

      {/* 03 Unsere Entwicklung */}
      <section className="ph-sec ph-light" id="entwicklung">
        <div className="ph-w">
          <div className="ph-head">
            <p className="ph-mono ph-label">
              <b>03</b> {h.process.label}
            </p>
            <Reveal>
              <h2 className="ph-h2">{h.process.title}</h2>
              <p className="ph-text">{h.process.text}</p>
            </Reveal>
          </div>
          <ol className="ph-steps" data-progress="fill">
            {h.process.steps.map((s, i) => (
              <Reveal key={s.title} as="li" className="ph-step" delay={i * 80}>
                <span className="ph-mono">
                  {h.process.stepLabel} {no(i + 1)}
                </span>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </Reveal>
            ))}
          </ol>
          <Reveal>
            <p className="ph-quote">
              {h.process.quote[0]}
              <em>{h.process.quote[1]}</em>
              {h.process.quote[2]}
            </p>
          </Reveal>
        </div>
      </section>

      {/* 04 Technologie und Infrastruktur */}
      <section className="ph-sec ph-black" id="technologie">
        <div className="ph-w">
          <div className="ph-head">
            <p className="ph-mono ph-label">
              <b>04</b> {h.tech.label}
            </p>
            <Reveal>
              <h2 className="ph-h2">{h.tech.title}</h2>
              <p className="ph-text">{h.tech.text}</p>
            </Reveal>
          </div>
          <ul className="ph-tech">
            {h.tech.items.map((x, i) => (
              <Reveal key={x.title} as="li" delay={(i % 3) * 60}>
                <span className="ph-mono">{no(i + 1)}</span>
                <h3>{x.title}</h3>
                <p>{x.text}</p>
              </Reveal>
            ))}
          </ul>
          <p className="ph-mono ph-note">{h.tech.note}</p>
        </div>
      </section>

      {/* Kontakt */}
      <section className="ph-cta" id="kontakt">
        <div className="ph-w">
          <Reveal>
            <h2 className="ph-h2">{h.contact.title}</h2>
            <p>{h.contact.text}</p>
          </Reveal>
          <div className="ph-btns">
            <a href={paths.contact(lang)} className="ph-btn ph-btn-black" data-testid="cta-contact-2">
              {h.contact.primary} <Arrow />
            </a>
            <a href={paths.products(lang)} className="ph-btn ph-btn-dark-line" data-testid="cta-products">
              {h.contact.secondary}
            </a>
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}
