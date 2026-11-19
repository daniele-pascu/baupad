import type { CSSProperties } from 'react';
import { Icon } from '../components/Icon';
import { TrashButton } from '../components/TrashButton';
import { ToolIcon, type ToolIconName } from '../components/ToolIcon';
import { SiteNav } from '../components/SiteNav';
import { isInstalledApp } from '../lib/platform';
import { useAccess } from '../lib/access';
import { paths } from '../lib/router';
import { usePageTitle } from '../lib/page-title';
import { canEditSites } from '../lib/sites';

interface Tool {
  id: ToolIconName;
  title: string;
  text: string;
  /** Akzentfarbe der Kachel */
  color: string;
  href?: string;
  /** Recht, das die Kachel braucht (sonst = id) */
  tool?: string;
}

const TOOLS: Tool[] = [
  { id: 'projects', title: 'Aufmaß', text: 'Pläne, LV, Messungen und Abrechnung', color: '#ff6a13', href: paths.projects() },
  { id: 'workers', title: 'Team', text: 'Wochenplanung nach Baustellen', color: '#2f80ed', href: paths.workers() },
  { id: 'photos', title: 'Fotos', text: 'Dokumentation je Baustelle, Woche und Tag', color: '#111111', href: paths.photos() },
  { id: 'reports', title: 'Berichte', text: 'Regielisten, Bautages- und Wochenberichte', color: '#a259ff', href: paths.reports() },
  { id: 'defects', title: 'Mängel', text: 'Mängel im Plan markieren, Fotos und PDF', color: '#d6242b', href: paths.defects() },
  { id: 'times', title: 'Zeiten', text: 'Stunden je Arbeiter und Tag, Monatszettel', color: '#0f9d76', href: paths.times() },
  { id: 'materials', title: 'Material', text: 'Materialien und Lieferanten der Firma', color: '#c2850c', href: paths.materials() },
];

/** Start nach der Anmeldung: alle Werkzeuge als gleich große Kacheln; Kamera und Projektregister als Tasten darüber. */
export function ToolsPage() {
  usePageTitle('Tools – BauPad');
  const access = useAccess();
  const tools = TOOLS.filter((t) => access.canTool((t.tool ?? t.id) as never));
  // Projektregister nur für Admin und Büro – die anderen übernehmen Projekte in den Tools („Projekt übernehmen“)
  const register = canEditSites(access.session);
  return (
    <>
      <SiteNav />
      <div className="page tools-page">
        {/* Einstellungen: über den Namen oben rechts (kein eigenes Zahnrad mehr) */}
        <header className="page-head page-head-row">
          <div>
            <p className="tools-eyebrow">Willkommen zurück</p>
            <h1 data-testid="tools-title">Tools</h1>
          </div>
          <TrashButton scope={{}} />
        </header>
        {/* Kamera und Projektregister sind keine Werkzeuge: als Tasten über den Kacheln */}
        {((isInstalledApp() && access.canTool('photos')) || register) && (
          <div className="tools-quick-row">
            {isInstalledApp() && access.canTool('photos') && (
              <a href={paths.camera()} className="tools-quick" data-testid="tools-camera">
                <Icon name="camera" size={22} />
                <strong>Foto aufnehmen</strong>
                <Icon name="next" size={16} />
              </a>
            )}
            {register && (
              <a href={paths.projectRegister()} className="tools-quick tools-quick-light" title="Alle Projekte der Firma" data-testid="tools-register">
                <Icon name="folder" size={22} />
                <strong>Projektregister</strong>
                <Icon name="next" size={16} />
              </a>
            )}
          </div>
        )}
        <nav className="tools-grid" aria-label="Tools">
          {tools.map((t) => {
            const body = (
              <>
                <ToolIcon name={t.id} weight="thin" size={132} className="tile-mark" />
                <span className="tile-top">
                  <span className="tile-icon" aria-hidden="true">
                    <ToolIcon name={t.id} size={34} />
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
