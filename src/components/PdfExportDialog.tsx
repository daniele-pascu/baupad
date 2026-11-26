import { useMemo, useState } from 'react';
import { PAPER } from '../lib/drawing';
import { hiddenLayerNames } from '../lib/layers';
import { exportPaper } from '../lib/sheet-layout';
import { costCenterName, costCentersOf, damagesOf, planTitle, plansOf, type ExportFile } from '../lib/aufmass';
import type { OverviewCorner } from '../lib/export-pdf';
import type { ProjectState } from '../lib/store';
import { Modal } from './Modal';
import { showError } from './ui';
import { ProgressRing } from './ProgressRing';
import { PdfPreview } from './PdfPreview';

interface Props {
  data: ProjectState;
  /** Auswahl begrenzen auf eine Kostenstelle */
  costCenterId?: string;
  /** vorausgewählte Pläne */
  initial: string[];
  /** 'plans' = Pläne als PDF, 'photos' = Fotos der Messungen als eigenes PDF (eigene Taste „Fotos exportieren“) */
  mode?: 'plans' | 'photos';
  onClose: () => void;
}

/** Auswahl der Pläne für den PDF-Export (einzelner Plan oder mehrere) bzw. für den Foto-Export. */
export function PdfExportDialog({ data, costCenterId, initial, mode = 'plans', onClose }: Props) {
  const photos = mode === 'photos';
  const groups = useMemo(
    () =>
      costCentersOf(data)
        .filter((c) => !costCenterId || c.id === costCenterId)
        .map((cc) => ({ cc, plans: plansOf(data, cc.id) }))
        .filter((g) => g.plans.length),
    [data, costCenterId],
  );
  const [selected, setSelected] = useState<Set<string>>(new Set(initial));
  const [busy, setBusy] = useState(false);
  /** echter Fortschritt 0–1, solange das PDF entsteht */
  const [progress, setProgress] = useState(0);
  const [preview, setPreview] = useState<ExportFile | null>(null);
  // Übersicht des Gesamtplans (nur bei Plänen mit Ausschnitt); Einstellung wird gemerkt
  const [overview, setOverview] = useState(() => readPref('pdfOverview', '1') === '1');
  const [corner, setCorner] = useState<OverviewCorner>(() => (readPref('pdfOverviewCorner', 'tr') as OverviewCorner));
  // BauPad-Logo in der Kopfzeile: Standard aus (manche Baustellen wollen kein App-Zeichen); Wahl wird gemerkt
  const [brand, setBrand] = useState(() => readPref('pdfBrand', '0') === '1');
  const photosOf = (id: string) => damagesOf(data, id).reduce((k, d) => k + (d.photoIds?.length ?? 0), 0);
  const photoCount = [...selected].reduce((n, id) => n + photosOf(id), 0);
  const anyCrop = [...selected].some((id) => data.plans[id]?.crop && data.plans[id]?.source !== 'drawing');
  const allIds = groups.flatMap((g) => g.plans.map((p) => p.id));
  const toggle = (id: string) => {
    const s = new Set(selected);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setSelected(s);
  };

  const run = async () => {
    setProgress(0);
    setBusy(true);
    try {
      const { exportPlansPdf } = await import('../lib/export-pdf');
      const ordered = allIds.filter((id) => selected.has(id));
      writePref('pdfOverview', overview ? '1' : '0');
      writePref('pdfOverviewCorner', corner);
      writePref('pdfBrand', brand ? '1' : '0');
      // erst Vorschau, dort speichern (Ordner wählen, teilen oder herunterladen)
      setPreview(await exportPlansPdf(data, { planIds: ordered, overview: { enabled: overview, corner }, brand, onProgress: setProgress }));
    } catch (e) {
      showError(e, 'PDF-Export fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  };

  // Foto-PDF: eigene Datei, jedes Foto mit Plan, Nummer und Position beschriftet
  const runPhotos = async () => {
    setProgress(0);
    setBusy(true);
    try {
      const { exportPhotosPdf } = await import('../lib/export-pdf');
      setPreview(await exportPhotosPdf(data, allIds.filter((id) => selected.has(id)), setProgress));
    } catch (e) {
      showError(e, 'Foto-PDF fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  };

  if (preview) return <PdfPreview file={preview} onBack={() => setPreview(null)} onClose={onClose} />;
  return (
    <Modal
      title={photos ? 'Fotos exportieren' : 'Pläne als PDF exportieren'}
      onClose={onClose}
      testId={photos ? 'photos-export-dialog' : 'pdf-export-dialog'}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          {busy ? (
            // statt des Knopfs: Fortschrittsring, solange das PDF entsteht
            <ProgressRing value={progress} label="PDF wird erstellt" testId="pdf-progress" />
          ) : photos ? (
            <button type="button" className="btn btn-primary" disabled={!photoCount} onClick={() => void runPhotos()} data-testid="pdf-photos-run" title="Eigenes PDF: jedes Foto mit Plan, Nummer und Position">
              {`${photoCount} ${photoCount === 1 ? 'Foto' : 'Fotos'} – Vorschau`}
            </button>
          ) : (
            <button type="button" className="btn btn-primary" disabled={!selected.size} onClick={() => void run()} data-testid="pdf-export-run">
              {`${selected.size} Plan/Pläne – Vorschau`}
            </button>
          )}
        </>
      }
    >
      {photos ? (
        <p className="muted">
          Alle Fotos der Messungen in den ausgewählten Plänen als eigenes PDF – je Foto ein großes Bild, beschriftet mit Plan
          und Nummer der Messung (und der Position, wenn zugeordnet). Zwei Fotos je A4-Seite.
        </p>
      ) : (
        <p className="muted">
          Jeder ausgewählte Plan wird als eigene Seite im gewählten Papierformat (A4/A3) mit allen Markierungen und Nummern
          ausgegeben – proportional eingepasst, mit 1 cm Rand. Das Format lässt sich in den Planangaben ändern. Die
          Originaldateien bleiben unverändert.
        </p>
      )}
      <div className="row gap">
        <button type="button" className="btn btn-sm" onClick={() => setSelected(new Set(allIds))}>
          Alle auswählen
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setSelected(new Set())}>
          Keine
        </button>
      </div>
      {groups.map(({ cc, plans }) => (
        <fieldset key={cc.id} className="check-group">
          <legend>{costCenterName(cc)}</legend>
          {plans.map((p) => (
            <label key={p.id} className="check-row">
              <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
              <span>
                {planTitle(p)}{' '}
                <span className="muted">
                  {photos ? (
                    <> · {photosOf(p.id)} {photosOf(p.id) === 1 ? 'Foto' : 'Fotos'}</>
                  ) : (
                    <>
                      · {damagesOf(data, p.id).length} {damagesOf(data, p.id).length === 1 ? 'Messung' : 'Messungen'} · <span data-testid="pdf-plan-paper">{PAPER[exportPaper(p)].label}</span>
                    </>
                  )}
                  {!photos && hiddenLayerNames(p).length > 0 && (
                    <span className="warn-text" data-testid="pdf-hidden-layers">
                      {' '}
                      · ausgeblendet: {hiddenLayerNames(p).join(', ')}
                    </span>
                  )}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      ))}
      {!groups.length && <p>Keine Pläne vorhanden.</p>}
      {!photos && (
        <fieldset className="check-group" data-testid="pdf-brand-options">
          <legend>Kennzeichnung</legend>
          <label className="check-row">
            <input type="checkbox" checked={brand} onChange={(e) => setBrand(e.target.checked)} data-testid="pdf-brand" />
            <span>BauPad-Logo rechts in der Kopfzeile („PAD Software · BauPad“)</span>
          </label>
        </fieldset>
      )}
      {!photos && anyCrop && (
        <fieldset className="check-group" data-testid="pdf-overview-options">
          <legend>Planausschnitte</legend>
          <label className="check-row">
            <input type="checkbox" checked={overview} onChange={(e) => setOverview(e.target.checked)} data-testid="pdf-overview" />
            <span>Kleine Übersicht des Gesamtplans mit rot markiertem Ausschnitt (im Seitenrand, verdeckt nichts)</span>
          </label>
          {overview && (
            <label className="field">
              <span>Position</span>
              <select value={corner} onChange={(e) => setCorner(e.target.value as OverviewCorner)} data-testid="pdf-overview-corner">
                <option value="tr">oben rechts</option>
                <option value="br">unten rechts</option>
                <option value="tl">oben links</option>
                <option value="bl">unten links</option>
              </select>
            </label>
          )}
        </fieldset>
      )}
    </Modal>
  );
}

function readPref(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* optional */
  }
}
