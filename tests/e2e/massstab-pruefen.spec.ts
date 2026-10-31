import { expect, test, type Page } from './fixtures';
import { join } from 'node:path';
import { createProject, drawRect, FIXTURES, freshStart, OUT, pickTool, planBox, waitForPlan, waitSaved } from './helpers';

/**
 * Kalibrierung prüfbar: klarer Status (nicht kalibriert / automatisch – prüfen / bestätigt /
 * selbst kalibriert), Prüfstrecke mit Abweichung in %, Prüfbericht mit den Maßen im Plan.
 */

async function importPlan(page: Page, file: string, no: string) {
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, file));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill(no);
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  await waitSaved(page);
}

/** Prüfstrecke ziehen; Länge = gemessener Wert × Faktor. Liefert den gemessenen Wert (m). */
async function checkLine(page: Page, factor: number): Promise<number> {
  await page.getByTestId('calibration-check').click();
  await expect(page.getByTestId('calibrate-hint')).toContainText('Prüfstrecke');
  const b = await planBox(page);
  await drawRect(page, b.x + b.width * 0.2, b.y + b.height * 0.7, b.x + b.width * 0.7, b.y + b.height * 0.7);
  const dlg = page.getByTestId('prompt-dialog');
  const label = await dlg.textContent();
  const measured = Number(/gemessen: ([\d.,]+) m/.exec(label!)![1].replace('.', '').replace(',', '.'));
  await dlg.locator('input').fill(String(Math.round(measured * factor * 1000) / 1000).replace('.', ','));
  await dlg.getByRole('button', { name: 'Prüfen' }).click();
  await waitSaved(page);
  return measured;
}

test('PDF: Status automatisch → bestätigt, Prüfstrecke mit Abweichung, Prüfbericht mit Maßketten', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Prüfen', {}, ['Keller']);
  await importPlan(page, 'massketten.pdf', 'K-1');
  const status = page.getByTestId('scale-status');
  await expect(status).toHaveAttribute('data-state', 'auto');
  await expect(status).toHaveClass(/warn/);

  // Prüfbericht: Maßketten passen zum erkannten Maßstab
  await status.click(); // öffnet das Kalibrieren
  await expect(page.getByTestId('calibrate-bar')).toBeVisible();
  // nie zwei Werkzeuge zugleich: Messung-Menü beendet das Kalibrieren, Esc schließt das Menü (Auswahl);
  // Kalibrieren schließt das Menü; Esc beim Kalibrieren → Auswahl
  await page.getByTestId('tool-probe').click();
  await expect(page.getByTestId('probe-menu')).toBeVisible();
  await expect(page.getByTestId('calibrate-bar')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('probe-menu')).toHaveCount(0);
  await expect(page.getByTestId('tool-select')).toHaveClass(/active/);
  await page.getByTestId('tool-probe').click();
  await status.click();
  await expect(page.getByTestId('probe-menu')).toHaveCount(0);
  await expect(page.getByTestId('calibrate-bar')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('calibrate-bar')).toHaveCount(0);
  await expect(page.getByTestId('tool-select')).toHaveClass(/active/);
  await status.click();
  await expect(page.getByTestId('calibrate-bar')).toBeVisible();
  await expect(page.getByTestId('calibration-info')).toContainText('Erkannt: 1:50 (ungeprüft)');
  await page.getByTestId('calibration-report-open').click();
  const rep = page.getByTestId('calibration-report');
  await expect(rep.getByTestId('report-status')).toContainText('Maßstab 1:50 automatisch erkannt – noch nicht geprüft');
  await expect(rep.getByTestId('report-summary')).toContainText('Maßpaaren passen');
  const [, ok, total] = /(\d+) von (\d+)/.exec((await rep.getByTestId('report-summary').textContent())!)!.map(Number);
  expect(ok).toBeGreaterThanOrEqual(3);
  expect(ok).toBeLessThanOrEqual(total);
  await expect(rep.getByTestId('report-dims').locator('tbody tr').first()).toContainText('passt');
  await expect(rep).toContainText('garantiert aber keine Maßhaltigkeit');
  await page.screenshot({ path: join(OUT, 'pruefbericht.png') });
  await rep.getByRole('button', { name: 'Schließen' }).click();

  // Prüfstrecke genau getroffen → ±0,0 %
  await checkLine(page, 1);
  await expect(page.getByTestId('calibration-info')).toContainText('Prüfung ±0,0 cm'); // Abweichung in cm
  await expect(page.getByTestId('check-line')).toBeVisible();

  // bestätigen → Status grün
  await page.getByTestId('scale-confirm').click();
  await waitSaved(page);
  await expect(status).toHaveAttribute('data-state', 'confirmed');
  await expect(status).toHaveClass(/ok/);
  await expect(status).toContainText('1:50 ✓');

  // Prüfstrecke mit 10 % Abweichung → Warnung, Maßstab bleibt
  await checkLine(page, 1.1);
  await expect(page.getByTestId('calibration-info')).toContainText('(−9,1 %)');
  await expect(page.getByTestId('calibration-info')).toContainText(/Prüfung −\d+,\d cm/);
  await expect(status).toHaveClass(/warn/);
  await page.getByTestId('calibration-report-open').click();
  await expect(rep.getByTestId('report-check')).toContainText('−9,1 %');
  await expect(rep.getByTestId('report-check')).toContainText('mehr als 2 cm'); // Warnung
  await expect(rep.getByTestId('report-check')).toContainText('auf 10 m');
  await rep.getByRole('button', { name: 'Schließen' }).click();

  // selbst kalibrieren → Status „≈ 1:…“, Prüfung zurückgesetzt
  await page.getByTestId('calibration-check').click();
  await page.getByTestId('calibration-check').click(); // aus
  const b = await planBox(page);
  await drawRect(page, b.x + b.width * 0.2, b.y + b.height * 0.5, b.x + b.width * 0.6, b.y + b.height * 0.5);
  const dlg = page.getByTestId('prompt-dialog');
  await dlg.locator('input').fill('5');
  await dlg.getByRole('button', { name: 'Kalibrieren' }).click();
  await waitSaved(page);
  await expect(status).toHaveAttribute('data-state', 'manual');
  await expect(status).toContainText('≈ 1:');
});

test('Bild: nicht kalibriert, klarer Hinweis; nach Kalibrierung Prüfbericht ohne Maßketten', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Prüfen Bild', {}, ['Hof']);
  await importPlan(page, 'farbplan.png', 'F-1');
  const status = page.getByTestId('scale-status');
  await expect(status).toHaveAttribute('data-state', 'none');
  await expect(status).toContainText('Nicht kalibriert');
  await status.click();
  await expect(page.getByTestId('calibrate-hint')).toContainText('Bild/Foto');
  await expect(page.getByTestId('calibration-detect')).toHaveCount(0);
  await pickTool(page, 'tool-calibrate');
  const b = await planBox(page);
  await drawRect(page, b.x + b.width * 0.1, b.y + b.height * 0.5, b.x + b.width * 0.9, b.y + b.height * 0.5);
  const dlg = page.getByTestId('prompt-dialog');
  await dlg.locator('input').fill('20');
  await dlg.getByRole('button', { name: 'Kalibrieren' }).click();
  await waitSaved(page);
  await expect(status).toHaveAttribute('data-state', 'manual');
  await expect(status).toContainText('Kalibriert'); // bei Bildern kein Papiermaßstab
  await pickTool(page, 'tool-calibrate');
  await page.getByTestId('calibration-report-open').click();
  await expect(page.getByTestId('calibration-report').getByTestId('report-image')).toContainText('Maßzahlen können nicht automatisch gelesen werden');
});
