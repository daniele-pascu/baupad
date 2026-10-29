import { expect, test, type Page } from './fixtures';
import { createProject, freshStart, pickTool, waitSaved } from './helpers';

/**
 * Phase 2 (Mini-CAD): Kopieren und Verschieben per Vektor mit Fang, Drehen, Skalieren,
 * Strecken, Trimmen, Verlängern, Bogen aus drei Punkten – über die obere Werkzeugleiste.
 */

test.describe.configure({ mode: 'serial' });

let page: Page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
});
test.afterAll(async () => {
  await page.close();
});

type El = { id: string; type: string; shape: { type: string; x: number; y: number; w: number; h: number; rotation?: number; closed?: boolean; points?: number[][] }; createdAt: number };
async function elements(): Promise<El[]> {
  return page.evaluate(
    () =>
      new Promise<El[]>((resolve) => {
        const req = indexedDB.open('schadstellen-aufmass');
        req.onsuccess = () => {
          const all = req.result.transaction('elements').objectStore('elements').getAll();
          all.onsuccess = () => {
            req.result.close();
            resolve((all.result as (El & { deletedAt: number | null })[]).filter((d) => !d.deletedAt).sort((a, b) => a.createdAt - b.createdAt));
          };
        };
      }),
  );
}
const scale = async () => Number(await page.getByTestId('plan-viewer').getAttribute('data-scale'));
const sheet = () => page.getByTestId('drawing-sheet');
/** Bildschirmpixel → Meter (1 Seiteneinheit = 1 cm) */
const m = async (px: number) => px / (await scale()) / 100;
async function drag(x1: number, y1: number, x2: number, y2: number) {
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 4 });
  await page.mouse.move(x2, y2, { steps: 4 });
  await page.mouse.up();
}
async function deselect() {
  await page.locator('.side-head h2').click();
  await page.keyboard.press('Escape');
}
async function prompt(value: string, button: string) {
  const d = page.getByTestId('prompt-dialog');
  await d.locator('input').fill(value);
  await d.getByRole('button', { name: button }).click();
}
const near = (a: number, b: number, tol = 0.02) => expect(Math.abs(a - b)).toBeLessThan(tol);

test('Kopieren und Verschieben per Basis- und Zielpunkt (mit Fang), Drehen, Skalieren', async () => {
  await freshStart(page);
  await createProject(page, 'CAD', {}, ['Halle']);
  await page.getByTestId('draw-plan').click();
  const nd = page.getByTestId('new-drawing');
  await nd.locator('[data-field="planNumber"]').fill('C-1');
  await nd.getByTestId('sheet-paper').selectOption('A4-quer');
  await nd.getByTestId('sheet-scale').selectOption('50');
  await nd.getByTestId('new-drawing-save').click();
  await expect(sheet()).toBeVisible();
  const sb = (await sheet().boundingBox())!;
  // Rechteck ziehen
  await pickTool(page, 'draw-rect');
  await drag(sb.x + 100, sb.y + 100, sb.x + 220, sb.y + 160);
  await waitSaved(page);
  const [r0] = await elements();

  // Kopieren: von der rechten oberen Ecke (Fang) 200 px nach rechts
  await pickTool(page, 'draw-copy');
  await expect(page.getByTestId('op-hint')).toContainText('Basispunkt');
  await drag(sb.x + 222, sb.y + 101, sb.x + 420, sb.y + 101);
  await waitSaved(page);
  let els = await elements();
  expect(els).toHaveLength(2);
  const c = els[1].shape;
  near(c.w, r0.shape.w, 1e-6); // Größe unverändert
  near(c.h, r0.shape.h, 1e-6);
  // Verschiebung = Vektor; der Basispunkt rastet exakt auf der Ecke ein (Ziel 1 px tiefer, frei)
  near(c.x - r0.shape.x, (await m(420 - 100)) - r0.shape.w);
  near(c.y - r0.shape.y, (await m(101 - 100)), 0.005);

  // Verschieben der Kopie um 80 px nach unten
  await pickTool(page, 'draw-move');
  await drag(sb.x + 400, sb.y + 130, sb.x + 400, sb.y + 210);
  await waitSaved(page);
  els = await elements();
  near(els[1].shape.y - r0.shape.y, await m(80));
  expect(els).toHaveLength(2);

  // Drehen um 90° und Skalieren auf die Hälfte (um den Mittelpunkt)
  await pickTool(page, 'draw-rotate');
  await prompt('90', 'Drehen');
  await waitSaved(page);
  expect((await elements())[1].shape.rotation).toBe(90);
  const before = (await elements())[1].shape;
  await pickTool(page, 'draw-scale');
  await prompt('0,5', 'Skalieren');
  await waitSaved(page);
  const after = (await elements())[1].shape;
  near(after.w, before.w / 2, 1e-4);
  near(after.x + after.w / 2, before.x + before.w / 2, 1e-4); // Mittelpunkt bleibt
  await page.screenshot({ path: 'tests/output/cad-kopieren.png' });
});

test('Strecken: Fenster über die rechte Seite, Rechteck wird breiter (ein Rückgängig-Schritt)', async () => {
  await deselect();
  const sb = (await sheet().boundingBox())!;
  const r0 = (await elements())[0];
  await pickTool(page, 'draw-stretch');
  await expect(page.getByTestId('op-hint')).toContainText('Fenster');
  await drag(sb.x + 200, sb.y + 80, sb.x + 240, sb.y + 180); // nur die rechten Ecken
  await expect(page.getByTestId('stretch-window')).toBeVisible();
  await expect(page.getByTestId('op-hint')).toContainText('Basispunkt');
  await drag(sb.x + 222, sb.y + 101, sb.x + 270, sb.y + 100); // Basispunkt rastet auf der Ecke (220|100) ein
  await waitSaved(page);
  const r1 = (await elements())[0];
  expect(r1.type).toBe('freehand'); // gestrecktes Rechteck = Fläche aus Eckpunkten
  near(r1.shape.w - r0.shape.w, await m(50));
  near(r1.shape.x, r0.shape.x, 1e-6); // linke Seite fest
  await page.getByTestId('draw-undo').click();
  await waitSaved(page);
  expect((await elements())[0].type).toBe('rect');
});

test('Trimmen und Verlängern von Linien an anderen Linien', async () => {
  await deselect();
  const sb = (await sheet().boundingBox())!;
  const line = async (x1: number, y1: number, x2: number, y2: number) => {
    await deselect();
    await pickTool(page, 'draw-line');
    await drag(sb.x + x1, sb.y + y1, sb.x + x2, sb.y + y2);
  };
  // Waagrechte Wand mit zwei Querwänden
  await line(100, 300, 600, 300);
  await line(250, 240, 250, 360);
  await line(450, 240, 450, 360);
  await waitSaved(page);
  const n0 = (await elements()).length;
  // Mittelstück zwischen den Querwänden entfernen
  await deselect();
  await pickTool(page, 'draw-trim');
  await page.mouse.click(sb.x + 350, sb.y + 300);
  await waitSaved(page);
  let els = await elements();
  expect(els).toHaveLength(n0 + 1); // Wand in zwei Teile geteilt
  const horizontals = els.filter((e) => e.type === 'line' && e.shape.h < 0.01);
  expect(horizontals).toHaveLength(2);
  // zusammen 500 px Wand minus 200 px Abstand der Querwände
  near(horizontals[0].shape.w + horizontals[1].shape.w, await m(300));

  // Kurze Linie bis zur nächsten Querwand verlängern
  await line(100, 500, 180, 500);
  await line(300, 450, 300, 560);
  await waitSaved(page);
  await deselect();
  await pickTool(page, 'draw-extend');
  await page.mouse.click(sb.x + 176, sb.y + 500);
  await waitSaved(page);
  els = await elements();
  const y450 = await m(450);
  const short = els.find((e) => e.type === 'line' && e.shape.h < 0.01 && e.shape.y > y450);
  expect(short).toBeTruthy();
  near(short!.shape.w, await m(200)); // von x = 100 bis zur Querwand bei x = 300
});

test('Bogen aus drei Punkten: Länge und Radius', async () => {
  await deselect();
  const sb = (await sheet().boundingBox())!;
  await pickTool(page, 'draw-arc');
  await expect(page.getByTestId('op-hint')).toContainText('Anfangspunkt');
  await page.mouse.click(sb.x + 650, sb.y + 300);
  await page.mouse.click(sb.x + 750, sb.y + 200);
  await page.mouse.click(sb.x + 850, sb.y + 300);
  await waitSaved(page);
  const arc = (await elements()).at(-1)!;
  expect(arc.type).toBe('arc');
  expect(arc.shape.closed).toBe(false);
  // Halbkreis mit r = 100 px
  const info = (await page.getByTestId('element-info').textContent())!;
  const num = (re: RegExp) => Number(info.match(re)![1].replace('.', '').replace(',', '.'));
  near(num(/Radius ([\d.,]+) m/), await m(100), 0.03);
  near(num(/Bogenlänge ([\d.,]+) m/), Math.PI * (await m(100)), 0.05);
  await page.screenshot({ path: 'tests/output/cad-bogen.png' });
});
