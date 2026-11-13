import { expect, test } from './fixtures';
import { createProject, freshStart } from './helpers';

/** Materialverwaltung (Teil 1): Kachel, Lieferanten, Materialstamm, Warnung bei Dubletten, Suche, Bearbeiten, Löschen */
test('Materialverwaltung: Lieferant und Materialien anlegen, Dublette melden, suchen, ändern, löschen', async ({ page }) => {
  await freshStart(page);
  await page.goto('./baupad/tools');
  await page.getByTestId('tool-materials').click();
  await expect(page.getByTestId('materials-title')).toHaveText('Materialverwaltung');
  await expect(page.getByTestId('hub-overview')).toBeVisible(); // erster Bereich: Übersicht
  await page.getByTestId('mat-tab-sites').click();
  await expect(page).toHaveURL(/materialverwaltung\?t=baustellen/);
  await expect(page.getByTestId('material-sites-empty')).toBeVisible();
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

test('Übersicht, Bestellen je Lieferant mit Bestellnummer, Wareneingang und Geräte mit Stückzahl je Baustelle', async ({ page }) => {
  test.setTimeout(120_000);
  await freshStart(page);
  await createProject(page, 'Wohnanlage Sonnenhof', { number: '2026-04', address: 'Hauptstraße 1, 4020 Linz' });
  const today = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const year = today.slice(0, 4);

  // Lieferant mit E-Mail
  await page.goto('./baupad/materialverwaltung?t=lieferanten');
  await page.getByTestId('supplier-new').click();
  const sd = page.getByTestId('supplier-dialog');
  await sd.getByTestId('supplier-name').fill('Baustoff Muster GmbH');
  await sd.getByTestId('supplier-email').fill('bestellung@muster.example');
  await sd.getByTestId('supplier-save').click();
  await expect(page.getByTestId('supplier-row')).toHaveCount(1);

  // Übersicht: noch nichts zu tun
  await page.getByTestId('mat-tab-overview').click();
  await expect(page).toHaveURL(/materialverwaltung$/);
  await expect(page.getByTestId('hub-kpi-open')).toContainText('0');
  await expect(page.getByTestId('hub-next-empty')).toBeVisible();

  // Bedarf melden: Baustelle wählen → Fenster „Material hinzufügen“ ist gleich offen
  const need = async (name: string, qty: string, unit: string, supplier: boolean, date = '') => {
    await page.goto('./baupad/materialverwaltung');
    await page.getByTestId('hub-need').click();
    await page.getByTestId('need-dialog').getByTestId('need-site').click();
    const d = page.getByTestId('item-dialog');
    await expect(d).toBeVisible();
    await d.getByTestId('item-name').fill(name);
    await d.getByTestId('item-unit').selectOption(unit);
    await d.getByTestId('item-qty').fill(qty);
    if (supplier) await d.getByTestId('item-supplier').selectOption({ label: 'Baustoff Muster GmbH' });
    if (date) await d.getByTestId('item-date').fill(date);
    await d.getByTestId('item-save').click();
    await expect(d).toHaveCount(0);
  };
  await need('Reprofiliermörtel R4', '40', 'Sack', true, today);
  await need('Korrosionsschutz 1K', '6', 'Eimer', true);
  await need('Schalöl', '20', 'l', false);
  await expect(page.getByTestId('item-row')).toHaveCount(3);

  // Übersicht zeigt den Bedarf und die Lieferung von heute
  await page.goto('./baupad/materialverwaltung');
  await expect(page.getByTestId('hub-kpi-open')).toContainText('3');
  await expect(page.getByTestId('hub-next-row')).toHaveCount(1);
  await expect(page.getByTestId('hub-next-row')).toContainText('40 Sack Reprofiliermörtel R4');
  await expect(page.getByTestId('hub-next-row')).toContainText('Wohnanlage Sonnenhof · noch nicht bestellt');
  await expect(page.getByTestId('hub-next-row')).toContainText('heute');

  // Bestellungen: je Lieferant, ohne Lieferant zuletzt
  await page.getByTestId('hub-order').click();
  await expect(page).toHaveURL(/t=bestellungen/);
  const groups = page.getByTestId('order-open-group');
  await expect(groups).toHaveCount(2);
  await expect(groups.nth(0)).toHaveAttribute('data-supplier', 'Baustoff Muster GmbH');
  await expect(groups.nth(0).getByTestId('order-line')).toHaveCount(2);
  await expect(groups.nth(1)).toContainText('Ohne Lieferant');
  await expect(page.getByTestId('orders-transit-empty')).toBeVisible();

  // Bestellung mit Nummer: Text für den Lieferanten, E-Mail-Link, als bestellt markieren
  await groups.nth(0).getByTestId('order-create').click();
  const od = page.getByTestId('order-dialog');
  await expect(od).toContainText(`Bestellung B-${year}-001 – Baustoff Muster GmbH`);
  const text = await od.getByTestId('order-text').inputValue();
  expect(text).toContain(`Bestellung B-${year}-001`);
  expect(text).toContain('Baustelle: Wohnanlage Sonnenhof\nLieferadresse: Hauptstraße 1, 4020 Linz');
  expect(text).toContain('- 40 Sack Reprofiliermörtel R4 – Liefertermin ');
  expect(text).toContain('- 6 Eimer Korrosionsschutz 1K');
  expect(text).not.toContain('Schalöl');
  await expect(od.getByTestId('order-mail')).toHaveAttribute('href', new RegExp(`^mailto:bestellung%40muster\\.example\\?subject=Bestellung%20B-${year}-001&body=`));
  await od.getByTestId('order-confirm').click();
  await expect(od).toHaveCount(0);
  await expect(page.getByTestId('order-open-group')).toHaveCount(1); // nur noch „Ohne Lieferant“
  const transit = page.getByTestId('order-transit-group');
  await expect(transit).toHaveCount(1);
  await expect(transit).toHaveAttribute('data-order', `B-${year}-001`);
  await expect(transit.getByTestId('order-line')).toHaveCount(2);

  // nächste Bestellung bekommt die nächste Nummer
  await page.getByTestId('order-open-group').getByTestId('order-create').click();
  await expect(od).toContainText(`Bestellung B-${year}-002`);
  await expect(od.getByTestId('order-mail')).toHaveCount(0); // ohne Lieferant keine E-Mail
  await od.getByRole('button', { name: 'Abbrechen' }).click();

  // Wareneingang: eine Position einzeln, dann der Rest
  await transit.locator('[data-testid="order-line"][data-name="Korrosionsschutz 1K"]').getByTestId('order-delivered').click();
  await expect(transit.getByTestId('order-line')).toHaveCount(1);
  await transit.getByTestId('order-delivered-all').click();
  await expect(page.getByTestId('orders-transit-empty')).toBeVisible();
  await page.goto('./baupad/materialverwaltung?t=baustellen');
  await expect(page.getByTestId('material-site-count')).toHaveText('1 offen · 2 geliefert');
  // Verlauf auf der Baustelle nennt die Bestellnummer
  await page.getByTestId('material-site-open').click();
  await page.locator('[data-testid="item-row"][data-name="Reprofiliermörtel R4"]').getByTestId('item-open').click();
  await expect(page.getByTestId('item-history')).toContainText(`Bestellt (B-${year}-001)`);
  await page.getByTestId('item-dialog').getByRole('button', { name: 'Abbrechen' }).click();

  // Geräte: Stückzahl und wo sie sind
  await page.goto('./baupad/materialverwaltung?t=geraete');
  await expect(page.getByTestId('devices-empty')).toBeVisible();
  await page.getByTestId('device-new').click();
  const dd = page.getByTestId('device-dialog');
  await dd.getByTestId('device-name').fill('Betonfräse');
  await dd.getByTestId('device-total').fill('3');
  await expect(dd.getByTestId('device-stock')).toHaveText('3 Stk');
  await dd.getByTestId('device-add-site').selectOption({ label: 'Wohnanlage Sonnenhof' });
  await expect(dd.getByTestId('device-qty')).toHaveText('1');
  await dd.getByTestId('device-plus').click();
  await expect(dd.getByTestId('device-qty')).toHaveText('2');
  await expect(dd.getByTestId('device-stock')).toHaveText('1 Stk');
  await dd.getByTestId('device-save').click();
  await expect(dd).toHaveCount(0);
  await expect(page.getByTestId('device-row')).toContainText('Betonfräse · 3 Stk');
  await expect(page.getByTestId('device-where')).toHaveText('Lager 1 · Wohnanlage Sonnenhof 2');
  await expect(page.getByTestId('devices-summary')).toHaveText('1 Geräte · 3 Stück · 2 auf Baustellen · 1 im Lager');

  // gleicher Name nochmal → Hinweis; mehr verteilt als vorhanden → Hinweis, kein Speichern
  await page.getByTestId('device-new').click();
  await dd.getByTestId('device-name').fill('betonfräse');
  await expect(dd.getByTestId('device-duplicate')).toContainText('gibt es schon');
  await dd.getByRole('button', { name: 'Abbrechen' }).click();
  await page.getByTestId('device-open').click();
  await dd.getByTestId('device-total').fill('1');
  await expect(dd.getByTestId('device-over')).toContainText('mehr Stück verteilt als vorhanden (2 von 1)');
  await dd.getByTestId('device-save').click();
  await expect(dd).toBeVisible();
  // ein Stück zurück ins Lager, Gesamtzahl wieder 3
  await dd.getByTestId('device-total').fill('3');
  await dd.getByTestId('device-minus').click();
  await dd.getByTestId('device-save').click();
  await expect(dd).toHaveCount(0);
  await expect(page.getByTestId('device-where')).toHaveText('Lager 2 · Wohnanlage Sonnenhof 1');
  await page.getByTestId('device-open').click();
  await dd.getByTestId('device-log').locator('summary').click();
  await expect(dd.getByTestId('device-log').locator('li').first()).toContainText('Wohnanlage Sonnenhof: 2 → 1 Stk');
  await dd.getByRole('button', { name: 'Abbrechen' }).click();

  // Geräte tauchen nicht im Materialstamm auf, aber in der Übersicht und auf der Baustelle; bleibt nach dem Neuladen
  await page.getByTestId('mat-tab-materials').click();
  await expect(page.getByTestId('materials-empty')).toBeVisible();
  await page.reload();
  await page.getByTestId('mat-tab-overview').click();
  await expect(page.getByTestId('hub-kpi-out')).toContainText('1');
  await expect(page.getByTestId('materials-title').locator('..')).toContainText('0 Materialien · 1 Geräte · 1 Lieferanten');
  await page.goto('./baupad/materialverwaltung?t=baustellen');
  await page.getByTestId('material-site-open').click();
  await expect(page.getByTestId('site-device')).toContainText('1 Stk Betonfräse');
});
