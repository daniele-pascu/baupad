import { expect, test } from './fixtures';
import { freshStart } from './helpers';

/** Materialverwaltung (Teil 1): Kachel, Lieferanten, Materialstamm, Warnung bei Dubletten, Suche, Bearbeiten, Löschen */
test('Materialverwaltung: Lieferant und Materialien anlegen, Dublette melden, suchen, ändern, löschen', async ({ page }) => {
  await freshStart(page);
  await page.goto('./baupad/tools');
  await page.getByTestId('tool-materials').click();
  await expect(page.getByTestId('materials-title')).toHaveText('Materialverwaltung');
  await expect(page.getByTestId('materials-empty')).toBeVisible();

  // Lieferant
  await page.getByTestId('mat-tab-suppliers').click();
  await expect(page).toHaveURL(/materialverwaltung\?t=lieferanten/);
  await page.getByTestId('supplier-new').click();
  const sd = page.getByTestId('supplier-dialog');
  await sd.getByTestId('supplier-name').fill('Baustoff Muster GmbH');
  await sd.getByTestId('supplier-phone').fill('0732 1234');
  await sd.getByTestId('supplier-save').click();
  await expect(page.getByTestId('supplier-row')).toHaveCount(1);
  // gleicher Lieferant nochmal → Hinweis, Abbrechen
  await page.getByTestId('supplier-new').click();
  await sd.getByTestId('supplier-name').fill('baustoff muster');
  await expect(sd.getByTestId('supplier-duplicate')).toContainText('Baustoff Muster GmbH ist schon hinterlegt');
  await sd.getByRole('button', { name: 'Abbrechen' }).click();

  // Materialien
  await page.getByTestId('mat-tab-materials').click();
  const add = async (name: string, unit: string, price: string, art = '') => {
    await page.getByTestId('material-new').click();
    const d = page.getByTestId('material-dialog');
    await d.getByTestId('material-name').fill(name);
    if (art) await d.getByTestId('material-articleNo').fill(art);
    await d.getByTestId('material-unit').selectOption(unit);
    await d.getByTestId('material-price').fill(price);
    await d.getByTestId('material-supplier').selectOption({ label: 'Baustoff Muster GmbH' });
    await d.getByTestId('material-save').click();
    await expect(d).toHaveCount(0);
  };
  await add('Zementestrich CT-C25', 'm²', '18,90', 'Z-100');
  await add('Kabelbinder 300 mm', 'Stk', '0,12');
  await expect(page.getByTestId('material-row')).toHaveCount(2);
  await expect(page.getByTestId('material-row').first()).toContainText('Kabelbinder 300 mm'); // alphabetisch
  await expect(page.locator('[data-testid="material-row"][data-name="Zementestrich CT-C25"]')).toContainText('Art.-Nr. Z-100 · m² · 18,90 € / m² · Baustoff Muster GmbH');

  // Dublette: gleicher Name, andere Schreibweise → Hinweis und Rückfrage; Abbrechen legt nichts an
  await page.getByTestId('material-new').click();
  const d = page.getByTestId('material-dialog');
  await d.getByTestId('material-name').fill('zementestrich ct c25');
  await d.getByTestId('material-unit').selectOption('m²');
  await expect(d.getByTestId('material-duplicate')).toContainText('„Zementestrich CT-C25“ (m²) ist schon hinterlegt');
  await d.getByTestId('material-save').click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('Trotzdem als weiteres Material anlegen?');
  await page.getByTestId('confirm-dialog').getByRole('button', { name: 'Abbrechen' }).click();
  await d.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(page.getByTestId('material-row')).toHaveCount(2);

  // Suche nach Artikelnummer, Lieferant
  await page.getByTestId('materials-search').fill('z100');
  await expect(page.getByTestId('material-row')).toHaveCount(1);
  await page.getByTestId('materials-search').fill('muster');
  await expect(page.getByTestId('material-row')).toHaveCount(2);
  await page.getByTestId('materials-search').fill('');

  // Ändern und nach dem Neuladen noch da
  await page.locator('[data-testid="material-row"][data-name="Kabelbinder 300 mm"]').getByTestId('material-open').click();
  await d.getByTestId('material-price').fill('0,15');
  await d.getByTestId('material-save').click();
  await page.reload();
  await expect(page.locator('[data-testid="material-row"][data-name="Kabelbinder 300 mm"]')).toContainText('0,15 € / Stk');

  // Lieferant löschen → Materialien bleiben, ohne Lieferant
  await page.getByTestId('mat-tab-suppliers').click();
  await expect(page.getByTestId('supplier-row')).toContainText('2 Materialien');
  await page.getByTestId('supplier-open').click();
  await page.getByTestId('supplier-delete').click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('2 Material(ien) bleiben erhalten');
  await page.getByTestId('confirm-dialog').getByRole('button', { name: 'Löschen' }).click();
  await expect(page.getByTestId('suppliers-empty')).toBeVisible();
  await page.getByTestId('mat-tab-materials').click();
  await expect(page.getByTestId('material-row')).toHaveCount(2);
  await expect(page.getByTestId('material-list')).not.toContainText('Baustoff Muster');

  // Material löschen
  await page.locator('[data-testid="material-row"][data-name="Kabelbinder 300 mm"]').getByTestId('material-open').click();
  await d.getByTestId('material-delete').click();
  await page.getByTestId('confirm-dialog').getByRole('button', { name: 'Löschen' }).click();
  await expect(page.getByTestId('material-row')).toHaveCount(1);
});
