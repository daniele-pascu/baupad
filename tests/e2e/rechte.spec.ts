import { expect, test } from './fixtures';
import { createProject, freshStart } from './helpers';

/**
 * Rechte je Rolle: Polier und Arbeiter dürfen keine Projekte anlegen (nur Admin und Büro) und sehen je Werkzeug
 * nur die freigegebenen Projekte. Der Kontext aus der Datenbank wird nachgebaut.
 */
const context = (role: string, extra: Record<string, unknown> = {}) => ({
  workspace_id: '11111111-1111-4111-8111-111111111111',
  workspace_name: 'Testfirma',
  role,
  pkg: 'team',
  tools: ['projects', 'photos', 'reports', 'workers', 'defects'],
  sites: [],
  tool_sites: {},
  operator: false,
  name: 'Test Nutzer',
  phone: '',
  ...extra,
});

test('Polier: kein „Neues Projekt“ in Aufmaß, Fotos, Mängelplan, Einteilung und in der Projektauswahl', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Neubau Musterstraße', { number: '2026-04' }); // noch ohne Rollen-Kontext (Admin)
  await page.route('**/rest/v1/rpc/my_context', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(context('polier')) }));
  await page.goto('./projekte');
  await expect(page.getByTestId('project-card')).toHaveCount(1);
  await expect(page.getByTestId('new-project')).toHaveCount(0);

  await page.goto('./fotos');
  await expect(page.getByTestId('photos-empty')).toBeVisible(); // Aufmaß-Projekt erscheint hier erst mit dem ersten Foto
  await expect(page.getByTestId('photo-new-site')).toHaveCount(0);
  await page.getByTestId('photo-file-input').setInputFiles([{ name: 'IMG_1.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) }]);
  const dlg = page.getByTestId('photo-save-dialog');
  await expect(dlg.getByTestId('photo-site').locator('option')).toHaveText(['– Projekt wählen –', '2026-04 · Neubau Musterstraße']); // Projekt wählbar, aber kein „Neues Projekt“
  await page.keyboard.press('Escape');

  await page.goto('./maengel');
  await expect(page.getByTestId('defect-new-site')).toHaveCount(0);

  await page.goto('./arbeitereinteilung');
  await page.getByTestId('add-site').click();
  // ohne Recht: nur Projekt übernehmen, kein „Neues Projekt anlegen“
  const pk = page.getByTestId('project-picker');
  await expect(pk).toBeVisible();
  await expect(pk.getByTestId('picker-new')).toHaveCount(0);
  await expect(pk.getByTestId('picker-item')).toHaveCount(1);
});

test('Büro darf Projekte anlegen; Projekte je Werkzeug: nur freigegebene sind wählbar', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Neubau Musterstraße', { number: '2026-04' });
  await page.goto('./projekte');
  await createProject(page, 'Sanierung Hauptplatz', { number: '2026-05' });
  await page.route('**/rest/v1/rpc/my_context', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(context('buero')) }));
  await page.goto('./fotos');
  await expect(page.getByTestId('photo-new-site')).toBeVisible();
  // Projekte aus Aufmaß erscheinen in Fotos nicht in der Übersicht, aber in der Auswahl zum Übernehmen
  await expect(page.locator('a[data-testid="photo-site"]')).toHaveCount(0);
  const fake = { name: 'IMG_1.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) };
  await page.getByTestId('photo-file-input').setInputFiles([fake]);
  const options = page.getByTestId('photo-save-dialog').getByTestId('photo-site').locator('option');
  await expect(options).toHaveText(['– Projekt wählen –', '2026-05 · Sanierung Hauptplatz', '2026-04 · Neubau Musterstraße', '+ Neues Projekt …']); // zuletzt bearbeitet zuerst
  const ids = await options.evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value.split('|')[0]).filter(Boolean));
  await page.keyboard.press('Escape');

  // Polier mit Freigabe nur für ein Projekt in der Fotodokumentation
  await page.unroute('**/rest/v1/rpc/my_context');
  await page.route('**/rest/v1/rpc/my_context', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(context('polier', { tool_sites: { photos: [`p:${ids[0]}`] } })) }));
  await page.reload();
  await page.getByTestId('photo-file-input').setInputFiles([fake]);
  await expect(page.getByTestId('photo-save-dialog').getByTestId('photo-site').locator('option')).toHaveText(['– Projekt wählen –', '2026-05 · Sanierung Hauptplatz']);
  await page.keyboard.press('Escape');
  await page.goto('./projekte');
  await expect(page.getByTestId('project-card')).toHaveCount(2); // Aufmaß: keine Einschränkung eingetragen → alle
});
