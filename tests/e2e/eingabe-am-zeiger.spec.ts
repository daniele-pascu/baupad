import { expect, test, type Page } from './fixtures';
import { createProject, freshStart, pickTool, waitSaved } from './helpers';

/**
 * Plan zeichnen am PC, Linie: Eingabe am Zeiger – Kasten mit Abstand und Winkel.
 * Zahl + Enter = Abstand in Mausrichtung; Zahl, Tab, Winkel, Enter = Abstand im Winkel; nur Winkel + Enter = Richtung fest.
 */

test.describe.configure({ mode: 'serial' });
test.skip(({ isMobile }) => isMobile, 'nur am PC (Tastatur)');

let page: Page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
});
test.afterAll(async () => {
  await page.close();
});

type El = { type: string; shape: { x: number; y: number; w: number; h: number; points?: number[][] }; createdAt: number };
async function lines(): Promise<El[]> {
  return page.evaluate(
    () =>
      new Promise<El[]>((resolve) => {
        const req = indexedDB.open('schadstellen-aufmass');
        req.onsuccess = () => {
          const all = req.result.transaction('elements').objectStore('elements').getAll();
          all.onsuccess = () => {
            req.result.close();
            resolve((all.result as (El & { deletedAt: number | null })[]).filter((d) => !d.deletedAt && d.type === 'line').sort((a, b) => a.createdAt - b.createdAt));
          };
        };
      }),
  );
}
/** Endpunkte einer Linie (Meter) */
const ends = (l: El) => (l.shape.points ?? []).map(([px, py]) => ({ x: l.shape.x + px * l.shape.w, y: l.shape.y + py * l.shape.h }));
const near = (a: number, b: number, tol = 1e-3) => expect(Math.abs(a - b)).toBeLessThan(tol);

test('Abstand und Winkel am Zeiger eintippen, Winkel allein hält die Richtung', async () => {
  await freshStart(page);
  await createProject(page, 'Eingabe', {}, ['Halle']);
  await page.getByTestId('draw-plan').click();
  const nd = page.getByTestId('new-drawing');
  await nd.locator('[data-field="planNumber"]').fill('E-1');
  await nd.getByTestId('sheet-paper').selectOption('A3');
  await nd.getByTestId('sheet-orient').selectOption('quer');
  await nd.getByTestId('sheet-scale').selectOption('100');
  await nd.getByTestId('new-drawing-save').click();
  const sheet = page.getByTestId('drawing-sheet');
  await expect(sheet).toBeVisible();
  const sb = (await sheet.boundingBox())!;

  // 1) Zahl, Tab, Winkel, Enter: 2 m im Winkel 90° (nach oben)
  await pickTool(page, 'draw-line');
  await page.mouse.click(sb.x + 300, sb.y + 400);
  await page.mouse.move(sb.x + 380, sb.y + 380, { steps: 4 });
  await expect(page.getByTestId('dyn-input')).toBeVisible(); // Kasten am Zeiger, live
  await page.keyboard.type('2');
  await expect(page.getByTestId('dyn-dist')).toContainText('2 m');
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('dyn-arc')).toBeVisible(); // Winkelmesser am Anfangspunkt
  await page.keyboard.type('90');
  await expect(page.getByTestId('dyn-angle')).toContainText('90°');
  await page.screenshot({ path: 'tests/output/eingabe-am-zeiger.png', clip: { x: sb.x + 180, y: sb.y + 250, width: 420, height: 260 } });
  await page.keyboard.press('Enter');
  await waitSaved(page);
  let ls = await lines();
  expect(ls).toHaveLength(1);
  const [a, b] = ends(ls[0]).sort((p, q) => q.y - p.y); // a unten, b oben
  near(a.x, b.x);
  near(a.y - b.y, 2);

  // 2) nur Zahl + Enter: 1,5 m in Mausrichtung (nach rechts)
  await page.keyboard.press('Escape');
  await pickTool(page, 'draw-line');
  await page.mouse.click(sb.x + 300, sb.y + 500);
  await page.mouse.move(sb.x + 420, sb.y + 500, { steps: 4 });
  await page.keyboard.type('1,5');
  await page.keyboard.press('Enter');
  await waitSaved(page);
  ls = await lines();
  expect(ls).toHaveLength(2);
  const [c, d] = ends(ls[1]).sort((p, q) => p.x - q.x);
  near(d.x - c.x, 1.5, 0.01);

  // 3) nur Winkel + Enter: Richtung 45° fest, Länge mit der Maus
  await page.keyboard.press('Escape');
  await pickTool(page, 'draw-line');
  await page.mouse.click(sb.x + 600, sb.y + 450);
  await page.mouse.move(sb.x + 650, sb.y + 440, { steps: 3 });
  await page.keyboard.press('Tab');
  await page.keyboard.type('45');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('dyn-angle')).toContainText('fest');
  await page.mouse.move(sb.x + 720, sb.y + 300, { steps: 5 }); // irgendwo – der Punkt rutscht auf den 45°-Strahl
  await page.mouse.click(sb.x + 720, sb.y + 300);
  await waitSaved(page);
  ls = await lines();
  expect(ls).toHaveLength(3);
  const [e, f] = ends(ls[2]).sort((p, q) => p.x - q.x);
  expect(f.x - e.x).toBeGreaterThan(0.1);
  near(f.x - e.x, e.y - f.y, 1e-3); // 45°: genauso weit nach rechts wie nach oben
});
