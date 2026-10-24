import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { catchDownload, createProject, FIXTURES, freshStart, OUT, saveDownload, waitForPlan, waitSaved } from './helpers';

/** Übersicht des Gesamtplans mit rot markiertem Ausschnitt im PDF (im freien Platz des A4/A3-Blatts). */

/** Ausschnitt direkt setzen (entspricht „Ausschnitt“ im Planmenü) */
async function setCrop(page: Page, planNumber: string, frac: { x: number; y: number; w: number; h: number }) {
  await page.evaluate(
    async ({ no, f }) => {
      await new Promise<void>((resolve) => {
        const req = indexedDB.open('schadstellen-aufmass');
        req.onsuccess = () => {
          const tx = req.result.transaction('plans', 'readwrite');
          const all = tx.objectStore('plans').getAll();
          all.onsuccess = () => {
            const p = all.result.find((x: { planNumber: string }) => x.planNumber === no);
            tx.objectStore('plans').put({ ...p, rev: p.rev + 1, crop: { x: p.pageWidth * f.x, y: p.pageHeight * f.y, w: p.pageWidth * f.w, h: p.pageHeight * f.h } });
          };
          tx.oncomplete = () => {
            req.result.close();
            resolve();
          };
        };
      });
    },
    { no: planNumber, f: frac },
  );
}

/** Anteil roter Pixel in einem Bildbereich (x-Bereich in Bruchteilen der Breite) */
function redShare(png: string, x0: number, x1: number): number {
  const out = execFileSync('python3', ['-c', `
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB'); w, h = im.size
n = r = 0
for y in range(h):
  for x in range(int(w*float(sys.argv[2])), int(w*float(sys.argv[3]))):
    p = im.getpixel((x, y)); n += 1
    if p[0] > 150 and p[1] < 110 and p[2] < 110: r += 1
print(r / max(n, 1))`, png, String(x0), String(x1)], { encoding: 'utf8' });
  return Number(out);
}

async function exportPdf(page: Page, name: string, opts: { overview: boolean; corner?: string }) {
  const dl = await catchDownload(page, async () => {
    await page.getByTestId('export-pdf-plan').click();
    const dlg = page.getByTestId('pdf-export-dialog');
    await expect(dlg.getByTestId('pdf-overview-options')).toBeVisible();
    await dlg.getByTestId('pdf-overview').setChecked(opts.overview);
    if (opts.corner) await dlg.getByTestId('pdf-overview-corner').selectOption(opts.corner);
    await page.getByTestId('pdf-export-run').click();
  });
  const pdf = await saveDownload(dl, `${name}.pdf`);
  execFileSync('pdftoppm', ['-png', '-r', '40', '-singlefile', pdf, join(OUT, name)]);
  return { pdf, png: join(OUT, `${name}.png`), text: execFileSync('pdftotext', [pdf, '-'], { encoding: 'utf8' }), info: execFileSync('pdfinfo', [pdf], { encoding: 'utf8' }) };
}
const width = (info: string) => Number(/Page size:\s+([\d.]+) x/.exec(info)![1]);

test('PDF-Plan mit Ausschnitt: Übersicht ein/aus, Position wählbar, Ausschnitt rot markiert', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Übersicht', {}, ['Garage']);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'plaene.pdf'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('page-tile').nth(1).click();
  await wiz.getByTestId('pages-next').click();
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('U-1');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  await waitSaved(page);
  await setCrop(page, 'U-1', { x: 0.1, y: 0.15, w: 0.45, h: 0.5 });
  await page.reload();
  await waitForPlan(page);

  const off = await exportPdf(page, 'uebersicht-aus', { overview: false });
  expect(off.text).not.toContain('Gesamtplan');
  const tr = await exportPdf(page, 'uebersicht-or', { overview: true, corner: 'tr' });
  expect(tr.text).toMatch(/Gesamtplan . Ausschnitt rot/);
  // Format bleibt A4 quer – die Übersicht sitzt im freien Platz neben dem Plan
  expect(off.info).toMatch(/Page size:\s+841\.89 x 595\.27\d* pts/);
  expect(tr.info).toMatch(/Page size:\s+841\.89 x 595\.27\d* pts/);
  expect(width(tr.info)).toBeCloseTo(width(off.info), 3);
  // Rote Ausschnittsmarkierung rechts im Randstreifen, nicht im Plan
  expect(redShare(tr.png, 0.8, 1)).toBeGreaterThan(0.002);
  const bl = await exportPdf(page, 'uebersicht-ul', { overview: true, corner: 'bl' });
  expect(redShare(bl.png, 0, 0.2)).toBeGreaterThan(0.002);
  expect(redShare(bl.png, 0.85, 1)).toBeLessThan(0.0005);
});

test('Bildplan mit Ausschnitt: Übersicht im Bild-Export', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Übersicht Foto', {}, ['Hof']);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('F-1');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  await waitSaved(page);
  await setCrop(page, 'F-1', { x: 0.5, y: 0.4, w: 0.4, h: 0.5 });
  await page.reload();
  await waitForPlan(page);
  const tr = await exportPdf(page, 'uebersicht-foto', { overview: true, corner: 'tr' });
  expect(tr.text).toContain('Gesamtplan');
  expect(redShare(tr.png, 0.8, 1)).toBeGreaterThan(0.002);
});
