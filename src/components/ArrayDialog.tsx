import { useState } from 'react';
import type { ArrayParams } from '../lib/cad-ops';
import { parseDecimal } from '../lib/numbers';
import { Modal } from './Modal';
import { customDialog } from './ui';

/**
 * Reihe: ausgewählte Objekte mehrfach anordnen – rechteckig (Spalten × Zeilen), linear (entlang einer Richtung)
 * oder polar (im Kreis um einen Mittelpunkt, der danach im Plan angetippt wird). Werte werden je Gerät gemerkt.
 */
type Kind = ArrayParams['kind'];
const KEY = 'arrayDialog';
type Saved = { kind: Kind; cols: string; rows: string; dx: string; dy: string; count: string; dist: string; angle: string; pcount: string; total: string; rotate: boolean };
const DEFAULTS: Saved = { kind: 'rect', cols: '3', rows: '1', dx: '1', dy: '1', count: '4', dist: '1', angle: '0', pcount: '6', total: '360', rotate: true };

function load(): Saved {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return DEFAULTS;
  }
}

function Field({ label, value, onChange, unit, testId }: { label: string; value: string; onChange(v: string): void; unit?: string; testId: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <span className="input-unit">
        <input value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal" autoComplete="off" data-testid={testId} />
        {unit && <span className="unit">{unit}</span>}
      </span>
    </label>
  );
}

function ArrayDialogView({ count, close }: { count: number; close(v: ArrayParams | null): void }) {
  const [v, setV] = useState<Saved>(load);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<Saved>) => setV((x) => ({ ...x, ...patch }));
  const num = (s: string) => parseDecimal(s);
  const submit = () => {
    let p: ArrayParams | null = null;
    if (v.kind === 'rect') {
      const [c, r, dx, dy] = [num(v.cols), num(v.rows), num(v.dx), num(v.dy)];
      if (!(c! >= 1 && r! >= 1) || (c! * r! < 2) || dx === null || dy === null) return setError('Spalten und Zeilen (zusammen mindestens 2) sowie beide Abstände angeben.');
      p = { kind: 'rect', cols: Math.round(c!), rows: Math.round(r!), dx, dy };
    } else if (v.kind === 'linear') {
      const [n, d, a] = [num(v.count), num(v.dist), num(v.angle)];
      if (!(n! >= 2) || d === null || a === null) return setError('Anzahl (mindestens 2), Abstand und Richtung angeben.');
      p = { kind: 'linear', count: Math.round(n!), dist: d, angle: a };
    } else {
      const [n, t] = [num(v.pcount), num(v.total)];
      if (!(n! >= 2) || t === null || t === 0) return setError('Anzahl (mindestens 2) und Gesamtwinkel angeben.');
      p = { kind: 'polar', count: Math.round(n!), total: t, rotate: v.rotate };
    }
    if ((p.kind === 'rect' ? p.cols * p.rows : p.count) > 500) return setError('Höchstens 500 Exemplare auf einmal.');
    try {
      localStorage.setItem(KEY, JSON.stringify(v));
    } catch {
      /* optional */
    }
    close(p);
  };
  return (
    <Modal
      title={`Reihe – ${count} Objekt${count === 1 ? '' : 'e'}`}
      onClose={() => close(null)}
      testId="array-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={() => close(null)}>
            Abbrechen
          </button>
          <button type="submit" form="array-form" className="btn btn-primary" data-testid="array-ok">
            {v.kind === 'polar' ? 'Weiter: Mittelpunkt' : 'Anordnen'}
          </button>
        </>
      }
    >
      <form
        id="array-form"
        className="text-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="segmented" role="tablist" aria-label="Art der Reihe">
          {(
            [
              ['rect', 'Rechteckig'],
              ['linear', 'Linear'],
              ['polar', 'Polar (Kreis)'],
            ] as const
          ).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={v.kind === k} onClick={() => set({ kind: k })} data-testid={`array-kind-${k}`}>
              {l}
            </button>
          ))}
        </div>
        {v.kind === 'rect' && (
          <div className="form-grid">
            <Field label="Spalten" value={v.cols} onChange={(x) => set({ cols: x })} testId="array-cols" />
            <Field label="Zeilen" value={v.rows} onChange={(x) => set({ rows: x })} testId="array-rows" />
            <Field label="Abstand nach rechts" value={v.dx} onChange={(x) => set({ dx: x })} unit="m" testId="array-dx" />
            <Field label="Abstand nach oben" value={v.dy} onChange={(x) => set({ dy: x })} unit="m" testId="array-dy" />
          </div>
        )}
        {v.kind === 'linear' && (
          <div className="form-grid">
            <Field label="Anzahl (mit Original)" value={v.count} onChange={(x) => set({ count: x })} testId="array-count" />
            <Field label="Abstand" value={v.dist} onChange={(x) => set({ dist: x })} unit="m" testId="array-dist" />
            <Field label="Richtung (0° = rechts, 90° = oben)" value={v.angle} onChange={(x) => set({ angle: x })} unit="°" testId="array-angle" />
          </div>
        )}
        {v.kind === 'polar' && (
          <>
            <div className="form-grid">
              <Field label="Anzahl (mit Original)" value={v.pcount} onChange={(x) => set({ pcount: x })} testId="array-pcount" />
              <Field label="Gesamtwinkel (360 = ganzer Kreis)" value={v.total} onChange={(x) => set({ total: x })} unit="°" testId="array-total" />
            </div>
            <label className="check-row small">
              <input type="checkbox" checked={v.rotate} onChange={(e) => set({ rotate: e.target.checked })} data-testid="array-rotate" />
              <span>Objekte mitdrehen</span>
            </label>
            <p className="muted small">Danach den Mittelpunkt im Plan antippen (Fang hilft, z. B. Kreismitte).</p>
          </>
        )}
        <p className="muted small">Abstände: negativ = nach links bzw. unten. Alle Kopien übernehmen Farbe, Linienart, Füllung und Maße.</p>
        {error && (
          <p className="error small" role="alert" data-testid="array-error">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}

export const arrayDialog = (count: number) => customDialog<ArrayParams>((close) => <ArrayDialogView count={count} close={close} />);
