import { expect, test, type Page } from './fixtures';
import { createProject, freshStart, saveDownload } from './helpers';
import { readFileSync } from 'node:fs';

/**
 * Zeitaufzeichnung: Der Polier tippt für seine Arbeiter je Tag Baustelle und Stunden (Vorschlag aus der
 * Einteilung), Wegzeit optional; Monatszettel je Person mit zweiter Baustelle; Excel; Freigabe sperrt für den Polier.
 */

/** Projekt + Einteilung: Max und Peter Mo–Fr auf Parkring (KW 44/2026) */
async function setup(page: Page) {
  await freshStart(page);
  await createProject(page, 'Parkring', { number: '91300' });
  await page.goto('./baupad/aufmass-und-abrechnung');
  await createProject(page, 'Halle 3', {});
  await page.goto('./baupad/arbeitereinteilung');
  await page.getByTestId('week-date').fill('2026-10-26');
  await page.getByTestId('crew-workers').click();
  const wd = page.getByTestId('staff-page');
  for (const n of ['Max', 'Peter']) {
    await wd.getByTestId('staff-new').click();
    await wd.getByTestId('worker-firstName').fill(n);
    await wd.getByTestId('worker-save').click();
    await expect(wd.getByTestId('worker-row').filter({ hasText: n })).toHaveCount(1);
  }
  await page.keyboard.press('Escape');
  await page.getByTestId('add-site').click();
  await page.getByTestId('project-picker').getByTestId('picker-item').filter({ hasText: 'Parkring' }).click();
  await page.locator('[data-site="Parkring"] [data-day="0"] [data-testid="day-add"]').click();
  const ad = page.getByTestId('assign-dialog');
  for (const n of ['Max', 'Peter']) await ad.locator(`[data-worker="${n}"] input`).check();
  await ad.getByTestId('assign-save').click();
  await expect(page.locator('[data-site="Parkring"] [data-day="2"] [data-testid="crew-chip"]')).toHaveText(['Max', 'Peter']);
}

const row = (page: Page, name: string) => page.locator(`[data-testid="times-day-row"][data-name="${name}"]`);

test('Tag erfassen, Monatszettel mit Wegzeit und zweiter Baustelle, Excel, Freigabe', async ({ page }) => {
  test.setTimeout(150_000);
  await setup(page);

  // Kachel in den Tools
  await page.goto('./baupad/tools');
  await page.getByTestId('tool-times').click();
  await expect(page.getByTestId('times-title')).toHaveText('Zeitaufzeichnung');

  // Tag erfassen: Vorschlag aus der Einteilung (Parkring, 07:00–16:00, Pause 0:30 = 8,5 h), Peter ändern, Rest übernehmen
  await page.getByTestId('times-date').fill('2026-10-28');
  await expect(page.getByTestId('times-day-row')).toHaveCount(2);
  await expect(row(page, 'Max')).toHaveAttribute('data-state', 'suggested');
  await expect(row(page, 'Max').getByTestId('times-from')).toHaveValue('07:00');
  await expect(row(page, 'Max').getByTestId('times-to')).toHaveValue('16:00');
  await expect(row(page, 'Max').getByTestId('times-pause')).toHaveValue('0.5');
  await expect(row(page, 'Max').getByTestId('times-hours')).toHaveText('8,5 h');
  await expect(row(page, 'Max').getByTestId('times-site')).toHaveValue(/^p:/);
  await row(page, 'Peter').getByTestId('times-to').fill('15:00');
  await expect(row(page, 'Peter')).toHaveAttribute('data-state', 'done');
  await expect(row(page, 'Peter').getByTestId('times-hours')).toHaveText('7,5 h');
  await row(page, 'Peter').getByTestId('times-pause').selectOption('1');
  await expect(row(page, 'Peter').getByTestId('times-hours')).toHaveText('7 h');
  await row(page, 'Peter').getByTestId('times-travel').fill('1,5');
  await row(page, 'Peter').getByTestId('times-travel').press('Enter');
  await expect(page.getByTestId('times-confirm-all')).toHaveText(/\(1\)/);
  await page.getByTestId('times-confirm-all').click();
  await expect(row(page, 'Max')).toHaveAttribute('data-state', 'done');
  // Peters Zeiten bleiben ab jetzt als Vorschlag (nächster Tag: bis 15:00, Pause 1:00)
  await page.getByTestId('times-date').fill('2026-10-29');
  await expect(row(page, 'Peter')).toHaveAttribute('data-state', 'suggested');
  await expect(row(page, 'Peter').getByTestId('times-to')).toHaveValue('15:00');
  await expect(row(page, 'Peter').getByTestId('times-pause')).toHaveValue('1');
  await expect(row(page, 'Max').getByTestId('times-to')).toHaveValue('16:00');

  // Monatsliste: Oktober, Stunden je Person
  await page.getByTestId('times-prev').click();
  await page.getByTestId('times-next').click();
  await expect(page.getByTestId('times-month-label')).toHaveText('Oktober 2026');
  await expect(page.locator('[data-testid="times-person"][data-name="Max"]').getByTestId('times-person-sum')).toContainText('8,5 h');
  await expect(page.locator('[data-testid="times-person"][data-name="Peter"]').getByTestId('times-person-sum')).toContainText('7 h');

  // Monatszettel Max: Do vorgeschlagen → übernehmen; Fr zweite Baustelle
  await page.locator('[data-testid="times-person"][data-name="Max"]').click();
  await expect(page.getByTestId('timesheet-title')).toHaveText('Max');
  await expect(page.getByTestId('timesheet-month')).toHaveText('Oktober 2026');
  const thu = page.locator('[data-testid="timesheet-day"][data-date="2026-10-29"]');
  await expect(thu.getByTestId('timesheet-suggestion')).toHaveText('Parkring 07:00–16:00, 8,5 h');
  await thu.getByTestId('timesheet-take').click();
  await expect(thu).toHaveAttribute('data-state', 'done');
  // Fr: vormittags Parkring 07:00–11:30, nachmittags Halle 3 11:30–16:00 (ohne Pause)
  const fri = page.locator('[data-testid="timesheet-day"][data-date="2026-10-30"]');
  await fri.getByTestId('timesheet-edit').click();
  await expect(fri).toHaveAttribute('data-state', 'done');
  await fri.getByTestId('timesheet-to').fill('11:30');
  await expect(fri.getByTestId('timesheet-line-hours')).toHaveText('4 h');
  await fri.getByTestId('timesheet-add-line').click();
  await expect(fri.getByTestId('timesheet-from').nth(1)).toHaveValue('11:30');
  await fri.getByTestId('timesheet-site').nth(1).selectOption({ label: 'Halle 3' });
  await expect(fri.getByTestId('timesheet-day-sum')).toHaveText('8,5 h');
  await expect(page.getByTestId('timesheet-summary')).toContainText('25,5 h');
  await expect(page.getByTestId('timesheet-summary')).toContainText('Halle 3 4,5 h');
  // Nationalfeiertag ohne Vorschlag; Samstag frei
  await expect(page.locator('[data-testid="timesheet-day"][data-date="2026-10-26"]')).toContainText('Nationalfeiertag');

  // Excel des Monatszettels
  const dl = page.waitForEvent('download');
  await page.getByTestId('timesheet-excel').click();
  const file = await saveDownload(await dl, 'zeit.xlsx');
  const { unzipSync, strFromU8 } = await import('fflate');
  const files = unzipSync(new Uint8Array(readFileSync(file)));
  expect(strFromU8(files['xl/worksheets/sheet2.xml'])).toContain('Halle 3');

  // Freigabe: Polier kann danach nichts mehr ändern
  await page.getByTestId('timesheet-approve').click();
  await page.getByTestId('confirm-dialog').getByRole('button', { name: 'Freigeben' }).click();
  await expect(page.getByTestId('timesheet-approved')).toContainText('Freigegeben am');
  const context = { workspace_id: '11111111-1111-4111-8111-111111111111', workspace_name: 'Testfirma', role: 'polier', pkg: 'team', tools: ['projects', 'photos', 'reports', 'workers', 'defects'], sites: [], tool_sites: {}, operator: false, name: 'Polier Paul', phone: '' };
  await page.route('**/rest/v1/rpc/my_context', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(context) }));
  await page.reload();
  await expect(page.getByTestId('timesheet-approved')).toContainText('Änderungen nur durch das Büro');
  await expect(page.getByTestId('timesheet-approve')).toHaveCount(0);
  await expect(fri.getByTestId('timesheet-site').first()).toBeDisabled();
  await expect(page.getByTestId('timesheet-take')).toHaveCount(0);
});
