import { preloadExcelLogo } from './lib/company';
import { useEffect, useState, type ReactNode } from 'react';
import { DialogHost, toast } from './components/ui';
import { Icon } from './components/Icon';
import { currentPath, navigate, parseRoute, paths, usePath } from './lib/router';
import { flush, openProject, useAppState } from './lib/store';
import { HomePage } from './pages/HomePage';
import { ProjectPage } from './pages/ProjectPage';
import { PlanEditorPage } from './pages/PlanEditorPage';
import { HomePage as SiteHomePage } from './site/pages/HomePage';
import { ProductsPage } from './site/pages/ProductsPage';
import { BauPadPage } from './site/pages/BauPadPage';
import { ToolPage } from './site/pages/ToolPage';
import { CompanyPage } from './site/pages/CompanyPage';
import { ContactPage, ThanksPage } from './site/pages/ContactPage';
import { FuturePage } from './site/pages/FuturePage';
import { DeleteAccountPage, ImprintPage, NotFoundPage, PrivacyPage } from './site/pages/LegalPages';
import './site/site.css';
import { AccountPage, LoginPage, NewPasswordPage } from './pages/AccountPages';
import { AccessPendingPage } from './pages/AccessPendingPage';
import { ToolsPage } from './pages/ToolsPage';
import { WorkersPage } from './pages/WorkersPage';
import { ReportsPage } from './pages/ReportsPage';
import { ReportSitePage } from './pages/ReportSitePage';
import { CameraPage } from './pages/CameraPage';
import { ReportEditorPage } from './pages/ReportEditorPage';
import { PhotosPage } from './pages/PhotosPage';
import { PhotoSitePage } from './pages/PhotoSitePage';
import { DefectsPage } from './pages/DefectsPage';
import { DefectSitePage } from './pages/DefectSitePage';
import { DefectPlanPage } from './pages/DefectPlanPage';

import { isInstalledApp } from './lib/platform';
import { getAuth } from './lib/auth';
import { useSession } from './lib/use-session';
import { connectPhotoCloud } from './lib/photo-cloud';
import { remoteConnected } from './lib/remote';
import { isNativeApp } from './lib/native';
import { adoptFreeSites } from './lib/sites';
import { canTool, isLocked, ROUTE_TOOL } from './lib/access';
import { hasStoredSession, initAuth } from './lib/auth-init';

initAuth();

// Die installierte App startet in der Werkzeug-Übersicht („Tools“) – auch Symbole, die vor der
// neuen Startseite angelegt wurden (diese starten noch mit der Adresse „./“).
if (typeof window !== 'undefined' && isInstalledApp()) {
  const name = parseRoute(currentPath()).name;
  let resume = false;
  try {
    resume = localStorage.getItem('resumeCamera') === '1';
  } catch {
    /* egal */
  }
  // War beim letzten Schließen der Kamera-Modus offen, geht es direkt dort weiter (ein Tipp weniger)
  if (resume && (name === 'landing' || name === 'tools' || name === 'projects')) navigate(paths.camera(), true);
  // Ohne gespeicherte Anmeldung: zuerst Anmelden/Registrieren, sonst direkt die Tools
  else if (name === 'landing' && !hasStoredSession()) navigate(paths.login(), true);
  else if (name === 'landing') navigate(paths.tools(), true);
}

/** Website-Seiten, die angemeldet keinen Sinn haben: direkt zu den Tools */
const SITE_ROUTES_WHEN_SIGNED_IN = new Set(['landing', 'products', 'baupad', 'company', 'future', 'product']);

function ToolsRedirect() {
  useEffect(() => {
    // nur umleiten, wenn die Adresse inzwischen nicht schon weitergewandert ist
    if (SITE_ROUTES_WHEN_SIGNED_IN.has(parseRoute(currentPath()).name)) navigate(paths.tools(), true);
  }, []);
  return null;
}

/** Store-App: die Website-Seiten gehören nicht in die App – ohne Anmeldung zur Anmeldeseite (Tools-Weiterleitung übernimmt den Rest) */
function NativeRedirect() {
  useEffect(() => {
    if (SITE_ROUTES.has(parseRoute(currentPath()).name)) navigate(paths.login(), true);
  }, []);
  return null;
}

/** Website-Seiten (eigener Rahmen mit Titel und Meta-Angaben) */
const SITE_ROUTES = new Set(['landing', 'products', 'baupad', 'company', 'contact', 'thanks', 'future', 'imprint', 'privacy', 'deleteAccountInfo', 'product', 'notFound']);

/** App-Seiten: Standardtitel „BauPad“ (die vorgerenderte index.html trägt den Titel der Startseite); Seiten mit eigenem Titel überschreiben ihn danach */
function TitleReset({ route }: { route: string }) {
  useEffect(() => {
    if (!SITE_ROUTES.has(route)) document.title = 'BauPad';
  }, [route]);
  return null;
}

/** Seiten ohne Anmeldung: Website, Anmelden/Registrieren, neues Passwort */
const PUBLIC_ROUTES = new Set(['landing', 'products', 'baupad', 'company', 'contact', 'thanks', 'future', 'imprint', 'privacy', 'deleteAccountInfo', 'product', 'login', 'newPassword', 'notFound']);

/**
 * Zugangsschleuse für alle Werkzeuge: ohne Anmeldung geht es zur Anmeldeseite. Eine auf dem Gerät
 * gespeicherte Anmeldung zählt auch offline (der Dienst muss nicht erreichbar sein) – erst Abmelden
 * oder eine vom Dienst zurückgewiesene Sitzung entfernen sie.
 */
function AuthGate({ route, children }: { route: string; children: ReactNode }) {
  const session = useSession();
  const stored = hasStoredSession();
  const blocked = session === null && !stored;
  // Werkzeug vom Admin nicht freigegeben → zurück zu den Tools
  const tool = ROUTE_TOOL[route];
  const forbidden = !!session && !!tool && !canTool(session, tool);
  // Arbeitsbereich noch nicht freigeschaltet (Bestellung offen) → Hinweisseite; Konto bleibt erreichbar (Abmelden, Konto löschen)
  const locked = !!session && isLocked(session) && route !== 'account';
  useEffect(() => {
    if (blocked) navigate(paths.login(), true);
    else if (forbidden) {
      toast('Dieses Werkzeug ist für dich nicht freigegeben. Bitte beim Admin deiner Firma nachfragen.', 'error');
      navigate(paths.tools(), true);
    }
  }, [blocked, forbidden]);
  if (blocked || forbidden || (session === undefined && !stored)) return null;
  if (locked) return <AccessPendingPage session={session!} />;
  return <>{children}</>;
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
    const clean = () => history.replaceState(null, '', location.pathname);
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

/** Zentrale Ablage je nach Anmeldung anbinden (Firma vorhanden → Cloud-Adapter, sonst lokal) */
function usePhotoCloud() {
  const session = useSession();
  const companyId = session?.companyId ?? null;
  useEffect(() => {
    if (session === undefined) return;
    void connectPhotoCloud(remoteConnected() ? companyId : null).catch(() => {});
  }, [session === undefined, companyId]);
}

export function App() {
  const route = parseRoute(usePath());
  // Startbild mit Logo beim Öffnen der installierten App (kurz, dann die App)
  const [splash, setSplash] = useState(() => isInstalledApp());
  useEffect(() => {
    if (!splash) return;
    const t = window.setTimeout(() => setSplash(false), 900);
    return () => window.clearTimeout(t);
  }, [splash]);
  useServiceWorker();
  useAuthReturn();
  usePhotoCloud();
  // einmalig: frei eingetippte Baustellen aus älteren Ständen ins Projektregister übernehmen
  useEffect(() => {
    void adoptFreeSites().catch((e) => console.warn('Projektregister', e));
  }, []);
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
      content = <SiteHomePage />;
      break;
    case 'products':
      content = <ProductsPage />;
      break;
    case 'baupad':
      content = <BauPadPage />;
      break;
    case 'company':
      content = <CompanyPage />;
      break;
    case 'future':
      content = <FuturePage />;
      break;
    case 'contact':
      content = <ContactPage />;
      break;
    case 'thanks':
      content = <ThanksPage />;
      break;
    case 'imprint':
      content = <ImprintPage />;
      break;
    case 'privacy':
      content = <PrivacyPage />;
      break;
    case 'product':
      content = <ToolPage key={route.product} id={route.product} />;
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
    case 'defects':
      content = <DefectsPage />;
      break;
    case 'defectSite':
      content = <DefectSitePage key={route.siteKey} siteKey={route.siteKey} />;
      break;
    case 'defectPlan':
      content = <DefectPlanPage key={route.planId} planId={route.planId} markId={route.markId} />;
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
    case 'deleteAccountInfo':
      content = <DeleteAccountPage />;
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
      content = <NotFoundPage />;
  }

  return (
    <>
      <OfflineBadge />
      <TitleReset route={route.name} />
      {SITE_ROUTES_WHEN_SIGNED_IN.has(route.name) && hasStoredSession() ? <ToolsRedirect /> : isNativeApp() && SITE_ROUTES.has(route.name) && !['imprint', 'privacy', 'contact', 'deleteAccountInfo'].includes(route.name) ? <NativeRedirect /> : PUBLIC_ROUTES.has(route.name) ? content : <AuthGate route={route.name}>{content}</AuthGate>}
      <DialogHost />
      {splash && (
        <div className="splash" aria-hidden="true" data-testid="splash">
          <img src="/icons/icon-192.png" alt="" width={96} height={96} />
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
    if (!('serviceWorker' in navigator) || import.meta.env.DEV || isNativeApp()) return;
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
            // Hinweis nur in der App, nicht auf der Website
            if (!PUBLIC_ROUTES.has(parseRoute(currentPath()).name) || parseRoute(currentPath()).name === 'login') toast('BauPad ist jetzt auch offline verfügbar.', 'success');
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
