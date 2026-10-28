import { zipSync } from 'fflate';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { MovePhotosDialog } from '../components/MovePhotosDialog';
import { PhotoPdfDialog } from '../components/PhotoPdfDialog';
import { forgetPhotoUrl, usePhotoUrl } from '../components/PhotoImg';
import { PhotoCapture, type PhotoSite } from '../components/PhotoCapture';
import { SiteNav } from '../components/SiteNav';
import { confirmDialog, offerFile, showError, toast } from '../components/ui';
import { safeFileName } from '../lib/aufmass';
import { getPhotoStorage } from '../lib/photo-storage';
import { dateTimeLabel, dayTitle, fmtBytes, GROUP_MODES, groupPhotos, matchesPhoto, type PhotoGroupMode, photoSiteKey, SYNC_LABELS, timeLabel, weekLabel } from '../lib/photos';
import { navigate, paths } from '../lib/router';
import type { Photo } from '../lib/types';
import { loadPhotoSites } from './PhotosPage';
import { usePageTitle } from './SitePages';

/** Foto-Kachel: Bild, darunter Uhrzeit, Benutzer und Beschreibung; im Auswahlmodus mit Häkchen */
function Thumb({ photo, selectable, selected, onOpen, onToggle }: { photo: Photo; selectable: boolean; selected: boolean; onOpen(): void; onToggle(): void }) {
  const src = usePhotoUrl(photo.id, 'thumb');
  return (
    <div className={`photo-card${selected ? ' selected' : ''}`} data-testid="photo-thumb" data-photo={photo.id} data-selected={selected || undefined}>
      <button
        type="button"
        className="photo-thumb"
        onClick={selectable ? onToggle : onOpen}
        title={photo.description || undefined}
        aria-label={`${selectable ? (selected ? 'Abwählen' : 'Auswählen') : 'Öffnen'}: Foto ${timeLabel(photo.takenAt)}${photo.description ? ` – ${photo.description}` : ''}`}
        aria-pressed={selectable ? selected : undefined}
      >
        {src ? <img src={src} alt="" loading="lazy" /> : <span className="photo-thumb-empty" />}
        <span className="photo-thumb-time">{timeLabel(photo.takenAt)}</span>
        {photo.sync !== 'synced' && (
          <span className={`photo-sync ${photo.sync}`} title={SYNC_LABELS[photo.sync]} aria-label={SYNC_LABELS[photo.sync]}>
            {photo.sync === 'local' ? 'Gerät' : photo.sync === 'failed' ? '!' : '↑'}
          </span>
        )}
        {selectable && (
          <span className={`photo-check${selected ? ' on' : ''}`} aria-hidden="true">
            {selected && <Icon name="check" size={14} />}
          </span>
        )}
      </button>
      <div className="photo-card-info">
        <span className="photo-card-line">
          <strong>{timeLabel(photo.takenAt)} Uhr</strong>
          {photo.userName && <span className="muted">{photo.userName}</span>}
        </span>
        <span className={`photo-card-desc${photo.description ? '' : ' muted'}`}>{photo.description || 'Keine Beschreibung'}</span>
      </div>
    </div>
  );
}

/**
 * Fotodokumentation einer Baustelle: Kalenderwoche → Aufnahmetag → Fotos; Großansicht mit Blättern,
 * Beschreibung, Herunterladen und Löschen; alle Fotos der Baustelle als ZIP.
 */
export function PhotoSitePage({ siteKey, week, photoId }: { siteKey: string; week: string | null; photoId: string | null }) {
  const [all, setAll] = useState<Photo[] | null>(null);
  const [site, setSite] = useState<PhotoSite | null>(null);
  const [sites, setSites] = useState<PhotoSite[]>([]);
  const [moving, setMoving] = useState<Photo[] | null>(null);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [user, setUser] = useState('');
  const [mode, setMode] = useState<PhotoGroupMode>(() => {
    if (week) return 'week';
    try {
      const m = localStorage.getItem('photoGroupMode');
      return GROUP_MODES.some((g) => g.id === m) ? (m as PhotoGroupMode) : 'week';
    } catch {
      return 'week';
    }
  });
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
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
        setSites(sites);
        const found = sites.find((s) => photoSiteKey({ projectId: s.projectId, siteName: s.name }) === siteKey);
        const last = mine.sort((a, b) => b.uploadedAt - a.uploadedAt)[0];
        setSite(found ?? (last ? { projectId: last.projectId, name: last.siteName, number: last.siteNumber, address: last.siteAddress } : null));
      })
      .catch((e) => showError(e, 'Fotos konnten nicht geladen werden'));
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey]);

  const users = useMemo(() => [...new Set(photos.map((p) => p.userName.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de')), [photos]);
  const shown = useMemo(() => photos.filter((p) => matchesPhoto(p, query) && (!user || p.userName.trim() === user)), [photos, query, user]);
  const groups = useMemo(() => groupPhotos(shown, mode), [shown, mode]);
  const changeMode = (m: PhotoGroupMode) => {
    setMode(m);
    setLimit(4);
    try {
      localStorage.setItem('photoGroupMode', m);
    } catch {
      /* egal */
    }
  };
  const chosen = useMemo(() => shown.filter((p) => selected.has(p.id)), [shown, selected]);
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const setMany = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) on ? next.add(id) : next.delete(id);
      return next;
    });
  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };
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
    const idx = groups.findIndex((g) => g.key === week);
    if (idx >= limit) setLimit(idx + 1);
    else document.querySelector(`[data-group="${week}"]`)?.scrollIntoView({ block: 'start' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week, groups.length, limit]);
  const flat = useMemo(() => groups.flatMap((g) => g.days.flatMap((d) => d.photos)), [groups]);
  const current = photoId ? photos.find((p) => p.id === photoId) ?? null : null;
  const hashes = useMemo(() => new Set((all ?? []).map((p) => p.hash)), [all]);
  const show = (id: string | null) => navigate(paths.photoSite(siteKey, { photoId: id }), true);

  const run = (fn: () => Promise<void>) => fn().catch((e) => showError(e, 'Das hat nicht geklappt'));
  const removeMany = (list: Photo[]) =>
    void confirmDialog({
      title: list.length === 1 ? 'Foto löschen?' : `${list.length} Fotos löschen?`,
      message: (
        <p>
          {list.length === 1 ? `Das Foto vom ${dateTimeLabel(list[0].takenAt)} wird` : `${list.length} Fotos werden`} endgültig gelöscht
          {list.some((p) => p.sync === 'local') ? ' – sie liegen nur auf diesem Gerät' : ''}.
        </p>
      ),
      confirmLabel: 'Löschen',
      danger: true,
    }).then((ok) => {
      if (!ok) return;
      void run(async () => {
        for (const p of list) {
          await getPhotoStorage().remove(p.id);
          forgetPhotoUrl(p.id);
        }
        if (current && list.some((p) => p.id === current.id)) show(null);
        setSelected(new Set());
        await reload();
        toast(list.length === 1 ? 'Foto gelöscht.' : `${list.length} Fotos gelöscht.`, 'success');
      });
    });
  const remove = (p: Photo) => removeMany([p]);
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
  const downloadZip = (list: Photo[] = shown) =>
    run(async () => {
      if (list.length === 1) return download(list[0]);
      const files: Record<string, Uint8Array> = {};
      const lines = ['Datei;Datum;Uhrzeit;Aufgenommen von;Beschreibung;Status'];
      for (const g of groupPhotos(list, 'week'))
        for (const d of g.days)
          for (const [i, p] of d.photos.entries()) {
            const b = await getPhotoStorage().blobs(p.id);
            if (!b) continue;
            const name = `${weekLabel(g.key).replace(' ', '')}/${d.day}/${d.day}_${timeLabel(p.takenAt).replace(':', '')}_${String(i + 1).padStart(2, '0')}.jpg`;
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
          <div className="row gap">
            <button type="button" className="btn btn-sm" onClick={() => setPdfOpen(true)} disabled={!shown.length} data-testid="photo-pdf">
              <Icon name="pdf" size={16} /> PDF
            </button>
            <button type="button" className="btn btn-sm" onClick={() => downloadZip()} disabled={!shown.length} data-testid="photo-zip">
              <Icon name="zip" size={16} /> Alle als ZIP
            </button>
          </div>
        </header>

        {site && <PhotoCapture sites={[site]} site={site} existingHashes={hashes} onSaved={() => void reload()} big />}

        {photos.length > 0 && (
          <div className="photo-toolbar" data-testid="photo-toolbar">
            <label className="crew-search reports-search">
              <Icon name="select" size={18} />
              <span className="sr-only">Suchen</span>
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="KW 44, 28.10., Name oder Beschreibung" data-testid="photo-search" />
            </label>
            {users.length > 1 && (
              <select value={user} onChange={(e) => setUser(e.target.value)} aria-label="Benutzer" data-testid="photo-user-filter">
                <option value="">Alle Benutzer</option>
                {users.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            )}
            <div className="segmented" role="radiogroup" aria-label="Gruppierung">
              {GROUP_MODES.map((m) => (
                <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} aria-selected={mode === m.id} onClick={() => changeMode(m.id)} data-testid={`photo-mode-${m.id}`}>
                  {m.label}
                </button>
              ))}
            </div>
            <button type="button" className={`btn btn-sm${selecting ? ' btn-primary' : ''}`} onClick={() => (selecting ? stopSelecting() : setSelecting(true))} data-testid="photo-select">
              <Icon name="check" size={16} /> {selecting ? 'Fertig' : 'Auswählen'}
            </button>
          </div>
        )}
        {all && photos.length === 0 && <p className="muted" data-testid="photo-site-empty">Noch keine Fotos auf dieser Baustelle.</p>}
        {photos.length > 0 && shown.length === 0 && <p className="muted">Keine Fotos gefunden.</p>}

        <div className={`photo-stream${selecting ? ' selecting' : ''}`} data-testid="photo-stream">
          {groups.slice(0, limit).map((g) => {
            const ids = g.days.flatMap((d) => d.photos.map((p) => p.id));
            const allOn = ids.every((id) => selected.has(id));
            return (
              <section key={g.key} className="photo-group" data-testid="photo-group" data-group={g.key}>
                <div className="photo-group-head">
                  <h2>{g.title}</h2>
                  <span className="muted small">
                    {g.count} {g.count === 1 ? 'Foto' : 'Fotos'}
                  </span>
                  {selecting && (
                    <label className="photo-group-all">
                      <input type="checkbox" checked={allOn} onChange={(e) => setMany(ids, e.target.checked)} data-testid="photo-group-all" />
                      Alle auswählen
                    </label>
                  )}
                </div>
                {g.days.map((d) => (
                  <div key={d.day} className="photo-day" data-testid="photo-day" data-day={d.day}>
                    {mode !== 'day' && <h3>{dayTitle(d.day)}</h3>}
                    <div className="photo-grid">
                      {d.photos.map((p) => (
                        <Thumb key={p.id} photo={p} selectable={selecting} selected={selected.has(p.id)} onOpen={() => show(p.id)} onToggle={() => toggleOne(p.id)} />
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
                Ältere laden ({groups.length - limit})
              </button>
            </div>
          )}
        </div>
      </div>
      {selecting && (
        <div className="photo-selection-bar" role="toolbar" aria-label="Auswahl" data-testid="photo-selection-bar">
          <strong>{chosen.length} ausgewählt</strong>
          <button type="button" className="btn btn-sm" onClick={() => setMany(shown.map((p) => p.id), true)}>
            Alle ({shown.length})
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setSelected(new Set())} disabled={!chosen.length}>
            Keine
          </button>
          <span className="spacer" />
          <button type="button" className="btn btn-sm" onClick={() => downloadZip(chosen)} disabled={!chosen.length} data-testid="photo-selected-download">
            <Icon name="download" size={16} /> Herunterladen
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setPdfOpen(true)} disabled={!chosen.length} data-testid="photo-selected-pdf">
            <Icon name="pdf" size={16} /> PDF
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setMoving(chosen)} disabled={!chosen.length} data-testid="photo-selected-move">
            <Icon name="move" size={16} /> Verschieben
          </button>
          <button type="button" className="btn btn-sm" disabled title="Kommt mit der zentralen Ablage: Link für 30 Tage, nur auf die Fotos" data-testid="photo-selected-share">
            <Icon name="share" size={16} /> Link teilen
          </button>
          <button type="button" className="btn btn-sm btn-danger-text" onClick={() => removeMany(chosen)} disabled={!chosen.length} data-testid="photo-selected-delete">
            <Icon name="trash" size={16} /> Löschen
          </button>
          <button type="button" className="btn btn-sm" onClick={stopSelecting} aria-label="Auswahl beenden">
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
      {moving && site && (
        <MovePhotosDialog
          photos={moving}
          sites={sites}
          from={site}
          onClose={() => setMoving(null)}
          onMoved={() => {
            setMoving(null);
            if (current && moving.some((p) => p.id === current.id)) show(null);
            setSelected(new Set());
            void reload();
          }}
        />
      )}
      {pdfOpen && site && <PhotoPdfDialog site={site} selection={selecting ? chosen : []} all={shown} onClose={() => setPdfOpen(false)} />}
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
          onMove={() => setMoving([current])}
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
  onMove,
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
  onMove(): void;
  onDescription(text: string): void;
}) {
  const src = usePhotoUrl(photo.id, 'data');
  const [desc, setDesc] = useState(photo.description);
  const [editing, setEditing] = useState(false);
  const touch = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    setDesc(photo.description);
    setEditing(false);
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
          <strong>{[photo.siteNumber, photo.siteName].filter(Boolean).join(' · ')}</strong>
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
          <button type="button" className="btn btn-sm" onClick={onMove} data-testid="lightbox-move">
            <Icon name="move" size={16} /> Verschieben
          </button>
          <button type="button" className="btn btn-sm btn-danger-text" onClick={onDelete} data-testid="lightbox-delete">
            <Icon name="trash" size={16} /> Löschen
          </button>
        </div>
      </footer>
    </div>
  );
}
