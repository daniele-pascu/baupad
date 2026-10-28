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
import { dateTimeLabel, dayTitle, fmtBytes, GROUP_MODES, groupPhotos, matchesPhoto, type PhotoGroupMode, photoSiteKey, rotateImage, SYNC_LABELS, timeLabel } from '../lib/photos';
import { navigate, paths } from '../lib/router';
import type { Photo } from '../lib/types';
import { loadPhotoSites } from './PhotosPage';
import { usePageTitle } from './SitePages';

/** Foto-Kachel: Bild, darunter Uhrzeit, Benutzer und Beschreibung; im Auswahlmodus mit Häkchen */
function Thumb({ photo, selectable, selected, onOpen, onToggle }: { photo: Photo; selectable: boolean; selected: boolean; onOpen(): void; onToggle(): void }) {
  const src = usePhotoUrl(photo.id, 'thumb', photo.updatedAt);
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
  /** Kopf (Projektinfo + Knöpfe) sichtbar: oben immer; beim Runterscrollen weg, beim Hochscrollen wieder da */
  const [showInfo, setShowInfo] = useState(true);
  const [toTop, setToTop] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const stickyRef = useRef<HTMLDivElement>(null);
  const infoRef = useRef<HTMLDivElement>(null);
  /** womit die Auswahl begonnen wurde (Hinweis in der Leiste) */
  const [intent, setIntent] = useState<'pdf' | 'move' | null>(null);
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
    setIntent(null);
    setSelected(new Set());
  };
  const startSelecting = (why: 'pdf' | 'move' | null) => {
    setSelecting(true);
    setIntent(why);
  };
  // Scrollen: Projektinfo ausblenden (runter) bzw. einblenden (ein Stück hoch); Pfeil „nach oben“ ab 600 px
  useEffect(() => {
    let last = window.scrollY;
    let acc = 0;
    const onScroll = () => {
      const y = window.scrollY;
      const dy = y - last;
      last = y;
      setToTop(y > 600);
      if (y < 160) {
        acc = 0;
        setShowInfo(true);
        return;
      }
      acc = Math.sign(dy) === Math.sign(acc) ? acc + dy : dy;
      if (acc > 80) setShowInfo(false);
      else if (acc < -40) setShowInfo(true);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  // Höhe des haftenden Blocks und der Projektinfo als CSS-Variablen (für das Verschieben und die Wochen-Überschriften)
  useEffect(() => {
    const el = stickyRef.current;
    const page = el?.parentElement;
    if (!el || !page) return;
    const apply = () => {
      page.style.setProperty('--sticky-h', `${el.offsetHeight}px`);
      page.style.setProperty('--info-h', `${infoRef.current?.offsetHeight ?? 0}px`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    if (infoRef.current) ro.observe(infoRef.current);
    return () => ro.disconnect();
  }, [site, photos.length, selecting]);
  /** neu laden – falls inzwischen Fotos dazugekommen sind */
  const refresh = () => {
    setRefreshing(true);
    const before = photos.length;
    void reload()
      .then(() => {
        setRefreshing(false);
        setAll((list) => {
          const now = (list ?? []).filter((p) => photoSiteKey(p) === siteKey).length;
          const diff = now - before;
          toast(diff > 0 ? `${diff} ${diff === 1 ? 'neues Foto' : 'neue Fotos'}.` : 'Keine neuen Fotos.', diff > 0 ? 'success' : 'info');
          return list;
        });
      })
      .catch(() => setRefreshing(false));
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
  /** um 90° drehen und sofort in dieser Lage speichern (Bild, Vorschau und – falls vorhanden – Original) */
  const rotate = (p: Photo, dir: 'left' | 'right') =>
    run(async () => {
      const storage = getPhotoStorage();
      const b = await storage.blobs(p.id);
      if (!b) throw new Error('Bilddaten nicht gefunden.');
      const [main, thumb] = await Promise.all([rotateImage(b.data, dir), rotateImage(b.thumb, dir, 0.75)]);
      const original = b.original ? (await rotateImage(b.original, dir, 0.92).catch(() => null))?.data : undefined;
      await storage.put({ ...p, width: main.width, height: main.height }, { data: main.data, thumb: thumb.data, ...(original ? { original } : {}) });
      forgetPhotoUrl(p.id);
      await reload();
      toast('Gedreht und gespeichert.', 'success');
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
  /** Fotos als ZIP: ein Ordner, Dateinamen nach Datum und Uhrzeit (JJJJ-MM-TT_HHMM_Nr.jpg), sonst nichts */
  const downloadZip = (list: Photo[] = shown) =>
    run(async () => {
      if (list.length === 1) return download(list[0]);
      const files: Record<string, Uint8Array> = {};
      const sorted = [...list].sort((a, b) => a.takenAt - b.takenAt);
      for (const [i, p] of sorted.entries()) {
        const b = await getPhotoStorage().blobs(p.id);
        if (!b) continue;
        files[`${p.day}_${timeLabel(p.takenAt).replace(':', '')}_${String(i + 1).padStart(3, '0')}.jpg`] = new Uint8Array(b.original ?? b.data);
      }
      if (!Object.keys(files).length) return toast('Keine Fotos zum Herunterladen.', 'info');
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
      <div className={`page photos-page${showInfo ? '' : ' head-collapsed'}`}>
        <div ref={stickyRef} className={`photo-sticky${showInfo ? '' : ' collapsed'}`} data-testid="photo-sticky" data-collapsed={!showInfo || undefined}>
        <div ref={infoRef} className="photo-sticky-info">
        <header className="page-head page-head-row">
          <div className="page-head-title">
            <a href={paths.photos()} className="icon-link" aria-label="Zur Übersicht" title="Zur Übersicht" data-testid="to-photos">
              <Icon name="back" />
            </a>
            <div>
              <h1 data-testid="photo-site-title">{site?.name ?? '…'}</h1>
              <span className="muted small">
                {[site?.number, site?.address, photos.length > 0 ? `${photos.length} ${photos.length === 1 ? 'Foto' : 'Fotos'}` : ''].filter(Boolean).join(' · ')}
              </span>
            </div>
          </div>
          <div className="row gap">
            <button type="button" className="btn btn-sm" onClick={refresh} disabled={refreshing} title="Neu laden – falls inzwischen Fotos dazugekommen sind" data-testid="photo-refresh">
              <Icon name="refresh" size={16} className={refreshing ? 'spin' : undefined} /> Aktualisieren
            </button>
            <button type="button" className="btn btn-sm" onClick={() => downloadZip()} disabled={!shown.length} data-testid="photo-zip">
              <Icon name="zip" size={16} /> Alle als ZIP
            </button>
          </div>
        </header>

        {site && <PhotoCapture sites={[site]} site={site} existingHashes={hashes} onSaved={() => void reload()} big />}
        </div>

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
            <div className="row gap photo-actions">
              <button type="button" className={`btn btn-sm${selecting ? ' btn-primary' : ''}`} onClick={() => (selecting ? stopSelecting() : startSelecting(null))} data-testid="photo-select">
                <Icon name="check" size={16} /> {selecting ? 'Fertig' : 'Auswählen'}
              </button>
              {!selecting && (
                <>
                  <button type="button" className="btn btn-sm" onClick={() => startSelecting('move')} title="Fotos auswählen und zu einer anderen Baustelle verschieben" data-testid="photo-move">
                    <Icon name="move" size={16} /> Verschieben
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => startSelecting('pdf')} title="Fotos auswählen und als PDF ausgeben" data-testid="photo-pdf">
                    <Icon name="pdf" size={16} /> PDF
                  </button>
                </>
              )}
            </div>
          </div>
        )}
          {selecting && (
          <div className="photo-selection-bar" role="toolbar" aria-label="Auswahl" data-testid="photo-selection-bar">
            <strong>{chosen.length} ausgewählt</strong>
            {intent && chosen.length === 0 && (
              <span className="photo-selection-hint" data-testid="photo-selection-hint">
                Fotos antippen, dann „{intent === 'pdf' ? 'PDF' : 'Verschieben'}“
              </span>
            )}
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
            <button type="button" className={`btn btn-sm${intent === 'pdf' && chosen.length ? ' btn-primary' : ''}`} onClick={() => setPdfOpen(true)} disabled={!chosen.length} data-testid="photo-selected-pdf">
              <Icon name="pdf" size={16} /> PDF
            </button>
            <button type="button" className={`btn btn-sm${intent === 'move' && chosen.length ? ' btn-primary' : ''}`} onClick={() => setMoving(chosen)} disabled={!chosen.length} data-testid="photo-selected-move">
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
        </div>
        {all && photos.length === 0 && <p className="muted" data-testid="photo-site-empty">Noch keine Fotos auf dieser Baustelle.</p>}
        {photos.length > 0 && shown.length === 0 && <p className="muted">Keine Fotos gefunden.</p>}

        <div className="photo-stream" data-testid="photo-stream">
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
      {toTop && (
        <button type="button" className="photo-to-top" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="Nach oben zu den neuesten Fotos" title="Nach oben zu den neuesten Fotos" data-testid="photo-to-top">
          <Icon name="up" size={22} />
        </button>
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
          onRotate={(dir) => rotate(current, dir)}
          onDescription={(t) => saveDescription(current, t)}
        />
      )}
    </>
  );
}

interface Zoom {
  s: number;
  x: number;
  y: number;
}
const NO_ZOOM: Zoom = { s: 1, x: 0, y: 0 };
const MAX_ZOOM = 8;

/** Großansicht mit Blättern (Pfeiltasten, Wischen), Vergrößern (Mausrad, Doppelklick, zwei Finger, +/−), Angaben und Beschreibung */
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
  onRotate,
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
  onRotate(dir: 'left' | 'right'): void;
  onDescription(text: string): void;
}) {
  const src = usePhotoUrl(photo.id, 'data', photo.updatedAt);
  const [desc, setDesc] = useState(photo.description);
  const [editing, setEditing] = useState(false);
  /** Vergrößerung: Faktor und Verschiebung (Bildmitte = 0/0) */
  const [z, setZ] = useState<Zoom>(NO_ZOOM);
  const zRef = useRef(z);
  zRef.current = z;
  const body = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  useEffect(() => {
    setDesc(photo.description);
    setEditing(false);
    setZ(NO_ZOOM);
  }, [photo.id, photo.description]);
  /** Verschiebung so begrenzen, dass das Bild nicht aus dem Fenster rutscht */
  const clamp = (st: Zoom): Zoom => {
    const b = body.current;
    const im = img.current;
    if (!b || !im || st.s <= 1) return st.s <= 1 ? NO_ZOOM : st;
    const mx = Math.max(0, (im.clientWidth * st.s - b.clientWidth) / 2);
    const my = Math.max(0, (im.clientHeight * st.s - b.clientHeight) / 2);
    return { s: st.s, x: Math.min(mx, Math.max(-mx, st.x)), y: Math.min(my, Math.max(-my, st.y)) };
  };
  /** um den Faktor zoomen, der Punkt (cx, cy – relativ zur Mitte) bleibt an Ort und Stelle */
  const zoomAt = (factor: number, cx = 0, cy = 0, from: Zoom = zRef.current) => {
    const ns = Math.min(MAX_ZOOM, Math.max(1, from.s * factor));
    const k = ns / from.s;
    setZ(clamp({ s: ns, x: cx - (cx - from.x) * k, y: cy - (cy - from.y) * k }));
  };
  const center = (clientX: number, clientY: number) => {
    const r = body.current!.getBoundingClientRect();
    return [clientX - (r.left + r.width / 2), clientY - (r.top + r.height / 2)];
  };
  // Mausrad (auch mit Strg), Doppelklick, Ziehen; am Handy zwei Finger (Zoom), ein Finger (Verschieben bzw. Wischen)
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const [cx, cy] = center(e.clientX, e.clientY);
      zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0022)), cx, cy);
    };
    const onDbl = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('button')) return;
      const [cx, cy] = center(e.clientX, e.clientY);
      if (zRef.current.s > 1) setZ(NO_ZOOM);
      else zoomAt(2.5, cx, cy);
    };
    let drag: { x: number; y: number; zx: number; zy: number } | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || zRef.current.s <= 1 || e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, zx: zRef.current.x, zy: zRef.current.y };
      el.setPointerCapture(e.pointerId);
      e.preventDefault();
    };
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      setZ(clamp({ ...zRef.current, x: drag.zx + e.clientX - drag.x, y: drag.zy + e.clientY - drag.y }));
    };
    const onUp = () => (drag = null);
    let touch: { x: number; y: number; zx: number; zy: number; dist: number; start: Zoom; moved: boolean } | null = null;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onTS = (e: TouchEvent) => {
      const t = e.touches;
      if (t.length === 2) {
        touch = { x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2, zx: zRef.current.x, zy: zRef.current.y, dist: dist(t), start: zRef.current, moved: true };
        e.preventDefault();
      } else if (t.length === 1) touch = { x: t[0].clientX, y: t[0].clientY, zx: zRef.current.x, zy: zRef.current.y, dist: 0, start: zRef.current, moved: false };
    };
    const onTM = (e: TouchEvent) => {
      if (!touch) return;
      const t = e.touches;
      if (t.length === 2 && touch.dist) {
        e.preventDefault();
        const [cx, cy] = center((t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2);
        zoomAt(dist(t) / touch.dist, cx, cy, touch.start);
      } else if (t.length === 1 && zRef.current.s > 1) {
        e.preventDefault();
        touch.moved = true;
        setZ(clamp({ ...zRef.current, x: touch.zx + t[0].clientX - touch.x, y: touch.zy + t[0].clientY - touch.y }));
      }
    };
    const onTE = (e: TouchEvent) => {
      const t = touch;
      touch = null;
      if (!t || t.moved || zRef.current.s > 1 || !e.changedTouches.length) return;
      const dx = e.changedTouches[0].clientX - t.x;
      const dy = e.changedTouches[0].clientY - t.y;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) (dx < 0 ? onNext : onPrev)();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('dblclick', onDbl);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('touchstart', onTS, { passive: false });
    el.addEventListener('touchmove', onTM, { passive: false });
    el.addEventListener('touchend', onTE);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('dblclick', onDbl);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('touchstart', onTS);
      el.removeEventListener('touchmove', onTM);
      el.removeEventListener('touchend', onTE);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onNext, onPrev]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing) return;
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') onPrev();
      else if (e.key === 'ArrowRight') onNext();
      else if (e.key === '+') zoomAt(1.5);
      else if (e.key === '-') zoomAt(1 / 1.5);
      else if (e.key === '0') setZ(NO_ZOOM);
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
        <div className="lightbox-zoom" role="group" aria-label="Vergrößerung">
          <button type="button" className="icon-btn" onClick={() => zoomAt(1 / 1.5)} disabled={z.s <= 1} aria-label="Verkleinern" title="Verkleinern (−)" data-testid="lightbox-zoom-out">
            <Icon name="minus" size={18} />
          </button>
          <button type="button" className="lightbox-zoom-value" onClick={() => setZ(NO_ZOOM)} disabled={z.s <= 1} title="Auf Fenstergröße (0)" data-testid="lightbox-zoom">
            {Math.round(z.s * 100)} %
          </button>
          <button type="button" className="icon-btn" onClick={() => zoomAt(1.5)} disabled={z.s >= MAX_ZOOM} aria-label="Vergrößern" title="Vergrößern (+) – auch Mausrad, Doppelklick oder zwei Finger" data-testid="lightbox-zoom-in">
            <Icon name="plus" size={18} />
          </button>
        </div>
        <span className="muted small">
          {index + 1} / {total}
        </span>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Schließen" data-testid="lightbox-close">
          <Icon name="close" />
        </button>
      </header>
      <div ref={body} className={`lightbox-body${z.s > 1 ? ' zoomed' : ''}`} data-zoom={z.s.toFixed(2)}>
        {total > 1 && (
          <button type="button" className="lightbox-nav prev" onClick={onPrev} aria-label="Vorheriges Foto" data-testid="lightbox-prev">
            <Icon name="back" />
          </button>
        )}
        {src ? (
          <img ref={img} src={src} alt={photo.description || 'Foto'} draggable={false} style={{ transform: `translate(${z.x}px, ${z.y}px) scale(${z.s})` }} data-testid="lightbox-image" />
        ) : (
          <span className="muted">Wird geladen …</span>
        )}
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
          <button type="button" className="btn btn-sm" onClick={() => onRotate('left')} title="Nach links drehen (wird sofort gespeichert)" data-testid="lightbox-rotate-left">
            <Icon name="rotate" size={16} className="flip-x" /> Links
          </button>
          <button type="button" className="btn btn-sm" onClick={() => onRotate('right')} title="Nach rechts drehen (wird sofort gespeichert)" data-testid="lightbox-rotate-right">
            <Icon name="rotate" size={16} /> Rechts
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
