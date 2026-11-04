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
  await expect(page.getByTestId('photos-empty')).toBeVisible(); // Aufmaß-Projekt erscheint hier erst nach dem Übernehmen
  await expect(page.getByTestId('photo-new-site')).toHaveText(/Projekt übernehmen/); // kein „Neues Projekt“
  await page.getByTestId('photo-new-site').click();
  const pp = page.getByTestId('project-picker');
  await expect(pp.getByTestId('picker-new')).toHaveCount(0);
  await expect(pp.getByTestId('picker-item')).toHaveText([/Neubau Musterstraße/]); // Projekt übernehmbar, aber nicht anlegen
  await page.keyboard.press('Escape');

  await page.goto('./maengel');
  await expect(page.getByTestId('defect-new-site')).toHaveText(/Projekt übernehmen/);

  await page.goto('./arbeitereinteilung');
  // ohne Recht, Projekte hinzuzufügen: keine Taste „Neues Projekt“ in der Einteilung
  await expect(page.getByTestId('workers-title')).toBeVisible();
  await expect(page.getByTestId('add-site')).toHaveCount(0);
});

test('Büro darf Projekte anlegen; Projekte je Werkzeug: nur freigegebene sind wählbar', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Neubau Musterstraße', { number: '2026-04' });
  await page.goto('./projekte');
  await createProject(page, 'Sanierung Hauptplatz', { number: '2026-05' });
  await page.route('**/rest/v1/rpc/my_context', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(context('buero')) }));
  await page.goto('./fotos');
  await expect(page.getByTestId('photo-new-site')).toHaveText(/Neues Projekt/);
  // Projekte aus Aufmaß erscheinen in Fotos nicht in der Übersicht, aber in der Auswahl zum Übernehmen
  await expect(page.locator('a[data-testid="photo-site"]')).toHaveCount(0);
  await page.getByTestId('photo-new-site').click();
  const pp = page.getByTestId('project-picker');
  await expect(pp.getByTestId('picker-new')).toHaveCount(1);
  await expect(pp.getByTestId('picker-item')).toHaveText([/Neubau Musterstraße/, /Sanierung Hauptplatz/]); // A–Z
  const ids = await pp.getByTestId('picker-item').evaluateAll((els) => els.map((e) => e.getAttribute('data-project')));
  const sanId = await page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const r = indexedDB.open('schadstellen-aufmass');
        r.onsuccess = () => {
          const q = r.result.transaction('projects').objectStore('projects').getAll();
          q.onsuccess = () => resolve((q.result as { id: string; name: string }[]).find((p) => p.name === 'Sanierung Hauptplatz')!.id);
        };
      }),
  );
  expect(ids).toEqual(['Neubau Musterstraße', 'Sanierung Hauptplatz']);
  await page.keyboard.press('Escape');

  // Polier mit Freigabe nur für ein Projekt in der Fotodokumentation
  await page.unroute('**/rest/v1/rpc/my_context');
  await page.route('**/rest/v1/rpc/my_context', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(context('polier', { tool_sites: { photos: [`p:${sanId}`] } })) }));
  await page.reload();
  await expect(page.getByTestId('photo-new-site')).toHaveText(/Projekt übernehmen/);
  await page.getByTestId('photo-new-site').click();
  await expect(pp.getByTestId('picker-new')).toHaveCount(0);
  await expect(pp.getByTestId('picker-item')).toHaveText([/Sanierung Hauptplatz/]);
  await page.keyboard.press('Escape');
  await page.goto('./projekte');
  await expect(page.getByTestId('project-card')).toHaveCount(2); // Aufmaß: keine Einschränkung eingetragen → alle
});
