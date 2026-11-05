import { expect, test } from './fixtures';
import { createProject, freshStart } from './helpers';

/** Materialverwaltung (Teil 1): Kachel, Lieferanten, Materialstamm, Warnung bei Dubletten, Suche, Bearbeiten, Löschen */
test('Materialverwaltung: Lieferant und Materialien anlegen, Dublette melden, suchen, ändern, löschen', async ({ page }) => {
  await freshStart(page);
  await page.goto('./baupad/tools');
  await page.getByTestId('tool-materials').click();
  await expect(page.getByTestId('materials-title')).toHaveText('Materialverwaltung');
  await expect(page.getByTestId('material-sites-empty')).toBeVisible(); // erster Bereich: Baustellen
  await page.getByTestId('mat-tab-materials').click();
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
  await expect(d).toHaveCount(0);
  await expect(page.locator('[data-testid="material-row"][data-name="Kabelbinder 300 mm"]')).toContainText('0,15 € / Stk');
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

test('Materialliste je Baustelle: aus dem Materialstamm, gleiches Material wird dazugerechnet, bestellt → geliefert mit Verlauf', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Wohnanlage Sonnenhof', { number: '2026-04' });
  await page.goto('./baupad/materialverwaltung?t=material');
  await page.getByTestId('material-new').click();
  const md = page.getByTestId('material-dialog');
  await md.getByTestId('material-name').fill('Zementestrich CT-C25');
  await md.getByTestId('material-unit').selectOption('m²');
  await md.getByTestId('material-price').fill('18,90');
  await md.getByTestId('material-save').click();
  await expect(md).toHaveCount(0);

  await page.getByTestId('mat-tab-sites').click();
  await expect(page.getByTestId('material-site')).toContainText('Noch keine Materialliste');
  await page.getByTestId('material-site-open').click();
  await expect(page.getByTestId('material-site-title')).toHaveText('2026-04 · Wohnanlage Sonnenhof');
  await expect(page.getByTestId('items-empty')).toBeVisible();

  const add = async (qty: string) => {
    await page.getByTestId('item-new').click();
    const d = page.getByTestId('item-dialog');
    await d.getByTestId('item-search').fill('estrich');
    await d.getByTestId('item-material').selectOption({ index: 1 });
    await expect(d.getByTestId('item-name')).toHaveValue('Zementestrich CT-C25');
    await expect(d.getByTestId('item-price')).toHaveValue('18,9');
    await d.getByTestId('item-qty').fill(qty);
    await d.getByTestId('item-date').fill('2026-11-20');
    await d.getByTestId('item-save').click();
  };
  await add('20');
  await expect(page.getByTestId('item-row')).toHaveCount(1);
  await expect(page.getByTestId('item-row')).toContainText('20 m² Zementestrich CT-C25');
  await expect(page.getByTestId('item-row')).toContainText('Liefertermin 20.11.2026');
  await expect(page.getByTestId('material-site-summary')).toContainText('1 offen · 0 bestellt · 0 geliefert · 378,00 € netto');

  // gleiches Material nochmal → Rückfrage, Menge wird dazugerechnet statt doppelt
  await add('10');
  await expect(page.getByTestId('confirm-dialog')).toContainText('steht schon auf der Liste (Offen, 20 m²). Menge 10 m² dazurechnen?');
  await page.getByTestId('confirm-dialog').getByRole('button', { name: 'Dazurechnen' }).click();
  await expect(page.getByTestId('item-row')).toHaveCount(1);
  await expect(page.getByTestId('item-row')).toContainText('30 m² Zementestrich');

  // bestellt → geliefert
  await page.getByTestId('item-advance').click();
  await expect(page.getByTestId('item-row')).toHaveAttribute('data-status', 'bestellt');
  await page.getByTestId('item-advance').click();
  await expect(page.getByTestId('item-row')).toHaveAttribute('data-status', 'geliefert');
  await expect(page.getByTestId('item-advance')).toHaveCount(0);
  await expect(page.getByTestId('material-site-summary')).toContainText('0 offen · 0 bestellt · 1 geliefert');

  // Verlauf mit Namen
  await page.getByTestId('item-open').click();
  const h = page.getByTestId('item-history');
  await expect(h.locator('li')).toHaveCount(4);
  await expect(h.locator('li').nth(0)).toContainText('Test Nutzer: Geliefert');
  await expect(h.locator('li').nth(2)).toContainText('Menge +10 → 30 m²');
  await page.getByTestId('item-dialog').getByRole('button', { name: 'Abbrechen' }).click();

  // nach dem Neuladen und in der Übersicht
  await page.reload();
  await expect(page.getByTestId('item-row')).toHaveCount(1);
  await page.getByTestId('material-site-back').click();
  await expect(page.getByTestId('material-site')).toContainText('1 geliefert');
});
