import { describe, expect, it } from 'vitest';
import { inputVector, parseCadInput, vectorInfo } from '../../src/lib/cad-input';

describe('Befehlsfeld: Eingabe wie im CAD', () => {
  it('ΔX;ΔY mit Komma als Dezimalzeichen, mit und ohne @', () => {
    expect(parseCadInput('2,5;1')).toEqual({ kind: 'rel', dx: 2.5, dy: 1 });
    expect(parseCadInput('@-1,25;0')).toEqual({ kind: 'rel', dx: -1.25, dy: 0 });
    expect(parseCadInput('3 -2')).toEqual({ kind: 'rel', dx: 3, dy: -2 });
    expect(parseCadInput('2.5,1')).toEqual({ kind: 'rel', dx: 2.5, dy: 1 });
  });
  it('Länge<Winkel', () => {
    expect(parseCadInput('3<45')).toEqual({ kind: 'polar', len: 3, angle: 45 });
    expect(parseCadInput('@1,5<90°')).toEqual({ kind: 'polar', len: 1.5, angle: 90 });
  });
  it('reiner Abstand', () => {
    expect(parseCadInput('1,25')).toEqual({ kind: 'dist', len: 1.25 });
    expect(parseCadInput('4 m')).toEqual({ kind: 'dist', len: 4 });
  });
  it('Unsinn wird abgelehnt', () => {
    for (const s of ['', 'abc', '1;2;3', '3<', '<45', '1,2,3']) expect(parseCadInput(s)).toBeNull();
  });
  it('Vektor im Plan: Y nach oben in der Eingabe, nach unten im Plan', () => {
    expect(inputVector({ kind: 'rel', dx: 2, dy: 1 })).toEqual({ x: 2, y: -1 });
    const p = inputVector({ kind: 'polar', len: 2, angle: 90 })!;
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.y).toBeCloseTo(-2, 9);
    expect(inputVector({ kind: 'dist', len: 5 }, { x: 3, y: 4 })).toEqual({ x: 3, y: 4 });
    expect(inputVector({ kind: 'dist', len: 5 })).toBeNull();
  });
  it('Anzeige am Cursor', () => {
    const i = vectorInfo(3, -4); // 3 m rechts, 4 m nach oben (im Plan y −4)
    expect(i.len).toBeCloseTo(5, 9);
    expect(i.dy).toBe(4);
    expect(i.angle).toBeCloseTo(53.1, 1);
    expect(vectorInfo(-1, 0).angle).toBe(180);
  });
});
