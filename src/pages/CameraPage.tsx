import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { deviceUserName, PhotoCapture, photoFromPrepared } from '../components/PhotoCapture';
import { PhotoImg } from '../components/PhotoImg';
import { PhotoSitePicker } from '../components/PhotoSitePicker';
import { showError, toast } from '../components/ui';
import { uuid } from '../lib/ids';
import { getPhotoStorage } from '../lib/photo-storage';
import { photoSiteKey, preparePhoto } from '../lib/photos';
import { navigate, paths } from '../lib/router';
import type { Photo, PhotoSite } from '../lib/types';
import { loadPhotoSites } from './PhotosPage';
import { usePageTitle } from './SitePages';

const LAST_SITE = 'photoLastSite';
const keyOf = (s: PhotoSite) => photoSiteKey({ projectId: s.projectId, siteName: s.name });

/**
 * Kamera-Modus: Live-Bild der Gerätekamera, Baustelle oben wählbar, großer Auslöser; jedes Foto wird sofort
 * der Baustelle zugeordnet und gespeichert (Aufnahmezeit = jetzt, Benutzer vom Gerät). Letztes Foto als
 * Kachel, Zähler, Blitz (wenn das Gerät es kann), Kamera wechseln, Beschreibung für die nächsten Fotos.
 * Ohne Kamerazugriff im Browser bleibt die Gerätekamera über die Dateiauswahl erreichbar.
 */
export function CameraPage({ siteKey }: { siteKey: string | null }) {
  usePageTitle('Kamera – Fotodokumentation – BauPad');
  const [sites, setSites] = useState<PhotoSite[]>([]);
  const [site, setSite] = useState<PhotoSite | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [count, setCount] = useState(0);
  const [last, setLast] = useState<Photo | null>(null);
  const [user, setUser] = useState('');
  const [desc, setDesc] = useState('');
  const [descOpen, setDescOpen] = useState(false);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [torch, setTorch] = useState(false);
  const [torchOk, setTorchOk] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const hashes = useMemo(() => new Set(photos.map((p) => p.hash)), [photos]);

  const reload = () =>
    getPhotoStorage()
      .list()
      .then(async (list) => {
        setPhotos(list);
        const s = await loadPhotoSites(list);
        setSites(s);
        return s;
      });
  useEffect(() => {
    void deviceUserName().then(setUser);
    void reload()
      .then((s) => {
        let want = siteKey;
        if (!want) {
          try {
            want = localStorage.getItem(LAST_SITE);
          } catch {
            /* egal */
          }
        }
        const found = s.find((x) => keyOf(x) === want) ?? (s.length === 1 ? s[0] : null);
        setSite(found);
      })
      .catch((e) => showError(e, 'Baustellen konnten nicht geladen werden'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey]);
  const chooseSite = (s: PhotoSite | null) => {
    setSite(s);
    try {
      if (s) localStorage.setItem(LAST_SITE, keyOf(s));
    } catch {
      /* egal */
    }
  };

  // Kamera starten (und beim Wechsel bzw. Verlassen stoppen)
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setError(null);
    setTorch(false);
    setTorchOk(false);
    const stop = () => {
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = null;
    };
    stop();
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Dieser Browser erlaubt keinen direkten Kamerazugriff.');
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: facing, width: { ideal: 2560 }, height: { ideal: 1920 } }, audio: false })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream.current = s;
        const v = video.current;
        if (v) {
          v.srcObject = s;
          void v.play().catch(() => undefined);
        }
        const track = s.getVideoTracks()[0];
        const caps = (track?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
        setTorchOk(!!caps.torch);
        setReady(true);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const name = e instanceof Error ? e.name : '';
        setError(name === 'NotAllowedError' ? 'Kamerazugriff wurde nicht erlaubt.' : name === 'NotFoundError' ? 'Keine Kamera gefunden.' : 'Kamera konnte nicht gestartet werden.');
      });
    return () => {
      cancelled = true;
      stop();
    };
  }, [facing]);

  const toggleTorch = () => {
    const track = stream.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torch;
    track
      .applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] })
      .then(() => setTorch(next))
      .catch(() => toast('Blitz wird von diesem Gerät nicht unterstützt.', 'info'));
  };

  const shoot = async () => {
    const v = video.current;
    if (!v || !ready || busy) return;
    if (!site) {
      toast('Bitte zuerst die Baustelle wählen.', 'info');
      return;
    }
    setBusy(true);
    setFlash(true);
    window.setTimeout(() => setFlash(false), 180);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = v.videoWidth || 1280;
      canvas.height = v.videoHeight || 960;
      canvas.getContext('2d')!.drawImage(v, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.92));
      if (!blob) throw new Error('Bild konnte nicht aufgenommen werden.');
      const now = new Date();
      const stamp = now.toISOString().replace(/[-:]/g, '').slice(0, 15);
      const file = new File([blob], `BauPad_${stamp}.jpg`, { type: 'image/jpeg', lastModified: now.getTime() });
      const pr = await preparePhoto(file);
      const photo = photoFromPrepared(uuid(), file, { ...pr, takenAt: now.getTime(), takenFrom: 'now' }, site, user, desc);
      const saved = await getPhotoStorage().put(photo, { data: pr.data, thumb: pr.thumb });
      setPhotos((p) => [...p, saved]);
      setLast(saved);
      setCount((n) => n + 1);
    } catch (e) {
      showError(e, 'Foto konnte nicht gespeichert werden');
    } finally {
      setBusy(false);
    }
  };

  const siteKeyNow = site ? keyOf(site) : null;
  const back = siteKeyNow ? paths.photoSite(siteKeyNow) : paths.photos();
  const reportsKey = site ? (site.projectId ? `p:${site.projectId}` : `n:${site.name.trim().toLowerCase()}`) : null;

  return (
    <div className="cam" data-testid="camera-page" data-ready={ready || undefined}>
      <header className="cam-top">
        <button type="button" className="cam-icon" onClick={() => setMenu(true)} aria-label="Menü" data-testid="cam-menu">
          <Icon name="menu" size={24} />
        </button>
        <div className="cam-site">
          <PhotoSitePicker
            sites={sites}
            value={site}
            onChange={chooseSite}
            onCreated={(s) => setSites((l) => [...l, s])}
            testId="cam-site"
          />
          {(site ? site.address : true) && <span className="cam-site-sub">{site ? site.address : 'Bitte Baustelle wählen'}</span>}
        </div>
        <a className="cam-icon cam-count" href={back} aria-label="Zu den Fotos" title="Zu den Fotos" data-testid="cam-close">
          <span data-testid="cam-counter">{count}</span>
          <Icon name="close" size={22} />
        </a>
      </header>

      <div className="cam-view">
        <video ref={video} playsInline muted autoPlay data-testid="cam-video" />
        {flash && <div className="cam-flash" />}
        {!ready && !error && <p className="cam-hint">Kamera wird gestartet …</p>}
        {error && (
          <div className="cam-error" data-testid="cam-error">
            <p>{error}</p>
            <p className="small">Du kannst die Kamera-App des Geräts verwenden – das Foto wird genauso gespeichert.</p>
          </div>
        )}
        {desc && (
          <button type="button" className="cam-desc-chip" onClick={() => setDescOpen(true)} data-testid="cam-desc-chip">
            <Icon name="text" size={14} /> {desc}
          </button>
        )}
        <div className="cam-side">
          <button type="button" className={`cam-icon${desc ? ' on' : ''}`} onClick={() => setDescOpen(true)} aria-label="Beschreibung für die nächsten Fotos" title="Beschreibung" data-testid="cam-desc">
            <Icon name="text" size={22} />
          </button>
          {torchOk && (
            <button type="button" className={`cam-icon${torch ? ' on' : ''}`} onClick={toggleTorch} aria-label="Blitz" title="Blitz" data-testid="cam-torch">
              <Icon name="flash" size={22} />
            </button>
          )}
          <button type="button" className="cam-icon" onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))} aria-label="Kamera wechseln" title="Kamera wechseln" data-testid="cam-flip">
            <Icon name="flip" size={22} />
          </button>
        </div>
      </div>

      <footer className="cam-bottom">
        {last ? (
          <a className="cam-last" href={paths.photoSite(keyOf(site!), { photoId: last.id })} aria-label="Letztes Foto ansehen" data-testid="cam-last">
            <PhotoImg id={last.id} />
          </a>
        ) : (
          <span className="cam-last empty" />
        )}
        {error ? (
          <PhotoCapture
            sites={sites}
            site={site ?? undefined}
            existingHashes={hashes}
            onSaved={(list) => {
              setCount((n) => n + list.length);
              setLast(list[list.length - 1] ?? null);
              void reload();
            }}
            render={({ camera }) => (
              <button type="button" className="cam-shutter" onClick={camera} aria-label="Foto aufnehmen" data-testid="cam-shutter-native">
                <Icon name="camera" size={34} />
              </button>
            )}
          />
        ) : (
          <button type="button" className="cam-shutter" onClick={() => void shoot()} disabled={!ready || busy} aria-label="Foto aufnehmen" data-testid="cam-shutter">
            <Icon name="camera" size={34} />
          </button>
        )}
        <PhotoCapture
          sites={sites}
          site={site ?? undefined}
          existingHashes={hashes}
          onSaved={(list) => {
            setCount((n) => n + list.length);
            setLast(list[list.length - 1] ?? null);
            void reload();
          }}
          render={({ library }) => (
            <button type="button" className="cam-icon cam-gallery" onClick={library} aria-label="Aus Galerie / Datei" title="Aus Galerie / Datei" data-testid="cam-gallery">
              <Icon name="images" size={26} />
            </button>
          )}
        />
      </footer>

      {descOpen && (
        <div className="cam-sheet-backdrop" onClick={() => setDescOpen(false)}>
          <form
            className="cam-sheet"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              setDescOpen(false);
            }}
          >
            <strong>Beschreibung für die nächsten Fotos</strong>
            <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="z. B. Riss Stütze B4" autoFocus data-testid="cam-desc-input" />
            <div className="row gap">
              <button type="button" className="btn btn-sm" onClick={() => setDesc('')}>
                Leeren
              </button>
              <button type="submit" className="btn btn-sm btn-primary" data-testid="cam-desc-save">
                Übernehmen
              </button>
            </div>
          </form>
        </div>
      )}
      {menu && (
        <div className="cam-sheet-backdrop" onClick={() => setMenu(false)}>
          <nav className="cam-drawer" onClick={(e) => e.stopPropagation()} aria-label="Menü" data-testid="cam-drawer">
            <strong className="cam-drawer-title">{site ? [site.number, site.name].filter(Boolean).join(' · ') : 'BauPad'}</strong>
            {siteKeyNow && (
              <a href={paths.photoSite(siteKeyNow)}>
                <Icon name="images" size={20} /> Fotos der Baustelle
              </a>
            )}
            {reportsKey && (
              <a href={paths.reportSite(reportsKey)}>
                <Icon name="file" size={20} /> Regielisten &amp; Tagesberichte
              </a>
            )}
            <a href={paths.photos()}>
              <Icon name="folder" size={20} /> Alle Baustellen
            </a>
            <button
              type="button"
              onClick={() => {
                setMenu(false);
                document.querySelector<HTMLSelectElement>('[data-testid="cam-site"]')?.focus();
              }}
            >
              <Icon name="move" size={20} /> Baustelle wechseln
            </button>
            <a href={paths.account()}>
              <Icon name="settings" size={20} /> Einstellungen
            </a>
            <a href={paths.tools()}>
              <Icon name="grid" size={20} /> Alle Werkzeuge
            </a>
            <button type="button" className="muted" onClick={() => navigate(back)}>
              <Icon name="close" size={20} /> Kamera schließen
            </button>
          </nav>
        </div>
      )}
    </div>
  );
}
