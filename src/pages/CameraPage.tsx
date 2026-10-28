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

type Ratio = '4:3' | '3:2' | '16:9' | '1:1';
type Orient = 'auto' | 'portrait' | 'landscape';
const RATIOS: Ratio[] = ['4:3', '3:2', '16:9', '1:1'];
const ratioValue = (r: Ratio) => {
  const [a, b] = r.split(':').map(Number);
  return a / b;
};
function stored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return allowed.includes(v as T) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Drehung (Grad im Uhrzeigersinn) und Ausschnitt für ein Kamerabild: Das Bild des Sensors (fw × fh) wird
 * so gedreht, dass es zur Lage des Handys passt (Ausrichtungssperre!), und mittig auf das Seitenverhältnis
 * zugeschnitten. `angle` = Lage des Handys (90: Oberkante links, −90: Oberkante rechts), null = unbekannt.
 */
export function cameraFraming(fw: number, fh: number, ratio: Ratio, orient: Orient, angle: number | null, layoutLandscape: boolean): { rot: 0 | 90 | -90; crop: { x: number; y: number; w: number; h: number }; out: { w: number; h: number } } {
  const frameLandscape = fw > fh;
  let rot: 0 | 90 | -90 = 0;
  // automatisch: Lage laut Sensor bzw. Oberfläche; ohne Sensorwert bleibt das Sensorbild, wie es kommt (z. B. PC-Webcam)
  const wantLandscape = orient === 'landscape' ? true : orient === 'portrait' ? false : layoutLandscape || angle === 90 || angle === -90 || (angle === null && frameLandscape);
  if (wantLandscape && !frameLandscape) rot = angle === -90 ? 90 : -90;
  else if (!wantLandscape && frameLandscape) rot = 90;
  const ow = rot ? fh : fw;
  const oh = rot ? fw : fh;
  const r = ow >= oh ? ratioValue(ratio) : 1 / ratioValue(ratio);
  const cw = Math.min(ow, oh * r);
  const ch = cw / r;
  // Ausschnitt in Sensor-Koordinaten (vor der Drehung): Breite/Höhe tauschen, wenn gedreht wird
  const w = rot ? ch : cw;
  const h = rot ? cw : ch;
  return { rot, crop: { x: (fw - w) / 2, y: (fh - h) / 2, w, h }, out: { w: Math.round(cw), h: Math.round(ch) } };
}

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
  const [formatOpen, setFormatOpen] = useState(false);
  const [ratio, setRatio] = useState<Ratio>(() => stored('camRatio', RATIOS, '4:3'));
  const [orient, setOrient] = useState<Orient>(() => stored('camOrient', ['auto', 'portrait', 'landscape'] as const, 'auto'));
  /** Lage des Handys laut Sensor: 0 aufrecht, 90 Oberkante links, −90 Oberkante rechts; null = unbekannt */
  const [angle, setAngle] = useState<number | null>(null);
  const [layoutLandscape, setLayoutLandscape] = useState(() => matchMedia('(orientation: landscape)').matches);
  const [frame, setFrame] = useState<{ w: number; h: number } | null>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const motionAsked = useRef(false);
  const viewRef = useRef<HTMLDivElement>(null);
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

  // Drehung erkennen: Layout (wenn die Oberfläche mitdreht) und Lagesensor (auch bei Ausrichtungssperre)
  useEffect(() => {
    const mq = matchMedia('(orientation: landscape)');
    const onMq = () => setLayoutLandscape(mq.matches);
    mq.addEventListener('change', onMq);
    const onOrient = (e: DeviceOrientationEvent) => {
      const { beta, gamma } = e;
      if (beta === null || gamma === null) return;
      // aufrecht gehalten: beta ≈ 90, gamma ≈ 0; quer: gamma nahe ±90 (−90 = Oberkante links)
      if (Math.abs(gamma) > 50 && Math.abs(beta) < 40) setAngle(gamma < 0 ? 90 : -90);
      else if (Math.abs(gamma) < 30) setAngle(0);
    };
    const attach = () => window.addEventListener('deviceorientation', onOrient);
    const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> } | undefined;
    if (DOE && !DOE.requestPermission) attach();
    const ask = () => {
      if (motionAsked.current || !DOE?.requestPermission) return;
      motionAsked.current = true;
      DOE.requestPermission()
        .then((r) => r === 'granted' && attach())
        .catch(() => undefined);
    };
    // iOS fragt die Erlaubnis nur aus einer Berührung heraus ab
    window.addEventListener('touchend', ask, { once: true });
    window.addEventListener('click', ask, { once: true });
    const ro = new ResizeObserver(() => viewRef.current && setBox({ w: viewRef.current.clientWidth, h: viewRef.current.clientHeight }));
    if (viewRef.current) ro.observe(viewRef.current);
    return () => {
      mq.removeEventListener('change', onMq);
      window.removeEventListener('deviceorientation', onOrient);
      window.removeEventListener('touchend', ask);
      window.removeEventListener('click', ask);
      ro.disconnect();
    };
  }, []);
  const framing = frame ? cameraFraming(frame.w, frame.h, ratio, orient, angle, layoutLandscape) : null;
  /** Maske über dem Live-Bild: so wird das Foto zugeschnitten */
  const mask = useMemo(() => {
    if (!framing || !frame || !box) return null;
    const k = Math.min(box.w / frame.w, box.h / frame.h);
    const vw = frame.w * k;
    const vh = frame.h * k;
    const ox = (box.w - vw) / 2;
    const oy = (box.h - vh) / 2;
    const c = framing.crop;
    return { left: ox + c.x * k, top: oy + c.y * k, width: c.w * k, height: c.h * k };
  }, [framing, frame, box]);
  const setRatioStored = (r: Ratio) => {
    setRatio(r);
    try {
      localStorage.setItem('camRatio', r);
    } catch {
      /* egal */
    }
  };
  const setOrientStored = (o: Orient) => {
    setOrient(o);
    try {
      localStorage.setItem('camOrient', o);
    } catch {
      /* egal */
    }
  };
  /** Symbole mitdrehen, damit sie in Handlage aufrecht stehen */
  const iconStyle = angle && !layoutLandscape ? { transform: `rotate(${angle}deg)` } : undefined;

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
      const fw = v.videoWidth || 1280;
      const fh = v.videoHeight || 960;
      const f = cameraFraming(fw, fh, ratio, orient, angle, layoutLandscape);
      const canvas = document.createElement('canvas');
      canvas.width = f.out.w;
      canvas.height = f.out.h;
      const g = canvas.getContext('2d')!;
      g.translate(canvas.width / 2, canvas.height / 2);
      if (f.rot) g.rotate((f.rot * Math.PI) / 180);
      // Ausschnitt des Sensorbilds mittig zeichnen (vor der Drehung w × h, danach passend zum Blatt)
      g.drawImage(v, f.crop.x, f.crop.y, f.crop.w, f.crop.h, -f.crop.w / 2, -f.crop.h / 2, f.crop.w, f.crop.h);
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

      <div className="cam-view" ref={viewRef}>
        <video
          ref={video}
          playsInline
          muted
          autoPlay
          className={facing === 'user' ? 'mirror' : undefined}
          onLoadedMetadata={(e) => setFrame({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })}
          onResize={(e) => setFrame({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })}
          data-testid="cam-video"
        />
        {mask && (
          <div className="cam-mask" aria-hidden="true" data-testid="cam-mask" data-rot={framing?.rot ?? 0}>
            <div style={{ left: 0, top: 0, right: 0, height: mask.top }} />
            <div style={{ left: 0, top: mask.top + mask.height, right: 0, bottom: 0 }} />
            <div style={{ left: 0, top: mask.top, width: mask.left, height: mask.height }} />
            <div style={{ left: mask.left + mask.width, top: mask.top, right: 0, height: mask.height }} />
            <span className="cam-mask-frame" style={mask} />
          </div>
        )}
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
          <button type="button" className="cam-icon" onClick={() => setFormatOpen(true)} aria-label="Format" title={`Format: ${ratio}, ${orient === 'auto' ? 'automatisch' : orient === 'portrait' ? 'hoch' : 'quer'}`} style={iconStyle} data-testid="cam-format">
            <Icon name="crop" size={22} />
          </button>
          <button type="button" className={`cam-icon${desc ? ' on' : ''}`} onClick={() => setDescOpen(true)} aria-label="Beschreibung für die nächsten Fotos" title="Beschreibung" style={iconStyle} data-testid="cam-desc">
            <Icon name="text" size={22} />
          </button>
          {torchOk && (
            <button type="button" className={`cam-icon${torch ? ' on' : ''}`} onClick={toggleTorch} aria-label="Blitz" title="Blitz" style={iconStyle} data-testid="cam-torch">
              <Icon name="flash" size={22} />
            </button>
          )}
          <button type="button" className={`cam-icon${facing === 'user' ? ' on' : ''}`} onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))} aria-label={facing === 'user' ? 'Zur Rückkamera' : 'Zur Frontkamera'} title={facing === 'user' ? 'Zur Rückkamera' : 'Zur Frontkamera'} style={iconStyle} data-testid="cam-flip">
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
      {formatOpen && (
        <div className="cam-sheet-backdrop" onClick={() => setFormatOpen(false)}>
          <div className="cam-sheet" onClick={(e) => e.stopPropagation()} data-testid="cam-format-sheet">
            <strong>Seitenverhältnis</strong>
            <div className="segmented" role="radiogroup" aria-label="Seitenverhältnis">
              {RATIOS.map((r) => (
                <button key={r} type="button" role="radio" aria-checked={ratio === r} aria-selected={ratio === r} onClick={() => setRatioStored(r)} data-testid={`cam-ratio-${r}`}>
                  {r}
                </button>
              ))}
            </div>
            <strong>Ausrichtung des Fotos</strong>
            <div className="segmented" role="radiogroup" aria-label="Ausrichtung">
              {(
                [
                  ['auto', 'Automatisch'],
                  ['portrait', 'Hoch'],
                  ['landscape', 'Quer'],
                ] as const
              ).map(([o, label]) => (
                <button key={o} type="button" role="radio" aria-checked={orient === o} aria-selected={orient === o} onClick={() => setOrientStored(o)} data-testid={`cam-orient-${o}`}>
                  {label}
                </button>
              ))}
            </div>
            <p className="muted small">
              Automatisch: Wird das Handy quer gehalten, wird das Foto quer gespeichert – auch bei eingeschalteter Ausrichtungssperre (Lagesensor).
              {angle !== null ? ` Erkannt: ${angle === 0 ? 'hochkant' : 'quer'}.` : ''}
            </p>
            <div className="row gap">
              <button type="button" className="btn btn-sm btn-primary" onClick={() => setFormatOpen(false)}>
                Fertig
              </button>
            </div>
          </div>
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
