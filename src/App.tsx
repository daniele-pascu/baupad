import { useAppearance } from './lib/appearance';
import { preloadExcelLogo } from './lib/company';
import { Component, lazy, Suspense, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { DialogHost, toast } from './components/ui';
import { Icon } from './components/Icon';
import { canonicalPath, currentPath, langOf, navigate, parseRoute, paths, usePath } from './lib/router';
import { flush, openProject, useAppState } from './lib/store';
import './site/site.css';
import { AccessPendingPage } from './pages/AccessPendingPage';
import { ToolsPage } from './pages/ToolsPage';

import { isInstalledApp } from './lib/platform';
import { getAuth } from './lib/auth';
import { useSession } from './lib/use-session';
import { backfillPhotoUserNames, connectPhotoCloud, syncPhotoCloud } from './lib/photo-cloud';
import { remoteConnected } from './lib/remote';
import { isNativeApp } from './lib/native';
import { adoptFreeSites } from './lib/sites';
import { notifyDataChanged, useDataChanged } from './lib/data-events';
import { canTool, isLocked, ROUTE_TOOL } from './lib/access';
import { hasStoredSession, initAuth } from './lib/auth-init';

/**
 * Seiten werden erst beim Öffnen geladen (eigene Dateien je Seite) – der Start lädt nur den Rahmen und die Tools-Übersicht.
 * Angemeldet werden die Seiten im Leerlauf vorgewärmt; eine schon geladene Seite erscheint ohne Zwischenbild.
 */
const PRELOADS: (() => Promise<void>)[] = [];
function page<K extends string>(load: () => Promise<Record<K, unknown>>, name: K) {
  type Any = ComponentType<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  let Loaded: Any | null = null;
  let pending: Promise<void> | null = null;
  const ensure = () =>
    (pending ??= load().then(
      (m) => {
        Loaded = m[name] as Any;
      },
      (e) => {
        pending = null; // nächster Versuch lädt neu (z. B. nach kurzem Funkloch)
        throw e;
      },
    ));
  // React merkt sich einen Fehlschlag dauerhaft – nach einem Fehler deshalb ein neuer Versuch mit frischem Lader
  const make = () =>
    lazy(() =>
      ensure().then(
        () => ({ default: Loaded! }),
        (e) => {
          Lazy = make();
          throw e;
        },
      ),
    );
  let Lazy = make();
  // je Einbau einmal entscheiden: schon geladen → direkt (kein Zwischenbild), sonst über Suspense
  const Page = (props: Record<string, unknown>) => {
    const [Use] = useState<Any>(() => Loaded ?? Lazy);
    return <Use {...props} />;
  };
  PRELOADS.push(ensure);
  return Page as Any;
}
const HomePage = page(() => import('./pages/HomePage'), 'HomePage');
const ProjectPage = page(() => import('./pages/ProjectPage'), 'ProjectPage');
const PlanEditorPage = page(() => import('./pages/PlanEditorPage'), 'PlanEditorPage');
const SiteHomePage = page(() => import('./site/pages/HomePage'), 'HomePage');
const ProductsPage = page(() => import('./site/pages/ProductsPage'), 'ProductsPage');
const BauPadPage = page(() => import('./site/pages/BauPadPage'), 'BauPadPage');
const ToolPage = page(() => import('./site/pages/ToolPage'), 'ToolPage');
const CompanyPage = page(() => import('./site/pages/CompanyPage'), 'CompanyPage');
const ContactPage = page(() => import('./site/pages/ContactPage'), 'ContactPage');
const ThanksPage = page(() => import('./site/pages/ContactPage'), 'ThanksPage');
const DeleteAccountPage = page(() => import('./site/pages/LegalPages'), 'DeleteAccountPage');
const ImprintPage = page(() => import('./site/pages/LegalPages'), 'ImprintPage');
const NotFoundPage = page(() => import('./site/pages/LegalPages'), 'NotFoundPage');
const PrivacyPage = page(() => import('./site/pages/LegalPages'), 'PrivacyPage');
const AccountPage = page(() => import('./pages/AccountPages'), 'AccountPage');
const AccountSectionPage = page(() => import('./pages/AccountPages'), 'AccountSectionPage');
const LoginPage = page(() => import('./pages/AccountPages'), 'LoginPage');
const NewPasswordPage = page(() => import('./pages/AccountPages'), 'NewPasswordPage');
const WorkersPage = page(() => import('./pages/WorkersPage'), 'WorkersPage');
const StaffPage = page(() => import('./pages/StaffPage'), 'StaffPage');
const ReportsPage = page(() => import('./pages/ReportsPage'), 'ReportsPage');
const ReportSitePage = page(() => import('./pages/ReportSitePage'), 'ReportSitePage');
const CameraPage = page(() => import('./pages/CameraPage'), 'CameraPage');
const ReportEditorPage = page(() => import('./pages/ReportEditorPage'), 'ReportEditorPage');
const FormTemplatesPage = page(() => import('./pages/FormTemplatesPage'), 'FormTemplatesPage');
const FormTemplateEditorPage = page(() => import('./pages/FormTemplateEditorPage'), 'FormTemplateEditorPage');
const FormEntryPage = page(() => import('./pages/FormEntryPage'), 'FormEntryPage');
const TimesPage = page(() => import('./pages/TimesPage'), 'TimesPage');
const RegisterPage = page(() => import('./pages/RegisterPage'), 'RegisterPage');
const TimesheetPage = page(() => import('./pages/TimesheetPage'), 'TimesheetPage');
const PhotosPage = page(() => import('./pages/PhotosPage'), 'PhotosPage');
const RecentPhotosPage = page(() => import('./pages/RecentPhotosPage'), 'RecentPhotosPage');
const PhotoSitePage = page(() => import('./pages/PhotoSitePage'), 'PhotoSitePage');
const DefectsPage = page(() => import('./pages/DefectsPage'), 'DefectsPage');
const MaterialsPage = page(() => import('./pages/MaterialsPage'), 'MaterialsPage');
const MaterialSitePage = page(() => import('./pages/MaterialSitePage'), 'MaterialSitePage');
const DefectSitePage = page(() => import('./pages/DefectSitePage'), 'DefectSitePage');
const DefectPlanPage = page(() => import('./pages/DefectPlanPage'), 'DefectPlanPage');

/** Seiten nacheinander im Leerlauf laden, damit der erste Klick auf ein Tool sofort reagiert */
function warmPages() {
  let i = 0;
  const next = () => {
    const load = PRELOADS[i++];
    if (!load) return;
    void load()
      .catch(() => undefined)
      .then(() => window.setTimeout(next, 40));
  };
  const idle = (window as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
  if (idle) idle(next);
  else window.setTimeout(next, 1500);
}
const CHUNK_ERROR = /dynamically imported module|module script failed|error loading|failed to fetch/i;

/**
 * Fängt Fehler einer Seite ab, statt die ganze App leer zu lassen. Konnte eine Seitendatei nicht geladen werden:
 * mit Empfang einmal neu laden (nach einer neuen Version fehlen alte Dateien am Server), ohne Empfang Hinweis mit
 * „Erneut versuchen“. Ein Seitenwechsel setzt die Grenze zurück.
 */
class PageBoundary extends Component<{ resetKey: string; children: ReactNode }, { error: unknown }> {
  state = { error: null as unknown };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  componentDidCatch(error: unknown) {
    if (!CHUNK_ERROR.test(String(error)) || !navigator.onLine) return;
    try {
      const last = Number(sessionStorage.getItem('chunk-reload') || 0);
      if (Date.now() - last < 30_000) return;
      sessionStorage.setItem('chunk-reload', String(Date.now()));
    } catch {
      return;
    }
    location.reload();
  }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (!this.state.error) return this.props.children;
    const chunk = CHUNK_ERROR.test(String(this.state.error));
    return (
      <div className="page">
        <div className="banner banner-warn" data-testid="page-load-failed">
          <p>{chunk ? 'Diese Seite konnte nicht geladen werden – wahrscheinlich kein Empfang.' : 'Diese Seite konnte nicht angezeigt werden.'}</p>
          <div className="row gap wrap">
            <button type="button" className="btn btn-primary" onClick={() => this.setState({ error: null })} data-testid="page-retry">
              Erneut versuchen
            </button>
            <a href={paths.tools()} className="btn">
              Zu den Tools
            </a>
          </div>
        </div>
      </div>
    );
  }
}

initAuth();

/** Seiten, die die installierte App beim Start nicht auf die Werkzeug-Übersicht umlenkt (Anmeldung, Rechtliches, Konto-Links aus E-Mails) */
const PUBLIC_ROUTES_AT_START = new Set(['login', 'register', 'newPassword', 'imprint', 'privacy', 'contact', 'deleteAccountInfo', 'account', 'accountSection', 'camera']);

// Die installierte App startet immer in der Werkzeug-Übersicht („Tools“) – bzw. im Kamera-Modus, wenn der zuletzt
// offen war. Auch Symbole, die vor der neuen Startseite angelegt wurden (Adresse „./“), und Android, das die
// letzte Adresse wiederherstellt.
/** schon gestartet (nur neu geladen, z. B. über einen Link)? Dann bleibt die Seite, wie sie ist */
const reloaded = (() => {
  try {
    const was = sessionStorage.getItem('appStarted') === '1';
    sessionStorage.setItem('appStarted', '1');
    return was;
  } catch {
    return false;
  }
})();
if (typeof window !== 'undefined' && isInstalledApp() && !reloaded) {
  const name = parseRoute(currentPath()).name;
  let resume = false;
  try {
    resume = localStorage.getItem('resumeCamera') === '1';
  } catch {
    /* egal */
  }
  // War beim letzten Schließen der Kamera-Modus offen, geht es direkt dort weiter – mit dem letzten Projekt (ein Tipp weniger)
  if (resume && (name === 'landing' || name === 'tools' || name === 'projects')) navigate(paths.camera(), true);
  // Ohne gespeicherte Anmeldung: zuerst Anmelden/Registrieren
  else if (name === 'landing' && !hasStoredSession()) navigate(paths.login(), true);
  // sonst immer die Werkzeug-Übersicht („Tools“) – auch wenn die App zuletzt in einem Werkzeug offen war
  else if (name !== 'tools' && !PUBLIC_ROUTES_AT_START.has(name) && hasStoredSession()) navigate(paths.tools(), true);
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
    const site = SITE_ROUTES.has(route);
    if (!site) document.title = 'BauPad';
    setTabIcon(site ? 'pad' : 'baupad');
  }, [route]);
  return null;
}

/** Symbol im Browser-Tab: Website = PAD-Software-Logo, geöffnete App = BauPad-Logo */
const TAB_ICONS = {
  pad: { icon: '/icons/pad-favicon-64.png', touch: '/icons/pad-icon-180.png' },
  baupad: { icon: '/icons/favicon-64.png', touch: '/icons/icon-180.png' },
} as const;
function setTabIcon(kind: keyof typeof TAB_ICONS) {
  const set = (rel: string, href: string) => {
    let l = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
    if (!l) {
      l = document.createElement('link');
      l.rel = rel;
      document.head.appendChild(l);
    }
    if (l.getAttribute('href') !== href) l.setAttribute('href', href);
  };
  set('icon', TAB_ICONS[kind].icon);
  set('apple-touch-icon', TAB_ICONS[kind].touch);
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
  const locked = !!session && isLocked(session) && route !== 'account' && route !== 'accountSection';
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
  const userId = session?.userId ?? null;
  const userName = session?.name ?? '';
  useEffect(() => {
    if (session === undefined) return;
    void connectPhotoCloud(remoteConnected() ? companyId : null)
      .catch(() => {})
      // nach der Anbindung: eigene Fotos ohne Namen bekommen den Namen der Anmeldung, danach Abgleich
      .then(() => backfillPhotoUserNames(userId ? { id: userId, name: userName } : null))
      .then(() => syncPhotoCloud().catch(() => {}))
      .catch(() => {});
  }, [session === undefined, companyId, userId, userName]);
}

export function App() {
  // angemeldet: die Tools im Leerlauf vorladen (Besucher der Website laden nur die Website)
  useEffect(() => {
    if (hasStoredSession()) warmPages();
  }, []);
  const path = usePath();
  const route = parseRoute(path);
  // Darstellung (Größe, hell/dunkel) und feste Größe nur in der App, nicht auf der Website
  useAppearance(!SITE_ROUTES.has(route.name));
  // alte Adressen still auf die richtige umschreiben (/tools → /baupad/tools …); Abfrage wie ?reset=1 bleibt erhalten
  useEffect(() => {
    if (location.hash.startsWith('#/')) return; // wird zuerst von der #-Umschreibung behandelt
    // Stand jetzt lesen (eine Seite kann in ihrem eigenen Effekt schon weiternavigiert haben)
    const now = location.pathname;
    const want = canonicalPath(parseRoute(now + location.search), langOf(now));
    if (want && decodeURIComponent(now.replace(/\/+$/, '') || '/') !== decodeURIComponent(want)) navigate(`${want}${location.search}`, true);
  }, [path]);
  // kein eigenes Startbild: Android/iOS bzw. die Store-App zeigen beim Öffnen schon das Logo – nur einmal
  useServiceWorker();
  useAuthReturn();
  usePhotoCloud();
  // Projektregister nachziehen: beim Start und nach jedem Abgleich (Baustellen ohne Projekt → Projekt im Register)
  const adopt = () =>
    adoptFreeSites()
      .then((n) => {
        if (n) notifyDataChanged(); // Seiten zeigen die Einträge jetzt unter dem Projekt
      })
      .catch((e) => console.warn('Projektregister', e));
  useEffect(() => void adopt(), []);
  useDataChanged(() => void adopt());
  // Firmenlogo für Excel-Exporte vorab laden (Export bleibt synchron im Klick)
  useEffect(preloadExcelLogo, []);
  useDataChanged(preloadExcelLogo); // Firmenlogo kann von einem anderen Gerät kommen
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
      content = <ProductsPage />; // Seite „Zukunft“ abgeschaltet – alte Adresse zeigt die Produkte
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
    case 'staff':
      content = <StaffPage />;
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
    case 'formTemplates':
      content = <FormTemplatesPage />;
      break;
    case 'formTemplate':
      content = <FormTemplateEditorPage key={route.templateId} templateId={route.templateId} />;
      break;
    case 'formEntry':
      content = <FormEntryPage key={route.entryId} entryId={route.entryId} />;
      break;
    case 'register':
      content = <RegisterPage />;
      break;
    case 'times':
      content = <TimesPage month={route.month} date={route.date} />;
      break;
    case 'timesheet':
      content = <TimesheetPage key={route.workerId} workerId={route.workerId} month={route.month} />;
      break;
    case 'photos':
      content = <PhotosPage />;
      break;
    case 'photosRecent':
      content = <RecentPhotosPage />;
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
    case 'materials':
      content = <MaterialsPage tab={({ baustellen: 'sites', bestellungen: 'orders', geraete: 'equipment', material: 'materials', lieferanten: 'suppliers' } as const)[route.tab ?? ''] ?? 'overview'} />;
      break;
    case 'materialSite':
      content = <MaterialSitePage key={route.projectId} projectId={route.projectId} />;
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
    case 'accountSection':
      content = <AccountSectionPage key={route.section} section={route.section} />;
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
  content = (
    <PageBoundary resetKey={path}>
      <Suspense fallback={<div className="page loading" aria-busy="true" />}>{content}</Suspense>
    </PageBoundary>
  );

  return (
    <>
      <OfflineBadge />
      <TitleReset route={route.name} />
      {SITE_ROUTES_WHEN_SIGNED_IN.has(route.name) && hasStoredSession() ? <ToolsRedirect /> : isNativeApp() && SITE_ROUTES.has(route.name) && !['imprint', 'privacy', 'contact', 'deleteAccountInfo'].includes(route.name) ? <NativeRedirect /> : PUBLIC_ROUTES.has(route.name) ? content : <AuthGate route={route.name}>{content}</AuthGate>}
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
