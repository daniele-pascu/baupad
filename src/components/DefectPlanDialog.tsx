import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { PhotoSitePicker } from './PhotoSitePicker';
import { showError } from './ui';
import { createDefectPlan } from '../lib/defects';
import { getBlob, loadProjectData } from '../lib/db';
import { planTitle } from '../lib/aufmass';
import { SourceThumb } from './PlanLibrary';
import type { SourceFile } from '../lib/types';
import { useProjectIn } from '../lib/sites';
import type { DefectPlan, PhotoSite } from '../lib/types';

/**
 * Plan in den Mängelplan hochladen: Baustelle wählen (oder neu anlegen), Titel, Datei (PDF erste Seite oder Foto).
 * Kein Maßstab, keine Kalibrierung – das Bild wird so übernommen, wie es ist.
 */
export function DefectPlanDialog({ sites, site, fromLibrary = false, onClose, onCreated }: { sites: PhotoSite[]; site?: PhotoSite | null; /** nur Auswahl aus der Planbibliothek */ fromLibrary?: boolean; onClose(): void; onCreated(plan: DefectPlan): void }) {
  const [chosen, setChosen] = useState<PhotoSite | null>(site ?? null);
  const [list, setList] = useState(sites);
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setList(sites), [sites]);
  // Planbibliothek des Projekts (Aufmaß & Abrechnung): Originalpläne je Seite zur Auswahl
  const [lib, setLib] = useState<{ file: SourceFile; pageIndex: number; label: string }[]>([]);
  const [libPick, setLibPick] = useState<{ file: SourceFile; pageIndex: number; label: string } | null>(null);
  useEffect(() => {
    setLib([]);
    setLibPick(null);
    const pid = chosen?.projectId;
    if (!pid) return;
    let live = true;
    void loadProjectData(pid).then((d) => {
      if (!live || !d) return;
      const plans = d.plans.filter((p) => !p.deletedAt && p.source !== 'drawing');
      const out: { file: SourceFile; pageIndex: number; label: string }[] = [];
      for (const f of d.files.filter((x) => !x.deletedAt).sort((a, b) => b.createdAt - a.createdAt)) {
        const pages = Math.max(1, Math.min(f.pageCount || 1, 40));
        for (let i = 0; i < pages; i++) {
          const used = plans.find((p) => p.fileId === f.id && p.pageIndex === i);
          const base = used ? planTitle(used) : f.name.replace(/\.[^.]+$/, '');
          out.push({ file: f, pageIndex: i, label: (f.pageCount || 1) > 1 && !used ? `${base} – Seite ${i + 1}` : base });
        }
      }
      setLib(out);
    });
    return () => {
      live = false;
    };
  }, [chosen?.projectId]);

  const save = async () => {
    if (!chosen) return showError(new Error('Bitte ein Projekt wählen.'), 'Plan nicht gespeichert');
    if (!file && !libPick) return showError(new Error('Bitte einen Plan als PDF oder Bild wählen.'), 'Plan nicht gespeichert');
    setBusy(true);
    try {
      let plan: DefectPlan;
      if (libPick && !file) {
        const buf = await getBlob(libPick.file.id);
        if (!buf) throw new Error('Originalplan nicht gefunden – bitte mit Internetverbindung erneut versuchen.');
        const f = new File([buf], libPick.file.name, { type: libPick.file.mimeType || (libPick.file.kind === 'pdf' ? 'application/pdf' : 'image/jpeg') });
        plan = await createDefectPlan(chosen, title || libPick.label, f, libPick.pageIndex);
      } else plan = await createDefectPlan(chosen, title, file!);
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
      title={fromLibrary ? 'Plan aus der Planbibliothek' : 'Plan hochladen'}
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
        {!fromLibrary && (
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
              if (f) setLibPick(null);
              if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ''));
            }}
          />
          <p className="muted small">Ohne Maßstab: Der Plan dient nur zum Markieren, es wird nichts gemessen.</p>
        </div>
        )}
        {lib.length > 0 && (
          <div className="field" data-testid="defect-library">
            <span>{fromLibrary ? `Planbibliothek des Projekts (${lib.length})` : `Oder aus der Planbibliothek des Projekts (${lib.length})`}</span>
            <div className="defect-lib-grid">
              {lib.map((x) => {
                const on = libPick?.file.id === x.file.id && libPick.pageIndex === x.pageIndex;
                return (
                  <button
                    key={`${x.file.id}:${x.pageIndex}`}
                    type="button"
                    className={`defect-lib-item${on ? ' on' : ''}`}
                    onClick={() => {
                      setLibPick(on ? null : x);
                      setFile(null);
                      if (!on && (!title || lib.some((y) => y.label === title))) setTitle(x.label);
                    }}
                    aria-pressed={on}
                    data-testid="defect-library-item"
                  >
                    <SourceThumb file={x.file} pageIndex={x.pageIndex} crop={null} />
                    <span className="small">{x.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
