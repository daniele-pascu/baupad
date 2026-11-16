import { describe, expect, it } from 'vitest';
import { canSite, canTool, siteKeyOf } from '../../src/lib/access';
import type { Session } from '../../src/lib/auth';

const base: Session = { userId: 'u', email: 'a@b.at', name: 'A', role: 'arbeiter', companyId: 'w1', companyName: 'F', operator: false, phone: '', pkg: 'team', workspaceActive: true, pricePerUser: 0, members: 0, providers: [], tools: ['photos'], sites: ['p:1', 'n:garage'], toolSites: {} };

describe('Zugriff je Benutzer', () => {
  it('Arbeiter sieht nur freigegebene Werkzeuge und Baustellen', () => {
    expect(canTool(base, 'photos')).toBe(true);
    expect(canTool(base, 'projects')).toBe(false);
    expect(canSite(base, 'p:1')).toBe(true);
    expect(canSite(base, 'p:2')).toBe(false);
    expect(canSite(base, siteKeyOf(null, ' Garage '))).toBe(true);
  });
  it('Projekte: sichtbar nach der Freigabe (gemeinsame Liste) oder wenn sie für das Werkzeug ausgewählt sind', () => {
    const s: Session = { ...base, sites: [], tools: ['photos', 'reports'], toolSites: { photos: ['p:7'] } };
    expect(canSite(s, 'p:7', 'photos')).toBe(true);
    expect(canSite(s, 'p:7', 'reports')).toBe(false); // nur für Fotos ausgewählt
    expect(canSite(s, 'p:1', 'reports')).toBe(false); // nicht freigegeben
    const mixed: Session = { ...base, toolSites: { photos: ['p:7'] } };
    expect(canSite(mixed, 'p:1', 'reports')).toBe(true); // freigegeben: gilt in allen Werkzeugen
    expect(canSite(mixed, 'p:1', 'photos')).toBe(true);
  });
  it('ohne Freigabe sieht ein Arbeiter kein Projekt; Admin, Büro, Betreiber und Benutzer ohne Arbeitsbereich sehen alle', () => {
    expect(canSite({ ...base, sites: [] }, 'p:9')).toBe(false);
    expect(canSite({ ...base, sites: [] }, 'n:garage')).toBe(true); // Baustelle ohne Projekt: wie bisher
    expect(canSite({ ...base, sites: [], role: 'buero' }, 'p:9')).toBe(true);
    expect(canTool({ ...base, tools: [] }, 'workers')).toBe(true);
    expect(canTool({ ...base, role: 'admin' }, 'workers')).toBe(true);
    expect(canSite({ ...base, operator: true }, 'p:9')).toBe(true);
    expect(canSite({ ...base, companyId: '' }, 'p:9')).toBe(true);
    expect(canSite(null, 'p:9')).toBe(true);
  });
});
