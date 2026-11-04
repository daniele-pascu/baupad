import { describe, expect, it } from 'vitest';
import { headFromProject } from '../../src/lib/reports';

describe('Berichtskopf aus dem Projekt', () => {
  it('verantwortlich = Bauleitung (mit Handynummer), sonst Bearbeiter', () => {
    const base = { name: 'Parkring', number: '91300', site: '', address: 'Wien', client: 'X', editor: 'Bearbeiter' };
    expect(headFromProject({ ...base, siteManager: { workerId: 'w1', name: 'Paul Leiter', phone: '0664 123' } }).responsible).toBe('Paul Leiter, 0664 123');
    expect(headFromProject({ ...base, siteManager: null }).responsible).toBe('Bearbeiter');
  });
});
