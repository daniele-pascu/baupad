import { describe, expect, it } from 'vitest';
import { backLenses, clampZoom, fmtZoom, lensKind, pinchZoom, zoomCrop, zoomStops } from '../../src/lib/camera-zoom';

describe('Kamera-Zoom', () => {
  it('erkennt Objektive am Namen (iPhone deutsch/englisch, Android)', () => {
    expect(lensKind('Rückseitige Ultraweitwinkelkamera')).toBe('ultra');
    expect(lensKind('Back Ultra Wide Camera')).toBe('ultra');
    expect(lensKind('Rückseitige Telekamera')).toBe('tele');
    expect(lensKind('Back Telephoto Camera')).toBe('tele');
    expect(lensKind('Rückkamera')).toBe('wide');
    expect(lensKind('Back Camera')).toBe('wide');
    expect(lensKind('Back Dual Wide Camera')).toBe('multi');
    expect(lensKind('Rückseitige Triple-Kamera')).toBe('multi');
    expect(lensKind('Frontkamera')).toBe('front');
    expect(lensKind('camera2 1, facing front')).toBe('front');
    expect(lensKind('camera2 0, facing back')).toBe('wide');
  });

  it('Objektiv-Tasten nur, wenn außer dem normalen das Ultraweitwinkel da ist; Tele nie', () => {
    const d = (id: string, label: string) => ({ kind: 'videoinput', deviceId: id, label });
    const iphone = backLenses([d('f', 'Frontkamera'), d('w', 'Rückkamera'), d('u', 'Rückseitige Ultraweitwinkelkamera'), d('t', 'Rückseitige Telekamera'), d('3', 'Rückseitige Triple-Kamera')]);
    expect(iphone.ultra?.id).toBe('u');
    expect(iphone.wide?.id).toBe('w');
    expect(iphone).not.toHaveProperty('tele');
    // nur normal + Tele → keine Objektiv-Tasten (Zoom digital bzw. mit zwei Fingern)
    expect(backLenses([d('w', 'Rückkamera'), d('t', 'Rückseitige Telekamera')])).toEqual({});
    // Android: nur „facing back“ ohne Art → keine Objektiv-Tasten (dort zoomt die Kamera selbst)
    expect(backLenses([d('0', 'camera2 0, facing back'), d('2', 'camera2 2, facing back'), d('1', 'camera2 1, facing front')])).toEqual({});
    // ohne Namen (vor der Erlaubnis) nichts
    expect(backLenses([d('a', ''), d('b', '')])).toEqual({});
  });

  it('Tasten für den Zoom der Kamera: Weitwinkel, 1× und bis zu drei Stufen', () => {
    expect(zoomStops(0.5, 10)).toEqual([0.5, 1, 2, 5, 10]);
    expect(zoomStops(0.6, 8)).toEqual([0.6, 1, 2, 3, 5]);
    expect(zoomStops(1, 4)).toEqual([1, 2, 3]);
    expect(zoomStops(1, 1.8)).toEqual([1]);
  });

  it('zwei Finger, digitaler Ausschnitt, Anzeige', () => {
    expect(pinchZoom(1, 100, 200, 1, 4)).toBe(2);
    expect(pinchZoom(2, 100, 400, 1, 4)).toBe(4);
    expect(pinchZoom(2, 200, 50, 1, 4)).toBe(1);
    expect(clampZoom(0.4, 0.5, 10)).toBe(0.5);
    expect(zoomCrop({ x: 0, y: 0, w: 640, h: 480 }, 2)).toEqual({ x: 160, y: 120, w: 320, h: 240 });
    expect(zoomCrop({ x: 10, y: 0, w: 100, h: 100 }, 1)).toEqual({ x: 10, y: 0, w: 100, h: 100 });
    expect(fmtZoom(0.5)).toBe('0,5');
    expect(fmtZoom(1)).toBe('1×');
    expect(fmtZoom(2.44)).toBe('2,4×');
  });
});
