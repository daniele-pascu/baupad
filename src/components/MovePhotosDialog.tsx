import { useState } from 'react';
import { getPhotoStorage } from '../lib/photo-storage';
import type { Photo, PhotoSite } from '../lib/types';
import { Modal } from './Modal';
import { PhotoSitePicker, siteValue } from './PhotoSitePicker';
import { showError, toast } from './ui';

/** Fotos einer anderen Baustelle zuordnen (falsch einsortiert) – auch neue Baustelle möglich */
export function MovePhotosDialog({ photos, sites, from, onClose, onMoved }: { photos: Photo[]; sites: PhotoSite[]; from: PhotoSite | null; onClose(): void; onMoved(target: PhotoSite): void }) {
  const [list, setList] = useState(sites);
  const [target, setTarget] = useState<PhotoSite | null>(null);
  const [busy, setBusy] = useState(false);
  const same = target && from && siteValue(target) === siteValue(from);
  const move = async () => {
    if (!target || same) return;
    setBusy(true);
    try {
      const storage = getPhotoStorage();
      const now = Date.now();
      for (const p of photos) await storage.update({ ...p, projectId: target.projectId, siteName: target.name, siteNumber: target.number, siteAddress: target.address, updatedAt: now });
      toast(`${photos.length} ${photos.length === 1 ? 'Foto' : 'Fotos'} nach „${target.name}“ verschoben.`, 'success');
      onMoved(target);
    } catch (e) {
      showError(e, 'Fotos konnten nicht verschoben werden');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`${photos.length} ${photos.length === 1 ? 'Foto' : 'Fotos'} verschieben`}
      onClose={onClose}
      testId="photo-move-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void move()} disabled={busy || !target || !!same} data-testid="photo-move-save">
            Verschieben
          </button>
        </>
      }
    >
      <label className="field">
        <span>Zur Baustelle</span>
        <PhotoSitePicker sites={list} value={target} onChange={setTarget} onCreated={(s) => setList((l) => [...l, s])} testId="photo-move-site" />
      </label>
      {same && <p className="warn-text small">Die Fotos sind schon auf dieser Baustelle.</p>}
      <p className="muted small">Kalenderwoche, Tag, Uhrzeit und Beschreibung bleiben erhalten.</p>
    </Modal>
  );
}
