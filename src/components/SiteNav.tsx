import { useEffect, useState } from 'react';
import { paths, usePath } from '../lib/router';
import { useSession } from '../lib/use-session';

/**
 * Schwarze Navigationsleiste der öffentlichen Seiten und von Aufmaß & Abrechnung.
 * Auf Smartphones werden „Über uns“ und „Kontakt“ in ein ausklappbares Menü verlegt.
 */
export function SiteNav() {
  const hash = usePath();
  const session = useSession();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [hash]);
  const current = (p: string) => (hash === p ? 'page' : undefined);

  return (
    <header className="site-nav" data-testid="site-nav">
      <div className="site-nav-inner">
        <a href={paths.landing()} className="site-logo" aria-label="BauPad – zur Startseite">
          <img src="/icons/logo-header.png" alt="BauPad" height={30} />
        </a>
        <nav className={`site-links${open ? ' open' : ''}`} aria-label="Hauptnavigation" id="site-links">
          {session ? (
            // angemeldet: nur die App – Kontakt und Rechtliches stehen unter Konto und Einstellungen
            <a href={paths.tools()} aria-current={current(paths.tools())}>
              Tools
            </a>
          ) : (
            <>
              <a href={paths.landing()}>Website</a>
              <a href={paths.contact()} aria-current={current(paths.contact())}>
                Kontakt
              </a>
            </>
          )}
        </nav>
        <div className="site-actions">
          {session ? (
            <a href={paths.account()} className="site-login" aria-current={current(paths.account())} data-testid="nav-account" title={session.email}>
              {session.name ? session.name.split(' ')[0] : 'Konto'}
            </a>
          ) : (
            <a href={paths.login()} className="site-login" aria-current={current(paths.login())}>
              Anmelden
            </a>
          )}
          <button
            type="button"
            className="site-menu-btn"
            aria-label={open ? 'Menü schließen' : 'Menü öffnen'}
            aria-expanded={open}
            aria-controls="site-links"
            onClick={() => setOpen(!open)}
          >
            <span />
            <span />
          </button>
        </div>
      </div>
    </header>
  );
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
