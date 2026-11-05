import { expect, test } from './fixtures';
import { join } from 'node:path';
import { createProject, freshStart, FIXTURES } from './helpers';

/**
 * Firmenformulare für BauPad-Berichte: PDF unter Berichte & Formulare → Vorlagen hochladen, Erkennung prüfen,
 * speichern; im Bericht „Firmenformular“ exportieren (ausgefülltes Original-PDF in der Vorschau).
 * Vorlagen: MST Bau-Tagesbericht und Regieliste.
 */
const form = (name: string) => join(FIXTURES, 'forms', name);

/** Vorlage hochladen → „Für einen BauPad-Bericht“ → Zuordnung prüfen */
async function uploadReportForm(page: import('./fixtures').Page, file: string) {
  await page.goto('./baupad/berichte-und-formulare/vorlagen');
  await page.getByTestId('form-template-input').setInputFiles(form(file));
  const nd = page.getByTestId('form-new-dialog');
  await nd.getByTestId('form-new-kind-report').click();
  await nd.getByTestId('form-new-create').click();
}

test('Bautagesbericht der Firma hochladen, Zuordnung prüfen, Bericht ins Firmenformular exportieren', async ({ page }) => {
  await freshStart(page);
  await uploadReportForm(page, 'mst-tagesbericht.pdf');
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
  await expect(page.getByTestId('form-template-row')).toContainText('Bautagesbericht · 14 Felder zugeordnet');
  // Konto → Kachel „Firmenformulare“ führt direkt zu den Vorlagen
  await page.goto('./konto');
  await page.locator('[data-testid="account-section"][data-tile="formulare"]').click();
  await expect(page.getByTestId('form-templates-title')).toHaveText('Formularvorlagen');

  // Bericht anlegen und als Firmenformular ausgeben
  await page.goto('./projekte');
  await createProject(page, 'Wohnanlage Sonnenhof', { number: '2026-04', address: 'Musterstraße 1, 4020 Linz' });
  await page.goto('./berichte');
  await expect(page.getByTestId('reports-forms-hint')).toContainText('MST Tagesbericht (Bautagesbericht)');
  await page.getByTestId('report-new-site').click();
  await page.getByTestId('project-picker').getByTestId('picker-item').filter({ hasText: 'Wohnanlage Sonnenhof' }).click();
  await page.getByTestId('report-group-new').click();
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
  await uploadReportForm(page, 'mst-regieliste.pdf');
  const dlg = page.getByTestId('form-template-dialog');
  await expect(dlg.getByTestId('form-template-type')).toHaveValue('regie');
  await expect(dlg.getByTestId('form-template-summary')).toContainText('Tabelle 10 Zeilen × 29 Spalten (Wochenblatt)');
  // gleiche Werkzeuge wie bei eigenen Feldern: Zoom, Schrift je Feld, Pfeiltasten, Zeichnen, Entf, Tabelle
  await dlg.getByTestId('form-zoom-in').click();
  await expect(dlg.getByTestId('form-zoom-level')).toHaveText('125 %');
  await dlg.getByTestId('form-zoom-fit').click();
  const box = dlg.locator('[data-testid="form-tpl-box"][data-key="project"]');
  await box.click();
  const fp = dlg.getByTestId('form-tpl-field');
  await fp.getByTestId('form-field-font').fill('11');
  await fp.getByTestId('form-field-fontface').selectOption('times');
  await fp.locator('[data-testid="form-field-color"][data-color="#000000"]').click();
  await fp.getByTestId('form-field-align-center').click();
  await expect(box.locator('.form-sample')).toHaveCSS('justify-content', 'center');
  await expect(box.locator('.form-sample')).toHaveText('Bauvorhaben / Projekt');
  await box.click();
  const x0 = Number(await fp.getByTestId('form-tpl-x').inputValue());
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => Number(await fp.getByTestId('form-tpl-x').inputValue())).toBeCloseTo(x0 + 1, 0);
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => Number(await fp.getByTestId('form-tpl-x').inputValue())).toBeCloseTo(x0 + 2, 0);
  // neues Feld wie Text ziehen → übernimmt die zuletzt gewählte Schrift; Entf entfernt es wieder
  const n0 = await dlg.getByTestId('form-tpl-box').count();
  await dlg.getByTestId('form-template-add').click();
  const vb = (await dlg.getByTestId('form-editor-viewport').boundingBox())!;
  await page.mouse.move(vb.x + vb.width * 0.3, vb.y + vb.height * 0.85);
  await page.mouse.down();
  await page.mouse.move(vb.x + vb.width * 0.5, vb.y + vb.height * 0.85, { steps: 4 });
  await page.mouse.up();
  await expect(dlg.getByTestId('form-tpl-box')).toHaveCount(n0 + 1);
  await expect(fp.getByTestId('form-field-fontface')).toHaveValue('times');
  await expect(fp.getByTestId('form-field-font')).toHaveValue('11');
  await page.keyboard.press('Delete');
  await expect(dlg.getByTestId('form-tpl-box')).toHaveCount(n0);
  // Tabelle antippen → Schrift der Tabelle
  await dlg.locator('.form-tpl-cell').first().click();
  await dlg.getByTestId('form-tpl-table').getByTestId('form-tpl-table-font').fill('8');
  await dlg.getByTestId('form-tpl-table').locator('[data-testid="form-tpl-table-color"][data-color="#000000"]').click();
  await dlg.getByTestId('form-template-save').click();
  await expect(dlg).toHaveCount(0);
  // gemerkt
  await page.getByTestId('form-template-edit').click();
  await page.locator('[data-testid="form-tpl-box"][data-key="project"]').click();
  await expect(page.getByTestId('form-tpl-field').getByTestId('form-field-fontface')).toHaveValue('times');
  await expect(page.getByTestId('form-tpl-table').getByTestId('form-tpl-table-font')).toHaveValue('8');
  await page.getByTestId('form-template-save').click();
  await expect(page.getByTestId('form-template-row')).toContainText('Regieliste · 11 Felder zugeordnet');
});
