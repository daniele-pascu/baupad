import { useEffect, useState } from 'react';
import { navigate, paths, usePath } from '../lib/router';
import { useSession } from '../lib/use-session';
import { shortName } from '../lib/auth';
import { useDataSyncState } from '../lib/data-sync';
import { useCloudState } from '../lib/photo-cloud';

/** Empfang des Geräts (online/offline-Ereignisse des Browsers) */
function useOnline(): boolean {
  const [on, setOn] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false);
  useEffect(() => {
    const up = () => setOn(true);
    const down = () => setOn(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return on;
}

/**
 * Speicherstand: alles wird zuerst auf dem Gerät gespeichert und bei Empfang hochgeladen.
 * Ohne Empfang oder solange noch etwas wartet, steht das hier sichtbar (sonst nichts).
 */
function SyncBadge() {
  const data = useDataSyncState();
  const photos = useCloudState();
  const online = useOnline();
  if (data.status === 'off' && photos.status === 'off') return null;
  const waiting = data.pending + photos.pending;
  // Fehler der Online-Ablage (nicht nur fehlender Empfang): deutlich zeigen, Antippen öffnet das Konto mit der Meldung
  const failure = online && (data.status === 'error' || photos.status === 'error' || photos.status === 'setup') ? (data.status === 'error' ? data.message : photos.message) : null;
  if (failure !== null)
    return (
      <button type="button" className="sync-badge error" title={failure || 'Online-Speichern fehlgeschlagen'} onClick={() => navigate(paths.accountSection('app'))} data-testid="sync-badge" data-error="1">
        Online-Fehler{waiting ? ` · ${waiting} warten` : ''}
      </button>
    );
  if (online && !waiting) return null;
  const busy = online && (data.busy || photos.busy);
  const text = !online ? (waiting ? `Offline · ${waiting} warten` : 'Offline') : busy ? 'Wird hochgeladen …' : `${waiting} warten auf Upload`;
  const title = !online
    ? 'Kein Empfang: alles wird auf dem Gerät gespeichert und automatisch hochgeladen, sobald wieder Empfang da ist.'
    : 'Wird automatisch hochgeladen – bei schwachem Empfang mehrere Versuche.';
  return (
    <span className={`sync-badge${online ? '' : ' offline'}`} title={title} role="status" data-testid="sync-badge" data-online={online ? '1' : '0'}>
      {text}
    </span>
  );
}

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
          {session && <SyncBadge />}
          {session ? (
            <a href={paths.account()} className="site-login" aria-current={current(paths.account())} data-testid="nav-account" title={session.email}>
              {session.name ? shortName(session.name) : 'Konto'}
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
