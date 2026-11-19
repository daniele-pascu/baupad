import { describe, expect, it } from 'vitest';
import { geometryMeasures } from '../../src/lib/calibration';

/**
 * Fläche aus dem Plan: Die PDF-Bibliothek liefert Koordinaten als Float32 – 15,15 × 7,70 m kommt dann als
 * 116,654998… m² an. Planmaße sind nie genauer als 1 cm², deshalb wird dieses Rauschen vor dem Runden entfernt.
 */
describe('Fläche aus dem Plan: kaufmännisch gerundet trotz PDF-Rauschen', () => {
  // 1:50 – Kalibrierung wie aus massketten.pdf (Float32-Koordinaten): 5 m = 283,4645690917969 Seiteneinheiten
  const k = 283.4645690917969 / 5;
  it('15,15 × 7,70 m = 116,655 m² → 116,66 m²', () => {
    const g = geometryMeasures({ type: 'rect', x: 120, y: 245.46456909179688, w: 858.8976440429688, h: 436.5354309082031 }, k);
    expect(g?.area).toBe(116.66);
    expect(g?.perimeter).toBe(45.7);
  });
  it('echte Werte unter der halben Stelle bleiben abgerundet', () => {
    // 10,00 × 1,2344 m = 12,344 m² → 12,34 m²
    const g = geometryMeasures({ type: 'rect', x: 0, y: 0, w: 10 * k, h: 1.2344 * k }, k);
    expect(g?.area).toBe(12.34);
  });
});
