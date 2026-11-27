import { describe, expect, it } from 'vitest';
import { exampleInUnit, inputInUnit, parseCadInput } from '../../src/lib/cad-input';

describe('Einheit der Eingabe', () => {
  it('rechnet Längen in Meter um, Winkel bleiben', () => {
    expect(inputInUnit(parseCadInput('250'), 'mm')).toEqual({ kind: 'dist', len: 0.25 });
    expect(inputInUnit(parseCadInput('3000<90'), 'mm')).toEqual({ kind: 'polar', len: 3, angle: 90 });
    expect(inputInUnit(parseCadInput('25;-10'), 'cm')).toEqual({ kind: 'rel', dx: 0.25, dy: -0.1 });
    expect(inputInUnit(parseCadInput('0,25'), 'm')).toEqual({ kind: 'dist', len: 0.25 });
    expect(inputInUnit(null, 'mm')).toBeNull();
  });
  it('zeigt Beispiele in der Einheit', () => {
    expect(exampleInUnit(0.25, 'm')).toBe('0,25');
    expect(exampleInUnit(0.25, 'mm')).toBe('250');
    expect(exampleInUnit(0.05, 'cm')).toBe('5');
    expect(exampleInUnit(2.8, 'm')).toBe('2,8');
  });
});
