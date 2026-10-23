// Kopiert die von pdf.js zur Laufzeit benötigten Dateien (Schriften, CMaps, WASM-Decoder)
// nach public/pdfjs, damit sie mit der App ausgeliefert und offline zwischengespeichert werden.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'pdfjs-dist');
const dest = join(root, 'public', 'pdfjs');

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(join(src, 'cmaps'), join(dest, 'cmaps'), { recursive: true });
cpSync(join(src, 'standard_fonts'), join(dest, 'standard_fonts'), { recursive: true });
cpSync(join(src, 'iccs'), join(dest, 'iccs'), { recursive: true });
cpSync(join(src, 'wasm'), join(dest, 'wasm'), {
  recursive: true,
  // quickjs wird nur für PDF-Formular-Skripte benötigt
  filter: (p) => !p.includes('quickjs'),
});
console.log('pdf.js-Dateien nach public/pdfjs kopiert');
