import { expect, test, type Page } from './fixtures';
import { join } from 'node:path';
import { createProject, FIXTURES, freshStart } from './helpers';

/**
 * Firmenformulare mit eigenen Feldern: Vorlage hochladen, Felder einrichten (Name, Typ, Hinweis, Pflicht,
 * zeichnen), im Projekt ausfüllen (nur die eingerichteten Felder, Datenübernahme aus Projekt und Einteilung,
 * mehrzeilig mit Warnung), PDF, Nummerierung je Projekt, Vorlagenversion, Rechte.
 */
const form = (name: string) => join(FIXTURES, 'forms', name);

/** Projekt + Einteilung (Max und Peter Mo–Fr, KW 44/2026) */
async function setup(page: Page) {
  await freshStart(page);
  await createProject(page, 'Wohnanlage Sonnenhof', { number: '2026-04', address: 'Musterstraße 1, 4020 Linz', client: 'Muster GmbH' }, [{ number: '91092', name: 'Tiefgarage' }]);
  await page.goto('./#/arbeitereinteilung');
  await page.getByTestId('week-date').fill('2026-10-26');
  await page.getByTestId('crew-workers').click();
  const wd = page.getByTestId('staff-page');
  for (const [n, role] of [
    ['Max', 'Polier'],
    ['Peter', 'Facharbeiter'],
  ]) {
    await wd.getByTestId('staff-new').click();
    await wd.getByTestId('worker-firstName').fill(n);
    await wd.getByTestId('worker-role').fill(role);
    await wd.getByTestId('worker-save').click();
    await expect(wd.getByTestId('worker-row').filter({ hasText: n })).toHaveCount(1);
  }
  await page.keyboard.press('Escape');
  await page.getByTestId('add-site').click();
  await page.getByTestId('project-picker').getByTestId('picker-item').filter({ hasText: 'Wohnanlage Sonnenhof' }).click();
  await page.locator('[data-site="Wohnanlage Sonnenhof"] [data-day="0"] [data-testid="day-add"]').click();
  const ad = page.getByTestId('assign-dialog');
  for (const n of ['Max', 'Peter']) await ad.locator(`[data-worker="${n}"] input`).check();
  await ad.getByTestId('assign-save').click();
  await expect(page.locator('[data-site="Wohnanlage Sonnenhof"] [data-day="2"] [data-testid="crew-chip"]')).toHaveText(['Max', 'Peter']);
}

const box = (page: Page, name: string) => page.locator(`[data-testid="form-field-box"][data-name="${name}"]`);

test('Vorlage einrichten, im Projekt ausfüllen, PDF, Nummern, Vorlagenversion', async ({ page }) => {
  test.setTimeout(150_000);
  await setup(page);

  // 1) Vorlage hochladen → eigene Felder, Vorschlag aus der Erkennung
  await page.goto('./baupad/berichte-und-formulare/vorlagen');
  await expect(page.getByTestId('form-templates-empty')).toBeVisible();
  await page.getByTestId('form-template-input').setInputFiles(form('mst-tagesbericht.pdf'));
  const nd = page.getByTestId('form-new-dialog');
  await nd.getByTestId('form-new-name').fill('Tagesbericht Muster');
  await nd.getByTestId('form-new-create').click();
  await expect(page.getByTestId('form-editor-title')).toHaveText('Tagesbericht Muster');
  await expect(page.getByTestId('form-field-box')).toHaveCount(14);
  await expect(page.getByTestId('form-editor-state')).toHaveText('gespeichert'); // Vorschlag ist gespeichert (Version 1)

  // 2) Felder bearbeiten: Typ, Hinweis, Pflicht; Feld umbenennen; neues Feld zeichnen; Feld löschen
  await box(page, 'Bauvorhaben').click();
  const panel = page.getByTestId('form-field-panel');
  await expect(panel.getByTestId('form-field-type')).toHaveValue('project');
  await panel.getByTestId('form-field-name').fill('Baustelle');
  await panel.getByTestId('form-field-required').check();
  await panel.getByTestId('form-field-hint').fill('Projekt wird übernommen');
  await box(page, 'Leistungsbeschreibung').click();
  await expect(panel.getByTestId('form-field-type')).toHaveValue('multiline');
  await expect(panel.getByTestId('form-field-lines')).toHaveAttribute('placeholder', /^\d+$/);
  const capacity = Number(await panel.getByTestId('form-field-lines').getAttribute('placeholder'));
  expect(capacity).toBeGreaterThanOrEqual(3);
  await box(page, 'Uhr, von').click();
  await panel.getByTestId('form-field-name').fill('Anwesende');
  await panel.getByTestId('form-field-type').selectOption('person');
  await box(page, 'Schlussabnahme').click();
  await panel.getByTestId('form-field-remove').click();
  await expect(page.getByTestId('form-field-box')).toHaveCount(13);
  // zeichnen: Kasten in der Mitte der Seite (sichtbarer Bereich; über vorhandene Kästen hinweg erlaubt)
  await page.getByTestId('form-editor-draw').click();
  const stage = (await page.getByTestId('form-editor-stage').boundingBox())!;
  await page.mouse.move(stage.x + stage.width * 0.55, stage.y + stage.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(stage.x + stage.width * 0.8, stage.y + stage.height * 0.57, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByTestId('form-field-box')).toHaveCount(14);
  await panel.getByTestId('form-field-name').fill('Wetter');
  await panel.getByTestId('form-field-type').selectOption('select');
  await panel.getByTestId('form-field-options').fill('sonnig\nbewölkt\nRegen');
  await panel.getByTestId('form-field-options').blur();
  await expect(page.getByTestId('form-editor-state')).toHaveText('nicht gespeichert');
  await page.getByTestId('form-editor-save').click();
  await expect(page.getByTestId('form-editor-state')).toHaveText('gespeichert');
  await expect(page.getByTestId('form-editor-title')).toBeVisible();
  // Übersicht: Vorlage mit Feldern (Pflicht markiert)
  await page.getByTestId('to-form-templates').click();
  const row = page.getByTestId('form-template-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Tagesbericht Muster');
  await expect(row).toContainText('14 Felder · 1 Pflicht · Version 2');
  await expect(row.getByTestId('form-template-fields')).toContainText('Baustelle *');
  await expect(row.getByTestId('form-template-fields')).toContainText('Wetter');

  // 3) Im Projekt ausfüllen: nur die eingerichteten Felder, Übernahme aus Projekt und Einteilung
  await page.goto('./baupad/berichte-und-formulare');
  await expect(page.getByTestId('reports-forms-hint')).toContainText('Tagesbericht Muster');
  await page.getByTestId('report-new-site').click();
  await page.getByTestId('project-picker').getByTestId('picker-item').filter({ hasText: 'Wohnanlage Sonnenhof' }).click();
  await page.getByTestId('report-group-new').click();
  const d = page.getByTestId('report-new-dialog');
  await d.locator('[data-testid="report-type-form"][data-name="Tagesbericht Muster"]').click();
  await d.getByTestId('report-date').fill('2026-10-28');
  await d.getByTestId('report-create').click();
  await expect(page.getByTestId('form-entry-title')).toHaveText('Tagesbericht Muster Nr. 1');
  await expect(page.getByTestId('form-entry-field')).toHaveCount(14);
  const fld = (name: string) => page.locator(`[data-testid="form-entry-field"][data-name="${name}"]`);
  await expect(fld('Baustelle')).toHaveValue('Wohnanlage Sonnenhof');
  await expect(fld('Kst')).toHaveValue('91092 – Tiefgarage');
  await expect(fld('Bau-Tagesbericht Nr')).toHaveValue('1');
  await expect(page.locator('[data-testid="form-entry-field"][type="date"]').first()).toHaveValue('2026-10-28');
  await expect(fld('Anwesende')).toHaveValue('Max, Peter'); // laut Einteilung an diesem Tag auf der Baustelle (änderbar)
  await expect(page.getByTestId('form-entry-people-suggest')).toHaveCount(0);
  await fld('Anwesende').fill('Hans');
  await expect(page.getByTestId('form-entry-people-suggest')).toContainText('Aus Einteilung: Max, Peter');
  await page.getByTestId('form-entry-people-suggest').click();
  await expect(fld('Anwesende')).toHaveValue('Hans, Max, Peter');
  await fld('Anwesende').fill('Max, Peter');
  await expect(page.getByTestId('form-entry-pdf')).toBeEnabled();
  await fld('Wetter').selectOption('bewölkt');

  // mehrzeilig: Zeilenzähler, Warnung bei Überlauf, PDF gesperrt
  const work = fld('Leistungsbeschreibung');
  await work.fill('Schalung Stützen Achse 3\nBewehrung Decke');
  await expect(page.getByTestId('form-entry-lines').first()).toHaveText(`Zeile 2 von ${capacity}`);
  await work.fill(Array.from({ length: capacity + 2 }, (_, i) => `Zeile ${i + 1}`).join('\n'));
  await expect(page.getByTestId('form-entry-check')).toContainText('Text passt nicht in den Kasten: Leistungsbeschreibung');
  await expect(page.getByTestId('form-entry-pdf')).toBeDisabled();
  await work.fill('Schalung Stützen Achse 3\nBewehrung Decke');
  await expect(page.getByTestId('form-entry-check')).toHaveCount(0);
  await expect(page.getByTestId('save-state')).toHaveText('gespeichert');

  // Pflichtfeld leer → gesperrt
  await fld('Baustelle').fill('');
  await expect(page.getByTestId('form-entry-check')).toContainText('Pflichtfelder offen: Baustelle');
  await expect(page.getByTestId('form-entry-pdf')).toBeDisabled();
  await fld('Baustelle').fill('Wohnanlage Sonnenhof');

  // 4) PDF
  await page.getByTestId('form-entry-pdf').click();
  const preview = page.getByTestId('pdf-preview');
  await expect(preview).toBeVisible();
  await expect(preview.getByTestId('pdf-file-name')).toHaveValue(/Tagesbericht_Muster_Wohnanlage_Sonnenhof_Nr1_2026-10-28/);
  await expect(preview.locator('img').first()).toBeVisible();
  await preview.getByTestId('preview-back').click();

  // 5) Projektseite: Liste je Vorlage; Kopie bekommt Nr. 2; Übersicht zählt
  await page.getByTestId('to-reports').click();
  const section = page.getByTestId('form-section');
  await expect(section).toHaveCount(1);
  await expect(section).toContainText('Tagesbericht Muster');
  await expect(page.getByTestId('form-item')).toHaveCount(1);
  await page.getByTestId('form-actions').click();
  await page.getByTestId('form-copy').click();
  await expect(page.getByTestId('form-entry-title')).toHaveText('Tagesbericht Muster Nr. 2');
  await expect(fld('Bau-Tagesbericht Nr')).toHaveValue('2');
  await expect(fld('Anwesende')).toHaveValue('Max, Peter'); // Kopie behält die Werte
  await page.getByTestId('to-reports').click();
  await expect(page.getByTestId('form-item')).toHaveCount(2);
  await page.getByTestId('to-reports-overview').click();
  await expect(page.getByTestId('report-site')).toContainText('2 Formulare');
  await expect(page.getByTestId('report-site-forms')).toHaveText('2 × Tagesbericht Muster');

  // 6) Vorlage ändern → Version 3; vorhandene Formulare behalten ihre Felder, neue bekommen die neuen
  await page.goto('./baupad/berichte-und-formulare/vorlagen');
  await page.getByTestId('form-template-edit').click();
  await box(page, 'Wetter').click();
  await panel.getByTestId('form-field-name').fill('Witterung');
  await page.getByTestId('form-editor-save').click();
  await expect(page.getByTestId('form-editor-state')).toHaveText('gespeichert');
  await page.goto('./baupad/berichte-und-formulare');
  await page.getByTestId('report-site').click();
  await page.getByTestId('form-item').first().click();
  await expect(fld('Wetter')).toHaveCount(1); // alter Stand bleibt
  await page.getByTestId('to-reports').click();
  await page.getByTestId('report-group-new').click();
  await d.locator('[data-testid="report-type-form"]').click();
  await d.getByTestId('report-create').click();
  await expect(page.getByTestId('form-entry-title')).toHaveText('Tagesbericht Muster Nr. 3');
  await expect(fld('Witterung')).toHaveCount(1);
});

test('Rechte: Polier richtet keine Vorlagen ein, kann aber Formulare ausfüllen', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Neubau Musterstraße', { number: '2026-04' });
  await page.goto('./baupad/berichte-und-formulare/vorlagen');
  await page.getByTestId('form-template-input').setInputFiles(form('mst-tagesbericht.pdf'));
  await page.getByTestId('form-new-dialog').getByTestId('form-new-create').click();
  await expect(page.getByTestId('form-editor-title')).toBeVisible();
  const context = { workspace_id: '11111111-1111-4111-8111-111111111111', workspace_name: 'Testfirma', role: 'polier', pkg: 'team', tools: ['projects', 'photos', 'reports', 'workers', 'defects'], sites: [], tool_sites: {}, operator: false, name: 'Test Nutzer', phone: '' };
  await page.route('**/rest/v1/rpc/my_context', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(context) }));
  await page.goto('./baupad/berichte-und-formulare/vorlagen');
  await expect(page.getByTestId('form-template-row')).toHaveCount(1);
  await expect(page.getByTestId('form-template-pick')).toHaveCount(0);
  await expect(page.getByTestId('form-template-edit')).toHaveCount(0);
  await page.goto('./baupad/berichte-und-formulare');
  await page.getByTestId('report-new-site').click();
  await page.getByTestId('project-picker').getByTestId('picker-item').first().click();
  await page.getByTestId('report-group-new').click();
  const d = page.getByTestId('report-new-dialog');
  await d.locator('[data-testid="report-type-form"]').click();
  await d.getByTestId('report-create').click();
  await expect(page.getByTestId('form-entry-title')).toContainText('Nr. 1');
});
