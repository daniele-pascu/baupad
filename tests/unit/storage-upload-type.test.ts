import { describe, expect, it } from 'vitest';
import { putTypeAllowed } from '../../supabase/functions/storage/index';

describe('Ablage: Hochladen nur mit passender Dateiart', () => {
  it('Fotos als JPEG, Pläne als PDF, Dateien als Binärdaten bzw. Excel', () => {
    expect(putTypeAllowed('photos/abcd1234/data.jpg', 'image/jpeg')).toBe(true);
    expect(putTypeAllowed('photos/abcd1234/thumb.jpg', undefined)).toBe(true);
    expect(putTypeAllowed('files/abcd1234/pdf.pdf', 'application/pdf')).toBe(true);
    expect(putTypeAllowed('files/abcd1234/data.bin', 'application/octet-stream')).toBe(true);
    expect(putTypeAllowed('files/abcd1234/data.bin', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe(true);
  });
  it('kein HTML, SVG oder Skript – auch nicht unter einem Foto-Namen', () => {
    expect(putTypeAllowed('photos/abcd1234/data.jpg', 'text/html')).toBe(false);
    expect(putTypeAllowed('photos/abcd1234/data.jpg', 'image/svg+xml')).toBe(false);
    expect(putTypeAllowed('files/abcd1234/pdf.pdf', 'application/javascript')).toBe(false);
    expect(putTypeAllowed('files/abcd1234/data.bin', 'text/html')).toBe(false);
  });
});
