import { useMemo, useState } from 'react';
import { costCenterLabel, costCentersOf, damagesOf, planTitle, plansOf } from '../lib/aufmass';
import type { ProjectState } from '../lib/store';
import { Modal } from './Modal';
import { offerFile, showError } from './ui';

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
      const file = await exportPlansPdf(data, { planIds: ordered });
      onClose();
      await offerFile(file);
    } catch (e) {
      showError(e, 'PDF-Export fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  };

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
            {busy ? 'PDF wird erstellt …' : `${selected.size} Plan/Pläne exportieren`}
          </button>
        </>
      }
    >
      <p className="muted">
        Jeder ausgewählte Plan wird als eigene Seite mit allen Markierungen, Nummern, Plannummer und Planbezeichnung
        ausgegeben. Die Originaldateien bleiben unverändert.
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
          <legend>{costCenterLabel(cc)}</legend>
          {plans.map((p) => (
            <label key={p.id} className="check-row">
              <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
              <span>
                {planTitle(p)} <span className="muted">· {damagesOf(data, p.id).length} Schadstellen</span>
              </span>
            </label>
          ))}
        </fieldset>
      ))}
      {!groups.length && <p>Keine Pläne vorhanden.</p>}
    </Modal>
  );
}
