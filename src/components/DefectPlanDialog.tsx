import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { PhotoSitePicker } from './PhotoSitePicker';
import { showError } from './ui';
import { createDefectPlan } from '../lib/defects';
import { useProjectIn } from '../lib/sites';
import type { DefectPlan, PhotoSite } from '../lib/types';

/**
 * Plan in den Mängelplan hochladen: Baustelle wählen (oder neu anlegen), Titel, Datei (PDF erste Seite oder Foto).
 * Kein Maßstab, keine Kalibrierung – das Bild wird so übernommen, wie es ist.
 */
export function DefectPlanDialog({ sites, site, onClose, onCreated }: { sites: PhotoSite[]; site?: PhotoSite | null; onClose(): void; onCreated(plan: DefectPlan): void }) {
  const [chosen, setChosen] = useState<PhotoSite | null>(site ?? null);
  const [list, setList] = useState(sites);
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setList(sites), [sites]);

  const save = async () => {
    if (!chosen) return showError(new Error('Bitte ein Projekt wählen.'), 'Plan nicht gespeichert');
    if (!file) return showError(new Error('Bitte einen Plan als PDF oder Bild wählen.'), 'Plan nicht gespeichert');
    setBusy(true);
    try {
      const plan = await createDefectPlan(chosen, title, file);
      await useProjectIn(chosen.projectId, 'defects');
      onCreated(plan);
    } catch (e) {
      showError(e, 'Plan konnte nicht übernommen werden');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Plan hochladen"
      onClose={onClose}
      testId="defect-plan-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy} data-testid="defect-plan-save">
            {busy ? 'Wird übernommen …' : 'Plan übernehmen'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        {!site && (
          <label className="field">
            <span>Projekt *</span>
            <PhotoSitePicker sites={list} value={chosen} onChange={setChosen} onCreated={(s) => setList((l) => [...l, s])} />
          </label>
        )}
        <label className="field">
          <span>Bezeichnung des Plans</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="z. B. EG Parkdeck, Fassade Nord" data-testid="defect-plan-title" />
        </label>
        <div className="field">
          <span>Plan (PDF, erste Seite – oder Foto/Bild) *</span>
          <div className="row gap wrap">
            <button type="button" className="btn" onClick={() => input.current?.click()} data-testid="defect-plan-pick">
              <Icon name="upload" size={16} /> {file ? 'Andere Datei' : 'Datei wählen'}
            </button>
            {file && <span className="small">{file.name}</span>}
          </div>
          <input
            ref={input}
            type="file"
            accept="application/pdf,image/*,.pdf,.png,.jpg,.jpeg"
            hidden
            data-testid="defect-plan-file"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ''));
            }}
          />
          <p className="muted small">Ohne Maßstab: Der Plan dient nur zum Markieren, es wird nichts gemessen.</p>
        </div>
      </div>
    </Modal>
  );
}
