import { Icon } from '../components/Icon';
import { SiteNav } from '../components/SiteNav';
import { paths } from '../lib/router';
import { usePageTitle } from './SitePages';

interface Tool {
  id: string;
  title: string;
  text: string;
  icon: string;
  /** Farbton der Kachel */
  tone: 'blue' | 'amber' | 'violet' | 'teal';
  href?: string;
}

const TOOLS: Tool[] = [
  { id: 'projects', title: 'Projektverwaltung', text: 'Projekte, Pläne und Aufmaß', icon: 'blueprint', tone: 'blue', href: paths.projects() },
  { id: 'workers', title: 'Arbeitereinteilung', text: 'Wochenplanung nach Baustellen', icon: 'worker', tone: 'amber', href: paths.workers() },
  { id: 'photos', title: 'Fotodokumentation', text: 'Baufortschritt und Mängel in Bildern', icon: 'camera', tone: 'violet' },
  { id: 'soon-2', title: 'Noch in Planung', text: 'Weiteres Werkzeug folgt', icon: 'soon', tone: 'teal' },
];

/** Start nach der Anmeldung: alle Werkzeuge als gleich große Kacheln, zwei pro Reihe. */
export function ToolsPage() {
  usePageTitle('Tools – BauPad');
  return (
    <>
      <SiteNav />
      <div className="page tools-page">
        <header className="page-head page-head-row">
          <h1 data-testid="tools-title">Tools</h1>
          <a href={paths.account()} className="icon-link" aria-label="Konto und Einstellungen" title="Konto und Einstellungen">
            <Icon name="settings" />
          </a>
        </header>
        <p className="muted tools-lead">Wählen Sie ein Werkzeug.</p>
        <nav className="tools-grid" aria-label="Werkzeuge">
          {TOOLS.map((t) => {
            const body = (
              <>
                <span className="tool-icon" aria-hidden="true">
                  <Icon name={t.icon} size={30} />
                </span>
                <span className="tool-text">
                  <strong>{t.title}</strong>
                  <span>{t.text}</span>
                </span>
                {t.href ? (
                  <span className="tool-go" aria-hidden="true">
                    <Icon name="next" size={18} />
                  </span>
                ) : (
                  <span className="tool-badge">Bald</span>
                )}
              </>
            );
            return t.href ? (
              <a key={t.id} href={t.href} className={`tool-tile tone-${t.tone}`} data-testid={`tool-${t.id}`}>
                {body}
              </a>
            ) : (
              <div key={t.id} className={`tool-tile tone-${t.tone} tool-soon`} aria-disabled="true" data-testid="tool-soon">
                {body}
              </div>
            );
          })}
        </nav>
      </div>
    </>
  );
}

/** Arbeitereinteilung – Platzhalter, bis der Bereich fertig ist */
export function WorkersPage() {
  usePageTitle('Arbeitereinteilung – BauPad');
  return (
    <>
      <SiteNav />
      <div className="page tools-page">
        <header className="page-head">
          <div className="page-head-title">
            <a href={paths.tools()} className="icon-link" aria-label="Zu den Tools" title="Zu den Tools" data-testid="to-tools">
              <Icon name="back" />
            </a>
            <h1 data-testid="workers-title">Arbeitereinteilung</h1>
          </div>
        </header>
        <div className="empty" data-testid="workers-soon">
          <span className="tool-icon tone-amber" aria-hidden="true">
            <Icon name="worker" size={30} />
          </span>
          <p>
            <strong>In Arbeit</strong>
          </p>
          <p className="muted">Hier entsteht die Wochenplanung nach Baustellen: Arbeiter je Tag einteilen, Vorwoche weiterführen, als PDF ausgeben.</p>
        </div>
      </div>
    </>
  );
}
