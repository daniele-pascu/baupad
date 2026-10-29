import { expect, test, type Page } from './fixtures';
import { join } from 'node:path';
import { catchDownload, createProject, drawRect, FIXTURES, fillMeasures, freshStart, openPlan, pickTool, planBox, readXlsx, saveDownload, waitForPlan, waitSaved } from './helpers';

/**
 * Nach Rechnungen aufteilen: jede Teilrechnung hat eigene Pläne (Plannummern je Rechnung
 * eindeutig, derselbe Plan darf in der nächsten Rechnung wieder vorkommen).
 */

type Rec = { id: string; planNumber: string; invoiceId?: string | null; deletedAt: number | null };
async function plans(page: Page): Promise<Rec[]> {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open('schadstellen-aufmass');
        req.onsuccess = () => {
          const all = req.result.transaction('plans').objectStore('plans').getAll();
          all.onsuccess = () => {
            req.result.close();
            resolve((all.result as Rec[]).filter((p) => !p.deletedAt));
          };
        };
      }),
  );
}

async function backToList(page: Page) {
  await page.getByRole('link', { name: 'Zurück zur Planliste' }).click();
  await expect(page.getByTestId('plan-list').or(page.getByTestId('plans-empty'))).toBeVisible();
}

const tab = (page: Page, text: string) => page.getByTestId('invoice-tab').filter({ hasText: text });

test('Nach Rechnungen aufteilen: eigene Pläne je Teilrechnung, gleiche Plannummer erlaubt', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Rechnungen');

  // Option vor den Plänen → 1. Teilrechnung
  await page.getByTestId('split-invoices').click();
  const dlg = page.getByTestId('invoice-dialog');
  await expect(dlg.getByTestId('invoice-kind-tr')).toHaveAttribute('aria-checked', 'true');
  await dlg.getByTestId('invoice-period').fill('Oktober 2026');
  await expect(dlg.getByTestId('invoice-save')).toHaveText('1. Teilrechnung anlegen');
  await dlg.getByTestId('invoice-save').click();
  await expect(page.getByTestId('invoice-tab')).toHaveCount(1);
  await expect(tab(page, 'TR 1')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('split-invoices')).toHaveCount(0);
  await expect(page.getByTestId('plans-empty')).toContainText('in der 1. Teilrechnung');

  // Plan in TR 1
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'massketten.pdf'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('K-1');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  await backToList(page);
  await expect(page.getByTestId('plan-row')).toHaveCount(1);

  // gleiche Nummer in derselben Rechnung: nicht erlaubt
  await page.getByTestId('draw-plan').click();
  const nd = page.getByTestId('new-drawing');
  await nd.locator('[data-field="planNumber"]').fill('K-1');
  await nd.getByTestId('new-drawing-save').click();
  await expect(nd).toContainText('in dieser Rechnung bereits vergeben');
  await nd.getByRole('button', { name: 'Abbrechen' }).click();

  // + Rechnung → 2. Teilrechnung, leer
  await page.getByTestId('invoice-add').click();
  await page.getByTestId('invoice-dialog').getByTestId('invoice-save').click();
  await expect(tab(page, 'TR 2')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('plan-row')).toHaveCount(0);
  await expect(page.getByTestId('plans-empty')).toContainText('in der 2. Teilrechnung');

  // derselbe Plan in TR 2 (Planbibliothek): Nummer K-1 ist hier frei und wird vorgeschlagen
  await page.getByTestId('open-plan-library').click();
  await page.getByTestId('plan-library').getByTestId('library-reuse').click();
  const reuse = page.getByTestId('reuse-plan');
  await expect(reuse.locator('[data-field="planNumber"]')).toHaveValue('K-1');
  await reuse.getByTestId('reuse-save').click();
  await waitForPlan(page);
  // Planwechsel im Editor: nur die Pläne dieser Rechnung
  await expect(page.getByTestId('plan-select').locator('option')).toHaveCount(1);
  await waitSaved(page);
  await backToList(page);
  await expect(page.getByTestId('plan-row')).toHaveCount(1);

  const all = await plans(page);
  expect(all.map((p) => p.planNumber)).toEqual(['K-1', 'K-1']);
  expect(new Set(all.map((p) => p.invoiceId)).size).toBe(2);

  // Rechnung mit Plänen lässt sich nicht löschen; als abgerechnet markieren
  await page.getByTestId('invoice-actions').click();
  await expect(page.getByTestId('invoice-delete')).toHaveCount(0);
  await page.getByTestId('invoice-settle').click();
  await expect(page.locator('.invoice-tab.settled')).toHaveCount(1);
  await expect(page.getByTestId('settled-warning')).toContainText('2. Teilrechnung ist abgerechnet');
  // im Plan: Warnung, Bearbeiten bleibt möglich
  await openPlan(page, 'K-1');
  await waitForPlan(page);
  await expect(page.getByTestId('settled-warning')).toBeVisible();
  await backToList(page);

  // Wechsel zu TR 1 bleibt nach dem Neuladen gemerkt
  await tab(page, 'TR 1').click();
  await expect(page.getByTestId('plan-row')).toHaveCount(1);
  await waitSaved(page);
  await page.reload();
  await expect(tab(page, 'TR 1')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.invoice-tab.settled')).toContainText('TR 2');

  // leere Rechnung (Schlussrechnung) anlegen und wieder löschen
  await page.getByTestId('invoice-add').click();
  const d3 = page.getByTestId('invoice-dialog');
  await expect(d3.getByRole('radio')).toHaveText(['Rechnung', 'Teilrechnung', 'Schlussteilrechnung', 'Schlussrechnung']);
  await d3.getByTestId('invoice-kind-r').click();
  await expect(d3.getByTestId('invoice-save')).toHaveText('3. Rechnung anlegen');
  await d3.getByTestId('invoice-kind-sr').click();
  await expect(d3.getByTestId('invoice-save')).toHaveText('3. Schlussrechnung anlegen');
  await d3.getByTestId('invoice-save').click();
  await expect(tab(page, 'SR 3')).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('invoice-actions').click();
  await page.getByTestId('invoice-delete').click();
  await expect(page.getByTestId('invoice-tab')).toHaveCount(2);
});

async function importPlan(page: Page, no: string) {
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'massketten.pdf'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill(no);
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
}

async function measure(page: Page, at: number, l: string, b: string) {
  const box = await planBox(page);
  await pickTool(page, 'tool-rect');
  await drawRect(page, box.x + box.width * at, box.y + box.height * 0.2, box.x + box.width * (at + 0.1), box.y + box.height * 0.3);
  await fillMeasures(page, l, b, '', false);
  await waitSaved(page);
}

test('Aufmaß je Rechnung: alle Pläne zusammen, Excel mit Rechnung im Titel', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Rechnung Excel');
  await page.getByTestId('split-invoices').click();
  await page.getByTestId('invoice-dialog').getByTestId('invoice-save').click();
  await expect(page.getByTestId('aufmass-invoice')).toHaveText('1. Teilrechnung');
  await importPlan(page, 'A');
  await measure(page, 0.2, '2', '1');
  await backToList(page);
  await importPlan(page, 'B');
  await measure(page, 0.2, '3', '1');
  await backToList(page);
  // ein Aufmaß mit den Messungen beider Pläne
  await expect(page.getByTestId('aufmass-block')).toHaveCount(0);
  await expect(page.getByTestId('aufmass-section').getByTestId('aufmass-table').locator('tbody tr')).toHaveCount(2);
  await page.getByTestId('export-xlsx-invoice').click();
  const file = await saveDownload(await catchDownload(page, () => page.getByTestId('excel-export').getByTestId('blatt-export').click()));
  expect(file).toContain('TR1');
  const wb = readXlsx(file);
  const ws = Object.values(wb)[0];
  expect(ws[0][0]?.v).toBe('Aufmaßblatt 001 – 1. Teilrechnung');
  const plansInSheet = ws.filter((r) => r[0]?.v === 'A' || r[0]?.v === 'B').map((r) => r[0]?.v);
  expect(plansInSheet).toEqual(['A', 'B']);
});

test('Ohne Aufteilung: je Plan ein Aufmaß, durchnummeriert, umbenennbar über ⋮', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Aufmaß je Plan');
  await importPlan(page, '1');
  await measure(page, 0.2, '2', '1');
  await backToList(page);
  await importPlan(page, '2');
  await backToList(page);
  // Option nur bei Projekten ohne Pläne
  await expect(page.getByTestId('split-invoices')).toHaveCount(0);

  const blocks = page.getByTestId('aufmass-block');
  await expect(blocks).toHaveCount(2);
  await expect(blocks.getByTestId('aufmass-name')).toHaveText(['Aufmaß 1', 'Aufmaß 2']);
  // Liste zugeklappt: nur Name, Plan, Anzahl und Fläche; Messungen erst nach Antippen
  await expect(page.getByTestId('aufmass-section').getByTestId('aufmass-table')).toHaveCount(0);
  await expect(blocks.nth(0)).toContainText('1 Messung · 2,00 m²');
  await expect(blocks.nth(1)).toContainText('0 Messungen');
  await blocks.nth(0).getByTestId('aufmass-toggle').click();
  await expect(blocks.nth(0).getByTestId('aufmass-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(blocks.nth(0).getByTestId('aufmass-table').locator('tbody tr')).toHaveCount(1);
  await expect(blocks.nth(1).getByTestId('aufmass-table')).toHaveCount(0);
  await blocks.nth(1).getByTestId('aufmass-toggle').click();
  await expect(blocks.nth(1)).toContainText('Noch keine Messungen');
  await blocks.nth(0).getByTestId('aufmass-toggle').click(); // wieder zu
  await expect(blocks.nth(0).getByTestId('aufmass-table')).toHaveCount(0);

  await blocks.nth(1).getByTestId('aufmass-actions').click();
  await page.getByTestId('aufmass-rename').click();
  const dlg = page.getByTestId('prompt-dialog');
  await dlg.locator('input').fill('Keller Nord');
  await dlg.getByRole('button', { name: 'Speichern' }).click();
  await expect(blocks.getByTestId('aufmass-name')).toHaveText(['Aufmaß 1', 'Keller Nord']);
  await waitSaved(page);
  await page.reload();
  await expect(page.getByTestId('aufmass-block').getByTestId('aufmass-name')).toHaveText(['Aufmaß 1', 'Keller Nord']);

  // wieder durchnummerieren
  await page.getByTestId('aufmass-block').nth(1).getByTestId('aufmass-actions').click();
  await page.getByTestId('aufmass-renumber').click();
  await expect(page.getByTestId('aufmass-block').getByTestId('aufmass-name')).toHaveText(['Aufmaß 1', 'Aufmaß 2']);

  // Excel nur dieses Aufmaßes
  await page.getByTestId('aufmass-block').nth(0).getByTestId('aufmass-actions').click();
  await page.getByTestId('aufmass-excel').click();
  await expect(page.getByTestId('excel-export')).toBeVisible();
});
