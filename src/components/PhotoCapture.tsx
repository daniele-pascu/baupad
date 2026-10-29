import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getMeta, setMeta } from '../lib/db';
import { uuid } from '../lib/ids';
import { getPhotoStorage } from '../lib/photo-storage';
import { isInstalledApp } from '../lib/platform';
import { paths } from '../lib/router';
import { dayAndWeek, fmtBytes, photoSiteKey, preparePhoto, type PreparedPhoto } from '../lib/photos';
import type { Photo, PhotoSite } from '../lib/types';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { PhotoSitePicker } from './PhotoSitePicker';
import { showError, toast } from './ui';

export type { PhotoSite };

/** Foto-Datensatz aus einem vorbereiteten Bild (gemeinsam für Speichern-Dialog und Kamera-Modus) */
export function photoFromPrepared(id: string, file: File, pr: PreparedPhoto, site: PhotoSite, user: string, description: string): Photo {
  const now = Date.now();
  return {
    id,
    companyId: null,
    projectId: site.projectId,
    siteName: site.name,
    siteNumber: site.number,
    siteAddress: site.address,
    takenAt: pr.takenAt,
    ...dayAndWeek(pr.takenAt),
    takenFrom: pr.takenFrom,
    uploadedAt: now,
    userName: user,
    description: description.trim(),
    fileName: file.name,
    width: pr.width,
    height: pr.height,
    size: pr.data.byteLength,
    hash: pr.hash,
    original: false,
    sync: 'local',
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** Name auf diesem Gerät – bis zur Anmeldung (dann kommt der Name aus der Sitzung) */
export async function deviceUserName(): Promise<string> {
  return (await getMeta<string>('deviceUser')) ?? '';
}

interface Pending {
  id: string;
  file: File;
  prepared: PreparedPhoto | null;
  error: string | null;
  url: string;
  description: string;
  duplicate: boolean;
}

/**
 * Fotos aufnehmen bzw. auswählen: Knopf „Foto aufnehmen“ (Kamera) und „Aus Galerie“; vor dem Speichern
 * Baustelle, Aufnahmezeit und Beschreibung prüfen; dann über die Speicher-Schnittstelle ablegen.
 */
export function PhotoCapture({
  sites,
  site,
  existingHashes,
  onSaved,
  big = false,
  render,
}: {
  sites: PhotoSite[];
  /** vorgewählte Baustelle (Baustellenseite) */
  site?: PhotoSite;
  existingHashes: Set<string>;
  onSaved(photos: Photo[]): void;
  big?: boolean;
  /** eigene Knöpfe statt der Standardknöpfe (z. B. im Kamera-Modus): `camera` öffnet die Gerätekamera, `library` die Galerie */
  render?: (open: { camera(): void; library(): void }) => ReactNode;
}) {
  const cam = useRef<HTMLInputElement>(null);
  const lib = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending[] | null>(null);
  const [chosen, setChosen] = useState<PhotoSite | null>(site ?? null);
  /** im Dialog neu angelegte Baustellen (bis die Liste neu geladen ist) */
  const [extra, setExtra] = useState<PhotoSite[]>([]);
  const allSites = [...sites, ...extra.filter((e) => !sites.some((s) => s.projectId === e.projectId && s.name === e.name))];
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void deviceUserName().then(setName);
  }, []);
  useEffect(() => () => pending?.forEach((p) => URL.revokeObjectURL(p.url)), [pending]);

  const pick = async (files: FileList | null) => {
    if (!files?.length) return;
    const list: Pending[] = [...files].map((file) => ({ id: uuid(), file, prepared: null, error: null, url: URL.createObjectURL(file), description: '', duplicate: false }));
    setPending(list);
    setChosen(site ?? (sites.length === 1 ? sites[0] : null));
    const seen = new Set<string>();
    for (const p of list) {
      try {
        const prepared = await preparePhoto(p.file);
        const duplicate = existingHashes.has(prepared.hash) || seen.has(prepared.hash);
        seen.add(prepared.hash);
        setPending((cur) => cur?.map((x) => (x.id === p.id ? { ...x, prepared, duplicate } : x)) ?? null);
      } catch (e) {
        setPending((cur) => cur?.map((x) => (x.id === p.id ? { ...x, error: e instanceof Error ? e.message : String(e) } : x)) ?? null);
      }
    }
  };

  const save = async () => {
    if (!pending || !chosen) return;
    const ready = pending.filter((p) => p.prepared && !p.duplicate);
    if (!ready.length) return;
    setBusy(true);
    try {
      const user = name.trim();
      if (user !== (await deviceUserName())) await setMeta('deviceUser', user);
      const storage = getPhotoStorage();
      const saved: Photo[] = [];
      for (const p of ready) {
        const pr = p.prepared!;
        const photo = photoFromPrepared(p.id, p.file, pr, chosen, user, p.description);
        saved.push(await storage.put(photo, { data: pr.data, thumb: pr.thumb }));
      }
      setPending(null);
      toast(`${saved.length} ${saved.length === 1 ? 'Foto' : 'Fotos'} gespeichert – ${chosen.name}.`, 'success');
      onSaved(saved);
    } catch (e) {
      showError(e, 'Fotos konnten nicht gespeichert werden');
    } finally {
      setBusy(false);
    }
  };

  const readyCount = pending?.filter((p) => p.prepared && !p.duplicate).length ?? 0;
  const working = pending?.some((p) => !p.prepared && !p.error) ?? false;

  return (
    <>
      <div className={`photo-capture${big ? ' big' : ''}${render ? ' custom' : ''}`}>
        {render ? (
          render({ camera: () => cam.current?.click(), library: () => lib.current?.click() })
        ) : (
          <>
            {/* Kamera-Modus nur in der installierten App; im Browser (PC) reicht die Dateiauswahl */}
            {isInstalledApp() && (
              <a className="btn btn-primary photo-shoot" href={paths.camera(site ? photoSiteKey({ projectId: site.projectId, siteName: site.name }) : null)} data-testid="photo-shoot">
                <Icon name="camera" size={big ? 26 : 20} /> Foto aufnehmen
              </a>
            )}
            <button type="button" className={`btn photo-pick${isInstalledApp() ? '' : ' btn-primary photo-pick-only'}`} onClick={() => lib.current?.click()} aria-label="Fotos auswählen" title="Fotos aus Galerie oder Datei auswählen" data-testid="photo-pick">
              <Icon name="upload" size={18} /> <span className={isInstalledApp() ? 'lbl' : undefined}>{isInstalledApp() ? 'Aus Galerie / Datei' : 'Fotos auswählen'}</span>
            </button>
          </>
        )}
        <input ref={cam} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => void pick(e.target.files).finally(() => (e.target.value = ''))} data-testid="photo-camera-input" />
        <input ref={lib} type="file" accept="image/*" multiple hidden onChange={(e) => void pick(e.target.files).finally(() => (e.target.value = ''))} data-testid="photo-file-input" />
      </div>
      {pending && (
        <Modal
          title={`${pending.length} ${pending.length === 1 ? 'Foto' : 'Fotos'} speichern`}
          onClose={() => !busy && setPending(null)}
          testId="photo-save-dialog"
          persistent
          footer={
            <>
              <button type="button" className="btn" onClick={() => setPending(null)} disabled={busy}>
                Abbrechen
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy || working || !chosen || !readyCount} data-testid="photo-save">
                {busy ? 'Wird gespeichert …' : `${readyCount} speichern`}
              </button>
            </>
          }
        >
          <label className="field">
            <span>Baustelle *</span>
            <PhotoSitePicker sites={allSites} value={chosen} onChange={setChosen} onCreated={(s) => setExtra((x) => [...x, s])} />
          </label>
          <label className="field">
            <span>Aufgenommen von</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ihr Name (bis zur Anmeldung auf diesem Gerät gespeichert)" autoComplete="name" data-testid="photo-user" />
          </label>
          <ul className="photo-pending" data-testid="photo-pending">
            {pending.map((p) => (
              <li key={p.id} className={p.duplicate || p.error ? 'skip' : ''} data-testid="photo-pending-item">
                <img src={p.url} alt="" />
                <div className="photo-pending-info">
                  <strong>{p.file.name}</strong>
                  {p.error ? (
                    <span className="error small">{p.error}</span>
                  ) : !p.prepared ? (
                    <span className="muted small">wird vorbereitet …</span>
                  ) : p.duplicate ? (
                    <span className="warn-text small" data-testid="photo-duplicate">
                      schon vorhanden – wird übersprungen
                    </span>
                  ) : (
                    <>
                      <span className="muted small">
                        {new Date(p.prepared.takenAt).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        {p.prepared.takenFrom === 'exif' ? ' (aus dem Foto)' : p.prepared.takenFrom === 'file' ? ' (Dateidatum)' : ' (jetzt)'} · {p.prepared.width} × {p.prepared.height} · {fmtBytes(p.prepared.data.byteLength)}
                      </span>
                      <input
                        value={p.description}
                        onChange={(e) => setPending((cur) => cur?.map((x) => (x.id === p.id ? { ...x, description: e.target.value } : x)) ?? null)}
                        placeholder="Beschreibung (optional)"
                        aria-label="Beschreibung"
                        data-testid="photo-pending-description"
                      />
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </>
  );
}
