import { expect, test, type Page } from './fixtures';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { excelExport, catchDownload, drawRect, FIXTURES, freshStart, OUT, pickTool, planBox, blattRows, blattRebar, readXlsx, saveDownload, waitForPlan, waitSaved } from './helpers';

/**
 * Paket J: Werkzeugleiste klappt nach dem Zeichnen zu (zurück zur Auswahl); nur die Länge ist
 * Pflicht, Breite/Höhe und Tiefe optional (leer = leer, nicht 0).
 * Paket K: Kostenstelle optional, Reihenfolge der Projektinformationen, Baubeginn nur dort.
 */

type Rec = Record<string, unknown> & { deletedAt: number | null; createdAt: number };
async function stored(page: Page, store: string): Promise<Rec[]> {
  return page.evaluate(
    (name) =>
      new Promise<Rec[]>((resolve) => {
        const req = indexedDB.open('schadstellen-aufmass');
        req.onsuccess = () => {
          const all = req.result.transaction(name).objectStore(name).getAll();
          all.onsuccess = () => {
            req.result.close();
            resolve((all.result as Rec[]).filter((d) => !d.deletedAt).sort((a, b) => a.createdAt - b.createdAt));
          };
        };
      }),
    store,
  );
}

async function projectWithoutCostCenter(page: Page, name: string) {
  await page.getByTestId('new-project').click();
  await page.getByTestId('project-picker').getByTestId('picker-new').click();
  const form = page.getByTestId('project-form');
  await form.locator('input[name="name"]').fill(name);
  await form.getByRole('button', { name: 'Projekt anlegen' }).click();
  await expect(page.getByTestId('project-title')).toHaveText(name);
}

test('Projekt ohne Kostenstelle: anlegen, Plan importieren, Kostenstelle später ergänzen', async ({ page }) => {
  await freshStart(page);
  await projectWithoutCostCenter(page, 'Ohne KSt');
  await expect(page.getByTestId('project-cost-centers')).toHaveText('–');
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('K-1');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  await page.getByRole('link', { name: 'Zurück zur Planliste' }).click();
  await expect(page.getByTestId('plan-row')).toHaveCount(1);
  // Excel ohne Kostenstelle: kein Fehler
  const dl = await catchDownload(page, () => excelExport(page, 'export-xlsx-cc'));
  expect(dl.suggestedFilename()).toBe('Ohne_KSt_Aufmassblatt_001.xlsx');
  // Später Hauptkostenstelle und eine weitere ergänzen – der Plan bleibt erhalten
  await page.getByTestId('edit-project').click();
  const form = page.getByTestId('project-form');
  await form.getByTestId('cost-center-number').first().fill('4711');
  await form.getByTestId('cost-center-input').first().fill('Tiefgarage');
  await form.getByRole('button', { name: '+ Weitere Kostenstelle' }).click();
  await form.getByTestId('cost-center-input').last().fill('Hof');
  await form.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByTestId('project-cost-centers')).toHaveText('4711 – Tiefgarage, Hof');
  await page.getByTestId('cost-center-select').selectOption({ label: '4711 – Tiefgarage (1)' });
  await expect(page.getByTestId('plan-row')).toHaveCount(1);
  await waitSaved(page);
  expect((await stored(page, 'costCenters')).length).toBe(2);
});

test('Projektinformationen: Reihenfolge, Baubeginn gespeichert und nur dort angezeigt', async ({ page }) => {
  await freshStart(page);
  await page.getByTestId('new-project').click();
  await page.getByTestId('project-picker').getByTestId('picker-new').click();
  const form = page.getByTestId('project-form');
  // Reihenfolge im Formular
  const labels = await form.locator('.field > span').allTextContents();
  expect(labels.map((l) => l.replace(/ \*| \(optional\)/g, ''))).toEqual(['Projektname', 'Bauvorhaben', 'Projektnummer', 'Kostenstelle', 'Auftraggeber', 'Baubeginn', 'Bemerkung']);
  await expect(form.getByTestId('project-start')).toHaveValue(''); // kein automatisches Datum
  await form.locator('input[name="name"]').fill('Reihenfolge');
  await form.getByTestId('cost-center-input').first().fill('Garage');
  await form.locator('input[name="number"]').fill('P-77');
  await form.locator('input[name="address"]').fill('Hauptstraße 3');
  await form.locator('input[name="client"]').fill('Stadt');
  await form.getByTestId('project-start').fill('2026-11-02');
  await form.locator('textarea[name="notes"]').fill('Hinweis');
  await form.getByRole('button', { name: 'Projekt anlegen' }).click();
  await expect(page.getByTestId('project-title')).toHaveText('Reihenfolge');
  // Reihenfolge in der Anzeige
  const shown = await page.locator('.project-info dt').allTextContents();
  expect(shown).toEqual(['Kostenstelle', 'Projektnummer', 'Adresse', 'Auftraggeber', 'Baubeginn', 'Bemerkung']);
  await expect(page.getByTestId('project-start')).toHaveText('02.11.2026');
  await page.reload();
  await expect(page.getByTestId('project-start')).toHaveText('02.11.2026');
  // Bearbeiten zeigt den gespeicherten Baubeginn
  await page.getByTestId('edit-project').click();
  await expect(form.getByTestId('project-start')).toHaveValue('2026-11-02');
  await form.getByRole('button', { name: 'Abbrechen' }).click();

  // Nicht im Aufmaßplan (PDF) und nicht in Excel
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('R-1');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  const pdl = await catchDownload(page, async () => {
    await page.getByTestId('export-pdf-plan').click();
    await page.getByTestId('pdf-export-run').click();
  });
  const pdf = await saveDownload(pdl, 'baubeginn.pdf');
  const text = execFileSync('pdftotext', [pdf, '-'], { encoding: 'utf8' });
  expect(text).not.toMatch(/02\.11\.2026|Baubeginn/);
  const xdl = await catchDownload(page, () => excelExport(page, 'export-xlsx-plan'));
  const wb = readXlsx(await saveDownload(xdl, 'baubeginn.xlsx'));
  expect(JSON.stringify(wb)).not.toMatch(/02\.11\.2026|2026-11-02|Baubeginn/);
});

test('Messung: nur Länge Pflicht, Breite/Höhe und Tiefe optional; Werkzeugleiste klappt zu', async ({ page }) => {
  await freshStart(page);
  await projectWithoutCostCenter(page, 'Maße');
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('M-1');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  const box = await planBox(page);
  const dlg = page.getByTestId('damage-dialog');

  // Ohne Länge: nicht speicherbar
  await pickTool(page, 'tool-rect');
  await drawRect(page, box.x + box.width * 0.1, box.y + box.height * 0.1, box.x + box.width * 0.2, box.y + box.height * 0.2);
  await expect(dlg.getByTestId('input-width')).not.toHaveAttribute('placeholder', /./);
  await dlg.getByTestId('damage-save').click();
  await expect(dlg).toContainText('Länge');
  await expect(dlg).toBeVisible();
  // Nur Länge → speicherbar, keine Fläche
  await dlg.getByTestId('input-length').fill('4,2');
  await expect(dlg.getByTestId('area-result')).toContainText('Fläche erst mit Breite/Höhe');
  await dlg.getByTestId('damage-save').click();
  await expect(dlg).toBeHidden();
  // Leiste zu, Auswahl aktiv, neue Messung ausgewählt
  await expect(page.getByTestId('tools-open')).toBeVisible();
  await expect(page.getByTestId('tool-rect')).toBeHidden();
  await expect(page.getByTestId('selection-bar')).toContainText('L 4,20 m');
  await page.getByTestId('tools-open').click();
  await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true');
  // und manuell wieder ausblenden
  await page.getByTestId('tools-close').click();
  await expect(page.getByTestId('tools-open')).toBeVisible();

  // Fläche (Messart) mit Länge und Tiefe, ohne Breite/Höhe → kein Volumen, keine Fläche
  await pickTool(page, 'tool-rect');
  await drawRect(page, box.x + box.width * 0.4, box.y + box.height * 0.1, box.x + box.width * 0.5, box.y + box.height * 0.2);
  await dlg.getByTestId('input-length').fill('3');
  await dlg.getByTestId('input-depth').fill('0,1');
  await dlg.getByTestId('damage-save').click();
  await expect(dlg).toBeHidden();
  // Wand: Länge × Höhe = Wandfläche, Tiefe leer
  await pickTool(page, 'tool-rect');
  await drawRect(page, box.x + box.width * 0.6, box.y + box.height * 0.1, box.x + box.width * 0.7, box.y + box.height * 0.2);
  await dlg.getByTestId('input-length').fill('5');
  await dlg.getByTestId('input-width').fill('2,8');
  await expect(dlg.getByTestId('area-result')).toContainText('14,00 m²');
  await dlg.getByTestId('damage-save').click();
  await expect(dlg).toBeHidden();
  // Ungültige optionale Eingabe wird abgelehnt
  await pickTool(page, 'tool-rect');
  await drawRect(page, box.x + box.width * 0.1, box.y + box.height * 0.5, box.x + box.width * 0.2, box.y + box.height * 0.6);
  await dlg.getByTestId('input-length').fill('1');
  await dlg.getByTestId('input-width').fill('0');
  await dlg.getByTestId('damage-save').click();
  await expect(dlg).toContainText('Breite/Höhe muss größer als 0 sein');
  await dlg.getByTestId('damage-cancel').click();
  await waitSaved(page);

  const ds = await stored(page, 'damages');
  expect(ds.map((d) => [d.length, d.width, d.depth, d.area])).toEqual([
    [4.2, null, null, null], // leer bleibt leer, nicht 0
    [3, null, 0.1, null],
    [5, 2.8, null, 14],
  ]);
  await expect(page.getByTestId('sum-area')).toHaveText('14,00');
  // Excel: leere Zellen statt 0
  const xdl = await catchDownload(page, () => excelExport(page, 'export-xlsx-plan'));
  // Aufmaßblatt: Fläche mit Länge × Breite, Linien nur mit Länge (keine 0 für fehlende Werte)
  const rows = blattRows(readXlsx(await saveDownload(xdl, 'optional.xlsx')));
  expect(rows.map((r) => [r.nr, r.values])).toEqual([
    [3, { Länge: 5, Breite: 2.8, 'm²': 14 }],
    [1, { m: 4.2 }],
    [2, { m: 3 }],
  ]);
  await page.screenshot({ path: join(OUT, 'leiste-zu.png') });
});

test('Zeichenmodus: nach dem Zeichnen Auswahl aktiv, Objekt bearbeitbar, Leiste wieder öffnen', async ({ page }) => {
  await freshStart(page);
  await projectWithoutCostCenter(page, 'Zeichnen');
  await page.getByTestId('draw-plan').click();
  const nd = page.getByTestId('new-drawing');
  await nd.locator('[data-field="planNumber"]').fill('Z-1');
  await nd.getByTestId('new-drawing-save').click();
  const sheet = page.getByTestId('drawing-sheet');
  await expect(sheet).toBeVisible();
  await pickTool(page, 'draw-rect');
  const sb = (await sheet.boundingBox())!;
  await page.mouse.move(sb.x + 60, sb.y + 60);
  await page.mouse.down();
  await page.mouse.move(sb.x + 160, sb.y + 120, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByTestId('element-bar')).toContainText('Rechteck');
  // Nach dem Zeichnen ist wieder „Auswahl“ aktiv (obere Leiste bleibt sichtbar, verdeckt den Plan nicht)
  await expect(page.getByTestId('draw-select')).toHaveAttribute('aria-pressed', 'true');
  // Objekt bleibt bearbeitbar (exakte Maße)
  await page.getByTestId('element-length').fill('2,5');
  await page.getByTestId('element-length').press('Enter');
  await expect(page.locator('.dims [data-dim="2,50 m"]').first()).toBeVisible();
  // Linien über die Maßeingabe schließen weiterhin aneinander an (Werkzeug bleibt aktiv)
  await page.locator('.side-head h2').click();
  await page.keyboard.press('Escape');
  await page.getByTestId('draw-line').click();
  await page.getByTestId('insert-length').fill('3');
  await page.getByTestId('insert-submit').click();
  await expect(page.getByTestId('draw-line')).toHaveAttribute('aria-pressed', 'true');
});

test('Messung: Bemerkung / Notiz im Dialog, in der Aufmaß-Tabelle und im Excel', async ({ page }) => {
  await freshStart(page);
  await projectWithoutCostCenter(page, 'Notiz');
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('N-1');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  const box = await planBox(page);
  const dlg = page.getByTestId('damage-dialog');
  // ohne Notiz: keine Spalte „Bemerkung“
  await pickTool(page, 'tool-rect');
  await drawRect(page, box.x + box.width * 0.1, box.y + box.height * 0.1, box.x + box.width * 0.2, box.y + box.height * 0.2);
  await dlg.getByTestId('input-length').fill('2');
  await dlg.getByTestId('input-width').fill('1');
  await dlg.getByTestId('damage-save').click();
  await expect(dlg).toBeHidden();
  await expect(page.getByTestId('aufmass-table').locator('th.note-col')).toHaveCount(0);
  // mit Notiz
  await pickTool(page, 'tool-rect');
  await drawRect(page, box.x + box.width * 0.4, box.y + box.height * 0.1, box.x + box.width * 0.5, box.y + box.height * 0.2);
  await dlg.getByTestId('input-length').fill('5');
  await dlg.getByTestId('input-width').fill('2');
  await dlg.getByTestId('input-note').fill('Ecke beschädigt');
  // Bewehrung: Zeilen Stück × Länge, Summe automatisch; ungültige Länge wird gemeldet
  await dlg.getByTestId('rebar-add').click();
  await dlg.getByTestId('rebar-count').nth(0).fill('4');
  await dlg.getByTestId('rebar-length').nth(0).fill('1,2');
  await dlg.getByTestId('rebar-add').click();
  await dlg.getByTestId('rebar-count').nth(1).fill('2');
  await dlg.getByTestId('rebar-length').nth(1).fill('abc');
  await dlg.getByTestId('damage-save').click();
  await expect(dlg).toContainText('Bewehrung: Stück als ganze Zahl');
  await dlg.getByTestId('rebar-length').nth(1).fill('0,8');
  await expect(dlg.getByTestId('rebar-line')).toHaveText(['= 4,80 lfm', '= 1,60 lfm']);
  await expect(dlg.getByTestId('rebar-sum')).toHaveText('Summe 6,40 lfm');
  await dlg.getByTestId('damage-save').click();
  await expect(dlg).toBeHidden();
  await waitSaved(page);
  const ds = await stored(page, 'damages');
  expect(ds.map((d) => d.note ?? null)).toEqual([null, 'Ecke beschädigt']);
  expect(ds.map((d) => d.rebar ?? null)).toEqual([null, 6.4]);
  expect(ds[1].rebarItems.map((x: { count: number; length: number }) => [x.count, x.length])).toEqual([
    [4, 1.2],
    [2, 0.8],
  ]);
  await expect(page.getByTestId('row-rebar')).toHaveText(['', '6,40']);
  await expect(page.getByTestId('sum-rebar')).toHaveText('6,40 lfm');
  await expect(page.getByTestId('aufmass-table').locator('th.note-col')).toHaveText('Bemerkung');
  await expect(page.getByTestId('row-note')).toHaveText(['', 'Ecke beschädigt']);
  // Notiz bleibt beim Bearbeiten erhalten
  await page.locator('[data-testid="aufmass-row"][data-number="2"]').getByRole('button', { name: /2 bearbeiten/ }).click();
  await expect(dlg.getByTestId('input-note')).toHaveValue('Ecke beschädigt');
  await expect(dlg.getByTestId('rebar-length')).toHaveCount(2);
  await expect(dlg.getByTestId('rebar-sum')).toHaveText('Summe 6,40 lfm');
  await dlg.getByTestId('damage-cancel').click();
  // Excel: Spalte „Bemerkung“
  const xdl = await catchDownload(page, () => excelExport(page, 'export-xlsx-plan'));
  const rows = blattRows(readXlsx(await saveDownload(xdl, 'notiz.xlsx')));
  expect(rows.map((r) => [r.nr, r.note])).toEqual([
    [1, null],
    [2, 'Ecke beschädigt'],
  ]);  // Bewehrung: eigene Tabelle mit Nr. und lfm
  expect(blattRebar(readXlsx(await saveDownload(xdl, 'notiz2.xlsx')))).toEqual([
    [2, 4, 1.2, 4.8],
    [2, 2, 0.8, 1.6],
  ]);
});

test('Messung: Fotos wie im Mängelplan (Galerie → Fotodokumentation), Taste Fotodokumentation im Projekt', async ({ page }) => {
  await freshStart(page);
  await projectWithoutCostCenter(page, 'Fotos Aufmaß');
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('F-1');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  const box = await planBox(page);
  const dlg = page.getByTestId('damage-dialog');
  await pickTool(page, 'tool-rect');
  await drawRect(page, box.x + box.width * 0.1, box.y + box.height * 0.1, box.x + box.width * 0.2, box.y + box.height * 0.2);
  await dlg.getByTestId('input-length').fill('2');
  await dlg.getByTestId('input-width').fill('1');
  await expect(dlg.getByTestId('attach-camera')).toBeVisible();
  await dlg.getByTestId('photo-file-input').setInputFiles(join(FIXTURES, 'foto.jpg'));
  const ps = page.getByTestId('photo-save-dialog');
  await ps.getByTestId('photo-save').click();
  await expect(ps).toHaveCount(0);
  await expect(dlg.getByTestId('attach-photo')).toHaveCount(1, { timeout: 15_000 });
  await dlg.getByTestId('attach-photo').click();
  await expect(page.getByTestId('photo-viewer')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('photo-viewer')).toHaveCount(0);
  // Serienaufnahme: Foto, Foto – Haken speichert beide zur Nummer (ohne Live-Bild: Kamera des Geräts)
  await dlg.getByTestId('attach-camera').click();
  const cam = page.getByTestId('series-camera');
  await expect(cam).toBeVisible();
  await expect(cam).toContainText('Aufmaß F-1 Nr. 1');
  // Testkamera (Live-Bild, ohne Lampe): Blitz-Taste zeigt den Hinweis auf die Gerätekamera
  await expect(cam).toHaveAttribute('data-live', '1', { timeout: 15_000 });
  await expect(cam.getByTestId('series-flash').locator('[data-flash-icon="off"]')).toHaveCount(1); // durchgestrichen
  await cam.getByTestId('series-flash').click();
  await expect(page.locator('.toast', { hasText: 'Gerätekamera' })).toHaveCount(1);
  await expect(cam.getByTestId('series-device-camera')).toBeVisible();
  // Hoch/Quer: automatisch erkannt (PC-Testkamera quer), umschaltbar
  await expect(cam.getByTestId('series-orient')).toContainText('Auto (Quer)');
  // Handy quer: Bild links groß, Auslöser und Haken rechts
  await page.setViewportSize({ width: 844, height: 390 });
  const vb = (await cam.locator('video').boundingBox())!;
  const sb = (await cam.getByTestId('series-shutter').boundingBox())!;
  expect(sb.x).toBeGreaterThanOrEqual(vb.x + vb.width - 2);
  expect(vb.height).toBeGreaterThan(250);
  await page.screenshot({ path: join(OUT, 'serienkamera-quer.png') });
  await page.setViewportSize({ width: 1440, height: 900 });
  await cam.getByTestId('series-shutter').click();
  await expect(cam.getByTestId('series-count')).toHaveText('1 Foto');
  // im schlimmsten Fall: Foto um 90° drehen
  await cam.getByTestId('series-turn').first().click();
  await expect(cam.getByTestId('series-thumb').first()).toHaveAttribute('data-rot', '90');
  // Gerätekamera (eigener Blitz): Foto kommt als Datei
  await cam.getByTestId('series-input').setInputFiles(join(FIXTURES, 'foto.jpg'));
  await expect(cam.getByTestId('series-count')).toHaveText('2 Fotos');
  await cam.getByTestId('series-done').click();
  await expect(cam).toHaveCount(0);
  await expect(dlg.getByTestId('attach-photo')).toHaveCount(3, { timeout: 15_000 });
  await dlg.getByTestId('damage-save').click();
  await expect(dlg).toBeHidden();
  await expect(page.getByTestId('row-photos')).toHaveText('3');
  await waitSaved(page);
  const ds = await stored(page, 'damages');
  expect((ds[0].photoIds as string[]).length).toBe(3);
  // gedrehtes Live-Foto ist hochkant gespeichert
  const ph = await stored(page, 'photos');
  const turned = ph.find((p) => p.id === (ds[0].photoIds as string[])[1])!;
  expect(Number(turned.height)).toBeGreaterThan(Number(turned.width));
  // erneut öffnen: Fotos sind dabei, aus der Fotodokumentation wählbar
  await page.locator('[data-testid="aufmass-row"][data-number="1"]').getByRole('button', { name: /1 bearbeiten/ }).click();
  await expect(dlg.getByTestId('attach-photo')).toHaveCount(3, { timeout: 15_000 });
  await dlg.getByTestId('attach-from-doku').click();
  await expect(page.getByTestId('dp-photo-pick')).toHaveCount(3);
  await page.getByTestId('dp-photo-picker-done').click();
  await dlg.getByTestId('damage-cancel').click();
  // Farblegende: erkannte Farbe mit eigener Bezeichnung, im Plan angezeigt
  await page.getByTestId('editor-legend').click();
  const lg = page.getByTestId('legend-dialog');
  await expect(lg.getByTestId('legend-row')).toHaveCount(1);
  await lg.getByTestId('legend-input').fill('Betonsanierung');
  await expect(lg.getByTestId('legend-show')).toBeChecked();
  // Lage wählbar (Standard unten links) – hier oben rechts
  await expect(lg.getByTestId('legend-pos-bl')).toHaveAttribute('aria-checked', 'true');
  await lg.getByTestId('legend-pos-tr').click();
  await lg.getByTestId('legend-save').click();
  await expect(page.getByTestId('plan-legend')).toContainText('Betonsanierung');
  await expect(page.getByTestId('plan-legend')).toHaveAttribute('data-pos', 'tr');
  await waitSaved(page);
  // Plan-PDF mit Legende (ohne Fotos)
  const dl = await catchDownload(page, async () => {
    await page.getByTestId('export-pdf-plan').click();
    await page.getByTestId('pdf-export-run').click();
  });
  const pdf = await saveDownload(dl, 'plan-legende.pdf');
  const text = execFileSync('pdftotext', [pdf, '-'], { encoding: 'utf8' });
  expect(text).toContain('Legende');
  expect(text).toContain('Betonsanierung');
  expect(text).not.toContain('Fotos');
  // im PDF oben rechts
  const bbox = execFileSync('pdftotext', ['-bbox', pdf, '-'], { encoding: 'utf8' });
  const pageW = Number(/<page width="([\d.]+)"/.exec(bbox)![1]);
  const pageH = Number(/<page width="[\d.]+" height="([\d.]+)"/.exec(bbox)![1]);
  const word = /<word xMin="([\d.]+)" yMin="([\d.]+)"[^>]*>Legende</.exec(bbox)!;
  expect(Number(word[1])).toBeGreaterThan(pageW / 2);
  expect(Number(word[2])).toBeLessThan(pageH / 2);
  expect(Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [pdf], { encoding: 'utf8' }))![1])).toBe(1);
  await page.keyboard.press('Escape');
  // Foto-PDF separat: jedes Foto mit Plan, Nummer und Position
  const fdl = await catchDownload(page, async () => {
    await page.getByTestId('export-pdf-plan').click();
    await expect(page.getByTestId('pdf-photos-run')).toContainText('Foto-PDF (3)');
    await page.getByTestId('pdf-photos-run').click();
  });
  const fpdf = await saveDownload(fdl, 'fotos.pdf');
  const ftext = execFileSync('pdftotext', [fpdf, '-'], { encoding: 'utf8' });
  expect(ftext.match(/Plan F-1 - parkdeck\s+·\s+Nr\. 1/g)?.length).toBe(3);
  expect(ftext).toContain('Position: ohne Leistungszuordnung');
  expect(Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [fpdf], { encoding: 'utf8' }))![1])).toBe(2);
  expect(execFileSync('pdfimages', ['-list', fpdf], { encoding: 'utf8' }).trim().split('\n').length - 2).toBe(3);
  // Projekt: Taste Fotodokumentation öffnet die Fotos des Projekts (mit Vermerk)
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'Zurück zur Planliste' }).click();
  await page.getByTestId('project-photos').click();
  await expect(page.getByTestId('photo-thumb')).toHaveCount(3, { timeout: 15_000 });
  await expect(page.locator('body')).toContainText('Fotos Aufmaß');
});

test('Stil-Menü (Darstellung neuer Messungen) schließt bei Klick auf den Plan oder ein anderes Werkzeug', async ({ page }) => {
  await freshStart(page);
  await projectWithoutCostCenter(page, 'Stil');
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('S-1');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  const box = await planBox(page);
  const pop = page.getByTestId('default-style');
  await pickTool(page, 'tool-select'); // Klick auf den Plan legt dann keine Messung an
  // Klicks im Menü lassen es offen
  await page.getByTestId('tool-style').click();
  await expect(pop).toBeVisible();
  await pop.click({ position: { x: 10, y: 10 } });
  await expect(pop).toBeVisible();
  // Klick auf den Plan
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await expect(pop).toHaveCount(0);
  // anderes Werkzeug
  await page.getByTestId('tool-style').click();
  await expect(pop).toBeVisible();
  await pickTool(page, 'tool-rect');
  await expect(pop).toHaveCount(0);
  // Taste „Stil“ schaltet weiterhin auf und zu
  await page.getByTestId('tool-style').click();
  await expect(pop).toBeVisible();
  await page.getByTestId('tool-style').click();
  await expect(pop).toHaveCount(0);
});
