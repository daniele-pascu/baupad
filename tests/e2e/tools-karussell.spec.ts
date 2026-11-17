import { expect, test } from './fixtures';
import { freshStart } from './helpers';

/** Tools-Seite: 3D-Karussell (dreht sich ständig, Intro), Kacheln drehen sich immer wieder; Bewegung reduzieren = still */
test('Tools: Karussell dreht sich, hält unter der Maus an, vordere Karte öffnet das Werkzeug; Kacheln drehen sich', async ({ page }) => {
  await freshStart(page);
  await page.goto('./baupad/tools');
  const orbit = page.getByTestId('tool-orbit');
  await expect(orbit.getByTestId('orbit-card')).toHaveCount(7);
  await expect(orbit).toHaveAttribute('aria-hidden', 'true'); // dieselben Werkzeuge stehen als Kacheln darunter
  await page.waitForTimeout(1500); // Intro vorbei
  const pos = () => orbit.getByTestId('orbit-card').first().evaluate((e) => (e as HTMLElement).style.transform);
  const a = await pos();
  await page.waitForTimeout(500);
  expect(await pos()).not.toBe(a);
  // die Kacheln drehen sich (erste Runde gruppenweise)
  await expect(page.locator('.tool-tile.spin').first()).toBeAttached({ timeout: 6000 });
  // kein seitliches Scrollen
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  // Maus darüber: steht still
  await orbit.locator('.orbit-stage').hover();
  await page.waitForTimeout(200);
  const b = await pos();
  await page.waitForTimeout(500);
  expect(await pos()).toBe(b);
  // nur die vordere Karte ist antippbar – sie öffnet ihr Werkzeug
  await expect(orbit.locator('[data-testid="orbit-card"][data-front]')).toHaveCount(1);
  const href = await orbit.locator('[data-testid="orbit-card"][data-front]').getAttribute('href');
  await orbit.locator('[data-testid="orbit-card"][data-front]').click();
  await expect(page).toHaveURL(new RegExp(`${href!.replace(/^\.?\//, '').replace(/[?]/g, '\\?')}$`));
});

test.describe('Bewegung reduzieren', () => {
  test.use({ reducedMotion: 'reduce' });
  test('Tools: Karussell steht still, Kacheln drehen sich nicht', async ({ page }) => {
    await freshStart(page);
    await page.goto('./baupad/tools');
    const card = page.getByTestId('orbit-card').first();
    await page.waitForTimeout(300);
    const a = await card.evaluate((e) => (e as HTMLElement).style.transform);
    await page.waitForTimeout(2500);
    expect(await card.evaluate((e) => (e as HTMLElement).style.transform)).toBe(a);
    await expect(page.locator('.tool-tile.spin')).toHaveCount(0);
  });
});
