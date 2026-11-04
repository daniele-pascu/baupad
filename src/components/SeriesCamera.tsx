import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { deviceUserName, photoFromPrepared } from './PhotoCapture';
import { showError, toast } from './ui';
import { uuid } from '../lib/ids';
import { isNativeApp, nativeTakePhoto } from '../lib/native';
import { getPhotoStorage } from '../lib/photo-storage';
import { preparePhoto } from '../lib/photos';
import { FLASH_HINT, FLASH_LABEL, flashBeforeShot, loadFlash, nextFlash, saveFlash, setTorch, torchSupported, type FlashMode } from '../lib/flash';
import { useProjectIn } from '../lib/sites';
import type { Photo, PhotoSite } from '../lib/types';

/**
 * Serienaufnahme zu einer Messung: Foto machen, noch eins, … – der Haken speichert alle Fotos auf einmal
 * (Fotodokumentation der Baustelle, mit Vermerk), ohne weiteren Dialog. Ohne Live-Bild (Store-App bzw.
 * Browser ohne Kamerazugriff) öffnet der Auslöser jedes Mal die Kamera des Geräts.
 */
export function SeriesCamera({ site, description, onDone, onClose }: { site: PhotoSite; description: string; onDone(saved: Photo[]): void; onClose(): void }) {
  const video = useRef<HTMLVideoElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [live, setLive] = useState<boolean | null>(isNativeApp() ? false : null);
  const [shots, setShots] = useState<{ file: File; url: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(false);
  const [mode, setMode] = useState<FlashMode>(loadFlash);
  const track = useRef<MediaStreamTrack | null>(null);
  const [torchOk, setTorchOk] = useState(false);

  useEffect(() => {
    if (isNativeApp()) return;
    let stream: MediaStream | null = null;
    let cancelled = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      setLive(false);
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment', width: { ideal: 4096 }, height: { ideal: 3072 } }, audio: false })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        track.current = s.getVideoTracks()[0] ?? null;
        setTorchOk(torchSupported(track.current));
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play().catch(() => undefined);
        }
        setLive(true);
      })
      .catch(() => !cancelled && setLive(false));
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  // Blitz „An“: Lampe dauerhaft an (auch fürs Vorschaubild), sonst aus
  useEffect(() => {
    if (live && torchOk) void setTorch(track.current, mode === 'on');
  }, [mode, live, torchOk]);
  const cycleFlash = () => {
    if (!torchOk) return toast(FLASH_HINT, 'info');
    const next = nextFlash(mode);
    setMode(next);
    saveFlash(next);
  };
  // Vorschaubilder freigeben
  useEffect(() => () => shots.forEach((s) => URL.revokeObjectURL(s.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const add = (files: File[]) => setShots((l) => [...l, ...files.map((file) => ({ file, url: URL.createObjectURL(file) }))]);

  const shoot = async () => {
    if (busy) return;
    if (isNativeApp()) {
      try {
        const f = await nativeTakePhoto();
        if (f) add([f]);
      } catch (e) {
        showError(e, 'Kamera konnte nicht geöffnet werden');
      }
      return;
    }
    const v = video.current;
    if (!live || !v) return input.current?.click();
    const off = await flashBeforeShot(mode, track.current, v);
    setFlash(true);
    window.setTimeout(() => setFlash(false), 150);
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth || 1280;
    canvas.height = v.videoHeight || 960;
    canvas.getContext('2d')!.drawImage(v, 0, 0, canvas.width, canvas.height);
    off();
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.92));
    if (!blob) return;
    const now = new Date();
    add([new File([blob], `BauPad_${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}_${shots.length + 1}.jpg`, { type: 'image/jpeg', lastModified: now.getTime() })]);
  };

  const done = async () => {
    if (!shots.length) return onClose();
    setBusy(true);
    try {
      const user = await deviceUserName();
      const storage = getPhotoStorage();
      const saved: Photo[] = [];
      for (const s of shots) {
        const pr = await preparePhoto(s.file);
        const live = s.file.name.startsWith('BauPad_');
        const photo = photoFromPrepared(uuid(), s.file, live ? { ...pr, takenAt: s.file.lastModified, takenFrom: 'now' } : pr, site, user, description);
        saved.push(await storage.put(photo, { data: pr.data, thumb: pr.thumb }));
      }
      await useProjectIn(site.projectId, 'photos').catch(() => undefined);
      toast(`${saved.length} ${saved.length === 1 ? 'Foto' : 'Fotos'} gespeichert`, 'success');
      onDone(saved);
    } catch (e) {
      showError(e, 'Fotos konnten nicht gespeichert werden');
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="series-cam" data-testid="series-camera" data-live={live === null ? 'wait' : live ? '1' : '0'}>
      <div className="series-cam-top">
        <button type="button" className="cam-icon" onClick={onClose} aria-label="Abbrechen" data-testid="series-cancel">
          <Icon name="close" size={24} />
        </button>
        <span className="series-cam-title">{description}</span>
        {live && (
          <>
            <button type="button" className={`series-cam-flashbtn${mode !== 'off' && torchOk ? ' on' : ''}`} onClick={cycleFlash} aria-label={`Blitz: ${FLASH_LABEL[mode]}`} title="Blitz: Aus / Auto / An" data-testid="series-flash" data-mode={mode}>
              <Icon name="flash" size={20} />
              <span>{torchOk ? FLASH_LABEL[mode] : '–'}</span>
            </button>
            <button type="button" className="series-cam-flashbtn" onClick={() => input.current?.click()} title="Kamera des Geräts öffnen (eigener Blitz Auto/An/Aus)" data-testid="series-device-camera">
              <Icon name="camera" size={20} />
              <span>Gerätekamera</span>
            </button>
          </>
        )}
      </div>
      <div className="series-cam-view">
        {live !== false && <video ref={video} playsInline muted autoPlay />}
        {live === false && <p className="series-cam-hint">Auslöser tippen – die Kamera des Geräts öffnet sich. Nach jedem Foto „Foto verwenden“, am Ende den Haken. Den Blitz (Auto/An/Aus) stellst du dort in der Kamera des Geräts ein.</p>}
        {flash && <div className="series-cam-flash" />}
      </div>
      {shots.length > 0 && (
        <div className="series-cam-strip" data-testid="series-shots">
          {shots.map((s, i) => (
            <span key={s.url} className="series-cam-thumb">
              <img src={s.url} alt={`Foto ${i + 1}`} />
              <button type="button" onClick={() => setShots((l) => l.filter((x) => x !== s))} aria-label="Foto verwerfen">
                <Icon name="close" size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="series-cam-bar">
        <span className="series-cam-count" data-testid="series-count">
          {shots.length} {shots.length === 1 ? 'Foto' : 'Fotos'}
        </span>
        <button type="button" className="cam-shutter" onClick={() => void shoot()} disabled={busy || live === null} aria-label="Foto aufnehmen" data-testid="series-shutter" />
        <button type="button" className="series-cam-done" onClick={() => void done()} disabled={busy} aria-label="Fertig – Fotos speichern" data-testid="series-done">
          <Icon name="check" size={30} />
        </button>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          add(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
        data-testid="series-input"
      />
    </div>,
    document.body,
  );
}
