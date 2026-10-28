import { useEffect, type CSSProperties } from 'react';
import { Icon } from '../components/Icon';
import { ToolIcon } from '../components/ToolIcon';
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

/** Öffentliche Startseite: PAD Software als Firma, BauPad als erstes Produkt mit seinen vier Werkzeugen */
export function LandingPage() {
  usePageTitle('BauPad');
  const t = site.home;
  const toFeatures = () => document.getElementById('funktionen')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
            <button type="button" className="site-cta site-cta-secondary" onClick={toFeatures} data-testid="cta-features">
              {t.secondary}
            </button>
          </div>
          <div className="hero-install fade-in delay-2">
            <InstallButton variant="link" />
          </div>
          <div className="hero-tools fade-in delay-3" aria-hidden="true">
            {t.tools.map((x) => (
              <span key={x.id} className="hero-tool" style={{ '--tool': x.color } as CSSProperties}>
                <ToolIcon name={x.id} size={18} />
                {x.title}
              </span>
            ))}
          </div>
        </section>

        <section className="product" id="funktionen" aria-labelledby="product-title">
          <p className="section-eyebrow">Ein Produkt, vier Werkzeuge</p>
          <h2 id="product-title" className="section-heading">
            Alles, was auf der Baustelle anfällt.
          </h2>
          <div className="product-grid" data-testid="product-grid">
            {t.tools.map((x) => (
              <a key={x.id} href={paths.product(site.products[x.id].slug)} className="product-card" style={{ '--tool': x.color } as CSSProperties} data-testid="product-card">
                <span className="product-icon" aria-hidden="true">
                  <ToolIcon name={x.id} size={26} />
                </span>
                <h3>{x.title}</h3>
                <p>{x.text}</p>
                <ul>
                  {x.points.slice(0, 2).map((p) => (
                    <li key={p}>
                      <Icon name="check" size={14} />
                      {p}
                    </li>
                  ))}
                </ul>
                <span className="product-more">
                  Mehr erfahren <span aria-hidden="true">→</span>
                </span>
              </a>
            ))}
          </div>
        </section>

        <section className="steps" aria-labelledby="steps-title">
          <p className="section-eyebrow">So läuft ein Tag mit BauPad</p>
          <h2 id="steps-title" className="section-heading">
            Drei Schritte. Kein Papier.
          </h2>
          <ol className="steps-list">
            {t.steps.map((s, i) => (
              <li key={s.title}>
                <span className="step-no">{i + 1}</span>
                <strong>{s.title}</strong>
                <p>{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <ul className="site-facts fade-in delay-3" aria-label="Eigenschaften">
          {t.facts.map((f) => (
            <li key={f}>
              <Icon name="check" size={16} />
              {f}
            </li>
          ))}
        </ul>

        <section className="company" aria-labelledby="company-title">
          <p className="section-eyebrow">{site.company}</p>
          <h2 id="company-title" className="section-heading">
            {t.companyTitle}
          </h2>
          <p className="company-text">{t.companyText}</p>
          <div className="hero-actions">
            <a href={paths.contact()} className="site-cta site-cta-secondary">
              {t.companyCta}
            </a>
            <a href={paths.about()} className="site-link">
              Über uns <span aria-hidden="true">→</span>
            </a>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

export function AboutPage() {
  usePageTitle('Über uns – BauPad');
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
  usePageTitle('Kontakt – PAD Software');
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

/** Zeile des Impressums; leere Angaben werden sichtbar als Platzhalter gezeigt, nichts wird erfunden */
function LegalRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value ? <span className="pre">{value}</span> : <span className="placeholder">wird ergänzt</span>}</dd>
    </div>
  );
}

/** Impressum (Angaben nach § 5 ECG und § 25 MedienG – Firmendaten werden ergänzt) */
export function ImprintPage() {
  usePageTitle('Impressum – PAD Software');
  const c = site.contact;
  return (
    <div className="site">
      <SiteNav />
      <main className="site-main site-text">
        <h1 className="site-title fade-in">Impressum</h1>
        <p className="fade-in delay-1">Angaben gemäß § 5 E-Commerce-Gesetz (ECG) und § 25 Mediengesetz.</p>
        <dl className="contact-list fade-in delay-2" data-testid="imprint-list">
          <LegalRow label="Unternehmen" value={c.company || site.company} />
          <LegalRow label="Inhaber / Geschäftsführung" value={c.person} />
          <LegalRow label="Anschrift" value={c.address} />
          <LegalRow label="E-Mail" value={c.email} />
          <LegalRow label="Telefon" value={c.phone} />
          <LegalRow label="UID-Nummer" value={c.uid} />
          <LegalRow label="Firmenbuch / Gewerbe" value={c.register} />
        </dl>
        <p className="muted small fade-in delay-3">
          Unternehmensgegenstand: Entwicklung und Vertrieb von Software. Mitglied der Wirtschaftskammer Österreich. Anwendbare Rechtsvorschriften:
          Gewerbeordnung (www.ris.bka.gv.at). Verbraucher können Beschwerden an die Online-Streitbeilegungsplattform der EU richten:
          https://ec.europa.eu/odr.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}

/** Datenschutzerklärung – beschreibt nur, was BauPad heute tatsächlich tut (Speicherung am Gerät, Hosting) */
export function PrivacyPage() {
  usePageTitle('Datenschutz – PAD Software');
  const c = site.contact;
  const sections: [string, string[]][] = [
    [
      'Verantwortlicher',
      [
        `${c.company || site.company}${c.address ? `, ${c.address}` : ''}${c.email ? `, E-Mail: ${c.email}` : ''}. Weitere Angaben im Impressum.`,
      ],
    ],
    [
      'Welche Daten BauPad verarbeitet',
      [
        'Alle Inhalte, die du in BauPad erfasst (Projekte, Pläne, Messungen, Arbeiter, Berichte, Fotos), werden ausschließlich im Speicher deines Geräts abgelegt (Browser-Datenbank). Sie werden nicht an uns oder Dritte übertragen.',
        'Exporte (Excel, PDF, ZIP) erstellst du selbst auf dem Gerät und gibst sie selbst weiter. Beim Teilen über Apps deines Geräts gelten deren Datenschutzbestimmungen.',
        'Fotos können Aufnahmezeit und den am Gerät eingetragenen Namen enthalten. Ortsangaben werden nicht gespeichert.',
      ],
    ],
    [
      'Hosting',
      [
        'Die Website und die App werden über GitHub Pages (GitHub Inc., USA) ausgeliefert. Beim Aufruf werden technisch notwendige Daten wie IP-Adresse, Zeitpunkt und aufgerufene Datei an GitHub übermittelt und dort nach deren Datenschutzerklärung verarbeitet (Art. 6 Abs. 1 lit. f DSGVO, berechtigtes Interesse an einem sicheren Betrieb).',
        'Nach dem ersten Laden funktioniert BauPad auch offline; dafür legt der Browser die Programmdateien lokal ab.',
      ],
    ],
    [
      'Cookies, Statistik, Werbung',
      ['BauPad verwendet keine Cookies zur Nachverfolgung, keine Statistik-Werkzeuge und keine Werbung. Einstellungen wie die Sortierung werden nur lokal im Browser gespeichert.'],
    ],
    [
      'Kamera',
      ['Der Kamera-Modus greift nur mit deiner ausdrücklichen Erlaubnis auf die Kamera zu. Das Bild wird ausschließlich auf dem Gerät verarbeitet und gespeichert.'],
    ],
    [
      'Geplante zentrale Ablage',
      [
        'Eine gemeinsame Ablage für Unternehmen mit Benutzerkonten ist in Vorbereitung. Sobald sie verfügbar ist, wird diese Erklärung um die dann eingesetzten Dienste und Speicherorte (Rechenzentren in der EU) ergänzt. Bis dahin verlässt kein Inhalt dein Gerät.',
      ],
    ],
    [
      'Deine Rechte',
      [
        'Da wir keine personenbezogenen Daten von dir speichern, können wir auch keine herausgeben oder löschen – das kannst du jederzeit selbst am Gerät (Projekt löschen, Browserdaten löschen). Fragen zum Datenschutz beantworten wir über die Kontaktseite. Beschwerden sind an die österreichische Datenschutzbehörde möglich (www.dsb.gv.at).',
      ],
    ],
  ];
  return (
    <div className="site">
      <SiteNav />
      <main className="site-main site-text">
        <h1 className="site-title fade-in">Datenschutz</h1>
        <p className="fade-in delay-1">Stand: {new Date().toLocaleDateString('de-AT', { month: 'long', year: 'numeric' })}. Kurz gesagt: BauPad speichert deine Daten auf deinem Gerät, nicht bei uns.</p>
        {sections.map(([h, ps]) => (
          <section key={h} className="legal-section fade-in delay-2">
            <h2>{h}</h2>
            {ps.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </section>
        ))}
      </main>
      <SiteFooter />
    </div>
  );
}
