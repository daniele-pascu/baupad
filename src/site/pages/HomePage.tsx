import type { CSSProperties } from 'react';
import { ToolIcon } from '../../components/ToolIcon';
import { paths } from '../../lib/router';
import { contactData } from '../contact-data';
import { useLang } from '../i18n';
import { TOOL_ENTRIES } from '../products';
import { organizationJsonLd, siteAlternates, softwareJsonLd } from '../seo';
import { Reveal } from '../components/Reveal';
import { SiteLayout } from '../components/SiteShell';

/** Leuchtfarbe je Werkzeug auf dunklem Grund (dunkle Töne aufgehellt) */
const LIT: Record<string, string> = { projects: '#ff7a2b', workers: '#4d95f5', reports: '#b47bff', photos: '#7fb2ff', defects: '#ff5b62', times: '#2fd6a7', materials: '#f2b632' };
const VALUE_COLORS = ['#2f80ed', '#0f9d76', '#ff6a13'];
const Arrow = () => <span aria-hidden="true">→</span>;

/**
 * Startseite: zuerst das Unternehmen (Kopf, Werte, Können), dann BauPad als eine große antippbare Karte mit dem
 * leuchtenden Stapel der sieben Werkzeuge (führt zur BauPad-Seite), Zusagen und Kontakt. Dunkle und weiße Flächen
 * wechseln sich ab. Rein gezeichnet – keine Bilder der Software, keine Fotos.
 */
export function HomePage() {
  const { lang, t } = useLang();
  const h = t.home;
  return (
    <SiteLayout meta={{ title: h.title, description: h.description, lang, alternates: siteAlternates('landing'), jsonLd: [organizationJsonLd(contactData.email), softwareJsonLd(lang, t.baupad.description)] }} className="ps-home hp">
      {/* 1. Kopf: das Unternehmen */}
      <section className="hp-hero hp-dark" aria-labelledby="hp-title">
        <div className="hp-beam" aria-hidden="true" />
        <div className="hp-gridbg" aria-hidden="true" />
        <div className="hp-w">
          <p className="hp-pill">
            <i aria-hidden="true" />
            {h.hero.badge}
          </p>
          <h1 id="hp-title" className="hp-h1 hp-grad">
            {h.hero.title.map((l) => (
              <span key={l}>{l} </span>
            ))}
          </h1>
          <p className="hp-lead">{h.hero.lead}</p>
          <div className="hp-btns">
            <a href={paths.company(lang)} className="hp-b1" data-testid="cta-company">
              {h.hero.primary} <Arrow />
            </a>
            <a href={paths.contact(lang)} className="hp-b2" data-testid="cta-contact">
              {h.hero.secondary}
            </a>
          </div>
          <ul className="hp-facts">
            {h.hero.facts.map((f) => (
              <li key={f.k}>
                <b>{f.k}</b>
                <span>{f.text}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 2. Das Unternehmen */}
      <section className="hp-sec hp-light" id="unternehmen">
        <div className="hp-w hp-about">
          <Reveal>
            <p className="hp-mono">{h.about.eyebrow}</p>
            <h2 className="hp-h2 hp-grad">
              {h.about.title.map((l) => (
                <span key={l}>{l} </span>
              ))}
            </h2>
            <p className="hp-sub">{h.about.text}</p>
            <a href={paths.company(lang)} className="hp-b2 hp-about-cta">
              {h.about.cta} <Arrow />
            </a>
          </Reveal>
          <ul className="hp-vals">
            {h.about.values.map((v, i) => (
              <Reveal key={v.title} as="li" delay={i * 90} className="hp-card hp-val" style={{ '--c': VALUE_COLORS[i] } as CSSProperties}>
                <i aria-hidden="true">{`0${i + 1}`}</i>
                <div>
                  <h3>{v.title}</h3>
                  <p>{v.text}</p>
                </div>
              </Reveal>
            ))}
          </ul>
        </div>
      </section>

      {/* 3. Was wir können */}
      <section className="hp-sec hp-mist" id="koennen">
        <div className="hp-w">
          <Reveal>
            <p className="hp-mono">{h.can.eyebrow}</p>
            <h2 className="hp-h2 hp-grad">{h.can.title}</h2>
          </Reveal>
          <div className="hp-feats">
            <Reveal className="hp-card hp-f1">
              <div className="hp-viz hp-v1" aria-hidden="true">
                <i />
                <i />
                <i />
              </div>
              <h3>{h.can.items[0].title}</h3>
              <p>{h.can.items[0].text}</p>
            </Reveal>
            <Reveal className="hp-card" delay={80}>
              <div className="hp-viz hp-v2" aria-hidden="true">
                {[1, 2, 3, 4].map((i) => (
                  <i key={i} style={{ height: i * 18 }} />
                ))}
                <b />
              </div>
              <h3>{h.can.items[1].title}</h3>
              <p>{h.can.items[1].text}</p>
            </Reveal>
            <Reveal className="hp-card" delay={160}>
              <div className="hp-viz hp-v3" aria-hidden="true">
                <span>XLSX</span>
                <span>PDF</span>
                <span>LV</span>
              </div>
              <h3>{h.can.items[2].title}</h3>
              <p>{h.can.items[2].text}</p>
            </Reveal>
            <Reveal className="hp-card hp-f4" delay={120}>
              <div className="hp-viz hp-v4">
                {h.can.numbers.map((n) => (
                  <span key={n.label}>
                    <b>{n.value}</b>
                    <small>{n.label}</small>
                  </span>
                ))}
              </div>
              <h3>{h.can.items[3].title}</h3>
              <p>{h.can.items[3].text}</p>
            </Reveal>
          </div>
        </div>
      </section>

      {/* 4. Unser Produkt: die ganze Karte führt zur BauPad-Seite */}
      <section className="hp-sec hp-light hp-prod-sec" id="baupad">
        <div className="hp-w">
          <Reveal>
            <p className="hp-mono">{h.product.eyebrow}</p>
          </Reveal>
          <Reveal>
            <a href={paths.baupad(lang)} className="hp-prod hp-dark" aria-label={h.product.label} data-testid="home-product" data-progress="enter">
              <div className="hp-prod-text">
                <p className="hp-bp">
                  <img src="/icons/baupad-icon.png" alt="" width={74} height={70} className="ps-build-logo" />
                  <b>{t.product}</b>
                  <span>{t.common.available}</span>
                </p>
                <h2 className="hp-h2 hp-grad">
                  {h.product.title.map((l) => (
                    <span key={l}>{l} </span>
                  ))}
                </h2>
                <p className="hp-sub">{h.product.text}</p>
                <ul className="hp-chips" data-testid="home-tools">
                  {TOOL_ENTRIES.map((x) => (
                    <li key={x.id} style={{ '--c': LIT[x.id] ?? x.color } as CSSProperties}>
                      <i aria-hidden="true">
                        <ToolIcon name={x.icon} size={14} />
                      </i>
                      {t.tools[x.id].title}
                    </li>
                  ))}
                </ul>
                <span className="hp-b1">
                  {h.product.cta} <Arrow />
                </span>
              </div>
              <div className="hp-scene" aria-hidden="true">
                <div className="hp-stack">
                  {TOOL_ENTRIES.map((x, i) => (
                    <div key={x.id} className="hp-pl" style={{ '--c': LIT[x.id] ?? x.color, '--i': i } as CSSProperties}>
                      <ToolIcon name={x.icon} size={19} />
                      <span>{t.tools[x.id].title}</span>
                    </div>
                  ))}
                  <div className="hp-pl hp-pl-top" style={{ '--i': TOOL_ENTRIES.length } as CSSProperties}>
                    <img src="/icons/baupad-icon.png" alt="" width={170} height={161} className="ps-build-logo" />
                  </div>
                </div>
              </div>
            </a>
          </Reveal>
        </div>
      </section>

      {/* 5. Was Sie erwarten können */}
      <section className="hp-sec hp-light hp-prom-sec" id="zusagen">
        <div className="hp-w">
          <Reveal>
            <p className="hp-mono">{h.promises.eyebrow}</p>
            <h2 className="hp-h2 hp-grad">{h.promises.title}</h2>
          </Reveal>
          <ul className="hp-prom">
            {h.promises.items.map((p, i) => (
              <Reveal key={p.title} as="li" delay={i * 80}>
                <span aria-hidden="true">{`0${i + 1}`}</span>
                <h3>{p.title}</h3>
                <p>{p.text}</p>
              </Reveal>
            ))}
          </ul>
        </div>
      </section>

      {/* 6. Kontakt */}
      <section className="hp-cta hp-dark" id="kontakt">
        <div className="hp-halo" aria-hidden="true" />
        <div className="hp-w">
          <Reveal>
            <p className="hp-mono">{h.contact.eyebrow}</p>
            <h2 className="hp-h2 hp-grad">{h.contact.title}</h2>
            <p className="hp-sub">{h.contact.text}</p>
            <div className="hp-btns">
              <a href={paths.contact(lang)} className="hp-b1" data-testid="cta-contact-2">
                {h.contact.cta} <Arrow />
              </a>
              <a href={`mailto:${contactData.email}`} className="hp-b2">
                {contactData.email}
              </a>
            </div>
          </Reveal>
        </div>
      </section>
    </SiteLayout>
  );
}
