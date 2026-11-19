import { describe, expect, it } from 'vitest';
import { measureTypeForUnit } from '../../src/lib/measure-types';

describe('Neue Messung: Messart aus der Einheit der Position', () => {
  it('Einheit → Messart', () => {
    expect(measureTypeForUnit('m²')).toBe('flaeche');
    expect(measureTypeForUnit('m2')).toBe('flaeche');
    expect(measureTypeForUnit(' M³ ')).toBe('volumen');
    expect(measureTypeForUnit('lfm')).toBe('laenge');
    expect(measureTypeForUnit('m')).toBe('laenge');
    expect(measureTypeForUnit('Stk')).toBe('stueck');
    expect(measureTypeForUnit('St.')).toBe('stueck');
    expect(measureTypeForUnit('psch')).toBe('frei');
    expect(measureTypeForUnit('')).toBe('frei');
  });
  it('Betoninstandsetzungs-Position: immer Betoninstandsetzung', () => {
    expect(measureTypeForUnit('Stk', true)).toBe('schadstelle');
    expect(measureTypeForUnit('m²', true)).toBe('schadstelle');
  });
});
