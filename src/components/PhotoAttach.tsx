import { useEffect, useMemo, useState } from 'react';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { PhotoCapture } from './PhotoCapture';
import { PhotoImg } from './PhotoImg';
import { PhotoViewer } from './PhotoViewer';
import { getPhotoStorage } from '../lib/photo-storage';
import { photoSiteKey } from '../lib/photos';
import type { Photo, PhotoSite } from '../lib/types';

/** Fotos der Baustelle aus der Fotodokumentation auswählen */
export function SitePhotosPicker({ photos, chosen, onClose, onDone }: { photos: Photo[]; chosen: string[]; onClose(): void; onDone(ids: string[]): void }) {
  const [sel, setSel] = useState<Set<string>>(new Set(chosen));
  const toggle = (id: string) => setSel((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  return (
    <Modal
      title="Fotos aus der Fotodokumentation"
      onClose={onClose}
      wide
      testId="dp-photo-picker"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onDone([...sel])} data-testid="dp-photo-picker-done">
            {sel.size} übernehmen
          </button>
        </>
      }
    >
      {photos.length === 0 ? (
        <p className="muted">Noch keine Fotos auf dieser Baustelle.</p>
      ) : (
        <div className="dp-photo-grid">
          {photos.map((p) => (
            <button key={p.id} type="button" className={`dp-photo-pick${sel.has(p.id) ? ' on' : ''}`} onClick={() => toggle(p.id)} aria-pressed={sel.has(p.id)} data-testid="dp-photo-pick">
              <PhotoImg id={p.id} />
              <span className="small">{new Date(p.takenAt).toLocaleDateString('de-DE')}</span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

/**
 * Fotos zu einem Eintrag (Messung im Aufmaß): aufnehmen, aus der Galerie oder aus der Fotodokumentation
 * der Baustelle wählen; neue Fotos landen auch in der Fotodokumentation. Antippen = groß ansehen.
 */
export function PhotoAttach({ site, ids, onChange, hint }: { site: PhotoSite; ids: string[]; onChange(ids: string[]): void; hint?: string }) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [picking, setPicking] = useState(false);
  const [view, setView] = useState<number | null>(null);
  const reload = () => getPhotoStorage().list().then(setPhotos).catch(() => {});
  useEffect(() => {
    void reload();
  }, []);
  const key = photoSiteKey({ projectId: site.projectId, siteName: site.name });
  const sitePhotos = useMemo(() => photos.filter((p) => !p.deletedAt && photoSiteKey(p) === key), [photos, key]);
  const hashes = useMemo(() => new Set(photos.map((p) => p.hash)), [photos]);
  const linked = ids.map((id) => photos.find((p) => p.id === id && !p.deletedAt)).filter((p): p is Photo => !!p);
  return (
    <div className="field" data-testid="photo-attach">
      <span>Fotos ({linked.length})</span>
      {linked.length > 0 && (
        <div className="dp-photo-row" data-testid="attach-photos">
          {linked.map((p, i) => (
            <span key={p.id} className="dp-photo-chip">
              <button type="button" className="dp-photo-open" onClick={() => setView(i)} aria-label="Foto groß anzeigen" data-testid="attach-photo">
                <PhotoImg id={p.id} />
              </button>
              <button type="button" className="dp-photo-x" onClick={() => onChange(ids.filter((x) => x !== p.id))} aria-label="Foto entfernen">
                <Icon name="close" size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="row gap wrap">
        <PhotoCapture
          sites={[site]}
          site={site}
          existingHashes={hashes}
          onSaved={(saved) => {
            onChange([...ids, ...saved.map((p) => p.id)]);
            void reload();
          }}
          render={({ camera, library }) => (
            <>
              <button type="button" className="btn btn-sm" onClick={camera} data-testid="attach-camera">
                <Icon name="camera" size={16} /> Foto aufnehmen
              </button>
              <button type="button" className="btn btn-sm" onClick={library} data-testid="attach-library">
                <Icon name="images" size={16} /> Aus Galerie
              </button>
            </>
          )}
        />
        <button type="button" className="btn btn-sm" onClick={() => setPicking(true)} data-testid="attach-from-doku">
          <Icon name="folder" size={16} /> Aus Fotodokumentation
        </button>
      </div>
      {hint && <p className="muted small">{hint}</p>}
      {picking && (
        <SitePhotosPicker
          photos={sitePhotos}
          chosen={ids}
          onClose={() => setPicking(false)}
          onDone={(sel) => {
            onChange(sel);
            setPicking(false);
          }}
        />
      )}
      {view !== null && linked.length > 0 && (
        <PhotoViewer ids={linked.map((p) => p.id)} index={Math.min(view, linked.length - 1)} title="Fotos der Messung" onIndex={setView} onClose={() => setView(null)} />
      )}
    </div>
  );
}
