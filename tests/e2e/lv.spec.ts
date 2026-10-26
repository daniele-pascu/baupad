import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { catchDownload, createProject, drawRect, FIXTURES, freshStart, planBox, readXlsx, readXlsxPrint, saveDownload, waitForPlan, waitSaved, pickTool } from './helpers';

/** Phase 4: LV/MFK aus PDF importieren, prüfen, durchsuchen, Messungen zuordnen, Mengen. */
test('LV importieren, Prüfansicht, Suche, Messungen zuordnen und Aufmaßmengen', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'LV-Test', {}, ['Garage']);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('P-1');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  await page.getByRole('link', { name: 'Zurück zur Planliste' }).click();

  // Import mit Prüfansicht
  await page.getByTestId('tab-lv').click();
  await page.getByTestId('lv-file-input').setInputFiles(join(FIXTURES, 'lv-beispiel.pdf'));
  const review = page.getByTestId('lv-review');
  await expect(review.getByTestId('lv-review-summary')).toContainText('4 Positionen');
  await expect(review.getByTestId('lv-review-summary')).toContainText('6.010,00 €');
  await expect(review.getByTestId('lv-review-summary')).toContainText('alle 2 Gruppensummen stimmen');
  await expect(review.getByTestId('lv-review-summary')).toContainText('1 Position(en) mit unsicheren Angaben');
  await expect(review.getByTestId('lv-name')).toHaveValue('Sanierung Tiefgarage Musterstrasse');
  await review.getByTestId('lv-review-save').click();
  await expect(page.getByTestId('lv-row')).toHaveCount(4);
  await expect(page.getByTestId('lv-flagged')).toContainText('1 Position');

  // Suche
  await page.getByTestId('lv-search').fill('sperr');
  await expect(page.getByTestId('lv-row')).toHaveCount(1);
  await page.getByTestId('lv-search').fill('');

  // Unsichere Position prüfen und bestätigen
  await page.locator('[data-testid="lv-row"][data-number="92 01 01 C"]').click();
  await page.getByTestId('lv-edit-position').click();
  await page.getByTestId('position-dialog').getByTestId('pos-save').click();
  await expect(page.getByTestId('lv-flagged')).toHaveCount(0);

  // Messungen im Plan den Positionen zuordnen
  await page.getByRole('tab', { name: /Liste/ }).click();
  await page.getByTestId('plan-open').first().click();
  await waitForPlan(page);
  const box = await planBox(page);
  const dlg = page.getByTestId('damage-dialog');
  await expect(page.getByTestId('current-position')).toContainText('ohne Leistungszuordnung');
  await pickTool(page, 'tool-rect');
  await drawRect(page, box.x + box.width * 0.2, box.y + box.height * 0.3, box.x + box.width * 0.35, box.y + box.height * 0.45);
  await dlg.getByTestId('input-length').fill('4');
  await dlg.getByTestId('input-width').fill('2,5');
  await dlg.getByTestId('input-position').selectOption({ label: '92 01 01 B Sperrflaeche (m²)' });
  await dlg.getByTestId('damage-save').click();
  await expect(page.locator('[data-testid="aufmass-row"][data-number="1"] [data-testid="row-position"]')).toHaveText('92 01 01 B');
  await expect(page.getByTestId('current-position')).toContainText('92 01 01 B');
  await pickTool(page, 'tool-line');
  await drawRect(page, box.x + box.width * 0.5, box.y + box.height * 0.3, box.x + box.width * 0.7, box.y + box.height * 0.35);
  await dlg.getByTestId('input-length').fill('12');
  // Zuletzt gewählte Leistung wird für die nächste Messung übernommen und im Plan angezeigt
  await expect(dlg.getByTestId('input-position').locator('option:checked')).toHaveText('92 01 01 B Sperrflaeche (m²)');
  await dlg.getByTestId('input-position').selectOption({ label: '92 01 01 A Linienmarkierung weiss (m)' });
  await dlg.getByTestId('damage-save').click();
  await waitSaved(page);
  await expect(page.getByTestId('current-position')).toContainText('92 01 01 A');
  // „Ohne Leistungszuordnung“ bleibt ebenfalls bis zur nächsten Änderung aktiv
  await page.getByRole('button', { name: 'Leistungszuordnung für neue Messungen aufheben' }).click();
  await expect(page.getByTestId('current-position')).toContainText('ohne Leistungszuordnung');
  await pickTool(page, 'tool-rect');
  await drawRect(page, box.x + box.width * 0.6, box.y + box.height * 0.6, box.x + box.width * 0.7, box.y + box.height * 0.7);
  await expect(dlg.getByTestId('input-position')).toHaveValue('');
  await dlg.getByTestId('damage-cancel').click();

  // Planliste zeigt die Leistungen, LV die Aufmaßmengen: 10 m² × 25 € + 12 m × 3 € = 286 €
  await page.getByRole('link', { name: 'Zurück zur Planliste' }).click();
  await expect(page.getByTestId('plan-services')).toContainText('92 01 01 A');
  await expect(page.getByTestId('plan-services')).toContainText('92 01 01 B');
  await page.getByTestId('tab-lv').click();
  await expect(page.locator('[data-testid="lv-row"][data-number="92 01 01 B"] [data-testid="lv-measured"]')).toHaveText('10,00');
  await expect(page.locator('[data-testid="lv-row"][data-number="92 01 01 A"] [data-testid="lv-measured"]')).toHaveText('12,00');
  await expect(page.getByTestId('lv-measured-total')).toHaveText('286,00 €');

  // Excel: LV-Auswertung mit LV-Menge und Aufmaß-Menge getrennt, Beträge als Formeln
  const dl = await catchDownload(page, () => page.getByTestId('export-xlsx-cc').click());
  const file = await saveDownload(dl, 'lv-auswertung.xlsx');
  const wb = readXlsx(file);
  const lvName = Object.keys(wb).find((n) => n.startsWith('LV '))!;
  expect(lvName).toBeTruthy();
  const lv = wb[lvName];
  expect(lv[0][0]?.v).toMatch(/^LV-Abgleich – /);
  expect(lv[2].map((c) => c?.v)).toEqual(['Pos.', 'Kurztext', 'EH', 'LV-Menge', 'Aufmaß-Menge', 'Differenz', 'EP (€)', 'GP LV (€)', 'GP Aufmaß (€)', 'Hinweis']);
  const b = lv.find((r) => r[0]?.v === '92 01 01 B')!;
  const rowNo = lv.indexOf(b) + 1;
  expect(b.slice(0, 9).map((c) => c?.v ?? null)).toEqual(['92 01 01 B', 'Sperrflaeche', 'm²', 120, 10, `=E${rowNo}-D${rowNo}`, 25, 3000, `=E${rowNo}*G${rowNo}`]);
  const c = lv.find((r) => r[0]?.v === '01 11 01 C')!;
  expect(c[4]?.v ?? null).toBeNull(); // keine Messung → keine erfundene Menge
  expect(readXlsxPrint(file)[lvName]).toMatchObject({ orientation: 'landscape', fitToWidth: 1, titleRows: '$1:$3' });
  // Übersicht: Zusammenfassung je Leistung mit Menge aus dem Blatt „Aufmaß“
  const ov = wb['Übersicht'];
  const ovB = ov.find((r) => r[0]?.v === '92 01 01 B')!;
  expect(ovB.slice(1, 3).map((c) => c?.v)).toEqual(['Sperrflaeche', 'm²']);
  expect(String(ovB[3]?.v)).toMatch(/^='Aufmaß'!E\d+$/);
  expect(Object.keys(wb)).not.toContain('Ohne Leistung'); // alle Messungen zugeordnet

  // Nach dem Neuladen bleibt alles erhalten
  await page.reload();
  await page.getByTestId('tab-lv').click();
  await expect(page.getByTestId('lv-row')).toHaveCount(4);
  await expect(page.getByTestId('lv-measured-total')).toHaveText('286,00 €');
  await page.screenshot({ path: join(process.cwd(), 'tests', 'output', 'lv-pc.png'), fullPage: true });

  // Freie Messungen (ohne Leistung): eine Fläche und eine Linie
  await page.getByRole('tab', { name: /Liste/ }).click();
  await page.getByTestId('plan-open').first().click();
  await waitForPlan(page);
  await expect(page.getByTestId('current-position')).toContainText('ohne Leistungszuordnung');
  await pickTool(page, 'tool-rect');
  await drawRect(page, box.x + box.width * 0.6, box.y + box.height * 0.6, box.x + box.width * 0.7, box.y + box.height * 0.7);
  await dlg.getByTestId('input-length').fill('3');
  await dlg.getByTestId('input-width').fill('2');
  await dlg.getByTestId('damage-save').click();
  await pickTool(page, 'tool-line');
  await drawRect(page, box.x + box.width * 0.2, box.y + box.height * 0.8, box.x + box.width * 0.4, box.y + box.height * 0.85);
  await dlg.getByTestId('input-length').fill('5,5');
  await dlg.getByTestId('damage-save').click();
  await waitSaved(page);
  await page.getByRole('link', { name: 'Zurück zur Planliste' }).click();

  // Excel nach Leistungen: Übersicht, je Position ein Blatt, freie Messungen getrennt
  const dl2 = await catchDownload(page, () => page.getByTestId('export-xlsx-positions').click());
  const file2 = await saveDownload(dl2, 'nach-leistungen.xlsx');
  const wb2 = readXlsx(file2);
  expect(Object.keys(wb2)).toEqual(['Leistungen', 'Pos 92 01 01 A', 'Pos 92 01 01 B', 'Freie Messungen', 'Projektdaten']);
  const sum = wb2['Leistungen'];
  expect(sum[1].map((c) => c?.v)).toEqual(['Pos.-Nr.', 'Kurztext', 'LV / MFK', 'EH', 'Messungen', 'Menge', 'EP (€)', 'Betrag (€)', 'Blatt']);
  const sb = sum.find((r) => r[0]?.v === '92 01 01 B')!;
  const sr = sum.indexOf(sb) + 1;
  expect([sb[3]?.v, sb[4]?.v, sb[5]?.v, sb[6]?.v, sb[7]?.v]).toEqual(['m²', 1, "='Pos 92 01 01 B'!G7", 25, `=F${sr}*G${sr}`]);
  const posB = wb2['Pos 92 01 01 B'];
  expect(posB[0][0]?.v).toMatch(/^Pos\. 92 01 01 B – /);
  expect(posB[3].map((c) => c?.v)).toEqual(['Plan', 'Nr.', 'Messart', 'Länge (m)', 'Breite (m)', 'Tiefe (m)', 'Menge (m²)', 'Hinweis']);
  expect(posB[4].slice(0, 7).map((c) => c?.v ?? null)).toEqual(['P-1', 1, 'Schadstelle', 4, 2.5, null, 10]);
  expect(posB[6].slice(0, 7).map((c) => c?.v ?? null)).toEqual(['Summe Menge (m²)', null, null, null, null, null, '=SUM(G5:G5)']);
  expect(posB[7][6]?.v).toBe(25);
  expect(posB[8][6]?.v).toBe('=G7*G8');
  const posA = wb2['Pos 92 01 01 A'];
  expect(posA[4][6]?.v).toBe(12); // Linie in m
  const free = wb2['Freie Messungen'];
  expect(free.slice(2, 4).map((r) => [r[2]?.v, r[3]?.v, r[6]?.v ?? null])).toEqual([['Schadstelle', 3, 6], ['Linie', 5.5, null]]);
  expect(free.find((r) => r[0]?.v === 'Summe Fläche (m²)')![6]?.v).toBe('=SUM(G3:G4)');
  expect(free.find((r) => r[0]?.v === 'Summe Länge Linien (m)')![3]?.v).toBe('=SUMIF(C3:C4,"Linie",D3:D4)');
  const pr = readXlsxPrint(file2);
  expect(pr['Pos 92 01 01 B']).toMatchObject({ orientation: 'landscape', fitToWidth: 1, titleRows: '$1:$4' });
  expect(pr['Leistungen']).toMatchObject({ orientation: 'landscape', titleRows: '$1:$2' });
});
