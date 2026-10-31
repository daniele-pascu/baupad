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
  await page.locator('[data-testid="account-section"][data-tile="abo"]').click();
  await expect(page.getByTestId('subscription-info')).toContainText('noch nicht freigeschaltet');
  await expect(page.getByTestId('subscription-price')).toContainText('noch nicht vereinbart');
  // Betreiber schaltet frei → beim nächsten Start sind die Werkzeuge da
  active = true;
  await page.goto('./tools');
  await expect(page.getByTestId('tools-title')).toBeVisible();
  await expect(page.getByTestId('access-pending')).toHaveCount(0);
});

test('Betreiber: Konto zeigt registrierte Firmen, Preis je Benutzer und Freischaltung je Firma', async ({ page }) => {
  const list = [
    { id: 'w9', name: 'Neu Bau GmbH', active: false, note: '', price_per_user: 0, created_at: Date.UTC(2026, 9, 30), activated_at: null, members: 1, admin_email: 'nina@neubau.at', admin_name: 'Nina Neu', pkg: 'einzel' },
    { id: 'w1', name: 'Muster Bau', active: true, note: '', price_per_user: '9.90', created_at: Date.UTC(2026, 0, 5), activated_at: Date.UTC(2026, 0, 6), members: 4, admin_email: 'chef@muster.at', admin_name: 'Chef', pkg: 'firma' },
  ];
  const calls: Record<string, unknown>[] = [];
  await page.route('**/rest/v1/rpc/my_context', (r) => r.fulfill(json(ctx({ workspace_id: 'w1', workspace_name: 'PAD Software', operator: true, workspace_active: true }))));
  await page.route('**/rest/v1/rpc/operator_workspaces', (r) => r.fulfill(json(list)));
  await page.route('**/rest/v1/rpc/operator_set_workspace', (r) => {
    const body = r.request().postDataJSON() as Record<string, unknown>;
    calls.push(body);
    const w = list.find((x) => x.id === body.p_id);
    if (w) {
      if (typeof body.p_active === 'boolean') w.active = body.p_active;
      if (typeof body.p_price === 'number') w.price_per_user = body.p_price;
      if (typeof body.p_note === 'string') w.note = body.p_note;
    }
    return r.fulfill({ status: 204, body: '' });
  });
  await freshStart(page);
  await page.goto('./konto');
  await page.locator('[data-testid="account-section"][data-tile="betreiber"]').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Betreiber: Kunden');
  const box = page.getByTestId('operator-workspaces');
  await expect(box).toContainText('2 Firmen registriert, 1 wartet auf Freischaltung');
  const rows = page.getByTestId('operator-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('Neu Bau GmbH');
  await expect(rows.first()).toContainText('nina@neubau.at');
  await expect(rows.first()).toContainText('Preis offen');
  await expect(rows.first()).toContainText('gesperrt');
  await expect(rows.nth(1)).toContainText('9,90 € je Benutzer');
  // Firma antippen → Preis vereinbaren, dann freischalten
  await rows.first().click();
  const detail = page.getByTestId('operator-detail');
  await expect(detail).toContainText('Nina Neu');
  await detail.getByTestId('operator-price').fill('12,50');
  await detail.getByTestId('operator-note').fill('Angebot 3.11.');
  await detail.getByTestId('operator-save').click();
  expect(calls).toEqual([{ p_id: 'w9', p_price: 12.5, p_note: 'Angebot 3.11.' }]);
  await expect(detail).toContainText('1 × 12,50 €');
  await detail.getByTestId('operator-toggle').click();
  expect(calls[1]).toEqual({ p_id: 'w9', p_active: true });
  await expect(detail).toContainText('freigeschaltet');
  await detail.getByTestId('operator-back').click();
  await expect(box).toContainText('2 Firmen registriert.');
  await expect(rows.first()).toContainText('12,50 € je Benutzer');
});

test('Firma sieht den vereinbarten Preis unter Abonnement und beim Anlegen eines Benutzers', async ({ page }) => {
  await page.route('**/rest/v1/rpc/my_context', (r) => r.fulfill(json(ctx({ workspace_active: true, price_per_user: '12.50', members: 3 }))));
  await page.route('**/rest/v1/rpc/list_workspace_users', (r) => r.fulfill(json([])));
  await freshStart(page);
  await page.goto('./konto/abo');
  const price = page.getByTestId('subscription-price');
  await expect(price).toContainText('12,50 € je Benutzer und Monat');
  await expect(price).toContainText('derzeit 3 Benutzer');
  await expect(price).toContainText('37,50 € je Monat');
  await page.goto('./konto/benutzer');
  await page.getByTestId('user-add').click();
  await expect(page.getByTestId('user-dialog').getByTestId('user-price-hint')).toContainText('12,50 € je Monat');
  await expect(page.getByTestId('user-dialog').getByTestId('user-price-hint')).toContainText('dann 4 Benutzer');
});

test('E-Mail-Adresse ändern nur als Admin der Firma', async ({ page }) => {
  let role = 'arbeiter';
  await page.route('**/rest/v1/rpc/my_context', (r) => r.fulfill(json(ctx({ workspace_active: true, role }))));
  await page.goto('./');
  await page.goto('./konto/email');
  await expect(page.getByTestId('email-locked')).toContainText('nur der Admin');
  await expect(page.getByTestId('email-form')).toHaveCount(0);
  await expect(page.getByTestId('account-delete')).toBeVisible();
  role = 'admin';
  await page.goto('./konto/email');
  await expect(page.getByTestId('email-form')).toBeVisible();
  await expect(page.getByTestId('email-locked')).toHaveCount(0);
});
