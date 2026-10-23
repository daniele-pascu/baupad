import { useEffect, useState, type ReactNode } from 'react';
import { DialogHost, toast } from './components/ui';
import { Icon } from './components/Icon';
import { parseRoute, paths, useHash } from './lib/router';
import { openProject, useAppState } from './lib/store';
import { HomePage } from './pages/HomePage';
import { ProjectPage } from './pages/ProjectPage';
import { CostCenterPage } from './pages/CostCenterPage';
import { PlanEditorPage } from './pages/PlanEditorPage';

export function App() {
  const route = parseRoute(useHash());
  useServiceWorker();

  let content: ReactNode;
  switch (route.name) {
    case 'home':
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
          <CostCenterPage costCenterId={route.costCenterId} />
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
          <a className="btn" href={paths.home()}>
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
        <a className="btn" href={paths.home()}>
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

function useServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
    let cancelled = false;
    import('virtual:pwa-register')
      .then(({ registerSW }) => {
        if (cancelled) return;
        const updateSW = registerSW({
          immediate: true,
          onOfflineReady() {
            toast('Die App ist jetzt auch offline verfügbar.', 'success');
          },
          onNeedRefresh() {
            showUpdateBanner(() => void updateSW(true));
          },
        });
      })
      .catch((e) => console.warn('Service Worker nicht verfügbar', e));
    return () => {
      cancelled = true;
    };
  }, []);
}

function showUpdateBanner(apply: () => void) {
  const el = document.createElement('div');
  el.className = 'update-banner';
  el.innerHTML = '<span>Eine neue Version der App ist verfügbar.</span>';
  const btn = document.createElement('button');
  btn.className = 'btn btn-sm btn-primary';
  btn.textContent = 'Jetzt aktualisieren';
  btn.onclick = apply;
  el.appendChild(btn);
  document.body.appendChild(el);
}
