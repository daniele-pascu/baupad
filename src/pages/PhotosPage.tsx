import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Icon } from '../components/Icon';
import { PhotoCapture, type PhotoSite } from '../components/PhotoCapture';
import { PhotoImg } from '../components/PhotoImg';
import { PhotoSiteDialog } from '../components/PhotoSitePicker';
import { SiteNav } from '../components/SiteNav';
import { ToolIcon } from '../components/ToolIcon';
import { showError } from '../components/ui';
import { listProjects, listReports, listWeeks } from '../lib/db';
import { listFreePhotoSites } from '../lib/photo-sites';
import { cloudConnected, getPhotoStorage, onPhotosChanged } from '../lib/photo-storage';
import { groupBySite, matchesPhoto, photoSiteKey, weekLabel } from '../lib/photos';
import { navigate, paths } from '../lib/router';
import type { Photo, Project } from '../lib/types';
import { usePageTitle } from '../lib/page-title';
import { useAccess } from '../lib/access';
import { useCanCreateProjects } from '../lib/sites';

const ACCENT = { '--tool': '#111111' } as CSSProperties;

/** Baustellen für neue Fotos: Projekte (Aufmaß & Abrechnung), Baustellen der Arbeitereinteilung und bisherige Foto-Baustellen */
export async function loadPhotoSites(photos: Photo[]): Promise<PhotoSite[]> {
  const [projects, weeks, reports, free] = await Promise.all([listProjects(), listWeeks(), listReports(), listFreePhotoSites()]);
  const out: PhotoSite[] = projects.map((p: Project) => ({ projectId: p.id, name: p.site || p.name, number: p.number ?? '', address: p.address }));
  const names = new Map<string, PhotoSite>();
  const add = (name: string, address = '') => {
    const k = name.trim().toLowerCase();
    if (k && !names.has(k)) names.set(k, { projectId: null, name: name.trim(), number: '', address });
  };
  for (const f of free) names.set(f.name.toLowerCase(), f);
  for (const w of weeks) for (const s of w.sites) if (!s.projectId) add(s.name, s.address ?? '');
  for (const r of reports) if (!r.projectId) add(r.head.site || r.head.project, r.head.address);
  for (const p of photos) if (!p.projectId) add(p.siteName, p.siteAddress);
  return [...out, ...[...names.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'))];
}

const fmt = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

/**
 * Fotodokumentation – Übersicht: alle Baustellen mit Anzahl, Zeitraum und Kalenderwochen; Suche über Baustelle,
 * Nummer, Adresse, KW, Datum, Benutzer und Beschreibung; großer Knopf „Foto aufnehmen“ (Handy/Tablet).
 */
export function PhotosPage() {
  const mayCreate = useCanCreateProjects();
  usePageTitle('Fotodokumentation – BauPad');
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const access = useAccess();
  const [allSites, setAllSites] = useState<PhotoSite[]>([]);
  /** nur freigegebene Projekte (Filter beim Rendern, damit er auch greift, wenn die Sitzung später kommt) */
  const sites = useMemo(() => access.filterSites(allSites, (s) => (s.projectId ? `p:${s.projectId}` : `n:${s.name.trim().toLowerCase()}`)), [allSites, access.session]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'recent' | 'name'>('recent');
  const [creating, setCreating] = useState(false);

  const reload = () =>
    getPhotoStorage()
      .list()
      .then(async (list) => {
        setPhotos(list);
        setAllSites(await loadPhotoSites(list));
      })
      .catch((e) => showError(e, 'Fotos konnten nicht geladen werden'));
  useEffect(() => {
    void reload();
    return onPhotosChanged(() => void reload());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groups = useMemo(() => {
    const list = (photos ?? []).filter((p) => matchesPhoto(p, query) && access.canSite(photoSiteKey(p)));
    const g = groupBySite(list);
    return sort === 'name' ? g.sort((a, b) => a.name.localeCompare(b.name, 'de')) : g.sort((a, b) => b.lastAt - a.lastAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos, query, sort, access.session]);
  /** die letzten vier Fotos je Baustelle als Vorschau */
  const latest = useMemo(() => {
    const m = new Map<string, Photo[]>();
    for (const p of [...(photos ?? [])].sort((a, b) => b.takenAt - a.takenAt)) {
      const k = photoSiteKey(p);
      const l = m.get(k) ?? [];
      if (l.length < 4) m.set(k, [...l, p]);
    }
    return m;
  }, [photos]);
  const hashes = useMemo(() => new Set((photos ?? []).map((p) => p.hash)), [photos]);
  const pending = (photos ?? []).filter((p) => p.sync !== 'synced').length;
  /** Projekte aus dem Register (und ältere freie Baustellen), die noch keine Fotos haben */
  const empty = useMemo(() => sites.filter((f) => !groups.some((g) => g.key === photoSiteKey({ projectId: f.projectId, siteName: f.name })) && [f.name, f.number, f.address].join(' ').toLowerCase().includes(query.trim().toLowerCase())), [sites, groups, query]);

  return (
    <>
      <SiteNav />
      <div className="page photos-page">
        <header className="page-head page-head-row">
          <div className="page-head-title">
            <a href={paths.tools()} className="icon-link" aria-label="Zu den Tools" title="Zu den Tools" data-testid="to-tools">
              <Icon name="back" />
            </a>
            <h1 data-testid="photos-title">Fotodokumentation</h1>
          </div>
          {mayCreate && (
          <button type="button" className="btn btn-sm" onClick={() => setCreating(true)} aria-label="Neues Projekt" title="Neues Projekt" data-testid="photo-new-site">
            <Icon name="plus" size={16} /> <span className="lbl">Neues Projekt</span>
          </button>
          )}
        </header>
        {creating && (
          <PhotoSiteDialog
            onClose={() => setCreating(false)}
            onSaved={(s) => {
              setCreating(false);
              void reload().then(() => navigate(paths.photoSite(photoSiteKey({ projectId: s.projectId, siteName: s.name }))));
            }}
          />
        )}

        <PhotoCapture sites={sites} existingHashes={hashes} onSaved={() => void reload()} big />

        {!cloudConnected() && photos && photos.length > 0 && (
          <div className="banner banner-info photos-sync-banner" role="status" data-testid="photos-local-banner">
            <p>
              <strong>Noch nicht zentral gespeichert:</strong> {pending} {pending === 1 ? 'Foto liegt' : 'Fotos liegen'} nur auf diesem Gerät.
              <span className="lbl"> Die gemeinsame Ablage für alle Geräte wird mit der Anmeldung angebunden – vorhandene Fotos werden dann automatisch hochgeladen.</span>
            </p>
          </div>
        )}

        {photos && photos.length === 0 && empty.length === 0 && (
          <div className="crew-setup" style={ACCENT} data-testid="photos-empty">
            <span className="tile-icon">
              <ToolIcon name="photos" size={22} />
            </span>
            <div>
              <strong>Noch keine Fotos</strong>
              <p className="muted small">Foto aufnehmen oder aus der Galerie wählen – es wird der Baustelle, Kalenderwoche und dem Aufnahmetag zugeordnet.</p>
            </div>
          </div>
        )}

        {photos && photos.length > 0 && (
          <div className="reports-tools">
            <label className="crew-search reports-search">
              <Icon name="select" size={18} />
              <span className="sr-only">Suchen</span>
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Baustelle, Nummer, Adresse, KW 44, 28.10., Name, Beschreibung" data-testid="photo-search" />
            </label>
            <div className="segmented" role="radiogroup" aria-label="Sortierung">
              <button type="button" role="radio" aria-checked={sort === 'recent'} aria-selected={sort === 'recent'} onClick={() => setSort('recent')} data-testid="photo-sort-recent">
                Zuletzt aktiv
              </button>
              <button type="button" role="radio" aria-checked={sort === 'name'} aria-selected={sort === 'name'} onClick={() => setSort('name')} data-testid="photo-sort-name">
                A–Z
              </button>
            </div>
          </div>
        )}
        {photos && photos.length > 0 && groups.length === 0 && empty.length === 0 && <p className="muted">Keine Fotos gefunden.</p>}

        <div className="photo-sites">
          {groups.map((g) => (
            <a key={g.key} href={paths.photoSite(g.key)} className="photo-site" data-testid="photo-site" data-site={g.name}>
              <div className="photo-site-preview" aria-hidden="true">
                {(latest.get(g.key) ?? []).map((p) => (
                  <PhotoImg key={p.id} id={p.id} />
                ))}
              </div>
              <div className="photo-site-main">
                <strong>{g.name}</strong>
                <span className="muted small">{[g.number, g.address].filter(Boolean).join(' · ')}</span>
                <span className="small">
                  {g.count} {g.count === 1 ? 'Foto' : 'Fotos'} · {g.from === g.to ? fmt(g.from) : `${fmt(g.from)} – ${fmt(g.to)}`}
                  {g.pending > 0 && <span className="rp-badge"> {g.pending} nur hier</span>}
                </span>
              </div>
              <div className="photo-site-weeks">
                {g.weeks.slice(0, 6).map((w) => (
                  <span key={w.week} className="photo-week-chip">
                    {weekLabel(w.week)} <small>{w.count}</small>
                  </span>
                ))}
                {g.weeks.length > 6 && <span className="muted small">+{g.weeks.length - 6}</span>}
              </div>
              <Icon name="next" size={18} />
            </a>
          ))}
          {empty.map((f) => (
            <a key={`empty:${f.projectId ?? f.name}`} href={paths.photoSite(photoSiteKey({ projectId: f.projectId, siteName: f.name }))} className="photo-site photo-site-empty" data-testid="photo-site" data-site={f.name}>
              <div className="photo-site-preview" aria-hidden="true">
                <span className="photo-thumb-empty" />
              </div>
              <div className="photo-site-main">
                <strong>{f.name}</strong>
                <span className="muted small">{[f.number, f.address].filter(Boolean).join(' · ')}</span>
                <span className="small muted">Noch keine Fotos</span>
              </div>
              <Icon name="next" size={18} />
            </a>
          ))}
        </div>
        {/* Baustellen ohne Fotos (zum schnellen Start) */}
        {photos && sites.some((s) => !groups.some((g) => g.key === photoSiteKey({ projectId: s.projectId, siteName: s.name }))) && !query && (
          <p className="muted small photos-hint">Weitere Baustellen stehen beim Speichern eines Fotos zur Auswahl (aus Aufmaß &amp; Abrechnung und Arbeitereinteilung).</p>
        )}
      </div>
    </>
  );
}
