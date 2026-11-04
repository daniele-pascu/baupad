import { describe, expect, it } from 'vitest';
import { cleanAbsences, withAbsence } from '../../src/lib/crew-absence';
import type { Absence } from '../../src/lib/types';

const a = (id: string, workerId: string, from: string, to: string, kind: Absence['kind'] = 'urlaub', createdAt = 1): Absence => ({ id, workerId, kind, from, to, createdAt });

describe('withAbsence – keine Doppelungen je Arbeiter und Tag', () => {
  it('gleicher Zeitraum nochmal → nur ein Eintrag', () => {
    const out = withAbsence([a('1', 'w', '2026-11-02', '2026-11-04')], a('2', 'w', '2026-11-02', '2026-11-04', 'urlaub', 2));
    expect(out.map((x) => x.id)).toEqual(['2']);
  });
  it('Überschneidung kürzt bzw. teilt den alten Eintrag, andere Arbeiter bleiben', () => {
    const out = withAbsence([a('1', 'w', '2026-11-02', '2026-11-08'), a('3', 'x', '2026-11-03', '2026-11-03')], a('2', 'w', '2026-11-04', '2026-11-05', 'krank', 2));
    expect(out.map((x) => [x.workerId, x.kind, x.from, x.to])).toEqual([
      ['w', 'urlaub', '2026-11-02', '2026-11-03'],
      ['w', 'urlaub', '2026-11-06', '2026-11-08'],
      ['x', 'urlaub', '2026-11-03', '2026-11-03'],
      ['w', 'krank', '2026-11-04', '2026-11-05'],
    ]);
    expect(new Set(out.map((x) => x.id)).size).toBe(4);
  });
  it('cleanAbsences bereinigt vorhandene Doppelungen (neuester gilt)', () => {
    const out = cleanAbsences([a('2', 'w', '2026-11-02', '2026-11-02', 'krank', 5), a('1', 'w', '2026-11-02', '2026-11-02', 'urlaub', 1), a('9', 'w', '2026-11-02', '2026-11-02', 'krank', 3)]);
    expect(out.map((x) => x.id)).toEqual(['2']);
  });
});
