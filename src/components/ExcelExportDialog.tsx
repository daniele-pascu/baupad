import { useState } from 'react';
import { exportXlsx, lvDocsOf, type XlsxLayout, type XlsxScope } from '../lib/aufmass';
import { defaultPeriod, exportAufmassblatt } from '../lib/aufmassblatt';
import { cachedExcelLogo } from '../lib/company';
import { updateProject, type ProjectState } from '../lib/store';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { offerFile, showError } from './ui';

/** nächste freie Aufmaßblatt-Nummer, dreistellig (001, 002 …) */
export const nextSheetNo = (data: ProjectState) => String((data.project.sheetNo ?? 0) + 1).padStart(3, '0');

/**
 * Excel-Export: Aufmaßblatt nach Firmenvorlage (Nummer wird vergeben und hochgezählt,
 * Leistungszeitraum aus den Messungen vorgeschlagen); weitere Formate darunter.
 */
export function ExcelExportDialog({ data, scope, onClose }: { data: ProjectState; scope: XlsxScope; onClose: () => void }) {
  const [no, setNo] = useState(() => nextSheetNo(data));
  const [period, setPeriod] = useState(() => defaultPeriod(data, scope));

  const run = (fn: () => void) => {
    try {
      fn();
      onClose();
    } catch (e) {
      showError(e, 'Excel-Export fehlgeschlagen');
    }
  };
  const blatt = () =>
    run(() => {
      const nr = no.trim() || nextSheetNo(data);
      // Firmenlogo (Konto → Einstellungen) kommt automatisch links in die Kopfzeile
      void offerFile(exportAufmassblatt(data, scope, { no: nr, period: period.trim() }, { logo: cachedExcelLogo() }));
      const n = Number(nr);
      if (Number.isInteger(n) && n > (data.project.sheetNo ?? 0)) updateProject({ sheetNo: n });
    });
  const other = (layout: XlsxLayout) => run(() => void offerFile(exportXlsx(data, scope, layout, { logo: cachedExcelLogo() })));

  return (
    <Modal
      title="Excel – Aufmaßblatt"
      onClose={onClose}
      testId="excel-export"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" onClick={blatt} data-testid="blatt-export">
            <Icon name="excel" /> Aufmaßblatt erstellen
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          blatt();
        }}
      >
        <div className="form-grid">
          <label className="field">
            <span>Aufmaßblatt-Nr.</span>
            <input value={no} onChange={(e) => setNo(e.target.value)} inputMode="numeric" autoComplete="off" data-testid="blatt-no" />
          </label>
          <label className="field">
            <span>Leistungszeitraum</span>
            <input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="z. B. 01.10.2026 – 26.10.2026" autoComplete="off" data-testid="blatt-period" />
          </label>
        </div>
        <p className="muted small">
          Wie die Firmenvorlage: Firmenlogo links in der Kopfzeile, Bauvorhaben, Kostenstelle und Leistungszeitraum; je LV/MFK die Positionen mit ihren
          Messungen (Stk., m, m², m³, l) und Zusammenstellung in EUR. Messungen ohne Position folgen mit Plan und Nr. Die Nummer wird beim nächsten Mal
          automatisch hochgezählt.
        </p>
        <button type="submit" hidden />
      </form>
      <div className="excel-other">
        <span className="muted small">Weitere Formate:</span>
        <button type="button" className="btn btn-sm" onClick={() => other('standard')} data-testid="xlsx-overview">
          Übersicht &amp; Messliste
        </button>
        <button type="button" className="btn btn-sm" onClick={() => other('classic')} data-testid="xlsx-classic">
          Klassisch
        </button>
        {lvDocsOf(data).length > 0 && (
          <button type="button" className="btn btn-sm" onClick={() => other('positions')} data-testid="xlsx-positions">
            Nach Leistungen
          </button>
        )}
      </div>
    </Modal>
  );
}
