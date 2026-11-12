import { describe, expect, it } from 'vitest';
import type { Session } from '../../src/lib/auth';
import { canSeePrices, PRICES_PERM } from '../../src/lib/price-access';

const s = (role: Session['role'], toolSites: Session['toolSites'] = {}) => ({ role, companyId: 'w1', operator: false, toolSites }) as Session;

describe('Preise und Summen der LV/MFK', () => {
  it('Admin und Büro immer', () => {
    expect(canSeePrices(s('admin'))).toBe(true);
    expect(canSeePrices(s('buero'))).toBe(true);
  });
  it('Polier und Arbeiter nur mit Freigabe unter Benutzer und Rollen', () => {
    expect(canSeePrices(s('polier'))).toBe(false);
    expect(canSeePrices(s('arbeiter'))).toBe(false);
    expect(canSeePrices(s('polier', { [PRICES_PERM]: ['1'] }))).toBe(true);
    expect(canSeePrices(s('arbeiter', { [PRICES_PERM]: ['1'] }))).toBe(true);
  });
  it('Projektfreigaben je Werkzeug zählen nicht als Preis-Freigabe', () => {
    expect(canSeePrices(s('polier', { projects: ['p:1'] }))).toBe(false);
  });
});
