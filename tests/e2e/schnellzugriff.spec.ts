import { expect, test, type Page } from './fixtures';
import { createProject, freshStart, pickWeekProject } from './helpers';

/**
 * Tools-Seite: Schnellzugriff (zuletzt geöffnet + angeheftet, Tool klein über dem Projekt) und „Heute auf der
 * Baustelle“ (eingeteilt, krank, Urlaub, noch frei); Projektregister mit Reitern Zuletzt / Angeheftet / Alle n –
 * Suchen schaltet die Reiter aus und sucht in allen Projekten.
 */

const quick = (page: Page) => page.getByTestId('quick-item');
const rows = (page: Page) => page.getByTestId('register-row');

test('Schnellzugriff, Projektregister mit Reitern und Nadel, Heute auf der Baustelle', async ({ page }) => {
  // fester Tag: Dienstag (Arbeitstag, kein Feiertag)
  await page.clock.setFixedTime(new Date('2026-11-24T09:00:00'));
  await freshStart(page);

  // Projekte in Aufmaß öffnen → stehen im Schnellzugriff (neueste zuerst), Tool klein darüber
  await createProject(page, 'Rohbau Müller');
  await page.goto('./baupad/aufmass-und-abrechnung');
  await createProject(page, 'Halle Nord');
  await page.goto('./baupad/tools');
  await expect(page.getByTestId('quick-access')).toBeVisible();
  await expect(quick(page)).toHaveCount(2);
  await expect(quick(page).locator('strong')).toHaveText(['Halle Nord', 'Rohbau Müller']);
  await expect(quick(page).first().locator('.quick-tool')).toHaveText('Aufmaß');
  // Antippen öffnet das Projekt im Tool
  await quick(page).nth(1).click();
  await expect(page.getByTestId('project-title')).toHaveText('Rohbau Müller');

  // Projektregister: „Alle 2“ zuerst; Zuletzt = zuletzt geöffnet (neueste zuerst)
  await page.goto('./baupad/projektregister');
  await expect(page.getByTestId('register-tab-alle')).toHaveText('Alle 2');
  await expect(page.getByTestId('register-tab-alle')).toHaveAttribute('aria-selected', 'true');
  await expect(rows(page)).toHaveCount(2);
  await page.getByTestId('register-tab-zuletzt').click();
  await expect(rows(page).first()).toHaveAttribute('data-name', 'Rohbau Müller');
  await expect(rows(page).nth(1)).toHaveAttribute('data-name', 'Halle Nord');

  // Angeheftet: leer → Nadel bei Halle Nord → nur Halle Nord
  await page.getByTestId('register-tab-angeheftet').click();
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByTestId('register-pins-empty')).toBeVisible();
  await page.getByTestId('register-tab-alle').click();
  const halle = page.locator('[data-testid="register-row"][data-name="Halle Nord"]');
  await halle.getByTestId('register-pin').click();
  await expect(halle.getByTestId('register-pin')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('register-tab-angeheftet').click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toHaveAttribute('data-name', 'Halle Nord');

  // Suchen schaltet die Reiter aus und zeigt Treffer aus allen Projekten
  await page.getByTestId('register-search').fill('müller');
  await expect(page.getByTestId('register-tabs')).toHaveClass(/off/);
  await expect(page.locator('[data-testid="register-tabs"] [aria-selected="true"]')).toHaveCount(0);
  await expect(page.getByTestId('register-search-all')).toBeVisible();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toHaveAttribute('data-name', 'Rohbau Müller');
  // Reiter antippen beendet die Suche
  await page.getByTestId('register-tab-angeheftet').click();
  await expect(page.getByTestId('register-search')).toHaveValue('');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toHaveAttribute('data-name', 'Halle Nord');

  // Tools: angeheftetes Projekt steht vorn (mit Nadel), danach die zuletzt geöffneten
  await page.goto('./baupad/tools');
  await expect(quick(page).locator('strong')).toHaveText(['Halle Nord', 'Rohbau Müller']);
  await expect(quick(page).first()).toHaveAttribute('data-pinned', 'true');
  await expect(quick(page).nth(1)).not.toHaveAttribute('data-pinned', 'true');
  // Register merkt den Reiter
  await page.getByTestId('quick-edit').click();
  await expect(page.getByTestId('register-tab-angeheftet')).toHaveAttribute('aria-selected', 'true');

  // Team: drei Arbeiter, zwei eingeteilt, einer noch frei → Karte „Heute auf der Baustelle“ (Tools und Team)
  await page.goto('./baupad/arbeitereinteilung/personal');
  const wd = page.getByTestId('staff-page');
  for (const [first, last] of [
    ['Anna', 'Huber'],
    ['Tom', 'Maier'],
    ['Lisa', 'Berger'],
  ]) {
    await wd.getByTestId('staff-new').click();
    await wd.getByTestId('worker-firstName').fill(first);
    await wd.getByTestId('worker-lastName').fill(last);
    await wd.getByTestId('worker-save').click();
  }
  await expect(wd.getByTestId('worker-row')).toHaveCount(3);
  await page.goto('./baupad/arbeitereinteilung');
  await page.getByTestId('add-site').click();
  await pickWeekProject(page, 'Rohbau Müller');
  const card = page.locator('[data-testid="site-card"][data-site="Rohbau Müller"]');
  await card.locator('[data-day="0"] [data-testid="day-add"]').click();
  const dlg = page.getByTestId('assign-dialog');
  for (const n of ['Huber Anna', 'Maier Tom']) await dlg.locator(`[data-testid="assign-worker"][data-worker="${n}"] input`).check();
  await dlg.getByTestId('assign-save').click();
  await expect(page.getByTestId('team-today-count')).toHaveText('2 Mitarbeiter eingeteilt');
  await expect(page.getByTestId('team-today-open')).toContainText('1 noch frei');
  await expect(page.getByTestId('team-today-open')).toContainText('Berger Lisa');

  await page.goto('./baupad/tools');
  const today = page.getByTestId('crew-today');
  await expect(today.getByTestId('crew-today-count')).toHaveText('2 Mitarbeiter eingeteilt');
  await expect(today).toContainText('17 Std. geplant · 07:00–16:00');
  await expect(today.getByTestId('crew-today-open')).toContainText('1 noch frei');
  await today.click();
  await expect(page.getByTestId('workers-title')).toHaveText('Team');
});
