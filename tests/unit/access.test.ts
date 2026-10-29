import { describe, expect, it } from 'vitest';
import { canSite, canTool, siteKeyOf } from '../../src/lib/access';
import type { Session } from '../../src/lib/auth';

const base: Session = { userId: 'u', email: 'a@b.at', name: 'A', role: 'arbeiter', companyId: 'w1', companyName: 'F', operator: false, phone: '', pkg: 'team', providers: [], tools: ['photos'], sites: ['p:1', 'n:garage'] };

describe('Zugriff je Benutzer', () => {
  it('Arbeiter sieht nur freigegebene Werkzeuge und Baustellen', () => {
    expect(canTool(base, 'photos')).toBe(true);
    expect(canTool(base, 'projects')).toBe(false);
    expect(canSite(base, 'p:1')).toBe(true);
    expect(canSite(base, 'p:2')).toBe(false);
    expect(canSite(base, siteKeyOf(null, ' Garage '))).toBe(true);
  });
  it('leere Listen bedeuten alles; Admin, Betreiber und Benutzer ohne Arbeitsbereich sind nicht eingeschränkt', () => {
    expect(canSite({ ...base, sites: [] }, 'p:9')).toBe(true);
    expect(canTool({ ...base, tools: [] }, 'workers')).toBe(true);
    expect(canTool({ ...base, role: 'admin' }, 'workers')).toBe(true);
    expect(canSite({ ...base, operator: true }, 'p:9')).toBe(true);
    expect(canSite({ ...base, companyId: '' }, 'p:9')).toBe(true);
    expect(canSite(null, 'p:9')).toBe(true);
  });
});
