import { expect, test } from './fixtures';
import { join } from 'node:path';
import { createProject, freshStart, FIXTURES } from './helpers';

/**
 * Eigene Firmenformulare: PDF unter Konto hochladen, Erkennung prüfen, speichern; im Bericht „Firmenformular“
 * exportieren (ausgefülltes Original-PDF in der Vorschau). Vorlagen: MST Bau-Tagesbericht und Regieliste.
 */
const form = (name: string) => join(FIXTURES, 'forms', name);

test('Bautagesbericht der Firma hochladen, Zuordnung prüfen, Bericht ins Firmenformular exportieren', async ({ page }) => {
  await freshStart(page);
  await page.goto('./konto/firma');
  await page.getByTestId('form-template-input').setInputFiles(form('mst-tagesbericht.pdf'));
  const dlg = page.getByTestId('form-template-dialog');
  await expect(dlg).toBeVisible();
  await expect(dlg.getByTestId('form-template-type')).toHaveValue('tag');
  await expect(dlg.getByTestId('form-template-summary')).toContainText('14 Felder erkannt');
  await expect(dlg.getByTestId('form-tpl-box')).toHaveCount(14);
  // Zuordnung ändern: Feld antippen → Wert wählen
  await dlg.locator('[data-testid="form-tpl-box"][data-key="notes"]').click();
  await expect(dlg.getByTestId('form-tpl-field')).toContainText('Vorbemerkungen');
  await dlg.getByTestId('form-tpl-key').selectOption('notes');
  await dlg.getByTestId('form-template-name').fill('MST Tagesbericht');
  await dlg.getByTestId('form-template-save').click();
  await expect(dlg).toHaveCount(0);
  await expect(page.getByTestId('form-template-row')).toContainText('MST Tagesbericht');
  await expect(page.getByTestId('form-template-row')).toContainText('Bautagesbericht · 14 Felder');

  // Bericht anlegen und als Firmenformular ausgeben
  await page.goto('./projekte');
  await createProject(page, 'Wohnanlage Sonnenhof', { number: '2026-04', address: 'Musterstraße 1, 4020 Linz' });
  await page.goto('./berichte');
  await expect(page.getByTestId('reports-forms-hint')).toContainText('MST Tagesbericht (Bautagesbericht)');
  await page.getByTestId('report-new').click();
  const d = page.getByTestId('report-new-dialog');
  await d.getByTestId('report-type-tag').click();
  await d.getByTestId('report-date').fill('2026-10-28');
  await d.getByTestId('report-create').click();
  await expect(page.getByTestId('report-title')).toHaveText('Bautagesbericht Nr. 1');
  await page.getByTestId('rp-work').fill('Schalung Stützen Achse 3.');
  await page.getByTestId('rp-staff-facharbeiter').fill('3');
  // Der PDF-Knopf gibt direkt das Firmenformular aus
  await expect(page.getByTestId('report-pdf-btn')).toHaveAttribute('title', 'Firmenformular: MST Tagesbericht');
  await page.getByTestId('report-pdf-btn').click();
  const preview = page.getByTestId('pdf-preview');
  await expect(preview).toBeVisible();
  await expect(preview.getByTestId('pdf-file-name')).toHaveValue(/Bautagesbericht_Wohnanlage_Sonnenhof_Nr1_2026-10-28/);
  await expect(preview.locator('img').first()).toBeVisible();
  await preview.getByTestId('preview-back').click();
  // BauPad-Layout weiterhin über das Menü
  await page.getByTestId('report-more').click();
  await page.getByTestId('report-baupad-pdf').click();
  await expect(page.getByTestId('pdf-preview')).toBeVisible();
});

test('Regieliste der Firma: Wochentabelle wird erkannt', async ({ page }) => {
  await freshStart(page);
  await page.goto('./konto/firma');
  await page.getByTestId('form-template-input').setInputFiles(form('mst-regieliste.pdf'));
  const dlg = page.getByTestId('form-template-dialog');
  await expect(dlg.getByTestId('form-template-type')).toHaveValue('regie');
  await expect(dlg.getByTestId('form-template-summary')).toContainText('Tabelle 10 Zeilen × 29 Spalten (Wochenblatt)');
  await dlg.getByTestId('form-template-save').click();
  await expect(page.getByTestId('form-template-row')).toContainText('Regieliste · 11 Felder');
});
