// Erzeugt aus den Formular-PDFs die Textpositionen und Linien als JSON (Eingabe für die Formular-Erkennung in den Unit-Tests).
// Aufruf: node --experimental-strip-types tests/fixtures/forms/make-form-fixtures.mjs
import * as pdfjs from '../../../node_modules/pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathSegments } from "../../../src/lib/pdf-snap.ts";

const OPS = pdfjs.OPS;
const DRAW = new Set([OPS.stroke, OPS.closeStroke, OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];

for (const name of ['mst-regieliste', 'mst-tagesbericht']) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(new URL(`./${name}.pdf`, import.meta.url))), useSystemFonts: true }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const texts = [];
  for (const it of tc.items) {
    if (!('str' in it) || !it.str.trim()) continue;
    const [a, b, c, d, e, f] = it.transform;
    const rot = Math.abs(b) > 0.01 ? 1 : 0;
    const fh = Math.hypot(c, d) || 1;
    // Ursprung oben links; bei gedrehtem Text (90°) ist die Grundlinie senkrecht
    texts.push({ str: it.str, x: +e.toFixed(2), y: +(vp.height - f).toFixed(2), w: +it.width.toFixed(2), h: +fh.toFixed(2), rot });
  }
  const list = await page.getOperatorList();
  let ctm = vp.transform;
  const stack = [];
  const segs = [];
  let pathId = 0;
  for (let i = 0; i < list.fnArray.length; i++) {
    const fn = list.fnArray[i];
    const args = list.argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = mul(ctm, args);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      if (Array.isArray(args[0]) || ArrayBuffer.isView(args[0])) ctm = mul(ctm, Array.from(args[0]));
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.constructPath) {
      const op = args[0];
      const data = args[1]?.[0];
      if (DRAW.has(op) && data && typeof data !== 'string' && 'length' in data) pathSegments(data, ctm, pathId++, segs, null);
    }
  }
  const out = { width: +vp.width.toFixed(2), height: +vp.height.toFixed(2), texts, segs: segs.map((s) => ({ x1: +s.a.x.toFixed(2), y1: +s.a.y.toFixed(2), x2: +s.b.x.toFixed(2), y2: +s.b.y.toFixed(2) })) };
  writeFileSync(new URL(`./${name}.json`, import.meta.url), JSON.stringify(out));
  const hor = out.segs.filter((s) => Math.abs(s.y1 - s.y2) < 0.5).length;
  const ver = out.segs.filter((s) => Math.abs(s.x1 - s.x2) < 0.5).length;
  console.log(name, 'texts', texts.length, 'segs', out.segs.length, 'horizontal', hor, 'vertical', ver);
}
