import type { CSSProperties } from 'react';
import { ToolIcon } from '../../components/ToolIcon';
import { paths } from '../../lib/router';
import { contactData } from '../contact-data';
import { useLang } from '../i18n';
import { TOOL_ENTRIES, toolPath } from '../products';
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
const IMG = '/site/baupad';
/** Vier Werkzeuge groß im Bild: welches Bild, welches Gerät, heller oder dunkler Grund */
const TILES: { id: 'projects' | 'workers' | 'times' | 'materials'; img: string; device: 'pc' | 'handy' | 'tablet'; tone: 'dark' | 'light' }[] = [
  { id: 'projects', img: 'pc-aufmass', device: 'pc', tone: 'dark' },
  { id: 'workers', img: 'pc-einteilung', device: 'pc', tone: 'light' },
  { id: 'times', img: 'handy-zeit', device: 'handy', tone: 'light' },
  { id: 'materials', img: 'tablet-bestellungen', device: 'tablet', tone: 'dark' },
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
 * das Produkt BauPad in Laptop und Handy → Kachelwand der sieben Werkzeuge → vier Werkzeuge groß im Bild →
 * vier Schritte, sechs Technik-Punkte je in einer Zeile → Kontakt.
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

      {/* 01 Über uns: fünf Grundsätze, je eine Zeile */}
      <section className="ph-sec ph-light" id="ueber-uns">
        <div className="ph-w">
          <Reveal className="ph-head">
            <p className="ph-mono ph-label">
              <b>01</b> {h.about.label}
            </p>
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

      {/* Das Produkt – sofort im Bild */}
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
          <div className="ph-btns">
            <a href={paths.baupad(lang)} className="ph-btn ph-btn-black" aria-label={h.product.aria} data-testid="home-product">
              {h.product.cta} <Arrow />
            </a>
            <a href={paths.tools()} className="ph-btn ph-btn-dark-line" data-testid="home-open">
              {h.product.open}
            </a>
          </div>
          <a href={paths.baupad(lang)} className="ph-stage" tabIndex={-1} aria-hidden="true" data-testid="home-stage">
            <span className="ph-lap">
              <span className="ph-lap-scr">
                <img src={`${IMG}/pc-aufmass.jpg`} width={1200} height={750} alt="" />
              </span>
              <span className="ph-lap-base" />
            </span>
            <span className="ph-phone">
              <img src={`${IMG}/handy-zeit.jpg`} width={560} height={1212} alt="" />
            </span>
          </a>
        </div>
      </section>

      {/* Die sieben Werkzeuge als Kachelwand */}
      <ToolWall />

      {/* Vier Werkzeuge groß im Bild */}
      <section className="ph-sec ph-black ph-tools">
        <div className="ph-w">
          <ul className="ph-tiles" data-testid="home-tiles">
            {TILES.map((x, i) => {
              const tool = TOOL_ENTRIES.find((e) => e.id === x.id)!;
              return (
                <Reveal key={x.id} as="li" delay={(i % 2) * 80}>
                  <a href={toolPath(x.id, lang)} className={`ph-tile ph-tile-${x.tone}`} style={{ '--c': tool.color } as CSSProperties} data-testid="home-tile">
                    <span className="ph-tile-icon">
                      <ToolIcon name={tool.icon} size={24} />
                    </span>
                    <span className="ph-tile-name">{t.tools[x.id].title}</span>
                    <span className="ph-tile-line">{t.baupad.tools.items[x.id].hook}</span>
                    <span className={`ph-tile-shot ph-tile-${x.device}`} aria-hidden="true">
                      <img src={`${IMG}/${x.img}.jpg`} width={x.device === 'handy' ? 560 : x.device === 'tablet' ? 1000 : 1200} height={x.device === 'handy' ? 1212 : x.device === 'tablet' ? 695 : 750} alt="" loading="lazy" decoding="async" />
                    </span>
                  </a>
                </Reveal>
              );
            })}
          </ul>
          <Reveal className="ph-slot">
            <b>{h.product.more}</b>
            <span className="ph-mono">{h.product.moreTag}</span>
          </Reveal>
        </div>
      </section>

      {/* 02 Unsere Entwicklung: vier Schritte */}
      <section className="ph-sec ph-light ph-sec-tight" id="entwicklung">
        <div className="ph-w">
          <Reveal className="ph-head">
            <p className="ph-mono ph-label">
              <b>02</b> {h.process.label}
            </p>
            <h2 className="ph-h2">{h.process.title}</h2>
          </Reveal>
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

      {/* 03 Technologie und Infrastruktur: sechs Punkte */}
      <section className="ph-sec ph-black" id="technologie">
        <div className="ph-w">
          <Reveal className="ph-head">
            <p className="ph-mono ph-label">
              <b>03</b> {h.tech.label}
            </p>
            <h2 className="ph-h2">{h.tech.title}</h2>
          </Reveal>
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
