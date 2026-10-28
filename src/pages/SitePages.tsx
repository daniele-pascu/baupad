import { useEffect } from 'react';
import { Icon } from '../components/Icon';
import { InstallButton } from '../components/InstallApp';
import { SiteFooter, SiteNav } from '../components/SiteNav';
import { site } from '../content/site';
import { paths } from '../lib/router';

export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = title;
    return () => {
      document.title = 'BauPad';
    };
  }, [title]);
}

/** Öffentliche Startseite */
export function LandingPage() {
  usePageTitle('BauPad');
  const t = site.home;
  return (
    <div className="site">
      <SiteNav />
      <main className="site-main">
        <section className="hero">
          <p className="hero-eyebrow fade-in">{t.eyebrow}</p>
          <h1 className="hero-title fade-in">{t.title}</h1>
          <p className="hero-lead fade-in delay-1">{t.lead}</p>
          <div className="hero-actions fade-in delay-2">
            <a href={paths.tools()} className="site-cta" data-testid="cta-tools">
              {t.cta}
              <span aria-hidden="true"> →</span>
            </a>
            <a href={paths.about()} className="site-cta site-cta-secondary">
              {t.secondary}
            </a>
          </div>
          <div className="hero-install fade-in delay-2">
            <InstallButton variant="link" />
          </div>
        </section>
        <section className="highlights fade-in delay-3" aria-label="Funktionen">
          {t.highlights.map((h) => (
            <div key={h.title} className="highlight">
              <span className="highlight-icon" aria-hidden="true">
                <Icon name={h.icon} size={22} />
              </span>
              <h2>{h.title}</h2>
              <p>{h.text}</p>
            </div>
          ))}
        </section>
        <ul className="site-facts fade-in delay-3" aria-label="Eigenschaften">
          {t.facts.map((f) => (
            <li key={f}>
              <Icon name="check" size={16} />
              {f}
            </li>
          ))}
        </ul>
      </main>
      <SiteFooter />
    </div>
  );
}

export function AboutPage() {
  usePageTitle('Über BauPad');
  const t = site.about;
  return (
    <div className="site">
      <SiteNav />
      <main className="site-main site-text">
        <h1 className="site-title fade-in">{t.title}</h1>
        {t.paragraphs.map((p, i) => (
          <p key={i} className={`fade-in delay-${Math.min(i + 1, 3)}`}>
            {p}
          </p>
        ))}
        <p className="fade-in delay-3">
          <a href={paths.tools()} className="site-cta">
            {site.home.cta}
            <span aria-hidden="true"> →</span>
          </a>
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}

export function ContactPage() {
  usePageTitle('Kontakt – BauPad');
  const t = site.contact;
  const rows: [string, string, 'mail' | 'tel' | null][] = [
    ['Firma', t.company, null],
    ['Ansprechperson', t.person, null],
    ['E-Mail', t.email, 'mail'],
    ['Telefon', t.phone, 'tel'],
    ['Adresse', t.address, null],
  ];
  return (
    <div className="site">
      <SiteNav />
      <main className="site-main site-text">
        <h1 className="site-title fade-in">{t.title}</h1>
        <p className="fade-in delay-1">{t.intro}</p>
        <dl className="contact-list fade-in delay-2" data-testid="contact-list">
          {rows.map(([label, value, kind]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>
                {!value ? (
                  <span className="placeholder">wird ergänzt</span>
                ) : kind === 'mail' ? (
                  <a href={`mailto:${value}`}>{value}</a>
                ) : kind === 'tel' ? (
                  <a href={`tel:${value.replace(/[^\d+]/g, '')}`}>{value}</a>
                ) : (
                  <span className="pre">{value}</span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </main>
      <SiteFooter />
    </div>
  );
}
