import { expect, test } from './fixtures';
import { freshStart } from './helpers';

test('Darstellung: Größe Klein/Mittel/Groß, Dunkelmodus an/aus/System, App ohne Seiten-Zoom (Website mit)', async ({ page }) => {
  await freshStart(page);
  await page.goto('/baupad/konto/darstellung');
  const html = page.locator('html');
  const viewport = () => page.locator('meta[name="viewport"]').getAttribute('content');
  await expect(page.getByTestId('appearance-settings')).toBeVisible();
  // App: feste Größe
  expect(await viewport()).toContain('maximum-scale=1');
  await expect(html).toHaveClass(/app-fixed/);
  // Größe
  await expect(html).toHaveAttribute('data-size', 'medium');
  await page.getByTestId('ui-size-large').click();
  await expect(html).toHaveAttribute('data-size', 'large');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('18px');
  await page.getByTestId('ui-size-small').click();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('14px');
  // Dunkelmodus an / aus / wie System
  await expect(html).toHaveAttribute('data-theme', 'light');
  await page.getByTestId('ui-theme-dark').click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(0, 0, 0)');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.getByTestId('ui-theme-system').click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(html).toHaveAttribute('data-theme', 'dark');
  // bleibt nach dem Neuladen und gilt in den Tools
  await page.goto('/baupad/tools');
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(html).toHaveAttribute('data-size', 'small');
  // Website: eigenes Design, Zoom erlaubt
  await page.goto('/impressum');
  await expect(html).not.toHaveAttribute('data-theme', /./);
  expect(await viewport()).not.toContain('maximum-scale');
});
