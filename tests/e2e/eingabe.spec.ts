import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { excelExport, catchDownload, drawRect, FIXTURES, freshStart, OUT, pickTool, planBox, messliste, readXlsx, saveDownload, waitForPlan, waitSaved } from './helpers';

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
  expect(dl.suggestedFilename()).toBe('Ohne_KSt_Aufmass.xlsx');
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
  const form = page.getByTestId('project-form');
  // Reihenfolge im Formular
  const labels = await form.locator('.field > span').allTextContents();
  expect(labels.map((l) => l.replace(/ \*| \(optional\)/g, ''))).toEqual(['Projektname', 'Kostenstelle(n)', 'Projektnummer', 'Adresse', 'Auftraggeber', 'Baubeginn', 'Bemerkung']);
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
  await expect(dlg.getByTestId('input-width')).toHaveAttribute('placeholder', 'optional');
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
  await dlg.getByTestId('kind-area').click();
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
  // Messliste: leere Zellen statt 0
  const rows = messliste(readXlsx(await saveDownload(xdl, 'optional.xlsx')));
  expect(rows.map((r) => r.values.slice(1))).toEqual([
    [4.2, null, null, null],
    [3, null, 0.1, null],
    [5, 2.8, null, 14],
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
