import { expect, test } from '@playwright/test';

/** BauPad als App installieren: Startseite (Link) und Konto → App und Speicher; Aufmaß & Abrechnung bleibt unverändert */

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

test('PC: ohne Browser-Dialog Anleitung je Gerät; Aufmaß & Abrechnung ohne Installieren-Knopf', async ({ page }) => {
  await page.goto('./#/');
  const btn = page.getByTestId('install-app');
  await expect(btn).toBeVisible();
  await btn.click();
  const guide = page.getByTestId('install-guide');
  await expect(guide).toBeVisible();
  await expect(page.getByTestId('install-tab-desktop')).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('install-tab-ios').click();
  await expect(guide.locator('.install-step')).toHaveCount(3);
  await expect(guide).toContainText('Zum Home-Bildschirm');
  await page.getByTestId('install-tab-android').click();
  await expect(guide).toContainText('App installieren');
  await page.keyboard.press('Escape');
  await expect(guide).toHaveCount(0);
  await page.goto('./#/projekte');
  await expect(page.getByTestId('projects-title')).toBeVisible();
  await expect(page.getByTestId('install-app')).toHaveCount(0);
});

test('Android/PC: Installationsdialog des Browsers wird direkt geöffnet', async ({ page }) => {
  await page.goto('./#/');
  await page.evaluate(() => {
    const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };
    e.prompt = async () => void ((window as unknown as { prompted: boolean }).prompted = true);
    e.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(e);
  });
  await page.getByTestId('install-app').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { prompted?: boolean }).prompted)).toBe(true);
  await expect(page.getByTestId('install-guide')).toHaveCount(0);
  await expect(page.getByTestId('install-app')).toHaveCount(0); // installiert → Knopf weg
});

test('Bereits als App geöffnet: kein Installieren-Knopf; Konto zeigt Status', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { get: () => true });
    localStorage.setItem('authSkipped', '1'); // „ohne Konto weiter“ wurde schon gewählt
  });
  // die installierte App startet in den Tools; die Startseite zeigt keinen Installieren-Link
  await page.goto('./#/');
  await expect(page.getByTestId('tools-title')).toBeVisible();
  await page.evaluate(() => (location.hash = '#/'));
  await expect(page.getByTestId('cta-tools')).toBeVisible();
  await expect(page.getByTestId('install-app')).toHaveCount(0);
  await page.goto('./#/konto');
  await expect(page.getByTestId('app-installed')).toHaveText('Als App installiert');
});

test('Konto: App und Speicher – Status und dauerhafte Speicherung anfordern', async ({ page }) => {
  await page.goto('./#/konto');
  const box = page.getByTestId('app-settings');
  await expect(box.getByTestId('app-installed')).toHaveText('Im Browser geöffnet');
  await expect(box.getByTestId('storage-persisted')).toBeVisible();
  await expect(box.getByTestId('install-app')).toBeVisible();
  const persist = box.getByTestId('storage-persist');
  if (await persist.count()) {
    await expect(box.getByTestId('storage-hint')).toBeVisible();
    await persist.click();
    await expect(page.locator('.toast')).toBeVisible();
  }
});

test.describe('iPhone', () => {
  test.use({ userAgent: IPHONE, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('Anleitung „Zum Home-Bildschirm“ mit drei Schritten und Hinweis zum eigenen Speicher', async ({ page }) => {
    await page.goto('./#/');
    await page.getByTestId('install-app').tap();
    const guide = page.getByTestId('install-guide');
    await expect(page.getByTestId('install-tab-ios')).toHaveAttribute('aria-selected', 'true');
    await expect(guide.locator('.install-step')).toHaveCount(3);
    await expect(guide).toContainText('Teilen');
    await expect(guide).toContainText('Projektsicherung öffnen');
    // passt auf den Bildschirm
    const b = (await guide.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(391);
  });
});
