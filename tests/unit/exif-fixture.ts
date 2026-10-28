/**
 * Testhilfe: EXIF-Block (APP1) mit DateTimeOriginal in ein JPEG einfügen – so lässt sich die Übernahme des
 * Aufnahmezeitpunkts ohne echte Kamera-Fotos prüfen. Little-Endian-TIFF, IFD0 → Exif-IFD → 0x9003.
 */
export function withExifDate(jpeg: Uint8Array, dateTime: string): Uint8Array {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('kein JPEG');
  const ascii = new TextEncoder().encode(`${dateTime}\0`); // 20 Bytes
  const tiff: number[] = [];
  const u16 = (v: number) => tiff.push(v & 0xff, (v >> 8) & 0xff);
  const u32 = (v: number) => tiff.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  // TIFF-Kopf: „II“, 42, Offset IFD0 = 8
  tiff.push(0x49, 0x49);
  u16(42);
  u32(8);
  // IFD0: ein Eintrag (ExifIFD-Zeiger) → Exif-IFD bei 8 + 2 + 12 + 4 = 26
  u16(1);
  u16(0x8769);
  u16(4);
  u32(1);
  u32(26);
  u32(0);
  // Exif-IFD: ein Eintrag DateTimeOriginal (ASCII, 20 Bytes) → Daten bei 26 + 2 + 12 + 4 = 44
  u16(1);
  u16(0x9003);
  u16(2);
  u32(ascii.length);
  u32(44);
  u32(0);
  tiff.push(...ascii);
  const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]; // „Exif\0\0“ + TIFF
  const len = payload.length + 2;
  const app1 = [0xff, 0xe1, (len >> 8) & 0xff, len & 0xff, ...payload];
  const out = new Uint8Array(jpeg.length + app1.length);
  out.set(jpeg.subarray(0, 2), 0);
  out.set(app1, 2);
  out.set(jpeg.subarray(2), 2 + app1.length);
  return out;
}
