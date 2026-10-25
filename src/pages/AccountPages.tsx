import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Icon } from '../components/Icon';
import { SiteFooter, SiteNav } from '../components/SiteNav';
import { getCompanyLogo, removeCompanyLogo, saveCompanyLogo, type CompanyLogo } from '../lib/company';
import { paths } from '../lib/router';
import { confirmDialog, showError, toast } from '../components/ui';
import { AppStorageSettings } from '../components/InstallApp';
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
  ['Firmeninformationen', 'Firma und Adresse für Exporte'],
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
            <strong>Vorschau:</strong> Sie sind nicht angemeldet – Benutzerkonten sind noch nicht eingerichtet. App, Speicher und Firmenlogo
            funktionieren bereits (auf diesem Gerät); die übrigen Bereiche sind geplant und noch nicht aktiv.
          </p>
        </div>
        <AppStorageSettings />
        <LogoSettings />
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

/**
 * Firmenlogo (schon aktiv, ohne Konto): wird auf diesem Gerät gespeichert und automatisch
 * rechts oben in die Kopfzeile jeder exportierten Excel-Datei eingefügt.
 */
function LogoSettings() {
  const [logo, setLogo] = useState<CompanyLogo | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void getCompanyLogo().then(setLogo);
  }, []);
  const url = useMemo(() => (logo ? URL.createObjectURL(new Blob([logo.bytes as BlobPart], { type: `image/${logo.type}` })) : null), [logo]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      setLogo(await saveCompanyLogo(file));
      toast('Firmenlogo gespeichert – es erscheint ab jetzt in der Excel-Kopfzeile.', 'success');
    } catch (e) {
      showError(e, 'Logo konnte nicht übernommen werden');
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!(await confirmDialog({ title: 'Firmenlogo entfernen?', message: <p>Exporte enthalten danach kein Logo mehr.</p>, confirmLabel: 'Entfernen', danger: true }))) return;
    await removeCompanyLogo();
    setLogo(null);
  };

  return (
    <section className="logo-settings" data-testid="logo-settings">
      <div className="logo-settings-head">
        <div>
          <strong>Firmenlogo</strong>
          <span className="muted">Erscheint automatisch rechts oben in der Kopfzeile jeder exportierten Excel-Datei. Wird nur auf diesem Gerät gespeichert.</span>
        </div>
      </div>
      <div className="logo-settings-body">
        <div className="logo-preview" data-testid="logo-preview">
          {url ? <img src={url} alt="Firmenlogo" data-testid="logo-image" /> : <span className="muted small">{logo === undefined ? '…' : 'Kein Logo'}</span>}
        </div>
        <div className="row gap wrap">
          <button type="button" className="btn btn-primary" onClick={() => input.current?.click()} disabled={busy} data-testid="logo-pick">
            <Icon name="upload" /> {logo ? 'Logo ersetzen' : 'Logo auswählen'}
          </button>
          {logo && (
            <button type="button" className="btn btn-danger-text" onClick={() => void remove()} data-testid="logo-remove">
              <Icon name="trash" /> Entfernen
            </button>
          )}
        </div>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,.png,.jpg,.jpeg"
          hidden
          data-testid="logo-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            void pick(f);
          }}
        />
      </div>
    </section>
  );
}
