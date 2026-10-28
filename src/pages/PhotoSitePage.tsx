import { zipSync } from 'fflate';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { PhotoCapture, type PhotoSite } from '../components/PhotoCapture';
import { SiteNav } from '../components/SiteNav';
import { confirmDialog, offerFile, showError, toast } from '../components/ui';
import { safeFileName } from '../lib/aufmass';
import { getPhotoStorage } from '../lib/photo-storage';
import { dateTimeLabel, dayTitle, fmtBytes, groupByWeekAndDay, matchesPhoto, photoSiteKey, SYNC_LABELS, timeLabel, weekTitle } from '../lib/photos';
import { navigate, paths } from '../lib/router';
import type { Photo } from '../lib/types';
import { loadPhotoSites } from './PhotosPage';
import { usePageTitle } from './SitePages';

/** Bild-Adressen (Vorschau bzw. Bild) – je Foto einmal erzeugt, bleiben für die Sitzung gültig */
const urls = new Map<string, string>();
async function photoUrl(id: string, kind: 'thumb' | 'data'): Promise<string | null> {
  const key = `${kind}:${id}`;
  const u = urls.get(key);
  if (u) return u;
  const b = await getPhotoStorage().blobs(id);
  if (!b) return null;
  const url = URL.createObjectURL(new Blob([b[kind]], { type: 'image/jpeg' }));
  urls.set(key, url);
  return url;
}
function forget(id: string) {
  for (const kind of ['thumb', 'data']) {
    const u = urls.get(`${kind}:${id}`);
    if (u) URL.revokeObjectURL(u);
    urls.delete(`${kind}:${id}`);
  }
}

function Thumb({ photo, onOpen }: { photo: Photo; onOpen(): void }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let on = true;
    void photoUrl(photo.id, 'thumb').then((u) => on && setSrc(u));
    return () => {
      on = false;
    };
  }, [photo.id]);
  return (
    <button type="button" className="photo-thumb" onClick={onOpen} data-testid="photo-thumb" data-photo={photo.id} title={photo.description || undefined}>
      {src ? <img src={src} alt={photo.description || `Foto ${timeLabel(photo.takenAt)}`} loading="lazy" /> : <span className="photo-thumb-empty" />}
      <span className="photo-thumb-meta">
        <span>{timeLabel(photo.takenAt)}</span>
        {photo.userName && <span className="muted">{photo.userName}</span>}
      </span>
      {photo.sync !== 'synced' && (
        <span className={`photo-sync ${photo.sync}`} title={SYNC_LABELS[photo.sync]} aria-label={SYNC_LABELS[photo.sync]}>
          {photo.sync === 'local' ? 'Gerät' : photo.sync === 'failed' ? '!' : '↑'}
        </span>
      )}
      {photo.description && <span className="photo-thumb-desc">{photo.description}</span>}
    </button>
  );
}

/**
 * Fotodokumentation einer Baustelle: Kalenderwoche → Aufnahmetag → Fotos; Großansicht mit Blättern,
 * Beschreibung, Herunterladen und Löschen; alle Fotos der Baustelle als ZIP.
 */
export function PhotoSitePage({ siteKey, week, photoId }: { siteKey: string; week: string | null; photoId: string | null }) {
  const [all, setAll] = useState<Photo[] | null>(null);
  const [site, setSite] = useState<PhotoSite | null>(null);
  const [query, setQuery] = useState('');
  /** fortlaufende Galerie: zuerst die neuesten Wochen, beim Scrollen nach unten erscheinen ältere */
  const [limit, setLimit] = useState(4);
  const sentinel = useRef<HTMLDivElement>(null);
  const photos = useMemo(() => (all ?? []).filter((p) => photoSiteKey(p) === siteKey), [all, siteKey]);
  usePageTitle(`${site?.name ?? 'Baustelle'} – Fotodokumentation – BauPad`);

  const reload = () =>
    getPhotoStorage()
      .list()
      .then(async (list) => {
        setAll(list);
        const mine = list.filter((p) => photoSiteKey(p) === siteKey);
        const sites = await loadPhotoSites(list);
        const found = sites.find((s) => photoSiteKey({ projectId: s.projectId, siteName: s.name }) === siteKey);
        const last = mine.sort((a, b) => b.uploadedAt - a.uploadedAt)[0];
        setSite(found ?? (last ? { projectId: last.projectId, name: last.siteName, number: last.siteNumber, address: last.siteAddress } : null));
      })
      .catch((e) => showError(e, 'Fotos konnten nicht geladen werden'));
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey]);

  const shown = useMemo(() => photos.filter((p) => matchesPhoto(p, query)), [photos, query]);
  const groups = useMemo(() => groupByWeekAndDay(shown), [shown]);
  // ältere Wochen nachladen, sobald das Ende sichtbar wird
  useEffect(() => {
    const el = sentinel.current;
    if (!el || limit >= groups.length) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setLimit((n) => n + 4), { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [limit, groups.length]);
  // Vorgabe aus der Adresse (?w=): zu dieser Woche scrollen
  useEffect(() => {
    if (!week || !groups.length) return;
    const idx = groups.findIndex((g) => g.week === week);
    if (idx >= limit) setLimit(idx + 1);
    else document.querySelector(`[data-week="${week}"]`)?.scrollIntoView({ block: 'start' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week, groups.length, limit]);
  const flat = useMemo(() => groups.flatMap((g) => g.days.flatMap((d) => d.photos)), [groups]);
  const current = photoId ? photos.find((p) => p.id === photoId) ?? null : null;
  const hashes = useMemo(() => new Set((all ?? []).map((p) => p.hash)), [all]);
  const show = (id: string | null) => navigate(paths.photoSite(siteKey, { photoId: id }), true);

  const run = (fn: () => Promise<void>) => fn().catch((e) => showError(e, 'Das hat nicht geklappt'));
  const remove = (p: Photo) =>
    void confirmDialog({
      title: 'Foto löschen?',
      message: (
        <p>
          Das Foto vom {dateTimeLabel(p.takenAt)} wird endgültig gelöscht{p.sync === 'local' ? ' – es liegt nur auf diesem Gerät' : ''}.
        </p>
      ),
      confirmLabel: 'Löschen',
      danger: true,
    }).then((ok) => {
      if (!ok) return;
      void run(async () => {
        await getPhotoStorage().remove(p.id);
        forget(p.id);
        if (current?.id === p.id) show(null);
        await reload();
        toast('Foto gelöscht.', 'success');
      });
    });
  const saveDescription = (p: Photo, description: string) =>
    run(async () => {
      await getPhotoStorage().update({ ...p, description: description.trim() });
      await reload();
    });
  const download = (p: Photo) =>
    run(async () => {
      const b = await getPhotoStorage().blobs(p.id);
      if (!b) throw new Error('Bilddaten nicht gefunden.');
      await offerFile({ name: `${safeFileName(p.siteName, p.day, timeLabel(p.takenAt).replace(':', ''))}.jpg`, data: new Uint8Array(b.original ?? b.data), mimeType: 'image/jpeg' });
    });
  /** alle Fotos der Baustelle (bzw. der Suche) als ZIP: Ordner je KW und Tag, dazu eine Liste mit Angaben */
  const downloadZip = () =>
    run(async () => {
      const files: Record<string, Uint8Array> = {};
      const lines = ['Datei;Datum;Uhrzeit;Aufgenommen von;Beschreibung;Status'];
      for (const g of groups)
        for (const d of g.days)
          for (const [i, p] of d.photos.entries()) {
            const b = await getPhotoStorage().blobs(p.id);
            if (!b) continue;
            const name = `${weekTitle(g.week).split(' ·')[0].replace(' ', '')}/${d.day}/${d.day}_${timeLabel(p.takenAt).replace(':', '')}_${String(i + 1).padStart(2, '0')}.jpg`;
            files[name] = new Uint8Array(b.original ?? b.data);
            lines.push([name, d.day, timeLabel(p.takenAt), p.userName, p.description.replace(/[;\n]/g, ' '), SYNC_LABELS[p.sync]].join(';'));
          }
      if (!Object.keys(files).length) return toast('Keine Fotos zum Herunterladen.', 'info');
      files['fotos.csv'] = new TextEncoder().encode(`﻿${lines.join('\n')}`);
      await offerFile({ name: `${safeFileName('Fotos', site?.name ?? 'Baustelle')}.zip`, data: zipSync(files, { level: 0 }), mimeType: 'application/zip' });
    });

  if (all && !site && !photos.length)
    return (
      <>
        <SiteNav />
        <div className="page">
          <p>Baustelle nicht gefunden.</p>
          <a className="btn" href={paths.photos()}>
            Zur Fotodokumentation
          </a>
        </div>
      </>
    );

  return (
    <>
      <SiteNav />
      <div className="page photos-page">
        <header className="page-head page-head-row">
          <div className="page-head-title">
            <a href={paths.photos()} className="icon-link" aria-label="Zur Übersicht" title="Zur Übersicht" data-testid="to-photos">
              <Icon name="back" />
            </a>
            <div>
              <h1 data-testid="photo-site-title">{site?.name ?? '…'}</h1>
              <span className="muted small">
                {[site?.number, site?.address].filter(Boolean).join(' · ')}
                {photos.length > 0 && ` · ${photos.length} ${photos.length === 1 ? 'Foto' : 'Fotos'}`}
              </span>
            </div>
          </div>
          <button type="button" className="btn btn-sm" onClick={downloadZip} disabled={!shown.length} data-testid="photo-zip">
            <Icon name="zip" size={16} /> Alle als ZIP
          </button>
        </header>

        {site && <PhotoCapture sites={[site]} site={site} existingHashes={hashes} onSaved={() => void reload()} big />}

        {photos.length > 3 && (
          <label className="crew-search reports-search photos-search">
            <Icon name="select" size={18} />
            <span className="sr-only">Suchen</span>
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="KW 44, 28.10., Name oder Beschreibung" data-testid="photo-search" />
          </label>
        )}
        {all && photos.length === 0 && <p className="muted" data-testid="photo-site-empty">Noch keine Fotos auf dieser Baustelle.</p>}

        <div className="photo-stream" data-testid="photo-stream">
          {groups.slice(0, limit).map((g) => {
            const n = g.days.reduce((s, d) => s + d.photos.length, 0);
            return (
              <section key={g.week} className="photo-week" data-testid="photo-week" data-week={g.week}>
                <div className="photo-week-head">
                  <strong>{weekTitle(g.week)}</strong>
                  <span className="muted small">
                    {n} {n === 1 ? 'Foto' : 'Fotos'}
                  </span>
                </div>
                {g.days.map((d) => (
                  <div key={d.day} className="photo-day" data-testid="photo-day" data-day={d.day}>
                    <h3>{dayTitle(d.day)}</h3>
                    <div className="photo-grid">
                      {d.photos.map((p) => (
                        <Thumb key={p.id} photo={p} onOpen={() => show(p.id)} />
                      ))}
                    </div>
                  </div>
                ))}
              </section>
            );
          })}
          {limit < groups.length && (
            <div ref={sentinel} className="photo-more" data-testid="photo-more">
              <button type="button" className="btn btn-sm" onClick={() => setLimit((n) => n + 4)}>
                Ältere Wochen laden ({groups.length - limit})
              </button>
            </div>
          )}
        </div>
      </div>
      {current && (
        <Lightbox
          photo={current}
          index={flat.findIndex((p) => p.id === current.id)}
          total={flat.length}
          onPrev={() => show(flat[(flat.findIndex((p) => p.id === current.id) - 1 + flat.length) % flat.length]?.id ?? null)}
          onNext={() => show(flat[(flat.findIndex((p) => p.id === current.id) + 1) % flat.length]?.id ?? null)}
          onClose={() => show(null)}
          onDelete={() => remove(current)}
          onDownload={() => download(current)}
          onDescription={(t) => saveDescription(current, t)}
        />
      )}
    </>
  );
}

/** Großansicht mit Blättern (Pfeiltasten, Wischen), Angaben und Beschreibung */
function Lightbox({
  photo,
  index,
  total,
  onPrev,
  onNext,
  onClose,
  onDelete,
  onDownload,
  onDescription,
}: {
  photo: Photo;
  index: number;
  total: number;
  onPrev(): void;
  onNext(): void;
  onClose(): void;
  onDelete(): void;
  onDownload(): void;
  onDescription(text: string): void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [desc, setDesc] = useState(photo.description);
  const [editing, setEditing] = useState(false);
  const touch = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    let on = true;
    setSrc(null);
    void photoUrl(photo.id, 'data').then((u) => on && setSrc(u));
    setDesc(photo.description);
    setEditing(false);
    return () => {
      on = false;
    };
  }, [photo.id, photo.description]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing) return;
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') onPrev();
      else if (e.key === 'ArrowRight') onNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, onClose, onPrev, onNext]);
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="Foto" data-testid="lightbox">
      <header className="lightbox-head">
        <div className="lightbox-title">
          <strong>{photo.siteName}</strong>
          <span>
            {dayTitle(photo.day)} · {timeLabel(photo.takenAt)} Uhr
            {photo.userName && ` · ${photo.userName}`}
          </span>
        </div>
        <span className="muted small">
          {index + 1} / {total}
        </span>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Schließen" data-testid="lightbox-close">
          <Icon name="close" />
        </button>
      </header>
      <div
        className="lightbox-body"
        onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
        onTouchEnd={(e) => {
          const t = touch.current;
          touch.current = null;
          if (!t) return;
          const dx = e.changedTouches[0].clientX - t.x;
          const dy = e.changedTouches[0].clientY - t.y;
          if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) (dx < 0 ? onNext : onPrev)();
        }}
      >
        {total > 1 && (
          <button type="button" className="lightbox-nav prev" onClick={onPrev} aria-label="Vorheriges Foto" data-testid="lightbox-prev">
            <Icon name="back" />
          </button>
        )}
        {src ? <img src={src} alt={photo.description || 'Foto'} data-testid="lightbox-image" /> : <span className="muted">Wird geladen …</span>}
        {total > 1 && (
          <button type="button" className="lightbox-nav next" onClick={onNext} aria-label="Nächstes Foto" data-testid="lightbox-next">
            <Icon name="next" />
          </button>
        )}
      </div>
      <footer className="lightbox-foot">
        {editing ? (
          <form
            className="lightbox-desc-form"
            onSubmit={(e) => {
              e.preventDefault();
              onDescription(desc);
              setEditing(false);
            }}
          >
            <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Beschreibung" aria-label="Beschreibung" autoFocus data-testid="lightbox-description-input" />
            <button type="submit" className="btn btn-sm btn-primary" data-testid="lightbox-description-save">
              Speichern
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setEditing(false)}>
              Abbrechen
            </button>
          </form>
        ) : (
          <button type="button" className="lightbox-desc" onClick={() => setEditing(true)} data-testid="lightbox-description">
            {photo.description || <span className="muted">Beschreibung hinzufügen …</span>}
            <Icon name="edit" size={14} />
          </button>
        )}
        <div className="lightbox-meta muted small">
          <span className={`photo-sync-text ${photo.sync}`} data-testid="lightbox-sync">
            {SYNC_LABELS[photo.sync]}
          </span>
          <span>
            {photo.width} × {photo.height} · {fmtBytes(photo.size)}
          </span>
          <span>gespeichert {dateTimeLabel(photo.uploadedAt)}</span>
          {photo.takenFrom !== 'exif' && <span>Aufnahmezeit {photo.takenFrom === 'file' ? 'aus dem Dateidatum' : 'beim Speichern erfasst'}</span>}
        </div>
        <div className="row gap">
          <button type="button" className="btn btn-sm" onClick={onDownload} data-testid="lightbox-download">
            <Icon name="download" size={16} /> Herunterladen
          </button>
          <button type="button" className="btn btn-sm btn-danger-text" onClick={onDelete} data-testid="lightbox-delete">
            <Icon name="trash" size={16} /> Löschen
          </button>
        </div>
      </footer>
    </div>
  );
}
