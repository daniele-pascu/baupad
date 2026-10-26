import { useEffect, useState } from 'react';
import { calibrationStatus, checkDeviation, checkError, formatCm, formatPercent, MAX_ERROR_M, planUnitsPerMeter } from '../lib/calibration';
import { formatMeasure } from '../lib/numbers';
import { checkScale, DIM_TOLERANCE_M, sourceText, type ScaleCheck } from '../lib/scale-detect';
import type { Plan, SourceFile } from '../lib/types';
import { Modal } from './Modal';

const MAX_ROWS = 40;

/**
 * Prüfbericht der Kalibrierung: Stand (automatisch/bestätigt/selbst), Prüfstrecke und – bei
 * PDFs mit Text – wie gut Maßstabsangaben und Maßketten des Plans zum Maßstab passen.
 * Bewusst ohne Genauigkeitsversprechen: Planqualität und Druck begrenzen die Genauigkeit.
 */
export function CalibrationReport({ plan, file, onClose }: { plan: Plan; file: SourceFile | undefined; onClose: () => void }) {
  const status = calibrationStatus(plan, file?.kind);
  const upm = planUnitsPerMeter(plan);
  const [check, setCheck] = useState<ScaleCheck | 'notext' | 'image' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!file || !upm) return;
    if (file.kind !== 'pdf') return setCheck('image');
    let live = true;
    void (async () => {
      const { getPdfDocument, readPageText } = await import('../lib/pdf');
      const items = await readPageText(await (await getPdfDocument(file.id)).getPage(plan.pageIndex + 1), plan.rotation);
      if (!live) return;
      setCheck(items.length ? checkScale(items, plan.crop ?? { x: 0, y: 0, w: plan.pageWidth, h: plan.pageHeight }, upm) : 'notext');
    })().catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [file, upm, plan.pageIndex, plan.rotation, plan.crop, plan.pageWidth, plan.pageHeight]);

  const dev = checkDeviation(plan);
  const err = checkError(plan);
  const c = plan.calibration;
  return (
    <Modal title="Prüfbericht Maßstab" onClose={onClose} wide testId="calibration-report">
      <p className={`banner ${status.warn ? 'banner-warn' : 'banner-info'} small`} data-testid="report-status">
        {status.text}
        {c?.auto && <> · Quelle: {sourceText(c.auto)}</>}
      </p>
      {c?.auto?.warning && <p className="banner banner-warn small">{c.auto.warning}</p>}

      <h3 className="report-head">Prüfstrecke</h3>
      {c?.check && dev !== null ? (
        <p data-testid="report-check">
          Soll {formatMeasure(c.check.expected)} m · im Plan gemessen {formatMeasure(c.check.measured)} m · Abweichung{' '}
          <strong className={Math.abs(err!.diff) > MAX_ERROR_M ? 'text-warn' : 'text-ok'}>{formatCm(err!.diff)}</strong> ({formatPercent(dev)}) · hochgerechnet auf
          10 m ≈ {formatCm(err!.per10m)}
          {Math.abs(err!.diff) > MAX_ERROR_M && <span className="text-warn"> – mehr als 2 cm: bitte neu kalibrieren (längere Referenzstrecke).</span>}
        </p>
      ) : (
        <p className="muted small">Noch keine Prüfstrecke gemessen. Tipp: eine zweite, möglichst lange bemaßte Strecke mit „Prüfstrecke“ nachmessen.</p>
      )}

      <h3 className="report-head">Abgleich mit den Maßen im Plan</h3>
      {!upm && <p className="muted">Der Plan ist noch nicht kalibriert.</p>}
      {error && <p className="banner banner-error small">{error}</p>}
      {check === 'image' && (
        <p className="muted small" data-testid="report-image">
          Bild bzw. Foto: Maßzahlen können nicht automatisch gelesen werden. Die Genauigkeit hängt von der Referenzstrecke ab – möglichst lang wählen
          (z. B. ganze Wand) und mit einer Prüfstrecke kontrollieren. Schräg fotografierte Pläne sind verzerrt und nur eingeschränkt messbar.
        </p>
      )}
      {check === 'notext' && (
        <p className="muted small" data-testid="report-image">
          Dieses PDF enthält keinen lesbaren Text (vermutlich ein Scan). Bitte über eine Referenzstrecke kalibrieren und mit einer Prüfstrecke kontrollieren.
        </p>
      )}
      {check && typeof check === 'object' && (
        <>
          {check.notes.length > 0 && (
            <ul className="report-notes" data-testid="report-notes">
              {check.notes.map((n) => (
                <li key={n.n}>
                  Maßstabsangabe <strong>1:{n.n}</strong> –{' '}
                  {n.ok ? <span className="text-ok">passt</span> : <span className="text-warn">passt nicht (Abweichung {formatPercent(n.deviation)})</span>}
                  {!n.ok && <span className="muted small"> – Plan evtl. verkleinert gedruckt</span>}
                </li>
              ))}
            </ul>
          )}
          {check.dims.length ? (
            <>
              <p data-testid="report-summary">
                <strong>
                  {check.okCount} von {check.dims.length}
                </strong>{' '}
                Maßpaaren passen (höchstens {DIM_TOLERANCE_M * 100} cm Abweichung){check.median !== null && <> · mittlere Abweichung {formatPercent(check.median)}</>}.
                {check.okCount < check.dims.length && (
                  <span className="muted small"> Nicht passende Paare sind oft keine echte Maßkette (Zahlen stehen nur nebeneinander) – oder widersprechen dem Maßstab.</span>
                )}
              </p>
              <div className="table-wrap">
                <table className="report-table" data-testid="report-dims">
                  <thead>
                    <tr>
                      <th>Maßzahlen</th>
                      <th className="num">Soll (m)</th>
                      <th className="num">Gemessen (m)</th>
                      <th className="num">Abweichung</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {check.dims.slice(0, MAX_ROWS).map((d, i) => (
                      <tr key={i} className={d.ok ? '' : 'report-bad'}>
                        <td>
                          {d.a} | {d.b}
                        </td>
                        <td className="num">{formatMeasure(d.expected)}</td>
                        <td className="num">{formatMeasure(d.measured)}</td>
                        <td className="num">{formatCm(d.measured - d.expected)}</td>
                        <td>{d.ok ? <span className="text-ok">passt</span> : <span className="text-warn">widersprüchlich</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {check.dims.length > MAX_ROWS && <p className="muted small">… und {check.dims.length - MAX_ROWS} weitere.</p>}
            </>
          ) : (
            check.notes.length === 0 && <p className="muted small">Im Plan wurden keine Maßketten oder Maßstabsangaben gefunden.</p>
          )}
        </>
      )}
      <p className="muted small report-note">
        Hinweis: Die Messgenauigkeit hängt von Planqualität, Druck bzw. Verkleinerung, Auflösung und der gewählten Referenzstrecke ab. BauPad zeigt
        Abweichungen an, garantiert aber keine Maßhaltigkeit des Plans.
      </p>
    </Modal>
  );
}
