import { useEffect, useMemo, useState } from 'react';
import { formatPercent } from '../lib/calibration';
import { analyzeDimensions, calibrationLine, LINE_TOLERANCE, matchDimensionLines, type DimMatch, type DimUnit } from '../lib/dimension-lines';
import { formatMeasure } from '../lib/numbers';
import { PT_PER_M } from '../lib/scale-detect';
import { putRecord, type ProjectState } from '../lib/store';
import type { Plan, SourceFile } from '../lib/types';
import { Modal } from './Modal';
import { toast } from './ui';

const fmtScale = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: n < 10 ? 1 : 0 });

/**
 * Maße aus dem Plan prüfen und übernehmen: jede erkannte Maßzahl mit ihrer Maßlinie, der
 * gelesenen Einheit, der im Plan gemessenen Länge und der Abweichung. Einheit und Werte sind
 * korrigierbar, einzelne Maße abwählbar; erst „Übernehmen“ speichert die Kalibrierung.
 */
export function DimensionReview({ data, plan, file, onClose }: { data: ProjectState; plan: Plan; file: SourceFile; onClose: () => void }) {
  const [matches, setMatches] = useState<DimMatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unit, setUnit] = useState<DimUnit | 'auto'>('auto');
  const [values, setValues] = useState<Record<number, string>>({});
  const [use, setUse] = useState<boolean[] | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const { getPdfDocument, readPageSegments, readPageText } = await import('../lib/pdf');
      const page = await (await getPdfDocument(file.id)).getPage(plan.pageIndex + 1);
      const region = plan.crop ?? { x: 0, y: 0, w: plan.pageWidth, h: plan.pageHeight };
      const m = matchDimensionLines(await readPageText(page, plan.rotation), await readPageSegments(page, plan.rotation, region), region);
      if (live) setMatches(m);
    })().catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [file.id, plan.pageIndex, plan.rotation, plan.crop, plan.pageWidth, plan.pageHeight]);

  // korrigierte Werte (in der Schreibweise des Plans) einsetzen
  const edited = useMemo(
    () =>
      matches?.map((m, i) => {
        const v = values[i] !== undefined ? Number(values[i].replace(',', '.')) : m.value;
        return v > 0 ? { ...m, value: v, units: unit === 'auto' ? m.units : [unit] } : { ...m, units: [] };
      }) ?? [],
    [matches, values, unit],
  );
  const an = useMemo(() => (edited.length ? analyzeDimensions(edited, unit === 'auto' ? undefined : unit) : null), [edited, unit]);
  // Auswahl: standardmäßig die passenden Maße; nach Änderung der Einheit neu
  useEffect(() => setUse(an ? an.rows.map((r) => r.ok) : null), [an]);
  const chosen = use ?? an?.rows.map((r) => r.ok) ?? [];
  const line = an ? calibrationLine(an, chosen) : null;
  const n = line ? (PT_PER_M * line.meters) / Math.hypot(line.b.x - line.a.x, line.b.y - line.a.y) : null;

  const apply = () => {
    if (!an || !line || n === null) return;
    const label = `ca. 1:${fmtScale(n)}`;
    putRecord('plans', {
      ...data.plans[plan.id],
      calibration: { a: line.a, b: line.b, meters: line.meters, auto: { source: 'lines', label, unit: an.unit, count: line.count, confirmed: true } },
    });
    toast(`Kalibrierung aus ${line.count} Maß${line.count === 1 ? '' : 'en'} übernommen (${label}, Einheit ${an.unit}). Gespeicherte Messwerte bleiben unverändert.`, 'success', 6000);
    onClose();
  };

  return (
    <Modal
      title="Maße aus dem Plan"
      onClose={onClose}
      wide
      testId="dimension-review"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" onClick={apply} disabled={!line} data-testid="dims-apply">
            Kalibrierung übernehmen
          </button>
        </>
      }
    >
      {error && <p className="banner banner-error small">{error}</p>}
      {!matches && !error && <p className="muted">Maße werden gelesen …</p>}
      {matches && !matches.length && (
        <p className="muted" data-testid="dims-none">
          Keine Maßlinien mit Maßzahl gefunden (z. B. Scan, Foto oder Maße ohne gezeichnete Maßlinie). Bitte über eine Referenzstrecke kalibrieren.
        </p>
      )}
      {an && matches && matches.length > 0 && (
        <>
          <div className="row gap wrap dims-head">
            <label className="field dims-unit">
              <span>Einheit der Maßzahlen</span>
              <select value={unit} onChange={(e) => setUnit(e.target.value as DimUnit | 'auto')} data-testid="dims-unit">
                <option value="auto">Automatisch: cm (420 = 4,20 m), „4,20“ = m</option>
                <option value="cm">Alle Zentimeter (420 = 4,20 m)</option>
                <option value="m">Alle Meter (4,20 = 4,20 m)</option>
                <option value="mm">Alle Millimeter (4200 = 4,20 m)</option>
              </select>
            </label>
            <p className="small" data-testid="dims-summary">
              <strong>
                {an.okCount} von {an.rows.length}
              </strong>{' '}
              Maßen passen zusammen (±{(LINE_TOLERANCE * 100).toLocaleString('de-DE')} %)
              {n !== null && (
                <>
                  {' '}
                  · Maßstab <strong>ca. 1:{fmtScale(n)}</strong> aus {line!.count} gewählten Maß{line!.count === 1 ? '' : 'en'}
                </>
              )}
              .
            </p>
          </div>
          {line?.count === 1 && <p className="banner banner-warn small">Nur ein Maß gewählt – ohne zweites Maß gibt es keine Kontrolle.</p>}
          {an.otherScale && (
            <p className="banner banner-warn small" data-testid="dims-other-scale">
              Einige Maße passen zu einem anderen Maßstab (ca. 1:{fmtScale(PT_PER_M / an.otherScale)}). Enthält der Plan Bereiche mit unterschiedlichem Maßstab,
              diese getrennt zuschneiden und kalibrieren.
            </p>
          )}
          <div className="table-wrap">
            <table className="report-table" data-testid="dims-table">
              <thead>
                <tr>
                  <th />
                  <th>Maßzahl</th>
                  <th className="num">gelesen (m)</th>
                  <th className="num">im Plan (m)</th>
                  <th className="num">Abweichung</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {an.rows.map((r, i) => (
                  <tr key={i} className={r.ok ? '' : 'report-bad'} data-testid="dims-row">
                    <td>
                      <input
                        type="checkbox"
                        checked={!!chosen[i]}
                        disabled={r.meters === null}
                        onChange={(e) => setUse(chosen.map((u, j) => (j === i ? e.target.checked : u)))}
                        aria-label={`Maß ${r.match.text} verwenden`}
                        data-testid="dims-use"
                      />
                    </td>
                    <td>
                      <input
                        className="dims-value"
                        value={values[i] ?? String(matches[i].value).replace('.', ',')}
                        onChange={(e) => setValues({ ...values, [i]: e.target.value })}
                        inputMode="decimal"
                        aria-label="Maßzahl korrigieren"
                        data-testid="dims-value"
                      />
                    </td>
                    <td className="num">{r.meters !== null ? formatMeasure(r.meters) : '–'}</td>
                    <td className="num">{r.measured !== null ? formatMeasure(r.measured) : '–'}</td>
                    <td className="num">{r.deviation !== null ? formatPercent(r.deviation) : '–'}</td>
                    <td>
                      {r.meters === null ? (
                        <span className="muted small">Einheit passt nicht</span>
                      ) : r.ok ? (
                        <span className="text-ok">passt</span>
                      ) : (
                        <span className="text-warn">widersprüchlich</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small report-note">
            Zahlen ohne Einheit gelten wie in Bauplänen üblich als Zentimeter (420 = 4,20 m · 5 = 0,05 m · 1245 = 12,45 m), Zahlen mit zwei
            Nachkommastellen als Meter (4,20). Gelesen werden nur Zahlen, die mittig über einer gezeichneten Maßlinie stehen; die Länge im Plan reicht von
            Begrenzung zu Begrenzung. Maße, die
            nicht zum gemeinsamen Maßstab passen, werden nicht verwendet. Die Genauigkeit hängt vom Plan ab – BauPad garantiert keine Maßhaltigkeit.
          </p>
        </>
      )}
    </Modal>
  );
}
