import { useMemo, useState } from 'react';
import { PAPER } from '../lib/drawing';
import { hiddenLayerNames } from '../lib/layers';
import { exportPaper } from '../lib/sheet-layout';
import { costCenterName, costCentersOf, damagesOf, planTitle, plansOf, type ExportFile } from '../lib/aufmass';
import type { OverviewCorner } from '../lib/export-pdf';
import type { ProjectState } from '../lib/store';
import { Modal } from './Modal';
import { showError } from './ui';
import { PdfPreview } from './PdfPreview';

interface Props {
  data: ProjectState;
  /** Auswahl begrenzen auf eine Kostenstelle */
  costCenterId?: string;
  /** vorausgewählte Pläne */
  initial: string[];
  onClose: () => void;
}

/** Auswahl der Pläne für den PDF-Export (einzelner Plan oder mehrere). */
export function PdfExportDialog({ data, costCenterId, initial, onClose }: Props) {
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
  const [preview, setPreview] = useState<ExportFile | null>(null);
  // Übersicht des Gesamtplans (nur bei Plänen mit Ausschnitt); Einstellung wird gemerkt
  const [overview, setOverview] = useState(() => readPref('pdfOverview', '1') === '1');
  const [corner, setCorner] = useState<OverviewCorner>(() => (readPref('pdfOverviewCorner', 'tr') as OverviewCorner));
  const anyCrop = [...selected].some((id) => data.plans[id]?.crop && data.plans[id]?.source !== 'drawing');
  const allIds = groups.flatMap((g) => g.plans.map((p) => p.id));
  const toggle = (id: string) => {
    const s = new Set(selected);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setSelected(s);
  };

  const run = async () => {
    setBusy(true);
    try {
      const { exportPlansPdf } = await import('../lib/export-pdf');
      const ordered = allIds.filter((id) => selected.has(id));
      writePref('pdfOverview', overview ? '1' : '0');
      writePref('pdfOverviewCorner', corner);
      // erst Vorschau, dort speichern (Ordner wählen, teilen oder herunterladen)
      setPreview(await exportPlansPdf(data, { planIds: ordered, overview: { enabled: overview, corner } }));
    } catch (e) {
      showError(e, 'PDF-Export fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  };

  if (preview) return <PdfPreview file={preview} onBack={() => setPreview(null)} onClose={onClose} />;
  return (
    <Modal
      title="Pläne als PDF exportieren"
      onClose={onClose}
      testId="pdf-export-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" disabled={busy || !selected.size} onClick={() => void run()} data-testid="pdf-export-run">
            {busy ? 'PDF wird erstellt …' : `${selected.size} Plan/Pläne – Vorschau`}
          </button>
        </>
      }
    >
      <p className="muted">
        Jeder ausgewählte Plan wird als eigene Seite im gewählten Papierformat (A4/A3) mit allen Markierungen und Nummern
        ausgegeben – proportional eingepasst, mit 1 cm Rand. Das Format lässt sich in den Planangaben ändern. Die
        Originaldateien bleiben unverändert.
      </p>
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
                  · {damagesOf(data, p.id).length} Schadstellen · <span data-testid="pdf-plan-paper">{PAPER[exportPaper(p)].label}</span>
                  {hiddenLayerNames(p).length > 0 && (
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
      {anyCrop && (
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
