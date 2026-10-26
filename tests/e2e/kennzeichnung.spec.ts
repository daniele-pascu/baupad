import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { excelExport, catchDownload, createProject, drawRect, FIXTURES, freshStart, planBox, blattRows, readXlsx, saveDownload, waitForPlan, waitSaved, pickTool } from './helpers';

/** Paket D: Nummern und Buchstaben kombinieren, Schema wird fortgesetzt. */
test('Kennzeichnungen A, B, C, „Wand A“ und Zahlen – Fortsetzung, Doppelprüfung, Export', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Kennzeichnung', {}, ['Wand']);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('K-1');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  const box = await planBox(page);
  const dlg = page.getByTestId('damage-dialog');
  let i = 0;
  const draw = async () => {
    const x = box.x + box.width * (0.1 + (i % 5) * 0.15);
    const y = box.y + box.height * (0.15 + Math.floor(i / 5) * 0.3);
    i++;
    await pickTool(page, 'tool-rect'); // nach jeder Messung ist wieder „Auswahl“ aktiv
    await drawRect(page, x, y, x + box.width * 0.08, y + box.height * 0.1);
    await expect(dlg).toBeVisible();
  };
  const save = async (no?: string) => {
    if (no !== undefined) await dlg.getByTestId('input-number').fill(no);
    await dlg.getByTestId('input-length').fill('1');
    await dlg.getByTestId('input-width').fill('1');
    await dlg.getByTestId('damage-save').click();
    await expect(dlg).toBeHidden();
  };
  await pickTool(page, 'tool-rect');

  // Erste Messung: Vorschlag 1, stattdessen „A“
  await draw();
  await expect(dlg.getByTestId('input-number')).toHaveValue('1');
  await save('A');
  // Fortsetzung B, C
  await draw();
  await expect(dlg.getByTestId('input-number')).toHaveValue('B');
  await save();
  await draw();
  await expect(dlg.getByTestId('input-number')).toHaveValue('C');
  // Bereits vergeben → Hinweis, nicht gespeichert
  await dlg.getByTestId('input-number').fill('a');
  await dlg.getByTestId('input-length').fill('1');
  await dlg.getByTestId('input-width').fill('1');
  await dlg.getByTestId('damage-save').click();
  await expect(dlg).toContainText('„a“ ist in diesem Plan bereits vergeben');
  await save('Wand A');
  await draw();
  await expect(dlg.getByTestId('input-number')).toHaveValue('Wand B');
  await save();
  // Nicht eindeutiges Schema → leeres Feld, manuelle Eingabe
  await draw();
  await dlg.getByTestId('input-number').fill('Stütze');
  await save();
  await draw();
  await expect(dlg.getByTestId('input-number')).toHaveValue('');
  // Zurück zu Zahlen: 5 → nächste 6
  await save('5');
  await draw();
  await expect(dlg.getByTestId('input-number')).toHaveValue('6');
  await save();
  await waitSaved(page);

  // Plan und Tabelle zeigen die Kennzeichnungen in der Reihenfolge der Erfassung
  const expected = ['A', 'B', 'Wand A', 'Wand B', 'Stütze', '5', '6'];
  await expect(page.locator('.damage-label text')).toHaveText(expected);
  const order = await page.locator('[data-testid="aufmass-row"]').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-number')));
  expect(order).toEqual(expected);
  await expect(page.locator('[data-testid="aufmass-row"][data-number="Wand B"]')).toContainText('Wand B');

  // Bearbeiten: Kennzeichnung ändern
  await page.locator('[data-testid="aufmass-row"][data-number="B"]').getByRole('button', { name: /bearbeiten/ }).click();
  await expect(dlg).toContainText('Schadstelle B bearbeiten');
  await dlg.getByTestId('input-number').fill('B2');
  await dlg.getByTestId('damage-save').click();
  await expect(page.locator('[data-testid="aufmass-row"][data-number="B2"]')).toHaveCount(1);
  await waitSaved(page);

  // Excel: Spalte „Nr.“ enthält die Kennzeichnungen als Text, Zahlen als Zahl
  const dl = await catchDownload(page, () => excelExport(page, 'export-xlsx-plan'));
  const nos = blattRows(readXlsx(await saveDownload(dl, 'kennzeichnung.xlsx')), 'K-1').map((r) => r.nr);
  expect(new Set(nos)).toEqual(new Set(['A', 'B2', 'Wand A', 'Wand B', 'Stütze', 5, 6]));
});
