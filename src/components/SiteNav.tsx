import { parseRoute, paths, usePath } from '../lib/router';
import { useSession } from '../lib/use-session';
import { SiteHeader } from '../site/components/SiteShell';
import { shortName } from '../lib/auth';
import { SaveButton } from './SaveButton';

/**
 * Schwarze Navigationsleiste der öffentlichen Seiten und von Aufmaß & Abrechnung.
 * Auf Smartphones werden „Über uns“ und „Kontakt“ in ein ausklappbares Menü verlegt.
 */
export function SiteNav() {
  const hash = usePath();
  const session = useSession();
  // nicht angemeldet (Anmelden, Registrieren, Passwort): dieselbe schwebende Leiste wie auf der Website.
  // Während die Anmeldung noch geladen wird (undefined), in der App gleich die App-Leiste – sonst blitzt beim Öffnen
  // kurz die Website-Leiste auf. Nur auf den Anmeldeseiten selbst bleibt es die Website-Leiste.
  const authPage = ['login', 'newPassword'].includes(parseRoute(hash).name);
  if (session === null || (session === undefined && authPage)) return <WebsiteBar />;
  return <AppNav hash={hash} session={session ?? null} />;
}

function WebsiteBar() {
  return (
    <div className="ps-chrome">
      <SiteHeader />
    </div>
  );
}

/**
 * Leiste der App (angemeldet): links BauPad – antippen führt direkt zu den Tools –, rechts Speicher-Taste und Konto.
 * Kein Menü, kein Kontakt, Impressum oder Datenschutz oben – die stehen unten im Konto.
 * session = null: Anmeldung wird noch geladen (Konto-Taste erscheint, sobald sie da ist).
 */
function AppNav({ hash, session }: { hash: string; session: NonNullable<ReturnType<typeof useSession>> | null }) {
  const current = (p: string) => (hash === p ? 'page' : undefined);
  return (
    <header className="site-nav" data-testid="site-nav">
      <div className="site-nav-inner">
        <a href={paths.tools()} className="site-logo" aria-label="BauPad – zu den Tools" aria-current={current(paths.tools())} data-testid="nav-tools">
          <img src="/icons/logo-header.png" alt="BauPad" height={30} />
        </a>
        <div className="site-actions">
          <SaveButton />
          {/* am Handy nur die Initialen im Kreis (data-initials, CSS) – sonst ist neben der Speicher-Taste kein Platz */}
          {session && (
            <a href={paths.account()} className="site-login" aria-current={current(paths.account())} data-testid="nav-account" data-initials={initials(session.name || 'Konto')} title={session.email}>
              {session.name ? shortName(session.name) : 'Konto'}
            </a>
          )}
        </div>
      </div>
    </header>
  );
}

/** Initialen für die Konto-Taste am Handy: „Daniele Pascu“ → „DP“, ein Wort → erster Buchstabe */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0][0]).toUpperCase();
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <span>
        © {new Date().getFullYear()} PAD Software · BauPad
      </span>
      <nav aria-label="Fußzeile">
        <a href={paths.contact()}>Kontakt</a>
        <a href={paths.imprint()}>Impressum</a>
        <a href={paths.privacy()}>Datenschutz</a>
      </nav>
    </footer>
  );
}
