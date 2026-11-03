import { useMemo, useState } from 'react';
import { costCenterName, costCentersOf, damagesOf, planTitle, plansOf } from '../lib/aufmass';
import { defaultPeriod, exportAufmassblatt, plansIn, type BlattScope } from '../lib/aufmassblatt';
import { cachedExcelLogo } from '../lib/company';
import { updateProject, type ProjectState } from '../lib/store';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { offerFile, showError } from './ui';

/** nächste freie Aufmaßblatt-Nummer, dreistellig (001, 002 …) */
export const nextSheetNo = (data: ProjectState) => String((data.project.sheetNo ?? 0) + 1).padStart(3, '0');

/**
 * Excel-Export: Aufmaßblatt nach Firmenvorlage (Nummer wird vergeben und hochgezählt,
 * Leistungszeitraum aus den Messungen vorgeschlagen).
 */
export function ExcelExportDialog({ data, scope, onClose }: { data: ProjectState; scope: BlattScope; onClose: () => void }) {
  const [no, setNo] = useState(() => nextSheetNo(data));
  // Pläne frei zusammenstellen: vorausgewählt ist, was exportiert werden soll (Plan, Kostenstelle, Projekt)
  const initial = useMemo(() => plansIn(data, scope).map((p) => p.id), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [sel, setSel] = useState<Set<string>>(() => new Set(initial));
  const pickable = scope.kind !== 'invoice'; // Rechnung: Pläne der Rechnung
  const groups = useMemo(() => costCentersOf(data).map((cc) => ({ cc, plans: plansOf(data, cc.id) })).filter((g) => g.plans.length), [data]);
  const allIds = groups.flatMap((g) => g.plans.map((p) => p.id));
  const same = sel.size === initial.length && initial.every((id) => sel.has(id));
  const effective: BlattScope = !pickable || same ? scope : { kind: 'plans', planIds: allIds.filter((id) => sel.has(id)) };
  const [period, setPeriod] = useState(() => defaultPeriod(data, scope));
  const [periodEdited, setPeriodEdited] = useState(false);
  const choose = (next: Set<string>) => {
    setSel(next);
    if (!periodEdited && next.size) setPeriod(defaultPeriod(data, { kind: 'plans', planIds: [...next] }));
  };

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
      if (!sel.size && pickable) throw new Error('Bitte mindestens einen Plan wählen.');
      const nr = no.trim() || nextSheetNo(data);
      // Firmenlogo (Konto → Einstellungen) kommt automatisch links in die Kopfzeile
      void offerFile(exportAufmassblatt(data, effective, { no: nr, period: period.trim() }, { logo: cachedExcelLogo() }));
      const n = Number(nr);
      if (Number.isInteger(n) && n > (data.project.sheetNo ?? 0)) updateProject({ sheetNo: n });
    });

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
            <input
              value={period}
              onChange={(e) => {
                setPeriod(e.target.value);
                setPeriodEdited(true);
              }}
              placeholder="z. B. 01.10.2026 – 26.10.2026"
              autoComplete="off"
              data-testid="blatt-period"
            />
          </label>
        </div>
        {pickable && allIds.length > 1 && (
          <fieldset className="blatt-plans" data-testid="blatt-plans">
            <legend>
              Pläne auf diesem Aufmaßblatt <span className="muted small">({sel.size} von {allIds.length})</span>
            </legend>
            <div className="row gap blatt-plans-quick">
              <button type="button" className="btn btn-sm" onClick={() => choose(new Set(allIds))} data-testid="blatt-plans-all">
                Alle
              </button>
              <button type="button" className="btn btn-sm" onClick={() => choose(new Set())} data-testid="blatt-plans-none">
                Keine
              </button>
            </div>
            <div className="blatt-plans-list">
              {groups.map((g) => (
                <div key={g.cc.id} className="blatt-plans-group">
                  {groups.length > 1 && <strong className="small">{costCenterName(g.cc)}</strong>}
                  {g.plans.map((p) => (
                    <label key={p.id} className="check-row small" data-testid="blatt-plan" data-plan={p.planNumber}>
                      <input
                        type="checkbox"
                        checked={sel.has(p.id)}
                        onChange={(e) => {
                          const next = new Set(sel);
                          if (e.target.checked) next.add(p.id);
                          else next.delete(p.id);
                          choose(next);
                        }}
                      />
                      <span>
                        {planTitle(p)} <span className="muted">· {damagesOf(data, p.id).length} Messungen</span>
                      </span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </fieldset>
        )}
        <p className="muted small">
          Wie die Firmenvorlage: Firmenlogo links in der Kopfzeile, Bauvorhaben, Kostenstelle und Leistungszeitraum; je LV/MFK die Positionen mit ihren
          Messungen (Stk., m, m², m³, l) und Zusammenstellung in EUR. Messungen ohne Position folgen mit Plan und Nr. Immer auf eine Seite. Die
          Nummer wird beim nächsten Mal automatisch hochgezählt.
        </p>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
