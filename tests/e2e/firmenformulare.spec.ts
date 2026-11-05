import { expect, test, type Page } from './fixtures';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { catchDownload, createProject, FIXTURES, freshStart, OUT, saveDownload } from './helpers';

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
  await page.mouse.move(stage.x + stage.width * 0.8, stage.y + stage.height * 0.55, { steps: 4 });
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
  await expect(page.getByTestId('form-entry-people-add')).toHaveCount(0); // keine Taste „+ Mitarbeiter“ mehr
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
  // „+“ neben der Liste legt sofort ein Formular mit heutigem Datum an
  await page.getByTestId('form-section-add').click();
  await expect(page.getByTestId('form-entry-title')).toHaveText('Tagesbericht Muster Nr. 3');
  await page.getByTestId('form-entry-more').click();
  await page.getByTestId('form-entry-delete').click();
  await page.getByTestId('confirm-dialog').getByRole('button', { name: 'Löschen' }).click();
  await expect(page.getByTestId('form-item')).toHaveCount(2);
  // Listen erst, wenn es dort etwas gibt: noch keine Regieliste → keine Liste „Regielisten“
  await expect(page.locator('[data-testid="report-section"][data-type="regie"]')).toHaveCount(0);
  await page.getByTestId('report-group-new').click();
  await page.getByTestId('report-new-dialog').getByTestId('report-type-regie').click();
  await page.getByTestId('report-new-dialog').getByTestId('report-create').click();
  await expect(page.getByTestId('report-title')).toHaveText('Regieliste Nr. 1');
  await page.getByTestId('to-reports').click();
  await expect(page.locator('[data-testid="report-section"][data-type="regie"]')).toHaveCount(1);
  // mit „+“ daneben gleich die nächste
  await expect(page.locator('[data-testid="report-section-add"][data-type="regie"]')).toBeVisible();
  await expect(page.getByTestId('report-item')).toHaveCount(1);
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

test('Felder: Namen vorschlagen, Schrift (Größe, Art, Farbe), Wochentag/KW aus dem Datum; Nummer durchgehend; Drucken nach Nummern', async ({ page }) => {
  test.setTimeout(150_000);
  await freshStart(page);
  await createProject(page, 'Wohnanlage Sonnenhof', { number: '2026-04' });
  await page.goto('./baupad/aufmass-und-abrechnung');
  await createProject(page, 'Halle 3', { number: '2026-05' });
  await page.goto('./baupad/berichte-und-formulare/vorlagen');
  await page.getByTestId('form-template-input').setInputFiles(form('mst-tagesbericht.pdf'));
  const nd = page.getByTestId('form-new-dialog');
  await nd.getByTestId('form-new-name').fill('Regie');
  await nd.getByTestId('form-new-create').click();
  await expect(page.getByTestId('form-field-box')).toHaveCount(14);
  const panel = page.getByTestId('form-field-panel');
  // PDF vergrößern: Tasten und Strg + Mausrad zoomen nur die PDF-Ansicht (Seitenleiste bleibt)
  const stageW = async () => (await page.getByTestId('form-editor-stage').boundingBox())!.width;
  const vpBox = (await page.getByTestId('form-editor-viewport').boundingBox())!;
  const w0 = await stageW();
  await page.getByTestId('form-zoom-in').click();
  await expect(page.getByTestId('form-zoom-level')).toHaveText('125 %');
  expect(await stageW()).toBeCloseTo(w0 * 1.25, 0);
  expect((await page.getByTestId('form-editor-viewport').boundingBox())!.width).toBeCloseTo(vpBox.width, 0); // Ansicht bleibt gleich groß
  await page.mouse.move(vpBox.x + vpBox.width / 2, vpBox.y + 100);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -300);
  await page.keyboard.up('Control');
  await expect.poll(stageW).toBeGreaterThan(w0 * 1.4);
  await page.getByTestId('form-zoom-fit').click();
  await expect(page.getByTestId('form-zoom-level')).toHaveText('100 %');
  // neues Feld zeichnen → Vorschlag „Wochentag“ setzt den passenden Typ
  const draw = async (fx: number, fy: number) => {
    await page.getByTestId('form-editor-draw').click();
    const st = (await page.getByTestId('form-editor-stage').boundingBox())!;
    await page.mouse.move(st.x + st.width * fx, st.y + st.height * fy);
    await page.mouse.down();
    await page.mouse.move(st.x + st.width * (fx + 0.2), st.y + st.height * fy, { steps: 4 });
    await page.mouse.up();
  };
  await draw(0.55, 0.22);
  await panel.getByTestId('form-name-suggestion').filter({ hasText: 'Wochentag' }).click();
  await expect(panel.getByTestId('form-field-name')).toHaveValue('Wochentag');
  await expect(panel.getByTestId('form-field-type')).toHaveValue('weekday');
  // Schrift: Größe, Times New Roman, fett, Farbe Rot
  await panel.getByTestId('form-field-font').fill('11');
  await panel.getByTestId('form-field-fontface').selectOption('times');
  await panel.getByTestId('form-field-bold').check();
  await panel.locator('[data-testid="form-field-color"][data-color="#c92a2a"]').click();
  await expect(panel.locator('[data-testid="form-field-color"][data-color="#c92a2a"]')).toHaveAttribute('aria-checked', 'true');
  await panel.screenshot({ path: join(OUT, 'formular-feld-schrift.png') });
  // selbst geschriebener Name, der einem Vorschlag entspricht → Typ automatisch (KW)
  await draw(0.55, 0.28);
  await panel.getByTestId('form-field-name').fill('KW');
  await expect(panel.getByTestId('form-field-type')).toHaveValue('week');
  // mehrzeiliges Feld zeigt die Zeilen an
  await expect(page.locator('[data-testid="form-field-box"][data-name="Leistungsbeschreibung"]')).toContainText(/\d+ Zeilen/);
  // Feldname dient als Muster im Kasten (in Schrift, Größe, Farbe)
  await expect(page.locator('[data-testid="form-field-box"][data-name="KW"] .form-sample')).toHaveText('KW');
  // Schriftgröße größer → Kasten wächst nach oben, Unterkante (Schreiblinie) bleibt
  const geo = async () => ({ y: Number(await panel.getByTestId('form-field-y').inputValue()), h: Number(await panel.getByTestId('form-field-h').inputValue()) });
  await panel.locator('summary').click();
  const g1 = await geo();
  await panel.getByTestId('form-field-font').fill('14');
  const g2 = await geo();
  expect(g2.h).toBeGreaterThan(g1.h);
  expect(Math.abs(g2.y + g2.h - (g1.y + g1.h))).toBeLessThan(0.3);
  // Pfeiltasten verschieben das gewählte Feld (1 pt je Druck)
  const x1 = Number(await panel.getByTestId('form-field-x').inputValue());
  await page.getByTestId('form-editor-stage').click({ position: { x: 5, y: 5 } }); // Fokus weg vom Eingabefeld (Auswahl bleibt nicht) …
  await page.locator('[data-testid="form-field-box"][data-name="KW"]').click(); // … Feld wieder wählen
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  expect(Number(await panel.getByTestId('form-field-x').inputValue())).toBeCloseTo(x1 + 2, 0);
  expect(Number(await panel.getByTestId('form-field-y').inputValue())).toBeCloseTo(g2.y + 1, 0);
  // nach unten ziehen beim Zeichnen = weitere Zeilen, jede Zeile einzeln; Zeilenabstand einstellbar
  await page.getByTestId('form-editor-draw').click();
  const st = (await page.getByTestId('form-editor-stage').boundingBox())!;
  await page.mouse.move(st.x + st.width * 0.1, st.y + st.height * 0.34);
  await page.mouse.down();
  await page.mouse.move(st.x + st.width * 0.5, st.y + st.height * 0.34 + (st.height / 842) * 7 * 2.835 * 2, { steps: 6 });
  await page.mouse.up();
  await expect(panel.getByTestId('form-field-type')).toHaveValue('multiline');
  const strips = page.locator('[data-testid="form-field-box"]').last().getByTestId('form-line-strip');
  await expect(strips).toHaveCount(3);
  await expect(panel.getByTestId('form-field-pitch')).toHaveValue('7');
  const h7 = Number(await panel.getByTestId('form-field-h').inputValue());
  await panel.getByTestId('form-field-pitch').fill('9');
  expect(Number(await panel.getByTestId('form-field-h').inputValue())).toBeCloseTo(h7 + 2 * 2 * 2.835, 0);
  await panel.getByTestId('form-field-name').fill('Arbeiten');
  // Beginn/Ende je Zeile: erste Zeile später beginnen (Eingabe), letzte Zeile früher enden (am Ende ziehen)
  await panel.getByTestId('form-line-insets').locator('xpath=..').locator('summary').click();
  await panel.getByTestId('form-inset-left-mm').first().fill('20');
  const s0 = (await strips.nth(0).boundingBox())!;
  const s1 = (await strips.nth(1).boundingBox())!;
  expect(s0.x).toBeGreaterThan(s1.x + 10);
  const handle = page.locator('[data-testid="form-field-box"]').last().getByTestId('form-inset-right').last();
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 - 60, hb.y + hb.height / 2, { steps: 4 });
  await page.mouse.up();
  const s2 = (await strips.nth(2).boundingBox())!;
  expect(s2.x + s2.width).toBeLessThan(s1.x + s1.width - 40);
  expect(Number(await panel.getByTestId('form-inset-right-mm').last().inputValue())).toBeGreaterThan(5);
  // Enter = fertig (Feld abgewählt); Entf löscht das gewählte Feld
  const count = await page.getByTestId('form-field-box').count();
  await panel.getByTestId('form-field-name').press('Enter');
  await expect(page.getByTestId('form-field-panel')).toHaveCount(0);
  await page.locator('[data-testid="form-field-box"][data-name="Arbeiten"]').click();
  await expect(page.getByTestId('form-field-panel')).toBeVisible();
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('form-field-box')).toHaveCount(count - 1);
  await expect(page.locator('[data-testid="form-field-box"][data-name="Arbeiten"]')).toHaveCount(0);
  await page.getByTestId('form-editor-stage').screenshot({ path: join(OUT, 'formular-editor-zeilen.png') });
  await page.getByTestId('form-editor-save').click();
  await expect(page.getByTestId('form-editor-state')).toHaveText('gespeichert');

  // Formular im ersten Projekt: Datum → KW und Wochentag automatisch
  const newForm = async (site: string, date: string) => {
    await page.goto('./baupad/berichte-und-formulare');
    if ((await page.locator(`[data-testid="report-site"]`).filter({ hasText: site }).count()) > 0) await page.locator('[data-testid="report-site"]').filter({ hasText: site }).click();
    else {
      await page.getByTestId('report-new-site').click();
      await page.getByTestId('project-picker').getByTestId('picker-item').filter({ hasText: site }).click();
    }
    await page.getByTestId('report-group-new').click();
    const d = page.getByTestId('report-new-dialog');
    await d.locator('[data-testid="report-type-form"][data-name="Regie"]').click();
    await d.getByTestId('report-date').fill(date);
    await d.getByTestId('report-create').click();
  };
  const fld = (name: string) => page.locator(`[data-testid="form-entry-field"][data-name="${name}"]`);
  await newForm('Wohnanlage Sonnenhof', '2026-11-04');
  await expect(page.getByTestId('form-entry-title')).toHaveText('Regie Nr. 1');
  await expect(fld('Wochentag')).toHaveValue('Mittwoch');
  await expect(fld('KW')).toHaveValue('45');
  // Datum ändern → beides zieht mit
  await page.locator('[data-testid="form-entry-field"][type="date"]').first().fill('2026-11-09');
  await expect(fld('Wochentag')).toHaveValue('Montag');
  await expect(fld('KW')).toHaveValue('46');
  await expect(page.getByTestId('save-state')).toHaveText('gespeichert');
  // anderes Projekt: Nummer läuft durch (Nr. 2), dann wieder im ersten Projekt Nr. 3
  await newForm('Halle 3', '2026-11-05');
  await expect(page.getByTestId('form-entry-title')).toHaveText('Regie Nr. 2');
  await expect(page.getByTestId('save-state')).toHaveText('gespeichert');
  await newForm('Wohnanlage Sonnenhof', '2026-11-06');
  await expect(page.getByTestId('form-entry-title')).toHaveText('Regie Nr. 3');
  await expect(page.getByTestId('save-state')).toHaveText('gespeichert');

  // Drucken je Formular: Nummern 1-3 → im Projekt Nr. 1 und Nr. 3 in einem PDF
  await page.getByTestId('to-reports').click();
  await page.locator('[data-testid="form-section-print"][data-name="Regie"]').click();
  const pd = page.getByTestId('prompt-dialog');
  await expect(pd.locator('input')).toHaveValue('1-3');
  await pd.locator('input').fill('1-3');
  const dl = await catchDownload(page, () => pd.getByRole('button', { name: 'PDF erstellen' }).click());
  const file = await saveDownload(dl, 'regie-1-3.pdf');
  expect(Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [file], { encoding: 'utf8' }))![1])).toBe(2);
  const txt = execFileSync('pdftotext', [file, '-'], { encoding: 'utf8' });
  expect(txt).toContain('Montag');
  expect(txt).toContain('Freitag');
});
