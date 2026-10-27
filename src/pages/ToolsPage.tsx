import type { CSSProperties } from 'react';
import { Icon } from '../components/Icon';
import { ToolIcon, type ToolIconName } from '../components/ToolIcon';
import { SiteNav } from '../components/SiteNav';
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
  { id: 'projects', title: 'Projektverwaltung', text: 'Projekte, Pläne und Aufmaß', color: '#ff6a13', href: paths.projects() },
  { id: 'workers', title: 'Arbeitereinteilung', text: 'Wochenplanung nach Baustellen', color: '#2f80ed', href: paths.workers() },
  { id: 'photos', title: 'Fotodokumentation', text: 'Baufortschritt und Mängel', color: '#27ae60' },
  { id: 'reports', title: 'Berichte & Formulare', text: 'Regielisten, Bautagesberichte', color: '#a259ff' },
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
          <a href={paths.account()} className="icon-link" aria-label="Konto und Einstellungen" title="Konto und Einstellungen">
            <Icon name="settings" />
          </a>
        </header>
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
