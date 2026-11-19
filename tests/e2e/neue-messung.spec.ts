import { expect, test } from './fixtures';
import { createProject, freshStart } from './helpers';

/**
 * Aufmaß „Neue Messung“: zuerst den Bereich wählen – Position (Messart kommt aus der Einheit bzw. der
 * Betoninstandsetzungs-Regel, alle neuen Messungen zählen dort) oder frei (Messart selbst wählen).
 */
test('Neue Messung: Position wählen stellt Messart und Bereich ein; frei öffnet die Messarten', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Bereiche', {}, ['EG']);
  // LV von Hand: Fläche (m²), Länge (lfm), Stück
  await page.getByTestId('lv-new').click();
  const ld = page.getByTestId('lv-doc-dialog');
  await ld.getByTestId('lv-doc-name').fill('Sanierung');
  await ld.getByTestId('lv-doc-name').press('Enter');
  const grid = ld.getByTestId('lv-grid-row');
  for (const [i, [no, text, unit]] of [['01', 'Beschichtung Boden', 'm²'], ['02', 'Rissverpressung', 'lfm'], ['03', 'Bohrung', 'Stk']].entries()) {
    await expect(grid).toHaveCount(i + 1);
    await grid.nth(i).getByTestId('grid-number').fill(no);
    await grid.nth(i).getByTestId('grid-shortText').fill(text);
    await grid.nth(i).getByTestId('grid-unit').fill(unit);
    await grid.nth(i).getByTestId('grid-unit').press('Enter');
  }
  await ld.getByTestId('lv-doc-save').click();
  await expect(ld).toBeHidden();
  await page.getByTestId('draw-plan').click();
  await page.getByTestId('new-drawing').locator('[data-field="planNumber"]').fill('B-1');
  await page.getByTestId('new-drawing-save').click();
  await page.getByTestId('mode-measure').click();

  // „Neue Messung“ in der Messleiste: frei + drei Positionen mit passender Messart
  await page.getByTestId('new-measure').click();
  const nd = page.getByTestId('new-measure-dialog');
  await expect(nd.getByTestId('new-measure-pos')).toHaveCount(3);
  await expect(nd.getByTestId('new-measure-type')).toHaveText([/Fläche/, /Länge/, /Stück/]);
  await nd.getByTestId('new-measure-pos').filter({ hasText: 'Rissverpressung' }).click();
  await expect(nd).toHaveCount(0);
  await expect(page.getByTestId('tool-mtype')).toHaveAttribute('data-value', 'laenge');
  await expect(page.getByTestId('current-position')).toContainText('02');
  // Hinweis „Neue Messungen“ antippen: dieselbe Auswahl, jetzt Fläche
  await page.getByTestId('current-position-pick').click();
  await nd.getByTestId('new-measure-pos').filter({ hasText: 'Beschichtung' }).click();
  await expect(page.getByTestId('tool-mtype')).toHaveAttribute('data-value', 'flaeche');
  await expect(page.getByTestId('current-position')).toContainText('01');
  // frei: ohne Position, Messart selbst wählen
  await page.getByTestId('new-measure').click();
  await nd.getByTestId('new-measure-free').click();
  await expect(page.getByTestId('current-position')).toContainText('ohne Leistungszuordnung');
  await expect(page.getByTestId('mtype-menu')).toBeVisible();
});
