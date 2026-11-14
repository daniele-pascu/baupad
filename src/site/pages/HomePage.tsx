import { paths } from '../../lib/router';
import { contactData } from '../contact-data';
import { useLang } from '../i18n';
import { organizationJsonLd, siteAlternates, softwareJsonLd } from '../seo';
import { Reveal } from '../components/Reveal';
import { SiteLayout } from '../components/SiteShell';
import { ToolWall } from '../components/ToolWall';

const Arrow = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);
const IMG = '/site/baupad';
/** Zeichen der vier Schritte: verstehen, entwickeln, Rückmeldung, verbessern – bewusst ohne Nummern */
const STEP_GLYPHS = [
  <path key="a" d="M11 17a6 6 0 100-12 6 6 0 000 12zM20 20l-4.700-4.700" />,
  <path key="b" d="M8 8l-4 4 4 4M16 8l4 4-4 4M13.500 6l-3 12" />,
  <path key="c" d="M5 5h14v10h-8.500L5 19z" />,
  <path key="d" d="M4 17l5-5 4 4 7-8M15 8h5v5" />,
];
/** Zeichen der sechs Technik-Punkte – ebenfalls ohne Nummern */
const TECH_GLYPHS = [
  <path key="a" d="M8 8l-4 4 4 4M16 8l4 4-4 4M13.500 6l-3 12" />,
  <path key="b" d="M5 5h14v6H5zM5 13h14v6H5zM8 8h.01M8 16h.01" />,
  <path key="c" d="M5 6c0-1.700 3.100-3 7-3s7 1.300 7 3-3.100 3-7 3-7-1.300-7-3zM5 6v12c0 1.700 3.100 3 7 3s7-1.300 7-3V6M5 12c0 1.700 3.100 3 7 3s7-1.300 7-3" />,
  <path key="d" d="M12 3l7 3v5c0 4.500-3 8-7 10-4-2-7-5.500-7-10V6zM9 12l2 2 4-4" />,
  <path key="e" d="M12 3l9 5-9 5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5" />,
  <path key="f" d="M20 12a8 8 0 11-2.300-5.700M20 4v5h-5" />,
];
/** Zeichen der fünf Grundsätze (Hammer: Lucide, ISC-Lizenz) */
const GLYPHS = [
  <path key="a" d="M12 21s-6-5.6-6-10a6 6 0 0112 0c0 4.400-6 10-6 10zM12 13a2 2 0 100-4 2 2 0 000 4z" />,
  <g key="b">
    <path d="m15 12-8.373 8.373a1 1 0 1 1-3-3L12 9" />
    <path d="m18 15 4-4" />
    <path d="m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172V7l-2.26-2.26a6 6 0 0 0-4.202-1.756L9 2.96l.92.82A6.18 6.18 0 0 1 12 8.4V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5" />
  </g>,
  <path key="c" d="M5 12.500l4.500 4.500L19 7.500" />,
  <path key="d" d="M20 12a8 8 0 11-2.300-5.700M20 4v5h-5" />,
  <path key="e" d="M5 6h14v5H5zM5 13h14v5H5zM8 8.500h.01M8 15.500h.01" />,
];

/**
 * Startseite PAD Software („Lime Contrast“), gebaut wie eine Produktseite: wenig Text, große Bilder.
 * Erster Bildschirm (schwarz, bildschirmfüllend): Name, Motto, ein Satz, rechts groß das Logo → wofür wir stehen →
 * BauPad (was es löst, drei kurze Punkte, Laptop + Tablet + Handy) → Kachelwand der sieben Werkzeuge → weiter zur
 * Produktseite → vier Schritte, sechs Technik-Punkte je in einer Zeile → Kontakt.
 * Jeder Bereich hat eine Überschrift und höchstens eine kurze Zeile. Keine Zertifikate, Garantien oder unbelegten Zahlen.
 */
export function HomePage() {
  const { lang, t } = useLang();
  const h = t.home;
  return (
    <SiteLayout meta={{ title: h.title, description: h.description, lang, alternates: siteAlternates('landing'), jsonLd: [organizationJsonLd(contactData.email), softwareJsonLd(lang, t.baupad.description)] }} className="ps-home ph">
      {/* Erster Bildschirm: wer wir sind – schwarz, füllt auf jedem Gerät den ganzen Bildschirm, rechts groß das Logo */}
      <section className="ph-hero" aria-labelledby="ph-title">
        <div className="ph-w ph-hero-grid">
          <div className="ph-hero-text">
            <p className="ph-mono ph-eye">{h.hero.eyebrow}</p>
            <h1 id="ph-title" className="ph-h1">
              {h.hero.name}
            </h1>
            <p className="ph-motto" data-testid="home-motto">
              {h.hero.motto.map((m) => (
                <span key={m}>{m}</span>
              ))}
            </p>
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
          <div className="ph-hero-logo" aria-hidden="true">
            <img src="/icons/pad-mark-gross.png" width={855} height={830} alt="" />
          </div>
        </div>
      </section>

      {/* Über uns: fünf Grundsätze, je eine Zeile */}
      <section className="ph-sec ph-light" id="ueber-uns">
        <div className="ph-w">
          <Reveal className="ph-head">
            <h2 className="ph-h2">{h.about.title}</h2>
            <a href={paths.company(lang)} className="ph-more">
              {h.about.more} <Arrow />
            </a>
          </Reveal>
          <ul className="ph-vals">
            {h.about.values.map((v, i) => (
              <Reveal key={v.title} as="li" className="ph-val" delay={i * 60}>
                <i aria-hidden="true">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    {GLYPHS[i]}
                  </svg>
                </i>
                <h3>{v.title}</h3>
                <p>{v.text}</p>
              </Reveal>
            ))}
          </ul>
        </div>
      </section>

      {/* BauPad: was es löst, ganz kurz was es kann, Laptop + Tablet + Handy */}
      <section className="ph-bp" id="loesungen" aria-labelledby="ph-bp-title">
        <div className="ph-w">
          <p className="ph-mono ph-tag">
            <i aria-hidden="true" />
            {h.product.tag}
          </p>
          <h2 id="ph-bp-title" className="ph-bp-name">
            <img src="/icons/baupad-icon.png" width={72} height={72} alt="" />
            {h.product.name}
          </h2>
          <p className="ph-bp-line">{h.product.tagline}</p>
          <p className="ph-bp-solves">{h.product.solves}</p>
          <ul className="ph-bp-can" data-testid="home-can">
            {h.product.can.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <div className="ph-btns">
            <a href={paths.baupad(lang)} className="ph-btn ph-btn-lime" aria-label={h.product.aria} data-testid="home-product">
              {h.product.cta} <Arrow />
            </a>
            <a href={paths.tools()} className="ph-btn ph-btn-line" data-testid="home-open">
              {h.product.open}
            </a>
          </div>
          <a href={paths.baupad(lang)} className="ph-stage" tabIndex={-1} aria-hidden="true" data-testid="home-stage">
            <span className="ph-lap">
              <span className="ph-lap-scr">
                <img src={`${IMG}/pc-aufmass.jpg`} width={1440} height={900} alt="" loading="lazy" decoding="async" />
              </span>
              <span className="ph-lap-base" />
            </span>
            <span className="ph-tab">
              <img src={`${IMG}/tablet-einteilung.jpg`} width={1180} height={820} alt="" loading="lazy" decoding="async" />
            </span>
            <span className="ph-phone">
              <img src={`${IMG}/handy-fotos.jpg`} width={585} height={1266} alt="" loading="lazy" decoding="async" />
            </span>
          </a>
        </div>
      </section>

      {/* Die sieben Werkzeuge als Kachelwand */}
      <ToolWall />

      {/* Weiter zu den Werkzeugen (Produktseite BauPad) */}
      <section className="ph-sec ph-black ph-tools">
        <div className="ph-w">
          <a href={paths.baupad(lang)} className="ph-btn ph-btn-lime" data-testid="home-tools">
            {h.product.all} <Arrow />
          </a>
          <Reveal className="ph-slot">
            <b>{h.product.more}</b>
            <span className="ph-mono">{h.product.moreTag}</span>
          </Reveal>
        </div>
      </section>

      {/* Unsere Entwicklung: vier Schritte auf einer Linie */}
      <section className="ph-sec ph-light" id="entwicklung">
        <div className="ph-w">
          <Reveal className="ph-head">
            <h2 className="ph-h2">{h.process.title}</h2>
          </Reveal>
          <ol className="ph-steps" data-progress="fill">
            {h.process.steps.map((s, i) => (
              <Reveal key={s.title} as="li" className="ph-step" delay={i * 80}>
                <span className="ph-step-no" aria-hidden="true">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    {STEP_GLYPHS[i]}
                  </svg>
                </span>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      {/* Technologie und Infrastruktur: sechs Punkte */}
      <section className="ph-sec ph-black" id="technologie">
        <div className="ph-w">
          <Reveal className="ph-head">
            <h2 className="ph-h2">{h.tech.title}</h2>
          </Reveal>
          <ul className="ph-tech">
            {h.tech.items.map((x, i) => (
              <Reveal key={x.title} as="li" delay={(i % 3) * 60}>
                <i aria-hidden="true">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    {TECH_GLYPHS[i]}
                  </svg>
                </i>
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
