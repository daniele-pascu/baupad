import { useEffect, useState } from 'react';
import { parseRoute, paths, useHash } from '../lib/router';
import { site } from '../content/site';

/**
 * Schwarze Navigationsleiste der öffentlichen Seiten und von Aufmaß & Abrechnung.
 * Auf Smartphones werden „Über uns“ und „Kontakt“ in ein ausklappbares Menü verlegt.
 */
export function SiteNav() {
  const hash = useHash();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [hash]);
  const current = (p: string) => (hash === p || (p === paths.landing() && (hash === '' || hash === '#')) ? 'page' : undefined);
  /** öffentliche Seiten tragen die Firma (PAD Software), die App das Produkt (BauPad) */
  const route = parseRoute(hash).name;
  const isSite = ['landing', 'about', 'contact', 'imprint', 'privacy', 'product'].includes(route);

  return (
    <header className="site-nav" data-testid="site-nav">
      <div className="site-nav-inner">
        {isSite ? (
          <a href={paths.landing()} className="site-logo site-wordmark" aria-label="PAD Software – zur Startseite">
            <span className="wm-pad">PAD</span>
            <span className="wm-soft">Software</span>
          </a>
        ) : (
          <a href={paths.landing()} className="site-logo" aria-label="BauPad – zur Startseite">
            <img src="./icons/logo-header.png" alt="BauPad" height={30} />
          </a>
        )}
        <nav className={`site-links${open ? ' open' : ''}`} aria-label="Hauptnavigation" id="site-links">
          {isSite && (
            <a href={paths.landing()} aria-current={current(paths.landing())}>
              BauPad
            </a>
          )}
          <a href={paths.about()} aria-current={current(paths.about())}>
            Über uns
          </a>
          <a href={paths.contact()} aria-current={current(paths.contact())}>
            Kontakt
          </a>
        </nav>
        <div className="site-actions">
          <a href={paths.login()} className="site-login" aria-current={current(paths.login())}>
            Anmelden
          </a>
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
        © {new Date().getFullYear()} {site.footer}
      </span>
      <nav aria-label="Fußzeile">
        <a href={paths.about()}>Über uns</a>
        <a href={paths.contact()}>Kontakt</a>
        <a href={paths.imprint()}>Impressum</a>
        <a href={paths.privacy()}>Datenschutz</a>
      </nav>
    </footer>
  );
}
