import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { catchDownload, createProject, drawRect, FIXTURES, fillMeasures, freshStart, OUT, planBox, saveDownload, tableRows, waitForPlan, waitSaved, pickTool } from './helpers';

/**
 * Paket H/I: Jeder exportierte Plan hat A4 oder A3 (hoch/quer); der Plan wird proportional
 * und zentriert mit mindestens 1 cm Rand eingepasst; die Überschrift ist frei wählbar und bleibt
 * gespeichert. Die Aufmaßwerte ändern sich dadurch nicht.
 */

const A4 = '595\\.27\\d* x 841\\.89';
const A4Q = '841\\.89 x 595\\.27\\d*';
const A3 = '841\\.89 x 1190\\.55';

async function exportPdf(page: Page, name: string) {
  const dl = await catchDownload(page, async () => {
    await page.getByTestId('export-pdf-plan').click();
    await page.getByTestId('pdf-export-run').click();
  });
  const pdf = await saveDownload(dl, `${name}.pdf`);
  execFileSync('pdftoppm', ['-png', '-r', '30', '-singlefile', pdf, join(OUT, name)]);
  return {
    info: execFileSync('pdfinfo', [pdf], { encoding: 'utf8' }),
    text: execFileSync('pdftotext', [pdf, '-'], { encoding: 'utf8' }),
    png: join(OUT, `${name}.png`),
  };
}

/** Anteil nicht weißer Pixel im Randstreifen (1 cm ≈ 11,8 px bei 30 dpi; geprüft: 10 px) */
function borderInk(png: string): number {
  return Number(
    execFileSync(
      'python3',
      [
        '-c',
        `
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('L'); w, h = im.size; b = 10
n = ink = 0
for y in range(h):
  for x in range(w):
    if x < b or y < b or x >= w - b or y >= h - b:
      n += 1
      if im.getpixel((x, y)) < 235: ink += 1
print(ink / n)`,
        png,
      ],
      { encoding: 'utf8' },
    ),
  );
}

test('Import: Format wählbar (Standard A4 passend), Überschrift, PDF genau A3 mit Rand', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Format', {}, ['Garage']);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'plaene.pdf'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('page-tile').nth(1).click(); // A3-Querseite
  await wiz.getByTestId('pages-next').click();
  await wiz.getByTestId('areas-next').click();
  // Standard: A4, Ausrichtung passend zum Plan (Querformat)
  await expect(wiz.getByTestId('export-paper')).toHaveValue('A4-quer');
  await wiz.getByTestId('export-paper').selectOption('A3-hoch');
  await wiz.locator('[data-field="planNumber"]').fill('F-1');
  await expect(wiz.locator('[data-field="title"]')).toHaveAttribute('placeholder', 'Aufmaßplan');
  await expect(wiz.getByTestId('heading-preview')).toContainText('Plannummer F-1 | Aufmaßplan');
  await wiz.locator('[data-field="title"]').fill('Aufmaßplan Tiefgarage');
  await wiz.getByTestId('show-paper').check(); // Format ausdrücklich im Plan anzeigen
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  const box = await planBox(page);
  await pickTool(page, 'tool-rect');
  await drawRect(page, box.x + box.width * 0.2, box.y + box.height * 0.2, box.x + box.width * 0.4, box.y + box.height * 0.35);
  await fillMeasures(page, '18', '2,5', '');
  await waitSaved(page);
  const before = await tableRows(page);

  const r = await exportPdf(page, 'format-a3-hoch');
  expect(r.info).toMatch(new RegExp(`Page size:\\s+${A3} pts`)); // Format nicht durch den Plan verändert
  expect(r.text).toContain('Plannummer F-1 | Aufmaßplan Tiefgarage');
  expect(r.text).toContain('A3 Hochformat');
  expect(r.text).toContain('Technik'); // Originalinhalt vektoriell erhalten
  expect(borderInk(r.png)).toBe(0); // nichts im 1-cm-Rand
  // Aufmaßwerte unverändert (18 m bleiben 18 m)
  expect(await tableRows(page)).toEqual(before);
  expect(before[0][1]).toBe('18,00');
});

test('Plandetails: Format und Überschrift ändern, nach Neuladen erhalten', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Format 2', {}, ['Hof']);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('P-7');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  let r = await exportPdf(page, 'format-standard');
  expect(r.info).toMatch(new RegExp(`Page size:\\s+(${A4}|${A4Q}) pts`)); // Standard A4
  expect(r.text).toContain('Plannummer P-7 | Aufmaßplan');
  expect(r.text).not.toMatch(/A4|Hochformat|Querformat/); // Format standardmäßig nicht im Plan
  expect(borderInk(r.png)).toBe(0);

  await page.getByRole('link', { name: 'Zurück zur Planliste' }).click();
  await page.getByTestId('plan-actions').click();
  await page.getByTestId('action-edit').click();
  const det = page.getByTestId('plan-details');
  await det.getByTestId('export-paper').selectOption('A4-hoch');
  await det.locator('[data-field="title"]').fill('Aufmaß Hof');
  await det.locator('[data-field="description"]').fill('Nur Bereich Nord');
  await det.getByTestId('show-note').check();
  await det.getByRole('button', { name: 'Speichern' }).click();
  await page.reload();
  await page.getByTestId('plan-actions').click();
  await page.getByTestId('action-edit').click();
  await expect(det.getByTestId('export-paper')).toHaveValue('A4-hoch');
  await expect(det.locator('[data-field="title"]')).toHaveValue('Aufmaß Hof');
  await expect(det.getByTestId('show-note')).toBeChecked();
  await det.getByRole('button', { name: 'Abbrechen' }).click();
  await page.getByTestId('plan-open').click();
  await waitForPlan(page);
  r = await exportPdf(page, 'format-a4-hoch');
  expect(r.info).toMatch(new RegExp(`Page size:\\s+${A4} pts`));
  expect(r.text).toContain('Plannummer P-7 | Aufmaß Hof');
  expect(r.text).toContain('Nur Bereich Nord'); // Bemerkung, weil „Im Plan anzeigen“ gewählt
  expect(borderInk(r.png)).toBe(0);
  await page.screenshot({ path: join(OUT, 'format-editor.png') });
});

test('Gezeichneter Plan: Überschrift frei wählbar, Format des Zeichenblatts', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Format 3', {}, ['Keller']);
  await page.getByTestId('draw-plan').click();
  const nd = page.getByTestId('new-drawing');
  // Vereinfachte Eingabe: nur Plannummer, Titel, Bemerkung, Format, Maßstab
  await expect(nd.locator('[data-field="planName"], [data-field="floor"], [data-field="area"]')).toHaveCount(0);
  await expect(nd.getByTestId('show-paper')).not.toBeChecked();
  await expect(nd.getByTestId('show-scale')).not.toBeChecked();
  await expect(nd.getByTestId('show-note')).not.toBeChecked();
  await nd.locator('[data-field="planNumber"]').fill('Z-9');
  await nd.locator('[data-field="title"]').fill('Aufmaßplan');
  await nd.locator('[data-field="planNumber"]').fill('067');
  await nd.locator('[data-field="description"]').fill('Interne Notiz');
  await nd.getByTestId('sheet-paper').selectOption('A4-quer');
  await nd.getByTestId('new-drawing-save').click();
  await expect(page.getByTestId('drawing-sheet')).toBeVisible();
  const r = await exportPdf(page, 'format-zeichnung');
  expect(r.info).toMatch(new RegExp(`Page size:\\s+${A4Q} pts`));
  expect(r.text).toContain('Plannummer 067 | Aufmaßplan');
  expect(r.text).not.toContain('Interne Notiz'); // Bemerkung nur auf Wunsch im Plan
  expect(r.text).not.toMatch(/Maßstab|A4/);
  expect(borderInk(r.png)).toBe(0);
});
