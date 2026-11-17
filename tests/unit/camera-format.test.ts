import { describe, expect, it } from 'vitest';
import { formatCrop, qualityMax } from '../../src/lib/camera-format';

describe('Kamera: Format und Auflösung (auch für Fotos der Gerätekamera in der Store-App)', () => {
  it('schneidet das größte Rechteck in der Mitte aus', () => {
    // Handyfoto 4032 × 3024 (quer, 4:3)
    expect(formatCrop(4032, 3024, '4:3', 'auto')).toEqual({ x: 0, y: 0, w: 4032, h: 3024 });
    expect(formatCrop(4032, 3024, '16:9', 'auto')).toEqual({ x: 0, y: 378, w: 4032, h: 2268 });
    expect(formatCrop(4032, 3024, '1:1', 'auto')).toEqual({ x: 504, y: 0, w: 3024, h: 3024 });
    expect(formatCrop(4032, 3024, '3:2', 'auto')).toEqual({ x: 0, y: 168, w: 4032, h: 2688 });
    // hochkant aufgenommen, automatisch: bleibt hoch
    expect(formatCrop(3024, 4032, '16:9', 'auto')).toEqual({ x: 378, y: 0, w: 2268, h: 4032 });
  });

  it('„Hoch“ bzw. „Quer“ erzwingt die Lage – aus der Mitte zugeschnitten', () => {
    expect(formatCrop(4032, 3024, '4:3', 'portrait')).toEqual({ x: 882, y: 0, w: 2268, h: 3024 });
    expect(formatCrop(3024, 4032, '4:3', 'landscape')).toEqual({ x: 0, y: 882, w: 3024, h: 2268 });
    expect(formatCrop(3024, 4032, '4:3', 'portrait')).toEqual({ x: 0, y: 0, w: 3024, h: 4032 });
  });

  it('drei Auflösungen: längste Kante', () => {
    expect(qualityMax('klein')).toBe(1280);
    expect(qualityMax('mittel')).toBe(2560);
    expect(qualityMax('hoch')).toBe(4096);
  });
});
