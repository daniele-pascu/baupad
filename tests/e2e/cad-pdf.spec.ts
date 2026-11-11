import { expect, test, type Page } from './fixtures';
import { execFileSync } from 'node:child_process';
import { catchDownload, createProject, freshStart, pickTool, saveDownload, waitSaved } from './helpers';

/** CAD Phase 7: PDF mit allen CAD-Objekten – Hilfslinien nie im PDF, Bögen/Drehungen/Maße drin */

test.describe.configure({ mode: 'serial' });

let page: Page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
});
test.afterAll(async () => {
  await page.close();
});

type El = { id: string; type: string; offset?: number; shape: { type: string; x: number; y: number; w: number; h: number; rotation?: number; points?: number[][] } };
async function elements(): Promise<El[]> {
  return page.evaluate(
    () =>
      new Promise<El[]>((resolve) => {
        const req = indexedDB.open('schadstellen-aufmass');
        req.onsuccess = () => {
          const all = req.result.transaction('elements').objectStore('elements').getAll();
          all.onsuccess = () => {
            req.result.close();
            resolve((all.result as (El & { deletedAt: number | null; createdAt: number })[]).filter((d) => !d.deletedAt).sort((a, b) => a.createdAt - b.createdAt));
          };
        };
      }),
  );
}
const sheet = () => page.getByTestId('drawing-sheet');
const near = (a: number, b: number, tol = 0.011) => expect(Math.abs(a - b), `${a} ≈ ${b}`).toBeLessThan(tol);
const ends = (e: El) => {
  const s = e.shape;
  const [[u0, v0], [u1, v1]] = s.points ?? [
    [0, 0],
    [1, 1],
  ];
  return [
    { x: s.x + u0 * s.w, y: s.y + v0 * s.h },
    { x: s.x + u1 * s.w, y: s.y + v1 * s.h },
  ];
};
const len = (e: El) => {
  const [a, b] = ends(e);
  return Math.hypot(b.x - a.x, b.y - a.y);
};
async function escape() {
  await page.locator('.side-head h2').click();
  await page.keyboard.press('Escape');
}
async function type(v: string) {
  await page.getByTestId('command-input').fill(v);
  await page.getByTestId('command-input').press('Enter');
}
async function line(x: number, y: number, input: string) {
  await escape();
  await pickTool(page, 'draw-line');
  await page.mouse.click(x, y);
  await type(input);
  await waitSaved(page);
}
async function screenOf(p: { x: number; y: number }) {
  const scale = Number(await page.getByTestId('plan-viewer').getAttribute('data-scale'));
  const sb = (await sheet().boundingBox())!;
  return { x: sb.x + p.x * 100 * scale, y: sb.y + p.y * 100 * scale };
}
async function click(p: { x: number; y: number }) {
  const s = await screenOf(p);
  await page.mouse.click(s.x, s.y);
}
/** Linie auswählen (Klick auf ihre Mitte) */
async function selectLine(e: El) {
  await escape();
  const [a, b] = ends(e);
  await pickTool(page, 'draw-select');
  await click({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  await expect(page.getByTestId('element-bar')).toBeVisible();
}



const tool = async (id: string) => {
  await escape();
  await pickTool(page, id);
};

test('PDF: abgerundete Linien, gedrehtes Rechteck, Maß aus Abstand, Hilfslinien nicht im PDF', async () => {
  await freshStart(page);
  await createProject(page, 'CAD PDF', {}, ['EG']);
  await page.getByTestId('draw-plan').click();
  await page.getByTestId('new-drawing').locator('[data-field="planNumber"]').fill('P7');
  await page.getByTestId('new-drawing-save').click();
  await expect(sheet()).toBeVisible();

  // Raum aus zwei Linien mit abgerundeter Ecke
  const s1 = await screenOf({ x: 3, y: 8 });
  await line(s1.x, s1.y, '6;0');
  const s2 = await screenOf({ x: 10, y: 7 });
  await line(s2.x, s2.y, '0;4');
  await tool('draw-fillet');
  await type('1');
  await click({ x: 5, y: 8 });
  await click({ x: 10, y: 5 });
  await waitSaved(page);
  expect((await elements()).some((e) => e.type === 'arc')).toBe(true);

  // Rechteck einfügen, um 30° drehen
  await tool('draw-rect');
  await page.getByTestId('insert-length').fill('3');
  await page.getByTestId('insert-width').fill('2');
  await page.getByTestId('insert-submit').click();
  await waitSaved(page);
  const r = (await elements()).find((e) => e.type === 'rect')!;
  await tool('draw-rotate');
  await expect(page.getByTestId('command-prompt')).toContainText('Objekte wählen');
  await click({ x: r.shape.x + r.shape.w / 2, y: r.shape.y });
  await page.getByTestId('command-next').click();
  await click({ x: r.shape.x, y: r.shape.y });
  await type('30');
  await waitSaved(page);
  expect((await elements()).find((e) => e.id === r.id)!.shape.rotation).toBe(330);

  // Abstand der beiden Linien-Enden als Maß
  await tool('draw-distance');
  await click({ x: 4, y: 8 });
  await click({ x: 10, y: 6 });
  await expect(page.getByTestId('distance-result')).toContainText('rechtwinklig');
  await page.getByTestId('distance-dimension').click();
  await waitSaved(page);
  expect((await elements()).some((e) => e.type === 'dimension')).toBe(true);

  // Hilfslinien quer über die ganze Zeichnung
  await tool('draw-guide');
  await page.getByTestId('guide-angle').selectOption('45');
  await click({ x: 6, y: 9 });
  await page.getByTestId('guide-angle').selectOption('0');
  await click({ x: 6, y: 10 });
  await waitSaved(page);
  await expect(page.getByTestId('guide-line')).toHaveCount(2);
  await page.getByTestId('command-done').click();

  // im Aufmaß keine Hilfslinien
  await page.getByTestId('mode-measure-tab').click();
  await expect(page.getByTestId('guide-line')).toHaveCount(0);

  // PDF: eine Seite, Maßtext drin, keine Hilfslinien-Farbe, Zeichnung vorhanden
  const dl = await catchDownload(page, async () => {
    await page.getByTestId('export-pdf-plan').click();
    await page.getByTestId('pdf-export-run').click();
  });
  const pdf = await saveDownload(dl, 'cad-phase7.pdf');
  expect(execFileSync('pdfinfo', [pdf], { encoding: 'utf8' })).toMatch(/Pages:\s+1/);
  expect(execFileSync('pdftotext', [pdf, '-'], { encoding: 'utf8' })).toContain('41'); // Maß 1,41 m (schräg gesetzt, daher zerlegt)
  execFileSync('pdftoppm', ['-png', '-r', '100', '-singlefile', pdf, 'tests/output/cad-phase7']);
  const stats = JSON.parse(
    execFileSync(
      'python3',
      [
        '-c',
        `import json,sys
from PIL import Image
im=Image.open('tests/output/cad-phase7.png').convert('RGB')
px=im.load(); w,h=im.size
pink=dark=0
for y in range(0,h,1):
  for x in range(0,w,1):
    r,g,b=px[x,y]
    if r>180 and g<110 and 70<b<160: pink+=1
    if r<90 and g<90 and b<90: dark+=1
print(json.dumps({'pink':pink,'dark':dark}))`,
      ],
      { encoding: 'utf8' },
    ),
  ) as { pink: number; dark: number };
  expect(stats.pink).toBe(0); // Hilfslinien (rosa, strichpunktiert) nie im PDF
  expect(stats.dark).toBeGreaterThan(500); // Linien, Bogen, Rechteck, Maß
});
