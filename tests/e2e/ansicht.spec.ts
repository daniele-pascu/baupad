import { expect, test, type Page } from './fixtures';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { catchDownload, createProject, FIXTURES, freshStart, OUT, saveDownload, waitForPlan, waitSaved } from './helpers';

/**
 * Menü „Ansicht“ im Aufmaß: Inhalt eines Vektor-PDFs nach Merkmalen filtern (Text, Strichstärke, Farben) –
 * ohne KI, gilt für Ansicht und PDF-Export, wird je Plan gespeichert.
 */

async function importPlan(page: Page, file: string, number: string) {
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, file));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill(number);
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
}

/** Pixel des Grundbilds im Viewer zählen: kräftig blau bzw. dunkel */
function countPixels(page: Page) {
  return page.locator('.viewer-canvas').first().evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let blue = 0;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 2] > d[i] + 80 && d[i + 2] > d[i + 1] + 40) blue++;
      if (d[i] + d[i + 1] + d[i + 2] < 300) dark++;
    }
    return { blue, dark };
  });
}

function pdfBlue(pdf: string, name: string): number {
  const png = join(OUT, name);
  execFileSync('pdftoppm', ['-png', '-r', '40', '-singlefile', pdf, png.replace(/\.png$/, '')]);
  const out = execFileSync('python3', ['-c', 'import sys; from PIL import Image\nim=Image.open(sys.argv[1]).convert("RGB")\nprint(sum(1 for (R,G,B) in im.getdata() if B>R+80 and B>G+40))', png], { encoding: 'utf8' });
  return Number(out.trim());
}

test('Farben ausblenden: blaue Flächen weg in Ansicht und PDF, bleibt nach dem Neuladen, Zurücksetzen holt sie zurück', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Ansicht Farben', {}, ['Hof']);
  await importPlan(page, 'farbplan.pdf', 'A-1');
  await page.getByTestId('plan-view').click();
  await page.getByTestId('plan-color-toggle').click(); // farbig, damit Blau zählbar ist
  await expect(page.locator('.viewer-world')).not.toHaveClass(/plan-gray/);
  await waitSaved(page);
  await expect.poll(async () => (await countPixels(page)).blue).toBeGreaterThan(500);
  // Farbliste aus dem PDF: grüner Rahmen und blaue Flächen
  const chips = page.getByTestId('plan-view-color');
  await expect(chips).toHaveCount(2);
  // nach Häufigkeit: vier blaue Flächen vor einem grünen Rahmen
  const blueKey = (await chips.first().getAttribute('data-color'))!;
  expect(blueKey).toMatch(/^#[0-3][0-9a-f]5[0-9a-f]f[0-9a-f]$/);
  await chips.first().click();
  await waitSaved(page);
  await expect(page.getByTestId('plan-view')).toHaveClass(/btn-primary/);
  await expect.poll(async () => (await countPixels(page)).blue).toBe(0);
  // Export ebenfalls ohne Blau (Menü mit Esc schließen)
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('plan-view-pop')).toHaveCount(0);
  const dl = await catchDownload(page, async () => {
    await page.getByTestId('export-pdf-plan').click();
    await page.getByTestId('pdf-export-run').click();
  });
  expect(pdfBlue(await saveDownload(dl, 'ansicht-ohne-blau.pdf'), 'ansicht-ohne-blau.png')).toBe(0);
  // bleibt gespeichert
  await page.reload();
  await waitForPlan(page);
  await expect.poll(async () => (await countPixels(page)).blue).toBe(0);
  await page.getByTestId('plan-view').click();
  await expect(page.locator(`[data-testid="plan-view-color"][data-color="${blueKey}"]`)).toHaveAttribute('aria-pressed', 'false');
  await page.getByTestId('plan-view-reset').click();
  await waitSaved(page);
  await expect.poll(async () => (await countPixels(page)).blue).toBeGreaterThan(500);
});

test('Text und dünne Linien ausblenden: weniger Dunkles im Plan; Linienstärken aus dem PDF zur Auswahl', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Ansicht Text', {}, ['Hof']);
  await importPlan(page, 'massketten.pdf', 'A-2');
  const before = (await countPixels(page)).dark;
  expect(before).toBeGreaterThan(100);
  await page.getByTestId('plan-view').click();
  await expect(page.getByTestId('plan-text')).toBeChecked();
  await page.getByTestId('plan-text').uncheck();
  await waitSaved(page);
  await expect.poll(async () => (await countPixels(page)).dark).toBeLessThan(before);
  const afterText = (await countPixels(page)).dark;
  const widths = page.getByTestId('plan-minwidth');
  if (await widths.count()) {
    const options = await widths.locator('option').allTextContents();
    expect(options[0]).toBe('alle Linien');
    expect(options.length).toBeGreaterThan(1);
    await widths.selectOption({ index: options.length - 1 }); // nur die dicksten Linien
    await waitSaved(page);
    await expect.poll(async () => (await countPixels(page)).dark).toBeLessThan(afterText);
  }
  await page.getByTestId('plan-view-reset').click();
  await waitSaved(page);
  await expect.poll(async () => (await countPixels(page)).dark).toBe(before);
});
