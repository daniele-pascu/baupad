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

/** Projekt-ID aus der Adresse der Projektseite (…/p/<id>) */
const projectIdFromUrl = (url: string) => new URL(url).pathname.split('/').filter(Boolean).pop()!;
const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

test('Freigabe im Projekt: Admin wählt Poliere und Arbeiter; ohne Freigabe sieht der Polier das Projekt nicht', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Neubau Musterstraße', { number: '2026-04' });
  const key = `p:${projectIdFromUrl(page.url())}`;
  await expect(page.getByTestId('project-access')).toHaveCount(0); // ohne Firma gibt es niemanden zum Freigeben
  const rows = [
    { id: 'u1', name: 'Franz Huber', email: 'franz@firma.test', role: 'polier', allowed: true },
    { id: 'u2', name: 'Max Muster', email: 'max@firma.test', role: 'arbeiter', allowed: false },
    { id: 'inv:peter@firma.test', name: 'Peter Beispiel', email: 'peter@firma.test', role: 'arbeiter', allowed: false },
  ];
  let saved: unknown = null;
  await page.route('**/rest/v1/rpc/my_context', (r) => r.fulfill(json(context('admin'))));
  await page.route('**/rest/v1/rpc/project_access', (r) => r.fulfill(json(rows)));
  await page.route('**/rest/v1/rpc/set_project_access', (r) => {
    saved = r.request().postDataJSON();
    return r.fulfill(json(null));
  });
  await page.reload();
  await page.getByTestId('project-access').click();
  const dlg = page.getByTestId('project-access-dialog');
  const user = (name: string) => dlg.locator(`[data-testid="project-access-user"][data-user="${name}"]`);
  await expect(dlg.getByTestId('project-access-user')).toHaveCount(3);
  await expect(user('Franz Huber')).toBeChecked();
  await expect(user('Max Muster')).not.toBeChecked();
  await dlg.getByTestId('project-access-all-arbeiter').click();
  await expect(user('Max Muster')).toBeChecked();
  await expect(user('Peter Beispiel')).toBeChecked();
  await user('Franz Huber').uncheck();
  await dlg.getByTestId('project-access-save').click();
  await expect(dlg).toHaveCount(0);
  expect(saved).toEqual({ p_key: key, p_ids: ['u2', 'inv:peter@firma.test'] });
  // dieselbe Taste im Fenster „Projektangaben bearbeiten“ (so in jedem Werkzeug erreichbar)
  await page.getByTestId('edit-project').click();
  await expect(page.getByTestId('project-form').getByTestId('project-access')).toBeVisible();
  await page.keyboard.press('Escape');

  // Polier ohne Freigabe: Projekt unsichtbar; nach der Freigabe sichtbar – die Taste „Freigabe“ hat er nie
  await page.route('**/rest/v1/rpc/my_context', (r) => r.fulfill(json(context('polier'))));
  await page.goto('./projekte');
  await expect(page.getByTestId('projects-title')).toBeVisible();
  await expect(page.getByTestId('project-card')).toHaveCount(0);
  await page.route('**/rest/v1/rpc/my_context', (r) => r.fulfill(json(context('polier', { sites: [key] }))));
  await page.goto('./projekte');
  await expect(page.getByTestId('project-card')).toHaveCount(1);
  await page.getByTestId('project-card').click();
  await expect(page.getByTestId('project-title')).toHaveText('Neubau Musterstraße');
  await expect(page.getByTestId('project-access')).toHaveCount(0);
});

test('Polier: kein „Neues Projekt“ in Aufmaß, Fotos, Mängelplan, Einteilung und in der Projektauswahl', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Neubau Musterstraße', { number: '2026-04' }); // noch ohne Rollen-Kontext (Admin)
  const sites = [`p:${projectIdFromUrl(page.url())}`]; // für den Polier freigegeben
  await page.route('**/rest/v1/rpc/my_context', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(context('polier', { sites })) }));
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
  await expect(page.getByTestId('projects-title')).toBeVisible();
  await expect(page.getByTestId('project-card')).toHaveCount(0); // Aufmaß: nichts freigegeben → kein Projekt
});
