import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { catchDownload, createProject, drawRect, FIXTURES, fillMeasures, freshStart, OUT, pickTool, planBox, saveDownload, waitForPlan, waitSaved } from './helpers';

/**
 * Importierte Pläne standardmäßig schwarz-weiß (Ansicht und PDF), damit die farbigen
 * Markierungen gut sichtbar sind; je Plan farbig umschaltbar. Die Originaldatei bleibt unverändert.
 */

/** Pixel im PDF zählen: kräftig blaue (Plan) und kräftig rote (Markierung) */
function colorCounts(pdf: string, name: string): { blue: number; red: number } {
  const png = join(OUT, name);
  execFileSync('pdftoppm', ['-png', '-r', '40', '-singlefile', pdf, png.replace(/\.png$/, '')]);
  const out = execFileSync(
    'python3',
    ['-c', 'import sys; from PIL import Image\nim=Image.open(sys.argv[1]).convert("RGB")\nb=r=0\nfor (R,G,B) in im.getdata():\n  b+= B>R+80 and B>G+40\n  r+= R>G+90 and R>B+90\nprint(b, r)', png],
    { encoding: 'utf8' },
  );
  const [blue, red] = out.trim().split(' ').map(Number);
  return { blue, red };
}

async function importPlan(page: Page, file: string, number: string) {
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, file));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill(number);
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
}

async function exportPdf(page: Page, name: string) {
  const dl = await catchDownload(page, async () => {
    await page.getByTestId('export-pdf-plan').click();
    await page.getByTestId('pdf-export-run').click();
  });
  return saveDownload(dl, name);
}

for (const file of ['farbplan.pdf', 'farbplan.png']) {
  test(`${file}: Ansicht und PDF schwarz-weiß, Markierung farbig; „Plan farbig“ schaltet zurück`, async ({ page }) => {
    await freshStart(page);
    await createProject(page, `SW ${file}`, {}, ['Hof']);
    await importPlan(page, file, 'SW-1');
    const world = page.locator('.viewer-world');
    await expect(world).toHaveClass(/plan-gray/);
    expect(await page.locator('.viewer-canvas').first().evaluate((c) => getComputedStyle(c).filter)).toBe('grayscale(1)');
    // rote Markierung
    const b = await planBox(page);
    await pickTool(page, 'tool-rect');
    await drawRect(page, b.x + b.width * 0.15, b.y + b.height * 0.15, b.x + b.width * 0.3, b.y + b.height * 0.3);
    await fillMeasures(page, '2', '1', '', false);
    await waitSaved(page);
    const gray = colorCounts(await exportPdf(page, `sw-${file}.pdf`), `sw-${file}.png`);
    expect(gray.blue).toBe(0); // Plan ohne Farbe
    expect(gray.red).toBeGreaterThan(20); // Markierung bleibt rot

    // je Plan farbig
    await page.getByTestId('layers-toggle').click();
    await page.getByTestId('plan-color').check();
    await expect(world).not.toHaveClass(/plan-gray/);
    await waitSaved(page);
    await page.locator('.side-head h2').click();
    const color = colorCounts(await exportPdf(page, `farbe-${file}.pdf`), `farbe-${file}.png`);
    expect(color.blue).toBeGreaterThan(500);
    // nach dem Neuladen erhalten
    await page.reload();
    await waitForPlan(page);
    await expect(world).not.toHaveClass(/plan-gray/);
  });
}
