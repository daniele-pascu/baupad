import { expect, test, type Page } from './fixtures';
import { createProject, freshStart, pickTool, waitSaved } from './helpers';

/** ÖNORM-Bauteile: Sanitär (Wandseite oben) und Pendeltür (Wand in der Mitte) setzen sich mit der Wandlinie auf die Linie */

test.describe.configure({ mode: 'serial' });
let page: Page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
});
test.afterAll(async () => {
  await page.close();
});

type El = { id: string; type: string; symbol?: { id: string; flipX?: boolean; flipY?: boolean }; shape: { x: number; y: number; w: number; h: number; rotation?: number } };
const elements = () =>
  page.evaluate(
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
const near = (a: number, b: number, tol = 0.011) => expect(Math.abs(a - b), `${a} ≈ ${b}`).toBeLessThan(tol);
async function screenOf(p: { x: number; y: number }) {
  const scale = Number(await page.getByTestId('plan-viewer').getAttribute('data-scale'));
  const sb = (await page.getByTestId('drawing-sheet').boundingBox())!;
  return { x: sb.x + p.x * 100 * scale, y: sb.y + p.y * 100 * scale };
}

test('WC an der Wand, Pendeltür mittig auf der Wand, neue Gruppen im Bauteil-Dialog', async () => {
  await freshStart(page);
  await createProject(page, 'Sanitär', {}, ['EG']);
  await page.getByTestId('draw-plan').click();
  await page.getByTestId('new-drawing').locator('[data-field="planNumber"]').fill('S-1');
  await page.getByTestId('new-drawing-save').click();
  const sb = (await page.getByTestId('drawing-sheet').boundingBox())!;
  await pickTool(page, 'draw-line');
  await page.mouse.click(sb.x + 150, sb.y + 300);
  await page.getByTestId('command-input').fill('6;0');
  await page.getByTestId('command-input').press('Enter');
  await waitSaved(page);
  const [wall] = await elements();
  const wy = wall.shape.y;
  await page.locator('.side-head h2').click();
  await page.keyboard.press('Escape');

  // Sanitär-Taste öffnet den Dialog mit der Gruppe Sanitär; Fänge/Durchbrüche als eigene Gruppe
  await pickTool(page, 'draw-sanitary');
  const pk = page.getByTestId('symbol-picker');
  await expect(pk.getByTestId('symbol-group-sanitary')).toHaveAttribute('aria-selected', 'true');
  await expect(pk.getByTestId('symbol-bathtub')).toBeVisible();
  await pk.getByTestId('symbol-group-shaft').click();
  await expect(pk.getByTestId('symbol-chimney')).toBeVisible();
  await pk.getByTestId('symbol-group-sanitary').click();
  await pk.getByTestId('symbol-wc-wall').click();
  let p = await screenOf({ x: wall.shape.x + 1, y: wy + 0.04 });
  await page.mouse.click(p.x, p.y);
  await waitSaved(page);
  const wc = (await elements()).at(-1)!;
  expect(wc.symbol?.id).toBe('wc-wall');
  near(wc.shape.y, wy); // Wandseite (oben im Symbol) liegt auf der Linie
  // Seite wechseln: WC auf die andere Wandseite, Rückseite bleibt auf der Linie
  await page.getByTestId('command-done').click();
  await page.mouse.click(p.x, p.y + 15);
  await page.getByTestId('symbol-flip-y').click();
  await waitSaved(page);
  const wc2 = (await elements()).find((e) => e.id === wc.id)!;
  expect(wc2.symbol?.flipY).toBe(true);
  near(wc2.shape.y + wc2.shape.h, wy);

  // Pendeltür: Wandlinie in der Mitte des Symbols
  await page.keyboard.press('Escape');
  await pickTool(page, 'draw-door');
  await pk.getByTestId('symbol-door-swing').click();
  p = await screenOf({ x: wall.shape.x + 4, y: wy + 0.04 });
  await page.mouse.click(p.x, p.y);
  await waitSaved(page);
  const sw = (await elements()).at(-1)!;
  expect(sw.symbol?.id).toBe('door-swing');
  near(sw.shape.y + sw.shape.h / 2, wy);
  await expect(page.locator('[data-symbol="wc-wall"]')).toHaveCount(1);
});
