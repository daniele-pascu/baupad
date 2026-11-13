import type { CSSProperties, ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { paths } from '../../lib/router';
import { contactData } from '../contact-data';
import { useLang } from '../i18n';
import { organizationJsonLd, siteAlternates, softwareJsonLd } from '../seo';
import { BuildScene } from '../components/BuildScene';
import { Reveal } from '../components/Reveal';
import { Lines, Section, SectionHead } from '../components/Section';
import { Backdrop } from '../components/Shapes';
import { SiteLayout } from '../components/SiteShell';

/** Strichzeichnungen zu „Was wir können“ – zeichnen sich beim Einblenden selbst */
const GLYPHS: ReactNode[] = [
  // Geräte: PC, Tablet, Handy
  <>
    <rect x="4" y="12" width="36" height="25" rx="2.5" pathLength={1} />
    <path d="M22 37v8M14 45h16" pathLength={1} />
    <rect className="fill" x="30" y="22" width="20" height="28" rx="2.5" pathLength={1} />
    <rect className="fill" x="46" y="30" width="13" height="24" rx="2.5" pathLength={1} />
  </>,
  // ohne Empfang: Balken, durchgestrichen
  <>
    <path d="M14 52v-8M26 52v-17M38 52V26M50 52V17" pathLength={1} />
    <path d="M8 14l48 44" pathLength={1} />
  </>,
  // Unterlagen: Blatt mit Zeilen
  <>
    <path d="M16 8h22l10 10v38H16z" pathLength={1} />
    <path d="M38 8v10h10" pathLength={1} />
    <path d="M23 29h18M23 37h18M23 45h11" pathLength={1} />
  </>,
  // Formular: Klemmbrett mit Haken
  <>
    <path d="M26 12h-8v44h28V12h-8" pathLength={1} />
    <rect x="26" y="8" width="12" height="8" rx="2" pathLength={1} />
    <path d="M24 29l3 3 5-6M24 42l3 3 5-6" pathLength={1} />
    <path d="M37 30h5M37 43h5" pathLength={1} />
  </>,
];

/** Startseite: Kopf, Kennzahlen, BauPad als Gebäude (Produkt im Mittelpunkt), Können, Ablauf, Unternehmen, Kontakt */
export function HomePage() {
  const { lang, t } = useLang();
  const h = t.home;
  return (
    <SiteLayout meta={{ title: h.title, description: h.description, lang, alternates: siteAlternates('landing'), jsonLd: [organizationJsonLd(contactData.email), softwareJsonLd(lang, t.baupad.description)] }} className="ps-home">
      {/* 1. Kopf: Plan-Raster in der Tiefe, bewegt sich mit dem Scrollen */}
      <section className="ps-hero ps-hero-home tone-midnight" aria-labelledby="ps-hero-title" data-hero="">
        <div className="ps-floor" aria-hidden="true">
          <i />
        </div>
        <div className="ps-wrap ps-hero-inner">
          <p className="ps-eyebrow ps-eyebrow-light ps-reveal is-in">{h.hero.eyebrow}</p>
          <h1 id="ps-hero-title" className="ps-display">
            <Lines lines={h.hero.title} />
          </h1>
          <p className="ps-lead ps-lead-light ps-hero-lead" data-reveal="" data-immediate="">
            {h.hero.lead}
          </p>
          <div className="ps-actions" data-reveal="" data-immediate="">
            <a href={paths.baupad(lang)} className="ps-btn ps-btn-light" data-testid="cta-baupad">
              {h.hero.primary} <Icon name="next" size={16} />
            </a>
            <a href={paths.contact(lang)} className="ps-btn ps-btn-outline" data-testid="cta-contact">
              {h.hero.secondary}
            </a>
          </div>
          <a href="#baupad" className="ps-scrollcue" data-reveal="" data-immediate="">
            <span aria-hidden="true" />
            {h.hero.scroll}
          </a>
        </div>
      </section>

      {/* 2. Kennzahlen */}
      <section className="ps-stats tone-white" aria-label={h.stats.label}>
        <ul className="ps-wrap ps-stats-row">
          {h.stats.items.map((s, i) => (
            <Reveal key={s.label} as="li" delay={i * 80}>
              <strong data-count={s.value}>{s.value}</strong>
              <span>{s.label}</span>
            </Reveal>
          ))}
        </ul>
      </section>

      {/* 3. Produkt: BauPad als Gebäude */}
      <BuildScene />

      {/* 4. Was wir können */}
      <Section tone="mist" id="koennen">
        <SectionHead eyebrow={h.can.eyebrow} title={h.can.title} />
        <div className="ps-can-grid">
          {h.can.items.map((c, i) => (
            <Reveal key={c.title} delay={i * 90} className="ps-can-item">
              <div className="ps-can-card" data-tilt="">
                <svg className="ps-glyph" viewBox="0 0 64 64" aria-hidden="true">
                  {GLYPHS[i]}
                </svg>
                <h3>{c.title}</h3>
                <p>{c.text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* 5. Ablauf: Linie zeichnet sich mit dem Scrollen */}
      <Section tone="white" id="ablauf">
        <SectionHead eyebrow={h.flow.eyebrow} title={h.flow.title} />
        <ol className="ps-flow" data-progress="fill">
          <li className="ps-flow-line" aria-hidden="true">
            <i />
          </li>
          {h.flow.steps.map((s, i) => (
            <li key={s.title} className="ps-flow-step" style={{ '--t': (i / 3 + 0.04).toFixed(3) } as CSSProperties}>
              <span className="ps-flow-dot" aria-hidden="true">
                {i + 1}
              </span>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </li>
          ))}
        </ol>
      </Section>

      {/* 6. Werte als Laufband, bewegt sich mit dem Scrollen */}
      <div className="ps-marquee" data-progress="through" role="img" aria-label={h.values.join(' · ')}>
        <div aria-hidden="true">
          {[0, 1, 2].map((r) =>
            h.values.map((v, i) => (
              <span key={`${r}-${v}`} className={(r * h.values.length + i) % 2 ? 'is-line' : ''}>
                {v}
              </span>
            )),
          )}
        </div>
      </div>

      {/* 7. Unternehmen */}
      <Section tone="white" id="unternehmen" className="ps-company">
        <div className="ps-company-grid">
          <div>
            <SectionHead eyebrow={h.company.eyebrow} title={h.company.title} text={h.company.text} />
            <Reveal className="ps-inline-cta">
              <a href={paths.company(lang)} className="ps-link">
                {h.company.cta} <Icon name="next" size={14} />
              </a>
            </Reveal>
          </div>
          <ul className="ps-promises">
            {h.company.promises.map((p, i) => (
              <Reveal key={p.title} as="li" delay={i * 80}>
                <span aria-hidden="true">{`0${i + 1}`}</span>
                <div>
                  <h3>{p.title}</h3>
                  <p>{p.text}</p>
                </div>
              </Reveal>
            ))}
          </ul>
        </div>
      </Section>

      {/* 8. Kontakt */}
      <Section tone="midnight" id="kontakt" className="ps-contact-cta">
        <Backdrop variant="contact" />
        <SectionHead eyebrow={h.contact.eyebrow} title={h.contact.title} text={h.contact.text} align="center" />
        <Reveal className="ps-actions ps-actions-center">
          <a href={paths.contact(lang)} className="ps-btn ps-btn-light ps-btn-lg" data-testid="cta-contact-2">
            {h.contact.cta} <Icon name="next" size={16} />
          </a>
          <a href={`mailto:${contactData.email}`} className="ps-link ps-link-light">
            {contactData.email}
          </a>
        </Reveal>
      </Section>
    </SiteLayout>
  );
}
