import { useEffect, useState, type ReactNode } from 'react';
import { DialogHost, toast } from './components/ui';
import { Icon } from './components/Icon';
import { navigate, parseRoute, paths, useHash } from './lib/router';
import { flush, openProject, useAppState } from './lib/store';
import { HomePage } from './pages/HomePage';
import { ProjectPage } from './pages/ProjectPage';
import { PlanEditorPage } from './pages/PlanEditorPage';
import { AboutPage, ContactPage, LandingPage } from './pages/SitePages';

/** Als App vom Home-Bildschirm gestartet (iOS/Android/Desktop-PWA)? */
const isInstalledApp = () =>
  matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

// Die installierte App startet direkt in der Projektverwaltung – auch Symbole, die vor der
// neuen Startseite angelegt wurden (diese starten noch mit der Adresse „./“).
if (typeof window !== 'undefined' && isInstalledApp() && parseRoute(location.hash).name === 'landing') {
  navigate(paths.projects(), true);
}

export function App() {
  const route = parseRoute(useHash());
  useServiceWorker();
  useEffect(() => {
    try {
      if (sessionStorage.getItem('justUpdated')) {
        sessionStorage.removeItem('justUpdated');
        toast('BauPad wurde auf die neueste Version aktualisiert.', 'success');
      }
    } catch {
      /* optional */
    }
  }, []);

  let content: ReactNode;
  switch (route.name) {
    case 'landing':
      content = <LandingPage />;
      break;
    case 'about':
      content = <AboutPage />;
      break;
    case 'contact':
      content = <ContactPage />;
      break;
    case 'projects':
      content = <HomePage />;
      break;
    case 'project':
      content = (
        <ProjectGate projectId={route.projectId}>
          <ProjectPage />
        </ProjectGate>
      );
      break;
    case 'costCenter':
      content = (
        <ProjectGate projectId={route.projectId}>
          <ProjectPage costCenterId={route.costCenterId} />
        </ProjectGate>
      );
      break;
    case 'plan':
      content = (
        <ProjectGate projectId={route.projectId}>
          <PlanEditorPage key={route.planId} planId={route.planId} focusDamageId={route.damageId} />
        </ProjectGate>
      );
      break;
    default:
      content = (
        <div className="page">
          <p>Seite nicht gefunden.</p>
          <a className="btn" href={paths.projects()}>
            Zur Startseite
          </a>
        </div>
      );
  }

  return (
    <>
      <OfflineBadge />
      {content}
      <DialogHost />
    </>
  );
}

/** Lädt das Projekt aus dem Gerätespeicher, bevor die Seite angezeigt wird. */
function ProjectGate({ projectId, children }: { projectId: string; children: ReactNode }) {
  const { loaded, loading, error } = useAppState((s) => ({
    loaded: s.projectId === projectId && !!s.data,
    loading: s.loading,
    error: s.projectId === projectId ? s.loadError : null,
  }));
  useEffect(() => {
    void openProject(projectId);
  }, [projectId]);
  if (error)
    return (
      <div className="page">
        <div className="banner banner-error">{error}</div>
        <a className="btn" href={paths.projects()}>
          Zur Startseite
        </a>
      </div>
    );
  if (!loaded || loading) return <div className="page loading">Projekt wird geladen …</div>;
  return <>{children}</>;
}

function OfflineBadge() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  if (online) return null;
  return (
    <div className="offline-badge" data-testid="offline-badge" title="Keine Internetverbindung – alle Daten werden lokal gespeichert.">
      <Icon name="wifiOff" size={16} /> Offline
    </div>
  );
}

/**
 * Service Worker (Offline-Betrieb) mit automatischer Aktualisierung:
 * - sucht beim Start, beim Zurückkehren in die App und alle 30 Minuten nach einer neuen Version,
 * - übernimmt sie selbstständig, sobald kein Eingabefenster offen ist und alles gespeichert wurde.
 */
function useServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
    let cancelled = false;
    let registration: ServiceWorkerRegistration | undefined;
    const check = () => {
      if (navigator.onLine) void registration?.update().catch(() => {});
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    import('virtual:pwa-register')
      .then(({ registerSW }) => {
        if (cancelled) return;
        const updateSW = registerSW({
          immediate: true,
          onRegisteredSW(_url, r) {
            registration = r;
            setInterval(check, 30 * 60 * 1000);
          },
          onOfflineReady() {
            toast('BauPad ist jetzt auch offline verfügbar.', 'success');
          },
          onNeedRefresh() {
            void applyUpdateWhenIdle(() => updateSW(true));
          },
        });
      })
      .catch((e) => console.warn('Service Worker nicht verfügbar', e));
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
}

/** Neue Version übernehmen, sobald kein Dialog offen ist; vorher alles speichern. */
async function applyUpdateWhenIdle(apply: () => Promise<void>) {
  while (document.querySelector('.modal')) await new Promise((r) => setTimeout(r, 2000));
  await flush();
  try {
    sessionStorage.setItem('justUpdated', '1');
  } catch {
    /* optional */
  }
  await apply();
}
