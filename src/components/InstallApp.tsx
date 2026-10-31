import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { browser, platform, promptInstall, requestPersistence, storageStatus, useInstallState, type Platform } from '../lib/install';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { toast } from './ui';
import { cloudCall } from '../lib/cloud';
import { retryPhotoCloud, syncPhotoCloud, useCloudState } from '../lib/photo-cloud';
import { useDataSyncState } from '../lib/data-sync';
import { fmtBytes } from '../lib/photos';
import { useSession } from '../lib/use-session';
import { showError } from './ui';

/**
 * „BauPad installieren“: direkt über den Installationsdialog des Browsers (Android, PC), sonst
 * Schritt-für-Schritt-Anleitung (iPhone/iPad). Unsichtbar, wenn BauPad schon als App läuft.
 */
export function InstallButton({ variant = 'btn', label = 'BauPad als App installieren' }: { variant?: 'btn' | 'link'; label?: string }) {
  const { standalone } = useInstallState();
  const [guide, setGuide] = useState(false);
  if (standalone) return null;
  const click = async () => {
    const r = await promptInstall();
    if (r === 'unavailable') setGuide(true);
    else if (r === 'accepted') toast('BauPad wird installiert – du findest es danach auf dem Startbildschirm bzw. im Startmenü.', 'success', 5000);
  };
  return (
    <>
      <button type="button" className={variant === 'link' ? 'install-link' : 'btn'} onClick={() => void click()} data-testid="install-app">
        <Icon name="download" size={variant === 'link' ? 16 : 20} /> {label}
      </button>
      {/* direkt in <body>: unabhängig von Animationen/Ausrichtung der Seite */}
      {guide && createPortal(<InstallGuide onClose={() => setGuide(false)} />, document.body)}
    </>
  );
}

/** Kleine Symbolbilder für die Anleitung (wie in Safari/Chrome) */
const STEP_ICONS: Record<string, string> = {
  share: 'M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 002 2h10a2 2 0 002-2v-6',
  addHome: 'M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2zM12 8v8M8 12h8',
  confirm: 'M5 12l5 5 9-10',
  menu: 'M12 5h.01M12 12h.01M12 19h.01',
  install: 'M4 5h16v11H4zM9 20h6M12 8v5M9.5 10.5L12 13l2.5-2.5',
  dock: 'M3 17h18M6 21h12M5 4h14v10H5z',
};

function Step({ n, icon, title, text }: { n: number; icon: string; title: string; text?: string }) {
  return (
    <li className="install-step">
      <span className="install-step-pic" aria-hidden="true">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={icon === 'menu' ? 3.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d={STEP_ICONS[icon]} />
        </svg>
        <span className="install-step-no">{n}</span>
      </span>
      <span>
        <strong>{title}</strong>
        {text && <span className="muted small">{text}</span>}
      </span>
    </li>
  );
}

const TABS: { id: Platform; label: string }[] = [
  { id: 'ios', label: 'iPhone/iPad' },
  { id: 'android', label: 'Android' },
  { id: 'desktop', label: 'PC / Mac' },
];

/** Anleitung je Gerät; das eigene Gerät ist vorausgewählt */
export function InstallGuide({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Platform>(platform());
  const b = browser();
  return (
    <Modal title="BauPad als App installieren" onClose={onClose} testId="install-guide">
      <div className="segmented install-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} data-testid={`install-tab-${t.id}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'ios' && (
        <>
          <ol className="install-steps">
            <Step n={1} icon="share" title="Auf „Teilen“ tippen" text={b === 'chrome' || b === 'firefox' ? 'In Chrome oben rechts in der Adressleiste, in Safari unten in der Leiste.' : 'In Safari unten in der Leiste (das Quadrat mit Pfeil nach oben).'} />
            <Step n={2} icon="addHome" title="„Zum Home-Bildschirm“ wählen" text="Falls nicht sichtbar: in der Liste etwas nach unten wischen." />
            <Step n={3} icon="confirm" title="Oben rechts „Hinzufügen“ tippen" text="BauPad liegt jetzt mit eigenem Symbol auf dem Home-Bildschirm und öffnet im Vollbild." />
          </ol>
          <p className="banner banner-info small">
            Auf dem iPhone hat die App einen eigenen Speicher. Projekte, die du bisher im Browser angelegt hast, vorher mit „Sichern“ als Datei speichern
            und in der App über „Projektsicherung öffnen“ übernehmen. Danach BauPad immer über das Symbol öffnen.
          </p>
        </>
      )}
      {tab === 'android' && (
        <ol className="install-steps">
          <Step n={1} icon="menu" title="Menü ⋮ oben rechts öffnen" text="In Chrome (bzw. ≡ unten im Samsung-Browser)." />
          <Step n={2} icon="install" title="„App installieren“ wählen" text="Je nach Browser auch „Zum Startbildschirm hinzufügen“." />
          <Step n={3} icon="confirm" title="„Installieren“ bestätigen" text="BauPad erscheint auf dem Startbildschirm und in der App-Übersicht." />
        </ol>
      )}
      {tab === 'desktop' && (
        <>
          <ol className="install-steps">
            <Step n={1} icon="install" title="Installieren-Symbol in der Adressleiste" text="Chrome und Edge: rechts in der Adressleiste (Bildschirm mit Pfeil) – oder Menü ⋮ → „Streamen, speichern und teilen“ → „Seite als App installieren“." />
            <Step n={2} icon="confirm" title="„Installieren“ bestätigen" text="BauPad öffnet in einem eigenen Fenster und liegt im Startmenü bzw. Dock." />
            <Step n={3} icon="dock" title="Mac mit Safari" text="Menü „Ablage“ → „Zum Dock hinzufügen“." />
          </ol>
          {b === 'firefox' && <p className="banner banner-warn small">Firefox kann Web-Apps nicht installieren – bitte Chrome, Edge oder Safari verwenden.</p>}
        </>
      )}
      <p className="muted small">Alle Daten bleiben auf dem Gerät und sind beim nächsten Öffnen wieder da – auch ohne Internet.</p>
    </Modal>
  );
}

/** Konto → Einstellungen: App installieren und Speicherstatus */
export function AppStorageSettings() {
  const { standalone } = useInstallState();
  const [st, setSt] = useState<Awaited<ReturnType<typeof storageStatus>>>(null);
  const refresh = () => void storageStatus().then(setSt);
  useEffect(refresh, []);
  const persist = async () => {
    const ok = await requestPersistence();
    refresh();
    toast(
      ok ? 'Die Daten werden dauerhaft auf diesem Gerät gespeichert.' : 'Der Browser hat die dauerhafte Speicherung noch nicht bestätigt. Als App installiert und regelmäßig genutzt, klappt es meist – Projekte zusätzlich mit „Sichern“ als Datei aufbewahren.',
      ok ? 'success' : 'info',
      6000,
    );
  };
  const mb = (n: number) => `${(n / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`;
  return (
    <section className="logo-settings" data-testid="app-settings">
      <div className="logo-settings-head">
        <div>
          <strong>App und Speicher</strong>
          <span className="muted">BauPad läuft im Browser und lässt sich auf PC, Android und iPhone/iPad als App installieren.</span>
        </div>
      </div>
      <div className="app-status">
        <span className={`status-pill${standalone ? ' ok' : ''}`} data-testid="app-installed">
          {standalone ? 'Als App installiert' : 'Im Browser geöffnet'}
        </span>
        {st && (
          <span className={`status-pill${st.persisted ? ' ok' : ' warn'}`} data-testid="storage-persisted">
            {st.persisted ? 'Daten dauerhaft gespeichert' : 'Dauerhafte Speicherung nicht bestätigt'}
          </span>
        )}
        {st && <span className="muted small">Belegt: {mb(st.usage)}</span>}
      </div>
      {st && !st.persisted && (
        <p className="small app-hint" data-testid="storage-hint">
          Ohne Bestätigung darf der Browser die Daten bei Speichermangel oder längerer Nichtnutzung löschen. Bitte dauerhafte Speicherung anfordern
          und Projekte regelmäßig mit „Sichern“ als Datei aufbewahren.
        </p>
      )}
      <div className="row gap wrap">
        <InstallButton />
        {st && !st.persisted && (
          <button type="button" className="btn" onClick={() => void persist()} data-testid="storage-persist">
            <Icon name="save" /> Dauerhaft speichern
          </button>
        )}
      </div>
      <CloudSettings />
    </section>
  );
}

const CLOUD_LABELS = {
  off: 'Nur auf diesem Gerät',
  setup: 'Noch nicht eingerichtet',
  connecting: 'Wird verbunden …',
  ready: 'Verbunden',
  error: 'Keine Verbindung',
} as const;

/** Konto → App und Speicher: Zustand der zentralen Ablage, Warteschlange, Abgleich; Betreiber: Prüfung und Einrichtung */
function CloudSettings() {
  const session = useSession();
  const cloud = useCloudState();
  const data = useDataSyncState();
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<{ photos: number; bytes: number } | null>(null);
  useEffect(() => {
    if (cloud.status !== 'ready') return;
    void cloudCall<{ photos: number; bytes: number }>('usage')
      .then(setUsage)
      .catch(() => setUsage(null));
  }, [cloud.status, cloud.lastSyncAt]);
  const run = async (label: string, fn: () => Promise<string>) => {
    setBusy(true);
    try {
      toast(await fn(), 'success', 6000);
    } catch (e) {
      showError(e, label);
    } finally {
      setBusy(false);
    }
  };
  const sync = () => run('Abgleich fehlgeschlagen', async () => {
    await syncPhotoCloud();
    return 'Abgleich abgeschlossen.';
  });
  const retry = () => run('Ablage nicht erreichbar', async () => {
    await retryPhotoCloud(session?.companyId ?? '');
    return 'Verbindung zur Ablage aufgebaut.';
  });
  const check = () => run('Verbindung fehlgeschlagen', async () => {
    const r = await cloudCall<{ ok: boolean; bucket: string; endpoint: string; region: string }>('status');
    return `Verbunden: Bucket ${r.bucket} (${r.region}) über ${r.endpoint}.`;
  });
  const corsSetup = () => run('Einrichtung fehlgeschlagen', async () => {
    await cloudCall('setup-cors');
    return 'Browser-Zugriff am Bucket eingerichtet (CORS).';
  });
  const tone = cloud.status === 'ready' ? ' ok' : cloud.status === 'off' || cloud.status === 'connecting' ? '' : ' warn';
  const time = (t: number) => new Date(t).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
  return (
    <div className="cloud-settings" data-testid="cloud-settings">
      <div className="logo-settings-head">
        <div>
          <strong>Zentrale Ablage</strong>
          <span className="muted">
            Projekte, Pläne, Aufmaße, Berichte, Einteilung, Mängelpläne, Formulare und Fotos aller Geräte deiner Firma – gespeichert in Nürnberg (Hetzner), Zugriff nur für
            angemeldete Benutzer deiner Firma. Ohne Netz bleibt alles auf dem Gerät und wird bei der nächsten Verbindung übertragen.
          </span>
        </div>
      </div>
      <div className="app-status">
        <span className={`status-pill${tone}`} data-testid="cloud-status">
          {CLOUD_LABELS[cloud.status]}
        </span>
        {cloud.status !== 'off' && cloud.pending > 0 && (
          <span className="muted small" data-testid="cloud-pending">
            {cloud.pending} {cloud.pending === 1 ? 'Foto wartet' : 'Fotos warten'} auf Upload
          </span>
        )}
        {data.status !== 'off' && data.pending > 0 && (
          <span className="muted small" data-testid="data-pending">
            {data.pending} {data.pending === 1 ? 'Änderung wartet' : 'Änderungen warten'} auf Upload
          </span>
        )}
        {(data.lastSyncAt ?? cloud.lastSyncAt) && <span className="muted small">Abgleich {time(Math.max(data.lastSyncAt ?? 0, cloud.lastSyncAt ?? 0))}</span>}
        {usage && (
          <span className="muted small" data-testid="cloud-usage">
            In der Ablage: {usage.photos} {usage.photos === 1 ? 'Foto' : 'Fotos'}, {fmtBytes(usage.bytes)}
          </span>
        )}
      </div>
      {data.status === 'error' && data.message && (
        <p className="small app-hint" data-testid="data-message">
          Datenabgleich: {data.message}
        </p>
      )}
      {cloud.message && cloud.status !== 'ready' && (
        <p className="small app-hint" data-testid="cloud-message">
          {cloud.message}
        </p>
      )}
      {cloud.status === 'off' && !session?.companyId && session && <p className="muted small">Dein Konto gehört zu keiner Firma – Fotos bleiben auf diesem Gerät.</p>}
      <div className="row gap wrap">
        {cloud.status === 'ready' && (
          <button type="button" className="btn" onClick={() => void sync()} disabled={busy || cloud.busy} data-testid="cloud-sync">
            <Icon name="refresh" /> Jetzt abgleichen
          </button>
        )}
        {(cloud.status === 'setup' || cloud.status === 'error') && session?.companyId && (
          <button type="button" className="btn" onClick={() => void retry()} disabled={busy} data-testid="cloud-retry">
            <Icon name="refresh" /> Erneut verbinden
          </button>
        )}
        {session?.operator && (
          <>
            <button type="button" className="btn" onClick={() => void check()} disabled={busy} data-testid="cloud-check">
              Verbindung prüfen
            </button>
            <button type="button" className="btn" onClick={() => void corsSetup()} disabled={busy} data-testid="cloud-cors">
              Browser-Zugriff einrichten
            </button>
          </>
        )}
      </div>
    </div>
  );
}
