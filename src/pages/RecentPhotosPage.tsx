import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { usePhotoUrl } from '../components/PhotoImg';
import { PhotoViewer } from '../components/PhotoViewer';
import { SiteNav } from '../components/SiteNav';
import { showError } from '../components/ui';
import { useAccess } from '../lib/access';
import { usePageTitle } from '../lib/page-title';
import { getPhotoStorage, onPhotosChanged } from '../lib/photo-storage';
import { dayTitle, photoSiteKey, timeLabel } from '../lib/photos';
import { paths } from '../lib/router';
import type { Photo } from '../lib/types';

const PAGE = 60;
const uploadDay = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Kachel: Bild, Projekt als Marke, Uhrzeit und Benutzer */
function Card({ photo, onOpen }: { photo: Photo; onOpen(): void }) {
  const src = usePhotoUrl(photo.id, 'thumb', photo.updatedAt);
  const site = [photo.siteNumber, photo.siteName].filter(Boolean).join(' – ');
  return (
    <div className="photo-card" data-testid="photo-recent-card" data-site={photo.siteName}>
      <button type="button" className="photo-thumb" onClick={onOpen} title={photo.description || undefined} aria-label={`Öffnen: ${site}, ${timeLabel(photo.uploadedAt)}`}>
        {src ? <img src={src} alt="" loading="lazy" /> : <span className="photo-thumb-empty" />}
        <span className="photo-thumb-time">{timeLabel(photo.uploadedAt)}</span>
      </button>
      <div className="photo-card-info">
        <a href={paths.photoSite(photoSiteKey(photo))} className="photo-recent-site" title="Zum Projekt">
          {site}
        </a>
        <span className="photo-card-line">
          {photo.userName && <span className="muted">{photo.userName}</span>}
          <span className="muted">{photo.fileName}</span>
        </span>
        {photo.description && <span className="photo-card-desc">{photo.description}</span>}
      </div>
    </div>
  );
}

/**
 * Fotodokumentation → „Zuletzt hochgeladen“ (Admin und Büro): die neuesten Fotos aller Projekte als Galerie,
 * nach Hochlade-Tag gruppiert, jedes mit Projekt, Zeit und Benutzer. Antippen öffnet die Großansicht.
 */
export function RecentPhotosPage() {
  usePageTitle('Zuletzt hochgeladen – Fotodokumentation – BauPad');
  const access = useAccess();
  const [all, setAll] = useState<Photo[] | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [viewer, setViewer] = useState<number | null>(null);
  const reload = () =>
    getPhotoStorage()
      .list()
      .then(setAll)
      .catch((e) => showError(e, 'Fotos konnten nicht geladen werden'));
  useEffect(() => {
    void reload();
    return onPhotosChanged(() => void reload());
  }, []);
  const photos = useMemo(
    () => access.filterSites(all ?? [], (p) => (p.projectId ? `p:${p.projectId}` : `n:${p.siteName.trim().toLowerCase()}`)).sort((a, b) => b.uploadedAt - a.uploadedAt),
    [all, access.session],
  );
  const shown = photos.slice(0, limit);
  const days = useMemo(() => {
    const out: { day: string; photos: Photo[] }[] = [];
    for (const p of shown) {
      const day = uploadDay(p.uploadedAt);
      const last = out[out.length - 1];
      if (last && last.day === day) last.photos.push(p);
      else out.push({ day, photos: [p] });
    }
    return out;
  }, [shown]);
  const ids = shown.map((p) => p.id);
  const idx = (id: string) => ids.indexOf(id);
  const allowed = access.session?.role === 'admin' || access.session?.role === 'buero';

  return (
    <>
      <SiteNav />
      <div className="page photos-page">
        <header className="page-head page-head-row">
          <div className="page-head-title">
            <a href={paths.photos()} className="icon-link" aria-label="Zur Fotodokumentation" title="Zur Fotodokumentation" data-testid="to-photos">
              <Icon name="back" />
            </a>
            <h1 data-testid="recent-title">Zuletzt hochgeladen</h1>
          </div>
        </header>
        {access.ready && !allowed && <p className="muted">Diese Ansicht ist für Admin und Büro.</p>}
        {allowed && all && photos.length === 0 && <p className="muted">Noch keine Fotos hochgeladen.</p>}
        {allowed && (
          <div className="photo-stream" data-testid="photo-recent-stream">
            {days.map((d) => (
              <div key={d.day} className="photo-day" data-testid="photo-recent-day" data-day={d.day}>
                <h3>{dayTitle(d.day)}</h3>
                <div className="photo-grid">
                  {d.photos.map((p) => (
                    <Card key={p.id} photo={p} onOpen={() => setViewer(idx(p.id))} />
                  ))}
                </div>
              </div>
            ))}
            {photos.length > limit && (
              <button type="button" className="btn photo-more" onClick={() => setLimit((l) => l + PAGE)} data-testid="photo-recent-more">
                Mehr anzeigen ({photos.length - limit} weitere)
              </button>
            )}
          </div>
        )}
        {viewer !== null && ids.length > 0 && (
          <PhotoViewer ids={ids} index={viewer} title={[shown[viewer]?.siteNumber, shown[viewer]?.siteName].filter(Boolean).join(' – ')} onIndex={setViewer} onClose={() => setViewer(null)} />
        )}
      </div>
    </>
  );
}
