import { preloadExcelLogo } from './lib/company';
import { useEffect, useState, type ReactNode } from 'react';
import { DialogHost, toast } from './components/ui';
import { Icon } from './components/Icon';
import { navigate, parseRoute, paths, useHash } from './lib/router';
import { flush, openProject, useAppState } from './lib/store';
import { HomePage } from './pages/HomePage';
import { ProjectPage } from './pages/ProjectPage';
import { PlanEditorPage } from './pages/PlanEditorPage';
import { AboutPage, ContactPage, LandingPage, ImprintPage, PrivacyPage } from './pages/SitePages';
import { ProductPage } from './pages/ProductPage';
import { AccountPage, LoginPage, NewPasswordPage } from './pages/AccountPages';
import { ToolsPage } from './pages/ToolsPage';
import { WorkersPage } from './pages/WorkersPage';
import { ReportsPage } from './pages/ReportsPage';
import { ReportSitePage } from './pages/ReportSitePage';
import { CameraPage } from './pages/CameraPage';
import { ReportEditorPage } from './pages/ReportEditorPage';
import { PhotosPage } from './pages/PhotosPage';
import { PhotoSitePage } from './pages/PhotoSitePage';

import { isInstalledApp } from './lib/platform';
import { authSkipped, getAuth } from './lib/auth';
import { hasStoredSession, initAuth } from './lib/auth-init';

initAuth();

// Die installierte App startet in der Werkzeug-Übersicht („Tools“) – auch Symbole, die vor der
// neuen Startseite angelegt wurden (diese starten noch mit der Adresse „./“).
if (typeof window !== 'undefined' && isInstalledApp()) {
  const name = parseRoute(location.hash).name;
  let resume = false;
  try {
    resume = localStorage.getItem('resumeCamera') === '1';
  } catch {
    /* egal */
  }
  // War beim letzten Schließen der Kamera-Modus offen, geht es direkt dort weiter (ein Tipp weniger)
  if (resume && (name === 'landing' || name === 'tools' || name === 'projects')) navigate(paths.camera(), true);
  // Ohne Anmeldung und ohne „ohne Konto weiter“: zuerst Anmelden/Registrieren, dann die Tools
  else if (name === 'landing' && !hasStoredSession() && !authSkipped()) navigate(paths.login(), true);
  else if (name === 'landing') navigate(paths.tools(), true);
}

/**
 * Rückkehr von Google/Apple/Microsoft oder aus einem E-Mail-Link: Supabase hängt „?code=…“ an die Adresse.
 * Der Client tauscht den Code ein; sobald die Sitzung da ist, geht es zu den Tools (oder zum neuen Passwort).
 */
function useAuthReturn() {
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (!q.has('code') && !q.has('reset') && !q.has('error_description')) return;
    const err = q.get('error_description');
    const reset = q.get('reset') === '1';
    const clean = () => history.replaceState(null, '', location.pathname + location.hash);
    if (err) {
      clean();
      toast(`Anmeldung nicht möglich: ${err}`, 'error');
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clean();
      navigate(reset ? paths.newPassword() : paths.tools(), true);
    };
    const off = getAuth().onChange((s) => s && finish());
    void getAuth()
      .session()
      .then((s) => s && finish());
    const t = window.setTimeout(() => {
      if (!done) clean();
    }, 15000);
    return () => {
      off();
      window.clearTimeout(t);
    };
  }, []);
}

export function App() {
  const route = parseRoute(useHash());
  // Startbild mit Logo beim Öffnen der installierten App (kurz, dann die App)
  const [splash, setSplash] = useState(() => isInstalledApp());
  useEffect(() => {
    if (!splash) return;
    const t = window.setTimeout(() => setSplash(false), 900);
    return () => window.clearTimeout(t);
  }, [splash]);
  useServiceWorker();
  useAuthReturn();
  // Firmenlogo für Excel-Exporte vorab laden (Export bleibt synchron im Klick)
  useEffect(preloadExcelLogo, []);
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
    case 'imprint':
      content = <ImprintPage />;
      break;
    case 'privacy':
      content = <PrivacyPage />;
      break;
    case 'product':
      content = <ProductPage key={route.product} id={route.product} />;
      break;
    case 'projects':
      content = <HomePage />;
      break;
    case 'tools':
      content = <ToolsPage />;
      break;
    case 'workers':
      content = <WorkersPage />;
      break;
    case 'reports':
      content = <ReportsPage />;
      break;
    case 'report':
      content = <ReportEditorPage key={route.reportId} reportId={route.reportId} />;
      break;
    case 'reportSite':
      content = <ReportSitePage key={route.siteKey} siteKey={route.siteKey} />;
      break;
    case 'photos':
      content = <PhotosPage />;
      break;
    case 'camera':
      content = <CameraPage key={route.siteKey ?? ''} siteKey={route.siteKey} />;
      break;
    case 'photoSite':
      content = <PhotoSitePage key={route.siteKey} siteKey={route.siteKey} week={route.week} photoId={route.photoId} />;
      break;
    case 'login':
      content = <LoginPage key={route.register ? 'r' : 'l'} register={route.register} />;
      break;
    case 'account':
      content = <AccountPage />;
      break;
    case 'newPassword':
      content = <NewPasswordPage />;
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
      {splash && (
        <div className="splash" aria-hidden="true" data-testid="splash">
          <img src="./icons/icon-192.png" alt="" width={96} height={96} />
          <strong>BauPad</strong>
          <span>PAD Software</span>
        </div>
      )}
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
  try {
    await apply();
  } catch (e) {
    // Update fehlgeschlagen (z. B. Verbindung abgebrochen): die bisherige Version läuft weiter,
    // beim nächsten Start wird es erneut versucht. Es geht nichts verloren (vorher gespeichert).
    console.warn('Update fehlgeschlagen', e);
    try {
      sessionStorage.removeItem('justUpdated');
    } catch {
      /* optional */
    }
  }
}
