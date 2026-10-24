import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { catchDownload, createProject, freshStart, saveDownload, waitSaved, pickTool } from './helpers';

/**
 * Präzises Zeichnen (Paket B) und Papierformat/Maßstab (Paket C): freie Maße ohne Rastern,
 * Begrenzung auf das Blatt, Linien-Endpunkte, Eckpunkte, Fläche aus Punkten, Format im PDF.
 */

test.describe.configure({ mode: 'serial' });

let page: Page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
});
test.afterAll(async () => {
  await page.close();
});

type El = { id: string; type: string; shape: { type: string; x: number; y: number; w: number; h: number; closed?: boolean; points?: number[][] }; createdAt: number };
async function stored(store: string): Promise<El[]> {
  return page.evaluate(
    (name) =>
      new Promise<El[]>((resolve) => {
        const req = indexedDB.open('schadstellen-aufmass');
        req.onsuccess = () => {
          const all = req.result.transaction(name).objectStore(name).getAll();
          all.onsuccess = () => {
            req.result.close();
            resolve((all.result as (El & { deletedAt: number | null })[]).filter((d) => !d.deletedAt).sort((a, b) => a.createdAt - b.createdAt));
          };
        };
      }),
    store,
  );
}
const scale = async () => Number(await page.getByTestId('plan-viewer').getAttribute('data-scale'));
const sheet = () => page.getByTestId('drawing-sheet');
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

test('Papierformat wählen: A4 hoch 1:50 – Blattgröße, Anzeige und gespeichert', async () => {
  await freshStart(page);
  await createProject(page, 'Präzise', {}, ['Halle']);
  await page.getByTestId('draw-plan').click();
  const nd = page.getByTestId('new-drawing');
  await nd.locator('[data-field="planNumber"]').fill('F-1');
  await nd.getByTestId('sheet-paper').selectOption('A4-hoch');
  await nd.getByTestId('sheet-scale').selectOption('50');
  // (210 − 2·10 mm) × 50 = 9,50 m; (297 − 2·10 − 14 mm) × 50 = 13,15 m
  await expect(nd.getByTestId('sheet-size')).toContainText('9,50 × 13,15 m');
  await nd.getByTestId('new-drawing-save').click();
  await expect(sheet()).toBeVisible();
  await expect(page.getByTestId('sheet-label')).toHaveText('A4 Hochformat · 1:50');
  await waitSaved(page);
  const plans = await stored('plans');
  expect(plans[0]).toMatchObject({ pageWidth: 950, pageHeight: 1315, drawing: { paper: 'A4-hoch', scale: 50, unit: 'm' } });
  await page.reload();
  await expect(page.getByTestId('sheet-label')).toHaveText('A4 Hochformat · 1:50');
});

test('Freie Maße ohne Raster; Formen bleiben auf dem Blatt', async () => {
  // Raster ist standardmäßig aus
  await expect(page.getByTestId('grid-toggle')).toHaveAttribute('aria-pressed', 'false');
  await pickTool(page, 'draw-rect');
  const sb = (await sheet().boundingBox())!;
  const s = await scale();
  const x1 = sb.x + 41;
  const y1 = sb.y + 37;
  await drag(x1, y1, x1 + 137, y1 + 61);
  await waitSaved(page);
  const r = (await stored('elements'))[0];
  // Größe entspricht genau der Bewegung (px / Zoom / 100 cm), keine Rundung auf 0,5 m
  expect(Math.abs(r.shape.w - 137 / s / 100)).toBeLessThan(0.003);
  expect(Math.abs(r.shape.h - 61 / s / 100)).toBeLessThan(0.003);
  // Exakte Eingabe danach, z. B. 1,38 m
  await page.getByTestId('element-length').fill('1,38');
  await page.getByTestId('element-length').press('Enter');
  await expect(page.locator('.dims [data-dim="1,38 m"]').first()).toBeVisible();

  // Über den Blattrand hinaus ziehen → Form endet am Rand (9,50 × 13,15 m)
  await deselect();
  await pickTool(page, 'draw-rect');
  await drag(sb.x + sb.width - 60, sb.y + sb.height - 60, sb.x + sb.width + 150, sb.y + sb.height + 150);
  await waitSaved(page);
  const edge = (await stored('elements'))[1];
  expect(edge.shape.x + edge.shape.w).toBeLessThanOrEqual(9.5 + 1e-6);
  expect(edge.shape.y + edge.shape.h).toBeLessThanOrEqual(13.15 + 1e-6);
  expect(edge.shape.w).toBeGreaterThan(0.3);
});

test('Linie: Endpunkte einzeln verschieben, Länge bleibt bearbeitbar', async () => {
  await deselect();
  await pickTool(page, 'draw-line');
  await page.getByTestId('insert-length').fill('3');
  await page.getByRole('button', { name: 'Richtung nach rechts' }).click();
  await page.getByTestId('insert-submit').click();
  await expect(page.getByTestId('element-bar')).toContainText('Linie');
  await pickTool(page, 'draw-select');
  // Eine Linie hat genau zwei Anfasser – ihre Endpunkte (kein Rahmen wie bei einem Rechteck)
  await expect(page.locator('.vertex-handle')).toHaveCount(2);
  await expect(page.locator('.handles .handle')).toHaveCount(0);
  await waitSaved(page);
  const before = (await stored('elements')).find((e) => e.type === 'line')!;
  const h1 = (await page.getByTestId('vertex-1').boundingBox())!;
  const s = await scale();
  await drag(h1.x + h1.width / 2, h1.y + h1.height / 2, h1.x + h1.width / 2 + 80, h1.y + h1.height / 2 + 40);
  await waitSaved(page);
  const after = (await stored('elements')).find((e) => e.type === 'line')!;
  const start = (l: El) => ({ x: l.shape.x + l.shape.points![0][0] * l.shape.w, y: l.shape.y + l.shape.points![0][1] * l.shape.h });
  expect(start(after).x).toBeCloseTo(start(before).x, 3); // anderer Endpunkt bleibt
  expect(start(after).y).toBeCloseTo(start(before).y, 3);
  const len = Math.hypot(after.shape.w, after.shape.h);
  expect(Math.abs(len - Math.hypot(3 + 80 / s / 100, 40 / s / 100))).toBeLessThan(0.02);
  // Länge exakt setzen
  await page.getByTestId('element-length').fill('4,25');
  await page.getByTestId('element-length').press('Enter');
  await expect(page.locator('.dims [data-dim="4,25 m"]').first()).toBeVisible();
});

test('Rechteck über Eckpunkte zum unregelmäßigen Viereck; Fläche aus Punkten', async () => {
  await deselect();
  // erstes Rechteck auswählen (Klick auf die Kante)
  const rect = page.locator('[data-element="rect"] path:last-child').first();
  const rb = (await rect.boundingBox())!;
  await page.mouse.click(rb.x + 2, rb.y + rb.height / 2);
  await expect(page.getByTestId('element-bar')).toContainText('Rechteck');
  await expect(page.locator('.vertex-handle')).toHaveCount(4);
  const v2 = (await page.getByTestId('vertex-2').boundingBox())!;
  await drag(v2.x + v2.width / 2, v2.y + v2.height / 2, v2.x + v2.width / 2 + 50, v2.y + v2.height / 2 + 30);
  await expect(page.getByTestId('element-bar')).toContainText('Fläche');
  await expect(page.getByTestId('element-info')).toContainText('Seiten');
  await waitSaved(page);
  const q = (await stored('elements'))[0];
  expect(q.shape.type).toBe('freehand');
  expect(q.shape.closed).toBe(true);
  expect(q.shape.points).toHaveLength(4);

  // Werkzeug „Fläche“: Punkte setzen, mit dem ersten Punkt abschließen
  await deselect();
  await pickTool(page, 'draw-polygon');
  const sb = (await sheet().boundingBox())!;
  const s = await scale();
  const ox = sb.x + 60;
  const oy = sb.y + sb.height - 200;
  for (const [dx, dy] of [[0, 0], [100, 0], [100, 60], [0, 60]]) await page.mouse.click(ox + dx, oy + dy);
  await expect(page.getByTestId('polygon-bar')).toContainText('4 Punkte');
  await expect(page.getByTestId('polygon-preview')).toBeVisible();
  await page.mouse.click(ox + 1, oy + 1); // erster Punkt → schließen
  await expect(page.getByTestId('element-bar')).toContainText('Fläche');
  const expected = (100 / s / 100) * (60 / s / 100);
  const info = await page.getByTestId('element-info').textContent();
  const area = Number(info!.match(/Fläche ([\d.,]+) m²/)![1].replace('.', '').replace(',', '.'));
  expect(Math.abs(area - expected)).toBeLessThan(0.05);
  await waitSaved(page);
  const poly = (await stored('elements')).at(-1)!;
  expect(poly.shape).toMatchObject({ type: 'freehand', closed: true });
  expect(poly.shape.points).toHaveLength(4);
});

test('Mauszeiger: Pfeil im Auswahlmodus, „Verschieben“ nur über dem ausgewählten Objekt', async () => {
  await deselect();
  await pickTool(page, 'draw-select');
  const viewer = page.getByTestId('plan-viewer');
  const sb = (await sheet().boundingBox())!;
  await page.mouse.move(sb.x + sb.width / 2, sb.y + 10);
  expect(await viewer.evaluate((el) => getComputedStyle(el).cursor)).toBe('default');
  const rect = page.locator('[data-element="freehand"] path:last-child').first();
  const rb = (await rect.boundingBox())!;
  await page.mouse.click(rb.x + rb.width / 2, rb.y + rb.height / 2);
  await page.mouse.move(rb.x + rb.width / 2 + 3, rb.y + rb.height / 2 + 3);
  await expect.poll(() => viewer.evaluate((el) => getComputedStyle(el).cursor)).toBe('move');
});

test('Aufmaß: Fläche aus Punkten als Messung; Markierung bleibt auf dem Blatt', async () => {
  await deselect();
  await page.getByTestId('mode-measure').click();
  await pickTool(page, 'tool-polygon');
  const sb = (await sheet().boundingBox())!;
  for (const [dx, dy] of [[150, 150], [260, 150], [210, 230]]) await page.mouse.click(sb.x + dx, sb.y + dy);
  await page.getByTestId('polygon-finish').click();
  const dlg = page.getByTestId('damage-dialog');
  await expect(dlg).toBeVisible();
  await dlg.getByTestId('input-length').fill('1,2');
  await dlg.getByTestId('input-width').fill('0,8');
  await dlg.getByTestId('damage-save').click();
  await expect(page.locator('[data-testid="aufmass-row"]')).toHaveCount(1);
  // Markierung über den Blattrand hinaus → endet am Rand
  await pickTool(page, 'tool-rect');
  await drag(sb.x + sb.width - 40, sb.y + 300, sb.x + sb.width + 200, sb.y + 360);
  await dlg.getByTestId('input-length').fill('1');
  await dlg.getByTestId('input-width').fill('1');
  await dlg.getByTestId('damage-save').click();
  await waitSaved(page);
  const dm = await page.evaluate(
    () =>
      new Promise<{ shape: { x: number; w: number } }[]>((resolve) => {
        const req = indexedDB.open('schadstellen-aufmass');
        req.onsuccess = () => {
          const all = req.result.transaction('damages').objectStore('damages').getAll();
          all.onsuccess = () => resolve(all.result);
        };
      }),
  );
  for (const d of dm) expect(d.shape.x + d.shape.w).toBeLessThanOrEqual(950 + 1e-6);
});

test('Format ändern und PDF im gewählten Format mit Maßstab', async () => {
  let dl = await catchDownload(page, async () => {
    await page.getByTestId('export-pdf-plan').click();
    await page.getByTestId('pdf-export-run').click();
  });
  let pdf = await saveDownload(dl, 'format-a4.pdf');
  expect(execFileSync('pdfinfo', [pdf], { encoding: 'utf8' })).toMatch(/Page size:\s+595\.2\d* x 841\.8\d*/);
  let text = execFileSync('pdftotext', [pdf, '-'], { encoding: 'utf8' });
  expect(text).toContain('Maßstab 1:50 (A4 Hoch)');
  expect(text).toContain('4,25 m'); // reale Maße, nicht Papiermaße
  expect(text).toMatch(/^2\s?m$/m); // Maßstabsleiste

  // Format nachträglich ändern: A3 quer 1:100
  await page.getByTestId('sheet-label').click();
  const pd = page.getByTestId('plan-details');
  await pd.getByTestId('sheet-paper').selectOption('A3-quer');
  await pd.getByTestId('sheet-scale').selectOption('100');
  await expect(pd.getByTestId('sheet-size')).toContainText('40,00 × 26,30 m');
  await pd.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByTestId('sheet-label')).toHaveText('A3 Querformat · 1:100');
  await waitSaved(page);
  dl = await catchDownload(page, async () => {
    await page.getByTestId('export-pdf-plan').click();
    await page.getByTestId('pdf-export-run').click();
  });
  pdf = await saveDownload(dl, 'format-a3.pdf');
  expect(execFileSync('pdfinfo', [pdf], { encoding: 'utf8' })).toMatch(/Page size:\s+1190\.5\d* x 841\.8\d*/);
  text = execFileSync('pdftotext', [pdf, '-'], { encoding: 'utf8' });
  expect(text).toContain('Maßstab 1:100 (A3 Quer)');
  expect(text).toContain('4,25 m');
  execFileSync('pdftoppm', ['-png', '-r', '50', pdf, 'tests/output/format-a3']);
});
