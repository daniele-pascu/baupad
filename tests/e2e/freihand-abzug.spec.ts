import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { createProject, freshStart, OUT, pickTool, waitSaved } from './helpers';

/**
 * Aufmaß: Freihand-Werkzeug (Linie bzw. Fläche genau wie gezeichnet, z. B. Risse) und
 * Abzüge/Zuschläge bei Flächen (z. B. Wand 5,50 × 2,30 abzüglich Tür) – im Dialog, in der Liste und gespeichert.
 */

test.describe.configure({ mode: 'serial' });

let page: Page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
});
test.afterAll(async () => {
  await page.close();
});

type Dmg = { kind: string; shape: { type: string; closed?: boolean; points?: number[][] }; length: number; width: number | null; area: number | null; deductions?: { label: string; count: number; length: number; width: number; add?: boolean }[] };
async function damages(): Promise<Dmg[]> {
  return page.evaluate(
    () =>
      new Promise<Dmg[]>((resolve) => {
        const req = indexedDB.open('schadstellen-aufmass');
        req.onsuccess = () => {
          const all = req.result.transaction('damages').objectStore('damages').getAll();
          all.onsuccess = () => {
            req.result.close();
            resolve((all.result as (Dmg & { deletedAt: number | null; createdAt: number })[]).filter((d) => !d.deletedAt).sort((a, b) => a.createdAt - b.createdAt));
          };
        };
      }),
  );
}
const sheet = () => page.getByTestId('drawing-sheet');

test('Freihand: wellige Linie bleibt genau wie gezeichnet (Linie mit Länge); am Startpunkt beendet = Fläche', async () => {
  await freshStart(page);
  await createProject(page, 'Freihand', {}, ['Halle']);
  await page.getByTestId('draw-plan').click();
  const nd = page.getByTestId('new-drawing');
  await nd.locator('[data-field="planNumber"]').fill('FH-1');
  await nd.getByTestId('new-drawing-save').click();
  await expect(sheet()).toBeVisible();
  await page.getByTestId('mode-measure').click();
  await pickTool(page, 'tool-freehand');
  const sb = (await sheet().boundingBox())!;
  const x = sb.x + 150;
  const y = sb.y + 200;
  // Riss: Wellenlinie ohne Absetzen
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 40; i++) await page.mouse.move(x + i * 8, y + Math.sin(i / 3) * 25);
  await page.mouse.up();
  const dlg = page.getByTestId('damage-dialog');
  await expect(dlg).toContainText('Neue Linie');
  await dlg.getByTestId('damage-save').click();
  await expect(dlg).toBeHidden();
  await waitSaved(page);
  await expect.poll(async () => (await damages()).length).toBe(1);
  let list = await damages();
  expect(list[0].kind).toBe('line');
  expect(list[0].shape).toMatchObject({ type: 'freehand', closed: false });
  expect(list[0].shape.points!.length).toBeGreaterThan(30); // alle Wellen bleiben erhalten
  expect(list[0].length).toBeGreaterThan(0);

  // geschlossene Freihandform → Fläche
  await pickTool(page, 'tool-freehand');
  const cx = sb.x + 300;
  const cy = sb.y + 420;
  await page.mouse.move(cx + 80, cy);
  await page.mouse.down();
  for (let i = 1; i <= 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    await page.mouse.move(cx + Math.cos(a) * (80 + (i % 2) * 6), cy + Math.sin(a) * 60);
  }
  await page.mouse.up();
  await expect(dlg).toContainText('Neue Fläche');
  await dlg.getByTestId('use-geometry').click();
  await dlg.getByTestId('damage-save').click();
  await waitSaved(page);
  await expect.poll(async () => (await damages()).length).toBe(2);
  list = await damages();
  expect(list[1]).toMatchObject({ kind: 'area', shape: { type: 'freehand' } });
  expect(list[1].shape.closed).not.toBe(false); // geschlossen (fehlt = geschlossen)
  expect(list[1].area).toBeGreaterThan(0);
  await waitSaved(page);
});

test('Abzüge: Wand 5,50 × 2,30 abzüglich Tür und 2 Fenster, zuzüglich Nische → netto im Dialog, in der Liste, gespeichert', async () => {
  await pickTool(page, 'tool-rect');
  const sb = (await sheet().boundingBox())!;
  await page.mouse.move(sb.x + 600, sb.y + 150);
  await page.mouse.down();
  await page.mouse.move(sb.x + 760, sb.y + 230, { steps: 5 });
  await page.mouse.up();
  const dlg = page.getByTestId('damage-dialog');
  await dlg.getByTestId('input-length').fill('5,5');
  await dlg.getByTestId('input-width').fill('2,3');
  // Tür
  await dlg.getByTestId('deduction-add').click();
  const rows = dlg.getByTestId('deduction-row');
  await rows.nth(0).getByTestId('deduction-label').fill('Tür');
  await rows.nth(0).getByTestId('deduction-length').fill('1');
  await rows.nth(0).getByTestId('deduction-width').fill('2,1');
  await expect(rows.nth(0).getByTestId('deduction-area')).toHaveText('−2,10 m²');
  // 2 Fenster
  await dlg.getByTestId('deduction-add').click();
  await rows.nth(1).getByTestId('deduction-label').fill('Fenster');
  await rows.nth(1).getByTestId('deduction-count').fill('2');
  await rows.nth(1).getByTestId('deduction-length').fill('1');
  await rows.nth(1).getByTestId('deduction-width').fill('1,2');
  // Nische hinzurechnen
  await dlg.getByTestId('deduction-add-plus').click();
  await rows.nth(2).getByTestId('deduction-label').fill('Nische');
  await rows.nth(2).getByTestId('deduction-length').fill('0,5');
  await rows.nth(2).getByTestId('deduction-width').fill('1');
  // 12,65 − 2,10 − 2,40 + 0,50 = 8,65
  await expect(dlg.getByTestId('deduction-sum')).toContainText('Brutto 12,65 m²');
  await expect(dlg.getByTestId('deduction-sum')).toContainText('netto 8,65 m²');
  await expect(dlg.getByTestId('area-result')).toContainText('8,65 m²');
  await dlg.screenshot({ path: join(OUT, 'abzuege-dialog.png') });
  // schmaler Bildschirm (Handy): Zeilen brechen um, nichts ragt heraus
  await page.setViewportSize({ width: 390, height: 844 });
  await dlg.getByTestId('deductions').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(OUT, 'abzuege-handy.png') });
  expect(await dlg.getByTestId('deductions').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 });
  // unvollständige Zeile verhindert das Speichern
  await dlg.getByTestId('deduction-add').click();
  await dlg.getByTestId('damage-save').click();
  await expect(rows.nth(3)).toContainText('Breite und Höhe fehlen.');
  await rows.nth(3).getByTestId('deduction-remove').click();
  await dlg.getByTestId('damage-save').click();
  await expect(dlg).toBeHidden();
  await expect(page.locator('.toast', { hasText: '8,65 m²' })).toHaveCount(1);

  const row = page.locator('[data-testid="aufmass-row"]').last();
  await expect(row.getByTestId('row-area')).toHaveText('8,65');
  const sub = page.getByTestId('row-deductions').last();
  await expect(sub).toContainText('brutto 12,65 m²');
  await expect(sub).toContainText('− 2,10 m² (Tür)');
  await expect(sub).toContainText('− 2,40 m² (2× Fenster)');
  await expect(sub).toContainText('+ 0,50 m² (Nische)');
  await expect(sub).toContainText('netto 8,65 m²');
  await waitSaved(page);
  await expect.poll(async () => (await damages()).length).toBe(3);
  const d = (await damages()).at(-1)!;
  expect(d.area).toBeCloseTo(8.65, 6);
  expect(d.deductions).toHaveLength(3);
  expect(d.deductions![2]).toMatchObject({ label: 'Nische', add: true });

  // Bearbeiten: Höhe ändern → netto neu; Abzüge bleiben
  await row.click();
  await page.getByTestId('selection-bar').getByRole('button', { name: /bearbeiten/i }).first().click();
  await expect(dlg.getByTestId('deduction-row')).toHaveCount(3);
  await dlg.getByTestId('input-width').fill('2,5'); // 13,75 − 4,50 + 0,50 = 9,75
  await expect(dlg.getByTestId('deduction-sum')).toContainText('netto 9,75 m²');
  await dlg.getByTestId('damage-save').click();
  await expect(row.getByTestId('row-area')).toHaveText('9,75');
  await waitSaved(page);
});
