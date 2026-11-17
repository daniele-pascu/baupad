import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { FlashIcon } from '../components/FlashIcon';
import { useCanCreateProjects } from '../lib/sites';
import { deviceUserName, PhotoCapture, photoFromPrepared } from '../components/PhotoCapture';
import { PhotoImg } from '../components/PhotoImg';
import { PhotoSiteDialog } from '../components/PhotoSitePicker';
import { showError, toast } from '../components/ui';
import { uuid } from '../lib/ids';
import { getPhotoStorage } from '../lib/photo-storage';
import { photoSiteKey, preparePhoto } from '../lib/photos';
import { paths } from '../lib/router';
import { isNativeApp, nativeTakePhoto } from '../lib/native';
import { useProjectIn } from '../lib/sites';
import type { Photo, PhotoSite } from '../lib/types';
import { loadPhotoSites } from './PhotosPage';
import { usePageTitle } from '../lib/page-title';
import { syncPhotoCloud, useCloudState } from '../lib/photo-cloud';
import { formatCrop, loadOrient, loadQuality, loadRatio, QUALITIES, qualityMax, RATIOS, ratioValue, saveOrient, saveQuality, saveRatio, type Orient, type Quality, type Ratio } from '../lib/camera-format';
import { backLenses, clampZoom, DIGITAL_MAX, DIGITAL_STOPS, fmtZoom, pinchZoom, zoomCrop, zoomStops, type HwZoom, type LensKind, type Lenses } from '../lib/camera-zoom';
import { FLASH_HINT, FLASH_LABEL, flashBeforeShot, loadFlash, nextFlash, saveFlash, setTorch as setTorchOn, type FlashMode } from '../lib/flash';

const LAST_SITE = 'photoLastSite';
const keyOf = (s: PhotoSite) => photoSiteKey({ projectId: s.projectId, siteName: s.name });

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
  const mayCreate = useCanCreateProjects();
  usePageTitle('Kamera – Fotos – BauPad');
  const [sites, setSites] = useState<PhotoSite[]>([]);
  const [site, setSite] = useState<PhotoSite | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [count, setCount] = useState(0);
  const [last, setLast] = useState<Photo | null>(null);
  const [user, setUser] = useState('');
  const [desc, setDesc] = useState('');
  const [descOpen, setDescOpen] = useState(false);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [, setTorch] = useState(false);
  const [torchOk, setTorchOk] = useState(false);
  /** Store-App: echte Kamera des Geräts statt Live-Bild */
  const native = isNativeApp();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const [busy, setBusy] = useState(false);
  const [siteOpen, setSiteOpen] = useState(false);
  const [siteQuery, setSiteQuery] = useState('');
  const [siteNew, setSiteNew] = useState(false);
  /** Kamera neu starten, wenn die App aus dem Hintergrund zurückkommt */
  const [tick, setTick] = useState(0);
  const [formatOpen, setFormatOpen] = useState(false);
  const [ratio, setRatio] = useState<Ratio>(loadRatio);
  const [orient, setOrient] = useState<Orient>(loadOrient);
  const [quality, setQuality] = useState<Quality>(loadQuality);
  /** Lage des Handys laut Sensor: 0 aufrecht, 90 Oberkante links, −90 Oberkante rechts; null = unbekannt */
  const [angle, setAngle] = useState<number | null>(null);
  const [layoutLandscape, setLayoutLandscape] = useState(() => matchMedia('(orientation: landscape)').matches);
  const [frame, setFrame] = useState<{ w: number; h: number } | null>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const motionAsked = useRef(false);
  const viewRef = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  // Zoom (lib/camera-zoom.ts): Objektive, Zoom der Kamera oder digital
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [lenses, setLenses] = useState<Lenses>({});
  const [lensNow, setLensNow] = useState<LensKind | null>(null);
  const [hwZoom, setHwZoom] = useState<HwZoom | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pinching, setPinching] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
  const hwPending = useRef<number | null>(null);
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
  // Merken, dass die Kamera offen war: die installierte App startet dann direkt wieder hier
  useEffect(() => {
    try {
      localStorage.setItem('resumeCamera', '1');
    } catch {
      /* egal */
    }
    return () => {
      try {
        localStorage.removeItem('resumeCamera');
      } catch {
        /* egal */
      }
    };
  }, []);
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
    if (native) {
      // Store-App: kein Live-Bild im Fenster – der Auslöser öffnet die Kamera des Geräts (volle Qualität)
      setReady(true);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Dieser Browser erlaubt keinen direkten Kamerazugriff.');
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: deviceId ? { deviceId: { exact: deviceId }, width: { ideal: 4096 }, height: { ideal: 3072 } } : { facingMode: facing, width: { ideal: 4096 }, height: { ideal: 3072 } }, audio: false })
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
        const caps = (track?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean; zoom?: { min: number; max: number; step?: number } };
        setTorchOk(!!caps.torch);
        // Zoom der Kamera (sonst digital); jedes Objektiv beginnt bei seinem Grundwert
        const z = caps.zoom && caps.zoom.max > caps.zoom.min ? { min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 0.1 } : null;
        setHwZoom(z);
        const set = (track?.getSettings?.() ?? {}) as MediaTrackSettings & { zoom?: number };
        setZoom(z ? clampZoom(set.zoom ?? 1, z.min, z.max) : 1);
        // Objektive der Rückseite (Namen gibt es erst nach der Erlaubnis)
        if (facing === 'environment')
          void navigator.mediaDevices
            .enumerateDevices?.()
            .then((list) => {
              if (cancelled) return;
              const found = backLenses(list);
              setLenses(found);
              const now = deviceId ?? set.deviceId; // gewähltes Objektiv, sonst das, was der Browser genommen hat
              setLensNow(found.ultra?.id === now ? 'ultra' : found.tele?.id === now ? 'tele' : found.wide ? 'wide' : null);
            })
            .catch(() => undefined);
        else {
          setLenses({});
          setLensNow(null);
        }
        setReady(true);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const name = e instanceof Error ? e.name : '';
        setError(name === 'NotAllowedError' ? 'Kamerazugriff wurde nicht erlaubt.' : name === 'NotFoundError' ? 'Keine Kamera gefunden.' : 'Kamera konnte nicht gestartet werden.');
      });
    const onVisibility = () => {
      if (document.hidden) stop();
      else setTick((t) => t + 1);
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', stop);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', stop);
      stop();
    };
  }, [facing, tick, deviceId]); // eslint-disable-line react-hooks/exhaustive-deps

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
    saveRatio(r);
  };
  const setOrientStored = (o: Orient) => {
    setOrient(o);
    saveOrient(o);
  };
  const setQualityStored = (q: Quality) => {
    setQuality(q);
    saveQuality(q);
  };
  /** Symbole mitdrehen, damit sie in Handlage aufrecht stehen */
  const iconStyle = angle && !layoutLandscape ? { transform: `rotate(${angle}deg)` } : undefined;

  // ---- Zoom ----
  const zMin = hwZoom ? hwZoom.min : 1;
  const zMax = hwZoom ? hwZoom.max : DIGITAL_MAX;
  /** digitaler Faktor (Ausschnitt) – 1, wenn die Kamera selbst zoomt */
  const digital = hwZoom ? 1 : zoom;
  const zoomTo = (z: number) => {
    const v = clampZoom(z, zMin, zMax);
    setZoom(v);
    if (!hwZoom) return;
    // Zoom der Kamera: höchstens einmal je Bild anfragen (beim Ziehen mit zwei Fingern)
    hwPending.current = v;
    requestAnimationFrame(() => {
      const want = hwPending.current;
      hwPending.current = null;
      const track = stream.current?.getVideoTracks()[0];
      if (want === null || !track) return;
      void track.applyConstraints({ advanced: [{ zoom: want } as MediaTrackConstraintSet] }).catch(() => undefined);
    });
  };
  const pickLens = (kind: 'ultra' | 'wide' | 'tele') => {
    const lens = lenses[kind];
    if (!lens) return;
    setZoom(1);
    if (kind === lensNow) {
      if (hwZoom) zoomTo(1);
      return;
    }
    setLensNow(kind);
    setDeviceId(lens.id);
  };
  const lensBase: Record<string, number | null> = { ultra: 0.5, wide: 1, tele: null };
  const lensLabel = (kind: 'ultra' | 'wide' | 'tele', active: boolean) => {
    const base = lensBase[kind];
    const z = active ? zoom : 1;
    if (base === null) return z === 1 ? 'Tele' : `Tele ${fmtZoom(z)}`;
    return fmtZoom(base * z);
  };
  /** Tasten: je Objektiv, sonst Stufen des Kamera-Zooms bzw. digital */
  const lensKinds = (['ultra', 'wide', 'tele'] as const).filter((k) => lenses[k]);
  const stops = hwZoom ? zoomStops(hwZoom.min, hwZoom.max) : DIGITAL_STOPS;
  const activeStop = stops.reduce((best, s) => (Math.abs(Math.log(s / zoom)) < Math.abs(Math.log(best / zoom)) ? s : best), stops[0]);
  const onPointerDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom };
      setPinching(true);
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!pinch.current || pointers.current.size < 2) return;
    const [a, b] = [...pointers.current.values()];
    zoomTo(pinchZoom(pinch.current.zoom, pinch.current.dist, Math.hypot(a.x - b.x, a.y - b.y), zMin, zMax));
  };
  const onPointerEnd = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) {
      pinch.current = null;
      setPinching(false);
    }
  };

  // Blitz Aus / Auto / An (gemerkt): An = Lampe dauerhaft, Auto = bei Dunkelheit kurz beim Auslösen
  const [flashMode, setFlashMode] = useState<FlashMode>(loadFlash);
  useEffect(() => {
    if (!torchOk) return;
    const on = flashMode === 'on';
    void setTorchOn(stream.current?.getVideoTracks()[0], on).then((ok) => ok && setTorch(on));
  }, [flashMode, torchOk]);
  const toggleTorch = () => {
    if (!torchOk) return toast(FLASH_HINT, 'info');
    const next = nextFlash(flashMode);
    setFlashMode(next);
    saveFlash(next);
  };

  /** Store-App: echte Kamera des Geräts, Foto wird wie ein Galeriebild gespeichert (Aufnahmezeit aus den Bilddaten) */
  const shootNative = async () => {
    if (busy) return;
    if (!site) {
      toast('Bitte zuerst die Baustelle wählen.', 'info');
      return;
    }
    setBusy(true);
    try {
      const file = await nativeTakePhoto();
      if (!file) return;
      // Foto der Gerätekamera: auf Seitenverhältnis/Ausrichtung zuschneiden (Mitte) und auf die Auflösung verkleinern
      const pr = await preparePhoto(file, Date.now(), { max: qualityMax(quality), crop: (w, h) => formatCrop(w, h, ratio, orient) });
      const photo = photoFromPrepared(uuid(), file, pr, site, user, desc);
      const saved = await getPhotoStorage().put(photo, { data: pr.data, thumb: pr.thumb });
      await useProjectIn(site.projectId, 'photos');
      setPhotos((p) => [...p, saved]);
      setLast(saved);
      setCount((n) => n + 1);
    } catch (e) {
      showError(e, 'Foto konnte nicht gespeichert werden');
    } finally {
      setBusy(false);
    }
  };

  const shoot = async () => {
    if (native) return shootNative();
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
      const off = await flashBeforeShot(flashMode, stream.current?.getVideoTracks()[0], v);
      const fw = v.videoWidth || 1280;
      const fh = v.videoHeight || 960;
      const f0 = cameraFraming(fw, fh, ratio, orient, angle, layoutLandscape);
      // digitaler Zoom: kleinerer Ausschnitt um die Mitte, in seiner echten Auflösung (kein Hochrechnen)
      const f = digital > 1 ? { ...f0, crop: zoomCrop(f0.crop, digital), out: { w: Math.round(f0.out.w / digital), h: Math.round(f0.out.h / digital) } } : f0;
      const canvas = document.createElement('canvas');
      canvas.width = f.out.w;
      canvas.height = f.out.h;
      const g = canvas.getContext('2d')!;
      g.translate(canvas.width / 2, canvas.height / 2);
      if (f.rot) g.rotate((f.rot * Math.PI) / 180);
      // Ausschnitt des Sensorbilds mittig zeichnen (vor der Drehung w × h, danach passend zum Blatt)
      g.drawImage(v, f.crop.x, f.crop.y, f.crop.w, f.crop.h, -f.crop.w / 2, -f.crop.h / 2, f.crop.w, f.crop.h);
      off();
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.92));
      if (!blob) throw new Error('Bild konnte nicht aufgenommen werden.');
      const now = new Date();
      const stamp = now.toISOString().replace(/[-:]/g, '').slice(0, 15);
      const file = new File([blob], `BauPad_${stamp}.jpg`, { type: 'image/jpeg', lastModified: now.getTime() });
      const pr = await preparePhoto(file, now.getTime(), { max: qualityMax(quality) });
      const photo = photoFromPrepared(uuid(), file, { ...pr, takenAt: now.getTime(), takenFrom: 'now' }, site, user, desc);
      const saved = await getPhotoStorage().put(photo, { data: pr.data, thumb: pr.thumb });
      await useProjectIn(site.projectId, 'photos');
      setPhotos((p) => [...p, saved]);
      setLast(saved);
      setCount((n) => n + 1);
    } catch (e) {
      showError(e, 'Foto konnte nicht gespeichert werden');
    } finally {
      setBusy(false);
    }
  };

  // Sichtbare Höhe (ohne Bildschirmtastatur) als CSS-Variable – iPhone schiebt sonst das Fenster hinter die Tastatur
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv || !(siteOpen || descOpen)) return;
    const apply = () => document.documentElement.style.setProperty('--vv-h', `${Math.round(vv.height)}px`);
    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
      document.documentElement.style.removeProperty('--vv-h');
    };
  }, [siteOpen, descOpen]);
  /** Baustellen für das Suchfenster: zuletzt fotografierte zuerst, mit Anzahl Fotos */
  const siteRows = useMemo(() => {
    const stats = new Map<string, { n: number; last: number }>();
    for (const p of photos) {
      const k = photoSiteKey(p);
      const st = stats.get(k) ?? { n: 0, last: 0 };
      st.n++;
      st.last = Math.max(st.last, p.uploadedAt);
      stats.set(k, st);
    }
    const q = siteQuery.trim().toLowerCase();
    return sites
      .map((x) => ({ site: x, key: keyOf(x), n: stats.get(keyOf(x))?.n ?? 0, last: stats.get(keyOf(x))?.last ?? 0 }))
      .filter((r) => !q || [r.site.name, r.site.number, r.site.address, r.site.costCenter ?? '', r.site.ccSearch ?? '', r.site.client ?? ''].some((t) => t.toLowerCase().includes(q)))
      .sort((a, b) => b.last - a.last || a.site.name.localeCompare(b.site.name, 'de'));
  }, [sites, photos, siteQuery]);
  const siteKeyNow = site ? keyOf(site) : null;
  const back = siteKeyNow ? paths.photoSite(siteKeyNow) : paths.photos();

  return (
    <div className="cam" data-testid="camera-page" data-ready={ready || undefined}>
      <header className="cam-top">
        <a className="cam-icon" href={back} aria-label="Kamera schließen" title="Kamera schließen" data-testid="cam-close">
          <Icon name="close" size={24} />
        </a>
        <button type="button" className="cam-site" onClick={() => setSiteOpen(true)} data-testid="cam-site" data-site={site?.name ?? ''}>
          <span className="cam-site-name">
            {site ? site.name : 'Baustelle wählen'} <Icon name="next" size={14} className="cam-site-caret" />
          </span>
          <span className="cam-site-sub">{site ? [site.number, site.costCenter ? `KST ${site.costCenter}` : '', site.address].filter(Boolean).join(' · ') || 'Baustelle' : 'Antippen und suchen'}</span>
        </button>
        <CamUpload />
      </header>

      <div className={`cam-view${pinching ? ' pinching' : ''}`} ref={viewRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd} onPointerLeave={onPointerEnd} data-zoom={zoom} data-zoom-mode={native ? 'native' : lensKinds.length ? 'lens' : hwZoom ? 'camera' : 'digital'}>
        <video
          ref={video}
          playsInline
          muted
          autoPlay
          className={facing === 'user' ? 'mirror' : undefined}
          style={digital !== 1 ? { transform: `${facing === 'user' ? 'scaleX(-1) ' : ''}scale(${digital})` } : undefined}
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
        {native && !error && (
          <div className="cam-error cam-native" data-testid="cam-native-hint">
            <p>
              <strong>Auslöser antippen</strong> – die Kamera deines Geräts öffnet sich und das Foto wird in voller Qualität gespeichert.
            </p>
            {count > 0 && <p className="small">{count} {count === 1 ? 'Foto' : 'Fotos'} in dieser Sitzung aufgenommen.</p>}
          </div>
        )}
        {error && (
          <div className="cam-error" data-testid="cam-error">
            <p>{error}</p>
            <p className="small">Du kannst die Kamera-App des Geräts verwenden – das Foto wird genauso gespeichert.</p>
          </div>
        )}
        {!native && ready && !error && (
          <div className="cam-zoom" role="group" aria-label="Zoom" data-testid="cam-zoom">
            {lensKinds.length
              ? lensKinds.map((k) => {
                  const active = lensNow === k;
                  return (
                    <button key={k} type="button" className={active ? 'on' : undefined} aria-pressed={active} onClick={() => pickLens(k)} aria-label={k === 'ultra' ? 'Ultraweitwinkel' : k === 'tele' ? 'Tele-Objektiv' : 'Normales Objektiv'} data-testid={`cam-lens-${k}`}>
                      {lensLabel(k, active)}
                    </button>
                  );
                })
              : stops.map((v) => {
                  const active = v === activeStop;
                  return (
                    <button key={v} type="button" className={active ? 'on' : undefined} aria-pressed={active} onClick={() => zoomTo(v)} aria-label={`Zoom ${fmtZoom(v)}${hwZoom ? '' : ' (digital)'}`} data-testid={`cam-zoom-${v}`}>
                      {active ? fmtZoom(zoom) : fmtZoom(v)}
                    </button>
                  );
                })}
          </div>
        )}
        {desc && (
          <button type="button" className="cam-desc-chip" onClick={() => setDescOpen(true)} data-testid="cam-desc-chip">
            <Icon name="text" size={14} /> {desc}
          </button>
        )}
        <div className="cam-side">
          <button type="button" className="cam-icon" onClick={() => setFormatOpen(true)} aria-label="Format und Auflösung" title={`Format: ${ratio}, ${orient === 'auto' ? 'automatisch' : orient === 'portrait' ? 'hoch' : 'quer'}, Auflösung ${QUALITIES.find((q) => q.id === quality)?.label}`} style={iconStyle} data-testid="cam-format">
            <Icon name="crop" size={22} />
          </button>
          <button type="button" className={`cam-icon${desc ? ' on' : ''}`} onClick={() => setDescOpen(true)} aria-label="Beschreibung für die nächsten Fotos" title="Beschreibung" style={iconStyle} data-testid="cam-desc">
            <Icon name="text" size={22} />
          </button>
          {!native && (
            <button type="button" className={`cam-icon${torchOk && flashMode !== 'off' ? ' on' : ''}`} onClick={toggleTorch} aria-label={`Blitz: ${FLASH_LABEL[torchOk ? flashMode : 'off']}`} title="Blitz: Aus / Auto / An" style={iconStyle} data-testid="cam-torch" data-mode={torchOk ? flashMode : 'off'}>
              <FlashIcon mode={torchOk ? flashMode : 'off'} size={22} />
            </button>
          )}
          {!native && (
          <button type="button" className={`cam-icon${facing === 'user' ? ' on' : ''}`} onClick={() => {
              setDeviceId(null);
              setZoom(1);
              setFacing((f) => (f === 'environment' ? 'user' : 'environment'));
            }} aria-label={facing === 'user' ? 'Zur Rückkamera' : 'Zur Frontkamera'} title={facing === 'user' ? 'Zur Rückkamera' : 'Zur Frontkamera'} style={iconStyle} data-testid="cam-flip">
            <Icon name="flip" size={22} />
          </button>
          )}
        </div>
      </div>

      <footer className="cam-bottom">
        {last ? (
          <a className="cam-last" href={paths.photoSite(keyOf(site!), { photoId: last.id })} aria-label="Letztes Foto ansehen" data-testid="cam-last">
            <PhotoImg id={last.id} />
            {count > 0 && (
              <span className="cam-last-count" aria-label={`${count} ${count === 1 ? 'Foto' : 'Fotos'} in dieser Sitzung`} data-testid="cam-counter">
                {count}
              </span>
            )}
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

      {siteOpen && (
        <div className="cam-sheet-backdrop top" onClick={() => setSiteOpen(false)}>
          <div className="cam-sheet cam-site-sheet" role="dialog" aria-modal="true" aria-label="Baustelle wählen" onClick={(e) => e.stopPropagation()} data-testid="cam-site-sheet">
            <strong>Baustelle wählen</strong>
            <input type="search" value={siteQuery} onChange={(e) => setSiteQuery(e.target.value)} placeholder="Name, Nummer, Kostenstelle oder Adresse suchen" autoFocus data-testid="cam-site-search" />
            <ul className="cam-site-list">
              {siteRows.map((r) => (
                <li key={r.key}>
                  <button
                    type="button"
                    className={r.key === siteKeyNow ? 'on' : undefined}
                    onClick={() => {
                      chooseSite(r.site);
                      setSiteOpen(false);
                      setSiteQuery('');
                    }}
                    data-testid="cam-site-row"
                    data-site={r.site.name}
                  >
                    <span className="cam-site-row-main">
                      <strong>{r.site.name}</strong>
                      <span>{[r.site.number, r.site.costCenter ? `KST ${r.site.costCenter}` : '', r.site.address].filter(Boolean).join(' · ') || (r.site.projectId ? 'Projekt' : 'Baustelle')}</span>
                    </span>
                    <span className="cam-site-row-n">{r.n > 0 ? `${r.n} Fotos` : ''}</span>
                    {r.key === siteKeyNow && <Icon name="check" size={18} />}
                  </button>
                </li>
              ))}
              {siteRows.length === 0 && <li className="muted small cam-site-empty">Keine Baustelle gefunden.</li>}
            </ul>
            <div className="row gap">
              {mayCreate && (
              <button type="button" className="btn btn-sm" onClick={() => setSiteNew(true)} data-testid="cam-site-new">
                <Icon name="plus" size={16} /> Neues Projekt
              </button>
              )}
              <span className="spacer" />
              <button type="button" className="btn btn-sm" onClick={() => setSiteOpen(false)}>
                Schließen
              </button>
            </div>
          </div>
        </div>
      )}
      {siteNew && (
        <PhotoSiteDialog
          onClose={() => setSiteNew(false)}
          onSaved={(s) => {
            setSiteNew(false);
            setSites((l) => [...l, s]);
            chooseSite(s);
            setSiteOpen(false);
          }}
        />
      )}
      {descOpen && (
        <div className="cam-sheet-backdrop top" onClick={() => setDescOpen(false)}>
          <form
            className="cam-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Beschreibung"
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
          <div className="cam-sheet" role="dialog" aria-modal="true" aria-label="Format und Auflösung" onClick={(e) => e.stopPropagation()} data-testid="cam-format-sheet">
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
              {native
                ? 'Automatisch: so, wie das Foto mit der Kamera des Geräts aufgenommen wird. Hoch bzw. Quer schneidet es passend aus der Mitte zu.'
                : `Automatisch: Wird das Handy quer gehalten, wird das Foto quer gespeichert – auch bei eingeschalteter Ausrichtungssperre (Lagesensor).${angle !== null ? ` Erkannt: ${angle === 0 ? 'hochkant' : 'quer'}.` : ''}`}
            </p>
            <strong>Auflösung</strong>
            <div className="segmented" role="radiogroup" aria-label="Auflösung">
              {QUALITIES.map((q) => (
                <button key={q.id} type="button" role="radio" aria-checked={quality === q.id} aria-selected={quality === q.id} onClick={() => setQualityStored(q.id)} data-testid={`cam-quality-${q.id}`}>
                  {q.label}
                </button>
              ))}
            </div>
            <p className="muted small" data-testid="cam-quality-hint">
              {QUALITIES.find((q) => q.id === quality)?.hint}
            </p>
            <div className="row gap">
              <button type="button" className="btn btn-sm btn-primary" onClick={() => setFormatOpen(false)}>
                Fertig
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Oben rechts: wie viele Fotos noch auf die Übertragung in die Ablage warten (ohne Empfang bleiben sie auf dem Gerät
 * und gehen von selbst hoch). Antippen: Hinweis und sofort erneut versuchen. Ohne Ablage (nur Gerät) ein leerer Platz,
 * damit die Baustelle in der Mitte bleibt.
 */
function CamUpload() {
  const cloud = useCloudState();
  const [online, setOnline] = useState(typeof navigator === 'undefined' || navigator.onLine !== false);
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
  if (cloud.status === 'off' || cloud.status === 'setup') return <span className="cam-icon cam-upload-space" aria-hidden="true" />;
  const n = cloud.pending;
  const waiting = n > 0 && (!online || cloud.status === 'error');
  const label = n === 0 ? 'Alle Fotos sind übertragen' : `${n} ${n === 1 ? 'Foto wartet' : 'Fotos warten'} auf die Übertragung${waiting ? ' – kein Empfang' : ''}`;
  const tap = () => {
    if (n === 0) {
      toast('Alle Fotos sind in der Ablage.', 'success');
      return;
    }
    toast(online ? `${n} ${n === 1 ? 'Foto wird' : 'Fotos werden'} übertragen …` : `${n} ${n === 1 ? 'Foto bleibt' : 'Fotos bleiben'} auf dem Gerät und ${n === 1 ? 'geht' : 'gehen'} von selbst hoch, sobald wieder Empfang da ist.`);
    if (online) void syncPhotoCloud().catch(() => {});
  };
  return (
    <button
      type="button"
      className={`cam-icon cam-upload${n === 0 ? ' done' : ''}${waiting ? ' waiting' : ''}${n > 0 && cloud.busy ? ' busy' : ''}`}
      onClick={tap}
      aria-label={label}
      title={label}
      data-testid="cam-upload"
      data-pending={n}
    >
      <Icon name={n === 0 ? 'check' : waiting ? 'wifiOff' : 'upload'} size={20} />
      {n > 0 && <span className="cam-upload-n">{n}</span>}
    </button>
  );
}
