import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { catchDownload, createProject, drawRect, FIXTURES, freshStart, OUT, planBox, readXlsx, readXlsxPrint, saveDownload, waitForPlan, waitSaved, pickTool } from './helpers';

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
  await expect(page.locator('[data-testid="lv-row"][data-number="92 01 01 B"] [data-testid="lv-measured"]')).toHaveText('10,00');
  await expect(page.locator('[data-testid="lv-row"][data-number="92 01 01 A"] [data-testid="lv-measured"]')).toHaveText('12,00');
  await expect(page.getByTestId('lv-measured-total')).toHaveText('286,00 €');

  // Nach dem Neuladen bleibt alles erhalten
  await page.reload();
  await expect(page.getByTestId('lv-row')).toHaveCount(4);
  await expect(page.getByTestId('lv-measured-total')).toHaveText('286,00 €');
  await page.screenshot({ path: join(process.cwd(), 'tests', 'output', 'lv-pc.png'), fullPage: true });

  // Freie Messungen (ohne Leistung): eine Fläche und eine Linie
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

  // Aufmaßblatt nach Firmenvorlage: Nummer automatisch, je LV die Positionen mit Tabelle nach Einheit,
  // Zusammenstellung (EUR), Gesamtpreis; Messungen ohne Position mit Plan und Nr.
  await page.getByTestId('export-xlsx-cc').click();
  const ex = page.getByTestId('excel-export');
  await expect(ex.getByTestId('blatt-no')).toHaveValue('001');
  await expect(ex.getByTestId('blatt-period')).toHaveValue(/\d{2}\.\d{2}\.\d{4}/);
  const dl3 = await catchDownload(page, () => ex.getByTestId('blatt-export').click());
  expect(dl3.suggestedFilename()).toMatch(/Aufmassblatt_001\.xlsx$/);
  const file3 = await saveDownload(dl3, 'aufmassblatt.xlsx');
  const ws = readXlsx(file3)['Aufmaßblatt 001'];
  const v = (r: number, c: number) => ws[r]?.[c]?.v ?? null;
  const rowOf = (text: string, col = 0) => ws.findIndex((r) => r[col]?.v === text);
  expect(v(0, 0)).toBe('Aufmaßblatt 001');
  expect([v(2, 0), v(2, 2)]).toEqual(['Bauvorhaben', 'LV-Test']);
  expect([v(3, 0), v(3, 2)]).toEqual(['Kostenstelle', 'Garage']);
  expect(v(4, 0)).toBe('Leistungszeitraum');
  expect(String(v(6, 0))).toMatch(/^LV - .*Sanierung Tiefgarage Musterstrasse/);
  expect(ws[8].map((c) => c?.v ?? null).filter(Boolean)).toEqual(['Pos. / Positionstext', 'Menge', 'EH', 'Einheitspreis', 'Positionspreis']);
  // Position B (m²): Menge = Summe der Tabelle, Positionspreis = EP × Menge
  const pb = rowOf('92 01 01 B');
  expect(v(pb, 2)).toBe('   Sperrflaeche'); // eingerückt wie in der Vorlage
  const q = ws[pb + 1];
  expect([q[3]?.v, q[4]?.v, q[5]?.v, q[6]?.v, q[7]?.v]).toEqual(['m²', 25, '€', `=E${pb + 2}*C${pb + 2}`, '€']);
  const th = pb + 3;
  expect(ws[th].map((c) => c?.v ?? null).filter((x) => x !== null)).toEqual(['Plan', 'Nr.', 'Länge', 'Breite', 'm²']); // ohne Bemerkung keine Spalte „Bemerkung“
  expect(ws[th + 1].slice(0, 5).map((c) => c?.v ?? null)).toEqual(['P-1', 1, 4, 2.5, `=C${th + 2}*D${th + 2}`]);
  expect(ws[th + 2].slice(4, 6).map((c) => c?.v ?? null)).toEqual([`=SUM(E${th + 2}:E${th + 2})`, 'm²']);
  expect(q[2]?.v).toBe(`=E${th + 3}`); // Menge verweist auf die Summe
  // Position A (m): Plan | Nr. | m
  const pa = rowOf('92 01 01 A');
  expect(ws[pa + 3].map((c) => c?.v ?? null).filter((x) => x !== null)).toEqual(['Plan', 'Nr.', 'm']);
  expect(ws[pa + 4].slice(0, 3).map((c) => c?.v ?? null)).toEqual(['P-1', 2, 12]);
  // Zusammenstellung und Gesamtpreis (Formeln)
  const boxRow = rowOf('Zusammenstellung (EUR)');
  expect(boxRow).toBeGreaterThan(pb);
  const total = ws.find((r) => r[4]?.v === 'Gesamtpreis in EUR')!;
  expect(String(total[6]?.v)).toMatch(/^=G\d+\+G\d+$/);
  // ohne Position: Fläche und Linie mit Plan und Nr.
  const free3 = rowOf('Aufmaß ohne Leistungsposition');
  expect(free3).toBeGreaterThan(boxRow);
  expect(ws.slice(free3).some((r) => r[0]?.v === 'P-1' && r[2]?.v === 3 && r[3]?.v === 2)).toBe(true);
  expect(ws.slice(free3).some((r) => r[0]?.v === 'P-1' && r[2]?.v === 5.5)).toBe(true);
  // Druck: Kopfzeile wie Vorlage (rechts „Seite von Seiten“), Seitenbreite
  // jede LV/MFK und das Aufmaß ohne Position auf einer eigenen Seite (Umbruch vor der Zeile), Zoom statt „an Seite anpassen“
  const pr3 = readXlsxPrint(file3)['Aufmaßblatt 001'];
  expect(pr3).toMatchObject({ orientation: 'portrait', fitToPage: false, rowBreaks: [free3 + 1] });
  expect(pr3.scale).toBeLessThanOrEqual(100);
  execFileSync('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', join(OUT, 'blatt-pdf'), file3], { timeout: 90_000 });
  const pdf3 = join(OUT, 'blatt-pdf', 'aufmassblatt.pdf');
  expect(execFileSync('pdfinfo', [pdf3], { encoding: 'utf8' })).toMatch(/Pages:\s+2\n/);
  const page2 = execFileSync('pdftotext', ['-f', '2', '-l', '2', pdf3, '-'], { encoding: 'utf8' });
  expect(page2).toContain('Aufmaß ohne Leistungsposition');
  expect(page2).not.toContain('LV - ');
  expect(readXlsxPrint(file3)['Aufmaßblatt 001'].header.right).toBe('&P von &N');
  // nächste Nummer wird hochgezählt
  await page.getByTestId('export-xlsx-cc').click();
  await expect(page.getByTestId('excel-export').getByTestId('blatt-no')).toHaveValue('002');
  await page.getByTestId('excel-export').getByRole('button', { name: 'Abbrechen' }).click();
});

test('Kurz-LV (eine Zeile je Position, Punkt-Nummern) importieren: alle Positionen, Summe wie im Dokument', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Kurz-LV', {}, ['Garage']);
  await page.getByTestId('lv-file-input').setInputFiles(join(FIXTURES, 'kurz-lv.pdf'));
  const review = page.getByTestId('lv-review');
  const summary = review.getByTestId('lv-review-summary');
  await expect(summary).toContainText('8 Positionen');
  await expect(summary).toContainText('23.663,67 €');
  await expect(review.getByTestId('lv-total-check')).toContainText('Summe stimmt mit dem Dokument überein');
  await expect(summary).not.toContainText('unsicheren Angaben');
  await expect(review.getByTestId('lv-name')).toHaveValue('Musterarbeiten Tiefgarage');
  await review.getByTestId('lv-review-save').click();
  await expect(page.getByTestId('lv-row')).toHaveCount(8);
  await expect(page.getByTestId('lv-flagged')).toHaveCount(0);
  // Punkt-Nummern, Wahlposition ohne GP, Pauschale ohne Nummer
  const row = (n: string) => page.locator(`[data-testid="lv-row"][data-number="${n}"]`);
  await expect(row('01.11.21.07C.')).toContainText('Untergrund aufrauen');
  await expect(row('02.14.80.90A.')).toContainText('Sandstrahlen');
  await expect(row('o. Nr. 1')).toContainText('Baustelle einrichten');
  await expect(row('S1.12.14.85.03A.2')).toContainText('kg');
  // bleibt nach dem Neuladen erhalten
  await page.reload();
  await expect(page.getByTestId('lv-row')).toHaveCount(8);
});

test('MFK mit Punkt-Nummern und EP-Zeile importieren: als MFK samt Nummer erkannt, Gruppen- und Gesamtsumme stimmen', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'MFK-Import', {}, ['Halle']);
  await page.getByTestId('lv-file-input').setInputFiles(join(FIXTURES, 'mfk-beispiel.pdf'));
  const review = page.getByTestId('lv-review');
  const summary = review.getByTestId('lv-review-summary');
  await expect(summary).toContainText('5 Positionen');
  await expect(summary).toContainText('12.345,00 €');
  await expect(summary).toContainText('alle 2 Gruppensummen stimmen');
  await expect(review.getByTestId('lv-total-check')).toContainText('Summe stimmt mit dem Dokument überein');
  await expect(summary).not.toContainText('unsicheren Angaben');
  await expect(review.getByTestId('lv-kind')).toHaveValue('mfk');
  await expect(review.getByTestId('lv-number')).toHaveValue('M9-001');
  await expect(review.getByTestId('lv-name')).toHaveValue('Musterhalle Beschichtungen'); // Nummer steht im eigenen Feld
  await review.getByTestId('lv-review-save').click();
  await expect(page.getByTestId('lv-row')).toHaveCount(5);
  await expect(page.getByTestId('lv-flagged')).toHaveCount(0);
  const row = (n: string) => page.locator(`[data-testid="lv-row"][data-number="${n}"]`);
  await expect(row('09.12.14.81.38.A')).toContainText('Untergrund schleifen');
  await expect(row('09.12.14.85.01.K.1')).toContainText('Stk');
  // Langtext: Grundtext + eigener Text, ohne Preisanteile
  await row('09.12.14.81.38.A').click();
  await expect(page.locator('.lv-detail')).toContainText('Gilt fuer die folgenden Positionen.');
  await expect(page.locator('.lv-detail')).toContainText('Ueberschleifen des Betonuntergrundes');
  await expect(page.locator('.lv-detail')).not.toContainText('Lohn');
});

test('Projektseite: Pläne, Aufmaß und LV/MFK untereinander; LV steht immer vor den MFKs', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Bereiche', {}, ['Garage']);
  // MFK zuerst hochladen, danach das LV
  for (const f of ['mfk-beispiel.pdf', 'kurz-lv.pdf']) {
    await page.getByTestId('lv-file-input').setInputFiles(join(FIXTURES, f));
    await page.getByTestId('lv-review').getByTestId('lv-review-save').click();
    await expect(page.getByTestId('lv-review')).toBeHidden();
  }
  const docs = page.getByTestId('lv-doc-tab');
  await expect(docs).toHaveCount(2);
  await expect(docs.nth(0)).toContainText('LV');
  await expect(docs.nth(0)).toContainText('Musterarbeiten Tiefgarage');
  await expect(docs.nth(1)).toContainText('MFK');
  await expect(docs.nth(1)).toContainText('M9-001');
  // Reihenfolge der Bereiche: Pläne, Aufmaß, LV/MFK – alle gleichzeitig sichtbar, keine Reiter mehr
  const y = async (sel: string) => (await page.locator(sel).first().boundingBox())!.y;
  const plansY = await y('.plans-title');
  const aufmassY = await y('[data-testid="aufmass-section"]');
  const lvY = await y('[data-testid="lv-section"]');
  expect(plansY).toBeLessThan(aufmassY);
  expect(aufmassY).toBeLessThan(lvY);
  await expect(page.getByTestId('aufmass-empty')).toBeVisible();
  await expect(page.getByTestId('export-xlsx-cc')).toBeVisible();
  await expect(page.locator('[role="tab"]')).toHaveCount(0);
  // auf- und zuklappen
  await docs.nth(1).click();
  await expect(page.getByTestId('lv-row')).toHaveCount(5);
  await docs.nth(1).click();
  await expect(page.getByTestId('lv-row')).toHaveCount(0);
  await docs.nth(0).click();
  await expect(page.getByTestId('lv-row')).toHaveCount(8);
  await page.screenshot({ path: join(OUT, 'projekt-bereiche.png'), fullPage: true });
});
