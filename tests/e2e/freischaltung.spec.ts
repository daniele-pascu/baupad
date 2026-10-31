import { expect, test } from './fixtures';
import { freshStart } from './helpers';

/**
 * Freischaltung: Ein neu registrierter Arbeitsbereich ist gesperrt (workspace_active false) – statt der
 * Werkzeuge erscheint die Hinweisseite; das Konto bleibt erreichbar. Der Betreiber sieht im Konto alle Firmen
 * und schaltet sie frei. Der Dienst wird nachgebaut (my_context, operator_workspaces, operator_set_workspace).
 */
const ctx = (over: Record<string, unknown>) => ({
  workspace_id: 'w9',
  workspace_name: 'Neu Bau GmbH',
  role: 'admin',
  pkg: 'einzel',
  tools: [],
  sites: [],
  tool_sites: {},
  operator: false,
  workspace_active: false,
  name: 'Nina Neu',
  phone: '',
  ...over,
});
const json = (o: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });

test('gesperrter Arbeitsbereich: Hinweisseite statt Werkzeuge, Konto erreichbar, nach Freischaltung Zugang', async ({ page }) => {
  let active = false;
  await page.route('**/rest/v1/rpc/my_context', (r) => r.fulfill(json(ctx({ workspace_active: active }))));
  await page.goto('./');
  await page.goto('./tools');
  const pending = page.getByTestId('access-pending');
  await expect(pending).toBeVisible();
  await expect(pending).toContainText('Neu Bau GmbH');
  await expect(pending).toContainText('nach Abschluss der Bestellung');
  await expect(page.getByTestId('tools-title')).toHaveCount(0);
  // Werkzeuge direkt aufrufen → ebenfalls gesperrt
  await page.goto('./projekte');
  await expect(page.getByTestId('access-pending')).toBeVisible();
  await expect(page.getByTestId('projects-title')).toHaveCount(0);
  // Konto bleibt erreichbar (Abmelden, Konto löschen)
  await page.goto('./konto');
  await expect(page.getByTestId('subscription-info')).toContainText('noch nicht freigeschaltet');
  // Betreiber schaltet frei → beim nächsten Start sind die Werkzeuge da
  active = true;
  await page.goto('./tools');
  await expect(page.getByTestId('tools-title')).toBeVisible();
  await expect(page.getByTestId('access-pending')).toHaveCount(0);
});

test('Betreiber: Konto zeigt registrierte Firmen und schaltet sie frei', async ({ page }) => {
  const list = [
    { id: 'w9', name: 'Neu Bau GmbH', active: false, note: '', created_at: Date.UTC(2026, 9, 30), activated_at: null, members: 1, admin_email: 'nina@neubau.at', admin_name: 'Nina Neu', pkg: 'einzel' },
    { id: 'w1', name: 'Muster Bau', active: true, note: '', created_at: Date.UTC(2026, 0, 5), activated_at: Date.UTC(2026, 0, 6), members: 4, admin_email: 'chef@muster.at', admin_name: 'Chef', pkg: 'firma' },
  ];
  const calls: unknown[] = [];
  await page.route('**/rest/v1/rpc/my_context', (r) => r.fulfill(json(ctx({ workspace_id: 'w1', workspace_name: 'PAD Software', operator: true, workspace_active: true }))));
  await page.route('**/rest/v1/rpc/operator_workspaces', (r) => r.fulfill(json(list)));
  await page.route('**/rest/v1/rpc/operator_set_workspace', (r) => {
    const body = r.request().postDataJSON() as { p_id: string; p_active: boolean };
    calls.push(body);
    const w = list.find((x) => x.id === body.p_id);
    if (w) w.active = body.p_active;
    return r.fulfill({ status: 204, body: '' });
  });
  await freshStart(page);
  await page.goto('./konto');
  const box = page.getByTestId('operator-workspaces');
  await expect(box).toContainText('2 Firmen registriert, 1 wartet auf Freischaltung');
  const rows = page.getByTestId('operator-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('Neu Bau GmbH');
  await expect(rows.first()).toContainText('nina@neubau.at');
  await expect(rows.first()).toContainText('gesperrt');
  await rows.first().getByTestId('operator-toggle').click();
  expect(calls).toEqual([{ p_id: 'w9', p_active: true }]);
  await expect(box).toContainText('2 Firmen registriert.');
  await expect(rows.first()).toContainText('freigeschaltet');
});
