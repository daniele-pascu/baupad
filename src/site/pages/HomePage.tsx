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
/**
 * Startseite PAD Software („Lime Contrast“), gebaut wie eine Produktseite: wenig Text, große Bilder.
 * Erster Bildschirm (schwarz, bildschirmfüllend): Name, Motto, ein Satz, Tasten „Unsere Produkte“ / „Über uns“, rechts
 * groß das Logo → direkt darunter BauPad (was es löst, drei kurze Punkte, Laptop + Tablet + Handy) → Kachelwand der sieben Werkzeuge → weiter zur
 * Produktseite → vier Schritte → Kontakt. „Wofür wir stehen“ und die Technik stehen auf „Über uns“.
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
            {/* „PAD“ kräftig, „Software“ dünn – wie im Schriftzug des Logos */}
            <h1 id="ph-title" className="ph-h1">
              <strong>{h.hero.name.split(' ')[0]}</strong> <span>{h.hero.name.split(' ').slice(1).join(' ')}</span>
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
