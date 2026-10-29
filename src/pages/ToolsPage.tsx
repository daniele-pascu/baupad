import type { CSSProperties } from 'react';
import { Icon } from '../components/Icon';
import { ToolIcon, type ToolIconName } from '../components/ToolIcon';
import { SiteNav } from '../components/SiteNav';
import { isInstalledApp } from '../lib/platform';
import { paths } from '../lib/router';
import { usePageTitle } from './SitePages';

interface Tool {
  id: ToolIconName;
  title: string;
  text: string;
  /** Akzentfarbe der Kachel */
  color: string;
  href?: string;
}

const TOOLS: Tool[] = [
  { id: 'projects', title: 'Aufmaß & Abrechnung', text: 'Pläne, Messungen, Excel und Rechnungen', color: '#ff6a13', href: paths.projects() },
  { id: 'workers', title: 'Arbeitereinteilung', text: 'Wochenplanung nach Baustellen', color: '#2f80ed', href: paths.workers() },
  { id: 'photos', title: 'Fotodokumentation', text: 'Fotos je Baustelle, Woche und Tag', color: '#111111', href: paths.photos() },
  { id: 'reports', title: 'Berichte & Formulare', text: 'Regielisten, Bautages- und Wochenberichte', color: '#a259ff', href: paths.reports() },
  { id: 'defects', title: 'Mängelplan', text: 'Mängel im Plan markieren, Fotos und PDF', color: '#d6242b', href: paths.defects() },
];

/** Start nach der Anmeldung: alle Werkzeuge als gleich große Kacheln, zwei pro Reihe (Industrie-Stil, hell). */
export function ToolsPage() {
  usePageTitle('Tools – BauPad');
  return (
    <>
      <SiteNav />
      <div className="page tools-page">
        <header className="page-head page-head-row">
          <div>
            <p className="tools-eyebrow">Willkommen zurück</p>
            <h1 data-testid="tools-title">Tools</h1>
          </div>
          <a href={paths.account()} className="icon-link" aria-label="Konto und Einstellungen" title="Konto und Einstellungen" data-testid="account-link">
            <Icon name="settings" />
          </a>
        </header>
        {isInstalledApp() && (
        <a href={paths.camera()} className="tools-quick" data-testid="tools-camera">
          <Icon name="camera" size={22} />
          <span>
            <strong>Foto aufnehmen</strong>
            <span>Kamera-Modus – Baustelle wählen, auslösen, fertig</span>
          </span>
          <Icon name="next" size={18} />
        </a>
        )}
        <nav className="tools-grid" aria-label="Werkzeuge">
          {TOOLS.map((t) => {
            const body = (
              <>
                <ToolIcon name={t.id} weight="thin" size={132} className="tile-mark" />
                <span className="tile-top">
                  <span className="tile-icon" aria-hidden="true">
                    <ToolIcon name={t.id} size={22} />
                  </span>
                </span>
                <span className="tile-text">
                  <strong>{t.title}</strong>
                  <span>{t.text}</span>
                </span>
                {t.href ? (
                  <span className="tile-go">
                    Öffnen <span aria-hidden="true">→</span>
                  </span>
                ) : (
                  <span className="tile-soon-label">In Vorbereitung</span>
                )}
              </>
            );
            const style = { '--tool': t.color } as CSSProperties;
            return t.href ? (
              <a key={t.id} href={t.href} className="tool-tile" style={style} data-testid={`tool-${t.id}`}>
                {body}
              </a>
            ) : (
              <div key={t.id} className="tool-tile tool-soon" style={style} aria-disabled="true" data-testid="tool-soon">
                {body}
              </div>
            );
          })}
        </nav>
      </div>
    </>
  );
}
