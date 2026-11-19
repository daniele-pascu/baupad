import { expect, test, type Page } from './fixtures';
import { createProject, freshStart } from './helpers';

/**
 * Sicherheit am Gerät: App-Sperre mit PIN (Konto → Sicherheit), Sperrbildschirm über der Seite, falsche PIN,
 * „PIN vergessen?“ löscht die Daten; und: wird der Zugang zur Firma beendet, löscht die App die Firmendaten vom Gerät,
 * sobald die Anmeldung online geprüft ist.
 */

const WS = '11111111-1111-4111-8111-111111111111';
const context = (workspace: string | null) => ({ workspace_id: workspace, workspace_name: workspace ? 'Testfirma' : null, role: workspace ? 'admin' : null, pkg: 'pro', tools: [], sites: [], tool_sites: {}, operator: false, name: 'Test Nutzer', phone: '', workspace_active: true });

/** Anmeldedienst und Ablage nachbilden (nur, was der Abgleich braucht) */
async function fakeCompany(page: Page, ctx: { workspace: string | null }, calls: string[]) {
  await page.route('**/rest/v1/rpc/my_context', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(context(ctx.workspace)) }));
  await page.route('**/functions/v1/storage', async (r) => {
    const body = r.request().postDataJSON() as Record<string, unknown>;
    const action = String(body.action);
    calls.push(action);
    const ok = (o: unknown) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (action === 'presign') return ok({ urls: Object.fromEntries((body.items as { key: string; method: string }[]).map((i) => [`${i.method} ${i.key}`, `https://ablage.test/${i.key}`])) });
    if (action === 'pull') return ok({ photos: [], now: new Date().toISOString() });
    if (action === 'records-pull') return ok({ records: [], cursor: null, more: false });
    if (action === 'usage') return ok({ photos: 0, bytes: 0 });
    return ok({ ok: true });
  });
  await page.route('https://ablage.test/**', (r) => r.fulfill({ status: 200, body: '' }));
}

test('App-Sperre: PIN einrichten, sperren, falsche PIN, entsperren – die Seite darunter bleibt erhalten', async ({ page, context: browserContext }) => {
  await freshStart(page);
  await createProject(page, 'Gesperrtes Projekt');
  await page.goto('./baupad/konto/sicherheit');
  await page.getByTestId('lock-setup').click();
  const dlg = page.getByTestId('pin-dialog');
  await dlg.getByTestId('pin-new').fill('2468');
  await dlg.getByTestId('pin-again').fill('2467');
  await dlg.getByTestId('pin-save').click();
  await expect(dlg.getByTestId('pin-error')).toContainText('nicht gleich');
  await dlg.getByTestId('pin-again').fill('2468');
  await dlg.getByTestId('pin-save').click();
  await expect(dlg).toBeHidden();
  // im selben Tab gerade eingerichtet → offen
  await expect(page.getByTestId('app-lock')).toBeHidden();
  await page.getByTestId('lock-after-5').click();
  await expect(page.getByTestId('lock-after-5')).toHaveAttribute('aria-checked', 'true');

  // Jetzt sperren → Sperrbildschirm, App darunter nicht bedienbar
  await page.goto('./baupad/aufmass-und-abrechnung');
  await expect(page.getByText('Gesperrtes Projekt')).toBeVisible();
  await page.goto('./baupad/konto/sicherheit');
  await page.getByTestId('lock-now').click();
  const lock = page.getByTestId('app-lock');
  await expect(lock).toBeVisible();
  await expect(page.locator('#root')).toHaveAttribute('inert', '');
  await lock.getByTestId('lock-pin').fill('1111');
  await lock.getByTestId('lock-unlock').click();
  await expect(lock.getByTestId('lock-msg')).toContainText('Falsche PIN');
  await lock.getByTestId('lock-pin').fill('2468');
  await lock.getByTestId('lock-unlock').click();
  await expect(lock).toBeHidden();
  await expect(page.locator('#root')).not.toHaveAttribute('inert', '');
  await expect(page.getByTestId('security-settings')).toBeVisible();

  // App neu geöffnet (neuer Tab ohne Sitzung im Tab) → gesperrt, auch auf jeder Werkzeugseite
  const again = await browserContext.newPage();
  await again.goto('./baupad/aufmass-und-abrechnung');
  await expect(again.getByTestId('app-lock')).toBeVisible();
  await again.getByTestId('lock-pin').fill('2468');
  await again.getByTestId('lock-pin').press('Enter');
  await expect(again.getByTestId('app-lock')).toBeHidden();
  await expect(again.getByText('Gesperrtes Projekt')).toBeVisible();
  await again.close();

  // ausschalten nur mit der aktuellen PIN
  await page.getByTestId('lock-off').click();
  await page.getByTestId('pin-current').fill('0000');
  await page.getByTestId('pin-save').click();
  await expect(page.getByTestId('pin-error')).toContainText('stimmt nicht');
  await page.getByTestId('pin-current').fill('2468');
  await page.getByTestId('pin-save').click();
  await expect(page.getByTestId('lock-setup')).toBeVisible();
});

test('App-Sperre: „PIN vergessen?“ meldet ab und löscht die Daten auf dem Gerät', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Projekt auf dem Handy');
  await page.goto('./baupad/konto/sicherheit');
  await page.getByTestId('lock-setup').click();
  await page.getByTestId('pin-new').fill('1357');
  await page.getByTestId('pin-again').fill('1357');
  await page.getByTestId('pin-save').click();
  await page.getByTestId('lock-now').click();
  await page.getByTestId('lock-forgot').click();
  await expect(page.getByTestId('lock-forgot-confirm')).toContainText('Noch nicht übertragene Änderungen gehen verloren');
  await page.getByTestId('lock-forgot-wipe').click();
  await expect(page).toHaveURL(/\/baupad\/anmelden/);
  // Seite lädt nach dem Löschen neu (Hinweis kommt erst danach) – vorher nichts auf der Seite abfragen
  await expect(page.getByText(/von diesem Gerät gelöscht/)).toBeVisible();
  // gelöscht: Sperre weg, Projekt weg (der Test meldet sich danach von selbst wieder an)
  expect(await page.evaluate(() => localStorage.getItem('baupad.appLock'))).toBeNull();
  await page.goto('./baupad/aufmass-und-abrechnung');
  await expect(page.getByTestId('app-lock')).toBeHidden();
  await expect(page.getByText('Projekt auf dem Handy')).toHaveCount(0);
});

test('Zugang zur Firma beendet: die App löscht die Firmendaten vom Gerät, sobald sie online ist', async ({ page }) => {
  const ctx: { workspace: string | null } = { workspace: WS };
  const calls: string[] = [];
  await fakeCompany(page, ctx, calls);
  await freshStart(page);
  await createProject(page, 'Firmenprojekt');
  // Abgleich mit der Firma läuft (Gerät gehört jetzt zu ihr)
  await expect.poll(() => calls.includes('records-upsert'), { timeout: 20_000 }).toBe(true);
  // gleicher Arbeitsbereich: nichts passiert
  await page.reload();
  await expect(page.getByText('Firmenprojekt')).toBeVisible();

  // Admin hat den Benutzer gesperrt → Kontext ohne Firma
  ctx.workspace = null;
  await page.reload();
  await expect(page.getByText('Dein Zugang zur Firma wurde beendet')).toBeVisible({ timeout: 20_000 });
  await page.goto('./baupad/aufmass-und-abrechnung');
  await expect(page.getByTestId('projects-title')).toBeVisible();
  await expect(page.getByText('Firmenprojekt')).toHaveCount(0);
  // angemeldet bleibt die Person (Konto erreichbar)
  await page.goto('./baupad/konto');
  await expect(page.getByTestId('account-session')).toBeVisible();
});

test('Konto → Sicherheit: „Abmelden und Daten löschen“ mit Rückfrage', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Altes Gerät');
  await page.goto('./baupad/konto/sicherheit');
  await page.getByTestId('wipe-device').click();
  const dlg = page.locator('.modal').last();
  await expect(dlg).toContainText('Abmelden und Daten löschen?');
  await dlg.getByRole('button', { name: 'Abmelden und löschen' }).click();
  await expect(page).toHaveURL(/\/baupad\/anmelden/);
  await expect(page.getByText(/von diesem Gerät gelöscht/)).toBeVisible(); // nach dem Neuladen
  await page.goto('./baupad/aufmass-und-abrechnung');
  await expect(page.getByText('Altes Gerät')).toHaveCount(0);
});
