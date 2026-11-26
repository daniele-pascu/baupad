import { expect, it } from 'vitest';
import { creep } from '../../src/components/ProgressRing';

it('Fortschrittsring: läuft langsam weiter, nie hinter dem echten Wert und ohne echten Wert nie über 90 %', () => {
  let s = 0;
  for (let i = 0; i < 400; i++) {
    const n = creep(s, 0);
    expect(n).toBeGreaterThanOrEqual(s);
    s = n;
  }
  expect(s).toBeGreaterThan(0.5);
  expect(s).toBeLessThanOrEqual(0.9);
  expect(creep(0.2, 0.6)).toBe(0.6); // echter Fortschritt springt vor
  expect(creep(0.95, 1)).toBe(1);
});
