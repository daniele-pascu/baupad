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

/**
 * Öffentliche Startseite von PAD Software – erzählt in fünf Schritten: Firma, BauPad, Probleme, Werkzeuge, Kennenlernen.
 * Ruhig, mit echten Bildern aus der App, dezentes Einblenden, keine 3D- oder Parallax-Effekte.
 */
export function LandingPage() {
  usePageTitle('PAD Software – BauPad');
  const t = site.home;
  const toProduct = () => document.getElementById('baupad')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return (
    <div className="site landing">
      <SiteNav />
      <main className="site-main lp">
        {/* 1. Was ist PAD Software? */}
        <section className="lp-hero" aria-labelledby="lp-title">
          <p className="lp-eyebrow fade-in">{t.eyebrow}</p>
          <h1 id="lp-title" className="lp-title fade-in">
            {t.title}
          </h1>
          <p className="lp-lead hero-lead fade-in delay-1">{t.lead}</p>
          <div className="lp-actions fade-in delay-2">
            <a href={paths.tools()} className="site-cta" data-testid="cta-tools">
              {t.cta}
              <span aria-hidden="true"> →</span>
            </a>
            <button type="button" className="site-cta site-cta-secondary" onClick={toProduct} data-testid="cta-features">
              {t.secondary}
            </button>
          </div>
        </section>

        {/* 2. Was ist BauPad? */}
        <section className="lp-product" id="baupad" aria-labelledby="lp-product-title">
          <div className="lp-product-copy">
            <p className="lp-eyebrow">{site.product}</p>
            <h2 id="lp-product-title" className="lp-h2">
              {t.productTitle}
            </h2>
            <p className="lp-text">{t.productText}</p>
            <ul className="lp-facts" aria-label="Eigenschaften">
              {t.facts.map((f) => (
                <li key={f}>
                  <Icon name="check" size={16} />
                  {f}
                </li>
              ))}
            </ul>
            <div className="hero-install">
              <InstallButton variant="link" />
            </div>
          </div>
        </section>

        {/* 3. Welche Probleme löst BauPad? */}
        <section className="lp-problems" aria-labelledby="lp-problems-title">
          <p className="lp-eyebrow">Das Problem</p>
          <h2 id="lp-problems-title" className="lp-h2">
            {t.problemsTitle}
          </h2>
          <ol className="lp-problem-list" data-testid="problems">
            {t.problems.map((x, i) => (
              <li key={x.title}>
                <span className="lp-no">0{i + 1}</span>
                <h3>{x.title}</h3>
                <p>{x.text}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* 4. Was kann BauPad konkret? */}
        <section className="lp-tools" id="werkzeuge" aria-labelledby="lp-tools-title">
          <p className="lp-eyebrow">Die Werkzeuge</p>
          <h2 id="lp-tools-title" className="lp-h2">
            {t.toolsTitle}
          </h2>
          <div className="lp-tool-list" data-testid="product-grid">
            {t.tools.map((x) => (
              <a key={x.id} href={paths.product(site.products[x.id].slug)} className="lp-tool" style={{ '--tool': x.color } as CSSProperties} data-testid="product-card">
                <span className="lp-tool-body">
                  <span className="product-icon" aria-hidden="true">
                    <ToolIcon name={x.id} size={22} />
                  </span>
                  <strong>{x.title}</strong>
                  <span className="lp-tool-text">{x.text}</span>
                  <ul className="lp-points">
                    {x.points.map((pt) => (
                      <li key={pt}>
                        <Icon name="check" size={15} />
                        {pt}
                      </li>
                    ))}
                  </ul>
                  <span className="lp-more">
                    Mehr erfahren <span aria-hidden="true">→</span>
                  </span>
                </span>
              </a>
            ))}
          </div>
        </section>

        <section className="lp-faq" aria-labelledby="lp-faq-title">
          <p className="lp-eyebrow">Fragen und Antworten</p>
          <h2 id="lp-faq-title" className="lp-h2">
            Kurz beantwortet.
          </h2>
          <div className="faq-list" data-testid="faq">
            {t.faq.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* 5. Kennenlernen und Kontakt */}
        <section className="lp-contact" id="kennenlernen" aria-labelledby="lp-contact-title">
          <p className="lp-eyebrow">Kennenlernen</p>
          <h2 id="lp-contact-title" className="lp-h2">
            {t.contactTitle}
          </h2>
          <p className="lp-text">{t.contactText}</p>
          <div className="lp-actions">
            <a href={paths.login()} className="site-cta site-cta-light" data-testid="cta-register">
              {t.contactCta}
              <span aria-hidden="true"> →</span>
            </a>
            <a href={paths.contact()} className="site-cta site-cta-ghost" data-testid="cta-contact">
              {t.companyCta}
            </a>
          </div>
          <p className="lp-contact-mail">
            <a href={`mailto:${site.contact.email}`}>{site.contact.email}</a>
          </p>
        </section>

        <section className="lp-company" aria-labelledby="lp-company-title">
          <p className="lp-eyebrow">{site.company}</p>
          <h2 id="lp-company-title" className="lp-h2">
            {t.companyTitle}
          </h2>
          <p className="lp-text">{t.companyText}</p>
          <p>
            <a href={paths.about()} className="lp-more">
              Über uns <span aria-hidden="true">→</span>
            </a>
          </p>
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
      'Benutzerkonto',
      [
        'Für die Werkzeuge ist ein Benutzerkonto nötig. Beim Registrieren werden E-Mail-Adresse, Name, optional der Firmenname sowie ein verschlüsselt gespeichertes Passwort verarbeitet; bei Anmeldung über Google, Apple oder Microsoft erhalten wir von dort Name und E-Mail-Adresse. Dazu kommen Arbeitsbereich (Firma), Funktion und freigegebene Werkzeuge, die der Admin deiner Firma festlegt.',
        'Diese Kontodaten speichert unser Auftragsverarbeiter Supabase Inc. in einem Rechenzentrum in der EU (Irland) auf Grundlage von Art. 6 Abs. 1 lit. b DSGVO (Vertragserfüllung). Projekte, Pläne, Fotos und Berichte bleiben weiterhin auf deinem Gerät.',
        'Du kannst dein Konto jederzeit unter „Konto und Einstellungen“ selbst löschen; damit werden Konto, Mitgliedschaften und ein nur von dir genutzter Arbeitsbereich entfernt.',
      ],
    ],
    [
      'Geplante zentrale Ablage',
      [
        'Eine gemeinsame Ablage für Fotos und Berichte aller Geräte eines Unternehmens ist in Vorbereitung. Sobald sie verfügbar ist, wird diese Erklärung um die dann eingesetzten Dienste und Speicherorte (Rechenzentren in der EU) ergänzt.',
      ],
    ],
    [
      'Deine Rechte',
      [
        'Du hast das Recht auf Auskunft, Berichtigung, Löschung und Datenübertragbarkeit deiner Kontodaten; Löschen und Ändern kannst du selbst in der App, alles Weitere über die Kontaktseite. Inhalte auf dem Gerät löschst du jederzeit selbst (Projekt löschen, Browserdaten löschen). Beschwerden sind an die österreichische Datenschutzbehörde möglich (www.dsb.gv.at).',
      ],
    ],
  ];
  return (
    <div className="site">
      <SiteNav />
      <main className="site-main site-text">
        <h1 className="site-title fade-in">Datenschutz</h1>
        <p className="fade-in delay-1">Stand: {new Date().toLocaleDateString('de-AT', { month: 'long', year: 'numeric' })}. Kurz gesagt: Dein Benutzerkonto liegt bei unserem Dienstleister in der EU, deine Projekte, Fotos und Berichte bleiben auf deinem Gerät.</p>
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

/** Öffentliche Anleitung „Konto löschen“ (Vorgabe von Google Play und App Store bei Apps mit Registrierung) */
export function DeleteAccountInfoPage() {
  usePageTitle('Konto löschen – BauPad');
  const c = site.contact;
  return (
    <div className="site">
      <SiteNav />
      <main className="site-main site-text">
        <h1 className="site-title fade-in">Konto löschen</h1>
        <p className="fade-in delay-1">Du kannst dein BauPad-Konto jederzeit selbst löschen, in der App oder im Browser. Es dauert eine Minute.</p>
        <ol className="fade-in delay-2" data-testid="delete-steps">
          <li>BauPad öffnen und anmelden: https://pad-software.at</li>
          <li>Oben rechts auf deinen Namen tippen (Konto und Einstellungen).</li>
          <li>Bereich „E-Mail und Konto“ aufklappen.</li>
          <li>„Konto löschen“ wählen und bestätigen.</li>
        </ol>
        <section className="legal-section fade-in delay-2">
          <h2>Was gelöscht wird</h2>
          <p>Dein Benutzerkonto (E-Mail, Name, Telefon, Anmeldemethoden), deine Mitgliedschaften in Arbeitsbereichen und ein Arbeitsbereich, den nur du genutzt hast. Die Löschung ist sofort wirksam und kann nicht rückgängig gemacht werden.</p>
          <h2>Was bleibt</h2>
          <p>Inhalte, die auf deinem Gerät gespeichert sind (Projekte, Pläne, Fotos, Berichte), bleiben dort, bis du sie in der App oder über die Browserdaten löschst. Inhalte, die du in den Arbeitsbereich einer Firma gestellt hast, bleiben bei dieser Firma.</p>
          <h2>Ohne Zugang zum Konto</h2>
          <p>
            Wenn du dich nicht mehr anmelden kannst, schreib uns von der E-Mail-Adresse des Kontos{c.email ? ` an ${c.email}` : ' über die Kontaktseite'}. Wir löschen das Konto innerhalb von 14 Tagen.
          </p>
        </section>
        <p className="fade-in delay-3">
          <a href={paths.login()} className="site-cta">
            Zur Anmeldung
            <span aria-hidden="true"> →</span>
          </a>
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
