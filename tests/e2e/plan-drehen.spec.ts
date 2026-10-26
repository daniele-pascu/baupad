import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { catchDownload, createProject, drawRect, FIXTURES, fillMeasures, freshStart, OUT, pickTool, planBox, saveDownload, waitForPlan, waitSaved } from './helpers';

/**
 * Plan beim Import drehen und weiße Ränder abschneiden; bestehende Pläne drehen (nur ohne
 * Messungen). Die Originaldatei bleibt unverändert, die Maßstabserkennung funktioniert gedreht.
 */

type P = { planNumber: string; pageWidth: number; pageHeight: number; rotation?: number; crop: { x: number; y: number; w: number; h: number } | null; calibration?: { a: { x: number; y: number }; b: { x: number; y: number }; meters: number } };
async function plans(page: Page): Promise<P[]> {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open('schadstellen-aufmass');
        req.onsuccess = () => {
          const all = req.result.transaction('plans').objectStore('plans').getAll();
          all.onsuccess = () => {
            req.result.close();
            resolve(all.result.filter((p: { deletedAt: number | null }) => !p.deletedAt));
          };
        };
      }),
  );
}
const plan = async (page: Page, no: string) => (await plans(page)).find((p) => p.planNumber === no)!;
const upm = (c: NonNullable<P['calibration']>) => Math.hypot(c.b.x - c.a.x, c.b.y - c.a.y) / c.meters;

/** Blaue Balken im Planbild: Wechsel blau/weiß entlang der Mitte (waagerecht bzw. senkrecht) */
async function stripes(page: Page): Promise<{ across: number; down: number }> {
  return page.locator('.viewer-canvas').first().evaluate((c: HTMLCanvasElement) => {
    const ctx = c.getContext('2d')!;
    const blue = (x: number, y: number) => {
      const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
      return b > r + 80 && b > g + 40;
    };
    const count = (pts: [number, number][]) => pts.reduce((n, p, i) => n + (i && blue(...p) !== blue(...pts[i - 1]) ? 1 : 0), 0);
    const W = c.width;
    const H = c.height;
    const row: [number, number][] = Array.from({ length: 200 }, (_, i) => [Math.round((i / 199) * (W - 1)), Math.round(H / 2)]);
    const col: [number, number][] = Array.from({ length: 200 }, (_, i) => [Math.round(W / 2), Math.round((i / 199) * (H - 1))]);
    return { across: count(row), down: count(col) };
  });
}

async function startImport(page: Page, file: string) {
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, file));
  return page.getByTestId('import-wizard');
}
async function finishImport(page: Page, no: string) {
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill(no);
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  await waitSaved(page);
}
async function backToList(page: Page) {
  await page.getByRole('link', { name: 'Zurück zur Planliste' }).click();
  await expect(page.getByTestId('plan-list')).toBeVisible();
}

test('Import: Seite drehen (PDF) – Maßstab trotzdem erkannt, Ansicht und PDF gedreht', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Drehen', {}, ['Keller']);
  // Vergleich: ungedreht
  await startImport(page, 'massketten.pdf');
  await finishImport(page, 'K-0');
  await backToList(page);
  const flat = await plan(page, 'K-0');

  const wiz = await startImport(page, 'massketten.pdf');
  await wiz.getByTestId('rotate-page-right').click();
  await expect(wiz.getByTestId('page-state')).toContainText('gedreht um 90°');
  await wiz.getByTestId('rotate-page-right').click();
  await wiz.getByTestId('rotate-page-left').click();
  await expect(wiz.getByTestId('page-state')).toContainText('gedreht um 90°');
  await finishImport(page, 'K-1');
  await expect(page.getByTestId('scale-detected')).toContainText('1:50'); // Maßketten auch gedreht gelesen
  const k1 = await plan(page, 'K-1');
  expect(k1.rotation).toBe(90);
  expect([k1.pageWidth, k1.pageHeight]).toEqual([flat.pageHeight, flat.pageWidth]);
  expect(upm(k1.calibration!)).toBeCloseTo(upm(flat.calibration!), 3); // gleicher Maßstab
  await page.screenshot({ path: join(OUT, 'drehen-pdf.png') });

  // PDF-Export des gedrehten Plans (Vektor) funktioniert
  const dl = await catchDownload(page, async () => {
    await page.getByTestId('export-pdf-plan').click();
    await page.getByTestId('pdf-export-run').click();
  });
  await saveDownload(dl, 'drehen.pdf');
});

test('Bild: beim Import drehen und Ränder abschneiden; bestehenden Plan drehen, mit Messungen gesperrt', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Drehen Bild', {}, ['Hof']);
  // ungedreht: senkrechte Balken → viele Wechsel quer, kaum längs
  await startImport(page, 'farbplan.png');
  await finishImport(page, 'B-0');
  const s0 = await stripes(page);
  expect(s0.across).toBeGreaterThanOrEqual(8);
  expect(s0.down).toBeLessThanOrEqual(2);
  await backToList(page);
  const flat = await plan(page, 'B-0');

  // links drehen + Ränder abschneiden
  const wiz = await startImport(page, 'farbplan.png');
  await wiz.getByTestId('rotate-page-left').click();
  await wiz.getByTestId('trim-page').click();
  await expect(wiz.getByTestId('page-state')).toContainText('1 Planbereich(e) · gedreht um 270°');
  await finishImport(page, 'B-1');
  const b1 = await plan(page, 'B-1');
  expect(b1.rotation).toBe(270);
  expect([b1.pageWidth, b1.pageHeight]).toEqual([flat.pageHeight, flat.pageWidth]);
  // Ausschnitt ohne weißen Rand (Inhalt ca. 8–12 % vom Rand entfernt)
  expect(b1.crop!.x).toBeGreaterThan(b1.pageWidth * 0.05);
  expect(b1.crop!.w).toBeLessThan(b1.pageWidth * 0.9);
  const s1 = await stripes(page);
  expect(s1.down).toBeGreaterThanOrEqual(8); // Balken liegen jetzt waagerecht
  expect(s1.across).toBeLessThanOrEqual(2);
  await page.screenshot({ path: join(OUT, 'drehen-bild.png') });
  await backToList(page);

  // bestehenden Plan B-0 (ohne Messungen) drehen
  const row = (no: string) => page.getByTestId('plan-row').filter({ hasText: no });
  await row('B-0').getByTestId('plan-actions').click();
  await page.getByTestId('action-rotate').click();
  const dlg = page.getByTestId('rotate-plan');
  await dlg.getByTestId('rotate-right').click();
  await expect(dlg.getByTestId('rotate-state')).toContainText('Gedreht um 90°');
  await dlg.getByTestId('rotate-save').click();
  await waitSaved(page);
  const b0 = await plan(page, 'B-0');
  expect([b0.rotation, b0.pageWidth, b0.pageHeight]).toEqual([90, flat.pageHeight, flat.pageWidth]);

  // mit Messung: Drehen gesperrt, Hinweis auf neues Aufmaß
  await page.getByTestId('plan-row').filter({ hasText: 'B-0' }).getByTestId('plan-open').click();
  await waitForPlan(page);
  const b = await planBox(page);
  await pickTool(page, 'tool-rect');
  await drawRect(page, b.x + b.width * 0.2, b.y + b.height * 0.2, b.x + b.width * 0.4, b.y + b.height * 0.4);
  await fillMeasures(page, '1', '1', '', false);
  await waitSaved(page);
  await backToList(page);
  await row('B-0').getByTestId('plan-actions').click();
  await page.getByTestId('action-rotate').click();
  await expect(dlg.getByTestId('rotate-blocked')).toContainText('1 Messung');
  await expect(dlg.getByTestId('rotate-save')).toHaveCount(0);
  await dlg.getByTestId('rotate-reuse').click();
  await expect(page.getByTestId('reuse-plan')).toContainText('farbplan.png'); // neues Aufmaß mit gleichem (gedrehtem) Plan
});
