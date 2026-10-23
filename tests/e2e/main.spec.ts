import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import {
  FIXTURES,
  OUT,
  catchDownload,
  createCostCenter,
  createProject,
  drawRect,
  fillMeasures,
  freshStart,
  markerRelPos,
  planBox,
  readXlsx,
  saveDownload,
  tableRows,
  waitForPlan,
  waitSaved,
} from './helpers';

/**
 * Vollständiger Arbeitsablauf am PC – entspricht den Testfällen 1–12 der Projektbeschreibung.
 */
test.describe.configure({ mode: 'serial' });

let page: Page;

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, locale: 'de-DE' });
  page = await context.newPage();
  page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('CONSOLE', m.text());
  });
});

const sorted = (rows: string[][]) => rows.map((r) => [r[0], r[1], r[2], r[3], r[4]]);

test('1. Projekt mit Kostenstellen in einem Schritt erstellen und wieder öffnen', async () => {
  await freshStart(page);
  // Ohne Kostenstelle lässt sich kein Projekt anlegen
  await page.getByTestId('new-project').click();
  const form = page.getByTestId('project-form');
  await form.locator('input[name="name"]').fill('Test');
  await form.getByRole('button', { name: 'Projekt anlegen' }).click();
  await expect(form).toContainText('Bitte mindestens eine Kostenstelle eingeben');
  await form.getByRole('button', { name: 'Abbrechen' }).click();

  await createProject(
    page,
    'Wohnanlage Süd',
    { site: 'Tiefgarage Musterstraße', address: 'Musterstraße 1, Wien', client: 'Hausverwaltung X', editor: 'D. Pascu' },
    ['Tiefgarage', 'Stiege 1'],
  );
  await expect(page.getByTestId('cost-center-card')).toHaveCount(2);
  await page.getByRole('link', { name: 'Zur Startseite' }).click();
  const card = page.getByTestId('project-card').filter({ hasText: 'Wohnanlage Süd' });
  await expect(card).toContainText('Tiefgarage Musterstraße');
  await expect(card).toContainText('2 Kostenst.');
  await expect(card).toContainText('Zuletzt bearbeitet');
  await card.click();
  await expect(page.getByTestId('project-title')).toHaveText('Wohnanlage Süd');
  await expect(page.locator('.project-info')).toContainText('Hausverwaltung X');
});

test('2. Weitere Kostenstelle erstellen und umbenennen', async () => {
  await createCostCenter(page, 'Fassad');
  await page.getByTestId('cost-center-card').filter({ hasText: 'Fassad' }).locator('..').getByRole('button', { name: 'Umbenennen' }).click();
  await page.getByTestId('prompt-dialog').locator('input').fill('Fassade Nord');
  await page.getByTestId('prompt-dialog').getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByTestId('cost-center-card')).toHaveCount(3);
  await expect(page.getByTestId('cost-center-card').filter({ hasText: 'Fassade Nord' })).toBeVisible();
  await waitSaved(page);
});

test('3./4. Mehrseitiges PDF importieren, Seiten und Layoutbereiche auswählen', async () => {
  await page.getByTestId('cost-center-card').filter({ hasText: 'Tiefgarage' }).click();
  await expect(page.getByTestId('cost-center-title')).toHaveText('Tiefgarage');
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'plaene.pdf'));
  const wiz = page.getByTestId('import-wizard');
  await expect(wiz).toContainText('4 Seiten');
  const tiles = wiz.getByTestId('page-tile');
  await expect(tiles).toHaveCount(4);
  // Seite 1 ist das Deckblatt – nur Seiten 2, 3 und 4 verwenden
  await tiles.nth(1).click();
  await tiles.nth(2).click();
  await tiles.nth(3).click();
  await expect(wiz).toContainText('3 ausgewählt');
  await wiz.getByTestId('pages-next').click();

  // Seite 3: zwei Planfelder automatisch erkennen
  const items = wiz.locator('.area-list-item');
  await expect(items).toHaveCount(3);
  await items.nth(1).getByTestId('edit-areas').click();
  const editor = page.getByTestId('area-editor');
  await editor.getByTestId('detect-areas').click();
  await expect(editor).toContainText('2 mögliche Bereiche erkannt');
  // Vorschläge werden nicht automatisch übernommen
  await expect(editor.getByTestId('areas-done')).toHaveText('Ganze Seite verwenden');
  await editor.getByTestId('accept-all-areas').click();
  await expect(editor.getByTestId('areas-done')).toHaveText('2 Bereich(e) übernehmen');
  await editor.getByTestId('areas-done').click();
  await expect(items.nth(1)).toContainText('2 Planbereich(e)');
  await wiz.getByTestId('areas-next').click();

  const drafts = wiz.getByTestId('plan-draft');
  await expect(drafts).toHaveCount(4);
  // Pflichtfeld Plannummer wird geprüft
  await wiz.getByTestId('import-save').click();
  await expect(drafts.first()).toContainText('Bitte eine Plannummer eingeben.');
  const values = [
    ['A-101', 'Untergeschoss', 'UG', 'Decke'],
    ['A-102', 'Tiefgarage, Decke', 'UG', 'Decke'],
    ['A-103', 'Wand Nord', 'UG', 'Wand Nord'],
    ['B-204', 'Stiege 2, Wand Nord', 'EG', 'Wand'],
  ];
  for (let i = 0; i < 4; i++) {
    const d = drafts.nth(i);
    await d.locator('[data-field="planNumber"]').fill(values[i][0]);
    await d.locator('[data-field="planName"]').fill(values[i][1]);
    await d.locator('[data-field="floor"]').fill(values[i][2]);
    await d.locator('[data-field="area"]').fill(values[i][3]);
  }
  await wiz.getByTestId('import-save').click();
  await expect(wiz).toBeHidden();
  await expect(page.getByTestId('plan-card')).toHaveCount(4);
  await expect(page.getByTestId('plan-card').first()).toContainText('A-101 – Untergeschoss');
  await expect(page.locator('.thumb img')).toHaveCount(4, { timeout: 30_000 });

  // Zuordnung zur Originalseite und erkannte Bereiche prüfen
  await waitSaved(page);
  const plans = await page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open('schadstellen-aufmass');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const all: any[] = await new Promise((res) => {
      const r = db.transaction('plans').objectStore('plans').getAll();
      r.onsuccess = () => res(r.result);
    });
    db.close();
    return all.map((p) => ({ n: p.planNumber, page: p.pageIndex, crop: p.crop, w: p.pageWidth, h: p.pageHeight }));
  });
  const byNo = Object.fromEntries(plans.map((p) => [p.n, p]));
  expect(byNo['A-101']).toMatchObject({ page: 1, crop: null, w: 1191, h: 842 });
  expect(byNo['B-204']).toMatchObject({ page: 3, crop: null, w: 842, h: 595 }); // gedrehte Seite
  // Planfelder liegen bei x = 60..560 und 630..1130 (PDF-Punkte)
  expect(byNo['A-102'].page).toBe(2);
  expect(byNo['A-102'].crop.x).toBeGreaterThan(40);
  expect(byNo['A-102'].crop.x).toBeLessThan(70);
  expect(byNo['A-102'].crop.x + byNo['A-102'].crop.w).toBeGreaterThan(555);
  expect(byNo['A-102'].crop.x + byNo['A-102'].crop.w).toBeLessThan(600);
  expect(byNo['A-103'].crop.x).toBeGreaterThan(600);
});

test('5.–7. Schadstellen einzeichnen, automatisch nummerieren, Maße eingeben, Fläche berechnen', async () => {
  await page.getByTestId('plan-card').filter({ hasText: 'A-101' }).click();
  await waitForPlan(page);
  const box = await planBox(page);
  await page.getByTestId('tool-rect').click();
  await drawRect(page, box.x + box.width * 0.2, box.y + box.height * 0.3, box.x + box.width * 0.3, box.y + box.height * 0.42);
  const dlg = page.getByTestId('damage-dialog');
  await expect(dlg).toBeVisible();
  await expect(dlg.getByTestId('input-number')).toHaveValue('1');
  await expect(dlg.getByTestId('input-length')).toHaveAttribute('inputmode', 'decimal');
  // Ungültige Eingaben werden nicht gespeichert
  await dlg.getByTestId('input-length').fill('abc');
  await dlg.getByTestId('input-width').fill('0');
  await dlg.getByTestId('damage-save').click();
  await expect(dlg).toContainText('ist keine gültige Zahl');
  await expect(dlg).toContainText('Breite muss größer als 0 sein');
  await expect(dlg).toContainText('Tiefe fehlt');
  await expect(dlg.getByTestId('area-result')).toContainText('–');
  // Abbrechen verwirft die neue Markierung
  await dlg.getByTestId('damage-cancel').click();
  await expect(dlg).toBeHidden();
  expect(await tableRows(page)).toHaveLength(0);

  await drawRect(page, box.x + box.width * 0.2, box.y + box.height * 0.3, box.x + box.width * 0.3, box.y + box.height * 0.42);
  await expect(dlg.getByTestId('input-number')).toHaveValue('1');
  await dlg.getByTestId('input-length').fill('1,5');
  await dlg.getByTestId('input-width').fill('0,8');
  await expect(dlg.getByTestId('area-result')).toContainText('1,20 m²'); // sofortige Aktualisierung
  await dlg.getByTestId('input-width').press('Enter');
  await expect(dlg.getByTestId('input-depth')).toBeFocused();
  await page.keyboard.type('0,05');
  await page.keyboard.press('Enter');
  await expect(dlg).toBeHidden();

  await page.getByTestId('tool-ellipse').click();
  await drawRect(page, box.x + box.width * 0.5, box.y + box.height * 0.5, box.x + box.width * 0.62, box.y + box.height * 0.6);
  await expect(dlg.getByTestId('input-number')).toHaveValue('2');
  await fillMeasures(page, '2', '1.25', '0,1');

  await page.getByTestId('tool-freehand').click();
  const fx = box.x + box.width * 0.7;
  const fy = box.y + box.height * 0.25;
  await page.mouse.move(fx, fy);
  await page.mouse.down();
  for (const [dx, dy] of [[40, -10], [80, 10], [90, 50], [50, 70], [10, 50], [0, 5]]) await page.mouse.move(fx + dx, fy + dy, { steps: 5 });
  await page.mouse.up();
  await expect(dlg.getByTestId('input-number')).toHaveValue('3');
  await fillMeasures(page, '0,6', '0,4', '0,03', false);

  await waitSaved(page);
  expect(sorted(await tableRows(page))).toEqual([
    ['1', '1,50', '0,80', '0,05', '1,20'],
    ['2', '2,00', '1,25', '0,10', '2,50'],
    ['3', '0,60', '0,40', '0,03', '0,24'],
  ]);
  await expect(page.getByTestId('sum-area')).toHaveText('3,94');
  // Nummern stehen im Plan
  await expect(page.locator('.damage-label')).toHaveCount(3);
  await expect(page.locator('.damage-label text')).toHaveText(['1', '2', '3']);
});

test('Markierungen bleiben beim Zoomen und Verschieben an ihrer Position', async () => {
  await page.getByTestId('tool-select').click();
  const before = await markerRelPos(page, 1);
  await page.getByRole('button', { name: 'Vergrößern' }).click();
  await page.getByRole('button', { name: 'Vergrößern' }).click();
  const afterZoom = await markerRelPos(page, 1);
  for (const k of ['x', 'y', 'w', 'h'] as const) expect(Math.abs(afterZoom[k] - before[k])).toBeLessThan(0.003);
  // Mausrad-Zoom und Verschieben
  const box = await page.getByTestId('plan-viewer').boundingBox();
  await page.mouse.move(box!.x + 300, box!.y + 300);
  await page.mouse.wheel(0, -300);
  await page.mouse.move(box!.x + 100, box!.y + 100);
  await page.mouse.down();
  await page.mouse.move(box!.x + 250, box!.y + 180, { steps: 5 });
  await page.mouse.up();
  const afterPan = await markerRelPos(page, 1);
  for (const k of ['x', 'y', 'w', 'h'] as const) expect(Math.abs(afterPan[k] - before[k])).toBeLessThan(0.003);
  await page.getByRole('button', { name: 'Gesamten Plan anzeigen' }).click();
  await page.getByRole('button', { name: 'Zur vorherigen Ansicht' }).click();
  await page.getByRole('button', { name: 'Gesamten Plan anzeigen' }).click();
});

test('8./9. Schadstelle bearbeiten, Nummer ändern, löschen – Plan und Tabelle synchron', async () => {
  // Bearbeiten über die Tabelle
  await page.locator('[data-testid="aufmass-row"][data-number="2"]').getByRole('button', { name: /bearbeiten/ }).click();
  const dlg = page.getByTestId('damage-dialog');
  await dlg.getByTestId('input-length').fill('3');
  await expect(dlg.getByTestId('area-result')).toContainText('3,75 m²');
  await dlg.getByTestId('damage-save').click();
  await expect(page.locator('[data-testid="aufmass-row"][data-number="2"] [data-testid="row-area"]')).toHaveText('3,75');
  await expect(page.getByTestId('sum-area')).toHaveText('5,19');

  // Nummer bereits vergeben → Tausch
  await page.locator('[data-testid="aufmass-row"][data-number="3"]').getByRole('button', { name: /bearbeiten/ }).click();
  await dlg.getByTestId('input-number').fill('1');
  await dlg.getByTestId('damage-save').click();
  await expect(dlg.getByTestId('number-conflict')).toContainText('bereits vergeben');
  await dlg.getByTestId('renumber-swap').click();
  await expect(dlg).toBeHidden();
  expect(sorted(await tableRows(page)).map((r) => [r[0], r[4]])).toEqual([
    ['1', '0,24'],
    ['2', '3,75'],
    ['3', '1,20'],
  ]);

  // Neue Schadstelle mit vergebener Nummer → nachfolgende verschieben
  await page.getByTestId('tool-rect').click();
  const box = await planBox(page);
  await drawRect(page, box.x + box.width * 0.35, box.y + box.height * 0.7, box.x + box.width * 0.42, box.y + box.height * 0.8);
  await expect(dlg.getByTestId('input-number')).toHaveValue('4');
  await dlg.getByTestId('input-number').fill('2');
  await dlg.getByTestId('input-length').fill('1');
  await dlg.getByTestId('input-width').fill('1');
  await dlg.getByTestId('input-depth').fill('0,02');
  await dlg.getByTestId('damage-save').click();
  await dlg.getByTestId('renumber-shift').click();
  await expect(dlg).toBeHidden();
  expect(sorted(await tableRows(page)).map((r) => [r[0], r[4]])).toEqual([
    ['1', '0,24'],
    ['2', '1,00'],
    ['3', '3,75'],
    ['4', '1,20'],
  ]);
  await expect(page.locator('.damage-label text')).toHaveText(['1', '2', '3', '4']);

  // Auswahl über die Tabelle markiert die Schadstelle im Plan
  await page.getByTestId('tool-select').click();
  await page.locator('[data-testid="aufmass-row"][data-number="3"]').click();
  await expect(page.getByTestId('selection-bar')).toContainText('Nr. 3');
  await expect(page.locator('.damage-label.selected text')).toHaveText('3');

  // Löschen mit Sicherheitsabfrage – andere Nummern bleiben unverändert
  await page.locator('[data-testid="aufmass-row"][data-number="2"]').click();
  await page.getByTestId('delete-selected').click();
  const confirm = page.getByTestId('confirm-dialog');
  await expect(confirm).toContainText('Die Nummern der übrigen Schadstellen bleiben unverändert');
  await confirm.getByRole('button', { name: 'Abbrechen' }).click();
  expect(await tableRows(page)).toHaveLength(4);
  await page.getByTestId('delete-selected').click();
  await confirm.getByRole('button', { name: 'Löschen' }).click();
  expect(sorted(await tableRows(page)).map((r) => r[0])).toEqual(['1', '3', '4']);
  await expect(page.locator('.damage-label')).toHaveCount(3);

  // Nächste neue Schadstelle erhält die nächsthöhere Nummer
  await page.getByTestId('tool-ellipse').click();
  await drawRect(page, box.x + box.width * 0.8, box.y + box.height * 0.7, box.x + box.width * 0.86, box.y + box.height * 0.8);
  await expect(dlg.getByTestId('input-number')).toHaveValue('5');
  await fillMeasures(page, '0,5', '0,5', '0,04');
  expect(sorted(await tableRows(page)).map((r) => [r[0], r[4]])).toEqual([
    ['1', '0,24'],
    ['3', '3,75'],
    ['4', '1,20'],
    ['5', '0,25'],
  ]);
  await expect(page.getByTestId('sum-area')).toHaveText('5,44');
});

test('Markierung verschieben, Größe ändern, Beschriftung verschieben, Farbe ändern', async () => {
  await page.getByTestId('tool-select').click();
  await page.locator('[data-testid="aufmass-row"][data-number="4"]').click();
  const before = await markerRelPos(page, 4);
  const path = page.locator('.viewer-overlay path[data-damage]').nth(
    await page.locator('.damage-label').evaluateAll((ls) => ls.findIndex((l) => l.getAttribute('data-label') === '4')),
  );
  const pb = (await path.boundingBox())!;
  // verschieben
  await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2);
  await page.mouse.down();
  await page.mouse.move(pb.x + pb.width / 2 + 60, pb.y + pb.height / 2 + 40, { steps: 6 });
  await page.mouse.up();
  const moved = await markerRelPos(page, 4);
  expect(moved.x).toBeGreaterThan(before.x + 0.01);
  expect(Math.abs(moved.w - before.w)).toBeLessThan(0.002);
  // Größe über Anfasser (unten rechts) ändern
  const handles = page.locator('.handles .handle');
  const se = (await handles.nth(4).boundingBox())!;
  await page.mouse.move(se.x + se.width / 2, se.y + se.height / 2);
  await page.mouse.down();
  await page.mouse.move(se.x + 50, se.y + 30, { steps: 6 });
  await page.mouse.up();
  const resized = await markerRelPos(page, 4);
  expect(resized.w).toBeGreaterThan(moved.w + 0.01);
  // Beschriftung verschieben, ohne die Markierung zu verändern
  const label = page.locator('.damage-label[data-label="4"] rect');
  const lb = (await label.boundingBox())!;
  await page.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2);
  await page.mouse.down();
  await page.mouse.move(lb.x + 80, lb.y + 60, { steps: 6 });
  await page.mouse.up();
  const lb2 = (await label.boundingBox())!;
  expect(lb2.x).toBeGreaterThan(lb.x + 40);
  const afterLabel = await markerRelPos(page, 4);
  for (const k of ['x', 'y', 'w', 'h'] as const) expect(Math.abs(afterLabel[k] - resized[k])).toBeLessThan(0.001);
  // Farbe ändern
  await page.getByRole('button', { name: 'Farbe Blau' }).click();
  await expect(page.locator('[data-testid="aufmass-row"][data-number="4"] .color-dot')).toHaveAttribute('style', /28, 126, 214|#1c7ed6/);
  await waitSaved(page);
});

test('10. Excel-Export (Plan) mit echten Zahlenwerten', async () => {
  const dl = await catchDownload(page, () => page.getByTestId('export-xlsx-plan').click());
  expect(dl.suggestedFilename()).toBe('Wohnanlage_Sued_Tiefgarage_A-101_Aufmass.xlsx');
  const file = await saveDownload(dl);
  const wb = readXlsx(file);
  const ws = wb['A-101'];
  expect(ws[0].map((c) => c?.v)).toEqual(['Plannummer', 'Schadstellennummer', 'Länge (m)', 'Breite (m)', 'Tiefe (m)', 'Fläche (m²)']);
  const data = ws.slice(1, 5).map((r) => r.map((c) => c?.v));
  expect(data).toEqual([
    ['A-101', 1, 0.6, 0.4, 0.03, 0.24],
    ['A-101', 3, 3, 1.25, 0.1, 3.75],
    ['A-101', 4, 1.5, 0.8, 0.05, 1.2],
    ['A-101', 5, 0.5, 0.5, 0.04, 0.25],
  ]);
  // Zahlen sind numerisch (Typ „n“), nicht Text
  for (const r of ws.slice(1, 5)) for (const c of r.slice(1, 6)) expect(c?.t).toBe('n');
  expect(ws[1][5]?.fmt).toBe('#,##0.00');
  const sumRow = ws.find((r) => r[0]?.v === 'Summe')!;
  expect(sumRow[5]?.v).toBe('=SUM(F2:F5)');
  expect(Object.keys(wb)).toEqual(['A-101', 'Projektdaten']);
  // Datei lässt sich mit einem kompatiblen Tabellenprogramm (LibreOffice) öffnen
  execFileSync('soffice', ['--headless', '--convert-to', 'csv:Text - txt - csv (StarCalc):59,34,76,1,,1031', '--outdir', OUT, file], { timeout: 90_000 });
  const csv = execFileSync('cat', [file.replace(/\.xlsx$/, '.csv')], { encoding: 'utf8' });
  // Dezimaltrennzeichen hängt von der Ländereinstellung des Programms ab
  expect(csv).toMatch(/A-101;1;0[.,]60;0[.,]40;0[.,]03;0[.,]24/);
  expect(csv).toMatch(/Summe;;;;;5[.,]44/); // Summenformel wird berechnet
});

test('11. Bearbeiteten Plan als PDF exportieren', async () => {
  const dl = await catchDownload(page, async () => {
    await page.getByTestId('export-pdf-plan').click();
    await page.getByTestId('pdf-export-run').click();
  });
  expect(dl.suggestedFilename()).toBe('Wohnanlage_Sued_Tiefgarage_A-101_Plan.pdf');
  const file = await saveDownload(dl);
  const info = execFileSync('pdfinfo', [file], { encoding: 'utf8' });
  expect(info).toMatch(/Pages:\s+1/);
  const text = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' });
  expect(text).toContain('Aufmaßplan A-101');
  expect(text).not.toContain('Kostenstelle:'); // nur noch die Plannummer im Kopf
  expect(text).toContain('A-101 Untergeschoss'); // Original-Planinhalt (Vektor) erhalten
  execFileSync('pdftoppm', ['-png', '-r', '60', file, join(OUT, 'export-a101')]);
});

test('Weitere Pläne: gedrehte Seite und Planbereich – PDF-Export mehrerer Pläne', async () => {
  for (const no of ['B-204', 'A-102']) {
    await page.getByTestId('plan-select').selectOption({ label: no === 'B-204' ? 'B-204 – Stiege 2, Wand Nord' : 'A-102 – Tiefgarage, Decke' });
    await waitForPlan(page);
    await expect(page.locator('.damage-label')).toHaveCount(0);
    const box = await planBox(page);
    await page.getByTestId('tool-rect').click();
    await drawRect(page, box.x + box.width * 0.1, box.y + box.height * 0.1, box.x + box.width * 0.25, box.y + box.height * 0.2);
    // Nummerierung beginnt je Plan wieder bei 0
    await expect(page.getByTestId('damage-dialog').getByTestId('input-number')).toHaveValue('1');
    await fillMeasures(page, '1', '2', '0,05');
  }
  await waitSaved(page);
  await page.getByRole('link', { name: 'Zur Kostenstelle' }).click();
  const dl = await catchDownload(page, async () => {
    await page.getByRole('button', { name: 'PDF – Pläne auswählen' }).click();
    await page.getByTestId('pdf-export-run').click();
  });
  const file = await saveDownload(dl, 'kostenstelle-plaene.pdf');
  expect(execFileSync('pdfinfo', [file], { encoding: 'utf8' })).toMatch(/Pages:\s+4/);
  execFileSync('pdftoppm', ['-png', '-r', '50', file, join(OUT, 'export-cc')]);
});

test('10b. Excel-Export Kostenstelle und Gesamtprojekt', async () => {
  const dl = await catchDownload(page, () => page.getByTestId('export-xlsx-cc').click());
  expect(dl.suggestedFilename()).toBe('Wohnanlage_Sued_Tiefgarage_Aufmass.xlsx');
  const wb = readXlsx(await saveDownload(dl));
  const rows = wb['Tiefgarage'].slice(1).filter((r) => r[1] && typeof r[1].v === 'number').map((r) => [r[0]?.v, r[1]?.v, r[5]?.v]);
  expect(rows).toEqual([
    ['A-101', 1, 0.24],
    ['A-101', 3, 3.75],
    ['A-101', 4, 1.2],
    ['A-101', 5, 0.25],
    ['A-102', 1, 2],
    ['B-204', 1, 2],
  ]);
  const info = wb['Projektdaten'];
  expect(info.some((r) => r[0]?.v === 'Projekt' && r[1]?.v === 'Wohnanlage Süd')).toBe(true);

  await page.getByRole('link', { name: 'Zum Projekt' }).click();
  const dl2 = await catchDownload(page, () => page.getByTestId('export-xlsx-project').click());
  expect(dl2.suggestedFilename()).toBe('Wohnanlage_Sued_Aufmass.xlsx');
  const wb2 = readXlsx(await saveDownload(dl2));
  expect(Object.keys(wb2)).toEqual(['Tiefgarage', 'Stiege 1', 'Fassade Nord', 'Projektdaten']);
});

test('12. Projekt speichern, schließen und vollständig wiederherstellen', async () => {
  // Neu laden: alle Daten sind noch da
  await page.reload();
  await page.getByTestId('cost-center-card').filter({ hasText: 'Tiefgarage' }).click();
  await page.getByTestId('plan-card').filter({ hasText: 'A-101' }).click();
  await waitForPlan(page);
  expect((await tableRows(page)).map((r) => r[0])).toEqual(['1', '3', '4', '5']);
  await page.getByRole('link', { name: 'Zur Kostenstelle' }).click();
  await page.getByRole('link', { name: 'Zum Projekt' }).click();

  // Sicherung exportieren
  const dl = await catchDownload(page, () => page.getByTestId('backup-project').click());
  expect(dl.suggestedFilename()).toMatch(/^Wohnanlage_Sued_Sicherung_\d{4}-\d{2}-\d{2}\.zip$/);
  const backup = await saveDownload(dl, 'sicherung.zip');

  // Projekt löschen (mit Sicherheitsabfrage)
  await page.getByRole('link', { name: 'Zur Startseite' }).click();
  await page.getByRole('button', { name: 'Löschen' }).click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('endgültig');
  await page.getByTestId('confirm-dialog').getByRole('button', { name: 'Endgültig löschen' }).click();
  await expect(page.getByTestId('project-card')).toHaveCount(0);

  // Ungültige Datei wird abgelehnt
  await page.getByTestId('import-project-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  await expect(page.locator('.toast-error')).toContainText('keine gültige Projektsicherung');

  // Wiederherstellen
  await page.getByTestId('import-project-input').setInputFiles(backup);
  await expect(page.getByTestId('project-title')).toHaveText('Wohnanlage Süd');
  await page.getByTestId('cost-center-card').filter({ hasText: 'Tiefgarage' }).click();
  await expect(page.getByTestId('plan-card')).toHaveCount(4);
  await page.getByTestId('plan-card').filter({ hasText: 'A-101' }).click();
  await waitForPlan(page);
  expect(sorted(await tableRows(page))).toEqual([
    ['1', '0,60', '0,40', '0,03', '0,24'],
    ['3', '3,00', '1,25', '0,10', '3,75'],
    ['4', '1,50', '0,80', '0,05', '1,20'],
    ['5', '0,50', '0,50', '0,04', '0,25'],
  ]);
  await expect(page.locator('.damage-label')).toHaveCount(4);

  // Erneuter Import derselben Sicherung → Konflikt wird erkannt, Import als Kopie
  await page.goto('./#/');
  await page.getByTestId('import-project-input').setInputFiles(backup);
  await expect(page.getByTestId('confirm-dialog')).toContainText('bereits vorhanden');
  await page.getByTestId('confirm-dialog').getByRole('button', { name: 'Abbrechen' }).click();
  await page.getByTestId('confirm-dialog').getByRole('button', { name: 'Als Kopie importieren' }).click();
  await expect(page.getByTestId('project-title')).toHaveText('Wohnanlage Süd (Kopie)');
  await page.goto('./#/');
  await expect(page.getByTestId('project-card')).toHaveCount(2);
});

test('Fehlerfälle: nicht unterstütztes Dateiformat, Konflikt zwischen zwei Tabs', async () => {
  await page.getByTestId('project-card').filter({ hasText: 'Wohnanlage Süd (Kopie)' }).click();
  await page.getByTestId('cost-center-card').filter({ hasText: 'Stiege 1' }).click();
  await page.getByTestId('plan-file-input').setInputFiles({ name: 'plan.dwg', mimeType: 'application/octet-stream', buffer: Buffer.from('xyz') });
  await expect(page.getByTestId('import-wizard')).toContainText('nicht unterstützt');
  await page.getByTestId('import-wizard').getByRole('button', { name: 'Schließen' }).last().click();

  // Zweiter Tab ändert dasselbe Projekt → erster Tab überschreibt nicht unbemerkt
  const url = page.url();
  const other = await page.context().newPage();
  await other.goto(url.replace(/#.*/, '') + '#/p/' + url.split('#/p/')[1].split('/')[0]);
  await other.getByRole('button', { name: 'Projektdaten bearbeiten' }).click();
  await other.getByTestId('project-form').locator('input[name="site"]').fill('Geändert in Tab 2');
  await other.getByTestId('project-form').getByRole('button', { name: 'Speichern' }).click();
  await expect(other.getByTestId('save-status')).toHaveAttribute('data-status', 'saved');
  await other.close();
  await page.getByRole('link', { name: 'Zum Projekt' }).click();
  await page.getByRole('button', { name: 'Projektdaten bearbeiten' }).click();
  await page.getByTestId('project-form').locator('input[name="client"]').fill('Änderung in Tab 1');
  await page.getByTestId('project-form').getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'conflict');
  await expect(page.locator('.banner-error')).toContainText('in einem anderen Fenster oder Tab geändert');
  await page.getByTestId('save-status').getByRole('button', { name: 'Neu laden' }).click();
  await expect(page.locator('.project-info')).toContainText('Geändert in Tab 2');
});
