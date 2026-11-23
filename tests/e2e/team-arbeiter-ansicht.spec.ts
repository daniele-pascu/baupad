import { expect, test } from './fixtures';
import { freshStart, newWeekProject } from './helpers';

/**
 * Team, Ansicht „Arbeiter“: je Arbeiter eine Zeile mit der Woche – Kürzel der Baustelle je Tag, U/K, „?“ für
 * noch nicht eingeteilt; nach Funktion oder A–Z; Antippen teilt ein bzw. öffnet das Fenster des Arbeiters.
 */
test('Team: Arbeiter-Ansicht – Woche je Arbeiter, nach Funktion oder A–Z, Antippen teilt ein', async ({ page }) => {
  await freshStart(page);
  await page.goto('./#/arbeitereinteilung');
  await page.getByTestId('week-date').fill('2026-11-02'); // KW 45, ohne Feiertag
  await page.getByTestId('crew-workers').click();
  const sp = page.getByTestId('staff-page');
  for (const [first, last, grade] of [
    ['Zoe', 'Adler', 'hilfsarbeiter'],
    ['Max', 'Muster', 'polier'],
    ['Anna', 'Berg', 'facharbeiter'],
  ]) {
    await sp.getByTestId('staff-new').click();
    await sp.getByTestId('worker-firstName').fill(first);
    await sp.getByTestId('worker-lastName').fill(last);
    await sp.getByTestId('worker-grade').selectOption(grade);
    await sp.getByTestId('worker-save').click();
    await expect(sp.getByTestId('worker-row').filter({ hasText: last })).toHaveCount(1);
  }
  await page.goto('./baupad/arbeitereinteilung');
  await page.getByTestId('week-date').fill('2026-11-02');
  await expect(page.getByTestId('week-label')).toHaveText('KW 45');
  await page.getByTestId('add-site').click();
  await newWeekProject(page, 'Gesundheitszentrum');
  // Max die ganze Woche auf dem Gesundheitszentrum (Baustellen-Ansicht)
  await page.locator('[data-testid="site-card"][data-site="Gesundheitszentrum"] [data-day="0"] [data-testid="day-add"]').click();
  const ad = page.getByTestId('assign-dialog');
  await ad.locator('[data-testid="assign-worker"][data-worker="Muster Max"] input').check();
  await ad.getByTestId('assign-save').click();

  // Umschalten: Arbeiter
  await page.getByTestId('crew-view-workers').click();
  const ww = page.getByTestId('crew-worker-week');
  await expect(ww).toBeVisible();
  await expect(page.getByTestId('site-card')).toHaveCount(0);
  // nach Funktion: Polier, Facharbeiter, Hilfsarbeiter
  await expect(ww.getByTestId('crew-ww-row')).toHaveCount(3);
  expect(await ww.getByTestId('crew-ww-row').evaluateAll((r) => r.map((x) => x.getAttribute('data-worker')))).toEqual(['Muster Max', 'Berg Anna', 'Adler Zoe']);
  // Max: Mo–Fr Gesundheitszentrum (Kürzel GE), die anderen offen
  const max = ww.locator('[data-testid="crew-ww-row"][data-worker="Muster Max"]');
  await expect(max.locator('[data-testid="crew-ww-cell"][data-kind="site"]')).toHaveCount(5);
  await expect(max.locator('[data-testid="crew-ww-cell"]').first()).toContainText('GE');
  const anna = ww.locator('[data-testid="crew-ww-row"][data-worker="Berg Anna"]');
  await expect(anna.locator('[data-testid="crew-ww-cell"][data-kind="open"]')).toHaveCount(5);
  await expect(page.getByTestId('crew-ww-legend')).toContainText('Gesundheitszentrum');
  // A–Z: Adler, Berg, Muster – bleibt gemerkt
  await ww.getByTestId('crew-ww-order-name').click();
  expect(await ww.getByTestId('crew-ww-row').evaluateAll((r) => r.map((x) => x.getAttribute('data-worker')))).toEqual(['Adler Zoe', 'Berg Anna', 'Muster Max']);
  // offenes Feld antippen → einteilen (restliche Woche)
  await anna.locator('[data-testid="crew-ww-cell"][data-day="2"]').click();
  const od = page.getByTestId('open-dialog');
  await expect(od).toBeVisible();
  await od.locator('[data-testid="open-site"][data-site="Gesundheitszentrum"]').click();
  await expect(od).toHaveCount(0);
  await expect(anna.locator('[data-testid="crew-ww-cell"][data-day="2"]')).toHaveAttribute('data-kind', 'site');
  await expect(anna.locator('[data-testid="crew-ww-cell"][data-day="0"]')).toHaveAttribute('data-kind', 'open');
  // eingeteiltes Feld antippen → Fenster des Arbeiters auf der Baustelle
  await max.locator('[data-testid="crew-ww-cell"][data-day="1"]').click();
  await expect(page.getByTestId('chip-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('chip-dialog')).toHaveCount(0);
  // Ansicht und Reihenfolge bleiben nach dem Neuladen
  await page.reload();
  await expect(page.getByTestId('crew-worker-week')).toHaveAttribute('data-order', 'name');
  // zurück zu den Baustellen
  await page.getByTestId('crew-view-sites').click();
  await expect(page.getByTestId('site-card')).toHaveCount(1);
  await expect(page.getByTestId('crew-worker-week')).toHaveCount(0);
});
