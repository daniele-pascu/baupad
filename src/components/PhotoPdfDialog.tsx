import { useState } from 'react';
import { getCompanyLogo } from '../lib/company';
import { getMeta } from '../lib/db';
import { DEFAULT_PDF_OPTIONS, PDF_MAX_PX, photoPdf, type PhotoPdfOptions, type PhotoPdfQuality } from '../lib/photo-pdf';
import { getPhotoStorage } from '../lib/photo-storage';
import { shrinkJpeg } from '../lib/photos';
import type { Photo, PhotoSite } from '../lib/types';
import { Modal } from './Modal';
import { offerFile, showError } from './ui';

type Opts = Omit<PhotoPdfOptions, 'company' | 'logo'>;
const KEY = 'photoPdfOptions';
function loadOpts(): Opts {
  try {
    return { ...DEFAULT_PDF_OPTIONS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Opts>) };
  } catch {
    return { ...DEFAULT_PDF_OPTIONS };
  }
}

const QUALITY: { id: PhotoPdfQuality; label: string; hint: string }[] = [
  { id: 'klein', label: 'Klein', hint: 'bis 1000 px – kleine Datei, zum Versenden' },
  { id: 'mittel', label: 'Mittel', hint: 'bis 2000 px – gut zum Drucken' },
  { id: 'hoch', label: 'Hoch', hint: 'Originalgröße, sofern gespeichert – größte Datei' },
];

/** Foto-PDF mit Optionen: Umfang, Fotos je Seite, Format, Qualität, Logo-Position, Angaben, Gruppierung */
export function PhotoPdfDialog({ site, selection, all, onClose }: { site: PhotoSite; selection: Photo[]; all: Photo[]; onClose(): void }) {
  const [o, setO] = useState<Opts>(loadOpts);
  const [scope, setScope] = useState<'selection' | 'all'>(selection.length ? 'selection' : 'all');
  const [progress, setProgress] = useState<string | null>(null);
  const set = <K extends keyof Opts>(k: K, v: Opts[K]) => setO((prev) => ({ ...prev, [k]: v }));
  const photos = scope === 'selection' ? selection : all;

  const create = async () => {
    setProgress('Wird vorbereitet …');
    try {
      try {
        localStorage.setItem(KEY, JSON.stringify(o));
      } catch {
        /* egal */
      }
      const [company, logo] = await Promise.all([getMeta<string>('companyName'), getCompanyLogo()]);
      let n = 0;
      const load = async (p: Photo, q: PhotoPdfQuality) => {
        setProgress(`Foto ${++n} von ${photos.length} …`);
        const b = await getPhotoStorage().blobs(p.id);
        if (!b) return null;
        if (q === 'hoch' && b.original) return new Uint8Array(b.original);
        if (q === 'klein') return new Uint8Array(await shrinkJpeg(b.data, PDF_MAX_PX.klein));
        return new Uint8Array(b.data);
      };
      await offerFile(await photoPdf(site, photos, load, { ...o, company: company ?? '', logo }));
      onClose();
    } catch (e) {
      showError(e, 'PDF konnte nicht erstellt werden');
    } finally {
      setProgress(null);
    }
  };

  const check = (k: keyof Opts, label: string, testId: string) => (
    <label className="check">
      <input type="checkbox" checked={!!o[k]} onChange={(e) => set(k, e.target.checked as never)} data-testid={testId} /> {label}
    </label>
  );

  return (
    <Modal
      title="PDF erstellen"
      onClose={() => !progress && onClose()}
      testId="photo-pdf-dialog"
      persistent
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={!!progress}>
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void create()} disabled={!!progress || !photos.length} data-testid="photo-pdf-create">
            {progress ?? `PDF mit ${photos.length} ${photos.length === 1 ? 'Foto' : 'Fotos'} erstellen`}
          </button>
        </>
      }
    >
      <div className="pdf-options">
        {selection.length > 0 && (
          <fieldset className="field">
            <span>Umfang</span>
            <div className="segmented" role="radiogroup">
              <button type="button" role="radio" aria-checked={scope === 'selection'} aria-selected={scope === 'selection'} onClick={() => setScope('selection')} data-testid="pdf-scope-selection">
                Auswahl ({selection.length})
              </button>
              <button type="button" role="radio" aria-checked={scope === 'all'} aria-selected={scope === 'all'} onClick={() => setScope('all')} data-testid="pdf-scope-all">
                Alle angezeigten ({all.length})
              </button>
            </div>
          </fieldset>
        )}
        <label className="field">
          <span>Titel</span>
          <input value={o.title ?? ''} onChange={(e) => set('title', e.target.value)} placeholder="Fotodokumentation" data-testid="pdf-title" />
        </label>
        <div className="form-row">
          <label className="field">
            <span>Fotos je Seite</span>
            <select value={o.perPage} onChange={(e) => set('perPage', Number(e.target.value) as Opts['perPage'])} data-testid="pdf-per-page">
              {[1, 2, 4, 6].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Format</span>
            <select value={o.landscape ? 'quer' : 'hoch'} onChange={(e) => set('landscape', e.target.value === 'quer')} data-testid="pdf-format">
              <option value="hoch">A4 hoch</option>
              <option value="quer">A4 quer</option>
            </select>
          </label>
          <label className="field">
            <span>Logo</span>
            <select value={o.logoRight ? 'rechts' : 'links'} onChange={(e) => set('logoRight', e.target.value === 'rechts')} data-testid="pdf-logo">
              <option value="rechts">rechts oben</option>
              <option value="links">links oben</option>
            </select>
          </label>
        </div>
        <fieldset className="field">
          <span>Bildqualität</span>
          <div className="radio-list">
            {QUALITY.map((q) => (
              <label key={q.id} className="check">
                <input type="radio" name="pdf-quality" value={q.id} checked={o.quality === q.id} onChange={() => set('quality', q.id)} data-testid={`pdf-quality-${q.id}`} /> <strong>{q.label}</strong>
                <span className="muted small"> – {q.hint}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="field">
          <span>Angaben je Foto</span>
          <div className="check-inline">
            {check('numbering', 'Nummer', 'pdf-number')}
            {check('showDate', 'Datum & Uhrzeit', 'pdf-date')}
            {check('showUser', 'Aufgenommen von', 'pdf-user')}
            {check('showDescription', 'Beschreibung', 'pdf-desc')}
          </div>
        </fieldset>
        <div className="form-row">
          <label className="field">
            <span>Überschrift und neue Seite je</span>
            <select value={o.groupBy} onChange={(e) => set('groupBy', e.target.value as Opts['groupBy'])} data-testid="pdf-group">
              <option value="week">Kalenderwoche</option>
              <option value="day">Tag</option>
              <option value="month">Monat</option>
              <option value="none">keine – fortlaufend</option>
            </select>
          </label>
          <label className="field">
            <span>Reihenfolge</span>
            <select value={o.oldestFirst ? 'alt' : 'neu'} onChange={(e) => set('oldestFirst', e.target.value === 'alt')} data-testid="pdf-order">
              <option value="alt">älteste zuerst</option>
              <option value="neu">neueste zuerst</option>
            </select>
          </label>
        </div>
        <p className="muted small">Firmenname und Logo kommen aus den Konto-Einstellungen. Die Einstellungen hier werden für das nächste PDF gemerkt.</p>
      </div>
    </Modal>
  );
}
