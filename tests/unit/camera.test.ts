import { describe, expect, it } from 'vitest';
import { cameraFraming } from '../../src/pages/CameraPage';

describe('Kamera – Drehung und Zuschnitt', () => {
  it('hochkant gehalten, Sensorbild hochkant: keine Drehung, 4:3 passt', () => {
    const f = cameraFraming(1080, 1440, '4:3', 'auto', 0, false);
    expect(f.rot).toBe(0);
    expect(f.out).toEqual({ w: 1080, h: 1440 });
  });
  it('Handy quer (Oberkante links) bei Ausrichtungssperre: Sensorbild hochkant → −90° und Querformat', () => {
    const f = cameraFraming(1080, 1440, '4:3', 'auto', 90, false);
    expect(f.rot).toBe(-90);
    expect(f.out).toEqual({ w: 1440, h: 1080 });
    const g = cameraFraming(1080, 1440, '16:9', 'auto', -90, false);
    expect(g.rot).toBe(90);
    expect(g.out).toEqual({ w: 1440, h: 810 });
    expect(g.crop).toEqual({ x: (1080 - 810) / 2, y: 0, w: 810, h: 1440 });
  });
  it('Oberfläche dreht mit (Sensorbild schon quer): keine Drehung; „Hoch“ erzwingt Hochformat', () => {
    expect(cameraFraming(1440, 1080, '4:3', 'auto', 90, true).rot).toBe(0);
    const p = cameraFraming(1440, 1080, '4:3', 'portrait', null, true);
    expect(p.rot).toBe(90);
    expect(p.out).toEqual({ w: 1080, h: 1440 }); // gedrehtes Sensorbild ist schon 3:4
    expect(cameraFraming(1440, 1080, '16:9', 'portrait', null, true).out).toEqual({ w: 810, h: 1440 });
  });
  it('1:1 schneidet mittig quadratisch; ohne Sensorwert bleibt ein queres Sensorbild quer (Webcam)', () => {
    const f = cameraFraming(1440, 1080, '1:1', 'auto', null, false);
    expect(f.rot).toBe(0);
    expect(f.out).toEqual({ w: 1080, h: 1080 });
    expect(f.crop).toEqual({ x: 180, y: 0, w: 1080, h: 1080 });
  });
});
