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

describe('Kamera: Vorschau füllt den Bildschirm, Antippen zum Scharfstellen', () => {
  it('Ausschnitt möglichst groß und mittig, der Rest des Kamerabilds füllt den Platz', async () => {
    const { previewLayout, ratioLabel } = await import('../../src/lib/camera-format');
    // Handy hochkant: Bereich 390 × 600, Kamerabild 3024 × 4032 (hoch), Format 9:16 → Ausschnitt 2268 × 4032
    const crop = { x: 378, y: 0, w: 2268, h: 4032 };
    const l = previewLayout({ w: 390, h: 600 }, { w: 3024, h: 4032 }, crop);
    expect(l.k).toBeCloseTo(600 / 4032, 6); // füllt die Höhe
    expect(l.height).toBeCloseTo(600, 3);
    expect(l.left + (crop.x + crop.w / 2) * l.k).toBeCloseTo(195, 3); // mittig
    expect(l.width).toBeGreaterThan(390); // Kamerabild breiter als der Bereich → kein schwarzer Rand
    expect(ratioLabel('16:9', true)).toBe('9:16');
    expect(ratioLabel('4:3', false)).toBe('4:3');
    expect(ratioLabel('1:1', true)).toBe('1:1');
  });

  it('Antippen → Punkt im Kamerabild (mit Zoom und gespiegelter Frontkamera)', async () => {
    const { tapToFrame } = await import('../../src/lib/camera-format');
    const box = { w: 400, h: 300 };
    const view = { left: 0, top: 0, width: 400, height: 300 };
    expect(tapToFrame(200, 150, box, view)).toEqual({ x: 0.5, y: 0.5 });
    expect(tapToFrame(100, 75, box, view)).toEqual({ x: 0.25, y: 0.25 });
    // 2× digital: Antippen am Rand trifft nur noch das Viertel um die Mitte
    expect(tapToFrame(0, 0, box, view, 2)).toEqual({ x: 0.25, y: 0.25 });
    expect(tapToFrame(100, 75, box, view, 1, true)).toEqual({ x: 0.75, y: 0.25 });
    expect(tapToFrame(-50, 400, box, view)).toEqual({ x: 0, y: 1 });
  });
});
