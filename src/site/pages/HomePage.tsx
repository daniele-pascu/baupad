import type { CSSProperties, ReactNode } from 'react';
import { ToolIcon } from '../../components/ToolIcon';
import { paths } from '../../lib/router';
import { contactData } from '../contact-data';
import { useLang } from '../i18n';
import { TOOL_ENTRIES } from '../products';
import { organizationJsonLd, siteAlternates, softwareJsonLd } from '../seo';
import { Reveal } from '../components/Reveal';
import { SiteLayout } from '../components/SiteShell';

const Arrow = () => <span aria-hidden="true">→</span>;
/** Zeichen der vier Stärken (Geräte, ohne Empfang, Unterlagen, alles greift ineinander) */
const GLYPHS: ReactNode[] = [
  <>
    <rect x="2" y="5" width="13" height="10" rx="1.5" />
    <path d="M1 18h15" />
    <rect x="17" y="8" width="5" height="11" rx="1.2" />
  </>,
  <>
    <path d="M3 9a14 14 0 0118 0M6.5 12.5a9 9 0 0111 0M10 16a4 4 0 014 0" />
    <path d="M3 3l18 18" />
  </>,
  <>
    <path d="M6 3h8l4 4v14H6z" />
    <path d="M14 3v4h4M9 13h6M9 17h6" />
  </>,
  <>
    <path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" />
  </>,
];

/** Laptop mit einem Bild der App (Beispieldaten) – in der BauPad-Karte */
function Laptop({ name, eager = false }: { name: string; eager?: boolean }) {
  return (
    <div className="fh-lap" aria-hidden="true">
      <div className="fh-lap-scr">
        <img src={`/site/baupad/${name}.jpg`} width={1200} height={750} alt="" loading={eager ? 'eager' : 'lazy'} decoding="async" />
      </div>
      <div className="fh-lap-base" />
    </div>
  );
}

/**
 * Startseite PAD Software: die Firma in Weiß und Schwarz – Aussage, Werte, Können, Zusagen. Farbe bringt nur das Produkt:
 * BauPad erscheint als schwarz-limettenfarbene Karte (im Kopf und im Abschnitt „Produkt“), beide führen zur BauPad-Seite.
 */
export function HomePage() {
  const { lang, t } = useLang();
  const h = t.home;
  const words = [...h.about.values.map((v) => v.title), ...h.promises.items.map((p) => p.title)];
  const band = words.map((w, i) => (i % 2 ? <i key={w}>{w}</i> : <span key={w}>{w}</span>));
  return (
    <SiteLayout meta={{ title: h.title, description: h.description, lang, alternates: siteAlternates('landing'), jsonLd: [organizationJsonLd(contactData.email), softwareJsonLd(lang, t.baupad.description)] }} className="ps-home fh">
      {/* 1. Kopf: das Unternehmen, rechts das Produkt als Karte */}
      <section className="fh-hero" aria-labelledby="fh-title">
        <div className="fh-w fh-hero-grid">
          <div>
            <p className="fh-badge">
              <i aria-hidden="true" />
              {h.hero.badge}
            </p>
            <h1 id="fh-title" className="fh-h1">
              {h.hero.title.map((l, i) => (
                <span key={l} className={i === h.hero.title.length - 1 ? 'fh-mark' : undefined}>
                  {l}{' '}
                </span>
              ))}
            </h1>
            <p className="fh-lead">{h.hero.lead}</p>
            <div className="fh-btns">
              <a href={paths.company(lang)} className="fh-b1" data-testid="cta-company">
                {h.hero.primary} <Arrow />
              </a>
              <a href={paths.contact(lang)} className="fh-b2" data-testid="cta-contact">
                {h.hero.secondary}
              </a>
            </div>
            <ul className="fh-facts">
              {h.hero.facts.map((f) => (
                <li key={f.k}>
                  <b>{f.k}</b>
                  <span>{f.text}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="fh-stack">
            <div className="fh-ghost fh-ghost-2" aria-hidden="true">
              {t.products.plannedTitle}
            </div>
            <div className="fh-ghost fh-ghost-1" aria-hidden="true">
              {t.products.plannedTitle}
            </div>
            <a href={paths.baupad(lang)} className="fh-bp" aria-label={h.product.label} data-testid="home-hero-product">
              <span className="fh-bp-head">
                <img src="/icons/baupad-icon.png" width={54} height={54} alt="" />
                <b>BauPad</b>
                <em>{h.product.eyebrow}</em>
              </span>
              <span className="fh-bp-text">{h.product.text}</span>
              <Laptop name="pc-aufmass" eager />
              <span className="fh-bp-go">
                {h.product.cta} <Arrow />
              </span>
            </a>
          </div>
        </div>
      </section>

      {/* Laufband: wofür die Firma steht */}
      <div className="fh-words" aria-hidden="true">
        <div>
          {band}
          {band}
          {band}
        </div>
      </div>

      {/* 2. Das Unternehmen */}
      <section className="fh-sec" id="unternehmen">
        <div className="fh-w fh-two">
          <Reveal>
            <p className="fh-eye">{h.about.eyebrow}</p>
            <h2 className="fh-h2">
              {h.about.title.map((l) => (
                <span key={l}>{l} </span>
              ))}
            </h2>
            <p className="fh-sub">{h.about.text}</p>
            <a href={paths.company(lang)} className="fh-b2 fh-more">
              {h.about.cta} <Arrow />
            </a>
          </Reveal>
          <ul className="fh-vals">
            {h.about.values.map((v, i) => (
              <Reveal key={v.title} as="li" className="fh-val" delay={i * 80}>
                <i aria-hidden="true">0{i + 1}</i>
                <div>
                  <h3>{v.title}</h3>
                  <p>{v.text}</p>
                </div>
              </Reveal>
            ))}
          </ul>
        </div>
      </section>

      {/* 3. Produkt: BauPad groß, daneben was in Planung ist */}
      <section className="fh-sec fh-sec-tight" id="baupad">
        <div className="fh-w">
          <Reveal>
            <p className="fh-eye">{h.product.eyebrow}</p>
            <h2 className="fh-h2">
              {h.product.title.map((l) => (
                <span key={l}>{l} </span>
              ))}
            </h2>
          </Reveal>
          <div className="fh-prods">
            <a href={paths.baupad(lang)} className="fh-bp fh-bp-wide" aria-label={h.product.label} data-testid="home-product">
              <span className="fh-bp-head">
                <img src="/icons/baupad-icon.png" width={54} height={54} alt="" />
                <b>BauPad</b>
                <em>{t.products.availableTitle}</em>
              </span>
              <span className="fh-bp-text">{h.product.text}</span>
              <ul className="fh-chips" data-testid="home-tools">
                {TOOL_ENTRIES.map((x) => (
                  <li key={x.id} style={{ '--c': x.color } as CSSProperties}>
                    <i>
                      <ToolIcon name={x.icon} size={14} />
                    </i>
                    {t.tools[x.id].title}
                  </li>
                ))}
              </ul>
              <Laptop name="pc-material" />
              <span className="fh-bp-go">
                {h.product.cta} <Arrow />
              </span>
            </a>
            <a href={paths.products(lang)} className="fh-plan" data-testid="home-planned">
              <small>{t.products.plannedTitle}</small>
              <span>{t.products.plannedNote}</span>
              <b>
                {t.nav.products} <Arrow />
              </b>
            </a>
          </div>
        </div>
      </section>

      {/* 4. Was wir können */}
      <section className="fh-sec fh-sec-tight" id="koennen">
        <div className="fh-w">
          <Reveal>
            <p className="fh-eye">{h.can.eyebrow}</p>
            <h2 className="fh-h2">{h.can.title}</h2>
          </Reveal>
          <div className="fh-feats">
            {h.can.items.map((c, i) => (
              <Reveal key={c.title} className="fh-card" delay={i * 70}>
                <i aria-hidden="true">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    {GLYPHS[i]}
                  </svg>
                </i>
                <h3>{c.title}</h3>
                <p>{c.text}</p>
              </Reveal>
            ))}
          </div>
          <ul className="fh-nums">
            {h.can.numbers.map((n) => (
              <li key={n.label}>
                <b data-count={n.value}>{n.value}</b>
                <span>{n.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 5. Zusagen */}
      <section className="fh-sec" id="zusagen">
        <div className="fh-w">
          <Reveal>
            <p className="fh-eye">{h.promises.eyebrow}</p>
            <h2 className="fh-h2">{h.promises.title}</h2>
          </Reveal>
          <ul className="fh-prom">
            {h.promises.items.map((p, i) => (
              <Reveal key={p.title} as="li" delay={i * 70}>
                <h3>{p.title}</h3>
                <p>{p.text}</p>
              </Reveal>
            ))}
          </ul>
        </div>
      </section>

      {/* 6. Kontakt */}
      <section className="fh-cta" id="kontakt">
        <div className="fh-w">
          <Reveal>
            <p className="fh-eye">{h.contact.eyebrow}</p>
            <h2 className="fh-h2">{h.contact.title}</h2>
            <p className="fh-sub">{h.contact.text}</p>
            <div className="fh-btns">
              <a href={paths.contact(lang)} className="fh-b1" data-testid="cta-contact-2">
                {h.contact.cta} <Arrow />
              </a>
            </div>
          </Reveal>
        </div>
      </section>
    </SiteLayout>
  );
}
