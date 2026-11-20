import { parseRoute, paths, usePath } from '../lib/router';
import { useSession } from '../lib/use-session';
import { SiteHeader } from '../site/components/SiteShell';
import { shortName } from '../lib/auth';
import { SaveButton } from './SaveButton';
import { hasStoredSession } from '../lib/auth-init';

/**
 * Schwarze Navigationsleiste der öffentlichen Seiten und von Aufmaß & Abrechnung.
 * Auf Smartphones werden „Über uns“ und „Kontakt“ in ein ausklappbares Menü verlegt.
 */
export function SiteNav() {
  const hash = usePath();
  const session = useSession();
  // Nur die Anmeldeseiten (Anmelden, Passwort) tragen die Website-Leiste. Alle Seiten der App zeigen immer die
  // App-Leiste – auch während die Anmeldung lädt oder wenn sie (z. B. ohne Empfang) nicht bestätigt werden konnte;
  // dann steht rechts „Anmelden“. Vorher erschien dabei oben die Leiste der Website.
  const authPage = ['login', 'newPassword'].includes(parseRoute(hash).name);
  if (authPage && !session) return <WebsiteBar />;
  return <AppNav hash={hash} session={session} />;
}

function WebsiteBar() {
  return (
    <div className="ps-chrome">
      <SiteHeader />
    </div>
  );
}

/**
 * Leiste der App: links BauPad – antippen führt direkt zu den Tools –, rechts Speicher-Taste und Konto.
 * Kein Menü, kein Kontakt, Impressum oder Datenschutz oben – die stehen unten im Konto.
 * session undefined: Anmeldung wird noch geladen (Konto-Taste erscheint, sobald sie da ist); null: „Anmelden“.
 */
function AppNav({ hash, session }: { hash: string; session: ReturnType<typeof useSession> }) {
  const current = (p: string) => (hash === p ? 'page' : undefined);
  return (
    <header className="site-nav" data-testid="site-nav">
      <div className="site-nav-inner">
        <a href={paths.tools()} className="site-logo" aria-label="BauPad – Tools" aria-current={current(paths.tools())} data-testid="nav-tools">
          {/* nur die weiße Schrift: das schwarze Kästchen hob sich auf der dunklen Leiste mit sichtbarem Rand ab */}
          <img src="/icons/logo-header-white.png" alt="BauPad" height={21} className="logo-word" />
        </a>
        <div className="site-actions">
          <SaveButton />
          {/* am Handy nur die Initialen im Kreis (data-initials, CSS) – sonst ist neben der Speicher-Taste kein Platz */}
          {/* Anmeldung nicht bestätigt: mit gespeicherter Anmeldung (z. B. ohne Empfang) bleibt es „Konto“, sonst „Anmelden“ */}
          {session === null &&
            (hasStoredSession() ? (
              <a href={paths.account()} className="site-login" aria-current={current(paths.account())} data-testid="nav-account">
                Konto
              </a>
            ) : (
              <a href={paths.login()} className="site-login" data-testid="nav-login">
                Anmelden
              </a>
            ))}
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
