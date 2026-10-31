import { Icon } from '../components/Icon';
import { SiteFooter, SiteNav } from '../components/SiteNav';
import { showError, toast } from '../components/ui';
import { getAuth, type Session } from '../lib/auth';
import { navigate, paths } from '../lib/router';
import { usePageTitle } from '../lib/page-title';
import { contactData } from '../site/contact-data';

/**
 * Hinweisseite für registrierte Firmen, deren Arbeitsbereich noch nicht freigeschaltet ist (Bestellung offen).
 * Die Werkzeuge sind bis zur Freischaltung durch PAD Software gesperrt.
 */
export function AccessPendingPage({ session }: { session: Session }) {
  usePageTitle('Zugang wird freigeschaltet – BauPad');
  const logout = async () => {
    try {
      await getAuth().signOut();
      toast('Abgemeldet.', 'success');
      navigate(paths.login(), true);
    } catch (e) {
      showError(e, 'Abmelden fehlgeschlagen');
    }
  };
  return (
    <div className="site">
      <SiteNav />
      <main className="site-main auth">
        <div className="auth-logo" aria-hidden="true">
          <img src="/icons/icon-192.png" alt="" width={72} height={72} />
        </div>
        <h1 className="site-title">Vielen Dank für Ihre Registrierung</h1>
        <div className="auth-card pending-card" data-testid="access-pending">
        <p>
          Ihr Konto <strong>{session.email}</strong>
          {session.companyName ? ` für „${session.companyName}“` : ''} wurde angelegt. BauPad befindet sich derzeit im Aufbau und wird Schritt für
          Schritt für unsere Kunden freigeschaltet.
        </p>
        <p>
          Der Zugang zu den Werkzeugen wird von PAD Software nach Abschluss der Bestellung aktiviert. Wir melden uns dazu persönlich bei Ihnen. Bis
          dahin ist keine Zahlung fällig und es entstehen keine Kosten.
        </p>
        <p className="muted small">
          Fragen zu Paketen, Preisen oder einer Vorführung: <a href={`mailto:${contactData.email}`}>{contactData.email}</a>
        </p>
        <div className="row gap wrap pending-actions">
          <a href={`mailto:${contactData.email}?subject=${encodeURIComponent('BauPad – Freischaltung ' + (session.companyName || session.email))}`} className="btn btn-primary">
            <Icon name="info" /> Freischaltung anfragen
          </a>
          <a href={paths.landing()} className="btn">
            Zur Website
          </a>
          <button type="button" className="btn" onClick={() => void logout()} data-testid="pending-logout">
            Abmelden
          </button>
        </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
