import { expect, test } from './fixtures';
import { createProject, freshStart } from './helpers';

/** Projektregister: alle Projekte mit Angaben, in Tools übernehmen, neues Projekt mit Wahl der Tools, Rechte. */
test('Projektregister: Angaben, in Tools übernehmen, dort öffnen, neues Projekt anlegen', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Parkring', { number: '91300', address: 'Parkring 10, 1010 Wien', client: 'Muster GmbH' }, [{ number: '91300', name: 'Garage' }]);
  await page.goto('./baupad/tools');
  await page.getByTestId('tools-register').click();
  await expect(page.getByTestId('register-title')).toHaveText('Projektregister');
  const row = page.locator('[data-testid="register-row"][data-name="Parkring"]');
  await expect(row).toContainText('Parkring 10, 1010 Wien');
  await expect(row).toContainText('Muster GmbH');
  await expect(row.getByTestId('register-tool')).toHaveText([/Aufmaß & Abrechnung/]);

  // in Fotodokumentation und Mängelplan übernehmen
  await row.getByTestId('register-adopt').click();
  const dlg = page.getByTestId('register-adopt-dialog');
  await expect(dlg.locator('[data-testid="register-adopt-tool"][data-tool="projects"] input')).toBeDisabled();
  await dlg.locator('[data-testid="register-adopt-tool"][data-tool="photos"] input').check();
  await dlg.locator('[data-testid="register-adopt-tool"][data-tool="defects"] input').check();
  await dlg.getByTestId('register-adopt-save').click();
  await expect(row.getByTestId('register-tool')).toHaveText([/Aufmaß & Abrechnung/, /Fotodokumentation/, /Mängelplan/]);
  // dort öffnen
  await row.locator('[data-testid="register-tool"][data-tool="defects"]').click();
  await expect(page.getByTestId('defect-site-title')).toHaveText('Parkring');
  await page.goto('./baupad/fotodokumentation');
  await expect(page.locator('a[data-testid="photo-site"]')).toHaveAttribute('data-site', 'Parkring');

  // neues Projekt im Register: nur Projektinfos, in keinem Tool; danach in Berichte & Formulare übernehmen
  await page.goto('./baupad/projektregister');
  await page.getByTestId('register-new').click();
  await page.getByTestId('project-name').fill('Halle 3');
  await page.getByTestId('project-save').click();
  const halle = page.locator('[data-testid="register-row"][data-name="Halle 3"]');
  await expect(halle).toContainText('Noch in keinem Tool');
  await expect(page.getByTestId('register-adopt-dialog')).toHaveCount(0);
  await halle.getByTestId('register-adopt').click();
  const ad = page.getByTestId('register-adopt-dialog');
  await expect(ad.getByTestId('register-adopt-save')).toBeDisabled();
  await ad.locator('[data-testid="register-adopt-tool"][data-tool="reports"] input').check();
  await ad.getByTestId('register-adopt-save').click();
  await halle.locator('[data-testid="register-tool"][data-tool="reports"]').click();
  await expect(page.getByTestId('report-site-page')).toHaveAttribute('data-site', 'Halle 3');
  await page.goto('./baupad/projektregister');
  await expect(page.getByTestId('register-row')).toHaveCount(2);
  await expect(page.locator('[data-testid="register-row"][data-name="Halle 3"]').getByTestId('register-tool')).toHaveText([/Berichte & Formulare/]);
  // nicht in Aufmaß & Abrechnung
  await page.goto('./baupad/aufmass-und-abrechnung');
  await expect(page.getByTestId('project-card')).toHaveCount(1);

  // Suche
  await page.goto('./baupad/projektregister');
  await page.getByTestId('register-search').fill('91300');
  await expect(page.getByTestId('register-row')).toHaveCount(1);
  await page.getByTestId('register-search').fill('');

  // Löschen: Halle 3 ohne Einträge; Parkring samt Baustelle in der Woche der Einteilung
  await page.locator('[data-testid="register-row"][data-name="Halle 3"]').getByTestId('register-delete').click();
  await page.getByTestId('confirm-dialog').getByRole('button', { name: 'Endgültig löschen' }).click();
  await expect(page.getByTestId('register-row')).toHaveCount(1);
  await page.goto('./baupad/arbeitereinteilung');
  await page.getByTestId('add-site').click();
  await page.getByTestId('project-picker').getByTestId('picker-item').filter({ hasText: 'Parkring' }).click();
  await expect(page.locator('[data-site="Parkring"]')).toHaveCount(1);
  await page.goto('./baupad/projektregister');
  await page.locator('[data-testid="register-row"][data-name="Parkring"]').getByTestId('register-delete').click();
  await expect(page.getByTestId('register-delete-usage')).toContainText('1 Baustelle in Wochen der Arbeitereinteilung');
  await page.getByTestId('confirm-dialog').getByRole('button', { name: 'Endgültig löschen' }).click();
  await expect(page.getByTestId('register-row')).toHaveCount(0);
  // auch aus der Woche weg und nicht wieder angelegt
  await page.goto('./baupad/arbeitereinteilung');
  await expect(page.locator('[data-site="Parkring"]')).toHaveCount(0);
  await page.goto('./baupad/projektregister');
  await expect(page.getByTestId('register-row')).toHaveCount(0);
});

test('Projektregister nur für Admin und Büro: Polier sieht weder Kachel noch Register, übernimmt Projekte im Tool', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Parkring', { number: '91300' });
  const context = { workspace_id: '11111111-1111-4111-8111-111111111111', workspace_name: 'Testfirma', role: 'polier', pkg: 'team', tools: ['projects', 'photos', 'reports', 'workers', 'defects'], sites: [], tool_sites: {}, operator: false, name: 'Polier Paul', phone: '' };
  await page.route('**/rest/v1/rpc/my_context', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(context) }));
  await page.goto('./baupad/tools');
  await expect(page.getByTestId('tools-title')).toBeVisible();
  await expect(page.getByTestId('tool-photos')).toBeVisible();
  await expect(page.getByTestId('tools-register')).toHaveCount(0);
  await page.goto('./baupad/projektregister');
  await expect(page.getByTestId('register-no-access')).toBeVisible();
  await expect(page.getByTestId('register-row')).toHaveCount(0);
  // im Tool: „Projekt übernehmen“ zeigt das Projekt aus dem Register
  await page.goto('./baupad/fotodokumentation');
  await page.getByTestId('photo-new-site').click();
  await expect(page.getByTestId('project-picker').getByTestId('picker-item').filter({ hasText: 'Parkring' })).toHaveCount(1);
  // Polier darf in keinem Tool ein Projekt anlegen – nur übernehmen
  await expect(page.getByTestId('project-picker').getByTestId('picker-new')).toHaveCount(0);
  for (const [url, btn] of [
    ['./baupad/aufmass-und-abrechnung', 'new-project'],
    ['./baupad/maengelplan', 'defect-new-site'],
    ['./baupad/berichte-und-formulare', 'report-new-site'],
  ] as const) {
    await page.goto(url);
    const b = page.getByTestId(btn);
    if (await b.count()) {
      await b.first().click();
      await expect(page.getByTestId('project-picker')).toBeVisible();
      await expect(page.getByTestId('project-picker').getByTestId('picker-new')).toHaveCount(0);
    }
  }
});

test('Gelöschtes Projekt kommt auf anderen Geräten nicht zurück: Reste werden weggeräumt statt neu angelegt', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Parkring', { number: '91300' });
  await page.goto('./baupad/arbeitereinteilung');
  await page.getByTestId('add-site').click();
  await page.getByTestId('project-picker').getByTestId('picker-item').filter({ hasText: 'Parkring' }).click();
  await expect(page.locator('[data-site="Parkring"]')).toHaveCount(1);
  // anderes Gerät: Löschung des Projekts ist angekommen, die geänderte Woche noch nicht
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('schadstellen-aufmass');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(['projects', 'meta'], 'readwrite');
          const all = tx.objectStore('projects').getAll();
          all.onsuccess = () => {
            const p = (all.result as { id: string; name: string }[]).find((x) => x.name === 'Parkring')!;
            tx.objectStore('projects').delete(p.id);
            tx.objectStore('meta').put({ key: 'deletedProjects', value: [p.id] });
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  await page.reload();
  await expect(page.locator('[data-site="Parkring"]')).toHaveCount(0);
  await page.goto('./baupad/projektregister');
  await expect(page.getByTestId('register-title')).toBeVisible();
  await expect(page.getByTestId('register-row')).toHaveCount(0);
});

test('Projekt im Tool gelöscht → auch aus dem Projektregister weg', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Weg damit', { number: '777' });
  await page.goto('./baupad/projektregister');
  await expect(page.getByTestId('register-row').filter({ hasText: 'Weg damit' })).toHaveCount(1);
  await page.goto('./baupad/aufmass-und-abrechnung');
  const card = page.locator('.project-card').filter({ hasText: 'Weg damit' });
  await card.getByRole('button', { name: 'Löschen' }).click();
  await page.getByTestId('confirm-dialog').getByRole('button', { name: 'Endgültig löschen' }).click();
  await expect(page.locator('.project-card').filter({ hasText: 'Weg damit' })).toHaveCount(0);
  await page.goto('./baupad/projektregister');
  await expect(page.getByTestId('register-new')).toBeVisible();
  await expect(page.getByTestId('register-row').filter({ hasText: 'Weg damit' })).toHaveCount(0);
});

test('Projektregister sortieren: Name, Kostenstelle auf-/absteigend, neueste/älteste zuerst', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Beta', {}, [{ number: '91500', name: 'Hof' }]);
  await page.goto('./baupad/aufmass-und-abrechnung');
  await createProject(page, 'Alpha', {}, [{ number: '91200', name: 'Keller' }]);
  await page.goto('./baupad/aufmass-und-abrechnung');
  await createProject(page, 'Gamma', {}, [{ number: '91300', name: 'Dach' }]);
  await page.goto('./baupad/tools');
  await page.getByTestId('tools-register').click();
  const names = () => page.getByTestId('register-row').evaluateAll((els) => els.map((e) => e.getAttribute('data-name')));
  await expect.poll(names).toEqual(['Alpha', 'Beta', 'Gamma']);
  await page.getByTestId('register-order').selectOption('cc-asc');
  await expect.poll(names).toEqual(['Alpha', 'Gamma', 'Beta']); // 91200, 91300, 91500
  await page.getByTestId('register-order').selectOption('cc-desc');
  await expect.poll(names).toEqual(['Beta', 'Gamma', 'Alpha']);
  await page.getByTestId('register-order').selectOption('new');
  await expect.poll(names).toEqual(['Gamma', 'Alpha', 'Beta']);
  await page.getByTestId('register-order').selectOption('old');
  await expect.poll(names).toEqual(['Beta', 'Alpha', 'Gamma']);
  // bleibt gemerkt
  await page.reload();
  await expect(page.getByTestId('register-order')).toHaveValue('old');
  await expect.poll(names).toEqual(['Beta', 'Alpha', 'Gamma']);
});

test('Projektfarben: automatisch verschieden, im Register änderbar, in allen Tools gleich', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Alpha');
  await page.goto('./baupad/aufmass-und-abrechnung');
  await createProject(page, 'Beta');
  await page.goto('./baupad/projektregister');
  const color = (name: string) => page.locator(`[data-testid="register-row"][data-name="${name}"]`).evaluate((el) => getComputedStyle(el).getPropertyValue('--pc').trim());
  const a = await color('Alpha');
  expect(a).toMatch(/^#[0-9a-f]{6}$/);
  expect(await color('Beta')).not.toBe(a);
  // im Register ändern
  await page.locator('[data-testid="register-row"][data-name="Alpha"]').getByTestId('register-edit').click();
  const dlg = page.getByTestId('photo-site-dialog');
  await expect(dlg.locator(`[data-testid="project-color-option"][data-color="${a}"]`)).toHaveAttribute('aria-checked', 'true');
  await dlg.locator('[data-testid="project-color-option"][data-color="#c026d3"]').click();
  await dlg.getByTestId('photo-site-save').click();
  await expect(dlg).toHaveCount(0);
  await expect.poll(() => color('Alpha')).toBe('#c026d3');
  // dieselbe Farbe in Aufmaß & Abrechnung
  await page.goto('./baupad/aufmass-und-abrechnung');
  const card = page.locator('li.project-card', { hasText: 'Alpha' });
  await expect.poll(() => card.evaluate((el) => getComputedStyle(el).getPropertyValue('--pc').trim())).toBe('#c026d3');
});
