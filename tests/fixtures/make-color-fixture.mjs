// Farbiger Testplan (blaue Flächen, grüne Linien) als PDF – für die Schwarz-Weiß-Darstellung.
import { PDFDocument, rgb } from 'pdf-lib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const doc = await PDFDocument.create();
const page = doc.addPage([1191, 842]);
page.drawRectangle({ x: 100, y: 100, width: 991, height: 642, borderColor: rgb(0, 0.5, 0), borderWidth: 4 });
for (let i = 0; i < 4; i++) page.drawRectangle({ x: 150 + i * 230, y: 300, width: 180, height: 300, color: rgb(0.1, 0.35, 0.95) });
writeFileSync(join(dir, 'farbplan.pdf'), await doc.save());
