import { expect, test, type Page } from './fixtures';
import { createProject, freshStart, pickTool, waitSaved } from './helpers';

/**
 * Aufmaß: zuerst die Messart wählen (Fläche, Wand, Länge, Volumen, Stück, Schadstelle, Frei), danach misst jedes
 * Werkzeug in dieser Art. Dialog mit Feldern je Messart, Tabelle und Rechenweg.
 */

test.describe.configure({ mode: 'serial' });
let page: Page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
});
test.afterAll(async () => {
  await page.close();
});

type Dmg = { id: string; measureType?: string; kind?: string; count?: number; length: number; width: number | null; depth: number | null; area: number | null; qty?: number | null; unit?: string | null; workArea?: string | null; damageType?: string | null; createdAt: number };
const damages = () =>
  page.evaluate(
    () =>
      new Promise<Dmg[]>((resolve) => {
        const req = indexedDB.open('schadstellen-aufmass');
        req.onsuccess = () => {
          const all = req.result.transaction('damages').objectStore('damages').getAll();
          all.onsuccess = () => {
            req.result.close();
            resolve((all.result as (Dmg & { deletedAt: number | null })[]).filter((d) => !d.deletedAt).sort((a, b) => a.createdAt - b.createdAt));
          };
        };
      }),
  );
/** zuletzt gespeicherte Messung (nach dem Speichern) */
async function lastDmg() {
  await waitSaved(page);
  return (await damages()).at(-1)!;
}
const num = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));
const scale = async () => Number(await page.getByTestId('plan-viewer').getAttribute('data-scale'));
const dlg = () => page.getByTestId('damage-dialog');

async function chooseType(id: string) {
  await pickTool(page, 'tool-mtype');
  await expect(page.getByTestId('mtype-menu')).toBeVisible();
  await page.getByTestId(`mtype-${id}`).click();
  await expect(page.getByTestId('tool-mtype')).toHaveAttribute('data-value', id);
}
/** Rechteck w × h Pixel ab (x, y) ziehen */
async function rect(x: number, y: number, w: number, h: number) {
  await pickTool(page, 'tool-rect');
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + w / 2, y + h / 2, { steps: 4 });
  await page.mouse.move(x + w, y + h, { steps: 4 });
  await page.mouse.up();
  await expect(dlg()).toBeVisible();
}

test('Messart wählen, dann mit beliebigem Werkzeug messen: Wand, Stück, Frei, Volumen, Anzahl', async () => {
  await freshStart(page);
  await createProject(page, 'Messarten', {}, ['EG']);
  await page.getByTestId('draw-plan').click();
  const nd = page.getByTestId('new-drawing');
  await nd.locator('[data-field="planNumber"]').fill('M-1');
  await nd.getByTestId('sheet-scale').selectOption('50');
  await nd.getByTestId('new-drawing-save').click();
  await page.getByTestId('mode-measure').click();
  const sb = (await page.getByTestId('drawing-sheet').boundingBox())!;
  const s = await scale();
  const px = (m: number) => m * 100 * s;
  const x = sb.x + 120;
  const y = sb.y + 120;

  // Standard: automatisch
  await expect(page.getByTestId('tool-mtype')).toContainText('Automatisch');

  // 1) Wand mit einem Rechteck: Umfang aus dem Plan × Höhe
  await chooseType('wand');
  await rect(x, y, px(4), px(3));
  await expect(dlg()).toContainText('Neue Messung: Wand');
  await expect(dlg().getByTestId('measure-type-select')).toHaveValue('wand');
  const len = num(await dlg().getByTestId('geometry-length').inputValue());
  expect(Math.abs(len - 14)).toBeLessThan(0.1); // Umfang 2 × (4 + 3)
  await dlg().getByTestId('input-width').fill('2,5');
  const wallArea = num((await dlg().getByTestId('wall-area').textContent())!.replace(/\s*m²/, ''));
  expect(Math.abs(wallArea - len * 2.5)).toBeLessThan(0.02);
  await dlg().getByTestId('input-work-area').fill('Mauerwerk');
  await dlg().getByTestId('damage-save').click();
  await expect(dlg()).toBeHidden();
  let d = await lastDmg();
  expect(d.measureType).toBe('wand');
  expect(d.workArea).toBe('Mauerwerk');
  expect(Math.abs(d.area! - len * 2.5)).toBeLessThan(0.02);
  await expect(page.locator('[data-testid="aufmass-row"]').last().getByTestId('row-kind')).toHaveAttribute('title', 'Wand');

  // 2) Stück mit einem Rechteck: Anzahl
  await chooseType('stueck');
  await rect(x + px(6), y, px(1), px(1));
  await expect(dlg()).toContainText('Neue Messung: Stück');
  await expect(dlg().getByTestId('input-length')).toHaveCount(0);
  await dlg().getByTestId('input-count').fill('4');
  await expect(dlg().getByTestId('count-result')).toHaveText('4 Stk');
  await dlg().getByTestId('damage-save').click();
  d = await lastDmg();
  expect(d.measureType).toBe('stueck');
  expect(d.count).toBe(4);
  expect(d.length).toBe(0);
  await expect(page.locator('[data-testid="aufmass-row"]').last().getByTestId('row-qty')).toHaveText('4 Stk');

  // 3) Frei: eigene Rechnung und Einheit
  await chooseType('frei');
  await rect(x + px(8), y, px(1), px(1));
  await dlg().getByTestId('input-formula').fill('2*3,5+1,2');
  await dlg().getByTestId('input-unit').fill('kg');
  await expect(dlg().getByTestId('free-result')).toHaveText('8,20 kg');
  await dlg().getByTestId('damage-save').click();
  d = await lastDmg();
  expect(d.measureType).toBe('frei');
  expect(d.qty).toBe(8.2);
  expect(d.unit).toBe('kg');
  await expect(page.locator('[data-testid="aufmass-row"]').last().getByTestId('row-qty')).toContainText('8,20 kg');

  // 4) Volumen: Höhe/Tiefe ist Pflicht
  await chooseType('volumen');
  await rect(x, y + px(5), px(2), px(1));
  await dlg().getByTestId('input-length').fill('2');
  await dlg().getByTestId('input-width').fill('1,5');
  await dlg().getByTestId('damage-save').click();
  await expect(dlg()).toContainText('Für das Volumen die Höhe bzw. Tiefe eingeben.');
  await dlg().getByTestId('input-depth').fill('0,2');
  await expect(dlg().getByTestId('volume-result')).toContainText('0,60 m³');
  await dlg().getByTestId('damage-save').click();
  await expect(dlg()).toBeHidden();
  d = await lastDmg();
  expect(d.measureType).toBe('volumen');
  expect(d.area).toBe(3);
  expect(d.depth).toBe(0.2);

  // 5) Fläche mit Anzahl: 3 × (2 × 1,5)
  await chooseType('flaeche');
  await rect(x + px(4), y + px(5), px(2), px(1));
  await dlg().getByTestId('input-length').fill('2');
  await dlg().getByTestId('input-width').fill('1,5');
  await dlg().getByTestId('input-count').fill('3');
  await dlg().getByTestId('damage-save').click();
  await expect(dlg()).toBeHidden();
  d = await lastDmg();
  expect(d.measureType).toBe('flaeche');
  expect(d.count).toBe(3);
  expect(d.area).toBe(9);

  // 6) Länge mit einem Rechteck: Umfang
  await chooseType('laenge');
  await rect(x + px(8), y + px(5), px(2), px(1));
  await expect(dlg()).toContainText('Neue Messung: Länge');
  const l2 = num(await dlg().getByTestId('geometry-length').inputValue());
  expect(Math.abs(l2 - 6)).toBeLessThan(0.1);
  await dlg().getByTestId('damage-save').click();
  await expect(dlg()).toBeHidden();
  d = await lastDmg();
  expect(d.measureType).toBe('laenge');
  expect(d.kind).toBe('line');

  // 7) Messart im Dialog umstellen: Schadstelle mit Schadensart
  await rect(x + px(11), y, px(1), px(1));
  await dlg().getByTestId('measure-type-select').selectOption('schadstelle');
  await expect(dlg()).toContainText('Neue Messung: Schadstelle');
  await dlg().getByTestId('input-length').fill('1');
  await dlg().getByTestId('input-width').fill('1');
  await dlg().getByTestId('input-damage-type').fill('Abplatzung');
  await dlg().getByTestId('damage-save').click();
  await expect(dlg()).toBeHidden();
  d = await lastDmg();
  expect(d.measureType).toBe('schadstelle');
  expect(d.kind).toBe('damage');
  expect(d.damageType).toBe('Abplatzung');
  await waitSaved(page);

  // Messart bleibt gemerkt (nach Neuladen)
  await page.reload();
  await expect(page.getByTestId('tool-mtype')).toHaveAttribute('data-value', 'laenge');
});
