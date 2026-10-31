import { describe, expect, it } from 'vitest';
import { shortName } from '../../src/lib/auth';

describe('shortName (Kopfzeile)', () => {
  it('kürzt den ersten Vornamen ab und hängt den Nachnamen an', () => {
    expect(shortName('Andrea Daniele Pascu')).toBe('A. Pascu');
    expect(shortName('Max Mustermann')).toBe('M. Mustermann');
    expect(shortName('  anna  maria  berger ')).toBe('A. berger');
  });
  it('lässt ein einzelnes Wort unverändert', () => {
    expect(shortName('Test')).toBe('Test');
    expect(shortName('')).toBe('');
  });
});
