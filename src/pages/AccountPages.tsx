import { useState, type FormEvent } from 'react';
import { Icon } from '../components/Icon';
import { SiteFooter, SiteNav } from '../components/SiteNav';
import { paths } from '../lib/router';
import { usePageTitle } from './SitePages';

/*
 * Benutzerkonten sind noch nicht eingerichtet: Diese Seiten zeigen nur die Oberfläche.
 * Es wird nichts gesendet oder gespeichert und keine Anmeldung vorgetäuscht.
 */

const PROVIDERS = ['Outlook (Microsoft)', 'Google', 'Apple'];

export function LoginPage() {
  usePageTitle('Anmelden – BauPad');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tried, setTried] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
  };

  return (
    <div className="site">
      <SiteNav />
      <main className="site-main auth">
        <h1 className="site-title">Anmelden</h1>
        <form className="auth-card" onSubmit={submit} noValidate data-testid="login-form">
          <label className="field">
            <span>E-Mail-Adresse</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" data-testid="login-email" />
          </label>
          <label className="field">
            <span>Passwort</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" data-testid="login-password" />
          </label>
          <button type="submit" className="btn btn-primary btn-lg auth-submit" data-testid="login-submit">
            Anmelden
          </button>
          {tried && (
            <div className="banner banner-info" role="status" data-testid="login-unavailable">
              <p>
                <strong>Die Anmeldung ist noch nicht eingerichtet.</strong> Es wurden keine Daten gesendet. Ihre Projekte werden weiterhin nur auf
                diesem Gerät gespeichert.
              </p>
              <a href={paths.projects()} className="btn btn-sm">
                Weiter zur Projektverwaltung
              </a>
            </div>
          )}

          <div className="auth-divider">
            <span>oder</span>
          </div>
          {PROVIDERS.map((p) => (
            <button key={p} type="button" className="btn btn-lg auth-provider" disabled data-testid="login-provider">
              Mit {p} anmelden <span className="auth-soon">bald verfügbar</span>
            </button>
          ))}
        </form>

        <p className="auth-note">
          Noch ohne Benutzerkonto nutzbar:{' '}
          <a href={paths.projects()} data-testid="login-skip">
            direkt zur Projektverwaltung
          </a>
          {' · '}
          <a href={paths.account()}>Kontobereich (Vorschau)</a>
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}

const SECTIONS: [string, string][] = [
  ['Persönliche Daten', 'Name, Telefon und Anzeigename'],
  ['E-Mail und Konto', 'E-Mail-Adresse ändern, Konto verwalten'],
  ['Passwort und Anmeldemethoden', 'Passwort ändern, Outlook, Google oder Apple verbinden'],
  ['Abonnement und Zahlung', 'Tarif, Rechnungen und Zahlungsart'],
  ['Firmeninformationen', 'Firma, Adresse und Logo für Exporte'],
  ['Weitere Einstellungen', 'Sprache, Benachrichtigungen und Datenschutz'],
];

export function AccountPage() {
  usePageTitle('Konto und Einstellungen – BauPad');
  return (
    <div className="site">
      <SiteNav />
      <main className="site-main auth">
        <h1 className="site-title">Konto und Einstellungen</h1>
        <div className="banner banner-info" role="status" data-testid="account-preview">
          <p>
            <strong>Vorschau:</strong> Sie sind nicht angemeldet – Benutzerkonten sind noch nicht eingerichtet. Die folgenden Bereiche sind geplant
            und noch nicht aktiv.
          </p>
        </div>
        <ul className="account-list">
          {SECTIONS.map(([title, text]) => (
            <li key={title} className="account-item" aria-disabled="true" data-testid="account-section">
              <div>
                <strong>{title}</strong>
                <span className="muted">{text}</span>
              </div>
              <span className="auth-soon">geplant</span>
            </li>
          ))}
        </ul>
        <div className="row gap wrap">
          <button type="button" className="btn" disabled data-testid="account-logout">
            Abmelden
          </button>
          <a href={paths.projects()} className="btn btn-primary">
            <Icon name="back" /> Zur Projektverwaltung
          </a>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
